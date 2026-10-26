/**
 * Die eigenen Verfuegbarkeitsmeldungen lesen (Phase 4 S4, Migration 0149).
 *
 * ROW LEVEL SECURITY IST DIE GRENZE, nicht ein Filter in diesem Code. Die
 * Richtlinie aus `0148` laesst `authenticated` genau die eigenen Zeilen
 * sehen, und `authenticated` hat auf dieser Tabelle nur `SELECT`. Deshalb
 * steht hier nirgends `eq("user_id", …)`: es braucht es nicht, und sich
 * darauf zu verlassen ist der Punkt (`docs/SECURITY.md`).
 *
 * DIESE DATEI SCHREIBT NICHTS. Das ist keine Nebenbemerkung, sondern eine
 * Zusage des Auftrags: das ANZEIGEN einer Meldung darf sie nicht als gelesen
 * markieren. Lesen und Markieren sind zwei Wege — der zweite liegt in
 * `notification-actions.ts` und wird nur von einer Nutzerhandlung
 * angestossen.
 *
 * VOR `0149` ANTWORTET SIE „KEINE MELDUNGEN", UND DAS IST ABSICHT. Beide
 * Abfragen nennen `read_at` ausdrücklich. Fehlt die Spalte — weil die
 * Migration in dieser Umgebung noch nicht angewendet ist —, antwortet
 * PostgREST mit einem Fehler, und beide Funktionen geben ihren neutralen
 * Wert: leere Liste, Zähler 0. Die Wunschliste lädt dann ganz normal, nur
 * ohne Abschnitt und ohne Marke. Deshalb darf der Code VOR der Migration
 * ausgerollt werden; umgekehrt gilt es ohnehin.
 *
 * DIE NAMEN UND BILDER KOMMEN AUS DERSELBEN MASCHINE wie im Katalog.
 * `toFigure()` und die drei Anreicherungen sind dieselben Funktionen, die
 * `fetchFavorites()` benutzt — eine Meldung darf die Figur nicht anders
 * nennen als die Karte darunter (ADR-0030). Alle beteiligten Nachschlagewerke
 * sind `cache()`-gebunden, also kostet das auf dieser Seite keinen zweiten
 * Zugriff.
 */
import { cache } from "react";

import {
  FIGURE_COLUMNS,
  characterElements,
  characterNames,
  fetchCharacterIndex,
  fetchNameIndex,
  loadLookups,
  toFigure,
  type FigureRow,
  withCharacterElement,
  withCharacterFamily,
  withVariants,
} from "@/lib/catalog/queries";
import type { CatalogFigure } from "@/lib/catalog/types";
import { currentUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";

/**
 * Eine Meldung, zusammen mit der Figur, um die es geht.
 *
 * Die Figur ist ein ganzes `CatalogFigure`, damit die Karte Bild, Namen und
 * Weg daraus nehmen kann, ohne eine zweite Quelle zu haben.
 */
export type AvailabilityNotice = {
  figure: CatalogFigure;
  /** Die Phase, die gemeldet wurde (`0147`). Teil des Schluessels. */
  buyableSince: string;
  /** Der guenstigste Preis ZUM ZEITPUNKT DER MELDUNG, in Cent. */
  cheapestCents: number;
  createdAt: string;
  /** `null` heisst ungelesen. */
  readAt: string | null;
};

type NoticeRow = {
  sky_id: string;
  buyable_since: string;
  cheapest_cents: number;
  created_at: string;
  read_at: string | null;
  skylanders: FigureRow | null;
};

/**
 * Wie viele Meldungen hoechstens geholt werden.
 *
 * Eine Wunschliste hat Dutzende Figuren, nicht Tausende, und jede Figur
 * bekommt je echter Verfuegbarkeitsphase hoechstens eine Meldung. Die Decke
 * ist also grosszuegig — sie steht da, damit ein Konto mit sehr langer
 * Geschichte die Seite nicht mit hundert Karten laedt.
 */
export const MAX_NOTICES = 24;

/**
 * Die eigenen Meldungen, neueste zuerst — ungelesene UND gelesene.
 *
 * GELESENE BLEIBEN SICHTBAR, und das ist eine Entscheidung: „als gelesen
 * markieren" heisst „ich habe es gesehen", nicht „weg damit". Die Karte wird
 * nur ruhiger. Wer eine Meldung loswerden will, entfernt die Figur aus der
 * Wunschliste — dann ist auch die Meldung gegenstandslos.
 */
export const fetchAvailabilityNotices = cache(
  async (): Promise<AvailabilityNotice[]> => {
    const supabase = await createClient();
    if (!(await currentUser())) return [];

    const [lookups, nameIndex, characterIndex, result] = await Promise.all([
      loadLookups(),
      fetchNameIndex(),
      fetchCharacterIndex(),
      /* `skylanders(...)` bettet ein: die Tabelle hat einen direkten
         Fremdschluessel darauf (`0148`). */
      supabase
        .from("availability_notifications")
        .select(
          `sky_id, buyable_since, cheapest_cents, created_at, read_at,`
          + ` skylanders(${FIGURE_COLUMNS})`,
        )
        .order("created_at", { ascending: false })
        .limit(MAX_NOTICES),
    ]);

    /*
     * EIN FEHLER BLOCKIERT NICHTS. Eine fehlende Meldung ist eine fehlende
     * Beigabe, kein Grund, die Wunschliste nicht zu zeigen — dieselbe Regel
     * wie bei `fetchFavoriteDemand()` und `claimAvailabilityNotifications()`.
     */
    if (result.error) return [];

    const rows = (result.data ?? []) as unknown as NoticeRow[];

    /*
     * ERST DIE FIGUREN ANREICHERN, DANN WIEDER ZUSAMMENSETZEN.
     *
     * `withVariants()` und die beiden Charakterfunktionen arbeiten auf einer
     * LISTE von Figuren, nicht auf einer einzelnen — der abgeleitete
     * Anzeigename einer Variante haengt an den Geschwistern. Deshalb gehen
     * alle Figuren zusammen durch die Maschine und werden danach wieder
     * ihren Meldungen zugeordnet.
     */
    const figures: CatalogFigure[] = [];
    for (const row of rows) {
      if (!row.skylanders) continue;
      figures.push(toFigure(row.skylanders, lookups));
    }
    const enriched = withCharacterElement(
      withCharacterFamily(withVariants(figures, nameIndex), characterNames(characterIndex)),
      characterElements(characterIndex),
    );
    const bySkyId = new Map(enriched.map((f) => [f.skyId, f]));

    const notices: AvailabilityNotice[] = [];
    for (const row of rows) {
      const figure = bySkyId.get(row.sky_id);
      /*
       * OHNE FIGUR KEINE KARTE. Die Katalogzeile kann durch den Import
       * deaktiviert worden sein; der Fremdschluessel ist `restrict`, also
       * ist sie noch da, aber `skylanders(...)` koennte sie dennoch nicht
       * liefern. Eine Meldung ohne Namen und Bild waere keine Meldung.
       */
      if (!figure) continue;
      notices.push({
        figure,
        buyableSince: row.buyable_since,
        cheapestCents: row.cheapest_cents,
        createdAt: row.created_at,
        readAt: row.read_at,
      });
    }
    return notices;
  },
);

/**
 * Wie viele eigene Meldungen ungelesen sind — die Zahl fuer die Marke in der
 * Navigationsleiste.
 *
 * NUR DIE ZAHL, nicht die Zeilen. `head: true` mit `count: "exact"` schickt
 * keine Daten zurueck; der Teilindex aus `0149`
 * (`… (user_id) where read_at is null`) beantwortet sie, ohne die gelesenen
 * Zeilen anzusehen. Das ist die haeufigste Abfrage dieser Tabelle: sie laeuft
 * bei jedem Aufruf einer geschuetzten Seite.
 *
 * `cache()` bindet sie an die Anfrage. Die Leiste fragt einmal, und wenn eine
 * Seite dieselbe Zahl noch braucht, kostet sie dort nichts.
 *
 * FUER EIN KONTO OHNE WUNSCHLISTE GIBT ES NICHTS ZU ZAEHLEN, und die Leiste
 * fragt dann auch nicht — `0` ohne Zugriff (siehe `(app)/layout.tsx`).
 */
export const fetchUnreadNoticeCount = cache(async (): Promise<number> => {
  const supabase = await createClient();
  if (!(await currentUser())) return 0;

  const { count, error } = await supabase
    .from("availability_notifications")
    .select("sky_id", { count: "exact", head: true })
    .is("read_at", null);

  /* Kein `throw`: eine fehlende Marke ist besser als eine fehlende Leiste. */
  if (error || typeof count !== "number") return 0;
  return count;
});
