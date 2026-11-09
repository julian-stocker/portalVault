import type { Metadata } from "next";
import Link from "next/link";

import { NewSale, type ReportEntry } from "@/components/business/new-sale";
import { de } from "@/lib/i18n/de";
import { fetchOrderbookCatalog } from "@/lib/orderbook/queries";
import { parseReturn, returnHref, type ReturnTarget } from "@/lib/reconciliation/routes";
import { attachOrderContext, fetchReconciliationSessionAll } from "@/lib/reconciliation/server/queries";

export const metadata: Metadata = { title: de.business.sales.create.title };
const t = de.business.sales.create.fromReport;

/**
 * Where the form came from, when it came from the CSV reconciliation (0184):
 * the unmatched order, read HERE from the stored session — never from the
 * address bar, which only names the session and the card. `exists`: a sale
 * already carries the order's number (the number decides, not the date).
 */
type FromReport =
  | { kind: "entry"; entry: ReportEntry }
  | { kind: "exists"; back: ReturnTarget; saleId: number }
  | { kind: "unusable"; back: ReturnTarget }
  | null;

async function fromReport(back: ReturnTarget | null): Promise<FromReport> {
  if (back === null) return null;
  const result = await fetchReconciliationSessionAll(back.sessionId);
  if (result.status !== "ok") return { kind: "unusable", back };
  const match = result.matches.find((m) => m.id === back.matchId);
  if (!match || match.category !== "external_only" || match.sale !== null || match.order === null) {
    return { kind: "unusable", back };
  }
  const [known] = await attachOrderContext(result.page.session.channel, [match]);
  if (typeof known.createdSaleId === "number") return { kind: "exists", back, saleId: known.createdSaleId };
  const o = match.order;
  return {
    kind: "entry",
    entry: {
      back, orderRef: o.orderRef, soldAt: o.soldOn, country: o.destinationCountry,
      subtotal: o.itemsValue, shipping: o.shipping,
      lines: (o.lines ?? []).map((l) => ({ name: l.name, quantity: l.quantity, unitPrice: l.unitPrice })),
    },
  };
}

/** `?test=1` when the form was opened from the Test view. A default, not a lock. */
export default async function NewSalePage({ searchParams }: {
  searchParams: Promise<{ test?: string; abgleich?: string; bestellung?: string; ansicht?: string }>;
}) {
  /* The catalog ships with the page, as it does on every other figure
     screen: one query here rather than one per keystroke on a phone. */
  const [query, catalog] = await Promise.all([searchParams, fetchOrderbookCatalog()]);
  const from = await fromReport(parseReturn(query));
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pt-8 pb-10 md:pt-12">
      {from ? (
        <Link href={returnHref(from.kind === "entry" ? from.entry.back : from.back)} data-back-to-reconciliation=""
              className="inline-flex min-h-11 items-center text-sm text-muted hover:text-fg">
          ← {de.business.reconciliation.result.backToReconciliation}
        </Link>
      ) : (
        <Link href="/business/orderbuch/verkauf?bereich=extern"
              className="inline-flex min-h-11 items-center text-sm text-muted hover:text-fg">
          ← {de.business.sales.backToLedger}
        </Link>
      )}
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">
        {de.business.sales.create.title}
      </h1>
      {from?.kind === "exists" ? (
        <p role="status" data-sale-exists={from.saleId} className="mt-4 text-sm">
          {t.exists(from.saleId)}{" "}
          <Link href={`/business/orderbuch/verkauf/${from.saleId}`} className="underline underline-offset-2">{t.openExisting}</Link>
        </p>
      ) : (
        <>
          {from?.kind === "unusable" ? <p role="status" data-report-unusable="" className="mt-4 text-sm text-muted">{t.notUsable}</p> : null}
          <NewSale defaultTest={query.test === "1"} catalog={catalog}
                   fromReport={from?.kind === "entry" ? from.entry : null} />
        </>
      )}
    </main>
  );
}
