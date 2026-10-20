-- ===========================================================================
-- R0139 — die Verkaufsfreigabe fuer Zubehoer wieder zurueck
--
-- Stellt den Stand vor `0139` her: die vier Tueren fragen wieder
-- `is_shop_eligible(i.sky_id)`, die Betriebsdiagnose nennt wieder ihre vier
-- Gruende, die drei neuen Funktionen und die zwei neuen Spalten fallen weg.
--
-- WAS SIE ZERSTOEREN WUERDE, UND DESHALB ABFRAGT: jede gesetzte Freigabe und
-- jede erfasste USK-Angabe. Mit den Spalten sind beide fort. Der Block in
-- Abschnitt 1 bricht deshalb ab, sobald eine Position freigegeben ist oder
-- ein Spiel eine Alterskennzeichnung traegt — wer trotzdem zurueckrollen
-- will, nimmt die Freigaben erst ueber `seller_set_sale_release(..., false)`
-- zurueck und sieht dabei, was er verliert.
--
-- REIHENFOLGE: erst die Funktionen, dann die Spalten. Ein `language sql`
-- Rumpf, der `sale_released` nennt, haelt die Spalte sonst fest.
--
-- In `begin` / `commit` klammern.
-- ===========================================================================

do $$
declare
  v_n integer;
begin
  if to_regprocedure('public.is_position_sellable(bigint)') is null then
    raise exception 'R0139 Abbruch: 0139 ist nicht angewendet — is_position_sellable fehlt';
  end if;

  select count(*) into v_n from public.shop_inventory where sale_released;
  if v_n > 0 then
    raise exception 'R0139 Abbruch: % Positionen sind freigegeben. Erst ueber '
      'seller_set_sale_release(sky_id, condition, false) zuruecknehmen — '
      'die Ruecknahme dieser Migration loescht die Spalte und damit die Freigabe', v_n;
  end if;

  select count(*) into v_n from public.shop_inventory where delivery_scope is not null;
  if v_n > 0 then
    raise exception 'R0139 Abbruch: % Positionen tragen einen Lieferumfang. Er geht mit '
      'der Spalte verloren — erst ueber seller_set_delivery_scope(..., null) '
      'zuruecknehmen', v_n;
  end if;

  select count(*) into v_n from public.skylanders where usk_rating is not null;
  if v_n > 0 then
    raise exception 'R0139 Abbruch: % Spiele tragen eine USK-Angabe. Sie geht mit der '
      'Spalte verloren und muesste von Hand neu erfasst werden', v_n;
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 1. Die drei neuen Funktionen fallen weg
-- ---------------------------------------------------------------------------
drop function if exists public.seller_set_sale_release(text, text, boolean);
drop function if exists public.seller_set_delivery_scope(text, text, text);
drop function if exists public.admin_set_usk_rating(text, smallint);


-- ---------------------------------------------------------------------------
-- 2. Die Tueren, Zeichen fuer Zeichen wie vor 0139
-- ---------------------------------------------------------------------------
-- 2a. shop_offers() — wie 0029, wieder mit VIER Spalten
--
-- `drop` statt `create or replace`: `0139` hat den Rueckgabetyp um
-- `delivery_scope` erweitert, und PostgreSQL laesst ihn nicht ersetzen.
drop function if exists public.shop_offers();

create function public.shop_offers()
returns table (
  sky_id    text,
  condition text,
  price     numeric,
  available boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    i.sky_id,
    i.condition,
    public.shop_price(i.sale_price, s.market_price, st.price_percentage) as price,
    (i.available_quantity > 0) as available
  from public.shop_inventory i
  join public.skylanders s on s.sky_id = i.sky_id
  cross join public.shop_settings st
  where i.is_listed
    -- V1 SELLS LOOSE ONLY (0029). The projection stops advertising what
    -- the platform will not sell: create_order() and
    -- shop_quantity_available() have refused a non-V1 condition since
    -- 0028, so a boxed row here was a price and an availability flag for
    -- a purchase that could not happen.
    --
    -- The rule is asked for, not restated: public.v1_sale_condition() is
    -- the same function the two commerce functions call. One word, one
    -- place, three doors.
    and i.condition = public.v1_sale_condition()
    and public.is_shop_eligible(i.sky_id)
    -- Something without a price is not an offer, however released it is.
    and public.shop_price(i.sale_price, s.market_price, st.price_percentage) is not null
  order by i.sky_id, i.condition;
$$;
revoke all on function public.shop_offers() from public;
grant execute on function public.shop_offers() to anon, authenticated;

-- 2b. shop_quantity_available() — wie 0028
create or replace function public.shop_quantity_available(
  p_sky_id    text,
  p_condition text,
  p_quantity  integer
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_quantity is not null
    and p_quantity >= 1
    and p_quantity <= public.max_cart_quantity()
    and exists (
      select 1
        from public.shop_inventory i
        join public.skylanders s on s.sky_id = i.sky_id
        cross join public.shop_settings st
       where i.sky_id    = p_sky_id
         and i.condition = p_condition
         -- V1 sells loose only (0028). A boxed position is real stock and
         -- stays in the table; it is simply not something this shop sells,
         -- so the honest answer is the same `false` a sold-out position
         -- already gets. No new error semantics for a boolean function.
         and i.condition = public.v1_sale_condition()
         and i.is_listed
         and public.is_shop_eligible(i.sky_id)
         -- Something without a price is not an offer, however released it is.
         and public.shop_price(i.sale_price, s.market_price, st.price_percentage) is not null
         -- The whole point. `available_quantity` is `quantity - reserved`,
         -- generated by the table (0003) — one definition, compared here,
         -- never returned.
         and i.available_quantity >= p_quantity
    );
$$;
revoke all on function public.shop_quantity_available(text, text, integer) from public;
grant execute on function public.shop_quantity_available(text, text, integer)
  to anon, authenticated;

-- 2c. create_order() — wie 0040
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
       and public.is_shop_eligible(i.sky_id);

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
revoke all on function public.create_order(text, text, jsonb, jsonb, text, text) from public;
grant execute on function public.create_order(text, text, jsonb, jsonb, text, text)
  to anon, authenticated;

-- 2d. reserve_for_order() — wie 0010
create or replace function public.reserve_for_order(p_order_id bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids      bigint[];
  v_expires  timestamptz := now() + public.reservation_ttl();
  v_row      record;
  v_count    integer := 0;
begin
  select array_agg(distinct l.inventory_id order by l.inventory_id)
    into v_ids
    from public.order_lines l
   where l.order_id = p_order_id
     and l.inventory_id is not null;

  if v_ids is null or array_length(v_ids, 1) = 0 then
    raise exception 'order % has no reservable lines', p_order_id
      using errcode = 'no_data_found';
  end if;

  -- 2. Lock every position at once, always in the same order.
  perform 1
     from public.shop_inventory i
    where i.id = any (v_ids)
    order by i.id
      for update;

  -- 3. Now that they are held, reclaim anything that has run out of time.
  perform public.release_expired_reservations(v_ids);

  for v_row in
    select l.id, l.inventory_id, l.quantity, l.sky_id, l.condition
      from public.order_lines l
     where l.order_id = p_order_id
       and l.inventory_id is not null
     order by l.inventory_id
  loop
    -- 4. Still sellable at all? Same rules as shop_offers(), asked of the
    --    same functions rather than copied.
    if not exists (
      select 1
        from public.shop_inventory i
        join public.skylanders s on s.sky_id = i.sky_id
        cross join public.shop_settings st
       where i.id = v_row.inventory_id
         and i.is_listed
         and public.is_shop_eligible(i.sky_id)
         and public.shop_price(i.sale_price, s.market_price, st.price_percentage) is not null
    ) then
      raise exception 'article % / % is no longer offered', v_row.sky_id, v_row.condition
        using errcode = 'check_violation';
    end if;

    -- 5. The guard is the WHERE clause, not a preceding SELECT.
    update public.shop_inventory
       set reserved = reserved + v_row.quantity
     where id = v_row.inventory_id
       and quantity - reserved >= v_row.quantity;

    if not found then
      raise exception 'not enough stock for % / %', v_row.sky_id, v_row.condition
        using errcode = 'check_violation';
    end if;

    insert into public.order_reservations
      (order_id, inventory_id, quantity, expires_at)
    values
      (p_order_id, v_row.inventory_id, v_row.quantity, v_expires);

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;
revoke all on function public.reserve_for_order(bigint) from public, anon, authenticated;

-- 2e. admin_shop_listing_audit() — wie 0041
create or replace function public.admin_shop_listing_audit()
returns table (
  sky_id     text,
  condition  text,
  is_listed  boolean,
  eligible   boolean,
  reason     text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required'
      using errcode = 'insufficient_privilege';
  end if;

  return query
    select
      i.sky_id,
      i.condition,
      i.is_listed,
      public.is_shop_eligible(i.sky_id),
      case
        when s.sky_id is null            then 'no catalog row'
        when not s.is_active             then 'inactive figure'
        when not s.catalog_visible       then 'editorially hidden'
        when c.name = any (public.non_collectible_categories())
                                         then 'not a collectible'
        else null
      end
      from public.shop_inventory i
      left join public.skylanders s on s.sky_id = i.sky_id
      left join public.categories c on c.id = s.category_id
     order by i.sky_id, i.condition;
end;
$$;
revoke all on function public.admin_shop_listing_audit() from public, anon;
grant execute on function public.admin_shop_listing_audit() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Jetzt erst das Tor und die Spalten
-- ---------------------------------------------------------------------------
drop function if exists public.is_position_sellable(bigint);

alter table public.shop_inventory drop constraint if exists shop_inventory_delivery_scope_known;
alter table public.shop_inventory drop column if exists delivery_scope;
alter table public.shop_inventory drop column if exists sale_released;
alter table public.skylanders     drop constraint if exists skylanders_usk_rating_known;
alter table public.skylanders     drop column if exists usk_rating;


-- ---------------------------------------------------------------------------
-- 4. Nachbedingungen
-- ---------------------------------------------------------------------------
do $$
declare
  v_n integer;
begin
  if to_regprocedure('public.is_position_sellable(bigint)') is not null then
    raise exception 'R0139 Abbruch: is_position_sellable steht noch';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'shop_inventory'
                and column_name = 'sale_released') then
    raise exception 'R0139 Abbruch: sale_released steht noch';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'shop_inventory'
                and column_name = 'delivery_scope') then
    raise exception 'R0139 Abbruch: delivery_scope steht noch';
  end if;
  if (select count(*) from pg_proc p, unnest(p.proargnames, p.proargmodes) as a(nm, md)
       where p.oid = to_regprocedure('public.shop_offers()') and a.md = 't') <> 4 then
    raise exception 'R0139 Abbruch: shop_offers liefert nicht wieder vier Spalten';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'skylanders'
                and column_name = 'usk_rating') then
    raise exception 'R0139 Abbruch: usk_rating steht noch';
  end if;
  if exists (
    select 1 from pg_proc p
     where p.oid in (to_regprocedure('public.shop_offers()'),
                     to_regprocedure('public.shop_quantity_available(text, text, integer)'),
                     to_regprocedure('public.create_order(text, text, jsonb, jsonb, text, text)'),
                     to_regprocedure('public.reserve_for_order(bigint)'))
       and position('is_shop_eligible' in p.prosrc) = 0
  ) then
    raise exception 'R0139 Abbruch: eine Tuer fragt is_shop_eligible nicht wieder';
  end if;

  select count(*) into v_n from public.shop_offers();
  raise notice 'R0139 ok: Tueren zurueck, Spalten fort, % Angebote', v_n;
end $$;
