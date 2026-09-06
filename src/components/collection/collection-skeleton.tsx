/**
 * The collection's shell, while the collection is on its way.
 *
 * Not a spinner and not a blank page: the same panel, the same control row
 * and the same table head the real page has, so what arrives fills a layout
 * that is already standing rather than replacing one (V4.3).
 *
 * Everything here is static markup — no data, no client component — so it
 * reaches the browser in the first flush, before any query has answered.
 *
 * Twelve placeholder rows, not 448: the point is that the structure is
 * visible, and a phone screen holds about that many.
 */
import { de } from "@/lib/i18n/de";

const ROWS = Array.from({ length: 12 }, (_, index) => index);

/** A soft bar standing in for a line of text. */
function Bar({ className }: { className: string }) {
  return <span aria-hidden="true" className={`block rounded-full bg-white/10 ${className}`} />;
}

export function CollectionSkeleton() {
  return (
    <div
      className="flex animate-pulse flex-col gap-6"
      aria-busy="true"
      aria-label={de.collection.loading}
    >
      {/* The vitrine panel: same ground, same gold frame, same height. */}
      <section className="rounded-sky-lg bg-[radial-gradient(130%_130%_at_18%_-10%,#2a2551_0%,#161230_45%,#0d0a1e_100%)] px-5 py-5 shadow-raised ring-2 ring-accent/40 md:px-7 md:py-6">
        <Bar className="h-3 w-24" />
        <div className="mt-3 flex flex-wrap items-end gap-x-8 gap-y-4">
          <Bar className="h-10 w-32" />
          <Bar className="h-4 w-20" />
          <Bar className="h-4 w-28" />
          <Bar className="h-4 w-16" />
        </div>
        <Bar className="mt-4 h-1.5 w-full" />
      </section>

      {/* Series bar, search, control row — the three things above the list. */}
      <div className="flex flex-col gap-3">
        <div className="flex gap-2 overflow-hidden">
          {["w-16", "w-36", "w-24", "w-28", "w-28", "w-32"].map((width) => (
            <Bar key={width} className={`h-9 shrink-0 ${width}`} />
          ))}
        </div>
        <Bar className="h-11 w-full" />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Bar className="h-4 w-24" />
          <div className="flex items-center gap-3">
            <Bar className="h-8 w-28" />
            <Bar className="h-9 w-44" />
          </div>
        </div>
      </div>

      {/* One section heading and the table's own shape. */}
      <div className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between gap-4">
          <Bar className="h-6 w-52" />
          <Bar className="h-4 w-20" />
        </div>
        <Bar className="h-px w-full" />
        <div className="flex flex-col gap-3">
          {ROWS.map((row) => (
            <div key={row} className="flex items-center gap-3">
              {/* The thumbnail's square, at its real 44 px, so nothing jumps
                  sideways when the images arrive. */}
              <Bar className="h-11 w-11 shrink-0 rounded-sky-sm" />
              <Bar className="h-4 flex-1" />
              <Bar className="hidden h-4 w-28 md:block" />
              <Bar className="hidden h-4 w-16 md:block" />
              <Bar className="h-4 w-16" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
