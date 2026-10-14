/**
 * Die kompakte Positionstabelle des NEUEN Einkaufs.
 *
 * FÜNF SPALTEN, EINE ZEILE JE FIGUR:
 *
 *   Name · SKY-ID · Zustand · Anzahl · Entfernen
 *
 * Serie und Marktwert stehen hier NICHT. Sie standen in der ersten Fassung
 * dieser Datei und haben die Zeile auf sieben Zellen gebracht; der Name hatte
 * danach weniger als acht Zeichen Platz. Der Marktwert ist nicht verloren —
 * er steht im Kästchen unter der Tabelle neben dem Faktor, wo er etwas
 * bedeutet, weil der Kaufpreis daneben steht.
 *
 * ---------------------------------------------------------------------------
 * WARUM DER UMBRUCH BEI `md:` UND NICHT BEI `sm:` LIEGT — gerechnet, nicht
 * geschätzt.
 *
 *   SKY-ID 5,5rem + Zustand 8rem + Anzahl 9rem + × 2rem = 24,5rem
 *   vier Lücken à 0,5rem                                =  2,0rem
 *                                                        ───────
 *                                                         26,5rem fest
 *
 *   bei sm: (40rem) bleiben dem Namen 13,5rem
 *   bei md: (48rem) bleiben dem Namen 21,5rem
 *
 * 13,5rem reichen für „Skylanders Spyro's Adv…" und nicht weiter. Die
 * einzeilige Tabelle greift deshalb erst, wo sie auch lesbar ist.
 *
 * ---------------------------------------------------------------------------
 * UNTER `md:` ZWEI ZEILEN — ENTWORFEN, NICHT UMGEBROCHEN.
 *
 *   Zeile 1   Name                                        SKY-0001
 *   Zeile 2   [ Angekommen ▾ ]            − 3 + ⇥      ×
 *
 * Eine echte einzeilige Tabelle ist bei 400px Breite nicht möglich: Name,
 * Auswahlfeld, Mengensteuerung und Entfernen brauchen zusammen über 20rem.
 * Die erste Fassung hatte dort `flex flex-wrap` — sieben Zellen, die sich
 * ihre Zeilen selbst suchen, bei jeder Fensterbreite anders. Zwei feste
 * Zeilen sind vorhersehbar; ein Umbruch ist ein Unfall.
 *
 * Das Umschalten macht `md:contents` am Steuerelement-Behälter: unter `md:`
 * ist er EINE Gitterzelle mit drei Dingen darin, ab `md:` verschwindet er als
 * Kasten und seine Kinder werden selbst Gitterzellen 4 und 5.
 *
 * ---------------------------------------------------------------------------
 * DIE MENGENZELLE LÄUFT NICHT ÜBER.
 *
 *   − 2rem · Zahl 2rem · + 2rem · ⇥ 2rem  = 8,00rem
 *   drei Lücken à 0,25rem                 = 0,75rem
 *                                          ───────
 *                                           8,75rem  in einer Spalte von 9rem
 *
 * In der ersten Fassung stand dasselbe in `w-28` (7rem) und ragte 1,75rem in
 * die Entfernen-Spalte. Vier Steuerelemente erscheinen ohnehin nur bei
 * mehreren Einheiten; bei einer steht dort ein einzelnes `+`.
 *
 * ---------------------------------------------------------------------------
 * KEINE ÄNDERUNG AN DER LOGIK. `addPurchaseFigure`, `setPurchaseQuantity`,
 * `setPurchaseLineState`, `splitPurchaseUnit` und `purchaseDraftPayload` sind
 * unverändert — dieselben Funktionen, dieselben Regeln, nur anders gezeichnet.
 *
 * ANGEKOMMEN IST NICHT EINGEBUCHT. Keiner der fünf Zustände bewegt Bestand.
 * `Einbuchen` schreibt eine Lagerbewegung und lebt auf der Detailseite des
 * Einkaufs, nachdem er existiert.
 */
"use client";

import { de } from "@/lib/i18n/de";
import type { FigureChoice } from "@/lib/orderbook/figure-search";
import {
  PURCHASE_DRAFT_STATES, addPurchaseFigure, isPurchaseDraftState,
  removePurchaseLine, setPurchaseLineState, setPurchaseQuantity, splitPurchaseUnit,
  type PurchaseDraftLine,
} from "@/lib/orderbook/purchase-draft";
import { FigureSearch } from "./figure-search";

const copy = de.business.orderbook.figures;
const states = de.business.orderbook.states;

/*
 * Zwei Spalten unter `md:`, fünf ab `md:`. Die Arithmetik steht im Kopf.
 * `items-center`, damit das Auswahlfeld und die Knöpfe auf einer Grundlinie
 * sitzen — `items-baseline` würde die Kästen gegeneinander verschieben.
 */
const ROW =
  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1.5 " +
  "md:grid-cols-[minmax(0,1fr)_5.5rem_8rem_9rem_2rem] md:gap-y-0";

/** Die ±, das Abtrennen und das × teilen diese Geometrie, damit die Zeile liegt. */
const STEP =
  "flex size-11 shrink-0 items-center justify-center rounded-sky-md text-sm " +
  "ring-1 ring-border/70 hover:ring-fg/30 disabled:opacity-40 focus-ring " +
  "md:size-8";

/** Schmal, weil es in einer Tabellenzelle steht und nicht in einem Formular. */
const STATE_SELECT =
  "min-h-11 w-full rounded-sky-md bg-surface px-2 text-xs ring-1 ring-border/70 " +
  "focus-ring disabled:opacity-40 md:min-h-8";

export function PurchaseDraftList({
  lines, catalog, onChange, disabled = false,
}: {
  lines: readonly PurchaseDraftLine[];
  catalog: readonly FigureChoice[];
  onChange: (next: PurchaseDraftLine[]) => void;
  disabled?: boolean;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 className="text-sm font-medium">{copy.heading}</h2>
        <p className="text-xs text-muted">{copy.hint}</p>
      </div>

      {/* Das Suchfeld bleibt oben und unverändert — dieselbe Auswahl wie im
          Verkaufsformular und auf der Detailseite. */}
      <FigureSearch
        catalog={catalog}
        disabled={disabled}
        onSelect={(choice) => onChange(addPurchaseFigure(lines, choice))}
      />

      {lines.length === 0 ? (
        <p className="text-xs text-muted">{copy.none}</p>
      ) : (
        <ul aria-label={copy.selected}
            className="divide-y divide-border/50 rounded-sky-lg ring-1 ring-border/60">
          {lines.map((line) => (
            <li key={line.key} className="bg-surface/60 px-2 py-1.5 md:py-1">
              <div className={ROW}>
                {/* 1 — Name. `truncate` statt Umbruch: die Zeile bleibt eine
                       Zeile, und der ganze Name steht im `title`. */}
                <span className="min-w-0 truncate text-sm" title={line.name}>
                  {line.name}
                </span>

                {/* 2 — SKY-ID. Unter `md:` rechts in derselben Zeile wie der
                       Name, ab `md:` eine eigene Spalte. Ausgeschrieben und
                       nicht als Tooltip: sie ist die Identität, nach der der
                       Betreiber im Zweifel greift, und ein Tooltip auf einem
                       Telefon ist keine Information. */}
                <span className="shrink-0 text-right text-xs tabular-nums text-muted md:text-left">
                  {line.skyId}
                </span>

                {/* 3 — Zustand. Ein Auswahlfeld, keine fünf Knöpfe. */}
                <select
                  value={line.state}
                  disabled={disabled}
                  aria-label={copy.stateOf(line.name)}
                  className={STATE_SELECT}
                  onChange={(event) => {
                    const next = event.target.value;
                    if (!isPurchaseDraftState(next)) return;
                    onChange(setPurchaseLineState(lines, line.key, next));
                  }}>
                  {PURCHASE_DRAFT_STATES.map((state) => (
                    <option key={state} value={state}>{states[state]}</option>
                  ))}
                </select>

                {/*
                  4 und 5 — Anzahl und Entfernen.

                  Unter `md:` ist dieser Behälter EINE Gitterzelle und hält
                  beides nebeneinander. Ab `md:` macht `md:contents` ihn als
                  Kasten unsichtbar, und seine zwei Kinder werden selbst die
                  Gitterzellen 4 und 5 — dieselben Spalten in jeder Zeile,
                  ohne ein zweites Gitter.
                */}
                <div className="flex shrink-0 items-center justify-end gap-2 md:contents">
                  <span className="flex items-center justify-end gap-1 md:w-36">
                    {line.quantity > 1 ? (
                      <>
                        <button type="button" disabled={disabled} className={STEP}
                                aria-label={copy.less(line.name)}
                                onClick={() => onChange(setPurchaseQuantity(lines, line.key, line.quantity - 1))}>
                          −
                        </button>
                        <span className="w-5 text-center text-sm tabular-nums"
                              aria-label={copy.quantity(line.name, line.quantity)}>
                          {line.quantity}
                        </span>
                        <button type="button" disabled={disabled} className={STEP}
                                aria-label={copy.more(line.name)}
                                onClick={() => onChange(setPurchaseQuantity(lines, line.key, line.quantity + 1))}>
                          +
                        </button>
                        {/* Nur hier: eine einzelne Einheit abzutrennen ergibt
                            nichts, und ein Knopf, der nichts tut, ist eine
                            Frage ohne Antwort. */}
                        <button type="button" disabled={disabled} className={STEP}
                                title={copy.splitHint}
                                aria-label={copy.splitOne(line.name)}
                                onClick={() => onChange(splitPurchaseUnit(lines, line.key))}>
                          ⇥
                        </button>
                      </>
                    ) : (
                      <button type="button" disabled={disabled} className={STEP}
                              aria-label={copy.more(line.name)}
                              onClick={() => onChange(setPurchaseQuantity(lines, line.key, 2))}>
                        +
                      </button>
                    )}
                  </span>

                  <button type="button" disabled={disabled} className={STEP}
                          aria-label={copy.removeOne(line.name)}
                          onClick={() => onChange(removePurchaseLine(lines, line.key))}>
                    ×
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
