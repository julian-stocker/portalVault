/**
 * One purchase (ADR-0088).
 *
 * The header carries the three numbers the operator judges a parcel by —
 * Ausgaben, Marktwert, Faktor — and says out loud when the market value is
 * incomplete, because a factor computed over part of a parcel is a different
 * claim from one computed over all of it.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PurchaseDate } from "@/components/business/purchase-date";
import { PurchaseItems } from "@/components/business/purchase-items";
import { TestFlag } from "@/components/business/test-flag";
import { formatPrice } from "@/lib/format";
import { de } from "@/lib/i18n/de";
import { AddPurchaseItem } from "@/components/business/add-purchase-item";
import { isHistorical } from "@/lib/orderbook/purchase";
import { safeBackHref } from "@/lib/orderbook/ledger";
import { fetchOrderbookCatalog, fetchPurchase } from "@/lib/orderbook/queries";

export const metadata: Metadata = { title: de.business.orderbook.title };
const copy = de.business.orderbook;

export default async function PurchasePage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ zurueck?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  /*
   * WHY THIS EXISTS. The ledger is now the primary way to read a purchase, and
   * this page is reached from it, from a bookmark or from a direct link. Until
   * now it had no way back at all — the operator's only exit was the browser
   * button, which a freshly opened link does not have.
   *
   * `zurueck` carries the whole view home: year, month and search. It is
   * validated rather than trusted, because it arrives from the URL.
   */
  const back = safeBackHref(query.zurueck);
  const [purchase, catalog] = await Promise.all([fetchPurchase(Number(id)), fetchOrderbookCatalog()]);
  if (!purchase) notFound();

  const incomplete = purchase.countedItems - purchase.knownItems;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pt-8 pb-10 md:pt-12">
      <Link href={back} className="inline-flex min-h-11 items-center text-sm text-muted hover:text-fg">
        ← {copy.back}
      </Link>
      <p className="mt-2 text-xs text-muted">
        {copy.title} · {copy.tabs.purchase} ·{" "}
        {copy.sources[purchase.source as keyof typeof copy.sources] ?? purchase.source}
      </p>
      {/*
        The heading IS the date, so an undated purchase says so in words rather
        than showing 01.01.1970 or an empty line that reads as a broken page.
      */}
      <h1 className={`mt-1 text-2xl font-semibold tracking-tight md:text-3xl${
        purchase.purchasedAt === null ? " text-muted" : ""}`}>
        {purchase.purchasedAt === null
          ? copy.undated
          : new Date(purchase.purchasedAt).toLocaleDateString("de-AT")}
      </h1>
      <div className="mt-1 flex flex-wrap items-center gap-x-4">
        <PurchaseDate purchaseId={purchase.id} purchasedAt={purchase.purchasedAt} />
        {/*
          The classification, correctable here (0063). One boolean: it moves
          the purchase between lists and between summaries and touches nothing
          about the parcel — not the cost, not an item, and never stock.
        */}
        <TestFlag kind="purchase" id={purchase.id} isTest={purchase.isTest} />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted">{copy.columns.expenses}</dt>
          <dd className="tabular-nums">{formatPrice(purchase.totalCost)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{copy.columns.marketValue}</dt>
          <dd className="tabular-nums">
            {purchase.knownItems ? formatPrice(purchase.knownValue) : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{copy.columns.factor}</dt>
          <dd className="tabular-nums">
            {purchase.factor === null
              ? "—"
              : purchase.factor.toLocaleString("de-AT", { minimumFractionDigits: 2 })}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{copy.columns.progress}</dt>
          <dd className="tabular-nums">
            {isHistorical(purchase.source)
              ? copy.historical
              : copy.progress(purchase.bookedItems, purchase.countedItems)}
          </dd>
        </div>
      </dl>

      {purchase.factor !== null ? (
        <p className="mt-1 text-sm text-muted">
          {copy.percentOfMarket(Math.round(purchase.factor * 1000) / 10)}
        </p>
      ) : (
        <p className="mt-1 text-sm text-muted">{copy.noValue}</p>
      )}
      {incomplete > 0 ? (
        <p className="mt-1 text-xs text-muted">{copy.incomplete(incomplete)}</p>
      ) : null}

      <PurchaseItems purchaseId={purchase.id} source={purchase.source}
                     items={purchase.items} catalog={catalog} />
      {purchase.source === "manual" ? (
        <AddPurchaseItem purchaseId={purchase.id} catalog={catalog} />
      ) : null}
    </main>
  );
}
