import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { de } from "@/lib/i18n/de";
import { join } from "node:path";

import { CARD_TYPES, CARD_TYPE_LABELS, DEFAULT_CARD_TYPE } from "@/lib/catalog/card-type";
import { duplicateBadge, marksOwnership, namesEdition, understatesCard } from "@/lib/catalog/card";
import {
  barWidth,
  AMOUNT_ORDINARY_PX,
  GRID_GAP_WIDE,
  NAME_FONT_PX,
  marketBlockWidth,
  nameWidth,
  OFFER_CHIP_COMPACT_PX,
  OFFER_LABEL_SHORT_PX,
  TILE_MAX,
  OWNED_DIAMOND_PX,
  UX01C_ROW_HEIGHT,
  UX01C_ROW_HEIGHT_TWO_LINE,
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
/* The two controls that stand side by side in the action bar (UX-01D). */
const INFO_SRC = read("src/components/catalog/info-link.tsx");

/**
 * The longest and the median display name the catalogue actually contains,
 * derived the way the catalogue derives them.
 *
 * At module scope because two blocks need the same measurement, and two
 * derivations of one number is how they start to disagree.
 */
const CATALOG_NAMES = (() => {
  const items = (JSON.parse(read("data/catalog/products.json")) as {
    items: { name: string; series: string }[];
  }).items;
  const bySeries = new Map<string, Set<string>>();
  for (const item of items) {
    const set = bySeries.get(item.series) ?? new Set<string>();
    set.add(item.name);
    bySeries.set(item.series, set);
  }
  const lengths = items.map((item) => {
    const names = bySeries.get(item.series) ?? new Set<string>();
    const shown = displayNameFor(item.name, parseVariant(item.name, names));
    return Math.max(item.name.length, shown.length);
  });
  lengths.sort((a, b) => a - b);
  const share = (max: number) =>
    lengths.filter((n) => n <= max).length / lengths.length;
  return {
    count: items.length,
    longest: lengths[lengths.length - 1],
    median: lengths[Math.floor(lengths.length / 2)],
    p90: lengths[Math.floor(lengths.length * 0.9)],
    share,
  };
})();
const LONGEST_NAME = CATALOG_NAMES.longest;
const MEDIAN_NAME = CATALOG_NAMES.median;
const P90_NAME = CATALOG_NAMES.p90;
const HEART_SRC = read("src/components/catalog/favorite-heart.tsx");
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

  it("seit UX-01G bekommt der Administrator dieselbe Kachel — mit anderen Handlungen", () => {
    /*
     * HIER STAND „the administrator keeps the card". Das war richtig, bis
     * der Betreiber entschied, dass die Kachel die Darstellung des Katalogs
     * ist — für alle drei Konten. Der Zweig zeichnet jetzt `FigureRow`, und
     * was ihn vom Sammlerzweig unterscheidet, sind drei Dinge: kein
     * Sammelknopf, kein Herz, und ein `adminSlot` mit Stift und Auge.
     */
    const adminBranch = CATALOG_CARD_CODE.slice(
      CATALOG_CARD_CODE.indexOf("if (admin) {"),
      CATALOG_CARD_CODE.indexOf("const quickBuy"),
    );
    expect(adminBranch).toContain("<FigureRow");
    expect(adminBranch).not.toContain("<FigureCard");
    expect(adminBranch).toContain("<AdminTileActions");
    /* Kein Sammeln und kein Herz: ein Betreiber sammelt nicht aus dem
       eigenen Katalog (ADR-0042). */
    expect(adminBranch).not.toContain("onToggle");
    expect(adminBranch).not.toContain("favoriteSlot");
  });

  it("und die klassische Karte lebt weiter, nur nicht mehr im Katalog", () => {
    /*
     * AUFGABE 4, und die Grenze darin: `FigureCard` ist NICHT ungenutzt. Die
     * Sammlung zeichnet sie, und der Shop zeichnet sie nach eigener Wahl.
     * Eine Komponente zu löschen, die zwei andere Flächen brauchen, wäre
     * genau der Schaden, den der Auftrag ausschliesst.
     */
    expect(read("src/components/collection/collection-view.tsx"))
      .toContain("<FigureCard");
    expect(read("src/components/shop/shop-view.tsx")).toContain("layoutFor(view)");
    /* Und der Katalog zeichnet sie nicht mehr — gefragt ist, was gezeichnet
       wird, nicht was im Kommentar steht. */
    const katalog = read("src/components/catalog/catalog-view.tsx");
    expect(katalog).not.toContain("<FigureCard");
    expect(katalog).not.toContain('from "@/components/catalog/figure-card"');
  });

  it("the card stays the default, so a surface that says nothing is unchanged", () => {
    /*
     * UX-01G HAT DIE VORGABE UMGEDREHT. Sie war `"card"`, weil die Kachel
     * die neue Darstellung war und ausdrücklich verlangt werden musste. Jetzt
     * ist die Kachel die Darstellung des Katalogs, also ist sie die Vorgabe —
     * und wer die Eigenschaft vergisst, bekommt sie und nicht die
     * Darstellung einer anderen Fläche.
     */
    expect(CATALOG_CARD_CODE).toContain('layout = "row"');
    expect(CATALOG_CARD_CODE).toContain('layout?: "card" | "row"');

    /*
     * WHO CHOOSES, AND WHO MUST NOT (UX-01C).
     *
     * The two interactive views choose a layout and nobody else does. The
     * server pages hand down DATA and the choice is the viewer's, remembered
     * in their browser; a page that passed one would be deciding something it
     * cannot know. The collection is out of scope by decision.
     */
    /*
     * NUR NOCH EINE FLÄCHE WÄHLT: der Shop. Der Katalog hat seit UX-01G
     * EINE Darstellung, und er schreibt sie als Konstante hin, statt sie zu
     * wählen — `const layout = "row" as const`.
     */
    expect(code(read("src/components/shop/shop-view.tsx"))).toMatch(/layout=\{/);
    expect(code(read("src/components/catalog/catalog-view.tsx")))
      .toContain('const layout = "row" as const;');
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

  it("UX-01C got it to 92, and UX-01D is 102 at every name length", () => {
    expect(UX01C_ROW_HEIGHT).toBe(92);
    expect(rowHeight(1)).toBe(102);
    /* The `sm:` step changes nothing: at 72 px the picture is still shorter
       than the text block, so the row does not grow on a tablet. */
    expect(rowHeight(1, true)).toBe(102);
    /*
     * TEN PIXELS, AND WHAT THEY BOUGHT. The identity line is a 44 px bar slot
     * now instead of a 16 px name, which is what makes the info action and
     * the heart reachable without a column of their own. The second half of
     * the trade is in the next test: the long-name case got CHEAPER.
     */
    expect(rowHeight(1) - UX01C_ROW_HEIGHT).toBe(10);
    /* Still far flatter than the first draft. */
    const saved = (PREVIOUS_ROW_HEIGHT - rowHeight(1)) / PREVIOUS_ROW_HEIGHT;
    expect(saved).toBeGreaterThan(0.25);
  });

  it("and a two-line name is now FREE, where it used to cost 16 px", () => {
    /*
     * THE QUIET WIN. A name of two lines is 32 px and the bar it shares the
     * line with is 44, so the longer name fits inside a height the row was
     * already paying. UX-01C grew to 108 for the same name.
     */
    expect(rowHeight(2)).toBe(rowHeight(1));
    expect(UX01C_ROW_HEIGHT_TWO_LINE).toBe(108);
    expect(rowHeight(2)).toBeLessThan(UX01C_ROW_HEIGHT_TWO_LINE);
  });

  it("and the bell costs width, never height", () => {
    /*
     * IT WAS A COLUMN AND IS A BAR. Two 44 px marks stacked on one x made a
     * row 8 px taller; side by side they make it no taller at all, and a
     * third mark takes 44 px from the NAME instead — the only thing on that
     * line able to give way.
     */
    expect(barWidth()).toBe(2 * ROW.touch);
    expect(barWidth(true)).toBe(3 * ROW.touch);
    expect(barWidth(true) - barWidth()).toBe(ROW.touch);
    /* The height function no longer takes a bell at all, which is the
       strongest way to say it cannot grow one. */
    expect(TEMPLATE_SRC).toContain("export function rowHeight(nameLines = 1, wide = false, priceWraps = false)");
    expect(TEMPLATE_SRC).not.toContain("ACTION_WITH_BELL");
  });

  it("and the price line no longer has to wrap at all", () => {
    /*
     * THE FALLBACK IS STILL THERE AND IS NO LONGER NEEDED. Before UX-01D a
     * three-digit amount pushed the chip onto its own line on every phone;
     * the 50 px the action column gave back, plus the compact label, mean the
     * worst case now fits with room to spare. The wrap arithmetic stays as
     * the stated fallback — nothing is truncated and no price is shrunk —
     * but no width in this design reaches it.
     */
    const text = rowTextWidth(phoneRowWidth(360));
    expect(priceLineFits(text, AMOUNT_PX, OFFER_CHIP_COMPACT_PX)).toBe(true);
    /* Even the LONG label fits at 360 now, although the phone shows the
       short one — so the `sm:` switch back cannot be a squeeze. */
    expect(priceLineFits(text, AMOUNT_PX, OFFER_CHIP_PX)).toBe(true);
    expect(rowHeight(1, false, true)).toBe(rowHeight(1) + AMOUNT_LINE + INFO.gap + 2);
  });

  it("the text block decides the height, not the picture", () => {
    /*
     * THE REASON THE PICTURE COULD GROW WHILE THE ROW SHRANK. At 72 px the
     * picture was the tallest thing in the row; the three text lines need
     * 70 px anyway, so anything up to 70 is free.
     */
    expect(INFO_HEIGHT).toBe(90);
    expect(ROW.image).toBeLessThan(INFO_HEIGHT);
    expect(ROW.imageWide).toBeLessThan(INFO_HEIGHT);
    expect(rowHeight(1)).toBe(2 * ROW.padY + INFO_HEIGHT);
    /* And it did grow: 56 was the first draft of the correction, 64 shipped. */
    expect(ROW.image).toBe(64);
    /* Two lines of 44, and the two touch targets are the reason for both. */
    expect(INFO.identity).toBe(ROW.touch);
    expect(INFO.price).toBe(ROW.touch);
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
    /* The column is gone entirely — that is what UX-01D did with it. */
    expect(ROW_CODE).not.toContain("flex-col items-center self-stretch");
    /*
     * WHAT IS PREPARED IS A PLACE AND A CONDITION, which is all "prepare it
     * architecturally" can honestly mean while `0150` is unapplied. The bell
     * is first in the bar, and only on a row with nothing to buy.
     */
    expect(ROW_CODE).toContain("{!offered && bellSlot ?");
    const bar = ROW_CODE.slice(ROW_CODE.indexOf("ml-auto flex shrink-0 items-center"));
    expect(bar.indexOf("bellSlot")).toBeLessThan(bar.indexOf("<InfoLink"));
    expect(bar.indexOf("<InfoLink")).toBeLessThan(bar.indexOf("favoriteSlot"));
  });

  it("and the offer is no longer a band under the picture", () => {
    /*
     * It spanned the whole row below the picture and cost 44 px plus a gap.
     * It is the last line of the text block now, right-aligned.
     */
    /* One line, no wrapping: since UX-01D the width is there, so `flex-wrap`
       came off and the chip is simply `ml-auto` at the row's inner edge. */
    expect(ROW_CODE).toContain("group relative ml-auto inline-flex min-h-11 shrink-0");
    expect(ROW_CODE).not.toContain("flex-wrap");
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
    expect(ROW_CODE).toContain("rounded-sky-md px-1.5 py-1.5 sm:gap-2.5");
    expect(ROW_CODE).toContain("items-stretch gap-1.5");
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
    /* Three since UX-01D: picture, hairline, text. The heart's column became
       a bar on the identity line, and the text block runs to the inner edge. */
    expect(ROW_COLUMNS).toBe(3);
    expect(ROW.divider).toBe(1);
    expect(ROW_CODE).toContain("w-px shrink-0 self-stretch");
    /* The text block absorbs the width; everything else is fixed. */
    expect(ROW_CODE).toContain("flex min-w-0 flex-1 flex-col gap-0.5");
  });

  it("the name is the first line, bigger and bolder, and alone there", () => {
    expect(ROW_CODE).toContain("figure.displayName");
    /* 14 px bold since UX-01E — see `NAME_FONT_PX` for why one pixel and
       not two. */
    expect(ROW_CODE).toContain("line-clamp-2 min-w-0 text-[14px] leading-[1.2] font-bold");
    expect(NAME_FONT_PX).toBe(14);
    expect(ROW_CODE).not.toContain("font-semibold text-foreground");
    /* The identity line carries the element's mark, the name and the bar —
       no edition label, no element WORD, and since UX-01E no gold diamond. */
    const bar = ROW_CODE.indexOf("ml-auto flex shrink-0 items-center");
    const nameLine = ROW_CODE.slice(
      ROW_CODE.indexOf('<div className="flex min-w-0 items-center gap-1.5">'),
      bar,
    );
    expect(nameLine).not.toContain("CARD_TYPE_LABELS");
    expect(nameLine).not.toContain("elementLabel");
    expect(nameLine).not.toContain("◆");
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
    /*
     * ONE BLOCK SINCE UX-01D, and that is the sharper version of the same
     * instruction: they were on two different lines 18 px apart, and the
     * operator asked for the caption to stand "deutlich näher" over its
     * number. They are stacked in one `flex-col gap-px` now — 1 px apart —
     * so nothing can come between them.
     */
    const stackAt = ROW_CODE.indexOf("flex shrink-0 flex-col gap-px");
    expect(stackAt).toBeGreaterThan(-1);
    expect(stackAt).toBeLessThan(captionAt);
    expect(amountAt).toBeGreaterThan(captionAt);
    /* And the series cannot get between them: it comes after the whole
       block, not after the caption. */
    expect(ROW_CODE.indexOf("figure.seriesLabel")).toBeGreaterThan(amountAt);
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
    /*
     * SEIT CAT-10 UEBERGIBT DIE ZEILE DEN SICHTBAREN TYPE und nicht den
     * Kartentyp. Die Zusage bleibt dieselbe — die Ausgabe steht in EINEM
     * Streifen und nicht als Wert in der Informationsspalte —, nur die
     * Quelle ist jetzt `visible_type` (`0163`). `bannerType()` ist die eine
     * Stelle, die sie liest, und sie leitet nichts ab.
     */
    expect(ROW_CODE).toContain("<EditionBanner type={banner} />");
    expect(ROW_CODE).toContain("bannerType(figure)");
    /*
     * IT BELONGS TO THE PICTURE COLUMN, AND SINCE UX-01E IT IS UNDER THE
     * PICTURE RATHER THAN OVER IT. So it still lies between the start of the
     * column and the hairline — but AFTER the stage's closing tag, which is
     * what "below, not on top" means in the markup.
     */
    const column = ROW_CODE.slice(
      ROW_CODE.indexOf("flex shrink-0 self-start flex-col"),
      ROW_CODE.indexOf("w-px shrink-0 self-stretch"),
    );
    expect(column, "the strip belongs to the picture column").toContain("<EditionBanner");
    expect(column.indexOf("<img")).toBeLessThan(column.indexOf("<EditionBanner"));
    /* The stage is CLOSED before the strip opens — which is the markup's way
       of saying "below the picture" rather than "inside it". */
    expect(column.indexOf("</span>")).toBeLessThan(column.indexOf("<EditionBanner"));
    expect(column).not.toContain("absolute");
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

  it("the bar's slots are 44 px, and the controls bring that themselves", () => {
    expect(ROW.touch).toBe(44);
    expect(ROW.touch).toBe(11 * 4);
    /*
     * THE ROW DECLARES NO 44 px BOX OF ITS OWN ANY MORE, which is the point:
     * the heart has carried `h-11 w-11` since it was built, and `InfoLink`
     * carries the same box deliberately so the two glyphs land on one line.
     * A width written here as well would be a second opinion about the same
     * number.
     */
    expect(INFO_SRC, "the info action brings its own 44 px").toContain("h-11 w-11");
    expect(HEART_SRC, "and so does the heart").toContain("h-11 w-11");
    expect(ROW_CODE).not.toContain("w-11");
    expect(ROW_CODE).toContain("self-start");
  });

  it("the info action brings no query, no dialog and no prefetch", () => {
    /*
     * ONE OF THESE STANDS ON EVERY ROW, so prefetching them would be a round
     * trip through `src/proxy.ts` — which validates the session against the
     * auth server — for every row scrolled into view. `OfferLink` learned
     * this the same way and says so in its own header.
     */
    expect(INFO_SRC).toContain("prefetch={false}");
    expect(INFO_SRC).toContain("href={`/skylanders/${slug}`}");
    expect(INFO_SRC).toContain("aria-label={de.catalog.infoFor(name)}");
    /* On the CODE, not the source: the header explains at length why this is
       not a `QuickView`, and naming the thing you are not is allowed. */
    const infoCode = code(INFO_SRC);
    for (const forbidden of ['"use client"', "useState", "fetch(", "@/lib/supabase",
                             "QuickView", "onOpen"]) {
      expect(infoCode, `the info action contains ${forbidden}`).not.toContain(forbidden);
    }
    /* And the row asks for it by name, without knowing where it leads. */
    expect(ROW_CODE).toContain("<InfoLink slug={figure.slug} name={figure.displayName} />");
    expect(ROW_CODE).not.toContain("/skylanders/");
  });

  it("and the row's own body still leads wherever the CALLER said", () => {
    /*
     * The two destinations are different questions and stay separate: the
     * body is the collect toggle, or on a signed-out surface the caller's
     * `signInHref`. The info action is the figure's page. Neither derives the
     * other.
     */
    expect(ROW_CODE).toContain("href ? (");
    expect(ROW_CODE).toContain("<Link\n          href={href}");
  });

  it("and the two boxes are identical, so the glyphs cannot drift apart", () => {
    /*
     * COPIED RATHER THAN IMPORTED — the `EditionBanner` precedent, and for
     * the same reason: the heart belongs to the card's corner and this to a
     * row's bar, so neither should have to import the other. But in the bar
     * they stand side by side, and a glyph 6 px off its neighbour is the kind
     * of thing nobody can name and everybody sees. This test is what keeps
     * them in step.
     */
    for (const shape of [
      "pointer-events-auto flex h-11 w-11 items-start justify-end",
      "grid place-items-center rounded-full p-1.5 transition-colors duration-150",
      'className="block h-[22px] w-[22px]"',
    ]) {
      expect(INFO_SRC, shape).toContain(shape.replace('className="', "").replace('"', ""));
      expect(HEART_SRC, shape).toContain(shape.replace('className="', "").replace('"', ""));
    }
  });

  it("the picture column sits at the top when a name pushed the row open", () => {
    /* `self-start` moved from the stage to the column that now holds the
       stage and the edition strip. */
    expect(ROW_CODE).toContain("flex shrink-0 self-start flex-col overflow-hidden");
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
    /* UX-01D's third slot, and it is positioned like the other two. */
    expect(ROW_CODE).toMatch(/<span className="relative">\s*<InfoLink/);
    /*
     * NEITHER LINE IS POSITIONED, and nor is the bar. All three are plain
     * flex rows: `relative` appears on the slots and on the chip's wrapper
     * and nowhere else in the text block, so every pixel that does not hold a
     * control falls through to the row's own toggle.
     */
    expect(ROW_CODE, "the identity line must not be positioned")
      .toContain('<div className="flex min-w-0 items-center gap-1.5">');
    expect(ROW_CODE, "the price line must not be positioned")
      .toContain('<div className="flex min-w-0 items-center gap-2">');
    expect(ROW_CODE, "the bar itself must not be positioned")
      .toContain('<span className="ml-auto flex shrink-0 items-center">');
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
    /*
     * DIE REGEL IST SEIT CAT-10 EINE ANDERE, und sie ist einfacher: kein
     * sichtbarer Type, kein Banner. `namesEdition()` fragte „ist der
     * Kartentyp etwas anderes als standard?"; jetzt gibt es dafuer keinen
     * Anlass mehr — die Auswahl IST die Aussage. Die Regel bleibt an EINER
     * Stelle, sie heisst nur `bannerType()` und steht in
     * `catalog-type.ts`.
     */
    expect(code(read("src/components/catalog/edition-banner.tsx")))
      .toContain("if (type === null) return null;");
    expect(code(read("src/lib/catalog/catalog-type.ts")))
      .toContain("export function bannerType(");
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
     * THE VISIBLE MARK WENT AND THE SENTENCE STAYED (UX-01E). A gold diamond
     * stood before the element; after the desktop review the operator asked
     * for the top left to be the element and the name and nothing else, with
     * the gold highlight carrying ownership on its own — which it does, three
     * times over: ground, edge and glow.
     *
     * The HIDDEN sentence is not removed with it, and that is the part worth
     * a test. It is the only place on the row that says how many copies are
     * owned, it is invisible, and it survives a forced-colours display where
     * the gold is repainted away. Dropping it would have cost a screen reader
     * information while changing nothing on screen.
     */
    expect(ROW_CODE).not.toContain("◆");
    expect(ROW_CODE).toContain("de.catalog.collectedBadge");
    expect(ROW_CODE).toContain("sr-only");
    expect(ROW_CODE).toContain("de.collection.copies(copies)");
    /* The gold itself is untouched — three signals, none costing a pixel. */
    expect(ROW_CODE).toContain("bg-own-subtle/70 ring-1 ring-own-line-strong");
    expect(ROW_CODE).toContain("shadow-[0_0_18px_-8px_var(--own-line-strong)]");
    expect(ROW_CODE).toContain("own-line-strong/60"); // the hairline
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
  it("kein Filter, keine Skalierung — und Deckkraft nur für das EINE, was sie bedeutet", () => {
    /*
     * DIE REGEL BLEIBT, MIT EINER BENANNTEN AUSNAHME.
     *
     * Die Zeile hat kein Artwork, dem man die Farbe nehmen könnte: Besitz
     * trägt sie über Grund, Kante und Glühen, und eine entsättigte Hülle
     * wäre ein zweites Signal für dieselbe Sache. Deshalb standen hier
     * `opacity-` und `saturate(` auf der Verbotsliste.
     *
     * SEIT CAT-09 GIBT ES EINEN FALL, DER GENAU DAS BRAUCHT: eine
     * VERSTECKTE Figur in der Adminansicht. Sie ist nicht „nicht besessen"
     * und nicht „nicht kaufbar" — sie ist zurückgenommen, und das soll man
     * an der ganzen Kachel sehen. Die Ausnahme hängt deshalb an EINER
     * Eigenschaft (`dimmed`), sie trifft Bild, Name und Betrag, und sie
     * lässt die Aktionsleiste in Ruhe: ein ausgegrauter Knopf sähe aus wie
     * ein abgeschalteter, und das Auge ist der Knopf, den man drücken will.
     */
    for (const forbidden of [
      "card-shell-unowned", "brightness(", "grayscale", "scale(",
      "UNCOLLECTED_SCALE",
    ]) {
      expect(ROW_SRC, `the row uses ${forbidden}`).not.toContain(forbidden);
    }
    expect(ROW_CODE).not.toContain("transform");

    /* Die Ausnahme, und sie hängt an `dimmed` — nirgends sonst. */
    const treffer = [...ROW_CODE.matchAll(/opacity-\d+|saturate-\[/g)].map((m) => m[0]);
    expect(treffer.length, "Deckkraft/Sättigung nur für dimmed").toBeGreaterThan(0);
    for (const t of treffer) {
      const i = ROW_CODE.indexOf(t);
      const umfeld = ROW_CODE.slice(Math.max(0, i - 160), i + 40);
      expect(umfeld, `${t} hängt nicht an dimmed`).toContain("dimmed");
    }
    /* Und die Aktionsleiste ist nicht betroffen: zwischen `adminSlot` und
       `favoriteSlot` steht keine Dämpfung. */
    const leiste = ROW_CODE.slice(ROW_CODE.indexOf("bellSlot}"),
                                  ROW_CODE.indexOf("favoriteSlot}") + 20);
    expect(leiste).not.toContain("dimmed");
    expect(leiste).not.toContain("opacity-");
  });

  it("the picture keeps its own stage, reserved before the file arrives", () => {
    /* `shrink-0` is on the column now; the stage keeps the square. */
    expect(ROW_CODE).toMatch(/h-16 w-16 items-center justify-center bg-plate/);
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
    /*
     * SEIT CAT-10 IST DIESE STELLE `TYPE_LABELS` — siebzehn Werte statt
     * sieben, weil ein Banner jetzt auch „GIANT" oder „TRAP" heissen kann.
     * Die Zusage ist unveraendert: der Streifen schreibt kein Wort selbst
     * aus.
     */
    const banner = code(read("src/components/catalog/edition-banner.tsx"));
    expect(banner).toContain("TYPE_LABELS[type]");
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
    /* The bar's two 44 px boxes are the controls' own — see the shape test. */
    expect(INFO_SRC).toContain("h-11 w-11");
    /* The visible layer is inset and cannot take a tap of its own. */
    expect(ROW_CODE).toContain("pointer-events-none absolute inset-x-0 inset-y-[10px]");
  });

  it("declares no width a phone cannot hold", () => {
    /*
     * `max-w-` IS DELIBERATELY NOT IN THIS SCAN, and the distinction is the
     * whole of the UX-01E correction: `w-` and `min-w-` FORCE a width and can
     * overflow a phone, while `max-w-` only caps one and never forces
     * anything. The tile's 520 px ceiling is the latter — it is what keeps a
     * lone tile from stretching, and it is checked against `TILE_MAX` below
     * rather than against a phone.
     */
    const widths = [...ROW_CODE.matchAll(/(?<!max-)\b(?:min-)?w-\[(\d+)px\]/g)]
      .map((m) => Number(m[1]));
    for (const width of widths) {
      expect(width, "a hard-coded width").toBeLessThanOrEqual(phoneRowWidth(PHONE_WIDTHS[0]));
    }
    expect(ROW_CODE).toContain(`max-w-[${TILE_MAX}px]`);
    expect(ROW_CODE).toContain("mx-auto");
    expect(ROW_CODE).not.toMatch(/\bw-screen\b/);
    expect(ROW_CODE).not.toMatch(/\boverflow-x-/);
    expect(ROW_CODE.match(/min-w-0/g) ?? []).not.toHaveLength(0);
  });
});

describe("the name still has room on a phone", () => {
  it("measures a real catalogue rather than a guess", () => {
    const longest = LONGEST_NAME;
    expect(CATALOG_NAMES.count).toBeGreaterThan(500);
    expect(longest).toBeGreaterThanOrEqual(30);
    expect(longest).toBeLessThanOrEqual(60);
    /* The median is the case that matters for a list of ninety rows. */
    expect(MEDIAN_NAME).toBeLessThan(longest);
  });

  it("the names that fit are counted, not assumed (UX-01E)", () => {
    /*
     * WHAT CHANGED AND WHY THE OLD CLAIM NO LONGER HOLDS. UX-01D gave the
     * name 88 px less than the text block, because the action bar shares its
     * line; UX-01E took another 44 for the visible bell and made the type a
     * pixel bigger. The longest name in the catalogue — 39 characters —
     * therefore no longer fits whole on ANY phone under this estimate, where
     * before it fitted from 390 px up.
     *
     * SO THE TEST COUNTS INSTEAD OF CLAIMING. The right question was never
     * "does the longest name fit" — it is a single outlier — but "how much of
     * the catalogue reads whole", and the answer is measured here against the
     * real 600 names. A name that does not fit clips at two lines with its
     * full text in `title`, and the info mark leads to the page that spells
     * it out; the operator allowed controlled shortening in as many words.
     *
     * THE ESTIMATE IS DELIBERATELY PESSIMISTIC (0.56 em a character, where
     * this stack measures nearer 0.49), so the real figures are better than
     * these. They are the floor, not the forecast.
     */
    const room = (v: number, withBell: boolean) =>
      nameCharsPerLine(nameWidth(rowTextWidth(phoneRowWidth(v)), { withBell }))
      * NAME_LINES;

    /* THE MEDIAN NAME FITS EVERYWHERE — with the bell, at the narrowest
       phone. That is the case that decides whether a list of ninety reads. */
    expect(MEDIAN_NAME).toBe(13);
    for (const viewport of PHONE_WIDTHS) {
      expect(room(viewport, true), `${viewport} px, with bell`)
        .toBeGreaterThanOrEqual(MEDIAN_NAME);
    }

    /*
     * AND AT THE NARROWEST, WITH THE BELL, MORE THAN NINE NAMES IN TEN READ
     * WHOLE — up from four in five, because the element's rune and its gap
     * came off the line (UX-01E correction) and gave the name 20 px back.
     */
    const narrowest = room(360, true);
    expect(narrowest).toBe(24);
    expect(CATALOG_NAMES.share(narrowest)).toBeGreaterThan(0.9);

    /* From 390 px up, nine in ten — the bell case included. */
    for (const viewport of [390, 414] as const) {
      expect(room(viewport, true), `${viewport} px`).toBeGreaterThanOrEqual(P90_NAME);
      expect(CATALOG_NAMES.share(room(viewport, true))).toBeGreaterThan(0.9);
    }

    /* A tile WITH an offer has one mark fewer, so it holds more. */
    expect(room(360, false)).toBeGreaterThan(room(360, true));
    expect(CATALOG_NAMES.share(room(414, false))).toBeGreaterThan(0.99);

    /* The outlier is named, so nobody has to rediscover it. */
    expect(LONGEST_NAME).toBe(39);
    expect(room(414, true)).toBeLessThan(LONGEST_NAME);
  });

  it("the text block grew with the correction, not shrank", () => {
    /*
     * A nice side effect of a 64 px picture replacing a 72 px one: the text
     * block is 8 px WIDER than in the version that was too tall.
     */
    /* 10 px wider than before this pass: the padding and the column gaps
       each gave up 2 px so an ordinary amount could sit beside the chip. */
    /* 239 since UX-01D — the 44 px column and one 6 px gap came back. */
    expect(rowTextWidth(phoneRowWidth(360))).toBe(239);
    expect(rowTextWidth(phoneRowWidth(360)) - 189).toBe(ROW.touch + ROW.gap);
    /* 24 at 14 px, where it was 25 at 13 — the one pixel of type, paid. */
    expect(nameCharsPerLine(189)).toBe(24);
  });

  it("and it grows with the viewport, never shrinks", () => {
    const widths = PHONE_WIDTHS.map((v) => rowTextWidth(phoneRowWidth(v)));
    expect(widths).toEqual([...widths].sort((a, b) => a - b));
    expect(widths[0]).toBeGreaterThan(0);
  });

  it("the value and the offer now share ONE line at every phone width", () => {
    /*
     * THEY HAD A LINE EACH until UX-01D, and the caption had a third. The
     * action column's 50 px and the shorter label are what bought the single
     * line — and this checks the whole line rather than its parts, which is
     * the stronger statement.
     */
    for (const viewport of PHONE_WIDTHS) {
      const text = rowTextWidth(phoneRowWidth(viewport));
      expect(priceLineFits(text, AMOUNT_PX, OFFER_CHIP_COMPACT_PX), `${viewport}`)
        .toBe(true);
      /* And with the long label too, although a phone shows the short one. */
      expect(priceLineFits(text, AMOUNT_PX, OFFER_CHIP_PX), `${viewport}: long`)
        .toBe(true);
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
   * block 293 px since UX-01D. The row's fixed parts take 105 px at the `sm:`
   * step, so a row needs 398 px to match it — and two of those plus the
   * grid's 12 px gap is 808 px of container. 52 rem (832) still clears it,
   * with 7 px a column to spare.
   */
  const LARGEST_PHONE_TEXT = rowTextWidth(phoneRowWidth(414));

  it("two columns are never narrower than the largest phone", () => {
    /* `GRID_GAP_WIDE`, not `ROW.gapWide`: the grid's `gap-3` is 12 px and the
       row's own column gap is 10. Borrowing one for the other was a pixel a
       column out. */
    const rowWidth = (TWO_COLUMN_AT_PX - GRID_GAP_WIDE) / 2;
    expect(Math.round(rowWidth)).toBe(410);
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

  it("up to three tiles, and never a fourth", () => {
    const grid = code(read("src/components/catalog/figure-grid.tsx"));
    expect(grid).toContain("repeat(auto-fill,minmax(min(360px,100%),1fr))");
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

/* ========================================================================
 * UX-01D — THE NINE CASES THE OPERATOR ASKED TO BE CHECKED
 *
 * No browser here, so every one of these is arithmetic over the measured
 * template rather than a screenshot. What they can prove is that nothing
 * overflows, nothing overlaps and no touch target is covered; what they
 * cannot prove is how it looks. The row is judged on the operator's iPhone,
 * which is the better instrument anyway.
 * ===================================================================== */

describe("UX-01D holds at every width the operator named", () => {
  /** The identity line: marks, name, bar. */
  const identityFits = (textWidth: number, opts = {}) =>
    nameWidth(textWidth, opts) > 0;

  it("360, 390 and 414 — the bar fits, the name keeps room, nothing overflows", () => {
    for (const viewport of PHONE_WIDTHS) {
      const text = rowTextWidth(phoneRowWidth(viewport));
      const label = `${viewport} px`;

      /* The bar is never squeezed: it is `shrink-0`, and the arithmetic says
         there is room for it plus a readable name. */
      expect(identityFits(text), label).toBe(true);
      expect(nameWidth(text), label).toBeGreaterThanOrEqual(125);

      /* The price line holds the worst amount beside the compact chip. */
      expect(priceLineFits(text, AMOUNT_PX, OFFER_CHIP_COMPACT_PX), label).toBe(true);

      /* And the sum of the fixed parts never exceeds the row. */
      const fixed = 2 * ROW.padX + ROW.image + ROW.divider + 2 * ROW.gap;
      expect(fixed + text, label).toBe(phoneRowWidth(viewport));
    }
  });

  it("the desktop's two columns are never narrower than the largest phone", () => {
    /*
     * THE RULE FROM UX-01C, UNCHANGED: a row in two columns must never be
     * narrower than a row on the largest phone, or the second column would
     * make the design worse at a wider viewport.
     *
     * THE CONTAINER IS ALREADY INSIDE THE PAGE PADDING — `@container` sits on
     * a div within `main … px-4` — so the threshold is NOT reduced by it
     * again. Writing this down because the first draft of this test did
     * subtract it twice and reported a failure that was its own arithmetic.
     */
    const widest = rowTextWidth(phoneRowWidth(414));
    const column = (TWO_COLUMN_AT_PX - GRID_GAP_WIDE) / 2;
    expect(rowTextWidth(column, true)).toBeGreaterThanOrEqual(widest);
    /* And there is never a third column — two is the ceiling. */
    expect(rowTextWidth((TWO_COLUMN_AT_PX - 2 * GRID_GAP_WIDE) / 3, true))
      .toBeLessThan(widest);
    /* A name in two columns is longer than on any phone, so nothing clips
       there that did not clip on a phone. */
    expect(nameCharsPerLine(nameWidth(rowTextWidth(column, true))) * NAME_LINES)
      .toBeGreaterThanOrEqual(LONGEST_NAME);
  });

  it("a long name gives way, and only the name", () => {
    /*
     * THE OPERATOR'S REQUIREMENT: a long name must not cover the bar. It
     * cannot — the bar is `shrink-0` and the name is `min-w-0 line-clamp-2`,
     * so the name clips and the bar keeps its 88 px. The cost is stated
     * rather than hidden: the longest name in the catalogue is 39 characters,
     * and at 360 px two lines hold about 34 of them.
     */
    const longest = LONGEST_NAME;
    expect(longest).toBe(39);
    /* With an offer — two marks in the bar — the longest name is whole from
       414 px. With the bell it is not, on any phone; the share that IS whole
       is counted in "the names that fit are counted, not assumed". */
    const at = (v: number, withBell = false) =>
      nameCharsPerLine(nameWidth(rowTextWidth(phoneRowWidth(v)), { withBell }));
    expect(at(360) * NAME_LINES, "clips at 360").toBeLessThan(longest);
    expect(at(414) * NAME_LINES, "whole at 414 with an offer")
      .toBeGreaterThanOrEqual(longest);
    expect(at(414, true) * NAME_LINES, "and not with the bell")
      .toBeLessThan(longest);
    /* Clipped, never overlapping — and the whole name stays in `title`. */
    expect(ROW_CODE).toContain("line-clamp-2 min-w-0");
    expect(ROW_CODE).toContain("title={figure.displayName}");
    expect(ROW_CODE).toContain('<span className="ml-auto flex shrink-0 items-center">');
  });

  it("a three-digit market value costs nothing any more", () => {
    /*
     * IT USED TO WRAP THE CHIP onto its own line at every phone width. The
     * 50 px the action column gave back, plus the shorter label, mean the
     * worst case now fits three times over.
     */
    for (const viewport of PHONE_WIDTHS) {
      const text = rowTextWidth(phoneRowWidth(viewport));
      expect(priceLineFits(text, AMOUNT_PX, OFFER_CHIP_COMPACT_PX), `${viewport}`).toBe(true);
      expect(rowHeight(1), "and the row does not grow for it").toBe(102);
    }
    /* The stack is as wide as its widest part, not as wide as both parts. */
    expect(marketBlockWidth(AMOUNT_PX)).toBe(AMOUNT_PX);
    expect(marketBlockWidth(AMOUNT_ORDINARY_PX)).toBe(MARKET_LABEL_PX);
  });

  it("a long offer price fits too, in both labels", () => {
    const narrowest = rowTextWidth(phoneRowWidth(360));
    /* The compact label on a phone … */
    expect(priceLineFits(narrowest, AMOUNT_PX, OFFER_CHIP_COMPACT_PX)).toBe(true);
    /* … and the long one, which only appears from `sm:` where the row is
       wider still. Checking it at 360 is the strict version of the test. */
    expect(priceLineFits(narrowest, AMOUNT_PX, OFFER_CHIP_PX)).toBe(true);
    expect(OFFER_CHIP_COMPACT_PX).toBeLessThan(OFFER_CHIP_PX);
    expect(OFFER_CHIP_PX - OFFER_CHIP_COMPACT_PX).toBe(54);
    /*
     * AND THE CHIP IS STILL THE LABEL AND NOTHING MORE. `OfferLink` carries
     * its own `px-1.5 sm:px-2`, so the row's wrapper adds none; the first
     * attempt added 8 px a side on top and pushed the chip to 133 px, which
     * wrapped the price line on every phone. Both widths are the label's.
     */
    expect(OFFER_CHIP_PX).toBe(OFFER_LABEL_PX);
    expect(OFFER_CHIP_COMPACT_PX).toBe(OFFER_LABEL_SHORT_PX + 16);
  });

  it("a figure with no offer keeps the quiet status, at the same edge", () => {
    /*
     * `OfferLink` renders a plain span with `de.shop.noOffer` and no surface
     * of its own; the row dresses the wrapper quietly instead of as a silver
     * action. Both states sit in the SAME wrapper, so the position cannot
     * differ between them — which is what "ebenfalls rechts ausrichten"
     * requires.
     */
    expect(ROW_CODE).toContain("group relative ml-auto inline-flex min-h-11 shrink-0 items-center");
    expect(ROW_CODE).toContain('"bg-deep/40 ring-1 ring-border/50"');
    /* One wrapper, two dresses: the ternary is inside it, not around it. */
    const wrapper = ROW_CODE.indexOf("group relative ml-auto inline-flex");
    const dress = ROW_CODE.indexOf("offered\n", wrapper);
    expect(dress).toBeGreaterThan(wrapper);
    expect(ROW_CODE.indexOf("{trade}")).toBeGreaterThan(dress);
  });

  it("collected and not collected differ in ground, never in geometry", () => {
    /*
     * THE GOLD IS UNCHANGED by UX-01D, and that is a requirement rather than
     * an accident: ownership is a ground, an edge, a glow and a diamond, and
     * none of the four takes any width or height. So an owned row and an
     * unowned one are the same size, and a list of ninety does not jump.
     */
    expect(rowHeight(1)).toBe(102);
    /*
     * SINCE UX-01E IT COSTS NOTHING AT ALL, which is the stronger version of
     * the same statement. The gold diamond took 11 px plus its gap off the
     * name on an owned row; it is gone, and ownership is now the ground, the
     * edge, the glow and a hidden sentence — none of which takes any width.
     * So an owned tile and an unowned one are identical in every dimension.
     */
    expect(OWNED_DIAMOND_PX).toBe(11); // what it used to cost
    expect(ROW_CODE).not.toContain("text-own-ink\">◆");
    expect(nameWidth(rowTextWidth(phoneRowWidth(360)))).toBe(145);
    expect(nameWidth(rowTextWidth(phoneRowWidth(360)), { withBell: true })).toBe(101);
    /* And the gold itself is still the three marks it was. */
    expect(ROW_CODE).toContain("bg-own-subtle/70 ring-1 ring-own-line-strong");
    expect(ROW_CODE).toContain("shadow-[0_0_18px_-8px_var(--own-line-strong)]");
    expect(ROW_CODE).toContain("text-own-ink");
  });

  it("and with the bell the bar takes its 44 px from the name, not from the row", () => {
    const text = rowTextWidth(phoneRowWidth(360));
    expect(nameWidth(text, { withBell: true })).toBe(nameWidth(text) - ROW.touch);
    expect(nameWidth(text, { withBell: true })).toBeGreaterThan(0);
    /*
     * Still a readable name at the narrowest width with three marks: twelve
     * characters a line, twenty-four over two, which is more than nine
     * catalogue names in ten. The bell costs six characters a line at 360 px,
     * and that number is the price of showing it — stated here so it is a
     * decision and not a surprise.
     */
    expect(nameCharsPerLine(nameWidth(text, { withBell: true }))).toBe(12);
    expect(nameCharsPerLine(nameWidth(text))).toBe(18);
    /* And no height anywhere. */
    expect(rowHeight(1)).toBe(102);
  });
});

describe("the offer says less on a phone, and the card is untouched", () => {
  const OFFER_SRC = read("src/components/shop/offer-link.tsx");
  /* On the CODE for the "no hook" assertions: the header explains at length
     why a media-query hook is the wrong tool, and naming the thing you are
     not using is allowed. */
  const OFFER_CODE = code(OFFER_SRC);
  const CARD_SRC = code(read("src/components/catalog/catalog-card.tsx"));

  it("the short label exists in the dictionary, beside the long one", () => {
    expect(de.shop.offersFromLabel).toBe("Angebote ab");
    expect(de.shop.offerFromLabel).toBe("ab");
    /* Nine characters less — which is the 54 px the arithmetic spends. */
    expect(de.shop.offersFromLabel.length - de.shop.offerFromLabel.length).toBe(9);
  });

  it("CSS picks the label, not JavaScript", () => {
    /*
     * BOTH WORDS ARE IN THE MARKUP. `OfferLink` renders on the server; a
     * media-query hook would make it a client component and give it a first
     * paint with the wrong label. So the short one is hidden from `sm:` up
     * and the long one below it, and nothing re-renders.
     */
    expect(OFFER_SRC).toContain('<span className="sm:hidden">{de.shop.offerFromLabel}</span>');
    expect(OFFER_SRC).toContain('<span className="hidden sm:inline">{de.shop.offersFromLabel}</span>');
    expect(OFFER_CODE).not.toContain("useMediaQuery");
    expect(OFFER_CODE).not.toContain("matchMedia");
    expect(OFFER_CODE).not.toContain('"use client"');
  });

  it("only the row asks for it, and the card cannot get it by accident", () => {
    /*
     * ONE CALL SITE AND ONE CONDITION. `CatalogCard` is the only thing that
     * builds this node and the only thing that knows `layout`, so the
     * decision belongs there — and `compact` defaults to false, which is why
     * every other consumer (`collection-action.tsx`, the figure page's panel)
     * keeps exactly what it rendered before.
     */
    expect(CARD_SRC).toContain('compact={layout === "row"}');
    expect(OFFER_SRC).toContain("compact = false,");
    const others = ["src/components/collection/collection-action.tsx",
                    "src/components/catalog/figure-card.tsx"];
    for (const file of others) {
      expect(code(read(file)), `${file} must not pass compact`).not.toContain("compact");
    }
  });

  it("and it changes the LABEL only — never the link or the offers", () => {
    /*
     * The destination, the accessible name, the price, the chevron, the
     * quick-view interception and the `data-perf` marker are outside the
     * branch. A test rather than a promise, because this component decides
     * what a visitor is told something costs.
     */
    const branch = OFFER_SRC.slice(
      OFFER_SRC.indexOf("{compact ? ("),
      OFFER_SRC.indexOf("<span className=\"font-bold tabular-nums\">"),
    );
    for (const outside of ["href=", "aria-label", "onClick", "data-perf",
                           "formatPrice", "summarizeOffers", "v1Buyable"]) {
      expect(branch, `${outside} must not be inside the label branch`)
        .not.toContain(outside);
    }
    expect(OFFER_SRC).toContain("aria-label={de.shop.offersFor(name)}");
  });
});
