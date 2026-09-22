-- ===========================================================================
-- 0088 — die Arbeitsmappe darf bestehende Legacy-Zeilen KORRIGIEREN
--
-- WARUM DAS BISHER NICHT GING, UND WARUM EIN ZWEITER IMPORTLAUF GEFÄHRLICH IST
--
-- `import-sales.mts` und `import-orderbook.mts` sind insert-only. Sie
-- erkennen eine bereits importierte Gruppe an ihrem Fingerabdruck — und der
-- hasht die Positionszeilen samt Namen, Flags und SKY-ID mit:
--
--   canonicalSaleIdentity:     [sourceRow, rawName, stockFlag, shippedFlag, skyId]
--   canonicalPurchaseIdentity: [sourceRow, rawName, conditionFlag, bookedFlag, skyId]
--
-- Korrigiert der Betreiber eine Flag oder einen Tippfehler, ändert sich der
-- Fingerabdruck. Die Gruppe gilt dann als unbekannt und wird ein ZWEITES MAL
-- importiert. Gemessen auf Staging: 29 Verkäufe mit 223 Positionen und 4
-- Einkäufe mit 15 Positionen wären verdoppelt worden.
--
-- Diese Migration gibt dem Sync einen Weg, der korrigiert statt anzulegen.
--
-- DIE IDENTITÄT IST DIE QUELLZEILE, UND SONST NICHTS
--
-- `source_row` ist das einzige Feld, das sich nicht ändert, wenn der
-- Betreiber die Mappe pflegt. Gemessen über den gesamten Bestand:
--
--   sale_items      1 253 Zeilen, alle mit source_row, 0 Duplikate
--   purchase_items  2 114 Legacy-Zeilen, alle mit source_row, 0 Duplikate,
--                   keine von zwei Gruppen beansprucht
--                   (7 weitere gehören `manual`-Einkäufen und haben keine)
--
-- Name, Flags und SKY-ID taugen ausdrücklich NICHT als Identität: genau sie
-- werden korrigiert. Wer danach sucht, findet die Zeile nach der Korrektur
-- nicht wieder — das ist derselbe Fehler wie beim Fingerabdruck, nur später.
--
-- WAS DIESE FUNKTIONEN ANFASSEN, UND WAS NIEMALS
--
-- Sie schreiben AUSSCHLIESSLICH die vier bzw. vier Spalten, die aus der
-- Arbeitsmappe stammen. Alles andere bleibt, wo es ist:
--
--   nicht angefasst   settled_at · not_shipped_at · returned_at ·
--                     return_announced_at · movement_id · return_movement_id ·
--                     market_price_snapshot · position · created_at ·
--                     sale_fees · sale_refunds · settlement_adjustments ·
--                     orderbook_audit · jede Id und jede Relation
--
-- `settled_at` ist unser Buchungsvermerk, kein Befund über das Objekt. Eine
-- korrigierte Flag darf ihn nicht löschen — und eine Funktion, die ihn nicht
-- in ihrer UPDATE-Liste führt, kann es gar nicht erst.
--
-- KEINE LAGERWIRKUNG. Keine dieser Funktionen liest oder schreibt
-- `shop_inventory`, `inventory_movements` oder `legacy_stock_events`. Der
-- Sync der Ordnerhistorie und die Rekonstruktion des Lagers sind zwei
-- getrennte Vorgänge und bleiben es.
--
-- WER SIE AUFRUFEN DARF
--
-- Nur `service_role`, also ausschließlich serverseitiges Werkzeug. Kein
-- `authenticated`, kein `anon`, keine Oberfläche. Dasselbe Muster wie
-- `system_record_inventory_movement` (0003), `system_set_image_override`
-- (0035) und `system_settle_reconciled_legacy_item` (0081).
--
-- JEDE FUNKTION PRÜFT IHR ZIEL SELBST. Eine operative Bestellung, ein
-- manueller Einkauf oder eine Zeile ohne Quellzeile wird abgelehnt, nicht
-- stillschweigend übersprungen — der Aufrufer soll den Unterschied merken.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Eine Verkaufsposition korrigieren.
-- ---------------------------------------------------------------------------
create or replace function public.system_sync_legacy_sale_item(
  p_item_id       bigint,
  p_raw_name      text,
  p_sky_id        text,
  p_stock_flag    text,
  p_shipped_flag  text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_sale public.sales%rowtype;
  v_item public.sale_items%rowtype;
begin
  select * into v_item from public.sale_items where id = p_item_id;
  if not found then
    raise exception 'sale_item % does not exist', p_item_id using errcode = 'no_data_found';
  end if;
  if v_item.source_row is null then
    raise exception 'sale_item % has no source row and is not a workbook line', p_item_id;
  end if;

  select * into v_sale from public.sales where id = v_item.sale_id;
  if v_sale.source is distinct from 'excel_order_2026' then
    raise exception 'sale % is not a workbook sale (source %)', v_sale.id, v_sale.source;
  end if;
  -- An order owns its lines through `order_lines`; a sale that belongs to one
  -- is operative history and the workbook has no say over it.
  if v_sale.order_id is not null then
    raise exception 'sale % belongs to order % and is operative', v_sale.id, v_sale.order_id;
  end if;

  update public.sale_items
     set raw_name            = p_raw_name,
         sky_id              = p_sky_id,
         legacy_stock_flag   = p_stock_flag,
         legacy_shipped_flag = p_shipped_flag,
         updated_at          = now()
   where id = p_item_id;
end;
$$;

comment on function public.system_sync_legacy_sale_item(bigint, text, text, text, text) is
  'Corrects the four workbook-owned columns of one imported sale position (0088): raw_name, sky_id and the two legacy flags. Identity is the row''s source_row, never its name or flags — those are what gets corrected. Touches nothing else: settled_at, movement ids, prices, fees, refunds, adjustments and audit rows are outside its UPDATE list and cannot be reached through it. Refuses a non-workbook sale, a sale attached to an order, and a line without a source row. service_role only.';

revoke all on function public.system_sync_legacy_sale_item(bigint, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.system_sync_legacy_sale_item(bigint, text, text, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 2. Eine Einkaufsposition korrigieren.
-- ---------------------------------------------------------------------------
create or replace function public.system_sync_legacy_purchase_item(
  p_item_id         bigint,
  p_raw_name        text,
  p_sky_id          text,
  p_condition_flag  text,
  p_booked_flag     text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_purchase public.purchases%rowtype;
  v_item     public.purchase_items%rowtype;
begin
  select * into v_item from public.purchase_items where id = p_item_id;
  if not found then
    raise exception 'purchase_item % does not exist', p_item_id using errcode = 'no_data_found';
  end if;
  if v_item.source_row is null then
    raise exception 'purchase_item % has no source row and is not a workbook line', p_item_id;
  end if;

  select * into v_purchase from public.purchases where id = v_item.purchase_id;
  if v_purchase.source is distinct from 'excel_order_2026' then
    raise exception 'purchase % is not a workbook purchase (source %)',
      v_purchase.id, v_purchase.source;
  end if;

  update public.purchase_items
     set raw_name              = p_raw_name,
         sky_id                = p_sky_id,
         legacy_condition_flag = p_condition_flag,
         legacy_booked_flag    = p_booked_flag,
         updated_at            = now()
   where id = p_item_id;
end;
$$;

comment on function public.system_sync_legacy_purchase_item(bigint, text, text, text, text) is
  'Corrects the four workbook-owned columns of one imported purchase position (0088): raw_name, sky_id, the condition marker (column C) and the booked marker (column D). Column D says whether the piece reached the inventory; a documented purchase is not automatically a shelf entry. Identity is source_row. Touches no state, no movement, no price and no cost. Refuses a manual purchase and a line without a source row. service_role only.';

revoke all on function public.system_sync_legacy_purchase_item(bigint, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.system_sync_legacy_purchase_item(bigint, text, text, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 3. Eine NEUE Position in eine bestehende Gruppe.
--
--    79 der neuen Einkaufszeilen liegen mitten in Gruppen, die es schon gibt.
--    Sie über den Gruppenimport einzuspielen hieße, die Gruppe zu verdoppeln.
-- ---------------------------------------------------------------------------
create or replace function public.system_add_legacy_purchase_item(
  p_purchase_id     bigint,
  p_position        integer,
  p_source_row      integer,
  p_raw_name        text,
  p_sky_id          text,
  p_condition_flag  text,
  p_booked_flag     text
)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_purchase public.purchases%rowtype;
  v_id       bigint;
begin
  select * into v_purchase from public.purchases where id = p_purchase_id;
  if not found then
    raise exception 'purchase % does not exist', p_purchase_id using errcode = 'no_data_found';
  end if;
  if v_purchase.source is distinct from 'excel_order_2026' then
    raise exception 'purchase % is not a workbook purchase', p_purchase_id;
  end if;
  if p_source_row is null then
    raise exception 'a workbook position must name its source row';
  end if;
  -- The source row is the identity. A second row claiming it would make the
  -- next sync ambiguous, so it is refused here rather than discovered later.
  if exists (select 1 from public.purchase_items where source_row = p_source_row) then
    raise exception 'source row % is already taken by another purchase item', p_source_row;
  end if;

  insert into public.purchase_items
    (purchase_id, position, source_row, raw_name, sky_id,
     legacy_condition_flag, legacy_booked_flag, state)
  values
    (p_purchase_id, p_position, p_source_row, p_raw_name, p_sky_id,
     p_condition_flag, p_booked_flag, 'reconciled_legacy')
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.system_add_legacy_purchase_item(bigint, integer, integer, text, text, text, text) is
  'Adds one workbook position to an EXISTING imported purchase (0088), for rows the owner inserted into a group that was imported long ago. State is reconciled_legacy like every other imported row: the current stock came from the reconciliation, never from re-playing these. Refuses a manual purchase, a missing source row and a source row another position already holds. service_role only.';

revoke all on function public.system_add_legacy_purchase_item(bigint, integer, integer, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.system_add_legacy_purchase_item(bigint, integer, integer, text, text, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 4. Dasselbe für eine Verkaufsposition.
-- ---------------------------------------------------------------------------
create or replace function public.system_add_legacy_sale_item(
  p_sale_id       bigint,
  p_position      integer,
  p_source_row    integer,
  p_raw_name      text,
  p_sky_id        text,
  p_condition     text,
  p_stock_flag    text,
  p_shipped_flag  text
)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_sale public.sales%rowtype;
  v_id   bigint;
begin
  select * into v_sale from public.sales where id = p_sale_id;
  if not found then
    raise exception 'sale % does not exist', p_sale_id using errcode = 'no_data_found';
  end if;
  if v_sale.source is distinct from 'excel_order_2026' then
    raise exception 'sale % is not a workbook sale', p_sale_id;
  end if;
  if v_sale.order_id is not null then
    raise exception 'sale % belongs to an order', p_sale_id;
  end if;
  if p_source_row is null then
    raise exception 'a workbook position must name its source row';
  end if;
  if exists (select 1 from public.sale_items where source_row = p_source_row) then
    raise exception 'source row % is already taken by another sale item', p_source_row;
  end if;

  insert into public.sale_items
    (sale_id, position, source_row, raw_name, sky_id, condition,
     legacy_stock_flag, legacy_shipped_flag)
  values
    (p_sale_id, p_position, p_source_row, p_raw_name, p_sky_id,
     coalesce(p_condition, 'loose'), p_stock_flag, p_shipped_flag)
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.system_add_legacy_sale_item(bigint, integer, integer, text, text, text, text, text) is
  'Adds one workbook position to an EXISTING imported sale (0088). Books no movement and closes nothing: settled_at stays NULL and the stock effect of an imported sale lives in the reconciliation, not here. Refuses a non-workbook sale, a sale attached to an order, a missing source row and a taken source row. service_role only.';

revoke all on function public.system_add_legacy_sale_item(bigint, integer, integer, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.system_add_legacy_sale_item(bigint, integer, integer, text, text, text, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 5. Den Fingerabdruck nachziehen.
--
--    Er beschreibt den Inhalt der Gruppe. Nach einer Korrektur beschreibt er
--    den alten Inhalt — und der nächste Lauf hielte die Gruppe wieder für
--    unbekannt. Ohne diesen Schritt ist der Sync NICHT idempotent.
--
--    Die Eindeutigkeitsindizes auf `import_fingerprint` bleiben scharf: ein
--    Wert, den eine andere Gruppe schon trägt, wird hier abgelehnt, nicht
--    von einem Constraint tief im Stack.
-- ---------------------------------------------------------------------------
create or replace function public.system_set_legacy_sale_fingerprint(
  p_sale_id     bigint,
  p_fingerprint text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_source text;
begin
  select source into v_source from public.sales where id = p_sale_id;
  if v_source is null then
    raise exception 'sale % does not exist', p_sale_id using errcode = 'no_data_found';
  end if;
  if v_source <> 'excel_order_2026' then
    raise exception 'sale % is not a workbook sale', p_sale_id;
  end if;
  if p_fingerprint is null or length(p_fingerprint) <> 64 then
    raise exception 'a fingerprint is 64 hex characters';
  end if;
  if exists (select 1 from public.sales
              where import_fingerprint = p_fingerprint and id <> p_sale_id) then
    raise exception 'fingerprint already belongs to another sale';
  end if;

  update public.sales
     set import_fingerprint = p_fingerprint, updated_at = now()
   where id = p_sale_id;
end;
$$;

comment on function public.system_set_legacy_sale_fingerprint(bigint, text) is
  'Re-stamps an imported sale''s content fingerprint after its positions were corrected (0088). Without this a second sync would not recognise the group and would import it again — the fingerprint hashes the rows, so correcting a row changes it. Refuses a value another sale already carries. service_role only.';

revoke all on function public.system_set_legacy_sale_fingerprint(bigint, text)
  from public, anon, authenticated;
grant execute on function public.system_set_legacy_sale_fingerprint(bigint, text) to service_role;


create or replace function public.system_set_legacy_purchase_fingerprint(
  p_purchase_id bigint,
  p_fingerprint text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_source text;
begin
  select source into v_source from public.purchases where id = p_purchase_id;
  if v_source is null then
    raise exception 'purchase % does not exist', p_purchase_id using errcode = 'no_data_found';
  end if;
  if v_source <> 'excel_order_2026' then
    raise exception 'purchase % is not a workbook purchase', p_purchase_id;
  end if;
  if p_fingerprint is null or length(p_fingerprint) <> 64 then
    raise exception 'a fingerprint is 64 hex characters';
  end if;
  if exists (select 1 from public.purchases
              where import_fingerprint = p_fingerprint and id <> p_purchase_id) then
    raise exception 'fingerprint already belongs to another purchase';
  end if;

  update public.purchases
     set import_fingerprint = p_fingerprint, updated_at = now()
   where id = p_purchase_id;
end;
$$;

comment on function public.system_set_legacy_purchase_fingerprint(bigint, text) is
  'Re-stamps an imported purchase''s content fingerprint after its positions were corrected (0088). See the sale variant for why idempotence depends on it. service_role only.';

revoke all on function public.system_set_legacy_purchase_fingerprint(bigint, text)
  from public, anon, authenticated;
grant execute on function public.system_set_legacy_purchase_fingerprint(bigint, text) to service_role;
