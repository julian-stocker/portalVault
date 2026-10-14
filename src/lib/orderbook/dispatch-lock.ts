/**
 * The synchronous guard a child component puts in front of a parent's
 * item action.
 *
 * WHY THIS EXISTS — the gap it closes, stated precisely.
 *
 * `PurchaseDetails` dispatches writing actions through a prop:
 *
 *     onItemAction: (key: number, run: () => Promise<PurchaseItemResult>) => void
 *
 * That signature promises nothing about double clicks. Today the single
 * mount site in `orderbook-ledger.tsx` happens to hold a `useRef` set and
 * drops a second dispatch for the same key, so no second request can leave
 * the browser. The dialog's own visible guard — `disabled={running}` — is
 * driven by STATE and is therefore one render behind: two clicks inside one
 * tick both see `running === false`. Remove the parent's ref and the dialog
 * is unprotected, and nothing in its types would say so.
 *
 * So the dialog keeps its own lock. Not because the parent is wrong, but
 * because a child that fires a writing request should not depend on a
 * promise its prop type does not make.
 *
 * THE RELEASE IS THE HARD PART, NOT THE LOCK.
 *
 * A naive `held.add(key)` in the click handler can wedge the row forever:
 * if the PARENT refuses the dispatch — its own lock is already held for this
 * key, e.g. because the expanded big table started the same action — then
 * `run` is never called, no `finally` ever fires, and the key stays locked
 * with nothing in flight. The button would be dead until the dialog closes.
 *
 * Two things prevent that:
 *
 *   1. `run` is wrapped, and the wrapper releases in `finally` — on success,
 *      on a refusal result, and on a thrown error alike.
 *   2. If the wrapper was never entered by the time `onItemAction` returns,
 *      the parent refused, and the key is released immediately.
 *
 * Point 2 relies on the parent invoking `run` synchronously. `act` in the
 * ledger does: its `void (async () => { const result = await run(); … })()`
 * runs its body up to the first `await`, and `run()` is that await's
 * operand. If a future parent deferred the call instead, `started` would
 * still be false here and we would release early — which degrades to
 * exactly today's behaviour, the parent's lock alone. Never a stuck row;
 * at worst no extra protection. That is the right way round.
 *
 * THE DATABASE REMAINS THE LAST INSTANCE. `seller_unbook_purchase_item`
 * takes `for update` and raises `this item is not in inventory` when there
 * is nothing to give back. This lock saves a pointless round trip; it is
 * not what makes the operation safe.
 */

/** Exactly the shape `PurchaseDetails` receives, and nothing more. */
type Dispatch<T> = (key: number, run: () => Promise<T>) => void;

/**
 * Dispatch `run` for `key` unless a dispatch for that key is still open.
 *
 * `held` is the caller's mutable set — a `useRef<Set<number>>` in a
 * component. It is passed in rather than captured so this stays a plain
 * function that a test can drive with real promises and real microtasks.
 *
 * Returns whether the dispatch was attempted. The return value is a
 * convenience for tests and callers that want to know; the protection does
 * not depend on anyone reading it.
 */
export function dispatchItemAction<T>(
  held: Set<number>,
  key: number,
  onItemAction: Dispatch<T>,
  run: () => Promise<T>,
): boolean {
  /* The second click of a double click lands here, before any render. */
  if (held.has(key)) return false;
  held.add(key);

  let started = false;
  onItemAction(key, () => {
    started = true;
    /*
     * `finally` on the promise, not `try/finally` around an await: this
     * wrapper must stay synchronous so the parent gets its promise back
     * unchanged in timing, and the release must happen whether the action
     * resolves, resolves with a refusal, or throws.
     */
    return run().finally(() => {
      held.delete(key);
    });
  });

  /* The parent refused — nothing is in flight, so nothing stays locked. */
  if (!started) held.delete(key);
  return true;
}
