/**
 * The one line of feedback after something goes into the cart (V10).
 *
 * A module store with the same shape as the cart's own — subscribe, snapshot,
 * server snapshot — because that is the pattern this product already uses for
 * state that lives outside React, and adding a context provider for one
 * transient sentence would be a second architecture for a smaller job.
 *
 * It holds **one** message. A second add replaces the first and restarts the
 * timer; there is no queue, because a queue would make somebody wait to read
 * about the thing they added three taps ago.
 *
 * THE TIMER LIVES HERE, NOT IN THE COMPONENT
 *
 * `show()` schedules the dismissal itself and cancels whatever was pending.
 * That makes the component a pure reader with no effects at all — nothing to
 * clean up on unmount, nothing that can leak, and no timer that survives a
 * message it no longer belongs to.
 *
 * It knows nothing about the cart beyond what it is told. It stores no
 * quantities of its own, reads no storage and mutates nothing: the cart is
 * the cart's business (ADR-0043).
 */
import type { OfferCondition } from "@/lib/shop/offer";

/** Long enough to read, short enough not to sit in the way. */
export const CART_TOAST_MS = 2600;

export type CartToast = {
  /** Whether the line is new, or an existing one that grew. */
  kind: "added" | "increased";
  name: string;
  condition: OfferCondition;
  price: number;
  /** The line's quantity **after** the change. Only shown for `increased`. */
  quantity: number;
  /**
   * Distinguishes two identical adds so the reader can tell them apart.
   * Never displayed.
   */
  id: number;
};

const listeners = new Set<() => void>();
let snapshot: CartToast | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let sequence = 0;

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): CartToast | null {
  return snapshot;
}

/** Nothing has been added on the server. */
export function getServerSnapshot(): CartToast | null {
  return null;
}

export function showCartToast(message: Omit<CartToast, "id">): void {
  if (timer !== null) clearTimeout(timer);
  sequence += 1;
  snapshot = { ...message, id: sequence };
  emit();

  timer = setTimeout(() => {
    timer = null;
    snapshot = null;
    emit();
  }, CART_TOAST_MS);
}

export function dismissCartToast(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  snapshot = null;
  emit();
}

/** Test seam: forgets everything this module is holding. Not used by the app. */
export function resetCartToast(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  snapshot = null;
  sequence = 0;
  listeners.clear();
}
