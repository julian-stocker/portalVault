-- ===========================================================================
-- 0095 — Positionsstorno, Retoure und Fehlbestand
--
-- DER ALLTAGSFALL, DEN ES BISHER NICHT GAB
--
-- Acht Figuren für 27,04 €, und eine davon zu 3,49 € stellt sich als nicht
-- lieferbar heraus. Die Bestellung soll NICHT storniert werden: eine Position
-- geht weg, sieben Figuren gehen raus, 3,49 € werden erstattet. Dafür gab es
-- bis hierher keinen Weg — `fulfillment_status = 'cancelled'` steht seit 0010
-- im CHECK und wurde von niemandem geschrieben, und eine Rückgabe konnte nur
-- über `admin_revert_sandbox_stock()` gebucht werden, das jede Live-
-- Bestellung ablehnt.
--
-- DREI EREIGNISSE, DIE NICHT DASSELBE SIND
--
--   Storno     eine Menge wird nicht geliefert. Vor dem Versand.
--   Retoure    eine gelieferte Menge kommt zurück. Nach dem Versand.
--   Fehlbestand
--              ein Storno, bei dem die Ware physisch gar nicht existierte.
--
-- Und der gefährlichste Fehler wäre, den dritten wie den ersten zu behandeln:
--
--   vorher    System 1   physisch 0     ← der Zählstand war falsch
--   Zahlung   sale −1 → System 0        ← zufällig jetzt korrekt
--   Storno mit +1 'return' → System 1   ← das Phantom ist zurück
--
-- Deshalb bucht ein Fehlbestand ZWEI Bewegungen: `+qty 'return'` macht den
-- Verkauf rückgängig, `−qty 'correction'` schreibt den Fehlbestand ab. Netto
-- null, und das Journal erklärt beides. Beide entstehen im selben RPC und
-- damit in derselben Transaktion: schlägt eine fehl, existiert auch die
-- andere nicht und es wird kein Ereignis geschrieben.
--
-- WER DAS ENTSCHEIDET
--
-- Nicht der Client. Ob eine Position überhaupt ausgebucht wurde, ist eine
-- technische Tatsache — `order_reservations.movement_id` —, und danach wird
-- niemand gefragt. Der Operator beantwortet EINE Frage: „liegt die Ware da?".
-- Der Server verbindet beides zu `stock_outcome`. Ein Browser, der etwas
-- anderes behauptet, kann damit keine Bewegung erzeugen.
--
-- MENGEN WERDEN NICHT GESPEICHERT
--
-- `order_line_events` ist anhängend. Storniert, retourniert, lieferbar und
-- offen sind Summen darüber — keine Spalte, kein Zähler, keine zweite
-- Wahrheit, die irgendwann von der ersten abweicht.
--
-- GELD BLEIBT GETRENNT. Kein Storno bewegt Geld, keine Erstattung bewegt
-- Bestand. Stripe wird von hier aus nicht geschrieben; `order_refunds` ist
-- weiterhin die Dokumentation einer Erstattung, die der Operator dort
-- ausgelöst hat. Neu ist nur, dass sie sagen kann, WOFÜR.
--
-- ÄNDERT KEINE DATEN. Zwei Tabellen, ein erweiterter Trigger, Funktionen.
-- Keine Zeile in `orders`, `order_lines`, `shop_inventory`,
-- `inventory_movements` oder `legacy_stock_events` wird angefasst.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Das Ledger der Positionsereignisse
--
-- Ein gemeinsames Journal für Storno und Retoure, weil beide dieselbe Aussage
-- in zwei Richtungen sind: „diese Menge dieser Position wird nicht (mehr)
-- geliefert". Dieselbe Idempotenz, dieselbe Bewegungsverknüpfung, dieselbe
-- Teilmengenfähigkeit — zwei Tabellen wären zweimal dasselbe.
--
-- Die CHECK-Bedingungen sind die Geschäftsregeln, nicht ihre Beschreibung:
-- eine Retoure ist immer ein echter Wareneingang, ein Fehlbestand hat immer
-- beide Bewegungen, und `none` hat keine.
-- ---------------------------------------------------------------------------

create table if not exists public.order_line_events (
  id            bigint generated always as identity primary key,
  order_id      bigint  not null,
  order_line_id bigint  not null,

  kind     text    not null,
  quantity integer not null,

  -- Was mit dem Bestand geschah. Festgehalten, nicht abgeleitet: ob die Ware
  -- da war, weiß nur der Mensch, der ins Regal gesehen hat.
  stock_outcome text not null,

  -- Die Bewegung, die den Verkauf rückgängig macht (+qty, 'return').
  movement_id bigint,
  -- Die Abschreibung des Fehlbestands (−qty, 'correction'). Nur dort.
  correction_movement_id bigint,

  occurred_at timestamptz not null default now(),
  reason      text,
  created_by  uuid,
  created_at  timestamptz not null default now(),

  constraint order_line_events_order_fk foreign key (order_id)
    references public.orders (id) on update cascade on delete restrict,
  constraint order_line_events_line_fk foreign key (order_line_id)
    references public.order_lines (id) on update cascade on delete restrict,
  constraint order_line_events_movement_fk foreign key (movement_id)
    references public.inventory_movements (id) on update cascade on delete restrict,
  constraint order_line_events_correction_fk foreign key (correction_movement_id)
    references public.inventory_movements (id) on update cascade on delete restrict,
  constraint order_line_events_created_by_fk foreign key (created_by)
    references auth.users (id) on delete set null,

  constraint order_line_events_kind_known
    check (kind in ('cancelled', 'returned')),
  constraint order_line_events_quantity_positive
    check (quantity > 0),
  constraint order_line_events_outcome_known
    check (stock_outcome in ('restocked', 'shortfall', 'none')),
  constraint order_line_events_reason_shape
    check (reason is null or length(reason) <= 500),

  -- Eine zurückgekommene Ware liegt im Regal. Alles andere wäre ein Storno.
  constraint order_line_events_returned_is_restocked
    check (kind <> 'returned' or stock_outcome = 'restocked'),

  -- Welcher Ausgang welche Bewegungen hat — strukturell, nicht per Konvention.
  constraint order_line_events_outcome_shape check (
        (stock_outcome = 'restocked'
         and movement_id is not null and correction_movement_id is null)
     or (stock_outcome = 'shortfall'
         and movement_id is not null and correction_movement_id is not null)
     or (stock_outcome = 'none'
         and movement_id is null and correction_movement_id is null)
  ),

  -- Eine Bewegung gehört zu höchstens einem Ereignis. Das ist die zweite
  -- Sperre gegen eine doppelte Rückbuchung, neben der Mengenprüfung unter
  -- Zeilensperre — dieselbe Form wie `order_reservations_movement_unique`.
  constraint order_line_events_movement_unique unique (movement_id),
  constraint order_line_events_correction_unique unique (correction_movement_id)
);

create index if not exists order_line_events_by_line
  on public.order_line_events (order_line_id);
create index if not exists order_line_events_by_order
  on public.order_line_events (order_id);

comment on table public.order_line_events is
  'Append-only ledger of what happened to a quantity of an order line (0095): cancelled before dispatch, or returned after it. Quantities are never stored on the line — cancelled, returned, fulfillable and outstanding are sums over this table. `stock_outcome` records what the shelf did: `restocked` (+return), `shortfall` (+return and -correction, net zero: the piece was never physically there), `none` (the position was never booked out). Never updated, never deleted.';
comment on column public.order_line_events.stock_outcome is
  'restocked | shortfall | none. Decided by the server from the technical fact whether the position was booked out (order_reservations.movement_id) plus the operator''s answer to one question: is the piece physically there? A client cannot choose it.';

alter table public.order_line_events enable row level security;
revoke all on public.order_line_events from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 2. Wofür eine Erstattung war
--
-- `order_refunds` bleibt, wie es ist: ein Betrag, ein Zeitpunkt, ein Grund.
-- Was fehlte, ist die Antwort auf „warum 3,49 €". Eine Spalte `order_line_id`
-- wäre die falsche Form gewesen — eine Erstattung kann eine Position, eine
-- Teilmenge, mehrere Positionen, die Versandkosten oder Kulanz betreffen, und
-- das ist 1:n.
--
-- Eine Erstattung OHNE Zuordnung bleibt gültig: jede Zeile, die vor dieser
-- Tabelle entstanden ist, ist weiterhin vollständig. Wo es Zuordnungen gibt,
-- müssen sie den Betrag exakt ergeben — geprüft in `seller_record_refund`.
-- ---------------------------------------------------------------------------

create table if not exists public.order_refund_allocations (
  id            bigint generated always as identity primary key,
  refund_id     bigint not null,
  order_line_id bigint,
  quantity      integer,
  amount        numeric(10,2) not null,
  allocation_type text not null,

  constraint order_refund_allocations_refund_fk foreign key (refund_id)
    references public.order_refunds (id) on update cascade on delete cascade,
  constraint order_refund_allocations_line_fk foreign key (order_line_id)
    references public.order_lines (id) on update cascade on delete restrict,

  constraint order_refund_allocations_type_known
    check (allocation_type in ('line', 'shipping', 'goodwill', 'other')),
  constraint order_refund_allocations_amount_positive
    check (amount > 0),
  -- Nur eine Positionszuordnung nennt eine Position, und nur sie eine Menge.
  constraint order_refund_allocations_line_shape
    check ((allocation_type = 'line') = (order_line_id is not null)),
  constraint order_refund_allocations_quantity_shape
    check (quantity is null or (allocation_type = 'line' and quantity > 0))
);

create index if not exists order_refund_allocations_by_refund
  on public.order_refund_allocations (refund_id);
create index if not exists order_refund_allocations_by_line
  on public.order_refund_allocations (order_line_id);

comment on table public.order_refund_allocations is
  'What a refund was for (0095). Optional and 1:n: a repayment may cover one position, a part of one, several, the shipping, or goodwill. Where allocations exist their amounts sum to the refund exactly. `on delete cascade` because an allocation has no meaning without its refund; refunds themselves are not deleted.';

alter table public.order_refund_allocations enable row level security;
revoke all on public.order_refund_allocations from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 3. Der Fulfillment-Trigger bekommt genau einen Übergang dazu
--
-- 0039 erlaubt `unfulfilled ↔ shipped` und sonst nichts. `cancelled` stand
-- im CHECK, war aber unerreichbar — jeder Versuch warf `restrict_violation`.
--
-- Neu erlaubt: `unfulfilled → cancelled`, und nur das. NICHT
-- `shipped → cancelled`: eine versendete Bestellung wird nicht storniert,
-- sie wird retourniert. NICHT `cancelled → *`: der Zustand ist terminal.
--
-- Alles andere ist wortgleich aus 0039 übernommen, `shipped_at` eingeschlossen
-- — beim Storno ist es ohnehin NULL, weil nur eine unversendete Bestellung
-- dorthin kommt.
-- ---------------------------------------------------------------------------

create or replace function public.orders_protect_fulfillment()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_changed boolean := new.fulfillment_status is distinct from old.fulfillment_status;
begin
  if v_changed then
    if not (
      (old.fulfillment_status = 'unfulfilled' and new.fulfillment_status = 'shipped')
      or
      (old.fulfillment_status = 'shipped' and new.fulfillment_status = 'unfulfilled')
      or
      -- 0095: eine Bestellung, von der nichts mehr zu liefern ist.
      (old.fulfillment_status = 'unfulfilled' and new.fulfillment_status = 'cancelled')
    ) then
      raise exception 'fulfillment cannot go from % to %', old.fulfillment_status, new.fulfillment_status
        using errcode = 'restrict_violation';
    end if;

    if new.needs_resolution is distinct from old.needs_resolution then
      raise exception 'fulfillment must not change needs_resolution'
        using errcode = 'restrict_violation';
    end if;

    -- Server time on the way out, nothing on the way back. Whatever the caller
    -- passed is discarded in both directions.
    if new.fulfillment_status = 'shipped' then
      new.shipped_at := now();
    else
      new.shipped_at := null;
    end if;
  else
    new.shipped_at := old.shipped_at;
  end if;

  return new;
end;
$$;

comment on function public.orders_protect_fulfillment() is
  'Guards the fulfillment lifecycle: unfulfilled to shipped and back (0039), and unfulfilled to cancelled (0095). Nothing leaves cancelled, and a shipped order is never cancelled — it is returned. Sets shipped_at from the server clock; no caller names a shipping date.';


-- ---------------------------------------------------------------------------
-- 4. Die abgeleiteten Mengen, einmal geschrieben
--
-- Dieselbe Rechnung wie `lineQuantities()` in `lib/commerce/order-lines.ts`.
-- Zwei Fassungen, ein Test hält sie gegeneinander — so wie `saleItemClosed()`
-- an `sale_item_is_closed()` hängt.
-- ---------------------------------------------------------------------------

create or replace function public.order_line_quantities(p_order_line_id bigint)
returns table (
  ordered     integer,
  cancelled   integer,
  returned    integer,
  fulfillable integer,
  outstanding integer,
  cancellable integer,
  returnable  integer
)
language sql
stable
set search_path = ''
as $$
  with l as (
    select ol.quantity from public.order_lines ol where ol.id = p_order_line_id
  ),
  e as (
    select
      coalesce(sum(ev.quantity) filter (where ev.kind = 'cancelled'), 0)::integer as cancelled,
      coalesce(sum(ev.quantity) filter (where ev.kind = 'returned'), 0)::integer  as returned
      from public.order_line_events ev
     where ev.order_line_id = p_order_line_id
  )
  select
    l.quantity,
    e.cancelled,
    e.returned,
    greatest(0, l.quantity - e.cancelled)                          as fulfillable,
    greatest(0, l.quantity - e.cancelled - e.returned)             as outstanding,
    -- Stornieren und Zurücknehmen greifen auf denselben Vorrat zu.
    greatest(0, l.quantity - e.cancelled - e.returned)             as cancellable,
    greatest(0, l.quantity - e.cancelled - e.returned)             as returnable
    from l cross join e;
$$;

comment on function public.order_line_quantities(bigint) is
  'Ordered, cancelled, returned, fulfillable, outstanding and what may still be cancelled or received back for one order line (0095). Derived from the append-only order_line_events; nothing is stored. Mirrors lineQuantities() in lib/commerce/order-lines.ts. Internal: no client role holds EXECUTE — it is reached from the security-definer functions that already decided who may ask.';

/*
 * NIEMAND RUFT DIESE BEIDEN DIREKT AUF.
 *
 * Sie sind `security invoker`, also könnten sie ohnehin nichts lesen, was der
 * Aufrufer nicht schon lesen darf: `order_line_events` ist für jede
 * Clientrolle entzogen, und ein Kunde sieht über RLS nur die Positionen
 * seiner eigenen Bestellung. Ein PUBLIC-EXECUTE wäre damit heute kein Leck.
 *
 * Trotzdem wird es entzogen, aus dem Grund, den 0082 schon einmal
 * nachgetragen hat: „kein Rolle hält EXECUTE" ist der Satz, auf den sich
 * später jemand verlässt. Ohne den Entzug hinge die Sicherheit dieser beiden
 * daran, dass die Rechte auf `order_line_events` bleiben, wie sie sind — und
 * genau solche Kopplungen fallen beim nächsten Grant niemandem auf.
 *
 * Die Aufrufer sind `admin_order()`, `admin_mark_order_shipped()`,
 * `seller_cancel_order_line()` und `seller_receive_order_return()` — alle
 * `security definer` und dem Migrations-Owner gehörend, und ein Owner darf
 * seine eigenen Funktionen immer ausführen.
 */
revoke all on function public.order_line_quantities(bigint) from public, anon, authenticated;


/** Ist von dieser Bestellung überhaupt noch etwas zu liefern? */
create or replace function public.order_fulfillable_total(p_order_id bigint)
returns integer
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(greatest(0, l.quantity - coalesce(c.cancelled, 0))), 0)::integer
    from public.order_lines l
    left join lateral (
      select coalesce(sum(ev.quantity), 0)::integer as cancelled
        from public.order_line_events ev
       where ev.order_line_id = l.id and ev.kind = 'cancelled'
    ) c on true
   where l.order_id = p_order_id;
$$;

comment on function public.order_fulfillable_total(bigint) is
  'How many pieces of this order are still to be delivered: ordered minus cancelled, summed over its lines (0095). Zero means there is no parcel left to send. Internal: no client role holds EXECUTE.';

revoke all on function public.order_fulfillable_total(bigint) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 5. Positionsstorno
--
-- Der Operator nennt Position, Menge und die EINE physische Tatsache, die nur
-- er kennt. Alles andere entscheidet diese Funktion.
-- ---------------------------------------------------------------------------

create or replace function public.seller_cancel_order_line(
  p_order_line_id bigint,
  p_quantity      integer,
  -- 'present' | 'missing'. Die einzige Frage an den Menschen.
  p_stock_presence text,
  p_reason        text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
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
    movement_id, correction_movement_id, reason, created_by
  ) values (
    v_order.id, p_order_line_id, 'cancelled', p_quantity, v_outcome,
    v_movement, v_correction, nullif(btrim(coalesce(p_reason, '')), ''), (select auth.uid())
  );

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
    'stock_outcome', v_outcome,
    'movement_id', v_movement,
    'correction_movement_id', v_correction,
    'fulfillable_total', v_remaining,
    'order_cancelled', v_remaining = 0);
end;
$$;

comment on function public.seller_cancel_order_line(bigint, integer, text, text) is
  'Cancels a quantity of one order line before dispatch (0095). The caller says how many and whether the goods are physically there; the server decides the stock outcome from whether the position was ever booked out. restocked books +qty return, shortfall books +qty return AND -qty correction in the same transaction (net zero, the piece was never there), none books nothing. Idempotent through the quantity check under the line lock. Cancels the whole order once nothing is left to deliver. Moves no money.';

revoke all on function public.seller_cancel_order_line(bigint, integer, text, text)
  from public, anon;
grant execute on function public.seller_cancel_order_line(bigint, integer, text, text)
  to authenticated;


-- ---------------------------------------------------------------------------
-- 6. Retoureneingang
--
-- Nach dem Versand. Der Wareneingang ist immer ein echter: was zurückkommt,
-- liegt im Regal — sonst wäre es nicht zurückgekommen.
-- ---------------------------------------------------------------------------

create or replace function public.seller_receive_order_return(
  p_order_line_id bigint,
  p_quantity      integer,
  p_reason        text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_line     record;
  v_order    record;
  v_open     integer;
  v_movement bigint;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required'
      using errcode = 'insufficient_privilege';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'a return needs a positive quantity'
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

  -- Dieselbe Weltprüfung wie beim Storno (0047/0021).
  if v_order.commerce_mode is distinct from public.commerce_mode() then
    raise exception 'order % belongs to a different commerce mode',
      v_order.order_number using errcode = 'insufficient_privilege';
  end if;

  if exists (select 1 from public.order_events e
              where e.order_id = v_order.id
                and e.event_type = 'sandbox_stock_reverted') then
    raise exception 'order % had its stock reverted as a test order',
      v_order.order_number using errcode = 'restrict_violation';
  end if;

  if v_order.payment_status not in ('paid', 'partially_refunded', 'refunded') then
    raise exception 'order % is %, and only a paid order can be returned',
      v_order.order_number, v_order.payment_status using errcode = 'restrict_violation';
  end if;

  if v_order.fulfillment_status <> 'shipped' then
    raise exception 'order % is %, and only a shipped order has goods to come back',
      v_order.order_number, v_order.fulfillment_status using errcode = 'restrict_violation';
  end if;

  -- Was nie ausgebucht wurde, kann nicht zurückkommen.
  if not exists (
    select 1 from public.order_reservations r
     where r.order_id = v_order.id
       and r.inventory_id = v_line.inventory_id
       and r.movement_id is not null
  ) then
    raise exception 'this position never left stock; there is nothing to book back'
      using errcode = 'restrict_violation';
  end if;

  select q.returnable into v_open from public.order_line_quantities(p_order_line_id) q;
  if p_quantity > v_open then
    raise exception 'only % of this position are still out, % were asked for',
      v_open, p_quantity using errcode = 'check_violation';
  end if;

  v_movement := public.apply_inventory_movement(
    v_line.sky_id, v_line.condition, p_quantity, 'return',
    null, null,
    'Retoure Bestellung ' || v_order.order_number,
    (select auth.uid()));

  insert into public.order_line_events (
    order_id, order_line_id, kind, quantity, stock_outcome,
    movement_id, reason, created_by
  ) values (
    v_order.id, p_order_line_id, 'returned', p_quantity, 'restocked',
    v_movement, nullif(btrim(coalesce(p_reason, '')), ''), (select auth.uid())
  );

  insert into public.order_events (order_id, event_type, actor_kind, actor_user_id, payload)
  values (v_order.id, 'order_return_received', 'admin', (select auth.uid()),
          jsonb_build_object('order_line_id', p_order_line_id,
                             'quantity', p_quantity, 'movement_id', v_movement));

  return jsonb_build_object('movement_id', v_movement,
                            'returned_total', (select q.returned
                                                 from public.order_line_quantities(p_order_line_id) q));
end;
$$;

comment on function public.seller_receive_order_return(bigint, integer, text) is
  'Books a quantity of one shipped order line back into stock (0095): one +qty `return` movement through the canonical path, and one append-only order_line_event. Partial returns are ordinary — the quantity is checked against what is still out, under the line lock, so a retry books nothing twice. Refuses a position that never left stock. Moves no money.';

revoke all on function public.seller_receive_order_return(bigint, integer, text)
  from public, anon;
grant execute on function public.seller_receive_order_return(bigint, integer, text)
  to authenticated;


-- ---------------------------------------------------------------------------
-- 7. Der Versand lernt zwei Gründe zu unterscheiden
--
-- Byte für byte die Fassung aus 0041, plus zwei Prüfungen:
--
--   Widerruf       der Kunde will aus dem Vertrag. Nichts geht raus.
--   nichts übrig   jede Position ist auf null storniert.
--
-- EIN TEILSTORNO SPERRT NICHT. Acht Figuren mit einer stornierten sind sieben
-- Figuren, die jemand erwartet.
-- ---------------------------------------------------------------------------

create or replace function public.admin_mark_order_shipped(
  p_order_number    text,
  p_tracking_number text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order    record;
  v_tracking text;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required'
      using errcode = 'insufficient_privilege';
  end if;

  v_tracking := nullif(btrim(coalesce(p_tracking_number, '')), '');
  if v_tracking is not null and length(v_tracking) > 64 then
    raise exception 'a tracking number of % characters is not plausible', length(v_tracking)
      using errcode = 'check_violation';
  end if;

  select o.* into v_order
    from public.orders o
   where o.order_number = p_order_number
     for update;

  if not found then
    raise exception 'unknown order %', p_order_number using errcode = 'no_data_found';
  end if;

  /*
   * EINE TEILWEISE ERSTATTETE BESTELLUNG IST EINE BEZAHLTE BESTELLUNG.
   *
   * Bis 0041 stand hier `<> 'paid'`, und das war richtig, solange eine
   * Erstattung nur am Ende eines Widerrufs vorkam. Mit dem Positionsstorno
   * ist sie der Alltag: acht Figuren, eine nicht lieferbar, 3,49 € zurück —
   * und die anderen sieben müssen raus. Mit der alten Bedingung wäre genau
   * diese Bestellung ab dem Moment der Erstattung nicht mehr versandfähig
   * gewesen.
   *
   * `refunded` bleibt draußen: wenn alles zurückgezahlt wurde, geht nichts
   * mehr raus.
   */
  if v_order.payment_status not in ('paid', 'partially_refunded') then
    raise exception 'order % is %, and only a paid order may be shipped',
      v_order.order_number, v_order.payment_status
      using errcode = 'check_violation';
  end if;

  if v_order.needs_resolution then
    raise exception 'order % needs to be looked at before it can be shipped',
      v_order.order_number
      using errcode = 'check_violation';
  end if;

  if v_order.fulfillment_status <> 'unfulfilled' then
    raise exception 'order % is already %', v_order.order_number, v_order.fulfillment_status
      using errcode = 'check_violation';
  end if;

  -- 0095: der Kunde hat den Vertrag widerrufen.
  if exists (select 1 from public.withdrawal_requests w where w.order_id = v_order.id) then
    raise exception 'order % was withdrawn; resolve the withdrawal before shipping',
      v_order.order_number using errcode = 'restrict_violation';
  end if;

  -- 0095: es ist nichts mehr zu liefern.
  if public.order_fulfillable_total(v_order.id) = 0 then
    raise exception 'order % has nothing left to ship', v_order.order_number
      using errcode = 'restrict_violation';
  end if;

  update public.orders
     set fulfillment_status = 'shipped',
         tracking_number    = coalesce(v_tracking, v_order.tracking_number)
   where id = v_order.id;

  insert into public.order_events (order_id, event_type, actor_kind, actor_user_id, payload)
  values (v_order.id, 'order_shipped', 'admin', (select auth.uid()),
          jsonb_build_object(
            'has_tracking',
            coalesce(v_tracking, v_order.tracking_number) is not null));

  return 'shipped';
end;
$$;

comment on function public.admin_mark_order_shipped(text, text) is
  'Marks a paid order as shipped and records the tracking number (0018, 0023, 0041). Refuses an order that was withdrawn, and one whose lines have all been cancelled (0095) — a PARTIAL cancellation does not block the parcel. shipped_at comes from the trigger, never from the caller.';


-- ---------------------------------------------------------------------------
-- 8. Eine Erstattung darf sagen, wofür sie war
--
-- Byte für byte die Fassung aus 0047, plus ein optionaler Parameter. Ohne ihn
-- verhält sie sich wie bisher — jeder bestehende Aufruf bleibt gültig.
--
-- ERST FALLEN LASSEN, SONST ENTSTEHT EINE ZWEITE FUNKTION.
--
-- `create or replace` ersetzt nur bei GLEICHER Argumentliste. Ein zusätzlicher
-- Parameter macht daraus eine Überladung, und dann stehen zwei
-- `seller_record_refund` nebeneinander — PostgREST kann einen Aufruf mit den
-- alten fünf Parametern nicht mehr zuordnen und antwortet `PGRST203`, womit
-- der Erstattungsweg schlicht kaputt wäre. Genau das ist beim ersten Lauf auf
-- Staging passiert; der Drop hier ist die Reparatur und macht die Migration
-- zugleich wiederholbar.
--
-- Die alte Fassung kann gefahrlos weichen: jeder Aufruf mit fünf benannten
-- Parametern löst danach wieder eindeutig auf die neue auf, deren sechster
-- einen Default hat.
-- ---------------------------------------------------------------------------

drop function if exists public.seller_record_refund(text, numeric, text, bigint, text);

create or replace function public.seller_record_refund(
  p_order_number text,
  p_amount       numeric,
  p_reason       text default null,
  p_withdrawal_id bigint default null,
  p_provider_refund_id text default null,
  -- [{type, order_line_id, quantity, amount}, …]. Leer oder NULL ist erlaubt.
  p_allocations jsonb default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_order  record;
  v_paid   numeric;
  v_so_far numeric;
  v_id     bigint;
  v_alloc  jsonb;
  v_sum    numeric := 0;
  v_type   text;
  v_line   bigint;
  v_qty    integer;
  v_amount numeric;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required'
      using errcode = 'insufficient_privilege';
  end if;

  select o.* into v_order from public.orders o where o.order_number = p_order_number;
  if not found then
    raise exception 'no such order' using errcode = 'invalid_parameter_value';
  end if;

  if v_order.payment_status not in ('paid', 'partially_refunded') then
    raise exception 'only a paid order can be refunded'
      using errcode = 'invalid_parameter_value';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'a refund needs a positive amount'
      using errcode = 'invalid_parameter_value';
  end if;

  v_paid := v_order.total_amount;
  select coalesce(sum(r.amount), 0) into v_so_far
    from public.order_refunds r where r.order_id = v_order.id;

  if v_so_far + p_amount > v_paid then
    raise exception 'that is more than was paid for this order'
      using errcode = 'invalid_parameter_value';
  end if;

  /*
   * DIE TEILE MÜSSEN DAS GANZE ERGEBEN — oder es gibt keine Teile.
   *
   * Geprüft BEVOR irgendetwas geschrieben wird, damit eine unvollständige
   * Aufteilung nie neben einer vollständigen Erstattung steht.
   */
  if p_allocations is not null and jsonb_array_length(p_allocations) > 0 then
    for v_alloc in select * from jsonb_array_elements(p_allocations) loop
      v_type   := v_alloc ->> 'type';
      v_line   := nullif(v_alloc ->> 'order_line_id', '')::bigint;
      v_qty    := nullif(v_alloc ->> 'quantity', '')::integer;
      v_amount := (v_alloc ->> 'amount')::numeric;

      if v_type is null or v_type not in ('line', 'shipping', 'goodwill', 'other') then
        raise exception 'unknown allocation type %', coalesce(v_type, '(null)')
          using errcode = 'invalid_parameter_value';
      end if;
      if v_amount is null or v_amount <= 0 then
        raise exception 'an allocation needs a positive amount'
          using errcode = 'invalid_parameter_value';
      end if;
      if (v_type = 'line') <> (v_line is not null) then
        raise exception 'only a line allocation names a position'
          using errcode = 'invalid_parameter_value';
      end if;
      if v_line is not null and not exists (
        select 1 from public.order_lines l
         where l.id = v_line and l.order_id = v_order.id
      ) then
        raise exception 'that position does not belong to order %', v_order.order_number
          using errcode = 'invalid_parameter_value';
      end if;

      v_sum := v_sum + v_amount;
    end loop;

    if round(v_sum, 2) <> round(p_amount, 2) then
      raise exception 'the parts come to % but the refund is %', v_sum, p_amount
        using errcode = 'invalid_parameter_value';
    end if;
  end if;

  insert into public.order_refunds (
    order_id, amount, currency, reason, withdrawal_request_id,
    provider_refund_id, created_by
  ) values (
    v_order.id, p_amount, v_order.currency, p_reason, p_withdrawal_id,
    p_provider_refund_id, auth.uid()
  ) returning id into v_id;

  if p_allocations is not null and jsonb_array_length(p_allocations) > 0 then
    insert into public.order_refund_allocations
      (refund_id, order_line_id, quantity, amount, allocation_type)
    select
      v_id,
      nullif(a ->> 'order_line_id', '')::bigint,
      nullif(a ->> 'quantity', '')::integer,
      (a ->> 'amount')::numeric,
      a ->> 'type'
      from jsonb_array_elements(p_allocations) a;
  end if;

  update public.orders o
     set payment_status = case when v_so_far + p_amount >= v_paid
                               then 'refunded' else 'partially_refunded' end
   where o.id = v_order.id;

  insert into public.order_events (order_id, event_type, actor_kind, payload)
  values (v_order.id, 'refund_recorded', 'admin',
          jsonb_build_object('refund_id', v_id, 'amount', p_amount::text));

  if p_withdrawal_id is not null then
    update public.withdrawal_requests w
       set handled_at = coalesce(w.handled_at, now()), handled_by = auth.uid()
     where w.id = p_withdrawal_id;
  end if;

  return jsonb_build_object('refund_id', v_id, 'refunded_total', v_so_far + p_amount);
end;
$$;

comment on function public.seller_record_refund(text, numeric, text, bigint, text, jsonb) is
  'Records a repayment the operator made in Stripe (0047, allocations 0095). Moves no money and touches no stock. Optional allocations say what the amount was for — a position and quantity, the shipping, goodwill — and must sum to it exactly; a refund without them stays valid. The status is a mirror; the money is the sum of order_refunds (ADR-0083).';

revoke all on function public.seller_record_refund(text, numeric, text, bigint, text, jsonb)
  from public, anon;
grant execute on function public.seller_record_refund(text, numeric, text, bigint, text, jsonb)
  to authenticated;


-- ---------------------------------------------------------------------------
-- 9. Der autorisierte Bestellkontext für das Widerrufsformular
--
-- Damit ein eingeloggter Kunde Bestellnummer, Name und E-Mail nicht noch
-- einmal abtippt. Das Tor ist `authorize_order_payment()` — derselbe Weg, den
-- `order_withdrawal_state()` seit 0047 benutzt: entweder gehört die Bestellung
-- dem angemeldeten Konto, oder der Aufrufer hält den Zahlungstoken des Gasts.
-- Ein fremder Aufrufer bekommt NULL, nicht etwa eine andere Antwort.
--
-- Der Name kommt aus der Lieferadresse der Bestellung, nie aus der Adresse.
-- ---------------------------------------------------------------------------

create or replace function public.order_withdrawal_context(
  p_order_number text,
  p_token        text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_order record;
  v_name  text;
begin
  select o.id, o.order_number, o.customer_email, o.placed_at
    into v_order
    from public.orders o
   where o.order_number = btrim(coalesce(p_order_number, ''));
  if not found then
    return null;
  end if;

  if not public.authorize_order_payment(v_order.id, (select auth.uid()), p_token) then
    return null;
  end if;

  select nullif(btrim(concat_ws(' ', a.first_name, a.last_name)), '')
    into v_name
    from public.order_addresses a
   where a.order_id = v_order.id
     and a.kind = 'shipping'
   limit 1;

  return jsonb_build_object(
    'order_number', v_order.order_number,
    'customer_email', v_order.customer_email,
    'consumer_name', v_name,
    'placed_at', v_order.placed_at,
    'declared', exists (select 1 from public.withdrawal_requests w
                         where w.order_id = v_order.id));
end;
$$;

comment on function public.order_withdrawal_context(text, text) is
  'The order behind a withdrawal form, for a caller who is authorised to see it (0095): the signed-in owner, or a guest holding the order''s payment token. Returns the order number, the e-mail on the order and the name from its shipping address, so none of it has to be typed again. NULL for anybody else — it is not an oracle. The public guest path at /widerrufen is unchanged and needs none of this.';

revoke all on function public.order_withdrawal_context(text, text) from public;
grant execute on function public.order_withdrawal_context(text, text) to anon, authenticated;


-- ---------------------------------------------------------------------------
-- 10. Was der Operator auf der Bestellung sieht
--
-- `admin_order()` gibt `jsonb` zurück, also reicht `create or replace` — kein
-- Drop, keine Grants nachzuziehen. Ergänzt werden: die Positions-ID (die die
-- neuen RPCs brauchen), die abgeleiteten Mengen je Position, der Widerruf, die
-- Erstattungen mit ihren Zuordnungen und die Positionsereignisse.
-- ---------------------------------------------------------------------------

create or replace function public.admin_order(p_order_number text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_order  record;
  v_result jsonb;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required'
      using errcode = 'insufficient_privilege';
  end if;

  select o.* into v_order from public.orders o where o.order_number = p_order_number;
  if not found then
    return null;
  end if;

  select jsonb_build_object(
    'order', jsonb_build_object(
      'order_number',       v_order.order_number,
      'placed_at',          v_order.placed_at,
      'paid_at',            v_order.paid_at,
      'shipped_at',         v_order.shipped_at,
      'cancelled_at',       v_order.cancelled_at,
      'payment_status',     v_order.payment_status,
      'fulfillment_status', v_order.fulfillment_status,
      'needs_resolution',   v_order.needs_resolution,
      'customer_email',     v_order.customer_email,
      'items_subtotal',     v_order.items_subtotal,
      'shipping_amount',    v_order.shipping_amount,
      'discount_amount',    v_order.discount_amount,
      'total_amount',       v_order.total_amount,
      'shipping_method',    v_order.shipping_method_name,
      'shipping_method_code', v_order.shipping_method_code,
      'tracking_number',    v_order.tracking_number,
      'is_guest',           v_order.user_id is null,
      'commerce_mode',      v_order.commerce_mode,
      'stock_reverted',     exists (
                              select 1 from public.order_events se
                               where se.order_id = v_order.id
                                 and se.event_type = 'sandbox_stock_reverted')
    ),
    'address', (
      select jsonb_build_object(
               'first_name', a.first_name, 'last_name', a.last_name,
               'company', a.company, 'street', a.street,
               'house_number', a.house_number, 'address_line_2', a.address_line_2,
               'postal_code', a.postal_code, 'city', a.city,
               'country_code', a.country_code, 'phone', a.phone)
        from public.order_addresses a
       where a.order_id = v_order.id
       limit 1
    ),
    -- `image` and `series` come from the LINE, never from `skylanders`: the
    -- order says what was sold, not what it is called today. Since 0095 the
    -- line also carries its id — the two new RPCs address a position, not an
    -- article — and the quantities derived from `order_line_events`.
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', l.id,
               'sky_id', l.sky_id, 'condition', l.condition,
               'name', l.name_snapshot, 'image', l.image_snapshot,
               'series', l.series_snapshot, 'quantity', l.quantity,
               'unit_price', l.unit_price, 'line_total', l.line_total,
               'cancelled', q.cancelled, 'returned', q.returned,
               'fulfillable', q.fulfillable, 'outstanding', q.outstanding,
               'cancellable', q.cancellable, 'returnable', q.returnable,
               -- Die technische Tatsache, aus der der Server den Bestandsausgang
               -- bestimmt. Die Oberfläche zeigt sie nicht als Auswahl an.
               'was_booked_out', exists (
                 select 1 from public.order_reservations r
                  where r.order_id = l.order_id
                    and r.inventory_id = l.inventory_id
                    and r.movement_id is not null))
               order by l.id)
        from public.order_lines l
        cross join lateral public.order_line_quantities(l.id) q
       where l.order_id = v_order.id
    ), '[]'::jsonb),
    'line_events', coalesce((
      select jsonb_agg(jsonb_build_object(
               'order_line_id', ev.order_line_id, 'kind', ev.kind,
               'quantity', ev.quantity, 'stock_outcome', ev.stock_outcome,
               'occurred_at', ev.occurred_at, 'reason', ev.reason)
               order by ev.id)
        from public.order_line_events ev
       where ev.order_id = v_order.id
    ), '[]'::jsonb),
    'withdrawal', (
      select jsonb_build_object('id', w.id, 'received_at', w.received_at,
                                'handled_at', w.handled_at,
                                'consumer_name', w.consumer_name)
        from public.withdrawal_requests w
       where w.order_id = v_order.id
       order by w.received_at asc
       limit 1
    ),
    'refunds', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'amount', r.amount, 'occurred_at', r.occurred_at,
               'reason', r.reason, 'provider_refund_id', r.provider_refund_id,
               'allocations', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'type', al.allocation_type, 'order_line_id', al.order_line_id,
                          'quantity', al.quantity, 'amount', al.amount) order by al.id)
                   from public.order_refund_allocations al
                  where al.refund_id = r.id), '[]'::jsonb))
               order by r.id)
        from public.order_refunds r
       where r.order_id = v_order.id
    ), '[]'::jsonb),
    'fulfillable_total', public.order_fulfillable_total(v_order.id),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
               'event_type', e.event_type, 'actor_kind', e.actor_kind,
               'created_at', e.created_at, 'payload', e.payload)
               order by e.id)
        from public.order_events e
       where e.order_id = v_order.id
    ), '[]'::jsonb),
    'mail', coalesce((
      select jsonb_agg(jsonb_build_object(
               'kind', m.kind,
               'state', public.order_mail_effective_state(m.state, m.claimed_at),
               'sent_at', m.sent_at,
               'attempts', m.attempts,
               'last_error', m.last_error,
               'updated_at', m.updated_at)
               order by m.kind)
        from public.order_mail m
       where m.order_id = v_order.id
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

comment on function public.admin_order(text) is
  'One order for the operator (0018, 0021, 0023, 0039, 0041) plus, since 0095: the line id, the derived quantities per line, whether the line was ever booked out, the line events, the withdrawal, the refunds with their allocations, and how much is still to be delivered.';
