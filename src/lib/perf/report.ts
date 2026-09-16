/**
 * Aggregating recorded navigations (ADR-0072).
 *
 * WHY THIS EXISTS AS WELL AS THE SQL
 *
 * `admin_perf_report()` computes the same numbers in Postgres for an
 * administrator with a browser session. The command-line report cannot call it:
 * it connects with the service-role key, which has no `auth.uid()`, so
 * `is_shop_admin()` is false and the function refuses — correctly, because that
 * predicate is the browser's authorisation and must not be loosened for a
 * script. Operator tooling in this repository reads tables directly with the
 * service role instead (`export-image-overrides.mts`, `verify-shop.mts`), and
 * that is the path the report now takes.
 *
 * So the grouping lives here, in a pure function the tests can reach, rather
 * than inline in a `.mts` that only runs against a real database.
 *
 * The definitions match the SQL deliberately: `percentile_cont`, which
 * interpolates linearly between neighbouring samples, the same route-pair
 * grouping, and the same ordering. The only place the two can differ is a value
 * landing exactly halfway between two milliseconds, where Postgres and
 * JavaScript may round in opposite directions — one millisecond, on a
 * measurement whose own resolution is coarser than that.
 *
 * No `@/` alias anywhere in this file: `tools/perf-report.mts` imports it under
 * plain Node, which cannot resolve the alias. `character-import-runtime.test.ts`
 * pins that rule for the catalog importer; it holds here for the same reason.
 */

/** One row of `perf_navigations`, named as PostgREST returns it. */
export type NavigationRow = {
  run_id: string;
  user_id: string;
  occurred_at: string;
  from_route: string | null;
  to_route: string;
  warm: boolean;
  interaction_to_visible_ms: number;
  interaction_to_commit_ms: number;
  commit_to_visible_ms: number;
  build_id: string | null;
  label: string | null;
};

export type RunSummary = {
  runId: string;
  label: string | null;
  buildId: string | null;
  userId: string;
  startedAt: string;
  endedAt: string;
  navigations: number;
};

export type PairSummary = {
  fromRoute: string | null;
  toRoute: string;
  warm: boolean;
  samples: number;
  visibleP50: number;
  visibleP75: number;
  visibleP95: number;
  visibleMin: number;
  visibleMax: number;
  commitP50: number;
  paintP50: number;
};

/**
 * `percentile_cont(fraction)` over already-sorted values.
 *
 * Continuous, not discrete: the rank may fall between two samples and the
 * result is interpolated. With four samples the median is the average of the
 * middle two, which is what the SQL returns and what a discrete percentile
 * would get wrong.
 */
export function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];

  const rank = fraction * (sorted.length - 1);
  const below = Math.floor(rank);
  const above = Math.ceil(rank);
  if (below === above) return sorted[below];
  return sorted[below] + (sorted[above] - sorted[below]) * (rank - below);
}

/** Whole milliseconds, as the SQL's `::integer` cast produces. */
const whole = (value: number) => Math.round(value);

/**
 * The runs, newest first — one row per `run_id`, as `admin_perf_runs()` groups
 * them. A run belongs to one account, so its label, build and account are
 * simply carried through the grouping.
 */
export function summarizeRuns(rows: readonly NavigationRow[], limit = 20): RunSummary[] {
  const byRun = new Map<string, NavigationRow[]>();
  for (const row of rows) {
    const group = byRun.get(row.run_id);
    if (group) group.push(row);
    else byRun.set(row.run_id, [row]);
  }

  const runs: RunSummary[] = [];
  for (const [runId, group] of byRun) {
    const times = group.map((row) => row.occurred_at).sort();
    runs.push({
      runId,
      // A run that was started without a label and named later still reports the
      // name: the last non-null wins, rather than "no label" because the first
      // navigation predated it.
      label: group.reduce<string | null>((carry, row) => row.label ?? carry, null),
      buildId: group.reduce<string | null>((carry, row) => row.build_id ?? carry, null),
      userId: group[0].user_id,
      startedAt: times[0],
      endedAt: times[times.length - 1],
      navigations: group.length,
    });
  }

  runs.sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0));
  return runs.slice(0, Math.max(1, Math.min(limit, 200)));
}

/** Only the rows a `--run` or `--label` filter selects. Both null means all. */
export function selectRows(
  rows: readonly NavigationRow[],
  filter: { runId?: string | null; label?: string | null },
): NavigationRow[] {
  return rows.filter(
    (row) =>
      (!filter.runId || row.run_id === filter.runId) &&
      (!filter.label || row.label === filter.label),
  );
}

/**
 * Timings per route pair, slowest p75 first.
 *
 * p75 rather than p50 decides the order, because the question is which
 * navigation feels slow — and a pair that is usually quick but regularly takes
 * two seconds is the one worth opening.
 *
 * `warm` is part of the key, never averaged into the cold numbers: a first
 * visit and a repeat visit to the same route are different measurements, and
 * blending them hides both.
 */
export function summarizePairs(rows: readonly NavigationRow[]): PairSummary[] {
  const byPair = new Map<string, NavigationRow[]>();
  for (const row of rows) {
    // The separator cannot occur in a route pattern: the CHECK constraint on
    // both columns excludes every character but letters, digits, `/[]_-`.
    const key = `${row.from_route ?? ""}|${row.to_route}|${row.warm}`;
    const group = byPair.get(key);
    if (group) group.push(row);
    else byPair.set(key, [row]);
  }

  const ascending = (a: number, b: number) => a - b;
  const pairs: PairSummary[] = [];
  for (const group of byPair.values()) {
    const visible = group.map((row) => row.interaction_to_visible_ms).sort(ascending);
    const commit = group.map((row) => row.interaction_to_commit_ms).sort(ascending);
    const paint = group.map((row) => row.commit_to_visible_ms).sort(ascending);

    pairs.push({
      fromRoute: group[0].from_route,
      toRoute: group[0].to_route,
      warm: group[0].warm,
      samples: group.length,
      visibleP50: whole(percentile(visible, 0.5)),
      visibleP75: whole(percentile(visible, 0.75)),
      visibleP95: whole(percentile(visible, 0.95)),
      visibleMin: visible[0],
      visibleMax: visible[visible.length - 1],
      commitP50: whole(percentile(commit, 0.5)),
      paintP50: whole(percentile(paint, 0.5)),
    });
  }

  pairs.sort((a, b) => b.visibleP75 - a.visibleP75);
  return pairs;
}
