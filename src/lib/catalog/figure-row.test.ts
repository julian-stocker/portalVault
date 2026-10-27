import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { CARD_TYPES, CARD_TYPE_LABELS, DEFAULT_CARD_TYPE } from "@/lib/catalog/card-type";
import { duplicateBadge, marksOwnership, namesEdition, understatesCard } from "@/lib/catalog/card";
import {
  ACTION_WITH_BELL,
  AMOUNT_LINE,
  AMOUNT_PX,
  CHIP_INSET,
  CHIP_VISIBLE,
  EDITION_CHIP_PX,
  INFO,
  INFO_HEIGHT,
  NAME_LINES,
  OFFER_CHIP_PX,
  OFFER_LABEL_PX,
  PAGE_PAD,
  PHONE_WIDTHS,
  PREVIOUS_ROW_HEIGHT,
  ROW,
  ROW_COLUMNS,
  TWO_COLUMN_AT_PX,
  MARKET_LABEL_PX,
  nameCharsPerLine,
  phoneRowWidth,
  priceLineFits,
  rowHeight,
  rowTextWidth,
} from "@/lib/catalog/row-template";
import { displayNameFor, parseVariant } from "@/lib/catalog/variant";

/**
 * The horizontal figure row (UX-01B, corrected in UX-01C, ADR-0148).
 *
 * WHAT THESE TESTS ARE FOR, AND IT IS NOT "DOES IT LOOK RIGHT"
 *
 * Five promises, and four of them are checkable without a browser:
 *
 *   1. the card is untouched — a second presentation, not a mode of the first
 *   2. ownership, wanting and the later alarm stay three independent states
 *   3. there is no second price, buyability or write path anywhere in it
 *   4. the name still has room on a 360 px phone — AND the row is FLAT
 *   5. it looks good — which only a browser can answer, named as a limit
 *
 * The fourth is the one worth having a module for. `rowTextWidth()` and
 * `rowHeight()` are arithmetic, the longest name in the catalogue is a
 * measurement that can be taken from `data/catalog/products.json`, and
 * together they answer questions a screenshot answers for one name at a time.
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
    for (const marker of ["FigureRow", "figure-row", "row-template", "INFO_HEIGHT"]) {
      expect(CARD_SRC, `the card mentions ${marker}`).not.toContain(marker);
    }
    for (const form of [/layout\s*\?:/, /layout\s*===/, /layout\s*=\s*"/]) {
      expect(CARD_CODE, `the card has a layout switch: ${form}`).not.toMatch(form);
    }
    expect(CARD_CODE, "the card knows a row layout").not.toContain('"row"');
  });

  it("and the row does not borrow the card's artwork geometry", () => {
    expect(ROW_SRC).not.toContain("card-template");
    for (const name of ["CARD_ASPECT", "GRID_ROWS", "GRID_AREAS", "artworkFor", "COLLECTED_GLOW"]) {
      expect(ROW_SRC, `the row reaches for ${name}`).not.toContain(name);
    }
    expect(ROW_SRC).not.toContain("CollectedSeal");
    expect(ROW_CODE).not.toMatch(/\.(png|webp)\b/);
  });

  it("the administrator keeps the card, whatever the layout says", () => {
    const adminBranch = CATALOG_CARD_CODE.slice(
      CATALOG_CARD_CODE.indexOf("if (admin) {"),
      CATALOG_CARD_CODE.indexOf("const quickBuy"),
    );
    expect(adminBranch).toContain("<FigureCard");
    expect(adminBranch).not.toContain("<FigureRow");
    expect(adminBranch).not.toContain("layout");
  });

  it("the card stays the default, so a surface that says nothing is unchanged", () => {
    expect(CATALOG_CARD_CODE).toContain('layout = "card"');
    expect(CATALOG_CARD_CODE).toContain('layout?: "card" | "row"');

    /*
     * WHO CHOOSES, AND WHO MUST NOT (UX-01C).
     *
     * The two interactive views choose a layout and nobody else does. The
     * server pages hand down DATA and the choice is the viewer's, remembered
     * in their browser; a page that passed one would be deciding something it
     * cannot know. The collection is out of scope by decision.
     */
    for (const chooser of [
      "src/components/catalog/catalog-view.tsx",
      "src/components/shop/shop-view.tsx",
    ]) {
      expect(code(read(chooser)), `${chooser} should select a layout`).toMatch(/layout=\{/);
    }
    for (const surface of [
      "src/components/collection/collection-view.tsx",
      "src/app/(public)/(catalog)/page.tsx",
      "src/app/(app)/favoriten/page.tsx",
      "src/app/(public)/shop/page.tsx",
    ]) {
      expect(code(read(surface)), `${surface} selects a layout`).not.toMatch(/layout=\{/);
    }
  });

  it("the collection keeps its own card-or-table switch", () => {
    const view = code(read("src/components/collection/collection-view.tsx"));
    expect(view).toContain("useSyncExternalStore(subscribeViewMode, readViewMode, serverViewMode)");
    expect(view).not.toContain("FigureRow");
  });
});

/* ========================================================================
 * 2. THE CORRECTION: THE ROW IS FLAT
 * ===================================================================== */

describe("the row is compact, and the reduction is a number", () => {
  it("the first version was 138 px on a phone", () => {
    /* 8 + 8 of padding, a 72 px picture beside a 50 px text stack, a 6 px gap
       and a 44 px offer band of its own. Kept as the yardstick so the
       reduction is measured rather than claimed. */
    expect(PREVIOUS_ROW_HEIGHT).toBe(138);
  });

  it("and the corrected one is 92 px — a third flatter", () => {
    expect(rowHeight(1)).toBe(92);
    /* The `sm:` step changes nothing: at 72 px the picture is still shorter
       than the text block, so the row does not grow on a tablet. */
    expect(rowHeight(1, true)).toBe(92);
    const saved = (PREVIOUS_ROW_HEIGHT - rowHeight(1)) / PREVIOUS_ROW_HEIGHT;
    expect(saved).toBeGreaterThan(0.33);
  });

  it("and a row that carries a bell grows by the bell, not in advance", () => {
    /*
     * THE POINT OF `ACTION_WITH_BELL`. Two 44 px marks on one x need 88 px,
     * which is 10 px more than the text block. Only the rows that actually
     * show a bell pay it — and those are exactly the rows with nothing to
     * buy, so the extra height tracks a real difference in content.
     */
    expect(rowHeight(1, false, true)).toBe(100);
    expect(rowHeight(1, false, true) - rowHeight(1)).toBe(8);
    expect(ACTION_WITH_BELL).toBe(2 * ROW.touch);
  });

  it("and a wrapped price line grows by one line, which is the fallback", () => {
    /*
     * THE OPERATOR'S INSTRUCTION, as arithmetic: when a long amount and a
     * long offer cannot share the line, the chip drops below it — nothing is
     * truncated and no price is shrunk. Only the figures that need it pay.
     */
    expect(rowHeight(1, false, false, true)).toBe(rowHeight(1) + AMOUNT_LINE + INFO.gap + 2);
    expect(priceLineFits(rowTextWidth(phoneRowWidth(360)), 48)).toBe(true);
    expect(priceLineFits(rowTextWidth(phoneRowWidth(360)), AMOUNT_PX)).toBe(false);
  });

  it("the text block decides the height, not the picture", () => {
    /*
     * THE REASON THE PICTURE COULD GROW WHILE THE ROW SHRANK. At 72 px the
     * picture was the tallest thing in the row; the three text lines need
     * 70 px anyway, so anything up to 70 is free.
     */
    expect(INFO_HEIGHT).toBe(80);
    expect(ROW.image).toBeLessThan(INFO_HEIGHT);
    expect(ROW.imageWide).toBeLessThan(INFO_HEIGHT);
    expect(rowHeight(1)).toBe(2 * ROW.padY + INFO_HEIGHT);
    /* And it did grow: 56 was the first draft of the correction, 64 shipped. */
    expect(ROW.image).toBe(64);
  });

  it("a long name may add a line, and only one line's worth", () => {
    expect(rowHeight(2) - rowHeight(1)).toBe(INFO.name);
    /* Still flatter than the version it replaces, even with two lines. */
    expect(rowHeight(2)).toBeLessThan(PREVIOUS_ROW_HEIGHT);
  });

  it("nothing is reserved for the bell any more", () => {
    /*
     * The first version forced the heart's column to two touch slots — 88 px
     * of height for a control that does not exist yet. That was the single
     * largest piece of the air this correction removed.
     */
    expect(TEMPLATE_SRC).not.toContain("actionSlots");
    expect(TEMPLATE_SRC).not.toContain("ROW_ACTION_HEIGHT");
    expect(ROW_CODE).not.toContain("min-h-22");
    expect(ROW_CODE, "the heart's column holds only what is in it")
      .toContain("flex w-11 shrink-0 flex-col items-center self-stretch");
    /* The slot exists and the column supports two positions, but the height
       follows the content: `justify-start` with the heart alone. */
    expect(ROW_CODE).toContain("bellSlot");
    expect(ROW_CODE).toContain('bellSlot ? "justify-between" : "justify-start"');
  });

  it("and the offer is no longer a band under the picture", () => {
    /*
     * It spanned the whole row below the picture and cost 44 px plus a gap.
     * It is the last line of the text block now, right-aligned.
     */
    expect(ROW_CODE).toContain("flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1");
    expect(ROW_CODE).toContain("group relative ml-auto inline-flex min-h-11 shrink-0");
    /* And no padding of its own: `OfferLink` brings `px-1.5 sm:px-2`, and
       doubling it made the line wrap on every phone row. */
    expect(ROW_CODE).not.toContain("inline-flex min-h-11 shrink-0 items-center px-2");
    expect(INFO.price).toBe(44);
  });

  it("and the line's left half carries what the meta line lost", () => {
    /*
     * CAUGHT BY THE LINT, NOT BY A REVIEW. Moving the element into a mark
     * took the series and the "not in the catalogue" notice off the meta
     * line with it, and `showSeries` went unused — which is how the loss
     * announced itself. Both now sit at the left of the offer line, where
     * the space was empty anyway, so they cost no height.
     */
    expect(ROW_CODE).toContain("!figure.isActive || showSeries ?");
    expect(ROW_CODE).toContain("de.catalog.inactive");
    expect(ROW_CODE).toContain("figure.seriesLabel");
    /* Out of range outranks the game, the same order the card's band uses. */
    expect(ROW_CODE).toContain("!figure.isActive ? de.catalog.inactive : figure.seriesLabel");
    /* They share the CAPTION line, never the price line. */
    const priceLine = ROW_CODE.slice(ROW_CODE.indexOf("flex-wrap items-center"));
    expect(priceLine).not.toContain("figure.seriesLabel");
    expect(priceLine).not.toContain("{edition}");
  });

  it("the padding and the gaps are the smaller pair now", () => {
    expect(ROW.padX).toBe(6);
    expect(ROW.padY).toBe(6);
    expect(ROW.gap).toBe(6);
    expect(ROW_CODE).toContain("gap-1.5 rounded-sky-md px-1.5 py-1.5 sm:gap-2.5");
    /* The same at every width: vertically it competes with nothing but
       height, and the row must not get taller on a tablet than on a phone. */
    expect(ROW_CODE).not.toContain("sm:p-3");
    expect(ROW_CODE).not.toContain("sm:py-");
    expect(ROW_CODE).not.toContain("sm:px-");
  });
});

/* ========================================================================
 * 3. THE ARRANGEMENT
 * ===================================================================== */

describe("four columns, and the order is the information hierarchy", () => {
  it("picture, hairline, text block, heart", () => {
    expect(ROW_COLUMNS).toBe(4);
    expect(ROW.divider).toBe(1);
    expect(ROW_CODE).toContain("w-px shrink-0 self-stretch");
    /* The text block absorbs the width; everything else is fixed. */
    expect(ROW_CODE).toContain("flex min-w-0 flex-1 flex-col gap-0.5");
  });

  it("the name is the first line, and the edition is not in it", () => {
    expect(ROW_CODE).toContain("figure.displayName");
    expect(ROW_CODE).toContain("line-clamp-2 min-w-0 text-[13px]");
    const nameLine = ROW_CODE.slice(
      ROW_CODE.indexOf("<p className=\"flex min-w-0 items-baseline gap-1\">"),
      ROW_CODE.indexOf("</p>"),
    );
    expect(nameLine).not.toContain("CARD_TYPE_LABELS");
    expect(nameLine).not.toContain("elementLabel");
  });

  it("the caption stands ABOVE the amount, not beside it", () => {
    /*
     * THE OPERATOR'S INSTRUCTION, and it is the reason line two exists. The
     * label named the number next to it before; now it names the number
     * below it, and the hierarchy reads name → MARKTWERT → amount.
     */
    const captionAt = ROW_CODE.indexOf("de.catalog.marketValue");
    const amountAt = ROW_CODE.indexOf("catalogDisplayMarketPrice(");
    expect(captionAt).toBeGreaterThan(-1);
    expect(captionAt, "the caption comes before the amount").toBeLessThan(amountAt);
    /* Different lines: the caption's paragraph closes before the price line
       opens. */
    const priceLineAt = ROW_CODE.indexOf("flex min-w-0 flex-wrap items-center");
    expect(captionAt).toBeLessThan(priceLineAt);
    expect(amountAt).toBeGreaterThan(priceLineAt);
    /* And the amount is the prominent one of the two. */
    expect(ROW_CODE).toContain("text-[17px] leading-none font-semibold tabular-nums");
    expect(ROW_CODE).toContain('text-[8px] leading-none font-medium tracking-[0.08em] uppercase');
  });

  it("the caption line holds the label and the chip with room to spare", () => {
    /*
     * 56 for the caption, 62 for the longest edition chip, 8 of gap — 126 of
     * a phone's 179. What is left is the series' share, and the series is the
     * one thing on this line allowed to shorten.
     */
    const text = rowTextWidth(phoneRowWidth(360));
    expect(MARKET_LABEL_PX + ROW.gap + EDITION_CHIP_PX).toBeLessThanOrEqual(text);
    expect(text - (MARKET_LABEL_PX + 2 * ROW.gap + EDITION_CHIP_PX),
      "and the series still gets a readable share").toBeGreaterThan(30);
  });

  it("the edition is gone from the information area entirely", () => {
    /*
     * THE OPERATOR'S INSTRUCTION. It was a chip at the right of the caption
     * line; it is a banderole on the picture now, so the text block never
     * mentions an edition at all — not on the caption line, not on the price
     * line.
     */
    expect(ROW_CODE).not.toContain("CARD_TYPE_LABELS");
    expect(ROW_CODE).not.toContain("{edition}");
    expect(ROW_CODE).not.toContain("bg-status-ground");
    expect(ROW_CODE).toContain("<EditionBanner cardType={figure.cardType} />");
    const stage = ROW_CODE.slice(
      ROW_CODE.indexOf("relative flex h-16 w-16"),
      ROW_CODE.indexOf("w-px shrink-0 self-stretch"),
    );
    expect(stage, "the banner belongs to the picture").toContain("<EditionBanner");
  });

  it("the offer is the last line of the text block, pushed to the right", () => {
    const block = ROW_CODE.slice(
      ROW_CODE.indexOf("flex min-w-0 flex-1 flex-col"),
      ROW_CODE.indexOf("flex w-11 shrink-0"),
    );
    expect(block, "the offer is not in the text block").toContain("{trade}");
    /* `ml-auto` on the pill rather than `justify-end` on the line: the line
       also carries the series at its left, and the pill still has to sit at
       the right whether or not that is there. */
    expect(block).toContain("ml-auto inline-flex");
    /* And it IS the last line: nothing but the failure notice follows it. */
    expect(block.indexOf("{trade}")).toBeGreaterThan(block.indexOf("de.catalog.marketValue"));
  });

  it("the heart's column is 44 px wide and as tall as the heart", () => {
    expect(ROW.touch).toBe(44);
    expect(ROW.touch).toBe(11 * 4);
    expect(ROW_CODE).toContain("w-11");
    expect(ROW_CODE).toContain("self-start");
  });

  it("the picture sits at the top when a name pushed the row open", () => {
    expect(ROW_CODE).toContain("shrink-0 self-start items-center justify-center");
  });
});

describe("the whole row is the toggle, and the two controls are not", () => {
  it("the toggle is an overlay, first in the DOM", () => {
    /*
     * THE STACKING IS THE TRICK, so it is asserted rather than trusted:
     * static children paint first, then positioned ones in DOM order. The
     * overlay comes first and the two controls carry `relative`, so they
     * paint above it and keep their own clicks. No `z-index` anywhere — and
     * NOT a negative one, which would paint the overlay behind the article's
     * own background and let the article win the hit test.
     */
    const article = ROW_CODE.indexOf("<article");
    const overlay = ROW_CODE.indexOf("absolute inset-0 h-full w-full rounded-sky-md");
    const offer = ROW_CODE.indexOf("{trade}");
    const heart = ROW_CODE.indexOf("{favoriteSlot}");
    expect(overlay).toBeGreaterThan(article);
    expect(overlay, "the overlay must come before the controls").toBeLessThan(offer);
    expect(overlay).toBeLessThan(heart);
    expect(ROW_CODE).not.toContain("-z-10");
    expect(ROW_CODE).not.toMatch(/\bz-\d/);
  });

  it("and ONLY the two controls are positioned — not the boxes around them", () => {
    /*
     * THE DEFECT THIS FIXES, found while chasing the preview's hit-test
     * report: the offer's whole LINE and the heart's whole COLUMN used to
     * carry `relative`, so their empty halves painted above the collect
     * overlay and swallowed every tap that landed there. A third of the row
     * was dead. Now the line and the column are static and only the 44 px
     * that actually hold a control sit above the overlay.
     */
    expect(ROW_CODE).toContain("group relative ml-auto inline-flex min-h-11");
    expect(ROW_CODE).toContain('<span className="relative">{favoriteSlot}</span>');
    expect(ROW_CODE).toContain('<span className="relative">{bellSlot}</span>');
    expect(ROW_CODE, "the price line must not be positioned")
      .toContain("flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1");
    expect(ROW_CODE, "the action column must not be positioned")
      .toContain("flex w-11 shrink-0 flex-col items-center self-stretch");
  });

  it("no nesting, and therefore no event handling to keep them apart", () => {
    /* A link inside a button is invalid markup and an ambiguous target. */
    expect(ROW_CODE).not.toContain("stopPropagation");
    const toggle = ROW_CODE.slice(
      ROW_CODE.indexOf("<button"),
      ROW_CODE.indexOf("</button>"),
    );
    expect(toggle).not.toContain("{trade}");
    expect(toggle).not.toContain("{favoriteSlot}");
  });

  it("the toggle says which figure it is about", () => {
    expect(ROW_CODE).toContain("aria-pressed={collected}");
    expect(ROW_CODE).toMatch(/sr-only[\s\S]{0,120}figure\.displayName/);
  });
});

/* ========================================================================
 * 4. OWNERSHIP
 * ===================================================================== */

describe("ownership on a row uses the rules that already exist", () => {
  it("asks the same four functions the card asks", () => {
    expect(ROW_SRC).toContain('from "@/lib/catalog/card"');
    for (const fn of ["marksOwnership(", "understatesCard(", "duplicateBadge("]) {
      expect(ROW_CODE, `the row calls ${fn}`).toContain(fn);
    }
    /* `namesEdition` moved one level in: `EditionBanner` asks it, so the rule
       is still one rule in one place. */
    expect(code(read("src/components/catalog/edition-banner.tsx")))
      .toContain("namesEdition(cardType)");
    expect(ROW_CODE).not.toMatch(/quantity\s*>\s*0/);
  });

  it("and therefore answers exactly as the card does", () => {
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
    for (const ground of ["owned:", "understated:", "neutral:"]) {
      expect(ROW_CODE, `GROUND is missing ${ground}`).toContain(ground);
    }
    expect(ROW_CODE)
      .toContain("owned ? GROUND.owned : understated ? GROUND.understated : GROUND.neutral");
  });

  it("possession is gold, from the gold tokens and not from a literal", () => {
    const owned = ROW_CODE.slice(ROW_CODE.indexOf("owned:"), ROW_CODE.indexOf("understated:"));
    expect(owned).toContain("bg-own-subtle/70");
    expect(owned).toContain("ring-own-line-strong");
    expect(owned).toMatch(/shadow-\[0_0_18px_-8px_var\(--own-line-strong\)\]/);
    expect(ROW_CODE, "the row hard-codes a colour").not.toMatch(/#[0-9a-fA-F]{6}/);
  });

  it("said compactly: a gold diamond, and the sentence for anyone who needs it", () => {
    /*
     * THE COMPACT FORM THE CORRECTION ASKED FOR. "◆ In deiner Sammlung" as
     * visible text took most of the meta line and pushed the edition and the
     * value off it. The ground, the edge and the diamond say it three times
     * over for anyone who can see them; the sentence stays in the markup for
     * anyone who cannot — and for a forced-colours display, where the gold is
     * repainted away.
     */
    expect(ROW_CODE).toContain("text-own-ink");
    expect(ROW_CODE).toContain("◆");
    expect(ROW_CODE).toContain("de.catalog.collectedBadge");
    expect(ROW_CODE).toContain("sr-only");
    /* And the copies count goes with it, in the same hidden sentence. */
    expect(ROW_CODE).toContain("de.collection.copies(copies)");
  });

  it("and it is not the coral of wanting, which is a different question", () => {
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

    const grounds = [deep, canvas].flatMap((behind) => [
      { name: "owned", hex: over(ownSubtle, 0.7, behind) },
      { name: "understated", hex: over(deep, 0.55, behind) },
      { name: "neutral", hex: over(deep, 0.7, behind) },
    ]);

    for (const ground of grounds) {
      expect(contrast(foreground, ground.hex), `name on ${ground.name}`).toBeGreaterThan(7);
      expect(contrast(muted, ground.hex), `meta on ${ground.name}`).toBeGreaterThan(4.5);
    }
    for (const ground of grounds.filter((g) => g.name === "owned")) {
      expect(contrast(ownInk, ground.hex), "gold ink on the owned ground").toBeGreaterThan(4.5);
    }
  });

  it("the offer line's ink is swapped for the dark ground, not reinvented", () => {
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
    for (const forbidden of [
      "card-shell-unowned", "saturate(", "brightness(", "grayscale",
      "opacity-", "scale(", "UNCOLLECTED_SCALE",
    ]) {
      expect(ROW_SRC, `the row uses ${forbidden}`).not.toContain(forbidden);
    }
    expect(ROW_CODE).not.toContain("transform");
  });

  it("the picture keeps its own stage, reserved before the file arrives", () => {
    expect(ROW_CODE).toMatch(/h-16 w-16 shrink-0/);
    expect(ROW_CODE).toContain("sm:h-18 sm:w-18");
    expect(ROW_CODE).toContain("bg-plate");
    expect(ROW_CODE).toContain("object-contain");
    expect(ROW_CODE).toContain('loading="lazy"');
  });

  it("and the 27 figures without a picture get an empty stage, not an error", () => {
    expect(ROW_CODE).toContain("de.catalog.noImage");
  });
});

/* ========================================================================
 * 5. THE EDITION
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
    const banner = code(read("src/components/catalog/edition-banner.tsx"));
    expect(banner).toContain("CARD_TYPE_LABELS[cardType]");
    for (const label of Object.values(CARD_TYPE_LABELS)) {
      expect(banner, `the banner spells out "${label}"`).not.toContain(`"${label}"`);
    }
  });

  it("the banner is never gold — an edition is a property of the object", () => {
    /* Gold means possession; a gold banner would make an unowned Legendary
       look owned. The same reason `VariantSeal` is not gold. */
    const banner = code(read("src/components/catalog/edition-banner.tsx"));
    expect(banner).not.toContain("own-");
    expect(banner).not.toContain("favorite-");
    expect(banner).not.toContain("gold");
  });

  it("the variant stays inside the name, where V3.6 put it", () => {
    expect(ROW_CODE).toContain("figure.displayName");
    expect(ROW_CODE).not.toContain("sortBaseName");
    expect(ROW_SRC).not.toContain("VariantSeal");
  });
});

/* ========================================================================
 * 6. THREE INDEPENDENT STATES
 * ===================================================================== */

describe("possession, wanting and the reserved alarm slot are independent", () => {
  it("the row receives each of them separately and couples none of them", () => {
    expect(ROW_CODE).toContain("collected = false");
    expect(ROW_CODE).toContain("favoriteSlot");
    expect(ROW_CODE).toContain("bellSlot");
    expect(ROW_CODE).not.toMatch(/collected\s*&&\s*favorite/);
    expect(ROW_CODE).not.toMatch(/favorite\w*\s*\?\s*GROUND/);
  });

  it("and it knows nothing about favourites beyond the slot", () => {
    expect(ROW_CODE).not.toContain("FavoriteHeart");
    expect(ROW_CODE).not.toContain("setFavorite");
    expect(ROW_CODE).not.toContain("favorites/");
  });

  it("but no bell, no notification centre and no scheduler are built", () => {
    for (const forbidden of [
      "watch_availability", "unwatch_availability", "fire_availability_alerts",
      "acknowledge_availability_alerts", "availability_alerts", "benachrichtigungen",
      "BellGlyph",
    ]) {
      expect(ROW_SRC, `the row reaches for ${forbidden}`).not.toContain(forbidden);
      expect(CATALOG_CARD_SRC, `catalog-card reaches for ${forbidden}`).not.toContain(forbidden);
    }
  });
});

/* ========================================================================
 * 7. THE OFFER SEMANTICS ARE THE EXISTING ONES
 * ===================================================================== */

describe("the offer is the one that already exists", () => {
  it("the row computes no price and no buyability — it is handed the line", () => {
    expect(ROW_SRC).not.toContain("@/lib/shop/offer");
    expect(ROW_CODE).not.toContain("OfferLink");
    for (const name of [
      "summarizeOffers", "v1BuyableOffers", "hasV1BuyableOffer", "automaticShopPrice",
      "available", "condition",
    ]) {
      expect(ROW_CODE, `the row mentions ${name}`).not.toContain(name);
    }
    expect(ROW_CODE).toContain("{trade}");
  });

  it("and the market value is the catalog's, boosted at the last moment", () => {
    expect(ROW_SRC).toContain("NO_MARKET_BOOST, catalogDisplayMarketPrice");
    expect(ROW_CODE).toContain("marketBoostPercent = NO_MARKET_BOOST");
    expect(ROW_CODE).toContain(
      "catalogDisplayMarketPrice(figure.marketPrice, marketBoostPercent)",
    );
    expect(ROW_CODE).toContain("figure.marketPrice === null");
    expect(ROW_CODE).toContain("de.catalog.noPrice");
    expect(ROW_SRC).not.toContain("fetchCatalogMarketBoost");
  });

  it("the two prices are told apart by a label and by a line", () => {
    /* Different rows, different sizes, different inks, and both labelled —
       they are two numbers and must never read as one (ADR-0033). */
    expect(ROW_CODE).toContain("de.catalog.marketValue");
    const valueLine = ROW_CODE.indexOf("de.catalog.marketValue");
    const offerLine = ROW_CODE.indexOf("{trade}");
    expect(valueLine).toBeLessThan(offerLine);
  });

  it("the line exists whether or not anything is for sale", () => {
    expect(ROW_CODE).not.toMatch(/trade \?\s*</);
  });
});

/* ========================================================================
 * 8. NO NEW WRITE PATHS
 * ===================================================================== */

describe("nothing new writes anywhere", () => {
  it("the row is presentation only — no action, no client, no fetch", () => {
    for (const forbidden of [
      '"use server"', "@/lib/supabase", "createClient", "revalidatePath",
      "useTransition", "useState", "fetch(", "/actions",
    ]) {
      expect(ROW_SRC, `the row contains ${forbidden}`).not.toContain(forbidden);
    }
    expect(TEMPLATE_SRC, "the geometry module imports nothing").not.toContain("import");
  });

  it("there is still exactly one collect call, in the shared control", () => {
    expect(CATALOG_CARD_CODE.match(/setCollected\(/g) ?? []).toHaveLength(1);
    expect(CATALOG_CARD_CODE.match(/useState\(/g) ?? []).toHaveLength(2);
    expect(CATALOG_CARD_CODE.match(/startTransition\(/g) ?? []).toHaveLength(1);
  });

  it("and no shop, stock, cart or checkout module was touched by it", () => {
    for (const forbidden of [
      "@/lib/cart", "@/lib/commerce", "shop_inventory", "reserve_order_stock",
      "shop_offers", "inventory_movements",
    ]) {
      expect(ROW_SRC, `the row reaches for ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("no dialog can be mounted inside a row", () => {
    expect(ROW_CODE).not.toContain("@container");
    /*
     * THE JSX, NOT THE WORD. The row legitimately NAMES the caller's
     * `hasQuickViewOffer()` in a comment, because that is where `offered`
     * comes from; what it must not do is render a dialog.
     */
    expect(ROW_CODE).not.toContain("<QuickView");
    expect(ROW_SRC).not.toContain('from "@/components/catalog/quick-view"');
    expect(ROW_SRC).not.toContain("Modal");
    expect(ROW_CODE).not.toMatch(/\bfixed\b/);
  });
});

/* ========================================================================
 * 9. MOBILE GEOMETRY — THE PART THAT IS ARITHMETIC
 * ===================================================================== */

describe("the geometry is measured, and the markup says the same numbers", () => {
  it("the class names agree with the constants", () => {
    /* Tailwind's spacing scale is 4 px, so these are the same numbers twice —
       which is exactly what would silently stop being true otherwise. */
    expect(ROW.padX).toBe(6); // `px-1.5`
    expect(ROW.padY).toBe(6); // `py-1.5`
    expect(ROW.gap).toBe(6); // `gap-1.5`
    expect(ROW.gapWide).toBe(10); // `sm:gap-2.5`
    expect(ROW.image).toBe(16 * 4);
    expect(ROW.imageWide).toBe(18 * 4);
    expect(INFO.price).toBe(11 * 4);
    expect(INFO.gap).toBe(2);
    expect(ROW_CODE).toContain("gap-0.5");
  });

  it("every control is 44 px, and the chip is visibly smaller than its target", () => {
    /*
     * THE OPERATOR ALLOWED THESE TO DIFFER, and they do. The ring and the
     * ground are drawn by a layer inset 9 px top and bottom, so the chip
     * reads as 26 px; the link fills the whole 44 and is what a finger hits.
     */
    expect(ROW.touch).toBe(44);
    expect(INFO.price).toBe(ROW.touch);
    expect(CHIP_VISIBLE).toBe(24);
    expect(CHIP_VISIBLE).toBeLessThan(ROW.touch);
    expect(CHIP_INSET).toBe(10);
    expect(ROW_CODE).toContain("min-h-11");
    expect(ROW_CODE).toContain("w-11");
    /* The visible layer is inset and cannot take a tap of its own. */
    expect(ROW_CODE).toContain("pointer-events-none absolute inset-x-0 inset-y-[10px]");
  });

  it("declares no width a phone cannot hold", () => {
    const widths = [...ROW_CODE.matchAll(/\b(?:min-)?w-\[(\d+)px\]/g)].map((m) => Number(m[1]));
    for (const width of widths) {
      expect(width, "a hard-coded width").toBeLessThanOrEqual(phoneRowWidth(PHONE_WIDTHS[0]));
    }
    expect(ROW_CODE).not.toMatch(/\bw-screen\b/);
    expect(ROW_CODE).not.toMatch(/\boverflow-x-/);
    expect(ROW_CODE.match(/min-w-0/g) ?? []).not.toHaveLength(0);
  });
});

describe("the name still has room on a phone", () => {
  /**
   * The longest name the catalogue actually contains, derived the way the
   * catalogue derives it.
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

  it("the text block grew with the correction, not shrank", () => {
    /*
     * A nice side effect of a 64 px picture replacing a 72 px one: the text
     * block is 8 px WIDER than in the version that was too tall.
     */
    /* 10 px wider than before this pass: the padding and the column gaps
       each gave up 2 px so an ordinary amount could sit beside the chip. */
    expect(rowTextWidth(phoneRowWidth(360))).toBe(189);
    expect(nameCharsPerLine(189)).toBe(25);
  });

  it("and it grows with the viewport, never shrinks", () => {
    const widths = PHONE_WIDTHS.map((v) => rowTextWidth(phoneRowWidth(v)));
    expect(widths).toEqual([...widths].sort((a, b) => a - b));
    expect(widths[0]).toBeGreaterThan(0);
  });

  it("the value and the offer each fit their own line at every phone width", () => {
    /* Which is why they are on two lines rather than one. */
    for (const viewport of PHONE_WIDTHS) {
      const text = rowTextWidth(phoneRowWidth(viewport));
      expect(text, `${viewport}: the caption`).toBeGreaterThanOrEqual(MARKET_LABEL_PX);
      expect(text, `${viewport}: the offer`).toBeGreaterThanOrEqual(OFFER_LABEL_PX);
    }
  });

  it("the page's own padding is accounted for, not forgotten", () => {
    expect(PAGE_PAD).toBe(16);
    expect(phoneRowWidth(360)).toBe(328);
    expect(code(read("src/app/(public)/(catalog)/page.tsx"))).toContain("px-4");
  });
});

describe("one column, then two, decided by the container", () => {
  it("the threshold is a measurement in rem and in px", () => {
    expect(TWO_COLUMN_AT_PX).toBe(832);
  });

  /**
   * THE RULE THE THRESHOLD IMPLEMENTS, and it is worth stating exactly
   * because the first attempt at this test justified it from the OLD
   * geometry and was wrong:
   *
   *   > A row in two columns must never be narrower than a row on the
   *   > largest phone.
   *
   * The largest phone this design is held to is 414 px, which gives the text
   * block 237 px. The row's fixed parts take 169 px at the `sm:` step, so a
   * row needs 406 px to match it — and two of those plus a 12 px gap is
   * 824 px of container. 52 rem (832) is the next round number above it.
   */
  const LARGEST_PHONE_TEXT = rowTextWidth(phoneRowWidth(414));

  it("two columns are never narrower than the largest phone", () => {
    const rowWidth = (TWO_COLUMN_AT_PX - ROW.gapWide) / 2;
    expect(Math.round(rowWidth)).toBe(411);
    expect(rowTextWidth(rowWidth, true)).toBeGreaterThanOrEqual(LARGEST_PHONE_TEXT);
  });

  it("and just below the threshold they would be", () => {
    /* The honest counter-test: the threshold is not decoration. */
    const tooNarrow = (TWO_COLUMN_AT_PX - 64 - ROW.gapWide) / 2;
    expect(rowTextWidth(tooNarrow, true)).toBeLessThan(LARGEST_PHONE_TEXT);
  });

  it("a tablet at 768 px therefore stays one column", () => {
    const inner = 768 - 2 * PAGE_PAD;
    expect(inner).toBeLessThan(TWO_COLUMN_AT_PX);
    /* Not because two columns would be unusable there — 193 px of text would
       work — but because they would be narrower than the phone the design is
       tuned for, and a tablet is not a worse phone. */
    expect(rowTextWidth((inner - ROW.gapWide) / 2, true)).toBeLessThan(LARGEST_PHONE_TEXT);
  });

  it("at the threshold the value and the offer could even share a line", () => {
    /* They do not — the layout keeps them apart for the phone's sake — but it
       shows how much room two columns have at 832 px and upwards. */
    const rowWidth = (TWO_COLUMN_AT_PX - ROW.gapWide) / 2;
    expect(rowTextWidth(rowWidth, true)).toBeGreaterThan(AMOUNT_PX + OFFER_CHIP_PX);
  });

  it("never a third column, let alone a fourth", () => {
    const grid = code(read("src/components/catalog/figure-grid.tsx"));
    expect(grid).toContain("@min-[52rem]:grid-cols-2");
    /* `sm:grid-cols-3` belongs to the CARD grid and stays; what must not
       exist is a third column for ROWS — a container-query one. */
    expect(grid).not.toMatch(/@min-\[[^\]]*\]:grid-cols-[3-9]/);
    const rows = grid.slice(grid.indexOf("const ROWS"), grid.indexOf("export function"));
    expect(rows).not.toContain("grid-cols-3");
    expect(rows).not.toContain("grid-cols-4");
    /* And the arithmetic agrees: three columns at the widest container are
       narrower than two, so a third would make the list worse. */
    const widest = 1152;
    expect(rowTextWidth((widest - 2 * ROW.gapWide) / 3, true))
      .toBeLessThan(rowTextWidth((widest - ROW.gapWide) / 2, true));
  });
});

/* ========================================================================
 * 10. THE ERROR PATH
 * ===================================================================== */

describe("a failed collect says so without covering anything", () => {
  it("in flow, because a row must never lay one thing over another", () => {
    expect(ROW_CODE).toContain('role="alert"');
    expect(ROW_CODE).toContain("de.catalog.collectFailed");
    const notice = ROW_CODE.slice(ROW_CODE.indexOf("{failed ?"));
    expect(notice.slice(0, 200)).not.toContain("absolute");
  });

  it("and the card keeps the absolute one it needs", () => {
    expect(CATALOG_CARD_CODE).toContain("absolute inset-x-1 bottom-1");
    expect(CATALOG_CARD_CODE).toContain("failed={failed}");
  });
});
