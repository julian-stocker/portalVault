/**
 * The parcel table (ADR-0088, ADR-0091).
 *
 * Used standing over an open box with a phone in one hand, so it is a list of
 * large rows rather than a table: each one is a figure, its worth, a state
 * picker and one button. No modals, no second screen.
 *
 * OPTIMISTIC FOR STATE, NEVER FOR BOOKING. A Quickbox change is a flag and
 * cheap to put back if the server disagrees, so it applies immediately. A
 * booking is money — it waits for the movement id and says so while waiting.
 * Disabling the button for the round trip blunts a double tap; the real
 * protection is that a second call returns the first movement rather than
 * making another.
 *
 * TWO CORRECTIONS, AND THEY ARE NOT THE SAME ACT (0064).
 *
 *   Zuordnung/Figur ändern  which figure this line IS. Allowed for every
 *                           unbooked item, historical ones included — that is
 *                           what 0054 exists for. The line, its workbook row
 *                           number and its provenance do not move.
 *   Entfernen               the line stops existing. Allowed ONLY for a
 *                           hand-made, unbooked item. A workbook line carries
 *                           provenance nothing will regenerate, and this
 *                           project does not re-import.
 *
 * Both controls are hidden where the database would refuse them — see
 * `canRemapItem` and `canRemoveItem`, which mirror `seller_remove_purchase_
 * item`'s own rules. The database is still the boundary; this only avoids
 * offering an action that is always going to be denied.
 *
 * ONCE BOOKED, NEITHER IS OFFERED. The row says `Im Bestand` and the only way
 * back is `Buchung zurücknehmen`, which writes a compensating movement rather
 * than erasing one.
 */
"use client";

import { useOptimistic, useState, useTransition } from "react";

import { ACTION_NEUTRAL, ACTION_PRIMARY } from "@/components/ui/action";
import { formatPrice } from "@/lib/format";
import { de } from "@/lib/i18n/de";
import {
  bookPurchaseItem, removePurchaseItem, setPurchaseItemSky, setPurchaseItemState,
  unbookPurchaseItem,
} from "@/lib/orderbook/actions";
import type { FigureChoice } from "@/lib/orderbook/figure-search";
import { FigureSearch } from "./figure-search";
import {
  QUICK_STATES, canBook, canRemapItem, canRemoveItem, type ItemState,
} from "@/lib/orderbook/purchase";
import type { PurchaseItem } from "@/lib/orderbook/queries";

const copy = de.business.orderbook;

/** The quiet text actions under a row. One geometry, so they line up. */
const ROW_ACTION = "min-h-11 text-xs text-muted underline underline-offset-2 sm:min-h-8";

export function PurchaseItems({
  purchaseId,
  source,
  items,
  catalog,
}: {
  purchaseId: number;
  /** `manual` or `excel_order_2026` — decides whether removal is offered. */
  source: string;
  items: PurchaseItem[];
  catalog: readonly FigureChoice[];
}) {
  const [remapping, setRemapping] = useState<number | null>(null);
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic(
    items,
    (current, update: { id: number; state: ItemState }) =>
      current.map((i) => (i.id === update.id ? { ...i, state: update.state } : i)),
  );
  const [booking, setBooking] = useState<number | null>(null);

  function quick(item: PurchaseItem, state: ItemState) {
    setError(null);
    startTransition(async () => {
      setOptimistic({ id: item.id, state });
      const result = await setPurchaseItemState(item.id, state, purchaseId);
      if (!result.ok) setError(result.message);
    });
  }

  function book(item: PurchaseItem) {
    setError(null);
    setBooking(item.id);
    startTransition(async () => {
      const result = await bookPurchaseItem(item.id, purchaseId);
      if (!result.ok) setError(result.message);
      setBooking(null);
    });
  }

  function remap(item: PurchaseItem, skyId: string | null) {
    setError(null);
    startTransition(async () => {
      const result = await setPurchaseItemSky(item.id, skyId, purchaseId, remember);
      if (!result.ok) setError(result.message);
      else { setRemapping(null); setRemember(false); }
    });
  }

  function unbook(item: PurchaseItem) {
    setError(null);
    startTransition(async () => {
      const result = await unbookPurchaseItem(item.id, purchaseId);
      if (!result.ok) setError(result.message);
    });
  }

  /*
   * No confirmation dialog, deliberately. The item is unbooked and hand-made
   * — nothing about it has reached stock, money or the workbook — and the way
   * back is to search for the figure again, which is now four keystrokes.
   * A modal here would tax the common correction to guard against nothing.
   */
  function remove(item: PurchaseItem) {
    setError(null);
    startTransition(async () => {
      const result = await removePurchaseItem(item.id, purchaseId);
      if (!result.ok) setError(result.message);
      else if (remapping === item.id) setRemapping(null);
    });
  }

  return (
    <div className="mt-6">
      {error ? (
        <p role="alert" className="mb-3 rounded-sky-md bg-surface px-3 py-2 text-sm ring-1 ring-border/70">
          {error}
        </p>
      ) : null}

      <ul className="divide-y divide-border/50 rounded-sky-lg ring-1 ring-border/60">
        {optimistic.map((item) => {
          const legacy = item.state === "reconciled_legacy";
          const isBooked = item.state === "booked";
          const mayRemap = canRemapItem(item);
          const mayRemove = canRemoveItem(source, item);
          return (
            <li key={item.id} className="bg-surface/60 px-3 py-2">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="font-medium">{item.position}. {item.name}</span>
                <span className="text-xs text-muted">
                  {item.seriesLabel ?? "—"}{item.skyId ? ` · ${item.skyId}` : ""}
                </span>
              </div>
              {/* Only when the workbook called it something else. Repeating an
                  identical name twice is clutter, and an uncategorised row's
                  raw name is already the primary line. */}
              {item.rawName && item.skyId && item.rawName !== item.name ? (
                <p className="text-xs text-muted">{copy.rawLabel(item.rawName)}</p>
              ) : null}

              <div className="flex flex-wrap items-baseline gap-x-3 text-sm">
                <span className="tabular-nums">
                  {item.marketPrice === null ? "—" : formatPrice(item.marketPrice)}
                </span>
                <span className="text-xs text-muted">
                  {item.marketPrice === null
                    ? copy.noValue
                    : item.priceIsFrozen
                      ? copy.priceFrozen
                      : copy.priceLive}
                </span>
              </div>

              {legacy ? (
                <p className="mt-1 text-xs text-muted">{copy.legacyRow}</p>
              ) : (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <div className="flex flex-wrap gap-1" role="group" aria-label={copy.columns.progress}>
                    {QUICK_STATES.map((state) => (
                      <button key={state} type="button"
                              disabled={pending || isBooked}
                              onClick={() => quick(item, state)}
                              aria-pressed={item.state === state}
                              className={`min-h-11 rounded-sky-md px-3 text-xs ring-1 disabled:opacity-50 ${
                                item.state === state ? "bg-surface font-medium ring-fg/40" : "text-muted ring-border/70"
                              }`}>
                        {copy.states[state]}
                      </button>
                    ))}
                  </div>

                  {isBooked ? (
                    <div className="ml-auto flex items-center gap-2">
                      <span className="text-xs font-medium">{copy.booked}</span>
                      <button type="button" disabled={pending} onClick={() => unbook(item)}
                              className={`${ACTION_NEUTRAL} min-h-11 w-auto disabled:opacity-60`}>
                        {copy.unbook}
                      </button>
                    </div>
                  ) : (
                    <button type="button"
                            disabled={pending || !canBook({ state: item.state, skyId: item.skyId })}
                            onClick={() => book(item)}
                            className={`${ACTION_PRIMARY} ml-auto min-h-11 w-auto disabled:opacity-40`}>
                      {booking === item.id ? copy.booking : copy.book}
                    </button>
                  )}
                </div>
              )}

              {item.movementId ? (
                <p className="mt-2 text-xs tabular-nums text-muted">#{item.movementId}</p>
              ) : null}

              {/* The two corrections, quiet and side by side. Neither appears
                  once the item owns a movement. */}
              {mayRemap || mayRemove ? (
                <div className="mt-1 flex flex-wrap items-center gap-x-4">
                  {mayRemap ? (
                    <button type="button" disabled={pending}
                            aria-expanded={remapping === item.id}
                            onClick={() => setRemapping(remapping === item.id ? null : item.id)}
                            className={ROW_ACTION}>
                      {legacy ? copy.remap : copy.figures.change}
                    </button>
                  ) : null}
                  {mayRemove ? (
                    <button type="button" disabled={pending} onClick={() => remove(item)}
                            className={`${ROW_ACTION} ml-auto`}>
                      {copy.figures.remove}
                    </button>
                  ) : null}
                </div>
              ) : null}

              {/* Inline, not a modal: the operator is on a phone and the row
                  they are correcting must stay on screen while they search. */}
              {remapping === item.id ? (
                <div className="mt-3 border-t border-border/70 pt-3">
                  <FigureSearch
                    catalog={catalog}
                    autoFocus
                    disabled={pending}
                    label={copy.figures.changeOne(item.name)}
                    onCancel={() => setRemapping(null)}
                    onSelect={(choice) => remap(item, choice.skyId)}
                  />
                  {/* Only meaningful for a row that HAS a workbook name to
                      remember. A hand-made item has nothing to map. */}
                  {item.rawName ? (
                    <label className="mt-2 flex items-center gap-2 text-xs text-muted">
                      <input type="checkbox" checked={remember}
                             onChange={(e) => setRemember(e.target.checked)} />
                      {copy.remapRemember}
                    </label>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" disabled={pending || item.skyId === null}
                            onClick={() => remap(item, null)}
                            className={`${ACTION_NEUTRAL} min-h-11 w-auto disabled:opacity-40`}>
                      {copy.remapNotAFigure}
                    </button>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
