-- ===========================================================================
-- 0038 - in-page interaction telemetry, for test accounts only
--
-- WHY THIS EXISTS BESIDE 0037
--
-- 0037 measures route navigations, and the first real Production run proved
-- it measures them correctly: 13 navigations, every one a masthead link. It
-- also proved something more useful — the catalog's PRIMARY interaction is
-- not a navigation at all. Tapping a figure opens the quick view through
-- React state (ADR-0027): no pathname changes, so navigation telemetry has
-- nothing to time, and the interaction most responsible for how SkyIsles
-- feels produced zero rows.
--
-- WHY A SECOND TABLE RATHER THAN A ROW IN THE FIRST
--
-- `perf_navigations.from_route` and `to_route` mean routes. Writing
-- `/[dialog]/quick-view` into a route column would make both columns mean
-- "a route, or sometimes not", and every later query would have to know
-- which. An interaction has a PLACE, not a direction, so it gets one `route`
-- column and a key saying what happened.
--
-- FOUR MOMENTS, NOT THREE
--
--   A  the tap on the trigger
--   B  the dialog is committed into the DOM
--   C  the first frame after that          - the structure is on screen
--   D  the artwork is ready to be seen     - nullable
--
-- D exists because opening the quick view LOADS NO DATA: the figure and its
-- offers are already in the browser (`lib/ui/quick-view.ts`). A -> C is
-- therefore pure client render and will usually look fast. The picture is
-- another matter: it is `loading="lazy"`, and for a figure with an
-- administrator override it comes from Supabase Storage over the network. A
-- report that omitted D would say "the quick view opens in 40 ms" while the
-- tester waits for an image, which is how a measurement becomes a lie.
--
-- WHAT IS RECORDED, AND WHAT IS NOT
--
-- An interaction key from a closed set, one normalised ROUTE PATTERN, four
-- durations, a viewport and a run id. Never which figure: no sky_id, no slug,
-- no name, no image URL. `quick_view_open` on `/` says a dialog opened, never
-- which one. There is no column that could hold a query string, a search
-- term, form or cart contents, a token or a header.
--
-- THIS IS NOT ANALYTICS
--
-- Same gate as 0037: `performance_tracking` (ADR-0071) and nobody else. A
-- normal visitor generates no row, sends no request and does not load the
-- code - the component is mounted server-side or not at all.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. perf_interactions
--
-- Deliberately NOT a copy of perf_navigations. Two columns differ, and both
-- differences carry meaning:
--
--   route               singular. An interaction happens somewhere; it does
--                       not go anywhere.
--   content_visible_ms  nullable. Some interactions have no artwork, and some
--                       browsers give no trustworthy signal that it arrived.
--                       A null says "not measured"; a zero would say
--                       "instant", which is a different and false claim.
-- ---------------------------------------------------------------------------
create table if not exists public.perf_interactions (
  id         bigint      generated always as identity primary key,

  -- The SAME run as the navigations recorded beside it. One run, one tab, one
  -- report covering both halves of what the tester did.
  run_id     uuid        not null,
  -- Derived from auth.uid() by the recorder. Never sent by the client.
  user_id    uuid        not null,
  occurred_at timestamptz not null default now(),

  -- Where it happened, as a pattern. Never a URL, never a slug.
  route      text        not null,
  -- What happened. A closed set - see the CHECK below.
  interaction text       not null,

  interaction_to_visible_ms integer not null,
  interaction_to_commit_ms  integer not null,
  commit_to_visible_ms      integer not null,

  /*
   * A -> D. Null when there is no artwork, when the browser gave no usable
   * signal, or when the dialog went away before the picture arrived.
   *
   * NOT clamped against interaction_to_visible_ms. A cached image can be
   * decoded before the second animation frame that defines C, so
   * content_visible_ms < interaction_to_visible_ms is a real and ordinary
   * outcome - it means the picture was never the thing being waited for.
   * Clamping it would erase exactly the case we most want to recognise.
   */
  content_visible_ms integer,

  viewport_w smallint    not null,
  viewport_h smallint    not null,

  /*
   * This interaction key was already seen on this route in this run.
   *
   * Nothing more. It does NOT claim the image was cached, that the Next.js
   * router cache was warm, or that Storage had the object - the row records
   * no image identity at all, so it could not know. Two quick views of two
   * different figures fetch two different pictures and the second is still
   * "warm" by this definition.
   */
  warm       boolean     not null default false,

  build_id   text,
  label      text,

  constraint perf_interactions_user_fk foreign key (user_id)
    references auth.users (id)
    on update cascade
    on delete cascade,

  -- The same pattern 0037 uses, for the same reason: no query, no hash, no
  -- host, and nothing a visitor typed.
  constraint perf_interactions_route_pattern
    check (route ~ '^/[A-Za-z0-9\[\]/_-]{0,63}$'),

  /*
   * THE CLOSED SET.
   *
   * A CHECK rather than a registry table, and the difference from ADR-0071 is
   * the point: tester features are an OPEN set, so a new one had to be an
   * INSERT. Interaction keys are closed by construction - a key cannot exist
   * until somebody writes the client code that emits it, which is already a
   * deploy. A registry would be ceremony around a constraint that is real.
   */
  constraint perf_interactions_known
    check (interaction in ('quick_view_open')),

  -- Non-negative and capped at ten minutes, as in 0037. A longer
  -- "interaction" is a phone that went into a pocket, not a measurement.
  constraint perf_interactions_visible_sane
    check (interaction_to_visible_ms >= 0 and interaction_to_visible_ms <= 600000),
  constraint perf_interactions_commit_sane
    check (interaction_to_commit_ms >= 0 and interaction_to_commit_ms <= 600000),
  constraint perf_interactions_paint_sane
    check (commit_to_visible_ms >= 0 and commit_to_visible_ms <= 600000),
  constraint perf_interactions_content_sane
    check (content_visible_ms is null
           or (content_visible_ms >= 0 and content_visible_ms <= 600000)),

  constraint perf_interactions_viewport_sane
    check (viewport_w between 0 and 10000 and viewport_h between 0 and 10000),

  constraint perf_interactions_build_id_bounded
    check (build_id is null or build_id ~ '^[A-Za-z0-9._-]{1,64}$'),
  constraint perf_interactions_label_bounded
    check (label is null or label ~ '^[a-z0-9][a-z0-9-]{0,39}$')
);

comment on table public.perf_interactions is
  'In-page interaction timings from accounts holding performance_tracking (ADR-0073). A -> C is the structure on screen, A -> D the artwork. Never identifies what was opened: no sky_id, slug, name or image path.';
comment on column public.perf_interactions.content_visible_ms is
  'A -> D, the artwork ready to be seen. Null when there is no image, no trustworthy signal, or the dialog closed first. May legitimately be less than interaction_to_visible_ms when the picture was already decoded.';
comment on column public.perf_interactions.warm is
  'This interaction key already occurred on this route in this run. Says nothing about any cache.';

alter table public.perf_interactions enable row level security;
revoke all on public.perf_interactions from anon, authenticated;

-- The two ways it is ever read: one run, and one interaction across runs.
create index if not exists perf_interactions_run_idx
  on public.perf_interactions (run_id, occurred_at);
create index if not exists perf_interactions_key_idx
  on public.perf_interactions (interaction, route, occurred_at desc);


-- ---------------------------------------------------------------------------
-- 2. record_interaction - the only way in
--
-- Identical posture to `record_navigation()`. The account comes from
-- `auth.uid()` and there is no `p_user_id`; the permission is asked before
-- anything is written; a caller without it is refused rather than silently
-- ignored, because silence would hide a misconfigured tester for a whole run.
-- ---------------------------------------------------------------------------
create or replace function public.record_interaction(
  p_run_id                    uuid,
  p_route                     text,
  p_interaction               text,
  p_interaction_to_visible_ms integer,
  p_interaction_to_commit_ms  integer,
  p_commit_to_visible_ms      integer,
  p_viewport_w                integer,
  p_viewport_h                integer,
  p_content_visible_ms        integer default null,
  p_warm                      boolean default false,
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
   * An administrator who is not a tester records nothing.
   */
  if not public.has_tester_permission('performance_tracking') then
    raise exception 'not authorized' using errcode = 'insufficient_privilege';
  end if;

  if p_run_id is null then
    raise exception 'an interaction belongs to a run' using errcode = 'check_violation';
  end if;

  -- Everything else is decided by the CHECK constraints, which are the one
  -- description of what a valid row is - including which interaction keys
  -- exist. Repeating that list here would be a second description to keep in
  -- step, and they would drift.
  insert into public.perf_interactions (
    run_id, user_id, route, interaction,
    interaction_to_visible_ms, interaction_to_commit_ms, commit_to_visible_ms,
    content_visible_ms, viewport_w, viewport_h, warm, build_id, label
  ) values (
    p_run_id, (select auth.uid()), p_route, p_interaction,
    p_interaction_to_visible_ms, p_interaction_to_commit_ms, p_commit_to_visible_ms,
    p_content_visible_ms, p_viewport_w, p_viewport_h, coalesce(p_warm, false),
    nullif(btrim(coalesce(p_build_id, '')), ''),
    nullif(btrim(coalesce(p_label, '')), '')
  );
end;
$$;

comment on function public.record_interaction(uuid, text, text, integer, integer, integer, integer, integer, integer, boolean, text, text) is
  'Records one in-page interaction timing (ADR-0073). Requires the performance_tracking tester permission; commerce and shop_admins grant nothing here. The account comes from auth.uid() and is never an argument.';

revoke all on function public.record_interaction(uuid, text, text, integer, integer, integer, integer, integer, integer, boolean, text, text)
  from public, anon;
grant  execute on function public.record_interaction(uuid, text, text, integer, integer, integer, integer, integer, integer, boolean, text, text)
  to authenticated;


-- ---------------------------------------------------------------------------
-- 3. Reading it back - administrators only
--
-- The tester produces the rows and cannot read them, exactly as in 0037: the
-- table says which account was slow where, and that is an operator's view.
--
-- The content percentiles are computed over the rows that HAVE a content
-- timing, and `content_samples` says how many that was. Averaging nulls as
-- zero would turn "we could not measure the picture" into "the picture was
-- instant" - the one mistake this column exists to avoid.
-- ---------------------------------------------------------------------------
create or replace function public.admin_perf_interactions(
  p_run_id uuid default null,
  p_label  text default null
)
returns table (
  interaction text,
  route       text,
  warm        boolean,
  samples     bigint,
  visible_p50 integer,
  visible_p75 integer,
  visible_p95 integer,
  visible_min integer,
  visible_max integer,
  commit_p50  integer,
  paint_p50   integer,
  content_samples bigint,
  content_p50 integer,
  content_p75 integer,
  content_p95 integer
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
    select n.interaction,
           n.route,
           n.warm,
           count(*) as samples,
           percentile_cont(0.50) within group (order by n.interaction_to_visible_ms)::integer,
           percentile_cont(0.75) within group (order by n.interaction_to_visible_ms)::integer,
           percentile_cont(0.95) within group (order by n.interaction_to_visible_ms)::integer,
           min(n.interaction_to_visible_ms),
           max(n.interaction_to_visible_ms),
           percentile_cont(0.50) within group (order by n.interaction_to_commit_ms)::integer,
           percentile_cont(0.50) within group (order by n.commit_to_visible_ms)::integer,
           -- `percentile_cont` ignores nulls; the count says over how many.
           count(n.content_visible_ms) as content_samples,
           percentile_cont(0.50) within group (order by n.content_visible_ms)::integer,
           percentile_cont(0.75) within group (order by n.content_visible_ms)::integer,
           percentile_cont(0.95) within group (order by n.content_visible_ms)::integer
      from public.perf_interactions n
     where (p_run_id is null or n.run_id = p_run_id)
       and (p_label  is null or n.label  = p_label)
     group by n.interaction, n.route, n.warm
     order by percentile_cont(0.75) within group (order by n.interaction_to_visible_ms) desc;
end;
$$;

comment on function public.admin_perf_interactions(uuid, text) is
  'Interaction timings aggregated per key and route, slowest p75 first (ADR-0073). Administrators only. Content percentiles cover only the rows that had a measurable artwork timing; content_samples says how many.';

revoke all on function public.admin_perf_interactions(uuid, text) from public, anon;
grant  execute on function public.admin_perf_interactions(uuid, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 4. Pruning - on request, never on a schedule
--
-- Same reasoning as 0037: a scheduler nobody watches is worse than a command
-- somebody runs when they decide the data has served its purpose.
-- ---------------------------------------------------------------------------
create or replace function public.admin_prune_perf_interactions(p_days integer default 90)
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

  delete from public.perf_interactions
   where occurred_at < now() - (greatest(1, coalesce(p_days, 90)) || ' days')::interval;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

comment on function public.admin_prune_perf_interactions(integer) is
  'Deletes interaction timings older than the given number of days, 90 by default (ADR-0073). Administrators only, run by hand.';

revoke all on function public.admin_prune_perf_interactions(integer) from public, anon;
grant  execute on function public.admin_prune_perf_interactions(integer) to authenticated;


-- ---------------------------------------------------------------------------
-- 5. What this migration deliberately does NOT do
--
-- No change to `perf_navigations`, `record_navigation()` or either admin
-- reader from 0037. Route columns still mean routes.
--
-- No `checkout_submit` key. It is measurable in principle - the tap, then the
-- moment SkyIsles hands off to Stripe - but the document is destroyed
-- immediately afterwards, so the sample has to survive an unload the delivery
-- path is not built to win. Deferred rather than half-done, and the duration
-- columns were NOT made nullable in advance for it.
--
-- No `quick_view_switch`. The dialog has no gallery arrows and no next
-- control (`quick-view.tsx`); to see another figure you close and tap another
-- card, which is two `quick_view_open` rows. A key that can never fire is
-- worse than no key.
--
-- No client privilege on `perf_interactions`. Not select, not insert. The
-- tester writes through `record_interaction()` and reads nothing back.
--
-- No column for a figure, a URL, a query string or any page content. The
-- schema is the guarantee: there is nowhere to put them.
--
-- No dependency on `0035`, which stays unapplied on Production. This needs
-- `auth.users` (0001), `is_shop_admin()` (0003) and `has_tester_permission()`
-- (0036) - nothing else.
-- ---------------------------------------------------------------------------
