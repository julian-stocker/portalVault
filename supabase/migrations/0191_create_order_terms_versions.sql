-- ===========================================================================
-- 0191 — create_order() mit den angezeigten Rechtsfassungen: die gekoppelte
--        Bestellung, NEBEN der bisherigen (Phase 1 von 2)
--
-- ###########################################################################
-- ##  NOT APPLIED — neither on Staging nor on Production.                  ##
-- ##  Each environment only after a separate approval by the operator.     ##
-- ###########################################################################
--
-- WARUM (ADR-0184, AP5, 2026-11-11)
--
-- Bisher übernimmt `create_order()` keine Fassungskennung: der Trigger aus
-- 0047 liest sie beim Anlegen aus `legal_document_versions`. Was der Kunde
-- gesehen hat (der ausgelieferte Code) und was der Snapshot speichert (die
-- Datenbank), ist nicht verbunden — beim Wechsel der Rechtstexte kann eine
-- Bestellung eine Fassung tragen, die der Kunde nie gesehen hat.
--
-- WAS DIESE DATEI TUT — GENAU DAS:
--
--   eine ZWEITE Überladung `create_order(…, p_agb_version text,
--   p_widerruf_version text)` — acht Parameter, ALLE ohne Standardwert. Ihr
--   Rumpf ist der aus 0139, zeichengleich, plus genau zwei Einfügungen: zwei
--   Variablen und der Abgleich der übergebenen Kennungen mit
--   `legal_document_versions` unter `for share`, vor jedem Schreiben.
--   Fehlt eine Kennung: SQLSTATE LV001. Weicht sie ab: LV002. In beiden Fällen
--   keine Bestellung, keine Position, keine Reservierung, kein Ereignis.
--
--   Rechte: genau die der bisherigen Überladung, aus dem Katalog übernommen
--   (gleiche Empfänger, gleicher Eigner, SECURITY DEFINER, leerer
--   search_path).

--   UND eine Lesefunktion `legal_versions_public()` — welche Fassung von AGB,
--   Widerrufsbelehrung, Datenschutzerklärung und Impressum gerade aktuell
--   ist, genau vier Kennungen, sonst nichts. Der Code enthält mehrere
--   Fassungen und zeigt die, die die Datenbank nennt; der Checkout sendet
--   genau diese an die gekoppelte Bestellung. So wird die Umschaltung (0192)
--   EIN Schritt in der Datenbank und hängt nicht am Zeitpunkt eines
--   Deployments (ADR-0184, AP5).
--
--   Sie ist `stable`, SECURITY DEFINER mit leerem search_path und für anon
--   und authenticated ausführbar, für PUBLIC nicht. Die Tabelle selbst bleibt
--   für beide gesperrt (0047). Zurückgegeben werden nur die vier namentlich
--   genannten Dokumente; kein `effective_from`, kein `updated_at`, keine
--   weitere Zeile. Fehlt eine der vier Kennungen, bricht sie mit SQLSTATE
--   LV003 ab, statt eine Lücke zu liefern.
--
-- WARUM EINE ZWEITE ÜBERLADUNG UND NICHT STANDARDWERTE. Ein neuer Parameter
-- mit `default null` neben der bisherigen Sechser-Signatur machte jeden
-- Aufruf mit sechs Argumenten mehrdeutig (PostgreSQL: „function … is not
-- unique“, PostgREST: PGRST203). Sie zu ersetzen hiesse DROP + CREATE der
-- laufenden Bestellfunktion; und einen Standardwert kann `create or replace`
-- später nicht mehr entfernen. Ohne Standardwerte sind beide Signaturen über
-- ihre Parameternamen eindeutig: PostgREST wählt die Sechser für einen
-- Aufruf mit sechs Namen, die Achter für einen mit acht; einen Aufruf mit
-- acht Namen kann die Sechser nicht annehmen und umgekehrt.
--
-- WAS SICH NICHT ÄNDERT: die bisherige Überladung (Rumpf, Rechte) bleibt
-- unberührt und bedient den laufenden Code weiter — mit dem bisherigen
-- Verhalten. Keine Tabelle, keine Zeile, kein Trigger, keine Lagerlogik
-- (der Rumpf ruft `reserve_for_order()` an derselben Stelle wie bisher),
-- kein Recht auf `legal_document_versions`.
--
-- DER ENDZUSTAND KOMMT MIT 0192: Kennungen auf 2026-11-11 UND die
-- Sechser-Überladung entfernt, in EINER Transaktion. Danach gibt es nur
-- noch die gekoppelte Bestellung; ohne Kennung kein Aufruf.
--
-- VORAUSSETZUNG: 0139 (der Rumpf, auf dem dieser aufbaut; auf Staging und
-- Production angewendet) und 0047 (`legal_document_versions`).
--
-- IDEMPOTENT. Ein zweiter Lauf ersetzt die Achter durch sich selbst und setzt
-- dieselben Rechte.
--
-- RÜCKNAHME: `supabase/rollback/R0191_create_order_terms_versions.sql`.
-- ===========================================================================

do $p0191$
declare
  v_old oid := to_regprocedure('public.create_order(text, text, jsonb, jsonb, text, text)');
  v_new oid := to_regprocedure('public.create_order(text, text, jsonb, jsonb, text, text, text, text)');
begin
  /* VORBEDINGUNGEN — kein Raten. */
  if to_regclass('public.legal_document_versions') is null then
    raise exception '0191 precondition: public.legal_document_versions does not exist (0047)';
  end if;
  if v_old is null then
    raise exception '0191 precondition: create_order with six parameters is missing';
  end if;
  if (select md5(p.prosrc) from pg_proc p where p.oid = v_old) is distinct from 'c233337c0ca0555756f21e1abe173593' then
    raise exception '0191 precondition: create_order(six) is not the body of 0139';
  end if;
  if (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'create_order')
     <> (case when v_new is null then 1 else 2 end) then
    raise exception '0191 precondition: create_order has an overload this file does not know';
  end if;
  if v_new is not null
     and (select md5(p.prosrc) from pg_proc p where p.oid = v_new) is distinct from '75fbeaea7b193035717eeb37c0995127' then
    raise exception '0191 precondition: create_order(eight) exists with another body';
  end if;
  if to_regprocedure('public.legal_versions_public()') is not null
     and (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.legal_versions_public()'))
         is distinct from '5e9daa01284d9b06b1b7d8fb053cff36' then
    raise exception '0191 precondition: legal_versions_public() exists with another body';
  end if;
end
$p0191$;

create or replace function public.create_order(
  p_request_id        text,
  p_email             text,
  p_items             jsonb,
  p_address           jsonb,
  p_shipping_method   text,
  p_payment_token     text,
  p_agb_version       text,
  p_widerruf_version  text
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
  -- 0191 (ADR-0184): the current versions, read under a share lock.
  v_agb_current      text;
  v_widerruf_current text;

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

  -- -------------------------------------------------------------------------
  -- 0191 (ADR-0184, AP5): THE TERMS THIS CUSTOMER WAS SHOWN ARE THE TERMS IN
  -- FORCE — or there is no order.
  --
  -- The checkout sends the AGB and Widerruf versions it displayed. They are
  -- compared here, inside this transaction, with `legal_document_versions`,
  -- read FOR SHARE: a concurrent version switch (an UPDATE of those rows)
  -- waits until this order has committed, and an order that arrives after
  -- the switch re-reads the new row and is refused. The snapshot trigger of
  -- 0047 then copies exactly the version checked here.
  --
  -- Before anything is written: no order, no line, no reservation, no event.
  -- After the request-id replay above, deliberately — an order that already
  -- exists keeps the snapshot it was created with.
  -- -------------------------------------------------------------------------
  if p_agb_version is null or btrim(p_agb_version) = ''
     or p_widerruf_version is null or btrim(p_widerruf_version) = '' then
    raise exception 'a checkout needs the versions of the terms it showed'
      using errcode = 'LV001';
  end if;

  select v.version into v_agb_current
    from public.legal_document_versions v where v.slug = 'agb' for share;
  select v.version into v_widerruf_current
    from public.legal_document_versions v where v.slug = 'widerruf' for share;

  if v_agb_current is distinct from p_agb_version
     or v_widerruf_current is distinct from p_widerruf_version then
    raise exception 'the terms changed since this checkout was shown'
      using errcode = 'LV002';
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

comment on function public.create_order(text, text, jsonb, jsonb, text, text, text, text) is
  'The only way to create an order (ADR-0050), coupled to the terms the customer was shown (0191, ADR-0184): p_agb_version and p_widerruf_version are compared with legal_document_versions under FOR SHARE before anything is written — missing raises LV001, different raises LV002, and neither creates an order, a line or a reservation. Otherwise the body of 0139 unchanged. Rights mirror the six-parameter overload, which 0192 removes.';

do $acl0191$
declare
  v_old regprocedure := to_regprocedure('public.create_order(text, text, jsonb, jsonb, text, text)');
  v_new regprocedure := to_regprocedure('public.create_order(text, text, jsonb, jsonb, text, text, text, text)');
  r record;
begin
  /* RECHTE — die der bisherigen Überladung, Empfänger für Empfänger. Erst
     alles entziehen (Supabase vergibt auf neue Funktionen von sich aus
     EXECUTE an anon, authenticated und service_role, PostgreSQL an PUBLIC),
     dann genau das erteilen, was die Sechser hat. */
  execute format('revoke all on function %s from public, anon, authenticated, service_role', v_new);
  for r in
    select a.grantee
      from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where p.oid = v_old and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner
  loop
    execute format('grant execute on function %s to %s', v_new,
      case when r.grantee = 0 then 'public' else quote_ident(r.grantee::regrole::text) end);
  end loop;
end
$acl0191$;

do $q0191$
declare
  v_old oid := to_regprocedure('public.create_order(text, text, jsonb, jsonb, text, text)');
  v_new oid := to_regprocedure('public.create_order(text, text, jsonb, jsonb, text, text, text, text)');
  v_acl_old text;
  v_acl_new text;
begin
  /* NACHBEDINGUNGEN — gemessen, nicht angenommen. */
  if v_new is null then
    raise exception '0191 postcondition: create_order(eight) was not created';
  end if;
  if (select md5(p.prosrc) from pg_proc p where p.oid = v_new) is distinct from '75fbeaea7b193035717eeb37c0995127'
     or (select md5(p.prosrc) from pg_proc p where p.oid = v_old) is distinct from 'c233337c0ca0555756f21e1abe173593' then
    raise exception '0191 postcondition: a create_order body is not the expected one';
  end if;
  if not (select p.prosecdef from pg_proc p where p.oid = v_new)
     or (select count(*) from pg_proc p, unnest(coalesce(p.proconfig, '{}')) c
          where p.oid = v_new and c like 'search\_path=%') <> 1
     or (select btrim(substring(c from 'search_path=(.*)$'), '"')
           from pg_proc p, unnest(p.proconfig) c
          where p.oid = v_new and c like 'search\_path=%') is distinct from ''
     or (select p.proowner from pg_proc p where p.oid = v_new)
        is distinct from (select p.proowner from pg_proc p where p.oid = v_old)
     or (select p.provolatile from pg_proc p where p.oid = v_new)
        is distinct from (select p.provolatile from pg_proc p where p.oid = v_old)
     or (select p.pronargdefaults from pg_proc p where p.oid = v_new) <> 0 then
    raise exception '0191 postcondition: create_order(eight) is not SECURITY DEFINER with an empty search_path, the same owner and volatility, and no defaults';
  end if;
  select string_agg(a.grantee::text, ',' order by a.grantee::text) into v_acl_old
    from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
   where p.oid = v_old and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner;
  select string_agg(a.grantee::text, ',' order by a.grantee::text) into v_acl_new
    from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
   where p.oid = v_new and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner;
  if v_acl_new is distinct from v_acl_old then
    raise exception '0191 postcondition: create_order(eight) does not carry exactly the rights of create_order(six)';
  end if;
  if (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'create_order') <> 2 then
    raise exception '0191 postcondition: expected exactly two create_order overloads';
  end if;
end
$q0191$;

-- ---------------------------------------------------------------------------
-- Die aktuellen Kennungen, öffentlich lesbar — und nur sie.
-- ---------------------------------------------------------------------------
create or replace function public.legal_versions_public()
returns table (
  agb         text,
  widerruf    text,
  datenschutz text,
  impressum   text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  -- The four published documents, each named. A slug added to the table later
  -- stays invisible here until somebody names it on purpose (ADR-0059); no
  -- date, no timestamp, nothing but the identifier the orders carry.
  select count(*),
         max(v.version) filter (where v.slug = 'agb'),
         max(v.version) filter (where v.slug = 'widerruf'),
         max(v.version) filter (where v.slug = 'datenschutz'),
         max(v.version) filter (where v.slug = 'impressum')
    into v_rows, agb, widerruf, datenschutz, impressum
    from public.legal_document_versions v
   where v.slug in ('agb', 'widerruf', 'datenschutz', 'impressum');

  -- Missing is an error, not a gap: the checkout must not guess a version.
  if v_rows <> 4
     or coalesce(btrim(agb), '') = '' or coalesce(btrim(widerruf), '') = ''
     or coalesce(btrim(datenschutz), '') = '' or coalesce(btrim(impressum), '') = '' then
    raise exception 'legal_versions_public: the current legal versions are incomplete'
      using errcode = 'LV003';
  end if;
  return next;
end;
$$;

comment on function public.legal_versions_public() is
  'Which version of AGB, Widerrufsbelehrung, Datenschutzerklaerung and Impressum is current (0191, ADR-0184): exactly one row with four identifiers, nothing else. The legal pages render the version named here, the checkout shows it and sends it to create_order, which compares it under FOR SHARE. Missing or empty raises LV003. Read-only; the table stays closed to anon and authenticated.';

revoke all on function public.legal_versions_public() from public, anon, authenticated, service_role;
grant execute on function public.legal_versions_public() to anon, authenticated;

do $v0191$
declare
  v_sig constant text := 'public.legal_versions_public()';
  v_oid oid := to_regprocedure(v_sig);
begin
  /* NACHBEDINGUNGEN der Lesefunktion — gemessen, nicht angenommen. */
  if v_oid is null then
    raise exception '0191 postcondition: % was not created', v_sig;
  end if;
  if (select md5(p.prosrc) from pg_proc p where p.oid = v_oid) is distinct from '5e9daa01284d9b06b1b7d8fb053cff36' then
    raise exception '0191 postcondition: % does not have the body of 0191', v_sig;
  end if;
  if not (select p.prosecdef from pg_proc p where p.oid = v_oid)
     or (select p.provolatile from pg_proc p where p.oid = v_oid) <> 's'
     or (select count(*) from pg_proc p, unnest(coalesce(p.proconfig, '{}')) c
          where p.oid = v_oid and c like 'search\_path=%') <> 1
     or (select btrim(substring(c from 'search_path=(.*)$'), '"')
           from pg_proc p, unnest(p.proconfig) c
          where p.oid = v_oid and c like 'search\_path=%') is distinct from '' then
    raise exception '0191 postcondition: % is not a stable security definer with an empty search_path', v_sig;
  end if;
  if pg_get_function_result(v_oid) is distinct from 'TABLE(agb text, widerruf text, datenschutz text, impressum text)' then
    raise exception '0191 postcondition: % returns more or other than the four identifiers', v_sig;
  end if;
  if (select string_agg(a.grantee::regrole::text, ',' order by a.grantee::regrole::text)
        from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
       where p.oid = v_oid and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner and a.grantee <> 0)
     is distinct from 'anon,authenticated'
     or exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                 where p.oid = v_oid and a.privilege_type = 'EXECUTE' and a.grantee = 0) then
    raise exception '0191 postcondition: % must be executable by exactly anon and authenticated', v_sig;
  end if;
  if has_table_privilege('anon', 'public.legal_document_versions', 'select')
     or has_table_privilege('authenticated', 'public.legal_document_versions', 'select') then
    raise exception '0191 postcondition: legal_document_versions is readable directly';
  end if;
end
$v0191$;

-- PostgREST liest die neue Signatur und die Lesefunktion; Supabase lädt nach DDL von selbst neu,
-- das hier ist nur die ausdrückliche Bitte.
notify pgrst, 'reload schema';
