-- ---------------------------------------------------------------------------
-- 0098 — Nachrichten zu einer Bestellung, und Systemereignisse daneben.
--
-- ZWEI QUELLEN, EIN STRANG. Was Menschen schreiben, steht in
-- `order_messages`. Was das System getan hat, steht seit jeher in
-- `order_events` — und bleibt dort. Es wird nicht kopiert, sondern beim Lesen
-- projiziert.
--
-- Das ist der Grund, warum „eine Systemmeldung ist nicht fälschbar" hier
-- keine Regel ist, die jemand durchsetzen müsste, sondern eine Eigenschaft:
-- eine Systemzeile kann in `order_messages` gar nicht stehen (ein CHECK lässt
-- nur `customer` und `seller` zu), und in `order_events` schreibt kein
-- Client — dort gibt es seit 0010 keine einzige Schreib-Policy und keinen
-- Grant. Eine kopierte Meldung wäre dagegen eine zweite Wahrheit, und die
-- einzige Frage an eine zweite Wahrheit ist, wann sie abweicht (ADR-0106).
--
-- WAS DIESE MIGRATION NICHT ANFASST: Bestellungen, Positionen, Bestand, Geld,
-- Widerrufe, Mail. Sie legt zwei Tabellen an und liest ansonsten nur.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1. Die Nachrichten
-- ---------------------------------------------------------------------------
create table if not exists public.order_messages (
  id       bigint generated always as identity primary key,
  order_id bigint not null,

  -- WER GESCHRIEBEN HAT — vom Server gesetzt, nie vom Aufrufer. Ein Käufer
  -- kann sich nicht als Verkäufer ausgeben, weil er das Feld nicht schicken
  -- kann: `post_order_message()` leitet es aus der Rolle ab.
  author_kind    text not null,
  -- Wie im Ereignisjournal: ein gelöschtes Konto nimmt die Nachricht nicht
  -- mit, es macht sie anonym.
  author_user_id uuid,

  body       text not null,
  created_at timestamptz not null default now(),

  constraint order_messages_order_fk foreign key (order_id)
    references public.orders (id) on update cascade on delete restrict,
  constraint order_messages_author_fk foreign key (author_user_id)
    references auth.users (id) on update cascade on delete set null,

  -- Nur Menschen. `system` steht bewusst NICHT hier.
  constraint order_messages_author_kind_known
    check (author_kind in ('customer', 'seller')),
  -- Serverseitige Grenze, dritte Instanz nach Formular und RPC.
  constraint order_messages_body_length
    check (length(body) between 1 and 2000)
);

create index if not exists order_messages_by_order
  on public.order_messages (order_id, created_at);

comment on table public.order_messages is
  'Text messages between the customer and the seller, always bound to one order (0098). Human authors only — a system notification is never a row here; it is projected from order_events when the conversation is read, which is what makes it unforgeable. Append-only: a trigger refuses UPDATE and DELETE. No client role holds any privilege; everything goes through the security-definer functions below.';
comment on column public.order_messages.author_kind is
  'customer | seller. Derived by the server from who is asking, never accepted from the caller.';


-- ---------------------------------------------------------------------------
-- 2. Der Lesestand
--
-- EIN WASSERSTAND, KEIN STATUS JE NACHRICHT. Der Strang besteht aus zwei
-- Quellen, und eine projizierte Systemzeile hat keine eigene Zeile, die man
-- als gelesen markieren könnte. Ein Zeitstempel je (Bestellung, Seite) ist
-- das Einzige, was über beide funktioniert.
--
-- `reader` ist die SEITE, nicht die Person: der Betrieb hat einen gemeinsamen
-- Lesestand. Alles andere führte eine Operator-Identität ein, die es in
-- diesem Produkt nicht geben soll (CLAUDE.md, Single-Seller).
-- ---------------------------------------------------------------------------
create table if not exists public.order_conversation_reads (
  order_id     bigint not null,
  reader       text   not null,
  last_read_at timestamptz not null default now(),
  updated_by   uuid,

  constraint order_conversation_reads_pk primary key (order_id, reader),
  constraint order_conversation_reads_order_fk foreign key (order_id)
    references public.orders (id) on update cascade on delete restrict,
  constraint order_conversation_reads_user_fk foreign key (updated_by)
    references auth.users (id) on update cascade on delete set null,
  constraint order_conversation_reads_reader_known
    check (reader in ('customer', 'seller'))
);

comment on table public.order_conversation_reads is
  'How far each side has read one order''s conversation (0098). One watermark per side, not a status per message: the stream merges order_messages with projected order_events, and a projection has no row to tick off. The seller side is shared by the whole operation — there is no operator identity in this product.';


-- ---------------------------------------------------------------------------
-- 3. Unveränderlichkeit — dieselbe Form wie `order_mail_protect()` (0019)
--
-- Die Regeln stehen in den Funktionen weiter unten. Dieser Trigger macht das
-- eine, was unabhängig vom Aufrufer gelten muss, strukturell unmöglich: eine
-- abgeschickte Nachricht wird nicht umgeschrieben und nicht entfernt. Was
-- gesagt wurde, wurde gesagt.
-- ---------------------------------------------------------------------------
create or replace function public.order_messages_protect()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'an order message is never edited'
      using errcode = 'restrict_violation';
  end if;
  raise exception 'an order message is never deleted'
    using errcode = 'restrict_violation';
end;
$$;

comment on function public.order_messages_protect() is
  'Refuses UPDATE and DELETE on order_messages (0098). Defence in depth: the functions never attempt either, and this makes it impossible whatever a future caller tries. No role holds EXECUTE: a trigger function cannot be called directly — PostgreSQL refuses a function returning `trigger` outside a trigger — and the trigger itself fires without consulting the caller''s privilege on it.';

/*
 * KEIN EINZIGES EXECUTE, AUCH NICHT FÜR service_role.
 *
 * Eine neu angelegte Funktion trägt per Default EXECUTE für PUBLIC, und auf
 * Supabase zusätzlich die Standardrechte für `anon`, `authenticated` und
 * `service_role`. Ohne diese Zeile stünde eine interne Schutzfunktion als
 * aufrufbarer RPC im Schema — genau der Befund, den 0082 schon einmal
 * nachgetragen hat und den 0095 bei zwei Lesefunktionen wiederholt hat.
 *
 * Hier ist der Entzug vollständig und ohne Risiko: ein direkter Aufruf ist
 * ohnehin unmöglich (PostgreSQL weist eine Funktion mit Rückgabetyp `trigger`
 * außerhalb eines Triggers ab), und das Feuern des Triggers prüft das
 * EXECUTE-Recht des Aufrufers nicht. Null Rechte ist deshalb die kleinste
 * Menge, die funktioniert — nicht die kleinste, die man sich traut.
 */
revoke all on function public.order_messages_protect()
  from public, anon, authenticated, service_role;

drop trigger if exists order_messages_protect on public.order_messages;
create trigger order_messages_protect
  before update or delete on public.order_messages
  for each row execute function public.order_messages_protect();


-- ---------------------------------------------------------------------------
-- 4. Rechte: keine. Alles läuft über die Funktionen.
-- ---------------------------------------------------------------------------
alter table public.order_messages enable row level security;
revoke all on public.order_messages from public, anon, authenticated;

alter table public.order_conversation_reads enable row level security;
revoke all on public.order_conversation_reads from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 5. Wer darf diese Unterhaltung sehen?
--
-- EINE STELLE, DIE ES ENTSCHEIDET, und jede Funktion unten fragt sie. Zwei
-- Wege hinein: das Konto, das bestellt hat, oder der Betrieb.
--
-- GÄSTE HABEN IN V1 KEINE UNTERHALTUNG. Eine Gastbestellung hat kein Konto,
-- also keine Gegenseite, die je läse — ein Strang, in den nur einer schreiben
-- kann, ist keine Unterhaltung, sondern ein Zettel. Die Checkout-Capability
-- wäre der technisch mögliche zweite Weg und wird bewusst nicht genommen:
-- sie lebt in einem Tab, eine Korrespondenz lebt länger.
-- ---------------------------------------------------------------------------
create or replace function public.order_conversation_role(p_order_id bigint)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
           when not exists (select 1 from public.orders o
                             where o.id = p_order_id and o.user_id is not null)
             then null
           when exists (select 1 from public.orders o
                         where o.id = p_order_id
                           and o.user_id = (select auth.uid()))
             then 'customer'
           when public.can_operate_active_seller()
             then 'seller'
           else null
         end;
$$;

comment on function public.order_conversation_role(bigint) is
  'customer | seller | NULL for the current request on one order (0098). NULL for a guest order (no account, so no conversation in V1), for a stranger, and for an order that does not exist — the same uniform answer my_order() gives. Internal: no client role holds EXECUTE.';

revoke all on function public.order_conversation_role(bigint) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 6. Welche Ereignisse im Strang erscheinen — und mit welchen Feldern
--
-- DER KANAL IST EIN GESPRÄCH, KEINE BESTELLHISTORIE. Das ist die Regel, aus
-- der sich die Liste ergibt, und sie ist kürzer, als sie zuerst war.
--
-- Anfangs standen hier sieben Typen — Zahlung, Storno, Retoure, Erstattung,
-- Widerruf, Bestellstorno, Versand. Fachlich richtig, im Gespräch falsch:
-- eine Bestellung erzeugt davon schnell ein Dutzend, und der Strang wurde zu
-- einer Chronik, in der die zwei Sätze zwischen Menschen untergingen. Die
-- vollständige Historie hat ihren Ort — `order_events` und der Bestellschirm
-- —, und der ist nicht dieser hier.
--
-- ZWEI ERSCHEINEN, WEIL ZWEI EINE ANTWORT VERDIENEN:
--
--   order_shipped    „Wo ist mein Paket?" — die Antwort steht dann da.
--   refund_recorded  „Wo ist mein Geld?"  — ebenso.
--
-- Alles andere bleibt unverändert im System und in der Bestellhistorie; es
-- wird hier nur nicht projiziert. Kein Ereignis wird gelöscht, keines
-- verändert, keine Zeile angefasst.
--
-- DIE LISTE STEHT IN SQL, nicht im Client. Ein Client, der sie erweitern
-- könnte, wäre keine Whitelist.
--
-- DIE PAYLOAD WIRD NIE DURCHGEREICHT. `order_events.payload` trägt
-- `movement_id`, `correction_movement_id`, `refund_id`, `attempt_id`,
-- `invoice_number`, `stock_outcome`, `withdrawal_request_id` — interne
-- Identitäten und Betriebsinterna, die in einem Kundenkanal nichts zu suchen
-- haben. Drei Felder sind freigegeben, und nur diese drei:
--
--   quantity       wie viele Stück betroffen sind
--   amount         welcher Betrag erstattet wurde
--
-- `order_line_id` war hier kurz dabei, mit dem Argument, der Lesende habe die
-- Bestellung ohnehin vor sich. Es ist trotzdem ein interner Primärschlüssel,
-- und die Regel lautet nicht „ungefährlich im Einzelfall", sondern „interne
-- Identitäten verlassen den Kundenkanal nicht". Soll eine Meldung später eine
-- Position benennen, bekommt sie eine kontrollierte öffentliche Projektion —
-- eine Positionsnummer innerhalb der Bestellung etwa — und nicht den PK.
--
-- Freien Text gibt es hier nicht. Der deutsche Satz entsteht in der
-- Oberfläche aus dem Typ; aus einem Systemereignis kann deshalb kein Markup
-- in die Seite gelangen.
-- ---------------------------------------------------------------------------
create or replace function public.order_conversation_events(p_order_id bigint)
returns table (
  event_id   bigint,
  event_type text,
  actor_kind text,
  occurred_at timestamptz,
  fields     jsonb
)
language sql
stable
set search_path = ''
as $$
  select e.id, e.event_type, e.actor_kind, e.created_at,
         (select coalesce(jsonb_object_agg(k, e.payload -> k), '{}'::jsonb)
            from unnest(array['quantity', 'amount']) as k
           where e.payload ? k)
    from public.order_events e
   where e.order_id = p_order_id
     and e.event_type in ('order_shipped', 'refund_recorded')
$$;

comment on function public.order_conversation_events(bigint) is
  'The order events that belong in a CONVERSATION — order_shipped and refund_recorded, and nothing else (0098). The channel is a conversation between the customer and the seller, not the order''s history: the full record lives in order_events and on the order screen. Two payload fields are allowed through, quantity and amount. Everything the payload otherwise carries — order line ids, movement ids, refund ids, invoice numbers, stock outcomes — stays inside: internal identities do not leave for the customer channel, however harmless one of them looks on its own. Internal: no client role holds EXECUTE; it is reached through order_conversation(), which has already decided who may ask.';

revoke all on function public.order_conversation_events(bigint) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 7. Die Unterhaltung lesen
--
-- WAS ALS UNGELESEN ZÄHLT. Neuer als der eigene Wasserstand — und nicht von
-- einem selbst. Für Nachrichten ist das `author_kind <> meine Rolle`. Für
-- Systemereignisse entscheidet `actor_kind`: was der Betrieb ausgelöst hat
-- (`admin`), ist für den Käufer neu und für den Betrieb nicht; was der Kunde
-- ausgelöst hat (`customer`), umgekehrt; was Zahlungsanbieter oder System
-- taten, ist für beide neu. Ohne diese Unterscheidung stünde am Betrieb ein
-- Zähler, der die eigenen Klicks mitzählt.
--
-- Ohne Wasserstand gilt alles als ungelesen: eine Unterhaltung, die noch nie
-- geöffnet wurde, hat nichts Gelesenes.
-- ---------------------------------------------------------------------------
create or replace function public.order_conversation(p_order_number text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_order  record;
  v_role   text;
  v_read   timestamptz;
  v_items  jsonb;
  v_unread integer;
begin
  select o.id, o.order_number, o.fulfillment_status, o.payment_status
    into v_order
    from public.orders o
   where o.order_number = p_order_number;
  if not found then
    -- Unbekannt und nicht-deins antworten gleich. Sonst wäre diese Funktion
    -- ein Orakel für fremde Bestellnummern.
    return null;
  end if;

  v_role := public.order_conversation_role(v_order.id);
  if v_role is null then
    return null;
  end if;

  select r.last_read_at into v_read
    from public.order_conversation_reads r
   where r.order_id = v_order.id and r.reader = v_role;

  with stream as (
    select 'message'::text as kind,
           m.id            as id,
           m.created_at    as at,
           m.author_kind   as author_kind,
           m.body          as body,
           null::text      as event_type,
           '{}'::jsonb     as fields,
           (m.author_kind <> v_role)                        as from_other
      from public.order_messages m
     where m.order_id = v_order.id
    union all
    select 'event',
           e.event_id,
           e.occurred_at,
           e.actor_kind,
           null,
           e.event_type,
           e.fields,
           case v_role
             when 'customer' then e.actor_kind <> 'customer'
             else                 e.actor_kind <> 'admin'
           end
      from public.order_conversation_events(v_order.id) e
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', s.kind, 'id', s.id, 'at', s.at,
           'author_kind', s.author_kind, 'body', s.body,
           'event_type', s.event_type, 'fields', s.fields,
           'unread', s.from_other and (v_read is null or s.at > v_read))
           order by s.at, s.kind, s.id), '[]'::jsonb),
         count(*) filter (where s.from_other and (v_read is null or s.at > v_read))
    into v_items, v_unread
    from stream s;

  return jsonb_build_object(
    'order_number', v_order.order_number,
    'role', v_role,
    'last_read_at', v_read,
    'unread', v_unread,
    -- Geschrieben werden darf immer. Eine Rückfrage kommt oft erst, wenn die
    -- Bestellung längst abgeschlossen, storniert oder erstattet ist.
    'writable', true,
    'items', v_items);
end;
$$;

comment on function public.order_conversation(text) is
  'One order''s conversation for whoever is asking (0098): human messages merged with the whitelisted order events, in time order, plus the reader''s watermark and unread count. NULL for an order that does not exist, a guest order, or somebody who is neither the customer nor the operation — one answer for all three, so the function cannot be used to probe order numbers. Reads only.';

revoke all on function public.order_conversation(text) from public, anon;
grant execute on function public.order_conversation(text) to authenticated;


-- ---------------------------------------------------------------------------
-- 8. Schreiben
--
-- DAS RATE LIMIT SPERRT ZU, NICHT AUF. Gezählt wird unter einem
-- Advisory-Lock auf die Bestellung: zwei gleichzeitige Absendungen sehen
-- sonst beide 19 und werden beide zu Nummer 20. Der Lock gilt für die
-- Transaktion und fällt mit ihr, und er nimmt keine Zeile in Anspruch, die
-- ein anderer Vorgang braucht.
--
-- Zwanzig menschliche Nachrichten je Bestellung und Stunde, beide Seiten
-- zusammen. Das ist keine Produktregel, sondern eine Bremse gegen Unfug und
-- gegen eine Schleife im Client.
-- ---------------------------------------------------------------------------
create or replace function public.post_order_message(
  p_order_number text,
  p_body         text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_order_id bigint;
  v_role     text;
  v_body     text;
  v_recent   integer;
  v_id       bigint;
  v_at       timestamptz;
begin
  select o.id into v_order_id
    from public.orders o where o.order_number = p_order_number;
  if not found then
    raise exception 'no such conversation' using errcode = 'no_data_found';
  end if;

  v_role := public.order_conversation_role(v_order_id);
  if v_role is null then
    -- Dieselbe Meldung wie für eine unbekannte Bestellung.
    raise exception 'no such conversation' using errcode = 'no_data_found';
  end if;

  -- Getrimmt, aber nicht sonst verändert: was jemand schreibt, steht so da.
  v_body := btrim(coalesce(p_body, ''));
  if v_body = '' then
    raise exception 'a message needs a body' using errcode = 'invalid_parameter_value';
  end if;
  if length(v_body) > 2000 then
    raise exception 'a message of % characters is too long', length(v_body)
      using errcode = 'check_violation';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('order_messages'), v_order_id::integer);

  select count(*) into v_recent
    from public.order_messages m
   where m.order_id = v_order_id
     and m.created_at > pg_catalog.now() - interval '1 hour';
  if v_recent >= 20 then
    raise exception 'too many messages for this order in the last hour'
      using errcode = 'restrict_violation';
  end if;

  insert into public.order_messages (order_id, author_kind, author_user_id, body)
  values (v_order_id, v_role, (select auth.uid()), v_body)
  returning id, created_at into v_id, v_at;

  -- Wer schreibt, hat gelesen. Sonst zählte die eigene Nachricht gegen den
  -- eigenen Wasserstand als „neu, aber nicht von mir" — sie tut es nicht,
  -- aber der Stand hinkte trotzdem hinterher.
  insert into public.order_conversation_reads (order_id, reader, last_read_at, updated_by)
  values (v_order_id, v_role, v_at, (select auth.uid()))
  on conflict (order_id, reader)
    do update set last_read_at = greatest(public.order_conversation_reads.last_read_at, excluded.last_read_at),
                  updated_by = excluded.updated_by;

  return jsonb_build_object('id', v_id, 'created_at', v_at, 'author_kind', v_role);
end;
$$;

comment on function public.post_order_message(text, text) is
  'Adds one message to an order''s conversation (0098). The author side is derived from who is asking and can never be supplied by the caller, so a customer cannot post as the seller. Refuses an empty body, more than 2000 characters, and more than 20 human messages per order per hour — counted under an advisory lock on the order, so two concurrent sends cannot both pass. Writes nothing else: no stock, no money, no order state.';

revoke all on function public.post_order_message(text, text) from public, anon;
grant execute on function public.post_order_message(text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 9. Als gelesen markieren
-- ---------------------------------------------------------------------------
create or replace function public.mark_order_conversation_read(p_order_number text)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_order_id bigint;
  v_role     text;
  v_at       timestamptz := pg_catalog.now();
begin
  select o.id into v_order_id
    from public.orders o where o.order_number = p_order_number;
  if not found then
    return null;
  end if;
  v_role := public.order_conversation_role(v_order_id);
  if v_role is null then
    return null;
  end if;

  insert into public.order_conversation_reads (order_id, reader, last_read_at, updated_by)
  values (v_order_id, v_role, v_at, (select auth.uid()))
  on conflict (order_id, reader)
    -- Der Stand geht nur vorwärts. Ein spätes Nachladen darf einen neueren
    -- Stand nicht zurückdrehen.
    do update set last_read_at = greatest(public.order_conversation_reads.last_read_at, excluded.last_read_at),
                  updated_by = excluded.updated_by;

  return v_at;
end;
$$;

comment on function public.mark_order_conversation_read(text) is
  'Moves the caller''s side of one conversation to now (0098). Idempotent and monotonic: the watermark never moves backwards. NULL where there is no conversation for this caller.';

revoke all on function public.mark_order_conversation_read(text) from public, anon;
grant execute on function public.mark_order_conversation_read(text) to authenticated;


-- ---------------------------------------------------------------------------
-- 10. Die Posteingänge und die beiden Zahlen am Rand
--
-- GEZÄHLT WIRD MIT EINEM AGGREGAT, NICHT ÜBER EINE LISTE. `admin_orders()`
-- ist bei 100 Zeilen gedeckelt, und genau deshalb log der alte Badge ab der
-- 101. offenen Bestellung (ADR-0082). Dieselbe Falle stellt sich hier
-- sofort wieder, sobald jemand „zähl die Unterhaltungen der ersten Seite"
-- schreibt. Also nicht.
--
-- SORTIERUNG DES POSTEINGANGS: erst was ungelesen ist, dann das Neueste.
-- Nicht „älteste unbeantwortete zuerst" — V1 kennt kein „beantwortet", und
-- eine Sortierung nach einem Zustand, den es nicht gibt, wäre eine
-- Behauptung.
-- ---------------------------------------------------------------------------
create or replace function public.conversation_summaries(p_role text)
returns table (
  order_number text,
  last_at      timestamptz,
  unread       integer,
  total        integer
)
language sql
stable
set search_path = ''
as $$
  with scope as (
    select o.id, o.order_number
      from public.orders o
     where o.user_id is not null
       and case p_role
             when 'customer' then o.user_id = (select auth.uid())
             else public.can_operate_active_seller()
           end
       /*
        * EIN POSTEINGANG LISTET GESPRÄCHE, KEINE BESTELLUNGEN.
        *
        * Ohne diese Bedingung genügte ein Versand, damit eine Bestellung
        * unter „Nachrichten" auftauchte — mit einem Eintrag, auf den niemand
        * antworten wollte, und einer Zahl am Rand für eine Mitteilung, die
        * auf der Bestellseite ohnehin steht. Der Posteingang füllte sich mit
        * Bestellungen statt mit Korrespondenz.
        *
        * Eine Unterhaltung beginnt, wenn ein Mensch schreibt. Ab dann gehören
        * Versand und Erstattung chronologisch dazu und zählen wie bisher;
        * davor gibt es nichts zu listen. `order_conversation()` ist davon
        * unberührt — auf der Bestellseite werden beide Meldungen weiterhin
        * gezeigt, auch wenn nie jemand geschrieben hat.
        */
       and exists (select 1 from public.order_messages m where m.order_id = o.id)
  ),
  stream as (
    select s.id, s.order_number, m.created_at as at,
           (m.author_kind <> p_role) as from_other
      from scope s join public.order_messages m on m.order_id = s.id
    union all
    select s.id, s.order_number, e.occurred_at,
           case p_role when 'customer' then e.actor_kind <> 'customer'
                       else e.actor_kind <> 'admin' end
      from scope s cross join lateral public.order_conversation_events(s.id) e
  )
  select st.order_number,
         max(st.at),
         count(*) filter (
           where st.from_other
             and (r.last_read_at is null or st.at > r.last_read_at))::integer,
         count(*)::integer
    from stream st
    left join public.order_conversation_reads r
           on r.order_id = st.id and r.reader = p_role
   group by st.order_number, r.last_read_at
   having count(*) > 0
   order by (count(*) filter (
              where st.from_other
                and (r.last_read_at is null or st.at > r.last_read_at)) > 0) desc,
            max(st.at) desc
$$;

comment on function public.conversation_summaries(text) is
  'One row per order that HAS a conversation — at least one human message — for the given side (0098): last activity, unread count, total entries. A shipment or a refund alone does not put an order in the inbox; it is shown on the order screen, where order_conversation() answers without this condition. Sorted unread first, then newest activity — V1 has no notion of "answered", so it does not pretend to sort by one. Internal: no client role holds EXECUTE; my_conversations() and seller_conversations() decide who may ask.';

revoke all on function public.conversation_summaries(text) from public, anon, authenticated;


create or replace function public.my_conversations()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when (select auth.uid()) is null then '[]'::jsonb else
    coalesce((select jsonb_agg(jsonb_build_object(
                'order_number', c.order_number, 'last_at', c.last_at,
                'unread', c.unread, 'total', c.total)
                /* Die Sortierung der Funktion ueberlebt ein `jsonb_agg` nicht
                   von selbst — hier steht sie noch einmal, ausdruecklich. */
                order by (c.unread > 0) desc, c.last_at desc)
                from public.conversation_summaries('customer') c), '[]'::jsonb)
  end;
$$;

comment on function public.my_conversations() is
  'The signed-in customer''s conversations, unread first (0098). Empty for a signed-out caller and for an account with none.';

revoke all on function public.my_conversations() from public, anon;
grant execute on function public.my_conversations() to authenticated;


create or replace function public.seller_conversations()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when not public.can_operate_active_seller() then '[]'::jsonb else
    coalesce((select jsonb_agg(jsonb_build_object(
                'order_number', c.order_number, 'last_at', c.last_at,
                'unread', c.unread, 'total', c.total)
                order by (c.unread > 0) desc, c.last_at desc)
                from public.conversation_summaries('seller') c), '[]'::jsonb)
  end;
$$;

comment on function public.seller_conversations() is
  'The operation''s conversations, unread first (0098). Empty for anybody who is not a seller operator — the same answer an empty inbox gives, so it says nothing about whether orders exist.';

revoke all on function public.seller_conversations() from public, anon;
grant execute on function public.seller_conversations() to authenticated;


create or replace function public.my_unread_total()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case when (select auth.uid()) is null then 0 else
    coalesce((select sum(c.unread)::integer
                from public.conversation_summaries('customer') c), 0)
  end;
$$;

comment on function public.my_unread_total() is
  'How many entries the signed-in customer has not read, across all their orders (0098). An aggregate, not a count over a capped page — the mistake ADR-0082 records.';

revoke all on function public.my_unread_total() from public, anon;
grant execute on function public.my_unread_total() to authenticated;


create or replace function public.seller_unread_total()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case when not public.can_operate_active_seller() then 0 else
    coalesce((select sum(c.unread)::integer
                from public.conversation_summaries('seller') c), 0)
  end;
$$;

comment on function public.seller_unread_total() is
  'How many entries the operation has not read, across every order (0098). Its own actions do not count towards it: an event with actor_kind admin is read by definition.';

revoke all on function public.seller_unread_total() from public, anon;
grant execute on function public.seller_unread_total() to authenticated;


-- ---------------------------------------------------------------------------
-- 11. Der Schnitt bei der Einführung
--
-- DAS PROBLEM. „Kein Wasserstand" heißt „alles ungelesen" — und das ist für
-- eine neue Unterhaltung richtig. Am Tag der Einführung wäre es falsch: jede
-- Bestellung, die je versendet, storniert oder erstattet wurde, bekäme
-- rückwirkend eine Handvoll roter Punkte für Dinge, die längst erledigt sind.
-- Der Betrieb sähe eine Arbeitsliste, die aus Vergangenheit besteht, und der
-- Käufer eine Benachrichtigung über ein Paket, das vor Wochen ankam.
--
-- DIE LÖSUNG IST DIE, DIE ES SCHON GIBT. Kein Sonderfall im Zählen, kein
-- Stichtag als Konstante, keine erfundenen Ereignisse und keine Zeile in
-- `order_events` angefasst: jede Bestellung, die es in diesem Moment gibt,
-- bekommt für beide Seiten einen Wasserstand auf JETZT. Was davor geschah,
-- bleibt im Verlauf sichtbar und gilt als gelesen. Was danach geschieht —
-- Nachricht wie Systemereignis — zählt normal.
--
-- Der Schnitt ist damit eine Tatsache in Daten, kein Zweig im Code. Die
-- Zählung kennt weiterhin genau eine Regel.
--
-- GENAU EINMAL. `where not exists (…)` macht daraus einen echten Startwert:
-- sobald irgendein Wasserstand existiert, ist das Feature in Betrieb, und ein
-- erneuter Lauf dieser Migration darf die Geschichte einer inzwischen
-- entstandenen Bestellung nicht als gelesen erklären. Das `on conflict` ist
-- die zweite Sperre für den Fall, dass beide Läufe sich überschneiden.
--
-- Gastbestellungen bleiben außen vor — sie haben in V1 keine Unterhaltung,
-- also auch keinen Lesestand.
-- ---------------------------------------------------------------------------
insert into public.order_conversation_reads (order_id, reader, last_read_at, updated_by)
select o.id, r.reader, now(), null
  from public.orders o
  cross join (values ('customer'), ('seller')) as r(reader)
 where o.user_id is not null
   and not exists (select 1 from public.order_conversation_reads)
on conflict (order_id, reader) do nothing;
