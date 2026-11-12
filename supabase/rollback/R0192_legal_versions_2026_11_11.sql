-- ===========================================================================
-- R0192 — Rücknahme von 0192: Kennungen zurück auf 2026-09-17 und die
--          Sechser-Überladung von create_order() wiederhergestellt
--
-- Nur nach eigener Freigabe, und nur zusammen mit dem Zurücknehmen der
-- 2026-11-11-Texte und des gekoppelten Checkouts im Code (sonst nennt die
-- Seite eine Fassung, die `legal_document_versions` nicht mehr als aktuell
-- führt, und jeder neue Checkout wird mit LV002 abgelehnt).
--
-- WAS SIE NICHT ZURÜCKNIMMT: Bestellungen, die zwischen 0192 und dieser
-- Rücknahme angelegt wurden, tragen 2026-11-11 in ihrem Snapshot — für immer
-- (0047 schützt ihn). Wer zurücknimmt, muss deshalb den 2026-11-11-Text in
-- `src/lib/legal/archive/` einfrieren, bevor er aus dem Code verschwindet.
--
-- DIE SECHSER IST DER RUMPF AUS 0139, ZEICHENGLEICH (md5 c233337c…), mit den
-- Rechten der gekoppelten Überladung aus 0191 — die ihrerseits die Rechte der
-- Sechser übernommen hatte. Die gekoppelte bleibt stehen; 0191 nimmt erst
-- `R0191` zurück.
--
-- Eine zweite Ausführung ist folgenlos: sie ändert nur Zeilen mit
-- 2026-11-11 und ersetzt die Sechser durch sich selbst.
-- ===========================================================================

begin;

update public.legal_document_versions
   set version = '2026-09-17',
       effective_from = date '2026-09-17',
       updated_at = now()
 where slug in ('agb', 'widerruf', 'datenschutz', 'impressum')
   and version = '2026-11-11';

comment on table public.legal_document_versions is
  'Which version of each legal text is current. The TEXT lives in src/lib/legal/; this holds only the identifier, so a trigger can snapshot it onto an order without a second round trip (ADR-0086).';

-- Die Sechser, wie 0139 sie hinterlassen hat.
create or replace function public.create_order(
  p_request_id      text,
  p_email           text,
  p_items           jsonb,
  p_address         jsonb,
  p_shipping_method text,
  p_payment_token   text
)
returns table (
  order_id        bigint,
  order_number    text,
  items_subtotal  numeric,
  shipping_amount numeric,
  total_amount    numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id bigint;
  v_number   text;
  v_user_id  uuid := (select auth.uid());
  v_item     jsonb;
  v_sky_id   text;
  v_cond     text;
  v_qty      integer;
  v_price    numeric(10,2);
  v_name     text;
  v_image    text;
  v_inv_id   bigint;
  v_line_total numeric(10,2);
  v_subtotal numeric(10,2) := 0;
  v_lines    integer := 0;
  v_client   text;
  v_country  text;
  v_ship_name text;
  v_shipping numeric(10,2);
  v_token_hash text;
  v_existing record;

  -- The positions, priced and snapshotted, between pass 1 and pass 2. Never
  -- leaves this function and never reaches the caller.
  v_resolved jsonb := '[]'::jsonb;

  -- Which world this order belongs to, read once and stamped on the row.
  v_mode text := public.commerce_mode();
begin
  -- ---------------------------------------------------------------------------
  -- Before anything else, including the shape checks: may this caller buy?
  --
  -- The gate is here rather than in the server action because this function is
  -- reachable over PostgREST with the anon key. A check in TypeScript would be
  -- one request away from being skipped; this one cannot be.
  --
  -- Deliberately the same refusal for all three reasons — closed, not signed
  -- in, not a tester. A caller learns that they may not check out, not why,
  -- and not that a sandbox exists.
  -- ---------------------------------------------------------------------------
  if not public.commerce_checkout_allowed() then
    raise exception 'checkout is not open to this caller'
      using errcode = 'insufficient_privilege';
  end if;

  if p_request_id is null or length(p_request_id) < 8 then
    raise exception 'a checkout needs a request id' using errcode = 'check_violation';
  end if;

  -- The capability is required. An order nobody can prove they placed is an
  -- order nobody can pay for.
  if p_payment_token is null or length(p_payment_token) < 32 then
    raise exception 'a checkout needs a payment capability' using errcode = 'check_violation';
  end if;

  v_token_hash := encode(sha256(convert_to(p_payment_token, 'utf8')), 'hex');

  -- Already done. Hand it back only to a caller that can prove it is the one
  -- that created it — the same token, not merely the same request id.
  select o.id, o.order_number, o.items_subtotal, o.shipping_amount, o.total_amount,
         o.payment_token_hash
    into v_existing
    from public.orders o
   where o.request_id = p_request_id;

  if found then
    if v_existing.payment_token_hash is distinct from v_token_hash then
      raise exception 'this checkout belongs to somebody else'
        using errcode = 'insufficient_privilege';
    end if;

    order_id        := v_existing.id;
    order_number    := v_existing.order_number;
    items_subtotal  := v_existing.items_subtotal;
    shipping_amount := v_existing.shipping_amount;
    total_amount    := v_existing.total_amount;
    return next;
    return;
  end if;

  if p_email is null or p_email not like '%@%' then
    raise exception 'a checkout needs a contact address' using errcode = 'check_violation';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'a checkout needs at least one article' using errcode = 'check_violation';
  end if;

  v_country := upper(coalesce(p_address ->> 'country_code', ''));
  /*
   * Asks the configuration, not a compiled-in country (ADR-0075).
   *
   * This is the authoritative check. The checkout form mirrors the same list
   * so it can offer a sensible field, but editing the client enables nothing:
   * an order for a country that is not enabled is refused here.
   */
  if not public.shipping_country_allowed(v_country) then
    raise exception 'this shop does not deliver to %', coalesce(nullif(v_country, ''), '(none)')
      using errcode = 'check_violation';
  end if;

  select c.name into v_ship_name
    from public.shipping_catalog() c
   where c.code = p_shipping_method;

  if v_ship_name is null then
    raise exception 'unknown shipping method %', coalesce(p_shipping_method, '(null)')
      using errcode = 'check_violation';
  end if;

  v_client := public.request_client_hash();
  perform public.enforce_checkout_limits(p_email, v_user_id, v_client);

  -- -------------------------------------------------------------------------
  -- Pass 1 — resolve and price every position. Writes nothing.
  --
  -- Identical to what the loop always did, except that the line is kept
  -- instead of inserted: the order it belongs to does not exist yet.
  -- -------------------------------------------------------------------------
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_sky_id := v_item ->> 'sky_id';
    v_cond   := v_item ->> 'condition';
    v_qty    := nullif(v_item ->> 'quantity', '')::integer;

    if v_qty is null or v_qty < 1 or v_qty > public.max_cart_quantity() then
      raise exception 'invalid quantity for %', v_sky_id using errcode = 'check_violation';
    end if;

    -- V1 SELLS LOOSE ONLY (0028).
    --
    -- Validated explicitly rather than left to the lookup below. Without this,
    -- a boxed line would fall through to `article % / % is not offered`, which
    -- is misleading: the position exists, is listed, is eligible and is
    -- priced. What is wrong is the request, so it is refused the way every
    -- other unacceptable argument to this function is refused -- the same
    -- errcode an invalid quantity raises, which the application already maps
    -- to the same outcome (`UNAVAILABLE` in lib/commerce/actions.ts).
    --
    -- Placed in pass 1, which writes nothing: no order row exists yet, no
    -- line, no address, no reservation. See the header on atomicity.
    if v_cond is distinct from public.v1_sale_condition() then
      raise exception 'condition % is not offered', coalesce(v_cond, '(null)')
        using errcode = 'check_violation';
    end if;

    select i.id,
           public.shop_price(i.sale_price, s.market_price, st.price_percentage),
           coalesce(s.display_name_override, s.name),
           coalesce(s.image_override_path, s.image_file)
      into v_inv_id, v_price, v_name, v_image
      from public.shop_inventory i
      join public.skylanders s on s.sky_id = i.sky_id
      cross join public.shop_settings st
     where i.sky_id = v_sky_id
       and i.condition = v_cond
       and i.is_listed
       and public.is_position_sellable(i.id);

    if v_inv_id is null or v_price is null then
      raise exception 'article % / % is not offered', v_sky_id, v_cond
        using errcode = 'no_data_found';
    end if;

    v_line_total := round(v_price * v_qty, 2);

    v_resolved := v_resolved || jsonb_build_object(
      'inventory_id', v_inv_id,
      'sky_id',       v_sky_id,
      'condition',    v_cond,
      'quantity',     v_qty,
      'name',         v_name,
      'image',        v_image,
      'unit_price',   v_price,
      'line_total',   v_line_total
    );

    v_subtotal := v_subtotal + v_line_total;
    v_lines := v_lines + 1;
  end loop;

  if v_lines = 0 then
    raise exception 'a checkout needs at least one article' using errcode = 'check_violation';
  end if;

  v_shipping := public.shipping_amount_for(p_shipping_method, v_subtotal);

  -- -------------------------------------------------------------------------
  -- The order, with the amounts it will keep for ever.
  --
  -- This is the whole fix. `orders_protect_immutable()` sees one INSERT and
  -- no UPDATE, and `orders_total_is_the_sum` holds on the first row written:
  -- discount_amount defaults to 0, so total = subtotal + shipping - 0.
  -- -------------------------------------------------------------------------
  insert into public.orders
    (request_id, user_id, customer_email, client_hash, commerce_mode,
     items_subtotal, shipping_amount, total_amount,
     shipping_method_code, shipping_method_name, payment_token_hash)
  values
    (p_request_id, v_user_id, p_email, v_client, v_mode,
     v_subtotal, v_shipping, v_subtotal + v_shipping,
     p_shipping_method, v_ship_name, v_token_hash)
  returning id, orders.order_number into v_order_id, v_number;

  -- -------------------------------------------------------------------------
  -- Pass 2 — write the lines from pass 1's snapshots.
  --
  -- No lookup here, by design. Re-reading would risk pricing a line
  -- differently from the subtotal the order was just charged for.
  -- -------------------------------------------------------------------------
  for v_item in select * from jsonb_array_elements(v_resolved)
  loop
    insert into public.order_lines
      (order_id, sky_id, condition, quantity, name_snapshot, image_snapshot,
       unit_price, line_total, inventory_id)
    values
      (v_order_id,
       v_item ->> 'sky_id',
       v_item ->> 'condition',
       (v_item ->> 'quantity')::integer,
       v_item ->> 'name',
       v_item ->> 'image',
       (v_item ->> 'unit_price')::numeric(10,2),
       (v_item ->> 'line_total')::numeric(10,2),
       (v_item ->> 'inventory_id')::bigint);
  end loop;

  insert into public.order_addresses
    (order_id, kind, first_name, last_name, company, street, house_number,
     address_line_2, postal_code, city, country_code, phone)
  values
    (v_order_id, 'shipping',
     p_address ->> 'first_name', p_address ->> 'last_name', p_address ->> 'company',
     p_address ->> 'street', p_address ->> 'house_number', p_address ->> 'address_line_2',
     p_address ->> 'postal_code', p_address ->> 'city',
     v_country, p_address ->> 'phone');

  perform public.reserve_for_order(v_order_id);

  -- No token, no hash and no fragment of either: an event is a record of what
  -- happened, not a place to leak a secret.
  insert into public.order_events (order_id, event_type, actor_kind, actor_user_id)
  values (v_order_id, 'placed', case when v_user_id is null then 'system' else 'customer' end, v_user_id);

  order_id        := v_order_id;
  order_number    := v_number;
  items_subtotal  := v_subtotal;
  shipping_amount := v_shipping;
  total_amount    := v_subtotal + v_shipping;
  return next;
end;
$$;

comment on function public.create_order(text, text, jsonb, jsonb, text, text) is
  'Creates an order from a cart, stores the hash of the caller''''s payment capability, and holds the stock — in one transaction. Refuses outright unless commerce_checkout_allowed() says this caller may buy, and stamps the mode it was told onto the order. Every position is priced once, the amounts are final before the order row is written, and nothing updates them afterwards. Since 0028 a line whose condition is not the one V1 sells is refused in pass 1, before anything is written, so a mixed request leaves no order behind.';

do $acl_r0192$
declare
  v_old regprocedure := to_regprocedure('public.create_order(text, text, jsonb, jsonb, text, text)');
  v_new regprocedure := to_regprocedure('public.create_order(text, text, jsonb, jsonb, text, text, text, text)');
  r record;
begin
  execute format('revoke all on function %s from public, anon, authenticated, service_role', v_old);
  for r in
    select a.grantee
      from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where p.oid = v_new and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner
  loop
    execute format('grant execute on function %s to %s', v_old,
      case when r.grantee = 0 then 'public' else quote_ident(r.grantee::regrole::text) end);
  end loop;
end
$acl_r0192$;

do $r0192$
begin
  if (select count(*) from public.legal_document_versions v
       where v.slug in ('agb', 'widerruf', 'datenschutz', 'impressum') and v.version = '2026-09-17') <> 4 then
    raise exception 'R0192 postcondition: not every legal document is back on 2026-09-17';
  end if;
  if (select md5(p.prosrc) from pg_proc p
       where p.oid = to_regprocedure('public.create_order(text, text, jsonb, jsonb, text, text)'))
     is distinct from 'c233337c0ca0555756f21e1abe173593' then
    raise exception 'R0192 postcondition: create_order(six) is not the body of 0139';
  end if;
end
$r0192$;

notify pgrst, 'reload schema';

commit;
