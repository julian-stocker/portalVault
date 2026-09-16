/**
 * Times navigations while a test account uses SkyIsles normally (ADR-0072).
 *
 * Rendered only when the server decided the account holds
 * `performance_tracking`. For everybody else this file is not in the tree:
 * no listener, no timer, no request, no measurement.
 *
 * HOW IT WATCHES
 *
 * One capture-phase click listener on the document, not a change to every
 * `<Link>`. It reads the event and decides; it never calls `preventDefault()`,
 * never stops propagation and never delays anything. A navigation behaves
 * exactly as it would if this component were absent — which it usually is.
 *
 * THE THREE MOMENTS
 *
 *   A  the click handler runs                        `performance.now()`
 *   B  `usePathname()` reports the new route         an effect
 *   C  the first frame after that                    two nested rAFs
 *
 * Two frames rather than one: the first callback runs BEFORE the paint of the
 * commit that scheduled it, so its timestamp is still "about to draw". The
 * second runs after that paint, which is the earliest moment the new page was
 * actually on screen.
 *
 * WHAT IT REFUSES TO MEASURE
 *
 * A tap is only credited to the arrival it was aimed at — see `explains()`. A
 * back button, a redirect or a second tap while the first was still running
 * leaves the pending tap unmatched, and it is dropped rather than turned into
 * a duration that measures two navigations.
 *
 * NO REACT STATE PER EVENT. Every moving part is a ref: state would re-render
 * the whole subtree on each tap, which is precisely the cost this must not add.
 */
"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";

import {
  classifyClick,
  explains,
  measure,
  pairKey,
  type Pending,
  type Sample,
} from "@/lib/perf/navigation";
import { drain, emptyQueue, enqueue, shouldFlush, type Queue } from "@/lib/perf/queue";
import { recordNavigations } from "@/lib/perf/record";
import { normalizeRoute } from "@/lib/perf/route";
import { currentRun } from "@/lib/perf/run";

export function NavigationTelemetry({ buildId }: { buildId: string }) {
  const pathname = usePathname();

  const run = useRef<{ runId: string; label: string | null } | null>(null);
  const pending = useRef<Pending | null>(null);
  const queue = useRef<Queue>(emptyQueue());
  const seenPairs = useRef<Set<string>>(new Set());
  /** The route the previous commit settled on, for `from_route`. */
  const lastRoute = useRef<string | null>(null);

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
      const anchor = (event.target as Element | null)?.closest?.("a");
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

  /* ------------------------------------------------- flush when the page goes */
  useEffect(() => {
    function onHidden() {
      if (document.visibilityState === "hidden") flush();
    }
    function onPageHide() {
      flush();
    }
    document.addEventListener("visibilitychange", onHidden);
    // `pagehide`, not `beforeunload`: iOS Safari fires the latter unreliably,
    // and swiping the tab away is exactly when a run would otherwise be lost.
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [flush]);

  return null;
}
