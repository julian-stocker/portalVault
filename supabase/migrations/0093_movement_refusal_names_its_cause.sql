-- ===========================================================================
-- 0093 — Eine abgelehnte Bewegung sagt, WARUM sie abgelehnt wurde
--
-- WAS VORHER FALSCH ANKAM
--
-- `apply_inventory_movement` lehnt einen Abgang ab, der das Regal unter die
-- reservierte Menge drücken würde. Der Wächter dafür ist die WHERE-Klausel
-- des UPDATE — `quantity + p_delta >= reserved` — und genau die bleibt hier
-- unverändert. Was sich ändert, ist ausschließlich der Satz danach.
--
-- Denn dieser eine Satz deckte zwei völlig verschiedene Lagen ab:
--
--   quantity 0, reserved 0, delta -1   es ist nichts da
--   quantity 1, reserved 1, delta -1   es ist etwas da, aber es gehört
--                                      bereits einer SkyIsles-Bestellung
--
-- Beide kamen als „would take SKY-xxxx / loose below its reserved quantity"
-- heraus. Das Orderbuch übersetzte den Text — er nennt „reserved" — in
-- „Dieser Artikel ist aktuell für eine SkyIsles-Bestellung reserviert", und
-- diese Meldung erschien dann auch für Figuren, für die es überhaupt keine
-- Lagerzeile und nirgends eine Reservierung gab. Der Betreiber suchte nach
-- einer Bestellung, die es nicht gibt.
--
-- WAS SICH ÄNDERT — UND WAS AUSDRÜCKLICH NICHT
--
-- Geändert: der eine `raise exception` im Fehlerzweig wird zu zwei, und der
-- Zweig liest vorher die bereits gesperrte Zeile, um zu entscheiden welcher.
--
-- Unverändert: Signatur, `security definer`, `set search_path = ''`, die
-- Grants (keine — die Funktion bleibt für public, anon, authenticated und
-- service_role revoked), die Reihenfolge der Schritte, das `insert … on
-- conflict do nothing`, das `select … for update`, die UPDATE-Bedingung, das
-- Schreiben der Bewegung, der Rückgabewert, der SQLSTATE (`check_violation`,
-- 23514) und damit jede Fallunterscheidung, die ein Aufrufer heute trifft.
--
-- WARUM DAS LESEN NACH DEM FEHLSCHLAG SICHER IST
--
-- Die Zeile ist seit dem `select … for update` in dieser Transaktion
-- gesperrt, und das UPDATE hat sie nicht verändert (null Zeilen). Der Lesende
-- sieht also exakt die Werte, gegen die der Wächter entschieden hat — keine
-- zweite Wahrheit, kein Fenster, keine Entscheidung auf veralteten Zahlen.
-- Und es ist kein Wächter: es läuft ausschließlich, nachdem bereits
-- feststeht, dass abgelehnt wird.
--
-- KEINE DATENÄNDERUNG. Diese Migration fasst keine Bestände, keine
-- Bewegungen, keine Reservierungen und keine Legacy-Daten an.
-- ===========================================================================

create or replace function public.apply_inventory_movement(
  p_sky_id     text,
  p_condition  text,
  p_delta      integer,
  p_reason     text,
  p_unit_cost  numeric,
  p_currency   text,
  p_note       text,
  p_created_by uuid
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inventory_id bigint;
  v_movement_id  bigint;
  v_updated      integer;
  v_quantity     integer;
  v_reserved     integer;
begin
  if p_delta is null or p_delta = 0 then
    raise exception 'a movement needs a non-zero delta'
      using errcode = 'check_violation';
  end if;

  -- Open the position if this is the first movement for it. A position that
  -- ends up unused is impossible: any failure below aborts the whole call, and
  -- PostgREST runs one RPC in one transaction.
  insert into public.shop_inventory (sky_id, condition)
  values (p_sky_id, p_condition)
  on conflict (sky_id, condition) do nothing;

  -- Lock it before deciding anything. Concurrent movements on the same
  -- position serialise here instead of racing.
  select id
    into v_inventory_id
    from public.shop_inventory
   where sky_id = p_sky_id
     and condition = p_condition
   for update;

  if v_inventory_id is null then
    raise exception 'no stock position for % / %', p_sky_id, p_condition
      using errcode = 'no_data_found';
  end if;

  -- The guard is the WHERE clause, not a preceding SELECT. There is no window
  -- between checking and writing, so no client and no concurrent transaction
  -- can read a stock level, compute a new one and write it back.
  --
  -- `>= reserved` covers negative stock too, since reserved is never below 0.
  update public.shop_inventory
     set quantity = quantity + p_delta
   where id = v_inventory_id
     and quantity + p_delta >= reserved;

  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    /*
     * REFUSED — AND NOW IT SAYS WHICH REFUSAL IT WAS.
     *
     * Read, not decided: the row is locked and the UPDATE changed nothing,
     * so these are the very numbers the guard above judged. The guard itself
     * is untouched; this branch only picks the sentence.
     */
    select quantity, reserved
      into v_quantity, v_reserved
      from public.shop_inventory
     where id = v_inventory_id;

    /*
     * There is not enough of it, full stop. `reserved` is never negative, so
     * a result below zero means the shelf itself cannot cover the movement —
     * whether or not anything is reserved.
     */
    if v_quantity + p_delta < 0 then
      raise exception
        'insufficient stock for % / %: % on hand, movement of %',
        p_sky_id, p_condition, v_quantity, p_delta
        using errcode = 'check_violation';
    end if;

    /*
     * There IS enough of it, but it is spoken for. A SkyIsles order holds it
     * and an external sale must not eat that hold — the same refusal as
     * before, now under its own name.
     */
    raise exception
      'movement would consume reserved stock for % / %: % on hand, % reserved',
      p_sky_id, p_condition, v_quantity, v_reserved
      using errcode = 'check_violation';
  end if;

  -- Same transaction. Either both of these happened or neither did.
  insert into public.inventory_movements
    (inventory_id, delta, reason, unit_cost, currency, note, created_by)
  values
    (v_inventory_id, p_delta, p_reason, p_unit_cost, p_currency, p_note, p_created_by)
  returning id into v_movement_id;

  return v_movement_id;
end;
$$;

comment on function public.apply_inventory_movement(text, text, integer, text, numeric, text, text, uuid) is
  'Stock change and journal entry in one transaction. Internal: no role holds EXECUTE. Call it through record_inventory_movement() or system_record_inventory_movement(). Refuses a movement that would take the position below its reserved quantity, and names which of the two causes it was (0093): `insufficient stock for …` when the shelf cannot cover it at all, `movement would consume reserved stock for …` when it can but the stock is held for an order. Both are check_violation, as the single refusal was before.';

/*
 * Die Rechte bleiben, wie 0003 sie gesetzt hat: niemand darf diese Funktion
 * direkt aufrufen. Wiederholt, weil `create or replace` die bestehenden
 * Grants zwar nicht anfasst, das Ziel hier aber ausdrücklich Teil des
 * Vertrags ist — und ein späterer Leser sonst in 0003 nachschlagen muss.
 */
revoke all on function public.apply_inventory_movement(text, text, integer, text, numeric, text, text, uuid)
  from public, anon, authenticated, service_role;
