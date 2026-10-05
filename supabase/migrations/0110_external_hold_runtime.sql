-- ===========================================================================
-- 0110 — External Holds, zur Laufzeit
--
-- `0109` hat `order_reservations` einen zweiten Eigentümer gegeben. Diese
-- Migration füllt ihn: ein externer Verkauf hält seinen Bestand von der
-- Anlage bis zum Versand, und er hält ihn über dieselbe Buchhaltung, die der
-- Shop-Checkout seit `0010` benutzt.
--
-- FÜNF FUNKTIONEN SIND NEU, NEUN WERDEN ERSETZT. Keine Signatur ändert sich,
-- also entsteht keine einzige neue Overload. Keine Zeile wird von dieser
-- Migration geschrieben: danach KANN ein Hold entstehen, und es existiert
-- keiner.
--
-- WAS 0110 AUSDRÜCKLICH NICHT TUT
--
--   KEINE STATUS-STATE-MACHINE. `seller_set_sale_status`, die
--   Rückwärtsübergänge und das Storno-Verhalten sind `0111`. Diese Datei
--   nennt sie nicht.
--
--   KEINE SIGNATURÄNDERUNG AN `seller_create_sale_with_details`. Der
--   `p_status`-Parameter gehört laut Plan zu `0111` und wird nicht
--   vorgezogen. Dass ein neu angelegter externer Verkauf trotzdem sofort
--   reserviert, kommt von unten: `seller_add_sale_item` versucht den Hold,
--   und die Anlage geht durch genau diese Funktion. Eine Stelle, keine
--   Dopplung.
--
--   KEINE BACKUPÄNDERUNG. `order_reservations.sale_item_id` fehlt in `0104`
--   und `0105`, und das ist bekannt und `0112` zugeordnet.
--
--   KEINE ÄNDERUNG AM CHECKOUT. `reserve_for_order`,
--   `release_order_reservations`, `convert_order_reservations` und
--   `release_expired_reservations` werden nicht angefasst. Sie kommen in
--   dieser Datei nur in Kommentaren vor.
--
-- LOOSE ONLY. Ein Hold entsteht ausschließlich auf der operativen Position,
-- und die ist `v1_sale_condition()`. Eine Verkaufszeile mit einer anderen
-- Condition bekommt keinen Hold und auch keine Ausnahme — sie bekommt den
-- Grund `not_loose`. Keine neue Verzweigung nach Condition: gefragt wird
-- dieselbe Funktion, die `shop_offers()`, `create_order()` und seit `0108`
-- auch `record_inventory_movement` fragen.
--
-- DIE EINE AUTORITATIVE ZAHL BLEIBT `shop_inventory.reserved`. Jede Änderung
-- daran geht durch eine geführte WHERE-Klausel, genau wie in `0010`:
--
--   halten    reserved = reserved + 1 where quantity - reserved >= 1
--   freigeben reserved = reserved - q where reserved >= q   (sonst laut)
--   wandeln   freigeben, DANN buchen — nie umgekehrt
--
-- Die Reihenfolge beim Wandeln ist nicht verhandelbar. `0025` sagt warum:
-- „Release the hold before booking, or the guard below trips on it." Der
-- Wächter in `apply_inventory_movement` ist `quantity + p_delta >= reserved`
-- und würde über den eigenen Hold stolpern.
--
-- `reservation_reconciliation` (0010) summiert alle aktiven Reservierungen
-- ohne Filter auf `order_id` und deckt externe Holds damit ab, ohne geändert
-- zu werden. `npm run verify:commerce` hält `drift = 0`.
--
-- ERGEBNISSE SIND MASCHINENLESBAR, NICHT ERKLÄREND. Die Funktionen geben
-- stabile Kleinbuchstaben-Kennungen zurück, kein deutscher Satz. Die
-- Übersetzung findet in `de.ts` statt, und das Vokabular ist dasselbe, das
-- `0111` für seine übersprungenen Positionen braucht:
--
--   held · already_held · no_stock · no_inventory · not_a_figure · not_loose
--   already_booked · settled · not_shipped
--   return_announced · returned · return_already_restocked
--   internal_sale · historical · cancelled
--   released · no_hold
--
-- RÜCKBAU. Die fünf neuen Funktionen löschen und die neun ersetzten aus
-- ihren Ursprungsmigrationen unverändert erneut anwenden:
--   seller_add_sale_item · seller_delete_sale · seller_unbook_sale_item (0059)
--   seller_remove_sale_item (0065) · seller_book_sale_item (0073)
--   seller_settle_sale_item (0073) · seller_set_sale_item_not_shipped (0074)
--   seller_sale (0096) · seller_create_sale_with_details (0065)
--   drop function if exists public.seller_hold_sale_item(bigint);
--   drop function if exists public.seller_release_sale_item_hold(bigint);
--   drop function if exists public.hold_sale_item(bigint);
--   drop function if exists public.release_sale_item_hold(bigint);
--   drop function if exists public.convert_sale_item_hold(bigint);
-- Bestehende Holds müssten vorher freigegeben werden; solange keiner
-- existiert, ist der Rückbau folgenlos.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Vorbedingungen
--
-- `0110` setzt `0109` voraus. Jede Zusage wird gegen den Katalog gelesen,
-- nicht gegen die Reihenfolge der Dateinamen.
-- ---------------------------------------------------------------------------

do $$
declare
  v_missing text[] := '{}';
  v_name    text;
  v_drift   bigint;
begin
  if not exists (
    select 1 from pg_attribute a
     where a.attrelid = 'public.order_reservations'::regclass
       and a.attname = 'sale_item_id' and not a.attisdropped
  ) then
    v_missing := v_missing || 'order_reservations.sale_item_id';
  end if;

  foreach v_name in array array[
    'order_reservations_one_owner',
    'order_reservations_order_hold_expires',
    'order_reservations_sale_hold_never_expires',
    'order_reservations_sale_hold_is_one',
    'order_reservations_sale_item_fk'
  ] loop
    if not exists (
      select 1 from pg_constraint c
       where c.conrelid = 'public.order_reservations'::regclass and c.conname = v_name
    ) then
      v_missing := v_missing || v_name;
    end if;
  end loop;

  if not exists (
    select 1 from pg_class i join pg_namespace n on n.oid = i.relnamespace
     where n.nspname = 'public'
       and i.relname = 'order_reservations_one_active_hold_per_item'
  ) then
    v_missing := v_missing || 'order_reservations_one_active_hold_per_item';
  end if;

  if array_length(v_missing, 1) > 0 then
    raise exception '0109 ist nicht vollständig angewendet; es fehlt: %',
      array_to_string(v_missing, ', ')
      using errcode = 'undefined_object';
  end if;

  -- Dieselbe Vorbedingung wie in 0109, aus demselben Grund.
  select count(*) into v_drift from public.reservation_reconciliation where drift <> 0;
  if v_drift > 0 then
    raise exception
      'reserved und die aktiven Reservierungen stimmen auf % Lagerposition(en) nicht überein (npm run verify:commerce)',
      v_drift using errcode = 'data_corrupted';
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 2. hold_sale_item() — der Versuch, und er wirft nicht
--
-- INTERN. Kein Rollen-Wächter und kein EXECUTE für irgendeine Rolle, genau
-- wie `apply_inventory_movement` (0003): aufgerufen wird sie ausschließlich
-- aus `security definer`-Funktionen, die ihrerseits gated sind.
--
-- WARUM SIE EINEN GRUND ZURÜCKGIBT UND KEINE AUSNAHME WIRFT. „Kein Bestand"
-- ist eine Tatsache und keine Störung: die Verkaufsposition bleibt gültig,
-- der Verkauf bleibt anlegbar, und die Oberfläche sagt es dem Betreiber.
-- Würde hier geworfen, müsste jeder Aufrufer — die Anlage eines Verkaufs mit
-- zwanzig Positionen eingeschlossen — jede einzelne Ausnahme abfangen, und
-- ein `exception when others` verschluckt irgendwann genau das, was laut
-- werden soll. `seller_hold_sale_item` in Abschnitt 4 setzt die Ablehnungen
-- davor, dort wo ein Mensch klickt.
--
-- EINE AUSNAHME GIBT ES TROTZDEM: `no_data_found`, wenn die Position nicht
-- existiert. Das ist ein Programmfehler des Aufrufers und keine Lage.
-- ---------------------------------------------------------------------------

create or replace function public.hold_sale_item(p_item_id bigint)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_item         public.sale_items;
  v_sale         public.sales;
  v_inventory_id bigint;
begin
  -- 1. Die Position, gesperrt. Jede Entscheidung unten liest diese Zeile.
  select * into v_item from public.sale_items where id = p_item_id for update;
  if not found then
    raise exception 'no such sale item' using errcode = 'no_data_found';
  end if;

  /*
   * 2. DIE GRÜNDE, IN FESTER REIHENFOLGE.
   *
   * Eine Position kann mehrere erfüllen; die erste zutreffende Zeile gewinnt,
   * damit dieselbe Lage immer denselben Grund nennt. Die Retourengründe
   * stehen oben, weil sie die Aussage sind, die der Betreiber sehen muss —
   * dieselbe Rangfolge, die `0111` für seine übersprungenen Positionen
   * braucht.
   */
  if v_item.sky_id is null then
    return 'not_a_figure';
  end if;
  -- LOOSE ONLY. Gefragt, nicht behauptet: dieselbe Funktion wie in 0028/0108.
  if v_item.condition is distinct from public.v1_sale_condition() then
    return 'not_loose';
  end if;
  if v_item.return_movement_id is not null then
    return 'return_already_restocked';
  end if;
  if v_item.returned_at is not null then
    return 'returned';
  end if;
  if v_item.return_announced_at is not null then
    return 'return_announced';
  end if;
  if v_item.movement_id is not null then
    return 'already_booked';
  end if;
  if v_item.settled_at is not null then
    return 'settled';
  end if;
  if v_item.not_shipped_at is not null then
    return 'not_shipped';
  end if;

  select * into v_sale from public.sales where id = v_item.sale_id;
  if v_sale.order_id is not null then
    -- Commerce hält den Bestand einer Bestellung selbst, über reserve_for_order.
    return 'internal_sale';
  end if;
  if v_sale.cancelled_at is not null then
    return 'cancelled';
  end if;
  if v_sale.source = 'excel_order_2026' and v_sale.stock_released_at is null then
    -- Gefrorene Historie bewegt niemals Bestand, in keiner Richtung.
    return 'historical';
  end if;

  /*
   * 3. SCHON GEHALTEN?
   *
   * Nicht nur Höflichkeit: `order_reservations_one_active_hold_per_item` ist
   * der Boden darunter, und ein zweiter Hold würde dort mit `23505` enden.
   * Hier wird daraus eine Antwort statt eines Fehlers.
   */
  if exists (
    select 1 from public.order_reservations r
     where r.sale_item_id = p_item_id and r.state = 'active'
  ) then
    return 'already_held';
  end if;

  /*
   * 4. DIE LAGERPOSITION, GESPERRT BEVOR ENTSCHIEDEN WIRD.
   *
   * `for update` hier und die geführte WHERE-Klausel unten sind zwei Hälften
   * derselben Sache: zwischen „ist frei" und „ist meins" darf kein Fenster
   * liegen, durch das ein Checkout oder ein zweiter externer Verkauf greift.
   */
  select i.id into v_inventory_id
    from public.shop_inventory i
   where i.sky_id = v_item.sky_id
     and i.condition = public.v1_sale_condition()
   for update;
  if v_inventory_id is null then
    return 'no_inventory';
  end if;

  /*
   * 5. DER WÄCHTER IST DIE WHERE-KLAUSEL, nicht ein vorangestelltes SELECT.
   *
   * `quantity - reserved >= 1` — dieselbe Zeile, mit der `reserve_for_order`
   * seit `0010` für den Shop reserviert. Greift sie nicht, entsteht kein
   * Hold, keine Zeile, keine Bestandsänderung. Erfunden wird nichts, und
   * `shop_inventory_reserved_within_quantity` ist der Boden darunter.
   */
  update public.shop_inventory
     set reserved = reserved + 1
   where id = v_inventory_id
     and quantity - reserved >= 1;

  if not found then
    return 'no_stock';
  end if;

  -- Kein `expires_at`: ein externer Hold läuft nicht ab, und
  -- `order_reservations_sale_hold_never_expires` erzwingt das.
  insert into public.order_reservations (sale_item_id, inventory_id, quantity, expires_at)
  values (p_item_id, v_inventory_id, 1, null);

  return 'held';
end;
$$;

comment on function public.hold_sale_item(bigint) is
  'Tries to hold one loose unit for one external sale position (0110). Returns a stable reason instead of raising, because "no stock" is a fact and not a fault: held, already_held, no_stock, no_inventory, not_a_figure, not_loose, already_booked, settled, not_shipped, return_announced, returned, return_already_restocked, internal_sale, historical, cancelled. Raises only no_data_found for an item that does not exist. Internal: no role holds EXECUTE — call it through seller_hold_sale_item() or one of the seller_*_sale_item functions.';

revoke all on function public.hold_sale_item(bigint)
  from public, anon, authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 3. release_sale_item_hold() — Bestand zurück, keine Bewegung
--
-- INTERN, wie Abschnitt 2. Dieselbe Form wie `release_order_reservations`
-- (0010), bis auf den Eigentümer: Zustandswechsel und `reserved` in einer
-- Transaktion, und ein unmöglicher Wert wird laut, nicht geklemmt.
--
-- IDEMPOTENT durch den Zustand. Ein zweiter Aufruf findet keinen aktiven
-- Hold und gibt `no_hold` zurück, ohne `reserved` ein zweites Mal zu senken.
-- Gewinnt ein paralleler Aufruf den Zustandswechsel, verliert dieser ihn und
-- gibt ebenfalls `no_hold` — der Bestand wird genau einmal zurückgegeben.
--
-- NIE EINE BEWEGUNG. Freigeben heißt, dass die Ware im Regal bleibt;
-- `inventory_movements` hat dazu nichts zu sagen.
-- ---------------------------------------------------------------------------

create or replace function public.release_sale_item_hold(p_item_id bigint)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_hold_id  bigint;
  v_inv_id   bigint;
  v_quantity integer;
begin
  select r.id, r.inventory_id, r.quantity
    into v_hold_id, v_inv_id, v_quantity
    from public.order_reservations r
   where r.sale_item_id = p_item_id
     and r.state = 'active'
   for update;

  if v_hold_id is null then
    return 'no_hold';
  end if;

  -- Den Anspruch zuerst holen. Wer diesen UPDATE verliert, tut nichts.
  update public.order_reservations
     set state = 'released', released_at = now()
   where id = v_hold_id
     and state = 'active';

  if not found then
    return 'no_hold';
  end if;

  update public.shop_inventory
     set reserved = reserved - v_quantity
   where id = v_inv_id
     and reserved >= v_quantity;

  if not found then
    /*
     * Laut, nicht nachsichtig — wortgleich mit `0010`. Ein gültiger aktiver
     * Hold bedeutet, dass `reserved` mindestens seine Menge ist; ist es das
     * nicht, sind Journal und Zähler schon auseinander, und ein Klemmen auf
     * Null würde das für immer verstecken.
     */
    raise exception
      'reserved on position % is below the hold being released (%)',
      v_inv_id, v_quantity
      using errcode = 'data_corrupted';
  end if;

  return 'released';
end;
$$;

comment on function public.release_sale_item_hold(bigint) is
  'Releases the active external hold on one sale position (0110): state becomes released, released_at is set, shop_inventory.reserved goes down by the held quantity, and no inventory movement is written. Returns released or no_hold. Idempotent: a second call finds nothing and lowers nothing. Internal — no role holds EXECUTE.';

revoke all on function public.release_sale_item_hold(bigint)
  from public, anon, authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 3b. convert_sale_item_hold() — der Hold wird verbraucht
--
-- INTERN, wie die beiden davor. Sie ist die DRITTE und letzte Stelle, an der
-- ein External Hold `shop_inventory.reserved` anfasst — halten, freigeben,
-- verbrauchen —, genau wie `reserve_for_order`,
-- `release_order_reservations` und `convert_order_reservations` die drei für
-- den Checkout sind. Drei Stellen, dreimal dieselbe geführte WHERE-Klausel.
--
-- WARUM SIE EXISTIERT UND NICHT IN `seller_book_sale_item` STEHT. Sie stand
-- dort, und ein Test aus `0073` hat das zurückgewiesen — zu Recht:
-- „leaves reservation-awareness to the one place that already has it".
-- Reservierungsarithmetik in der Buchungsfunktion wäre eine zweite Stelle,
-- an der jemand `reserved` rechnet, und damit genau die parallele
-- Bestandswahrheit, die es nicht geben darf. `seller_book_sale_item` ruft
-- eine Funktion und kennt die Zahl nicht.
--
-- SIE SCHREIBT KEINE `movement_id`. Die Bewegung existiert in diesem Moment
-- noch nicht — der Hold MUSS vor dem Buchen gelöst sein, sonst stolpert der
-- Wächter in `apply_inventory_movement` über ihn (`0025`). Die Verknüpfung
-- setzt der Aufrufer danach; `order_reservations_movement_only_when_converted`
-- erlaubt sie, weil der Zustand hier schon `converted` ist.
--
-- Gibt die Hold-Id zurück, oder NULL, wenn die Position keinen hielt — und
-- NULL ist kein Fehler: eine Position ohne Hold ist buchbar, und genau das
-- lässt eine teilweise reservierte Order versenden.
-- ---------------------------------------------------------------------------

create or replace function public.convert_sale_item_hold(p_item_id bigint)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_hold_id  bigint;
  v_inv_id   bigint;
  v_quantity integer;
begin
  select r.id, r.inventory_id, r.quantity
    into v_hold_id, v_inv_id, v_quantity
    from public.order_reservations r
   where r.sale_item_id = p_item_id
     and r.state = 'active'
   for update;

  if v_hold_id is null then
    return null;
  end if;

  -- Den Anspruch zuerst. Wer diesen UPDATE verliert, verbraucht nichts —
  -- dieselbe Klaue wie in `convert_order_reservations` (0025).
  update public.order_reservations
     set state = 'converted', converted_at = now()
   where id = v_hold_id
     and state = 'active';

  if not found then
    raise exception 'the hold on this position changed state concurrently'
      using errcode = 'serialization_failure';
  end if;

  update public.shop_inventory
     set reserved = reserved - v_quantity
   where id = v_inv_id
     and reserved >= v_quantity;

  if not found then
    raise exception
      'reserved on position % is below the hold being converted (%)',
      v_inv_id, v_quantity
      using errcode = 'data_corrupted';
  end if;

  return v_hold_id;
end;
$$;

comment on function public.convert_sale_item_hold(bigint) is
  'Consumes the active external hold on one sale position (0110): claims the state as converted, then lowers shop_inventory.reserved by the held quantity. Returns the hold id, or NULL when the position held nothing — which is not an error: a position without a hold is still bookable, and that is what lets a partly held order ship. Writes no movement and no movement_id; the hold must be released BEFORE the booking, or the ledger guard trips on it (0025). Internal — no role holds EXECUTE.';

revoke all on function public.convert_sale_item_hold(bigint)
  from public, anon, authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 4. seller_hold_sale_item() — der Weg für einen Klick
--
-- Der Wächter und die Ablehnungen stehen hier, nicht in Abschnitt 2: ein
-- Mensch, der „Reservieren" drückt, soll einen Satz bekommen, wenn er etwas
-- verlangt, was nie gehen wird — ein interner Verkauf, gefrorene Historie,
-- eine stornierte Order. Was nur JETZT nicht geht, kommt als Grund zurück.
--
-- Dieselbe Trennung, die `record_inventory_movement` und
-- `apply_inventory_movement` seit `0003` haben.
-- ---------------------------------------------------------------------------

create or replace function public.seller_hold_sale_item(p_item_id bigint)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_item public.sale_items;
  v_sale public.sales;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;

  select * into v_item from public.sale_items where id = p_item_id;
  if not found then
    raise exception 'no such sale item' using errcode = 'no_data_found';
  end if;
  select * into v_sale from public.sales where id = v_item.sale_id;

  -- Was gar nicht gehalten werden darf: benannt abgelehnt.
  if v_sale.order_id is not null then
    raise exception 'an order holds its own stock' using errcode = 'restrict_violation';
  end if;
  if v_sale.source = 'excel_order_2026' and v_sale.stock_released_at is null then
    raise exception 'this historical sale has not been released'
      using errcode = 'restrict_violation';
  end if;
  if v_sale.cancelled_at is not null then
    raise exception 'this order was cancelled; nothing is held for it'
      using errcode = 'restrict_violation';
  end if;

  -- Alles Übrige ist eine Lage und kommt als Grund zurück.
  return public.hold_sale_item(p_item_id);
end;
$$;

comment on function public.seller_hold_sale_item(bigint) is
  'Holds one loose unit for one external sale position, for a signed-in shop operator (0110). Refuses with restrict_violation what may never be held — an internal sale, a frozen workbook sale, a cancelled order — and returns a stable reason for everything else: held, already_held, no_stock, no_inventory, not_a_figure, not_loose, already_booked, settled, not_shipped, return_announced, returned, return_already_restocked. Never invents stock: the guard is the WHERE clause in hold_sale_item().';

revoke all on function public.seller_hold_sale_item(bigint) from public, anon;
grant execute on function public.seller_hold_sale_item(bigint) to authenticated;


create or replace function public.seller_release_sale_item_hold(p_item_id bigint)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_item public.sale_items;
  v_sale public.sales;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;

  select * into v_item from public.sale_items where id = p_item_id;
  if not found then
    raise exception 'no such sale item' using errcode = 'no_data_found';
  end if;
  select * into v_sale from public.sales where id = v_item.sale_id;

  /*
   * Eine Bestellung gibt ihren Bestand über `release_order_reservations`
   * frei, nie hier. Die Funktion könnte dort ohnehin nichts finden — ein
   * Order-Hold trägt kein `sale_item_id` —, aber eine stille Null wäre eine
   * schlechtere Antwort als eine benannte Ablehnung.
   */
  if v_sale.order_id is not null then
    raise exception 'an order releases its own stock' using errcode = 'restrict_violation';
  end if;

  return public.release_sale_item_hold(p_item_id);
end;
$$;

comment on function public.seller_release_sale_item_hold(bigint) is
  'Releases the external hold on one sale position for a signed-in shop operator (0110). Returns released or no_hold. Refuses an internal sale, whose stock is released by release_order_reservations(). Writes no inventory movement: the goods stay on the shelf.';

revoke all on function public.seller_release_sale_item_hold(bigint) from public, anon;
grant execute on function public.seller_release_sale_item_hold(bigint) to authenticated;


-- ---------------------------------------------------------------------------
-- 5. seller_add_sale_item — eine neue Position hält sofort
--
-- SIGNATUR UNVERÄNDERT: (bigint, text, text, text) → bigint. Rumpf aus
-- `0059`, mit einem Aufruf am Ende.
--
-- HIER ENTSTEHT AUCH DER HOLD EINER NEUEN BESTELLUNG.
-- `seller_create_sale_with_details` legt ihre Positionen durch genau diese
-- Funktion an, also reserviert ein neu angelegter externer Verkauf von
-- selbst — ohne dass die Anlagefunktion ihre Signatur ändern müsste, die
-- laut Plan erst mit `0111` wächst.
--
-- Der Rückgabewert bleibt die `sale_items.id`. Der Grund des Hold-Versuchs
-- wird nicht hochgereicht: die Anlage darf an fehlendem Bestand nicht
-- scheitern, und der Zustand jeder Position ist über `seller_sale`
-- rekonstruierbar — Abschnitt 11 gibt `held` und `stock_available` mit aus.
-- ---------------------------------------------------------------------------

create or replace function public.seller_add_sale_item(
  p_sale_id bigint, p_sky_id text default null,
  p_raw_name text default null, p_condition text default 'loose'
)
returns bigint
language plpgsql volatile security definer set search_path = ''
as $$
declare v_id bigint; v_pos integer; v_order bigint; v_source text;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;
  select order_id, source into v_order, v_source from public.sales where id = p_sale_id;
  if not found then raise exception 'no such sale' using errcode = 'no_data_found'; end if;
  if v_order is not null then
    raise exception 'an internal sale takes its items from the order' using errcode = 'restrict_violation';
  end if;
  select coalesce(max(position), 0) + 1 into v_pos from public.sale_items where sale_id = p_sale_id;
  insert into public.sale_items (sale_id, position, sky_id, raw_name, condition)
  values (p_sale_id, v_pos, nullif(btrim(coalesce(p_sky_id,'')),''),
          nullif(btrim(coalesce(p_raw_name,'')),''), coalesce(nullif(btrim(p_condition),''),'loose'))
  returning id into v_id;

  /*
   * Der Versuch, und nur der Versuch (0110). Scheitert er an fehlendem
   * Bestand, bleibt die Position bestehen und bekommt keinen Hold — eine
   * teilweise reservierte externe Order ist ein zulässiger Zustand.
   */
  perform public.hold_sale_item(v_id);

  return v_id;
end;
$$;

comment on function public.seller_add_sale_item(bigint, text, text, text) is
  'Adds one physical position to an external sale and immediately tries to hold a loose unit for it (0110). The hold is an attempt: a position without free stock is created all the same and simply carries no hold. Refuses an internal sale, whose items are the order lines.';


-- ---------------------------------------------------------------------------
-- 6. seller_create_sale_with_details — nur die Sperrordnung
--
-- SIGNATUR UNVERÄNDERT, fünfzehn Parameter wie in `0065`. `p_status` kommt
-- mit `0111`, und `0110` zieht das nicht vor.
--
-- WARUM SIE HIER TROTZDEM AUFTAUCHT. Sie legt N Positionen an, und jede
-- davon sperrt über `hold_sale_item` eine Lagerzeile — in der Reihenfolge
-- der Nutzlast. Zwei gleichzeitige Anlagen mit denselben Figuren in
-- verschiedener Reihenfolge könnten sich dabei verklemmen. Deshalb sperrt
-- diese Funktion ALLE betroffenen Lagerzeilen EINMAL vorweg, aufsteigend
-- nach `id` — dieselbe Ordnung, die `reserve_for_order` (0010) und
-- `convert_order_reservations` (0025) nehmen: „the same order every caller
-- takes, so a sweep and a checkout cannot deadlock against each other".
--
-- Danach sind die späteren `for update` derselben Transaktion wiedereintretend
-- und kosten nichts.
--
-- Sonst ist der Rumpf der aus `0065`, Zeile für Zeile.
-- ---------------------------------------------------------------------------

create or replace function public.seller_create_sale_with_details(
  p_channel          text,
  p_sold_at          date    default null,
  p_country          text    default null,
  p_external_ref     text    default null,
  p_buyer_ref        text    default null,
  p_note             text    default null,
  p_is_test          boolean default false,
  p_items_subtotal   numeric default 0,
  p_shipping_charged numeric default 0,
  p_discount_amount  numeric default 0,
  p_items            jsonb   default '[]'::jsonb,
  p_fees             jsonb   default '[]'::jsonb,
  p_adjustments      jsonb   default '[]'::jsonb,
  p_payout_amount    numeric default null,
  p_payout_ref       text    default null
)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id      bigint;
  v_element jsonb;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;

  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_fees, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_adjustments, '[]'::jsonb)) <> 'array'
  then
    raise exception 'items, fees and adjustments must each be a json array'
      using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) > 200
     or jsonb_array_length(coalesce(p_fees, '[]'::jsonb)) > 20
     or jsonb_array_length(coalesce(p_adjustments, '[]'::jsonb)) > 20
  then
    raise exception 'too many items, fees or adjustments in one sale'
      using errcode = 'program_limit_exceeded';
  end if;

  /*
   * DIE SPERRORDNUNG, EINMAL UND AUFSTEIGEND (0110). Siehe den Kopf dieses
   * Abschnitts. Rein lesend — `for update` nimmt die Zeilensperren, ohne
   * etwas zu verändern.
   */
  perform 1
     from public.shop_inventory i
    where i.condition = public.v1_sale_condition()
      and i.sky_id in (
        select nullif(btrim(coalesce(e->>'sky_id', '')), '')
          from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e)
    order by i.id
      for update;

  v_id := public.seller_create_sale(p_channel, p_sold_at, p_country,
                                    p_external_ref, p_buyer_ref, p_note, p_is_test);

  update public.sales
     set items_subtotal   = coalesce(p_items_subtotal, 0),
         shipping_charged = coalesce(p_shipping_charged, 0),
         discount_amount  = coalesce(p_discount_amount, 0)
   where id = v_id;

  for v_element in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    if jsonb_typeof(v_element) <> 'object' then
      raise exception 'every item must be a json object' using errcode = 'invalid_parameter_value';
    end if;
    -- Hält mit (0110): der Hold entsteht in seller_add_sale_item.
    perform public.seller_add_sale_item(
      v_id,
      nullif(btrim(coalesce(v_element->>'sky_id', '')), ''),
      nullif(btrim(coalesce(v_element->>'raw_name', '')), ''),
      coalesce(nullif(btrim(coalesce(v_element->>'condition', '')), ''), 'loose')
    );
  end loop;

  for v_element in select * from jsonb_array_elements(coalesce(p_fees, '[]'::jsonb)) loop
    if jsonb_typeof(v_element) <> 'object' then
      raise exception 'every fee must be a json object' using errcode = 'invalid_parameter_value';
    end if;
    perform public.seller_add_sale_fee(
      v_id,
      v_element->>'kind',
      (v_element->>'amount')::numeric,
      v_element->>'settled_by',
      nullif(btrim(coalesce(v_element->>'label', '')), ''),
      nullif(btrim(coalesce(v_element->>'note', '')), '')
    );
  end loop;

  for v_element in select * from jsonb_array_elements(coalesce(p_adjustments, '[]'::jsonb)) loop
    if jsonb_typeof(v_element) <> 'object' then
      raise exception 'every adjustment must be a json object'
        using errcode = 'invalid_parameter_value';
    end if;
    perform public.seller_add_settlement_adjustment(
      v_id,
      p_channel,
      (v_element->>'amount')::numeric,
      nullif(btrim(coalesce(v_element->>'reason', '')), ''),
      nullif(btrim(coalesce(v_element->>'external_ref', '')), ''),
      nullif(btrim(coalesce(v_element->>'note', '')), ''),
      (nullif(btrim(coalesce(v_element->>'occurred_at', '')), ''))::date
    );
  end loop;

  if p_payout_amount is not null then
    perform public.seller_set_sale_payout(v_id, p_payout_amount, p_payout_ref, null, null);
  end if;

  return v_id;
end;
$$;


-- ---------------------------------------------------------------------------
-- 7. seller_book_sale_item — der Hold wird verbraucht
--
-- SIGNATUR UNVERÄNDERT: (bigint) → bigint. Rumpf aus `0073`, mit dem
-- Verbrauch des Holds dazwischen.
--
-- DIE REIHENFOLGE. Anspruch holen → Hold lösen → buchen → Bewegung an den
-- Hold schreiben. Jeder Schritt hat einen Grund:
--
--   Anspruch zuerst   `state = 'converted' where state = 'active'`. Wer
--                     diesen UPDATE verliert, bucht nicht — dieselbe Klaue
--                     wie in `convert_order_reservations` (0025).
--   Hold lösen        VOR dem Buchen. Der Wächter in
--                     `apply_inventory_movement` ist
--                     `quantity + p_delta >= reserved` und würde sonst über
--                     den eigenen Hold stolpern.
--   Bewegung danach   `order_reservations_movement_only_when_converted`
--                     erlaubt eine `movement_id` nur im Zustand `converted`,
--                     also wird sie nach dem Zustandswechsel geschrieben.
--
-- IDEMPOTENT wie bisher: eine Position mit `movement_id` kehrt sofort zurück,
-- unter `for update`, ohne den Hold anzufassen. Zweimal buchen bucht einmal.
--
-- EINE POSITION OHNE HOLD IST WEITER BUCHBAR. Das ist die Bedingung dafür,
-- dass eine teilweise reservierte Order verschickt werden kann: ohne Hold
-- entscheidet allein der Wächter im Lagerjournal, genau wie vor `0110`.
-- ---------------------------------------------------------------------------

create or replace function public.seller_book_sale_item(p_item_id bigint)
returns bigint
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_item    record;
  v_sale    record;
  v_mid     bigint;
  v_price   numeric;
  v_hold_id bigint;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;

  select * into v_item from public.sale_items where id = p_item_id for update;
  if not found then raise exception 'no such sale item' using errcode = 'no_data_found'; end if;
  if v_item.movement_id is not null then return v_item.movement_id; end if;  -- already booked

  select * into v_sale from public.sales where id = v_item.sale_id;

  if v_sale.source = 'excel_order_2026' and v_sale.stock_released_at is null then
    raise exception 'historical sales never move stock' using errcode = 'restrict_violation';
  end if;
  if v_sale.cancelled_at is not null then
    raise exception 'this order was cancelled; nothing left the shelf'
      using errcode = 'restrict_violation';
  end if;
  if v_sale.order_id is not null then
    raise exception 'the order already moved this stock' using errcode = 'restrict_violation';
  end if;
  if v_item.settled_at is not null then
    raise exception 'this position is already closed without a movement'
      using errcode = 'restrict_violation';
  end if;
  if v_item.sky_id is null then
    raise exception 'this item is not a catalog figure and has no stock position'
      using errcode = 'check_violation';
  end if;
  if v_item.legacy_stock_flag = '-' then
    raise exception 'the workbook records this copy as not taken from stock; close it instead'
      using errcode = 'restrict_violation';
  end if;

  /*
   * DER HOLD, FALLS ES EINEN GIBT (0110).
   *
   * Eine Funktion, keine Arithmetik: `convert_sale_item_hold` holt den
   * Anspruch und gibt den Bestand frei, und zwar VOR der Buchung. Diese
   * Funktion kennt `reserved` nicht und soll es nicht kennen — der Wächter
   * sitzt in `apply_inventory_movement`, und eine zweite Rechnung hier wäre
   * eine schwächere Kopie einer Regel, die hält.
   */
  v_hold_id := public.convert_sale_item_hold(p_item_id);

  -- Raises if the shelf cannot cover it without eating a reservation.
  v_mid := public.record_inventory_movement(
    v_item.sky_id, v_item.condition, -1, 'sale_external',
    null, null, 'Orderbuch: externer Verkauf #' || v_sale.id);

  if v_hold_id is not null then
    update public.order_reservations set movement_id = v_mid where id = v_hold_id;
  end if;

  select market_price into v_price from public.skylanders where sky_id = v_item.sky_id;

  update public.sale_items
     set movement_id = v_mid,
         market_price_snapshot = v_price,
         market_price_snapshot_at = now(),
         updated_at = now()
   where id = p_item_id;

  update public.sales
     set buy_in_factor_snapshot = coalesce(buy_in_factor_snapshot, public.orderbook_global_factor()),
         updated_at = now(), updated_by = (select auth.uid())
   where id = v_sale.id;

  return v_mid;
end;
$$;

comment on function public.seller_book_sale_item(bigint) is
  'Books a stock movement for one external sale position. Records auth.uid() as the actor through record_inventory_movement(). Since 0110 it consumes the position''s external hold first — claim the state, lower reserved, then book — so the ledger guard never trips on the hold it is about to release. A position without a hold books exactly as before, which is what lets a partly held order ship. Idempotent: a second call returns the same movement and moves nothing.';


-- ---------------------------------------------------------------------------
-- 8. seller_unbook_sale_item — und sie hält wieder
--
-- SIGNATUR UNVERÄNDERT: (bigint) → bigint. Drei Änderungen am Rumpf aus
-- `0059`.
--
--   1. GEFRORENE HISTORIE BEWEGT NIEMALS BESTAND, IN KEINER RICHTUNG.
--      `seller_book_sale_item` lehnt sie seit `0073` ab, diese Funktion bis
--      jetzt nicht. Wortgleiche Sperre, damit die Symmetrie am Text
--      ablesbar ist.
--
--   2. EINE ANGEKÜNDIGTE RETOURE BLOCKIERT DIE RÜCKNAHME.
--      `sale_items_return_needs_a_movement` (0074) verlangt bei
--      `return_announced_at` eine `movement_id`. Ohne diese Sperre endete
--      der Weg an jenem CHECK mit einem nackten `23514` statt an einem Satz,
--      der sagt, was zu tun ist. Die Datenbankfunktion schützt die
--      Invariante selbst, nicht erst die Oberfläche.
--
--   3. DANACH ENTSTEHT EIN NEUER HOLD, kein reaktivierter.
--      Der alte `converted`-Hold bleibt mit seiner `movement_id` als
--      Historie stehen; `order_reservations_one_active_hold_per_item` ist
--      partiell und erlaubt das. Ausnahme: eine stornierte Order hält
--      nichts. Das steuert der Zustand und kein Parameter — `0111` setzt
--      `cancelled_at`, bevor es diese Funktion in seinem Storno-Lauf ruft.
-- ---------------------------------------------------------------------------

create or replace function public.seller_unbook_sale_item(p_item_id bigint)
returns bigint
language plpgsql volatile security definer set search_path = ''
as $$
declare v_item record; v_sale record; v_mid bigint;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;
  select * into v_item from public.sale_items where id = p_item_id for update;
  if not found then raise exception 'no such sale item' using errcode = 'no_data_found'; end if;
  if v_item.movement_id is null then return null; end if;           -- nothing to reverse

  select * into v_sale from public.sales where id = v_item.sale_id;

  -- 1. Gefrorene Historie bewegt niemals Bestand (0110).
  if v_sale.source = 'excel_order_2026' and v_sale.stock_released_at is null then
    raise exception 'historical sales never move stock' using errcode = 'restrict_violation';
  end if;

  -- 2. Eine angekündigte Retoure zuerst zurücknehmen (0110).
  if v_item.return_announced_at is not null then
    raise exception 'this return is on its way; take the announcement back first'
      using errcode = 'restrict_violation';
  end if;

  if v_item.return_movement_id is not null then
    raise exception 'this item was already restocked as a return' using errcode = 'restrict_violation';
  end if;

  v_mid := public.record_inventory_movement(
    v_item.sky_id, v_item.condition, 1, 'correction',
    null, null, 'Orderbuch: Ausbuchen zurückgenommen, Position ' || p_item_id);

  update public.sale_items
     set movement_id = null, market_price_snapshot = null,
         market_price_snapshot_at = null, updated_at = now()
   where id = p_item_id;

  -- 3. Ein NEUER Hold, solange die Order nicht storniert ist (0110).
  if v_sale.cancelled_at is null then
    perform public.hold_sale_item(p_item_id);
  end if;

  return v_mid;
end;
$$;

comment on function public.seller_unbook_sale_item(bigint) is
  'Takes one external booking back: a +1 correction through the ledger, the movement link cleared, and since 0110 a NEW active hold if the sale is still open — the old converted hold keeps its movement id as history. Refuses a frozen workbook sale (history moves no stock in either direction), a position whose return has been announced, and one already restocked as a return. Idempotent: a position without a movement returns null.';


-- ---------------------------------------------------------------------------
-- 9. Die beiden Endungen ohne Bewegung geben den Hold frei
--
-- `Erledigt` und `Nicht verschickt` heißen beide: diese Position verlässt das
-- Regal nicht. Dann darf sie auch nichts mehr halten — sonst stünde Bestand
-- für einen Vorgang reserviert, der zu Ende ist.
--
-- Die Rücknahme (`false`) versucht umgekehrt, wieder zu halten. Gelingt es
-- nicht, bleibt die Position ohne Hold und sagt es.
--
-- Signaturen unverändert: (bigint, boolean) → void. Rümpfe aus `0073`/`0074`.
-- ---------------------------------------------------------------------------

create or replace function public.seller_settle_sale_item(
  p_item_id bigint,
  p_settled boolean default true
)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare v_item record; v_sale record;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;

  select * into v_item from public.sale_items where id = p_item_id for update;
  if not found then raise exception 'no such sale item' using errcode = 'no_data_found'; end if;

  if not p_settled then
    update public.sale_items set settled_at = null, updated_at = now() where id = p_item_id;
    -- Wieder offen, also wieder haltbar (0110).
    perform public.hold_sale_item(p_item_id);
    return;
  end if;

  if v_item.settled_at is not null then return; end if;   -- idempotent

  if v_item.movement_id is not null then
    raise exception 'this position left the shelf; reverse the booking first'
      using errcode = 'restrict_violation';
  end if;

  select * into v_sale from public.sales where id = v_item.sale_id;
  if v_sale.order_id is not null then
    raise exception 'an order''s lines are owned by commerce' using errcode = 'restrict_violation';
  end if;
  if v_sale.source = 'excel_order_2026' and v_sale.stock_released_at is null then
    raise exception 'this historical sale has not been released' using errcode = 'restrict_violation';
  end if;

  if v_item.sky_id is not null and v_item.legacy_stock_flag is distinct from '-' then
    raise exception 'a catalog figure leaves stock by being booked, never by being closed'
      using errcode = 'check_violation';
  end if;

  -- Beendet heißt: hält nichts mehr (0110).
  perform public.release_sale_item_hold(p_item_id);

  update public.sale_items set settled_at = now(), updated_at = now() where id = p_item_id;
end;
$$;


create or replace function public.seller_set_sale_item_not_shipped(
  p_item_id bigint,
  p_not_shipped boolean default true
)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare v_item record; v_sale record;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;

  select * into v_item from public.sale_items where id = p_item_id for update;
  if not found then raise exception 'no such sale item' using errcode = 'no_data_found'; end if;

  if not p_not_shipped then
    update public.sale_items set not_shipped_at = null, updated_at = now() where id = p_item_id;
    -- Wieder offen, also wieder haltbar (0110).
    perform public.hold_sale_item(p_item_id);
    return;
  end if;

  if v_item.not_shipped_at is not null then return; end if;   -- idempotent

  if v_item.movement_id is not null then
    raise exception 'this position left the shelf; reverse the booking first'
      using errcode = 'restrict_violation';
  end if;
  if v_item.settled_at is not null then
    raise exception 'this position is already closed' using errcode = 'restrict_violation';
  end if;

  select * into v_sale from public.sales where id = v_item.sale_id;
  if v_sale.order_id is not null then
    raise exception 'an order''s lines are owned by commerce' using errcode = 'restrict_violation';
  end if;
  if v_sale.source = 'excel_order_2026' and v_sale.stock_released_at is null then
    raise exception 'this historical sale has not been released' using errcode = 'restrict_violation';
  end if;

  -- Die Ware blieb im Regal, also hält sie nichts mehr (0110).
  perform public.release_sale_item_hold(p_item_id);

  update public.sale_items set not_shipped_at = now(), updated_at = now() where id = p_item_id;
end;
$$;


-- ---------------------------------------------------------------------------
-- 10. Löschen gibt frei, bevor es löscht
--
-- `0109` hat `reservations_deny_delete` genau eine Ausnahme beigebracht: ein
-- EXTERNER Hold im Zustand `released` ohne Bewegung verschwindet mit seiner
-- Position. Ein `active` Hold tut das nicht — und genau darum muss er vorher
-- freigegeben werden, sonst scheitert der Cascade am Trigger und `reserved`
-- bliebe oben.
--
-- Beide Funktionen lehnen gebuchte Positionen ohnehin ab, ein zu löschender
-- Hold ist also nie `converted`.
--
-- Signaturen unverändert: (bigint) → void. Rümpfe aus `0065` und `0059`.
-- ---------------------------------------------------------------------------

create or replace function public.seller_remove_sale_item(p_item_id bigint)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_item record;
  v_sale record;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;

  select * into v_item from public.sale_items where id = p_item_id for update;
  if not found then
    raise exception 'no such sale item' using errcode = 'no_data_found';
  end if;

  if v_item.movement_id is not null or v_item.return_movement_id is not null then
    raise exception 'this item is booked out; reverse the stock movement before removing it'
      using errcode = 'restrict_violation';
  end if;

  select * into v_sale from public.sales where id = v_item.sale_id;

  if v_sale.order_id is not null then
    raise exception 'an internal sale takes its items from the order'
      using errcode = 'restrict_violation';
  end if;

  if v_sale.source = 'excel_order_2026'
     or v_item.source_row is not null
     or v_item.legacy_stock_flag is not null
     or v_item.legacy_shipped_flag is not null
  then
    raise exception 'this item came from the legacy workbook; its provenance is not removable'
      using errcode = 'restrict_violation';
  end if;

  -- Erst freigeben, dann löschen (0110). Der Cascade nimmt die freigegebene
  -- Hold-Zeile mit; eine aktive hätte der Trigger abgelehnt.
  perform public.release_sale_item_hold(p_item_id);

  delete from public.sale_items where id = p_item_id;

  perform public.orderbook_log(v_item.sale_id, 'sale_item', p_item_id, 'delete', null, null, null);
  perform public.orderbook_touch_sale(v_item.sale_id);
end;
$$;


create or replace function public.seller_delete_sale(p_id bigint)
returns void language plpgsql volatile security definer set search_path = ''
as $$
declare v_booked integer; v_item bigint;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from public.sales where id = p_id and order_id is not null) then
    raise exception 'an internal sale exists because an order was paid' using errcode = 'restrict_violation';
  end if;
  select count(*) into v_booked from public.sale_items
   where sale_id = p_id and (movement_id is not null or return_movement_id is not null);
  if v_booked > 0 then
    raise exception 'this sale has % item(s) with stock movements; reverse them first', v_booked
      using errcode = 'restrict_violation';
  end if;

  /*
   * Jeden aktiven Hold freigeben, bevor der Cascade die Positionen nimmt
   * (0110). Aufsteigend nach `id`, dieselbe Ordnung wie überall sonst.
   */
  for v_item in
    select i.id from public.sale_items i where i.sale_id = p_id order by i.id
  loop
    perform public.release_sale_item_hold(v_item);
  end loop;

  delete from public.sales where id = p_id;
end;
$$;


-- ---------------------------------------------------------------------------
-- 11. seller_sale — der Hold wird sichtbar
--
-- SIGNATUR UNVERÄNDERT: (bigint) → jsonb, `stable`. Rumpf aus `0096`, mit
-- zwei Feldern mehr pro Position:
--
--   held             hält diese Position gerade Bestand?
--   stock_available  wie viel ist auf der operativen Lagerzeile frei —
--                    NULL, wenn es gar keine gibt.
--
-- Zusammen trennen sie die drei Lagen, die die Oberfläche unterscheiden muss:
-- reserviert · kein Bestand · keine Lagerposition. Die Entscheidung bleibt
-- draußen; hier stehen nur die zwei Tatsachen, aus denen sie folgt.
--
-- `available_quantity` ist die generierte Spalte aus `0003`
-- (`quantity - reserved`) — eine Definition, hier gelesen, nirgends kopiert.
-- ---------------------------------------------------------------------------

create or replace function public.seller_sale(p_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_sale record; v_out jsonb;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;
  select * into v_sale from public.sales where id = p_id;
  if not found then return null; end if;

  select jsonb_build_object(
    'sale', to_jsonb(v_sale),
    'is_test', public.sale_is_test(p_id),
    'expected_payout', public.sale_expected_payout(p_id),
    'buy_in', public.sale_buy_in(p_id),
    'order', case when v_sale.order_id is null then null else (
      select jsonb_build_object('id', o.id, 'order_number', o.order_number,
        'paid_at', o.paid_at, 'payment_status', o.payment_status,
        'fulfillment_status', o.fulfillment_status, 'shipped_at', o.shipped_at,
        'items_subtotal', o.items_subtotal, 'shipping_amount', o.shipping_amount,
        'discount_amount', o.discount_amount, 'total_amount', o.total_amount,
        'currency', o.currency,
        'commerce_mode', o.commerce_mode,
        'country', (select a.country_code from public.order_addresses a
                     where a.order_id = o.id and a.kind = 'shipping' limit 1),
        'refunded', coalesce((select sum(r.amount) from public.order_refunds r where r.order_id = o.id), 0),
        'lines', coalesce((select jsonb_agg(jsonb_build_object(
                    'id', l.id, 'sky_id', l.sky_id, 'name', coalesce(k.name, l.name_snapshot),
                    'series_code', k.series_code, 'condition', l.condition,
                    'quantity', l.quantity, 'unit_price', l.unit_price,
                    'line_total', l.line_total,
                    'cancelled', q.cancelled, 'returned', q.returned,
                    'fulfillable', q.fulfillable, 'outstanding', q.outstanding,
                    'market_price', k.market_price) order by l.id)
                  from public.order_lines l
                  cross join lateral public.order_line_quantities(l.id) q
                  left join public.skylanders k on k.sky_id = l.sky_id
                  where l.order_id = o.id), '[]'::jsonb))
      from public.orders o where o.id = v_sale.order_id) end,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
                'id', i.id, 'position', i.position, 'sky_id', i.sky_id,
                'name', coalesce(k.name, i.raw_name, i.sky_id), 'raw_name', i.raw_name,
                'series_code', k.series_code, 'condition', i.condition,
                'market_price', coalesce(i.market_price_snapshot, k.market_price),
                'price_is_frozen', i.market_price_snapshot is not null,
                'movement_id', i.movement_id, 'returned_at', i.returned_at,
                'return_movement_id', i.return_movement_id,
                'return_announced_at', i.return_announced_at,
                'settled_at', i.settled_at,
                'not_shipped_at', i.not_shipped_at,
                -- Der External Hold (0110), als zwei Tatsachen.
                'held', exists (select 1 from public.order_reservations h
                                 where h.sale_item_id = i.id and h.state = 'active'),
                'stock_available', (select v.available_quantity
                                      from public.shop_inventory v
                                     where v.sky_id = i.sky_id
                                       and v.condition = public.v1_sale_condition()),
                'legacy_stock_flag', i.legacy_stock_flag,
                'legacy_shipped_flag', i.legacy_shipped_flag,
                'source_row', i.source_row) order by i.position)
              from public.sale_items i
              left join public.skylanders k on k.sky_id = i.sky_id
              where i.sale_id = p_id), '[]'::jsonb),
    'fees', coalesce((select jsonb_agg(to_jsonb(f) order by f.id) from public.sale_fees f where f.sale_id = p_id), '[]'::jsonb),
    'refunds', coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from public.sale_refunds r where r.sale_id = p_id), '[]'::jsonb),
    'adjustments', coalesce((select jsonb_agg(to_jsonb(a) order by a.id) from public.settlement_adjustments a where a.sale_id = p_id), '[]'::jsonb)
  ) into v_out;
  return v_out;
end;
$$;


-- ---------------------------------------------------------------------------
-- 12. Nachprüfung
--
-- Die vier neuen Funktionen existieren mit genau einer Signatur, die acht
-- ersetzten ebenfalls, und kein External Hold ist entstanden.
-- ---------------------------------------------------------------------------

do $$
declare
  v_missing text[] := '{}';
  v_name    text;
  v_holds   bigint;
  v_count   bigint;
begin
  foreach v_name in array array[
    'hold_sale_item', 'release_sale_item_hold', 'convert_sale_item_hold',
    'seller_hold_sale_item', 'seller_release_sale_item_hold',
    'seller_add_sale_item', 'seller_create_sale_with_details',
    'seller_book_sale_item', 'seller_unbook_sale_item',
    'seller_settle_sale_item', 'seller_set_sale_item_not_shipped',
    'seller_remove_sale_item', 'seller_delete_sale', 'seller_sale'
  ] loop
    select count(*) into v_count
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_name;
    if v_count <> 1 then
      v_missing := v_missing || (v_name || ' hat ' || v_count || ' Overload(s), erwartet 1');
    end if;
  end loop;

  if array_length(v_missing, 1) > 0 then
    raise exception '0110 unvollständig: %', array_to_string(v_missing, ', ')
      using errcode = 'data_corrupted';
  end if;

  select count(*) into v_holds
    from public.order_reservations where sale_item_id is not null;
  if v_holds > 0 then
    raise exception '0110 hat % External Hold(s) vorgefunden; 0110 erzeugt keine', v_holds
      using errcode = 'data_corrupted';
  end if;

  raise notice '0110 vollständig: 5 neue und 9 ersetzte Funktionen, je eine Signatur — und 0 External Holds';
end $$;
