-- ===========================================================================
-- 0099 — AUFMERKSAMKEIT AN DER BESTELLUNG, FÜR BEIDE SEITEN GLEICH
--
-- WAS DIESE MIGRATION LÖST
--
-- Seit 0098 hat der Nachrichtenkanal einen Lesestand: ein Wasserstand je
-- (Bestellung, Seite), ein Strom, und „ungelesen" heißt neuer als mein Stand
-- und nicht von mir. Das funktioniert, und es ist das einzige Stück
-- Aufmerksamkeit, das dieses Produkt bisher kennt.
--
-- Für Bestellungen gab es nichts Vergleichbares. Was der Betrieb sah, war
-- `seller_open_order_counts()` — eine Ableitung aus dem STATUS: solange eine
-- Bestellung unversandt ist, steht die Zahl da, ganz gleich, wie oft man
-- hingesehen hat. Als Arbeitszähler ist das richtig. Als Benachrichtigung
-- wäre es falsch, denn eine Benachrichtigung, die das Ansehen nicht
-- wegnimmt, ist nach der dritten Bestellung nur noch Farbe.
--
-- STATUS IST NICHT AUFMERKSAMKEIT. Das ist die Regel, aus der alles Weitere
-- folgt. Diese Migration zählt EREIGNISSE GEGEN EINEN LESESTAND, nie einen
-- Zustand. „Bezahlt und noch nicht versendet" bleibt Arbeit und bleibt auf
-- der Arbeitskarte; „seit deinem letzten Blick ist etwas passiert" ist
-- Aufmerksamkeit und bekommt eine Marke, die verschwindet, sobald man sie
-- angesehen hat.
--
-- ZWEI KANÄLE, BEIDE SEITEN GLEICH
--
--   Nachrichten   was ein MENSCH geschrieben hat          (0098, hier verengt)
--   Bestellungen  was an der BESTELLUNG passiert ist      (neu)
--
-- Bis heute zählte der Nachrichtenkanal beides: die zwei projizierten
-- Ereignisse `order_shipped` und `refund_recorded` liefen in seine
-- Ungelesen-Zahl ein. Das war richtig, solange es nur einen Kanal gab, und
-- wird falsch, sobald es zwei gibt — dieselbe Zustellung zählte sonst an
-- zwei Marken. Abschnitt 8 verengt `conversation_summaries()` deshalb auf
-- menschliche Nachrichten.
--
-- IM STRANG SELBST ÄNDERT SICH NICHTS. `order_conversation()` zeigt die
-- beiden Systemzeilen weiter an derselben Stelle (ADR-0108). Verschoben wird
-- ausschließlich, WO sie gezählt werden — Darstellung und Zählung sind zwei
-- Fragen, und nur die zweite hat eine Marke.
--
-- DIE WHITELIST, UND WARUM SIE EINE IST
--
-- Nicht „alles, was ich nicht selbst getan habe". `order_events` kennt über
-- zwanzig Typen, darunter `payment_attempt_started`, `invoice_issued` und
-- `checkout_expired` — Buchhaltung des Systems, keine Nachricht an einen
-- Menschen. Was jemanden unterbricht, wird einzeln entschieden:
--
--   Verkäufer  payment_succeeded         eine neue bezahlte Bestellung
--              withdrawal_declared       ein Widerruf ist erklärt
--              payment_amount_mismatch   Geld stimmt nicht, jemand muss ran
--              late_payment_unresolved   bezahlt, nichts gebucht
--
--   Käufer     order_line_cancelled      eine Position wurde gestrichen
--              order_cancelled           die ganze Bestellung wurde gestrichen
--              order_shipped             das Paket ist unterwegs
--              refund_recorded           das Geld ist zurück
--
-- DIE BEIDEN STORNO-TYPEN STANDEN ZUERST NICHT AUF DER LISTE, und der erste
-- echte Teilstorno hat gezeigt, warum das zu wenig ist: der Käufer bekam eine
-- Meldung über das GELD, aber keine über die Änderung seiner BESTELLUNG — und
-- die ist die eigentliche Nachricht. `order_cancelled` steht daneben, weil ein
-- vollständiges Storno diesen Typ zusätzlich schreibt und sonst durchfiele,
-- wenn keine einzelne Position genannt ist. Beide tragen `actor_kind = admin`,
-- zählen also für den Käufer und nie für den Betrieb.
--
-- Dazu, wie in 0098, der Absender: was die eigene Seite ausgelöst hat, ist
-- per Definition gelesen. `order_shipped` trägt `actor_kind = 'admin'` und
-- zählt deshalb für den Käufer, nie für den Betrieb.
--
-- EIN UNTERSCHIED ZU 0098, UND ER IST BEABSICHTIGT: GASTBESTELLUNGEN
--
-- Eine Unterhaltung braucht zwei Seiten, die lesen können — deshalb hat eine
-- Gastbestellung in 0098 keine. Eine BESTELLUNG hat der Betrieb trotzdem zu
-- bearbeiten. Die Verkäuferseite dieses Kanals umfasst deshalb jede
-- Bestellung, mit Konto oder ohne; die Käuferseite naturgemäß nur die mit
-- Konto.
--
-- GEZÄHLT WERDEN BESTELLUNGEN, NICHT EREIGNISSE
--
-- `attention_summaries()` liefert je Bestellung eine Zeile mit `unread`, und
-- die beiden Summenfunktionen zählen darüber die ZEILEN mit `unread > 0`. Drei
-- neue Ereignisse an einer Bestellung sind eine Bestellung, in die man sehen
-- muss — am Eintrag steht ein „Neu", nicht drei, und die Karte sagt „1
-- Bestellung mit Neuigkeiten". Der Nachrichtenkanal zählt weiter Nachrichten,
-- weil dort jede einzelne gelesen werden will; das ist kein Widerspruch,
-- sondern der Unterschied zwischen einem Posteingang und einer Bestellliste.
--
-- DER SCHNITT BEI DER EINFÜHRUNG ist derselbe wie in 0098: jede bestehende
-- Bestellung startet auf beiden Seiten als gelesen. Sonst begrüßte die
-- Umstellung den Betrieb mit einer Marke für Vorgänge, die längst erledigt
-- sind.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Der zweite Wasserstand
--
-- Gleiche Form wie `order_conversation_reads`, bewusst eine eigene Tabelle:
-- zwei Kanäle sind zwei Lesestände. Wer seine Nachrichten liest, hat damit
-- nicht die Versandmeldung gesehen, und umgekehrt.
-- ---------------------------------------------------------------------------
create table if not exists public.order_attention_reads (
  order_id     bigint not null,
  reader       text   not null,
  last_read_at timestamptz not null default now(),
  updated_by   uuid,

  constraint order_attention_reads_pk primary key (order_id, reader),
  constraint order_attention_reads_order_fk foreign key (order_id)
    references public.orders (id) on update cascade on delete restrict,
  constraint order_attention_reads_user_fk foreign key (updated_by)
    references auth.users (id) on update cascade on delete set null,
  constraint order_attention_reads_reader_known
    check (reader in ('customer', 'seller'))
);

comment on table public.order_attention_reads is
  'How far each side has looked at one order''s events (0099). The twin of order_conversation_reads and deliberately a second table: reading the messages is not the same act as seeing that the parcel went out. One watermark per side; the seller side is shared by the whole operation.';


-- ---------------------------------------------------------------------------
-- 2. Rechte: keine. Alles läuft über die Funktionen.
-- ---------------------------------------------------------------------------
alter table public.order_attention_reads enable row level security;
revoke all on public.order_attention_reads from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 3. Wer fragt, und in welcher Rolle
--
-- Nicht `order_conversation_role()`: das antwortet für eine Gastbestellung
-- mit NULL, weil es dort keine Unterhaltung gibt. Hier gibt es sehr wohl
-- etwas zu sehen — für den Betrieb.
-- ---------------------------------------------------------------------------
create or replace function public.order_attention_role(p_order_id bigint)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
           when not exists (select 1 from public.orders o where o.id = p_order_id)
             then null
           when exists (select 1 from public.orders o
                         where o.id = p_order_id
                           and o.user_id is not null
                           and o.user_id = (select auth.uid()))
             then 'customer'
           when public.can_operate_active_seller()
             then 'seller'
           else null
         end;
$$;

comment on function public.order_attention_role(bigint) is
  'customer | seller | NULL for the current request on one order (0099). Unlike order_conversation_role() a guest order answers ''seller'' for the operation: a guest has no conversation, but the operation still has an order to work on. Internal: no client role holds EXECUTE.';

revoke all on function public.order_attention_role(bigint) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 4. Welche Ereignisse eine Seite angehen
--
-- Zwei Filter, beide nötig: der TYP entscheidet, ob das Ereignis überhaupt
-- jemanden unterbricht, der ABSENDER, wen von beiden. Ohne den zweiten
-- zählte der Betrieb seine eigenen Klicks mit.
--
-- Kein Payload. Diese Funktion beantwortet „wie viel ist neu", nicht „was
-- steht drin" — der Inhalt steht auf dem Bestellschirm, wo er hingehört, und
-- was der Kundenkanal von einer Payload sehen darf, entscheidet weiterhin
-- `order_conversation_events()` (0098).
-- ---------------------------------------------------------------------------
create or replace function public.order_attention_events(p_order_id bigint, p_role text)
returns table (
  event_id    bigint,
  event_type  text,
  occurred_at timestamptz,
  from_other  boolean
)
language sql
stable
set search_path = ''
as $$
  select e.id, e.event_type, e.created_at,
         case p_role
           when 'customer' then e.actor_kind <> 'customer'
           else e.actor_kind <> 'admin'
         end
    from public.order_events e
   where e.order_id = p_order_id
     and case p_role
           when 'customer' then e.event_type in ('order_shipped', 'refund_recorded',
                                                 'order_line_cancelled', 'order_cancelled')
           else e.event_type in ('payment_succeeded', 'withdrawal_declared',
                                 'payment_amount_mismatch', 'late_payment_unresolved')
         end
$$;

comment on function public.order_attention_events(bigint, text) is
  'The order events that interrupt one side (0099). A whitelist per side, not "everything I did not do myself": order_events knows two dozen types, most of them the system''s own bookkeeping. The customer hears about a cancelled line or order, the parcel and the money; the operation hears about a paid order, a declared withdrawal and the two ways a payment goes wrong. Internal: no client role holds EXECUTE.';

revoke all on function public.order_attention_events(bigint, text) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 5. Eine Zeile je Bestellung, die etwas zu melden hat
--
-- Zwilling zu `conversation_summaries()`, bis in die Sortierung: erst was
-- ungelesen ist, dann das Neueste. Gezählt wird mit einem Aggregat, nie über
-- eine gedeckelte Liste (ADR-0082).
-- ---------------------------------------------------------------------------
create or replace function public.attention_summaries(p_role text)
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
     where case p_role
             when 'customer'
               then o.user_id is not null and o.user_id = (select auth.uid())
             else public.can_operate_active_seller()
           end
  ),
  stream as (
    select s.id, s.order_number, e.occurred_at as at, e.from_other
      from scope s
      cross join lateral public.order_attention_events(s.id, p_role) e
  )
  select st.order_number,
         max(st.at),
         count(*) filter (
           where st.from_other
             and (r.last_read_at is null or st.at > r.last_read_at))::integer,
         count(*)::integer
    from stream st
    left join public.order_attention_reads r
           on r.order_id = st.id and r.reader = p_role
   group by st.order_number, r.last_read_at
   having count(*) > 0
   order by (count(*) filter (
              where st.from_other
                and (r.last_read_at is null or st.at > r.last_read_at)) > 0) desc,
            max(st.at) desc
$$;

comment on function public.attention_summaries(text) is
  'One row per order that has something to report for the given side (0099): last event, unread count, total. Unread first, then newest — the same order the conversation inbox uses. Internal: no client role holds EXECUTE; my_order_attention() and seller_order_attention() decide who may ask.';

revoke all on function public.attention_summaries(text) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 6. Als gesehen markieren — beim Öffnen der BESTELLUNG
--
-- Nicht beim Öffnen der Liste. Eine Liste überfliegt man; sie als „alles
-- gesehen" zu werten nähme genau die Marke weg, wegen der man hinsieht.
-- Monoton wie in 0098: der Stand geht nur vorwärts.
-- ---------------------------------------------------------------------------
create or replace function public.mark_order_attention_read(p_order_number text)
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

  v_role := public.order_attention_role(v_order_id);
  if v_role is null then
    return null;
  end if;

  insert into public.order_attention_reads (order_id, reader, last_read_at, updated_by)
  values (v_order_id, v_role, v_at, (select auth.uid()))
  on conflict (order_id, reader)
    do update set last_read_at = greatest(public.order_attention_reads.last_read_at,
                                          excluded.last_read_at),
                  updated_by = excluded.updated_by;

  return v_at;
end;
$$;

comment on function public.mark_order_attention_read(text) is
  'Moves the caller''s side of one order to now (0099). Called when the ORDER is opened, never when a list is. Idempotent and monotonic; NULL where this caller has no side on that order.';

revoke all on function public.mark_order_attention_read(text) from public, anon;
grant execute on function public.mark_order_attention_read(text) to authenticated;


-- ---------------------------------------------------------------------------
-- 7. Die vier Clientfunktionen, spiegelbildlich benannt
-- ---------------------------------------------------------------------------
create or replace function public.my_order_attention()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when (select auth.uid()) is null then '[]'::jsonb else
    coalesce((select jsonb_agg(jsonb_build_object(
                'order_number', a.order_number, 'last_at', a.last_at,
                'unread', a.unread, 'total', a.total)
                order by (a.unread > 0) desc, a.last_at desc)
                from public.attention_summaries('customer') a), '[]'::jsonb)
  end;
$$;

comment on function public.my_order_attention() is
  'What has happened on the signed-in customer''s orders since they last looked, unread first (0099).';

revoke all on function public.my_order_attention() from public, anon;
grant execute on function public.my_order_attention() to authenticated;


create or replace function public.seller_order_attention()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when not public.can_operate_active_seller() then '[]'::jsonb else
    coalesce((select jsonb_agg(jsonb_build_object(
                'order_number', a.order_number, 'last_at', a.last_at,
                'unread', a.unread, 'total', a.total)
                order by (a.unread > 0) desc, a.last_at desc)
                from public.attention_summaries('seller') a), '[]'::jsonb)
  end;
$$;

comment on function public.seller_order_attention() is
  'What has happened on the operation''s orders since it last looked, unread first (0099). Guest orders included — they have no conversation, but they are orders.';

revoke all on function public.seller_order_attention() from public, anon;
grant execute on function public.seller_order_attention() to authenticated;


create or replace function public.my_attention_total()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case when (select auth.uid()) is null then 0 else
    coalesce((select count(*) filter (where a.unread > 0)::integer
                from public.attention_summaries('customer') a), 0)
  end;
$$;

comment on function public.my_attention_total() is
  'How many of the signed-in customer''s ORDERS have something they have not seen (0099) — orders, not events: three new events on one order are one order to look at, and the badge says "1 Bestellung mit Neuigkeiten". An aggregate, not a count over a capped page (ADR-0082).';

revoke all on function public.my_attention_total() from public, anon;
grant execute on function public.my_attention_total() to authenticated;


create or replace function public.seller_attention_total()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case when not public.can_operate_active_seller() then 0 else
    coalesce((select count(*) filter (where a.unread > 0)::integer
                from public.attention_summaries('seller') a), 0)
  end;
$$;

comment on function public.seller_attention_total() is
  'How many ORDERS have something the operation has not seen (0099) — orders, not events, for the same reason my_attention_total() counts orders. Its own actions never count towards it.';

revoke all on function public.seller_attention_total() from public, anon;
grant execute on function public.seller_attention_total() to authenticated;


-- ---------------------------------------------------------------------------
-- 8. Der Nachrichtenkanal zählt ab jetzt nur noch Menschen
--
-- Einzige Änderung an 0098, und nur an der ZÄHLUNG: der Ereignisteil fällt
-- aus dem Strom. `order_conversation()` bleibt unangetastet — im Strang
-- stehen `order_shipped` und `refund_recorded` weiterhin als Systemzeilen
-- (ADR-0108). Gezählt werden sie jetzt nebenan, sonst trüge dieselbe
-- Zustellung an zwei Marken bei.
--
-- Die Bedingung „hat überhaupt eine menschliche Nachricht" bleibt, wird aber
-- überflüssig: ohne Nachricht hat der Strom keine Zeile mehr. Sie steht
-- trotzdem noch da, weil sie den Posteingang billiger macht.
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
       and exists (select 1 from public.order_messages m where m.order_id = o.id)
  ),
  stream as (
    select s.id, s.order_number, m.created_at as at,
           (m.author_kind <> p_role) as from_other
      from scope s join public.order_messages m on m.order_id = s.id
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
  'One row per order that HAS a conversation — at least one human message — for the given side (0098, narrowed by 0099): last message, unread count, total messages. Since 0099 the stream is HUMAN MESSAGES ONLY: order_shipped and refund_recorded are still shown inside the thread by order_conversation(), but they are counted in the order channel (attention_summaries), so one delivery never feeds two badges. Sorted unread first, then newest. Internal: no client role holds EXECUTE.';

revoke all on function public.conversation_summaries(text) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 9. Der Schnitt bei der Einführung
--
-- Jede bestehende Bestellung startet als gesehen — auf der Verkäuferseite
-- ausnahmslos, auf der Käuferseite überall dort, wo es ein Konto gibt. Ohne
-- das begrüßte die Umstellung den Betrieb mit einer Marke für Vorgänge, die
-- er längst bearbeitet hat.
--
-- `where not exists (…)` macht den Block einmalig: ein zweiter Lauf dieser
-- Migration setzt keinen Lesestand zurück.
-- ---------------------------------------------------------------------------
insert into public.order_attention_reads (order_id, reader, last_read_at, updated_by)
select o.id, 'seller', now(), null
  from public.orders o
 where not exists (select 1 from public.order_attention_reads)
on conflict (order_id, reader) do nothing;

insert into public.order_attention_reads (order_id, reader, last_read_at, updated_by)
select o.id, 'customer', now(), null
  from public.orders o
 where o.user_id is not null
   and not exists (select 1 from public.order_attention_reads r
                    where r.reader = 'customer')
on conflict (order_id, reader) do nothing;
