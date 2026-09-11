-- ===========================================================================
-- 0020 — runtime verification of the order_events carve-out, STAGING ONLY
--
-- One question, asked from both sides: can an account that touched an order's
-- history be deleted, and is that still the ONLY thing that may change about
-- that history?
--
--   HOW TO RUN
--   Supabase Dashboard -> SQL Editor, on the STAGING project. One section at a
--   time. Each raises on the first failure, so a section that finishes without
--   an error has passed.
--
--   SECTIONS 1–3 roll back and leave nothing. SECTION 4 is the real cleanup of
--   the account this defect stranded on 2026-09-11 and COMMITS on purpose —
--   it is clearly marked.
--
--   NO ACCOUNT IS CREATED ANYWHERE IN THIS FILE. Sections 1 and 2 attribute a
--   throwaway EVENT to an existing account and never delete it; section 3
--   proves the deletion path on the account that is already stranded.
--
--   ⚠️  NEVER RUN THIS AGAINST PRODUCTION.
-- ===========================================================================


-- ===========================================================================
-- SECTION 0 — preflight. Reads only.
-- ===========================================================================
do $$
declare v_inv bigint;
begin
  select count(*) into v_inv from public.shop_inventory;
  if v_inv > 50 then
    raise exception 'This does not look like staging (% inventory rows). STOP.', v_inv;
  end if;

  if to_regprocedure('public.prevent_order_event_change()') is null then
    raise exception '0020 not applied: prevent_order_event_change() is missing';
  end if;

  -- The trigger must be the new one, not the blanket deny_write().
  if not exists (
    select 1 from pg_trigger t
     where t.tgrelid = 'public.order_events'::regclass
       and t.tgname = 'order_events_append_only'
       and t.tgfoid = 'public.prevent_order_event_change()'::regprocedure
  ) then
    raise exception 'order_events_append_only still points at the old function';
  end if;

  -- And the siblings must be untouched: neither references an account.
  if not exists (
    select 1 from pg_trigger t
     where t.tgrelid = 'public.order_lines'::regclass
       and t.tgfoid = 'public.deny_write()'::regprocedure
  ) then
    raise exception 'order_lines lost its append-only guard';
  end if;
  if not exists (
    select 1 from pg_trigger t
     where t.tgrelid = 'public.order_addresses'::regclass
       and t.tgfoid = 'public.deny_write()'::regprocedure
  ) then
    raise exception 'order_addresses lost its append-only guard';
  end if;

  raise notice 'PASS  section 0 — 0020 applied, siblings untouched';
end $$;


-- ===========================================================================
-- SECTION 1 — the anonymisation itself, and only it.
--
-- Uses an EXISTING account and never deletes it: this section is about which
-- UPDATE is permitted, not about the deletion path. No account is created
-- anywhere in this file — every fixture is an event, and every event is rolled
-- back.
-- ===========================================================================
begin;
do $$
declare
  v_order bigint;
  v_event bigint;
  v_user  uuid;
  v_row   public.order_events;
  v_ok    boolean;
begin
  select id into v_order from public.orders order by id limit 1;
  select id into v_user from auth.users order by created_at limit 1;
  if v_user is null then raise exception 'no account to attribute a test event to'; end if;

  insert into public.order_events (order_id, event_type, actor_kind, actor_user_id, payload)
  values (v_order, 'test_carveout', 'admin', v_user, jsonb_build_object('probe', true))
  returning id into v_event;

  -- THE PERMITTED CHANGE: the identifier goes, nothing else moves.
  update public.order_events set actor_user_id = null where id = v_event;

  select * into v_row from public.order_events where id = v_event;
  if v_row.actor_user_id is not null then raise exception 'the actor was not anonymised'; end if;
  if v_row.event_type <> 'test_carveout' then raise exception 'event_type changed'; end if;
  if v_row.actor_kind <> 'admin' then raise exception 'actor_kind changed'; end if;
  if v_row.payload <> jsonb_build_object('probe', true) then raise exception 'payload changed'; end if;

  -- AND NOTHING ELSE. Each of these must still be refused.
  v_ok := false;
  begin
    update public.order_events set event_type = 'forged' where id = v_event;
  exception when others then v_ok := true;
  end;
  if not v_ok then raise exception 'event_type was rewritten'; end if;

  v_ok := false;
  begin
    update public.order_events set payload = '{"forged":true}'::jsonb where id = v_event;
  exception when others then v_ok := true;
  end;
  if not v_ok then raise exception 'payload was rewritten'; end if;

  v_ok := false;
  begin
    update public.order_events set actor_kind = 'system' where id = v_event;
  exception when others then v_ok := true;
  end;
  if not v_ok then raise exception 'actor_kind was rewritten'; end if;

  v_ok := false;
  begin
    update public.order_events set created_at = now() - interval '1 day' where id = v_event;
  exception when others then v_ok := true;
  end;
  if not v_ok then raise exception 'created_at was rewritten'; end if;

  -- Setting an actor back is NOT the permitted direction.
  v_ok := false;
  begin
    update public.order_events set actor_user_id = v_user where id = v_event;
  exception when others then v_ok := true;
  end;
  if not v_ok then raise exception 'an anonymised actor was restored'; end if;

  -- DELETE stays refused outright.
  v_ok := false;
  begin
    delete from public.order_events where id = v_event;
  exception when others then v_ok := true;
  end;
  if not v_ok then raise exception 'an order event was deleted'; end if;

  raise notice 'PASS  section 1 — only the identifier may go, and only in that direction';
end $$;
rollback;


-- ===========================================================================
-- SECTION 2 — anonymising while changing something else is still refused.
--
-- The trap the carve-out must not open: a caller who nulls the actor AND
-- rewrites the payload in the same statement.
-- ===========================================================================
begin;
do $$
declare
  v_order bigint;
  v_event bigint;
  v_user  uuid;
  v_ok    boolean;
begin
  select id into v_order from public.orders order by id limit 1;
  select id into v_user from auth.users order by created_at limit 1;

  insert into public.order_events (order_id, event_type, actor_kind, actor_user_id, payload)
  values (v_order, 'test_carveout', 'admin', v_user, jsonb_build_object('probe', true))
  returning id into v_event;

  v_ok := false;
  begin
    update public.order_events
       set actor_user_id = null,
           payload       = '{"smuggled":true}'::jsonb
     where id = v_event;
  exception when others then v_ok := true;
  end;
  if not v_ok then raise exception 'a rewrite was smuggled in with the anonymisation'; end if;

  v_ok := false;
  begin
    update public.order_events
       set actor_user_id = null,
           event_type    = 'smuggled'
     where id = v_event;
  exception when others then v_ok := true;
  end;
  if not v_ok then raise exception 'an event_type change was smuggled in'; end if;

  raise notice 'PASS  section 2 — the carve-out carries nothing else with it';
end $$;
rollback;


-- ===========================================================================
-- SECTION 3 — the deletion path, proved on the account this defect stranded.
--
-- On 2026-09-11 a throwaway administrator that had shipped an order could not
-- be removed. That account is the fixture: it already carries a real
-- `order_shipped` event, and a `placed` event is added here so one deletion
-- proves the rule for both the customer and the administrator case.
--
-- ROLLED BACK. Section 4 does the removal for real.
-- ===========================================================================
begin;
do $$
declare
  v_order   bigint;
  v_user    uuid;
  v_placed  bigint;
  v_shipped bigint;
  v_row     public.order_events;
begin
  select id into v_user from auth.users where email like '%@staging.invalid' order by created_at limit 1;
  if v_user is null then
    raise exception 'no stranded throwaway account to prove the deletion path with — if it was already cleaned up, this section has nothing left to show';
  end if;

  select id into v_shipped
    from public.order_events
   where actor_user_id = v_user and event_type = 'order_shipped'
   limit 1;
  if v_shipped is null then
    raise exception 'the stranded account carries no order_shipped event';
  end if;

  select id into v_order from public.orders order by id limit 1;
  insert into public.order_events (order_id, event_type, actor_kind, actor_user_id, payload)
  values (v_order, 'placed', 'customer', v_user, '{}'::jsonb)
  returning id into v_placed;

  delete from public.shop_admins where user_id = v_user;

  -- THE WHOLE POINT: before 0020 this raised.
  delete from auth.users where id = v_user;

  select * into v_row from public.order_events where id = v_shipped;
  if not found then raise exception 'the shipping event vanished with the account'; end if;
  if v_row.actor_user_id is not null then raise exception 'the administrator survived the deletion'; end if;
  if v_row.event_type <> 'order_shipped' then raise exception 'the shipping event was altered'; end if;

  select * into v_row from public.order_events where id = v_placed;
  if not found then raise exception 'the placed event vanished with the account'; end if;
  if v_row.actor_user_id is not null then raise exception 'the customer survived the deletion'; end if;
  if v_row.event_type <> 'placed' then raise exception 'the placed event was altered'; end if;
  if v_row.actor_kind <> 'customer' then raise exception 'actor_kind was altered'; end if;

  raise notice 'PASS  section 3 — both a customer and an administrator can be deleted, events stay';
end $$;
rollback;


-- ===========================================================================
-- SECTION 4 — remove the stranded account for real. COMMITS.
--
-- ⚠️  This section deliberately does NOT roll back.
--
-- It touches only accounts whose address ends in `@staging.invalid` — the
-- throwaway pattern every seed and verifier in this repository uses. A real
-- account can never match.
-- ===========================================================================
do $$
declare
  v_user   record;
  v_before bigint;
  v_after  bigint;
  v_events bigint;
  v_total  bigint;
begin
  select count(*) into v_before from auth.users where email like '%@staging.invalid';
  raise notice 'stray throwaway accounts before: %', v_before;

  select count(*) into v_total from public.order_events;

  for v_user in
    select id, email from auth.users where email like '%@staging.invalid'
  loop
    select count(*) into v_events
      from public.order_events e where e.actor_user_id = v_user.id;

    delete from public.shop_admins where user_id = v_user.id;
    delete from auth.users where id = v_user.id;

    raise notice '  removed % (% order event(s) anonymised)', v_user.email, v_events;
  end loop;

  select count(*) into v_after from auth.users where email like '%@staging.invalid';
  if v_after <> 0 then
    raise exception '% throwaway account(s) still present', v_after;
  end if;

  -- The history they touched is still there, with no person attached.
  if (select count(*) from public.order_events) <> v_total then
    raise exception 'order_events count changed from % to %',
      v_total, (select count(*) from public.order_events);
  end if;

  raise notice 'PASS  section 4 — % stray account(s) removed, all % order event(s) intact',
    v_before, v_total;
end $$;
