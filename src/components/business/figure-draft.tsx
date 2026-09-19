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
            <li key={line.skyId} className="bg-surface/60 px-2 py-1.5">
              <div className="flex items-center gap-2">
                <span className="w-10 shrink-0 text-xs uppercase text-muted">{line.series}</span>
                <span className="min-w-0 flex-1 truncate text-sm">{line.name}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted">
                  {line.marketPrice === null ? copy.noMarketValue : formatPrice(line.marketPrice)}
                </span>

                {line.quantity > 1 ? (
                  <span className="flex shrink-0 items-center gap-1">
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
                  </span>
                ) : (
                  <button type="button" disabled={disabled} className={STEP}
                          aria-label={copy.more(line.name)}
                          onClick={() => onChange(setQuantity(lines, line.skyId, 2))}>
                    +
                  </button>
                )}

                <button type="button" disabled={disabled} className={STEP}
                        aria-label={copy.removeOne(line.name)}
                        onClick={() => { setChanging(null); onChange(removeFigure(lines, line.skyId)); }}>
                  ×
                </button>
              </div>

              <button type="button" disabled={disabled}
                      aria-expanded={changing === line.skyId}
                      onClick={() => setChanging(changing === line.skyId ? null : line.skyId)}
                      className="min-h-11 text-xs text-muted underline underline-offset-2 sm:min-h-8">
                {copy.change}
              </button>

              {/* Inline, never a modal: the row being corrected has to stay on
                  screen while its replacement is searched for. */}
              {changing === line.skyId ? (
                <div className="border-t border-border/70 pt-2">
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
