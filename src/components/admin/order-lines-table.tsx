import type { ReactNode } from "react";

import { snapshotImageSource, imageSrc } from "@/lib/catalog/image";
import { formatPrice } from "@/lib/format";
import { de } from "@/lib/i18n/de";

/**
 * The positions of one order, for the person packing the parcel (ADR-0074).
 *
 * This replaced a list of text cards. Picking figures from a shelf is a
 * scanning task — seven facts per line, always in the same place, with the
 * picture first because that is what the hand is looking for. Prose rows made
 * the operator read each line to find the quantity.
 *
 * EVERY FIELD COMES FROM THE ORDER, NONE FROM THE CATALOG
 *
 * Name, series, condition, quantity, price and picture are all snapshots taken
 * when the order was placed (ADR-0033). A figure renamed, repriced or
 * re-photographed since then must not change what this order says it sold. The
 * component therefore receives a line and never a `sky_id` to look up — there
 * is no query here to get wrong.
 *
 * TWO LAYOUTS, ONE TABLE
 *
 * The admin order page is worked on an iPhone, so seven columns cannot simply
 * scroll sideways: the page itself must never move. The same `<table>`
 * elements are laid out as rows from `md:` up and as a compact block below it,
 * which keeps one set of markup and one set of data rather than rendering the
 * order twice and hoping the two stay in step.
 */
export type OrderLine = {
  /** Since 0095: what the two position actions address. */
  id?: number;
  sky_id: string;
  condition: string;
  name: string;
  /** `order_lines.image_snapshot` — a reference, not a URL. */
  image?: string | null;
  /** `order_lines.series_snapshot`. Null on every order placed before 0039. */
  series?: string | null;
  quantity: number;
  unit_price: string | number;
  line_total: string | number;
  /*
   * The derived quantities (0095). Sums over `order_line_events`; absent on a
   * database without that migration, and then the row reads exactly as it did
   * before — `quantity`, and nothing about cancellations.
   */
  cancelled?: number;
  returned?: number;
  fulfillable?: number;
  /** How many may still be cancelled, and how many may still come back. */
  cancellable?: number;
  returnable?: number;
};

/**
 * What became of the ordered pieces, in one short line under the name.
 *
 * Only when something happened. An untouched position says nothing extra —
 * the ordinary case stays as quiet as it was.
 */
function lineStatus(line: OrderLine): string | null {
  const copy = de.admin.orders.lineActions;
  const cancelled = line.cancelled ?? 0;
  const returned = line.returned ?? 0;
  if (cancelled === 0 && returned === 0) return null;

  const parts: string[] = [];
  if (cancelled > 0) parts.push(copy.cancelledCount(cancelled));
  if (returned > 0) parts.push(copy.returnedCount(returned));
  const left = line.fulfillable ?? line.quantity - cancelled;
  if (cancelled > 0 && left > 0) parts.push(copy.toDeliver(left));
  return parts.join(" · ");
}

/** A fixed box, so a missing or oddly shaped picture cannot move the row. */
const THUMB = "h-12 w-12 shrink-0 rounded-sky-sm bg-surface object-contain ring-1 ring-border/60";

function Thumb({ line }: { line: OrderLine }) {
  const src = imageSrc(snapshotImageSource(line.image));
  const copy = de.admin.orders;

  if (src === null) {
    return (
      <div
        className={`${THUMB} flex items-center justify-center text-[10px] leading-tight text-muted`}
        // The placeholder is the same size as the picture it stands in for, so
        // a line without one does not shift the rest of the row.
        aria-label={copy.lineNoImage}
        role="img"
      >
        —
      </div>
    );
  }

  return (
    // Not `next/image`: these are already optimised and content-addressed
    // (ADR-0026), and the catalog does not re-optimise them either.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      width={48}
      height={48}
      loading="lazy"
      decoding="async"
      className={THUMB}
    />
  );
}

function condition(value: string): string {
  const copy = de.admin.orders;
  return value === "boxed" ? copy.conditionBoxed : copy.conditionLoose;
}

/** The series, or an honest dash for an order placed before it was recorded. */
function series(line: OrderLine): string {
  const value = typeof line.series === "string" ? line.series.trim() : "";
  return value === "" ? de.admin.orders.lineSeriesUnknown : value;
}

export function OrderLinesTable({ lines, action }: {
  lines: OrderLine[];
  /**
   * What the operator may do with one position (0095).
   *
   * A render slot rather than a prop bag: the controls are interactive and
   * live in a client component, while this table stays the server-rendered
   * snapshot it has always been. A surface that only shows the order — the
   * customer's own page — passes nothing and gets exactly what it got before.
   */
  action?: (line: OrderLine) => ReactNode;
}) {
  const copy = de.admin.orders;

  return (
    <table className="mt-2 w-full border-collapse text-sm">
      {/*
       * Headers only where there are columns to head. Below `md:` each line is
       * a block and a header row would label nothing.
       */}
      <thead className="hidden md:table-header-group">
        <tr className="border-b border-border/70 text-left text-xs tracking-wide text-muted uppercase">
          <th scope="col" className="w-16 py-2 pr-3 font-medium">
            {copy.lineImage}
          </th>
          <th scope="col" className="py-2 pr-3 font-medium">
            {copy.lineFigure}
          </th>
          <th scope="col" className="py-2 pr-3 font-medium">
            {copy.lineSeries}
          </th>
          <th scope="col" className="py-2 pr-3 font-medium">
            {copy.lineCondition}
          </th>
          <th scope="col" className="py-2 pr-3 text-right font-medium">
            {copy.lineQuantity}
          </th>
          <th scope="col" className="py-2 pr-3 text-right font-medium">
            {copy.unitPrice}
          </th>
          <th scope="col" className="py-2 text-right font-medium">
            {copy.lineTotal}
          </th>
          {action ? <th scope="col" className="py-2 pl-3" /> : null}
        </tr>
      </thead>

      <tbody className="md:divide-y md:divide-border/50">
        {lines.map((line, index) => (
          <tr
            key={`${line.sky_id}-${line.condition}-${index}`}
            className={
              // Below `md:` the row is a padded block with the picture beside
              // a stack of facts; from `md:` it returns to being a table row.
              "mb-2 grid grid-cols-[3rem_1fr_auto] items-start gap-x-3 gap-y-1 " +
              "rounded-sky-md bg-surface/60 p-3 " +
              "md:mb-0 md:table-row md:gap-0 md:rounded-none md:bg-transparent md:p-0"
            }
          >
            <td className="row-span-3 md:table-cell md:py-2 md:pr-3">
              <Thumb line={line} />
            </td>

            <td className="md:table-cell md:py-2 md:pr-3">
              <span className="font-medium">{line.name}</span>
              {/* The SKY-ID is secondary here and its own cell on desktop:
                  it identifies the article when two variants share a name. */}
              <span className="ml-2 text-xs text-muted tabular-nums md:hidden">{line.sky_id}</span>
              <span className="mt-0.5 hidden text-xs text-muted tabular-nums md:block">
                {line.sky_id}
              </span>
              {/* Nur wenn etwas passiert ist — eine unberührte Position bleibt still. */}
              {lineStatus(line) ? (
                <span className="mt-0.5 block text-xs font-medium text-own-ink">
                  {lineStatus(line)}
                </span>
              ) : null}
            </td>

            {/* On the phone the series and condition share the line under the
                name; on desktop each has its column. */}
            <td className="col-start-2 text-xs text-muted md:table-cell md:py-2 md:pr-3 md:text-sm md:text-inherit">
              {series(line)}
              <span className="md:hidden"> · {condition(line.condition)}</span>
            </td>
            <td className="hidden md:table-cell md:py-2 md:pr-3">{condition(line.condition)}</td>

            <td className="col-start-2 text-xs text-muted tabular-nums md:table-cell md:py-2 md:pr-3 md:text-right md:text-sm md:text-inherit">
              <span className="md:hidden">
                {line.quantity} × {formatPrice(Number(line.unit_price))}
              </span>
              <span className="hidden md:inline">{line.quantity}</span>
            </td>
            <td className="hidden tabular-nums md:table-cell md:py-2 md:pr-3 md:text-right">
              {formatPrice(Number(line.unit_price))}
            </td>

            <td className="col-start-3 row-start-1 text-right font-semibold tabular-nums md:table-cell md:py-2 md:font-medium">
              {formatPrice(Number(line.line_total))}
            </td>

            {action ? (
              <td className="col-span-3 md:table-cell md:py-2 md:pl-3 md:text-right">
                {action(line)}
              </td>
            ) : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
