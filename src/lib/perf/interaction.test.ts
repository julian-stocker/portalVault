import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { watchArtwork, type ArtworkResult, type ImageLike } from "./artwork.ts";
import {
  INTERACTIONS,
  explainsDialog,
  interactionKey,
  isInteraction,
  measureInteraction,
  usableInteraction,
  type InteractionSample,
  type PendingInteraction,
} from "./interaction.ts";
import { MAX_NAVIGATION_MS } from "./navigation.ts";
import { drain, emptyQueue, enqueue, shouldFlush } from "./queue.ts";
import {
  selectInteractions,
  summarizeInteractions,
  type InteractionRow,
} from "./report.ts";

/**
 * In-page interaction telemetry (ADR-0073).
 *
 * The quick view is the catalog's main gesture and it is not a navigation, so
 * 0037 could not see it. What is worth holding here is not that a number gets
 * recorded but that the numbers stay honest — above all that "we could not
 * measure the picture" never becomes "the picture was instant".
 */
const MIGRATION = "supabase/migrations/0038_performance_interactions.sql";
const source = (path: string) => readFileSync(path, "utf8");
const code = (path: string) =>
  source(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*--.*$/gm, "")
    .replace(/^\s*\/\/.*$/gm, "");

const tap: PendingInteraction = { key: "quick_view_open", at: 1000, route: "/" };

function interaction(over: Partial<InteractionSample> = {}): InteractionSample {
  return {
    kind: "interaction",
    interaction: "quick_view_open",
    route: "/",
    interactionToVisibleMs: 120,
    interactionToCommitMs: 80,
    commitToVisibleMs: 40,
    contentVisibleMs: 900,
    warm: false,
    ...over,
  };
}

/** An `<img>` that does only what the watcher is allowed to rely on. */
function fakeImage(over: Partial<ImageLike> = {}): ImageLike & { fire: (type: string) => void } {
  const listeners = new Map<string, Set<() => void>>();
  return {
    complete: false,
    naturalWidth: 640,
    addEventListener(type, listener) {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    fire(type: string) {
      for (const listener of [...(listeners.get(type) ?? [])]) listener();
    },
    ...over,
  };
}

describe("the closed set of interaction keys", () => {
  it("holds exactly what V2 measures", () => {
    // One key. `quick_view_switch` is absent because the dialog has no gallery
    // arrows, and `checkout_submit` because it is deferred, not half-built.
    expect([...INTERACTIONS]).toEqual(["quick_view_open"]);
  });

  it("rejects an invented key", () => {
    for (const bad of ["quick_view_switch", "checkout_submit", "click", "", null, 42]) {
      expect(isInteraction(bad), String(bad)).toBe(false);
    }
    expect(isInteraction("quick_view_open")).toBe(true);
  });

  it("is the same set the database will accept", () => {
    const sql = code(MIGRATION);
    expect(sql).toContain("check (interaction in ('quick_view_open'))");
    expect(sql).not.toContain("quick_view_switch'");
    expect(sql).not.toContain("checkout_submit");
  });

  it("refuses a sample carrying a key the set does not hold", () => {
    expect(usableInteraction(interaction({ interaction: "nope" as never }))).toBe(false);
  });
});

describe("A, B, C for a dialog", () => {
  it("splits the tap into waiting and drawing", () => {
    const sample = measureInteraction(tap, 1080, 1120, 1900, false);
    expect(sample).toEqual({
      kind: "interaction",
      interaction: "quick_view_open",
      route: "/",
      interactionToVisibleMs: 120,
      interactionToCommitMs: 80,
      commitToVisibleMs: 40,
      contentVisibleMs: 900,
      warm: false,
    });
  });

  it("rounds rather than carrying fractions into an integer column", () => {
    const sample = measureInteraction(tap, 1000.4, 1000.6, 1000.6, false);
    expect(sample?.interactionToVisibleMs).toBe(1);
    expect(sample?.contentVisibleMs).toBe(1);
  });

  it("produces nothing when a clock ran backwards", () => {
    expect(measureInteraction(tap, 900, 1100, null, false)).toBeNull();
    expect(measureInteraction(tap, 1100, 1000, null, false)).toBeNull();
  });

  it("produces nothing beyond the cap", () => {
    expect(measureInteraction(tap, 1100, 1000 + MAX_NAVIGATION_MS + 1, null, false)).toBeNull();
  });

  it("carries the route the tap happened on, never a destination", () => {
    const sample = measureInteraction({ ...tap, route: "/collection" }, 1010, 1020, null, false);
    expect(sample?.route).toBe("/collection");
  });

  it("drops a dialog nobody tapped for", () => {
    // Opened by code, or left from a tap that produced something else.
    expect(explainsDialog(null, 1000)).toBe(false);
    expect(explainsDialog(tap, 1000 + MAX_NAVIGATION_MS + 1)).toBe(false);
    expect(explainsDialog(tap, 1200)).toBe(true);
  });
});

describe("content timing is never invented", () => {
  it("is null when there was nothing to measure", () => {
    const sample = measureInteraction(tap, 1010, 1020, null, false);
    expect(sample?.contentVisibleMs).toBeNull();
  });

  it("is null rather than zero — the two mean opposite things", () => {
    /*
     * A zero would read as "the artwork was instant", which is the single
     * most misleading thing this column could say about a picture nobody
     * could time.
     */
    const sample = measureInteraction(tap, 1010, 1020, null, false);
    expect(sample?.contentVisibleMs).not.toBe(0);
    expect(sample?.contentVisibleMs).toBeNull();
  });

  it("is null when the artwork moment falls outside the cap", () => {
    // Not clamped to the cap: a wrong duration is worse than an absent one.
    const sample = measureInteraction(tap, 1010, 1020, 1000 + MAX_NAVIGATION_MS + 1, false);
    expect(sample?.contentVisibleMs).toBeNull();
    // The structural numbers survive — the dialog really did open.
    expect(sample?.interactionToVisibleMs).toBe(20);
  });

  it("may legitimately be SMALLER than the structural timing", () => {
    /*
     * A cached picture can finish decoding before the second animation frame
     * that defines C. That is not an error — it means the image was never the
     * thing being waited for — and clamping it to C would erase exactly the
     * case worth recognising.
     */
    const sample = measureInteraction(tap, 1010, 1100, 1030, false);
    expect(sample?.contentVisibleMs).toBe(30);
    expect(sample!.contentVisibleMs!).toBeLessThan(sample!.interactionToVisibleMs);
  });

  it("is allowed through by the database in that order too", () => {
    // The CHECK bounds it, and deliberately does not compare it to A→C.
    const sql = code(MIGRATION);
    expect(sql).toContain("perf_interactions_content_sane");
    expect(sql).toContain("content_visible_ms is null");
    expect(sql).not.toMatch(/content_visible_ms\s*>=\s*interaction_to_visible_ms/);
  });
});

describe("watching the artwork", () => {
  const settled = () => {
    const calls: ArtworkResult[] = [];
    return { calls, settle: (result: ArtworkResult) => calls.push(result) };
  };

  it("settles immediately when there is no image", () => {
    const { calls, settle } = settled();
    watchArtwork(null, () => 5, settle);
    expect(calls).toEqual([{ at: null, outcome: "no-image" }]);
  });

  it("waits for a remote image, then decodes it", async () => {
    const { calls, settle } = settled();
    const image = fakeImage({ decode: () => Promise.resolve() });
    watchArtwork(image, () => 777, settle);

    // Still loading: nothing recorded yet.
    expect(calls).toHaveLength(0);
    image.fire("load");
    await Promise.resolve();
    expect(calls).toEqual([{ at: 777, outcome: "decoded" }]);
  });

  it("uses load when decode does not exist", async () => {
    // Older Safari. `load` is a weaker signal than `decode`, but a real one.
    const { calls, settle } = settled();
    const image = fakeImage({ decode: undefined });
    watchArtwork(image, () => 42, settle);
    image.fire("load");
    await Promise.resolve();
    expect(calls).toEqual([{ at: 42, outcome: "loaded" }]);
  });

  it("decodes an already-cached image rather than assuming it was instant", async () => {
    /*
     * The brief's point exactly: `complete` does not mean "ready to paint".
     * `decode()` gives a real moment, and that moment is what is recorded.
     */
    const { calls, settle } = settled();
    const image = fakeImage({ complete: true, decode: () => Promise.resolve() });
    watchArtwork(image, () => 13, settle);
    await Promise.resolve();
    expect(calls).toEqual([{ at: 13, outcome: "decoded" }]);
  });

  it("records nothing for a cached image when decode is unavailable", async () => {
    // The load happened before anybody was watching. Any number would be
    // invented, so there is none.
    const { calls, settle } = settled();
    watchArtwork(fakeImage({ complete: true, decode: undefined }), () => 13, settle);
    await Promise.resolve();
    expect(calls).toEqual([{ at: null, outcome: "already-complete" }]);
  });

  it("records nothing when decode rejects", async () => {
    const { calls, settle } = settled();
    const image = fakeImage({ decode: () => Promise.reject(new Error("broken")) });
    watchArtwork(image, () => 99, settle);
    image.fire("load");
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toEqual([{ at: null, outcome: "failed" }]);
  });

  it("records nothing when the image errors", () => {
    const { calls, settle } = settled();
    const image = fakeImage();
    watchArtwork(image, () => 99, settle);
    image.fire("error");
    expect(calls).toEqual([{ at: null, outcome: "failed" }]);
  });

  it("treats a complete image with no pixels as a failure", () => {
    // `complete` is true for a broken image too.
    const { calls, settle } = settled();
    watchArtwork(fakeImage({ complete: true, naturalWidth: 0 }), () => 5, settle);
    expect(calls).toEqual([{ at: null, outcome: "failed" }]);
  });

  it("settles as cancelled when the dialog goes away first", () => {
    const { calls, settle } = settled();
    const cancel = watchArtwork(fakeImage(), () => 5, settle);
    cancel();
    expect(calls).toEqual([{ at: null, outcome: "cancelled" }]);
  });

  it("settles exactly once, whatever happens afterwards", () => {
    const { calls, settle } = settled();
    const image = fakeImage({ decode: undefined });
    const cancel = watchArtwork(image, () => 5, settle);
    image.fire("load");
    image.fire("load");
    image.fire("error");
    cancel();
    expect(calls).toHaveLength(1);
  });

  it("stops listening once it has settled", () => {
    const removals: string[] = [];
    const image = fakeImage({
      decode: undefined,
      removeEventListener: (type: string) => removals.push(type),
    });
    watchArtwork(image, () => 5, () => {});
    image.fire("load");
    expect(removals).toContain("load");
    expect(removals).toContain("error");
  });

  it("sets no timer of its own", () => {
    // A telemetry client that schedules work is one step from becoming the
    // latency it measures. Unresolved watches end via cancel().
    const artwork = code("src/lib/perf/artwork.ts");
    expect(artwork).not.toContain("setTimeout");
    expect(artwork).not.toContain("setInterval");
  });
});

describe("warm, and what it does not claim", () => {
  it("keys on the interaction and the route together", () => {
    expect(interactionKey("quick_view_open", "/")).not.toBe(
      interactionKey("quick_view_open", "/collection"),
    );
  });

  it("carries the flag it was given", () => {
    expect(measureInteraction(tap, 1010, 1020, null, true)?.warm).toBe(true);
    expect(measureInteraction(tap, 1010, 1020, null, false)?.warm).toBe(false);
  });

  it("says in the schema that it is about the run, not a cache", () => {
    /*
     * Two quick views of two different figures fetch two different pictures,
     * and the second is still "warm" by this definition. The row records no
     * image identity at all, so it could not know otherwise.
     */
    const sql = source(MIGRATION);
    expect(sql).toContain("Says nothing about any cache.");
    expect(sql).toMatch(/does NOT claim the image was cached/);
  });
});

describe("one queue, two kinds", () => {
  const nav = {
    kind: "navigation" as const,
    fromRoute: "/",
    toRoute: "/collection",
    interactionToVisibleMs: 100,
    interactionToCommitMs: 70,
    commitToVisibleMs: 30,
    warm: false,
  };

  it("carries both, in the order they happened", () => {
    let queue = emptyQueue();
    queue = enqueue(queue, nav);
    queue = enqueue(queue, interaction());
    queue = enqueue(queue, nav);
    const { batch } = drain(queue);
    expect(batch.map((sample) => sample.kind)).toEqual([
      "navigation",
      "interaction",
      "navigation",
    ]);
  });

  it("uses one batch threshold for both", () => {
    let queue = emptyQueue();
    for (let i = 0; i < 9; i += 1) queue = enqueue(queue, i % 2 ? nav : interaction());
    expect(shouldFlush(queue)).toBe(false);
    queue = enqueue(queue, interaction());
    expect(shouldFlush(queue)).toBe(true);
  });

  it("is still bounded when interactions fill it", () => {
    let queue = emptyQueue();
    for (let i = 0; i < 120; i += 1) queue = enqueue(queue, interaction());
    expect(queue.samples).toHaveLength(100);
    expect(queue.dropped).toBe(20);
  });

  it("has exactly one unload path", () => {
    // A second queue would mean a second `pagehide` handler and a second way
    // to lose the end of a run.
    const client = code("src/components/perf/navigation-telemetry.tsx");
    expect((client.match(/addEventListener\("pagehide"/g) ?? []).length).toBe(1);
    expect((client.match(/removeEventListener\("pagehide"/g) ?? []).length).toBe(1);
    expect((client.match(/emptyQueue\(\)/g) ?? []).length).toBe(1);
  });

  it("settles a waiting artwork before the queue is emptied", () => {
    // Otherwise the last interaction of a run is the one that gets lost.
    const client = code("src/components/perf/navigation-telemetry.tsx");
    expect(client).toMatch(/cancelArtwork\.current\?\.\(\);\s*flush\(\);/);
  });
});

describe("a bad interaction cannot take navigations with it", () => {
  const record = code("src/lib/perf/record.ts");

  it("validates and skips per sample, not per batch", () => {
    expect(record).toContain("if (!usableInteraction(sample)) continue;");
    expect(record).toContain("if (!usable(sample)) continue;");
  });

  it("sends each kind to its own function", () => {
    expect(record).toContain('await supabase.rpc("record_interaction"');
    expect(record).toContain('await supabase.rpc("record_navigation"');
    expect(record).toContain('if (sample.kind === "interaction")');
  });

  it("still swallows everything and returns nothing", () => {
    expect(record).toContain("Promise<void>");
    expect(record).toContain("} catch {");
    expect(record).not.toContain("console.");
  });

  it("rejects a malformed interaction before it is sent", () => {
    expect(usableInteraction(interaction({ route: "/?q=drobot" }))).toBe(false);
    expect(usableInteraction(interaction({ interactionToVisibleMs: -1 }))).toBe(false);
    expect(usableInteraction(interaction({ contentVisibleMs: -5 }))).toBe(false);
    expect(usableInteraction(interaction({ warm: "yes" as never }))).toBe(false);
    // A null content timing is valid, and must stay valid.
    expect(usableInteraction(interaction({ contentVisibleMs: null }))).toBe(true);
  });
});

describe("the recorder, in the database", () => {
  const sql = code(MIGRATION);
  const body = sql.slice(
    sql.indexOf("create or replace function public.record_interaction("),
    sql.indexOf("$$;", sql.indexOf("create or replace function public.record_interaction(")),
  );

  it("requires the performance permission and nothing else grants it", () => {
    expect(body).toContain("public.has_tester_permission('performance_tracking')");
    expect(body).not.toContain("'commerce'");
    expect(body).not.toContain("is_shop_admin");
  });

  it("takes the account from the session, never from the caller", () => {
    const signature = sql.slice(
      sql.indexOf("create or replace function public.record_interaction("),
      sql.indexOf("returns void", sql.indexOf("create or replace function public.record_interaction(")),
    );
    expect(signature).not.toContain("p_user_id");
    expect(sql).toContain("p_run_id, (select auth.uid()), p_route, p_interaction");
  });

  it("refuses an anonymous caller outright", () => {
    expect(body).toContain("if (select auth.uid()) is null then");
  });

  it("is a security definer with a pinned search path", () => {
    expect(body).toContain("security definer");
    expect(body).toContain("set search_path = ''");
  });
});

describe("what the interaction table will and will not hold", () => {
  const sql = code(MIGRATION);
  const table = sql.slice(
    sql.indexOf("create table if not exists public.perf_interactions"),
    sql.indexOf("comment on table public.perf_interactions"),
  );

  it("has no column that could name a figure", () => {
    for (const forbidden of ["sky_id", "skyid", "slug", "name", "title", "image", "artwork_path"]) {
      expect(table.toLowerCase(), forbidden).not.toContain(forbidden);
    }
  });

  it("has no column for a URL, a query or anything typed", () => {
    for (const forbidden of ["url", "query", "search", "referrer", "content_type", "payload", "cart", "token"]) {
      expect(table.toLowerCase(), forbidden).not.toContain(forbidden);
    }
  });

  it("keeps a route pattern, singular — an interaction has no destination", () => {
    expect(table).toContain("route      text        not null");
    expect(table).not.toContain("from_route");
    expect(table).not.toContain("to_route");
    expect(sql).toContain("perf_interactions_route_pattern");
  });

  it("bounds every duration", () => {
    for (const name of ["visible_sane", "commit_sane", "paint_sane", "content_sane"]) {
      expect(sql, name).toContain(`perf_interactions_${name}`);
    }
  });

  it("gives no client any privilege", () => {
    expect(sql).toContain("alter table public.perf_interactions enable row level security");
    expect(sql).toContain("revoke all on public.perf_interactions from anon, authenticated");
    expect(sql).not.toMatch(/create policy .* on public\.perf_interactions/i);
    expect(sql).not.toMatch(/grant [a-z, ]+ on public\.perf_interactions/i);
  });

  it("lets only an administrator read or prune it", () => {
    for (const fn of ["admin_perf_interactions", "admin_prune_perf_interactions"]) {
      const at = sql.indexOf(`create or replace function public.${fn}(`);
      expect(at, fn).toBeGreaterThan(-1);
      expect(sql.slice(at, sql.indexOf("$$;", at)), fn).toContain(
        "if not public.is_shop_admin() then",
      );
    }
  });

  it("does not let the tester read back what they generated", () => {
    const reader = sql.slice(sql.indexOf("create or replace function public.admin_perf_interactions("));
    expect(reader).not.toContain("has_tester_permission");
  });

  it("counts the content samples instead of averaging nulls as zero", () => {
    expect(sql).toContain("count(n.content_visible_ms) as content_samples");
    expect(sql).toContain("percentile_cont(0.50) within group (order by n.content_visible_ms)");
  });
});

describe("0037 is not touched", () => {
  const sql = code(MIGRATION);

  it("alters nothing that already exists", () => {
    expect(sql).not.toContain("alter table public.perf_navigations");
    expect(sql).not.toContain("drop table public.perf_navigations");
    expect(sql).not.toContain("create or replace function public.record_navigation");
    expect(sql).not.toContain("create or replace function public.admin_perf_report");
  });

  it("stores no fake route in the navigation table", () => {
    expect(sql).not.toContain("[dialog]");
    expect(source(MIGRATION)).not.toContain("/[dialog]/quick-view'");
  });

  it("depends on 0036 and 0003, never on 0035", () => {
    expect(sql).toContain("public.has_tester_permission");
    expect(sql).toContain("public.is_shop_admin()");
    expect(sql).not.toContain("system_set_image_override");
  });
});

describe("the marker in the markup", () => {
  const offerLink = source("src/components/shop/offer-link.tsx");

  it("is carried only when the link opens the dialog", () => {
    // Without `onOpen` this really is a link to the detail page, and it should
    // stay an ordinary measured navigation.
    expect(offerLink).toContain('{...(onOpen ? { "data-perf": "quick_view_open" } : {})}');
  });

  it("names an interaction and never a figure", () => {
    const marker = offerLink.slice(offerLink.indexOf('"data-perf"'), offerLink.indexOf('"data-perf"') + 80);
    expect(marker).not.toContain("slug");
    expect(marker).not.toContain("skyId");
    expect(marker).not.toContain("name");
  });

  it("changes nothing about the element's behaviour or semantics", () => {
    // Still a Link, still not prefetched, still the same label and handler.
    expect(offerLink).toContain("prefetch={false}");
    expect(offerLink).toContain("aria-label={de.shop.offersFor(name)}");
    expect(offerLink).toContain("event.preventDefault();");
    expect(offerLink).toContain("onOpen();");
  });

  it("is what stops a dialog open from being charged to the next navigation", () => {
    /*
     * This element is an anchor whose handler calls `preventDefault()` in the
     * bubble phase, after the capture-phase telemetry listener has already
     * seen the click. Without the marker the open looked like the start of a
     * navigation to the detail page, and the navigation that never came would
     * spoil the next real one.
     */
    const client = code("src/components/perf/navigation-telemetry.tsx");
    const markerBranch = client.indexOf("PERF_ATTRIBUTE");
    const anchorBranch = client.indexOf('closest("a")');
    expect(markerBranch).toBeGreaterThan(-1);
    expect(markerBranch).toBeLessThan(anchorBranch);
  });
});

describe("the dialog is watched without the dialog knowing", () => {
  const client = code("src/components/perf/navigation-telemetry.tsx");

  it("finds it by attributes it already carried", () => {
    expect(client).toContain('[role="dialog"][aria-modal="true"]');
    expect(client).toContain("new MutationObserver");
  });

  it("leaves Modal and QuickView alone", () => {
    const modal = source("src/components/ui/modal.tsx");
    const quickView = source("src/components/catalog/quick-view.tsx");
    for (const file of [modal, quickView]) {
      expect(file).not.toContain("perf");
      expect(file).not.toContain("telemetry");
    }
    // And the things the brief said not to touch are still there.
    expect(modal).toContain("motion-safe:animate-[fade-in_120ms_ease-out]");
    expect(modal).toContain("motion-safe:animate-[rise_140ms_ease-out]");
    expect(modal).toContain("backdrop-blur-[3px]");
    expect(quickView).toContain('loading="lazy"');
    expect(quickView).toContain('decoding="async"');
  });

  it("uses the same double-frame definition of visible as navigation does", () => {
    expect((client.match(/requestAnimationFrame/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it("ends a watch when the dialog is removed", () => {
    expect(client).toContain("record.removedNodes");
  });
});

describe("the interaction section of the report", () => {
  function row(over: Partial<InteractionRow> = {}): InteractionRow {
    return {
      run_id: "11111111-1111-4111-8111-111111111111",
      occurred_at: "2026-09-16T10:00:00.000Z",
      route: "/",
      interaction: "quick_view_open",
      interaction_to_visible_ms: 100,
      interaction_to_commit_ms: 60,
      commit_to_visible_ms: 40,
      content_visible_ms: 800,
      warm: false,
      label: "prod-baseline-v2",
      ...over,
    };
  }

  it("groups by interaction, route and warmth", () => {
    const summary = summarizeInteractions([
      row(),
      row({ warm: true }),
      row({ route: "/collection" }),
    ]);
    expect(summary).toHaveLength(3);
  });

  it("excludes null content from the content percentiles", () => {
    const summary = summarizeInteractions([
      row({ content_visible_ms: 400 }),
      row({ content_visible_ms: 600 }),
      row({ content_visible_ms: null }),
    ]);
    expect(summary[0].samples).toBe(3);
    expect(summary[0].contentSamples).toBe(2);
    // 400 and 600 — not 0, 400, 600, which would have given 400.
    expect(summary[0].contentP50).toBe(500);
  });

  it("reports no content timing as a null, never as zero", () => {
    const summary = summarizeInteractions([row({ content_visible_ms: null })]);
    expect(summary[0].contentSamples).toBe(0);
    expect(summary[0].contentP50).toBeNull();
    expect(summary[0].contentP75).toBeNull();
    expect(summary[0].contentP95).toBeNull();
  });

  it("still reports the structural timing when no artwork was measurable", () => {
    const summary = summarizeInteractions([row({ content_visible_ms: null })]);
    expect(summary[0].visibleP50).toBe(100);
  });

  it("orders by the structural p75, like the navigation table", () => {
    const summary = summarizeInteractions([
      row({ route: "/", interaction_to_visible_ms: 50 }),
      row({ route: "/collection", interaction_to_visible_ms: 900 }),
    ]);
    expect(summary[0].route).toBe("/collection");
  });

  it("honours --run and --label exactly as the navigation section does", () => {
    const other = "99999999-9999-4999-8999-999999999999";
    const rows = [row(), row({ run_id: other, label: "old" })];
    expect(selectInteractions(rows, { runId: other })).toHaveLength(1);
    expect(selectInteractions(rows, { label: "prod-baseline-v2" })).toHaveLength(1);
    expect(selectInteractions(rows, { runId: null, label: null })).toHaveLength(2);
  });

  it("prints a dash for an unmeasurable artwork", () => {
    const tool = source("tools/perf-report.mts");
    expect(tool).toContain('const num = (value: number | null, width: number) => String(value ?? "—")');
    expect(tool).toContain("num(row.contentP50, 8)");
  });

  it("says how many samples had a measurable artwork timing", () => {
    const tool = code("tools/perf-report.mts");
    expect(tool).toContain("row.contentSamples");
    expect(tool).toContain("sample(s) where it could be measured;");
  });

  it("keeps the two sections and their percentiles apart", () => {
    const tool = code("tools/perf-report.mts");
    expect(tool).toContain('heading("Navigations")');
    expect(tool).toContain('heading("Interactions")');
    expect(tool).toContain("summarizePairs(");
    expect(tool).toContain("summarizeInteractions(");
  });

  it("stays read-only, and still makes no RPC", () => {
    const tool = code("tools/perf-report.mts");
    const verbs = tool.match(/\.(select|insert|update|delete|upsert|rpc)\(/g) ?? [];
    expect(new Set(verbs)).toEqual(new Set([".select("]));
    expect(tool).toContain('.from("perf_interactions")');
    expect(tool).toContain('requireStagingIfRequested("perf:report")');
  });

  it("survives a database where 0038 has not been applied", () => {
    // The navigation half of the report must not go down with it.
    const tool = code("tools/perf-report.mts");
    expect(tool).toContain("if (error) return null;");
    expect(tool).toContain("0038 is not applied.");
  });
});

describe("still deliberately unmeasured", () => {
  const client = code("src/components/perf/navigation-telemetry.tsx");
  const sql = code(MIGRATION);

  it("does not instrument anything but the one trigger", () => {
    // No generic interaction analytics: one attribute, one closed key.
    const markers = Array.from(
      source("src/components/shop/offer-link.tsx").matchAll(/data-perf/g),
    );
    expect(markers).toHaveLength(1);
    expect(
      Array.from(source("src/components/ui/modal.tsx").matchAll(/data-perf/g)),
    ).toHaveLength(0);
  });

  it("times no dialog close, no scroll, no typing", () => {
    for (const absent of ["scroll", "keydown", "keypress", "input", "close_"]) {
      expect(client, absent).not.toContain(absent);
    }
  });

  it("does not implement checkout submit", () => {
    expect(sql).not.toContain("checkout_submit");
    expect(code("src/components/checkout/checkout-view.tsx")).not.toContain("data-perf");
  });

  it("did not loosen the duration columns for it either", () => {
    const table = sql.slice(
      sql.indexOf("create table if not exists public.perf_interactions"),
      sql.indexOf("comment on table"),
    );
    expect(table).toContain("interaction_to_visible_ms integer not null");
    expect(table).toContain("interaction_to_commit_ms  integer not null");
    expect(table).toContain("commit_to_visible_ms      integer not null");
  });

  it("leaves every known performance suspect where it was", () => {
    expect(source("src/lib/supabase/middleware.ts")).toContain("await supabase.auth.getUser()");
    expect(source("src/lib/auth/user.ts")).toContain("supabase.auth.getUser()");
    expect(source("src/components/catalog/figure-card.tsx")).toContain(
      "prefetch={href ? undefined : false}",
    );
    expect(source("src/components/shop/offer-link.tsx")).toContain("prefetch={false}");
  });
});

describe("the telemetry still costs the page nothing", () => {
  const client = code("src/components/perf/navigation-telemetry.tsx");

  it("never prevents, delays or logs", () => {
    expect(client).not.toContain("preventDefault");
    expect(client).not.toContain("stopPropagation");
    expect(client).not.toContain("console.");
    expect(client).toContain("passive: true");
  });

  it("keeps no React state per event", () => {
    expect(client).not.toContain("useState");
    expect(client).toContain("useRef");
  });

  it("uses no API mobile Safari lacks", () => {
    for (const unsupported of [
      "PerformanceObserver",
      "largest-contentful-paint",
      "layout-shift",
      "longtask",
      "navigator.connection",
      "sendBeacon",
    ]) {
      expect(client, unsupported).not.toContain(unsupported);
    }
    // MutationObserver, rAF and img.decode() all exist in mobile Safari.
    expect(client).toContain("MutationObserver");
  });

  it("sets no timer", () => {
    expect(client).not.toContain("setTimeout");
    expect(client).not.toContain("setInterval");
  });
});

// A guard against the slip that made `report.ts` stage as a binary file.
describe("the sources are text", () => {
  it("contains no control characters", () => {
    for (const file of [
      "src/lib/perf/interaction.ts",
      "src/lib/perf/artwork.ts",
      "src/lib/perf/report.ts",
      "src/components/perf/navigation-telemetry.tsx",
      MIGRATION,
    ]) {
      expect(source(file), file).not.toMatch(/[\x00-\x08\x0b\x0c\x0e-\x1f]/);
    }
  });
});
