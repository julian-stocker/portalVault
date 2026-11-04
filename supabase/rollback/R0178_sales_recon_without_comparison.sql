-- ===========================================================================
-- ROLLBACK OF 0178 — seller_recon_session back to the body from `0172`,
--                    seller_recon_pending and its helpers dropped
--
-- WHAT IT DOES: `create or replace` of
-- `seller_recon_session(bigint, text, integer, integer)` with the body from
-- `0172`, character for character (`create or replace` keeps the ACL), then
-- `drop function` of `seller_recon_pending(bigint)`,
-- `sales_recon_pending_set(bigint)`, `sales_recon_sale_values(bigint)` and
-- `sales_recon_at_analysis(boolean, jsonb, jsonb)`.
--
-- WHAT IT COSTS: the key `ledger` disappears from the session read, and the
-- pending preview is gone. No row, no table, no session, no decision and no
-- sale changes — 0178 only reads.
--
-- IT OVERWRITES AND DROPS ONLY WHAT 0178 WROTE. It refuses
--   * while `seller_recon_apply` is not the body from `0173` — the planned
--     0179 replaces the apply with one that recomputes
--     `sales_recon_pending_set` under lock; dropping the helper under it
--     would break every apply. Roll 0179 back first;
--   * while any of the four new functions carries a body other than the one
--     from 0178 — a later version is not dropped blindly;
--   * while the session read is neither 0172 nor 0178.
--
-- IT IS IDEMPOTENT: where the session read already carries the body of 0172
-- and the three functions are gone, it says so and changes nothing. It aborts
-- when a THIRD version of the session read stands.
--
-- EXECUTION: as one unit (the SQL editor runs it as one implicit
-- transaction), or wrapped in `begin` / `commit`.
-- ===========================================================================

do $pre$
declare
  v_body text;
  v_fn text;
  v_expected text;
begin
  if (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_recon_apply(bigint,integer)'))
     is distinct from 'f8b1132c27ba1b18123f6c2548f9997c' then
    raise exception 'R0178 abort: seller_recon_apply is not the body from 0173 — roll back what came after 0178 first';
  end if;
  for v_fn, v_expected in values ('seller_recon_pending(bigint)', '51213fd88afb5441a487dc89bba2ac06'),
                                 ('sales_recon_pending_set(bigint)', '3228eb12e00d7982c5cad5c42ea6f773'),
                                 ('sales_recon_sale_values(bigint)', '4c4a01eb05adb6d439450063f04eada9'),
                                 ('sales_recon_at_analysis(boolean,jsonb,jsonb)', '192dedca6ea258b54c6108ccbcd2d149') loop
    select md5(p.prosrc) into v_body from pg_proc p where p.oid = to_regprocedure('public.' || v_fn);
    if v_body is not null and v_body <> v_expected then
      raise exception 'R0178 abort: % is % and not the body from 0178 (%). A later version is not dropped blindly.',
        v_fn, v_body, v_expected;
    end if;
  end loop;
  select md5(p.prosrc) into v_body from pg_proc p
   where p.oid = to_regprocedure('public.seller_recon_session(bigint,text,integer,integer)');
  if v_body = '42c2f33b00fa40040a36e2a71637e724' then
    raise notice 'R0178: seller_recon_session already carries the body from 0172.';
  elsif v_body is distinct from 'd70ee33c2b740aa811704ad5e561a34e' then
    raise exception 'R0178 abort: seller_recon_session is % — neither 0172 '
      '(42c2f33b00fa40040a36e2a71637e724) nor 0178 (d70ee33c2b740aa811704ad5e561a34e). A third version is not overwritten blindly.',
      coalesce(v_body, '(none)');
  end if;
end
$pre$;

create or replace function public.seller_recon_session(
  p_id bigint, p_category text default null, p_offset integer default 0, p_limit integer default 50)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_session public.sales_recon_sessions;
begin
  perform public.sales_recon_gate();
  select * into v_session from public.sales_recon_sessions where id = p_id;
  if not found then raise exception 'no such session' using errcode = 'no_data_found'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 200 or p_offset is null or p_offset < 0 then
    raise exception 'a page is 1 to 200 rows from offset 0' using errcode = 'check_violation';
  end if;

  return jsonb_build_object(
    'session', to_jsonb(v_session) - array['created_by', 'closed_by', 'discarded_by'],
    'files', coalesce((select jsonb_agg(to_jsonb(f) order by f.id) from public.sales_recon_files f
                        where f.session_id = p_id), '[]'::jsonb),
    'total', (select count(*) from public.sales_recon_matches m
               where m.session_id = p_id and (p_category is null or m.category = p_category)),
    'matches', coalesce((
      select jsonb_agg(page.entry order by page.row_order)
        from (select m.id as row_order,
                     jsonb_build_object(
                       'id', m.id, 'category', m.category, 'certainty', m.certainty, 'score', m.score,
                       'dateDelta', m.date_delta, 'competitors', m.competitors, 'reason', m.reason,
                       'order', (select to_jsonb(o) - 'session_id' from public.sales_recon_orders o where o.id = m.order_id),
                       'sale', (select jsonb_build_object(
                                  'id', s.id, 'soldOn', s.sold_at, 'itemsSubtotal', s.items_subtotal,
                                  'discount', s.discount_amount, 'shipping', s.shipping_charged,
                                  'cancelledOn', s.cancelled_at::date, 'externalOrderRef', s.external_order_ref,
                                  'source', s.source, 'stale', s.updated_at is distinct from m.sale_updated_at)
                                  from public.sales s where s.id = m.sale_id),
                       'findings', coalesce((
                         select jsonb_agg(jsonb_build_object(
                                  'id', fi.id, 'key', fi.finding_key, 'field', fi.field, 'kind', fi.kind,
                                  'ledger', fi.ledger_value, 'external', fi.external_value, 'delta', fi.delta,
                                  'causes', fi.causes, 'allowedDecisions', to_jsonb(fi.allowed_decisions),
                                  'decision', (select jsonb_build_object(
                                                 'id', d.id, 'decision', d.decision, 'manualValue', d.manual_value,
                                                 'reason', d.reason, 'decidedAt', d.decided_at)
                                                 from public.sales_recon_decisions d
                                                where d.finding_id = fi.id order by d.id desc limit 1),
                                  'applied', exists (select 1 from public.sales_recon_applications a
                                                       join public.sales_recon_decisions d on d.id = a.decision_id
                                                      where d.finding_id = fi.id))
                                order by fi.id)
                           from public.sales_recon_findings fi where fi.match_id = m.id), '[]'::jsonb)) as entry
                from public.sales_recon_matches m
               where m.session_id = p_id and (p_category is null or m.category = p_category)
               order by m.id
              offset p_offset limit p_limit) page), '[]'::jsonb));
end;
$$;

drop function if exists public.seller_recon_pending(bigint);
drop function if exists public.sales_recon_pending_set(bigint);
drop function if exists public.sales_recon_sale_values(bigint);
drop function if exists public.sales_recon_at_analysis(boolean, jsonb, jsonb);

do $post$
begin
  if (select md5(p.prosrc) from pg_proc p
       where p.oid = to_regprocedure('public.seller_recon_session(bigint,text,integer,integer)'))
     is distinct from '42c2f33b00fa40040a36e2a71637e724' then
    raise exception 'R0178 postcondition: seller_recon_session is not the body of 0172';
  end if;
  if not has_function_privilege('authenticated', 'public.seller_recon_session(bigint,text,integer,integer)', 'execute')
     or has_function_privilege('anon', 'public.seller_recon_session(bigint,text,integer,integer)', 'execute') then
    raise exception 'R0178 postcondition: the rights on seller_recon_session moved';
  end if;
  raise notice 'R0178: seller_recon_session is the body of 0172 again; seller_recon_pending and its helpers are gone.';
end
$post$;
