-- ---------------------------------------------------------------------------
-- 0097 — Der Stornierungsgrund als Wert, nicht als Freitext.
--
-- WARUM ÜBERHAUPT. `order_line_events.reason` nimmt seit 0095 jeden Text bis
-- 500 Zeichen an. Ein Grund aus einer festen Auswahl ließe sich dort
-- unterbringen — aber nichts würde die Wertemenge zusichern, dieselbe Spalte
-- trüge zwei Bedeutungen (Code bei vier Gründen, Freitext bei „Sonstiges"),
-- und die deutschen Beschriftungen stünden in einer Datenbank, deren Sprache
-- Englisch ist. Eine Auswertung müsste später raten.
--
-- WARUM JETZT. Die Tabelle enthält genau eine Zeile — das Storno von A1, mit
-- `reason = null` — und auf Production existiert sie noch gar nicht. Eine
-- Struktur, die hier entschieden wird, gilt rückwirkend für alles. Ab dem
-- nächsten Durchstichschritt wäre sie eine Umdeutung bestehender Daten.
--
-- WAS SICH NICHT ÄNDERT. Der Grund entscheidet nichts über den Bestand. Er
-- taucht in der Berechnung von `stock_outcome` nicht auf, und die eine Frage
-- an den Menschen — liegt das Stück im Regal? — bleibt unverändert Pflicht.
-- Keine Bestandslogik, keine Refundlogik, keine Bewegung.
--
-- WAS NICHT MITGELIEFERT WIRD. `admin_order()` projiziert `reason_code`
-- (noch) nicht: heute zeigt kein Bildschirm die Ereignisgründe an, und eine
-- Projektion für einen Leser, den es nicht gibt, wäre eine dritte Kopie einer
-- 145-zeiligen Funktion. Sobald ein Schirm sie braucht, ist es eine Zeile.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1. Die Spalte und ihre Wertemenge
-- ---------------------------------------------------------------------------
alter table public.order_line_events
  add column if not exists reason_code text;

comment on column public.order_line_events.reason_code is
  'Why a quantity was cancelled, as one of a fixed set (0097): buyer_request, item_not_found, item_damaged, stock_incorrect, other. Deliberately independent of stock_outcome — a reason never decides what the shelf did, the operator''s answer to the presence question does. NULL on every return and on rows written before this existed; free text belongs in `reason`, above all with `other`.';

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'order_line_events_reason_code_known') then
    alter table public.order_line_events
      add constraint order_line_events_reason_code_known check (
        reason_code is null or reason_code in (
          'buyer_request',    -- Käuferwunsch
          'item_not_found',   -- Artikel nicht auffindbar
          'item_damaged',     -- Artikel beschädigt
          'stock_incorrect',  -- Falscher Lagerbestand
          'other'));          -- Sonstiges — Freitext steht in `reason`
  end if;

  -- Ein Stornierungsgrund gehört zum Storno. Eine Retoure hat keinen: warum
  -- der Kunde zurückschickt, ist eine andere Frage als warum wir stornieren.
  if not exists (select 1 from pg_constraint
                  where conname = 'order_line_events_reason_code_only_on_cancel') then
    alter table public.order_line_events
      add constraint order_line_events_reason_code_only_on_cancel check (
        reason_code is null or kind = 'cancelled');
  end if;
end
$$;


-- ---------------------------------------------------------------------------
-- 2. Der fünfte Parameter
--
-- ERST LÖSCHEN, DANN ANLEGEN. `create or replace` ersetzt nur bei identischer
-- Argumentliste; ein zusätzlicher Parameter erzeugt eine ZWEITE Funktion, und
-- PostgREST antwortet dann mit PGRST203, weil es nicht weiß, welche gemeint
-- ist. Genau das ist in 0095 mit `seller_record_refund` passiert.
--
-- `p_reason_code` steht VOR `p_reason`, weil beide `default null` haben und
-- ein vierter Positionsparameter sonst im falschen Feld landete. PostgREST
-- ruft benannt auf, aber die Reihenfolge ist trotzdem die ehrlichere.
-- ---------------------------------------------------------------------------
drop function if exists public.seller_cancel_order_line(bigint, integer, text, text);

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

comment on function public.seller_cancel_order_line(bigint, integer, text, text, text) is
  'Cancels a quantity of one order line before dispatch (0095, um den Grund erweitert in 0097). The caller says how many, whether the goods are physically there, and why; the server decides the stock outcome from whether the position was ever booked out — the reason has no part in it. restocked books +qty return, shortfall books +qty return AND -qty correction in the same transaction (net zero, the piece was never there), none books nothing. Idempotent through the quantity check under the line lock. Cancels the whole order once nothing is left to deliver. Moves no money.';

revoke all on function public.seller_cancel_order_line(bigint, integer, text, text, text)
  from public, anon;
grant execute on function public.seller_cancel_order_line(bigint, integer, text, text, text)
  to authenticated;
