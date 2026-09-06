/**
 * The collection as a table.
 *
 * The other way to look at a large collection: not "show me my figures" but
 * "how many, which game, what is it worth" (ADR-0038, V4). Same rows, same
 * numbers, same market-value rule — only the presentation differs.
 *
 * A real `<table>` on desktop, with real `<th scope="col">`, because that is
 * what makes a table navigable rather than a grid of text. Below `md:` it
 * becomes stacked rows: a six-column table on a 390 px screen is either
 * unreadable or a horizontal scroll, and neither is an overview.
 *
 * No shop price and no stock. This is the private collection (ADR-0032).
 */
"use client";

import Link from "next/link";

import { useCollectionMutation } from "@/components/collection/use-collection-mutation";
import { elementLabel } from "@/lib/catalog/element";
import type { CollectionRow } from "@/lib/collection/view";
import { formatNumber, formatPrice } from "@/lib/format";
import { imageSrc } from "@/lib/catalog/image";
import { de } from "@/lib/i18n/de";

function rowValue(row: CollectionRow): number | null {
  return row.figure.marketPrice === null ? null : row.quantity * row.figure.marketPrice;
}

/**
 * A thumbnail, or a quiet stand-in.
 *
 * Same plate idea as the cards, at 44 px: the photographs are on white, so a
 * light square is what makes them look like the same kind of object. The 27
 * figures without a file keep the square rather than collapsing the row.
 */
function Thumb({ src, name }: { src: string | null; name: string }) {
  return (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-sky-sm bg-plate ring-1 ring-card-border/70">
      {src ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={src}
          alt=""
          aria-hidden="true"
          loading="lazy"
          decoding="async"
          width={44}
          height={44}
          className="h-full w-full object-contain"
        />
      ) : (
        <span aria-hidden="true" className="text-[10px] text-on-plate-muted">
          —
        </span>
      )}
      <span className="sr-only">{name}</span>
    </span>
  );
}

/**
 * The table's remove, as a line of text.
 *
 * Same mutation as the card footer, same undo, still no confirmation dialog
 * (ADR-0031) — the row stays put and says "Rückgängig". What differs is the
 * weight: a filled button repeated down 448 rows would turn a table into a
 * column of buttons, so this is a text action that only fills in on hover.
 */
function RemoveCell({
  row,
  onRemove,
}: {
  row: CollectionRow;
  onRemove: (skyId: string, quantity: number) => void;
}) {
  const { apply, pending, failed } = useCollectionMutation(
    row.figure.skyId,
    row.quantity,
    onRemove,
  );

  const owned = row.quantity > 0;
  const justRemoved = !owned && row.initialQuantity > 0;
  // A row that was never owned has nothing to remove and nothing to undo.
  if (!owned && !justRemoved) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => apply(owned ? 0 : Math.max(row.initialQuantity, 1))}
        aria-label={owned ? de.collection.removeLabel(row.figure.displayName) : undefined}
        aria-busy={pending || undefined}
        className={
          "rounded-sky-sm px-2 py-1 text-xs whitespace-nowrap underline underline-offset-2 " +
          (justRemoved ? "text-accent" : "text-muted hover:text-danger") +
          (pending ? " opacity-70" : "")
        }
      >
        {owned ? de.collection.remove : de.collection.undo}
      </button>
      {failed ? (
        <span role="alert" className="block text-[11px] text-danger">
          {de.collection.removeFailed}
        </span>
      ) : null}
    </>
  );
}

export function CollectionTable({
  rows,
  onRemove,
}: {
  rows: readonly CollectionRow[];
  onRemove: (skyId: string, quantity: number) => void;
}) {
  return (
    <>
      {/* Desktop: a table, because it is one. */}
      <table className="hidden w-full border-collapse text-sm md:table">
        <thead>
          {/* Name left, everything countable centred: a column of centred
              values is quieter to scan than a ragged mix (V4.1). */}
          <tr className="border-b border-border">
            <th scope="col" className="w-16 py-2.5 pr-3">
              <span className="sr-only">{de.collection.table.image}</span>
            </th>
            <th scope="col" className="py-2.5 pr-4 text-left font-medium text-muted">
              {de.collection.table.figure}
            </th>
            <th scope="col" className="py-2.5 pr-4 text-center font-medium text-muted">
              {de.collection.table.series}
            </th>
            <th scope="col" className="py-2.5 pr-4 text-center font-medium text-muted">
              {de.collection.table.element}
            </th>
            <th scope="col" className="py-2.5 pr-4 text-center font-medium text-muted">
              {de.collection.table.quantity}
            </th>
            <th scope="col" className="py-2.5 pr-4 text-center font-medium text-muted">
              {de.catalog.marketValue}
            </th>
            <th scope="col" className="py-2.5 pr-4 text-center font-medium text-muted">
              {de.collection.table.total}
            </th>
            {/* Rightmost, so the row reads figure → facts → what I can do
                with it, and the action never sits between two numbers. */}
            <th scope="col" className="py-2.5 text-right font-medium text-muted">
              {de.collection.table.action}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const total = rowValue(row);
            return (
              <tr key={row.figure.skyId} className="border-b border-border/60 last:border-0">
                <td className="py-2 pr-3">
                  <span className="flex justify-center">
                    <Thumb src={imageSrc(row.figure)} name={row.figure.displayName} />
                  </span>
                </td>
                <td className="py-2 pr-4">
                  <Link
                    href={`/skylanders/${row.figure.slug}`}
                    className="font-medium hover:text-accent"
                  >
                    {row.figure.displayName}
                  </Link>
                </td>
                <td className="py-2 pr-4 text-center text-muted">{row.figure.seriesLabel}</td>
                <td className="py-2 pr-4 text-center text-muted">
                  {row.figure.element ? elementLabel(row.figure.element) : "—"}
                </td>
                <td className="py-2 pr-4 text-center tabular-nums">
                  {formatNumber(row.quantity)}
                </td>
                <td className="py-2 pr-4 text-center tabular-nums text-muted">
                  {row.figure.marketPrice === null
                    ? de.catalog.noPrice
                    : formatPrice(row.figure.marketPrice)}
                </td>
                <td className="py-2 pr-4 text-center font-medium tabular-nums">
                  {total === null ? "—" : formatPrice(total)}
                </td>
                <td className="py-2 text-right">
                  <RemoveCell row={row} onRemove={onRemove} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Phones: stacked rows. Name and quantity on the first line, game and
          value on the second — the four things worth scanning. */}
      <ul className="flex flex-col md:hidden">
        {rows.map((row) => {
          const total = rowValue(row);
          return (
            <li
              key={row.figure.skyId}
              className="flex items-center gap-3 border-b border-border/60 py-2.5 last:border-0"
            >
              <Thumb src={imageSrc(row.figure)} name={row.figure.displayName} />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-baseline justify-between gap-3">
                  <Link
                    href={`/skylanders/${row.figure.slug}`}
                    className="min-w-0 truncate text-sm font-medium"
                  >
                    {row.figure.displayName}
                  </Link>
                  <span className="shrink-0 text-sm tabular-nums">
                    <span aria-hidden="true">{formatNumber(row.quantity)}×</span>
                    <span className="sr-only">
                      {de.collection.table.quantity}: {formatNumber(row.quantity)}
                    </span>
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-3 text-xs text-muted">
                  <span className="min-w-0 truncate">{row.figure.seriesLabel}</span>
                  <span className="flex shrink-0 items-baseline gap-3 tabular-nums">
                    {total === null ? de.catalog.noPrice : formatPrice(total)}
                    <RemoveCell row={row} onRemove={onRemove} />
                  </span>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
