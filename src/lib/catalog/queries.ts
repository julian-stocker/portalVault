/**
 * Reading the catalog.
 *
 * Three small queries — figures, series, categories — joined in code rather
 * than through embedded selects.
 *
 * WHY NOT EMBEDDED SELECTS: there is no direct foreign key from `skylanders`
 * to `series`. The composite key points at `categories(id, series_code)`, and
 * the series is valid transitively through that (docs/DATABASE.md, 3.3).
 * PostgREST therefore cannot infer a `series(...)` embed, and asking for one
 * fails with "Could not find a relationship". Six series and thirty
 * categories are trivial to look up separately.
 *
 * The browser never talks to the database — it receives the result (ADR-0026).
 */
import { cache } from "react";

import type { Character, Element } from "@/lib/catalog/character";
import { asElement } from "@/lib/catalog/element";
import { collectibleOnly, isCollectible, isCollectibleCategory } from "@/lib/catalog/collectible";
import { asCardType } from "@/lib/catalog/card-type";
import {
  asCatalogStatus,
  statusFromVisibility,
  type CatalogStatus,
} from "@/lib/catalog/catalog-status";
import { isCatalogGroup, type CatalogGroup } from "@/lib/catalog/group";
import { buildSearchIndex } from "@/lib/catalog/search";
import { sortFigures } from "@/lib/catalog/sort";
import {
  displayNameFor,
  parseVariant,
  searchFormsFor,
  sortPartsFor,
  parseEliteEdition,
  eliteDisplayNameFor,
  eliteSearchFormsFor,
} from "@/lib/catalog/variant";
import type { CatalogFigure, SeriesOption } from "@/lib/catalog/types";
import { createClient } from "@/lib/supabase/server";

type FigureRow = {
  sky_id: string;
  name: string;
  slug: string;
  series_code: string;
  category_id: number;
  market_price: string | number | null;
  image_file: string | null;
  image_override_path: string | null;
  is_active: boolean;
  catalog_visible: boolean;
  display_name_override: string | null;
  character_id: number | null;
  base_sky_id: string | null;
  card_type: string;
  /* Seit 0135. Optional, damit ein Leser, der die Spalte nicht anfordert,
     dieselbe Zeilenform behält. */
  item_type?: string | null;
  /* Seit 0163 (CAT-10), aus demselben Grund optional. */
  types?: string[] | null;
  visible_type?: string | null;
  visible_type_decided?: boolean | null;
};

// One string literal, not a concatenation: PostgREST's typing reads the
// select list at the type level, and a computed string loses the row type.
const FIGURE_COLUMNS =
  "sky_id, name, slug, series_code, category_id, market_price, image_file, image_override_path, is_active, character_id, base_sky_id, catalog_visible, display_name_override, card_type, item_type, types, visible_type, visible_type_decided";

type Lookups = {
  series: Map<string, { label: string; position: number }>;
  categories: Map<number, { position: number; name: string; catalogGroup: CatalogGroup | null }>;
};

/**
 * The two lookup tables every catalog read needs: the games and the
 * categories. Together about sixteen rows, changed only when an administrator
 * edits a category.
 *
 * Memoised per request. One render of /collection used to run this four
 * times — `fetchCollection` and, inside it, `fetchNameIndex` both ask for it,
 * and `countCollectibleFigures` and `countCollectibleFiguresBySeries` each
 * await it before their own query. That was eight round trips for sixteen
 * rows, and the last two lengthened their branch instead of running alongside
 * it.
 *
 * `cache` is React's per-request memo, the same one `currentUser` and
 * `isAdmin` use. It is not a data cache: it holds nothing between requests,
 * nothing between users, and nothing across a `revalidatePath`. The next
 * request reads both tables again, so an edited category shows up on the very
 * next render — which is why `setCatalogGroup` revalidates `/` and
 * `/collection`.
 *
 * Nothing writes these tables and then reads them back inside one request:
 * `admin_set_catalog_group` is the only writer, and it lives in
 * `lib/admin/actions.ts`, which calls none of the readers above.
 */
const loadLookups = cache(async (): Promise<Lookups> => {
  const supabase = await createClient();
  const [seriesResult, categoryResult] = await Promise.all([
    supabase.from("series").select("code, label, position"),
    supabase.from("categories").select("id, position, name, catalog_group"),
  ]);

  if (seriesResult.error) throw new Error(`series: ${seriesResult.error.message}`);
  if (categoryResult.error) throw new Error(`categories: ${categoryResult.error.message}`);

  return {
    series: new Map(
      (seriesResult.data ?? []).map((row) => [
        row.code as string,
        { label: row.label as string, position: row.position as number },
      ]),
    ),
    categories: new Map(
      (categoryResult.data ?? []).map((row) => [
        row.id as number,
        {
          position: row.position as number,
          name: row.name as string,
          // A value the CHECK constraint already restricts; the guard keeps a
          // future value the app does not know yet out of the type.
          catalogGroup: isCatalogGroup(row.catalog_group) ? row.catalog_group : null,
        },
      ]),
    ),
  };
});

/**
 * numeric(10,2) arrives as a string over the wire. Parsing it here keeps the
 * "null means unknown, never 0" rule intact (ADR-0010).
 */
export function toFigure(row: FigureRow, lookups: Lookups): CatalogFigure {
  const series = lookups.series.get(row.series_code);
  return {
    skyId: row.sky_id,
    name: row.name,
    slug: row.slug,
    seriesCode: row.series_code,
    seriesLabel: series?.label ?? row.series_code,
    seriesPosition: series?.position ?? 0,
    categoryPosition: lookups.categories.get(row.category_id)?.position ?? 0,
    categoryName: lookups.categories.get(row.category_id)?.name ?? "",
    categoryId: row.category_id,
    catalogGroup: lookups.categories.get(row.category_id)?.catalogGroup ?? null,
    /* Guarded rather than cast: the CHECK constraint is the guarantee, and
       this keeps a value a later migration adds — read by an older build —
       out of the artwork lookup instead of into an undefined one. */
    cardType: asCardType(row.card_type),
    /* Roh weitergegeben, nicht gedeutet: `isCollectible()` ist die eine
       Stelle, die daraus eine Folge zieht (0137). */
    itemType: row.item_type ?? null,
    /*
     * DIE TYPMENGE UND DAS BANNER (CAT-10), ebenfalls roh. `bannerType()`
     * ist die eine Stelle, die daraus ein Banner macht, und sie liest
     * AUSSCHLIESSLICH `visible_type` — nie die Menge und nie die
     * Prioritaet: ein abgeleitetes Banner waere eine Veraenderung des
     * oeffentlichen Katalogs ohne Entscheidung (D4).
     */
    types: row.types ?? [],
    visibleType: row.visible_type ?? null,
    visibleTypeDecided: row.visible_type_decided ?? false,
    // Filled in by withVariants() once the series context is known — unless
    // an administrator has chosen the public name, which wins over the
    // derivation (ADR-0039).
    displayName: row.display_name_override ?? row.name,
    sortBaseName: row.display_name_override ?? row.name,
    sortVariantLabel: null,
    // Both spellings, always: a search for the imported name has to keep
    // working after the public name was changed.
    searchIndex: buildSearchIndex(
      row.display_name_override === null ? [row.name] : [row.display_name_override, row.name],
    ),
    marketPrice: row.market_price === null ? null : Number(row.market_price),
    imageFile: row.image_file,
    imageOverridePath: row.image_override_path,
    isActive: row.is_active,
    catalogVisible: row.catalog_visible,
    /* Der gelesene Wert, sonst exakt abgeleitet — siehe `hatStatusSpalte`. */
    catalogStatus:
      asCatalogStatus((row as { catalog_status?: unknown }).catalog_status)
      ?? statusFromVisibility(row.catalog_visible),
    canonicalName: row.name,
    displayNameOverride: row.display_name_override,
    characterId: row.character_id,
    baseSkyId: row.base_sky_id ?? null,
    // Filled in by withCharacterElement() once the character index is known.
    element: null,
  };
}

/**
 * Index of collectible names per series — the lookup the variant rule needs
 * to tell a variant from a name that merely starts with the same word.
 */
export function buildNameIndex(figures: readonly CatalogFigure[]): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  for (const figure of figures) {
    let names = index.get(figure.seriesCode);
    if (!names) {
      names = new Set();
      index.set(figure.seriesCode, names);
    }
    names.add(figure.name);
  }
  return index;
}

/** Derives display name, sort parts and search index (ADR-0030). */
export function withVariants(
  figures: readonly CatalogFigure[],
  nameIndex: ReadonlyMap<string, ReadonlySet<string>>,
): CatalogFigure[] {
  return figures.map((figure) => {
    // An administrator's choice wins over the derivation (ADR-0039). The
    // canonical name still reaches the search index — toFigure put both
    // spellings there — but nothing is inferred from it any more: the public
    // name has been decided.
    if (figure.displayNameOverride !== null) return figure;

    const namesInSeries = nameIndex.get(figure.seriesCode) ?? new Set<string>();

    /*
     * Eon's Elite first (V3.6). It is a different question from the finish
     * system — "which box did this come in" rather than "which finish is
     * this" — and it is asked first because the answers would otherwise
     * collide: "Elite Boomer (2)" must not be read as a figure called
     * "Elite Boomer" with a variant label of "2".
     *
     * `editionLabel` is null for the loose row, so its badge stays empty and
     * only the "- ohne OVP" disappears from what a visitor reads.
     */
    const elite = parseEliteEdition(figure.name, namesInSeries);
    if (elite !== null) {
      return {
        ...figure,
        displayName: eliteDisplayNameFor(elite),
        /*
         * All three rows sort together AND with the character they are a
         * version of: "Boomer", "Eon's Elite Boomer", and the rest of the
         * Boomer family in one block under B — not under E for "Eon's".
         */
        sortBaseName: elite.characterName,
        sortVariantLabel: elite.editionLabel,
        searchIndex: buildSearchIndex(eliteSearchFormsFor(figure.name, elite)),
      };
    }

    const variant = parseVariant(figure.name, namesInSeries);
    const { sortBaseName, sortVariantLabel } = sortPartsFor(figure.name, variant);
    return {
      ...figure,
      displayName: displayNameFor(figure.name, variant),
      sortBaseName,
      sortVariantLabel,
      searchIndex: buildSearchIndex(searchFormsFor(figure.name, variant)),
    };
  });
}

/**
 * Adds the curated character name to the search haystack.
 *
 * "Hot Dog" then also finds "Fire Bone Hot Dog", because the two are linked
 * by character_id — not because the names look alike. Nothing fuzzy happens
 * here: only the exact canonical name of the linked character is added, so
 * "Drobot" still never reaches "Mini Drobit" (a different character), and a
 * figure without a character keeps the index it already had.
 */
export function withCharacterSearch(
  figures: readonly CatalogFigure[],
  characterNames: ReadonlyMap<number, string>,
): CatalogFigure[] {
  return figures.map((figure) => {
    if (figure.characterId === null) return figure;
    const name = characterNames.get(figure.characterId);
    if (name === undefined) return figure;
    const extra = buildSearchIndex([name]);
    if (figure.searchIndex.includes(extra)) return figure;
    return { ...figure, searchIndex: `${figure.searchIndex} | ${extra}` };
  });
}

/**
 * Attaches the curated element to each linked figure.
 *
 * Separate from the search pass so each stays one job, and so a test can
 * prove the obvious thing: a figure without a character keeps `element: null`
 * no matter what its name looks like.
 */
export function withCharacterElement(
  figures: readonly CatalogFigure[],
  elements: ReadonlyMap<number, Element | null>,
): CatalogFigure[] {
  return figures.map((figure) => {
    if (figure.characterId === null) return figure;
    const element = elements.get(figure.characterId) ?? null;
    return element === figure.element ? figure : { ...figure, element };
  });
}

/**
 * THE COLLECTOR FAMILY, WHERE THE CATALOGUE ACTUALLY KNOWS IT (ADR-0070b).
 *
 * `sortBaseName` decides which figures stand together. Until now it came
 * entirely from the NAME: `variant.ts` splits "Legendary Astroblast" into a
 * base and a label, and a name it cannot split stays whole. That works for
 * the forms somebody curated a token for, and it cannot work for the rest —
 * "Dark Turbo Charge D.K." shares no characters with "Turbo Charge Donkey
 * Kong", and "Legendary Grim Creemper" is a typo in the source. ADR-0034
 * lists both as unsolvable by any name rule, which is why the curated link
 * exists in the first place.
 *
 * So where a curated character IS known, it decides the family. The name rule
 * keeps everything else, unchanged.
 *
 * IT WRITES ONE FIELD. That is the whole safety property of this pass:
 * `sortVariantLabel` is what `figure-card.tsx` renders as a seal, and this
 * function never touches it. A figure whose family improves keeps exactly the
 * badge it had — including none. "Kaos in OVP" joins the Kaos family without
 * anyone being told it is an "in OVP" variant, and the derivation cannot
 * invent a label because it has no code that produces one.
 *
 * `displayName` is untouched too: "Gold Fire Kraken" keeps its name and sorts
 * under Fire Kraken. Family, display and badge are three questions with three
 * answers (ADR-0070b).
 *
 * A figure with no character, or one whose id is not in the index, is
 * returned as it came — which is 461 of the 565 collectibles today.
 */
export function withCharacterFamily(
  figures: readonly CatalogFigure[],
  characterNames: ReadonlyMap<number, string>,
): CatalogFigure[] {
  return figures.map((figure) => {
    if (figure.characterId === null) return figure;
    const canonical = characterNames.get(figure.characterId);
    if (canonical === undefined || canonical === figure.sortBaseName) return figure;
    return { ...figure, sortBaseName: canonical };
  });
}

/**
 * DIE BASISFIGUR, WO SIE AUSDRÜCKLICH ZUGEORDNET IST (CAT-07).
 *
 * Der dritte und genaueste Griff nach der Familie. Die Reihenfolge der
 * Durchgänge ist die Architektur:
 *
 *   1. `withVariants()`        die Namensregel — „Legendary Bash" → „Bash",
 *                              aber nur wenn „Bash" in derselben Serie
 *                              wirklich existiert (ADR-0030)
 *   2. `withCharacterFamily()` der kuratierte Charakter, serienübergreifend
 *                              (ADR-0070b)
 *   3. `withBaseFigure()`      diese Funktion: die ausdrücklich zugeordnete
 *                              Basisfigur, innerhalb EINER Serie
 *
 * Jeder spätere überschreibt den früheren, weil er genauer ist. Eine
 * Namensregel rät; ein Charakter sagt „dieselbe Person"; eine Basisfigur
 * sagt „Variante GENAU dieser Figur". Nur die letzte hat ein Mensch je
 * Zeile entschieden.
 *
 * SIE SCHREIBT EIN FELD. Das ist dieselbe Sicherheitszusage wie bei
 * `withCharacterFamily()`: `sortVariantLabel` ist das Siegel, das
 * `figure-card.tsx` zeichnet, und diese Funktion fasst es nicht an. Eine
 * Figur, deren Familie sich verbessert, behält genau das Abzeichen, das sie
 * hatte — auch keines. Und `displayName` bleibt unberührt: „Chrome Spyro"
 * heißt weiter „Chrome Spyro" und sortiert unter Spyro.
 *
 * SIE NIMMT DEN ANZEIGENAMEN DER BASISFIGUR, nicht deren Rohnamen: das ist
 * der Name, unter dem die Basisfigur selbst einsortiert ist, und nur so
 * landen beide im gleichen Block. Steht die Basisfigur nicht in der Liste —
 * weil sie versteckt ist oder ein Entwurf —, bleibt die Variante, wie sie
 * kam. Eine fehlende Zuordnung beschädigt nichts.
 */
export function withBaseFigure(
  figures: readonly CatalogFigure[],
): CatalogFigure[] {
  /* Der Anzeigename je SKY-ID, aus derselben Liste. Kein zweiter Weg und
     keine zweite Abfrage: `fetchCatalog()` hält den ganzen Katalog ohnehin. */
  const anzeige = new Map<string, string>();
  for (const f of figures) anzeige.set(f.skyId, f.displayName);

  return figures.map((figure) => {
    if (figure.baseSkyId === null) return figure;
    const basis = anzeige.get(figure.baseSkyId);
    if (basis === undefined || basis === figure.sortBaseName) return figure;
    return { ...figure, sortBaseName: basis };
  });
}

export type CharacterIndex = Map<number, { canonicalName: string; element: Element | null }>;

/** id -> name and element for every curated character. Nineteen rows today. */
export async function fetchCharacterIndex(): Promise<CharacterIndex> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("characters").select("id, canonical_name, element");
  if (error) throw new Error(`characters: ${error.message}`);
  return new Map(
    (data ?? []).map((row) => [
      row.id as number,
      {
        canonicalName: row.canonical_name as string,
        element: asElement(row.element as string | null),
      },
    ]),
  );
}

/** Convenience views of the index, so callers do not re-map it each time. */
export function characterNames(index: CharacterIndex): Map<number, string> {
  return new Map([...index].map(([id, entry]) => [id, entry.canonicalName]));
}

export function characterElements(index: CharacterIndex): Map<number, Element | null> {
  return new Map([...index].map(([id, entry]) => [id, entry.element]));
}

/**
 * Names of all active collectible figures, grouped by series.
 *
 * Used where the caller does not already hold the whole catalog — a detail
 * page or a collection. One small query rather than loading everything.
 */
export async function fetchNameIndex(): Promise<Map<string, Set<string>>> {
  const supabase = await createClient();
  const [lookups, result] = await Promise.all([
    loadLookups(),
    supabase.from("skylanders").select("name, series_code, category_id").eq("is_active", true).eq("catalog_visible", true),
  ]);
  if (result.error) throw new Error(`name index: ${result.error.message}`);

  const index = new Map<string, Set<string>>();
  for (const row of (result.data ?? []) as { name: string; series_code: string; category_id: number }[]) {
    const category = lookups.categories.get(row.category_id);
    if (!category || !isCollectibleCategory(category.name)) continue;
    let names = index.get(row.series_code);
    if (!names) {
      names = new Set();
      index.set(row.series_code, names);
    }
    names.add(row.name);
  }
  return index;
}

/**
 * All active, collectible figures, in catalog order.
 *
 * Console games stay in the database but never reach the collector catalog
 * (src/lib/catalog/collectible.ts).
 *
 * `includeHidden` is the administrator's view of the **same** catalog, not a
 * second one (ADR-0042). It drops exactly one filter — the editorial
 * `catalog_visible` — so an administrator can find a figure they hid and put
 * it back. Everything else stays: `is_active` still applies, software is
 * still excluded, and the row still has to pass RLS. "Admin mode" means the
 * collector catalog including its hidden entries, never every technical row
 * in `skylanders`.
 */
export async function fetchCatalog(
  options: { includeHidden?: boolean } = {},
): Promise<CatalogFigure[]> {
  const supabase = await createClient();
  let query = supabase.from("skylanders").select(FIGURE_COLUMNS).eq("is_active", true);
  if (!options.includeHidden) query = query.eq("catalog_visible", true);

  const [lookups, result] = await Promise.all([loadLookups(), query]);

  if (result.error) throw new Error(`catalog: ${result.error.message}`);
  const figures = collectibleOnly(
    ((result.data ?? []) as FigureRow[]).map((row) => toFigure(row, lookups)),
  );
  // The catalog already holds every collectible name, so the variant rule
  // needs no extra query here.
  const index = await fetchCharacterIndex();
  const names = characterNames(index);
  const withNames = withVariants(figures, buildNameIndex(figures));
  const withSearch = withCharacterSearch(withNames, names);
  // The family pass runs after the name rule and before the sort: it is the
  // curated answer overriding the derived one, and only for sortBaseName.
  const withFamily = withCharacterFamily(withSearch, names);
  /* Und zuletzt die ausdrücklich zugeordnete Basisfigur: der genaueste
     Griff, deshalb der letzte (CAT-07). Auch sie schreibt nur
     `sortBaseName`. */
  const withBase = withBaseFigure(withFamily);
  return sortFigures(withCharacterElement(withBase, characterElements(index)));
}

/**
 * Die NICHT sammelbaren Katalogzeilen — Spiele, Portale, Bundles, Zubehör.
 *
 * WOFÜR ES DAS GIBT. Das Lager führt seit dem ersten Tag Zeilen auf Spiele:
 * 13 Lagerzeilen und 18 Verkaufspositionen. Die Lagerübersicht konnte sie
 * nicht benennen, weil sie ihre Namen nicht hatte — `fetchCatalog()` legt
 * `collectibleOnly()` über jedes Ergebnis, und das ist richtig: der
 * öffentliche Katalog und die Sammlung zeigen Sammelobjekte. Diese Funktion
 * ist die andere Hälfte derselben Tabelle, für die eine Ansicht, die sie
 * braucht.
 *
 * WARUM NICHT EIN SCHALTER AN `fetchCatalog()`. Weil `fetchCatalog()` den
 * öffentlichen Katalog, die Sammlung, die Detailseite und den Adminkatalog
 * bedient. Ein `includeAccessories`-Flag dort wäre ein Weg, auf dem ein
 * Portal in den Sammlungsfortschritt gerät, sobald jemand es an der falschen
 * Stelle setzt — und der Fortschritt ist eine Zahl, die Nutzer kennen
 * (ADR-0128, Punkt 7). Zwei Funktionen, zwei Mengen, kein Schalter.
 *
 * KEINE VARIANTEN, KEINE CHARAKTERE, KEIN SORTIERDURCHGANG. Ein Portal hat
 * keinen Charakter (ADR-0034) und keine Variantenschwester; die Pipeline von
 * `fetchCatalog()` hätte hier nichts zu tun. Der Anzeigename ist
 * `display_name_override ?? name` — dieselbe Rangfolge, die
 * `seller_import_catalog()` liefert und der Adminkatalog zeigt.
 *
 * UND ABSICHTLICH DER ROHNAME, NICHT DER KURZNAME. ADR-0128 Punkt 1 sieht
 * `Portal – <Serie>` als abgeleiteten Hauptnamen vor. Für eine LAGERLISTE
 * wäre das unbrauchbar: 21 Portale verteilen sich auf sechs Serien, vier
 * davon hießen dann gleich. Der Rohname trägt die Modellnummer, und die
 * unterscheidet die Varianten — `84392790 (G)` gegen `84392080 (G)`.
 *
 * `is_active` IST DIE EINE GRENZE, die auch `fetchCatalog()` zieht, plus
 * der reservierte Bereich: `SKY-9000`–`9999` gehört Fixtures (ADR-0070), und
 * die Prüffigur `SKY-9998` steht in einer Spiele-Kategorie. Sie bleibt damit
 * dort, wo sie heute ist — in der Zeile „außerhalb des Sortiments".
 *
 * ---------------------------------------------------------------------------
 * UND `catalog_visible` ENTSCHEIDET GENAU WIE BEI FIGUREN
 *
 * `includeHidden` ist dasselbe Wort und dieselbe Bedeutung wie bei
 * `fetchCatalog()`: ohne das Flag liefert diese Funktion nur, was
 * redaktionell freigegeben ist. Der öffentliche Zubehörbereich ruft sie
 * deshalb ohne Argument, die LAGERÜBERSICHT mit `includeHidden: true` — dort
 * geht es nicht um Veröffentlichung, sondern darum, eine vorhandene
 * Lagerzeile benennen zu können.
 *
 * DAS IST DIE GANZE SICHTBARKEITSREGEL, und sie ist bewusst keine eigene:
 * ein Portal steht heute auf `catalog_visible = false` (so hat `0138` es
 * angelegt) und erscheint öffentlich erst, wenn ein Administrator es
 * einzeln freigibt. Es gibt keinen Weg, der daran vorbeiführt, und keine
 * Sammelfreigabe.
 *
 * VIER EIGENSCHAFTEN, VIER ENTSCHEIDUNGEN. Sichtbar zu sein heißt nicht
 * sammelbar (`isCollectible()` bleibt nein) und nicht verkäuflich
 * (`is_shop_eligible()` bleibt nein). Siehe `@/lib/catalog/item-type`.
 * ---------------------------------------------------------------------------
 */
export async function fetchAccessoryCatalog(
  options: { includeHidden?: boolean } = {},
): Promise<CatalogFigure[]> {
  const supabase = await createClient();
  let rows = supabase
    .from("skylanders")
    .select(FIGURE_COLUMNS)
    .eq("is_active", true)
    .lt("sky_id", "SKY-9000")
    .order("sky_id");
  if (!options.includeHidden) rows = rows.eq("catalog_visible", true);

  const [lookups, result] = await Promise.all([loadLookups(), rows]);

  if (result.error) throw new Error(`accessory catalog: ${result.error.message}`);
  return ((result.data ?? []) as FigureRow[])
    .map((row) => toFigure(row, lookups))
    /* Das Gegenstück zu `collectibleOnly()`, und über dieselbe eine Regel:
       `isCollectible()` fragt Artikeltyp UND Kategoriename. Eine zweite
       Fassung der Regel hier wäre eine zweite Wahrheit. */
    .filter((figure) => !isCollectible(figure));
}

/** One figure by its slug. Navigation only — the identity is the SKY-ID. */
export async function fetchFigureBySlug(slug: string): Promise<CatalogFigure | null> {
  const supabase = await createClient();
  const [lookups, result] = await Promise.all([
    loadLookups(),
    supabase.from("skylanders").select(FIGURE_COLUMNS).eq("slug", slug).maybeSingle(),
  ]);

  if (result.error) throw new Error(`figure: ${result.error.message}`);
  if (!result.data) return null;

  const figure = toFigure(result.data as FigureRow, lookups);
  const [nameIndex, index] = await Promise.all([fetchNameIndex(), fetchCharacterIndex()]);
  // The same family as everywhere else. One figure on its own never sorts
  // against anything, but no surface may disagree about what family it is in.
  return withCharacterFamily(withVariants([figure], nameIndex), characterNames(index))[0];
}

/**
 * Ein ZUBEHÖRARTIKEL über seinen Slug — oder null.
 *
 * Dieselbe Abfrage wie `fetchFigureBySlug()`, mit zwei Unterschieden, und
 * beide sind der Grund, warum es sie gibt:
 *
 *   * keine Variantenbildung und keine Charakterfamilie. Ein Portal hat
 *     keine Geschwister (ADR-0034), und `withVariants()` über eine einzelne
 *     Zeile wäre eine Behauptung über eine Menge, die es nicht gibt.
 *   * die Sichtbarkeit entscheidet der AUFRUFER, nicht diese Funktion —
 *     genau wie bei `fetchFigureBySlug()`. Die Seite prüft
 *     `catalogVisible` und antwortet sonst mit 404 (ADR-0039).
 */
export async function fetchAccessoryBySlug(slug: string): Promise<CatalogFigure | null> {
  const supabase = await createClient();
  const [lookups, result] = await Promise.all([
    loadLookups(),
    supabase.from("skylanders").select(FIGURE_COLUMNS).eq("slug", slug).maybeSingle(),
  ]);

  if (result.error) throw new Error(`accessory: ${result.error.message}`);
  if (!result.data) return null;

  const figure = toFigure(result.data as FigureRow, lookups);
  /* Eine Figur ist hier falsch: sie hat ihre eigene Seite mit Charakter,
     Variante und Sammeln. Zwei Adressräume, keine Vermischung. */
  return isCollectible(figure) ? null : figure;
}

/** PostgREST meldet so, dass es die Spalte nicht gibt. */
const COLUMN_MISSING = "42703";

/**
 * Die USK-Alterskennzeichnung eines Spiels (`0139`) — oder null.
 *
 * EIGENE ABFRAGE, NICHT IN `FIGURE_COLUMNS`. Die Spaltenliste des Katalogs
 * wird auf JEDER Umgebung ausgeführt, und `usk_rating` gibt es auf
 * Production noch nicht: eine Spalte dort hineinzunehmen, legte den
 * gesamten öffentlichen Katalog lahm, sobald jemand ihn aufruft.
 *
 * `null` heißt deshalb zweierlei, und beides führt zum selben Verhalten:
 * nicht erfasst, oder diese Umgebung kennt die Spalte noch nicht. In
 * beiden Fällen steht im Angebot keine Kennzeichnung — und ohne erfasste
 * Kennzeichnung gibt es ohnehin kein Angebot für ein Spiel
 * (`seller_set_sale_release()`), die beiden Fälle treffen also nie auf ein
 * kaufbares Spiel.
 */
export async function fetchUskRating(skyId: string): Promise<number | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("skylanders").select("usk_rating").eq("sky_id", skyId).maybeSingle();
  if (error) {
    if (error.code === COLUMN_MISSING) return null;
    throw new Error(`usk rating: ${error.message}`);
  }
  const wert = (data as { usk_rating?: number | null } | null)?.usk_rating;
  return typeof wert === "number" ? wert : null;
}

type CharacterRow = {
  id: number;
  canonical_name: string;
  element: string | null;
  species: string | null;
  role_type: string | null;
  short_description: string | null;
  source_url: string | null;
  source_label: string | null;
  verified_at: string | null;
};

const CHARACTER_COLUMNS =
  "id, canonical_name, element, species, role_type, short_description, source_url, source_label, verified_at";

function toCharacter(row: CharacterRow): Character {
  return {
    id: row.id,
    canonicalName: row.canonical_name,
    // The database CHECK already restricts these to the known values, so the
    // cast repeats a guarantee rather than assuming one.
    element: row.element as Character["element"],
    roleType: row.role_type as Character["roleType"],
    species: row.species,
    shortDescription: row.short_description,
    sourceUrl: row.source_url,
    sourceLabel: row.source_label,
    verifiedAt: row.verified_at,
  };
}

/** Everything a detail page shows. Character and related figures are optional. */
export type FigureDetail = {
  figure: CatalogFigure;
  character: Character | null;
  /** Other collectibles of the same character. Never contains `figure`. */
  related: CatalogFigure[];
};

/**
 * One figure with its character context.
 *
 * Two extra queries, and only when the figure actually carries a character:
 * 457 of the 561 collectibles have none today, and those pay nothing.
 */
export async function fetchFigureDetail(slug: string): Promise<FigureDetail | null> {
  const figure = await fetchFigureBySlug(slug);
  if (!figure) return null;
  if (figure.characterId === null) return { figure, character: null, related: [] };

  const supabase = await createClient();
  const [lookups, characterResult, siblingResult] = await Promise.all([
    loadLookups(),
    supabase.from("characters").select(CHARACTER_COLUMNS).eq("id", figure.characterId).maybeSingle(),
    supabase.from("skylanders").select(FIGURE_COLUMNS).eq("character_id", figure.characterId),
  ]);

  if (characterResult.error) throw new Error(`character: ${characterResult.error.message}`);
  if (siblingResult.error) throw new Error(`related figures: ${siblingResult.error.message}`);

  // Same collector rule as everywhere else: software never appears, and the
  // figure the page is about is not listed beside itself.
  const siblings = collectibleOnly(
    ((siblingResult.data ?? []) as FigureRow[])
      .map((row) => toFigure(row, lookups))
      .filter((row) => row.skyId !== figure.skyId),
  );
  const nameIndex = await fetchNameIndex();
  const character = characterResult.data ? toCharacter(characterResult.data as CharacterRow) : null;

  // Every figure here shares the one character, so its element applies to
  // all of them — no second query, and still no derivation from a name.
  const elements = new Map([[figure.characterId, character?.element ?? null]]);
  /*
   * The siblings are exactly the figures that share this one character, so
   * the family name is already in hand — no second query, and the related
   * list orders itself the way the catalogue does.
   */
  const names = new Map(
    character === null ? [] : [[character.id, character.canonicalName] as const],
  );
  const related = sortFigures(
    withCharacterElement(withCharacterFamily(withVariants(siblings, nameIndex), names), elements),
  );

  return {
    figure: withCharacterElement([figure], elements)[0],
    character,
    related,
  };
}

export async function fetchSeries(): Promise<SeriesOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("series")
    .select("code, label, position")
    .order("position");

  if (error) throw new Error(`series: ${error.message}`);
  return (data ?? []).map((row) => ({
    code: row.code as string,
    label: row.label as string,
    position: row.position as number,
  }));
}

/**
 * How many active, collectible figures the catalog holds — the denominator of
 * the collection progress. Software is excluded, so owning every figure can
 * actually reach 100 %.
 */
export async function countCollectibleFigures(): Promise<number> {
  const supabase = await createClient();
  const lookups = await loadLookups();

  const excluded = [...lookups.categories.entries()]
    .filter(([, category]) => !isCollectibleCategory(category.name))
    .map(([id]) => id);

  let query = supabase
    .from("skylanders")
    .select("*", { count: "exact", head: true })
    .eq("is_active", true).eq("catalog_visible", true);

  if (excluded.length > 0) {
    query = query.not("category_id", "in", `(${excluded.join(",")})`);
  }

  const { count, error } = await query;
  if (error) throw new Error(`catalog count: ${error.message}`);
  return count ?? 0;
}

/**
 * How many active collectibles each game holds.
 *
 * The collection page needs exactly this and nothing else from the catalog:
 * the denominators under "12 / 81". It used to load all 561 figures — with
 * names, slugs, prices, images and search indexes — carry them through the
 * variant and character enrichment, and ship them to the browser, only to
 * count them there (V4.3). One column, tallied on the server, answers the
 * same question.
 */
export async function countCollectibleFiguresBySeries(): Promise<Record<string, number>> {
  const supabase = await createClient();
  const lookups = await loadLookups();

  const excluded = [...lookups.categories.entries()]
    .filter(([, category]) => !isCollectibleCategory(category.name))
    .map(([id]) => id);

  let query = supabase.from("skylanders").select("series_code").eq("is_active", true).eq("catalog_visible", true);
  if (excluded.length > 0) {
    query = query.not("category_id", "in", `(${excluded.join(",")})`);
  }

  const { data, error } = await query;
  if (error) throw new Error(`series counts: ${error.message}`);

  const totals: Record<string, number> = {};
  for (const row of data ?? []) {
    const code = row.series_code as string;
    totals[code] = (totals[code] ?? 0) + 1;
  }
  return totals;
}

export type { FigureRow, Lookups };
/**
 * Der redaktionelle Status je SKY-ID — eine eigene, winzige Abfrage.
 *
 * WARUM NICHT IN `FIGURE_COLUMNS`. Zwei Gründe, beide hart:
 *
 *   1. `supabase-js` leitet den Zeilentyp aus dem LITERAL der Spaltenliste
 *      ab. Eine zur Laufzeit zusammengesetzte Liste ergibt
 *      `GenericStringError` — die Typisierung des ganzen Katalogs fiele weg.
 *   2. `catalog_status` kommt erst mit Migration `0152`. Die Spalte in die
 *      Katalogabfrage zu schreiben, bevor sie existiert, beantwortet
 *      PostgREST mit `42703` — und der Katalog wäre leer, bis jemand
 *      migriert.
 *
 * Deshalb eine Abfrage für sich, die nur der Adminbereich stellt: zwei
 * Spalten, keine Verknüpfung, und sie DARF fehlschlagen. Fehlt die Spalte,
 * kommt eine leere Zuordnung zurück, und `statusOf()` leitet den Wert aus
 * `catalogVisible` ab — **exakt**, denn `0152` füllt die Spalte mit derselben
 * Rechnung, und vorher kann es keine Entwürfe geben.
 *
 * Nach `0152` auf Staging UND Production darf der Fehlerzweig verschwinden;
 * die Abfrage selbst bleibt, weil Grund 1 bleibt.
 */
export async function fetchCatalogStatuses(): Promise<Map<string, CatalogStatus>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("skylanders")
    .select("sky_id, catalog_status");
  if (error !== null || data === null) return new Map();
  const aus = new Map<string, CatalogStatus>();
  for (const row of data as { sky_id: string; catalog_status: unknown }[]) {
    const status = asCatalogStatus(row.catalog_status);
    if (status !== null) aus.set(row.sky_id, status);
  }
  return aus;
}

export { loadLookups, FIGURE_COLUMNS };
