/**
 * Reads back what the tester's phone measured (ADR-0072).
 *
 *   npm run perf:report:staging -- --latest
 *   npm run perf:report:prod    -- --run <uuid>
 *   npm run perf:report:prod    -- --label mobile-baseline-1
 *
 * READ ONLY. One `select` on one table and nothing else; there is no insert,
 * update, delete, RPC or storage call in this file, and `telemetry.test.ts`
 * holds that.
 *
 * WHY IT READS THE TABLE AND NOT `admin_perf_report()`
 *
 * Because it cannot call it. This runs with the service-role key, which has no
 * `auth.uid()`, so `is_shop_admin()` is false and both admin functions refuse —
 * which is right: that predicate is the *browser's* authorisation, and loosening
 * it so a script could pass would weaken the thing protecting the data from
 * every signed-in account. The admin functions stay exactly as they are, for an
 * administrator with a session.
 *
 * Operator tooling here has always read tables directly with the service role
 * instead — `export-image-overrides.mts`, `verify-shop.mts`, `import-catalog.mts`.
 * The key never leaves the developer machine, is never `NEXT_PUBLIC_`, and is
 * not in the deployed bundle (`docs/DEPLOYMENT.md`). The grouping then happens
 * in `src/lib/perf/report.ts`, where it can be tested.
 *
 * WHY A COMMAND AND NOT A PAGE
 *
 * The question is asked a few times per optimisation, by one person, and the
 * answer is a table of numbers. A dashboard would be a surface to build, style,
 * secure and keep working; a terminal report is something an operator reads and
 * an agent can be handed verbatim.
 *
 * WHAT THE THREE COLUMNS MEAN
 *
 *   visible   the tap until the new page was on screen — the felt duration
 *   commit    the tap until the router changed route — waiting
 *   paint     the route change until the frame — rendering
 *
 * A slow `visible` with a slow `commit` is a server or data problem. A slow
 * `visible` with a fast `commit` is rendering. That split is the reason all
 * three are recorded.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  selectRows,
  summarizePairs,
  summarizeRuns,
  type NavigationRow,
} from "../src/lib/perf/report.ts";
import { requireStagingIfRequested } from "./lib/staging-guard.mts";

/** The columns the report needs. `user_id` only to say which tester a run was. */
const COLUMNS =
  "run_id, user_id, occurred_at, from_route, to_route, warm, " +
  "interaction_to_visible_ms, interaction_to_commit_ms, commit_to_visible_ms, build_id, label";

/** PostgREST's page size, and the most rows this report will pull in total. */
const PAGE = 1000;
const MAX_ROWS = 100_000;

function heading(text: string): void {
  console.log(`\n${text}\n${"-".repeat(text.length)}`);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`\nMissing ${name}. Run through npm, which loads the env file.\n`);
    process.exit(1);
  }
  return value;
}

function argument(args: readonly string[], name: string): string | null {
  const flag = `--${name}`;
  const index = args.indexOf(flag);
  if (index !== -1 && args[index + 1] && !args[index + 1].startsWith("--")) return args[index + 1];
  const inline = args.find((arg) => arg.startsWith(`${flag}=`));
  return inline ? inline.slice(flag.length + 1) : null;
}

const pad = (value: string | number, width: number) => String(value).padEnd(width);
const num = (value: number | null, width: number) => String(value ?? "—").padStart(width);

/**
 * Every recorded navigation, oldest first, in pages.
 *
 * The whole table rather than a filtered query: the run listing needs all of it
 * anyway, and one read keeps the report a single point in time instead of two
 * queries that could disagree. `admin_prune_perf_navigations(days)` is what
 * keeps this small; if the cap is ever reached the report says so rather than
 * quietly reporting a slice.
 */
async function readAll(client: SupabaseClient): Promise<NavigationRow[]> {
  const rows: NavigationRow[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await client
      .from("perf_navigations")
      .select(COLUMNS)
      .order("occurred_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`read navigations: ${error.message}`);

    const page = (data ?? []) as unknown as NavigationRow[];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }

  console.log(
    `\n  Note: stopped at ${MAX_ROWS} rows. Older navigations are not in this report;` +
      "\n  prune with admin_prune_perf_navigations(days) to keep it whole.",
  );
  return rows;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  // The `:staging` script sets the flag; `:prod` does not, and then this is a
  // no-op. The same interlock every dual-environment tool in `tools/` uses, and
  // it runs before a connection exists.
  requireStagingIfRequested("perf:report");

  const client: SupabaseClient = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const latest = args.includes("--latest");
  let runId = argument(args, "run");
  const label = argument(args, "label");

  const all = await readAll(client);

  heading("Runs");
  const runs = summarizeRuns(all);
  if (runs.length === 0) {
    console.log("  No navigation has been recorded yet.\n");
    return;
  }

  for (const [index, run] of runs.entries()) {
    const marker = index === 0 ? "→" : " ";
    console.log(
      `  ${marker} ${run.runId}  ${pad(run.label ?? "—", 22)}` +
        `${pad(run.buildId ?? "—", 14)}${num(run.navigations, 5)} nav  ` +
        // Only the account's first characters: which tester it was matters, the
        // full id in a terminal report does not.
        `${run.userId.slice(0, 8)}…  ${run.startedAt.slice(0, 19).replace("T", " ")}`,
    );
  }

  /*
   * `--latest` is the newest run, and newest is decided by the start time, not
   * by whichever tester happened to be last in a list. With more than one tester
   * this still names exactly one run rather than blending two.
   */
  if (latest && runId === null && label === null) {
    runId = runs[0].runId;
    console.log(`\n  --latest: ${runId}`);
  }

  heading("Navigations");
  const measured = summarizePairs(selectRows(all, { runId, label }));
  if (measured.length === 0) {
    console.log("  Nothing matched that filter.\n");
    return;
  }

  const scope = runId ? `run ${runId}` : label ? `label ${label}` : "every run";
  console.log(`  ${scope}`);
  console.log(
    `\n  ${pad("from", 26)}${pad("to", 26)}${pad("warm", 6)}` +
      `${"n".padStart(4)}${"p50".padStart(7)}${"p75".padStart(7)}${"p95".padStart(7)}` +
      `${"min".padStart(7)}${"max".padStart(7)}${"commit".padStart(8)}${"paint".padStart(7)}`,
  );
  console.log(`  ${"-".repeat(110)}`);

  for (const row of measured) {
    console.log(
      `  ${pad(row.fromRoute ?? "—", 26)}${pad(row.toRoute, 26)}${pad(row.warm ? "warm" : "cold", 6)}` +
        `${num(row.samples, 4)}${num(row.visibleP50, 7)}${num(row.visibleP75, 7)}` +
        `${num(row.visibleP95, 7)}${num(row.visibleMin, 7)}${num(row.visibleMax, 7)}` +
        `${num(row.commitP50, 8)}${num(row.paintP50, 7)}`,
    );
  }

  const total = measured.reduce((sum, row) => sum + row.samples, 0);
  console.log(
    `\n  ${total} navigation(s) over ${measured.length} route pair(s).` +
      "\n  p50/p75/p95/min/max are the felt duration (tap to visible), in ms." +
      "\n  commit = tap to route change (waiting) · paint = route change to frame (rendering).\n",
  );
}

main().catch((error: unknown) => {
  console.error(`\nReport aborted: ${error instanceof Error ? error.message : error}`);
  console.error("Nothing was written.\n");
  process.exit(1);
});
