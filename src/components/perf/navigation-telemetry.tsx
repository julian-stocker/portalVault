/**
 * Times navigations and in-page interactions while a test account uses
 * SkyIsles normally (ADR-0072, ADR-0073).
 *
 * Rendered only when the server decided the account holds
 * `performance_tracking`. For everybody else this file is not in the tree:
 * no listener, no observer, no timer, no request, no measurement.
 *
 * HOW IT WATCHES
 *
 * One capture-phase click listener on the document, not a change to every
 * `<Link>` and not a handler on every card. It reads the event and decides; it
 * never calls `preventDefault()`, never stops propagation and never delays
 * anything. A tap behaves exactly as it would if this component were absent —
 * which it usually is.
 *
 * THE MOMENTS
 *
 *   A  the click handler runs                        `performance.now()`
 *   B  navigation: `usePathname()` reports the route  an effect
 *      interaction: the dialog is added to the DOM    a MutationObserver
 *   C  the first frame after B                        two nested rAFs
 *   D  interaction only: the artwork is ready         `lib/perf/artwork.ts`
 *
 * Two frames rather than one: the first callback runs BEFORE the paint of the
 * commit that scheduled it, so its timestamp is still "about to draw". The
 * second runs after that paint, which is the earliest moment the new content
 * was actually on screen.
 *
 * WHY A MUTATION OBSERVER FOR B
 *
 * The quick view is a portal into `document.body` carrying
 * `role="dialog" aria-modal="true"` — attributes it already had. Watching for
 * that node is what lets this measure the dialog without `Modal` or
 * `QuickView` knowing anything about telemetry, and without a single line of
 * their behaviour changing.
 *
 * WHAT IT REFUSES TO MEASURE
 *
 * A tap is only credited to what it caused — see `explains()` and
 * `explainsDialog()`. A back button, a redirect or a second tap while the
 * first was still running leaves the pending tap unmatched, and it is dropped
 * rather than turned into a duration that measures two things.
 *
 * NO REACT STATE PER EVENT. Every moving part is a ref: state would re-render
 * the whole subtree on each tap, which is precisely the cost this must not add.
 */
"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";

import { watchArtwork, type ImageLike } from "@/lib/perf/artwork";
import {
  explainsDialog,
  interactionKey,
  isInteraction,
  measureInteraction,
  PERF_ATTRIBUTE,
  type PendingInteraction,
} from "@/lib/perf/interaction";
import {
  classifyClick,
  explains,
  measure,
  pairKey,
  type Pending,
} from "@/lib/perf/navigation";
import { drain, emptyQueue, enqueue, shouldFlush, type Queue, type Sample } from "@/lib/perf/queue";
import { recordNavigations } from "@/lib/perf/record";
import { normalizeRoute } from "@/lib/perf/route";
import { currentRun } from "@/lib/perf/run";

/** The dialog the quick view opens, by attributes it already carried. */
const DIALOG = '[role="dialog"][aria-modal="true"]';

export function NavigationTelemetry({ buildId }: { buildId: string }) {
  const pathname = usePathname();

  const run = useRef<{ runId: string; label: string | null } | null>(null);
  const pending = useRef<Pending | null>(null);
  const queue = useRef<Queue>(emptyQueue());
  const seenPairs = useRef<Set<string>>(new Set());
  /** The route the previous commit settled on, for `from_route`. */
  const lastRoute = useRef<string | null>(null);

  /* ------------------------------------------------------- interaction state */
  const pendingInteraction = useRef<PendingInteraction | null>(null);
  const seenInteractions = useRef<Set<string>>(new Set());
  /** Ends the artwork watch in flight, if there is one. */
  const cancelArtwork = useRef<(() => void) | null>(null);

  /* ------------------------------------------------------------------ send */
  /*
   * `useCallback`, not a ref written during render. Both close over `buildId`
   * and nothing else that changes, so the effects below list them and still
   * run once — and a ref assigned while rendering would be a lie about when
   * the value is allowed to be read.
   */
  const flush = useCallback(() => {
    const { batch, rest } = drain(queue.current);
    queue.current = rest;
    if (batch.length === 0 || run.current === null) return;

    // Not awaited, and deliberately not caught here either: `recordNavigations`
    // swallows everything itself, so there is no rejection to handle.
    void recordNavigations({
      runId: run.current.runId,
      label: run.current.label,
      buildId,
      viewportW: Math.round(window.innerWidth),
      viewportH: Math.round(window.innerHeight),
      samples: batch,
    });
  }, [buildId]);

  const collect = useCallback(
    (sample: Sample) => {
      queue.current = enqueue(queue.current, sample);
      if (shouldFlush(queue.current)) flush();
    },
    [flush],
  );

  /* ------------------------------------------------- A: the tap, and only A */
  useEffect(() => {
    run.current = currentRun(window.location.search);
    lastRoute.current = normalizeRoute(window.location.pathname);

    function onClick(event: MouseEvent) {
      const target = event.target as Element | null;
      if (!target?.closest) return;

      /*
       * An instrumented in-page trigger first: the quick view opens from a
       * `<button>`, so the anchor branch below would never see it. The marker
       * carries an interaction key and nothing else — never a figure.
       */
      const marked = target.closest(`[${PERF_ATTRIBUTE}]`);
      if (marked) {
        const key = marked.getAttribute(PERF_ATTRIBUTE);
        if (isInteraction(key)) {
          pendingInteraction.current = {
            key,
            at: performance.now(),
            route: lastRoute.current ?? normalizeRoute(window.location.pathname),
          };
        }
        return;
      }

      const anchor = target.closest("a");
      if (!anchor) return;

      const verdict = classifyClick({
        href: anchor.getAttribute("href"),
        target: anchor.getAttribute("target"),
        download: anchor.hasAttribute("download"),
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        button: event.button,
        defaultPrevented: event.defaultPrevented,
        currentPath: window.location.pathname,
        origin: window.location.origin,
      });
      if (!verdict.measure) return;

      pending.current = {
        at: performance.now(),
        toRoute: normalizeRoute(verdict.toPath),
        fromRoute: lastRoute.current ?? normalizeRoute(window.location.pathname),
      };
    }

    // Capture, so a handler that stops propagation cannot hide the tap — and
    // passive, so the listener can never delay the click.
    document.addEventListener("click", onClick, { capture: true, passive: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, []);

  /* --------------------------------------------- B and C: arrival, then paint */
  useEffect(() => {
    if (pathname === null) return;
    const committedAt = performance.now();
    const arrived = normalizeRoute(pathname);

    const tap = pending.current;
    pending.current = null;
    lastRoute.current = arrived;

    // Not the navigation this tap started — a redirect, a back button, or the
    // first render of the session. Nothing is recorded, on purpose.
    if (tap === null || !explains(tap, pathname, committedAt)) return;

    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        const key = pairKey(tap.fromRoute, tap.toRoute);
        const warm = seenPairs.current.has(key);
        seenPairs.current.add(key);

        const sample = measure(tap, committedAt, performance.now(), warm);
        if (sample !== null) collect(sample);
      });
    });

    return () => {
      cancelAnimationFrame(first);
      if (second !== 0) cancelAnimationFrame(second);
    };
  }, [pathname, collect]);

  /* ------------------------------- B, C and D for an in-page dialog (0038) */
  useEffect(() => {
    let frames: number[] = [];

    function opened(dialog: Element) {
      const committedAt = performance.now();
      const tap = pendingInteraction.current;
      pendingInteraction.current = null;

      // A dialog nobody tapped for: opened by code, by a keyboard shortcut,
      // or left over from a tap that never produced this one.
      if (!explainsDialog(tap, committedAt)) return;

      const first = requestAnimationFrame(() => {
        const second = requestAnimationFrame(() => {
          const visibleAt = performance.now();
          const key = interactionKey(tap.key, tap.route);
          const warm = seenInteractions.current.has(key);
          seenInteractions.current.add(key);

          /*
           * D is settled separately, and the sample is only queued once it
           * has been. `cancelArtwork` is called when the dialog closes and
           * before any flush, so a picture that never arrives still produces
           * a row — with a null content timing, which is the honest answer.
           */
          cancelArtwork.current = watchArtwork(
            dialog.querySelector("img") as ImageLike | null,
            () => performance.now(),
            ({ at }) => {
              cancelArtwork.current = null;
              const sample = measureInteraction(tap, committedAt, visibleAt, at, warm);
              if (sample !== null) collect(sample);
            },
          );
        });
        frames.push(second);
      });
      frames.push(first);
    }

    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          const dialog = node.matches(DIALOG) ? node : node.querySelector(DIALOG);
          if (dialog) opened(dialog);
        }
        // The dialog went away. Anything still waiting on its picture settles
        // now rather than never.
        for (const node of record.removedNodes) {
          if (node instanceof Element && (node.matches(DIALOG) || node.querySelector(DIALOG))) {
            cancelArtwork.current?.();
          }
        }
      }
    });
    observer.observe(document.body, { childList: true });

    return () => {
      observer.disconnect();
      for (const frame of frames) cancelAnimationFrame(frame);
      frames = [];
      cancelArtwork.current?.();
    };
  }, [collect]);

  /* ------------------------------------------------- flush when the page goes */
  useEffect(() => {
    function leave() {
      // Settle a waiting artwork first, so its sample is in the queue by the
      // time the queue is emptied. Otherwise the last interaction of a run is
      // the one that gets lost.
      cancelArtwork.current?.();
      flush();
    }
    function onHidden() {
      if (document.visibilityState === "hidden") leave();
    }
    document.addEventListener("visibilitychange", onHidden);
    // `pagehide`, not `beforeunload`: iOS Safari fires the latter unreliably,
    // and swiping the tab away is exactly when a run would otherwise be lost.
    window.addEventListener("pagehide", leave);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", leave);
    };
  }, [flush]);

  return null;
}
