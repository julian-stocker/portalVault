/**
 * Die Positionen eines Verkaufs, die kein Katalogartikel sind.
 *
 * EINE EIGENE LISTE, DIREKT UNTER DER FIGURENLISTE — und nicht dieselbe.
 * Eine Figurenzeile zeigt Serie und Marktwert; eine freie Position hat
 * beides nicht, und zwei leere Spalten in jeder zweiten Zeile lesen sich als
 * fehlende Daten, nicht als „gibt es hier nicht". Der Unterschied ist auch
 * fachlich keiner der Darstellung: diese Positionen haben keine SKY-ID, also
 * keinen Lagerbezug, keine Reservierung und keine Bewegung — das sagt die
 * Überschrift der Liste einmal, statt es in jeder Zeile zu verschweigen.
 *
 * ANGELEGT WIRD SIE NEBENAN: `FigureSearch` bietet den Namen an, wenn der
 * Katalog nichts gefunden hat (`onFree`). Hier wird nur gezeigt, gezählt und
 * entfernt. Nichts davon berührt die Datenbank — wie beim Figurenentwurf
 * existiert der Verkauf noch nicht.
 */
"use client";

import { de } from "@/lib/i18n/de";
import {
  freeItemCount, removeFreeItem, setFreeQuantity, type FreeItemLine,
} from "@/lib/orderbook/free-items";

const copy = de.business.orderbook.figures;

/** Dieselbe Geometrie wie die Mengen- und Entfernen-Knöpfe im Figurenentwurf. */
const STEP =
  "flex size-11 shrink-0 items-center justify-center rounded-sky-md text-sm "
  + "ring-1 ring-border/70 hover:ring-fg/30 disabled:opacity-40 focus-ring "
  + "sm:size-8";

export function FreeItems({ lines, budget, onChange, disabled = false }: {
  lines: readonly FreeItemLine[];
  /** Wie viele Stücke insgesamt noch hineinpassen — siehe `MAX_DRAFT_UNITS`. */
  budget: number;
  onChange: (next: FreeItemLine[]) => void;
  disabled?: boolean;
}) {
  if (lines.length === 0) return null;

  const remaining = Math.max(0, budget - freeItemCount(lines));

  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h3 className="text-sm font-medium">{copy.freeHeading}</h3>
        <p className="text-xs text-muted">{copy.freeHint}</p>
      </div>

      <ul aria-label={copy.freeSelected}
          className="divide-y divide-border/50 rounded-sky-lg ring-1 ring-border/60">
        {lines.map((line) => (
          <li key={line.key} className="bg-surface/60 px-2 py-1.5 sm:py-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="min-w-0 flex-1 truncate text-sm" title={line.name}>
                {line.name}
              </span>

              {/* Ein Feld, in dem eine Zahl steht, ist hier zu viel: die
                  Stückzahl einer freien Position ist fast immer 1 und wird
                  höchstens einmal angetippt. */}
              <span className="flex shrink-0 items-center justify-end gap-1">
                {line.quantity > 1 ? (
                  <>
                    <button type="button" disabled={disabled} className={STEP}
                            aria-label={copy.less(line.name)}
                            onClick={() => onChange(
                              setFreeQuantity(lines, line.key, line.quantity - 1, remaining))}>
                      −
                    </button>
                    <span className="w-5 text-center text-sm tabular-nums"
                          aria-label={copy.quantity(line.name, line.quantity)}>
                      {line.quantity}
                    </span>
                  </>
                ) : null}
                <button type="button" disabled={disabled || remaining <= 0} className={STEP}
                        aria-label={copy.more(line.name)}
                        onClick={() => onChange(
                          setFreeQuantity(lines, line.key, line.quantity + 1, remaining))}>
                  +
                </button>
              </span>

              <button type="button" disabled={disabled} className={STEP}
                      aria-label={copy.removeOne(line.name)}
                      onClick={() => onChange(removeFreeItem(lines, line.key))}>
                ×
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
