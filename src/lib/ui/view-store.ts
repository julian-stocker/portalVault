/**
 * A remembered choice of view, as a store React can read safely.
 *
 * WHY THIS IS A FACTORY AND NOT A SECOND COPY OF THE COLLECTION'S MODULE
 *
 * `src/components/collection/view-mode.ts` solved this once, for symbols or
 * table, and it got four subtle things right that are easy to get wrong the
 * second time:
 *
 *   1. the value is read AFTER mount, never during render — the server has no
 *      `localStorage`, so using it for the first paint hands React a
 *      different tree on the client and produces a hydration mismatch
 *   2. `getSnapshot` may be called on every render, so it has to return a
 *      value that compares equal when nothing changed — a string does, which
 *      is why a mode is one
 *   3. every access is wrapped: a private window, disabled site data or a
 *      value from an older build must fall back, not throw
 *   4. another tab changing the choice must not leave this one disagreeing
 *
 * UX-01C needs the same four for the catalogue, under a DIFFERENT key. So the
 * mechanism moves here and the key becomes a parameter, rather than the
 * forty lines being written out twice and drifting apart.
 *
 * THE COLLECTION IS NOT MIGRATED, AND THAT IS DELIBERATE. Its module is in
 * service and covered by its own tests, `/collection` is explicitly out of
 * scope for UX-01C, and a no-op refactor of working code is a risk taken for
 * tidiness. It can adopt this later without any change in behaviour; until
 * then this file is the one implementation that new views use.
 *
 * TWO STORES NEVER SHARE STATE. Each instance holds its own listener set and
 * its own key, so the catalogue's choice and the collection's cannot read or
 * overwrite one another — a test asserts both the keys and the independence.
 */

/** Everything a view switch needs, for one remembered choice. */
export type ViewStore<T extends string> = {
  /** The storage key. Exposed so a test can assert two stores differ. */
  readonly key: string;
  /** The allowed values, in display order. */
  readonly values: readonly T[];
  /** What is shown when nothing is remembered. */
  readonly fallback: T;
  /** Whether a value from outside is one of them. */
  is: (value: unknown) => value is T;
  /** The remembered choice, or the fallback. Browser only. */
  read: () => T;
  /** Best effort: a browser that refuses to store this is not an error. */
  write: (value: T) => void;
  /** `useSyncExternalStore`'s subscribe. Returns the unsubscriber. */
  subscribe: (onChange: () => void) => () => void;
  /** The server snapshot, which the first client paint has to match. */
  server: () => T;
};

export function createViewStore<T extends string>({
  key,
  values,
  fallback,
}: {
  key: string;
  values: readonly T[];
  fallback: T;
}): ViewStore<T> {
  /*
   * Per instance, not per module. Two stores in one page must not wake each
   * other up — React would ask the wrong snapshot and re-render for nothing.
   */
  const listeners = new Set<() => void>();

  const is = (value: unknown): value is T =>
    typeof value === "string" && (values as readonly string[]).includes(value);

  function read(): T {
    try {
      const stored = window.localStorage.getItem(key);
      return is(stored) ? stored : fallback;
    } catch {
      /* Private mode, storage disabled, a value from an older build. */
      return fallback;
    }
  }

  function write(value: T): void {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* The choice simply does not outlive the session. */
    }
    /* Told to React in the same tick, whether or not storage accepted it:
       the switch has to respond even where nothing can be remembered. */
    for (const listener of listeners) listener();
  }

  function subscribe(onChange: () => void): () => void {
    listeners.add(onChange);
    /*
     * `storage` fires only in OTHER tabs, which is exactly what it is for
     * here. Filtered by key so an unrelated write does not wake this store;
     * `event.key === null` is `clear()` and concerns every key.
     */
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === key) onChange();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(onChange);
      window.removeEventListener("storage", onStorage);
    };
  }

  const server = (): T => fallback;

  return { key, values, fallback, is, read, write, subscribe, server };
}
