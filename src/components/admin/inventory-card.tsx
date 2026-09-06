/**
 * One stock position, as an operator uses it.
 *
 * A card rather than a table row, because this page is used on a phone with
 * one thumb: the three things that change daily — stock, price, offered or
 * not — are full-width controls, not icons. Desktop gets the same card in a
 * wider grid; shrinking a seven-column table onto 390 px was the alternative
 * and it is not a usable one.
 *
 * Everything it writes goes through the shop functions (ADR-0037): stock via
 * a movement, price and listing via `set_shop_listing`. The card never
 * assigns `quantity`, never touches `reserved`, and never confuses the shop
 * price with the catalog's market price.
 *
 * V6 split the daily job from the rare one (ADR-0047). Correcting a shelf
 * count is `−  7  +`, right where the number is; everything that needs a
 * reason, a note or a cost — a purchase, a sale, a write-off — lives behind
 * "Weitere Buchung". Both book an ordinary movement; only the number of
 * interactions differs.
 */
"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { AdminThumb } from "@/components/admin/admin-thumb";
import { PriceEditor } from "@/components/admin/price-editor";
import { StockDialog } from "@/components/admin/stock-dialog";
import { StockStepper } from "@/components/admin/stock-stepper";
import { setListing } from "@/lib/admin/actions";
import type { InventoryPosition, Movement } from "@/lib/admin/inventory-model";
import { formatNumber, formatPrice } from "@/lib/format";
import { imageSrc } from "@/lib/catalog/image";
import { de } from "@/lib/i18n/de";

function Figure({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className={`text-sm tabular-nums ${tone ?? ""}`}>{value}</dd>
    </div>
  );
}

export function InventoryCard({
  position,
  movements,
  percentage,
}: {
  position: InventoryPosition;
  /** Already loaded by the page; the card renders, it does not fetch. */
  movements: readonly Movement[];
  /** The shop-wide percentage, for the "Automatisch · 90 %" line (ADR-0045). */
  percentage: number;
}) {
  const router = useRouter();
  const [booking, setBooking] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const figure = position.figure;

  /**
   * What this position would cost without its override.
   *
   * Only needed while an override IS set — otherwise `effectivePrice` already
   * is the automatic price and the database computed it. This is the one
   * place money is worked out in the browser, it never leaves the preview,
   * and it is rounded the same way `public.shop_price` rounds: to cents,
   * half away from zero, on a value scaled to integers so no binary fraction
   * can drift.
   */
  const automaticPrice =
    figure?.marketPrice == null
      ? null
      : Math.round(figure.marketPrice * percentage) / 100;

  const conditionLabel =
    position.condition === "loose" ? de.inventory.conditionLoose : de.inventory.conditionBoxed;

  /**
   * Price and listing travel together, because `set_shop_listing` writes both.
   * Whichever one is being changed, the other is sent as it stands.
   */
  function save(next: { salePrice?: number | null; isListed?: boolean }) {
    setFailed(null);
    startTransition(async () => {
      const result = await setListing({
        skyId: position.skyId,
        condition: position.condition,
        salePrice: next.salePrice !== undefined ? next.salePrice : position.salePrice,
        isListed: next.isListed !== undefined ? next.isListed : position.isListed,
        note: position.note,
      });
      if (!result.ok) {
        setFailed(result.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <article className="flex flex-col gap-3 rounded-sky-lg bg-surface/80 p-3 ring-1 ring-border/70">
      <div className="flex items-start gap-3">
        <AdminThumb
          src={figure ? imageSrc(figure) : null}
          name={figure?.displayName ?? position.skyId}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{figure?.displayName ?? position.skyId}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted">
            <span className="font-mono">{position.skyId}</span>
            {figure ? <span>· {figure.seriesLabel}</span> : null}
            <span>· {conditionLabel}</span>
          </p>
        </div>
        {/* The offer state, and the control that changes it. Independent of
            stock: "listed but sold out" and "in stock, not offered" are both
            real (ADR-0037). */}
        <button
          type="button"
          onClick={() => save({ isListed: !position.isListed })}
          aria-pressed={position.isListed}
          aria-busy={pending || undefined}
          className={
            "min-h-9 shrink-0 rounded-full px-3 text-xs font-medium whitespace-nowrap ring-1 " +
            (position.isListed
              ? "bg-accent-subtle text-accent ring-accent/60"
              : "bg-surface text-muted ring-border/70")
          }
        >
          {position.isListed ? de.inventory.listed : de.inventory.notListed}
        </button>
      </div>

      {/* The daily control, given the room it deserves: the number and the
          two ways to change it, on one line, at 44 px each (ADR-0047). */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="text-[11px] text-muted">{de.inventory.quantity}</p>
          <StockStepper
            skyId={position.skyId}
            condition={position.condition}
            quantity={position.quantity}
            reserved={position.reserved}
            onFailed={setFailed}
          />
        </div>

        <dl className="flex flex-wrap items-start gap-x-5 gap-y-2">
          {/* Reserved is shown only when it is not zero — a column of noughts
              on every card says nothing, and nothing writes it in V1. */}
          {position.reserved > 0 ? (
            <Figure label={de.inventory.reserved} value={formatNumber(position.reserved)} />
          ) : null}
          <Figure
            label={de.inventory.available}
            value={formatNumber(position.available)}
            tone={position.available > 0 ? "text-foreground" : "text-muted"}
          />
          <Figure
            label={de.inventory.marketPrice}
            value={
              figure?.marketPrice === null || figure === null
                ? "—"
                : formatPrice(figure.marketPrice)
            }
            tone="text-muted"
          />
          <div className="min-w-0">
            <dt className="text-[11px] text-muted">{de.inventory.salePrice}</dt>
            <dd>
              {/* What the shop charges, and whether it follows the rule
                  (ADR-0045). The automatic figure is the database's, not a
                  second calculation. */}
              <PriceEditor
                position={position}
                automaticPrice={
                  position.priceSource === "automatic" ? position.effectivePrice : automaticPrice
                }
                percentage={percentage}
                onFailed={setFailed}
              />
            </dd>
          </div>
        </dl>
      </div>

      {failed ? (
        <p role="alert" className="text-sm text-danger">
          {failed}
        </p>
      ) : null}

      {booking ? (
        <StockDialog
          skyId={position.skyId}
          condition={position.condition}
          quantity={position.quantity}
          reserved={position.reserved}
          onDone={() => {
            setBooking(false);
            router.refresh();
          }}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setBooking(true)}
            className="min-h-10 flex-1 rounded-sky-md bg-surface px-4 text-sm font-medium ring-1 ring-border-strong hover:bg-border/30"
          >
            {de.inventory.changeStock}
          </button>
          <button
            type="button"
            onClick={() => setShowHistory((open) => !open)}
            aria-expanded={showHistory}
            className="text-xs text-muted underline underline-offset-2 hover:text-foreground"
          >
            {de.inventory.history}
          </button>
        </div>
      )}

      {showHistory ? (
        /* Read-only, and structurally so: movements are append-only in the
           database and there is no function that edits or deletes one. A
           wrong booking is answered with a correction. */
        <ul className="flex flex-col gap-1 border-t border-border/60 pt-2 text-xs text-muted">
          {movements.length === 0 ? (
            <li>{de.inventory.noHistory}</li>
          ) : (
            movements.map((movement) => (
              <li key={movement.id} className="flex flex-wrap gap-x-2 tabular-nums">
                <span className={movement.delta > 0 ? "text-foreground" : ""}>
                  {movement.delta > 0 ? "+" : ""}
                  {formatNumber(movement.delta)}
                </span>
                <span>· {de.inventory.reasons[movement.reason] ?? movement.reason}</span>
                <span>· {new Date(movement.createdAt).toLocaleDateString("de-AT")}</span>
                {movement.unitCost !== null ? <span>· {formatPrice(movement.unitCost)}</span> : null}
                {movement.note ? <span className="truncate">· {movement.note}</span> : null}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </article>
  );
}
