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
 * assigns `quantity`, never touches `reserved`, and never confuses SkyIsles'
 * price with the catalog's market price.
 */
"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { AdminThumb } from "@/components/admin/admin-thumb";
import { StockDialog } from "@/components/admin/stock-dialog";
import { setListing } from "@/lib/admin/actions";
import type { InventoryPosition, Movement } from "@/lib/admin/inventory-model";
import { formatNumber, formatPrice } from "@/lib/format";
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
}: {
  position: InventoryPosition;
  /** Already loaded by the page; the card renders, it does not fetch. */
  movements: readonly Movement[];
}) {
  const router = useRouter();
  const [booking, setBooking] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [price, setPrice] = useState(
    position.salePrice === null ? "" : String(position.salePrice).replace(".", ","),
  );
  const [editingPrice, setEditingPrice] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const figure = position.figure;
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
      setEditingPrice(false);
      router.refresh();
    });
  }

  function savePrice() {
    const text = price.trim().replace(",", ".");
    if (text === "") {
      // Clearing the price also takes the position out of the shop: the
      // database refuses a listing without one, and silently keeping it
      // listed would be a lie.
      save({ salePrice: null, isListed: false });
      return;
    }
    const value = Number(text);
    if (!(value > 0)) {
      setFailed(de.inventory.pricePositive);
      return;
    }
    save({ salePrice: value });
  }

  return (
    <article className="flex flex-col gap-3 rounded-sky-lg bg-surface/80 p-3 ring-1 ring-border/70">
      <div className="flex items-start gap-3">
        <AdminThumb file={figure?.imageFile ?? null} name={figure?.displayName ?? position.skyId} />
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

      <dl className="grid grid-cols-3 gap-x-4 gap-y-2 sm:grid-cols-5">
        <Figure label={de.inventory.quantity} value={formatNumber(position.quantity)} />
        <Figure label={de.inventory.reserved} value={formatNumber(position.reserved)} />
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
          <dd className="text-sm tabular-nums">
            {editingPrice ? (
              <span className="flex items-center gap-1">
                <input
                  autoFocus
                  inputMode="decimal"
                  value={price}
                  onChange={(event) => setPrice(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") savePrice();
                    if (event.key === "Escape") setEditingPrice(false);
                  }}
                  className="min-h-9 w-20 rounded-sky-sm bg-surface px-2 text-sm tabular-nums ring-1 ring-border/70"
                />
                <button
                  type="button"
                  onMouseDown={savePrice}
                  className="text-[11px] text-accent underline"
                >
                  {de.admin.save}
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setEditingPrice(true)}
                className="underline decoration-dotted underline-offset-4 hover:decoration-solid"
              >
                {position.salePrice === null
                  ? de.inventory.noPrice
                  : formatPrice(position.salePrice)}
              </button>
            )}
          </dd>
        </div>
      </dl>

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
