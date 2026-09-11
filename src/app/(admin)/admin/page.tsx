import type { Metadata } from "next";
import Link from "next/link";

import { BusinessSettings } from "@/components/admin/business-settings";
import { ShopSettings } from "@/components/admin/shop-settings";
import { fetchBusinessSettings } from "@/lib/admin/business";
import { fetchShopSettings } from "@/lib/admin/inventory";
import { fetchOpenOrderCounts } from "@/lib/admin/order-queries";
import { hasOpenWork } from "@/lib/admin/orders";
import { fetchAdminCategories } from "@/lib/admin/queries";
import { de } from "@/lib/i18n/de";

export const metadata: Metadata = { title: de.admin.title };

/**
 * The way in.
 *
 * Deliberately thin: two links, the one number that says whether the
 * classification is finished, and the one setting that prices the whole shop
 * (ADR-0045). Still not a dashboard — everything here is either a way in or
 * a thing to change.
 */
export default async function AdminPage() {
  const [categories, settings, openOrders, business] = await Promise.all([
    fetchAdminCategories(),
    fetchShopSettings(),
    // Memoised per request — the layout above already counted these rows.
    fetchOpenOrderCounts(),
    fetchBusinessSettings(),
  ]);
  const unclassified = categories.filter((c) => c.catalogGroup === null && c.figures > 0);
  const copy = de.admin.orders;
  const flagged = openOrders.needsResolution > 0;

  return (
    <main className="mx-auto w-full max-w-4xl px-4 pt-8 pb-6 md:pt-12">
      <h1 className="text-3xl font-semibold tracking-tight">{de.admin.title}</h1>

      <div className="mt-8 flex flex-col gap-3">
        <Link
          href="/admin/orders?open=1"
          className={
            "rounded-sky-lg bg-surface/80 px-5 py-4 hover:ring-border-strong " +
            // The same three-level tone the order list uses, so the two agree
            // about what is loud: only a flagged order raises its voice.
            (flagged ? "ring-2 ring-danger/70" : "ring-1 ring-border/70")
          }
        >
          <span className="font-medium">{copy.title}</span>
          {/*
           * The two numbers, on the page the operator opens first (F5).
           *
           * Counted from rows `admin_orders(p_open_only => true)` already
           * returns — no second query, no aggregate, nothing that polls. Until
           * now a flagged order was discoverable only by opening the list on a
           * hunch, and a flagged order is one where money has arrived, nothing
           * was booked and shipping is locked (ADR-0050).
           */}
          <span className="mt-1 block text-sm">
            {hasOpenWork(openOrders) ? (
              <>
                {flagged ? (
                  <span className="font-semibold text-danger">
                    {copy.needsResolutionCount(openOrders.needsResolution)}
                  </span>
                ) : null}
                {flagged && openOrders.toShip > 0 ? (
                  <span className="text-muted"> · </span>
                ) : null}
                {openOrders.toShip > 0 ? (
                  <span className={flagged ? "text-muted" : "font-medium text-accent"}>
                    {copy.toShipCount(openOrders.toShip)}
                  </span>
                ) : null}
              </>
            ) : (
              <span className="text-muted">{copy.nothingOpen}</span>
            )}
          </span>
          <span className="mt-1 block text-sm text-muted">{copy.linkHint}</span>
        </Link>

        <Link
          href="/admin/catalog"
          className="rounded-sky-lg bg-surface/80 px-5 py-4 ring-1 ring-border/70 hover:ring-border-strong"
        >
          <span className="font-medium">{de.admin.catalog}</span>
          <span className="mt-1 block text-sm text-muted">
            Sichtbarkeit, Anzeigenamen und interne Notizen je Figur.
          </span>
        </Link>

        <Link
          href="/admin/catalog/categories"
          className="rounded-sky-lg bg-surface/80 px-5 py-4 ring-1 ring-border/70 hover:ring-border-strong"
        >
          <span className="font-medium">{de.admin.categories}</span>
          <span className="mt-1 block text-sm text-muted">
            {categories.length} Kategorien
            {unclassified.length > 0
              ? ` · ${unclassified.length} ohne Produktgruppe`
              : " · alle klassifiziert"}
          </span>
        </Link>
      </div>

      {/* Who SkyIsles is, before what it charges: the contact address feeds
          every customer mail and later the legal pages (ADR-0059). */}
      <div className="mt-8">
        <BusinessSettings contactEmail={business.contactEmail} replyTo={business.replyTo} />
      </div>

      <div className="mt-8">
        <ShopSettings percentage={settings.pricePercentage} />
      </div>

      <p className="mt-8 text-sm text-muted">{de.admin.completionNote}</p>
    </main>
  );
}
