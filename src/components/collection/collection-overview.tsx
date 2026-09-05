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
import type { DuplicateSummary, SegmentSummary } from "@/lib/collection/view";
import { formatNumber, formatPercent, formatPrice } from "@/lib/format";
import { de } from "@/lib/i18n/de";

/**
 * Four corner brackets. Written out rather than composed, because Tailwind
 * only emits classes it can see literally — a computed `border-${side}` would
 * produce no border at all.
 */
const CORNERS = [
  "top-1 left-1 border-t-2 border-l-2 rounded-tl-lg",
  "top-1 right-1 border-t-2 border-r-2 rounded-tr-lg",
  "bottom-1 left-1 border-b-2 border-l-2 rounded-bl-lg",
  "bottom-1 right-1 border-b-2 border-r-2 rounded-br-lg",
] as const;

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] tracking-wide text-on-deep-muted">{label}</dt>
      <dd className="mt-0.5 truncate text-lg leading-tight font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

export function CollectionOverview({
  summary,
  duplicates,
  stats,
  segmentLabel,
}: {
  summary: SegmentSummary;
  /** Present only while the duplicates filter is on. */
  duplicates: DuplicateSummary | null;
  /** Only for the caveats, which describe the whole collection either way. */
  stats: CollectionStats;
  /** Name of the active scope: "Alle" or a game. */
  segmentLabel: string;
}) {
  const caveats =
    stats.withoutPrice > 0 || stats.inactiveOwned > 0 || stats.nonCollectibleOwned > 0;

  return (
    <section
      aria-label={de.collection.overview}
      className={
        "relative overflow-hidden rounded-sky-lg px-5 py-5 text-on-deep md:px-7 md:py-6 " +
        // Nearly opaque, on purpose (ADR-0038, V3.2). V3.1 let the panel sit
        // at 70 % over the world artwork and the completion figures ended up
        // reading across a sunset. A vitrine plate has a back.
        "bg-[radial-gradient(130%_130%_at_18%_-10%,#2a2551_0%,#161230_45%,#0d0a1e_100%)] " +
        // A struck gold frame, not a hairline: this is the one panel in the
        // product that is allowed to look like an object.
        "shadow-raised ring-2 ring-accent/85"
      }
    >
      {/* A frame inside the frame, four corner brackets, and a warm light in
          the upper right. V3 called this "two quiet ornaments"; a vitrine
          panel earns more than that (ADR-0038, V3.1). */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-[4px] rounded-[0.66rem] ring-1 ring-accent/45"
      />
      {CORNERS.map((corner) => (
        <span
          key={corner}
          aria-hidden="true"
          className={`pointer-events-none absolute h-5 w-5 border-accent ${corner}`}
        />
      ))}
      {/* Two warm reflections, as light on a lacquered surface rather than
          as a lamp: one wide from the upper right, one narrow at the left
          edge where the frame would catch it. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 -right-16 h-64 w-64 rounded-full opacity-70 blur-3xl"
        style={{ background: "rgb(224 164 74 / 0.26)" }}
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-20 -left-16 h-48 w-48 rounded-full opacity-50 blur-3xl"
        style={{ background: "rgb(120 96 220 / 0.28)" }}
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-10 top-0 h-px"
        style={{
          background:
            "linear-gradient(to right, transparent, var(--gold-line-strong), transparent)",
        }}
      />

      {/*
       * One row on desktop, stacked on a phone (V3.4).
       *
       * The V3.3 panel put the headline, a caption, the bar and three figures
       * on five separate lines and came out taller than the first row of
       * cards it was meant to introduce. The same content reads in about a
       * third less height when the number and the readout sit side by side.
       */}
      <div className="relative flex flex-col gap-5 md:flex-row md:items-end md:gap-8">
        <div className="min-w-0 shrink-0">
          <p className="text-[11px] font-medium tracking-wide text-on-deep-muted uppercase">
            {segmentLabel}
          </p>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
            <span className="text-4xl leading-none font-semibold tracking-tight text-accent tabular-nums md:text-5xl">
              {formatNumber(summary.owned)}
            </span>
            <span className="text-sm text-on-deep-muted tabular-nums">
              {de.collection.ofTotal(summary.total)}
            </span>
          </div>
        </div>

        {/* The readout. Auto-fitting columns rather than a fixed three, so a
            long German label widens its own column instead of breaking the
            row. */}
        <dl className="grid min-w-0 flex-1 grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 md:pb-1">
          <Fact label={de.collection.completeLabel} value={formatPercent(summary.ratio)} />
          <Fact label={de.collection.estimatedValue} value={formatPrice(summary.value)} />
          {summary.missing > 0 ? (
            <Fact label={de.collection.missingLabel} value={formatNumber(summary.missing)} />
          ) : null}
        </dl>
      </div>

      <div
        aria-hidden="true"
        className="relative mt-4 h-1.5 w-full overflow-hidden rounded-full bg-black/45 shadow-[inset_0_1px_2px_rgb(0_0_0/0.6)]"
      >
        <div
          className="h-full rounded-full shadow-[0_0_10px_rgb(224_164_74/0.55)]"
          style={{
            width: `${Math.min(100, Math.max(0, summary.ratio * 100))}%`,
            background: "linear-gradient(to bottom, #f3cd85 0%, var(--accent) 55%, #a9761f 100%)",
          }}
        />
      </div>

      {/* One extra line while the duplicates filter is on — not a second
          summary (ADR-0038, V4.2). Completion stays on screen; this is added
          to it, because showing duplicates is a way of looking at the
          collection, not a different question about it. */}
      {duplicates ? (
        <p className="relative mt-3 text-sm text-on-deep-muted tabular-nums">
          {de.collection.duplicateLine(
            duplicates.figures,
            duplicates.extraCopies,
            formatPrice(duplicates.value),
          )}
        </p>
      ) : null}

      {/* Facts that would otherwise quietly distort the numbers above. They
          describe the whole collection, not the segment. */}
      {caveats ? (
        <div className="relative mt-3.5 flex flex-col gap-0.5 border-t border-on-deep/10 pt-2.5 text-[11px] text-on-deep-muted">
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
