/**
 * What counts as collectible.
 *
 * The catalog holds console games alongside the figures: 39 of the 600
 * entries are software for Wii, Xbox, PlayStation, 3DS and Switch. They are
 * canonical data — they exist in the legacy spreadsheet, they have SKY-IDs
 * and prices — but nobody collects them, and counting them would distort
 * every progress figure.
 *
 * THE RULE: an entry is collectible unless its category says otherwise.
 *
 * This is the category structure the owner defined, not a name blacklist over
 * individual figures (docs/SKYLANDERS_DATA.md, section 3). Verified against
 * the real data on 2026-09-04:
 *
 *   - exactly 6 categories are named "Spiele", one per series, all at
 *     position 0
 *   - they hold exactly 39 entries, every one of them console software
 *   - no game-like entry exists in any other category (0 false negatives)
 *   - nothing collectible sits inside them (0 false positives)
 *   - independent corroboration: all 39 have NO image, while 534 of the 561
 *     collectible entries do. The legacy image pipeline never gave software a
 *     picture, which is a second signal pointing at the same set.
 *
 * COUPLING TO BE AWARE OF: the category names come from the legacy project
 * (etl/categories.py). Renaming "Spiele" there would silently let software
 * back into the catalog. The test in collectible.test.ts and the note in
 * docs/SKYLANDERS_DATA.md exist so that coupling is visible rather than
 * discovered later.
 *
 * ---------------------------------------------------------------------------
 * ZWEI REGELN SEIT 0137, UND ZWAR ABSICHTLICH
 *
 * Mit dem Zubehör kommen vier weitere Kategorien — `Portale`, `Bundles`,
 * `Taschen`, `Zubehör` —, und mit `0135` kommt eine Eigenschaft der ZEILE:
 * `item_type`. Hier wird beides gefragt, und das ist keine Doppelung:
 *
 *   * Der ARTIKELTYP ist die fachliche Eigenschaft. Er entscheidet zuerst,
 *     weil er auch dann gilt, wenn jemand eine Kategorie anders benennt.
 *   * Der KATEGORIENAME ist die Struktur, die der Betreiber gewählt hat. Er
 *     entscheidet weiter, weil nicht jeder Aufrufer den Artikeltyp kennt —
 *     der Fallback ist das Verhalten von vor `0137`, Zeichen für Zeichen.
 *
 * Eine Figur ist von beidem unberührt: `item_type = 'figure'` und keine der
 * fünf Kategorien. Die Zahlen von heute ändern sich dadurch nicht, und genau
 * das beweist Migration `0137` in ihrer eigenen Transaktion.
 * ---------------------------------------------------------------------------
 */
import type { CatalogFigure } from "@/lib/catalog/types";

/**
 * Category names whose entries are not collectible items.
 *
 * MUSS ZEICHENGLEICH ZU `public.non_collectible_categories()` SEIN — `0006`,
 * erweitert in `0137`. `npm run verify:shop` vergleicht beide Fassungen und
 * meldet jede Abweichung; die SQL-Seite ist die, an der Shop und Fortschritt
 * hängen.
 */
export const NON_COLLECTIBLE_CATEGORIES: ReadonlySet<string> = new Set([
  "Spiele", "Portale", "Bundles", "Taschen", "Zubehör",
]);

export function isCollectibleCategory(categoryName: string): boolean {
  return !NON_COLLECTIBLE_CATEGORIES.has(categoryName);
}

/**
 * Kategorien, deren Zeilen sammelbar sind, aber KEIN Charakter.
 *
 * ZWEI FRAGEN, NICHT EINE. „Sammelbar" heisst: jemand sammelt es, es zaehlt
 * in den Fortschritt. „Charakter" heisst: es ist eine Figur, die einen
 * Charakter DARSTELLT. Ein Trap, ein Fahrzeug, ein Kreationskristall, ein
 * Magic Item, eine Trophy und eine Location sind sammelbar und trotzdem
 * keine Charaktere — `docs/DATABASE.md` nennt die Zahl: 159 der
 * Sammelobjekte sind gar keine Charaktere.
 *
 * WARUM DIESE LISTE HIER STEHT UND NICHT IN EINEM TEST. Sie stand bis zum
 * 2026-10-29 als lokale Konstante `NOT_FIGURES` in
 * `src/lib/catalog/character-data.test.ts` — eine fachliche Regel, die nur
 * ein Test kannte. Beim Bau der Basisfigurensuche (CAT-07/CAT-08) fehlte sie
 * dort: der Dialog bot `Portale`, Traps und Fahrzeuge als Basisfigur an.
 * Eine Regel, die an zwei Stellen gebraucht wird, gehoert an eine.
 *
 * WAS SIE ENTSCHEIDET:
 *
 *   * keine Charakterfamilie enthaelt eine solche Zeile
 *     (`character-data.test.ts` rechnet das gegen die kuratierte Datei nach)
 *   * keine davon wird als BASISFIGUR angeboten (`fetchBaseFigures`)
 *
 * WAS SIE NICHT ENTSCHEIDET: ob die Zeile im Katalog steht, ob sie zaehlt,
 * ob sie verkauft werden darf. Ein Trap ist ein vollwertiges Sammelobjekt.
 *
 * DIE TRAPS SIND DER GRUND, WARUM ES OHNE DIESE LISTE SCHIEFGEHT: sie heissen
 * `<Element> <Form>` — „Fire Torch", „Life Torch", „Dark Sword". Jede
 * Namensregel haelt sie fuer eine Variante von „Torch" bzw. „Sword"
 * (`src/lib/catalog/variant.ts`, ADR-0034). Die Kategorie weiss es besser.
 */
export const NON_CHARACTER_CATEGORIES: ReadonlySet<string> = new Set([
  "Traps", "Trap Items", "Fahrzeuge", "Kreationskristalle",
  "Magic Items", "Trophies", "Locations & Truhen",
]);

/** Sammelbar UND ein Charakter — beides muss gelten. */
export function isCharacterCategory(categoryName: string): boolean {
  return isCollectibleCategory(categoryName)
      && !NON_CHARACTER_CATEGORIES.has(categoryName);
}

/**
 * Dieselbe Frage an einer Zeile, mit dem Artikeltyp davor.
 *
 * Derselbe Aufbau wie `isCollectible()`: der ARTIKELTYP entscheidet zuerst,
 * weil er auch dann gilt, wenn jemand eine Kategorie anders benennt;
 * `undefined` heisst „keine Auskunft" und nicht „kein Charakter".
 */
export function isCharacterFigure(figure: MitTyp): boolean {
  return isCollectible(figure) && isCharacterCategory(figure.categoryName);
}

/**
 * Der Artikeltyp, soweit er bekannt ist.
 *
 * `undefined` heisst „keine Auskunft" und NICHT „keine Figur": ein Aufrufer,
 * der die Spalte nicht gelesen hat, soll das Verhalten von vor `0137`
 * bekommen und nicht den halben Katalog verlieren.
 */
type MitTyp = Pick<CatalogFigure, "categoryName"> & { itemType?: string | null };

export function isCollectible(figure: MitTyp): boolean {
  if (figure.itemType !== undefined && figure.itemType !== null
      && figure.itemType !== "figure") return false;
  return isCollectibleCategory(figure.categoryName);
}

/** Keeps only the collectible entries, order untouched. */
export function collectibleOnly<T extends MitTyp>(figures: readonly T[]): T[] {
  return figures.filter(isCollectible);
}
