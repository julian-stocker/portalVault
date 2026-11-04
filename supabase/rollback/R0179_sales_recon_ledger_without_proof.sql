-- ===========================================================================
-- ROLLBACK OF 0179 — seller_recon_session back to the body from `0178`,
--                    sales_recon_ledger and sales_recon_proven dropped
--
-- WHAT IT DOES: `create or replace` of
-- `seller_recon_session(bigint, text, integer, integer)` with the body from
-- `0178`, character for character (`create or replace` keeps the ACL), then
-- `drop function` of `sales_recon_ledger(bigint)` and
-- `sales_recon_proven(jsonb, text, jsonb, boolean)`. `sales_recon_at_analysis`
-- (0178) stood all along and is called again.
--
-- WHAT IT COSTS: `ledger.atAnalysis` claims `derived` again without proof —
-- the finding of the functional read check (session 3) is back. No row, no
-- session, no decision and no sale changes — 0179 only reads.
--
-- IT OVERWRITES AND DROPS ONLY WHAT 0179 WROTE. It refuses while either
-- helper carries a body other than the one from 0179, and while the session
-- read is neither 0178 nor 0179. Idempotent: where the 0178 read stands and
-- both helpers are gone, it says so and changes nothing.
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
  for v_fn, v_expected in values ('sales_recon_ledger(bigint)', '07875fe3ba889fefab1c55dbe67005d9'),
                                 ('sales_recon_proven(jsonb,text,jsonb,boolean)', 'b7b36ccd5efdd57e661808b62274df68') loop
    select md5(p.prosrc) into v_body from pg_proc p where p.oid = to_regprocedure('public.' || v_fn);
    if v_body is not null and v_body <> v_expected then
      raise exception 'R0179 abort: % is % and not the body from 0179 (%). A later version is not dropped blindly.',
        v_fn, v_body, v_expected;
    end if;
  end loop;
  if to_regprocedure('public.sales_recon_at_analysis(boolean,jsonb,jsonb)') is null then
    raise exception 'R0179 abort: sales_recon_at_analysis (0178) is missing — the 0178 read would not run';
  end if;
  select md5(p.prosrc) into v_body from pg_proc p
   where p.oid = to_regprocedure('public.seller_recon_session(bigint,text,integer,integer)');
  if v_body = 'd70ee33c2b740aa811704ad5e561a34e' then
    raise notice 'R0179: seller_recon_session already carries the body from 0178.';
  elsif v_body is distinct from '5ed52447581cc895efc6a56f268c0da3' then
    raise exception 'R0179 abort: seller_recon_session is % — neither 0178 '
      '(d70ee33c2b740aa811704ad5e561a34e) nor 0179 (5ed52447581cc895efc6a56f268c0da3). A third version is not overwritten blindly.',
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
                       /*
                        * 0178: the SkyIsles side of the comparison — at analysis,
                        * now, and how the two relate (see the header).
                        */
                       'ledger', (select jsonb_build_object(
                                    'state', case
                                      when s.updated_at is distinct from m.sale_updated_at then 'changed'
                                      when exists (select 1 from public.sales_recon_applications a
                                                    where a.session_id = m.session_id and a.sale_id = m.sale_id
                                                      and a.outcome = 'applied') then 'applied'
                                      else 'unchanged' end,
                                    'version', jsonb_build_object('analysed', m.sale_updated_at, 'current', s.updated_at),
                                    'current', public.sales_recon_sale_values(s.id),
                                    'atAnalysis', jsonb_build_object(
                                      'soldOn', public.sales_recon_at_analysis(o.id is not null, fx.sold_on, to_jsonb(o.sold_on)),
                                      'itemsNet', public.sales_recon_at_analysis(o.id is not null, fx.items_net, to_jsonb(o.items_value)),
                                      'shipping', public.sales_recon_at_analysis(o.id is not null, fx.shipping, to_jsonb(o.shipping)),
                                      'expectedTotal', public.sales_recon_at_analysis(o.id is not null, fx.total, to_jsonb(o.total)),
                                      'pieces', public.sales_recon_at_analysis(o.id is not null, fx.pieces, to_jsonb(o.pieces))))
                                    from public.sales s
                                    left join public.sales_recon_orders o on o.id = m.order_id
                                    cross join lateral (
                                      select max(fi.ledger_value::text) filter (where fi.finding_key = 'sold_on')::jsonb as sold_on,
                                             max(fi.ledger_value::text) filter (where fi.finding_key = 'items_net')::jsonb as items_net,
                                             max(fi.ledger_value::text) filter (where fi.finding_key = 'shipping')::jsonb as shipping,
                                             max(fi.ledger_value::text) filter (where fi.finding_key = 'total')::jsonb as total,
                                             max(fi.ledger_value::text) filter (where fi.finding_key = 'pieces')::jsonb as pieces
                                        from public.sales_recon_findings fi where fi.match_id = m.id) fx
                                   where s.id = m.sale_id),
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

drop function if exists public.sales_recon_ledger(bigint);
drop function if exists public.sales_recon_proven(jsonb, text, jsonb, boolean);

do $post$
begin
  if (select md5(p.prosrc) from pg_proc p
       where p.oid = to_regprocedure('public.seller_recon_session(bigint,text,integer,integer)'))
     is distinct from 'd70ee33c2b740aa811704ad5e561a34e' then
    raise exception 'R0179 postcondition: seller_recon_session is not the body of 0178';
  end if;
  if not has_function_privilege('authenticated', 'public.seller_recon_session(bigint,text,integer,integer)', 'execute')
     or has_function_privilege('anon', 'public.seller_recon_session(bigint,text,integer,integer)', 'execute') then
    raise exception 'R0179 postcondition: the rights on seller_recon_session moved';
  end if;
  raise notice 'R0179: seller_recon_session is the body of 0178 again; sales_recon_ledger and sales_recon_proven are gone.';
end
$post$;
