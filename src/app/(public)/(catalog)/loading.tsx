/**
 * Catalog skeleton.
 *
 * The catalog loads 561 figures server-side, which takes a moment. This
 * keeps the layout from jumping into place — it mirrors the real geometry
 * (heading, search, tab row, context line, card grid) rather than showing a
 * spinner in the middle of an empty page.
 *
 * Eight cards, not 561: enough that the transition is not a hard cut,
 * without pretending to know what is coming. Nothing animates — a shimmer
 * wall would be motion for its own sake, and `prefers-reduced-motion` would
 * have to switch it off again anyway.
 */
import { de } from "@/lib/i18n/de";

function Block({ className }: { className: string }) {
  return <div aria-hidden="true" className={`rounded-sky-md bg-border/50 ${className}`} />;
}

export default function CatalogLoading() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 md:py-8" aria-busy="true">
      {/* The only thing a screen reader needs to hear; the shapes below are
          decoration and stay hidden from it. */}
      <p className="sr-only" role="status">
        {de.catalog.loading}
      </p>

      <Block className="mb-4 h-7 w-56 md:mb-3" />
      <div className="flex flex-col gap-3">
        <Block className="h-11 w-full" />
        {/* Six games, spelled out, on a shared track — the geometry the
            segmented bar actually has since V2 (ADR-0038). */}
        <div className="flex w-fit gap-1 rounded-sky-lg bg-border/40 p-1">
          {/* Written out, not interpolated: Tailwind only emits classes it
              sees literally, so `w-${n}` would produce no width at all. */}
          {["w-32", "w-16", "w-28", "w-24", "w-32", "w-28"].map((width, index) => (
            <Block key={index} className={`h-9 shrink-0 ${width}`} />
          ))}
        </div>
        <Block className="h-5 w-32" />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 xl:grid-cols-5">
        {Array.from({ length: 8 }, (_, index) => (
          <div
            key={index}
            aria-hidden="true"
            className="flex flex-col gap-2.5 rounded-sky-lg bg-surface p-2.5 shadow-card"
          >
            <div className="aspect-square w-full rounded-sky-md bg-border/50" />
            <Block className="h-4 w-3/4" />
            <Block className="h-4 w-1/3" />
            <Block className="h-3 w-1/2" />
            <Block className="mt-1 h-10 w-full" />
          </div>
        ))}
      </div>
    </main>
  );
}
