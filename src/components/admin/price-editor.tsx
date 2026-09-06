/**
 * The shop price of one position — automatic, or a price you chose (ADR-0045).
 *
 * Two facts, one line: what the shop charges, and where that number came
 * from. The second is what makes the first safe to read at a glance —
 * "4,49 €" alone cannot tell you whether it will follow the next market
 * price update or stay put.
 *
 * The editor is a two-way choice rather than a text field with a clear
 * button, because that is the actual decision: this position follows the
 * shop-wide rule, or it does not. "Delete the number to go back to
 * automatic" is the same thing expressed as a side effect.
 *
 * It writes through `setListing`, which is one call for price and listing
 * together, so the listing flag travels along unchanged.
 */
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { setListing } from "@/lib/admin/actions";
import type { InventoryRow } from "@/lib/admin/inventory-model";
import { ACTION_NEUTRAL } from "@/components/ui/action";
import { formatPrice } from "@/lib/format";
import { de } from "@/lib/i18n/de";

/** German decimal input, and only that — no thousands separators to guess at. */
function parseAmount(text: string): number | null {
  const clean = text.trim().replace(",", ".");
  if (clean === "") return null;
  const value = Number(clean);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function PriceEditor({
  position,
  /** What the automatic price would be — computed by the database, not here. */
  automaticPrice,
  percentage,
  onFailed,
}: {
  position: InventoryRow;
  automaticPrice: number | null;
  percentage: number;
  onFailed: (message: string | null) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(
    position.salePrice === null ? "" : String(position.salePrice).replace(".", ","),
  );
  const [, startTransition] = useTransition();

  function save(salePrice: number | null) {
    onFailed(null);
    startTransition(async () => {
      const result = await setListing({
        skyId: position.skyId,
        condition: position.condition,
        salePrice,
        // Untouched. Price and listing are separate decisions that happen to
        // share one database call (ADR-0037).
        isListed: position.isListed,
        note: position.note,
      });
      if (!result.ok) {
        onFailed(result.message);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-w-0 text-left underline decoration-dotted underline-offset-4 hover:decoration-solid"
      >
        <span className="block text-sm tabular-nums">
          {position.effectivePrice === null
            ? de.inventory.noPrice
            : formatPrice(position.effectivePrice)}
        </span>
        {/* Where the number came from. One line, always present, so the two
            states are told apart by reading rather than by remembering. */}
        <span className="block text-[11px] leading-tight text-muted">
          {position.priceSource === "manual"
            ? de.inventory.priceManual
            : automaticPrice === null
              ? de.inventory.priceNoBasis
              : de.inventory.priceAutomatic(String(percentage))}
        </span>
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-sky-md bg-surface-raised p-2 ring-1 ring-border/70">
      <button
        type="button"
        onClick={() => save(null)}
        aria-pressed={position.priceSource === "automatic"}
        className={
          "rounded-sky-sm px-2 py-1.5 text-left text-xs ring-1 " +
          (position.priceSource === "automatic"
            ? "bg-accent-subtle text-accent ring-accent/50"
            : "ring-border/70 hover:bg-border/30")
        }
      >
        {automaticPrice === null
          ? de.inventory.priceNoBasis
          : de.inventory.priceModeAuto(`${percentage} % · ${formatPrice(automaticPrice)}`)}
      </button>

      <label className="flex flex-col gap-1 text-[11px] text-muted">
        {de.inventory.priceModeManual}
        <input
          inputMode="decimal"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              const value = parseAmount(draft);
              if (value === null) onFailed(de.inventory.pricePositive);
              else save(value);
            }
            if (event.key === "Escape") setOpen(false);
          }}
          placeholder="5,20"
          className="min-h-10 rounded-sky-sm bg-surface px-2 text-sm tabular-nums ring-1 ring-border/70"
        />
      </label>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            const value = parseAmount(draft);
            if (value === null) onFailed(de.inventory.pricePositive);
            else save(value);
          }}
          className={`${ACTION_NEUTRAL} min-h-10 flex-1`}
        >
          {de.admin.save}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className={`${ACTION_NEUTRAL} min-h-10 flex-1`}
        >
          {de.inventory.cancel}
        </button>
      </div>
    </div>
  );
}
