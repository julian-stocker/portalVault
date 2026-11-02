/**
 * Catalog search and filtering.
 *
 * Runs entirely in the browser: the whole catalog is 13.6 KB gzipped, so a
 * round trip per keystroke would be slower than the filtering itself
 * (ADR-0026).
 */
import type { CatalogFigure } from "@/lib/catalog/types";

/** Every series, as the "Alle" option in the series tabs. */
export const ALL_SERIES = "all";

/**
 * Folds a string into a comparable form.
 *
 * Umlauts are spelled out the same way the slug rule does, so searching for
 * "fuer" finds "für" and vice versa. Apostrophes vanish so "Spyros" finds
 * "Spyro's".
 */
export function normalizeForSearch(text: string): string {
  return text
    .replace(/ä/gi, "ae")
    .replace(/ö/gi, "oe")
    .replace(/ü/gi, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .trim();
}

/**
 * Substring match. Nothing clever — the catalog is small.
 *
 * Matches against `searchIndex`, which already holds every spelling of the
 * name: the canonical one, the displayed one and the plain word order in
 * between. So "Legendary Bash", "Bash (Legendary)" and "Bash Legendary" all
 * find the same figure (ADR-0030).
 */
export function matchesQuery(figure: CatalogFigure, normalizedQuery: string): boolean {
  if (normalizedQuery === "") return true;
  return figure.searchIndex.includes(normalizedQuery);
}

/** Builds the pre-normalised haystack stored on each figure. */
export function buildSearchIndex(forms: readonly string[]): string {
  return forms.map(normalizeForSearch).join(" | ");
}

export function matchesSeries(figure: CatalogFigure, seriesCode: string): boolean {
  return seriesCode === ALL_SERIES || figure.seriesCode === seriesCode;
}

/**
 * Hides what someone already owns, leaving what is still missing.
 *
 * The catalog's one view filter, and it points the other way round since
 * V4.3: showing everything is the resting state, and switching "Besitz
 * anzeigen" off answers the question a collector actually stands in a shop
 * with — *what do I still need?* The earlier version could only do the
 * opposite, which the collection page already answers better.
 *
 * Applied to the pool *before* search and series, so one narrowing feeds
 * every view the catalog has — the grid and the cross-series search results
 * alike. Doing it inside the search instead would leave a second path that
 * could forget it.
 *
 * Display only. Nothing here writes, and ownership is still marked on every
 * card by the gold frame whether the filter is on or off.
 */
export function missingFigures(
  figures: readonly CatalogFigure[],
  ownedSkyIds: ReadonlySet<string>,
): CatalogFigure[] {
  return figures.filter((figure) => !ownedSkyIds.has(figure.skyId));
}

/**
 * WAS EINE EINGABE ALS SKY-ID BEDEUTET (CAT-18) — oder `null`.
 *
 *   „SKY-0147", „sky-0147", „sky 147", „SKY147"   → genau SKY-0147, nur sie
 *   „0147", „147"                                 → SKY-0147, NEBEN der Namenssuche
 *
 * EXAKT, NIE ALS TEILTREFFER. „147" ist SKY-0147 und nicht SKY-1470; „14"
 * ist SKY-0014 und nicht SKY-0147. Eine SKY-ID hat vier Ziffern
 * (ADR-0001); fünf und mehr sind keine, sondern z. B. eine Modellnummer im
 * Namen eines Portals, und bleiben reine Namenssuche.
 *
 * `exclusive` sagt, ob die Namenssuche daneben schweigt: wer das Präfix
 * tippt, meint die ID; wer nur Ziffern tippt, kann auch einen Namen meinen.
 */
export function skyIdQuery(query: string): { skyId: string; exclusive: boolean } | null {
  const q = query.trim();
  const mitPraefix = /^sky\s*-?\s*(\d{1,4})$/i.exec(q);
  if (mitPraefix) return { skyId: `SKY-${mitPraefix[1].padStart(4, "0")}`, exclusive: true };
  const ziffern = /^(\d{1,4})$/.exec(q);
  if (ziffern) return { skyId: `SKY-${ziffern[1].padStart(4, "0")}`, exclusive: false };
  return null;
}

/**
 * Die Trefferregel, mit oder ohne SKY-ID.
 *
 * NUR DORT, WO DIE SKY-ID EIN ARBEITSWERKZEUG IST — im Admin-Katalog. Ein
 * Sammler sucht nach Namen; „147" soll ihm keine Figur liefern, deren Name
 * nichts davon enthält. Ohne `skyIds` ist das hier exakt `matchesQuery`.
 */
function searcher(query: string, skyIds: boolean): (figure: CatalogFigure) => boolean {
  const normalized = normalizeForSearch(query);
  const id = skyIds ? skyIdQuery(query) : null;
  if (id === null) return (figure) => matchesQuery(figure, normalized);
  if (id.exclusive) return (figure) => figure.skyId === id.skyId;
  return (figure) => figure.skyId === id.skyId || matchesQuery(figure, normalized);
}

/**
 * Der exakte ID-Treffer zuerst, sonst die Reihenfolge der Eingabe. Nur er
 * wandert; alles andere bleibt in Katalogreihenfolge (ADR-0169).
 */
function exactFirst(figures: CatalogFigure[], query: string, skyIds: boolean): CatalogFigure[] {
  const id = skyIds ? skyIdQuery(query) : null;
  if (id === null) return figures;
  const i = figures.findIndex((figure) => figure.skyId === id.skyId);
  return i <= 0 ? figures : [figures[i], ...figures.slice(0, i), ...figures.slice(i + 1)];
}

/** Applies search and series filter together. Order of the input is kept. */
export function filterFigures(
  figures: readonly CatalogFigure[],
  options: { query?: string; seriesCode?: string; skyIds?: boolean },
): CatalogFigure[] {
  const query = options.query ?? "";
  const skyIds = options.skyIds ?? false;
  const series = options.seriesCode ?? ALL_SERIES;
  const trifft = searcher(query, skyIds);
  return exactFirst(
    figures.filter((figure) => matchesSeries(figure, series) && trifft(figure)),
    query, skyIds,
  );
}

/**
 * A catalog search that does not lose figures behind the active tab.
 *
 * The catalog always has one game selected (ADR-0038), which used to mean a
 * search only ever looked inside it: typing "Robot" while Spyro's Adventure
 * was active hid every Robot in the other five games, with nothing on screen
 * to say so.
 *
 * Now the chosen game answers first and the others follow as their own
 * sections. The tab does **not** change — switching it silently would take
 * the visitor somewhere they did not ask to go, and clearing the search has
 * to return them to exactly the view they left.
 */
export type SearchGroup = {
  code: string;
  label: string;
  figures: CatalogFigure[];
  /** True for the group the active tab points at. */
  active: boolean;
};

export function groupSearchResults(
  figures: readonly CatalogFigure[],
  options: {
    query: string;
    /** The active tab. Its group comes first, whether or not it has hits. */
    seriesCode: string;
    /** Series in database order; only those with hits are returned. */
    series: readonly { code: string; label: string }[];
    /** Also resolve SKY-IDs (admin catalogue only, see `skyIdQuery`). */
    skyIds?: boolean;
  },
): SearchGroup[] {
  const skyIds = options.skyIds ?? false;
  const trifft = searcher(options.query, skyIds);
  const hits = new Map<string, CatalogFigure[]>();

  for (const figure of figures) {
    if (!trifft(figure)) continue;
    const list = hits.get(figure.seriesCode);
    if (list) list.push(figure);
    else hits.set(figure.seriesCode, [figure]);
  }

  const ordered = [
    ...options.series.filter((one) => one.code === options.seriesCode),
    ...options.series.filter((one) => one.code !== options.seriesCode),
  ];

  return ordered
    .map((one) => ({
      code: one.code,
      label: one.label,
      figures: exactFirst(hits.get(one.code) ?? [], options.query, skyIds),
      active: one.code === options.seriesCode,
    }))
    // The active group is kept even when empty: "nothing here, but three in
    // Giants" is the answer, and dropping it would hide the question.
    .filter((group) => group.figures.length > 0 || group.active);
}
