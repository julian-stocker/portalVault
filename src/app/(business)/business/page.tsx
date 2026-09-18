import type { Metadata } from "next";
import Link from "next/link";

import { fetchOpenOrderCounts } from "@/lib/admin/order-queries";
import { hasOpenWork } from "@/lib/admin/orders";
import { fetchShopYearToDate } from "@/lib/admin/shop-kpi";
import { formatNumber, formatPrice } from "@/lib/format";
import { fetchSellerPublic } from "@/lib/shop/seller";
import { de } from "@/lib/i18n/de";

export const metadata: Metadata = { title: de.business.title };

/**
 * The shop's management home (ADR-0080).
 *
 * Built like "Mein Konto": cards with a title, one sentence and a
 * destination. It answers "what can I manage in my shop?" and then gets out of
 * the way — the individual fields belong to the area that owns them, not to a
 * dashboard that would otherwise become a form with forty inputs.
 *
 * Until now this page WAS the shop: four panels stacked under two links, so
 * the seller's legal address sat two scrolls under the order count and the
 * shipping countries were somewhere in between. Everything on it still exists;
 * it moved to the page whose subject it is.
 *
 * NO RATINGS CARD. The operator wants seller ratings later, and there is no
 * schema, no data and no page behind them. `site-footer.tsx` settled this rule
 * for the product already: a dead link is worse than a missing one. The
 * section is recorded in ADR-0080 instead of drawn here.
 */
const AREAS: readonly { href: string; copy: { title: string; hint: string } }[] = [
  { href: "/business/profile", copy: de.business.areas.profile },
  { href: "/business/offers", copy: de.business.areas.offers },
  { href: "/business/inventory", copy: de.business.areas.inventory },
  { href: "/business/orders", copy: de.business.areas.orders },
  { href: "/business/shipping", copy: de.business.areas.shipping },
  { href: "/business/legal", copy: de.business.areas.legal },
  { href: "/business/reports", copy: de.business.areas.reports },
  { href: "/business/widerrufe", copy: de.business.areas.withdrawals },
  { href: "/business/inventory/import", copy: de.business.areas.imports },
];

export default async function BusinessPage() {
  // Memoised per request — the layout above already counted these rows.
  const [openOrders, seller, year] = await Promise.all([
    fetchOpenOrderCounts(),
    fetchSellerPublic(),
    // One aggregate, in parallel with the rest. The shop's navigation never
    // waits on a year of orders because it never asks for them (ADR-0081).
    fetchShopYearToDate(),
  ]);
  const orders = de.admin.orders;
  const flagged = openOrders.needsResolution > 0;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pt-8 pb-10 md:pt-12">
      {/*
       * Title and year side by side on a wide screen, stacked on a phone.
       * The numbers are status, not a destination — quieter than the six cards
       * below, which are what this page is for (ADR-0081).
       */}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{de.business.title}</h1>
          {/* The shop names itself from seller data; the account's username is
              a personal handle and never stands in for it (ADR-0080). */}
          <p className="mt-2 text-sm text-muted">
            {seller ? seller.displayName : de.business.hint}
          </p>
        </div>

        <dl className="flex shrink-0 flex-wrap gap-3">
          <div className="rounded-sky-md bg-surface/60 px-4 py-3 ring-1 ring-border/60">
            <dt className="text-xs text-muted">{de.business.ytdOrders}</dt>
            {/* `tabular-nums` so the two cards keep their width while the
                numbers change. */}
            <dd className="mt-0.5 text-xl font-semibold tabular-nums">
              {formatNumber(year.orderCount)}
            </dd>
          </div>
          <div className="rounded-sky-md bg-surface/60 px-4 py-3 ring-1 ring-border/60">
            <dt className="text-xs text-muted">{de.business.ytdOrderValue}</dt>
            <dd className="mt-0.5 text-xl font-semibold tabular-nums">
              {formatPrice(year.orderValue)}
            </dd>
          </div>
        </dl>
      </div>

      {/* What the two numbers leave out, said once rather than guessed at. */}
      <p className="mt-2 text-xs text-muted">{de.business.ytdHint}</p>

      {/*
       * Work first, and only when there is any. A flagged order is paid, has
       * booked no stock and cannot ship (ADR-0050) — the one thing on this
       * page worth interrupting for.
       */}
      {hasOpenWork(openOrders) ? (
        <Link
          href="/business/orders?open=1"
          className={
            "mt-6 block rounded-sky-lg bg-surface/80 px-5 py-4 hover:ring-border-strong " +
            (flagged ? "ring-2 ring-danger/70" : "ring-1 ring-border/70")
          }
        >
          <span className="text-sm">
            {flagged ? (
              <span className="font-semibold text-danger">
                {orders.needsResolutionCount(openOrders.needsResolution)}
              </span>
            ) : null}
            {flagged && openOrders.toShip > 0 ? <span className="text-muted"> · </span> : null}
            {openOrders.toShip > 0 ? (
              <span className={flagged ? "text-muted" : "font-medium text-foreground"}>
                {orders.toShipCount(openOrders.toShip)}
              </span>
            ) : null}
            {openOrders.inFlight > 0 ? (
              <span className="text-muted"> · {orders.inFlightCount(openOrders.inFlight)}</span>
            ) : null}
          </span>
        </Link>
      ) : null}

      <nav className="mt-6 grid gap-3 sm:grid-cols-2" aria-label={de.business.title}>
        {AREAS.map((area) => (
          <Link
            key={area.href}
            href={area.href}
            className="rounded-sky-lg bg-surface/80 px-5 py-4 ring-1 ring-border/70 hover:ring-border-strong"
          >
            <span className="block font-medium">{area.copy.title}</span>
            <span className="mt-1 block text-sm text-muted">{area.copy.hint}</span>
          </Link>
        ))}
      </nav>
    </main>
  );
}
