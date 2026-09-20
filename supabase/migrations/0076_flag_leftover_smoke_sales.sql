-- ===========================================================================
-- 0076 — TWO LEFTOVER SMOKE RUNS GET THE FLAG THEY SHOULD HAVE HAD
-- ===========================================================================
--
-- STAGING ONLY, AND IT SAYS SO BY REFUSING TO FIND ANYTHING ELSEWHERE.
--
-- Two sales on Staging are smoke-test runs that were never marked as such:
--
--   #15  buyer `smoke`   ref `SMOKE-1`    "temporärer Test"
--   #19  buyer `uiflow`  ref `UIFLOW-1`   "UI-Durchlauf (temporär)"
--
-- Both were created, booked out and restocked within seconds, by a
-- temporary operator, on 2026-09-18. Both carry `is_test = false`, so they
-- count in business sums and appear in the ledger as real trade. #15 is the
-- sale that showed `Ausgebucht ✓` while its figure sat on the shelf — the
-- observation that produced 0075.
--
-- They are NOT in Production. I named them during the release preflight for
-- exactly this reason: the transfer filtered on `source = 'excel_order_2026'`
-- rather than on `is_test`, which is what kept them out. This migration
-- therefore finds nothing in Production, and says so rather than failing.
--
-- WHY A FLAG AND NOT A DELETION
--
-- Both own real inventory movements — a `sale_external` of -1 and a `return`
-- of +1, four of them between the two sales. `inventory_movements` is
-- append-only with `on delete restrict`, and those rows are the honest
-- record of what the shelf did that afternoon. Deleting the sales would
-- orphan them or be refused; `is_test = true` changes nothing physical and
-- moves the sales out of the business figures, which is the whole complaint.
--
-- NET EFFECT ON STOCK: NONE, BEFORE OR AFTER. Each position went out and
-- came back. The movements stay exactly as they are.
--
-- IDENTIFIED BY WHAT THEY ARE, NOT BY ID
--
-- A hand-made external sale, with no import fingerprint, not yet flagged,
-- carrying one of the two references the tools of the time wrote. Every
-- other hand-made sale on Staging already has `is_test = true`; the count
-- has to come out at two or the block refuses.
-- ===========================================================================

do $$
declare
  v_expected constant integer := 2;
  v_found    integer;
  v_updated  integer;
  v_moves    integer;
  v_stock    bigint;
begin
  select count(*) into v_moves from public.inventory_movements;
  select coalesce(sum(quantity), 0) into v_stock from public.shop_inventory;

  select count(*) into v_found
    from public.sales s
   where s.source = 'manual'
     and s.order_id is null
     and s.import_fingerprint is null
     and s.is_test = false
     and s.external_order_ref in ('SMOKE-1', 'UIFLOW-1');

  /*
   * Production has neither, and that is the expected outcome there — not a
   * failure. A migration that raised would make applying the set to
   * Production impossible for no reason.
   */
  if v_found = 0 then
    raise notice '0076: keine unmarkierten Smoke-Verkaeufe gefunden — nichts zu tun.';
    return;
  end if;

  if v_found <> v_expected then
    raise exception 'expected % unflagged smoke sales, found % — refusing to guess',
      v_expected, v_found using errcode = 'data_exception';
  end if;

  /*
   * BOTH MUST BE FINISHED TEST RUNS, not something that merely looks like
   * one. Every position went out and came back, so flagging them removes a
   * pair of movements that cancel each other from the business figures and
   * nothing else.
   */
  if exists (
    select 1 from public.sale_items i
      join public.sales s on s.id = i.sale_id
     where s.external_order_ref in ('SMOKE-1', 'UIFLOW-1')
       and s.is_test = false
       and (i.movement_id is null or i.return_movement_id is null))
  then
    raise exception 'a position of these sales is not a completed out-and-back run'
      using errcode = 'data_exception';
  end if;

  update public.sales s
     set is_test = true, updated_at = now()
   where s.source = 'manual'
     and s.order_id is null
     and s.import_fingerprint is null
     and s.is_test = false
     and s.external_order_ref in ('SMOKE-1', 'UIFLOW-1');

  get diagnostics v_updated = row_count;
  if v_updated <> v_expected then
    raise exception 'flagged % sales, expected % — rolling back', v_updated, v_expected
      using errcode = 'data_exception';
  end if;

  /* Nothing physical may have moved. */
  if (select count(*) from public.inventory_movements) <> v_moves then
    raise exception 'inventory movements changed — rolling back' using errcode = 'data_exception';
  end if;
  if (select coalesce(sum(quantity), 0) from public.shop_inventory) <> v_stock then
    raise exception 'stock changed — rolling back' using errcode = 'data_exception';
  end if;

  raise notice '0076: % Smoke-Verkaeufe als Testvorgang markiert. Bestand % unveraendert, % Bewegungen unveraendert.',
    v_updated, v_stock, v_moves;
end;
$$;
