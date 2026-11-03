-- ===========================================================================
-- 0172 — SALES RECONCILIATION: READING, RECORDING, DECIDING (ADR-0174)
--
-- ###########################################################################
-- ##  NOT APPLIED — neither on Staging nor on Production.                  ##
-- ##  Staging only, after a separate approval by the operator.             ##
-- ###########################################################################
--
-- The functions around the record of `0169`. Applying a decision is `0173`.
--
--   seller_recon_candidates(channel, from, to)   the sales to compare against
--   seller_recon_aliases(channel)                names each SKY-ID was sold under
--   seller_recon_create(payload)                 store one analysed session
--   seller_recon_sessions()                      list
--   seller_recon_session(id, category, offset, limit)   read, page by page
--   seller_recon_decide(finding, decision, …)    record one decision
--   seller_recon_close(id) / seller_recon_discard(id)
--   seller_recon_thin_snapshots(id)             thin out a finished session
--
-- EVERY FUNCTION: `security definer`, empty `search_path`, gated by
-- `can_operate_active_seller()` (ADR-0077), EXECUTE for `authenticated` only.
-- The internal helpers hold no client right at all.
--
-- THE PAYLOAD IS NOT TRUSTED. The analysis runs in TypeScript (the server
-- action), but anybody with a session could call `seller_recon_create`
-- directly. So the database checks everything it stores itself:
--
--   * EVERY object, at every level, may only carry its listed keys. An
--     unknown key — `buyerName`, `address`, anything — aborts the whole call.
--     This is the third lock against buyer data, after the browser parser
--     and the schema.
--   * Every text has a length limit, every amount a range, every date a shape.
--   * The session summary may hold numbers only (and short keys).
--   * Every sale named must exist, be external and belong to the channel, and
--     its `updated_at` must still be what the analysis read — otherwise PT409.
--   * The decisions a finding allows are computed HERE from its field, not
--     taken from the payload.
--
-- DECIDING follows the pattern of `0156`: the caller sends the values the
-- screen SHOWED; they must equal the stored finding, and the sale must be
-- unchanged since the analysis. Otherwise PT409, and nothing is recorded.
--
-- Rollback: `supabase/rollback/R0169_0173_drop_sales_reconciliation.sql`.
-- ===========================================================================


do $pre$
begin
  if to_regclass('public.sales_recon_sessions') is null then
    raise exception '0172 needs 0169: sales_recon_sessions is missing';
  end if;
  if to_regprocedure('public.seller_cancel_external_sale(bigint,text,date,timestamptz)') is null then
    raise exception '0172 needs 0170: seller_cancel_external_sale is missing';
  end if;
  if to_regprocedure('public.seller_recon_create(jsonb)') is not null then
    raise exception '0172 is already applied: seller_recon_create exists';
  end if;
end
$pre$;


-- ---------------------------------------------------------------------------
-- 1. Internal helpers — no client right
-- ---------------------------------------------------------------------------

create or replace function public.sales_recon_gate()
returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;
end;
$$;

/* An object with only the listed keys. Names the unknown keys, never a value. */
create or replace function public.sales_recon_only_keys(p_obj jsonb, p_allowed text[], p_what text)
returns void
language plpgsql immutable set search_path = ''
as $$
declare v_unknown text;
begin
  if p_obj is null or jsonb_typeof(p_obj) <> 'object' then
    raise exception '% must be an object', p_what using errcode = 'check_violation';
  end if;
  select string_agg(k, ', ' order by k) into v_unknown
    from jsonb_object_keys(p_obj) k
   where not (k = any (p_allowed));
  if v_unknown is not null then
    raise exception '% carries unknown field(s): %', p_what, v_unknown using errcode = 'check_violation';
  end if;
end;
$$;

/*
 * NO CONTACT DATA IN FREE TEXT. The key whitelist keeps buyer FIELDS out;
 * this keeps buyer DATA out of the fields that remain free text — a title,
 * a variation, a reason. It refuses what is unambiguously contact data: an
 * e-mail address, and a phone number in international form (`+49 …`). A
 * plain digit run is NOT refused — portal model numbers (`84148790`) and
 * order numbers are digit runs too. Names the field, never the value.
 */
create or replace function public.sales_recon_no_contact(p_text text, p_what text)
returns void
language plpgsql immutable set search_path = ''
as $$
begin
  if p_text is null then return; end if;
  if p_text ~* '[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}' then
    raise exception '% looks like it contains an e-mail address', p_what using errcode = 'check_violation';
  end if;
  if p_text ~ '\+[0-9]{2}[0-9 /().-]{6,}[0-9]' then
    raise exception '% looks like it contains a phone number', p_what using errcode = 'check_violation';
  end if;
end;
$$;

/* A string field, trimmed, NULL when absent or JSON null; refused when too long. */
create or replace function public.sales_recon_text(p_obj jsonb, p_key text, p_max integer, p_required boolean, p_what text)
returns text
language plpgsql immutable set search_path = ''
as $$
declare v jsonb := p_obj -> p_key; t text;
begin
  if v is null or jsonb_typeof(v) = 'null' then
    if p_required then raise exception '%.% is required', p_what, p_key using errcode = 'check_violation'; end if;
    return null;
  end if;
  if jsonb_typeof(v) <> 'string' then
    raise exception '%.% must be text', p_what, p_key using errcode = 'check_violation';
  end if;
  t := btrim(v #>> '{}');
  if length(t) > p_max then
    raise exception '%.% is longer than % characters', p_what, p_key, p_max using errcode = 'check_violation';
  end if;
  if t = '' then
    if p_required then raise exception '%.% is required', p_what, p_key using errcode = 'check_violation'; end if;
    return null;
  end if;
  perform public.sales_recon_no_contact(t, p_what || '.' || p_key);
  return t;
end;
$$;

create or replace function public.sales_recon_number(p_obj jsonb, p_key text, p_min numeric, p_max numeric, p_required boolean, p_what text)
returns numeric
language plpgsql immutable set search_path = ''
as $$
declare v jsonb := p_obj -> p_key; n numeric;
begin
  if v is null or jsonb_typeof(v) = 'null' then
    if p_required then raise exception '%.% is required', p_what, p_key using errcode = 'check_violation'; end if;
    return null;
  end if;
  if jsonb_typeof(v) <> 'number' then
    raise exception '%.% must be a number', p_what, p_key using errcode = 'check_violation';
  end if;
  n := (v #>> '{}')::numeric;
  if n < p_min or n > p_max then
    raise exception '%.% is outside % … %', p_what, p_key, p_min, p_max using errcode = 'check_violation';
  end if;
  return n;
end;
$$;

create or replace function public.sales_recon_day(p_obj jsonb, p_key text, p_required boolean, p_what text)
returns date
language plpgsql immutable set search_path = ''
as $$
declare t text := public.sales_recon_text(p_obj, p_key, 10, p_required, p_what);
begin
  if t is null then return null; end if;
  if t !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception '%.% is not a day (YYYY-MM-DD)', p_what, p_key using errcode = 'check_violation';
  end if;
  return t::date;
exception when datetime_field_overflow or invalid_datetime_format then
  raise exception '%.% is not a valid day', p_what, p_key using errcode = 'check_violation';
end;
$$;

create or replace function public.sales_recon_array(p_obj jsonb, p_key text, p_max integer, p_what text)
returns jsonb
language plpgsql immutable set search_path = ''
as $$
declare v jsonb := coalesce(p_obj -> p_key, '[]'::jsonb);
begin
  if jsonb_typeof(v) <> 'array' then
    raise exception '%.% must be a list', p_what, p_key using errcode = 'check_violation';
  end if;
  if jsonb_array_length(v) > p_max then
    raise exception '%.% has more than % entries', p_what, p_key, p_max using errcode = 'check_violation';
  end if;
  return v;
end;
$$;

/* Numbers only, under short plain keys — a summary can carry no name. */
create or replace function public.sales_recon_numbers_only(p jsonb)
returns boolean
language sql immutable set search_path = ''
as $$
  select case jsonb_typeof(p)
    when 'number' then true
    when 'object' then coalesce((select bool_and(e.key ~ '^[A-Za-z0-9_-]{1,40}$'
                                                 and public.sales_recon_numbers_only(e.value))
                                   from jsonb_each(p) e), true)
    else false end
$$;

/*
 * THE DECISIONS A FIELD ALLOWS — the one place this is decided.
 *
 *   sold_on, items_net, shipping   a value: take, keep, correct, later
 *   external_order_ref             an ADDITION: take or not, never "correct"
 *   total                          an EVENT (refund, cancellation): never a
 *                                  value to copy — only by hand, with reason
 *   pieces, figure                 V1 never changes `sale_items`: only a
 *                                  documented clarification (ADR-0174)
 */
create or replace function public.sales_recon_allowed(p_field text)
returns text[]
language sql immutable set search_path = ''
as $$
  select case p_field
    when 'sold_on'            then array['take_external', 'keep_ledger', 'manual', 'defer']
    when 'items_net'          then array['take_external', 'keep_ledger', 'manual', 'defer']
    when 'shipping'           then array['take_external', 'keep_ledger', 'manual', 'defer']
    when 'external_order_ref' then array['take_external', 'keep_ledger', 'defer']
    when 'total'              then array['manual', 'keep_ledger', 'defer']
    when 'pieces'             then array['manual', 'keep_ledger', 'defer']
    when 'figure'             then array['manual', 'keep_ledger', 'defer']
  end::text[]
$$;

revoke all on function public.sales_recon_gate() from public, anon, authenticated;
revoke all on function public.sales_recon_only_keys(jsonb, text[], text) from public, anon, authenticated;
revoke all on function public.sales_recon_no_contact(text, text) from public, anon, authenticated;
revoke all on function public.sales_recon_text(jsonb, text, integer, boolean, text) from public, anon, authenticated;
revoke all on function public.sales_recon_number(jsonb, text, numeric, numeric, boolean, text) from public, anon, authenticated;
revoke all on function public.sales_recon_day(jsonb, text, boolean, text) from public, anon, authenticated;
revoke all on function public.sales_recon_array(jsonb, text, integer, text) from public, anon, authenticated;
revoke all on function public.sales_recon_numbers_only(jsonb) from public, anon, authenticated;
revoke all on function public.sales_recon_allowed(text) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 2. What the analysis compares against
-- ---------------------------------------------------------------------------

/*
 * Every external sale of the channel whose day lies within the period ±3
 * days, test sales included (the analysis must be able to say "not
 * comparable: test"), with its pieces. Amounts are those of the SALE.
 */
create or replace function public.seller_recon_candidates(p_channel text, p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.sales_recon_gate();
  if p_channel is null or p_channel not in ('ebay') then
    raise exception 'unknown channel' using errcode = 'check_violation';
  end if;
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 400 then
    raise exception 'a period of at most 400 days is required' using errcode = 'check_violation';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'saleId', s.id,
             'source', s.source,
             'isTest', s.is_test,
             'soldOn', s.sold_at,
             'itemsSubtotal', coalesce(s.items_subtotal, 0),
             'discount', coalesce(s.discount_amount, 0),
             'shipping', coalesce(s.shipping_charged, 0),
             'refundsTotal', coalesce((select sum(r.amount) from public.sale_refunds r where r.sale_id = s.id), 0),
             'cancelledOn', s.cancelled_at::date,
             'externalOrderRef', s.external_order_ref,
             'updatedAt', s.updated_at,
             'pieces', coalesce((
               select jsonb_agg(jsonb_build_object(
                        'itemId', i.id, 'skyId', i.sky_id, 'name', k.name, 'rawName', i.raw_name,
                        'seriesCode', k.series_code, 'baseSkyId', k.base_sky_id)
                      order by i.position, i.id)
                 from public.sale_items i
                 left join public.skylanders k on k.sky_id = i.sky_id
                where i.sale_id = s.id), '[]'::jsonb))
           order by s.sold_at, s.id)
      from public.sales s
     where s.channel = p_channel
       and s.order_id is null
       and s.sold_at between p_from - 3 and p_to + 3), '[]'::jsonb);
end;
$$;

/* The ledger as alias table: every name a SKY-ID was sold under on this channel. */
create or replace function public.seller_recon_aliases(p_channel text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.sales_recon_gate();
  if p_channel is null or p_channel not in ('ebay') then
    raise exception 'unknown channel' using errcode = 'check_violation';
  end if;
  return coalesce((
    select jsonb_object_agg(x.sky_id, x.names)
      from (select n.sky_id, jsonb_agg(distinct n.name) as names
              from (select i.sky_id, i.raw_name as name
                      from public.sale_items i join public.sales s on s.id = i.sale_id
                     where s.channel = p_channel and s.order_id is null
                       and i.sky_id is not null and i.raw_name is not null
                    union
                    select k.sky_id, k.name
                      from public.skylanders k
                     where exists (select 1 from public.sale_items i join public.sales s on s.id = i.sale_id
                                    where i.sky_id = k.sky_id and s.channel = p_channel)) n
             group by n.sky_id) x), '{}'::jsonb);
end;
$$;


-- ---------------------------------------------------------------------------
-- 3. Recording one analysed session — one transaction, or nothing
-- ---------------------------------------------------------------------------

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


-- ---------------------------------------------------------------------------
-- 4. Reading
-- ---------------------------------------------------------------------------

create or replace function public.seller_recon_sessions()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.sales_recon_gate();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', s.id, 'channel', s.channel, 'state', s.state,
             'coveredFrom', s.covered_from, 'coveredTo', s.covered_to, 'chainComplete', s.chain_complete,
             'createdAt', s.created_at, 'closedAt', s.closed_at, 'discardedAt', s.discarded_at,
             'snapshotsPurgedAt', s.snapshots_purged_at, 'summary', s.summary,
             'files', (select count(*) from public.sales_recon_files f where f.session_id = s.id),
             'decided', (select count(distinct d.finding_id) from public.sales_recon_decisions d
                           join public.sales_recon_findings fi on fi.id = d.finding_id
                           join public.sales_recon_matches m on m.id = fi.match_id
                          where m.session_id = s.id),
             'applied', (select count(*) from public.sales_recon_applications a where a.session_id = s.id))
           order by s.id desc)
      from public.sales_recon_sessions s), '[]'::jsonb);
end;
$$;

/*
 * One session, one page of matches. Each match carries its order (header and,
 * unless purged, the positions), the sale AS IT IS NOW with a `stale` flag,
 * and its findings with the current decision and whether it was applied.
 */
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


-- ---------------------------------------------------------------------------
-- 5. Deciding — one finding, one row, never an overwrite
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
-- 6. Ending a session, and thinning out a finished one
-- ---------------------------------------------------------------------------

create or replace function public.seller_recon_close(p_id bigint)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
begin
  perform public.sales_recon_gate();
  update public.sales_recon_sessions
     set state = 'closed', closed_at = now(), closed_by = (select auth.uid())
   where id = p_id and state = 'open';
  if not found then
    raise exception 'no open session %', p_id using errcode = 'restrict_violation';
  end if;
end;
$$;

/* Discarding means "nothing from here": refused once anything was applied — close it instead. */
create or replace function public.seller_recon_discard(p_id bigint)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
begin
  perform public.sales_recon_gate();
  if exists (select 1 from public.sales_recon_applications where session_id = p_id) then
    raise exception 'decisions of this session were applied — close it instead' using errcode = 'restrict_violation';
  end if;
  update public.sales_recon_sessions
     set state = 'discarded', discarded_at = now(), discarded_by = (select auth.uid())
   where id = p_id and state = 'open';
  if not found then
    raise exception 'no open session %', p_id using errcode = 'restrict_violation';
  end if;
end;
$$;

/*
 * THE RETENTION RULE. A finished session keeps everything an audit needs —
 * order headers, matches, findings with both values, decisions, applications
 * — and may drop the position lists (titles, variations). Idempotent.
 */
create or replace function public.seller_recon_thin_snapshots(p_id bigint)
returns integer
language plpgsql volatile security definer set search_path = ''
as $$
declare v_state text; v_count integer;
begin
  perform public.sales_recon_gate();
  select state into v_state from public.sales_recon_sessions where id = p_id for update;
  if not found then raise exception 'no such session' using errcode = 'no_data_found'; end if;
  if v_state = 'open' then
    raise exception 'an open session keeps its snapshots' using errcode = 'restrict_violation';
  end if;
  update public.sales_recon_orders set lines = null where session_id = p_id and lines is not null;
  get diagnostics v_count = row_count;
  update public.sales_recon_sessions set snapshots_purged_at = coalesce(snapshots_purged_at, now()) where id = p_id;
  return v_count;
end;
$$;


-- ---------------------------------------------------------------------------
-- 7. Rights: the seller functions for `authenticated`, nothing for anyone else
-- ---------------------------------------------------------------------------
revoke all on function public.seller_recon_candidates(text, date, date) from public, anon;
revoke all on function public.seller_recon_aliases(text) from public, anon;
revoke all on function public.seller_recon_create(jsonb) from public, anon;
revoke all on function public.seller_recon_sessions() from public, anon;
revoke all on function public.seller_recon_session(bigint, text, integer, integer) from public, anon;
revoke all on function public.seller_recon_decide(bigint, text, jsonb, text, jsonb, jsonb) from public, anon;
revoke all on function public.seller_recon_close(bigint) from public, anon;
revoke all on function public.seller_recon_discard(bigint) from public, anon;
revoke all on function public.seller_recon_thin_snapshots(bigint) from public, anon;

grant execute on function public.seller_recon_candidates(text, date, date) to authenticated;
grant execute on function public.seller_recon_aliases(text) to authenticated;
grant execute on function public.seller_recon_create(jsonb) to authenticated;
grant execute on function public.seller_recon_sessions() to authenticated;
grant execute on function public.seller_recon_session(bigint, text, integer, integer) to authenticated;
grant execute on function public.seller_recon_decide(bigint, text, jsonb, text, jsonb, jsonb) to authenticated;
grant execute on function public.seller_recon_close(bigint) to authenticated;
grant execute on function public.seller_recon_discard(bigint) to authenticated;
grant execute on function public.seller_recon_thin_snapshots(bigint) to authenticated;
