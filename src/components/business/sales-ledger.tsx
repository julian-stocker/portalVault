"use client";

/**
 * The Verkauf ledger (ADR-0089).
 *
 * The Einkauf ledger's IMPLEMENTATION, not merely its shape. Every element
 * here comes from `ledger-table.tsx` and lands on `.ob-row` / `.ob-item` —
 * the same two rules the purchase ledger renders through, which are the rules
 * that demonstrably work in the owner's browser.
 *
 * The previous version had its own `.ob-sale` family mirroring `.ob-row`
 * faithfully, and it still rendered as one run-on line while Einkauf, from the
 * same stylesheet and the same layer, did not. A rule only one ledger depends
 * on is a rule that can go missing for only that ledger. So Verkauf no longer
 * has one: its ten tracks are an inline custom property on the container,
 * delivered in the same response as the markup.
 *
 * WHAT IS DIFFERENT, AND WHY
 *
 * Three extra columns that only a sale has: `Erwartet`, `Gemeldet` and `Δ`.
 * Payout reconciliation is the reason the owner wants to stop keeping the
 * spreadsheet, so all three sit in the collapsed row rather than behind a
 * click — and a missing reported payout reads `Offen`, never `0,00 €`.
 *
 * Ten columns do not fit a narrow window, so the ledger keeps its width and
 * scrolls sideways. Squeezing the table instead would cost the alignment that
 * is the entire point of a table.
 */

/*
 * The financial row, in the workbook's own order and under its own headings:
 * `Order 2026!T4` is literally `EU`, U `Summe`, V `Versand`, W `Rabatt`,
 * X+AA the fees, Y+Z the labels, AD `Refund`, AE `Auszahlung`.
 *
 * Datum · EU · Summe · Versand · Rabatt · Fees · Label · Refund · Auszahlung ·
 * Lager · Details
 *
 * `Fees` and `Label` are disjoint halves of the same fee table and arrive as
 * aggregates from `seller_sales()` (0062) — a label is never in both.
 */
const SALE_COLUMNS =
  "6rem 3rem minmax(5rem, 1fr) minmax(5rem, 1fr) minmax(5rem, 1fr) "
  + "minmax(5rem, 1fr) minmax(5rem, 1fr) minmax(5rem, 1fr) minmax(6.5rem, 1fr) 7.5rem 5.5rem";

/*
 * The item track list lives in `sale-indicator.tsx` and is shared with the
 * detail screen: seven cells, the Einkauf six with a narrow indicator in
 * front. One constant, both sale screens — the thing that produced two
 * different sale layouts in the first place.
 *
 * The four-column version this replaces folded `#` and `Serie` into the
 * figure cell's tooltip, where a phone could not reach them, and gave `Figur`
 * `minmax(9rem, 1fr)` inside a 71rem ledger — so it collected every bit of
 * slack and pushed status and action off the screen. What the owner saw was
 * a row of empty cells with a button at the end of it.
 */

/* 7.5rem wider than before: the Lager column carries words, not a tick. */
const SALE_MIN_WIDTH = "71rem";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";

import { formatPrice } from "@/lib/format";
import { SALE_ITEM_COLUMNS, SaleIndicator } from "./sale-indicator";
import { de } from "@/lib/i18n/de";
import { announceSaleItemReturn, bookSaleItem, loadSale, restockSaleItem, returnSaleItem }
  from "@/lib/orderbook/sales-actions";
import type { SaleRow, SalesSummary } from "@/lib/orderbook/sales-queries";
import {
  countryLabel, saleItemActions, saleStockStatus, saleItemIndicator, legacyOutcome,
  type LegacyOutcome,
} from "@/lib/orderbook/sales-view";

/** Outcome → the sentence the status dot reads out (0087). */
const LEGACY_LABEL: Record<LegacyOutcome, keyof typeof de.business.sales.itemIndicator> = {
  shipped: "legacyShipped",
  not_shipped: "legacyNotShipped",
  returned: "legacyReturned",
  lost: "legacyLost",
  shipped_unreferenced: "legacyShippedUnreferenced",
  unresolved: "legacyUnresolved",
};
import { SaleDetails } from "./sale-details";
import {
  LedgerExpansion, LedgerHead, LedgerItemHead, LedgerItemRow, LedgerRow, LedgerTable,
} from "./ledger-table";
import { RowMarks } from "./orderbook-nav";

const copy = de.business.sales;

const formatDate = (iso: string | null): string =>
  iso === null ? copy.undated
    : new Date(iso).toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit", year: "numeric" });

/**
 * The payout cell (ADR-0095).
 *
 * One number, computed. There used to be two — what the channel had reported
 * and what it should have paid — with `offen` standing in until somebody
 * typed the first. That reconciliation is gone: the payout is derived from
 * the sale's own figures by `sale_expected_payout()`, so there is nothing to
 * be pending about.
 */
/**
 * The stock column (0072).
 *
 * `Ausgebucht ✓` only where every position owns a `sale_external` movement.
 * A sale finished partly by settling says `Erledigt` and carries no tick:
 * it is done, and two of its pieces never left figure inventory.
 */
function Stock({ sale }: { sale: SaleRow }) {
  const status = saleStockStatus(sale);
  const c = copy.stock;
  const text = status === "outbooked" ? c.outbooked
    : status === "returned" ? c.returned
    : status === "closed" ? c.closed
    : status === "cancelled" ? c.cancelled
    : status === "frozen" ? c.frozen
    : status === "partial" ? `${sale.closedCount} von ${sale.itemCount}`
    : c.open;
  const title = status === "outbooked" ? c.outbookedHint
    : status === "returned" ? c.returnedHint
    : status === "closed" ? c.closedHint(sale.outbookedCount, sale.restockedCount,
                                         sale.settledCount, sale.notShippedCount)
    : status === "cancelled" ? c.cancelledHint
    : status === "frozen" ? c.frozenHint
    : status === "partial" ? c.partial
    : c.openHint;
  /* The tick belongs to the two states a real movement stands behind. */
  const strong = status === "outbooked" || status === "returned";
  return (
    <span className={"truncate text-xs " + (strong ? "text-fg" : "text-muted")}
          title={title} aria-label={title}>
      {text}
    </span>
  );
}

function Payout({ sale }: { sale: SaleRow }) {
  if (sale.expectedPayout === null) return <span className="text-xs text-muted">—</span>;
  return (
    <span className="ob-money tabular-nums" title={copy.summary.expected}>
      {formatPrice(sale.expectedPayout)}
    </span>
  );
}

function Summary({ summary }: { summary: SalesSummary }) {
  const cells = [
    { key: "count", label: copy.summary.count, value: summary.saleCount.toLocaleString("de-AT"),
      hint: `${summary.itemCount.toLocaleString("de-AT")} ${copy.summary.items}` },
    { key: "gross", label: copy.summary.gross, value: formatPrice(summary.gross), hint: null },
    { key: "expected", label: copy.summary.expected, value: formatPrice(summary.expectedPayout), hint: null },
  ];
  return (
    <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
      {cells.map((cell) => (
        <div key={cell.key} className="rounded-sky-md bg-surface/70 px-3 py-1.5 ring-1 ring-border/60">
          <dt className="text-xs leading-tight text-muted">{cell.label}</dt>
          <dd className="leading-tight tabular-nums">{cell.value}</dd>
          {cell.hint ? <dd className="text-xs leading-tight text-muted">{cell.hint}</dd> : null}
        </div>
      ))}
    </dl>
  );
}

type Detail = Record<string, unknown>;

export function SalesLedger({ sales, summary, backHref }: {
  sales: SaleRow[]; summary: SalesSummary; backHref: string;
}) {
  const [open, setOpen] = useState<ReadonlySet<number>>(
    () => new Set(sales.filter((s) => s.matchItems.length > 0).map((s) => s.id)));
  const [details, setDetails] = useState<Record<number, Detail | "failed">>({});
  /*
   * Which sale's breakdown is open. Separate from `open`, which is the item
   * list: the chevron and the Details button are two controls doing two
   * things, and neither may move the other.
   */
  const [showing, setShowing] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const loading = useRef<Set<number>>(new Set());

  const load = useCallback((id: number, force = false) => {
    if (loading.current.has(id)) return;
    loading.current.add(id);
    void loadSale(id).then((d) => {
      loading.current.delete(id);
      setDetails((current) => ({ ...current, [id]: d ?? "failed" }));
    });
    if (force) setDetails((current) => { const next = { ...current }; delete next[id]; return next; });
  }, []);

  /* Details reuses the same lazily-loaded payload the item list uses. */
  const onDetails = (id: number) => { setShowing(id); load(id); };

  const toggle = (id: number) => {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    if (!open.has(id)) load(id);
  };

  useEffect(() => {
    for (const id of open) load(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Never optimistic. The server decides, then the row is re-read. */
  const act = (id: number, run: () => Promise<{ ok: boolean; message?: string }>) => {
    setError(null);
    startTransition(async () => {
      const result = await run();
      if (!result.ok) { setError(result.message ?? null); return; }
      loading.current.delete(id);
      load(id, true);
    });
  };

  const showingSale = sales.find((s) => s.id === showing) ?? null;

  if (sales.length === 0) {
    return (<><Summary summary={summary} /><p className="mt-6 text-sm text-muted">{copy.empty}</p></>);
  }

  return (
    <>
      <Summary summary={summary} />
      {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}

      <LedgerTable columns={SALE_COLUMNS} itemColumns={SALE_ITEM_COLUMNS}
                   minWidth={SALE_MIN_WIDTH}>
        <LedgerHead>
          <span>{copy.columns.date}</span>
          <span>{copy.columns.country}</span>
          <span className="text-right">{copy.columns.sum}</span>
          <span className="text-right">{copy.columns.shipping}</span>
          <span className="text-right">{copy.columns.discount}</span>
          <span className="text-right">{copy.columns.fees}</span>
          <span className="text-right">{copy.columns.label}</span>
          <span className="text-right">{copy.columns.refund}</span>
          <span className="text-right">{copy.columns.payout}</span>
          <span className="text-center">{copy.columns.stock}</span>
          <span className="text-center">{copy.columns.details}</span>
        </LedgerHead>

        <ul className="divide-y divide-border/60">
          {sales.map((sale) => {
            const expanded = open.has(sale.id);
            const detail = details[sale.id];
            const gross = (sale.itemsSubtotal ?? 0) + (sale.shippingCharged ?? 0) - (sale.discountAmount ?? 0);
            return (
              <li key={sale.id}>
                <LedgerRow expanded={expanded} controls={`sale-${sale.id}`}
                           onToggle={() => toggle(sale.id)}
                           label={<>
                             {expanded ? copy.collapse : copy.expand} — {formatDate(sale.soldAt)}, {formatPrice(gross)}
                           </>}>
                  {/* Date, plus the row's classification marks — see `RowMarks`. */}
                  <span className={sale.soldAt === null ? "font-medium text-muted" : "font-medium tabular-nums"}>
                    {formatDate(sale.soldAt)}
                    <RowMarks isTest={sale.isTest} isIncomplete={sale.isIncomplete} isOpen={sale.isOpen} />
                  </span>
                  {/* `EU` in the workbook, and what it holds is the code. */}
                  <span className="truncate text-xs text-muted" title={countryLabel(sale.country)}>
                    {sale.country ?? "—"}
                  </span>
                  <span className="ob-money text-right tabular-nums">
                    {formatPrice(sale.itemsSubtotal ?? 0)}
                  </span>
                  <span className="ob-money text-right tabular-nums text-muted">
                    {formatPrice(sale.shippingCharged ?? 0)}
                  </span>
                  <span className="ob-money text-right tabular-nums text-muted">
                    {formatPrice(sale.discountAmount ?? 0)}
                  </span>
                  {/* Two disjoint halves: a shipping label is in Label, never
                      in Fees, so the pair is the whole cost of the sale. */}
                  <span className="ob-money text-right tabular-nums text-muted">
                    {formatPrice(sale.feesTotal)}
                  </span>
                  <span className="ob-money text-right tabular-nums text-muted">
                    {formatPrice(sale.labelTotal)}
                  </span>
                  <span className="ob-money text-right tabular-nums text-muted">
                    {formatPrice(sale.refunded)}
                  </span>
                  <span className="text-right"><Payout sale={sale} /></span>
                  <span className="text-center"><Stock sale={sale} /></span>
                  {/*
                    A REAL BUTTON, AND IT HAS TO OUTRANK THE ROW'S OVERLAY.

                    `z-20`, not `z-10`. The overlay that makes the whole row a
                    disclosure control carries `z-10` so it sits above the
                    sticky first column — and it comes LATER in the DOM, so at
                    equal z-index it wins and swallows this click. That is
                    exactly what happened: `Details` expanded the item list
                    instead of opening the dialog, and `stopPropagation` never
                    ran because the event never reached this button.
                  */}
                  <span className="relative z-20 text-center">
                    <button type="button"
                            onClick={(event) => { event.stopPropagation(); onDetails(sale.id); }}
                            className="min-h-9 rounded-sky-md px-2 text-xs text-muted ring-1 ring-border/70 hover:text-fg">
                      {copy.columns.details}
                    </button>
                  </span>
                </LedgerRow>

                {sale.matchItems.length > 0 ? (
                  <p className="truncate px-3 pb-1 text-xs text-muted">
                    {sale.matchItems.slice(0, 4).map((m) => `${m.position}. ${m.name}`).join(" · ")}
                  </p>
                ) : null}

                {expanded ? (
                  <LedgerExpansion id={`sale-${sale.id}`}>
                    {detail === undefined ? (
                      <p className="px-3 py-2 text-xs text-muted">{copy.loadingItems}</p>
                    ) : detail === "failed" ? (
                      <p className="px-3 py-2 text-xs text-muted">{copy.itemsFailed}</p>
                    ) : (
                      <SaleDetail sale={sale} detail={detail} pending={pending} act={act} />
                    )}
                    <div className="px-3 pt-1.5">
                      <Link href={`/business/orderbuch/verkauf/${sale.id}?zurueck=${encodeURIComponent(backHref)}`}
                            className="text-xs text-muted underline underline-offset-2">
                        {copy.detail}
                      </Link>
                    </div>
                  </LedgerExpansion>
                ) : null}
              </li>
            );
          })}
        </ul>
      </LedgerTable>

      {/*
        One dialog for the whole ledger, not one per row: a modal per sale
        would mount 293 portals to show none of them.
      */}
      {showingSale ? (
        <SaleDetails key={showingSale.id} sale={showingSale} detail={details[showingSale.id]}
                     open onClose={() => setShowing(null)}
                     onSaved={() => { loading.current.delete(showingSale.id); load(showingSale.id, true); }} />
      ) : null}
    </>
  );
}

/** The expanded body: items, money and the payout, in the order work happens. */
function SaleDetail({ sale, detail, pending, act }: {
  sale: SaleRow; detail: Detail; pending: boolean;
  act: (id: number, run: () => Promise<{ ok: boolean; message?: string }>) => void;
}) {
  const order = detail.order as Record<string, unknown> | null;
  const items = (detail.items ?? []) as Record<string, unknown>[];
  const lines = (order?.lines ?? []) as Record<string, unknown>[];
  const historical = String((detail.sale as Record<string, unknown>)?.source) === "excel_order_2026";

  return (
    <>
      {/*
        THE SAME SIX COLUMNS AN EXPANDED PURCHASE HAS, in the same order and
        from the same CSS rule. `Bestand` and `Retoure` stay merged into one
        status — that was right in 0075 and is unchanged — but `#` and `Serie`
        come back out of the tooltip and get the tracks they have next door.
      */}
      <LedgerItemHead>
        {/* No heading: the column is one glyph wide and the dot names
            itself through its aria-label. */}
        <span aria-hidden="true" />
        <span>#</span>
        <span>{copy.itemColumns.series}</span>
        <span>{copy.itemColumns.figure}</span>
        <span className="text-right">{copy.itemColumns.marketValue}</span>
        <span className="text-center">{copy.itemColumns.status}</span>
        <span className="text-right">{copy.itemColumns.action}</span>
      </LedgerItemHead>

      <ul className="divide-y divide-border/40">
        {/* An internal sale shows the ORDER's lines. There is no copy to show. */}
        {order
          ? lines.map((line, index) => (
              <LedgerItemRow key={String(line.id)}>
                {/* Commerce booked it when the order was paid: done. */}
                <SaleIndicator indicator={saleItemIndicator("outbooked", true)}
                               label={copy.itemIndicator.outbooked} />
                <span className="tabular-nums text-xs text-muted">{index + 1}</span>
                <span className="truncate text-xs text-muted">
                  {line.series_code ? String(line.series_code) : "—"}
                </span>
                <span className="break-words" title={String(line.name ?? "")}>
                  {String(line.quantity)}× {String(line.name ?? "")}
                </span>
                <span className="ob-money text-right tabular-nums">{formatPrice(Number(line.unit_price))}</span>
                {/* Commerce already moved the stock when the order was paid. */}
                <span className="text-center text-xs text-muted">{copy.itemStates.outbooked}</span>
                <span className="text-right text-xs text-muted">{copy.commerceOwned}</span>
              </LedgerItemRow>
            ))
          : items.map((item) => {
              const can = saleItemActions(item as never, {
                frozen: historical && sale.stockReleasedAt === null,
                cancelled: sale.cancelledAt !== null,
                shipped: sale.shippedAt !== null,
                historical,
              });
              const derived = can.status === "open" || can.status === "shipped"
              || can.status === "settled" || can.status === "not_shipped";
            const outcome = historical && derived ? legacyOutcome(item as never) : null;
              const id = Number(item.id);
              const strong = can.status === "outbooked" || can.status === "restocked";
              /*
               * The ledger's inline list offers the two actions that move
               * stock and the two that step a return along. Closing a
               * position without a movement is a decision, and decisions
               * belong on the detail screen where the whole sale is visible.
               */
              const primary: Partial<Record<string, () => void>> = {
                book: () => act(sale.id, () => bookSaleItem(id, sale.id)),
                announce_return: () => act(sale.id, () => announceSaleItemReturn(id, sale.id, true)),
                mark_returned: () => act(sale.id, () => returnSaleItem(id, sale.id, true)),
                restock: () => act(sale.id, () => restockSaleItem(id, sale.id)),
              };
              const run = can.primary ? primary[can.primary] : undefined;
              return (
                <LedgerItemRow key={String(item.id)}>
                  <SaleIndicator
                    indicator={saleItemIndicator(can.status, sale.shippedAt !== null,
                      { historical, outcome })}
                    label={outcome !== null
                      ? copy.itemIndicator[LEGACY_LABEL[outcome]]
                      : can.heldForReconciliation
                        ? copy.itemIndicator.legacyPending
                        : can.status === "outbooked" && sale.shippedAt === null
                          ? copy.itemIndicator.outbookedUnshipped
                          : copy.itemIndicator[can.status]} />
                  <span className="tabular-nums text-xs text-muted">
                    {item.position === null || item.position === undefined
                      ? "—" : String(item.position)}
                  </span>
                  {/* A dash for a non-figure: a portal has no Skylanders
                      series, and inventing one would be worse than a blank. */}
                  <span className="truncate text-xs text-muted">
                    {item.series_code ? String(item.series_code) : "—"}
                  </span>
                  <span className="break-words" title={String(item.name ?? item.raw_name ?? "")}>
                    {String(item.name ?? item.raw_name ?? "")}
                  </span>
                  <span className="ob-money text-right tabular-nums">
                    {item.market_price === null ? "—" : formatPrice(Number(item.market_price))}
                  </span>
                  <span className={`truncate text-center text-xs ${strong ? "text-fg" : "text-muted"}`}>
                    {copy.itemStates[can.status]}
                  </span>
                  <span className="text-right">
                    {/* Only what the server would accept. An impossible button
                        invites a click that ends in a rule the screen knew —
                        and, for imported history, one the database WOULD
                        accept but the reconciled stock must not see twice. */}
                    {can.heldForReconciliation ? (
                      <span className="text-xs text-muted"
                            title={copy.errors.heldForReconciliation}>
                        {copy.itemActionHeld}
                      </span>
                    ) : null}
                    {run ? (
                      <button type="button" disabled={pending} onClick={run}
                              className="min-h-9 rounded-sky-md px-2 text-xs ring-1 ring-border/70 disabled:opacity-50">
                        {copy.itemActionLabels[can.primary!]}
                      </button>
                    ) : null}
                  </span>
                </LedgerItemRow>
              );
            })}
      </ul>

    </>
  );
}
