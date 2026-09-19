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
  addSaleItem, bookSaleItem, removeSaleItem, restockSaleItem, returnSaleItem,
  setSaleItemSky,
} from "@/lib/orderbook/sales-actions";
import { itemActions, saleItemEdits } from "@/lib/orderbook/sales-view";
import type { FigureChoice } from "@/lib/orderbook/figure-search";
import { FigureSearch } from "./figure-search";
import {
  LedgerItemHead, LedgerItemRow, LedgerTable,
} from "./ledger-table";

const copy = de.business.sales;
const book = de.business.orderbook;

/* # · Serie · Figur · Marktwert · Bestand · Retoure · Aktion */
const ITEM_COLUMNS = "2.5rem 8.5rem minmax(0, 1fr) 5.5rem 6rem 5rem 8rem";

export function SaleItems({ saleId, items, catalog, historical, internal }: {
  saleId: number;
  items: Record<string, unknown>[];
  catalog: readonly FigureChoice[];
  historical: boolean;
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

      <LedgerTable itemColumns={ITEM_COLUMNS} minWidth="44rem">
        <LedgerItemHead>
          <span>#</span>
          <span>{copy.itemColumns.series}</span>
          <span>{copy.itemColumns.figure}</span>
          <span className="text-right">{copy.itemColumns.marketValue}</span>
          <span className="text-center">{copy.itemColumns.stock}</span>
          <span className="text-center">{copy.itemColumns.returned}</span>
          <span className="text-right">{copy.itemColumns.action}</span>
        </LedgerItemHead>

        <ul className="divide-y divide-border/40">
          {items.length === 0 ? (
            <li className="px-3 py-3 text-sm text-muted">{copy.noItems}</li>
          ) : items.map((item) => {
            const can = itemActions(item as never, historical);
            const edits = saleItemEdits(item as never, { historical, internal });
            const itemId = Number(item.id);
            const stock = item.movement_id !== null ? copy.booked : "—";
            const back = item.return_movement_id !== null ? copy.restocked
              : item.returned_at !== null ? copy.returned : "—";
            return (
              <LedgerItemRow key={String(item.id)}>
                <span className="tabular-nums text-xs text-muted">{String(item.position)}</span>
                <span className="truncate text-xs text-muted">{String(item.series_code ?? "—")}</span>
                <span className="truncate">{String(item.name ?? item.raw_name ?? "")}</span>
                <span className="ob-money text-right tabular-nums">
                  {item.market_price === null || item.market_price === undefined
                    ? "—" : formatPrice(Number(item.market_price))}
                </span>
                <span className="text-center text-xs text-muted">{stock}</span>
                <span className="text-center text-xs text-muted">{back}</span>
                <span className="flex justify-end gap-2 text-right">
                  {/* Only what the server would accept. An impossible button
                      invites a click that ends in a rule the screen knew. */}
                  {can.canBook ? (
                    <button type="button" disabled={pending}
                            onClick={() => act(() => bookSaleItem(Number(item.id), saleId))}
                            className={`${ACTION_PRIMARY} min-h-9 w-auto px-2 text-xs disabled:opacity-50`}>
                      {copy.book}
                    </button>
                  ) : can.canReturn ? (
                    <button type="button" disabled={pending}
                            onClick={() => act(() => returnSaleItem(Number(item.id), saleId, true))}
                            className="min-h-9 px-2 text-xs text-muted underline underline-offset-2 disabled:opacity-50">
                      {copy.returnItem}
                    </button>
                  ) : can.canRestock ? (
                    <button type="button" disabled={pending}
                            onClick={() => act(() => restockSaleItem(Number(item.id), saleId))}
                            className={`${ACTION_NEUTRAL} min-h-9 w-auto px-2 text-xs disabled:opacity-50`}>
                      {copy.restock}
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
