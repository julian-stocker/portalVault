-- ===========================================================================
-- 0026 — runtime verification of the platform/seller split, STAGING ONLY
--
-- Two questions. Does the seller hold exactly what `business_settings` held,
-- and can the two subjects be changed without either reaching the other?
--
--   HOW TO RUN
--   Supabase Dashboard -> SQL Editor, on the STAGING project. One section at a
--   time. Each raises on the first failure, so a section that finishes without
--   an error has passed.
--
--   EVERY SECTION THAT WRITES ROLLS BACK. Nothing here commits.
--
--   ⚠️  NEVER RUN THIS AGAINST PRODUCTION.
-- ===========================================================================


-- ===========================================================================
-- SECTION 0 — preflight. Reads only.
-- ===========================================================================
do $$
declare
  v_inv     bigint;
  v_missing text[] := '{}';
begin
  select count(*) into v_inv from public.shop_inventory;
  if v_inv > 50 then
    raise exception 'This does not look like staging (% inventory rows). STOP.', v_inv;
  end if;

  if to_regclass('public.sellers')          is null then v_missing := v_missing || 'sellers';          end if;
  if to_regclass('public.platform_settings') is null then v_missing := v_missing || 'platform_settings'; end if;
  if to_regclass('public.business_settings') is not null then
    raise exception 'business_settings still exists — the rename did not happen';
  end if;

  if to_regprocedure('public.active_seller()')                            is null then v_missing := v_missing || 'active_seller';            end if;
  if to_regprocedure('public.mail_contact_settings()')                    is null then v_missing := v_missing || 'mail_contact_settings';    end if;
  if to_regprocedure('public.platform_settings_public()')                 is null then v_missing := v_missing || 'platform_settings_public'; end if;
  if to_regprocedure('public.admin_seller()')                             is null then v_missing := v_missing || 'admin_seller';             end if;
  if to_regprocedure('public.admin_set_seller_contact(text,text,text)')   is null then v_missing := v_missing || 'admin_set_seller_contact'; end if;
  if to_regprocedure('public.admin_platform_settings()')                  is null then v_missing := v_missing || 'admin_platform_settings';  end if;
  if to_regprocedure('public.admin_set_platform_contact(text)')           is null then v_missing := v_missing || 'admin_set_platform_contact'; end if;

  if array_length(v_missing, 1) is not null then
    raise exception '0026 not applied: % missing', array_to_string(v_missing, ', ');
  end if;

  -- The old names must be gone, or two definitions of the same fact survive.
  if to_regprocedure('public.business_settings_public()') is not null
     or to_regprocedure('public.admin_business_settings()') is not null
     or to_regprocedure('public.admin_set_business_contact(text,text)') is not null then
    raise exception 'a pre-0026 function survived the migration';
  end if;

  raise notice 'PASS  section 0 — both subjects exist, the old names are gone';
end $$;


-- ===========================================================================
-- SECTION 1 — the seller is exactly one, named, and holds the copied values.
-- Reads only.
-- ===========================================================================
do $$
declare
  v_count  bigint;
  v_active bigint;
  v_seller public.sellers;
begin
  select count(*) into v_count  from public.sellers;
  select count(*) into v_active from public.sellers where is_active;

  if v_count <> 1 then raise exception 'expected one seller, found %', v_count; end if;
  if v_active <> 1 then raise exception 'expected one ACTIVE seller, found %', v_active; end if;

  select * into v_seller from public.active_seller();
  if v_seller.display_name is distinct from 'yulez.collectibles' then
    raise exception 'active_seller() is named %, not yulez.collectibles',
      coalesce(v_seller.display_name, '(null)');
  end if;

  -- The addresses must have survived the copy. Printed as a length and a
  -- domain only: this file is read by more eyes than the admin area is.
  raise notice 'active_seller()  name=%  contact set=%  reply_to set=%',
    v_seller.display_name,
    (v_seller.contact_email is not null),
    (v_seller.transactional_reply_to is not null);

  raise notice 'PASS  section 1 — exactly one active seller, named yulez.collectibles';
end $$;


-- ===========================================================================
-- SECTION 2 — the mail projection is unchanged in shape and answers the same.
-- Reads only.
-- ===========================================================================
do $$
declare
  v_contact  text;
  v_reply    text;
  v_seller   public.sellers;
  v_effective text;
begin
  select m.contact_email, m.transactional_reply_to into v_contact, v_reply
    from public.mail_contact_settings() m;

  select * into v_seller from public.active_seller();

  if v_contact is distinct from v_seller.contact_email then
    raise exception 'mail_contact_settings() does not return the seller''s contact';
  end if;
  if v_reply is distinct from v_seller.transactional_reply_to then
    raise exception 'mail_contact_settings() does not return the seller''s reply-to';
  end if;

  -- The rule send-order-mail applies, restated here so a change to it is loud.
  v_effective := coalesce(v_reply, v_contact);
  if v_effective is null then
    raise notice 'WARN  no address configured — order mail would carry no Reply-To';
  end if;

  raise notice 'PASS  section 2 — the mail projection answers from the seller';
end $$;


-- ===========================================================================
-- SECTION 3 — a second active seller is impossible.
-- ===========================================================================
begin;
do $$
declare v_ok boolean;
begin
  v_ok := false;
  begin
    insert into public.sellers (display_name, is_active) values ('second seller', true);
  exception when unique_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'a second ACTIVE seller was accepted'; end if;

  -- An inactive one is allowed by the index — and must be, or a seller that
  -- stops selling could never be kept for the orders they fulfilled.
  insert into public.sellers (display_name, is_active) values ('retired seller', false);

  -- But it may not be activated while another is active.
  v_ok := false;
  begin
    update public.sellers set is_active = true where display_name = 'retired seller';
  exception when unique_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'an inactive seller was activated alongside the active one'; end if;

  raise notice 'PASS  section 3 — at most one active seller, enforced by the index';
end $$;
rollback;


-- ===========================================================================
-- SECTION 4 — the two subjects are set independently, in both directions.
-- ===========================================================================
begin;
do $$
declare
  v_seller_before   public.sellers;
  v_platform_before text;
  v_seller_after    public.sellers;
  v_platform_after  text;
begin
  select * into v_seller_before from public.active_seller();
  select contact_email into v_platform_before from public.platform_settings;

  -- Change the PLATFORM. The seller must not move.
  update public.platform_settings set contact_email = 'platform-probe@example.com' where id;

  select contact_email into v_platform_after from public.platform_settings;
  if v_platform_after is not distinct from v_platform_before then
    raise exception 'the platform contact did not actually change — this section proves nothing';
  end if;

  select * into v_seller_after from public.active_seller();
  if v_seller_after is distinct from v_seller_before then
    raise exception 'changing the platform contact changed the seller';
  end if;

  -- Change the SELLER. The platform must not move.
  update public.sellers
     set contact_email = 'seller-probe@example.com',
         transactional_reply_to = 'seller-reply@example.com'
   where is_active;

  select contact_email into v_platform_after from public.platform_settings;
  if v_platform_after is distinct from 'platform-probe@example.com' then
    raise exception 'changing the seller contact changed the platform';
  end if;

  -- And the mail projection follows the SELLER, not the platform.
  if (select m.contact_email from public.mail_contact_settings() m)
     is distinct from 'seller-probe@example.com' then
    raise exception 'order mail did not follow the seller';
  end if;
  if (select m.transactional_reply_to from public.mail_contact_settings() m)
     is distinct from 'seller-reply@example.com' then
    raise exception 'the reply-to did not follow the seller';
  end if;

  raise notice 'PASS  section 4 — neither subject can reach the other';
end $$;
rollback;


-- ===========================================================================
-- SECTION 5 — the shape guards still hold on the new table.
-- ===========================================================================
begin;
do $$
declare v_ok boolean;
begin
  v_ok := false;
  begin
    update public.sellers set contact_email = 'not-an-address' where is_active;
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'a malformed seller contact was accepted'; end if;

  v_ok := false;
  begin
    update public.sellers set transactional_reply_to = 'also-not' where is_active;
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'a malformed reply-to was accepted'; end if;

  v_ok := false;
  begin
    update public.sellers set display_name = repeat('x', 121) where is_active;
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'an over-long trade name was accepted'; end if;

  -- Null is a real value on both addresses: not configured yet.
  update public.sellers set contact_email = null, transactional_reply_to = null where is_active;
  if (select m.contact_email from public.mail_contact_settings() m) is not null then
    raise exception 'the seller contact cannot be cleared';
  end if;

  raise notice 'PASS  section 5 — the shape guards moved with the columns';
end $$;
rollback;


-- ===========================================================================
-- SECTION 6 — nobody but the service role gets in. Reads only.
-- ===========================================================================
do $$
begin
  if has_table_privilege('anon', 'public.sellers', 'select')
     or has_table_privilege('authenticated', 'public.sellers', 'select') then
    raise exception 'sellers is readable by a client role';
  end if;

  if has_table_privilege('anon', 'public.platform_settings', 'select')
     or has_table_privilege('authenticated', 'public.platform_settings', 'select') then
    raise exception 'platform_settings is readable by a client role';
  end if;

  if has_function_privilege('anon', 'public.active_seller()', 'execute')
     or has_function_privilege('authenticated', 'public.active_seller()', 'execute') then
    raise exception 'active_seller() is reachable from a client';
  end if;

  if has_function_privilege('anon', 'public.mail_contact_settings()', 'execute')
     or has_function_privilege('authenticated', 'public.mail_contact_settings()', 'execute') then
    raise exception 'mail_contact_settings() is reachable from a client';
  end if;

  if has_function_privilege('anon', 'public.platform_settings_public()', 'execute')
     or has_function_privilege('authenticated', 'public.platform_settings_public()', 'execute') then
    raise exception 'the public projection is granted before there is a page for it';
  end if;

  -- The admin functions ARE reachable by a signed-in account; the role check
  -- is inside them. That is the shape 0019 established and it is unchanged.
  if not has_function_privilege('authenticated', 'public.admin_seller()', 'execute') then
    raise exception 'admin_seller() is not reachable by a signed-in admin';
  end if;
  if not has_function_privilege('authenticated', 'public.admin_platform_settings()', 'execute') then
    raise exception 'admin_platform_settings() is not reachable by a signed-in admin';
  end if;
  if has_function_privilege('anon', 'public.admin_seller()', 'execute')
     or has_function_privilege('anon', 'public.admin_set_seller_contact(text,text,text)', 'execute') then
    raise exception 'an admin function is reachable without an account';
  end if;

  raise notice 'PASS  section 6 — the table is closed and only the admin RPCs are granted';
end $$;
