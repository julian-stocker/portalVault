-- ===========================================================================
-- 0082 — 0081 left one revoke short, and its own comment said otherwise
--
-- WHAT WENT WRONG
--
-- `0081` declares `apply_reconciled_legacy_settlement()` internal — "no role
-- holds EXECUTE", exactly like `apply_inventory_movement()` has been since
-- 0003 — and then revokes it only `from public, anon, authenticated`.
-- `service_role` was not named, so it kept the grant, and the function it
-- was supposed to reach only through `system_settle_reconciled_legacy_item()`
-- was callable directly.
--
-- Measured rather than assumed: probing both functions on Production,
-- `apply_inventory_movement` answered `42501 permission denied` to the
-- service role while `apply_reconciled_legacy_settlement` ran its body and
-- answered `P0002 no such sale item`. 0003 gets this right because its
-- revoke names four roles:
--
--     revoke all on function public.apply_inventory_movement(...)
--       from public, anon, authenticated, service_role;
--
-- HOW MUCH THIS ACTUALLY MATTERED
--
-- Little, and saying so is not an excuse for leaving it. The only role that
-- kept the grant is the one `system_settle_reconciled_legacy_item()` is
-- granted to anyway, and that wrapper adds no check of its own — so nothing
-- could be reached through the hole that was not already reachable beside
-- it. No privilege escalation, and no data was touched: the probe used a
-- sale-item id that does not exist.
--
-- What it did cost is the invariant. "Internal: no role holds EXECUTE" is
-- the sentence a later reader relies on before adding a check to the
-- wrapper instead of the body. A comment that is false about permissions is
-- worse than no comment, because it is trusted.
--
-- WHY A NEW MIGRATION RATHER THAN AN EDIT
--
-- 0081 is applied on Staging and on Production and is committed. Editing an
-- applied migration makes a fresh database and an existing one disagree
-- about what "0081" means. The correction gets its own number.
-- ===========================================================================

revoke all on function public.apply_reconciled_legacy_settlement(bigint)
  from public, anon, authenticated, service_role;

comment on function public.apply_reconciled_legacy_settlement(bigint) is
  'The rules for closing one workbook sale position the legacy reconciliation already accounted for (0081). Internal: no role holds EXECUTE — 0082 completed the revoke that 0081 left short of service_role. Call it through seller_settle_reconciled_legacy_item() or system_settle_reconciled_legacy_item().';
