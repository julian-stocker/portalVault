/**
 * Tells the browser who it is acting as.
 *
 * The server knows the session; the cart store and the payment-capability
 * helpers are client modules that cannot ask. This is the one place the
 * answer crosses over, and it does three things in one order that matters
 * (ADR-0061):
 *
 *   1. throw away every payment capability left by a different identity
 *   2. record the new principal, so every key written from now on carries it
 *   3. load that identity's basket — merging a guest basket on the way in
 *
 * Rendered by both shells, so the answer is the same on every route. It draws
 * nothing.
 */
"use client";

import { useEffect } from "react";

import { bindPrincipal } from "@/lib/cart/store";
import { forgetForeignPaymentState } from "@/lib/commerce/capability";
import { principalFor, setCurrentPrincipal } from "@/lib/auth/principal";

export function PrincipalGate({ userId }: { userId: string | null }) {
  useEffect(() => {
    const principal = principalFor(userId);
    // Unconditional, not only on a change: a tab that was open across a
    // sign-out in another tab still holds the old keys, and this is the next
    // moment anything runs.
    forgetForeignPaymentState(principal);
    setCurrentPrincipal(principal);
    bindPrincipal(principal);
  }, [userId]);

  return null;
}
