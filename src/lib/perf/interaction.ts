/**
 * Timing an in-page interaction (ADR-0073).
 *
 * The quick view is the catalog's main interaction and it is not a
 * navigation: tapping a figure sets React state and a dialog appears
 * (ADR-0027). 0037 could not see it, so this measures it — the same shape of
 * measurement, one moment longer.
 *
 *   A  the tap on the trigger
 *   B  the dialog is committed into the DOM
 *   C  the first frame after that       — the structure is on screen
 *   D  the artwork is ready to be seen  — nullable
 *
 * WHY D EXISTS
 *
 * Opening the quick view loads no data: the figure and its offers are already
 * in the browser (`lib/ui/quick-view.ts`). A→C is therefore pure client
 * render and will usually be quick. The picture is the part that is not —
 * `loading="lazy"`, and for a figure with an administrator override it comes
 * from Supabase Storage over the network. A report with only A→C would say
 * the quick view opens in 40 ms while the tester sits looking at an empty
 * frame.
 *
 * The decidable parts are pure functions here; the DOM watching lives in the
 * component, as it does for navigation.
 */
import { MAX_NAVIGATION_MS } from "./navigation.ts";
import { ROUTE_PATTERN } from "./route.ts";

/**
 * Every interaction that may be recorded.
 *
 * Closed, and the CHECK constraint in `0038` holds the same list. A key
 * cannot exist without client code to emit it, so this set only ever changes
 * in a deploy — which is why it is a constant and a constraint rather than a
 * registry table (ADR-0073).
 */
export const INTERACTIONS = ["quick_view_open"] as const;
export type InteractionKey = (typeof INTERACTIONS)[number];

/** What the trigger carries in the markup. Never a figure identity. */
export const PERF_ATTRIBUTE = "data-perf";

export function isInteraction(value: unknown): value is InteractionKey {
  return typeof value === "string" && (INTERACTIONS as readonly string[]).includes(value);
}

/** A tap that has not yet produced a dialog. */
export type PendingInteraction = {
  key: InteractionKey;
  /** `performance.now()` at the tap. */
  at: number;
  /** The route it happened on, already a pattern. */
  route: string;
};

export type InteractionSample = {
  kind: "interaction";
  interaction: InteractionKey;
  route: string;
  interactionToVisibleMs: number;
  interactionToCommitMs: number;
  commitToVisibleMs: number;
  /** A→D, or null when the artwork gave no trustworthy signal. */
  contentVisibleMs: number | null;
  warm: boolean;
};

/**
 * Whether a dialog that just appeared belongs to the tap we are holding.
 *
 * The same rule navigation uses: a tap is only credited to what it caused. A
 * dialog opened some other way — a keyboard shortcut, a redirect, code — has
 * no tap, and a tap whose dialog never appeared is dropped rather than
 * attached to the next one.
 */
export function explainsDialog(
  pending: PendingInteraction | null,
  now: number,
): pending is PendingInteraction {
  if (pending === null) return false;
  const elapsed = now - pending.at;
  return elapsed >= 0 && elapsed <= MAX_NAVIGATION_MS;
}

/**
 * The finished sample, or null when the numbers cannot be trusted.
 *
 * `content` is handled apart from the other three: it is allowed to be null,
 * and it is allowed to be SMALLER than A→C. A cached picture can finish
 * decoding before the second animation frame that defines C, and that is not
 * an error — it is the case where the image was never what anybody waited
 * for. Clamping it to C would erase exactly the distinction the column is for.
 */
export function measureInteraction(
  pending: PendingInteraction,
  committedAt: number,
  visibleAt: number,
  contentAt: number | null,
  warm: boolean,
): InteractionSample | null {
  const toCommit = committedAt - pending.at;
  const toVisible = visibleAt - pending.at;
  const commitToVisible = visibleAt - committedAt;

  // A clock that ran backwards, or a phone that went into a pocket.
  if (toCommit < 0 || commitToVisible < 0) return null;
  if (toVisible > MAX_NAVIGATION_MS) return null;

  let content: number | null = null;
  if (contentAt !== null) {
    const toContent = contentAt - pending.at;
    // Out of range is "not measured", never a clamped number: a wrong
    // duration is worse than an absent one.
    if (toContent >= 0 && toContent <= MAX_NAVIGATION_MS) content = Math.round(toContent);
  }

  return {
    kind: "interaction",
    interaction: pending.key,
    route: pending.route,
    interactionToVisibleMs: Math.round(toVisible),
    interactionToCommitMs: Math.round(toCommit),
    commitToVisibleMs: Math.round(commitToVisible),
    contentVisibleMs: content,
    warm,
  };
}

/** `warm` is per run: this key, on this route, has happened before. */
export function interactionKey(key: InteractionKey, route: string): string {
  return `${key}|${route}`;
}

/** Everything the server will accept. Checked before the batch is sent. */
export function usableInteraction(sample: InteractionSample): boolean {
  const bounded = (value: number) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_NAVIGATION_MS;

  return (
    isInteraction(sample?.interaction) &&
    typeof sample.route === "string" &&
    ROUTE_PATTERN.test(sample.route) &&
    bounded(sample.interactionToVisibleMs) &&
    bounded(sample.interactionToCommitMs) &&
    bounded(sample.commitToVisibleMs) &&
    (sample.contentVisibleMs === null || bounded(sample.contentVisibleMs)) &&
    typeof sample.warm === "boolean"
  );
}
