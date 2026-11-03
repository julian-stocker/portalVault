-- ===========================================================================
-- ROLLBACK OF 0176 — seller_recon_create back to the body from `0172`
--
-- WHAT IT DOES: `create or replace` of `seller_recon_create(jsonb)` with the
-- body from `0172`, character for character, then `drop function` of
-- `sales_recon_validate_payload(jsonb)`. `create or replace` keeps the ACL.
--
-- WHAT IT COSTS: the gap is back — a known upload with forbidden content is
-- recognised and answered with its session instead of being refused
-- (nothing is stored in that case, as before 0176). No row, no table, no
-- session changes.
--
-- IT IS IDEMPOTENT: where `seller_recon_create` already carries the body of
-- `0172` and the check function is gone, it says so and changes nothing. It
-- aborts when a THIRD version stands.
--
-- EXECUTION: as one unit (the SQL editor runs it as one implicit
-- transaction), or wrapped in `begin` / `commit`.
-- ===========================================================================

do $pre$
declare
  v_body text;
begin
  select md5(p.prosrc) into v_body from pg_proc p
   where p.oid = to_regprocedure('public.seller_recon_create(jsonb)');
  if v_body = 'c54080be8908ef61589629314c1c0d9c' then
    raise notice 'R0176: seller_recon_create(jsonb) already carries the body from 0172.';
  elsif v_body is distinct from '21fab5ff4ea2c7cb2550f3db821fce0f' then
    raise exception 'R0176 abort: seller_recon_create(jsonb) is % — neither 0172 '
      '(c54080be8908ef61589629314c1c0d9c) nor 0176 (21fab5ff4ea2c7cb2550f3db821fce0f). A third version is not overwritten blindly.',
      coalesce(v_body, '(none)');
  end if;
end
$pre$;

create or replace function public.seller_recon_create(p_payload jsonb)
returns bigint
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_channel text;
  v_session bigint;
  v_files jsonb; v_orders jsonb; v_matches jsonb; v_coverage jsonb; v_summary jsonb;
  v_file jsonb; v_order jsonb; v_line jsonb; v_match jsonb; v_finding jsonb; v_item jsonb;
  v_files_key text;
  v_order_id bigint; v_match_id bigint; v_sale public.sales; v_seen timestamptz;
  v_field text; v_key text;
begin
  perform public.sales_recon_gate();
  perform public.sales_recon_only_keys(p_payload,
    array['channel', 'parser', 'parserVersion', 'coverage', 'summary', 'files', 'orders', 'matches'], 'payload');

  v_channel := public.sales_recon_text(p_payload, 'channel', 16, true, 'payload');
  if v_channel not in ('ebay') then
    raise exception 'unknown channel' using errcode = 'check_violation';
  end if;
  v_files := public.sales_recon_array(p_payload, 'files', 100, 'payload');
  v_orders := public.sales_recon_array(p_payload, 'orders', 5000, 'payload');
  v_matches := public.sales_recon_array(p_payload, 'matches', 10000, 'payload');
  if jsonb_array_length(v_files) = 0 then
    raise exception 'a session needs at least one file' using errcode = 'check_violation';
  end if;

  v_coverage := coalesce(p_payload -> 'coverage', '{}'::jsonb);
  perform public.sales_recon_only_keys(v_coverage,
    array['coveredFrom', 'coveredTo', 'recordFirst', 'recordLast', 'chainComplete'], 'coverage');
  if jsonb_typeof(v_coverage -> 'chainComplete') is distinct from 'boolean' then
    raise exception 'coverage.chainComplete must be true or false' using errcode = 'check_violation';
  end if;

  v_summary := coalesce(p_payload -> 'summary', '{}'::jsonb);
  if jsonb_typeof(v_summary) <> 'object' or not public.sales_recon_numbers_only(v_summary) then
    raise exception 'summary may hold numbers only' using errcode = 'check_violation';
  end if;

  -- The same set of files as an OPEN session: that session, not a second one.
  for v_file in select * from jsonb_array_elements(v_files) loop
    perform public.sales_recon_only_keys(v_file,
      array['fileName', 'fingerprint', 'footerCount', 'orders', 'firstSoldOn', 'lastSoldOn', 'recordFirst', 'recordLast'], 'file');
  end loop;
  select string_agg(distinct f ->> 'fingerprint', ',' order by f ->> 'fingerprint')
    into v_files_key from jsonb_array_elements(v_files) f;
  select id into v_session from public.sales_recon_sessions
   where channel = v_channel and files_key = v_files_key and state = 'open';
  if v_session is not null then
    return v_session;
  end if;

  insert into public.sales_recon_sessions
    (channel, parser, parser_version, files_key, covered_from, covered_to, record_first, record_last,
     chain_complete, summary, created_by)
  values (v_channel,
          public.sales_recon_text(p_payload, 'parser', 64, true, 'payload'),
          public.sales_recon_number(p_payload, 'parserVersion', 1, 1000, true, 'payload')::integer,
          v_files_key,
          public.sales_recon_day(v_coverage, 'coveredFrom', false, 'coverage'),
          public.sales_recon_day(v_coverage, 'coveredTo', false, 'coverage'),
          public.sales_recon_number(v_coverage, 'recordFirst', 0, 100000000, false, 'coverage')::integer,
          public.sales_recon_number(v_coverage, 'recordLast', 0, 100000000, false, 'coverage')::integer,
          (v_coverage ->> 'chainComplete')::boolean,
          v_summary,
          (select auth.uid()))
  /*
   * TWO TABS, ONE UPLOAD. The check above is not enough under concurrency:
   * two calls can both find no open session. The partial unique index
   * decides, and the loser receives the winner's session instead of an
   * error — the same answer as the sequential case.
   */
  on conflict (channel, files_key) where state = 'open' do nothing
  returning id into v_session;
  if v_session is null then
    select id into v_session from public.sales_recon_sessions
     where channel = v_channel and files_key = v_files_key and state = 'open';
    return v_session;
  end if;

  for v_file in select * from jsonb_array_elements(v_files) loop
    insert into public.sales_recon_files
      (session_id, file_name, fingerprint, footer_count, orders, first_sold_on, last_sold_on, record_first, record_last)
    values (v_session,
            public.sales_recon_text(v_file, 'fileName', 200, true, 'file'),
            public.sales_recon_text(v_file, 'fingerprint', 64, true, 'file'),
            public.sales_recon_number(v_file, 'footerCount', 0, 1000000, false, 'file')::integer,
            public.sales_recon_number(v_file, 'orders', 0, 1000000, true, 'file')::integer,
            public.sales_recon_day(v_file, 'firstSoldOn', false, 'file'),
            public.sales_recon_day(v_file, 'lastSoldOn', false, 'file'),
            public.sales_recon_number(v_file, 'recordFirst', 0, 100000000, false, 'file')::integer,
            public.sales_recon_number(v_file, 'recordLast', 0, 100000000, false, 'file')::integer);
  end loop;

  for v_order in select * from jsonb_array_elements(v_orders) loop
    perform public.sales_recon_only_keys(v_order,
      array['channel', 'orderRef', 'recordNo', 'soldOn', 'paidOn', 'shippedOn', 'itemsValue', 'shipping', 'total',
            'pieces', 'combined', 'destinationCountry', 'shippingService', 'sourceFile', 'lines'], 'order');
    if coalesce(v_order ->> 'channel', v_channel) <> v_channel then
      raise exception 'an order of another channel' using errcode = 'check_violation';
    end if;
    if jsonb_typeof(v_order -> 'combined') is distinct from 'boolean' then
      raise exception 'order.combined must be true or false' using errcode = 'check_violation';
    end if;
    for v_line in select * from jsonb_array_elements(public.sales_recon_array(v_order, 'lines', 500, 'order')) loop
      perform public.sales_recon_only_keys(v_line,
        array['lineRef', 'listingId', 'title', 'variant', 'name', 'quantity', 'unitPrice', 'value'], 'line');
      perform public.sales_recon_text(v_line, 'lineRef', 64, false, 'line');
      perform public.sales_recon_text(v_line, 'listingId', 32, true, 'line');
      perform public.sales_recon_text(v_line, 'title', 300, true, 'line');
      perform public.sales_recon_text(v_line, 'variant', 300, false, 'line');
      perform public.sales_recon_text(v_line, 'name', 200, true, 'line');
      perform public.sales_recon_number(v_line, 'quantity', 1, 10000, true, 'line');
      perform public.sales_recon_number(v_line, 'unitPrice', 0, 1000000, true, 'line');
      perform public.sales_recon_number(v_line, 'value', 0, 1000000, true, 'line');
    end loop;
    insert into public.sales_recon_orders
      (session_id, channel, order_ref, record_no, sold_on, paid_on, shipped_on, items_value, shipping, total,
       pieces, combined, destination_country, shipping_service, source_file, lines)
    values (v_session, v_channel,
            public.sales_recon_text(v_order, 'orderRef', 64, true, 'order'),
            public.sales_recon_number(v_order, 'recordNo', 0, 100000000, false, 'order')::integer,
            public.sales_recon_day(v_order, 'soldOn', true, 'order'),
            public.sales_recon_day(v_order, 'paidOn', false, 'order'),
            public.sales_recon_day(v_order, 'shippedOn', false, 'order'),
            public.sales_recon_number(v_order, 'itemsValue', 0, 1000000, true, 'order'),
            public.sales_recon_number(v_order, 'shipping', 0, 1000000, true, 'order'),
            public.sales_recon_number(v_order, 'total', 0, 1000000, true, 'order'),
            public.sales_recon_number(v_order, 'pieces', 0, 10000, true, 'order')::integer,
            (v_order ->> 'combined')::boolean,
            public.sales_recon_text(v_order, 'destinationCountry', 2, false, 'order'),
            public.sales_recon_text(v_order, 'shippingService', 100, false, 'order'),
            public.sales_recon_text(v_order, 'sourceFile', 200, true, 'order'),
            v_order -> 'lines');
  end loop;

  for v_match in select * from jsonb_array_elements(v_matches) loop
    perform public.sales_recon_only_keys(v_match,
      array['orderRef', 'saleId', 'saleUpdatedAt', 'category', 'certainty', 'score', 'dateDelta',
            'competitors', 'reason', 'findings'], 'match');

    v_order_id := null;
    if public.sales_recon_text(v_match, 'orderRef', 64, false, 'match') is not null then
      select o.id into v_order_id from public.sales_recon_orders o
       where o.session_id = v_session and o.order_ref = v_match ->> 'orderRef';
      if v_order_id is null then
        raise exception 'a match names an order that is not in this session' using errcode = 'check_violation';
      end if;
    end if;

    v_sale := null;
    v_seen := null;
    if public.sales_recon_number(v_match, 'saleId', 1, 9223372036854775807, false, 'match') is not null then
      select * into v_sale from public.sales where id = (v_match ->> 'saleId')::bigint;
      if not found then
        raise exception 'a match names a sale that does not exist' using errcode = 'no_data_found';
      end if;
      if v_sale.channel <> v_channel or v_sale.order_id is not null then
        raise exception 'a match names a sale of another channel or an internal sale' using errcode = 'check_violation';
      end if;
      v_seen := (public.sales_recon_text(v_match, 'saleUpdatedAt', 40, true, 'match'))::timestamptz;
      if v_sale.updated_at is distinct from v_seen then
        raise exception 'sale % changed while it was being analysed — analyse again', v_sale.id
          using errcode = 'PT409';
      end if;
    end if;

    for v_item in select * from jsonb_array_elements(public.sales_recon_array(v_match, 'competitors', 50, 'match')) loop
      perform public.sales_recon_only_keys(v_item, array['orderRef', 'saleId', 'score'], 'competitor');
      perform public.sales_recon_text(v_item, 'orderRef', 64, true, 'competitor');
      perform public.sales_recon_number(v_item, 'saleId', 1, 9223372036854775807, true, 'competitor');
      perform public.sales_recon_number(v_item, 'score', -1000, 1000, true, 'competitor');
    end loop;

    insert into public.sales_recon_matches
      (session_id, order_id, sale_id, category, certainty, score, date_delta, competitors, reason, sale_updated_at)
    values (v_session, v_order_id, v_sale.id,
            public.sales_recon_text(v_match, 'category', 32, true, 'match'),
            public.sales_recon_text(v_match, 'certainty', 32, false, 'match'),
            public.sales_recon_number(v_match, 'score', -1000, 1000, false, 'match'),
            public.sales_recon_number(v_match, 'dateDelta', -100000, 100000, false, 'match')::integer,
            coalesce(v_match -> 'competitors', '[]'::jsonb),
            public.sales_recon_text(v_match, 'reason', 32, false, 'match'),
            v_seen)
    returning id into v_match_id;

    for v_finding in select * from jsonb_array_elements(public.sales_recon_array(v_match, 'findings', 200, 'match')) loop
      perform public.sales_recon_only_keys(v_finding,
        array['key', 'field', 'kind', 'ledger', 'external', 'delta', 'causes'], 'finding');
      if v_order_id is null or v_sale.id is null then
        raise exception 'only a pair of order and sale has findings' using errcode = 'check_violation';
      end if;
      v_key := public.sales_recon_text(v_finding, 'key', 32, true, 'finding');
      v_field := public.sales_recon_text(v_finding, 'field', 32, true, 'finding');
      if jsonb_typeof(coalesce(v_finding -> 'ledger', 'null'::jsonb)) not in ('string', 'number', 'null')
         or jsonb_typeof(coalesce(v_finding -> 'external', 'null'::jsonb)) not in ('string', 'number', 'null')
         or length(coalesce(v_finding ->> 'ledger', '')) > 300
         or length(coalesce(v_finding ->> 'external', '')) > 300 then
        raise exception 'a finding value is one short scalar' using errcode = 'check_violation';
      end if;
      if jsonb_typeof(v_finding -> 'ledger') = 'string' then
        perform public.sales_recon_no_contact(v_finding ->> 'ledger', 'finding.ledger');
      end if;
      if jsonb_typeof(v_finding -> 'external') = 'string' then
        perform public.sales_recon_no_contact(v_finding ->> 'external', 'finding.external');
      end if;
      for v_item in select * from jsonb_array_elements(public.sales_recon_array(v_finding, 'causes', 20, 'finding')) loop
        perform public.sales_recon_only_keys(v_item, array['code', 'amount'], 'cause');
        if public.sales_recon_text(v_item, 'code', 64, true, 'cause') !~ '^[a-z_]+$' then
          raise exception 'a cause code is a plain word' using errcode = 'check_violation';
        end if;
        perform public.sales_recon_number(v_item, 'amount', -1000000, 1000000, false, 'cause');
      end loop;
      insert into public.sales_recon_findings
        (match_id, finding_key, field, kind, ledger_value, external_value, delta, causes, allowed_decisions)
      values (v_match_id, v_key, v_field,
              public.sales_recon_text(v_finding, 'kind', 16, true, 'finding'),
              coalesce(v_finding -> 'ledger', 'null'::jsonb),
              coalesce(v_finding -> 'external', 'null'::jsonb),
              public.sales_recon_number(v_finding, 'delta', -100000000, 100000000, false, 'finding'),
              coalesce(v_finding -> 'causes', '[]'::jsonb),
              coalesce(public.sales_recon_allowed(v_field), array[]::text[]));
    end loop;
  end loop;

  return v_session;
end;
$$;

drop function if exists public.sales_recon_validate_payload(jsonb);

do $post$
begin
  if (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_recon_create(jsonb)'))
     is distinct from 'c54080be8908ef61589629314c1c0d9c' then
    raise exception 'R0176 postcondition: seller_recon_create is not the body from 0172';
  end if;
  if to_regprocedure('public.sales_recon_validate_payload(jsonb)') is not null then
    raise exception 'R0176 postcondition: sales_recon_validate_payload still exists';
  end if;
  raise notice 'R0176: seller_recon_create is the body from 0172 again; a known upload is recognised before its content is checked.';
end
$post$;
