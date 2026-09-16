import { describe, expect, it } from "vitest";

import {
  percentile,
  selectRows,
  summarizePairs,
  summarizeRuns,
  type NavigationRow,
} from "./report.ts";

/**
 * The aggregation the command-line report prints (ADR-0072).
 *
 * It exists in TypeScript because `admin_perf_report()` cannot be called with
 * the service-role key — `is_shop_admin()` has no `auth.uid()` to ask about.
 * These tests hold the definitions to what the SQL says, so the two readings of
 * the same table do not drift into two different answers.
 */
function row(over: Partial<NavigationRow> = {}): NavigationRow {
  return {
    run_id: "11111111-1111-4111-8111-111111111111",
    user_id: "22222222-2222-4222-8222-222222222222",
    occurred_at: "2026-09-16T10:00:00.000Z",
    from_route: "/",
    to_route: "/collection",
    warm: false,
    interaction_to_visible_ms: 100,
    interaction_to_commit_ms: 70,
    commit_to_visible_ms: 30,
    build_id: "abc123",
    label: "mobile-baseline-1",
    ...over,
  };
}

describe("percentile_cont, and why it interpolates", () => {
  it("averages the middle two of an even sample", () => {
    // The discrete percentile would return 20 here. Postgres returns 25, and so
    // must this, or the terminal report and a future admin page disagree.
    expect(percentile([10, 20, 30, 40], 0.5)).toBe(25);
  });

  it("takes the middle of an odd sample", () => {
    expect(percentile([10, 20, 30], 0.5)).toBe(20);
  });

  it("interpolates between neighbours", () => {
    expect(percentile([0, 100], 0.75)).toBe(75);
    expect(percentile([0, 10, 20, 30, 40], 0.95)).toBe(38);
  });

  it("returns the ends at 0 and 1", () => {
    expect(percentile([5, 9, 14], 0)).toBe(5);
    expect(percentile([5, 9, 14], 1)).toBe(14);
  });

  it("survives one sample and none", () => {
    expect(percentile([42], 0.95)).toBe(42);
    expect(percentile([], 0.5)).toBe(0);
  });
});

describe("runs", () => {
  const a = "aaaaaaaa-1111-4111-8111-111111111111";
  const b = "bbbbbbbb-1111-4111-8111-111111111111";

  it("groups by run and counts navigations", () => {
    const runs = summarizeRuns([
      row({ run_id: a, occurred_at: "2026-09-16T10:00:00.000Z" }),
      row({ run_id: a, occurred_at: "2026-09-16T10:04:00.000Z" }),
      row({ run_id: b, occurred_at: "2026-09-16T11:00:00.000Z" }),
    ]);
    expect(runs.map((r) => [r.runId, r.navigations])).toEqual([
      [b, 1],
      [a, 2],
    ]);
  });

  it("spans a run from its first navigation to its last", () => {
    const [run] = summarizeRuns([
      row({ occurred_at: "2026-09-16T10:04:00.000Z" }),
      row({ occurred_at: "2026-09-16T10:00:00.000Z" }),
      row({ occurred_at: "2026-09-16T10:02:00.000Z" }),
    ]);
    expect(run.startedAt).toBe("2026-09-16T10:00:00.000Z");
    expect(run.endedAt).toBe("2026-09-16T10:04:00.000Z");
  });

  it("orders newest first, which is what --latest picks", () => {
    const runs = summarizeRuns([
      row({ run_id: a, occurred_at: "2026-09-16T09:00:00.000Z" }),
      row({ run_id: b, occurred_at: "2026-09-16T12:00:00.000Z" }),
    ]);
    expect(runs[0].runId).toBe(b);
  });

  it("keeps a label given after the run began", () => {
    // The operator opened the site, then reloaded with `?perf=…`. The run is
    // named, not half-named.
    const [run] = summarizeRuns([row({ label: null }), row({ label: "mobile-after-1" })]);
    expect(run.label).toBe("mobile-after-1");
  });

  it("bounds the listing", () => {
    const many = Array.from({ length: 300 }, (_, i) =>
      row({ run_id: `${String(i).padStart(8, "0")}-1111-4111-8111-111111111111` }),
    );
    expect(summarizeRuns(many, 20)).toHaveLength(20);
    expect(summarizeRuns(many, 9999)).toHaveLength(200);
  });
});

describe("filters", () => {
  const other = "99999999-9999-4999-8999-999999999999";

  it("selects one run", () => {
    const rows = [row(), row({ run_id: other })];
    expect(selectRows(rows, { runId: other })).toHaveLength(1);
  });

  it("selects one label", () => {
    const rows = [row(), row({ label: "mobile-after-1" })];
    expect(selectRows(rows, { label: "mobile-after-1" })).toHaveLength(1);
  });

  it("returns everything when nothing is asked", () => {
    const rows = [row(), row({ run_id: other, label: null })];
    expect(selectRows(rows, { runId: null, label: null })).toHaveLength(2);
  });
});

describe("route pairs", () => {
  it("keeps warm and cold apart", () => {
    /*
     * The whole point of the flag. Averaged together, a fast repeat visit
     * flatters a slow first visit and both numbers become unusable.
     */
    const pairs = summarizePairs([
      row({ warm: false, interaction_to_visible_ms: 1000 }),
      row({ warm: true, interaction_to_visible_ms: 200 }),
    ]);
    expect(pairs).toHaveLength(2);
    expect(pairs.map((p) => [p.warm, p.visibleP50])).toEqual([
      [false, 1000],
      [true, 200],
    ]);
  });

  it("keeps the two directions of a pair apart", () => {
    const pairs = summarizePairs([
      row({ from_route: "/", to_route: "/collection" }),
      row({ from_route: "/collection", to_route: "/" }),
    ]);
    expect(pairs).toHaveLength(2);
  });

  it("treats a null from_route as its own pair", () => {
    // The first navigation of a run has nowhere it came from.
    const pairs = summarizePairs([row({ from_route: null }), row({ from_route: "/" })]);
    expect(pairs).toHaveLength(2);
    expect(pairs.some((p) => p.fromRoute === null)).toBe(true);
  });

  it("computes the felt duration across a pair", () => {
    const pairs = summarizePairs(
      [100, 200, 300, 400].map((ms) => row({ interaction_to_visible_ms: ms })),
    );
    expect(pairs[0]).toMatchObject({
      samples: 4,
      visibleP50: 250,
      visibleP75: 325,
      visibleMin: 100,
      visibleMax: 400,
    });
  });

  it("reports commit and paint from their own columns", () => {
    const pairs = summarizePairs([
      row({ interaction_to_commit_ms: 500, commit_to_visible_ms: 20 }),
      row({ interaction_to_commit_ms: 700, commit_to_visible_ms: 40 }),
    ]);
    expect(pairs[0].commitP50).toBe(600);
    expect(pairs[0].paintP50).toBe(30);
  });

  it("puts the slowest p75 first, which is what to open", () => {
    const pairs = summarizePairs([
      row({ to_route: "/collection", interaction_to_visible_ms: 100 }),
      row({ to_route: "/skylanders/[slug]", interaction_to_visible_ms: 2000 }),
      row({ to_route: "/shop", interaction_to_visible_ms: 500 }),
    ]);
    expect(pairs.map((p) => p.toRoute)).toEqual(["/skylanders/[slug]", "/shop", "/collection"]);
  });

  it("reports whole milliseconds", () => {
    const pairs = summarizePairs(
      [100, 101, 103].map((ms) => row({ interaction_to_visible_ms: ms })),
    );
    for (const value of [pairs[0].visibleP50, pairs[0].visibleP75, pairs[0].visibleP95]) {
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  it("returns nothing for nothing", () => {
    expect(summarizePairs([])).toEqual([]);
    expect(summarizeRuns([])).toEqual([]);
  });
});

describe("the module a plain-Node tool has to load", () => {
  it("imports nothing through the @/ alias", async () => {
    // `tools/perf-report.mts` runs under bare Node, which cannot resolve it.
    // The same rule `character-import-runtime.test.ts` pins for the importer.
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("src/lib/perf/report.ts", "utf8")).not.toContain('from "@/');
  });
});
