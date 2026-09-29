/**
 * Der Figuren-Kalkulator (V1).
 *
 * WOFÜR ER GEBAUT IST. Nicht für zwei Figuren, sondern für dreißig aus einem
 * Kleinanzeigen-Angebot. Der ganze Bildschirm ist auf einen Rhythmus hin
 * gebaut: Namen tippen → Enter → nächster Name. Das Suchfeld leert sich
 * selbst und behält den Fokus (das macht `FigureSearch` seit `0064`), die
 * neue Position erscheint oben, und keine Bestätigung steht dazwischen.
 *
 * WAS ER RECHNET UND WORAUS. Jede Position startet mit
 * `skylanders.market_price` — im Projekt der kanonische Marktwert und genau
 * der, gegen den das Orderbuch seinen Einkaufsfaktor bildet. NICHT der
 * Shoppreis (`shop_price()` ist die Verkaufsseite) und NICHT der
 * Katalog-Aufschlag aus `0094`, der ausdrücklich nur eine Anzeigeeinstellung
 * ist. Die Rechnung selbst steht in `lib/calculator/calculation.ts`, in Cent
 * und ohne React.
 *
 * WAS ER NICHT TUT. Er schreibt nichts — kein Lager, keine Bewegung, keine
 * Bestellung, kein Warenkorb, kein Katalogpreis. Ein von Hand gesetzter
 * Einzelwert gilt für diese eine Sitzung. Ein Neuladen verwirft die
 * Kalkulation, und das ist für V1 die Entscheidung, nicht ein Versäumnis.
 */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { FigureSearch } from "@/components/business/figure-search";
import { Modal } from "@/components/ui/modal";
import { ACTION_NEUTRAL, COMMERCE_INK } from "@/components/ui/action";
import { formatPrice } from "@/lib/format";
import { de } from "@/lib/i18n/de";
import { loadCalculatorContext } from "@/lib/calculator/actions";
import type { FigureChoice } from "@/lib/orderbook/figure-search";
import {
  addFigure, centsToEuro, changeQuantity, clampFactor, FALLBACK_FACTOR, initialFactor,
  lineTotalCents, maxPurchaseCents, parseAmountToCents, parseFactor, removeLine,
  resetUnitCents, setQuantity, setUnitCents, totals, type CalculationLine,
} from "@/lib/calculator/calculation";

const copy = de.calculator;

/** Die Stufen, die ein Händler tatsächlich benutzt. Tippen geht daneben weiter. */
const FACTOR_PRESETS = [40, 50, 60, 70] as const;

/**
 * Wie viele Treffer die Suche zeigt.
 *
 * Weniger als die acht der Orderbuch-Bildschirme: dort steht der Kasten auf
 * einer ganzen Seite, hier in einem Dialog über einer Liste, die ebenfalls
 * sichtbar bleiben muss.
 */
const CALC_RESULTS = 6;

export function CalculatorModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const headingId = "calculator-title";
  const [catalog, setCatalog] = useState<readonly FigureChoice[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [lines, setLines] = useState<CalculationLine[]>([]);
  /*
   * Der historische Schnitt aus dem Orderbuch, nur als Referenz. `null`
   * heißt: es gibt keinen belastbaren — dann wird unten der Rückfall
   * gezeigt, und zwar als das, was er ist.
   */
  const [historicFactor, setHistoricFactor] = useState<number | null>(null);
  const [factor, setFactor] = useState<number>(FALLBACK_FACTOR);
  const [confirmClear, setConfirmClear] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);

  /*
   * Einmal je Seitenaufruf, und erst beim ersten Öffnen. Der Katalog ist
   * groß genug, dass es sich lohnt, ihn nicht mitzuschleppen — und klein
   * genug, dass ein zweites Öffnen ihn nicht noch einmal holen muss.
   */
  useEffect(() => {
    if (!open || catalog !== null) return;
    let alive = true;
    void loadCalculatorContext()
      .then((context) => {
        if (!alive) return;
        setCatalog(context.catalog);
        setFailed(context.catalog.length === 0);
        setHistoricFactor(context.historicFactor);
        /*
         * DER EIGENE SCHNITT IST DER AUSGANGSPUNKT, NICHT DIE VORGABE.
         *
         * Nur beim ersten Laden. Wer den Faktor danach verstellt, soll ihn
         * beim nächsten Öffnen so vorfinden, wie er ihn gelassen hat — und
         * ein zweites Laden gibt es ohnehin nicht.
         */
        setFactor(initialFactor(context.historicFactor));
      })
      .catch(() => { if (alive) { setCatalog([]); setFailed(true); } });
    return () => { alive = false; };
  }, [open, catalog]);

  /*
   * SOFORT TIPPEN KÖNNEN — der ganze Zweck dieses Fensters.
   *
   * `autoFocus` allein reicht hier nicht: `Modal` holt den Fokus in seinem
   * eigenen Effekt auf das Panel, und Kindeffekte laufen vor denen des
   * Elternteils. Dieser Effekt gehört dem Elternteil, läuft also danach und
   * gewinnt. Er hängt zusätzlich am Katalog, weil das Feld erst existiert,
   * wenn geladen ist.
   */
  useEffect(() => {
    if (!open || catalog === null) return;
    searchInput.current?.focus();
  }, [open, catalog]);

  /*
   * Eine begonnene Bestätigung gilt nicht für das nächste Öffnen. Direkt im
   * Schließen erledigt statt in einem Effekt auf `open`: ein Effekt, der
   * synchron Zustand setzt, löst eine zweite Renderrunde aus, und hier gibt
   * es nichts zu beobachten — das Schließen ist eine Handlung mit einem Ort.
   */
  const close = useCallback(() => {
    setConfirmClear(false);
    onClose();
  }, [onClose]);

  const add = useCallback((choice: FigureChoice) => {
    setLines((current) => addFigure(current, choice));
    setConfirmClear(false);
  }, []);

  const sums = useMemo(() => totals(lines), [lines]);
  const maxCents = maxPurchaseCents(sums.totalCents, factor);

  return (
    <Modal open={open} onClose={close} labelledBy={headingId} size="xl">
      {/*
        DIE HÖHENKETTE, UND WARUM SIE HIER GESCHLOSSEN WERDEN MUSS.

        Das Panel ist `flex flex-col` mit einer Deckelhöhe und
        `overflow-hidden`. Ohne `flex-1` bliebe dieser Kasten
        inhaltsgroß — bei dreißig Positionen wäre die Liste einfach
        abgeschnitten und der Fuß mit der wichtigsten Zahl außer Sicht,
        statt dass die Liste rollt. `min-h-0` daneben, sonst weigert sich
        ein Flex-Kind, unter seine Inhaltsgröße zu schrumpfen, und der
        innere Rollbereich bekäme nie eine Grenze.
      */}
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="flex items-start justify-between gap-4 border-b border-gold-line px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 id={headingId} className="text-base font-semibold text-on-deep">{copy.title}</h2>
            <p className="mt-0.5 text-xs text-on-deep-muted">{copy.hint}</p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label={copy.close}
            className="focus-ring -mr-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-on-deep-muted hover:text-on-deep"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none"
                 stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        {/* Die Suche bleibt stehen, die Liste darunter rollt. Bei dreißig
            Positionen ist das der Unterschied zwischen Tippen und Suchen. */}
        {/*
          Gedeckelt, damit acht Treffer auf einem Telefon nicht die ganze
          Fläche einnehmen und die Positionsliste auf null drücken. Sechs
          Treffer reichen für den Ablauf hier — wer eintippt, was er in der
          Hand hält, nimmt ohnehin den ersten.
        */}
        <div className="max-h-[45dvh] shrink-0 overflow-y-auto border-b border-gold-line px-4 py-3 sm:px-5">
          {catalog === null ? (
            <p className="text-sm text-on-deep-muted">{copy.loading}</p>
          ) : failed ? (
            <p role="alert" className="text-sm text-danger">{copy.loadFailed}</p>
          ) : (
            <FigureSearch
              catalog={catalog}
              onSelect={add}
              label={copy.searchLabel}
              placeholder={copy.searchPlaceholder}
              showImage
              inputRef={searchInput}
              limit={CALC_RESULTS}
            />
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-5">
          {lines.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-on-deep">{copy.empty}</p>
              <p className="mt-1 text-xs text-on-deep-muted">{copy.emptyHint}</p>
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {lines.map((line) => (
                <PositionRow
                  key={line.skyId}
                  line={line}
                  onQuantity={(delta) => setLines((c) => changeQuantity(c, line.skyId, delta))}
                  onQuantitySet={(q) => setLines((c) => setQuantity(c, line.skyId, q))}
                  onUnit={(cents) => setLines((c) => setUnitCents(c, line.skyId, cents))}
                  onReset={() => setLines((c) => resetUnitCents(c, line.skyId))}
                  onRemove={() => setLines((c) => removeLine(c, line.skyId))}
                />
              ))}
            </ul>
          )}
        </div>

        {/*
          WAS EIN SCREENREADER SONST NICHT MITBEKÄME.
          Der ganze Ablauf ist Tippen und Enter; die Liste wächst dabei
          lautlos. Eine höfliche Region sagt nach jeder Aufnahme, wie viele
          Positionen und Stücke es jetzt sind — nicht bei jedem Tastendruck
          an einem Wertfeld, denn `positions` und `units` ändern sich dabei
          nicht.
        */}
        <p className="sr-only" role="status" aria-live="polite">
          {lines.length === 0
            ? copy.empty
            : `${sums.positions} ${copy.positionsLabel}, ${sums.units} ${copy.unitsLabel}`}
        </p>

        <Summary
          historicFactor={historicFactor}
          positions={sums.positions}
          units={sums.units}
          totalCents={sums.totalCents}
          withoutValue={sums.withoutValue}
          factor={factor}
          onFactor={setFactor}
          maxCents={maxCents}
          confirmClear={confirmClear}
          onClearRequest={() => setConfirmClear(true)}
          onClearConfirm={() => { setLines([]); setConfirmClear(false); }}
          onClearCancel={() => setConfirmClear(false)}
        />
      </div>
    </Modal>
  );
}

/* ----------------------------------------------------------------- Position */

function PositionRow({
  line, onQuantity, onQuantitySet, onUnit, onReset, onRemove,
}: {
  line: CalculationLine;
  onQuantity: (delta: number) => void;
  onQuantitySet: (quantity: number) => void;
  onUnit: (cents: number) => void;
  onReset: () => void;
  onRemove: () => void;
}) {
  /*
   * Das Feld hält seinen eigenen Text, solange jemand darin tippt: würde es
   * bei jedem Tastendruck aus Cent zurückgerechnet, könnte man kein Komma
   * setzen, ohne dass der Cursor springt. Beim Verlassen gilt wieder der
   * gerechnete Wert.
   */
  const [draft, setDraft] = useState<string | null>(null);
  const [qtyDraft, setQtyDraft] = useState<string | null>(null);
  const shown = draft ?? (line.unitCents === 0 ? "" : centsToEuro(line.unitCents).toFixed(2));

  function commit(raw: string) {
    const cents = parseAmountToCents(raw);
    if (cents !== null) onUnit(cents);
    setDraft(null);
  }

  function commitQuantity(raw: string) {
    // Leer heißt: der Händler hat gelöscht, um neu zu tippen, und es dann
    // gelassen. Die Menge bleibt, was sie war.
    if (raw.trim() !== "") onQuantitySet(Number(raw));
    setQtyDraft(null);
  }

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-sky-md bg-surface/70 px-3 py-2 ring-1 ring-border/70">
      <span className="h-10 w-10 shrink-0 overflow-hidden rounded-sky-sm bg-deep/40 ring-1 ring-border/60">
        {line.image ? (
          /* Wie `FigureImage`: vorab optimiert und statisch ausgeliefert,
             `next/image` brächte hier nichts als Kosten (ADR-0026). */
          // eslint-disable-next-line @next/next/no-img-element
          <img src={line.image} alt="" className="h-full w-full object-contain" loading="lazy" />
        ) : null}
      </span>

      <span className="flex min-w-0 flex-1 basis-40 flex-col">
        <span className="truncate text-sm font-medium text-on-deep">{line.name}</span>
        <span className="flex items-center gap-1.5 text-[11px] text-on-deep-muted">
          <span className="uppercase">{line.series}</span>
          <span className="tabular-nums">{line.skyId}</span>
          {line.manual ? (
            <button type="button" onClick={onReset} aria-label={copy.resetLabel(line.name)}
                    className="focus-ring rounded-sky-sm px-1 underline underline-offset-2">
              {copy.manual}
            </button>
          ) : line.suggestedCents === null ? (
            <span className="text-danger">{copy.noPrice}</span>
          ) : null}
        </span>
      </span>

      {/* Menge */}
      <span className="flex shrink-0 items-center gap-1">
        <button type="button" onClick={() => { setQtyDraft(null); onQuantity(-1); }}
                aria-label={copy.less(line.name)}
                className="focus-ring flex h-9 w-9 items-center justify-center rounded-sky-sm ring-1 ring-border/70 hover:ring-border-strong">
          −
        </button>
        <label className="sr-only" htmlFor={`qty-${line.skyId}`}>{copy.quantity}</label>
        {/*
          Wie das Wertfeld darunter mit eigenem Entwurf, und aus demselben
          Grund: ein gebundenes `type="number"` springt beim Leeren sofort
          auf 1 zurück, weil `Number("")` NaN ist und die Menge nie unter 1
          fällt. Wer „12" statt „1" tippen will, müsste das Feld also gegen
          sich selbst bedienen. Übernommen wird beim Verlassen.
        */}
        <input
          id={`qty-${line.skyId}`}
          type="text"
          inputMode="numeric"
          value={qtyDraft ?? String(line.quantity)}
          onChange={(e) => setQtyDraft(e.target.value.replace(/[^\d]/g, ""))}
          onBlur={(e) => { commitQuantity(e.target.value); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commitQuantity(e.currentTarget.value); }
          }}
          className="h-9 w-12 rounded-sky-sm bg-surface px-1 text-center text-sm tabular-nums ring-1 ring-border/70 focus-ring"
        />
        <button type="button" onClick={() => { setQtyDraft(null); onQuantity(1); }}
                aria-label={copy.more(line.name)}
                className="focus-ring flex h-9 w-9 items-center justify-center rounded-sky-sm ring-1 ring-border/70 hover:ring-border-strong">
          +
        </button>
      </span>

      {/* Einzelwert */}
      <span className="flex shrink-0 items-center gap-1">
        <label className="sr-only" htmlFor={`unit-${line.skyId}`}>{copy.unitValue}</label>
        <input
          id={`unit-${line.skyId}`}
          type="text"
          inputMode="decimal"
          value={shown}
          placeholder="0,00"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(e.currentTarget.value); } }}
          className="h-9 w-20 rounded-sky-sm bg-surface px-2 text-right text-sm tabular-nums ring-1 ring-border/70 focus-ring"
        />
        <span aria-hidden="true" className="text-xs text-on-deep-muted">€</span>
      </span>

      <span className="w-20 shrink-0 text-right text-sm font-semibold tabular-nums text-on-deep">
        {formatPrice(centsToEuro(lineTotalCents(line)))}
      </span>

      <button type="button" onClick={onRemove} aria-label={copy.remove(line.name)}
              className="focus-ring flex h-9 w-9 shrink-0 items-center justify-center rounded-sky-sm text-on-deep-muted hover:text-danger">
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none"
             stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </li>
  );
}

/* ------------------------------------------------------------------ Summe */

function Summary({
  historicFactor, positions, units, totalCents, withoutValue, factor, onFactor, maxCents,
  confirmClear, onClearRequest, onClearConfirm, onClearCancel,
}: {
  historicFactor: number | null;
  positions: number; units: number; totalCents: number; withoutValue: number;
  factor: number; onFactor: (value: number) => void; maxCents: number;
  confirmClear: boolean;
  onClearRequest: () => void; onClearConfirm: () => void; onClearCancel: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <footer className="shrink-0 border-t border-gold-line bg-deep/40 px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <dl className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm">
          <div className="flex items-baseline gap-1.5">
            <dt className="text-xs text-on-deep-muted">{copy.positionsLabel}</dt>
            <dd className="font-semibold tabular-nums text-on-deep">{positions}</dd>
          </div>
          <div className="flex items-baseline gap-1.5">
            <dt className="text-xs text-on-deep-muted">{copy.unitsLabel}</dt>
            <dd className="font-semibold tabular-nums text-on-deep">{units}</dd>
          </div>
          <div className="flex items-baseline gap-1.5">
            <dt className="text-xs text-on-deep-muted">{copy.totalLabel}</dt>
            <dd className="text-lg font-semibold tabular-nums text-on-deep">
              {formatPrice(centsToEuro(totalCents))}
            </dd>
          </div>
        </dl>

        {/*
          ZWEI FAKTOREN, EINER DAVON EDITIERBAR.
          Oben die Referenz — der Schnitt, zu dem tatsächlich eingekauft
          wurde —, darunter das Feld, mit dem dieses eine Paket gerechnet
          wird. Die Referenz ist kleiner und ruhiger: sie soll erinnern, nicht
          konkurrieren. Ohne Datenlage steht dort, dass es keine gibt, und
          nicht der Rückfallwert als wäre er einer.
        */}
        <div className="flex flex-col gap-1">
          <p className="text-[11px] text-on-deep-muted">
            {historicFactor === null
              ? copy.historicFactorNone
              : copy.historicFactor(historicFactor)}
          </p>
          <div className="flex items-center gap-2">
          <label htmlFor="calc-factor" className="text-xs text-on-deep-muted">
            {copy.factorLabel}
          </label>
          <span className="flex items-center gap-1">
            {FACTOR_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => { setDraft(null); onFactor(preset); }}
                aria-pressed={factor === preset}
                className={`focus-ring h-9 rounded-sky-sm px-2 text-xs tabular-nums ring-1 ${
                  factor === preset
                    ? "bg-surface text-on-deep ring-border-strong"
                    : "text-on-deep-muted ring-border/70 hover:ring-border-strong"
                }`}
              >
                {preset}%
              </button>
            ))}
          </span>
          <input
            id="calc-factor"
            type="text"
            inputMode="numeric"
            value={draft ?? String(factor)}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={(e) => {
              const parsed = parseFactor(e.target.value);
              if (parsed !== null) onFactor(clampFactor(parsed));
              setDraft(null);
            }}
            className="h-9 w-14 rounded-sky-sm bg-surface px-2 text-right text-sm tabular-nums ring-1 ring-border/70 focus-ring"
          />
          <span aria-hidden="true" className="text-xs text-on-deep-muted">%</span>
          </div>
        </div>

        {/*
          DIE ZAHL, WEGEN DER JEMAND DAS FENSTER ÖFFNET.
          Deshalb die einzige hier, die eine eigene Fläche und die
          Commerce-Farbe bekommt — sie ist die Entscheidung, alles andere ist
          ihre Herleitung.
        */}
        <div className="rounded-sky-md bg-surface px-4 py-2 ring-1 ring-commerce-line">
          <p className="text-[11px] text-on-deep-muted">{copy.maxPurchase}</p>
          {/* Inline wie überall in dieser Rolle: die Farbe kommt aus dem
              Token, nicht aus einer Klasse, die erst erzeugt werden muss. */}
          <p className="text-2xl font-semibold tabular-nums" style={COMMERCE_INK}>
            {formatPrice(centsToEuro(maxCents))}
          </p>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-on-deep-muted">
          {copy.maxPurchaseHint}
          {withoutValue > 0 ? ` · ${copy.withoutValue(withoutValue)}` : ""}
        </p>

        {positions === 0 ? null : confirmClear ? (
          <span className="flex items-center gap-2">
            <span role="alert" className="text-xs text-on-deep">{copy.clearConfirm(positions)}</span>
            <button type="button" onClick={onClearConfirm}
                    className={`${ACTION_NEUTRAL} h-9 w-auto min-h-9 px-3 text-xs`}>
              {copy.clear}
            </button>
            <button type="button" onClick={onClearCancel}
                    className="focus-ring h-9 rounded-sky-sm px-2 text-xs text-on-deep-muted underline underline-offset-2">
              {copy.cancel}
            </button>
          </span>
        ) : (
          <button type="button" onClick={onClearRequest}
                  className="focus-ring h-9 rounded-sky-sm px-2 text-xs text-on-deep-muted underline underline-offset-2">
            {copy.clear}
          </button>
        )}
      </div>
    </footer>
  );
}
