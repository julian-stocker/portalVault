/**
 * The stock list on a wide screen: one compact row per position
 * (Lagerverwaltung V2, AP4 — corrected 2026-11-10).
 *
 *   Artikel | Bestand | Reserviert | Marktpreis | Verkaufspreis | Status | ▾
 *
 * READ IN THE ROW, EDIT IN THE DETAILS — EXCEPT STOCK. A row holds numbers and one status
 * badge, every row the same height, so a screen shows twenty positions and a
 * column can be scanned top to bottom. The controls — stepper, price editor,
 * shop switch, accessory block — and the journal appear only once a row is
 * opened. That is what makes the table compact; the first version put the
 * stepper and the price editor into every row and was as tall as the cards.
 *
 * STOCK IS ALWAYS AT HAND (2026-11-11). The Bestand column shows `[−] 3 [+]`
 * (`InstantStockControl`): each click books exactly ±1 through
 * `bookMovement`, one booking at a time. No popup, no draft, no confirmation
 * — the operator's choice for the desktop, and the table's ONLY stock
 * control: the details carry none. The mobile card keeps its draft.
 *
 * NOTHING NEW IS WRITTEN HERE. Every control is the card's:
 *
 *   Bestand        `InstantStockControl` — ±1 per click, in the column
 *   Verkaufspreis  `PriceEditor`  — `set_shop_listing()`
 *   Shopstatus     `ListingSwitch` — release only after a confirmation,
 *                  taking back at once
 *   Details        counters, status sentence, `AccessorySaleControls`,
 *                  `PositionHistory`
 *
 * and the same gates apply: `operative` (0108) for stock, `sellable` for price
 * and release (ADR-0128).
 *
 * ONE OPERABLE COPY. `InventoryView` puts the table and the cards side by side
 * in the markup and lets CSS show exactly one (`md:`). An element under
 * `display: none` cannot be clicked, focused or read out, so only the visible
 * view can be operated — and since a row's editors exist only while it is
 * open, and a hidden row cannot be opened, the hidden table holds none.
 */
"use client";

import { useState } from "react";

import { AccessorySaleControls } from "@/components/admin/accessory-sale-controls";
import { Counter } from "@/components/admin/inventory-card";
import { ListingSwitch } from "@/components/admin/listing-switch";
import { PositionHistory } from "@/components/admin/position-history";
import { PositionStatusBadge, PositionStatusNote } from "@/components/admin/position-status";
import { PositionTitle } from "@/components/admin/position-title";
import { PriceEditor } from "@/components/admin/price-editor";
import { InstantStockControl } from "@/components/admin/instant-stock-control";
import { FavoriteDemandIndicator } from "@/components/business/favorite-demand-indicator";
import {
  hasSaleControls, isOperativeCondition, isShopGoods, type InventoryPosition,
} from "@/lib/admin/inventory-model";
import { positionKey } from "@/lib/admin/position-key";
import { tradeCounters, type TradeTotals } from "@/lib/admin/stock-history";
import { automaticShopPrice } from "@/lib/shop/offer";
import { formatNumber, formatPrice } from "@/lib/format";
import { de } from "@/lib/i18n/de";

const copy = de.inventory;
const COLUMNS = 7;

const HEAD = "h-9 px-2 text-left align-middle text-[11px] font-medium text-muted";
/* One height for every row: the picture is 40 px, the row is 52. */
const CELL = "h-[52px] px-2 align-middle border-t border-border/40";
const NUMBER = `${CELL} text-right tabular-nums whitespace-nowrap`;

export function InventoryTable({
  positions,
  legacyTotals,
  tradeTotals,
  percentage,
}: {
  positions: readonly InventoryPosition[];
  legacyTotals: Readonly<Record<string, TradeTotals>>;
  tradeTotals: Readonly<Record<number, TradeTotals>>;
  percentage: number;
}) {
  return (
    <table className="w-full table-fixed border-separate border-spacing-0 rounded-sky-lg bg-surface/80 text-sm ring-1 ring-border/70">
      <caption className="sr-only">{copy.table.caption}</caption>
      <colgroup>
        {/* Fixed widths for the numbers, the rest for the name: from 768 px
            the article column keeps about 200 px, and a long name truncates
            instead of pushing a number out of its column. */}
        <col />
        <col className="w-28" />
        <col className="w-20" />
        <col className="w-24" />
        <col className="w-28" />
        <col className="w-32" />
        <col className="w-11" />
      </colgroup>
      <thead>
        <tr>
          <th scope="col" className={HEAD}>{copy.table.article}</th>
          <th scope="col" className={`${HEAD} text-center`}>{copy.table.stock}</th>
          <th scope="col" className={`${HEAD} text-right`}>{copy.table.reserved}</th>
          <th scope="col" className={`${HEAD} text-right`}>{copy.table.marketPrice}</th>
          <th scope="col" className={`${HEAD} text-right`}>{copy.table.salePrice}</th>
          <th scope="col" className={HEAD}>{copy.table.status}</th>
          <th scope="col" className={HEAD}><span className="sr-only">{copy.table.details}</span></th>
        </tr>
      </thead>
      {positions.map((position) => (
        <InventoryTableRow
          key={position.inventoryId}
          position={position}
          legacyTotals={legacyTotals[positionKey(position.skyId, position.condition)]}
          tradeTotals={tradeTotals[position.inventoryId]}
          percentage={percentage}
        />
      ))}
    </table>
  );
}

/**
 * One position: its row, and — on request — its details underneath. A
 * `<tbody>` per position keeps the two rows together for assistive
 * technology and for the hover line.
 */
export function InventoryTableRow({
  position,
  legacyTotals,
  tradeTotals,
  percentage,
}: {
  position: InventoryPosition;
  legacyTotals?: TradeTotals;
  tradeTotals?: TradeTotals;
  percentage: number;
}) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const figure = position.figure;
  const name = figure?.displayName ?? position.skyId;
  /* The card's gates, unchanged (0108, ADR-0128). */
  const operative = isOperativeCondition(position.condition);
  const shopGoods = isShopGoods(position);
  const sellable = operative && shopGoods;
  const saleState = hasSaleControls(position) ? (position.saleState ?? null) : null;
  const automaticPrice = automaticShopPrice(figure?.marketPrice ?? null, percentage);
  /* Complete aggregates, never the capped history (0086). */
  const { purchased, sold } = tradeCounters(legacyTotals, tradeTotals);
  const detailsId = `inventory-details-${position.inventoryId}`;

  return (
    <tbody>
      <tr
        onClick={() => setOpen((value) => !value)}
        className={"cursor-pointer hover:bg-surface " + (open ? "bg-surface" : "")}
      >
        <td className={CELL}>
          <span className="flex min-w-0 items-center gap-2">
            <PositionTitle position={position} />
            <FavoriteDemandIndicator count={position.favoriteDemand} />
          </span>
        </td>
        <td className={`${CELL} text-center tabular-nums whitespace-nowrap`} onClick={(event) => event.stopPropagation()}>
          {operative ? (
            <InstantStockControl
              skyId={position.skyId}
              condition={position.condition}
              quantity={position.quantity}
              reserved={position.reserved}
              name={name}
              onFailed={setFailed}
            />
          ) : (
            formatNumber(position.quantity)
          )}
        </td>
        <td className={NUMBER}>
          <span className={position.reserved > 0 ? "font-medium" : "text-muted"}>
            {formatNumber(position.reserved)}
          </span>
        </td>
        <td className={NUMBER}>
          {figure === null || figure.marketPrice === null ? "—" : formatPrice(figure.marketPrice)}
        </td>
        <td className={NUMBER}>
          {/* Only shop goods have a shop price (ADR-0128). Where it comes
              from is one word under it — the editor is in the details. */}
          {!shopGoods ? (
            <span className="text-muted">—</span>
          ) : (
            <span className="flex flex-col items-end leading-tight">
              <span>{position.effectivePrice === null ? "–" : formatPrice(position.effectivePrice)}</span>
              <span className="text-[10px] text-muted">
                {position.priceSource === "manual" ? copy.priceManual : copy.priceAuto}
              </span>
            </span>
          )}
        </td>
        <td className={CELL}>
          <PositionStatusBadge position={position} />
        </td>
        <td className={`${CELL} text-center`}>
          <button
            type="button"
            onClick={(event) => {
              /* The row toggles too; one click must not toggle twice. */
              event.stopPropagation();
              setOpen((value) => !value);
            }}
            aria-expanded={open}
            aria-controls={detailsId}
            aria-label={open ? copy.table.hideDetails(name) : copy.table.showDetails(name)}
            className="focus-ring inline-flex h-8 w-8 items-center justify-center rounded-full text-muted ring-1 ring-border/70 hover:text-foreground"
          >
            <span aria-hidden="true" className="text-[10px]">{open ? "▴" : "▾"}</span>
          </button>
        </td>
      </tr>

      {/* An error belongs to its row, open or not. */}
      {failed ? (
        <tr>
          <td colSpan={COLUMNS} className="px-3 pb-1.5">
            <p role="alert" className="text-sm text-danger">{failed}</p>
          </td>
        </tr>
      ) : null}

      {open ? (
        <tr id={detailsId}>
          <td colSpan={COLUMNS} className="border-t border-border/40 bg-surface/60 px-3 pt-2 pb-3">
            <div className="flex flex-col gap-2.5">
              {!operative ? (
                <p className="rounded-sky-md bg-status-ground px-2.5 py-1.5 text-[11px] leading-tight text-status-ink ring-1 ring-status-line">
                  <span className="font-medium">{copy.historicalCondition}</span>{" "}
                  {copy.historicalConditionHint}
                </p>
              ) : !shopGoods && saleState === null ? (
                <p className="text-[11px] leading-tight text-muted">{copy.accessoryNotShopHint}</p>
              ) : null}

              <PositionStatusNote position={position} />

              {/* Price and release, side by side — each the card's own
                  control. STOCK IS NOT HERE: the table has one stock control,
                  `[−] n [+]` in its column (2026-11-11). A second, draft-based
                  one in the details was a second way to the same number. */}
              <div className="flex flex-wrap items-start gap-x-8 gap-y-3">
                {shopGoods ? (
                  <div className="flex flex-col gap-1">
                    <span className="text-[11px] text-muted">{copy.salePrice}</span>
                    {sellable ? (
                      <PriceEditor
                        position={position}
                        automaticPrice={
                          position.priceSource === "automatic" ? position.effectivePrice : automaticPrice
                        }
                        percentage={percentage}
                        onFailed={setFailed}
                      />
                    ) : (
                      <span className="text-sm tabular-nums">
                        {position.effectivePrice === null ? "–" : formatPrice(position.effectivePrice)}
                      </span>
                    )}
                  </div>
                ) : null}

                {sellable ? (
                  <div className="flex flex-col items-start gap-1">
                    <span className="text-[11px] text-muted">{copy.listingFilter}</span>
                    <ListingSwitch position={position} onFailed={setFailed} />
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center gap-x-4 self-center">
                  <Counter label={copy.purchased} value={purchased} />
                  <Counter label={copy.sold} value={sold} />
                  <Counter label={copy.available} value={position.available} />
                </div>
              </div>

              {saleState !== null ? (
                <AccessorySaleControls position={position} saleState={saleState} onFailed={setFailed} />
              ) : null}

              <PositionHistory position={position} />
            </div>
          </td>
        </tr>
      ) : null}
    </tbody>
  );
}

