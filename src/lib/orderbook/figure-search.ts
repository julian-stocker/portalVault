/**
 * Finding one figure among eight hundred, while holding it (0064).
 *
 * Pure: no database, no browser. The catalog arrives with the page — that
 * decision is `fetchOrderbookCatalog`'s and predates this file — so searching
 * is a filter over an array that is already in memory. There is no request
 * per keystroke, which is why there is nothing here to debounce and no
 * response that can arrive out of order and overwrite a newer one.
 *
 * WHY RANKING AND NOT JUST `includes`
 *
 * The old add-item box did `name.toLowerCase().includes(q)` and showed the
 * first twelve in catalog order. Type `wash` and `Dark Wash Buckler` can
 * appear above `Wash Buckler`, because the catalog is ordered by SKY-ID and
 * nothing said otherwise. The operator is holding the plain one. Picking the
 * wrong variant is the mistake this whole workflow exists to make cheap to
 * undo, and it is cheaper still not to invite it.
 *
 * So: a word that STARTS with what you typed beats a word that merely
 * contains it, and an exact name wins outright.
 *
 * VARIANTS NEED NO VARIANT SYSTEM. `Free Ranger`, `Legendary Free Ranger` and
 * `Dark Wash Buckler` are separate catalog rows with separate SKY-IDs and
 * separate market prices. The distinguishing information is already there —
 * name, series, id, price — so this ranks canonical rows and invents no
 * metadata about them.
 */

/** One catalog row, as the screens receive it from `fetchOrderbookCatalog`. */
export type FigureChoice = {
  skyId: string;
  /**
   * Was auf dem Schirm steht: der redaktionelle Anzeigename, sonst der
   * Rohname (0117). Dieselbe Auflösung wie im öffentlichen Katalog seit
   * `0004` — `display_name_override ?? name`.
   */
  name: string;
  /**
   * Der ROHNAME aus dem Katalog, falls er sich vom Anzeigenamen
   * unterscheidet (0117).
   *
   * Zwei Gründe, ihn mitzuführen. Erstens die Suche: wer „ohne OVP" tippt —
   * weil er den Namen aus der Arbeitsmappe oder von einem früheren
   * Bildschirm kennt — soll die Zeile trotzdem finden. Zweitens das
   * Schreiben: `seller_add_purchase_item` legt ihn als `raw_name` ab, und
   * das muss der Rohname bleiben und nicht die heutige Darstellung.
   */
  rawName?: string;
  /** The canonical `series_code`: `SA`, `G`, `SF`, `TT`, `SC`, `I`. */
  series: string;
  /** `null` is "no price known" and is never treated as zero. */
  marketPrice: number | null;
  /*
   * Das aufgelöste Bild, oder `null`. OPTIONAL und bewusst nachgereicht:
   * die drei Orderbuch-Bildschirme brauchen es nicht und zeigen es nicht,
   * der Kalkulator (V1) zeigt es. Ein Feld, das `undefined` sein darf, hält
   * bestehende Aufrufer unverändert gültig.
   */
  image?: string | null;
  /**
   * Was für ein Artikel das ist: `figure`, `game`, `portal`, `bundle`,
   * `other` (0135, mitgeliefert seit 0137).
   *
   * OPTIONAL, und das ist kein Zögern: läuft noch die siebenspaltige Fassung
   * von `seller_import_catalog()` — etwa zwischen Migration und Deployment —,
   * fehlt das Feld, und dann verhält sich alles hier wie vorher. `undefined`
   * heißt deshalb „keine Auskunft", nicht „keine Figur".
   */
  itemType?: string;
  /**
   * Der Kategoriename, roh aus dem Katalog (`Spiele`, `Portale`, `Senseis`).
   *
   * Die RPC liefert ihn seit `0117` auf Position 4; bis `0137` hat die
   * Anwendung ihn verworfen. Er macht die Suche brauchbar — „portal" findet
   * Portale, auch wenn der Artikel `84709790` heißt — und er ist DATEN, kein
   * abgeleitetes Etikett: interpretiert wird er nirgends, nur verglichen.
   */
  categoryName?: string;
  /**
   * Wie viele Konten diese Figur vorgemerkt haben (`0145`, ADR-0136).
   *
   * OPTIONAL, und `undefined` heisst „nicht geladen" — nicht „niemand". Die
   * Zahl kommt aus `favorite_demand()`, und die Funktion antwortet nur einem
   * aktiven Verkaeuferbetrieb; ein Sammler, der denselben Picker im
   * Kalkulator benutzt, bekommt sie gar nicht. Figuren OHNE Favorit fehlen
   * in der Antwort, also ist `undefined` auch dort der Normalfall.
   *
   * NUR DATEN, keine Suchgrundlage: `searchFigures()` liest sie nicht, und
   * die Reihenfolge der Treffer aendert sich dadurch nicht. Wer nach
   * Nachfrage sortieren wollte, wuerde eine andere Frage stellen.
   */
  favoriteDemand?: number;
};

/** Below this, a query matches too much to be worth showing. */
export const MIN_QUERY = 2;

/** How many results one list shows. Enough to choose from, few enough to scan. */
export const MAX_RESULTS = 8;

/**
 * Rank buckets, lowest first. Named rather than inlined so the order is
 * legible at the call site and a test can assert on the reason, not a number.
 */
const EXACT_NAME = 0;
const NAME_PREFIX = 1;
const WORD_PREFIX = 2;
const NAME_CONTAINS = 3;
const ID_MATCH = 4;
/*
 * Der Rohname trifft zuletzt (0117). Er ist eine Hilfe für den, der den
 * alten Namen im Kopf hat, und soll den Anzeigenamen nie verdrängen: wer
 * „Elite Spyro" tippt, will die Zeile oben, nicht eine andere, deren
 * ROHname zufällig besser passt.
 */
const RAW_NAME_MATCH = 5;
/*
 * ZULETZT DIE ART DES ARTIKELS (0137).
 *
 * „portal" trifft jedes Portal, „spiel" jedes Spiel — über den
 * Kategorienamen, der mit der Katalogzeile kommt, und über den Artikeltyp
 * selbst. Gebraucht wird das, weil ein Portal `84709790 (SF)` heißt: der
 * Betreiber hat es in der Hand und kennt seinen Namen nicht.
 *
 * UNTEN, UND ZWAR GANZ. Wer „Spyro" tippt, will Figuren und nicht die
 * Kategorie; wer „Portale" tippt, hat nichts anderes gemeint. Ein Treffer
 * auf den Namen schlägt deshalb immer einen Treffer auf die Art.
 *
 * NUR AM WORTANFANG. `includes` hätte „or" aus „Portale" geholt und mit zwei
 * Zeichen den halben Katalog geliefert.
 */
const TYPE_MATCH = 6;

function normalise(text: string): string {
  return text.trim().toLowerCase();
}

/**
 * Which bucket this row falls in, or `null` when it does not match at all.
 *
 * The SKY-ID is searchable because the operator sometimes has it — off a
 * label, out of the ledger, from a previous screen — and typing `0212` should
 * find `SKY-0212` rather than nothing.
 */
export function rankFigure(choice: FigureChoice, query: string): number | null {
  const q = normalise(query);
  if (q.length < MIN_QUERY) return null;

  const name = normalise(choice.name);
  if (name === q) return EXACT_NAME;
  if (name.startsWith(q)) return NAME_PREFIX;
  // `wash` finds `Dark Wash Buckler` at word level, below a real prefix hit.
  if (name.split(/\s+/).some((word) => word.startsWith(q))) return WORD_PREFIX;
  if (name.includes(q)) return NAME_CONTAINS;
  if (normalise(choice.skyId).includes(q)) return ID_MATCH;
  // Erst jetzt der Rohname, und nur wenn er ein anderer ist.
  if (choice.rawName !== undefined && choice.rawName !== choice.name
      && normalise(choice.rawName).includes(q)) return RAW_NAME_MATCH;
  /*
   * Und zuletzt die Art. Eine Figur bleibt davon unberührt: `figure` und
   * die Figurenkategorien tragen keinen Namen, den jemand als Art tippt —
   * und wer doch „figur" eingibt, bekommt die Kategorie `Figuren`, was genau
   * das ist, was er gemeint hat.
   */
  if (choice.categoryName !== undefined
      && normalise(choice.categoryName).startsWith(q)) return TYPE_MATCH;
  if (choice.itemType !== undefined
      && choice.itemType !== "figure" && choice.itemType.startsWith(q)) return TYPE_MATCH;
  return null;
}

/**
 * The results for one query, best first.
 *
 * Ties break by name so the list is stable: the same query always produces
 * the same order, which is what makes the keyboard path (`Enter` takes the
 * first) safe to rely on.
 */
export function searchFigures(
  catalog: readonly FigureChoice[],
  query: string,
  limit: number = MAX_RESULTS,
): FigureChoice[] {
  if (normalise(query).length < MIN_QUERY) return [];
  const ranked: { choice: FigureChoice; rank: number }[] = [];
  for (const choice of catalog) {
    const rank = rankFigure(choice, query);
    if (rank !== null) ranked.push({ choice, rank });
  }
  ranked.sort((a, b) =>
    a.rank !== b.rank ? a.rank - b.rank : a.choice.name.localeCompare(b.choice.name, "de-AT"));
  return ranked.slice(0, Math.max(0, limit)).map((r) => r.choice);
}

/**
 * Ist dieser Artikel KEINE Figur? (0137)
 *
 * Die eine Stelle, an der die Oberfläche das fragt — damit „fehlt das Feld"
 * genau einmal entschieden wird und nicht an fünf Stellen verschieden.
 * Fehlt `itemType`, ist die Antwort NEIN: ohne Auskunft wird kein Artikel
 * zum Zubehör erklärt.
 */
export function isAccessory(choice: FigureChoice): boolean {
  return choice.itemType !== undefined && choice.itemType !== "figure";
}

/**
 * Eine Katalogzeile, wie `seller_import_catalog()` sie liefert — nur die drei
 * Felder, die über die Aufnahme in die Auswahlliste entscheiden.
 *
 * `unknown`, nicht `boolean | string`: die Werte kommen aus einer RPC, und
 * eine ältere Funktionsfassung liefert sie gar nicht. Die Prüfung unten
 * entscheidet das ausdrücklich, statt sich auf einen Typ zu verlassen, den
 * niemand garantiert.
 */
export type CatalogRow = {
  is_active?: unknown;
  catalog_visible?: unknown;
  item_type?: unknown;
};

/**
 * Darf diese Katalogzeile im Einkauf zur Wahl stehen? (0117, geschärft in 0137)
 *
 * ZWEI MASSSTÄBE, UND SIE MESSEN VERSCHIEDENE DINGE.
 *
 *   `is_active`       — TECHNISCH, und er gilt jeder Zeile ohne Ausnahme. Das
 *                       ist der Weg, eine falsch angelegte Zeile aus der
 *                       Auswahl zu nehmen, auch die eines Zubehörartikels.
 *   `catalog_visible` — REDAKTIONELL, und redaktionell heißt: im ÖFFENTLICHEN
 *                       Katalog (ADR-0039). Er gilt deshalb nur FIGUREN.
 *
 * WARUM DIE AUSNAHME NÖTIG IST. `seller_create_catalog_item` schreibt jeden
 * neuen Zubehörartikel mit `catalog_visible = false` — dort gehört er nicht
 * hin. Mit dem Riegel von `0117` auf allen Zeilen wäre genau dieser Artikel
 * unmittelbar nach seiner Entstehung wieder unauffindbar: einmal hinzugefügt,
 * weil die SKY-ID aus der Anlegefunktion direkt in die Position geht — und
 * danach nie wieder, nicht für ein zweites Exemplar und nicht für den
 * nächsten Einkauf. Der Bestand wäre da, die Historie auch, nur der Weg
 * dorthin nicht.
 *
 * FÜR FIGUREN ÄNDERT SICH NICHTS. Der Grund von `0117` war Eon's Elite — drei
 * Katalogzeilen je Figur, von denen zwei nicht mehr angeboten werden —, und
 * der betrifft ausschließlich Figuren.
 *
 * FEHLT `item_type`, bleibt es beim Verhalten von `0117`. Läuft noch die
 * siebenspaltige Fassung der RPC, ist die Zeile „ohne Auskunft", und ohne
 * Auskunft wird keine ausgeblendete Zeile zur Wahl gestellt — die Liste
 * öffnet sich also nicht, sie bleibt wie vorher.
 */
export function isPickableCatalogRow(row: CatalogRow): boolean {
  if (row.is_active === false) return false;
  const accessory = typeof row.item_type === "string" && row.item_type !== "figure";
  return accessory || row.catalog_visible !== false;
}

/** What the search box should say right now. One state, decided in one place. */
export type SearchState = "idle" | "tooShort" | "empty" | "noCatalog" | "results";

export function searchState(
  catalog: readonly FigureChoice[], query: string, results: readonly FigureChoice[],
): SearchState {
  if (catalog.length === 0) return "noCatalog";
  if (query.trim() === "") return "idle";
  if (normalise(query).length < MIN_QUERY) return "tooShort";
  return results.length === 0 ? "empty" : "results";
}

/**
 * Where the keyboard highlight goes next.
 *
 * Clamped rather than wrapped: at the bottom of eight results `ArrowDown`
 * should stay put, not silently jump back to the first one the operator has
 * already rejected.
 */
export function moveHighlight(current: number, delta: number, count: number): number {
  if (count === 0) return 0;
  return Math.min(count - 1, Math.max(0, current + delta));
}
