-- ===========================================================================
-- 0171 — ONE EXTERNAL ORDER, ONE SALE, PER PLATFORM (ADR-0174)
--
-- ###########################################################################
-- ##  NOT APPLIED — neither on Staging nor on Production.                  ##
-- ##  Staging only, after a separate approval by the operator.             ##
-- ###########################################################################
--
-- `sales.external_order_ref` (0059) has had no rule at all: free text, no
-- index, no uniqueness. As long as nobody stored eBay order numbers that did
-- not matter. The reconciliation now offers to store them — one explicit
-- decision at a time, never in bulk — and from then on the reference IS the
-- identity: stage A of the matching (`src/lib/reconciliation/match.ts`)
-- pairs a sale with the order whose number it carries, and with no other.
-- Two sales carrying the same order number would make that ambiguous.
--
-- THE RULE. Within one channel (`ebay`, `manual`, …) an order number belongs
-- to at most one sale. Two platforms may use the same string; that is not a
-- clash. Test sales are exempt — fixtures may reuse a number on purpose.
-- Unset references (NULL, the normal historical case) are not affected.
--
-- WHAT IT DOES NOT DO. It sets, changes or clears no reference. If any two
-- sales already share one, it refuses and names the count — the operator
-- resolves it by hand, nothing is guessed.
--
-- Rollback: `supabase/rollback/R0169_0173_drop_sales_reconciliation.sql`.
-- ===========================================================================


do $pre$
declare
  v_clashes integer;
begin
  if to_regclass('public.sales_external_order_ref_per_channel') is not null then
    raise exception '0171 is already applied: sales_external_order_ref_per_channel exists';
  end if;
  select count(*) into v_clashes from (
    select channel, external_order_ref
      from public.sales
     where external_order_ref is not null and not is_test
     group by channel, external_order_ref
    having count(*) > 1) d;
  if v_clashes > 0 then
    raise exception '0171 stops: % order number(s) are already carried by more than one sale of the same channel', v_clashes;
  end if;
end
$pre$;

create unique index sales_external_order_ref_per_channel
  on public.sales (channel, external_order_ref)
  where external_order_ref is not null and not is_test;

comment on index public.sales_external_order_ref_per_channel is
  'Within one channel an external order number belongs to at most one non-test sale (0171, ADR-0174). Stage A of the sales reconciliation relies on it.';
