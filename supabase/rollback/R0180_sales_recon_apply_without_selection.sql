-- ===========================================================================
-- ROLLBACK OF 0180 — decide, pending and the old apply back to 0172 / 0178 /
--                    0173, the selected apply, the preview and the helpers
--                    of 0180 dropped
--
-- WHAT IT DOES: `create or replace` of
--   seller_recon_decide(bigint, text, jsonb, text, jsonb, jsonb)   body of 0172
--   seller_recon_apply(bigint, integer)                            body of 0173
--   seller_recon_pending(bigint)                                   body of 0178
-- character for character, gives `authenticated` EXECUTE on the old apply
-- back (as 0173 did), and drops
--   seller_recon_apply(bigint, bigint[], text), seller_recon_preview(bigint, bigint[]),
--   sales_recon_selection(bigint, bigint[]), sales_recon_check_selection(bigint[]),
--   sales_recon_decision_problem(bigint, bigint), sales_recon_take_check(bigint),
--   sales_recon_allowed_0180(text).
--
-- WHAT IT COSTS — AND WHY IT IS NOT A ROUTINE STEP. The gaps 0180 closed are
-- open again: `manual` writes free values, refunds and cancellations; an
-- uncertain pair can be taken over; the apply takes EVERY pending decision of
-- a session, bound only by a count. Run it only on purpose, after a decision
-- of the operator.
--
-- NO ROW CHANGES. Applications made through 0180 stay rows of
-- `sales_recon_applications` (they are append-only), and the sales they
-- changed keep their values. Decisions stay as they are.
--
-- IT OVERWRITES AND DROPS ONLY WHAT 0180 WROTE. It refuses while any of the
-- ten functions carries a body that is neither the one of 0180 nor the one it
-- restores. Idempotent: where the old bodies stand and the new functions are
-- gone, it says so and changes nothing.
--
-- EXECUTION: as one unit (the SQL editor runs it as one implicit
-- transaction), or wrapped in `begin` / `commit`.
-- ===========================================================================

do $pre$
declare
  v_fn text;
  v_new text;
  v_old text;
  v_body text;
begin
  for v_fn, v_new in values
      ('sales_recon_allowed_0180(text)', '56a9899eaf5465f1b90acc0ccb986b38'),
      ('sales_recon_take_check(bigint)', 'bce45f42855c25fc428cab86bd7cf081'),
      ('sales_recon_decision_problem(bigint,bigint)', 'ed9d427a8657e78c77ef70d53cc42410'),
      ('sales_recon_check_selection(bigint[])', 'b382e469fb58fa8a756f24910b9a8cc8'),
      ('sales_recon_selection(bigint,bigint[])', '97c3461ea718a4694d06cf1fc1280a22'),
      ('seller_recon_preview(bigint,bigint[])', 'f3bc1d34fa3e7b843ca609fe7b0f5569'),
      ('seller_recon_apply(bigint,bigint[],text)', 'b96ceff990dafa33674c71e928c713bb') loop
    select md5(p.prosrc) into v_body from pg_proc p where p.oid = to_regprocedure('public.' || v_fn);
    if v_body is not null and v_body <> v_new then
      raise exception 'R0180 abort: % is % and not the body from 0180 (%). A later version is not dropped blindly.',
        v_fn, v_body, v_new;
    end if;
  end loop;
  for v_fn, v_new, v_old in values
      ('seller_recon_decide(bigint,text,jsonb,text,jsonb,jsonb)', 'dffdbe5b16fa39989de47c9c61a77911', '2526d3a77ccf3153158182d0ecd391aa'),
      ('seller_recon_apply(bigint,integer)', '72cc0079c007847cabd4db20a6109a0c', 'f8b1132c27ba1b18123f6c2548f9997c'),
      ('seller_recon_pending(bigint)', 'dc140b5971bc752e90ad2344b3db2712', '51213fd88afb5441a487dc89bba2ac06') loop
    select md5(p.prosrc) into v_body from pg_proc p where p.oid = to_regprocedure('public.' || v_fn);
    if v_body = v_old then
      raise notice 'R0180: % already carries its body from before 0180.', v_fn;
    elsif v_body is distinct from v_new then
      raise exception 'R0180 abort: % is % — neither 0180 (%) nor its earlier body (%). A third version is not overwritten blindly.',
        v_fn, coalesce(v_body, '(none)'), v_new, v_old;
    end if;
  end loop;
  if to_regprocedure('public.sales_recon_pending_set(bigint)') is null then
    raise exception 'R0180 abort: sales_recon_pending_set (0178) is missing — the 0178 pending read would not run';
  end if;
end
$pre$;

-- ---------------------------------------------------------------------------
-- The body of 0172, character for character
-- ---------------------------------------------------------------------------
create or replace function public.seller_recon_decide(
  p_finding_id bigint, p_decision text, p_manual_value jsonb, p_reason text,
  p_shown_ledger jsonb, p_shown_external jsonb)
returns bigint
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_finding public.sales_recon_findings;
  v_match public.sales_recon_matches;
  v_state text;
  v_now_updated timestamptz;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_action text;
  v_id bigint;
begin
  perform public.sales_recon_gate();
  if v_reason is not null and length(v_reason) > 500 then
    raise exception 'an explanation has at most 500 characters' using errcode = 'check_violation';
  end if;
  perform public.sales_recon_no_contact(v_reason, 'reason');

  select * into v_finding from public.sales_recon_findings where id = p_finding_id;
  if not found then raise exception 'no such finding' using errcode = 'no_data_found'; end if;
  select * into v_match from public.sales_recon_matches where id = v_finding.match_id;
  select state into v_state from public.sales_recon_sessions where id = v_match.session_id for update;
  if v_state <> 'open' then
    raise exception 'this session is % — nothing more can be decided', v_state using errcode = 'restrict_violation';
  end if;
  if p_decision is null or not (p_decision = any (v_finding.allowed_decisions)) then
    raise exception 'this decision is not possible for the field %', v_finding.field using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.sales_recon_applications a
               join public.sales_recon_decisions d on d.id = a.decision_id
              where d.finding_id = p_finding_id) then
    raise exception 'this finding has already been applied' using errcode = 'restrict_violation';
  end if;

  -- The 0156 pattern: what the screen showed is what is stored, and the sale did not move.
  if coalesce(p_shown_ledger, 'null'::jsonb) is distinct from v_finding.ledger_value
     or coalesce(p_shown_external, 'null'::jsonb) is distinct from v_finding.external_value then
    raise exception 'the values shown are not the values of this finding — reload' using errcode = 'PT409';
  end if;
  select updated_at into v_now_updated from public.sales where id = v_match.sale_id;
  if v_now_updated is distinct from v_match.sale_updated_at then
    raise exception 'sale % changed since the analysis — analyse again', v_match.sale_id using errcode = 'PT409';
  end if;

  if p_decision = 'manual' then
    case v_finding.field
      when 'sold_on' then
        perform public.sales_recon_only_keys(p_manual_value, array['value'], 'manual value');
        if public.sales_recon_day(p_manual_value, 'value', true, 'manual value') not between date '2000-01-01' and current_date + 1 then
          raise exception 'that sale date is outside the plausible range' using errcode = 'check_violation';
        end if;
      when 'items_net', 'shipping' then
        perform public.sales_recon_only_keys(p_manual_value, array['value'], 'manual value');
        if public.sales_recon_number(p_manual_value, 'value', 0, 1000000, true, 'manual value')
           <> round(public.sales_recon_number(p_manual_value, 'value', 0, 1000000, true, 'manual value'), 2) then
          raise exception 'an amount has at most two decimals' using errcode = 'check_violation';
        end if;
      when 'total' then
        v_action := public.sales_recon_text(p_manual_value, 'action', 16, true, 'manual value');
        if v_action = 'refund' then
          perform public.sales_recon_only_keys(p_manual_value, array['action', 'amount', 'reason', 'occurred_on'], 'manual value');
          perform public.sales_recon_number(p_manual_value, 'amount', 0.01, 1000000, true, 'manual value');
          if public.sales_recon_text(p_manual_value, 'reason', 32, true, 'manual value') not in
             ('artikel_fehlt', 'artikel_beschaedigt', 'nicht_geliefert', 'versandkorrektur', 'retoure', 'kulanz', 'sonstiges') then
            raise exception 'a refund needs one of the known refund reasons' using errcode = 'check_violation';
          end if;
          perform public.sales_recon_day(p_manual_value, 'occurred_on', false, 'manual value');
          if v_reason is null then
            raise exception 'a refund needs an explanation' using errcode = 'check_violation';
          end if;
        elsif v_action = 'cancel' then
          perform public.sales_recon_only_keys(p_manual_value, array['action', 'cancelled_on'], 'manual value');
          perform public.sales_recon_day(p_manual_value, 'cancelled_on', false, 'manual value');
          if v_reason is null then
            raise exception 'a cancellation needs an explanation' using errcode = 'check_violation';
          end if;
        elsif v_action = 'none' then
          perform public.sales_recon_only_keys(p_manual_value, array['action'], 'manual value');
        else
          raise exception 'a total is settled by refund, cancel or none' using errcode = 'check_violation';
        end if;
      when 'pieces', 'figure' then
        perform public.sales_recon_only_keys(p_manual_value, array['action'], 'manual value');
        if public.sales_recon_text(p_manual_value, 'action', 16, true, 'manual value') <> 'clarify' then
          raise exception 'pieces and figures are only clarified by hand (V1 never changes sale_items)'
            using errcode = 'check_violation';
        end if;
        if v_reason is null then
          raise exception 'a clarification needs a note' using errcode = 'check_violation';
        end if;
      else
        raise exception 'the field % has no manual correction', v_finding.field using errcode = 'check_violation';
    end case;
  elsif p_manual_value is not null then
    raise exception 'only a manual decision carries a value' using errcode = 'check_violation';
  end if;

  insert into public.sales_recon_decisions
    (finding_id, decision, manual_value, reason, shown_ledger, shown_external, decided_by)
  values (p_finding_id, p_decision, p_manual_value, v_reason,
          coalesce(p_shown_ledger, 'null'::jsonb), coalesce(p_shown_external, 'null'::jsonb),
          (select auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- The body of 0173, character for character
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- The body of 0178, character for character
-- ---------------------------------------------------------------------------
create or replace function public.seller_recon_pending(p_session_id bigint)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_state text;
begin
  perform public.sales_recon_gate();
  select state into v_state from public.sales_recon_sessions where id = p_session_id;
  if not found then raise exception 'no such session' using errcode = 'no_data_found'; end if;
  if v_state <> 'open' then
    -- Nothing is pending where nothing can be applied (seller_recon_apply refuses).
    return jsonb_build_object('sessionId', p_session_id, 'state', v_state, 'sessionOpen', false,
                              'count', 0, 'staleSales', 0, 'token', null, 'changes', '[]'::jsonb);
  end if;
  return jsonb_build_object('sessionId', p_session_id, 'state', v_state, 'sessionOpen', true)
         || public.sales_recon_pending_set(p_session_id);
end;
$$;

comment on function public.seller_recon_apply(bigint, integer) is
  'Applies the pending decisions of one reconciliation session (0173, ADR-0174): all or nothing, after comparing every affected sale with the analysed state (PT409 otherwise). Writes only through seller_update_sale, seller_add_sale_refund and seller_cancel_external_sale; never sale_items, inventory_movements or legacy_stock_events.';
comment on function public.seller_recon_pending(bigint) is
  'The changes seller_recon_apply would make for one open session now (0178, ADR-0174): per change sale, field, old and target value; count; stale sales; a token over the ordered set. Reads only.';

revoke all on function public.seller_recon_apply(bigint, integer) from public, anon;
grant execute on function public.seller_recon_apply(bigint, integer) to authenticated;

drop function if exists public.seller_recon_apply(bigint, bigint[], text);
drop function if exists public.seller_recon_preview(bigint, bigint[]);
drop function if exists public.sales_recon_selection(bigint, bigint[]);
drop function if exists public.sales_recon_check_selection(bigint[]);
drop function if exists public.sales_recon_decision_problem(bigint, bigint);
drop function if exists public.sales_recon_take_check(bigint);
drop function if exists public.sales_recon_allowed_0180(text);

do $post$
declare
  v_fn text;
  v_old text;
begin
  for v_fn, v_old in values
      ('seller_recon_decide(bigint,text,jsonb,text,jsonb,jsonb)', '2526d3a77ccf3153158182d0ecd391aa'),
      ('seller_recon_apply(bigint,integer)', 'f8b1132c27ba1b18123f6c2548f9997c'),
      ('seller_recon_pending(bigint)', '51213fd88afb5441a487dc89bba2ac06') loop
    if (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.' || v_fn)) is distinct from v_old then
      raise exception 'R0180 postcondition: % is not its body from before 0180', v_fn;
    end if;
    if not has_function_privilege('authenticated', 'public.' || v_fn, 'execute')
       or has_function_privilege('anon', 'public.' || v_fn, 'execute') then
      raise exception 'R0180 postcondition: the rights on % are not authenticated-only', v_fn;
    end if;
  end loop;
  if to_regprocedure('public.seller_recon_apply(bigint,bigint[],text)') is not null
     or to_regprocedure('public.seller_recon_preview(bigint,bigint[])') is not null
     or to_regprocedure('public.sales_recon_take_check(bigint)') is not null then
    raise exception 'R0180 postcondition: a function of 0180 still stands';
  end if;
  raise notice 'R0180: decide (0172), apply (0173) and pending (0178) stand again; the functions of 0180 are gone. No row touched.';
end
$post$;
