import type { Metadata } from "next";
import Link from "next/link";

import { NewPurchase } from "@/components/business/new-purchase";
import { fetchOwnCalculation } from "@/lib/calculator/saved-queries";
import { handOverUnits } from "@/lib/calculator/saved";
import { de } from "@/lib/i18n/de";
import {
  purchaseDraftFromUnits, purchaseDraftGap,
} from "@/lib/orderbook/purchase-draft";
import { fetchOrderbookCatalog } from "@/lib/orderbook/queries";

export const metadata: Metadata = { title: de.business.orderbook.newPurchase };

/**
 * `?test=1` arrives when the form was opened from the Test view, so the box is
 * already ticked and the operator is not asked to reclassify a record they
 * created two seconds ago. It is a default, not a lock — the checkbox is still
 * there and still theirs.
 *
 * `?kalkulation=<uuid>` kommt aus dem Kalkulator (Calculator V3, ADR-0132).
 * Dann stehen die Figuren dieser gespeicherten Kalkulation schon im
 * Formular — **in demselben Formular**, mit derselben Positionsverwaltung,
 * denselben Pflichtfeldern und demselben Speichern-Knopf. Es ist kein
 * zweiter Weg, einen Einkauf anzulegen; es ist dieser Weg mit einer
 * Vorbelegung.
 *
 * ÜBER DIE URL REIST NUR DIE KENNUNG. Die Artikel liest `fetchOwnCalculation`
 * serverseitig, mit der Sitzung des Aufrufers und damit unter den
 * Richtlinien aus `0142`. Eine fremde, unbekannte oder krumme Kennung
 * liefert `null`, und dann verhält sich die Seite wie „+ Neu" ohne
 * Parameter: **leeres Formular, kein Hinweis, kein Fehler.** Wer nichts
 * sehen darf, soll nicht erfahren, dass es existiert.
 *
 * UND SIE SCHREIBT NICHTS. Diese Seite aufzurufen legt keinen Einkauf an und
 * verändert die Kalkulation nicht — auch nicht beim Neuladen oder
 * Zurücknavigieren. Entstehen soll ein Einkauf erst durch den vorhandenen
 * Speichern-Knopf.
 */
export default async function NewPurchasePage({ searchParams }: {
  searchParams: Promise<{ test?: string; kalkulation?: string }>;
}) {
  /*
   * The catalog ships with the page, exactly as it does on the detail screen:
   * one query here rather than one per keystroke over a phone connection,
   * which is what makes the search instant while holding a figure.
   */
  const [{ test, kalkulation }, catalog] = await Promise.all([
    searchParams, fetchOrderbookCatalog(),
  ]);

  /*
   * Die Kalkulation, falls eine genannt ist. Erst danach die Zeilen, denn
   * `purchaseDraftFromUnits` braucht den Katalog: Name, Serie und Marktwert
   * kommen von dort und nicht aus dem Schnappschuss — genau wie beim Tippen.
   */
  const calculation = typeof kalkulation === "string" && kalkulation !== ""
    ? await fetchOwnCalculation(kalkulation)
    : null;
  const units = calculation === null ? [] : handOverUnits(calculation);
  const initialLines = purchaseDraftFromUnits(catalog, units);
  const missingUnits = purchaseDraftGap(catalog, units);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pt-8 pb-10 md:pt-12">
      <Link href="/business/orderbuch"
            className="inline-flex min-h-11 items-center text-sm text-muted hover:text-fg">
        ← {de.business.orderbook.back}
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">
        {de.business.orderbook.newPurchase}
      </h1>
      <NewPurchase
        defaultTest={test === "1"}
        catalog={catalog}
        initialLines={initialLines}
        /*
         * Die Kennung geht nur mit, wenn die Kalkulation wirklich dem
         * Aufrufer gehört — sonst wäre sie eine Behauptung aus der URL, die
         * später in einem Datenbankaufruf landet. Der Riegel in `0143`
         * prüft sie ein zweites Mal; das hier ist der erste.
         */
        calculationId={calculation?.id ?? null}
        missingUnits={missingUnits}
      />
    </main>
  );
}
