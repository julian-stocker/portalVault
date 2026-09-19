-- ===========================================================================
-- 0055 — letting the importer see what it already imported
--
-- WHY THIS EXISTS AT ALL
--
-- The historical batch importer has to answer one question before it writes
-- anything: has this workbook group already been imported? `0053` stores the
-- answer — `purchases.import_fingerprint`, with a partial unique index behind
-- it — but no seller-facing function returns it. `seller_purchases()` returns
-- twelve columns and that is not one of them.
--
-- So a Seller Operator could not tell an already-imported group from a new one
-- until the insert failed. That is a usable last line of defence and a useless
-- preview: the whole point of preview-then-apply is that the operator sees the
-- outcome BEFORE authorising it, and "we will find out when it errors" is not
-- seeing it.
--
-- WHY NOT READ IT WITH THE SERVICE-ROLE KEY INSTEAD
--
-- Because that is the mistake `0052` was written to fix. The Staging proof of
-- the inventory importer ran as service_role, which bypasses RLS, so it proved
-- the classifier and nothing about authorization — and 28 Production rows were
-- skipped for a permission the real account did not have. A tool that needs a
-- key the product cannot use is a tool whose path the product can never take.
--
-- WHY NOT WIDEN `seller_purchases()`
--
-- Its shape is what the Orderbuch screens read. Adding a column to it to serve
-- a batch importer would change a function four callers depend on to give one
-- caller a field none of the others want.
--
-- WHAT THIS RETURNS, AND WHY IT IS NOT A LEAK
--
-- The fingerprints of imported Excel groups and nothing else. A fingerprint is
-- a SHA-256 of workbook content the caller must already hold to compute — a
-- Seller Operator reading these learns only which of his own imports he has
-- done. No purchase, no price, no item.
-- ===========================================================================

create or replace function public.seller_purchase_fingerprints()
returns table (import_fingerprint text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required'
      using errcode = 'insufficient_privilege';
  end if;

  -- Only the imported ones. A hand-made purchase has no fingerprint, and the
  -- partial unique index is scoped the same way.
  return query
    select p.import_fingerprint
      from public.purchases p
     where p.import_fingerprint is not null
       and p.source = 'excel_order_2026';
end;
$$;

comment on function public.seller_purchase_fingerprints() is
  'The import fingerprints already recorded, so the historical batch importer can recognise an already-imported workbook group during PREVIEW rather than discovering it from a unique-violation during apply (0055). Seller operators only; returns no purchase data.';

revoke all on function public.seller_purchase_fingerprints() from public, anon;
grant execute on function public.seller_purchase_fingerprints() to authenticated;
