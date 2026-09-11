import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AccountHeader } from "@/components/account/account-header";
import { fetchMyOrders } from "@/lib/account/orders";
import { currentProfile } from "@/lib/auth/profile";
import { ONBOARDING_PATH, SIGN_IN_PATH } from "@/lib/auth/redirect";
import { formatDate, formatPrice } from "@/lib/format";
import { de } from "@/lib/i18n/de";

export const metadata: Metadata = { title: de.account.orders.title };

/**
 * A customer's own orders.
 *
 * `my_orders()` and not a table read: `orders_select_own` has allowed this
 * since 0010, but a grant is column-blind, so reading the table would hand
 * the browser `client_hash`, `payment_token_hash` and `request_id` along with
 * it. The same reasoning that made `shop_offers()` a function (ADR-0043).
 *
 * Guest orders are deliberately absent — they have no `user_id` to match, and
 * inventing a match on the e-mail address would make an address into a
 * credential (ADR-0032).
 */
export default async function MyOrdersPage() {
  const profile = await currentProfile();
  if (!profile) redirect(SIGN_IN_PATH);
  if (!profile.username) redirect(ONBOARDING_PATH);

  const orders = await fetchMyOrders();
  const copy = de.account.orders;

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 pt-8 pb-10 md:pt-12">
      <AccountHeader title={copy.title} hint={copy.hint} />

      {orders.length === 0 ? (
        <section className="rounded-sky-lg bg-surface/80 p-5 ring-1 ring-border/70">
          <p className="font-medium">{copy.empty}</p>
          <p className="mt-1 text-sm text-muted">{copy.emptyHint}</p>
        </section>
      ) : (
        <ul className="flex flex-col gap-2">
          {orders.map((order) => (
            <li key={order.orderNumber}>
              <Link
                href={`/account/orders/${order.orderNumber}`}
                className="block rounded-sky-lg bg-surface/80 px-5 py-4 ring-1 ring-border/70 hover:ring-border-strong"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="font-medium tabular-nums">
                    {order.orderNumber}
                    {/* A test order stays marked as one for ever (ADR-0060). */}
                    {order.commerceMode === "sandbox" ? (
                      <span className="ml-2 rounded-sky-sm bg-accent/20 px-1.5 py-0.5 align-middle text-[0.65rem] tracking-wide">
                        {copy.testBadge}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-sm font-semibold tabular-nums">
                    {formatPrice(order.totalAmount)}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-baseline gap-x-3 text-sm text-muted">
                  <span>{formatDate(order.placedAt)}</span>
                  <span>{copy.articles(order.lineCount)}</span>
                  <span>{de.account.orders.statusLabel[order.status] ?? order.status}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted">{copy.guestNote}</p>
    </main>
  );
}
