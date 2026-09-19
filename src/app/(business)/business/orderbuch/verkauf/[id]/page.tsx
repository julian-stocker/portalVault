/**
 * One sale (ADR-0089).
 *
 * The financial breakdown lives in the Details overlay on the ledger; this is
 * the working surface for the GOODS — which physical figures the sale is for,
 * and whether they have left the shelf yet.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SaleItems } from "@/components/business/sale-items";
import { TestFlag } from "@/components/business/test-flag";
import { formatPrice } from "@/lib/format";
import { de } from "@/lib/i18n/de";
import { fetchOrderbookCatalog } from "@/lib/orderbook/queries";
import { fetchSale } from "@/lib/orderbook/sales-queries";
import { CHANNEL_LABELS, countryLabel, safeSalesBackHref } from "@/lib/orderbook/sales-view";

export const metadata: Metadata = { title: de.business.sales.title };
const copy = de.business.sales;

const formatDate = (iso: string | null): string =>
  iso === null ? copy.undated
    : new Date(iso).toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit", year: "numeric" });

export default async function SalePage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ zurueck?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const back = safeSalesBackHref(query.zurueck);
  const [detail, catalog] = await Promise.all([
    fetchSale(Number(id)), fetchOrderbookCatalog(),
  ]);
  if (!detail) notFound();

  const sale = (detail.sale ?? {}) as Record<string, unknown>;
  const order = detail.order as Record<string, unknown> | null;
  const items = (detail.items ?? []) as Record<string, unknown>[];
  const internal = order !== null;
  const historical = String(sale.source) === "excel_order_2026";
  /*
   * The classification, as the database decided it (0063) — the operator's own
   * flag for an external sale, `orders.commerce_mode` for an internal one.
   * Never worked out again here: two answers to one question is how they start
   * disagreeing.
   */
  const isTest = detail.is_test === true;
  const soldAt = internal ? (order?.paid_at as string | null) ?? null
                          : (sale.sold_at as string | null) ?? null;
  const subtotal = Number((internal ? order?.items_subtotal : sale.items_subtotal) ?? 0);
  const shipping = Number((internal ? order?.shipping_amount : sale.shipping_charged) ?? 0);
  const discount = Number((internal ? order?.discount_amount : sale.discount_amount) ?? 0);

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pt-8 pb-10 md:pt-12">
      <Link href={back} className="inline-flex min-h-11 items-center text-sm text-muted hover:text-fg">
        ← {copy.backToLedger}
      </Link>
      <p className="mt-2 text-xs text-muted">
        {copy.title} · {internal ? copy.tabs.internal : copy.tabs.external}
        {historical ? ` · ${copy.detailsModal.imported}` : ""}
      </p>
      <h1 className={`mt-1 text-2xl font-semibold tracking-tight md:text-3xl${
        soldAt === null ? " text-muted" : ""}`}>
        {formatDate(soldAt)}
      </h1>
      <p className="mt-1 text-sm text-muted">
        {internal ? String(order?.order_number ?? CHANNEL_LABELS.skyisles)
                  : CHANNEL_LABELS[String(sale.channel)] ?? String(sale.channel)}
        {sale.destination_country_code || order
          ? ` · ${countryLabel(String(sale.destination_country_code ?? ""))}` : ""}
      </p>

      {/*
        AN INTERNAL SALE GETS A SENTENCE, NOT A SWITCH.
        Its answer belongs to the order, and `orders.commerce_mode` is frozen
        when the order is placed — so there is nothing here to change and a
        control would only produce a refusal. An external sale gets the toggle.
      */}
      <div className="mt-2">
        {internal ? (
          isTest ? (
            <span title={de.business.orderbook.status.testTitle}
                  className="inline-block rounded-sky-md bg-surface px-2 py-0.5 text-xs font-medium text-muted ring-1 ring-border/70">
              {de.business.orderbook.status.testBadge} · {copy.testFromOrder}
            </span>
          ) : null
        ) : (
          <TestFlag kind="sale" id={Number(id)} isTest={isTest}
                    expectedUpdatedAt={(sale.updated_at as string) ?? null} />
        )}
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted">{copy.columns.sum}</dt>
          <dd className="ob-money tabular-nums">{formatPrice(subtotal)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{copy.columns.shipping}</dt>
          <dd className="ob-money tabular-nums">{formatPrice(shipping)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{copy.columns.discount}</dt>
          <dd className="ob-money tabular-nums">{formatPrice(discount)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{copy.summary.expected}</dt>
          <dd className="ob-money tabular-nums">
            {detail.expected_payout === null || detail.expected_payout === undefined
              ? "—" : formatPrice(Number(detail.expected_payout))}
          </dd>
        </div>
      </dl>

      {/*
        An internal sale shows the ORDER's lines; there is no second copy of
        them to manage. `SaleItems` renders them read-only in that case.
      */}
      <SaleItems saleId={Number(id)} catalog={catalog}
                 internal={internal} historical={historical}
                 items={internal
                   ? ((order?.lines ?? []) as Record<string, unknown>[]).map((l, i) => ({
                       id: l.id, position: i + 1, series_code: l.series_code,
                       name: l.name, raw_name: null, market_price: l.unit_price,
                       movement_id: 1, returned_at: null, return_movement_id: null,
                       sky_id: l.sky_id,
                     }))
                   : items} />
    </main>
  );
}
