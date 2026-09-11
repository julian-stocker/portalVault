"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { forgetPaymentToken, recallPaymentToken } from "@/lib/commerce/capability";
import {
  AUTO_REFRESH_DELAYS_MS,
  isTerminal,
  shouldAutoRefresh,
  viewFor,
  type OrderPaymentState,
  type PaymentView,
} from "@/lib/commerce/payment-state";
import { formatPrice } from "@/lib/format";
import { de } from "@/lib/i18n/de";
import { createClient } from "@/lib/supabase/client";

/**
 * What the customer is told after coming back from the payment page (B2.4).
 *
 * WHY THIS IS A CLIENT COMPONENT
 *
 * A guest proves ownership of their order with the capability, and that lives
 * in `sessionStorage` — which a server component cannot read, by definition.
 * So the authorised read has to happen in the browser. The page around this is
 * still a server shell; only the one question "did the money arrive" is asked
 * from here.
 *
 * Signed-in customers take the same path deliberately. `order_payment_state()`
 * accepts either proof, so one code path serves both, and there is no second
 * projection that could drift from the first.
 *
 * THE REDIRECT PROVES NOTHING
 *
 * Stripe sends the customer here when the Checkout Session completes, which is
 * not the same event as money arriving — and the URL is one a customer can
 * simply type. `session_id` from that URL is never read: it authorises nothing
 * and identifies nothing the order number does not. Every word this component
 * shows comes from `order_payment_state()`.
 */
export function PaymentStatus({ orderNumber }: { orderNumber: string }) {
  const [state, setState] = useState<OrderPaymentState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  const read = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const supabase = createClient();
      // The token is only sent when we actually hold one. A signed-in owner
      // needs none: the function accepts their verified auth.uid().
      const token = recallPaymentToken(orderNumber);
      const { data, error } = await supabase.rpc("order_payment_state", {
        p_order_number: orderNumber,
        p_token: token,
      });
      const row = Array.isArray(data) ? data[0] : data;
      setState(error || !row ? null : (row as OrderPaymentState));
    } catch {
      setState(null);
    } finally {
      inFlight.current = false;
      setBusy(false);
      setLoaded(true);
    }
  }, [orderNumber]);

  /*
   * Scheduled rather than called straight away.
   *
   * `read()` sets state before its first await, and doing that synchronously
   * inside an effect makes React re-render in a cascade — the compiler refuses
   * it, rightly. A zero delay puts the first request in the next task, which
   * is also when the browser has finished painting the shell.
   */
  useEffect(() => {
    const timer = setTimeout(() => void read(), 0);
    return () => clearTimeout(timer);
  }, [read]);

  const view: PaymentView = loaded ? viewFor(state) : "awaiting_confirmation";

  /*
   * Three looks, then silence.
   *
   * Timeouts and not an interval, on purpose: an interval is a loop, and a
   * loop against the database that nobody stops is the polling infrastructure
   * ADR-0054 says not to build. A webhook that has not arrived in ten seconds
   * will not be caught by a fourth request either — from then on the customer
   * presses the button, which is honest about who is waiting for whom.
   */
  useEffect(() => {
    if (!loaded || !shouldAutoRefresh(view)) return;
    const timers = AUTO_REFRESH_DELAYS_MS.map((delay) =>
      setTimeout(() => {
        void read();
      }, delay),
    );
    return () => timers.forEach(clearTimeout);
    // Deliberately keyed on `loaded` alone: the schedule is set once when the
    // page settles, not restarted by every answer it receives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  /*
   * Forget the capability once it cannot answer anything new.
   *
   * It was kept for exactly one purpose — reading this order's state back —
   * and a secret held past its purpose is exposure for nothing (ADR-0056).
   */
  useEffect(() => {
    if (loaded && isTerminal(view)) forgetPaymentToken(orderNumber);
  }, [loaded, view, orderNumber]);

  const copy = de.checkout.result;
  const titles: Record<PaymentView, string> = {
    confirmed: copy.confirmedTitle,
    awaiting_confirmation: copy.awaitingTitle,
    needs_attention: copy.attentionTitle,
    expired: copy.expiredTitle,
    refunded: copy.refundedTitle,
    unknown: copy.unknownTitle,
  };
  const hints: Record<PaymentView, string> = {
    confirmed: copy.confirmedHint,
    awaiting_confirmation: copy.awaitingHint,
    needs_attention: copy.attentionHint,
    expired: copy.expiredHint,
    refunded: copy.refundedHint,
    unknown: copy.unknownHint,
  };

  const total =
    state && typeof state.total_amount !== "undefined"
      ? Number(state.total_amount)
      : Number.NaN;

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/5 p-5">
      <div>
        <h2 className="text-lg font-semibold">{loaded ? titles[view] : copy.checking}</h2>
        {loaded ? <p className="mt-1 text-sm text-on-deep-muted">{hints[view]}</p> : null}
      </div>

      <dl className="grid grid-cols-2 gap-y-1 text-sm">
        <dt className="text-on-deep-muted">{copy.orderNumber}</dt>
        <dd className="text-right font-semibold tabular-nums">{orderNumber}</dd>
        {Number.isFinite(total) ? (
          <>
            <dt className="text-on-deep-muted">{copy.total}</dt>
            <dd className="text-right font-semibold tabular-nums">{formatPrice(total)}</dd>
          </>
        ) : null}
      </dl>

      <div className="flex flex-wrap items-center gap-3">
        {view === "awaiting_confirmation" ? (
          <button
            type="button"
            onClick={() => void read()}
            disabled={busy}
            className="rounded-full border border-white/25 px-4 py-2 text-sm disabled:opacity-40"
          >
            {copy.refresh}
          </button>
        ) : null}
        <Link href="/" className="text-sm underline underline-offset-4">
          {copy.toCatalog}
        </Link>
      </div>
    </div>
  );
}
