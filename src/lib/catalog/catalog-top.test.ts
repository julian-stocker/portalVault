import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ELEMENTS } from "@/lib/catalog/character";
import {
  CATALOG_SECTIONS,
  activeSection,
  offersSeriesGrid,
  sectionTarget,
} from "@/lib/catalog/catalog-section";
import {
  NO_ELEMENTS,
  elementCoverage,
  isElementActive,
  matchesElement,
  toggleElement,
} from "@/lib/catalog/element-filter";
import {
  DEFAULT_MARKET_RANGE,
  centsToEuro,
  euroToCents,
  isMarketRangeActive,
  matchesMarketRange,
  withoutMarketPrice,
} from "@/lib/catalog/market-filter";
import { catalogFilterCount } from "@/lib/catalog/ownership";
import {
  DEFAULT_QUICK_FILTER,
  QUICK_FILTERS,
  quickFilterOf,
  quickFilterPair,
  quickFiltersFor,
} from "@/lib/catalog/quick-filter";
import {
  SPECIAL_SERIES_FROM,
  isSpecialCode,
  isSpecialSeries,
  mainSeries,
  specialSeries,
} from "@/lib/catalog/series-nav";
import type { SeriesOption } from "@/lib/catalog/types";
import { de } from "@/lib/i18n/de";

/**
 * The catalogue's top area — sections, series, quick filter, advanced filters
 * (UX-01F, ADR-0150).
 *
 * WHAT THIS FILE IS FOR. Four controls changed at once, and three of them
 * replace something that worked. The risks are not in the pixels:
 *
 *   1. a stored preference quietly lost in the rename of a control
 *   2. a combination of filters that used to be expressible and no longer is
 *   3. a filter applied to a narrowed set instead of the whole catalogue
 *   4. a control offered to somebody it cannot answer for
 *
 * Each has a section below.
 */

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const code = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const VIEW = code(read("src/components/catalog/catalog-view.tsx"));
const SWITCH = read("src/components/catalog/catalog-section-switch.tsx");
const GRID = read("src/components/catalog/series-grid.tsx");

/** The real series table on staging, read on 2026-10-27. */
const SERIES: readonly SeriesOption[] = [
  { code: "SA", label: "Spyro's Adventure", position: 0 },
  { code: "G", label: "Giants", position: 1 },
  { code: "SF", label: "Swap Force", position: 2 },
  { code: "T", label: "Trap Team", position: 3 },
  { code: "SC", label: "SuperChargers", position: 4 },
  { code: "I", label: "Imaginators", position: 5 },
  { code: "SMOK", label: "Smoke Test", position: 98 },
  { code: "TEST", label: "RLS Test Series", position: 99 },
];

const figure = (over: Partial<{ element: string | null; marketPrice: number | null }> = {}) => ({
  element: null as never,
  marketPrice: null as number | null,
  ...over,
}) as { element: never; marketPrice: number | null };

/* ========================================================================
 * 1. THREE SECTIONS, TWO MECHANISMS, AND NO PREFERENCE LOST
 * ===================================================================== */

describe("the three sections keep the mechanisms they replaced", () => {
  it("accessories stay a route, the two figure sections stay a view", () => {
    /*
     * MERGING THE CONTROLS WITHOUT MERGING THE MECHANISMS. A route is
     * shareable, bookmarkable and works with the back button (ADR-0128); a
     * remembered view switches instantly and fetches nothing (UX-01C).
     * Both reasons still hold, so both mechanisms stayed.
     */
    expect(sectionTarget("accessories")).toEqual({ kind: "route", href: "/zubehoer" });
    expect(sectionTarget("figures")).toEqual({ kind: "view", href: "/", view: "rows" });
    expect(sectionTarget("cards")).toEqual({ kind: "view", href: "/", view: "cards" });
    expect(CATALOG_SECTIONS).toEqual(["figures", "accessories", "cards"]);
  });

  it("and NO stored preference changes meaning", () => {
    /*
     * THE RISK THE OPERATOR NAMED. The remembered view keeps its key and its
     * two values; only the labels around it changed. So somebody who chose
     * the tiles lands in Figuren and somebody who chose the cards lands in
     * Karten — the same two states they had.
     */
    const store = code(read("src/components/catalog/catalog-view-mode.ts"));
    expect(store).toContain('"skyisles.catalog.view"');
    expect(store).toContain('["cards", "rows"]');
    expect(activeSection("figures", "rows")).toBe("figures");
    expect(activeSection("figures", "cards")).toBe("cards");
  });

  it("on the accessory page the remembered view is not consulted", () => {
    /*
     * Otherwise a visitor whose remembered view is "cards" would see Zubehör
     * AND Karten highlighted — a navigation claiming two places at once.
     */
    for (const view of ["cards", "rows"] as const) {
      expect(activeSection("accessories", view)).toBe("accessories");
    }
  });

  it("the switch is one row of three, and only accessories navigates", () => {
    expect(SWITCH).toContain("<button");
    expect(SWITCH).toContain("<Link");
    /* The branch is on the TARGET's kind, never on the section's name — which
       is what lets "cards" become a route of its own without touching this
       component. */
    expect(SWITCH).toContain('target.kind === "view" && onSelectView');
    expect(SWITCH).not.toMatch(/section === "cards"/);
    /* Three short labels fit a phone, so nothing scrolls. */
    expect(SWITCH).not.toContain("overflow-x-auto");
    expect(SWITCH).toContain("max-w-[34rem]");
  });

  it("coming from the accessory page, a figure section carries its view along", () => {
    /* Otherwise "Karten" from Zubehör would land on whatever was remembered
       last rather than on the cards. */
    expect(SWITCH).toContain("catalogViewStore.write(target.view)");
    expect(SWITCH).toContain("<Link");
  });

  it("und seit UX-01G hat der Schalter zwei Bereiche und keine Kartenpille", () => {
    /*
     * VORHER: `sections={admin ? ["accessories"] : undefined}` und ein
     * `onSelectView`, das die Darstellung umschaltete. Beides ist fort, weil
     * der Katalog nur noch EINE Darstellung hat — die Kachel, für alle drei
     * Konten. Eine Pille „Karten" wäre genau der Zustand mit zwei
     * Beschriftungen, den dieselbe Datei an anderer Stelle ablehnt.
     *
     * Der Schalter ist damit, was er immer war: wo bin ich — Figuren oder
     * Zubehör.
     */
    expect(VIEW).toContain('sections={["figures", "accessories"]}');
    expect(VIEW).not.toContain("onSelectView=");
    expect(VIEW).not.toContain("CatalogViewToggle");
    /* Und die Rolle entscheidet nicht mehr die Darstellung. */
    expect(VIEW).not.toContain('admin ? "card"');
    expect(VIEW).toContain('const layout = "row" as const;');
  });

  it("real collectible cards are a seam, not a feature", () => {
    /*
     * "Karten" shows the classic vertical figure cards for now. The operator
     * asked for the architecture to stay open WITHOUT inventing a card table
     * or a card feature — so the only preparation is that one function says
     * what the section is, and nothing else branches on it.
     */
    const section = read("src/lib/catalog/catalog-section.ts");
    for (const invented of ["card_type", "trading_card", "cards table", "fetchCards",
                            "CardItem", "collectible_card"]) {
      expect(section, `${invented} would be an invented feature`).not.toContain(invented);
    }
    expect(section).toContain("A seam, not a feature");
  });
});

/* ========================================================================
 * 2. THE SERIES GRID
 * ===================================================================== */

describe("the six games are a fixed grid, and the test series are not", () => {
  it("the split comes from the data's own numbering, not from a count", () => {
    /*
     * NINETY RATHER THAN SIX. `series-nav.ts`'s own rule is that nothing
     * about the games is hardcoded — "the first six" would file a seventh
     * game as a special category the day it ships.
     */
    expect(SPECIAL_SERIES_FROM).toBe(90);
    expect(mainSeries(SERIES).map((s) => s.code)).toEqual(["SA", "G", "SF", "T", "SC", "I"]);
    expect(specialSeries(SERIES).map((s) => s.code)).toEqual(["SMOK", "TEST"]);
    /* A seventh game lands in the grid without a decision. */
    const seventh = [...SERIES, { code: "X", label: "Next Game", position: 6 }];
    expect(mainSeries(seventh)).toHaveLength(7);
    expect(isSpecialSeries({ code: "X", label: "Next Game", position: 6 })).toBe(false);
  });

  it("three columns, then six — decided by the CONTAINER", () => {
    /*
     * The operator's refinement of 2026-10-27: 3 x 2 on a phone, 6 x 1 once
     * the block is wide enough, and the switch reads the container rather
     * than the screen — so the same component laid into a narrower column
     * later keeps the 3 x 2 form instead of promising six.
     */
    const grid = code(GRID);
    expect(grid).toContain("@container");
    expect(grid).toContain("grid-cols-3");
    expect(grid).toContain("@min-[44rem]:grid-cols-6");
    /* Capped in the 3-column form, uncapped in the 6-column one. */
    expect(grid).toContain("max-w-[34rem]");
    expect(grid).toContain("@min-[44rem]:max-w-none");
    /* No viewport breakpoint crept in beside the container query. */
    expect(grid).not.toMatch(/\b(?:sm|md|lg|xl):grid-cols/);
  });

  it("the cells are 48 px, uniform, and nothing is truncated", () => {
    const grid = code(GRID);
    /* 48 px is inside the 48-56 asked for and above the 44 px touch floor;
       two lines of 12 px type need 30, so the height is the floor rather than
       the content. */
    expect(grid).toContain("min-h-12");
    expect(grid).not.toContain("h-[");
    /* Equal heights come from the grid itself. Asserted on the CODE: the
       header says at length that nothing is truncated, and naming what you do
       not do is allowed. */
    expect(grid).not.toContain("truncate");
    expect(grid).not.toContain("overflow-x-auto");
    expect(grid).not.toContain("snap-x");
    /* And no figure counts in the cells — the result count has its own row. */
    expect(grid).not.toMatch(/\bcount\b/);
    expect(grid).not.toContain("figures");
  });

  it("the active cell is gold, and spends less gold than ownership does", () => {
    /*
     * GOLD MEANS POSSESSION in this product, and `EditionBanner` was kept off
     * it for exactly that reason — "a gold banner would make an unowned
     * Legendary look owned". The operator asked for a gold series selection
     * anyway, having seen it in a mockup, so the collision is kept from
     * mattering by spending LESS gold: ownership is a ground, an edge AND a
     * glow; the series is an edge and a faint ground with NO glow. The
     * missing glow is also what "keine großen Glüheffekte" asked for.
     */
    const grid = code(GRID);
    expect(grid).toContain("ring-own-line-strong");
    expect(grid).toContain("bg-own-subtle/35");
    expect(grid).toContain("text-own-ink");
    expect(grid, "no glow in the header").not.toContain("shadow-[0_0");
    expect(grid).not.toContain("drop-shadow");
    /* And the tile's ownership marking is untouched — three signals, the
       third of which the header deliberately lacks. */
    const row = code(read("src/components/catalog/figure-row.tsx"));
    expect(row).toContain("bg-own-subtle/70 ring-1 ring-own-line-strong");
    expect(row).toContain("shadow-[0_0_18px_-8px_var(--own-line-strong)]");
  });

  it("and no series icons were invented", () => {
    /* `public/images/` holds brand, cards and skylanders — no series asset
       exists, and the operator said not to invent one. */
    const grid = code(GRID);
    expect(grid).not.toContain("<svg");
    expect(grid).not.toContain("<img");
    expect(grid).not.toContain("icon");
  });

  it("a chosen test series highlights NO cell", () => {
    /*
     * The quiet lie this prevents: standing in Smoke Test while the grid
     * shows Spyro's Adventure as current.
     */
    expect(isSpecialCode(SERIES, "SMOK")).toBe(true);
    expect(isSpecialCode(SERIES, "SA")).toBe(false);
    expect(GRID).toContain("const onSpecial = isSpecialCode(series, active)");
    expect(GRID).toContain("!onSpecial && option.code === active");
  });

  it("the second door is quiet, and absent where there is nothing behind it", () => {
    expect(GRID).toContain("specials.length > 0 ?");
    expect(GRID).toContain("<select");
    expect(de.catalog.seriesExtraLabel).toBe("Sonderkategorien");
    /* Picking the blank option is not an action: there is no such thing as
       no series (ADR-0038). */
    expect(GRID).toContain('if (event.target.value !== "") onSelect');
  });

  it("and the series assignment itself is untouched", () => {
    /* The split decides WHERE a series is offered, never which figures are
       in it. No query, no mapping, no second source. */
    const nav = read("src/lib/catalog/series-nav.ts");
    for (const forbidden of ["seriesCode =", "supabase", "fetch(", "catalog_group"]) {
      expect(nav, `series-nav must not contain ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("the grid is for figures only, because the series means something else for accessories", () => {
    /*
     * MEASURED, NOT ASSUMED. In the figure sections a series is always chosen
     * and there is no "Alle" (ADR-0038); the accessory area defaults to all
     * series and narrows by type and platform instead. One grid for both
     * would make a cell mean two different things.
     */
    expect(offersSeriesGrid("figures")).toBe(true);
    expect(offersSeriesGrid("cards")).toBe(true);
    expect(offersSeriesGrid("accessories")).toBe(false);
    const accessories = code(read("src/components/catalog/accessory-view.tsx"));
    expect(accessories).not.toContain("SeriesGrid");
    expect(accessories).toContain('useState(ALLE)');
  });
});

/* ========================================================================
 * 3. THE QUICK FILTER IS A PROJECTION
 * ===================================================================== */

describe("the quick filter adds no state and loses no combination", () => {
  it("the four values are four pairs of the existing dimensions", () => {
    expect(QUICK_FILTERS).toEqual(["all", "owned", "missing", "available"]);
    expect(DEFAULT_QUICK_FILTER).toBe("all");
    expect(quickFilterPair("all")).toEqual({ ownership: "all", availability: "all" });
    expect(quickFilterPair("owned")).toEqual({ ownership: "owned", availability: "all" });
    expect(quickFilterPair("missing")).toEqual({ ownership: "missing", availability: "all" });
    expect(quickFilterPair("available")).toEqual({ ownership: "all", availability: "available" });
  });

  it("and the mapping is exact in both directions", () => {
    for (const value of QUICK_FILTERS) {
      expect(quickFilterOf(quickFilterPair(value)), value).toBe(value);
    }
  });

  it("the combination the bar cannot name highlights NOTHING", () => {
    /*
     * THE RISK THE OPERATOR'S REQUEST CARRIED. `availability.ts` says in its
     * own header that merging ownership and availability would make "missing
     * AND buyable" — "the whole reason somebody opens a catalog with money in
     * mind" — unexpressible. Nothing was merged: the dialog still sets both,
     * and when it sets that pair the bar shows no selection rather than
     * claiming the nearest segment.
     */
    expect(quickFilterOf({ ownership: "missing", availability: "available" })).toBeNull();
    expect(quickFilterOf({ ownership: "owned", availability: "available" })).toBeNull();
    /* And the dialog still offers both, separately. */
    expect(VIEW).toContain("<OwnershipFilter active={ownership}");
    expect(VIEW).toContain("<AvailabilityFilter active={availability}");
  });

  it("signed out, only the two questions with answers are offered", () => {
    /*
     * "Fehlen" would quietly mean "everything" for somebody who owns
     * nothing — exactly the misleading state the operator ruled out. The
     * rule is the project's existing `offersOwnershipFilter`, not a new one.
     */
    expect(quickFiltersFor(false)).toEqual(["all", "available"]);
    expect(quickFiltersFor(true)).toEqual(QUICK_FILTERS);
    expect(VIEW).toContain("quickFiltersFor(offersOwnershipFilter({ signedIn, admin }))");
  });

  it("and there is no second filter implementation", () => {
    /* The predicates stay the only ones. A quick filter with its own
       matching logic is how two answers to one question start to differ. */
    const quick = code(read("src/lib/catalog/quick-filter.ts"));
    for (const forbidden of ["matchesOwnership", "matchesAvailability", "filter(",
                             "owned.has", "offers["]) {
      expect(quick, `quick-filter must not ${forbidden}`).not.toContain(forbidden);
    }
  });
});

/* ========================================================================
 * 4. THE TWO NEW DIMENSIONS
 * ===================================================================== */

describe("the element filter narrows, and says what it cannot reach", () => {
  it("empty means no narrowing — never 'figures without an element'", () => {
    expect(isElementActive(NO_ELEMENTS)).toBe(false);
    expect(matchesElement(figure({ element: null }), NO_ELEMENTS)).toBe(true);
    expect(matchesElement(figure({ element: "Fire" }), NO_ELEMENTS)).toBe(true);
  });

  it("a figure with no character never matches a chosen element", () => {
    const fire = new Set(["Fire"]) as never;
    expect(matchesElement(figure({ element: "Fire" }), fire)).toBe(true);
    expect(matchesElement(figure({ element: "Water" }), fire)).toBe(false);
    expect(matchesElement(figure({ element: null }), fire)).toBe(false);
  });

  it("several at once, because 'Fire or Water' is a real question", () => {
    const one = toggleElement(NO_ELEMENTS, "Fire");
    const two = toggleElement(one, "Water");
    expect([...two].sort()).toEqual(["Fire", "Water"]);
    expect(toggleElement(two, "Fire").has("Fire")).toBe(false);
    expect(ELEMENTS.length).toBe(10);
  });

  it("and the coverage is counted from the data, not written down", () => {
    /*
     * An element reaches a figure only through a curated `character_id`
     * (ADR-0034), and the curation covered 92 of 594 rows on staging when
     * this was built. A control that hid 85 % of a catalogue without saying
     * so would be a trap, so the panel prints the coverage — computed, so it
     * cannot go stale.
     */
    const figures = [figure({ element: "Fire" }), figure({ element: null }),
                     figure({ element: null })];
    expect(elementCoverage(figures)).toEqual({ withElement: 1, total: 3 });
    expect(elementCoverage([])).toEqual({ withElement: 0, total: 0 });
    expect(de.catalog.elementCurated(92, 594)).toContain("92 von 594");
    const panel = read("src/components/catalog/element-filter.tsx");
    expect(panel).toContain("de.catalog.elementCurated(coverage.withElement, coverage.total)");
  });
});

describe("the market filter is the market value, and says so", () => {
  it("no bound means no narrowing", () => {
    expect(isMarketRangeActive(DEFAULT_MARKET_RANGE)).toBe(false);
    expect(matchesMarketRange(figure({ marketPrice: null }), DEFAULT_MARKET_RANGE, 0)).toBe(true);
  });

  it("both ends are inclusive", () => {
    const range = { minCents: 1000, maxCents: 2000 };
    expect(matchesMarketRange(figure({ marketPrice: 1000 }), range, 0)).toBe(true);
    expect(matchesMarketRange(figure({ marketPrice: 2000 }), range, 0)).toBe(true);
    expect(matchesMarketRange(figure({ marketPrice: 999 }), range, 0)).toBe(false);
    expect(matchesMarketRange(figure({ marketPrice: 2001 }), range, 0)).toBe(false);
  });

  it("a figure nobody has priced does not count as free", () => {
    /* `null` is "nobody has priced this", never 0 (ADR-0010) — so it cannot
       satisfy a bound, and the panel says how many are left out. */
    expect(matchesMarketRange(figure({ marketPrice: null }), { minCents: 0, maxCents: null }, 0))
      .toBe(false);
    expect(withoutMarketPrice([figure({ marketPrice: 100 }), figure({ marketPrice: null })]))
      .toBe(1);
    expect(de.catalog.marketRangeNoPrice(27)).toContain("27");
  });

  it("it compares the PRINTED value, boost included", () => {
    /*
     * The catalogue may print a boosted market value (`0094`). A filter that
     * compared the raw figure would drop a tile showing 11 € out of
     * "bis 12 €" — a disagreement nobody can debug from the screen.
     */
    const range = { minCents: null, maxCents: 1100 };
    expect(matchesMarketRange(figure({ marketPrice: 1000 }), range, 0)).toBe(true);
    expect(matchesMarketRange(figure({ marketPrice: 1000 }), range, 20)).toBe(false);
  });

  it("and it is unmistakably not an offer price", () => {
    expect(de.catalog.marketRangeNav).toBe("Marktwert von/bis");
    expect(de.catalog.marketRangeHint).toBe("Marktwert, nicht Angebotspreis");
    const filter = read("src/lib/catalog/market-filter.ts");
    expect(filter).toContain("market_price");
    /* It reads the figure, never the offers. */
    expect(code(filter)).not.toContain("offers");
    expect(code(filter)).not.toContain("summarizeOffers");
  });

  it("the euro fields are cents, and half-typed input narrows nothing", () => {
    expect(euroToCents("")).toBeNull();
    expect(euroToCents("  ")).toBeNull();
    expect(euroToCents("12")).toBe(1200);
    expect(euroToCents("12,50")).toBe(1250);
    expect(euroToCents("12.50")).toBe(1250);
    expect(euroToCents("-3")).toBeNull();
    expect(euroToCents("abc")).toBeNull();
    expect(centsToEuro(null)).toBe("");
    expect(centsToEuro(1250)).toBe("12.5");
  });
});

/* ========================================================================
 * 5. EVERY COMBINATION, THE WHOLE CATALOGUE, AND AN HONEST BADGE
 * ===================================================================== */

describe("the filters work together, on everything", () => {
  it("all five narrowings happen in ONE pool, so every combination works", () => {
    /*
     * The pipeline, in order: favourites → ownership → group → availability
     * → element → market value. One `useMemo`, one pool, and the search and
     * the series read its result — which is what makes series × group ×
     * ownership × availability × element × market combine by construction
     * rather than by five special cases.
     */
    const pool = VIEW.slice(VIEW.indexOf("const pool = useMemo"), VIEW.indexOf("const quick ="));
    const order = ["favoritesOnly", "matchesOwnership", "matchesGroup",
                   "matchesAvailability", "matchesElement", "matchesMarketRange"];
    let at = -1;
    for (const step of order) {
      const next = pool.indexOf(step);
      expect(next, `${step} is missing from the pool`).toBeGreaterThan(-1);
      expect(next, `${step} is out of order`).toBeGreaterThan(at);
      at = next;
    }
    /* And the search reads the pool, not the other way round. */
    expect(VIEW).toContain("filterFigures(pool, { query: deferredQuery, seriesCode })");
  });

  it("and on the WHOLE catalogue — there is no pagination to filter a slice of", () => {
    /*
     * THE RISK THE OPERATOR NAMED. The catalogue is handed to the browser
     * once (ADR-0043), so a filter cannot accidentally see a page of it.
     * Asserted by absence, because that is what the guarantee is.
     */
    /*
     * Patterns rather than bare words: `underline-offset-4` and
     * `outline-offset-1` are CSS utilities and say nothing about paging, so a
     * substring test on "offset" would fail for the wrong reason — which it
     * did, the first time this was written.
     */
    for (const paging of [/\.slice\(\s*0\s*,/, /\bpageSize\b/, /\boffset:/,
                          /\blimit\b/, /\bcursor\b/, /\bloadMore\b/,
                          /\bfetchMore\b/, /\binfinite/i, /\bPAGE_SIZE\b/]) {
      expect(VIEW, `${paging} would make the pool a slice`).not.toMatch(paging);
    }
    expect(VIEW).toContain("const pool = useMemo");
  });

  it("the badge counts what is hidden, and the quick bar is not hidden", () => {
    /*
     * The badge promises "there are narrowings you cannot see". Since the
     * quick bar shows ownership and availability, counting them would say
     * that about two a visitor is looking at — the same mistake as counting
     * the chosen game.
     */
    expect(catalogFilterCount(null, "all")).toBe(0);
    expect(catalogFilterCount(null, "owned")).toBe(1);
    expect(catalogFilterCount(null, "owned", "all", { quickVisible: true })).toBe(0);
    expect(catalogFilterCount(null, "missing", "available", { quickVisible: false })).toBe(2);
    /* The two new ones are inside the dialog, so they always count. */
    expect(catalogFilterCount(null, "all", "all", { element: true })).toBe(1);
    expect(catalogFilterCount(null, "all", "all", { market: true })).toBe(1);
    expect(catalogFilterCount("trap", "all", "all", { element: true, market: true })).toBe(3);
    expect(VIEW).toContain("quickVisible: quick !== null");
  });

  it("and resetting the dialog clears the two new ones as well", () => {
    const reset = VIEW.slice(VIEW.indexOf("function resetFilters"), VIEW.indexOf("function card"));
    expect(reset).toContain("setElements(NO_ELEMENTS)");
    expect(reset).toContain("setMarket(DEFAULT_MARKET_RANGE)");
  });
});
