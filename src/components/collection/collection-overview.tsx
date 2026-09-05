/**
 * What the collection adds up to — and the way into it.
 *
 * A collector's summary, not a business dashboard: one line of numbers, a
 * quiet bar, the estimated value, and how far each of the six games has come.
 * No tiles, no badges, no trophies.
 *
 * The series rows are also the series filter. They were a separate tab bar
 * first, next to this list, and that put the six games on the screen twice
 * and pushed the figures below the fold on a phone. Merging them is both
 * shorter and better: "Giants 0 / 81" is exactly the thing you want to tap.
 *
 * Every bar states its numbers in text as well. A bar that only exists as a
 * filled rectangle is unreadable to anyone who cannot see it — and unreadable
 * to everyone at a glance.
 */
import type { CollectionStats } from "@/lib/collection/stats";
import type { SeriesProgress } from "@/lib/collection/view";
import { ALL_SERIES } from "@/lib/catalog/search";
import { formatNumber, formatPercent, formatPrice } from "@/lib/format";
import { de } from "@/lib/i18n/de";

function Bar({ ratio, thin = false }: { ratio: number; thin?: boolean }) {
  return (
    <div
      aria-hidden="true"
      className={`w-full overflow-hidden rounded-full bg-border ${thin ? "h-1" : "h-2"}`}
    >
      <div
        className="h-full rounded-full bg-accent"
        style={{ width: `${Math.min(100, Math.max(0, ratio * 100))}%` }}
      />
    </div>
  );
}

export function CollectionOverview({
  stats,
  series,
  activeSeries,
  onSelectSeries,
}: {
  stats: CollectionStats;
  series: readonly SeriesProgress[];
  activeSeries: string;
  onSelectSeries: (code: string) => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <section
        aria-label={de.collection.overview}
        className="flex flex-col gap-2.5 rounded-sky-lg border border-border bg-surface p-4 shadow-card"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-4">
          <p className="text-lg font-semibold tabular-nums">
            {de.collection.collectedOf(stats.countedFigures, stats.catalogTotal)}
          </p>
          <p className="text-sm text-muted tabular-nums">
            {de.collection.complete(formatPercent(stats.progress))}
          </p>
        </div>

        <Bar ratio={stats.progress} />

        <div className="flex flex-wrap items-baseline justify-between gap-x-4">
          <span className="text-sm text-muted">{de.collection.estimatedValue}</span>
          <span className="text-lg font-semibold tabular-nums">
            {formatPrice(stats.estimatedValue)}
          </span>
        </div>

        {/* Facts that would otherwise quietly distort the numbers above. */}
        {stats.withoutPrice > 0 ? (
          <p className="text-xs text-muted">{de.collection.withoutPrice(stats.withoutPrice)}</p>
        ) : null}
        {stats.inactiveOwned > 0 ? (
          <p className="text-xs text-muted">{de.collection.inactiveOwned(stats.inactiveOwned)}</p>
        ) : null}
        {stats.nonCollectibleOwned > 0 ? (
          <p className="text-xs text-muted">
            {de.collection.nonCollectibleOwned(stats.nonCollectibleOwned)}
          </p>
        ) : null}
      </section>

      <div role="tablist" aria-label={de.collection.seriesProgress} className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">{de.collection.seriesProgress}</h2>
        {/* Three columns at most: six would give "Spyro's Adventure" plus two
            numbers about 190 px, which is not enough for any of them. */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 lg:grid-cols-3">
          {series.map((entry) => {
            const isActive = entry.code === activeSeries;
            return (
              <button
                key={entry.code}
                type="button"
                role="tab"
                aria-selected={isActive}
                // Tapping the chosen series again clears the filter.
                onClick={() => onSelectSeries(isActive ? ALL_SERIES : entry.code)}
                className={
                  "-mx-2 flex min-h-11 min-w-0 flex-col justify-center gap-1 rounded-sky-sm px-2 " +
                  "text-left " +
                  (isActive ? "bg-accent-subtle" : "hover:bg-border/40")
                }
              >
                <span className="flex min-w-0 items-baseline justify-between gap-2">
                  {/* min-w-0 twice on purpose: a flex item will not shrink
                      below its content without it, so `truncate` never fires
                      and the label runs into the next column. */}
                  <span className="min-w-0 truncate text-xs text-muted">{entry.label}</span>
                  <span className="shrink-0 text-xs tabular-nums">
                    <span className="font-medium">
                      {formatNumber(entry.owned)}/{formatNumber(entry.total)}
                    </span>
                    <span className="ml-1 text-muted">{formatPercent(entry.ratio)}</span>
                  </span>
                </span>
                <Bar ratio={entry.ratio} thin />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
