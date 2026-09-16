/**
 * A run: one browser session of measurements (ADR-0072).
 *
 * The operator picks up the phone, uses SkyIsles for ten minutes and puts it
 * down. That is a run, and grouping by it is what makes "before" and "after"
 * comparable. Nothing has to be started or stopped — opening the site is
 * enough.
 *
 * `sessionStorage`, not `localStorage`: a run should end when the tab does.
 */

/** A label the operator may give a run, e.g. `mobile-baseline-1`. */
export const LABEL_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;

/**
 * What survives from `?perf=…`, or null.
 *
 * Lower-cased, spaces and underscores folded to hyphens, everything else
 * dropped, then bounded. A label reaches a database column with its own CHECK;
 * this is so the value is already what that column accepts rather than being
 * refused after a whole run was recorded.
 */
export function sanitizeLabel(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const folded = raw
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return folded !== "" && LABEL_PATTERN.test(folded) ? folded : null;
}

const RUN_KEY = "skyisles.perf.run";
const LABEL_KEY = "skyisles.perf.label";

/** A UUID, from the platform where there is one and from `Math.random` where
    there is not. The value only has to be unique among runs. */
function uuid(): string {
  const cryptoApi = globalThis.crypto as Crypto | undefined;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") return cryptoApi.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const value = (Math.random() * 16) | 0;
    return (char === "x" ? value : (value & 0x3) | 0x8).toString(16);
  });
}

export type Run = { runId: string; label: string | null };

/**
 * The run for this browser session, created on first use.
 *
 * Every storage access is guarded: a browser with site data blocked throws on
 * `sessionStorage`, and telemetry must never be the reason a page fails. In
 * that case the run lives for one page load, which is a worse measurement and
 * not a broken site.
 */
export function currentRun(search: string): Run {
  const fromQuery = sanitizeLabel(new URLSearchParams(search).get("perf"));

  let runId: string | null = null;
  let label: string | null = null;
  try {
    runId = sessionStorage.getItem(RUN_KEY);
    label = sessionStorage.getItem(LABEL_KEY);
  } catch {
    /* no storage: a one-page run */
  }

  if (runId === null) {
    runId = uuid();
    try {
      sessionStorage.setItem(RUN_KEY, runId);
    } catch {
      /* ignored */
    }
  }

  // A label given in the URL names the run from here on; it is stored once and
  // the parameter is never propagated, so later navigations carry nothing.
  if (fromQuery !== null && fromQuery !== label) {
    label = fromQuery;
    try {
      sessionStorage.setItem(LABEL_KEY, fromQuery);
    } catch {
      /* ignored */
    }
  }

  return { runId, label: label !== null && LABEL_PATTERN.test(label) ? label : null };
}
