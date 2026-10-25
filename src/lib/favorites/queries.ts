/**
 * Reading someone's wishlist.
 *
 * Row level security limits every read here to the caller's own rows. There
 * is no filter on `user_id` in the code because there does not need to be
 * one — and relying on the database for it is the point
 * (`docs/SECURITY.md`).
 *
 * BOTH FUNCTIONS READ IN BULK, and that is not an optimisation detail. The
 * catalog draws up to 561 cards; a per-card "is this favourited" would be
 * 561 requests. The owned state has been loaded this way since V1.5, and the
 * wishlist follows it exactly.
 */
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
import { isCollectible } from "@/lib/catalog/collectible";
import { sortFigures } from "@/lib/catalog/sort";
import type { CatalogFigure } from "@/lib/catalog/types";
import { cache } from "react";

import { currentUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";

type FavoriteRow = {
  sky_id: string;
  skylanders: FigureRow | null;
};

/**
 * The SKY-IDs the signed-in user has marked.
 *
 * Returns an empty set for anonymous visitors, so the catalog renders the
 * same way for everyone and simply shows no hearts filled.
 */
export async function fetchFavoritedSkyIds(): Promise<Set<string>> {
  const supabase = await createClient();
  if (!(await currentUser())) return new Set();

  const { data, error } = await supabase.from("favorites").select("sky_id");
  if (error) throw new Error(`favorites: ${error.message}`);
  return new Set((data ?? []).map((row) => row.sky_id as string));
}

/**
 * The wishlist with the figures attached, in catalog order.
 *
 * INACTIVE FIGURES STAY, and for the same reason the collection keeps them:
 * something somebody marked must not vanish because the catalog import
 * deactivated the row. The figure is then simply not buyable, which is
 * information rather than a reason to forget the wish.
 */
export async function fetchFavorites(): Promise<CatalogFigure[]> {
  const supabase = await createClient();
  if (!(await currentUser())) return [];

  const [lookups, nameIndex, characterIndex, result] = await Promise.all([
    loadLookups(),
    fetchNameIndex(),
    fetchCharacterIndex(),
    // `skylanders(...)` embeds fine: favorites has a direct foreign key to it.
    supabase.from("favorites").select(`sky_id, skylanders(${FIGURE_COLUMNS})`),
  ]);
  if (result.error) throw new Error(`favorites: ${result.error.message}`);

  const figures: CatalogFigure[] = [];
  for (const row of (result.data ?? []) as unknown as FavoriteRow[]) {
    if (!row.skylanders) continue;
    const figure = toFigure(row.skylanders, lookups);
    /*
     * DIE WUNSCHLISTE IST AUSSCHLIESSLICH SAMMELBAR, und die Grenze steht
     * hier an der QUELLE — dieselbe Entscheidung wie in `fetchCollection`
     * (ADR-0128). Was gar nicht erst in die Liste kommt, kann in keinem
     * Filter und in keiner Suche wieder auftauchen.
     *
     * `favorites` hat nur einen Fremdschluessel auf `skylanders`, also
     * KOENNTE dort eine Zubehoerzeile stehen; ueber die Oberflaeche entsteht
     * sie nicht, weil der Katalog kein Zubehoer fuehrt und das Herz nur dort
     * sitzt. Entstuende sie doch, bliebe sie folgenlos.
     */
    if (!isCollectible(figure)) continue;
    figures.push(figure);
  }

  /*
   * Derselbe abgeleitete Anzeigename und dasselbe Element wie im Katalog,
   * aus denselben Funktionen — eine Karte auf der Wunschliste darf nicht
   * anders aussehen als dieselbe Karte im Katalog (ADR-0030).
   */
  const enriched = withCharacterElement(
    withCharacterFamily(withVariants(figures, nameIndex), characterNames(characterIndex)),
    characterElements(characterIndex),
  );

  return sortFigures(enriched);
}

/* ---------------------------------------------------------------------------
 * DIE NACHFRAGE — Zahlen für den Betrieb, und nur Zahlen
 * ------------------------------------------------------------------------ */

/** Die Decke, die `favorite_demand()` selbst zieht (`0145`). */
export const MAX_DEMAND_SKY_IDS = 2000;

/**
 * Wie viele Konten eine Figur vorgemerkt haben, je SKY-ID.
 *
 * EIN AUFRUF FÜR EINE GANZE ANSICHT. Der Figuren-Picker filtert ein Array im
 * Browser (`figure-search.tsx`), das Lager zeichnet knapp 290 Karten — eine
 * Abfrage je Figur wären hunderte Anfragen für eine Zahl. `cache()` bindet
 * das Ergebnis an die Anfrage, also zahlt eine Seite es höchstens einmal,
 * auch wenn Katalog und Lager beide fragen.
 *
 * OHNE LISTE HOLT SIE ALLES, und das ist hier das Kleinere: `favorite_demand()`
 * gibt Figuren OHNE Favorit nicht zurück, also ist die Antwort so groß wie
 * die Zahl der vorgemerkten Figuren — und nicht so groß wie der Katalog. Eine
 * Liste von 534 SKY-IDs zu senden, um 30 Zahlen zu bekommen, wäre die
 * größere Anfrage.
 *
 * WER FRAGEN DARF, ENTSCHEIDET DIE DATENBANK. Die Funktion ist
 * `security definer` hinter `can_operate_active_seller()`; ein Sammler, ein
 * Plattformadministrator und `anon` werden mit `insufficient_privilege`
 * abgewiesen. Hier steht KEINE zweite Rollenprüfung, die auseinanderlaufen
 * könnte — was zurückkommt, ist leer oder richtig.
 *
 * EIN FEHLER BLOCKIERT NICHTS. Eine fehlende Nachfragezahl ist eine fehlende
 * Zusatzinformation, kein Grund, den Picker oder das Lager nicht zu zeigen.
 * Deshalb eine leere Map statt eines Fehlers — die Anzeige verschwindet
 * dann einfach, und der Einkauf geht weiter.
 *
 * @param skyIds  Nur diese Figuren. Ohne Angabe: alle mit mindestens einem
 *   Favoriten. Mehr als 2000 weist `0145` ab, und diese Funktion weist
 *   vorher ab — eine Decke, die erst in der Datenbank greift, ist eine
 *   Fehlermeldung statt einer Grenze.
 */
export const fetchFavoriteDemand = cache(
  async (skyIds?: readonly string[]): Promise<ReadonlyMap<string, number>> => {
    if (skyIds && skyIds.length > MAX_DEMAND_SKY_IDS) {
      throw new Error(
        `favorite demand: ${skyIds.length} SKY-IDs sind zu viele (max ${MAX_DEMAND_SKY_IDS})`);
    }
    if (skyIds && skyIds.length === 0) return new Map();

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("favorite_demand", {
      p_sky_ids: skyIds ? [...skyIds] : null,
    });
    /* Kein `throw`: siehe oben. Ein Sammler landet hier regelmäßig, und für
       ihn ist „keine Zahlen" die richtige Antwort und kein Zwischenfall. */
    if (error || !Array.isArray(data)) return new Map();

    const out = new Map<string, number>();
    for (const row of data as { sky_id: unknown; users: unknown }[]) {
      if (typeof row.sky_id === "string" && typeof row.users === "number") {
        out.set(row.sky_id, row.users);
      }
    }
    return out;
  },
);
