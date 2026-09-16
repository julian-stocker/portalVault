import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { classifyClick, explains, measure, pairKey, MAX_NAVIGATION_MS } from "./navigation.ts";
import { BATCH_SIZE, MAX_QUEUED, drain, emptyQueue, enqueue, shouldFlush } from "./queue.ts";
import { ROUTE_PATTERN, normalizeRoute, sameRoute } from "./route.ts";
import { LABEL_PATTERN, sanitizeLabel } from "./run.ts";

/**
 * Navigation telemetry for test accounts (ADR-0072).
 *
 * The decidable parts are pure functions, so what counts as a navigation, what
 * a route pattern may contain and what the three durations mean are checked
 * here rather than observed on a phone. The parts that cannot be pure — the
 * permission gate, the mounting, the delivery — are held by reading the
 * source, the way this codebase holds its other structural guarantees.
 */
const MIGRATION = "supabase/migrations/0037_performance_telemetry.sql";
const source = (path: string) => readFileSync(path, "utf8");
/** Without the prose: every file here explains what it refuses to do. */
const code = (path: string) =>
  source(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*--.*$/gm, "")
    .replace(/^\s*\/\/.*$/gm, "");

function click(over: Partial<Parameters<typeof classifyClick>[0]> = {}) {
  return classifyClick({
    href: "/collection",
    target: null,
    download: false,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    button: 0,
    defaultPrevented: false,
    currentPath: "/",
    origin: "https://skyisles.app",
    ...over,
  });
}

describe("a route becomes a pattern, never a URL", () => {
  it("collapses the figure detail to its shape", () => {
    // The question is which KIND of navigation is slow. 565 samples of one
    // each would answer nothing.
    expect(normalizeRoute("/skylanders/gold-fire-kraken")).toBe("/skylanders/[slug]");
    expect(normalizeRoute("/skylanders/bash")).toBe("/skylanders/[slug]");
  });

  it("collapses every dynamic route this application actually has", () => {
    expect(normalizeRoute("/account/orders/SI-2026-001000")).toBe("/account/orders/[orderNumber]");
    expect(normalizeRoute("/admin/orders/SI-2026-001000")).toBe("/admin/orders/[orderNumber]");
    expect(normalizeRoute("/admin/catalog/SKY-0821")).toBe("/admin/catalog/[skyId]");
  });

  it("leaves a static route under the same prefix alone", () => {
    // `/admin/catalog/categories` is a page, not a figure.
    expect(normalizeRoute("/admin/catalog/categories")).toBe("/admin/catalog/categories");
    expect(normalizeRoute("/account/orders")).toBe("/account/orders");
    expect(normalizeRoute("/")).toBe("/");
    expect(normalizeRoute("/collection")).toBe("/collection");
  });

  it("drops the query string — that is where a search term would be", () => {
    expect(normalizeRoute("/?q=drobot")).toBe("/");
    expect(normalizeRoute("/skylanders/bash?from=search#top")).toBe("/skylanders/[slug]");
    expect(normalizeRoute("/collection#owned")).toBe("/collection");
  });

  it("never emits anything a pattern may not contain", () => {
    for (const path of [
      "/",
      "/skylanders/gold-fire-kraken",
      "/?q=a%20search%20term",
      "/etwas/mit/ümlaut",
      "/a".repeat(200),
      "not-a-path",
      "",
    ]) {
      expect(ROUTE_PATTERN.test(normalizeRoute(path)), path).toBe(true);
    }
  });

  it("refuses to pass through a route it was not taught", () => {
    // An unknown shape becomes `/[unknown]` rather than a way for a path
    // segment to reach the database.
    expect(normalizeRoute("/etwas/mit/ümlaut")).toBe("/[unknown]");
    expect(normalizeRoute("not-a-path")).toBe("/[unknown]");
  });

  it("knows when two paths are the same destination", () => {
    expect(sameRoute("/skylanders/bash", "/skylanders/drobot")).toBe(true);
    expect(sameRoute("/collection", "/")).toBe(false);
  });
});

describe("what is a navigation, and what is not", () => {
  it("measures an ordinary internal tap", () => {
    expect(click()).toEqual({ measure: true, toPath: "/collection" });
  });

  it("ignores an external link", () => {
    expect(click({ href: "https://example.com/x" }).measure).toBe(false);
    expect(click({ href: "https://skylanders.fandom.com/wiki/Bash" }).measure).toBe(false);
  });

  it("ignores target=_blank and anything else that opens elsewhere", () => {
    expect(click({ target: "_blank" }).measure).toBe(false);
    expect(click({ target: "other" }).measure).toBe(false);
    // `_self` is an ordinary navigation.
    expect(click({ target: "_self" }).measure).toBe(true);
  });

  it("ignores a download", () => {
    expect(click({ download: true }).measure).toBe(false);
  });

  it("ignores a modified or non-primary click", () => {
    // These open a tab; the current page does not navigate at all.
    for (const key of ["metaKey", "ctrlKey", "shiftKey", "altKey"] as const) {
      expect(click({ [key]: true }).measure, key).toBe(false);
    }
    expect(click({ button: 1 }).measure).toBe(false);
  });

  it("ignores a hash on the page it is already on", () => {
    expect(click({ href: "/#top", currentPath: "/" }).measure).toBe(false);
  });

  it("ignores a link to the route already open", () => {
    expect(click({ href: "/collection", currentPath: "/collection" }).measure).toBe(false);
  });

  it("ignores a click something else already handled", () => {
    expect(click({ defaultPrevented: true }).measure).toBe(false);
  });

  it("ignores an anchor with no href", () => {
    expect(click({ href: null }).measure).toBe(false);
    expect(click({ href: "" }).measure).toBe(false);
  });
});

describe("a tap is only credited to the navigation it started", () => {
  const tap = { at: 1000, toRoute: "/collection", fromRoute: "/" };

  it("matches the destination it was aimed at", () => {
    expect(explains(tap, "/collection", 1200)).toBe(true);
  });

  it("does not match a different arrival", () => {
    /*
     * The case this exists for: a redirect, a back button or a second tap
     * would otherwise be credited with the first tap's start time and produce
     * a duration that measures two navigations.
     */
    expect(explains(tap, "/account", 1200)).toBe(false);
  });

  it("matches a dynamic arrival by pattern, not by path", () => {
    const toDetail = { at: 0, toRoute: "/skylanders/[slug]", fromRoute: "/" };
    expect(explains(toDetail, "/skylanders/gold-fire-kraken", 100)).toBe(true);
  });

  it("gives up on a tap that never arrived", () => {
    // The phone went into a pocket. Not a navigation.
    expect(explains(tap, "/collection", 1000 + MAX_NAVIGATION_MS + 1)).toBe(false);
  });
});

describe("the three durations", () => {
  const tap = { at: 1000, toRoute: "/collection", fromRoute: "/" };

  it("splits waiting from drawing", () => {
    const sample = measure(tap, 1700, 1900, false);
    expect(sample).toEqual({
      kind: "navigation",
      fromRoute: "/",
      toRoute: "/collection",
      interactionToVisibleMs: 900,
      interactionToCommitMs: 700,
      commitToVisibleMs: 200,
      warm: false,
    });
  });

  it("rounds rather than carrying fractions into an integer column", () => {
    expect(measure(tap, 1000.4, 1000.6, false)?.interactionToVisibleMs).toBe(1);
  });

  it("produces nothing when a clock ran backwards", () => {
    expect(measure(tap, 900, 1200, false)).toBeNull();
    expect(measure(tap, 1200, 900, false)).toBeNull();
  });

  it("produces nothing beyond the cap", () => {
    expect(measure(tap, 1100, 1000 + MAX_NAVIGATION_MS + 1, false)).toBeNull();
  });

  it("carries the warm flag it was given", () => {
    expect(measure(tap, 1100, 1200, true)?.warm).toBe(true);
  });

  it("keys a route pair by both ends", () => {
    expect(pairKey("/", "/collection")).not.toBe(pairKey("/collection", "/"));
  });
});

describe("the queue never becomes the problem it measures", () => {
  it("flushes at the batch size, not before", () => {
    let queue = emptyQueue();
    const sample = measure({ at: 0, toRoute: "/", fromRoute: "/x" }, 1, 2, false)!;
    for (let i = 0; i < BATCH_SIZE - 1; i += 1) queue = enqueue(queue, sample);
    expect(shouldFlush(queue)).toBe(false);
    queue = enqueue(queue, sample);
    expect(shouldFlush(queue)).toBe(true);
  });

  it("is bounded, dropping the oldest rather than growing", () => {
    // A run that lost its first minute is still useful. One that exhausted the
    // tab's memory is not.
    let queue = emptyQueue();
    const sample = measure({ at: 0, toRoute: "/", fromRoute: "/x" }, 1, 2, false)!;
    for (let i = 0; i < MAX_QUEUED + 5; i += 1) queue = enqueue(queue, sample);
    expect(queue.samples).toHaveLength(MAX_QUEUED);
    expect(queue.dropped).toBe(5);
  });

  it("takes everything on a flush, so a closing page loses nothing", () => {
    let queue = emptyQueue();
    const sample = measure({ at: 0, toRoute: "/", fromRoute: "/x" }, 1, 2, false)!;
    queue = enqueue(queue, sample);
    queue = enqueue(queue, sample);
    const { batch, rest } = drain(queue);
    expect(batch).toHaveLength(2);
    expect(rest.samples).toHaveLength(0);
  });

  it("puts nothing back — there is no retry", () => {
    // Retrying over a bad mobile connection is how a telemetry client becomes
    // the performance problem. The next flush carries what accumulated since.
    const client = code("src/components/perf/navigation-telemetry.tsx");
    expect(client).not.toContain("setTimeout");
    expect(client).not.toContain("setInterval");
    expect(client).not.toContain("retry");
  });
});

describe("a run, and the label somebody may give it", () => {
  it("accepts a plain label", () => {
    expect(sanitizeLabel("mobile-baseline-1")).toBe("mobile-baseline-1");
  });

  it("folds what it can and drops what it cannot", () => {
    expect(sanitizeLabel("Mobile Baseline 1")).toBe("mobile-baseline-1");
    expect(sanitizeLabel("vorher_nachher")).toBe("vorher-nachher");
    expect(sanitizeLabel("  --weird--  ")).toBe("weird");
  });

  it("refuses anything that is not a label", () => {
    for (const bad of ["", "   ", "!!!", null, undefined, 42, "-"]) {
      expect(sanitizeLabel(bad), String(bad)).toBeNull();
    }
  });

  it("bounds the length, and stays inside its own pattern", () => {
    const long = sanitizeLabel("a".repeat(200));
    expect(long).toHaveLength(40);
    expect(LABEL_PATTERN.test(long!)).toBe(true);
  });

  it("keeps the run in sessionStorage, so it ends with the tab", () => {
    const run = code("src/lib/perf/run.ts");
    expect(run).toContain("sessionStorage");
    expect(run).not.toContain("localStorage");
  });

  it("survives a browser that refuses storage", () => {
    // Blocked site data throws on access. Telemetry must never be the reason
    // a page fails.
    const run = source("src/lib/perf/run.ts");
    expect((run.match(/catch/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("does not carry the label parameter into later navigation", () => {
    // It is read once and stored; nothing appends it to a URL.
    const run = code("src/lib/perf/run.ts");
    expect(run).not.toContain("history.");
    expect(run).not.toContain("router");
  });
});

describe("the permission is the gate, and it is asked on the server", () => {
  const permission = code("src/lib/perf/permission.ts");
  const layout = code("src/app/layout.tsx");
  const sql = code(MIGRATION);

  it("mounts the component only for the permission", () => {
    expect(layout).toContain("await canTrackPerformance()");
    expect(layout).toContain("{tracking ? <NavigationTelemetry");
    // A normal visitor never receives the component, so no listener exists.
    expect(layout).toContain(": null}");
  });

  it("asks the generic tester permission, not a telemetry-specific list", () => {
    expect(permission).toContain('p_permission: PERFORMANCE_TRACKING');
    expect(permission).toContain('has_tester_permission');
  });

  it("denies on error and denies without a session", () => {
    expect(permission).toContain("if (!(await currentUser())) return false;");
    expect(permission).toContain("if (error) return false;");
  });

  it("commerce alone grants nothing here", () => {
    /*
     * The independence ADR-0071 promises, checked where it matters: the
     * recorder asks for `performance_tracking` by name, and neither the
     * commerce permission nor shop_admins appears in its body.
     */
    const fn = sql.slice(
      sql.indexOf("create or replace function public.record_navigation("),
      sql.indexOf("$$;", sql.indexOf("create or replace function public.record_navigation(")),
    );
    expect(fn).toContain("public.has_tester_permission('performance_tracking')");
    expect(fn).not.toContain("'commerce'");
    expect(fn).not.toContain("is_shop_admin");
  });

  it("takes the account from the session, never from the caller", () => {
    const sig = sql.slice(
      sql.indexOf("create or replace function public.record_navigation("),
      sql.indexOf("returns void", sql.indexOf("create or replace function public.record_navigation(")),
    );
    expect(sig).not.toContain("p_user_id");
    expect(sql).toContain("p_run_id, (select auth.uid())");
  });
});

describe("what the table will and will not hold", () => {
  const sql = code(MIGRATION);

  it("has no column for a URL, a query or anything somebody typed", () => {
    const table = sql.slice(
      sql.indexOf("create table if not exists public.perf_navigations"),
      sql.indexOf("comment on table public.perf_navigations"),
    );
    for (const forbidden of ["url", "query", "search", "referrer", "content", "payload", "cart", "token"]) {
      expect(table.toLowerCase(), forbidden).not.toContain(forbidden);
    }
  });

  it("constrains routes to patterns, in the database as well", () => {
    expect(sql).toContain("perf_navigations_to_route_pattern");
    expect(sql).toContain("perf_navigations_from_route_pattern");
  });

  it("refuses a negative or absurd duration", () => {
    for (const name of ["visible_sane", "commit_sane", "paint_sane"]) {
      expect(sql, name).toContain(`perf_navigations_${name}`);
    }
    expect(sql).toContain(">= 0 and interaction_to_visible_ms <= 600000");
  });

  it("bounds the build id and the label", () => {
    expect(sql).toContain("perf_navigations_build_id_bounded");
    expect(sql).toContain("perf_navigations_label_bounded");
  });

  it("gives no client any privilege on the table", () => {
    expect(sql).toContain("alter table public.perf_navigations enable row level security");
    expect(sql).toContain("revoke all on public.perf_navigations from anon, authenticated");
    expect(sql).not.toMatch(/create policy .* on public\.perf_navigations/i);
    expect(sql).not.toMatch(/grant [a-z, ]+ on public\.perf_navigations/i);
  });
});

describe("reading it back is an administrator's job", () => {
  const sql = code(MIGRATION);

  it("gates every read on is_shop_admin", () => {
    for (const fn of ["admin_perf_runs", "admin_perf_report", "admin_prune_perf_navigations"]) {
      const at = sql.indexOf(`create or replace function public.${fn}(`);
      const body = sql.slice(at, sql.indexOf("$$;", at));
      expect(at, fn).toBeGreaterThan(-1);
      expect(body, fn).toContain("if not public.is_shop_admin() then");
    }
  });

  it("does not let the tester read what they generated", () => {
    // Producing the rows is not a reason to see them: the table names which
    // accounts were slow where, which is an operator's view.
    const report = sql.slice(sql.indexOf("create or replace function public.admin_perf_report("));
    expect(report).not.toContain("has_tester_permission");
  });

  it("computes the percentiles once, in SQL", () => {
    expect(sql).toContain("percentile_cont(0.50) within group");
    expect(sql).toContain("percentile_cont(0.75) within group");
    expect(sql).toContain("percentile_cont(0.95) within group");
  });

  it("separates warm from cold", () => {
    expect(sql).toContain("group by n.from_route, n.to_route, n.warm");
  });

  it("prunes only when asked, with no scheduler", () => {
    expect(sql).toContain("admin_prune_perf_navigations");
    expect(sql).toContain("|| ' days')::interval");
    expect(sql).not.toContain("pg_cron");
    expect(sql).not.toContain("cron.schedule");
  });
});

describe("the report command only reads", () => {
  const tool = code("tools/perf-report.mts");

  it("calls no mutating method", () => {
    for (const forbidden of [".insert(", ".update(", ".delete(", ".upsert(", ".upload(", ".remove("]) {
      expect(tool, forbidden).not.toContain(forbidden);
    }
  });

  it("makes no RPC call at all", () => {
    /*
     * It cannot: the service-role key has no `auth.uid()`, so `is_shop_admin()`
     * is false and both admin functions refuse. That is the browser's
     * authorisation and it stays exactly as strict — the command reads the
     * table directly instead, the way every other operator tool here does.
     */
    expect(tool).not.toContain(".rpc(");
    expect(tool).toContain('.from("perf_navigations")');
  });

  it("selects and nothing more", () => {
    // The only PostgREST verbs in the file.
    const verbs = tool.match(/\.(select|insert|update|delete|upsert|rpc)\(/g) ?? [];
    expect(new Set(verbs)).toEqual(new Set([".select("]));
  });

  it("uses the service-role key and never a public one", () => {
    expect(tool).toContain('requireEnv("SUPABASE_SERVICE_ROLE_KEY")');
    expect(tool).not.toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  });

  it("supports the filters the workflow needs", () => {
    expect(tool).toContain('argument(args, "run")');
    expect(tool).toContain('argument(args, "label")');
    expect(tool).toContain('args.includes("--latest")');
  });

  it("names one run for --latest, never a blend of testers", () => {
    expect(tool).toContain("runId = runs[0].runId");
  });

  it("carries the staging interlock the other dual-environment tools use", () => {
    expect(tool).toContain('requireStagingIfRequested("perf:report")');
  });

  it("resolves without the @/ alias, because bare Node runs it", () => {
    expect(tool).not.toContain('from "@/');
  });
});

describe("navigation is never made slower, and never waits", () => {
  const client = code("src/components/perf/navigation-telemetry.tsx");
  const record = code("src/lib/perf/record.ts");

  it("never prevents or delays a click", () => {
    expect(client).not.toContain("preventDefault");
    expect(client).not.toContain("stopPropagation");
    expect(client).toContain("passive: true");
  });

  it("never awaits delivery", () => {
    expect(client).toContain("void recordNavigations(");
    expect(client).not.toContain("await recordNavigations");
  });

  it("swallows every delivery failure", () => {
    expect(record).toContain("} catch {");
    expect(record).toContain("Promise<void>");
  });

  it("keeps no React state, so a tap re-renders nothing", () => {
    expect(client).not.toContain("useState");
    expect(client).toContain("useRef");
  });

  it("logs nothing to the console", () => {
    expect(client).not.toContain("console.");
    expect(record).not.toContain("console.");
  });

  it("uses no API mobile Safari lacks", () => {
    for (const unsupported of [
      "PerformanceObserver",
      "largest-contentful-paint",
      "layout-shift",
      "event-timing",
      "longtask",
      "navigator.connection",
      "PerformanceNavigationTiming",
      "sendBeacon",
    ]) {
      expect(client, unsupported).not.toContain(unsupported);
    }
    // What it does use, all of which Safari has.
    expect(client).toContain("performance.now()");
    expect(client).toContain("requestAnimationFrame");
    expect(client).toContain("visibilitychange");
    expect(client).toContain("pagehide");
  });

  it("changes none of the known performance suspects", () => {
    /*
     * 0037 is measurement, not repair. A clean BEFORE baseline requires the
     * suspects to still be there.
     */
    const proxy = source("src/lib/supabase/middleware.ts");
    expect(proxy).toContain("await supabase.auth.getUser()");
    expect(source("src/lib/auth/user.ts")).toContain("supabase.auth.getUser()");
    expect(source("src/components/catalog/figure-card.tsx")).toContain("prefetch={href ? undefined : false}");
  });
});
