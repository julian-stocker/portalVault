/**
 * A game's heading inside the "Alle" view.
 *
 * 448 figures in one uninterrupted grid is a scroll, not an overview; broken
 * by game it becomes six readable sections (ADR-0038, V4). This is the rule
 * between them — a separator, not a second hero: one line with the name, the
 * count and a thread of progress under it.
 *
 * A real `<h2>`, so the page has a heading outline a screen reader can jump
 * through rather than six visually distinct but structurally invisible
 * blocks.
 */
import { formatNumber, formatPercent } from "@/lib/format";

export function SeriesSectionHeader({
  label,
  owned,
  total,
  ratio,
  count,
}: {
  label: string;
  /** Progress form: how far this game has come. */
  owned?: number;
  total?: number;
  ratio?: number;
  /** Count form: what a search found here. Used instead of the three above. */
  count?: string;
}) {
  const showsProgress = owned !== undefined && total !== undefined && ratio !== undefined;

  return (
    <div className="relative">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="font-display text-xl leading-tight font-semibold tracking-tight md:text-2xl">
          {label}
        </h2>
        {showsProgress ? (
          <p className="text-sm text-muted tabular-nums">
            <span className="font-medium text-foreground">
              {formatNumber(owned)} / {formatNumber(total)}
            </span>
            <span className="ml-2">{formatPercent(ratio)}</span>
          </p>
        ) : count ? (
          <p className="text-sm text-muted tabular-nums">{count}</p>
        ) : null}
      </div>

      {/* A thread rather than a bar: the section is a separator, and a full
          progress bar here would compete with the one in the summary. */}
      <div
        aria-hidden="true"
        className="mt-2 h-px w-full overflow-hidden rounded-full bg-gradient-to-r from-accent/45 via-border to-transparent"
      >
        <div
          className="h-full bg-accent"
          style={{ width: `${Math.min(100, Math.max(0, (ratio ?? 0) * 100))}%` }}
        />
      </div>
    </div>
  );
}
