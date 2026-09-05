-- ===========================================================================
-- 0003 — shop foundation
--
-- The technical ground for the first-party shop (ADR-0032, ADR-0033,
-- ADR-0037). It creates the authorization carrier, the stock table, the
-- movement journal and the two write paths — and nothing else. No orders, no
-- reservations API, no public projection, no import.
--
-- Three ideas shape everything below.
--
-- 1. The role does not live in `profiles`. That table carries a table-wide
--    UPDATE grant for `authenticated` plus profiles_update_own, so a `role`
--    column there would be self-assignable with one PostgREST call. The role
--    gets its own table that no client can read or write, and a single
--    function is the only way to ask about it.
--
-- 2. Stock belongs to the shop, not to an account. shop_inventory has no
--    user_id, which makes it structurally impossible for business stock to
--    end up in someone's personal collection. collection_items is untouched.
--
-- 3. quantity and the journal move together or not at all. Both are written
--    inside one function, in one transaction, and clients hold no write
--    privilege on either table — so there is no second way to change stock.
--
-- Additive only: three new tables, one view, six functions. No existing table,
-- column, policy or row is altered.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. shop_admins — who may manage the shop
--
-- Deliberately its own table. Deliberately unreadable: nothing in the
-- application needs the list, and a readable list answers "who else is an
-- admin" for anyone who asks.
-- ---------------------------------------------------------------------------
create table public.shop_admins (
  -- The stable identity. Never the email address: that identifies an account,
  -- it does not authorise one (ADR-0032). No address appears in this schema,
  -- in any policy, or in any function.
  user_id    uuid        primary key,

  granted_at timestamptz not null default now(),
  note       text,

  -- A deleted account must not leave a permission behind. Unlike the movement
  -- journal there is nothing here worth preserving.
  constraint shop_admins_user_fk foreign key (user_id)
    references auth.users (id)
    on update cascade
    on delete cascade
);

comment on table public.shop_admins is
  'Shop administrators. No client privileges at all; granted through the service role. Queried only via public.is_shop_admin().';


-- ---------------------------------------------------------------------------
-- 2. is_shop_admin() — the one place the question is answered
--
-- SECURITY DEFINER because shop_admins is readable by nobody. STABLE so the
-- planner may call it once per statement instead of once per row.
--
-- Takes no argument on purpose. An is_shop_admin(uuid) would be a lookup
-- service for other people's accounts.
-- ---------------------------------------------------------------------------
create or replace function public.is_shop_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.shop_admins
     where user_id = (select auth.uid())
  );
$$;

comment on function public.is_shop_admin() is
  'True when the current request belongs to a shop administrator. The only authorization predicate for shop writes.';

-- Postgres grants EXECUTE to PUBLIC on every new function, so this REVOKE is
-- required, not decorative.
revoke all on function public.is_shop_admin() from public, anon;
grant execute on function public.is_shop_admin() to authenticated;


-- ---------------------------------------------------------------------------
-- 3. shop_inventory — the shop's stock
--
-- Keyed by (sky_id, condition): the same figure can be stocked and priced
-- loose and boxed without inventing a second SKY-ID. Packaging is a property
-- of the stock, never a second collectible identity (ADR-0037, section 5a).
-- ---------------------------------------------------------------------------
create table public.shop_inventory (
  id                 bigint      generated always as identity primary key,

  -- Identity of the position. Both columns are immutable (trigger below):
  -- re-pointing a position would silently rewrite the meaning of every
  -- movement already recorded against it.
  sky_id             text        not null,
  condition          text        not null,

  quantity           integer     not null default 0,
  -- Held by a checkout that has not been paid yet. No API writes this in V1;
  -- the column exists so that reservations later need no data migration.
  reserved           integer     not null default 0,

  -- One definition of "available", used by the mutation function, the partial
  -- index and the later public projection. Three copies would drift.
  available_quantity integer     generated always as (quantity - reserved) stored,

  -- Manually maintained, and deliberately unrelated to skylanders.market_price
  -- (ADR-0037, section 7): a price update must never move a shop price.
  -- NULL means "no price decided yet", never "free".
  sale_price         numeric(10,2),

  -- Does the shop carry this at all? Separate from "is it in stock", so
  -- "listed but sold out" is expressible. Not to be confused with
  -- skylanders.is_active, which says whether the legacy source knows the row.
  is_listed          boolean     not null default false,

  -- Internal. Never public (docs/SECURITY.md).
  note               text,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint shop_inventory_sky_fk foreign key (sky_id)
    references public.skylanders (sky_id)
    on update cascade
    on delete restrict,

  -- V1 knows exactly two. sealed/new/used/mint and the rest wait for a real
  -- product requirement (ADR-0037, section 5). A CHECK rather than an enum,
  -- like characters_element_known in 0002: adding a value later is a
  -- constraint swap, while an enum value cannot be removed again.
  constraint shop_inventory_condition_known
    check (condition in ('loose', 'boxed')),

  constraint shop_inventory_quantity_not_negative check (quantity >= 0),
  constraint shop_inventory_reserved_not_negative check (reserved >= 0),

  -- The last net under the mutation function: stock can never fall below what
  -- is already promised to a checkout.
  constraint shop_inventory_reserved_within_quantity check (reserved <= quantity),

  -- Same rule as market_price (ADR-0010): 0 must not stand in for unknown.
  constraint shop_inventory_price_positive
    check (sale_price is null or sale_price > 0),

  -- Offering something without a price is not a listing.
  constraint shop_inventory_listed_needs_price
    check (not is_listed or sale_price is not null)
);

comment on table public.shop_inventory is
  'Shop stock, owned by SkyIsles. No user_id: business stock is never personal collection data (ADR-0032). No client privileges; written only through the mutation functions.';
comment on column public.shop_inventory.quantity is
  'Authoritative stock. Only apply_inventory_movement() changes it, always together with a journal row.';
comment on column public.shop_inventory.sale_price is
  'Manual shop price in EUR. Independent of skylanders.market_price. Single-currency by decision (ADR-0037, section 7).';

create unique index shop_inventory_sky_condition_key
  on public.shop_inventory (sky_id, condition);

-- The catalog join.
create index shop_inventory_sky_id_idx
  on public.shop_inventory (sky_id);

-- "Missing and available": a small slice of a table that is mostly not that.
create index shop_inventory_offer_idx
  on public.shop_inventory (sky_id)
  where is_listed and quantity > reserved;


-- ---------------------------------------------------------------------------
-- 3.1 The position's identity is immutable
--
-- RLS already keeps clients out, but the service role bypasses RLS — and the
-- later import runs as the service role. Triggers are NOT bypassed, which is
-- why this invariant lives here and not in a policy. Same reasoning as
-- prevent_sky_id_change() in 0001.
-- ---------------------------------------------------------------------------
create or replace function public.prevent_shop_inventory_identity_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.sky_id is distinct from old.sky_id
     or new.condition is distinct from old.condition then
    raise exception
      'shop_inventory identity is immutable (ADR-0037): (%, %) cannot become (%, %) — book the old position out and open a new one',
      old.sky_id, old.condition, new.sky_id, new.condition
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

comment on function public.prevent_shop_inventory_identity_change() is
  'Rejects any UPDATE that would re-point a stock position. Applies to the service role as well.';

create trigger shop_inventory_identity_immutable
  before update of sky_id, condition on public.shop_inventory
  for each row execute function public.prevent_shop_inventory_identity_change();

create trigger shop_inventory_set_updated_at
  before update on public.shop_inventory
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------------
-- 4. inventory_movements — the append-only journal
--
-- Every change of stock leaves exactly one row here, written in the same
-- transaction as the change itself. The business history is immutable for
-- every role: a wrong movement is corrected by a counter-movement, never by
-- editing or removing one. A position that carries history cannot be deleted
-- either — the reference below is RESTRICT, so there is no way around the
-- journal.
--
-- One change is permitted, and only one: `created_by` may be anonymised to
-- NULL when that account is deleted (see the trigger in 4.1). Nothing factual
-- moves with it.
--
-- No sky_id column. inventory_id -> shop_inventory -> sky_id is unique, the
-- position is never deleted, and its identity is immutable — so a snapshot
-- would duplicate a value that cannot diverge (ADR-0037, section 11).
--
-- No order_id yet: `orders` does not exist. It arrives with that migration.
-- ---------------------------------------------------------------------------
create table public.inventory_movements (
  id           bigint      generated always as identity primary key,

  inventory_id bigint      not null,

  -- Signed. Positive is goods in, negative is goods out.
  delta        integer     not null,

  reason       text        not null,

  -- Cost basis, and only for a real purchase. The legacy stock has none that
  -- can be substantiated (docs/SKYLANDERS_DATA.md 11d), so the import writes
  -- NULL rather than an estimate. From the first goods receipt of our own the
  -- price is known — and without these columns it would be lost for good
  -- (ADR-0037, section 21).
  unit_cost    numeric(10,2),
  currency     text,

  -- Internal. Never public.
  note         text,

  created_at   timestamptz not null default now(),

  -- NULL means "system", or "the account has since been deleted": the service
  -- role has no auth.uid(), and inventing an actor would be a false entry in
  -- an audit journal. Never taken from a parameter — the wrappers below set it
  -- themselves. ON DELETE SET NULL below is the only route by which an
  -- existing row ever changes, and the trigger in 4.1 limits it to exactly
  -- that.
  created_by   uuid,

  -- RESTRICT, like every other reference in this schema. Together with the
  -- append-only trigger below it means the history of a position cannot be
  -- removed by any route: not the movement on its own, and not by deleting
  -- the position it belongs to.
  constraint inventory_movements_inventory_fk foreign key (inventory_id)
    references public.shop_inventory (id)
    on update cascade
    on delete restrict,

  -- Deleting an account must not erase what it booked — and must not be
  -- blocked by it either. The trigger in 4.1 lets exactly this UPDATE through.
  constraint inventory_movements_actor_fk foreign key (created_by)
    references auth.users (id)
    on update cascade
    on delete set null,

  -- A movement of zero is not a movement.
  constraint inventory_movements_delta_not_zero check (delta <> 0),

  constraint inventory_movements_reason_known
    check (reason in (
      'purchase',        -- goods receipt with a known cost
      'sale_skyisles',   -- sold through the shop
      'sale_external',   -- sold elsewhere, eBay included — recorded by hand
      'return',          -- either direction, see below
      'correction',      -- a recount, either direction
      'writeoff',        -- damaged, lost
      'initial_import'   -- the start of the SkyIsles ledger, once per position
    )),

  -- Direction is fixed only where it is unambiguous. `return` deliberately
  -- allows both: a customer return is goods in, a return to a supplier is
  -- goods out, and a constraint that forbids one of them would only push the
  -- entry under a wrong reason.
  constraint inventory_movements_delta_direction
    check (
      case reason
        when 'purchase'       then delta > 0
        when 'initial_import' then delta > 0
        when 'sale_skyisles'  then delta < 0
        when 'sale_external'  then delta < 0
        when 'writeoff'       then delta < 0
        else true
      end
    ),

  -- Cost belongs to a purchase and nowhere else. initial_import is excluded on
  -- purpose: a column that must be NULL there says structurally that the
  -- legacy cost basis is unknown, instead of leaving room for a guess.
  constraint inventory_movements_cost_only_on_purchase
    check (reason = 'purchase' or (unit_cost is null and currency is null)),

  -- An amount without a currency is not an amount, and a currency without an
  -- amount says nothing.
  constraint inventory_movements_cost_pairs_with_currency
    check ((unit_cost is null) = (currency is null)),

  -- 0 is possible (a filler in a bundle); negative is not.
  constraint inventory_movements_cost_not_negative
    check (unit_cost is null or unit_cost >= 0),

  constraint inventory_movements_currency_iso
    check (currency is null or currency ~ '^[A-Z]{3}$')
);

comment on table public.inventory_movements is
  'Append-only stock journal. One row per change, written in the same transaction as the change. Never public, never updated, never deleted.';
comment on column public.inventory_movements.created_by is
  'The shop admin who booked it, or NULL for a system write such as the legacy import.';

-- At most one opening balance per position. This is what makes re-running the
-- later import safe: a second attempt fails on the index instead of doubling
-- the stock. The guarantee lives in the database, not in a script.
create unique index inventory_movements_one_initial_import
  on public.inventory_movements (inventory_id)
  where reason = 'initial_import';

create index inventory_movements_history_idx
  on public.inventory_movements (inventory_id, created_at desc);


-- ---------------------------------------------------------------------------
-- 4.1 Append-only, enforced for everyone
--
-- The REVOKEs below stop clients. This trigger also stops the service role,
-- which bypasses RLS but not triggers — the same reasoning that puts the
-- SKY-ID rule in a trigger in 0001.
--
-- DELETE is refused without exception, for every role. There is no escape via
-- the position either: the foreign key above is RESTRICT, so a position that
-- carries history cannot be deleted, and the history cannot be reached around
-- it. A mistakenly created position stays, empty and unlisted — the price of
-- an audit trail that means something, and the right one to pay.
--
-- UPDATE is refused too, with exactly one exception: anonymising the actor.
-- When an account is deleted, `created_by` must go from that person's id to
-- NULL — that is what ON DELETE SET NULL does, and PostgreSQL performs it as
-- an UPDATE on this table. Refusing it outright would make any account that
-- ever booked a movement permanently undeletable, which contradicts both the
-- intent written on that foreign key and the account-deletion promise in
-- docs/AUTH.md.
--
-- The boundary is the permitted mutation, not the caller: whether PostgreSQL
-- itself issued the UPDATE cannot be detected reliably, and guessing at it
-- would be a worse guarantee than checking what actually changed. Every
-- factual column must be identical, and `created_by` may only lose a value,
-- never gain or exchange one. The business history — what moved, when, why, at
-- what cost — stays untouchable; only the personal identifier can go.
-- ---------------------------------------------------------------------------
create or replace function public.prevent_inventory_movement_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    -- NULL-safe throughout: unit_cost, currency, note and created_by are all
    -- nullable, so plain equality would silently pass a row full of NULLs.
    if old.created_by is not null
       and new.created_by is null
       and (new.id, new.inventory_id, new.delta, new.reason,
            new.unit_cost, new.currency, new.note, new.created_at)
           is not distinct from
           (old.id, old.inventory_id, old.delta, old.reason,
            old.unit_cost, old.currency, old.note, old.created_at)
    then
      return new;
    end if;

    raise exception
      'inventory_movements is append-only (ADR-0037): the only permitted change is anonymising created_by to NULL when the account is deleted — record a counter-movement instead'
      using errcode = 'restrict_violation';
  end if;

  raise exception
    'inventory_movements is append-only (ADR-0037): history is never removed — record a counter-movement instead'
    using errcode = 'restrict_violation';
end;
$$;

comment on function public.prevent_inventory_movement_change() is
  'Refuses every DELETE, and every UPDATE except anonymising created_by to NULL with all factual columns unchanged (the ON DELETE SET NULL path). Applies to the service role as well.';

create trigger inventory_movements_append_only
  before update or delete on public.inventory_movements
  for each row execute function public.prevent_inventory_movement_change();


-- ---------------------------------------------------------------------------
-- 5. The mutation core
--
-- One implementation of the invariant, two authorization wrappers around it.
--
-- The problem this shape solves: an interactive shop write happens in the name
-- of a signed-in administrator and must be checked with is_shop_admin(). The
-- later legacy import runs as the service role, which has no auth.uid() and
-- therefore can never be a shop admin. Weakening is_shop_admin() to let it
-- through would open the same door to every signed-in user.
--
-- So authorization is separated from the logic:
--
--   apply_inventory_movement()          the invariant. Callable by NOBODY.
--     ^                     ^
--     |                     |
--   record_inventory_       system_record_inventory_
--   movement()              movement()
--   authenticated +         service_role only
--   is_shop_admin()         (no client role holds EXECUTE)
--   created_by = auth.uid() created_by = NULL
--
-- Postgres itself keeps the two apart: EXECUTE is a privilege, and a request
-- running as `authenticated` simply has none on the system wrapper. Nothing
-- here inspects a client-supplied flag, a JWT claim or an email address.
--
-- The inner function is reachable only because the wrappers are SECURITY
-- DEFINER owned by the migration owner, and an owner may always execute its
-- own functions. Every client role is revoked from it explicitly.
-- ---------------------------------------------------------------------------
create or replace function public.apply_inventory_movement(
  p_sky_id     text,
  p_condition  text,
  p_delta      integer,
  p_reason     text,
  p_unit_cost  numeric,
  p_currency   text,
  p_note       text,
  p_created_by uuid
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inventory_id bigint;
  v_movement_id  bigint;
  v_updated      integer;
begin
  if p_delta is null or p_delta = 0 then
    raise exception 'a movement needs a non-zero delta'
      using errcode = 'check_violation';
  end if;

  -- Open the position if this is the first movement for it. A position that
  -- ends up unused is impossible: any failure below aborts the whole call, and
  -- PostgREST runs one RPC in one transaction.
  insert into public.shop_inventory (sky_id, condition)
  values (p_sky_id, p_condition)
  on conflict (sky_id, condition) do nothing;

  -- Lock it before deciding anything. Concurrent movements on the same
  -- position serialise here instead of racing.
  select id
    into v_inventory_id
    from public.shop_inventory
   where sky_id = p_sky_id
     and condition = p_condition
   for update;

  if v_inventory_id is null then
    raise exception 'no stock position for % / %', p_sky_id, p_condition
      using errcode = 'no_data_found';
  end if;

  -- The guard is the WHERE clause, not a preceding SELECT. There is no window
  -- between checking and writing, so no client and no concurrent transaction
  -- can read a stock level, compute a new one and write it back.
  --
  -- `>= reserved` covers negative stock too, since reserved is never below 0.
  update public.shop_inventory
     set quantity = quantity + p_delta
   where id = v_inventory_id
     and quantity + p_delta >= reserved;

  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    raise exception
      'movement of % would take % / % below its reserved quantity',
      p_delta, p_sky_id, p_condition
      using errcode = 'check_violation';
  end if;

  -- Same transaction. Either both of these happened or neither did.
  insert into public.inventory_movements
    (inventory_id, delta, reason, unit_cost, currency, note, created_by)
  values
    (v_inventory_id, p_delta, p_reason, p_unit_cost, p_currency, p_note, p_created_by)
  returning id into v_movement_id;

  return v_movement_id;
end;
$$;

comment on function public.apply_inventory_movement(text, text, integer, text, numeric, text, text, uuid) is
  'Stock change and journal entry in one transaction. Internal: no role holds EXECUTE. Call it through record_inventory_movement() or system_record_inventory_movement().';

revoke all on function public.apply_inventory_movement(text, text, integer, text, numeric, text, text, uuid)
  from public, anon, authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 5.1 The interactive path — a signed-in shop administrator
-- ---------------------------------------------------------------------------
create or replace function public.record_inventory_movement(
  p_sky_id    text,
  p_condition text,
  p_delta     integer,
  p_reason    text,
  p_unit_cost numeric default null,
  p_currency  text    default null,
  p_note      text    default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Before anything else. EXECUTE is granted to `authenticated` as a whole,
  -- so this check — not the grant — is the authorization.
  if not public.is_shop_admin() then
    raise exception 'shop administrator role required'
      using errcode = 'insufficient_privilege';
  end if;

  -- The actor is read from the request, never accepted as an argument.
  return public.apply_inventory_movement(
    p_sky_id, p_condition, p_delta, p_reason,
    p_unit_cost, p_currency, p_note, (select auth.uid())
  );
end;
$$;

comment on function public.record_inventory_movement(text, text, integer, text, numeric, text, text) is
  'Books a stock movement for a signed-in shop administrator. Records auth.uid() as the actor.';

revoke all on function public.record_inventory_movement(text, text, integer, text, numeric, text, text)
  from public, anon;
grant execute on function public.record_inventory_movement(text, text, integer, text, numeric, text, text)
  to authenticated;


-- ---------------------------------------------------------------------------
-- 5.2 The system path — controlled server tooling, service role only
--
-- No cost parameters at all: the one job this path has in V1 is the legacy
-- opening balance, and that has no substantiated cost basis. Leaving the
-- arguments out is stronger than documenting that they should stay NULL.
-- ---------------------------------------------------------------------------
create or replace function public.system_record_inventory_movement(
  p_sky_id    text,
  p_condition text,
  p_delta     integer,
  p_reason    text,
  p_note      text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- No is_shop_admin() check: the authorization IS the EXECUTE privilege,
  -- which only service_role holds. A request running as anon or authenticated
  -- is rejected by Postgres before this body is reached.
  return public.apply_inventory_movement(
    p_sky_id, p_condition, p_delta, p_reason, null, null, p_note, null
  );
end;
$$;

comment on function public.system_record_inventory_movement(text, text, integer, text, text) is
  'Books a stock movement from controlled server tooling. Executable only by service_role; records created_by NULL (system). No cost parameters.';

revoke all on function public.system_record_inventory_movement(text, text, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.system_record_inventory_movement(text, text, integer, text, text)
  to service_role;


-- ---------------------------------------------------------------------------
-- 6. set_shop_listing — price and listing, never stock
--
-- Separate from movements because it changes no quantity: there is nothing to
-- journal. It cannot touch quantity or reserved, and it cannot re-point a
-- position, because sky_id and condition are the conflict key rather than
-- something it assigns.
-- ---------------------------------------------------------------------------
create or replace function public.set_shop_listing(
  p_sky_id     text,
  p_condition  text,
  p_sale_price numeric,
  p_is_listed  boolean,
  p_note       text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inventory_id bigint;
begin
  if not public.is_shop_admin() then
    raise exception 'shop administrator role required'
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.shop_inventory (sky_id, condition, sale_price, is_listed, note)
  values (p_sky_id, p_condition, p_sale_price, coalesce(p_is_listed, false), p_note)
  on conflict (sky_id, condition) do update
     set sale_price = excluded.sale_price,
         is_listed  = excluded.is_listed,
         note       = excluded.note
  returning id into v_inventory_id;

  return v_inventory_id;
end;
$$;

comment on function public.set_shop_listing(text, text, numeric, boolean, text) is
  'Sets price, listing flag and internal note for a stock position, creating it at quantity 0 if needed. Never changes quantity or reserved.';

revoke all on function public.set_shop_listing(text, text, numeric, boolean, text)
  from public, anon;
grant execute on function public.set_shop_listing(text, text, numeric, boolean, text)
  to authenticated;


-- ---------------------------------------------------------------------------
-- 7. Reconciliation
--
-- Postgres cannot express "the sum of one table equals a column of another" as
-- a constraint, and a trigger would be worse than nothing: it would write the
-- same mistake twice and hide it. A view costs nothing and turns the check
-- into one query — run by tools/verify-rls.mts.
--
-- security_invoker: the view is evaluated with the caller's rights, so it
-- cannot become a way around the REVOKEs on the tables underneath.
-- ---------------------------------------------------------------------------
create view public.shop_inventory_reconciliation
with (security_invoker = true) as
  select
    i.id                                        as inventory_id,
    i.sky_id,
    i.condition,
    i.quantity,
    coalesce(sum(m.delta), 0)::integer          as movement_sum,
    i.quantity - coalesce(sum(m.delta), 0)::integer as drift
  from public.shop_inventory i
  left join public.inventory_movements m on m.inventory_id = i.id
  group by i.id, i.sky_id, i.condition, i.quantity;

comment on view public.shop_inventory_reconciliation is
  'Internal audit: drift must be 0 for every position. No client privileges.';

revoke all on public.shop_inventory_reconciliation from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 8. Row Level Security
--
-- All three tables carry RLS with no policy at all. Not an oversight: no
-- client may read or write any of it.
--
--   * shop_admins    — the list of administrators is not public information
--   * shop_inventory — quantity, reserved and note are business data
--                      (docs/SECURITY.md); a plain SELECT would expose all
--                      three, and column grants would leak again with the next
--                      column added
--   * inventory_movements — purchase prices, reasons, actors
--
-- The public shop projection comes with the shop UI: a narrow view or RPC
-- exposing sky_id, condition, sale_price, is_listed and a derived in-stock
-- boolean — never a number. The foundation has no public surface and
-- therefore needs none.
-- ---------------------------------------------------------------------------
alter table public.shop_admins        enable row level security;
alter table public.shop_inventory     enable row level security;
alter table public.inventory_movements enable row level security;


-- ---------------------------------------------------------------------------
-- 9. Privileges
--
-- Supabase grants ALL on every new table in `public` to anon, authenticated
-- and service_role through ALTER DEFAULT PRIVILEGES, and GRANT is additive —
-- so these REVOKEs are what actually closes the tables.
--
-- TRUNCATE matters most: row level security does not apply to it, which makes
-- the table privilege the only thing between a client and an empty table.
--
-- Shop administrators get no table privileges either. Their whole write
-- surface is EXECUTE on the three functions above, which is the only place the
-- quantity/journal invariant can be guaranteed.
--
-- service_role keeps its default privileges: it is the trusted server path,
-- and the import needs to read the catalog and seed admins. It is not exempt
-- from the triggers — the journal stays append-only and positions stay
-- immutable for it too — and any direct write it makes that skipped the
-- functions would show up as drift in the reconciliation view.
-- ---------------------------------------------------------------------------
revoke all on public.shop_admins        from anon, authenticated;
revoke all on public.shop_inventory     from anon, authenticated;
revoke all on public.inventory_movements from anon, authenticated;

-- No sequence grants: identity sequences are only advanced by an INSERT, and
-- no client role may insert into any of these tables. The functions run as the
-- owner and need no grant of their own.
