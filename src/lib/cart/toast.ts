/**
 * The one line of feedback after the cart was asked to change (V10, V11).
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
 * FOUR MESSAGES, AND WHY THE SHAPE IS A UNION
 *
 * V11 added the two that report a refusal. They are separate members rather
 * than flags on one object so that a refusal has **nowhere to put a number**:
 * `denied` carries no name, no price and no quantity, and the type is what
 * guarantees it. "Keine weitere Menge verfügbar" cannot accidentally grow a
 * stock level, because there is no field for one (docs/SECURITY.md).
 *
 * It knows nothing about the cart beyond what it is told. It stores no
 * quantities of its own, reads no storage and mutates nothing: the cart is
 * the cart's business (ADR-0043).
 */
import type { OfferCondition } from "@/lib/shop/offer";

/** Long enough to read, short enough not to sit in the way. */
export const CART_TOAST_MS = 2600;

/**
 * What happened, as the visitor needs to hear it.
 *
 *   added      a line that was not there is there now
 *   increased  a line that was there grew
 *   denied     the shop cannot supply that many right now — no reason given,
 *              and no count, ever
 *   unchecked  the question could not be put to the server at all. A
 *              different sentence from `denied` on purpose: one is an answer,
 *              the other is the absence of one, and claiming a stock status
 *              we never obtained would be a lie.
 */
export type CartToastMessage =
  | { kind: "added"; name: string; condition: OfferCondition; price: number }
  | { kind: "increased"; name: string; condition: OfferCondition; quantity: number }
  | { kind: "denied" }
  | { kind: "unchecked" };

/**
 * `id` distinguishes two identical messages so a reader can tell them apart.
 * Never displayed.
 */
export type CartToast = CartToastMessage & { id: number };

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

export function showCartToast(message: CartToastMessage): void {
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
