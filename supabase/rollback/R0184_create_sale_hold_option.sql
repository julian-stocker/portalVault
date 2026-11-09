-- ===========================================================================
-- ROLLBACK OF 0184 — seller_create_sale_with_details back to 0110's 15 arguments
--
-- WHAT IT DOES: drops the 16-argument function (with `p_hold`) and creates
-- the body of `0110` character for character, with 0065's comment and
-- rights. Afterwards every sale is created holding as before 0184.
--
-- WHAT IT DOES NOT TOUCH: sales created without a hold stay as they are —
-- their positions may be held or booked later by hand. No table, no row.
-- Callers that send `p_hold` fail afterwards (PGRST202): roll back the app
-- first, or together.
-- ===========================================================================

do $pre$
begin
  if to_regprocedure('public.seller_create_sale_with_details(text,date,text,text,text,text,boolean,numeric,numeric,numeric,jsonb,jsonb,jsonb,numeric,text,boolean)') is null then
    raise exception 'R0184 abort: the 16-argument seller_create_sale_with_details is not there — nothing to roll back';
  end if;
end
$pre$;

drop function public.seller_create_sale_with_details(text, date, text, text, text, text, boolean, numeric, numeric, numeric, jsonb, jsonb, jsonb, numeric, text, boolean);

create or replace function public.seller_create_sale_with_details(
  p_channel          text,
  p_sold_at          date    default null,
  p_country          text    default null,
  p_external_ref     text    default null,
  p_buyer_ref        text    default null,
  p_note             text    default null,
  p_is_test          boolean default false,
  p_items_subtotal   numeric default 0,
  p_shipping_charged numeric default 0,
  p_discount_amount  numeric default 0,
  p_items            jsonb   default '[]'::jsonb,
  p_fees             jsonb   default '[]'::jsonb,
  p_adjustments      jsonb   default '[]'::jsonb,
  p_payout_amount    numeric default null,
  p_payout_ref       text    default null
)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id      bigint;
  v_element jsonb;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;

  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_fees, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_adjustments, '[]'::jsonb)) <> 'array'
  then
    raise exception 'items, fees and adjustments must each be a json array'
      using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) > 200
     or jsonb_array_length(coalesce(p_fees, '[]'::jsonb)) > 20
     or jsonb_array_length(coalesce(p_adjustments, '[]'::jsonb)) > 20
  then
    raise exception 'too many items, fees or adjustments in one sale'
      using errcode = 'program_limit_exceeded';
  end if;

  /*
   * DIE SPERRORDNUNG, EINMAL UND AUFSTEIGEND (0110). Siehe den Kopf dieses
   * Abschnitts. Rein lesend — `for update` nimmt die Zeilensperren, ohne
   * etwas zu verändern.
   */
  perform 1
     from public.shop_inventory i
    where i.condition = public.v1_sale_condition()
      and i.sky_id in (
        select nullif(btrim(coalesce(e->>'sky_id', '')), '')
          from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e)
    order by i.id
      for update;

  v_id := public.seller_create_sale(p_channel, p_sold_at, p_country,
                                    p_external_ref, p_buyer_ref, p_note, p_is_test);

  update public.sales
     set items_subtotal   = coalesce(p_items_subtotal, 0),
         shipping_charged = coalesce(p_shipping_charged, 0),
         discount_amount  = coalesce(p_discount_amount, 0)
   where id = v_id;

  for v_element in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    if jsonb_typeof(v_element) <> 'object' then
      raise exception 'every item must be a json object' using errcode = 'invalid_parameter_value';
    end if;
    -- Hält mit (0110): der Hold entsteht in seller_add_sale_item.
    perform public.seller_add_sale_item(
      v_id,
      nullif(btrim(coalesce(v_element->>'sky_id', '')), ''),
      nullif(btrim(coalesce(v_element->>'raw_name', '')), ''),
      coalesce(nullif(btrim(coalesce(v_element->>'condition', '')), ''), 'loose')
    );
  end loop;

  for v_element in select * from jsonb_array_elements(coalesce(p_fees, '[]'::jsonb)) loop
    if jsonb_typeof(v_element) <> 'object' then
      raise exception 'every fee must be a json object' using errcode = 'invalid_parameter_value';
    end if;
    perform public.seller_add_sale_fee(
      v_id,
      v_element->>'kind',
      (v_element->>'amount')::numeric,
      v_element->>'settled_by',
      nullif(btrim(coalesce(v_element->>'label', '')), ''),
      nullif(btrim(coalesce(v_element->>'note', '')), '')
    );
  end loop;

  for v_element in select * from jsonb_array_elements(coalesce(p_adjustments, '[]'::jsonb)) loop
    if jsonb_typeof(v_element) <> 'object' then
      raise exception 'every adjustment must be a json object'
        using errcode = 'invalid_parameter_value';
    end if;
    perform public.seller_add_settlement_adjustment(
      v_id,
      p_channel,
      (v_element->>'amount')::numeric,
      nullif(btrim(coalesce(v_element->>'reason', '')), ''),
      nullif(btrim(coalesce(v_element->>'external_ref', '')), ''),
      nullif(btrim(coalesce(v_element->>'note', '')), ''),
      (nullif(btrim(coalesce(v_element->>'occurred_at', '')), ''))::date
    );
  end loop;

  if p_payout_amount is not null then
    perform public.seller_set_sale_payout(v_id, p_payout_amount, p_payout_ref, null, null);
  end if;

  return v_id;
end;
$$;

comment on function public.seller_create_sale_with_details(text, date, text, text, text, text, boolean, numeric, numeric, numeric, jsonb, jsonb, jsonb, numeric, text) is
  'Creates one external sale together with its amounts, items, fees, adjustments and reported payout in a single transaction (0065). One item element per physical unit — duplicates are expected and are not collapsed. Moves NO stock: seller_book_sale_item remains the only path to the ledger. Delegates to the existing single-purpose functions so their validation and audit behaviour is not duplicated; any invalid element rolls the whole sale back.';

revoke all on function public.seller_create_sale_with_details(text, date, text, text, text, text, boolean, numeric, numeric, numeric, jsonb, jsonb, jsonb, numeric, text) from public, anon;
grant execute on function public.seller_create_sale_with_details(text, date, text, text, text, text, boolean, numeric, numeric, numeric, jsonb, jsonb, jsonb, numeric, text) to authenticated;

do $post$
begin
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'seller_create_sale_with_details') <> 1
     or (select md5(p.prosrc) from pg_proc p
          where p.oid = to_regprocedure('public.seller_create_sale_with_details(text,date,text,text,text,text,boolean,numeric,numeric,numeric,jsonb,jsonb,jsonb,numeric,text)'))
        is distinct from '4aceeb7caab83b1b078fd03f39982464' then
    raise exception 'R0184 postcondition: not exactly the body of 0110';
  end if;
end
$post$;
