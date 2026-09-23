/**
 * Five numbers above the stock list.
 *
 * A strip, not a dashboard: the page's job is still the list below it, and a
 * panel that took half the screen would push the search — the thing the
 * operator actually came for — under the fold. One surface, four equal
 * cells, the same `bg-surface/80` and hairline every other business panel
 * uses, no glow and no accent colour.
 *
 * The labels are quiet and the values loud, because the labels are read once
 * and the values every time. Each label carries a second line saying WHICH
 * pieces it counts — "Im Shop" is pieces a customer can buy, not positions,
 * and the difference is the whole point of the number.
 *
 * Presentation only. The arithmetic is `inventoryOverview()`, which the page
 * runs over rows it already holds.
 */
import { formatNumber, formatPrice } from "@/lib/format";
import type { InventoryOverview } from "@/lib/admin/inventory-overview";
import { de } from "@/lib/i18n/de";

const copy = de.inventory.overview;

function Metric({ label, hint, value, wide = false }: {
  label: string;
  hint: string;
  value: string;
  /**
   * Fills the phone's row on its own.
   *
   * Five cells in a two-column grid leave the last one beside a hole. The
   * fifth spans both instead, so the strip ends on a full line rather than
   * a gap — and from `sm:` every cell is one column again.
   */
  wide?: boolean;
}) {
  return (
    /* `min-w-0` so a long euro amount truncates its own cell instead of
       widening the grid and pushing a metric off a phone. */
    <div className={`flex min-w-0 flex-col gap-0.5${wide ? " col-span-2 sm:col-span-1" : ""}`}>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="truncate text-xl font-semibold tabular-nums md:text-2xl" title={value}>
        {value}
      </dd>
      {/* The sentence that keeps "Im Shop" from being read as "positions". */}
      <p className="text-[11px] leading-snug text-muted">{hint}</p>
    </div>
  );
}

export function InventoryOverviewPanel({ overview }: { overview: InventoryOverview }) {
  return (
    <section className="rounded-sky-lg bg-surface/80 p-4 ring-1 ring-border/70 md:p-5">
      <h2 className="text-sm font-medium">{copy.heading}</h2>

      {/*
        Two columns on a phone, five across from `sm:` — the five cells are
        equal in weight, so they are equal in width wherever they fit. The
        order tells the story: what is there, what of it is spoken for, what
        is buyable, and then the two amounts.

        `Reserviert` is shown even at 0. Leaving it out when nothing is held
        would make the other four ambiguous exactly when somebody is trying
        to work out why `Im Shop` is lower than `Lagerbestand`.
      */}
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-5">
        <Metric label={copy.stock} hint={copy.stockHint}
                value={formatNumber(overview.stockPieces)} />
        <Metric label={copy.reserved} hint={copy.reservedHint}
                value={formatNumber(overview.reservedPieces)} />
        <Metric label={copy.offered} hint={copy.offeredHint}
                value={formatNumber(overview.offeredPieces)} />
        <Metric label={copy.marketValue} hint={copy.marketValueHint}
                value={formatPrice(overview.marketValue)} />
        <Metric label={copy.shopValue} hint={copy.shopValueHint}
                value={formatPrice(overview.shopValue)} wide />
      </dl>

      {/* Only when there is something to say: a figure with no market price
          is left out of the sum rather than counted as 0 € (ADR-0010), and
          silently leaving it out would make the total look wrong. */}
      {overview.withoutMarketPrice > 0 ? (
        <p className="mt-3 text-xs text-muted">
          {copy.withoutPrice(overview.withoutMarketPrice)}
        </p>
      ) : null}
    </section>
  );
}
