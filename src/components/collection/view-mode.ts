/**
 * How the showcase is drawn.
 *
 * Two ways to look at the same collection: the cards, which are what a
 * collector wants to *see*, and a table, which is what they want when the
 * collection is large and the question is a number rather than a figure
 * (ADR-0038, V4).
 *
 * Pure, so the choice and its persistence can be tested without a browser.
 */
export const VIEW_MODES = ["symbols", "table"] as const;
export type ViewMode = (typeof VIEW_MODES)[number];

/**
 * The table (ADR-0038, V4.2).
 *
 * A large collection is read before it is browsed: 448 cards is a scroll,
 * while the table answers "how many, which game, what is it worth" on the
 * first screen. The cards are one click away and the choice is remembered,
 * so anyone who wants the showcase gets it back on every later visit.
 */
export const DEFAULT_VIEW_MODE: ViewMode = "table";

const STORAGE_KEY = "skyisles.collection.view";

export function isViewMode(value: unknown): value is ViewMode {
  return typeof value === "string" && (VIEW_MODES as readonly string[]).includes(value);
}

/**
 * The remembered choice, or the default.
 *
 * Read after mount rather than during render: the server has no
 * `localStorage`, so using it for the first paint would hand React a
 * different tree on the client and produce a hydration mismatch. Anything
 * unreadable — private mode, storage disabled, a value from an older build —
 * falls back to the default rather than throwing.
 */
export function readViewMode(): ViewMode {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isViewMode(stored) ? stored : DEFAULT_VIEW_MODE;
  } catch {
    return DEFAULT_VIEW_MODE;
  }
}

/** Best effort: a browser that refuses to store this is not an error. */
export function writeViewMode(mode: ViewMode): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Private mode, quota, storage disabled — the choice simply does not
    // outlive the session.
  }
  for (const listener of listeners) listener();
}

/**
 * The store behind `useSyncExternalStore`.
 *
 * Reading storage in an effect and calling `setState` works, but it is a
 * render triggered by a render, and React says so. This is the shape the
 * problem actually has: an external system whose value React should read,
 * with a different answer on the server than in the browser.
 *
 * `getSnapshot` may be called on every render, so it must return a value that
 * compares equal when nothing changed — a string does, which is why the mode
 * is one.
 */
const listeners = new Set<() => void>();

export function subscribeViewMode(onChange: () => void): () => void {
  listeners.add(onChange);
  // Another tab changing the choice should not leave this one disagreeing.
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** The server has no storage, and the first client paint must match it. */
export function serverViewMode(): ViewMode {
  return DEFAULT_VIEW_MODE;
}
