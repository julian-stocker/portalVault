/**
 * One stock position, as an operator uses it (Lager V2).
 *
 * A card rather than a table row, because this page is used on a phone with
 * one thumb. The layout follows the three questions in the order they are
 * asked: what is this, how much of it is there, what does it cost — and then,
 * on request, where the number came from.
 *
 *   [40px] Bash · SKY-0007 · Spyro's Adventure · Lose     [Im Shop]
 *   Eingekauft 8    Verkauft 12    Bestand [−] 4 [+]
 *   Marktpreis 4,99 €    Shoppreis 4,49 € · Automatisch · 90 %
 *   ──────────────────────────────────────────────────────────
 *   Historie                                        17 Einträge
 *
 * THREE ROWS, EACH ONE LINE. A card is a dossier in a list of hundreds, not
 * a detail page. Two earlier passes stacked these and then tried to claw
 * the height back with smaller paddings; this one starts from the row.
 *
 * Each row groups its content to the LEFT and lets the spare width sit at
 * the end, rather than pushing the last item to the far edge. On a wide
 * card `justify-between` was what produced the empty middle.
 *
 * WRITES. Stock through one movement per save (`StockStepper`), price and
 * release through `set_shop_listing` (`PriceEditor`, the switch). The card
 * never assigns `quantity`, never touches `reserved`, and never confuses the
 * shop price with the catalog's market price (ADR-0033, ADR-0037).
 */
"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { AdminThumb } from "@/components/admin/admin-thumb";
import { PriceEditor } from "@/components/admin/price-editor";
import { StockLedger } from "@/components/admin/stock-ledger";
import { StockStepper } from "@/components/admin/stock-stepper";
import { setListing } from "@/lib/admin/actions";
import type { InventoryPosition } from "@/lib/admin/inventory-model";
import { loadCardHistory } from "@/lib/admin/legacy-actions";
import {
  mergeHistory, tradeCounters,
  type CardHistory, type LedgerEntry, type TradeTotals,
} from "@/lib/admin/stock-history";
import { automaticShopPrice } from "@/lib/shop/offer";
import { formatNumber, formatPrice } from "@/lib/format";
import { imageSrc } from "@/lib/catalog/image";
import { de } from "@/lib/i18n/de";

const copy = de.inventory;

/** A counter: quiet label, number beside it. One line, no box. */
function Counter({ label, value }: { label: string; value: number }) {
  return (
    <span className="flex min-w-0 items-baseline gap-1">
      <span className="truncate text-[11px] text-muted">{label}</span>
      <span className="text-sm font-medium tabular-nums">{formatNumber(value)}</span>
    </span>
  );
}

export function InventoryCard({
  position,
  legacyTotals,
  tradeTotals,
  percentage,
}: {
  position: InventoryPosition;
  /** The reconstruction's lifetime totals for this position, if it has any. */
  legacyTotals?: TradeTotals;
  /** The operative ledger's lifetime totals for this position (0086). */
  tradeTotals?: TradeTotals;
  /** The shop-wide percentage, for the "Automatisch · 90 %" line (ADR-0045). */
  percentage: number;
}) {
  const router = useRouter();
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<CardHistory | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const figure = position.figure;
  /*
   * Two complete aggregates, added. The timeline below is NOT part of this
   * and must never become part of it: it is capped, these figures are not
   * (0086). That coupling is the bug this card used to have.
   */
  const { purchased, sold } = tradeCounters(legacyTotals, tradeTotals);

  /**
   * What this position would cost without its override. Only needed while an
   * override IS set — otherwise `effectivePrice` already is the automatic
   * price and the database computed it (ADR-0045).
   */
  const automaticPrice = automaticShopPrice(figure?.marketPrice ?? null, percentage);
  const conditionLabel =
    position.condition === "loose" ? copy.conditionLoose : copy.conditionBoxed;

  /**
   * BOTH sources are fetched on first open, not with the page.
   *
   * 2 671 reconstructed rows sit across 600 positions, and the operative
   * ledger grows for as long as the shop runs. Only an opened card shows
   * either, so one round trip per open beats 273 on load — which is what
   * this page did before 0086, once per position, for a list it then
   * summed into a counter it had no business summing.
   */
  function toggleHistory() {
    const next = !showHistory;
    setShowHistory(next);
    if (!next || history !== null || loadingHistory) return;
    setLoadingHistory(true);
    void loadCardHistory(position.skyId, position.condition, position.inventoryId)
      .then(setHistory)
      .catch(() => setHistory({ legacy: [], movements: [] }))
      .finally(() => setLoadingHistory(false));
  }

  const entries: LedgerEntry[] = mergeHistory(
    history?.legacy ?? [],
    history?.movements ?? [],
  );

  /**
   * Price and listing travel together, because `set_shop_listing` writes
   * both. Whichever one is being changed, the other is sent as it stands.
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
    <article className="flex flex-col gap-2 rounded-sky-lg bg-surface/80 p-2.5 ring-1 ring-border/70">
      {/* 1. What this is — one line. The picture is a fixed square and
             never a flex child that can be squeezed; the name is the only
             part that gives. */}
      <div className="flex items-center gap-2">
        <AdminThumb
          src={figure ? imageSrc(figure) : null}
          name={figure?.displayName ?? position.skyId}
        />
        <p className="min-w-0 flex-1 truncate text-xs leading-tight">
          <span className="text-sm font-medium">{figure?.displayName ?? position.skyId}</span>
          <span className="text-muted">
            {" · "}
            <span className="font-mono">{position.skyId}</span>
            {figure ? ` · ${figure.seriesLabel}` : ""}
            {` · ${conditionLabel}`}
          </span>
        </p>

        {/* The shop release, and the control that changes it (ADR-0048).
            "Im Shop" means released, never "in stock": the two are separate
            questions and both states of each are real. */}
        <button
          type="button"
          onClick={() => save({ isListed: !position.isListed })}
          aria-pressed={position.isListed}
          aria-busy={pending || undefined}
          className={
            "min-h-7 shrink-0 rounded-full px-2.5 text-[11px] font-medium whitespace-nowrap ring-1 " +
            (position.isListed
              ? "bg-status-ground text-status-ink ring-status-line"
              : "bg-surface text-muted ring-border/70")
          }
        >
          {position.isListed ? copy.listed : copy.notListed}
        </button>
      </div>

      {/* The two reasons a released position is nevertheless not on sale.
          Their own line, so they never widen the header. */}
      {position.isListed && (position.available <= 0 || position.effectivePrice === null) ? (
        <p className="text-[11px] leading-tight text-muted">
          {position.effectivePrice === null ? (
            <span className="text-danger">{copy.noPriceHint}</span>
          ) : (
            copy.soldOutHint
          )}
        </p>
      ) : null}

      {/* 2. How much of it there is — one line, grouped left. `Bestand`
             is last because it is the one that gets touched, so it ends up
             beside the stepper instead of splitting it. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Counter label={copy.purchased} value={purchased} />
        <Counter label={copy.sold} value={sold} />
        <span className="flex items-center gap-1.5">
          <span className="text-[11px] text-muted">{copy.stockLabel}</span>
          <StockStepper
            skyId={position.skyId}
            condition={position.condition}
            quantity={position.quantity}
            reserved={position.reserved}
            onFailed={setFailed}
          />
        </span>
        {/* Only when something is actually promised to a checkout —
            otherwise this repeats the number beside it. */}
        {position.reserved > 0 ? (
          <span className="text-[11px] text-muted">
            {copy.draftReserved(position.reserved)} · {copy.available}{" "}
            <span className="tabular-nums">{formatNumber(position.available)}</span>
          </span>
        ) : null}
      </div>

      {/* 3. What it costs — one line, grouped left. */}
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="flex items-baseline gap-1.5">
          <span className="text-[11px] text-muted">{copy.marketPrice}</span>
          <span className="text-sm tabular-nums">
            {figure === null || figure.marketPrice === null
              ? "—"
              : formatPrice(figure.marketPrice)}
          </span>
        </span>
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="text-[11px] text-muted">{copy.salePrice}</span>
          {/* What the shop charges, and whether it follows the rule
              (ADR-0045). The automatic figure is the database's. */}
          <PriceEditor
            position={position}
            automaticPrice={
              position.priceSource === "automatic" ? position.effectivePrice : automaticPrice
            }
            percentage={percentage}
            onFailed={setFailed}
          />
        </span>
      </div>

      {failed ? (
        <p role="alert" className="text-sm text-danger">
          {failed}
        </p>
      ) : null}

      {/* 4. Where the number came from. */}
      <div className="border-t border-border/30 pt-1.5">
        <button
          type="button"
          onClick={toggleHistory}
          aria-expanded={showHistory}
          className="flex w-full items-baseline justify-between gap-2 text-xs text-muted hover:text-foreground"
        >
          <span className="flex items-baseline gap-1.5">
            <span aria-hidden="true" className="text-[10px]">{showHistory ? "▴" : "▾"}</span>
            {copy.history}
          </span>
          {/* Only once the history has arrived: before that there is
              nothing to count, and a zero that jumps is worse than none. */}
          {history !== null ? (
            <span className="text-[11px] tabular-nums">{copy.historyCount(entries.length)}</span>
          ) : null}
        </button>

        {showHistory ? (
          <div className="mt-1.5">
            {loadingHistory && history === null ? (
              <p className="px-1 py-2 text-xs text-muted">{copy.historyLoading}</p>
            ) : (
              /* Read-only, and structurally so: movements are append-only
                 and legacy events are too. A wrong booking is answered with
                 a correction, never an edit. */
              <StockLedger entries={entries} />
            )}
          </div>
        ) : null}
      </div>
    </article>
  );
}
