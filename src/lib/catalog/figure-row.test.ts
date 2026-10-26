import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { CARD_TYPES, CARD_TYPE_LABELS, DEFAULT_CARD_TYPE } from "@/lib/catalog/card-type";
import { duplicateBadge, marksOwnership, namesEdition, understatesCard } from "@/lib/catalog/card";
import {
  NAME_LINES,
  OFFER_LABEL_PX,
  PAGE_PAD,
  PHONE_WIDTHS,
  ROW,
  ROW_ACTION_HEIGHT,
  ROW_COLUMNS,
  nameCharsPerLine,
  phoneRowWidth,
  rowOfferWidth,
  rowTextWidth,
} from "@/lib/catalog/row-template";
import { displayNameFor, parseVariant } from "@/lib/catalog/variant";

/**
 * The horizontal figure row (UX-01B, ADR-0148).
 *
 * WHAT THESE TESTS ARE FOR, AND IT IS NOT "DOES IT LOOK RIGHT"
 *
 * Four promises were made when this presentation was approved, and three of
 * them are checkable without a browser:
 *
 *   1. the card is untouched — a second presentation, not a mode of the first
 *   2. ownership, wanting and the later alarm stay three independent states
 *   3. there is no second price, buyability or write path anywhere in it
 *   4. the name still has room on a 360 px phone
 *
 * The fourth is the one worth having a module for. `rowTextWidth()` is
 * arithmetic, the longest name in the catalogue is a measurement that can be
 * taken from `data/catalog/products.json`, and together they answer the
 * question a screenshot can only answer for one name at a time.
 *
 * Contrast is COMPUTED rather than asserted as a string, the way
 * `src/lib/design/roles.test.ts` does it: a token can be renamed correctly
 * and still be unreadable.
 */

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/** Source with its comments removed, so a comment cannot satisfy a test. */
const code = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const ROW_FILE = "src/components/catalog/figure-row.tsx";
const ROW_SRC = read(ROW_FILE);
const ROW_CODE = code(ROW_SRC);
const CARD_SRC = read("src/components/catalog/figure-card.tsx");
const CARD_CODE = code(CARD_SRC);
const CATALOG_CARD_SRC = read("src/components/catalog/catalog-card.tsx");
const CATALOG_CARD_CODE = code(CATALOG_CARD_SRC);
const TEMPLATE_SRC = read("src/lib/catalog/row-template.ts");
const CSS = read("src/app/globals.css");

/* ------------------------------------------------------------------ colour */

const rgb = (hex: string): number[] =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

const channel = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

const luminance = (hex: string): number => {
  const [r, g, b] = rgb(hex).map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** WCAG contrast ratio between two opaque colours. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** `fg` at `alpha` over `bg`, as the browser composites it. */
function over(fg: string, alpha: number, bg: string): string {
  const [f, b] = [fg, bg].map((hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)));
  const mix = f.map((c, i) => Math.round(c * alpha + b[i] * (1 - alpha)));
  return `#${mix.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/** A `--token: #value;` from the stylesheet's light block. */
function token(name: string): string {
  const match = CSS.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "i"));
  expect(match, `--${name} is a literal colour in globals.css`).not.toBeNull();
  return match![1];
}

/* ========================================================================
 * 1. A SECOND PRESENTATION, NOT A MODE OF THE FIRST
 * ===================================================================== */

describe("the classic figure card is untouched", () => {
  it("knows nothing about the row, its geometry or the layout choice", () => {
    /*
     * The whole reason the row is its own file. `figure-card.tsx` places its
     * content on finished artwork through nine measured bands that sum to
     * 100 % (`card-template.ts`); a horizontal branch inside it would be a
     * second coordinate system beside those measurements. Eighteen other test
     * files hold the card's own promises — this one only holds that the row
     * did not reach into it.
     */
    for (const marker of ["FigureRow", "figure-row", "row-template", "ROW_ACTION_HEIGHT"]) {
      expect(CARD_SRC, `the card mentions ${marker}`).not.toContain(marker);
    }
    /*
     * And it takes no layout decision. Named precisely rather than as a word
     * search: the card legitimately carries `data-card-layout-debug`, which
     * is its own debug overlay and has nothing to do with this.
     */
    for (const form of [/layout\s*\?:/, /layout\s*===/, /layout\s*=\s*"/]) {
      expect(CARD_CODE, `the card has a layout switch: ${form}`).not.toMatch(form);
    }
    expect(CARD_CODE, "the card knows a row layout").not.toContain('"row"');
  });

  it("and the row does not borrow the card's artwork geometry", () => {
    /*
     * The other direction, and it matters just as much: a row that imported
     * `card-template.ts` would be reaching for numbers measured off a PNG it
     * does not draw. Its own module is small on purpose.
     */
    expect(ROW_SRC).not.toContain("card-template");
    for (const name of ["CARD_ASPECT", "GRID_ROWS", "GRID_AREAS", "artworkFor", "COLLECTED_GLOW"]) {
      expect(ROW_SRC, `the row reaches for ${name}`).not.toContain(name);
    }
    /* And it draws no artwork of its own either — no template, no seal, no
       glow layer. A row is markup, and that is the point. */
    expect(ROW_SRC).not.toContain("CollectedSeal");
    expect(ROW_CODE).not.toMatch(/\.(png|webp)\b/);
  });

  it("the administrator keeps the card, whatever the layout says", () => {
    /*
     * An editorial card carries an inline name editor, a hidden badge and an
     * edit action, and the row has no place for any of them. The admin branch
     * must therefore return BEFORE the layout choice is read.
     */
    const adminBranch = CATALOG_CARD_CODE.slice(
      CATALOG_CARD_CODE.indexOf("if (admin) {"),
      CATALOG_CARD_CODE.indexOf("const quickBuy"),
    );
    expect(adminBranch).toContain("<FigureCard");
    expect(adminBranch).not.toContain("<FigureRow");
    expect(adminBranch).not.toContain("layout");
  });

  it("the card stays the default, so no shipped surface changes", () => {
    expect(CATALOG_CARD_CODE).toContain('layout = "card"');
    expect(CATALOG_CARD_CODE).toContain('layout?: "card" | "row"');
    /* Nothing passes it yet: UX-01C adds the switch. A surface that started
       passing `layout` would be a production route changing its appearance,
       which this step explicitly does not do. */
    for (const surface of [
      "src/components/catalog/catalog-view.tsx",
      "src/components/shop/shop-view.tsx",
      "src/components/collection/collection-view.tsx",
      "src/app/(public)/(catalog)/page.tsx",
      "src/app/(app)/favoriten/page.tsx",
      "src/app/(public)/shop/page.tsx",
    ]) {
      expect(code(read(surface)), `${surface} selects a layout`).not.toMatch(/layout=\{/);
    }
  });

  it("the collection keeps its own card-or-table switch", () => {
    /* Decision 5 of the brief: the showcase is not part of this change. */
    const view = code(read("src/components/collection/collection-view.tsx"));
    expect(view).toContain("useSyncExternalStore(subscribeViewMode, readViewMode, serverViewMode)");
    expect(view).not.toContain("FigureRow");
  });
});

/* ========================================================================
 * 2. OWNERSHIP
 * ===================================================================== */

describe("ownership on a row uses the rules that already exist", () => {
  it("asks the same four functions the card asks", () => {
    expect(ROW_SRC).toContain('from "@/lib/catalog/card"');
    for (const fn of ["marksOwnership(", "understatesCard(", "duplicateBadge(", "namesEdition("]) {
      expect(ROW_CODE, `the row calls ${fn}`).toContain(fn);
    }
    /* No second rule: the row never decides ownership from a quantity, a
       price or an offer. */
    expect(ROW_CODE).not.toMatch(/quantity\s*>\s*0/);
  });

  it("and therefore answers exactly as the card does", () => {
    /* The rule itself, stated once more here so a change to it fails loudly
       on both presentations at once. */
    expect(marksOwnership("catalog", true)).toBe(true);
    expect(marksOwnership("catalog", false)).toBe(false);
    expect(marksOwnership("showcase", true)).toBe(false);
    expect(understatesCard("catalog", false, true)).toBe(true);
    expect(understatesCard("catalog", false, false)).toBe(false);
    expect(understatesCard("catalog", true, true)).toBe(false);
    expect(duplicateBadge(1)).toBeNull();
    expect(duplicateBadge(2)).toBe(2);
    expect(duplicateBadge(undefined)).toBeNull();
  });

  it("three grounds, because a surface that cannot answer must not pretend", () => {
    /*
     * The third is the one that is easy to get wrong. A signed-out catalogue
     * knows nobody's collection, so drawing every row as "not yours" would
     * say nothing about ownership and merely fade the list — the same
     * distinction `understatesCard` exists for.
     */
    expect(ROW_CODE).toMatch(/owned:\s*$|owned:/m);
    for (const ground of ["owned:", "understated:", "neutral:"]) {
      expect(ROW_CODE, `GROUND is missing ${ground}`).toContain(ground);
    }
    expect(ROW_CODE).toContain("owned ? GROUND.owned : understated ? GROUND.understated : GROUND.neutral");
  });

  it("possession is gold, from the gold tokens and not from a literal", () => {
    const owned = ROW_CODE.slice(ROW_CODE.indexOf("owned:"), ROW_CODE.indexOf("understated:"));
    expect(owned).toContain("bg-own-subtle/70");
    expect(owned).toContain("ring-own-line-strong");
    /* The glow the brief asked for — at the edge, from a token, with a
       negative spread so it stays a glow and not a halo. */
    expect(owned).toMatch(/shadow-\[0_0_18px_-8px_var\(--own-line-strong\)\]/);
    /* No colour literal anywhere in the row: every ink and ground is a token. */
    expect(ROW_CODE, "the row hard-codes a colour").not.toMatch(/#[0-9a-fA-F]{6}/);
  });

  it("and it is not the coral of wanting, which is a different question", () => {
    /* Gold means possession, coral means wanting (V3.1). The row paints
       neither over the other: the heart arrives as a slot and brings its own
       colour with it. */
    expect(ROW_CODE).not.toContain("favorite-ink");
    expect(ROW_CODE).not.toContain("favorite-glow");
  });

  it("every ink stays legible on all three grounds", () => {
    const deep = token("deep");
    const canvas = token("canvas");
    const ownSubtle = token("own-subtle");
    const foreground = token("foreground");
    const muted = token("muted");
    const ownInk = token("own-ink");

    /* The grounds, as the browser composites them: a 70 % / 55 % alpha over
       whichever of the two dark backdrops is behind the grid. */
    const grounds = [deep, canvas].flatMap((behind) => [
      { name: "owned", hex: over(ownSubtle, 0.7, behind) },
      { name: "understated", hex: over(deep, 0.55, behind) },
      { name: "neutral", hex: over(deep, 0.7, behind) },
    ]);

    for (const ground of grounds) {
      /* AA for body text is 4.5:1. The name carries the row, so it is held
         to a higher bar than the floor. */
      expect(contrast(foreground, ground.hex), `name on ${ground.name}`).toBeGreaterThan(7);
      expect(contrast(muted, ground.hex), `meta on ${ground.name}`).toBeGreaterThan(4.5);
    }
    /* Gold ink appears only on the owned ground, so it is only measured there. */
    for (const ground of grounds.filter((g) => g.name === "owned")) {
      expect(contrast(ownInk, ground.hex), "gold ink on the owned ground").toBeGreaterThan(4.5);
    }
  });

  it("the offer line's ink is swapped for the dark ground, not reinvented", () => {
    /*
     * `OfferLink` writes in `--trade-ink`, which is near-black because on a
     * card it sits on a silver plate the artwork paints. A row has no plate,
     * so the row redefines the pair — the same two variables and the same
     * mechanism `figure-card.tsx` already uses for its two dark artworks.
     * `OfferLink` itself is not touched.
     */
    expect(ROW_CODE).toContain('"--trade-ink": "var(--trade-ink-on-dark)"');
    expect(ROW_CODE).toContain('"--trade-ink-quiet": "var(--trade-ink-quiet-on-dark)"');
    expect(CARD_CODE, "the card still does the same swap").toContain(
      '"--trade-ink": "var(--trade-ink-on-dark)"',
    );

    const onDark = token("trade-ink-on-dark");
    const quietOnDark = token("trade-ink-quiet-on-dark");
    const owned = over(token("own-subtle"), 0.7, token("deep"));
    const neutral = over(token("deep"), 0.7, token("canvas"));
    for (const [name, ground] of [["owned", owned], ["neutral", neutral]] as const) {
      expect(contrast(onDark, ground), `offer ink on ${name}`).toBeGreaterThan(4.5);
      expect(contrast(quietOnDark, ground), `"no offer" on ${name}`).toBeGreaterThan(4.5);
    }
  });
});

describe("a figure nobody owns keeps its photograph", () => {
  it("no filter, no opacity and no scale anywhere in the row", () => {
    /*
     * The brief is explicit, and so is the risk: the card takes the colour
     * out of its ARTWORK (`card-shell-unowned` on layer 2 only), which it can
     * do because the artwork is a separate element from the photograph. A row
     * has no such layer, so the same trick applied here would land on the
     * figure itself.
     */
    for (const forbidden of [
      "card-shell-unowned",
      "saturate(",
      "brightness(",
      "grayscale",
      "opacity-",
      "scale(",
      "UNCOLLECTED_SCALE",
    ]) {
      expect(ROW_SRC, `the row uses ${forbidden}`).not.toContain(forbidden);
    }
    /* And no transform at all, so there is nothing that could move a row and
       nothing that could blur its text. */
    expect(ROW_CODE).not.toContain("transform");
  });

  it("the picture keeps its own stage, reserved before the file arrives", () => {
    /* Size on the wrapper, not on the `<img>`: the space is held open while
       the list loads, so rows do not jump as images arrive. */
    expect(ROW_CODE).toMatch(/h-18 w-18 shrink-0/);
    expect(ROW_CODE).toContain("sm:h-22 sm:w-22");
    expect(ROW_CODE).toContain("bg-plate");
    /* `object-contain`, because a figure is cut out and a crop takes its head
       off — the same rule the collection's table follows. */
    expect(ROW_CODE).toContain("object-contain");
    expect(ROW_CODE).toContain('loading="lazy"');
  });

  it("and the 27 figures without a picture get an empty stage, not an error", () => {
    expect(ROW_CODE).toContain("de.catalog.noImage");
  });
});

/* ========================================================================
 * 3. THE EDITION, WHICH THE ROW HAS TO SAY IN WORDS
 * ===================================================================== */

describe("the edition is named, because a row has no artwork to show it", () => {
  it("every type but the default is worth a word", () => {
    expect(namesEdition(DEFAULT_CARD_TYPE)).toBe(false);
    expect(DEFAULT_CARD_TYPE).toBe("standard");
    for (const type of CARD_TYPES.filter((t) => t !== DEFAULT_CARD_TYPE)) {
      expect(namesEdition(type), type).toBe(true);
    }
  });

  it("and the word comes from the one place those names live", () => {
    expect(ROW_SRC).toContain("CARD_TYPE_LABELS");
    expect(ROW_CODE).toContain("namesEdition(figure.cardType) ? CARD_TYPE_LABELS[figure.cardType]");
    /* Not re-spelled here: the row prints what the label map says. */
    for (const label of Object.values(CARD_TYPE_LABELS)) {
      expect(ROW_CODE, `the row spells out "${label}"`).not.toContain(`"${label}"`);
    }
  });

  it("the chip is neutral — an edition is a property of the object", () => {
    /*
     * The same reasoning `VariantSeal` is built on: rarity belongs to the
     * figure, possession belongs to the viewer, and they appear on the same
     * row. A gold chip would make an unowned Legendary look owned.
     */
    const chip = ROW_CODE.slice(ROW_CODE.indexOf("{edition ?"), ROW_CODE.indexOf("{edition}"));
    expect(chip).toContain("bg-status-ground");
    expect(chip).toContain("text-status-ink");
    expect(chip).not.toContain("own-");
    expect(chip).not.toContain("favorite-");
  });

  it("the variant stays inside the name, where V3.6 put it", () => {
    /* `displayName` is "Legendary Bash" since V3.6 — the variant is part of
       the name, not a suffix hanging off it. The row prints that name and
       does not invent a second presentation of the variant. */
    expect(ROW_CODE).toContain("figure.displayName");
    expect(ROW_CODE).not.toContain("sortBaseName");
    expect(ROW_SRC).not.toContain("VariantSeal");
  });
});

/* ========================================================================
 * 4. THREE INDEPENDENT STATES
 * ===================================================================== */

describe("possession, wanting and the later alarm are three separate states", () => {
  it("the row receives each of them separately and couples none of them", () => {
    /* Possession is a boolean it draws; wanting is a slot it places; the
       alarm is a slot it holds open. No branch reads one to decide another. */
    expect(ROW_CODE).toContain("collected = false");
    expect(ROW_CODE).toContain("favoriteSlot");
    expect(ROW_CODE).toContain("bellSlot");
    expect(ROW_CODE).not.toMatch(/collected\s*&&\s*favorite/);
    expect(ROW_CODE).not.toMatch(/favorite\w*\s*\?\s*GROUND/);
  });

  it("and it knows nothing about favourites beyond the slot", () => {
    /*
     * The heart is passed in, exactly as it is to the card: `FigureRow` draws
     * a figure and knows nothing about collections, wishlists or sessions.
     */
    expect(ROW_CODE).not.toContain("FavoriteHeart");
    expect(ROW_CODE).not.toContain("setFavorite");
    expect(ROW_CODE).not.toContain("favorites/");
  });

  it("the action column holds room for the bell before the bell exists", () => {
    /*
     * ADR-0147's bell is UX-02. Reserving its slot now is what keeps that
     * step from being a layout change: no row grows, no text reflows.
     */
    expect(ROW.actionSlots).toBe(2);
    expect(ROW_ACTION_HEIGHT).toBe(ROW.touch * ROW.actionSlots);
    expect(ROW_ACTION_HEIGHT).toBe(88);
    /* `w-11` is 44 px and `min-h-22` is 88 px on Tailwind's 4 px scale. */
    expect(ROW_CODE).toContain("min-h-22 w-11 shrink-0");
    expect(ROW.touch).toBe(11 * 4);
    expect(ROW_ACTION_HEIGHT).toBe(22 * 4);
  });

  it("but no bell, no notification centre and no scheduler are built", () => {
    for (const forbidden of [
      "watch_availability",
      "unwatch_availability",
      "fire_availability_alerts",
      "acknowledge_availability_alerts",
      "availability_alerts",
      "benachrichtigungen",
      "BellGlyph",
    ]) {
      expect(ROW_SRC, `the row reaches for ${forbidden}`).not.toContain(forbidden);
      expect(CATALOG_CARD_SRC, `catalog-card reaches for ${forbidden}`).not.toContain(forbidden);
    }
  });
});

/* ========================================================================
 * 5. THE OFFER SEMANTICS ARE THE EXISTING ONES
 * ===================================================================== */

describe("the offer is the one that already exists", () => {
  it("the row computes no price and no buyability — it is handed the line", () => {
    /*
     * THE ONE THAT MATTERS. A module that does not import the offer rules
     * cannot restate them, whatever its comments say. `trade` arrives as a
     * finished element from `catalog-card.tsx`, which builds it from
     * `OfferLink` exactly as it does for the card.
     */
    expect(ROW_SRC).not.toContain("@/lib/shop/offer");
    expect(ROW_CODE).not.toContain("OfferLink");
    for (const name of [
      "summarizeOffers",
      "v1BuyableOffers",
      "hasV1BuyableOffer",
      "automaticShopPrice",
      "available",
      "condition",
    ]) {
      expect(ROW_CODE, `the row mentions ${name}`).not.toContain(name);
    }
    expect(ROW_CODE).toContain("{trade}");
  });

  it("and the market value is the catalog's, boosted at the last moment", () => {
    /* The same import, the same default and the same call the card makes, so
       the printed number cannot differ between the two presentations. */
    expect(ROW_SRC).toContain("NO_MARKET_BOOST, catalogDisplayMarketPrice");
    expect(ROW_CODE).toContain("marketBoostPercent = NO_MARKET_BOOST");
    expect(ROW_CODE).toContain(
      "catalogDisplayMarketPrice(figure.marketPrice, marketBoostPercent)",
    );
    /* `null` is a real state and never a zero (ADR-0010). */
    expect(ROW_CODE).toContain("figure.marketPrice === null");
    expect(ROW_CODE).toContain("de.catalog.noPrice");
    expect(ROW_SRC).not.toContain("fetchCatalogMarketBoost");
  });

  it("the two prices are told apart by a label, as they must be", () => {
    /* The market value and the asking price stand on the same row, and they
       are different things (ADR-0033). The label is what keeps them from
       being read as one number. */
    expect(ROW_CODE).toContain("de.catalog.marketValue");
  });

  it("the offer band is a sibling of the toggle, never a child of it", () => {
    /*
     * A link inside a button is invalid markup and an ambiguous target. The
     * card keeps its trade plate outside its body for the same reason; a row
     * can simply put the band underneath. Proved structurally: `{trade}` does
     * not occur between the toggle's tags.
     */
    const open = ROW_CODE.indexOf("<button");
    const close = ROW_CODE.indexOf("</button>");
    expect(open, "the row has a toggle").toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(open);
    expect(ROW_CODE.slice(open, close), "the offer sits inside the toggle")
      .not.toContain("{trade}");
    /* And the band is a real 44 px target even when its content is one line
       of 11 px type. */
    expect(ROW_CODE).toContain("flex min-h-11 items-center");
  });

  it("the band exists whether or not anything is for sale", () => {
    /*
     * `OfferLink` draws the quiet sentence when there is nothing to buy, so
     * the row must not make the band conditional: a row would then change
     * height between a figure that is for sale and one that is not, and a
     * list of 561 of them would ripple.
     */
    expect(ROW_CODE).not.toMatch(/trade \?\s*</);
  });
});

/* ========================================================================
 * 6. NO NEW WRITE PATHS
 * ===================================================================== */

describe("nothing new writes anywhere", () => {
  it("the row is presentation only — no action, no client, no fetch", () => {
    for (const forbidden of [
      '"use server"',
      "@/lib/supabase",
      "createClient",
      "revalidatePath",
      "useTransition",
      "useState",
      "fetch(",
      "/actions",
    ]) {
      expect(ROW_SRC, `the row contains ${forbidden}`).not.toContain(forbidden);
    }
    expect(TEMPLATE_SRC, "the geometry module imports nothing").not.toContain("import");
  });

  it("there is still exactly one collect call, in the shared control", () => {
    /*
     * Decision 2 of the brief: `CatalogCard` stays the one place that mutates.
     * Two presentations, one server action, one optimistic state, one
     * rollback — so a row and a card cannot drift apart in behaviour.
     */
    expect(CATALOG_CARD_CODE.match(/setCollected\(/g) ?? []).toHaveLength(1);
    expect(CATALOG_CARD_CODE.match(/useState\(/g) ?? []).toHaveLength(2); // collected, failed
    expect(CATALOG_CARD_CODE.match(/startTransition\(/g) ?? []).toHaveLength(1);
  });

  it("and no shop, stock, cart or checkout module was touched by it", () => {
    for (const forbidden of [
      "@/lib/cart",
      "@/lib/commerce",
      "shop_inventory",
      "reserve_order_stock",
      "shop_offers",
      "inventory_movements",
    ]) {
      expect(ROW_SRC, `the row reaches for ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("no dialog can be mounted inside a row", () => {
    /*
     * The card is an `@container`, which makes it a containing block for a
     * `position: fixed` descendant — which is why the quick view is owned by
     * the grid and not by a card (IR-001). The row is not a container at all,
     * so the hazard does not arise; it still must not mount a dialog.
     */
    expect(ROW_CODE).not.toContain("@container");
    expect(ROW_SRC).not.toContain("QuickView");
    expect(ROW_SRC).not.toContain("Modal");
    expect(ROW_CODE).not.toMatch(/\bfixed\b/);
  });
});

/* ========================================================================
 * 7. MOBILE GEOMETRY — THE PART THAT IS ARITHMETIC
 * ===================================================================== */

describe("the geometry is measured, and the markup says the same numbers", () => {
  it("four columns, and the hairline is one of them", () => {
    expect(ROW_COLUMNS).toBe(4);
    expect(ROW.divider).toBe(1);
    expect(ROW_CODE).toContain("w-px shrink-0 self-stretch");
  });

  it("the class names agree with the constants", () => {
    /* Tailwind's spacing scale is 4 px, so these are the same numbers twice —
       which is exactly what would silently stop being true otherwise. */
    expect(ROW.pad).toBe(2 * 4);
    expect(ROW.padWide).toBe(3 * 4);
    expect(ROW.gap).toBe(2 * 4);
    expect(ROW.gapWide).toBe(3 * 4);
    expect(ROW.image).toBe(18 * 4);
    expect(ROW.imageWide).toBe(22 * 4);
    expect(ROW_CODE).toContain("gap-2 rounded-sky-md p-2 sm:gap-3 sm:p-3");
    expect(ROW_CODE).toContain("gap-2 rounded-sky-sm text-left sm:gap-3");
  });

  it("every control is at least 44 px, on every width", () => {
    expect(ROW.touch).toBe(44);
    /* The three controls a row can carry: the identity toggle, the offer
       band, and the heart in its column. The toggle is the tallest of the
       three by construction — it holds the picture. */
    expect(ROW.image).toBeGreaterThanOrEqual(ROW.touch);
    expect(ROW_CODE).toContain("min-h-11");
    expect(ROW_CODE).toContain("w-11");
  });

  it("declares no width a phone cannot hold", () => {
    /* Nothing is sized in a way that could exceed the narrowest row. */
    const widths = [...ROW_CODE.matchAll(/\b(?:min-)?w-\[(\d+)px\]/g)].map((m) => Number(m[1]));
    for (const width of widths) {
      expect(width, "a hard-coded width").toBeLessThanOrEqual(phoneRowWidth(PHONE_WIDTHS[0]));
    }
    expect(ROW_CODE).not.toMatch(/\bw-screen\b/);
    expect(ROW_CODE).not.toMatch(/\boverflow-x-/);
    /* The text column may shrink to nothing, so nothing in it can push the
       row sideways. */
    expect(ROW_CODE.match(/min-w-0/g) ?? []).not.toHaveLength(0);
  });
});

describe("the name still has room on a phone", () => {
  /**
   * The longest name the catalogue actually contains, derived the way the
   * catalogue derives it.
   *
   * `products.json` is the import's own snapshot of the 600 rows. The name a
   * row PRINTS is `displayName`, which `variant.ts` derives — a prefix
   * spelling keeps its length, a bracket spelling loses two characters — so
   * both forms are measured and the longer wins.
   */
  const items = (JSON.parse(read("data/catalog/products.json")) as {
    items: { name: string; series: string }[];
  }).items;

  const bySeries = new Map<string, Set<string>>();
  for (const item of items) {
    const set = bySeries.get(item.series) ?? new Set<string>();
    set.add(item.name);
    bySeries.set(item.series, set);
  }

  const longest = items.reduce((max, item) => {
    const names = bySeries.get(item.series) ?? new Set<string>();
    const shown = displayNameFor(item.name, parseVariant(item.name, names));
    return Math.max(max, item.name.length, shown.length);
  }, 0);

  it("measures a real catalogue rather than a guess", () => {
    expect(items.length).toBeGreaterThan(500);
    /* If this number moves a lot, the arithmetic below deserves a second
       look rather than a quiet pass. */
    expect(longest).toBeGreaterThanOrEqual(30);
    expect(longest).toBeLessThanOrEqual(60);
  });

  it("fits in two lines at 360, 390 and 414 px", () => {
    for (const viewport of PHONE_WIDTHS) {
      const text = rowTextWidth(phoneRowWidth(viewport));
      const fits = nameCharsPerLine(text) * NAME_LINES;
      expect(fits, `${viewport} px leaves ${text} px for the name`)
        .toBeGreaterThanOrEqual(longest);
    }
  });

  it("and the estimate errs on the pessimistic side", () => {
    /* 0.56 em per character at 13 px is 7.28 px, against a measured average
       nearer 6.4 px for mixed-case Latin text in this stack. An estimate used
       as a guarantee has to be too big, not too small. */
    expect(rowTextWidth(phoneRowWidth(360))).toBe(171);
    expect(nameCharsPerLine(171)).toBe(23);
  });

  it("the text column grows with the viewport and never shrinks", () => {
    const widths = PHONE_WIDTHS.map((v) => rowTextWidth(phoneRowWidth(v)));
    expect(widths).toEqual([...widths].sort((a, b) => a - b));
    expect(widths[0]).toBeGreaterThan(0);
  });

  it("the wider step spends its extra width on the picture, not against it", () => {
    /* At `sm:` the picture and the gaps grow. The text column must still end
       up wider, or the breakpoint would be a regression. */
    const narrow = rowTextWidth(phoneRowWidth(640), false);
    const wide = rowTextWidth(phoneRowWidth(640), true);
    expect(narrow - wide).toBe(ROW.imageWide - ROW.image + 3 * (ROW.gapWide - ROW.gap) + 2 * (ROW.padWide - ROW.pad));
    expect(wide).toBeGreaterThan(rowTextWidth(phoneRowWidth(414)));
  });
});

describe("the offer band has room for its longer label", () => {
  it("at every phone width", () => {
    for (const viewport of PHONE_WIDTHS) {
      expect(rowOfferWidth(phoneRowWidth(viewport)), `${viewport} px`)
        .toBeGreaterThanOrEqual(OFFER_LABEL_PX);
    }
  });

  it("and it is wider than the text column, which is why it is a band", () => {
    /* The band keeps the picture's width and the hairline's as well — about
       90 px more than the text column has. That is the measurement that
       decided it should not be a fourth line in the text column. */
    for (const viewport of PHONE_WIDTHS) {
      const row = phoneRowWidth(viewport);
      expect(rowOfferWidth(row) - rowTextWidth(row)).toBe(ROW.image + ROW.divider + 2 * ROW.gap);
    }
  });

  it("the page's own padding is accounted for, not forgotten", () => {
    /* Every catalogue surface wraps its content in `main … px-4`, so a row on
       a 360 px phone is 328 px wide. Forgetting this is how a layout passes
       its own arithmetic and overflows in a browser. */
    expect(PAGE_PAD).toBe(16);
    expect(phoneRowWidth(360)).toBe(328);
    expect(code(read("src/app/(public)/(catalog)/page.tsx"))).toContain("px-4");
  });
});

/* ========================================================================
 * 8. THE ERROR PATH
 * ===================================================================== */

describe("a failed collect says so without covering anything", () => {
  it("in flow, because a row must never lay one thing over another", () => {
    /*
     * The card's notice is absolute and sits over its artwork, because a
     * card's height is an aspect ratio and a notice in flow would break the
     * grid. A row has no fixed height, and an absolute pill here would have
     * to be laid over the offer band or the picture.
     */
    expect(ROW_CODE).toContain('role="alert"');
    expect(ROW_CODE).toContain("de.catalog.collectFailed");
    const notice = ROW_CODE.slice(ROW_CODE.indexOf("{failed ?"));
    expect(notice).not.toContain("absolute");
  });

  it("and the card keeps the absolute one it needs", () => {
    /* Unchanged, and asserted here as well so that moving the row's notice
       cannot quietly take the card's with it. */
    expect(CATALOG_CARD_CODE).toContain("absolute inset-x-1 bottom-1");
    expect(CATALOG_CARD_CODE).toContain("failed={failed}");
  });
});
