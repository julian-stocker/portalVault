/**
 * The figures of a purchase or a sale being written (0064, generalised 0065).
 *
 * ONE PICKER FOR BOTH SIDES OF THE ORDERBUCH. It was `PurchaseDraft` until
 * the external-sale form needed the same thing; copying it would have been a
 * third figure-selection experience in a product that had just been reduced
 * to one. Nothing about choosing figures differs between buying and selling,
 * so nothing here knows which it is.
 *
 * A list, not cards. The operator is standing over a box with a phone: every
 * row is one line, 44 px tall, and carries only what distinguishes it —
 * series, name, what it is worth — plus the two things that can go wrong,
 * which are "how many" and "which one".
 *
 * NOTHING HERE TOUCHES THE DATABASE. Adding, removing, changing and counting
 * all happen in the parent's state; the record does not exist yet. That is
 * the whole reason the create screen can afford a `×` with no confirmation —
 * there is nothing to undo, no audit event and no stock.
 *
 * `− n +` APPEARS ONLY WHEN IT EARNS ITS SPACE. A single unit shows a plain
 * row with a `×`, which is the common case and the mockup's shape. The
 * stepper is what the second identical figure turns it into.
 *
 * ONE LINE PER FIGURE ON A DESKTOP, TWO ON A PHONE — AND THE SAME MARKUP.
 *
 * `Ändern` used to sit on a line of its own at every width. On a phone that
 * is right: the row is already full. On a desktop it meant a 32px line whose
 * only content was a text link, so five figures spent 160px saying "Ändern"
 * five times, and the list read as five cards rather than five rows.
 *
 * Above `sm:` the row becomes a six-column grid —
 * `Serie · Name · Preis · Ändern · Menge · ×` — and the columns are tracks
 * rather than flex items, so the prices line up under each other and so does
 * the `×`, whether the row above it carries a stepper or a lone `+`. The
 * quantity control is ONE cell in both cases, which is why the single `+` is
 * wrapped in the same span as the stepper.
 *
 * Below `sm:` nothing moves: the same children wrap exactly as they did, the
 * targets stay 44px, and `Ändern` — last in the DOM, pulled into fourth place
 * by `sm:order-4` — falls onto its own line again. The desktop order is a
 * presentation detail; the reading order for a screen reader follows the DOM,
 * where the destructive `×` still comes before the correction link it belongs
 * to.
 */
"use client";

import { useState } from "react";

import { de } from "@/lib/i18n/de";
import { formatPrice } from "@/lib/format";
import {
  addFigure, removeFigure, replaceFigure, setQuantity, type DraftLine,
} from "@/lib/orderbook/draft";
import type { FigureChoice } from "@/lib/orderbook/figure-search";
import { FigureSearch } from "./figure-search";

const copy = de.business.orderbook.figures;

/**
 * The row itself: a wrapping flex line on a phone, a table row on a desktop.
 *
 * The tracks are fixed where alignment matters (series, price, quantity) and
 * `auto` where the content decides (`Ändern`, `×`); the name takes what is
 * left and truncates rather than pushing the row wider — `minmax(0,1fr)` is
 * what allows it to shrink at all.
 */
const ROW =
  "flex flex-wrap items-center gap-x-2 gap-y-1 " +
  "sm:grid sm:grid-cols-[2.5rem_minmax(0,1fr)_4.5rem_auto_6rem_auto] sm:gap-y-0";

/** The ± control and the × share this geometry so the row stays level. */
const STEP =
  "flex size-11 shrink-0 items-center justify-center rounded-sky-md text-sm " +
  "ring-1 ring-border/70 hover:ring-fg/30 disabled:opacity-40 focus-ring " +
  "sm:size-8";

export function FigureDraft({
  lines,
  catalog,
  onChange,
  disabled = false,
  hint = copy.hint,
}: {
  lines: DraftLine[];
  catalog: readonly FigureChoice[];
  onChange: (next: DraftLine[]) => void;
  disabled?: boolean;
  /** One line under the heading. The sale form says something else here. */
  hint?: string;
}) {
  /** The line whose identity is being corrected, by SKY-ID. One at a time. */
  const [changing, setChanging] = useState<string | null>(null);

  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 className="text-sm font-medium">{copy.heading}</h2>
        <p className="text-xs text-muted">{hint}</p>
      </div>

      <FigureSearch
        catalog={catalog}
        disabled={disabled}
        onSelect={(choice) => onChange(addFigure(lines, choice))}
      />

      {lines.length === 0 ? (
        <p className="text-xs text-muted">{copy.none}</p>
      ) : (
        <ul aria-label={copy.selected}
            className="divide-y divide-border/50 rounded-sky-lg ring-1 ring-border/60">
          {lines.map((line) => (
            <li key={line.skyId} className="bg-surface/60 px-2 py-1.5 sm:py-1">
              <div className={ROW}>
                <span className="w-10 shrink-0 text-xs uppercase text-muted">{line.series}</span>
                <span className="min-w-0 flex-1 truncate text-sm" title={line.name}>{line.name}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted sm:text-right">
                  {line.marketPrice === null ? copy.noMarketValue : formatPrice(line.marketPrice)}
                </span>

                {/* One cell either way: a lone `+` and the stepper share this
                    span, so the column after it starts at the same x on every
                    row. */}
                <span className="flex shrink-0 items-center justify-end gap-1 sm:order-5 sm:w-24">
                  {line.quantity > 1 ? (
                    <>
                      <button type="button" disabled={disabled} className={STEP}
                              aria-label={copy.less(line.name)}
                              onClick={() => onChange(setQuantity(lines, line.skyId, line.quantity - 1))}>
                        −
                      </button>
                      <span className="w-5 text-center text-sm tabular-nums"
                            aria-label={copy.quantity(line.name, line.quantity)}>
                        {line.quantity}
                      </span>
                      <button type="button" disabled={disabled} className={STEP}
                              aria-label={copy.more(line.name)}
                              onClick={() => onChange(setQuantity(lines, line.skyId, line.quantity + 1))}>
                        +
                      </button>
                    </>
                  ) : (
                    <button type="button" disabled={disabled} className={STEP}
                            aria-label={copy.more(line.name)}
                            onClick={() => onChange(setQuantity(lines, line.skyId, 2))}>
                      +
                    </button>
                  )}
                </span>

                <button type="button" disabled={disabled} className={`${STEP} sm:order-6`}
                        aria-label={copy.removeOne(line.name)}
                        onClick={() => { setChanging(null); onChange(removeFigure(lines, line.skyId)); }}>
                  ×
                </button>

                {/* Last in the DOM, fourth on screen above `sm:` — see the
                    file header. `basis-full` is what gives it its own line on
                    a phone; a grid item ignores it.

                    „Ändern" statt „Figur ändern": in einer Spalte zwischen
                    Preis und Menge zahlt jedes Wort Breite. Der Figurenname
                    steht trotzdem im zugänglichen Namen — fünf Knöpfe, die
                    alle nur „Ändern" heißen, sind ohne Blick auf die Zeile
                    nicht auseinanderzuhalten. Sichtbarer Text bleibt der
                    Anfang des Namens, damit Sprachsteuerung ihn trifft. */}
                <button type="button" disabled={disabled}
                        aria-expanded={changing === line.skyId}
                        onClick={() => setChanging(changing === line.skyId ? null : line.skyId)}
                        className="min-h-11 basis-full text-left text-xs text-muted underline underline-offset-2 sm:order-4 sm:min-h-8 sm:basis-auto">
                  {copy.changeShort}
                  <span className="sr-only"> · {line.name}</span>
                </button>
              </div>

              {/* Inline, never a modal: the row being corrected has to stay on
                  screen while its replacement is searched for. */}
              {changing === line.skyId ? (
                <div className="border-t border-border/70 pt-2 sm:mt-1">
                  <FigureSearch
                    catalog={catalog}
                    autoFocus
                    disabled={disabled}
                    label={copy.changeOne(line.name)}
                    onCancel={() => setChanging(null)}
                    onSelect={(choice) => {
                      onChange(replaceFigure(lines, line.skyId, choice));
                      setChanging(null);
                    }}
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
