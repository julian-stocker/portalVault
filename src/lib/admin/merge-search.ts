/**
 * CAT-05D — die Suche nach dem Ziel einer Zusammenführung.
 *
 * WARUM EINE SERVERAKTION UND NICHT DIE GANZE LISTE IM BROWSER: der Katalog
 * hat 731 Zeilen, und jede Tabellenzeile trägt ein eigenes Merge-Icon. Alle
 * Zeilen an alle Zeilen zu reichen wären 731 × 731 Datensätze im HTML — am
 * Telefon ist das der Unterschied zwischen einer Seite und einer Zumutung.
 *
 * Sie LIEST nur. Geschrieben wird erst, wenn der Bediener bestätigt, und
 * dann über `mergeDraftIntoFigure()`.
 */
"use server";

import { isPlatformAdmin } from "@/lib/auth/capabilities";
import {
  fetchAdminNotes, fetchMergeBestand, fetchMergeReferences,
  type MergeReferenzstand,
} from "@/lib/admin/queries";
import { falte, findeTreffer } from "@/lib/admin/merge-candidates";

export type Zielzeile = {
  skyId: string;
  /** Der Anzeigename — danach wird gesucht und gelistet. */
  name: string;
  /** Die Spalte `name`, roh. Nur damit vergleicht die Vorschau (CAT-05F). */
  nameRaw: string;
  seriesCode: string; categoryName: string;
  categoryId: number; cardType: string; itemType: string;
  characterId: number | null; imageOverridePath: string | null;
  /** Das Bild aus dem Altimport — für das Vorschaubild der bisherigen Figur. */
  imageFile: string | null;
  displayNameOverride: string | null; catalogStatus: string;
  adminNote: string | null;
  /** Nur bei Vorschlägen gesetzt: warum dieser Eintrag naheliegt. */
  stufe?: string; grund?: string;
};

export type Suchergebnis = {
  treffer: Zielzeile[];
  referenzen: MergeReferenzstand;
  /**
   * Die Zeile des Entwurfs, VOLLSTÄNDIG und aus der Datenbank.
   *
   * WARUM NICHT DIE DER TABELLE. Die Katalogliste führt nicht jede Spalte;
   * was ihr fehlt, stand im Dialog als Platzhalter (`itemType: "figure"`,
   * `characterId: null`, `adminNote: null`). Für eine Anzeige war das
   * ungenau, seit CAT-05F ist es untragbar: der Server vergleicht die
   * angezeigten Werte mit seinen eigenen und bricht bei Abweichung ab. Die
   * Vorschau rechnet deshalb mit dieser Zeile und nicht mit der aus der
   * Tabelle.
   */
  entwurf: Zielzeile | null;
};

/**
 * Vorschläge (bei leerer Suche) oder Treffer zu einem Suchwort.
 *
 * Der Entwurf selbst und alle anderen Entwürfe bleiben draußen: ein Entwurf
 * kann nicht das Ziel sein, `0154` weist das ab.
 */
export async function searchMergeTargets(
  draftSkyId: string,
  query: string,
): Promise<Suchergebnis | null> {
  if (!(await isPlatformAdmin())) return null;

  const [bestand, referenzen, noten] = await Promise.all([
    fetchMergeBestand(),
    fetchMergeReferences(draftSkyId),
    /*
     * DIE NOTIZEN WURDEN NIE GELADEN (CAT-05H).
     *
     * Hier stand `new Map()` — leer, und nichts hat sie je gefuellt.
     * `adminNote` war deshalb bei JEDER Zeile `null`, bei Ziel wie Entwurf.
     * Die Folge war still und schwerwiegend: `vorschau()` sah im Entwurf
     * keine Notiz, bot also keine Tabellenzeile „Interne Notiz" an, und das
     * Kaestchen konnte nicht angekreuzt werden — `0156` uebernimmt aber nur
     * Ausgewaehltes. Die Herkunftszeile des Imports waere damit bei jeder
     * Zusammenfuehrung verloren gegangen, ohne dass es jemandem aufgefallen
     * waere. Gefunden bei der Ursachensuche zum ersten Merge-Versuch.
     */
    fetchAdminNotes(),
  ]);
  const entwurf = bestand.find((r) => r.skyId === draftSkyId);
  const ziele = bestand.filter((r) => r.catalogStatus !== "draft");
  const zu = (r: typeof ziele[number], extra: Partial<Zielzeile> = {}): Zielzeile => ({
    skyId: r.skyId, name: r.name, nameRaw: r.nameRaw, seriesCode: r.seriesCode,
    categoryName: r.categoryName, categoryId: r.categoryId, cardType: r.cardType,
    itemType: r.itemType, characterId: r.characterId,
    imageOverridePath: r.imageOverridePath, imageFile: r.imageFile,
    displayNameOverride: r.displayNameOverride, catalogStatus: r.catalogStatus,
    adminNote: noten[r.skyId] ?? null, ...extra,
  });

  const entwurfZeile = entwurf === undefined ? null : zu(entwurf);

  const q = query.trim();
  if (q.length >= 2) {
    const gefaltet = falte(q);
    const treffer = ziele
      .filter((r) => falte(r.name).includes(gefaltet)
                  || r.skyId.toLowerCase().includes(q.toLowerCase()))
      .slice(0, 8)
      .map((r) => zu(r));
    return { treffer, referenzen, entwurf: entwurfZeile };
  }

  /* Leere Suche → die Dublettenvorschläge, ohne die Grundfigur. */
  if (entwurf === undefined) return { treffer: [], referenzen, entwurf: null };
  const vorschlaege = findeTreffer(
    { ...entwurf, kern: "", hatFamilie: false, istFigur: entwurf.itemType === "figure" },
    ziele,
  ).filter((t) => t.stufe !== "Grundfigur").slice(0, 6);

  return {
    treffer: vorschlaege.map((t) => {
      const r = ziele.find((x) => x.skyId === t.skyId)!;
      return zu(r, { stufe: t.stufe, grund: t.grund });
    }),
    referenzen,
    entwurf: entwurfZeile,
  };
}
