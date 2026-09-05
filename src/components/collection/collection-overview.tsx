/**
 * What the selected segment adds up to.
 *
 * A collector's summary, not a business dashboard. The deep ground is the
 * back wall of the case — the one place in the product that uses `--deep`, so
 * it stays a moment rather than a style.
 *
 * V2.1 (ADR-0038) tied it to the tabs and dropped the six series progress
 * cards that used to sit underneath. They said the same thing in miniature,
 * one row per game, which made the page read as a dashboard and gave the
 * collection two competing ways to pick a series. Now the tab bar selects,
 * and this panel is that selection's summary.
 *
 * It deliberately ignores the search box: a hero that recomputed on every
 * keystroke would turn "how complete is Trap Team" into a number that jumps
 * while you type.
 */
import type { CollectionStats } from "@/lib/collection/stats";
import type { SegmentSummary } from "@/lib/collection/view";
import { formatNumber, formatPercent, formatPrice } from "@/lib/format";
import { de } from "@/lib/i18n/de";

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-on-deep-muted">{label}</dt>
      <dd className="text-lg leading-tight font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

export function CollectionOverview({
  summary,
  stats,
  segmentLabel,
}: {
  summary: SegmentSummary;
  /** Only for the caveats, which describe the whole collection either way. */
  stats: CollectionStats;
  /** Name of the active segment: "Alle", a game, or "Duplikate". */
  segmentLabel: string;
}) {
  const caveats =
    stats.withoutPrice > 0 || stats.inactiveOwned > 0 || stats.nonCollectibleOwned > 0;

  return (
    <section
      aria-label={de.collection.overview}
      className="rounded-sky-lg bg-deep p-5 text-on-deep shadow-raised md:p-6"
    >
      <p className="text-xs font-medium tracking-wide text-on-deep-muted uppercase">
        {segmentLabel}
      </p>

      {summary.kind === "completion" ? (
        <>
          {/* The headline number and what it is measured against. The size
              difference is the hierarchy — no labels needed above them. */}
          <div className="mt-2 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <span className="text-4xl leading-none font-semibold tabular-nums md:text-5xl">
              {formatNumber(summary.owned)}
            </span>
            <span className="text-sm text-on-deep-muted tabular-nums">
              {de.collection.ofTotal(summary.total)}
            </span>
          </div>
          <p className="mt-1 text-sm text-on-deep-muted">{de.collection.ownedFigures}</p>

          <div aria-hidden="true" className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-on-deep/15">
            <div
              className="h-full rounded-full bg-accent"
              style={{ width: `${Math.min(100, Math.max(0, summary.ratio * 100))}%` }}
            />
          </div>

          <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-3">
            <Fact label={de.collection.completeLabel} value={formatPercent(summary.ratio)} />
            <Fact label={de.collection.estimatedValue} value={formatPrice(summary.value)} />
            {summary.missing > 0 ? (
              <Fact label={de.collection.missingLabel} value={formatNumber(summary.missing)} />
            ) : null}
          </dl>
        </>
      ) : (
        <>
          {/* Duplicates are not a completion segment: there is no total to
              reach, so no "x of y" and no progress bar (ADR-0038). */}
          <div className="mt-2 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <span className="text-4xl leading-none font-semibold tabular-nums md:text-5xl">
              {formatNumber(summary.figures)}
            </span>
            <span className="text-sm text-on-deep-muted">{de.collection.duplicateFigures}</span>
          </div>

          <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-3">
            <Fact label={de.collection.extraCopies} value={formatNumber(summary.extraCopies)} />
            <Fact label={de.collection.extraCopiesValue} value={formatPrice(summary.value)} />
          </dl>
        </>
      )}

      {/* Facts that would otherwise quietly distort the numbers above. They
          describe the whole collection, not the segment. */}
      {caveats ? (
        <div className="mt-4 flex flex-col gap-0.5 border-t border-on-deep/10 pt-3 text-xs text-on-deep-muted">
          {stats.withoutPrice > 0 ? <p>{de.collection.withoutPrice(stats.withoutPrice)}</p> : null}
          {stats.inactiveOwned > 0 ? <p>{de.collection.inactiveOwned(stats.inactiveOwned)}</p> : null}
          {stats.nonCollectibleOwned > 0 ? (
            <p>{de.collection.nonCollectibleOwned(stats.nonCollectibleOwned)}</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
