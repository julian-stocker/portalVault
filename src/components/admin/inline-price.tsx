/**
 * Der Marktwert, direkt an der Kachel (CAT-09).
 *
 * ===========================================================================
 * DIE FALLE, DIE DER BETREIBER BENANNT HAT — UND SIE IST ECHT
 * ===========================================================================
 *
 * `skylanders.market_price` ist der GESPEICHERTE Wert. Was die Kachel
 * ANZEIGT, ist seit dem vorübergehenden Zuschlag etwas anderes:
 *
 *     Anzeige = market_price × (1 + Zuschlag/100)
 *
 * gerechnet in `src/lib/catalog/market-boost.ts`, im letzten Moment, in der
 * Komponente, die ihn druckt — und **nie gespeichert**. Schriebe dieses Feld
 * den angezeigten Betrag zurück, wäre der Zuschlag beim nächsten Lesen
 * zweimal drin, beim nächsten Speichern dreimal, und niemand sähe, wann es
 * angefangen hat.
 *
 * DESHALB ZEIGT DAS FELD DEN GESPEICHERTEN WERT. Im Normalzustand steht der
 * ANGEZEIGTE Betrag da — das ist, was der Besucher sieht, und der Betreiber
 * soll dasselbe sehen. Sobald er den Stift drückt, wechselt die Zelle auf den
 * GESPEICHERTEN Wert, und ein Satz darunter sagt, dass der Katalog einen
 * Zuschlag darauf rechnet. Zwei Zahlen, zwei Rollen, und die Oberfläche sagt,
 * welche sie bearbeitet.
 *
 * ===========================================================================
 * „PREIS OFFEN" IST NICHT NULL EURO (ADR-0010)
 * ===========================================================================
 *
 * Ein leeres Feld schreibt `NULL` — „kein bekannter Marktwert". Eine 0 weist
 * die Datenbank mit einem Satz ab (`0162`), und die Constraint
 * `skylanders_market_price_positive` wäre die letzte Schicht dahinter. Beide
 * Richtungen gehen also: ein offener Preis wird gesetzt, ein gesetzter wird
 * wieder offen — durch Leeren des Feldes, nicht durch eine 0.
 *
 * KOMMA UND PUNKT. `4,99` und `4.99` sind dasselbe; Tausenderpunkte gibt es
 * bei einem Figurenpreis nicht, und ein `1.234,56` würde als `1234.56`
 * gelesen. Die Umrechnung steht in `src/lib/admin/price-input.ts`, damit sie
 * geprüft werden kann, ohne eine Oberfläche zu rendern.
 */
"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { Spinner } from "@/components/ui/pending";
import { setMarketPrice } from "@/lib/admin/actions";
import { parsePriceInput, formatPriceInput } from "@/lib/admin/price-input";
import { NO_MARKET_BOOST, catalogDisplayMarketPrice } from "@/lib/catalog/market-boost";
import { formatPrice } from "@/lib/format";
import { de } from "@/lib/i18n/de";

/** Ein Feld der Leiste, in der Größe der anderen Marken — 44 px, 22 px Glyph. */
const MARKE =
  "group/px pointer-events-auto flex h-11 w-11 shrink-0 items-center justify-center "
  + "focus-visible:outline-none";
const GRUND =
  "grid place-items-center rounded-full p-1.5 transition-colors duration-150 "
  + "group-hover/px:bg-white/16 group-focus-visible/px:bg-white/16";
/**
 * EINE GROESSE IN DIESER ZELLE, UND SIE IST NICHT DIE DER LEISTE — 18 px
 * statt 22.
 *
 * Die vier Marken der Aktionsleiste (Info, Stift, Auge, Papierkorb) stehen
 * nebeneinander in 44-px-Feldern und tragen 22 px. Die drei hier stehen
 * NEBEN EINER ZAHL, und die ist 17 px hoch: ein 22-px-Glyph daneben waere
 * groesser als der Betrag, den er bearbeitet. Deshalb eine eigene Groesse —
 * aber EINE: Stift, Haken und Kreuz sind alle 18 px, und das Feld bleibt
 * 44 px. Meine erste Fassung hatte 16 fuer den Stift und 18 fuer die beiden
 * anderen, und genau diese Sorte Unterschied hat der Betreiber benannt.
 */
const ICON = {
  viewBox: "0 0 22 22", fill: "none", stroke: "currentColor",
  strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round",
  className: "block h-[18px] w-[18px]", "aria-hidden": "true",
} as const;

export function InlinePrice({
  skyId,
  name,
  marketPrice,
  marketBoostPercent = NO_MARKET_BOOST,
  dimmed = false,
}: {
  skyId: string;
  name: string;
  /** Der GESPEICHERTE Wert. `null` heißt „Preis offen". */
  marketPrice: number | null;
  /** Der Zuschlag, mit dem der Katalog ihn DRUCKT. */
  marketBoostPercent?: number;
  dimmed?: boolean;
}) {
  const [wert, setWert] = useState<number | null>(marketPrice);
  const [offen, setOffen] = useState(false);
  const [text, setText] = useState("");
  const [fehler, setFehler] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const feld = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (offen) feld.current?.select();
  }, [offen]);

  function aufmachen() {
    /* VORAUSGEFÜLLT MIT DEM GESPEICHERTEN WERT, nicht mit dem gedruckten. */
    setText(formatPriceInput(wert));
    setFehler(null);
    setOffen(true);
  }

  function abbrechen() {
    setOffen(false);
    setFehler(null);
  }

  function speichern() {
    if (pending) return;                     /* keine Doppelspeicherung */
    const gelesen = parsePriceInput(text);
    if (gelesen === "ungueltig") { setFehler(de.admin.priceInvalid); return; }
    setFehler(null);
    start(async () => {
      const ergebnis = await setMarketPrice(skyId, gelesen);
      if (ergebnis.ok) { setWert(gelesen); setOffen(false); }
      /* BEI EINEM FEHLER BLEIBT DIE EINGABE STEHEN. Wer eine Zahl getippt
         hat, soll sie nicht neu tippen müssen, um die Meldung zu lesen. */
      else setFehler(ergebnis.message);
    });
  }

  if (!offen) {
    return (
      <span className="flex min-w-0 items-center gap-0.5">
        <span
          className={
            "text-[17px] leading-none font-semibold tabular-nums whitespace-nowrap "
            + (wert === null || dimmed ? "text-muted" : "text-foreground")
          }
        >
          {wert === null
            ? de.catalog.noPrice
            : formatPrice(catalogDisplayMarketPrice(wert, marketBoostPercent))}
        </span>
        <button
          type="button"
          onClick={aufmachen}
          aria-label={de.admin.priceEdit(name)}
          title={de.admin.priceEdit(name)}
          className={`${MARKE} text-muted hover:text-foreground`}
        >
          <span className={GRUND}>
            {/* lucide pencil, auf demselben 22er-Raster wie die Leiste */}
            <svg {...ICON}>
              <path d="M11 18.5h8" />
              <path d="M15.2 3.8a1.9 1.9 0 0 1 2.7 2.7L6.6 17.8l-3.6.9.9-3.6Z" />
            </svg>
          </span>
        </button>
      </span>
    );
  }

  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="flex items-center gap-1">
        <input
          ref={feld}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); speichern(); }
            if (e.key === "Escape") { e.preventDefault(); abbrechen(); }
          }}
          disabled={pending}
          inputMode="decimal"
          aria-label={de.admin.priceEdit(name)}
          placeholder={de.catalog.noPrice}
          className="focus-ring min-h-11 w-[5.5rem] rounded-sky-sm bg-surface px-2
                     text-[15px] tabular-nums text-foreground ring-1 ring-border-strong
                     disabled:opacity-60"
        />
        <button
          type="button"
          onClick={speichern}
          disabled={pending}
          aria-label={de.admin.priceSave}
          title={de.admin.priceSave}
          className={`${MARKE} text-own-ink hover:text-foreground disabled:opacity-40`}
        >
          <span className={GRUND}>
            {pending ? (
              /*
               * DAS GETEILTE RAD, nicht ein eigenes. `src/lib/ui/pending.test.ts`
               * laesst genau eines im Produkt zu, und das ist richtig: meine
               * erste Fassung hat sich hier ein zweites gebaut, das weder
               * `prefers-reduced-motion` kennt noch dieselbe Strichbreite hat.
               */
              <Spinner className="size-[18px]" />
            ) : (
              /* lucide check */
              <svg {...ICON}>
                <path d="M4 11.5 8.5 16 18 6" />
              </svg>
            )}
          </span>
        </button>
        <button
          type="button"
          onClick={abbrechen}
          disabled={pending}
          aria-label={de.admin.priceCancel}
          title={de.admin.priceCancel}
          className={`${MARKE} text-muted hover:text-foreground disabled:opacity-40`}
        >
          <span className={GRUND}>
            {/* lucide x */}
            <svg {...ICON}>
              <path d="M5 5l12 12" /><path d="M17 5 5 17" />
            </svg>
          </span>
        </button>
      </span>

      {/*
       * WELCHE ZAHL HIER STEHT, UND WAS DER KATALOG DARAUS MACHT. Ohne diesen
       * Satz wäre nicht zu sehen, dass das Feld den gespeicherten Wert trägt
       * und die Kachel einen anderen druckt.
       */}
      <span className="text-[10px] leading-tight text-muted">
        {de.admin.priceStored}
        {marketBoostPercent > 0 ? ` · ${de.admin.priceBoostHint(marketBoostPercent)}` : ""}
      </span>
      <span className="text-[10px] leading-tight text-muted">{de.admin.priceOpenHint}</span>
      {fehler ? (
        <span role="alert" className="text-[11px] leading-snug text-danger">{fehler}</span>
      ) : null}
    </span>
  );
}
