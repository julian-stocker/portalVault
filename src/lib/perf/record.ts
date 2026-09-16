/**
 * Where a batch of measurements goes (ADR-0072, ADR-0073).
 *
 * A Server Action rather than `sendBeacon`: the insert needs the caller's
 * session, and a beacon cannot carry one. It is called with `keepalive` from
 * the client so a flush started as the page goes away still completes.
 *
 * NOTHING WAITS FOR THIS. The client never awaits it before navigating, and
 * every failure is swallowed — the recorder refusing, the network being gone,
 * the session having expired. Telemetry that can break navigation is worse
 * than no telemetry, because it breaks the thing it exists to measure.
 *
 * The account is not an argument. `record_navigation()` and
 * `record_interaction()` both take it from `auth.uid()` and ask
 * `has_tester_permission('performance_tracking')` before they write, so this
 * file cannot record on anybody else's behalf however it is called.
 *
 * TWO KINDS, ONE BATCH, NO SHARED FATE
 *
 * Since 0038 a batch carries navigations and in-page interactions in the
 * order they happened. Each sample is validated and sent on its own: a
 * malformed interaction is skipped, and the navigations around it are still
 * recorded. The two kinds never became one code path that could fail together.
 */
"use server";

import { usableInteraction, type InteractionSample } from "@/lib/perf/interaction";
import { MAX_NAVIGATION_MS, type NavigationSample } from "@/lib/perf/navigation";
import { LABEL_PATTERN } from "@/lib/perf/run";
import { ROUTE_PATTERN } from "@/lib/perf/route";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUILD_ID = /^[A-Za-z0-9._-]{1,64}$/;

/** One request's worth. Bounded so a bad caller cannot send a megabyte. */
const MAX_BATCH = 50;

export type Sample = NavigationSample | InteractionSample;

export type Batch = {
  runId: string;
  label: string | null;
  buildId: string | null;
  viewportW: number;
  viewportH: number;
  samples: Sample[];
};

function duration(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_NAVIGATION_MS;
}

function pixels(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 10000;
}

/**
 * Everything wrong with a navigation sample, or nothing.
 *
 * Checked here as well as by the CHECK constraints — not because the database
 * might let something through, but so a single malformed sample is skipped
 * instead of aborting the batch that carries nine good ones.
 */
function usable(sample: NavigationSample): boolean {
  return (
    typeof sample?.toRoute === "string" &&
    ROUTE_PATTERN.test(sample.toRoute) &&
    (sample.fromRoute === null || ROUTE_PATTERN.test(sample.fromRoute)) &&
    duration(sample.interactionToVisibleMs) &&
    duration(sample.interactionToCommitMs) &&
    duration(sample.commitToVisibleMs) &&
    typeof sample.warm === "boolean"
  );
}

/**
 * Records a batch. Returns nothing a caller could branch on.
 *
 * Deliberately `void`: there is no success the client should react to and no
 * failure it should retry. A number here would invite somebody to await it.
 */
export async function recordNavigations(batch: Batch): Promise<void> {
  try {
    if (!batch || !UUID.test(batch.runId)) return;
    if (!Array.isArray(batch.samples) || batch.samples.length === 0) return;
    if (!pixels(batch.viewportW) || !pixels(batch.viewportH)) return;

    const label = typeof batch.label === "string" && LABEL_PATTERN.test(batch.label) ? batch.label : null;
    const buildId =
      typeof batch.buildId === "string" && BUILD_ID.test(batch.buildId) ? batch.buildId : null;

    const supabase = await createClient();

    for (const sample of batch.samples.slice(0, MAX_BATCH)) {
      /*
       * One call per measurement. A row-array RPC would be fewer round trips
       * and would also mean one malformed sample rejecting the batch; at ten
       * rows a few times per session the simpler shape is worth more than the
       * saved calls — and it is what keeps a bad interaction from taking the
       * navigations with it.
       */
      if (sample.kind === "interaction") {
        if (!usableInteraction(sample)) continue;
        await supabase.rpc("record_interaction", {
          p_run_id: batch.runId,
          p_route: sample.route,
          p_interaction: sample.interaction,
          p_interaction_to_visible_ms: sample.interactionToVisibleMs,
          p_interaction_to_commit_ms: sample.interactionToCommitMs,
          p_commit_to_visible_ms: sample.commitToVisibleMs,
          p_content_visible_ms: sample.contentVisibleMs,
          p_viewport_w: batch.viewportW,
          p_viewport_h: batch.viewportH,
          p_warm: sample.warm,
          p_build_id: buildId,
          p_label: label,
        });
        continue;
      }

      if (!usable(sample)) continue;
      await supabase.rpc("record_navigation", {
        p_run_id: batch.runId,
        p_to_route: sample.toRoute,
        p_from_route: sample.fromRoute,
        p_interaction_to_visible_ms: sample.interactionToVisibleMs,
        p_interaction_to_commit_ms: sample.interactionToCommitMs,
        p_commit_to_visible_ms: sample.commitToVisibleMs,
        p_viewport_w: batch.viewportW,
        p_viewport_h: batch.viewportH,
        p_warm: sample.warm,
        p_build_id: buildId,
        p_label: label,
      });
    }
  } catch {
    /*
     * Swallowed, and that is the contract. The caller does not await this, has
     * nowhere to show an error and must not change its behaviour because
     * measurement failed.
     */
  }
}
