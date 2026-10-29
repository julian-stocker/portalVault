import { describe, expect, it } from "vitest";

import { de } from "@/lib/i18n/de";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  CATALOG_VIEWS,
  DEFAULT_CATALOG_VIEW,
  catalogViewStore,
  layoutFor,
} from "@/components/catalog/catalog-view-mode";
import {
  GRID_GAP_X,
  GRID_GAP_Y,
  NAME_LINES,
  PHONE_WIDTHS,
  ROW,
  TILE_COLUMNS_MAX,
  TILE_MAX,
  TILE_MIN,
  TWO_COLUMN_AT_PX,
  DESKTOP_WIDTHS,
  containerWidth,
  nameCharsPerLine,
  phoneRowWidth,
  rowTextWidth,
  tileColumns,
  tileWidth,
} from "@/lib/catalog/row-template";

/**
 * The view switch (UX-01C, ADR-0148).
 *
 * WHAT THESE TESTS ARE ABOUT. The switch is the smallest part of this step;
 * the risk is entirely in what it must NOT disturb. Four things, and each one
 * is checkable:
 *
 *   1. it is a drawing choice, so no filter, search, series or group may
 *      depend on it — proved from the dependency arrays, not by reading JSX
 *   2. it is the catalogue's own choice, under its own key, and the
 *      collection's is untouched
 *   3. all three surfaces read ONE value, so the answer does not change with
 *      the page somebody asks it on
 *   4. the two-column desktop step is a measurement, not a preference
 *
 * `view-store.test.ts` covers the storage mechanics against a real
 * `localStorage`; this file covers the wiring and the arithmetic.
 */

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const code = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const CATALOG_VIEW = "src/components/catalog/catalog-view.tsx";
const SHOP_VIEW = "src/components/shop/shop-view.tsx";
const COLLECTION_VIEW = "src/components/collection/collection-view.tsx";
const GRID = "src/components/catalog/figure-grid.tsx";
const TOGGLE = "src/components/catalog/catalog-view-toggle.tsx";
const MODE = "src/components/catalog/catalog-view-mode.ts";

const catalog = code(read(CATALOG_VIEW));
const shop = code(read(SHOP_VIEW));
const grid = code(read(GRID));
const toggle = code(read(TOGGLE));

/* ========================================================================
 * 1. THE MODE ITSELF
 * ===================================================================== */

describe("two presentations, and the card is the default", () => {
  it("offers exactly cards and rows, in that order", () => {
    expect(CATALOG_VIEWS).toEqual(["cards", "rows"]);
  });

  it("starts on the card, so a first visit is unchanged", () => {
    /*
     * The operator's decision. The collection defaults the other way — to
     * its table — because a large collection is read before it is browsed;
     * the catalogue is a vitrine, and the card is what a collector comes for.
     */
    expect(DEFAULT_CATALOG_VIEW).toBe("cards");
    expect(catalogViewStore.fallback).toBe("cards");
    expect(catalogViewStore.server()).toBe("cards");
  });

  it("maps a view to a card layout, and the two vocabularies stay separate", () => {
    /* A function rather than a cast: the mode names a VIEW and the card
       names a LAYOUT, and a rename on either side should fail here rather
       than silently in the markup. */
    expect(layoutFor("cards")).toBe("card");
    expect(layoutFor("rows")).toBe("row");
  });

  it("its grid mode and its view share one vocabulary, so no third mapping exists", () => {
    /* `FigureGrid`'s mode is deliberately the SAME two words, so the views
       can pass `view` straight through. One mapping (`layoutFor`) is enough
       for the whole feature. */
    expect(grid).toContain('export type GridMode = "cards" | "rows"');
    expect(catalog).toContain("mode={gridMode}");
    expect(shop).toContain("mode={view}");
  });
});

/* ========================================================================
 * 2. INDEPENDENT OF THE COLLECTION
 * ===================================================================== */

describe("the catalogue's choice is its own", () => {
  it("under its own key", () => {
    expect(catalogViewStore.key).toBe("skyisles.catalog.view");
  });

  it("and the collection's key is a different string, still in its own module", () => {
    /*
     * Two keys because they are two questions: the collection chooses between
     * cards and a TABLE, the catalogue between two kinds of card. One shared
     * value would force "table" to mean something here.
     */
    const collectionMode = read("src/components/collection/view-mode.ts");
    expect(collectionMode).toContain('const STORAGE_KEY = "skyisles.collection.view"');
    expect(collectionMode).not.toContain("skyisles.catalog.view");
    /* On the stripped source: the catalogue's module NAMES the collection's
       key in a comment, to say why it is not reused. What matters is that no
       line of code reaches for it. */
    expect(code(read(MODE))).not.toContain("skyisles.collection.view");
    expect(catalogViewStore.key).not.toBe("skyisles.collection.view");
  });

  it("the collection keeps its own switch and gains no row", () => {
    const collection = code(read(COLLECTION_VIEW));
    expect(collection).toContain("<ViewToggle");
    expect(collection).toContain(
      "useSyncExternalStore(subscribeViewMode, readViewMode, serverViewMode)",
    );
    expect(collection).not.toContain("FigureRow");
    expect(collection).not.toContain("catalogViewStore");
    expect(collection).not.toMatch(/layout=\{/);
  });

  it("and nothing in the catalogue's chain reaches into the collection", () => {
    /*
     * `src/lib/shop/accessory-sale-ui.test.ts` already forbids the word
     * "collection" in `shop-view.tsx`; this keeps the new modules on the
     * right side of that line too, which is why the store is generic rather
     * than imported from the showcase.
     */
    for (const [name, file] of [["mode", MODE], ["toggle", TOGGLE],
                                ["store", "src/lib/ui/view-store.ts"]] as const) {
      expect(code(read(file)), `${name} imports from the collection`)
        .not.toMatch(/components\/collection/);
    }
  });
});

/* ========================================================================
 * 3. IT DRAWS, IT DOES NOT NARROW
 * ===================================================================== */

describe("no filter, search, series or group depends on the view", () => {
  /** The dependency array of a named `useMemo` in the catalogue. */
  function deps(after: string): string {
    const from = catalog.indexOf(after);
    expect(from, after).toBeGreaterThan(-1);
    const open = catalog.indexOf("[", catalog.indexOf("}, [", from));
    const close = catalog.indexOf("]", open);
    expect(close).toBeGreaterThan(open);
    return catalog.slice(open, close + 1);
  }

  it("the pool, the visible list and the search groups all ignore it", () => {
    /*
     * THE STRONGEST FORM THIS CAN TAKE WITHOUT A BROWSER. A memo cannot
     * depend on a value its dependency array does not name, so if none of
     * the three names the view, switching cannot change what they compute —
     * and therefore cannot change which figures are on screen.
     */
    for (const memo of ["const pool = useMemo", "const visible = useMemo",
                        "const groups = useMemo"]) {
      const list = deps(memo);
      for (const forbidden of ["view", "layout", "gridMode"]) {
        expect(list, `${memo} depends on ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("the reset, the filter count and the badge know nothing about it either", () => {
    const narrowing = catalog.slice(
      catalog.indexOf("function reset()"),
      catalog.indexOf("function card("),
    );
    for (const forbidden of ["view", "layout", "gridMode"]) {
      expect(narrowing, `narrowing mentions ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("switching reaches exactly two places: the card's layout and the grid's mode", () => {
    /* Everything else in the file is untouched by the choice. */
    expect(catalog).toContain("layout={layout}");
    expect(catalog.match(/mode=\{gridMode\}/g) ?? []).toHaveLength(2); // both grids
  });

  it("and it is not a navigation — no router, no refresh, no URL", () => {
    for (const [name, src] of [["catalogue", catalog], ["shop", shop],
                               ["toggle", toggle]] as const) {
      expect(src, `${name} navigates`).not.toContain("useRouter");
      expect(src, `${name} navigates`).not.toContain("router.");
      expect(src, `${name} writes the URL`).not.toContain("history.pushState");
      expect(src, `${name} uses query state`).not.toContain("useSearchParams");
    }
  });

  it("der Katalog hat seit UX-01G keinen Umschalter mehr — der Shop hat ihn", () => {
    /*
     * DIE REGEL BLEIBT, DIE FLÄCHE WECHSELT. Eine Darstellungswahl gehört
     * nicht zu den Einschränkungen (`ui/browse.test.ts`), sonst zählte das
     * Filterabzeichen etwas, das nichts einschränkt. Im KATALOG gibt es
     * seit UX-01G gar keine Wahl mehr: eine Kachel für alle drei Konten.
     * Der SHOP behält seine, und dort gilt die Regel weiter.
     */
    expect(catalog).not.toContain("CatalogViewToggle");
    const sheet = shop.slice(shop.indexOf("<FilterSheet"), shop.indexOf("</FilterSheet>"));
    expect(sheet).not.toContain("CatalogViewToggle");
    expect(shop).toContain("<CatalogViewToggle");
  });
});

/* ========================================================================
 * 4. ALL THREE SURFACES, AND THEIR DIFFERENCES KEPT
 * ===================================================================== */

describe("three surfaces, one remembered choice", () => {
  it("der Shop liest den Speicher — der Katalog nicht mehr", () => {
    /*
     * UX-01G: zwei Flächen, eine Frage, und der Katalog stellt sie nicht
     * mehr. Er hat eine Darstellung; ein gemerkter Wert aus dem Shop soll
     * dort nichts bedeuten, und deshalb liest er ihn gar nicht.
     */
    for (const teil of ["catalogViewStore.subscribe", "catalogViewStore.read",
                        "catalogViewStore.server"]) {
      expect(shop, `shop: ${teil}`).toContain(teil);
      expect(catalog, `catalogue: ${teil}`).not.toContain(teil);
    }
    /* Der Speicher selbst bleibt — eine Fläche benutzt ihn. */
    expect(read("src/components/catalog/catalog-view-mode.ts"))
      .toContain("catalogViewStore");
  });

  it("and the wishlist gets it for free, because it IS the catalogue", () => {
    /*
     * `/favoriten` renders `CatalogView` with a smaller set of figures and
     * `favoritesOnly` (ADR-0136). That is the whole reason it needs no
     * wiring of its own — and the reason this test exists is that a future
     * change which gave it a view of its own would silently lose the switch.
     */
    const page = code(read("src/app/(app)/favoriten/page.tsx"));
    expect(page).toContain("<CatalogView");
    expect(page).toContain("favoritesOnly");
    expect(page).not.toContain("FigureGrid");
    expect(page).not.toContain("CatalogViewToggle");
  });

  it("the shop keeps its series label, its sign-in link and its own quick view", () => {
    /* The differences between the surfaces survive the switch: they are
       props on the card, and the layout is a third one beside them. */
    expect(shop).toContain("showSeries");
    expect(shop).toContain("layout={layoutFor(view)}");
    expect(shop).toContain("signInHref");
    expect(shop.match(/<QuickView/g) ?? []).toHaveLength(1);
  });

  it("the shop still offers no heart and no ownership ranking", () => {
    /*
     * Unchanged by UX-01C and worth holding: `favorites` is off here, so no
     * heart; `knowsCollection` is absent, so no ownership ranking — the shop
     * loads ownership only to mark what somebody already has.
     */
    expect(shop).not.toContain("favorites");
    expect(shop).not.toContain("knowsCollection");
  });

  it("seit UX-01G bekommt JEDE Rolle dieselbe Kachel", () => {
    /*
     * HIER STAND DAS GEGENTEIL, und es war der Anlass dieses Schritts:
     * `const layout = admin ? "card" : layoutFor(view)` — ein Administrator
     * bekam immer die klassische Sammelkarte. Das war die einzige Stelle im
     * Katalog, an der die ROLLE das Aussehen entschied.
     *
     * Jetzt entscheidet sie nur noch die HANDLUNGEN, und die stehen in der
     * Aktionsleiste derselben Kachel: `[Glocke] [Info] [Herz]` beim Sammler,
     * `[Info]` beim Betrieb, `[Info] [Stift] [Auge]` beim Administrator.
     */
    expect(catalog).toContain('const layout = "row" as const;');
    expect(catalog).toContain('const gridMode = "rows" as const;');
    expect(catalog).not.toContain('admin ? "card"');
    expect(catalog).not.toContain('admin ? "cards"');
    /* Und keine Darstellungswahl mehr, nirgends im Katalog. */
    expect(catalog).not.toContain("CatalogViewToggle");
    expect(catalog).not.toContain("onSelectView=");
    /* Die Rolle reist als Kontoart zur Kachel. */
    expect(catalog).toContain("accountType={accountType}");
  });

  it("the accessory area is not switched, and keeps the card grid it had", () => {
    /* Only the three named surfaces. The accessory tile has no row, so a
       switch there would offer a state it cannot draw. */
    const accessories = code(read("src/components/catalog/accessory-view.tsx"));
    expect(accessories).not.toContain("CatalogViewToggle");
    expect(accessories).not.toContain("catalogViewStore");
    /*
     * It DOES carry the section switch since UX-01F — that is how somebody
     * gets back to the figures — but it passes the default view and never
     * reads the stored one: on this page Zubehör is current, and
     * `activeSection` deliberately does not consult the view for it.
     */
    expect(accessories).toContain("<CatalogSectionSwitch");
    expect(accessories).toContain("view={DEFAULT_CATALOG_VIEW}");
  });
});

/* ========================================================================
 * 5. THE GRID, AND WHY lg: IS THE BREAKPOINT
 * ===================================================================== */

describe("the grid lays out rows in one column, two from a container query", () => {
  it("the card grid is unchanged, character for character", () => {
    /*
     * `accessory-grid.test.ts` holds `accessory-view.tsx` against this exact
     * literal so the two areas cannot drift apart. Adding a rows mode must
     * not disturb it.
     */
    expect(grid).toContain("grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4");
    expect(grid).toContain('dense ? " xl:grid-cols-5" : ""');
  });

  it("tiles ask the REAL width, and no longer at a single threshold (UX-01E)", () => {
    /*
     * A container query was already the right KIND of answer — the question
     * "how many fit" is about the box, not the screen. But it answered at ONE
     * number: 52 rem, two columns, nothing in between. `auto-fill` answers
     * continuously, at every width, with no threshold to keep in step with
     * the page's own layout — so the query, and the wrapper that existed only
     * to be measured, are both gone.
     */
    expect(grid).toContain("grid-cols-[repeat(auto-fill,minmax(min(360px,100%),1fr))]");
    expect(grid).toContain("gap-x-3 gap-y-2");
    /*
     * AND NO `justify-content`, WHICH IS PART OF THE FIX. `1fr` tracks take
     * the whole row between them, so there is nothing left over to centre —
     * and a `justify-center` that DID have leftover space was what made the
     * single mis-counted tile sit in the middle of an empty page instead of
     * overflowing visibly, which is why the bug read as a design choice.
     */
    expect(grid).not.toContain("justify-center");
    expect(grid).not.toContain("@container");
    expect(grid).not.toContain("@min-[52rem]");
    /*
     * And no viewport breakpoint crept back in to replace it — asserted on
     * the ROWS literal alone, because the CARDS literal beside it legitimately
     * uses `sm:` and `md:` and must keep doing so.
     */
    const rows = grid.slice(grid.indexOf("const ROWS ="), grid.indexOf("export function FigureGrid"));
    expect(rows).not.toMatch(/\b(?:sm|md|lg|xl):/);
    expect(rows).not.toMatch(/@min-\[/);
  });

  it("the numbers in the class agree with the geometry module", () => {
    /*
     * THE TRACK CARRIES THE MINIMUM AND `1fr`, NEVER A DEFINITE MAXIMUM —
     * the regression this test exists to prevent. `auto-fill` counts
     * repetitions by the track's maximum whenever that maximum is definite,
     * so writing the tile's 520 px ceiling into the track made the browser
     * count 520 px tiles: one on a normal laptop window, never three. The
     * ceiling belongs to the tile; the track's maximum must stay indefinite.
     */
    expect(grid).toContain(`minmax(min(${TILE_MIN}px,100%),1fr)`);
    expect(grid, "a definite maximum in the track breaks the count")
      .not.toMatch(/minmax\(min\([^)]*\),\s*\d+px\)/);
    expect(TILE_MIN).toBe(360);
    expect(TILE_MAX).toBe(520);
    /* And the cap really is on the tile, where it cannot affect the count. */
    const row = readFileSync(
      join(process.cwd(), "src/components/catalog/figure-row.tsx"), "utf8");
    expect(row).toContain(`max-w-[${TILE_MAX}px]`);
    expect(row).toContain("mx-auto");
    /* `gap-x-3` is 12 px, and that is the gap the column arithmetic counts. */
    expect(GRID_GAP_X).toBe(12);
    expect(GRID_GAP_Y).toBe(8);
  });

  it("one, two, then three — and never four, because the page is 6xl", () => {
    expect(tileColumns(containerWidth(390))).toBe(1);
    expect(tileColumns(containerWidth(768))).toBe(2);
    expect(tileColumns(containerWidth(1280))).toBe(3);
    expect(tileColumns(containerWidth(1600))).toBe(TILE_COLUMNS_MAX);
    /* The widest the page ever gives the grid is 1120 px, and a fourth tile
       would be 271 — far below the 360 a tile needs. */
    expect(containerWidth(4000)).toBe(1120);
    expect(tileColumns(containerWidth(4000))).toBe(3);
  });

  it("and the old 52 rem threshold still lands on two, which is continuity", () => {
    /* The number is no longer in the markup, but the behaviour it encoded did
       not change at that width — the new formula simply also answers every
       width between. */
    expect(TWO_COLUMN_AT_PX).toBe(832);
    expect(tileColumns(TWO_COLUMN_AT_PX)).toBe(2);
    expect(tileWidth(TWO_COLUMN_AT_PX)).toBe(410);
  });

  it("and the default is cards, so every other surface is untouched", () => {
    expect(grid).toContain('mode = "cards"');
  });

  it("the container wrapper is not a hazard for the quick view", () => {
    /*
     * `@container` is a containing block for a `position: fixed` descendant.
     * The dialog is a SIBLING of the grid, owned by the page — never inside
     * it (IR-001) — and both views still render exactly one.
     */
    for (const [name, src] of [["catalogue", catalog], ["shop", shop]] as const) {
      expect(src.match(/<QuickView/g) ?? [], name).toHaveLength(1);
      /*
       * THE JSX, NOT THE WORD — the same trap `quick-view-ux.test.ts` already
       * names. A card inside the grid legitimately CALLS
       * `setQuickViewSkyId()` to report the intent; what must not be in there
       * is a rendered `<QuickView`.
       */
      const gridCall = src.slice(src.indexOf("<FigureGrid"), src.indexOf("</FigureGrid>"));
      expect(gridCall, `${name} mounts a dialog inside the grid`).not.toContain("<QuickView");
      /* That the card REPORTS the intent instead of rendering the dialog is
         `quick-view-ux.test.ts`'s promise, and it still holds: in the
         catalogue the handler sits in `card()` rather than in the grid's
         children, so it is not visible in this slice at all. */
    }
  });
});

/* ========================================================================
 * 6. MOBILE RULES, CARRIED OVER TO THE SWITCH ITSELF
 * ===================================================================== */

describe("the switch is thumb-sized and does not push the row sideways", () => {
  it("each option is a real button with a pressed state and a visible word", () => {
    expect(toggle).toContain('type="button"');
    expect(toggle).toContain("aria-pressed={isActive}");
    expect(toggle).toContain("de.catalog.view[option]");
    expect(toggle).toContain('aria-label={de.catalog.viewLabel}');
    expect(toggle).toContain('role="group"');
  });

  it("44 px of target: a 36 px button inside a group padded by 4", () => {
    /* `min-h-9` is 36 px on Tailwind's 4 px scale, `p-1` is 4 px a side. */
    expect(toggle).toContain("min-h-9");
    expect(toggle).toContain("p-1");
    expect(9 * 4 + 2 * 4).toBe(ROW.touch);
  });

  it("it cannot wrap a row open or overflow one", () => {
    expect(toggle).toContain("shrink-0");
    expect(toggle).toContain("whitespace-nowrap");
    /* The toolbar wraps as a whole rather than letting a control be cut. */
    expect(code(read("src/components/ui/browse-toolbar.tsx"))).toContain("flex-wrap");
  });

  it("the icons are decorative, so nothing depends on recognising a glyph", () => {
    expect(toggle.match(/aria-hidden="true"/g) ?? []).toHaveLength(2);
  });

  it("and the row's own geometry still fits at every phone width", () => {
    /* Unchanged from UX-01B and re-asserted here, because UX-01C is the step
       that puts those rows on a real page. */
    for (const viewport of PHONE_WIDTHS) {
      const text = rowTextWidth(phoneRowWidth(viewport));
      expect(text, `${viewport} px`).toBeGreaterThan(160);
      expect(nameCharsPerLine(text) * NAME_LINES).toBeGreaterThanOrEqual(39);
    }
  });
});

/* ========================================================================
 * 7. WHAT THE SWITCH MUST NOT HAVE BROUGHT WITH IT
 * ===================================================================== */

describe("nothing else changed", () => {
  it("no new query, no new action, no new dialog", () => {
    for (const [name, file] of [["mode", MODE], ["toggle", TOGGLE],
                                ["store", "src/lib/ui/view-store.ts"],
                                ["grid", GRID]] as const) {
      const src = read(file);
      for (const forbidden of ["@/lib/supabase", "createClient", '"use server"',
                               "fetch(", "QuickView", "Modal"]) {
        expect(src, `${name} contains ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("the classic card and its artwork geometry are untouched", () => {
    const card = read("src/components/catalog/figure-card.tsx");
    for (const marker of ["FigureRow", "catalog-view-mode", "view-store", "GridMode"]) {
      expect(card, `the card mentions ${marker}`).not.toContain(marker);
    }
    const template = read("src/lib/catalog/card-template.ts");
    expect(template).not.toContain("row-template");
    expect(template).not.toContain("GridMode");
  });

  it("the offer line, the quick view and the collect action are the same objects", () => {
    /*
     * One `setCollected`, one optimistic state, one `OfferLink`, one dialog
     * per grid — the switch chose a presentation and touched none of them.
     */
    const catalogCard = code(read("src/components/catalog/catalog-card.tsx"));
    expect(catalogCard.match(/setCollected\(/g) ?? []).toHaveLength(1);
    expect(catalogCard.match(/<OfferLink/g) ?? []).toHaveLength(1);
    expect(catalogCard.match(/<FavoriteHeart/g) ?? []).toHaveLength(1);
    for (const [name, src] of [["catalogue", catalog], ["shop", shop]] as const) {
      expect(src.match(/<QuickView/g) ?? [], name).toHaveLength(1);
    }
  });

  it("and the shop's offer semantics are untouched", () => {
    /* No second buyability rule arrived with the switch. */
    for (const forbidden of ["summarizeOffers", "v1BuyableOffers", "available",
                             "shop_offers", "usk_rating", "sale_released"]) {
      expect(shop, `the shop restates ${forbidden}`).not.toContain(forbidden);
    }
  });
});

describe("UX-01E renamed the label and nothing else", () => {
  it('the switcher says "Kacheln" now, not "Liste"', () => {
    expect(de.catalog.view.rows).toBe("Kacheln");
    expect(de.catalog.view.cards).toBe("Karten");
    /* And the old word is gone from the dictionary, so it cannot come back
       through a second key. */
    expect(JSON.stringify(de.catalog.view)).not.toContain("Liste");
  });

  it("but the stored value and the key are untouched, so a remembered view survives", () => {
    /*
     * THE POINT OF THE SEPARATION. A remembered view is user state; throwing
     * it away for a word in the interface would be the wrong trade, and
     * renaming either the key or the value would do exactly that — silently,
     * on the next visit, for everyone who had chosen tiles.
     */
    expect(catalogViewStore.key).toBe("skyisles.catalog.view");
    expect(CATALOG_VIEWS).toEqual(["cards", "rows"]);
    expect(DEFAULT_CATALOG_VIEW).toBe("cards");
    /* A value written before the rename still reads back as the tile view. */
    expect(catalogViewStore.is("rows")).toBe(true);
    expect(layoutFor("rows")).toBe("row");
  });

  it("and the label is read from the dictionary, never written in the markup", () => {
    const toggle = readFileSync(
      join(process.cwd(), "src/components/catalog/catalog-view-toggle.tsx"), "utf8");
    expect(toggle).not.toContain("Liste");
    expect(toggle).not.toContain("Kacheln");
    expect(toggle).toContain("de.catalog.view");
  });

  it("no tile is ever narrower than TILE_MIN or wider than TILE_MAX", () => {
    /*
     * THE TWO FAILURE MODES THE REVIEW FOUND, as one loop: a tile too narrow
     * to hold its own content, and a single tile stretched across a tablet.
     * Checked at every width the operator named, plus the awkward ones
     * between — a container just under and just over each threshold.
     */
    const widths = [...PHONE_WIDTHS, ...DESKTOP_WIDTHS, 600, 731, 733, 1103, 1105, 4000];
    for (const viewport of widths) {
      const container = containerWidth(viewport);
      const tile = tileWidth(container);
      const columns = tileColumns(container);
      const label = `${viewport} px → ${columns} × ${Math.round(tile)}`;

      expect(tile, `${label}: too wide`).toBeLessThanOrEqual(TILE_MAX);
      /* A phone narrower than TILE_MIN is the one allowed exception, and it
         is the `min(360px,100%)` in the class: the tile is the container. */
      if (container >= TILE_MIN) {
        expect(tile, `${label}: too narrow`).toBeGreaterThanOrEqual(TILE_MIN - 1);
      } else {
        expect(tile, `${label}: must not overflow`).toBe(container);
      }
      /* And the tiles plus their gaps never exceed the container. */
      expect(columns * tile + (columns - 1) * GRID_GAP_X,
        `${label}: overflows`).toBeLessThanOrEqual(container + 0.5);
      expect(columns).toBeLessThanOrEqual(TILE_COLUMNS_MAX);
    }
  });

  it("the awkward widths land where the arithmetic says, not where one hopes", () => {
    /* One below and one above each step, so a threshold cannot drift. */
    expect(tileColumns(731)).toBe(1);
    expect(tileColumns(732)).toBe(2);
    expect(tileColumns(1103)).toBe(2);
    expect(tileColumns(1104)).toBe(3);
    /* A single tile in a 600 px container is capped and centred, not
       stretched — the "übermäßig langgezogene Einzelkachel" the review
       found. */
    expect(tileWidth(600)).toBe(TILE_MAX);
    expect(tileWidth(600)).toBeLessThan(600);
  });
});
