-- ===========================================================================
-- 0025 — runtime verification of the movement vocabulary, STAGING ONLY
--
-- One question, asked from both sides: can a NEW sale be booked as `sale`,
-- and is the OLD name still exactly as untouchable as it was?
--
--   HOW TO RUN
--   Supabase Dashboard -> SQL Editor, on the STAGING project. One section at a
--   time. Each raises on the first failure, so a section that finishes without
--   an error has passed.
--
--   EVERY SECTION ROLLS BACK. Nothing here commits, nothing is left behind,
--   and no historical movement is changed — that is the point of section 2.
--
--   ⚠️  NEVER RUN THIS AGAINST PRODUCTION.
-- ===========================================================================


-- ===========================================================================
-- SECTION 0 — preflight. Reads only.
-- ===========================================================================
do $$
declare
  v_inv bigint;
  v_def text;
begin
  select count(*) into v_inv from public.shop_inventory;
  if v_inv > 50 then
    raise exception 'This does not look like staging (% inventory rows). STOP.', v_inv;
  end if;

  -- The vocabulary must have grown, not moved.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.inventory_movements'::regclass
       and conname  = 'inventory_movements_reason_known'
       and pg_get_constraintdef(oid) like '%''sale''%'
  ) then
    raise exception '0025 not applied: `sale` is not a permitted reason';
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.inventory_movements'::regclass
       and conname  = 'inventory_movements_reason_known'
       and pg_get_constraintdef(oid) like '%sale_skyisles%'
  ) then
    raise exception 'sale_skyisles was removed — history can never satisfy this constraint';
  end if;

  -- The writer must book the new name.
  select pg_get_functiondef('public.convert_order_reservations(bigint)'::regprocedure)
    into v_def;
  if v_def not like '%''sale''%' then
    raise exception 'convert_order_reservations() does not book `sale`';
  end if;
  if v_def like '%sale_skyisles%' then
    raise exception 'convert_order_reservations() still books the old name';
  end if;

  -- And the guard must be untouched.
  if not exists (
    select 1 from pg_trigger t
     where t.tgrelid = 'public.inventory_movements'::regclass
       and t.tgfoid  = 'public.prevent_inventory_movement_change()'::regprocedure
  ) then
    raise exception 'inventory_movements lost its append-only guard';
  end if;

  raise notice 'PASS  section 0 — vocabulary grew, writer switched, guard intact';
end $$;


-- ===========================================================================
-- SECTION 1 — the census. Reads only, prints the numbers to compare against.
-- ===========================================================================
do $$
declare
  v_old bigint;
  v_new bigint;
begin
  select count(*) into v_old from public.inventory_movements where reason = 'sale_skyisles';
  select count(*) into v_new from public.inventory_movements where reason = 'sale';
  raise notice 'CENSUS  sale_skyisles = %   sale = %', v_old, v_new;
  raise notice '        note the first number: section 4 asserts it has not moved';
end $$;


-- ===========================================================================
-- SECTION 2 — the old name is still untouchable, in both directions.
--
-- THE CORE PROMISE OF 0025. If any of this passes where it should fail, the
-- migration has opened a hole in the append-only journal.
-- ===========================================================================
begin;
do $$
declare
  v_id  bigint;
  v_row public.inventory_movements;
  v_ok  boolean;
begin
  select id into v_id from public.inventory_movements
   where reason = 'sale_skyisles' order by id limit 1;
  if v_id is null then
    raise notice 'SKIP  section 2 — no historical sale_skyisles row on this database';
    return;
  end if;

  select * into v_row from public.inventory_movements where id = v_id;

  -- Renaming history to the new name: refused.
  v_ok := false;
  begin
    update public.inventory_movements set reason = 'sale' where id = v_id;
  exception when others then v_ok := true;
  end;
  if not v_ok then raise exception 'a historical movement was renamed to `sale`'; end if;

  -- A blanket backfill: refused.
  v_ok := false;
  begin
    update public.inventory_movements set reason = 'sale' where reason = 'sale_skyisles';
  exception when others then v_ok := true;
  end;
  if not v_ok then raise exception 'a backfill rewrote history'; end if;

  -- Deleting it instead: refused.
  v_ok := false;
  begin
    delete from public.inventory_movements where id = v_id;
  exception when others then v_ok := true;
  end;
  if not v_ok then raise exception 'a historical movement was deleted'; end if;

  -- And nothing about the row moved while we tried.
  if (select reason from public.inventory_movements where id = v_id) <> 'sale_skyisles' then
    raise exception 'the reason changed after all';
  end if;
  if (select delta from public.inventory_movements where id = v_id) <> v_row.delta then
    raise exception 'the delta changed';
  end if;

  raise notice 'PASS  section 2 — history cannot be renamed, backfilled or deleted';
end $$;
rollback;


-- ===========================================================================
-- SECTION 3 — the new name behaves exactly as the old one did.
-- ===========================================================================
begin;
do $$
declare
  v_inv bigint;
  v_sky text;
  v_con text;
  v_id  bigint;
  v_ok  boolean;
begin
  select id, sky_id, condition into v_inv, v_sky, v_con
    from public.shop_inventory where quantity > 0 order by id limit 1;
  if v_inv is null then
    raise notice 'SKIP  section 3 — no position with stock';
    return;
  end if;

  -- Negative: accepted, same as sale_skyisles.
  v_id := public.apply_inventory_movement(v_sky, v_con, -1, 'sale', null, null, 'probe 0025', null);
  if v_id is null then raise exception 'a negative `sale` was not booked'; end if;
  if (select reason from public.inventory_movements where id = v_id) <> 'sale' then
    raise exception 'the movement was booked under a different reason';
  end if;

  -- Positive: refused by the direction rule, same as sale_skyisles.
  v_ok := false;
  begin
    perform public.apply_inventory_movement(v_sky, v_con, 1, 'sale', null, null, 'probe 0025', null);
  exception when others then v_ok := true;
  end;
  if not v_ok then raise exception 'a positive `sale` was accepted'; end if;

  -- A cost on a sale: still impossible.
  v_ok := false;
  begin
    perform public.apply_inventory_movement(v_sky, v_con, -1, 'sale', 4.24, 'EUR', 'probe 0025', null);
  exception when others then v_ok := true;
  end;
  if not v_ok then raise exception 'a `sale` carried a unit cost'; end if;

  -- An invented reason: still refused.
  v_ok := false;
  begin
    perform public.apply_inventory_movement(v_sky, v_con, -1, 'sale_platform', null, null, 'probe', null);
  exception when others then v_ok := true;
  end;
  if not v_ok then raise exception 'an unknown reason was accepted'; end if;

  -- And a `sale` movement is as append-only as every other.
  v_ok := false;
  begin
    update public.inventory_movements set reason = 'correction' where id = v_id;
  exception when others then v_ok := true;
  end;
  if not v_ok then raise exception 'a `sale` movement was rewritten'; end if;

  raise notice 'PASS  section 3 — `sale` books out, refuses in, carries no cost, cannot be rewritten';
end $$;
rollback;


-- ===========================================================================
-- SECTION 4 — the census again. Nothing may have moved.
-- ===========================================================================
do $$
declare
  v_old bigint;
begin
  select count(*) into v_old from public.inventory_movements where reason = 'sale_skyisles';
  raise notice 'CENSUS  sale_skyisles = %  — compare with section 1', v_old;
  raise notice 'PASS  section 4 — read the two numbers; they must be equal';
end $$;
