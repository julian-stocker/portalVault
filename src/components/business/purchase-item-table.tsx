/**
 * Die Positionstabelle eines Einkaufs — Kopfzeile und Zeile, an einem Ort.
 *
 * HERAUSGEZOGEN AUS `orderbook-ledger.tsx`, UNVERÄNDERT. Diese Datei ist
 * zunächst nichts Neues: `Status`, `ItemRow` und die sechs Spaltenköpfe
 * standen bis Schritt 1 des Umbaus im Einkaufsbuch selbst und stehen hier
 * Zeichen für Zeichen gleich. Kein Verhalten, keine Aktion und kein
 * Steuerelement ist dazugekommen.
 *
 * WARUM SIE UMGEZOGEN SIND. Dieselbe Tabelle soll ein zweites Mal gezeigt
 * werden — im (i)-Fenster des Einkaufsbuchs. Zwei Kopien derselben sechs
 * Spuren wären zwei Orte, an denen eine Spalte dazukommen kann, und eine
 * Kopfzeile, die ihrer Zeile nicht mehr entspricht, ist eine Tabelle, die
 * lügt. Deshalb reisen Kopf und Zeile ab jetzt zusammen.
 *
 * `PurchaseItemHead` IST DER GRUND, warum es diese Datei und nicht nur einen
 * Export gibt: die sechs Spaltenbeschriftungen standen im Einkaufsbuch im JSX
 * verstreut, 450 Zeilen unter der Zeile, die sie füllt. Jetzt stehen sie
 * daneben.
 *
 * `Status` reist mit, weil `ItemRow` ihn braucht. Das Einkaufsbuch benutzt ihn
 * ebenfalls für seine eigene Zeile und importiert ihn deshalb von hier — die
 * Alternative wäre ein Import im Kreis gewesen.
 *
 * DIE SPURENZAHL GEHÖRT NICHT HIERHER. `PURCHASE_ITEM_COLUMNS` bleibt im
 * Einkaufsbuch und wird an `LedgerTable` übergeben, das daraus die
 * CSS-Variable `--ob-item-columns` macht. Diese Datei füllt die Spuren, sie
 * legt sie nicht fest.
 */
"use client";

import { useState, type ReactNode } from "react";

import { formatPrice } from "@/lib/format";
import { de } from "@/lib/i18n/de";
import {
  canCheckIn, itemStatus, type RowStatus,
} from "@/lib/orderbook/ledger";
import {
  canChangeEnding, creditsNoValue, endingsFor, type ItemState,
} from "@/lib/orderbook/purchase";
import type { PurchaseItem } from "@/lib/orderbook/queries";
import { LedgerItemHead, LedgerItemRow } from "./ledger-table";

const copy = de.business.orderbook;


/**
 * The status cell — and the ✓ is a claim now, not a decoration.
 *
 * ONE RULE: the tick appears if and only if a stock movement exists. A
 * historical row says `Historisch` in words and carries no tick at all,
 * because a ✓ in a column about inventory reads as "this is on the shelf
 * because I put it there" — which is false for 2 103 of the 2 114 imported
 * items and, since 0067, unanswered for the other eleven.
 *
 * `text` is what the cell shows, `title` the longer form behind it. They
 * differ only where the short form would not fit the track: a partly booked
 * purchase shows `3 von 14` and says `Teilweise eingebucht` on hover.
 */
export function Status({ status, text, title }: {
  status: RowStatus; text: string; title: string;
}) {
  return (
    <span
      className={"truncate text-xs " + (status === "complete" ? "text-fg" : "text-muted")}
      title={title}
      aria-label={title}
    >
      {text}
    </span>
  );
}


/**
 * Was in der Zustandsspalte steht — kurz und lang.
 *
 * EINE STELLE FÜR ZWEI TABELLEN. Dieser Block stand bis Schritt 2 nur in
 * `ItemRow`. Seit der (i)-Dialog dieselbe Zustandsspalte zeigt, gäbe es ihn
 * sonst zweimal, und zwei Orte, die „Historisch" entscheiden, sind zwei Orte,
 * an denen ein Zustand irgendwann verschieden heisst.
 *
 * Gefragt wird nach der BEWEGUNG, nicht nach dem Zustand — `itemStatus`
 * erklärt warum. Eine offene Einheit druckt ihren eigenen Zustand
 * (`Bestellt`, `Angekommen`, `Beschädigt`, `Fehlt`), was mehr sagt als „nicht
 * eingebucht" und die Sprache der Knöpfe ist, die sie weiterbewegen.
 *
 * `text` ist, was die Zelle zeigt, `title` die längere Form dahinter. Sie
 * unterscheiden sich nur dort, wo die kurze Form die Spur nicht füllt.
 */
export function itemStatusText(item: PurchaseItem): {
  status: RowStatus; text: string; title: string;
} {
  const status = itemStatus(item);
  const text = status === "historical" ? copy.historicalLabel
    : status === "complete" ? copy.completeCell
    : copy.states[item.state as keyof typeof copy.states] ?? item.state;
  const title = status === "historical" ? copy.historicalHint
    : status === "complete" ? copy.completeLabel
    : status === "settled" ? copy.settleHint
    : text;
  return { status, text, title };
}


/**
 * Die sechs Spaltenköpfe, in der Reihenfolge, in der `ItemRow` sie füllt.
 *
 * Die `Aktion`-Spur steht auch dort, wo kein Knopf darin ist — sonst
 * verschöben sich die Spalten zwischen einer historischen und einer
 * buchbaren Zeile unter dem Blick weg.
 */
export function PurchaseItemHead() {
  return (
    <LedgerItemHead>
      <span>#</span>
      <span>{copy.itemColumns.series}</span>
      <span>{copy.itemColumns.figure}</span>
      <span className="text-right">{copy.columns.marketValue}</span>
      <span className="text-center">{copy.itemColumns.status}</span>
      <span className="text-right">{copy.itemColumns.action}</span>
    </LedgerItemHead>
  );
}


/**
 * One physical item, one line.
 *
 * `.ob-item` is the same five-track grid the expanded header uses, and the
 * `Aktion` track exists whether or not a button is in it — so a historical row
 * and a bookable one line up instead of the columns shifting under each other.
 */
export function ItemRow({ item, onBook, onState, busy, failure }: {
  item: PurchaseItem;
  /** Einbuchen — die eine Aktion, die Bestand erzeugt. */
  onBook: () => void;
  /** Die drei Enden aus dem Plus-Menü: beschädigt, fehlt, Vitrine. */
  onState: (state: string) => void;
  /** Diese Position läuft gerade. Keine Behauptung über das Ergebnis. */
  busy: boolean;
  /** Abgelehnt, mit dem Satz der Datenbank — je Position, nicht je Tabelle. */
  failure: string | null;
}) {
  const [open, setOpen] = useState(false);
  /* Derselbe Text wie im (i)-Dialog, aus derselben Funktion. */
  const { status, text, title } = itemStatusText(item);

  return (
    <LedgerItemRow>
      <span className="tabular-nums text-xs text-muted">{item.position}</span>
      {/*
        Serie, from the canonical catalog. It replaced `· Excel: DRobot`, which
        spent the width on how the owner once typed a name and still left
        `Drobot` ambiguous between two games. The raw text stays in the
        database and stays on the correction screen, where it is the evidence
        being corrected — here it was only noise.

        A dash for a non-figure: a portal has no Skylanders series and
        inventing one would be worse than an empty cell.
      */}
      <span className="truncate text-xs text-muted">{item.seriesLabel ?? "—"}</span>
      {/* `truncate` is a last resort, not a strategy — the floor above is
          sized so it rarely fires. When it does, the full name is still
          reachable rather than gone. */}
      <span className="truncate" title={item.name}>{item.name}</span>
      <span className="text-right tabular-nums">
        {item.marketPrice === null ? "—" : formatPrice(item.marketPrice)}
      </span>
      {/*
        DIESELBE ANTWORT WIE AUF DER DETAILSEITE — und bei einer Ablehnung
        steht hier die Ablehnung, nicht der alte Status. Sonst sähe eine
        abgelehnte Position aus wie eine, bei der nichts passiert ist.
      */}
      <span className={`truncate text-center text-xs ${
        failure !== null ? "text-danger" : ""}`}
            title={failure ?? title}>
        {failure !== null ? failure
          : busy ? copy.itemRunning
            : <Status status={status} text={text} title={title} />}
      </span>
      <span className="flex items-center justify-end gap-1 text-right">
        {canCheckIn(item) ? (
          <button type="button" disabled={busy} onClick={onBook}
                  className="min-h-9 rounded-sky-md px-2 text-xs ring-1 ring-border/70 disabled:opacity-50">
            {copy.book}
          </button>
        ) : null}
        {/*
          DAS PLUS-MENÜ — die Enden, die kein Bestand sind.

          Nur wo es etwas zu entscheiden gibt: `canChangeEnding` ist für jede
          KATALOGFIGUR wahr, die weder im Lager liegt noch eine
          Arbeitsmappenzeile ist. Für ein Portal, eine gebuchte oder eine
          historische Position bleibt es aus — dort würde jeder Punkt in eine
          Ablehnung führen, die der Bildschirm schon kennt.

          WAS DARIN STEHT, ENTSCHEIDET `endingsFor` UND NICHT DIESE DATEI.
          Eine offene Position bekommt die drei Enden; eine beschädigte oder
          fehlende bekommt NUR „Angekommen" — den einen bewussten Weg zurück.
          Kein Punkt „Vitrine" für sie, denn aus der Vitrine darf eingebucht
          werden, und das wäre der zweite Weg einer beschädigten Figur in den
          Verkaufsbestand (D4).

          Ein `details`-Element und kein eigener Zustandsautomat: das Auf- und
          Zuklappen ist Browsersache, und ein Klick darauf darf die Zeile
          nicht aufklappen — deshalb `stopPropagation` und `relative z-20`
          gegen die durchsichtige Zeilen-Überlagerung, dieselbe Lehre wie beim
          (i) im Verkaufsbuch.
        */}
        {canChangeEnding(item as { state: ItemState; skyId: string | null }) ? (
          <details open={open} className="relative z-20"
                   onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
            <summary onClick={(e) => e.stopPropagation()}
                     aria-label={creditsNoValue(item.state as ItemState)
                       ? copy.correctEnding : copy.moreEndings}
                     className="flex size-9 cursor-pointer items-center justify-center rounded-sky-md text-xs text-muted ring-1 ring-border/70 marker:hidden hover:text-fg hover:ring-fg/30 [&::-webkit-details-marker]:hidden">
              <span aria-hidden="true">+</span>
            </summary>
            <div className="absolute right-0 z-30 mt-1 flex w-40 flex-col gap-1 rounded-sky-md bg-surface p-1 ring-1 ring-border/70 shadow-elevation-raised">
              {endingsFor(item.state as ItemState).map((state) => (
                <button key={state} type="button" disabled={busy}
                        onClick={(e) => { e.stopPropagation(); setOpen(false); onState(state); }}
                        className="min-h-9 rounded-sky-sm px-2 text-left text-xs hover:bg-surface-raised disabled:opacity-50">
                  {copy.states[state as keyof typeof copy.states]}
                </button>
              ))}
            </div>
          </details>
        ) : null}
      </span>
    </LedgerItemRow>
  );
}


/* ===========================================================================
 * DIE LESEVARIANTE — für das (i)-Fenster des Einkaufsbuchs.
 *
 * DREI SPALTEN, KEINE VIERTE: Figur · Serie/SKY-ID · Zustand. Das Fenster ist
 * zum Nachsehen da; Einbuchen und Zustandswechsel bleiben auf der
 * Detailseite, und eine leere Aktionsspalte wäre eine Spur, die nichts
 * verspricht.
 *
 * WARUM SIE NICHT `LedgerItemRow` BENUTZT — gemessen, nicht gemutmaßt.
 *
 * `.ob-item` holt seine Spuren aus `--ob-item-columns`, und die setzt
 * `LedgerTable`. Im Fenster gibt es kein `LedgerTable`, also griffe der
 * CSS-Rückfall aus `globals.css`:
 *
 *     grid-template-columns: var(--ob-item-columns,
 *       2.5rem 9.5rem minmax(0, 1fr) 6rem 6rem 6.5rem);
 *
 * Sechs Spuren für drei Zellen — die drei leeren hinten wären genau die
 * Aktionsspalte, die hier nicht erscheinen soll. Und `LedgerTable` brächte
 * `.ob-min` mit, einen waagerechten Mindestbreiten-Boden, der ein Fenster
 * seitlich scrollen lässt. Beides falsch für diesen Ort.
 *
 * Geteilt wird deshalb die BEDEUTUNG, nicht das Gitter: `itemStatusText` für
 * die Zustandsspalte, der Strich für eine Nicht-Figur, `truncate` mit dem
 * vollen Namen im `title`. Das Aussehen einer Tabelle entsteht hier aus drei
 * eigenen Spuren.
 *
 * DER PLATZ FÜR SPÄTER. `actions` ist ein Steckplatz: wird er nicht
 * übergeben, hat die Zeile drei Spuren. Übergibt ihn Schritt 3 mit dem
 * ⋯-Menü für `Figur ändern` und `Entfernen`, werden es vier — ohne dass die
 * Tabelle dafür ein zweites Mal entsteht. Heute übergibt ihn niemand, und
 * die Spalte existiert nicht.
 * ======================================================================== */

/* ---------------------------------------------------------------------------
 * EINE SPURENLISTE, FÜR DIE KOPFZEILE UND FÜR JEDE ZEILE.
 *
 * Hier standen zwei — drei Spuren ohne Aktion, vier mit —, und das war der
 * Layoutfehler. Vier Gründe, und jeder einzelne hätte gereicht:
 *
 *   1. Verschiedene Spurenzahl je Zeile. Die `1fr`-Spalte ist dann in einer
 *      dreispurigen Zeile anders breit als in einer vierspurigen, also stehen
 *      die Spalten nicht übereinander.
 *
 *   2. Die Kopfzeile wurde ohne `withActions` gerufen und hatte drei Spuren,
 *      während die umhängbaren Zeilen vier hatten.
 *
 *   3. Die vierte Spur war `auto`. JEDE ZEILE IST IHR EIGENES GITTER — das
 *      `<li>` trägt kein `display: grid`, der innere `<div>` tut es —, also
 *      misst `auto` je Zeile neu. Selbst bei vier Spuren überall wäre eine
 *      Zeile mit Knopf anders aufgeteilt als eine ohne. Alle Spuren außer der
 *      Namensspalte brauchen deshalb FESTE Breiten.
 *
 *   4. `seriesLabel` ist das volle Serienlabel, nicht der Code. „Spyro's
 *      Adventure · SKY-0056" sind 28 Zeichen und braucht bei `text-xs` etwa
 *      12,6rem; in einer 9rem-Zelle mit `truncate` fiel die SKY-ID weg — also
 *      genau die Identität, um die es in der Zelle geht.
 *
 * Die Antwort auf 4 ist Stapeln: Label oben mit `truncate`, SKY-ID darunter
 * und NIE gekürzt. Die Zelle braucht dann nur die Breite der ID.
 *
 * ARITHMETIK ab `sm:`
 *     Serie/SKY-ID 7rem + Status 6,5rem + Aktion 4,5rem = 18,00rem
 *     drei Lücken à 0,75rem                             =  2,25rem
 *                                                        ─────────
 *                                                         20,25rem fest
 *   Das Fenster ist `max-w-[660px]` = 41,25rem; abzüglich Rand bleiben dem
 *   Namen etwa 18rem.
 *
 * UNTER `sm:` zwei Reihen, zwei Spalten, in DOM-Reihenfolge:
 *     Figur   │ Serie/SKY-ID
 *     Status  │ Aktion
 *   Kein waagerechter Überlauf, keine ausdrückliche Platzierung, und die
 *   Kopfzeile bleibt dort ausgeblendet — über einem 2×2-Feld beschriftet eine
 *   Kopfzeile die falsche Hälfte.
 * ------------------------------------------------------------------------ */

/** Die Spuren. EIN Wert, von der Kopfzeile und jeder Zeile benutzt. */
const READ_TRACKS =
  "grid-cols-[minmax(0,1fr)_5.5rem] "
  + "sm:grid-cols-[minmax(0,1fr)_7rem_6.5rem_4.5rem]";

/** Abstände und Innenrand, ebenfalls für beide identisch. */
const READ_BOX = "items-start gap-x-3 gap-y-1 px-4 py-1.5 sm:items-center sm:gap-y-0";

/**
 * Die Kopfzeile der Lesetabelle.
 *
 * Unter `sm:` steht sie nicht: dort ist jede Position zwei Zeilen hoch, und
 * eine Kopfzeile über einem zweizeiligen Satz beschriftet die falsche Hälfte.
 * Die Zellen tragen dort ihre Bedeutung selbst — der Name oben, Herkunft und
 * Zustand darunter.
 */
export function PurchaseItemReadHead() {
  return (
    <div className={`hidden ${READ_TRACKS} ${READ_BOX} `
      + "text-xs uppercase tracking-wide text-muted sm:grid"}>
      <span>{copy.itemColumns.figure}</span>
      <span>{copy.itemColumns.series}</span>
      <span>{copy.itemColumns.status}</span>
      <span className="text-right">{copy.itemColumns.action}</span>
    </div>
  );
}

/**
 * Eine physische Einkaufsposition, eine Zeile — lesend.
 *
 * Schreibt nichts und ruft nichts. Der angezeigte Name ist der aufgelöste aus
 * `0119` (`display_name_override` vor `skylanders.name`); `raw_name` bleibt
 * unberührt in der Datenbank und erscheint hier nicht — er ist das
 * Beweisstück, das Schritt 3 beim Öffnen von `Figur ändern` zeigt, und dort
 * gehört er hin.
 */
export function PurchaseItemReadRow({ item, actions, below }: {
  item: PurchaseItem;
  /** Die kompakte Aktion am Zeilenende — siehe den Block oben. */
  actions?: ReactNode;
  /**
   * Was unter der Zeile aufklappt, über die ganze Breite.
   *
   * Im `<li>` und nicht daneben: eine Korrektur gehört sichtbar zu der Zeile,
   * die korrigiert wird, und zwei `<li>` für eine Position wären zwei
   * Einträge in einer Liste, die eine Position zeigt.
   */
  below?: ReactNode;
}) {
  const { status, text, title } = itemStatusText(item);
  return (
    <li className={below === undefined ? "" : "bg-surface/40"}>
    <div className={`grid ${READ_TRACKS} ${READ_BOX}`}>
      {/*
        DER NAME VERSCHIEBT NICHTS. `minmax(0,1fr)` als Spur, `min-w-0` und
        `truncate` an der Zelle: ein langer Name endet mit Auslassung, statt
        die festen Spuren rechts von sich wegzudrücken. Vollständig steht er
        im `title`.
      */}
      <span className="min-w-0 truncate text-sm" title={item.name}>
        {item.position}. {item.name}
      </span>
      {/*
        SERIE ÜBER SKY-ID, NICHT DANEBEN.
        Nebeneinander waren es bis zu 28 Zeichen in einer 9rem-Zelle, und
        `truncate` schnitt die SKY-ID ab — die Identität, um die es in dieser
        Zelle geht. Gestapelt kürzt nur das Label; die ID steht immer ganz da.
        Ein Strich für eine Nicht-Figur: ein Portal hat keine
        Skylanders-Serie, und eine zu erfinden wäre schlimmer als eine leere
        Zelle — dieselbe Regel wie in der grossen Tabelle.
      */}
      <span className="min-w-0 text-xs text-muted">
        <span className="block truncate">{item.seriesLabel ?? "—"}</span>
        {item.skyId === null ? null : (
          <span className="block tabular-nums">{item.skyId}</span>
        )}
      </span>
      <span className="min-w-0 truncate text-xs">
        <Status status={status} text={text} title={title} />
      </span>
      {/*
        DIE VIERTE SPUR STEHT IMMER, mit oder ohne Knopf — sonst teilt sich
        eine Zeile ohne Aktion ihre Breite anders auf als eine mit, und die
        Spalten stehen nicht übereinander. Leer heisst leer: kein gesperrter
        Knopf, der nie erreichbar wird.
      */}
      <span className="flex items-center justify-end gap-1">{actions ?? null}</span>
    </div>
    {below === undefined ? null : (
      <div className="border-t border-border/50 px-4 py-2">{below}</div>
    )}
    </li>
  );
}
