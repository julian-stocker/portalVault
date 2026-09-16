-- ===========================================================================
-- 0037 - navigation telemetry, for test accounts only
--
-- WHY
--
-- Navigation on a real phone feels slow, and "feels" is where every argument
-- about performance goes to die. This records how long it actually takes, on
-- the device it actually happens on, while the operator uses SkyIsles normally
-- — no developer tools, no stopwatch, no button before every tap.
--
-- WHAT IS RECORDED, AND WHAT IS NOT
--
-- Three durations, two normalised ROUTE PATTERNS, a viewport and a run id.
-- `/skylanders/[slug]`, never `/skylanders/gold-fire-kraken`: the question is
-- which KIND of navigation is slow, and a figure's name is not part of it.
--
-- Not recorded, and there is no column that could hold them: query strings,
-- search terms, form contents, cart contents, tokens, cookies, headers, page
-- contents. No session replay, no keystrokes. The widest field here is a
-- 64-character route pattern.
--
-- THIS IS NOT ANALYTICS
--
-- It runs for accounts that hold `performance_tracking` (ADR-0071) and for
-- nobody else. A normal visitor generates no row, sends no request and does
-- not even load the code: the component is mounted server-side or not at all.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. perf_navigations
--
-- One row per navigation the tester performed. The three durations are the
-- whole point:
--
--   interaction_to_visible_ms   A -> C   what it felt like
--   interaction_to_commit_ms    A -> B   waiting: server, data, router
--   commit_to_visible_ms        B -> C   rendering and paint after the commit
--
-- The second and third are what turn "1500 ms" into something actionable.
-- ---------------------------------------------------------------------------
create table if not exists public.perf_navigations (
  id         bigint      generated always as identity primary key,

  -- One browser session. Grouping is what makes a run comparable to another.
  run_id     uuid        not null,
  -- Derived from auth.uid() by the recorder. Never sent by the client.
  user_id    uuid        not null,
  occurred_at timestamptz not null default now(),

  -- Normalised patterns, never URLs. `from_route` is null for the first
  -- navigation of a run, where there is no previous route to name.
  from_route text,
  to_route   text        not null,

  interaction_to_visible_ms integer not null,
  interaction_to_commit_ms  integer not null,
  commit_to_visible_ms      integer not null,

  viewport_w smallint    not null,
  viewport_h smallint    not null,

  -- This route pair was already seen in this run. Nothing more: it does NOT
  -- claim anything about the Next.js router cache, only that the pair repeated.
  warm       boolean     not null default false,

  -- Which deployment produced these numbers, so before and after are telling
  -- apart. A commit sha or 'dev'; never a secret.
  build_id   text,
  -- An optional name the operator gave the run, e.g. 'mobile-baseline-1'.
  label      text,

  constraint perf_navigations_user_fk foreign key (user_id)
    references auth.users (id)
    on update cascade
    on delete cascade,

  -- A route pattern, not a URL: no query, no hash, no host. The CHECK says so
  -- rather than trusting the client that sends it.
  constraint perf_navigations_from_route_pattern
    check (from_route is null or from_route ~ '^/[A-Za-z0-9\[\]/_-]{0,63}$'),
  constraint perf_navigations_to_route_pattern
    check (to_route ~ '^/[A-Za-z0-9\[\]/_-]{0,63}$'),

  /*
   * Non-negative, and capped at ten minutes. A longer "navigation" is a phone
   * that went into a pocket, not a measurement — the client drops those, and
   * this is the second line so a bug cannot fill the table with nonsense.
   */
  constraint perf_navigations_visible_sane
    check (interaction_to_visible_ms >= 0 and interaction_to_visible_ms <= 600000),
  constraint perf_navigations_commit_sane
    check (interaction_to_commit_ms >= 0 and interaction_to_commit_ms <= 600000),
  constraint perf_navigations_paint_sane
    check (commit_to_visible_ms >= 0 and commit_to_visible_ms <= 600000),

  constraint perf_navigations_viewport_sane
    check (viewport_w between 0 and 10000 and viewport_h between 0 and 10000),

  constraint perf_navigations_build_id_bounded
    check (build_id is null or build_id ~ '^[A-Za-z0-9._-]{1,64}$'),
  constraint perf_navigations_label_bounded
    check (label is null or label ~ '^[a-z0-9][a-z0-9-]{0,39}$')
);

comment on table public.perf_navigations is
  'Navigation timings from accounts holding the performance_tracking tester permission (ADR-0072). Route PATTERNS only - no URLs, no query strings, no search terms, no page or cart contents. Not analytics: a normal visitor never reaches this table and never loads the code that writes it.';

comment on column public.perf_navigations.interaction_to_visible_ms is
  'A -> C. From the tap to the first frame after the destination rendered. The perceived duration, and the metric this table exists for.';
comment on column public.perf_navigations.interaction_to_commit_ms is
  'A -> B. From the tap until the router changed route. Waiting: server, data, router.';
comment on column public.perf_navigations.commit_to_visible_ms is
  'B -> C. From the route change to the first painted frame. Rendering and hydration.';
comment on column public.perf_navigations.warm is
  'This from/to pair already occurred in this run. Says nothing about the Next.js cache - only that the pair repeated.';

alter table public.perf_navigations enable row level security;
revoke all on public.perf_navigations from anon, authenticated;

-- The two ways it is ever read: one run, and one route pair across runs.
create index if not exists perf_navigations_run_idx
  on public.perf_navigations (run_id, occurred_at);
create index if not exists perf_navigations_pair_idx
  on public.perf_navigations (to_route, from_route, occurred_at desc);


-- ---------------------------------------------------------------------------
-- 2. record_navigation - the only way in
--
-- The account is taken from `auth.uid()` and the permission is asked before
-- anything is written. There is no `p_user_id`: a telemetry endpoint that
-- accepted one would let any signed-in account write rows in somebody else's
-- name, and the table would stop meaning anything.
--
-- A caller without the permission is refused, not silently ignored. Silence
-- would hide a misconfigured tester for a whole test run.
-- ---------------------------------------------------------------------------
create or replace function public.record_navigation(
  p_run_id                    uuid,
  p_to_route                  text,
  p_interaction_to_visible_ms integer,
  p_interaction_to_commit_ms  integer,
  p_commit_to_visible_ms      integer,
  p_viewport_w                integer,
  p_viewport_h                integer,
  p_warm                      boolean default false,
  p_from_route                text    default null,
  p_build_id                  text    default null,
  p_label                     text    default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'not authorized' using errcode = 'insufficient_privilege';
  end if;

  /*
   * The gate. `commerce` grants nothing here and `shop_admins` grants nothing
   * here: a tester permission is exactly the one thing it names (ADR-0071).
   */
  if not public.has_tester_permission('performance_tracking') then
    raise exception 'not authorized' using errcode = 'insufficient_privilege';
  end if;

  if p_run_id is null then
    raise exception 'a navigation belongs to a run' using errcode = 'check_violation';
  end if;

  -- Everything else is decided by the CHECK constraints, which are the one
  -- description of what a valid row is. Repeating them here would be a second
  -- description to keep in step.
  insert into public.perf_navigations (
    run_id, user_id, from_route, to_route,
    interaction_to_visible_ms, interaction_to_commit_ms, commit_to_visible_ms,
    viewport_w, viewport_h, warm, build_id, label
  ) values (
    p_run_id, (select auth.uid()), p_from_route, p_to_route,
    p_interaction_to_visible_ms, p_interaction_to_commit_ms, p_commit_to_visible_ms,
    p_viewport_w, p_viewport_h, coalesce(p_warm, false),
    nullif(btrim(coalesce(p_build_id, '')), ''),
    nullif(btrim(coalesce(p_label, '')), '')
  );
end;
$$;

comment on function public.record_navigation(uuid, text, integer, integer, integer, integer, integer, boolean, text, text, text) is
  'Records one navigation timing (ADR-0072). Requires the performance_tracking tester permission; commerce and shop_admins grant nothing here. The account comes from auth.uid() and is never an argument.';

revoke all on function public.record_navigation(uuid, text, integer, integer, integer, integer, integer, boolean, text, text, text)
  from public, anon;
grant  execute on function public.record_navigation(uuid, text, integer, integer, integer, integer, integer, boolean, text, text, text)
  to authenticated;


-- ---------------------------------------------------------------------------
-- 3. Reading it back - administrators only
--
-- THE TESTER CANNOT READ THIS. Generating the rows is not a reason to see
-- them: the table names which accounts were slow where, and that is an
-- operator's view, not a participant's.
-- ---------------------------------------------------------------------------

-- 3.1 Which runs exist, newest first. Enough to pick one.
create or replace function public.admin_perf_runs(p_limit integer default 20)
returns table (
  run_id      uuid,
  label       text,
  build_id    text,
  user_id     uuid,
  started_at  timestamptz,
  ended_at    timestamptz,
  navigations bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_shop_admin() then
    raise exception 'shop administrator role required'
      using errcode = 'insufficient_privilege';
  end if;

  return query
    select n.run_id,
           max(n.label)      as label,
           max(n.build_id)   as build_id,
           -- A run belongs to one account; max() is just a way to carry it
           -- through the grouping.
           max(n.user_id)    as user_id,
           min(n.occurred_at) as started_at,
           max(n.occurred_at) as ended_at,
           count(*)          as navigations
      from public.perf_navigations n
     group by n.run_id
     order by min(n.occurred_at) desc
     limit greatest(1, least(coalesce(p_limit, 20), 200));
end;
$$;

comment on function public.admin_perf_runs(integer) is
  'The recorded runs, newest first (ADR-0072). Administrators only.';

revoke all on function public.admin_perf_runs(integer) from public, anon;
grant  execute on function public.admin_perf_runs(integer) to authenticated;


-- 3.2 The aggregate, per route pair.
--
-- Percentiles in SQL rather than in the report script: `percentile_cont` is
-- exactly this calculation, and doing it twice in two languages is two places
-- for it to be subtly different.
create or replace function public.admin_perf_report(
  p_run_id uuid default null,
  p_label  text default null
)
returns table (
  from_route text,
  to_route   text,
  warm       boolean,
  samples    bigint,
  visible_p50 integer,
  visible_p75 integer,
  visible_p95 integer,
  visible_min integer,
  visible_max integer,
  commit_p50  integer,
  paint_p50   integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_shop_admin() then
    raise exception 'shop administrator role required'
      using errcode = 'insufficient_privilege';
  end if;

  return query
    select n.from_route,
           n.to_route,
           n.warm,
           count(*) as samples,
           percentile_cont(0.50) within group (order by n.interaction_to_visible_ms)::integer,
           percentile_cont(0.75) within group (order by n.interaction_to_visible_ms)::integer,
           percentile_cont(0.95) within group (order by n.interaction_to_visible_ms)::integer,
           min(n.interaction_to_visible_ms),
           max(n.interaction_to_visible_ms),
           percentile_cont(0.50) within group (order by n.interaction_to_commit_ms)::integer,
           percentile_cont(0.50) within group (order by n.commit_to_visible_ms)::integer
      from public.perf_navigations n
     where (p_run_id is null or n.run_id = p_run_id)
       and (p_label  is null or n.label  = p_label)
     group by n.from_route, n.to_route, n.warm
     order by percentile_cont(0.75) within group (order by n.interaction_to_visible_ms) desc;
end;
$$;

comment on function public.admin_perf_report(uuid, text) is
  'Navigation timings aggregated per route pair, slowest p75 first (ADR-0072). Administrators only. Percentiles are computed here so there is one implementation of them.';

revoke all on function public.admin_perf_report(uuid, text) from public, anon;
grant  execute on function public.admin_perf_report(uuid, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 4. Retention
--
-- Ninety days, deleted when somebody asks. No cron and no background job: a
-- measurement table does not justify scheduling infrastructure, and nothing
-- may delete rows while a visitor is navigating.
-- ---------------------------------------------------------------------------
create or replace function public.admin_prune_perf_navigations(p_days integer default 90)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted bigint;
begin
  if not public.is_shop_admin() then
    raise exception 'shop administrator role required'
      using errcode = 'insufficient_privilege';
  end if;

  delete from public.perf_navigations
   where occurred_at < now() - (greatest(1, coalesce(p_days, 90)) || ' days')::interval;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

comment on function public.admin_prune_perf_navigations(integer) is
  'Deletes navigation timings older than the given number of days, 90 by default (ADR-0072). Administrators only, run by hand: measurement data is not worth a scheduler.';

revoke all on function public.admin_prune_perf_navigations(integer) from public, anon;
grant  execute on function public.admin_prune_perf_navigations(integer) to authenticated;


-- ---------------------------------------------------------------------------
-- 5. What is deliberately absent
--
-- No client privilege on `perf_navigations`. Not select, not insert. The
-- tester writes through `record_navigation()` and can read nothing back.
--
-- No column for a URL, a query string, a search term or any page content.
-- The schema is the guarantee: there is nowhere to put them.
--
-- No scheduler. See section 4.
-- ---------------------------------------------------------------------------
