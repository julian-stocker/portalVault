import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { catalogFilterCount } from "@/lib/catalog/ownership";
import { collectionFilterCount, NO_FILTERS } from "@/lib/collection/view";

/**
 * The browse system (V3.3).
 *
 * Catalog and collection had each grown their own arrangement of the same
 * gesture — search, pick a game, narrow, look. Three rows of pills before a
 * single figure on a phone, and no way for the eye to tell navigation from
 * narrowing.
 *
 * One hierarchy now: search, then the games, then a toolbar that says what is
 * being shown and what can be done about it. What is in the panel and what
 * stays outside is a decision about MEANING, and these tests hold it.
 */
function source(path: string): string {
  return readFileSync(path, "utf8");
}

/** Comments stripped: these files explain themselves in the words searched for. */
function code(path: string): string {
  return source(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const CATALOG = "src/components/catalog/catalog-view.tsx";
const COLLECTION = "src/components/collection/collection-view.tsx";
const SHEET = "src/components/ui/filter-sheet.tsx";
const TOOLBAR = "src/components/ui/browse-toolbar.tsx";
const BAR = "src/components/ui/filter-bar.tsx";

/* ------------------------------------------------ the counts, as functions */

describe("the filter badge counts real state", () => {
  it("counts nothing when nothing is narrowed", () => {
    expect(catalogFilterCount(null, "all")).toBe(0);
    expect(collectionFilterCount(NO_FILTERS)).toBe(0);
  });

  it("counts each of the catalog's two secondary filters", () => {
    expect(catalogFilterCount("figure", "all")).toBe(1);
    expect(catalogFilterCount(null, "owned")).toBe(1);
    expect(catalogFilterCount(null, "missing")).toBe(1);
    expect(catalogFilterCount("trap", "owned")).toBe(2);
  });

  it("counts the collection's one", () => {
    expect(collectionFilterCount({ duplicatesOnly: true })).toBe(1);
  });

  it("does not count the game or the search box", () => {
    /*
     * Both are on screen. The badge promises "there are narrowings you cannot
     * see", and a chosen game is not one of them — counting it would make the
     * badge lie about what the panel holds.
     */
    expect(catalogFilterCount(null, "all")).toBe(0);
    expect(code(CATALOG)).toContain("catalogFilterCount(group, ownership, availability)");
    expect(code(CATALOG)).not.toMatch(/catalogFilterCount\([^)]*seriesCode/);
    expect(code(CATALOG)).not.toMatch(/catalogFilterCount\([^)]*query/);
  });

  it("is never a literal in the markup", () => {
    for (const file of [CATALOG, COLLECTION]) {
      expect(code(file)).not.toMatch(/activeCount=\{\d/);
    }
  });
});

/* --------------------------------------------- what is inside, what is out */

describe("the games are navigation and stay outside the panel", () => {
  it("the catalog renders its series row outside the sheet", () => {
    const catalog = code(CATALOG);
    const series = catalog.indexOf("<SeriesTabs");
    const sheet = catalog.indexOf("<FilterSheet");
    expect(series).toBeGreaterThan(-1);
    expect(sheet).toBeGreaterThan(series);
  });

  it("the collection renders its game row outside the sheet", () => {
    const collection = code(COLLECTION);
    const bar = collection.indexOf("<FilterBar");
    const sheet = collection.indexOf("<FilterSheet");
    expect(bar).toBeGreaterThan(-1);
    expect(sheet).toBeGreaterThan(bar);
  });

  it("the row is compact and scrolls rather than wrapping", () => {
    // A navigation whose height depends on how many games exist is one the
    // eye has to find again after every change.
    const bar = code(BAR);
    expect(bar).toContain('variant?: "default" | "nav"');
    expect(bar).toContain("overflow-x-auto");
    expect(bar).toContain('nav ? "gap-1.5" : "gap-2 sm:flex-wrap"');
    expect(code("src/components/catalog/series-tabs.tsx")).toContain('variant="nav"');
    expect(code(COLLECTION)).toContain('variant="nav"');
  });

  it("and keeps a 44 px target on touch while shrinking on a pointer", () => {
    const bar = code(BAR);
    expect(bar).toContain("min-h-11");
    expect(bar).toContain("sm:min-h-9");
  });
});

describe("the panel holds only what each page really filters by", () => {
  it("the catalog offers its type tabs and its ownership filter", () => {
    const catalog = code(CATALOG);
    const sheet = catalog.slice(catalog.indexOf("<FilterSheet"), catalog.indexOf("</FilterSheet>"));
    expect(sheet).toContain("<ProductGroupTabs");
    expect(sheet).toContain("<OwnershipFilter");
  });

  it("the collection offers its duplicates filter and nothing else", () => {
    const collection = code(COLLECTION);
    const sheet = collection.slice(
      collection.indexOf("<FilterSheet"),
      collection.indexOf("</FilterSheet>"),
    );
    expect(sheet).toContain("<FilterMenu");
    expect(sheet.match(/<FilterGroup/g)).toHaveLength(1);
  });

  it("no commerce filter reaches the collection, because it has no offers", () => {
    const collection = code(COLLECTION);
    for (const commerce of ["OfferLink", "fetchOffers", "offers", "Angebot"]) {
      expect(collection, `${commerce} is not part of this page (V3.2)`).not.toContain(commerce);
    }
  });

  it("nothing is invented — no sort, no element, no variant, no offer state", () => {
    /*
     * None of these has a filter model behind it. A control for a filter that
     * does not exist is worse than its absence: it promises an answer the
     * data cannot give (ADR-0034).
     */
    for (const file of [CATALOG, COLLECTION]) {
      const sheet = code(file).slice(
        code(file).indexOf("<FilterSheet"),
        code(file).indexOf("</FilterSheet>"),
      );
      for (const invented of ["sort", "Sortier", "element", "Element", "variant", "Variante"]) {
        expect(sheet, `${invented} has no filter model in ${file}`).not.toContain(invented);
      }
    }
  });

  it("the view switch stays out: it draws the rows, it does not narrow them", () => {
    const collection = code(COLLECTION);
    const sheet = collection.slice(
      collection.indexOf("<FilterSheet"),
      collection.indexOf("</FilterSheet>"),
    );
    expect(sheet).not.toContain("ViewToggle");
    expect(collection).toContain("<ViewToggle");
  });
});

/* ------------------------------------------------------------- the toolbar */

describe("both pages use one toolbar", () => {
  it("count on the left, controls on the right, announced politely", () => {
    const toolbar = code(TOOLBAR);
    expect(toolbar).toContain('aria-live="polite"');
    expect(toolbar).toContain("justify-between");
    // It invents no control of its own.
    expect(toolbar).not.toContain("<button");
  });

  it("and both render it", () => {
    expect(code(CATALOG)).toContain("<BrowseToolbar");
    expect(code(COLLECTION)).toContain("<BrowseToolbar");
  });
});

/* ------------------------------------------------- the panel's own contract */

describe("the panel reuses the dialog that exists", () => {
  const sheet = code(SHEET);

  it("is a Modal, not a second dialog", () => {
    expect(sheet).toContain('from "@/components/ui/modal"');
    expect(sheet).toContain("<Modal");
    // Everything the dialog already solves must not be solved again here.
    for (const duplicated of ["createPortal", "addEventListener", "document.body", "Escape"]) {
      expect(sheet, `${duplicated} belongs to Modal`).not.toContain(duplicated);
    }
  });

  it("names itself and its trigger", () => {
    expect(sheet).toContain('aria-haspopup="dialog"');
    expect(sheet).toContain("aria-expanded={open}");
    expect(sheet).toContain("labelledBy={headingId}");
    expect(sheet).toContain("focus-ring");
  });

  it("says the count as a sentence, not only as a bullet", () => {
    expect(sheet).toContain("de.browse.filterActive(activeCount)");
    expect(sheet).toContain('className="sr-only"');
  });

  it("offers a reset only when there is something to reset", () => {
    expect(sheet).toContain("{active ? (");
    expect(sheet).toContain("de.browse.filterReset");
  });

  it("clears the filters and leaves navigation alone", () => {
    /*
     * The reset belongs to the panel, so it clears what the panel holds. The
     * chosen game and the search box are navigation somebody can see; wiping
     * them from in here would undo something they did not ask about.
     */
    const catalog = code(CATALOG);
    const reset = catalog.slice(catalog.indexOf("function resetFilters"));
    const body = reset.slice(0, reset.indexOf("}"));
    // Every filter the panel holds, and only those.
    expect(body).toContain("setOwnership(DEFAULT_OWNERSHIP)");
    expect(body).toContain("setGroup(null)");
    expect(body).toContain("setAvailability(DEFAULT_AVAILABILITY)");
    expect(body).not.toContain("setQuery");
    expect(body).not.toContain("setSeriesCode");
  });

  it("carries no touch target under 44 px", () => {
    expect(sheet).toContain("min-h-11");
    expect(code("src/components/collection/filter-menu.tsx")).toContain("min-h-11");
  });
});

/* --------------------------------------------------------------- behaviour */

describe("the rebuild changed no data path", () => {
  it("adds no fetch, no route push and no URL state", () => {
    for (const file of [CATALOG, COLLECTION, SHEET, TOOLBAR]) {
      const src = code(file);
      for (const forbidden of ["fetch(", "useRouter", "router.push", "useSearchParams", "createClient"]) {
        expect(src, `${forbidden} in ${file}`).not.toContain(forbidden);
      }
    }
  });

  it("keeps the filter state exactly where it was — in the view", () => {
    // The panel owns only whether it is open. Every filter still lives in the
    // page's own state, so nothing about how filtering works moved.
    expect(code(SHEET)).toContain("const [open, setOpen] = useState(false)");
    expect(code(SHEET)).not.toContain("duplicatesOnly");
    expect(code(SHEET)).not.toContain("ownership");
  });
});
