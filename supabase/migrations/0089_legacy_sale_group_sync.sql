-- ===========================================================================
-- 0089 — das eine Kopffeld, das die Arbeitsmappe nachträglich füllt
--
-- WARUM NUR EINES
--
-- Der Fingerabdruck einer importierten Bestellung hasht acht Dinge: zwei
-- Konstanten, vier Kopfwerte (`headerRow`, `date`, `buyer`, `money.U`), einen
-- weiteren Kopfwert (`money.AE`) und die Positionszeilen. Gemessen über alle
-- 292 bestehenden Legacy-Verkäufe weicht davon heute genau eines ab:
--
--   date        2 Verkäufe — der Betreiber hat zwei zuvor undatierte
--               Bestellungen datiert (#51 → 2026-02-10, #99 → 2026-03-18)
--   headerRow   0
--   buyer       0
--   money.U     0
--   money.AE    1 Verkauf (#228), siehe unten
--
-- Deshalb schreibt diese Funktion `sold_at` und sonst nichts. `buyer_ref`
-- und `items_subtotal` bekommen keinen Schreibpfad, solange sie nirgends
-- abweichen: ein Weg, den niemand braucht, ist ein Weg, den niemand prüft.
--
-- WARUM `money.AE` KEINE SPALTE BEKOMMT
--
-- Es ist die Kontrollzahl der Arbeitsmappe für die erwartete Auszahlung und
-- wird vom Importer nur gegen die eigene Rechnung gehalten. Es ist kein
-- Geschäftsdatum, es steht in keiner Spalte von `sales`, und genau deshalb
-- kann ein Sync seine Änderung auch nicht erkennen — nur der Abdruck verrät
-- sie. Eine Spalte dafür anzulegen, um einen Hash erklären zu können, wäre
-- die falsche Antwort auf die richtige Beobachtung.
--
-- WAS SIE NICHT ANFASST
--
-- `shipped_at`, `cancelled_at`, `stock_released_at`, `buyer_ref`, jede
-- Geldspalte, `import_fingerprint` (das macht 0088), `is_test`, `source`,
-- `order_id`. Und kein Lager: weder `shop_inventory` noch
-- `inventory_movements` noch `legacy_stock_events` kommen hier vor.
--
-- WER SIE AUFRUFEN DARF: nur `service_role`, wie alle `system_*`-Funktionen
-- dieses Schemas (0003, 0035, 0081, 0088).
-- ===========================================================================

create or replace function public.system_sync_legacy_sale_group(
  p_sale_id bigint,
  p_sold_at date
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_sale public.sales%rowtype;
begin
  select * into v_sale from public.sales where id = p_sale_id;
  if not found then
    raise exception 'sale % does not exist', p_sale_id using errcode = 'no_data_found';
  end if;
  if v_sale.source is distinct from 'excel_order_2026' then
    raise exception 'sale % is not a workbook sale (source %)', p_sale_id, v_sale.source;
  end if;
  -- A sale that belongs to an order is operative history; the workbook has
  -- no say over when it happened.
  if v_sale.order_id is not null then
    raise exception 'sale % belongs to order % and is operative', p_sale_id, v_sale.order_id;
  end if;
  -- A date is what this function is for. Clearing one would be a different
  -- act with a different justification, and nobody has asked for it.
  if p_sold_at is null then
    raise exception 'sale %: refusing to clear sold_at', p_sale_id;
  end if;
  -- The business year is the whole point of the cut (ADR-0102). A workbook
  -- date outside it means the sheet was misread, not that history moved.
  if p_sold_at < date '2026-01-01' then
    raise exception 'sale %: % is before the business cut', p_sale_id, p_sold_at;
  end if;

  update public.sales
     set sold_at = p_sold_at, updated_at = now()
   where id = p_sale_id;
end;
$$;

comment on function public.system_sync_legacy_sale_group(bigint, date) is
  'Writes sold_at on one imported sale (0089) — the single header field the workbook corrects in practice, measured across all 292 legacy sales. Nothing else: buyer_ref, every money column, shipped_at, cancelled_at, stock_released_at and import_fingerprint are outside its UPDATE list. money.AE is part of the import fingerprint but deliberately gets no column: it is the workbook''s own payout check, not a business fact. Refuses a non-workbook sale, a sale attached to an order, a NULL date and a date before the business cut. service_role only.';

revoke all on function public.system_sync_legacy_sale_group(bigint, date)
  from public, anon, authenticated;
grant execute on function public.system_sync_legacy_sale_group(bigint, date) to service_role;
