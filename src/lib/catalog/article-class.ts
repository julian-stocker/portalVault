/**
 * Die ARTIKELART einer Katalogzeile — aus strukturierten Daten, nie aus dem Namen.
 *
 * WOZU SIE GEBRAUCHT WIRD. Eine Variante gehört zu einem Basisartikel
 * **derselben Art**: eine Figur zu einer Figur, ein Trap zu einem Trap, ein
 * Fahrzeug zu einem Fahrzeug. Bis zum 2026-10-29 kannte die
 * Basisartikelsuche diese Frage gar nicht — sie bot `Portale` als Basis einer
 * Figur an —, und mein erster Versuch sie zu beantworten war falsch: er
 * schloss alle Nicht-Charaktere aus. Damit hätte ein Trap nie eine Variante
 * bekommen können, und die gibt es (30 der Entwürfe sind Traps, Fahrzeuge,
 * Kristalle oder Magic Items).
 *
 * ZWEI QUELLEN, IN DIESER REIHENFOLGE — und keine davon ist der Name:
 *
 *   1. `item_type` (`0135`). Er trägt `game` und `portal` und ist damit die
 *      härtere Auskunft: er gilt auch dann, wenn jemand eine Kategorie
 *      umbenennt.
 *   2. Der KATEGORIENAME. Gemessen am echten Bestand (2026-10-29): **alle**
 *      640 Figurenzeilen tragen `item_type = 'figure'` — Traps, Fahrzeuge,
 *      Kristalle, Magic Items, Trophies und Locations eingeschlossen. Die
 *      Spalte trennt sie also NICHT; die Kategorie tut es, und sie ist die
 *      Struktur, die der Betreiber selbst gewählt hat.
 *
 * `null` HEISST „KEINE AUSKUNFT" UND IST EIN ERGEBNIS. Eine Kategorie, die
 * hier nicht steht, bekommt keine geratene Art — die Suche bietet dann
 * nichts an und sagt das (CAT-08, Anforderung 7). Eine neue Kategorie ist
 * damit eine Entscheidung und kein Zufall.
 *
 * SIE ENTSCHEIDET NICHT ÜBER FAMILIEN. Ob eine Zeile einen CHARAKTER
 * darstellt, fragt `isCharacterFigure()` in `collectible.ts` — das ist die
 * Frage für `characters`, und sie ist eine andere: ein Trap kann eine
 * Variante haben und trotzdem kein Charakter sein.
 */

/** Die Arten, die der Katalog heute kennt. */
export type ArticleClass =
  | "character" | "trap" | "vehicle" | "crystal" | "magic_item"
  | "trophy" | "location" | "portal" | "game" | "bundle" | "bag" | "accessory";

/**
 * Kategorie → Art, vollständig und ausdrücklich.
 *
 * Gemessen am Bestand vom 2026-10-29: 23 Kategorien, und jede außer
 * `Smoke Test Kategorie` steht hier. Die fehlt mit Absicht — eine
 * Testkategorie ist keine fachliche Art, und eine Zeile darin soll keine
 * Kandidaten bekommen.
 */
const NACH_KATEGORIE: Readonly<Record<string, ArticleClass>> = {
  /* Charakterfiguren — dreizehn Kategorien, und jede ist eine Figur, die
     einen Charakter darstellt. „Varianten & LightCore" gehört dazu: die
     Zeilen darin sind eigenständige Katalogeinträge und dürfen Basis sein. */
  "Figuren": "character",
  "Giants große Figuren": "character",
  "Giants neue Figuren": "character",
  "Giants Series 2 Figuren": "character",
  "Minis": "character",
  "Senseis": "character",
  "Sidekicks": "character",
  "SWAP Force": "character",
  "Swap Force neue Figuren": "character",
  "Trap Masters": "character",
  "Trap Team neue Figuren": "character",
  "Trap Team Series Figuren": "character",
  "Varianten & LightCore": "character",
  /* Und das Zubehör, jede Art für sich. `Trap Items` liegt bei den Traps:
     beides sind Fallen-Artikel, und eine Variante eines Trap Items hat ihre
     Basis dort. */
  "Traps": "trap",
  "Trap Items": "trap",
  "Fahrzeuge": "vehicle",
  "Kreationskristalle": "crystal",
  "Magic Items": "magic_item",
  "Trophies": "trophy",
  "Locations & Truhen": "location",
  "Portale": "portal",
  "Spiele": "game",
  "Bundles": "bundle",
  "Taschen": "bag",
  "Zubehör": "accessory",
};

/** Was `item_type` allein schon sagt — er geht der Kategorie vor. */
const NACH_TYP: Readonly<Record<string, ArticleClass>> = {
  game: "game",
  portal: "portal",
};

export type MitArt = { categoryName: string; itemType?: string | null };

/**
 * Die Art einer Zeile, oder `null`, wenn sie sich nicht sicher sagen lässt.
 *
 * WIDERSPRUCH IST AUCH „KEINE AUSKUNFT": sagt `item_type` `portal` und die
 * Kategorie `Figuren`, dann stimmt eines von beiden nicht, und dann wird
 * nicht entschieden, sondern gefragt. Lieber eine Liste ohne Kandidaten als
 * eine mit falschen.
 */
export function articleClass(row: MitArt): ArticleClass | null {
  const ausTyp = row.itemType === undefined || row.itemType === null
    ? undefined
    : NACH_TYP[row.itemType];
  const ausKategorie = NACH_KATEGORIE[row.categoryName];

  if (ausTyp !== undefined) {
    /* Beide haben eine Meinung und sie weichen ab → keine Auskunft. */
    if (ausKategorie !== undefined && ausKategorie !== ausTyp) return null;
    return ausTyp;
  }
  return ausKategorie ?? null;
}

/** Gehören zwei Zeilen zur selben Art? `null` ist mit nichts gleich. */
export function sameArticleClass(a: MitArt, b: MitArt): boolean {
  const ka = articleClass(a);
  return ka !== null && ka === articleClass(b);
}

/** Alle Kategorien, die zu einer Art gehören — für Tests und Diagnosen. */
export function categoriesOfClass(klasse: ArticleClass): string[] {
  return Object.entries(NACH_KATEGORIE)
    .filter(([, k]) => k === klasse).map(([name]) => name).sort();
}

export { NACH_KATEGORIE as ARTICLE_CLASS_BY_CATEGORY };
