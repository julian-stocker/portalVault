-- ===========================================================================
-- 0100 — EINE MAIL JE EREIGNIS, NICHT JE ART
--
-- WAS BISHER GALT UND WARUM ES NICHT MEHR REICHT
--
-- `order_mail` trug seit `0019` den Primärschlüssel `(order_id, kind)`, und
-- der INSERT selbst war die Sperre: zwei gleichzeitige Zustellungen rennen auf
-- den Schlüssel, eine gewinnt, die andere bekommt `duplicate`. Für die Mails,
-- die es damals gab, ist das genau richtig — eine Bestellung wird einmal
-- bestätigt und einmal versendet.
--
-- Für alles WIEDERHOLBARE ist es die falsche Körnung. Eine Bestellung kann
-- zwei Erstattungen haben, drei Teilstornos und ein Dutzend Nachrichten. Mit
-- `(order_id, kind)` wäre die zweite Erstattungsmail strukturell unmöglich —
-- nicht unterdrückt, sondern nicht existierbar.
--
-- DIE ÄNDERUNG IST EINE SPALTE UND EIN INDEX
--
-- `ref` nennt das auslösende Ereignis: die `order_refunds.id`, die
-- `order_line_events.id`, die `order_messages.id`. Der Schlüssel wird
-- `(order_id, kind, coalesce(ref, ''))`. Bestehende Zeilen tragen `ref = NULL`
-- und bleiben damit exakt so einzigartig wie bisher — einmalige Arten
-- schicken weiter ohne `ref` und können sich nicht verdoppeln.
--
-- **Es entsteht keine einzige neue Mail durch diese Migration.** Sie ändert
-- nur, was künftig möglich ist.
--
-- EIN ENTZUG HÄNGT AN DER SIGNATUR, NICHT AM NAMEN
--
-- `0019` hat diese vier Funktionen ausdrücklich gesperrt — für ihre damalige
-- Argumentliste. Ein `drop function` + `create` mit einem Parameter mehr legt
-- eine ANDERE Funktion an, und Postgres gibt jeder neuen `EXECUTE` an
-- `PUBLIC`; Supabase reicht zusätzlich `anon` und `authenticated` nach. Der
-- alte Entzug gilt für die alte Signatur und ist mit ihr verschwunden.
--
-- Das ist genau die Falle, die `0019` in seinem eigenen Kommentar beschreibt —
-- und in die diese Datei zwischen dem 27. und dem 28. September trotzdem
-- gelaufen ist: auf Staging waren die vier Funktionen einen Tag lang für
-- `anon` aufrufbar. Wer den öffentlichen Schlüssel hat und eine Bestellnummer
-- errät, hätte damit `claim_order_mail` rufen und den echten Versand einer
-- Bestätigung unterdrücken können. Gefunden im Postflight, behoben hier.
--
-- **Jede Funktion, die diese Datei per `drop`+`create` neu anlegt, bekommt
-- ihren Entzug unmittelbar neben ihrem Kommentar.** `revoke-coverage.test.ts`
-- prüft das für die ganze Datei, damit dieselbe Lücke bei der nächsten
-- Signaturänderung nicht ein zweites Mal entsteht.
--
-- `seller_cancel_order_line()` ist die Ausnahme und bleibt es: gleiche
-- Argumentliste, also `create or replace` ohne `drop` — und damit bleiben die
-- Rechte aus `0097` erhalten (`anon` entzogen, `authenticated` erlaubt, weil
-- der Betrieb sie ruft). Ein Entzug hier nähme dem Betrieb das Storno.
--
-- WARUM `drop function` UND NICHT `create or replace`
--
-- Die vier Funktionen bekommen einen Parameter, und `create or replace` legt
-- bei geänderter Argumentliste eine ÜBERLADUNG an. PostgREST antwortet darauf
-- mit `PGRST203`, und zwar auch der Service Role — die Edge Function
-- `send-order-mail` ruft genau diese vier. Also erst weg, dann neu.
--
-- DIE MAIL BLEIBT EIN HINWEIS
--
-- Sie liest den Lesestand aus `0098`/`0099` und schreibt ihn nie. `0098` und
-- `0099` bleiben die einzige Wahrheit darüber, was gesehen wurde; eine Mail,
-- die einen Wasserstand verschöbe, würde eine Marke löschen, die niemand
-- angesehen hat.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Die Ereignisreferenz
-- ---------------------------------------------------------------------------
alter table public.order_mail
  add column if not exists ref text;

comment on column public.order_mail.ref is
  'Which occurrence this mail belongs to: a refund id, an order_line_events id, an order_messages id (0100). NULL for the kinds that happen once per order — those keep exactly the uniqueness they had.';

alter table public.order_mail
  drop constraint if exists order_mail_ref_sane;
alter table public.order_mail
  add constraint order_mail_ref_sane
    check (ref is null or (btrim(ref) <> '' and length(ref) <= 64));


-- ---------------------------------------------------------------------------
-- 2. Der Schlüssel wandert von (order, kind) auf (order, kind, ref)
--
-- Als eindeutiger Index, nicht als Primärschlüssel: `coalesce()` darf in einem
-- Primärschlüssel nicht stehen, und das NULL muss hier als Wert zählen statt
-- als Unbekanntes — sonst wäre jede Zeile ohne `ref` beliebig oft anlegbar,
-- und genau das soll unmöglich bleiben.
-- ---------------------------------------------------------------------------
alter table public.order_mail
  drop constraint if exists order_mail_pk;

create unique index if not exists order_mail_event_key
  on public.order_mail (order_id, kind, coalesce(ref, ''));


-- ---------------------------------------------------------------------------
-- 3. Die Arten, die es künftig gibt
--
-- `message_to_customer` und `message_to_seller` sind zwei Arten und nicht eine
-- mit einem Empfängerfeld: `goesToCustomer()` in der Edge Function entscheidet
-- allein aus der Art, wohin eine Mail geht, und eine Art, die beides sein
-- kann, macht aus dieser Entscheidung eine Verzweigung mit zwei Wahrheiten.
-- ---------------------------------------------------------------------------
alter table public.order_mail drop constraint if exists order_mail_kind_known;
alter table public.order_mail
  add constraint order_mail_kind_known
    check (kind in (
      -- einmal je Bestellung
      'order_received',
      'order_confirmation',
      'shipping_confirmation',
      'withdrawal_receipt',
      'resolution_alert',
      'new_order_notice',
      'withdrawal_notice',
      -- je Ereignis, mit `ref`
      'refund_confirmation',
      'cancellation_notice',
      'message_to_customer',
      'message_to_seller',
      -- historisch, vor 0047
      'payment_confirmation'
    ));


-- ---------------------------------------------------------------------------
-- 4. Die vier Funktionen, um `p_ref` erweitert
--
-- Der Parameter steht hinten und hat einen Vorgabewert, also bleibt jeder
-- bestehende Aufruf gültig und trifft weiterhin die Zeile ohne Referenz.
-- ---------------------------------------------------------------------------
drop function if exists public.claim_order_mail(text, text, boolean);

create or replace function public.claim_order_mail(
  p_order_number text,
  p_kind         text,
  p_force        boolean default false,
  p_ref          text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id  bigint;
  v_ref       text := nullif(btrim(coalesce(p_ref, '')), '');
  v_row       public.order_mail;
  v_effective text;
begin
  select o.id into v_order_id from public.orders o where o.order_number = p_order_number;
  if not found then
    return 'unknown_order';
  end if;

  -- Der INSERT ist die Sperre, wie seit 0019 — nur greift er jetzt je
  -- Ereignis statt je Art.
  insert into public.order_mail (order_id, kind, ref, state, claimed_at, attempts)
  values (v_order_id, p_kind, v_ref, 'sending', now(), 1)
  on conflict do nothing;

  if found then
    return 'claimed';
  end if;

  select * into v_row
    from public.order_mail m
   where m.order_id = v_order_id
     and m.kind = p_kind
     and coalesce(m.ref, '') = coalesce(v_ref, '')
     for update;

  if not found then
    return 'in_flight';
  end if;

  if v_row.state = 'sent' then
    return 'already_sent';
  end if;

  v_effective := public.order_mail_effective_state(v_row.state, v_row.claimed_at);

  if v_effective = 'sending' then
    return 'in_flight';
  end if;

  if v_effective = 'unresolved' and not coalesce(p_force, false) then
    update public.order_mail
       set state = 'unresolved'
     where order_id = v_order_id and kind = p_kind
       and coalesce(ref, '') = coalesce(v_ref, '');
    return 'unresolved';
  end if;

  update public.order_mail
     set state      = 'sending',
         claimed_at = now(),
         attempts   = attempts + 1,
         last_error = null
   where order_id = v_order_id and kind = p_kind
     and coalesce(ref, '') = coalesce(v_ref, '');

  return 'claimed';
end;
$$;

comment on function public.claim_order_mail(text, text, boolean, text) is
  'Claims the right to send one mail, exactly once per (order, kind, ref) since 0100. The INSERT is the lock. `ref` names the occurrence — a refund id, a line event id, a message id — and NULL keeps the one-per-order kinds exactly as unique as they were.';

revoke all on function public.claim_order_mail(text, text, boolean, text) from public, anon, authenticated;


drop function if exists public.mark_order_mail_sent(text, text, text);

create or replace function public.mark_order_mail_sent(
  p_order_number text,
  p_kind         text,
  p_message_id   text,
  p_ref          text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.order_mail
     set state               = 'sent',
         sent_at             = now(),
         provider_message_id = nullif(btrim(coalesce(p_message_id, '')), ''),
         last_error          = null
   where order_id = (select o.id from public.orders o where o.order_number = p_order_number)
     and kind = p_kind
     and coalesce(ref, '') = coalesce(nullif(btrim(coalesce(p_ref, '')), ''), '')
     and state <> 'sent';
end;
$$;

comment on function public.mark_order_mail_sent(text, text, text, text) is
  'The provider accepted the mail. `state <> sent` rather than `state = sending`, for the reason 0019 records; `ref` addresses the occurrence (0100).';

revoke all on function public.mark_order_mail_sent(text, text, text, text) from public, anon, authenticated;


drop function if exists public.mark_order_mail_failed(text, text, text);

create or replace function public.mark_order_mail_failed(
  p_order_number text,
  p_kind         text,
  p_error        text,
  p_ref          text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.order_mail
     set state      = 'failed',
         last_error = left(nullif(btrim(coalesce(p_error, '')), ''), 200)
   where order_id = (select o.id from public.orders o where o.order_number = p_order_number)
     and kind = p_kind
     and coalesce(ref, '') = coalesce(nullif(btrim(coalesce(p_ref, '')), ''), '')
     and state = 'sending';
end;
$$;

comment on function public.mark_order_mail_failed(text, text, text, text) is
  'The provider clearly refused: retryable, because nothing was accepted (0019, addressed per occurrence since 0100).';

revoke all on function public.mark_order_mail_failed(text, text, text, text) from public, anon, authenticated;


drop function if exists public.mark_order_mail_unresolved(text, text, text);

create or replace function public.mark_order_mail_unresolved(
  p_order_number text,
  p_kind         text,
  p_error        text,
  p_ref          text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.order_mail
     set state      = 'unresolved',
         last_error = left(nullif(btrim(coalesce(p_error, '')), ''), 200)
   where order_id = (select o.id from public.orders o where o.order_number = p_order_number)
     and kind = p_kind
     and coalesce(ref, '') = coalesce(nullif(btrim(coalesce(p_ref, '')), ''), '')
     and state = 'sending';
end;
$$;

comment on function public.mark_order_mail_unresolved(text, text, text, text) is
  'Nobody can say whether the mail went out. Deliberately not `failed` (0019, addressed per occurrence since 0100).';

revoke all on function public.mark_order_mail_unresolved(text, text, text, text) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 5. Die Drosselung für Nachrichten
--
-- EIN LEBHAFTES GESPRÄCH DARF KEINE MAILLAWINE SEIN. Zehn Nachrichten in
-- zehn Minuten sind zehn Hinweise auf dasselbe Gespräch, und der zehnte sagt
-- nichts, was der erste nicht schon gesagt hat.
--
-- Die Regel braucht keinen Zeitgeber und keinen Zähler, weil beide Angaben
-- schon dastehen:
--
--   Hinweis senden, wenn der Empfänger seit dem letzten Hinweis
--   HINEINGESEHEN hat — oder wenn es noch keinen gab.
--
-- Hat er nicht hineingesehen, liegt in seinem Postfach bereits ein
-- ungelesener Hinweis auf genau dieses Gespräch; ein zweiter wäre eine
-- Wiederholung. Hat er, ist die neue Nachricht für ihn wirklich neu.
--
-- Selbstregulierend: wer liest, bekommt wieder einen Hinweis; wer nicht
-- liest, bekommt genau einen. Kein Fenster, das man kalibrieren müsste.
--
-- LIEST NUR, SCHREIBT NICHTS. Diese Funktion fasst weder `order_mail` noch
-- einen Wasserstand an.
-- ---------------------------------------------------------------------------
create or replace function public.message_notice_due(p_order_number text, p_recipient text)
returns boolean
language sql
stable
set search_path = ''
as $$
  with target as (
    select o.id from public.orders o where o.order_number = p_order_number
  ),
  last_notice as (
    select max(m.sent_at) as at
      from public.order_mail m
     where m.order_id = (select id from target)
       and m.kind = case p_recipient
                      when 'customer' then 'message_to_customer'
                      else 'message_to_seller'
                    end
       and m.state = 'sent'
  ),
  seen as (
    select r.last_read_at as at
      from public.order_conversation_reads r
     where r.order_id = (select id from target)
       and r.reader = p_recipient
  )
  select case
           when (select at from last_notice) is null then true
           when (select at from seen) is null then false
           else (select at from seen) >= (select at from last_notice)
         end;
$$;

comment on function public.message_notice_due(text, text) is
  'Whether a new message deserves a mail for this side (0100): yes if no notice has gone out yet, or if the recipient has opened the conversation since the last one. If they have not, an unread notice about this very conversation is already in their inbox and a second would repeat it. Reads only — it touches neither order_mail nor any watermark.';

-- Kein Clientrecht: die Drosselung entscheidet die Edge Function, die ohnehin
-- als Service Role läuft. Ein Aufrufer, der sie fragen könnte, könnte auch
-- erfahren, ob zu einer fremden Bestellung schon einmal ein Hinweis herausging.
revoke all on function public.message_notice_due(text, text) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 6. Das Storno nennt sein eigenes Ereignis
--
-- `seller_cancel_order_line()` schrieb die Zeile in `order_line_events` und
-- gab ihre Id nicht zurück. Für die Stornomail ist genau diese Id die `ref` —
-- ohne sie wäre das zweite Teilstorno einer Bestellung für Resend und für die
-- Zustellsperre eine Wiederholung des ersten.
--
-- Gleiche Argumentliste, also `create or replace` ohne Überladung; der Rumpf
-- ist der aus `0097` mit zwei zusätzlichen Zeilen.
-- ---------------------------------------------------------------------------
create or replace function public.seller_cancel_order_line(
  p_order_line_id bigint,
  p_quantity      integer,
  -- 'present' | 'missing'. Die einzige Frage an den Menschen.
  p_stock_presence text,
  -- Warum storniert wurde. Einer der Werte, die der CHECK oben erlaubt —
  -- oder NULL, damit ein Aufrufer aus der Zeit vor 0097 weiter funktioniert.
  p_reason_code   text default null,
  p_reason        text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  /* 0100: Die Identität DIESES Stornos. Sie wird zur `ref` der
     Stornomail, damit ein zweites Teilstorno derselben Bestellung eine
     eigene Mail bekommen kann statt als Wiederholung zu gelten. */
  v_event bigint;
  v_line        record;
  v_order       record;
  v_open        integer;
  v_booked      boolean;
  v_outcome     text;
  v_movement    bigint := null;
  v_correction  bigint := null;
  v_remaining   integer;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required'
      using errcode = 'insufficient_privilege';
  end if;

  if p_stock_presence is null or p_stock_presence not in ('present', 'missing') then
    raise exception 'say whether the goods are physically there'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'a cancellation needs a positive quantity'
      using errcode = 'invalid_parameter_value';
  end if;

  /*
   * DER GRUND ENTSCHEIDET NICHTS ÜBER DEN BESTAND (0097).
   *
   * Er wird hier geprüft und weiter unten geschrieben — und taucht in der
   * Berechnung von `v_outcome` nicht auf. „Artikel beschädigt" sagt nichts
   * darüber, ob das Stück im Regal liegt: das weiß nur der Mensch, der
   * hineingesehen hat, und genau dafür gibt es die eine Frage.
   *
   * Der CHECK auf der Spalte lehnt einen unbekannten Wert ohnehin ab; hier
   * steht er trotzdem, damit die Meldung sagt, was gemeint ist.
   */
  if p_reason_code is not null
     and p_reason_code not in ('buyer_request', 'item_not_found',
                               'item_damaged', 'stock_incorrect', 'other') then
    raise exception 'unknown cancellation reason %', p_reason_code
      using errcode = 'invalid_parameter_value';
  end if;

  select ol.* into v_line
    from public.order_lines ol
   where ol.id = p_order_line_id
     for update;
  if not found then
    raise exception 'no such order line' using errcode = 'no_data_found';
  end if;

  select o.* into v_order
    from public.orders o
   where o.id = v_line.order_id
     for update;

  /*
   * DIE BESTELLUNG MUSS ZU DER WELT GEHÖREN, IN DER DIESE INSTALLATION GERADE
   * LÄUFT — dieselbe Regel, die `receive_withdrawal()` seit 0047 anwendet.
   *
   * Nicht das Literal 'live': `create_order()` stempelt jede Bestellung mit
   * `commerce_mode()` (0021), und diese Funktion fragt dieselbe. Production
   * läuft live und weist damit jede historische Sandbox-Bestellung ab,
   * Staging läuft sandbox und kann den Weg überhaupt erst durchspielen. Ein
   * Pfad, der nie end-to-end gelaufen ist, ist keiner, den man auf echte
   * Bestellungen loslässt.
   */
  if v_order.commerce_mode is distinct from public.commerce_mode() then
    raise exception 'order % belongs to a different commerce mode',
      v_order.order_number using errcode = 'insufficient_privilege';
  end if;

  /*
   * Und der eine Weg, der dasselbe schon tut: `admin_revert_sandbox_stock()`
   * bucht für eine Testbestellung den GANZEN Bestand zurück (0083). Wo das
   * geschehen ist, würde eine Stornierung dieselbe Ware ein zweites Mal
   * einbuchen.
   */
  if exists (select 1 from public.order_events e
              where e.order_id = v_order.id
                and e.event_type = 'sandbox_stock_reverted') then
    raise exception 'order % had its stock reverted as a test order',
      v_order.order_number using errcode = 'restrict_violation';
  end if;

  if v_order.payment_status not in ('paid', 'partially_refunded') then
    raise exception 'order % is %, and only a paid order has positions to cancel',
      v_order.order_number, v_order.payment_status using errcode = 'restrict_violation';
  end if;

  -- Versendete Ware wird retourniert, nicht storniert.
  if v_order.fulfillment_status <> 'unfulfilled' then
    raise exception 'order % is %, and only an unfulfilled order can be cancelled',
      v_order.order_number, v_order.fulfillment_status using errcode = 'restrict_violation';
  end if;

  -- IDEMPOTENZ UND TEILMENGEN IN EINEM: gerechnet unter der Zeilensperre, die
  -- oben genommen wurde. Ein zweiter Aufruf sieht, was der erste geschrieben
  -- hat, und findet nichts Offenes mehr.
  select q.cancellable into v_open from public.order_line_quantities(p_order_line_id) q;
  if p_quantity > v_open then
    raise exception 'only % of this position are still open, % were asked for',
      v_open, p_quantity using errcode = 'check_violation';
  end if;

  /*
   * DIE TECHNISCHE TATSACHE, die den Ausgang mitbestimmt: hat diese Position
   * das Regal jemals verlassen? Das ist die `sale`-Bewegung der Reservierung,
   * und sie ist die einzige Quelle dafür. Ohne sie gibt es nichts
   * zurückzugeben — was der Operator über das Regal sagt, ändert daran nichts.
   */
  v_booked := exists (
    select 1
      from public.order_reservations r
     where r.order_id = v_order.id
       and r.inventory_id = v_line.inventory_id
       and r.movement_id is not null
  );

  v_outcome := case
    when not v_booked then 'none'
    when p_stock_presence = 'present' then 'restocked'
    else 'shortfall'
  end;

  /*
   * Beide Bewegungen, oder keine. Ein RPC ist eine Transaktion (PostgREST),
   * also rollt ein Fehler in der zweiten die erste mit zurück — und das
   * Ereignis unten entsteht gar nicht erst.
   */
  if v_outcome <> 'none' then
    v_movement := public.apply_inventory_movement(
      v_line.sky_id, v_line.condition, p_quantity, 'return',
      null, null,
      'Storno Bestellung ' || v_order.order_number,
      (select auth.uid()));
  end if;

  if v_outcome = 'shortfall' then
    -- Der Verkauf ist rückgängig; jetzt wird der Fehlbestand abgeschrieben.
    v_correction := public.apply_inventory_movement(
      v_line.sky_id, v_line.condition, -p_quantity, 'correction',
      null, null,
      'Fehlbestand Bestellung ' || v_order.order_number,
      (select auth.uid()));
  end if;

  insert into public.order_line_events (
    order_id, order_line_id, kind, quantity, stock_outcome,
    movement_id, correction_movement_id, reason_code, reason, created_by
  ) values (
    v_order.id, p_order_line_id, 'cancelled', p_quantity, v_outcome,
    v_movement, v_correction, p_reason_code,
    nullif(btrim(coalesce(p_reason, '')), ''), (select auth.uid())
  ) returning id into v_event;

  insert into public.order_events (order_id, event_type, actor_kind, actor_user_id, payload)
  values (v_order.id, 'order_line_cancelled', 'admin', (select auth.uid()),
          jsonb_build_object(
            'order_line_id', p_order_line_id, 'quantity', p_quantity,
            'stock_outcome', v_outcome,
            'movement_id', v_movement, 'correction_movement_id', v_correction));

  -- Bleibt nichts mehr zu liefern, ist die Bestellung storniert. Der Trigger
  -- aus Abschnitt 3 lässt genau diesen Übergang zu.
  v_remaining := public.order_fulfillable_total(v_order.id);
  if v_remaining = 0 and v_order.fulfillment_status = 'unfulfilled' then
    update public.orders
       set fulfillment_status = 'cancelled',
           cancelled_at = coalesce(cancelled_at, now())
     where id = v_order.id;

    insert into public.order_events (order_id, event_type, actor_kind, actor_user_id)
    values (v_order.id, 'order_cancelled', 'admin', (select auth.uid()));
  end if;

  return jsonb_build_object(
    'event_id', v_event,
    'stock_outcome', v_outcome,
    'movement_id', v_movement,
    'correction_movement_id', v_correction,
    'fulfillable_total', v_remaining,
    'order_cancelled', v_remaining = 0);
end;
$$;
