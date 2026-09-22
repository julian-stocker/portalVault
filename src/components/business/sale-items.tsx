/**
 * The items of one external sale, and the one action that moves stock.
 *
 * CREATING A SALE IS NOT A STOCK MOVEMENT, AND THIS IS WHERE THAT BECOMES
 * VISIBLE. An item sits here as "sold, still on the shelf" until somebody
 * presses `Ausbuchen`, which is the only control on this screen that touches
 * inventory. It goes through `seller_book_sale_item`, which writes the
 * canonical `-1 sale_external` movement through the ledger — never a quantity
 * update — and refuses when the stock is not free, so a reserved unit cannot
 * be sold out from under a shop order.
 *
 * `Ausbuchen` is also where the two snapshots freeze: the sale's Buy-In factor
 * and the item's market price. Neither is taken at creation, because neither
 * is true until the goods actually leave.
 *
 * NEVER OPTIMISTIC. Every button waits for the database. A stock movement is
 * money; a row that says `Ausgebucht` before the ledger agrees is a lie that
 * costs a stocktake to find.
 */
"use client";

import { useState, useTransition } from "react";

import { ACTION_NEUTRAL, ACTION_PRIMARY } from "@/components/ui/action";
import { formatPrice } from "@/lib/format";
import { de } from "@/lib/i18n/de";
import {
  addSaleItem, announceSaleItemReturn, bookSaleItem, receiveSaleItemReturn, removeSaleItem,
  restockSaleItem, shipSaleItem,
  returnSaleItem, setSaleItemNotShipped, setSaleItemSky, settleSaleItem,
} from "@/lib/orderbook/sales-actions";
import {
  legacyOutcome, saleItemActions, saleItemEdits, saleItemIndicator, type LegacyOutcome,
} from "@/lib/orderbook/sales-view";
import { SALE_ITEM_COLUMNS, SaleIndicator } from "./sale-indicator";
import type { FigureChoice } from "@/lib/orderbook/figure-search";
import { FigureSearch } from "./figure-search";
import {
  LedgerItemHead, LedgerItemRow, LedgerTable,
} from "./ledger-table";

const copy = de.business.sales;

/** Outcome → the sentence the status dot reads out. */
const LEGACY_LABEL: Record<LegacyOutcome, keyof typeof de.business.sales.itemIndicator> = {
  shipped: "legacyShipped",
  not_shipped: "legacyNotShipped",
  returned: "legacyReturned",
  lost: "legacyLost",
  shipped_unreferenced: "legacyShippedUnreferenced",
  unresolved: "legacyUnresolved",
};

const book = de.business.orderbook;

/*
 * The track list comes from `sale-indicator.tsx` and is shared with the
 * ledger's expansion, so the two sale screens cannot drift apart. It is the
 * Einkauf list with one narrow cell in front — see SALE_ITEM_COLUMNS.
 *
 * The floor is the one number this screen owns, because it has no ledger
 * around it to inherit a width from. The six fixed tracks, the six gaps and
 * the padding come to 37.75rem; 46 leaves `Figur` a little over 8rem, which
 * is about twenty characters — the readable minimum `mobile-layout.test.ts`
 * holds every item table to.
 */
const ITEM_MIN_WIDTH = "46rem";

export function SaleItems({ saleId, items, catalog, historical, internal,
                           frozen, cancelled, shipped = false }: {
  saleId: number;
  items: Record<string, unknown>[];
  catalog: readonly FigureChoice[];
  historical: boolean;
  /** A workbook sale nobody released. Narrower than `historical` (0071). */
  frozen?: boolean;
  /** The order was called off. */
  cancelled?: boolean;
  /** The order went out — a sale fact, which is why it arrives from above. */
  shipped?: boolean;
  internal: boolean;
}) {
  /** The line whose figure is being corrected, by item id. One at a time. */
  const [remapping, setRemapping] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const act = (run: () => Promise<{ ok: boolean; message?: string }>) => {
    setError(null);
    startTransition(async () => {
      const result = await run();
      if (!result.ok) setError(result.message ?? null);
    });
  };

  return (
    <section className="mt-6">
      <h2 className="text-sm font-medium">{book.itemColumns.figure}</h2>
      {error ? (
        <p role="alert" className="mt-2 rounded-sky-md bg-surface px-3 py-2 text-sm ring-1 ring-border/70">
          {error}
        </p>
      ) : null}

      <LedgerTable itemColumns={SALE_ITEM_COLUMNS} minWidth={ITEM_MIN_WIDTH}>
        <LedgerItemHead>
          {/*
            THE SAME SIX COLUMNS AN EXPANDED PURCHASE HAS. `Bestand` and
            `Retoure` stay merged into one status — a row could otherwise
            read `Ausgebucht` and `Wieder eingelagert` at once and leave the
            reader to work out which was true now — and `#` and `Serie` have
            their own tracks instead of hiding in the figure cell's tooltip,
            where a phone cannot reach them.
          */}
          {/* The indicator column has no heading: a word would be wider
              than the column and would claim to be the status, which is
              five columns along and spelled out. The dot names itself
              through its aria-label. */}
          <span aria-hidden="true" />
          <span>#</span>
          <span>{book.itemColumns.series}</span>
          <span>{copy.itemColumns.figure}</span>
          <span className="text-right">{copy.itemColumns.marketValue}</span>
          <span className="text-center">{copy.itemColumns.status}</span>
          <span className="text-right">{copy.itemColumns.action}</span>
        </LedgerItemHead>

        <ul className="divide-y divide-border/40">
          {items.length === 0 ? (
            <li className="px-3 py-3 text-sm text-muted">{copy.noItems}</li>
          ) : items.map((item) => {
            const can = saleItemActions(item as never, {
              frozen: frozen ?? historical, cancelled: cancelled ?? false, shipped,
              historical,
            });
            /*
             * What the workbook recorded for this line. It decides the status
             * of an imported row outright — `settled_at` is our bookkeeping,
             * not a statement about the object (0087).
             */
            const derived = can.status === "open" || can.status === "shipped"
              || can.status === "settled" || can.status === "not_shipped";
            const outcome = historical && derived ? legacyOutcome(item as never) : null;
            const edits = saleItemEdits(item as never, { historical, internal });
            const itemId = Number(item.id);
            const id = Number(item.id);
            /* One label per state, and the tick only where a movement is. */
            const strong = can.status === "outbooked" || can.status === "restocked";
            const run = (fn: () => Promise<unknown>) => () => act(fn as never);
            const primary: Record<string, () => void> = {
              ship: run(() => shipSaleItem(id, saleId)),
              book: run(() => bookSaleItem(id, saleId)),
              announce_return: run(() => announceSaleItemReturn(id, saleId, true)),
              /* „Bestätigen": Wareneingang und Einbuchung in einem Aufruf (0092). */
              mark_returned: run(() => receiveSaleItemReturn(id, saleId)),
              restock: run(() => restockSaleItem(id, saleId)),
              settle: run(() => settleSaleItem(id, saleId, true)),
              unsettle: run(() => settleSaleItem(id, saleId, false)),
              unmark_not_shipped: run(() => setSaleItemNotShipped(id, saleId, false)),
            };
            const quiet = can.primary === "unsettle" || can.primary === "unmark_not_shipped"
              || can.primary === "announce_return";
            return (
              <LedgerItemRow key={String(item.id)}>
                <SaleIndicator
                  indicator={saleItemIndicator(can.status, shipped, { historical, outcome })}
                  label={outcome !== null
                    ? copy.itemIndicator[LEGACY_LABEL[outcome]]
                    : can.heldForReconciliation
                      ? copy.itemIndicator.legacyPending
                      : can.status === "outbooked" && !shipped
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
                  {item.market_price === null || item.market_price === undefined
                    ? "—" : formatPrice(Number(item.market_price))}
                </span>
                <span className={`truncate text-center text-xs ${strong ? "text-fg" : "text-muted"}`}
                      title={can.status === "settled" ? copy.settleHint
                        : can.status === "not_shipped" ? copy.notShippedItemHint : undefined}>
                  {outcome !== null ? copy.legacyStates[outcome] : copy.itemStates[can.status]}
                </span>
                <span className="flex flex-wrap justify-end gap-2 text-right">
                  {/* Only what the server would accept. An impossible button
                      invites a click that ends in a rule the screen knew. */}
                  {/* Held, not refused: the database would accept it, and
                      the reconciled stock already contains its effect. */}
                  {can.heldForReconciliation ? (
                    <span className="text-xs text-muted" title={copy.errors.heldForReconciliation}>
                      {copy.itemActionHeld}
                    </span>
                  ) : null}
                  {can.primary ? (
                    <button type="button" disabled={pending} onClick={primary[can.primary]}
                            className={quiet
                              ? "min-h-9 px-2 text-xs text-muted underline underline-offset-2 disabled:opacity-50"
                              : `${can.primary === "book" || can.primary === "ship"
                                    ? ACTION_PRIMARY : ACTION_NEUTRAL} min-h-9 w-auto px-2 text-xs disabled:opacity-50`}>
                      {copy.itemActionLabels[can.primary]}
                    </button>
                  ) : null}
                  {/* The one secondary: a parcel can go out without a piece
                      in it, and then nothing is booked because nothing left. */}
                  {can.canNotShip ? (
                    <button type="button" disabled={pending} title={copy.notShippedItemHint}
                            onClick={() => act(() => setSaleItemNotShipped(id, saleId, true))}
                            className="min-h-9 px-2 text-xs text-muted underline underline-offset-2 disabled:opacity-50">
                      {copy.markNotShippedItem}
                    </button>
                  ) : null}
                  {/* A line that never left the shelf may simply be wrong:
                      the wrong figure, or one figure too many. Both are gone
                      the moment it is booked out — from then on the ledger
                      describes it and only a return or a correction may. */}
                  {edits.canRemap ? (
                    <button type="button" disabled={pending}
                            aria-expanded={remapping === itemId}
                            onClick={() => setRemapping(remapping === itemId ? null : itemId)}
                            className="min-h-9 text-xs text-muted underline underline-offset-2 disabled:opacity-50">
                      {copy.changeFigure}
                    </button>
                  ) : null}
                  {edits.canRemove ? (
                    <button type="button" disabled={pending}
                            onClick={() => act(() => removeSaleItem(itemId, saleId))}
                            className="min-h-9 text-xs text-muted underline underline-offset-2 disabled:opacity-50">
                      {copy.detailsModal.remove}
                    </button>
                  ) : null}
                </span>
              </LedgerItemRow>
            );
          })}
        </ul>
      </LedgerTable>

      {/*
        The correction panel, below the table rather than inside a row: the
        item list is a grid with fixed columns and a search box does not fit
        one. It names the line it belongs to, so there is no doubt which.
      */}
      {remapping !== null ? (() => {
        const target = items.find((i) => Number(i.id) === remapping);
        const name = String(target?.name ?? target?.raw_name ?? "");
        return (
          <div className="mt-3 rounded-sky-lg bg-surface/60 p-3 ring-1 ring-border/70">
            <p className="mb-1 text-xs text-muted">{copy.changeFigureOne(name)}</p>
            <FigureSearch
              catalog={catalog}
              autoFocus
              disabled={pending}
              label={copy.changeFigureOne(name)}
              onCancel={() => setRemapping(null)}
              onSelect={(choice) => act(async () => {
                const r = await setSaleItemSky(remapping, choice.skyId, saleId);
                if (r.ok) setRemapping(null);
                return r;
              })}
            />
          </div>
        );
      })() : null}

      {/*
        An internal sale takes its items from the order — the database refuses
        to add one — and a historical sale is a reconstruction, not a workbench.
      */}
      {internal || historical ? (
        <p className="mt-2 text-xs text-muted">
          {internal ? copy.commerceOwned : copy.detailsModal.imported}
        </p>
      ) : (
        <div className="mt-3 rounded-sky-lg bg-surface/60 p-3 ring-1 ring-border/70">
          <p className="mb-1 text-xs text-muted">{copy.itemSearch}</p>
          {/* The same picker the create form and the Einkauf use. Selecting a
              result adds ONE physical unit; the same figure may be added
              again, because two copies are two objects. */}
          <FigureSearch
            catalog={catalog}
            disabled={pending}
            onSelect={(choice) => act(() => addSaleItem(saleId, choice.skyId, null, "loose"))}
          />
          <p className="mt-2 text-xs text-muted">{copy.create.stockHint}</p>
        </div>
      )}

    </section>
  );
}
