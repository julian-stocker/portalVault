/**
 * What counts as a measurable navigation, and what the numbers mean
 * (ADR-0072).
 *
 * THE THREE POINTS
 *
 *   A  interaction   the tap, as the click handler saw it
 *   B  commit        the router changed route
 *   C  visible       the first frame painted after the destination rendered
 *
 * A-to-C is the metric: "I tapped, and how long until SkyIsles showed me the
 * new page?" A-to-B and B-to-C split that into waiting and drawing, which is
 * the difference between a slow server and a slow render.
 *
 * WHAT C IS AND IS NOT
 *
 * A practical proxy for perceived navigation: the first animation frame after
 * React committed the destination. It is NOT Largest Contentful Paint, NOT
 * Interaction to Next Paint and NOT browser Navigation Timing — none of which
 * measures an App Router navigation, and the first three of which mobile
 * Safari does not implement at all.
 */
import { normalizeRoute } from "./route.ts";

/** Longer than this and the phone went into a pocket, not into a navigation. */
export const MAX_NAVIGATION_MS = 30_000;

/** What a click has to be before it is a navigation worth timing. */
export type ClickFacts = {
  /** `href` of the anchor, as authored. */
  href: string | null;
  /** `target` attribute, if any. */
  target: string | null;
  /** Whether the anchor carries a `download` attribute. */
  download: boolean;
  /** Modifier keys and the button, exactly as the event reported them. */
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  button: number;
  /** Already prevented by something else — then it is not a navigation. */
  defaultPrevented: boolean;
  /** Where the browser is now. */
  currentPath: string;
  /** The site's own origin. */
  origin: string;
};

export type ClickVerdict =
  | { measure: true; toPath: string }
  | { measure: false; reason: string };

/**
 * Whether this click starts an internal navigation we can time.
 *
 * Deliberately conservative: everything it is unsure about is not measured. A
 * missing sample costs a data point; a wrong one costs trust in every number
 * beside it.
 *
 * It decides only. Nothing here prevents a default, stops propagation or
 * touches the event — the navigation happens exactly as it would without
 * telemetry.
 */
export function classifyClick(facts: ClickFacts): ClickVerdict {
  if (facts.defaultPrevented) return { measure: false, reason: "already handled" };
  // A middle click or a modified click opens a tab; the current page does not
  // navigate at all.
  if (facts.button !== 0) return { measure: false, reason: "not a primary click" };
  if (facts.metaKey || facts.ctrlKey || facts.shiftKey || facts.altKey) {
    return { measure: false, reason: "modified click" };
  }
  if (facts.href === null || facts.href === "") return { measure: false, reason: "no href" };
  if (facts.download) return { measure: false, reason: "download" };
  if (facts.target !== null && facts.target !== "" && facts.target !== "_self") {
    return { measure: false, reason: "opens elsewhere" };
  }

  let url: URL;
  try {
    url = new URL(facts.href, facts.origin);
  } catch {
    return { measure: false, reason: "unparseable href" };
  }
  if (url.origin !== facts.origin) return { measure: false, reason: "external" };

  const currentPath = facts.currentPath.split("?")[0].split("#")[0];
  // A hash on the same page scrolls; it is not a navigation.
  if (url.pathname === currentPath && url.hash !== "") {
    return { measure: false, reason: "hash only" };
  }
  if (url.pathname === currentPath) return { measure: false, reason: "same route" };

  return { measure: true, toPath: url.pathname };
}

/** One tap, waiting for the route to change. */
export type Pending = {
  /** `performance.now()` at the moment of the tap. */
  at: number;
  /** Normalised pattern of where the tap was headed. */
  toRoute: string;
  /** Normalised pattern of where it started. */
  fromRoute: string;
};

/**
 * Whether a pending tap explains the route the browser just arrived at.
 *
 * THE POINT OF THIS FUNCTION. Without it a tap that never completed would be
 * credited to the next navigation — a back button, a redirect, a second tap —
 * and produce a duration that measures two things. So the arrival has to be
 * the destination that was tapped, and it has to be recent.
 */
export function explains(pending: Pending, arrivedPath: string, now: number): boolean {
  if (now - pending.at > MAX_NAVIGATION_MS) return false;
  return normalizeRoute(arrivedPath) === pending.toRoute;
}

export type NavigationSample = {
  /**
   * What kind of measurement this is (ADR-0073).
   *
   * The queue carries navigations and in-page interactions together, and the
   * delivery step sends each to its own function. A discriminator on the
   * sample is how a batch stays one ordered list of what the tester did
   * rather than two lists that have to be zipped back together.
   */
  kind: "navigation";
  fromRoute: string;
  toRoute: string;
  interactionToVisibleMs: number;
  interactionToCommitMs: number;
  commitToVisibleMs: number;
  warm: boolean;
};

/** The old name, kept because everything that speaks of navigation uses it. */
export type Sample = NavigationSample;

/** The three durations, rounded, from the three timestamps. */
export function measure(
  pending: Pending,
  committedAt: number,
  visibleAt: number,
  warm: boolean,
): Sample | null {
  const toVisible = Math.round(visibleAt - pending.at);
  const toCommit = Math.round(committedAt - pending.at);
  const toPaint = Math.round(visibleAt - committedAt);

  // A clock that ran backwards, or a navigation that outlived the cap: no
  // sample at all rather than a number nobody can interpret.
  if (toVisible < 0 || toCommit < 0 || toPaint < 0) return null;
  if (toVisible > MAX_NAVIGATION_MS) return null;

  return {
    kind: "navigation",
    fromRoute: pending.fromRoute,
    toRoute: pending.toRoute,
    interactionToVisibleMs: toVisible,
    interactionToCommitMs: toCommit,
    commitToVisibleMs: toPaint,
    warm,
  };
}

/**
 * The key a route pair is remembered by, within one run.
 *
 * `warm` means exactly "this pair occurred before in this run" and nothing
 * more. It does NOT prove the Next.js router cache was warm — only that the
 * operator walked the same path twice, which is the comparison worth having.
 */
export function pairKey(fromRoute: string, toRoute: string): string {
  return `${fromRoute} ${toRoute}`;
}
