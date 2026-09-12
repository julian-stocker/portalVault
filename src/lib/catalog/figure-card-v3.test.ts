import { describe, expect, it } from "vitest";
import { readFileSync, statSync } from "node:fs";

import {
  CARD_CANVAS,
  GRID_AREAS,
  GRID_ROWS,
  INSET,
  LAYOUT_DEBUG,
  ROWS,
  TEMPLATE,
  WINDOW_FILL,
} from "@/lib/catalog/card-template";
import { marksOwnership } from "@/lib/catalog/card";
import { buyableOffers, summarizeOffers, type Offer } from "@/lib/shop/offer";

/**
 * FigureCard V3.3 — the card is a picture.
 *
 * `designs/cards/silver.png` and `gold.png` are finished artwork with a real
 * alpha channel: frame, paper, gold, crown, silver plate. The component draws
 * none of it. These tests hold the two things that break silently when it
 * drifts back:
 *
 *   1. NOTHING IS PAINTED TWICE. A CSS gold frame under a gold PNG is a
 *      double frame, and nobody notices until the assets change.
 *   2. THE TWO TEMPLATES SHARE ONE COORDINATE SYSTEM. They are 1024 × 1536
 *      each and their zones differ by at most 6 px; collecting a figure must
 *      change the surface and move nothing.
 */
const CARD = "src/components/catalog/figure-card.tsx";
const CATALOG_CARD = "src/components/catalog/catalog-card.tsx";
const SEAL = "src/components/catalog/variant-seal.tsx";
const LINK = "src/components/shop/offer-link.tsx";
const TOOL = "tools/build-card-templates.mts";

const source = (path: string) => readFileSync(path, "utf8");
const code = (path: string) =>
  source(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/^\s*\/\/.*$/gm, "");

/** The INFO block alone: from its own style up to where the meta row starts. */
function infoBlock(card: string): string {
  const from = card.indexOf("at(INFO)");
  const to = card.indexOf("pointer-events-none absolute flex items-center", from);
  expect(from, "the info block is missing").toBeGreaterThan(-1);
  expect(to, "the meta row is missing").toBeGreaterThan(from);
  return card.slice(from, to);
}

const offer = (o: Partial<Offer> = {}): Offer => ({
  skyId: "SKY-0001",
  condition: "loose",
  price: 4.49,
  available: true,
  ...o,
});

/** Percent strings back to numbers, for arithmetic on the zones. */
const num = (s: string) => Number.parseFloat(s);

// ---------------------------------------------------------------------------

describe("the shipped templates", () => {
  it.each(["silver", "gold"])("%s exists in two widths", (name) => {
    for (const file of [`public/images/cards/${name}.webp`, `public/images/cards/${name}-sm.webp`]) {
      expect(statSync(file).size, `${file} is missing or empty`).toBeGreaterThan(1000);
    }
  });

  it.each(["silver", "gold"])("%s is small enough to ship 561 times", (name) => {
    // The sources are ~1.8 MB each. A catalog page renders up to 561 cards,
    // so what ships has to be a fraction of that.
    expect(statSync(`public/images/cards/${name}.webp`).size).toBeLessThan(120_000);
    expect(statSync(`public/images/cards/${name}-sm.webp`).size).toBeLessThan(60_000);
  });

  it("the build tool refuses assets that would not line up", () => {
    const tool = source(TOOL);
    expect(tool).toContain("both templates must be");
    expect(tool).toContain("has no alpha channel");
    // No keying, no cropping: the sources are finished artwork.
    expect(code(TOOL)).not.toMatch(/extract|trim|flatten|removeAlpha/);
  });

  it("the sources stay out of the repository", () => {
    const ignore = source(".gitignore");
    expect(ignore).toContain("/designs/cards/");
    expect(ignore).toContain("/designs/artwork/");
  });
});

describe("nothing the artwork already paints is painted again", () => {
  const card = code(CARD);

  it.each([
    ["a card frame", /ring-\[3px\]|outline-\[#8a6a45\]|border-own/],
    ["the gold ground", /own-ground|card-owned|bg-\[image:var\(--own/],
    ["the struck frame", /shadow-gold|own-frame/],
    ["the sparkle layer", /gold-sparkle|after:bg-\[image/],
    ["a CSS crown", /CollectedCrown|crown/i],
    ["an image plate or its ring", /bg-plate|ring-border|rounded-sky-md/],
    ["a seam above the trade row", /border-t|border-trade-line|border-own-ink\/30/],
  ])("does not draw %s", (_, pattern) => {
    expect(card).not.toMatch(pattern);
  });

  it("the CSS crown component is gone rather than unused", () => {
    expect(() => statSync("src/components/catalog/collected-crown.tsx")).toThrow();
  });

  it("and the CSS surfaces are gone from the model", () => {
    // Against stripped code: the comment left in their place explains what
    // they were and why they went, and names them while doing it.
    const model = code("src/lib/catalog/card.ts");
    expect(model).not.toContain("cardSurfaceClass");
    expect(model).not.toContain("OWNED_SURFACE");
    expect(model).not.toContain("NEUTRAL_SURFACE");
  });
});

describe("possession is the whole card", () => {
  it("gold when it is yours, silver when it is not", () => {
    expect(TEMPLATE.owned.src).toContain("gold");
    expect(TEMPLATE.plain.src).toContain("silver");
    expect(code(CARD)).toContain("owned ? TEMPLATE.owned : TEMPLATE.plain");
  });

  it("still only the catalog asks the question", () => {
    expect(marksOwnership("catalog", true)).toBe(true);
    expect(marksOwnership("showcase", true)).toBe(false);
  });

  it("says it in words as well, for anyone the gold does not reach", () => {
    const card = code(CARD);
    expect(card).toContain("de.catalog.collectedBadge");
    // Forced colours and a screen that renders gold as grey both survive this.
    expect(card).toMatch(/owned \? \(/);
  });

  it("and the copies count still works on top of it", () => {
    expect(code(CARD)).toContain("de.collection.copies(copies)");
  });
});

describe("one row grid, measured off the artwork", () => {
  it("the canvas is the render box, so the gold glow is not clipped", () => {
    expect(CARD_CANVAS).toEqual({ width: 1024, height: 1536 });
    expect(code(CARD)).toContain("aspectRatio: CARD_ASPECT");
  });

  it("the rows sum to exactly the card", () => {
    /*
     * The whole point. Nine bands that account for 100 % of the height means
     * a slot cannot drift and a long name cannot push anything below it —
     * there is no leftover for it to push into.
     */
    const total = ROWS.reduce((sum, r) => sum + r.height, 0);
    expect(Math.abs(total - 100)).toBeLessThan(0.01);
  });

  it("runs top to bottom in the order the card reads", () => {
    expect(ROWS.map((r) => r.area)).toEqual([
      "frame-top",
      "image",
      "pad",
      "name",
      "market",
      "sep",
      "meta",
      "trade",
      "frame-bottom",
    ]);
  });

  it("lands on the bands the templates paint", () => {
    // Cumulative tops, against the measurements taken off the two PNGs.
    const top: Record<string, number> = {};
    let y = 0;
    for (const r of ROWS) {
      top[r.area] = y;
      y += r.height;
    }
    // image window: y 114–775 of 1536
    expect(top.image).toBeCloseTo((114 / 1536) * 100, 1);
    // the painted diamond rule: y 1136–1148
    expect(top.sep).toBeCloseTo((1136 / 1536) * 100, 1);
    expect(top.meta).toBeCloseTo((1148 / 1536) * 100, 1);
    // the silver plate: y 1267–1406
    expect(top.trade).toBeCloseTo((1267 / 1536) * 100, 1);
    expect(top["frame-bottom"]).toBeCloseTo((1406 / 1536) * 100, 1);
  });

  it("is expressed in percent, never in pixels", () => {
    expect(GRID_ROWS).toMatch(/^[\d.% ]+$/);
    expect(GRID_ROWS).not.toMatch(/px|rem|em/);
  });

  it("names every row, so a slot is placed and never positioned", () => {
    for (const r of ROWS) expect(GRID_AREAS).toContain(`"${r.area}"`);
  });

  it("the two empty rows exist as rows rather than as margins", () => {
    /*
     * `pad` is the air under the window and `sep` is where the ornament is
     * painted. Reserving them is what keeps text off the diamond — a margin
     * could be overridden, a row cannot be occupied by accident.
     */
    const card = code(CARD);
    expect(card).toContain('<Slot area="pad" />');
    expect(card).toContain('<Slot area="sep" />');
  });

  it("side insets come from the artwork too, not from taste", () => {
    for (const value of Object.values(INSET)) expect(value).toMatch(/^\d+(\.\d+)?%$/);
    // The window is wider than the text field; the plate is wider than both.
    expect(parseFloat(INSET.image)).toBeLessThan(parseFloat(INSET.text));
    expect(parseFloat(INSET.trade)).toBeLessThan(parseFloat(INSET.text));
  });
});

describe("nothing is positioned by hand any more", () => {
  const card = code(CARD);

  it("no slot carries a vertical margin", () => {
    // The row decides where a slot is. A margin would be a second opinion.
    expect(card).not.toMatch(/\bmt-\[/);
    expect(card).not.toMatch(/\bmb-\[/);
    expect(card).not.toMatch(/\bmt-auto\b/);
  });

  it("nothing distributes space down the page", () => {
    expect(card).not.toContain("justify-between\n");
    expect(card).not.toContain("flex-1");
    expect(card).not.toContain("grow");
  });

  it("a slot clips rather than stretching its row", () => {
    // `min-h-0` on every one: a fixed row would otherwise be pushed open by
    // content that does not fit, which is the failure this grid prevents.
    expect(card).toContain("min-h-0");
  });

  it("every slot is addressable, for the debug mode and for a test", () => {
    expect(card).toContain("data-slot={area}");
    expect(card).toContain("gridArea: area");
  });
});

describe("the layout debug mode", () => {
  const css = readFileSync("src/app/globals.css", "utf8");

  it("is off, so production markup is unchanged", () => {
    expect(LAYOUT_DEBUG).toBe(false);
    // The attribute is absent rather than false — nothing to match on.
    expect(code(CARD)).toContain('LAYOUT_DEBUG ? "" : undefined');
  });

  it("paints every slot a different colour", () => {
    for (const area of ["image", "name", "market", "meta", "trade"]) {
      expect(css, `${area} has no debug colour`).toContain(`[data-slot="${area}"]`);
    }
  });

  it("marks the two rows that must stay empty differently", () => {
    expect(css).toContain('[data-slot="pad"]');
    expect(css).toContain('[data-slot="sep"]');
    expect(css).toContain("repeating-linear-gradient");
  });

  it("applies only under the attribute", () => {
    const block = css.slice(css.indexOf("FigureCard layout debugging"));
    for (const line of block.split("\n")) {
      if (line.trim().startsWith("[data-slot")) {
        expect(line, "a debug rule escapes the attribute").toContain("data-card-layout-debug");
      }
    }
  });
});

describe("the figure sits behind the window", () => {
  const card = code(CARD);

  it("is drawn before the template, so the artwork clips it", () => {
    expect(card.indexOf("object-contain")).toBeLessThan(card.indexOf("srcSet"));
  });

  it("is contained, never cropped to the frame", () => {
    expect(card).toContain("object-contain");
    expect(card).not.toContain("object-cover");
  });

  it("the template cannot swallow a tap meant for the card", () => {
    expect(card).toContain("pointer-events-none absolute inset-0");
  });

  it("a figure without a picture leaves the window empty, not broken", () => {
    expect(card).toContain("de.catalog.noImage");
  });
});

describe("every element lives in its own slot", () => {
  const card = code(CARD);

  it.each([
    ["image", "the figure, the seal, the status chip, the copies count"],
    ["name", "up to two lines, and nothing else"],
    ["market", "the label and the price"],
    ["meta", "ownership and element"],
    ["trade", "the silver plate"],
  ])("%s is a named slot", (area) => {
    expect(card).toContain(`<Slot area="${area}"`);
  });

  it("the name is centred in its row, so two lines move nothing", () => {
    const name = card.slice(card.indexOf('<Slot area="name"'), card.indexOf('<Slot area="market"'));
    expect(name).toContain("items-center");
    expect(name).toContain("line-clamp-2");
    expect(name).toContain("text-center");
  });

  it("the market block sits at the foot of its row, above the ornament", () => {
    const market = card.slice(card.indexOf('<Slot area="market"'), card.indexOf('<Slot area="meta"'));
    expect(market).toContain("justify-end");
    expect(market).toContain("gap-[4%]");
    expect(market).toContain("text-center");
    // The number is the dominant figure on the card and may never break.
    expect(market).toContain("whitespace-nowrap");
    expect(market).toContain("tabular-nums");
  });

  it("the meta row is two columns that cannot overlap", () => {
    /*
     * `minmax(0, 1fr) auto`: the ownership column may shrink to nothing, the
     * element never does. Whatever the card's width, the two cannot run into
     * each other — the type shrinks with the card instead.
     */
    const meta = card.slice(card.indexOf('<Slot area="meta"'), card.indexOf("const bodyClass"));
    expect(meta).toContain('gridTemplateColumns: "minmax(0, 1fr) auto"');
    expect(meta).toContain("items-center");
    expect((meta.match(/whitespace-nowrap/g) ?? []).length).toBe(2);
  });

  it("the trade slot is a sibling of the body, so it is its own target", () => {
    expect(card.indexOf('<Slot area="trade"')).toBeGreaterThan(card.indexOf("</Link>"));
    expect(card).not.toContain("stopPropagation");
  });

  it("only the name and the price hold their size", () => {
    /*
     * Everything else steps back once. Hierarchy: price > name > meta >
     * label — the label is the quietest thing on the card because the price
     * is the loudest.
     */
    expect(card).toContain("clamp(9px,6.2cqw,15px)");  // name
    expect(card).toContain("clamp(11px,7cqw,16px)");   // price
    expect(card).toContain("clamp(7px,4.1cqw,9.5px)"); // label
    expect(card).toContain("clamp(8px,4.6cqw,10.5px)"); // meta
    expect((code(LINK).match(/clamp\(9px,4\.8cqw,11px\)/g) ?? []).length).toBe(2);
  });

  it("the label is quieter than the price it labels", () => {
    const market = card.slice(card.indexOf('<Slot area="market"'), card.indexOf('<Slot area="meta"'));
    expect(market).toContain("text-template-ink-muted");
    expect(market).toContain("clamp(11px,7cqw,16px)");
  });

  it("type scales with the CARD, not with the viewport", () => {
    /*
     * The grid is four columns from 768 px and five from 1280 px, where a
     * card is as narrow as on a phone. A viewport breakpoint would have given
     * it desktop type.
     */
    expect(card).toContain("@container");
    expect(card).not.toMatch(/sm:text-\[/);
  });

  it("no SIZE is expressed in `em`, which resolves against the wrong thing", () => {
    /*
     * Two exemptions, both correct and both RELATIVE TO THEIR OWN ELEMENT:
     * `tracking-[0.1em]` spaces type by its own size, and `text-[0.8em]` on
     * the ownership bullet keeps it proportional to the words it marks. What
     * broke the old layout was `em` used for a BOX, where it silently meant
     * the inherited 16 px.
     */
    const boxes = [...card.matchAll(/(?:h|w|mt|mb|gap)-\[[^\]]*em\]/g)];
    expect(boxes.map((m) => m[0])).toEqual([]);
    expect(card).not.toContain("calc(2 * 1.15em)");
  });

  it("both trade states stay on one line", () => {
    const link = code(LINK);
    expect((link.match(/whitespace-nowrap/g) ?? []).length).toBe(2);
    expect(link).toContain("px-1.5 sm:px-2");
    // The plate's label must never be cut: the padding gives way instead.
    expect(link).not.toContain("truncate");
  });
});

describe("normal card information is black", () => {
  const card = code(CARD);

  it.each([
    ["the name", /sortBaseName[\s\S]{0,10}/],
    ["the market value label", /marketValue/],
    ["the market value", /formatPrice\(figure\.marketPrice\)/],
  ])("%s is on the card", (_, pattern) => {
    expect(card).toMatch(pattern);
  });

  it("every normal fact uses one ink, and it is near-black", () => {
    // 14.8:1 on both templates. `--on-card` is a warm brown-black made for
    // the ivory panels; on printed paper a warm ink reads as faded.
    /*
     * Three places: the name, the value itself, and the meta slot — which
     * carries the ink for both of its columns rather than repeating it.
     *
     * The MARKTWERT label is deliberately NOT among them — it is a label, not
     * a statement, and it carries the muted ink so the price above it can be
     * the loudest thing on the card.
     */
    const inks = [...card.matchAll(/text-template-ink(?!-)/g)];
    expect(inks.length).toBe(3);
  });

  it("carries no hardcoded card colours any more", () => {
    expect(card).not.toMatch(/text-\[#[0-9a-f]{6}\]/i);
  });

  it("keeps muted only where a state is genuinely secondary", () => {
    /*
     * Three: the MARKTWERT label, a price nobody knows, and a figure with no
     * photograph. The label is muted by intent rather than by state — it is
     * the quietest thing on the card because the price is the loudest.
     */
    const muted = [...card.matchAll(/text-template-ink-muted/g)];
    expect(muted.length).toBe(3);
  });

  it("the element is named rather than coloured", () => {
    // ADR-0034 always required the word; the colour was never the carrier.
    expect(card).toContain("elementLabel(figure.element)");
    expect(card).not.toContain("elementChipClass");
  });

  it("the same ink on the gold card and the plain one", () => {
    /*
     * One branch decides the TEMPLATE; none decides an ink. `owned` may pick
     * WHETHER a line appears — the ownership line does — but never which
     * colour it is written in.
     */
    expect(card).not.toMatch(/owned \?\s*"[^"]*text-[^"]*"\s*:/);
    expect(card).not.toMatch(/owned \?\s*"text-/);
  });

  it("the seal and the plate keep their own", () => {
    // Explicitly out of scope: the variant seal has its two dark plates, and
    // the trade row inks the silver.
    expect(code(SEAL)).toMatch(/#f3e6c8|#ded7e8/);
    expect(code(LINK)).toContain("#39424d");
  });
});

describe("the variant seal", () => {
  it("reads the label that already exists and derives nothing", () => {
    expect(code(CARD)).toContain("figure.sortVariantLabel");
    expect(code(SEAL)).not.toMatch(/parseVariant|startsWith|split/);
  });

  it("is never gold — rarity must not read as possession", () => {
    expect(code(SEAL)).not.toMatch(/own-ink|gold|accent|brand/);
  });

  it("lets the name be the figure's own", () => {
    expect(code(CARD)).toContain("{figure.sortBaseName}");
    expect(code(CARD)).toContain("title={figure.displayName}");
  });

  it("loses no semantic information by taking the finish out of the name", () => {
    /*
     * Checked before removing it, as asked. The finish still reaches every
     * consumer that needs it:
     *
     *   search      `searchIndex` is built from searchFormsFor(name, variant)
     *   a11y        the figure's `alt` carries the full displayName
     *   tooltip     `title` on the name line
     *   elsewhere   detail page, collection table, admin, the offer link's
     *               accessible name — all still use displayName
     */
    expect(source("src/lib/catalog/queries.ts")).toContain("searchFormsFor(figure.name, variant)");
    expect(code(CARD)).toContain("alt={figure.displayName}");
    expect(code(CATALOG_CARD)).toContain("name={figure.displayName}");
  });

  it("and is decorative to a screen reader, because the alt already says it", () => {
    // Otherwise the finish is read twice between the picture and the name.
    expect(code(SEAL)).toContain('aria-hidden="true"');
  });
});

describe("market value and offer price are two different things", () => {
  it("the market value is labelled, so the two numbers cannot merge", () => {
    const card = code(CARD);
    expect(card).toContain("de.catalog.marketValue");
    expect(card).toContain("formatPrice(figure.marketPrice)");
  });

  it("the market value is in the market row and the offer is on the plate", () => {
    const card = code(CARD);
    expect(card.indexOf("marketValue")).toBeGreaterThan(card.indexOf('<Slot area="image"'));
    expect(card.indexOf('<Slot area="trade"')).toBeGreaterThan(card.indexOf("marketValue"));
  });

  it("the card states no offer price of its own", () => {
    // Only `OfferLink` may — it is the one thing that knows what an offer is.
    expect(code(CARD)).not.toContain("summarizeOffers");
  });
});

describe("the trade zone", () => {
  it("is seller-neutral: it names the offers, never the seller", () => {
    const link = code(LINK);
    expect(link).toContain("de.shop.offersFrom");
    expect(link).not.toMatch(/seller|yulez|vendor|merchant/i);
  });

  it("leads to the figure's offers and sells nothing from the grid", () => {
    const link = code(LINK);
    expect(link).toContain("#angebote");
    expect(link).not.toMatch(/addOne|useAddToCart|useCart/);
    expect(code(CATALOG_CARD)).not.toContain("ShopAction");
  });

  it("says so quietly when there is nothing on offer", () => {
    expect(summarizeOffers([])).toEqual({ kind: "none" });
    expect(summarizeOffers([offer({ available: false })])).toEqual({ kind: "none" });
    const link = code(LINK);
    expect(link).toContain("de.shop.noOffer");
    // Quiet by weight and size, never by contrast: it still reads 5.4:1.
    expect(link).not.toMatch(/opacity-[1-5]0\b/);
  });

  it("shows the cheapest buyable price, whatever the conditions are", () => {
    expect(
      summarizeOffers([offer({ price: 9 }), offer({ condition: "boxed", price: 4.49 })]),
    ).toMatchObject({ price: 4.49 });
    // A sold-out cheaper line must not set the "ab" price.
    expect(
      summarizeOffers([offer({ price: 1, available: false }), offer({ condition: "boxed", price: 8 })]),
    ).toMatchObject({ price: 8 });
    expect(buyableOffers([offer({ available: false })])).toEqual([]);
  });

  it("is a sibling of the body, so it is its own target", () => {
    const card = code(CARD);
    expect(card.indexOf("{trade}")).toBeGreaterThan(card.indexOf("</Link>"));
    expect(card).not.toContain("stopPropagation");
  });
});

describe("the geometry rule still holds", () => {
  it("every card is the same shape, offer or no offer", () => {
    const card = code(CARD);
    // The plate is a ROW of the grid, so its box cannot depend on what is in
    // it — and the row exists whether `trade` is passed or not.
    expect(card).not.toMatch(/trade \? </);
    expect(card).toContain('<Slot area="trade"');
    expect(ROWS.some((r) => r.area === "trade")).toBe(true);
  });

  it("a failure notice cannot change the card's height", () => {
    // It is drawn over the window, not appended under the card.
    expect(code(CARD)).toContain("{notice}");
    expect(code(CATALOG_CARD)).toContain("absolute inset-x-1 bottom-1");
  });

  it("the deep-link highlight is kept, and borrows neither metal", () => {
    const card = code(CARD);
    expect(card).toContain("outline-nav-active-ink");
    expect(card).not.toMatch(/highlighted \?[^:]*(own-ink|trade)/);
  });
});
