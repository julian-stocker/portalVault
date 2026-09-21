-- ===========================================================================
-- 0080 — one imported sale line names the wrong Kaos
--
-- WHAT IS WRONG
--
-- `Order 2026` row 1381 sells a figure the owner typed as `Kaos`. Its market
-- formula — which is the identity, not the free text (ADR-0088) — reads
-- `T!I124`, the Trap Team sheet: SKY-0419 Kaos [T]. The sales importer filed
-- it as SKY-0563 Kaos [I], the Imaginators villain, because it resolved the
-- bare name instead of the reference.
--
-- The catalog holds four figures whose name begins with Kaos (SKY-0419 [T],
-- SKY-0495 [SC], SKY-0563 [I], SKY-0564 [I]), so the name alone never could
-- decide it. The workbook's four other Kaos sale lines all resolved to
-- SKY-0419 correctly; this one row is the outlier, which is what makes it a
-- defect rather than a rule.
--
-- WHY IT MATTERS NOW
--
-- The line is still unbooked, so it counts as an open legacy sale against
-- SKY-0563 and is missing from SKY-0419. Both figures therefore carry a wrong
-- reconciliation target, and reconciliation is the next thing that runs.
-- Fixing it afterwards would mean correcting stock that was moved on a false
-- premise.
--
-- WHY AN UPDATE IS SAFE HERE, AND ONLY HERE
--
-- `movement_id is null`: nothing was ever booked out of stock for this line,
-- so no `inventory_movements` row points at it and no ledger entry is touched
-- or removed. The guard below refuses the migration outright if that has
-- changed since it was written — a booked line needs a return and a
-- rebooking, not an UPDATE, and this migration must not quietly do the wrong
-- one of those.
--
-- FAIL-CLOSED
--
-- Exactly one row must match on all of: the sale's source, the source row,
-- the current sky_id, and an unbooked, unsettled state. Anything else raises
-- and the transaction rolls back. Re-running after a successful run matches
-- zero rows by the sky_id predicate and is reported as already-applied.
-- ===========================================================================

do $$
declare
  v_target   bigint;
  v_count    integer;
  v_done     integer;
begin
  select count(*) into v_done
    from public.sale_items si
    join public.sales s on s.id = si.sale_id
   where s.source = 'excel_order_2026'
     and si.source_row = 1381
     and si.sky_id = 'SKY-0419';

  if v_done = 1 then
    raise notice '0080: already applied — row 1381 already names SKY-0419.';
    return;
  end if;

  select count(*), min(si.id) into v_count, v_target
    from public.sale_items si
    join public.sales s on s.id = si.sale_id
   where s.source = 'excel_order_2026'
     and si.source_row = 1381
     and si.sky_id = 'SKY-0563'
     and si.movement_id is null
     and si.return_movement_id is null
     and si.settled_at is null;

  if v_count <> 1 then
    raise exception
      '0080 refuses to run: expected exactly one unbooked SKY-0563 line at source row 1381, found %', v_count
      using errcode = 'restrict_violation';
  end if;

  update public.sale_items
     set sky_id = 'SKY-0419',
         note = concat_ws(' | ', nullif(note, ''),
                'Zuordnung korrigiert 0080: Excel Order 2026!1381 verweist auf T!I124 = SKY-0419 (vorher SKY-0563).')
   where id = v_target;

  raise notice '0080: sale_item % remapped from SKY-0563 to SKY-0419.', v_target;
end;
$$;
