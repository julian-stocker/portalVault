/**
 * Who the browser is acting as, right now.
 *
 * Everything a checkout keeps in the browser — the guest basket, the payment
 * capability, the order being paid for — used to sit under a fixed key. The
 * browser was the identity, so signing out and in as somebody else changed
 * nothing about what those keys held, and the second account was shown the
 * first one's basket and open order (ADR-0061).
 *
 * A principal is the missing half of every one of those keys. It is not a
 * security boundary and does not pretend to be one: the database decides who
 * may read an order, and `authorize_order_payment()` has always been the gate.
 * This is what stops one person's browser from *offering* another person's
 * state to them.
 */
export type Principal = { kind: "guest" } | { kind: "user"; id: string };

export const GUEST: Principal = { kind: "guest" };

export function principalFor(userId: string | null | undefined): Principal {
  return typeof userId === "string" && userId !== "" ? { kind: "user", id: userId } : GUEST;
}

/**
 * The key fragment. Short, stable and readable in devtools — none of this is
 * secret, and a key that cannot be read is a key nobody can debug.
 */
export function principalKey(principal: Principal): string {
  return principal.kind === "user" ? `u.${principal.id}` : "guest";
}

export function samePrincipal(a: Principal | null, b: Principal | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind !== b.kind) return false;
  return a.kind !== "user" || b.kind !== "user" || a.id === b.id;
}

/* --------------------------------------------------- the one live principal */

/**
 * What the browser is acting as right now, for the modules that cannot be
 * handed it as a prop — the payment capability helpers, called from deep
 * inside event handlers.
 *
 * A module-level value rather than a context, for the same reason the cart
 * store is one: there is exactly one answer per browser, and a provider
 * between the reader and the answer only creates the possibility of two.
 *
 * Defaults to the guest. A page that never binds a principal therefore
 * behaves as a signed-out one — which is the safe default, because the guest
 * namespace holds nothing belonging to an account.
 */
let current: Principal = GUEST;

export function currentPrincipal(): Principal {
  return current;
}

/** Returns true when this actually changed anything. */
export function setCurrentPrincipal(next: Principal): boolean {
  if (samePrincipal(current, next)) return false;
  current = next;
  return true;
}

/** Test seam. Not used by the app. */
export function resetPrincipal(): void {
  current = GUEST;
}
