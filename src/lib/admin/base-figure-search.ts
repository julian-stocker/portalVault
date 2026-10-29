/**
 * CAT-07 — die Suche nach einer BASISFIGUR.
 *
 * NICHT DIE FAMILIENSUCHE. Eine Familie (`characters`) verbindet denselben
 * Charakter serienübergreifend; eine Basisfigur ist eine konkrete
 * Katalogzeile DERSELBEN Serie, deren Variante die neue Figur wird. Der
 * Bediener sucht ab CAT-07 die zweite, nicht die erste —
 * `family-search.ts` bleibt für die Familienzuordnung daneben stehen.
 *
 * FÜNF FILTER, UND JEDER IST EINE REGEL AUS CAT-07/CAT-08:
 *
 *   1. dieselbe Serie            — eine Variante gehört zu einer Basisfigur
 *                                  derselben Serie. `0159` erzwingt das
 *                                  strukturell; hier wird es schon nicht
 *                                  angeboten.
 *   2. DIESELBE ARTIKELART       — Figur → Figur, Trap → Trap, Fahrzeug →
 *                                  Fahrzeug, Kristall → Kristall. Die
 *                                  Entscheidung liegt in
 *                                  `src/lib/catalog/article-class.ts` und
 *                                  kommt aus `item_type` und der Kategorie,
 *                                  nie aus dem Namen.
 *   3. keine Varianten           — `base_sky_id IS NULL`. Varianten von
 *                                  Varianten gibt es nicht.
 *   4. keine Entwürfe            — eine Basisfigur ist eine veröffentlichte
 *                                  oder versteckte Figur, keine, die selbst
 *                                  noch zur Entscheidung steht.
 *   5. nicht sie selbst          — eine Figur ist nicht ihre eigene Variante.
 *
 * DER ZWEITE FILTER HAT BIS ZUM 2026-10-29 GEFEHLT. Beim Entwurf SKY-0854
 * „White Flocked LightCore Prism Break" standen deshalb `Portale` ganz oben
 * in der Liste. Er steht jetzt im SERVER, in `fetchBaseFigures` — ein Filter
 * im Browser wäre keine Regel, sondern eine Darstellung.
 *
 * UND ER IST NICHT „NUR CHARAKTERE". Das war der erste Versuch, und er war
 * falsch: ein Trap, ein Fahrzeug, ein Kreationskristall kann ebenfalls eine
 * Variante haben — 30 der Entwürfe sind genau das, und ein Charakterfilter
 * hätte ihnen jede Basis genommen. Gemessen am Bestand (2026-10-29): alle
 * 22 bestehenden Variantenbeziehungen liegen INNERHALB einer Kategorie,
 * keine einzige darüber hinweg.
 *
 * WAS AUSDRÜCKLICH NICHT GEFILTERT WIRD: Artikel, auf die schon Varianten
 * zeigen. Sie sind gültige Basisartikel — „Prism Break" bleibt wählbar,
 * nachdem eine Variante auf ihn zeigt. Und keiner wird wegen seines NAMENS
 * ausgeschlossen: „LightCore Prism Break", „Legendary Spyro" und „Dark
 * Cynder" sind eigenständige Katalogzeilen.
 *
 * KEINE AUSKUNFT IST EIN ERGEBNIS. Lässt sich die Art des Entwurfs nicht
 * sicher sagen, kommt eine LEERE Liste mit `art: null` zurück, und der
 * Dialog sagt das — statt irgendwelche Kandidaten anzubieten
 * (Anforderung 7).
 *
 * SORTIERT WIRD NACH WAHRSCHEINLICHKEIT (`base-figure-rank.ts`): wessen Name
 * am Ende des Entwurfsnamens steht, steht oben. Das ist eine REIHENFOLGE und
 * keine Auswahl — der Bediener klickt weiterhin selbst.
 *
 * SIE LIEST NUR.
 */
"use server";

import { isPlatformAdmin } from "@/lib/auth/capabilities";
import { fetchBaseFigures, type Basiszeile } from "@/lib/admin/queries";
import { falte } from "@/lib/admin/merge-candidates";
import { baseRank, basePrefix, baseWordScore, sortByBaseRank }
  from "@/lib/admin/base-figure-rank";
import type { ArticleClass } from "@/lib/catalog/article-class";

export type { Basiszeile };

export type Basissuche = {
  treffer: Basiszeile[];
  /** Die Serie, in der gesucht wurde — der Dialog nennt sie. */
  serie: string | null;
  /** Wie viele Zeilen die fünf Filter überhaupt übrig lassen. */
  moeglich: number;
  /**
   * Wie viele davon die Suche trifft — `moeglich`, wenn nichts gesucht wird.
   *
   * Der Dialog zeigt höchstens acht; ohne diese Zahl wüsste der Bediener
   * nicht, ob er alles sieht oder nur den Anfang.
   */
  gefunden: number;
  /**
   * Der Artikel, der oben steht, weil sein Name mit dem des Entwurfs
   * verwandt ist — mit der Vorsilbe, die übrig bleibt. `null`, wenn keiner
   * passt.
   *
   * NUR ZUR ANZEIGE. Der Dialog sagt damit, WARUM einer oben steht;
   * ausgewählt wird nichts.
   */
  empfehlung: { skyId: string; vorsilbe: string } | null;
  /**
   * Die Artikelart des Entwurfs — `null` heisst „nicht sicher bestimmbar".
   *
   * Der Dialog braucht sie für zwei Dinge: um zu sagen, WONACH gesucht wird
   * („Basis-Traps derselben Serie"), und um bei `null` eine verständliche
   * Meldung zu zeigen statt einer willkürlichen Liste.
   */
  art: ArticleClass | null;
};

/**
 * Basisfiguren derselben Serie wie `skyId`.
 *
 * `null` heisst „nicht berechtigt" — dieselbe Form wie `searchMergeTargets`
 * und `searchFamilies`, damit der Dialog alle drei gleich behandelt.
 */
export async function searchBaseFigures(
  skyId: string,
  query: string,
): Promise<Basissuche | null> {
  if (!(await isPlatformAdmin())) return null;

  const { serie, entwurfName, art, kandidaten } = await fetchBaseFigures(skyId);
  if (serie === null) {
    return { treffer: [], serie: null, moeglich: 0, gefunden: 0,
             empfehlung: null, art: null };
  }

  /*
   * GESUCHT WIRD IN BEIDEN NAMEN UND IN DER SKY-ID. Der Anzeigename ist, was
   * der Bediener auf der Karte sieht; der rohe ist, was in der Arbeitsmappe
   * steht — und bei einem `display_name_override` sind das zwei
   * verschiedene. Wer eines von beiden tippt, soll die Zeile finden.
   */
  const q = falte(query.trim());
  const roh = query.trim().toLowerCase();
  const gefiltert = q === ""
    ? kandidaten
    : kandidaten.filter((k) => falte(k.name).includes(q)
                            || falte(k.nameRaw).includes(q)
                            || k.skyId.toLowerCase().includes(roh));

  /*
   * SORTIERT WIRD IMMER, auch ohne Suchwort — Anforderung 7. Vorher stand
   * die Liste alphabetisch, und bei über hundert Figuren der Serie war die
   * richtige irgendwo in der Mitte.
   */
  const sortiert = sortByBaseRank(entwurfName ?? "", gefiltert);
  const beste = sortiert[0];
  /*
   * EMPFOHLEN WIRD NUR, WAS WIRKLICH VERWANDT AUSSIEHT — eines der beiden
   * Signale muss greifen. Sonst stünde bei jedem Entwurf irgendeine Figur
   * als „wahrscheinlich" da, bloss weil sie alphabetisch zuerst kommt.
   */
  const stark = beste === undefined ? 0 : baseRank(entwurfName ?? "", beste.nameRaw);
  const schwach = beste === undefined ? 0 : baseWordScore(entwurfName ?? "", beste.nameRaw);
  const empfehlung = beste !== undefined && (stark > 0 || schwach > 0)
    ? {
        skyId: beste.skyId,
        /* Die Vorsilbe gibt es nur bei einem Suffixtreffer; beim schwachen
           Signal bleibt sie leer, und der Satz sagt dann nur „wahrscheinlich
           die richtige". */
        vorsilbe: stark > 0 ? basePrefix(entwurfName ?? "", beste.nameRaw) : "",
      }
    : null;

  return {
    serie,
    art,
    moeglich: kandidaten.length,
    gefunden: gefiltert.length,
    empfehlung,
    treffer: sortiert.slice(0, 8),
  };
}
