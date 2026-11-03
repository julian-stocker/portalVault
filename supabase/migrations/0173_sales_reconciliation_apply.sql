-- ===========================================================================
-- 0173 — SALES RECONCILIATION: APPLYING THE DECISIONS (ADR-0174)
--
-- ###########################################################################
-- ##  NOT APPLIED — neither on Staging nor on Production.                  ##
-- ##  Staging only, after a separate approval by the operator.             ##
-- ###########################################################################
--
--   seller_recon_apply(session_id, expected_count) → jsonb
--
-- THE SEPARATE FINAL CONFIRMATION. The screen shows every pending decision
-- that would change something or document a clarification, and its count.
-- The caller passes that count; if the database counts differently — another
-- tab decided something in between — nothing happens.
--
-- ALL OR NOTHING (ADR-0174, decision 3). Before the first write, every sale
-- the pending decisions touch is locked and compared with the state the
-- analysis saw (`sales_recon_matches.sale_updated_at`). If even ONE changed,
-- the whole call aborts with PT409 and names the sales. There are no partial
-- applications — and any error later in the transaction takes everything
-- written before it back with it.
--
-- WHAT A DECISION DOES — and only through the functions that already own it,
-- so the sales book's own audit (`orderbook_audit`) records every change:
--
--   sold_on             take / manual   seller_update_sale → sold_at
--   items_net           take / manual   seller_update_sale → items_subtotal
--                                       = target + the EXISTING discount
--                                       (decision 4: the discount is never
--                                       changed automatically)
--   shipping            take / manual   seller_update_sale → shipping_charged
--   external_order_ref  take            seller_update_sale → external_order_ref
--                                       (one explicit decision per sale; 0171
--                                       keeps it unique per channel)
--   total               manual refund   seller_add_sale_refund (amount, reason)
--                       manual cancel   seller_cancel_external_sale (0170)
--                       manual none     documented, nothing changed
--   pieces, figure      manual clarify  documented, nothing changed — V1 never
--                                       touches `sale_items` (decision: only a
--                                       documented manual clarification)
--
-- `keep_ledger` and `defer` change nothing and are not applied: deferring
-- leaves the finding open for a later round. A session can be applied in as
-- many rounds as the operator needs; a decision is applied at most once
-- (`sales_recon_applications_once`).
--
-- WHAT IT NEVER DOES. No inventory movement, no change to `sale_items`, no
-- `legacy_stock_events`, no change to a sale outside the session.
--
-- Rollback: `supabase/rollback/R0169_0173_drop_sales_reconciliation.sql`.
-- ===========================================================================


do $pre$
begin
  if to_regprocedure('public.seller_recon_decide(bigint,text,jsonb,text,jsonb,jsonb)') is null then
    raise exception '0173 needs 0172: seller_recon_decide is missing';
  end if;
  if to_regprocedure('public.seller_update_sale(bigint,date,boolean,text,numeric,numeric,numeric,text,text,text,timestamptz)') is null
     or to_regprocedure('public.seller_add_sale_refund(bigint,numeric,timestamptz,text,text,text)') is null then
    raise exception '0173 needs seller_update_sale (0091) and seller_add_sale_refund (0062)';
  end if;
  if to_regprocedure('public.seller_recon_apply(bigint,integer)') is not null then
    raise exception '0173 is already applied: seller_recon_apply exists';
  end if;
end
$pre$;


create or replace function public.seller_recon_apply(p_session_id bigint, p_expected integer)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_state text;
  v_count integer;
  v_stale text;
  v_sale_id bigint;
  v_sale public.sales;
  v_pending record;
  v_order_ref text;
  v_sold_at date; v_subtotal numeric; v_shipping numeric; v_ref text;
  v_target numeric;
  v_applied integer := 0;
  v_documented integer := 0;
  v_sales integer := 0;
begin
  perform public.sales_recon_gate();

  select state into v_state from public.sales_recon_sessions where id = p_session_id for update;
  if not found then raise exception 'no such session' using errcode = 'no_data_found'; end if;
  if v_state <> 'open' then
    raise exception 'this session is % — nothing can be applied', v_state using errcode = 'restrict_violation';
  end if;

  /*
   * THE PENDING SET: the CURRENT decision of every finding of this session
   * that would change or document something and has not been applied.
   */
  -- A second call in the same transaction must not trip over the first one's table.
  drop table if exists recon_pending;
  create temporary table recon_pending on commit drop as
  select d.id as decision_id, d.decision, d.manual_value, d.reason,
         f.field, f.external_value, m.sale_id, m.sale_updated_at, m.order_id
    from public.sales_recon_findings f
    join public.sales_recon_matches m on m.id = f.match_id
    join lateral (select * from public.sales_recon_decisions d2
                   where d2.finding_id = f.id order by d2.id desc limit 1) d on true
   where m.session_id = p_session_id
     and d.decision in ('take_external', 'manual')
     and not exists (select 1 from public.sales_recon_applications a
                       join public.sales_recon_decisions dx on dx.id = a.decision_id
                      where dx.finding_id = f.id);

  select count(*) into v_count from pg_temp.recon_pending;
  if p_expected is null or p_expected <> v_count then
    raise exception 'the confirmation counted % decision(s), there are % — reload', coalesce(p_expected, 0), v_count
      using errcode = 'PT409';
  end if;
  if v_count = 0 then
    return jsonb_build_object('applied', 0, 'documented', 0, 'sales', 0);
  end if;

  -- ALL OR NOTHING: lock every affected sale, in id order, and compare first.
  perform 1 from public.sales s
   where s.id in (select sale_id from pg_temp.recon_pending)
   order by s.id
   for update;
  select string_agg(distinct p.sale_id::text, ', ' order by p.sale_id::text) into v_stale
    from pg_temp.recon_pending p join public.sales s on s.id = p.sale_id
   where s.updated_at is distinct from p.sale_updated_at;
  if v_stale is not null then
    raise exception 'sale(s) % changed since the analysis — nothing was applied; analyse again', v_stale
      using errcode = 'PT409';
  end if;

  for v_sale_id in select distinct sale_id from pg_temp.recon_pending order by sale_id loop
    v_sales := v_sales + 1;
    select * into v_sale from public.sales where id = v_sale_id;
    select o.order_ref into v_order_ref
      from public.sales_recon_orders o
     where o.id = (select order_id from pg_temp.recon_pending where sale_id = v_sale_id limit 1);
    v_sold_at := null; v_subtotal := null; v_shipping := null; v_ref := null;

    -- 1. The values, gathered into ONE update of the sale.
    for v_pending in select * from pg_temp.recon_pending
                      where sale_id = v_sale_id and field in ('sold_on', 'items_net', 'shipping', 'external_order_ref')
                      order by decision_id loop
      case v_pending.field
        when 'sold_on' then
          v_sold_at := case when v_pending.decision = 'manual' then (v_pending.manual_value ->> 'value')::date
                            else (v_pending.external_value #>> '{}')::date end;
          insert into public.sales_recon_applications
            (decision_id, session_id, sale_id, field, outcome, old_value, new_value, applied_by)
          values (v_pending.decision_id, p_session_id, v_sale_id, 'sold_on', 'applied',
                  v_sale.sold_at::text, v_sold_at::text, (select auth.uid()));
        when 'items_net' then
          v_target := case when v_pending.decision = 'manual' then (v_pending.manual_value ->> 'value')::numeric
                           else (v_pending.external_value #>> '{}')::numeric end;
          v_subtotal := round(v_target + coalesce(v_sale.discount_amount, 0), 2);
          insert into public.sales_recon_applications
            (decision_id, session_id, sale_id, field, outcome, old_value, new_value, applied_by)
          values (v_pending.decision_id, p_session_id, v_sale_id, 'items_net', 'applied',
                  format('items_subtotal %s (net %s)', v_sale.items_subtotal,
                         v_sale.items_subtotal - coalesce(v_sale.discount_amount, 0)),
                  format('items_subtotal %s (net %s)', v_subtotal, v_target), (select auth.uid()));
        when 'shipping' then
          v_shipping := case when v_pending.decision = 'manual' then (v_pending.manual_value ->> 'value')::numeric
                             else (v_pending.external_value #>> '{}')::numeric end;
          insert into public.sales_recon_applications
            (decision_id, session_id, sale_id, field, outcome, old_value, new_value, applied_by)
          values (v_pending.decision_id, p_session_id, v_sale_id, 'shipping', 'applied',
                  v_sale.shipping_charged::text, v_shipping::text, (select auth.uid()));
        when 'external_order_ref' then
          v_ref := v_pending.external_value #>> '{}';
          if v_sale.external_order_ref is not null and v_sale.external_order_ref <> v_ref then
            raise exception 'sale % already carries another order reference', v_sale_id using errcode = 'restrict_violation';
          end if;
          if exists (select 1 from public.sales s2
                      where s2.channel = v_sale.channel and s2.external_order_ref = v_ref
                        and s2.id <> v_sale_id and not s2.is_test) then
            raise exception 'the order reference of sale % is already carried by another sale', v_sale_id
              using errcode = 'unique_violation';
          end if;
          insert into public.sales_recon_applications
            (decision_id, session_id, sale_id, field, outcome, old_value, new_value, applied_by)
          values (v_pending.decision_id, p_session_id, v_sale_id, 'external_order_ref', 'applied',
                  v_sale.external_order_ref, v_ref, (select auth.uid()));
      end case;
      v_applied := v_applied + 1;
    end loop;

    if v_sold_at is not null or v_subtotal is not null or v_shipping is not null or v_ref is not null then
      -- The sale is locked and was compared above; the token is therefore not needed here.
      perform public.seller_update_sale(
        p_id => v_sale_id, p_sold_at => v_sold_at, p_clear_date => false, p_country => null,
        p_items_subtotal => v_subtotal, p_shipping_charged => v_shipping, p_discount_amount => null,
        p_external_ref => v_ref, p_buyer_ref => null, p_note => null, p_expected_updated_at => null);
    end if;

    -- 2. Events and documentation.
    for v_pending in select * from pg_temp.recon_pending
                      where sale_id = v_sale_id and field in ('total', 'pieces', 'figure')
                      order by decision_id loop
      if v_pending.field = 'total' and v_pending.manual_value ->> 'action' = 'refund' then
        perform public.seller_add_sale_refund(
          v_sale_id,
          (v_pending.manual_value ->> 'amount')::numeric,
          coalesce((v_pending.manual_value ->> 'occurred_on')::date, current_date)::timestamptz,
          v_pending.manual_value ->> 'reason',
          v_order_ref,
          format('Verkaufsabgleich %s: %s', p_session_id, v_pending.reason));
        insert into public.sales_recon_applications
          (decision_id, session_id, sale_id, field, outcome, old_value, new_value, applied_by)
        values (v_pending.decision_id, p_session_id, v_sale_id, 'total', 'applied',
                null, format('refund %s (%s)', v_pending.manual_value ->> 'amount', v_pending.manual_value ->> 'reason'),
                (select auth.uid()));
        v_applied := v_applied + 1;
      elsif v_pending.field = 'total' and v_pending.manual_value ->> 'action' = 'cancel' then
        perform public.seller_cancel_external_sale(
          v_sale_id, v_pending.reason, (v_pending.manual_value ->> 'cancelled_on')::date, null);
        insert into public.sales_recon_applications
          (decision_id, session_id, sale_id, field, outcome, old_value, new_value, applied_by)
        values (v_pending.decision_id, p_session_id, v_sale_id, 'total', 'applied',
                null, 'cancelled', (select auth.uid()));
        v_applied := v_applied + 1;
      else
        -- `none` for a total, `clarify` for pieces and figures: recorded, nothing changed.
        insert into public.sales_recon_applications
          (decision_id, session_id, sale_id, field, outcome, old_value, new_value, applied_by)
        values (v_pending.decision_id, p_session_id, v_sale_id, v_pending.field, 'documented',
                null, v_pending.manual_value ->> 'action', (select auth.uid()));
        v_documented := v_documented + 1;
      end if;
    end loop;

    -- 3. The session's view of this sale is the state it just wrote.
    update public.sales_recon_matches m
       set sale_updated_at = s.updated_at
      from public.sales s
     where m.session_id = p_session_id and m.sale_id = v_sale_id and s.id = v_sale_id;
  end loop;

  return jsonb_build_object('applied', v_applied, 'documented', v_documented, 'sales', v_sales);
end;
$$;

comment on function public.seller_recon_apply(bigint, integer) is
  'Applies the pending decisions of one reconciliation session (0173, ADR-0174): all or nothing, after comparing every affected sale with the analysed state (PT409 otherwise). Writes only through seller_update_sale, seller_add_sale_refund and seller_cancel_external_sale; never sale_items, inventory_movements or legacy_stock_events.';

revoke all on function public.seller_recon_apply(bigint, integer) from public, anon;
grant execute on function public.seller_recon_apply(bigint, integer) to authenticated;
