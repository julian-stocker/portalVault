import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";

import {
  CARD_ARTWORK,
  CARD_CANVAS,
  GRID_AREAS,
  GRID_ROWS,
  INSET,
  LAYOUT_DEBUG,
  ROWS,
  WINDOW_FILL,
} from "@/lib/catalog/card-template";
import { marksOwnership } from "@/lib/catalog/card";
import { v1BuyableOffers, summarizeOffers, type Offer } from "@/lib/shop/offer";

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
  const SHIPPED = ["card", "special", "elite", "dark", "legendary", "chase", "prestige", "collected"];

  it.each(SHIPPED)("%s exists in two widths", (name) => {
    for (const file of [`public/images/cards/${name}.webp`, `public/images/cards/${name}-sm.webp`]) {
      expect(statSync(file).size, `${file} is missing or empty`).toBeGreaterThan(1000);
    }
  });

  it.each(SHIPPED)("%s is small enough to ship 561 times", (name) => {
    // The sources are 1.3–2.4 MB each. A catalog page renders up to 561 cards,
    // so what ships has to be a fraction of that.
    expect(statSync(`public/images/cards/${name}.webp`).size).toBeLessThan(200_000);
    expect(statSync(`public/images/cards/${name}-sm.webp`).size).toBeLessThan(90_000);
  });

  it("ships nothing from the architectures that were abandoned", () => {
    /*
     * Three generations of ownership artwork left files behind: `silver`/`gold`
     * (ownership as the whole card, pre-V3.5), `collection` (one overlay
     * artwork for every type), and the `*.collected` pairs (a second full card
     * per type). All three are gone; only the six cards and one overlay remain.
     */
    for (const gone of [
      "silver", "gold", "collection",
      "card.collected", "special.collected", "dark.collected",
      "legendary.collected", "chase.collected", "prestige.collected",
    ]) {
      for (const suffix of [".webp", "-sm.webp"]) {
        expect(
          existsSync(`public/images/cards/${gone}${suffix}`),
          `${gone}${suffix} is still shipped`,
        ).toBe(false);
      }
    }
    const shipped = readdirSync("public/images/cards");
    expect(shipped.sort()).toEqual(
      SHIPPED.flatMap((n) => [`${n}-sm.webp`, `${n}.webp`]).sort(),
    );
  });

  it("the build tool refuses assets that would not line up", () => {
    const tool = source(TOOL);
    expect(tool).toContain("every template must be");
    expect(tool).toContain("has no alpha channel");
    /*
     * And, since V3.6, an artwork whose window is not actually see-through.
     * A `special.png` arrived at exactly the right size with the design tool's
     * transparency checkerboard flattened into the pixels; the only check at
     * the time was the size, so it passed.
     *
     * `extract` is what reads those regions. It is a measurement, not an
     * edit — the assertion below is that nothing WRITES a modified pixel:
     * no crop, no key, no flatten, no alpha thrown away.
     */
    expect(tool).toContain("the image window is only");
    expect(tool).toContain("is not cut out of its background");
    expect(code(TOOL)).not.toMatch(/\.trim\(|flatten\(|removeAlpha\(/);
    expect(code(TOOL)).not.toMatch(/\.extract\([^)]*\)\s*\.toFile/);
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
  it("the figure's own card, and an overlay when it is yours", () => {
    /*
     * V3.5 split one axis into two. The gold/silver pair said "yours" and
     * "not yours" and nothing about the figure; now the artwork says what the
     * collectible IS, and ownership overrides it without writing to it.
     */
    /*
     * V3.5 split one axis into two: the artwork says what the collectible IS,
     * and ownership is shown on top of it. V3.6 finished the job — ownership
     * cannot reach the artwork at all now, because `artworkFor` no longer
     * takes a viewer.
     */
    expect(CARD_ARTWORK.standard.src).toContain("card.webp");
    expect(code(CARD)).toContain("const template = artworkFor(figure.cardType);");
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
    // V3.5: the six new artworks are 1007×1562, a different ratio rather
    // than a rescale, and the canvas moved to them.
    expect(CARD_CANVAS).toEqual({ width: 1007, height: 1562 });
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

  it("keeps the rows in a plausible order against the artwork", () => {
    /*
     * This used to pin cumulative tops against pixel rows measured off
     * `silver.png` and `gold.png` — y 114, 1136, 1148, 1267, 1406 of 1536.
     * Those two are not the artwork any more: V3.5 replaced them with six
     * files on a 1007×1562 canvas of a different ratio, and fix round 1
     * deliberately moved `meta` and `trade` down.
     *
     * The painted bands of the new artworks have NOT been measured — the
     * operator asked for one small correction and a look in the browser
     * before anything is pinned. Asserting the old numbers would have been
     * asserting a canvas that no longer exists, and inventing new ones would
     * be worse.
     *
     * What is checked is what is actually known: the window is in the upper
     * half, the trade row clears the bottom ornament, and nothing overlaps.
     */
    const top: Record<string, number> = {};
    let y = 0;
    for (const r of ROWS) { top[r.area] = y; y += r.height; }

    expect(top.image).toBeGreaterThan(5);
    expect(top.image + 43).toBeLessThan(55);          // window ends before mid-card
    expect(top.name).toBeGreaterThan(top.image);
    expect(top.market).toBeGreaterThan(top.name);
    expect(top.meta).toBeGreaterThan(top.market);
    expect(top.trade).toBeGreaterThan(top.meta);
    // The bottom ornament of every new artwork begins around 96 %.
    expect(top.trade + 9.05).toBeLessThan(95);
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

  it("still reaches every grid layer, so the tool survives being switched off", () => {
    /*
     * The card draws three grid layers on one set of measurements. Two of
     * them sit ON the artwork and hold the slots the debug mode paints — the
     * decorative one and the interactive one — and both have to carry the
     * attribute: asserting that it merely appears somewhere would pass with
     * one of the two silently dropped, leaving half the card unpainted the
     * next time someone needs the tool.
     *
     * The third is the picture layer BEHIND the artwork. It is deliberately
     * unmarked: its only slot is `image`, whose band the decorative layer
     * already paints on exactly the same geometry, and painting it twice
     * would tint the figure rather than the slot.
     */
    const card = code(CARD);
    const overlays = card.match(/pointer-events-none absolute inset-0 grid/g) ?? [];
    const marked = card.match(/data-card-layout-debug=\{LAYOUT_DEBUG \? "" : undefined\}/g) ?? [];
    expect(overlays).toHaveLength(2);
    expect(marked).toHaveLength(overlays.length);
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
    ["the name", /\{figure\.displayName\}/],
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
    expect(code(LINK)).toMatch(/#[0-9a-f]{6}/);
  });
});

describe("the trade row separates its two states by contrast (V3.2)", () => {
  /**
   * A wall of cards has to say at a glance which figure can be bought. Both
   * states used to share one ink at one weight, so it did not.
   *
   * They are separated by contrast, not by colour: silver stays silver,
   * because gold means ownership and a buyable offer is not something you own
   * (V3.1). Measured against the plate the artwork actually paints, sampled
   * from both templates at the trade band.
   */
  const PLATE = { silver: "#c2c8cd", gold: "#bec2c8" } as const;

  function luminance(hex: string): number {
    const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const [r, g, b] = channels.map((v) =>
      v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
    );
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function contrast(a: string, b: string): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  }

  /** The two inks, read out of the component rather than restated here. */
  /*
   * The two inks became CSS variables in V3.6 so the card can swap them on
   * dark stock — `var(--trade-ink, #11161c)`. The literal is still there as
   * the fallback, and it is still what paints on the four light artworks and
   * in `collection-action.tsx`, where no card defines the variable.
   */
  function ink(name: "INK_QUIET" | "INK_OFFER"): string {
    const match = code(LINK).match(
      new RegExp(`export const ${name} = "var\\(--trade-ink[a-z-]*, (#[0-9a-f]{6})\\)"`),
    );
    expect(match, `${name} is missing or no longer carries a literal fallback`).not.toBeNull();
    return match![1];
  }

  /** A token's value, read from the stylesheet that declares it. */
  function token(name: string): string {
    const match = readFileSync("src/app/globals.css", "utf8").match(
      new RegExp(`--${name}:\\s*(#[0-9a-f]{6});`),
    );
    expect(match, `--${name} is not declared`).not.toBeNull();
    return match![1];
  }

  /**
   * THE TEST THAT WOULD HAVE CAUGHT THE BUG.
   *
   * The old assertions found `#11161c` in the file and passed while the
   * browser painted the text near-white. Finding a hex in a source file says
   * nothing about whether the colour reaches the element: a class only paints
   * if its rule arrives, and a card on a dark page inherits near-white when
   * none does.
   *
   * So the colour is carried as an inline style now, and these check that —
   * that the value is applied on the very element that renders the text, by a
   * mechanism that needs nothing generated and outranks every stylesheet rule
   * short of `!important`.
   */
  it("applies both inks as inline styles, not as classes", () => {
    const link = code(LINK);
    expect(link).toContain("style={{ color: INK_OFFER }}");
    expect(link).toContain("style={{ color: INK_QUIET }}");
    // The class form is what failed; it must not come back alongside.
    expect(link).not.toMatch(/text-\[#[0-9a-f]{6}\]/);
  });

  it("puts the style on the element that renders the text", () => {
    const link = code(LINK);
    for (const state of ["INK_QUIET", "INK_OFFER"]) {
      const at = link.indexOf(`style={{ color: ${state} }}`);
      expect(at, `${state} is not applied`).toBeGreaterThan(-1);
      // The opening tag it belongs to, and the text it wraps, are the same
      // element: the style sits before the `>` that closes that tag.
      const tagEnd = link.indexOf(">", at);
      const nextTagStart = link.indexOf("<", at);
      expect(tagEnd, `${state} must close its own tag first`).toBeLessThan(nextTagStart);
    }
  });

  it("has no ancestor in the card forcing a colour onto the trade slot", () => {
    /*
     * A colour on the slot or on the grid above it would be inherited by
     * anything that did not set its own — which is how near-white got in.
     *
     * The slicing is fiddly and was wrong once: the card has TWO elements
     * carrying `pointer-events-none absolute inset-0 grid` — layer three
     * inside the body, and the sibling grid that owns the trade row — and
     * `indexOf` found the first. The closing tag was then searched from the
     * start of the string, landed BEFORE the trade row, and produced an empty
     * slice that asserted nothing. `lastIndexOf` takes the sibling grid, and
     * the closing tag is searched forward from the opening one.
     */
    const card = code(CARD);
    const gridAt = card.lastIndexOf("pointer-events-none absolute inset-0 grid");
    const sibling = card.slice(gridAt);
    const openAt = sibling.indexOf('area="trade"');
    expect(openAt, "the trade row is not in the sibling grid").toBeGreaterThan(-1);

    const tradeSlot = sibling.slice(openAt, sibling.indexOf("</Slot>", openAt));
    // Not empty, or the assertions below hold nothing.
    expect(tradeSlot.length).toBeGreaterThan(20);
    expect(tradeSlot).not.toMatch(/text-(white|on-deep|foreground)/);
    expect(tradeSlot).not.toMatch(/text-\[#/);

    // And the grid itself, between its opening tag and the trade row.
    const gridTag = sibling.slice(0, sibling.indexOf(">"));
    expect(gridTag).not.toMatch(/text-(white|on-deep|foreground)/);
  });

  it("writes a buyable offer in near-black, well past AA", () => {
    for (const plate of Object.values(PLATE)) {
      expect(contrast(ink("INK_OFFER"), plate)).toBeGreaterThanOrEqual(7);
    }
  });

  it("clears AA on both plates — 'no offer' is readable, not dimmed away", () => {
    /*
     * The gold template is the owned card and its plate is three points
     * darker (#bec2c8 against #c2c8cd), so it is the one the floor has to
     * hold on. Both are checked.
     */
    for (const plate of Object.values(PLATE)) {
      expect(contrast(ink("INK_QUIET"), plate)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("stays visibly the quieter of the two", () => {
    for (const plate of Object.values(PLATE)) {
      expect(contrast(ink("INK_QUIET"), plate)).toBeLessThan(6);
    }
  });

  it("carries a second pair for dark stock, and the card swaps to it", () => {
    /*
     * THE BUG THIS PINS. `#474f5b` is a mid grey. On the four light artworks
     * it is the quiet state; on `dark.png` and `legendary.png`, whose text
     * areas measure 39 and 32, it is not quiet, it is gone — "Aktuell kein
     * Angebot" was very nearly invisible.
     *
     * The card root already swapped `--template-ink` for dark stock. The
     * trade row joins that swap rather than growing a mechanism of its own,
     * and the stocks below are the two measured artwork surfaces.
     */
    const STOCK = { dark: "#272727", legendary: "#202020" } as const;
    const offer = token("trade-ink-on-dark");
    const quiet = token("trade-ink-quiet-on-dark");

    for (const [name, stock] of Object.entries(STOCK)) {
      expect(contrast(offer, stock), `offer on ${name}`).toBeGreaterThanOrEqual(7);
      // Readable, not dimmed away — the same floor the light pair holds.
      expect(contrast(quiet, stock), `quiet on ${name}`).toBeGreaterThanOrEqual(4.5);
      // And still visibly the weaker of the two.
      expect(contrast(quiet, stock), `quiet on ${name} is too loud`).toBeLessThan(
        contrast(offer, stock),
      );
    }

    /* One swap, on the card root, beside the two it already did. */
    const card = code(CARD);
    expect(card).toContain('"--trade-ink": "var(--trade-ink-on-dark)"');
    expect(card).toContain('"--trade-ink-quiet": "var(--trade-ink-quiet-on-dark)"');
    // It hangs off the tone, not off a card type.
    const at = card.indexOf('"--trade-ink"');
    expect(card.lastIndexOf('tone === "dark"', at)).toBeGreaterThan(-1);
    expect(card).not.toMatch(/cardType === "(dark|legendary)"/);
  });

  it("separates the two states by a wide margin of ink", () => {
    for (const plate of Object.values(PLATE)) {
      const ratio = contrast(ink("INK_OFFER"), plate) / contrast(ink("INK_QUIET"), plate);
      // Dark against grey, not two shades of the same thing. The quiet ink
      // sits high enough to clear AA on both plates, which costs some of the
      // margin — it is still more than double, and that is what has to read
      // while scrolling.
      expect(ratio).toBeGreaterThanOrEqual(2);
    }
  });

  it("weights the price more heavily than its label", () => {
    const link = code(LINK);
    expect(link).toContain("font-bold tabular-nums");
    expect(link).toContain("de.shop.offersFromLabel");
  });

  it("distinguishes them by ink alone, never by a second surface", () => {
    /*
     * An earlier draft gave the buyable state a gradient, a highlight and a
     * shadow. On the real artwork the plate is already a painted surface and
     * a second one laid over it made the text harder to read, not easier.
     */
    const link = code(LINK);
    expect(link).not.toContain("linear-gradient");
    expect(link).not.toContain("inset_0_1px_0");
    expect(link).not.toMatch(/shadow-\[/);
    // Press feedback stays, as ink.
    expect(link).toContain("hover:opacity-");
    expect(link).toContain("active:opacity-");
  });

  it("uses no gold anywhere in the trade row", () => {
    // Gold is ownership (V3.1). A buyable offer is not something you own.
    const link = code(LINK);
    for (const gold of ["gold", "own-ink", "own-line", "ACTION_OWN"]) {
      expect(link, `${gold} belongs to ownership`).not.toContain(gold);
    }
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

  it("lets the name be the figure's own, in full (V3.6)", () => {
    /*
     * The card shows `displayName` and the badge shows the label, so a
     * Legendary Bash reads "Legendary Bash" with "Legendary" also on the seal
     * over the window. That repetition was the reason the card showed only
     * the base name until V3.6 — and it stopped being a repetition when the
     * display rule turned round: "Bash" is not a shorter way of writing
     * "Granite Crusher", it is a different figure.
     *
     * `sortBaseName` keeps its one job: where the card SITS, never what it
     * SAYS. A card that renders it as the visible name is the defect this
     * pins.
     */
    expect(code(CARD)).toContain("{figure.displayName}");
    expect(code(CARD)).toContain("title={figure.displayName}");
    expect(code(CARD)).not.toContain("{figure.sortBaseName}");
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

  it("shows the loose price and never teases a cheaper boxed one (V3.3)", () => {
    /*
     * This used to quote whichever condition was cheapest. V1 sells loose
     * only, so a boxed listing — even at half the price — is not a price
     * anybody can pay here, and putting it on the card would advertise a
     * purchase the product refuses to make.
     */
    expect(
      summarizeOffers([offer({ price: 9 }), offer({ condition: "boxed", price: 4.49 })]),
    ).toMatchObject({ price: 9 });

    // A sold-out loose line beside a buyable boxed one leaves nothing to say.
    expect(
      summarizeOffers([offer({ price: 1, available: false }), offer({ condition: "boxed", price: 8 })]),
    ).toEqual({ kind: "none" });

    expect(v1BuyableOffers([offer({ available: false })])).toEqual([]);
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

/**
 * The window is white all the way to the frame (V3.6).
 *
 * The defect: a thin transparent strip along the top of the window on five of
 * the six cards. `WINDOW_FILL` had been measured down the artworks' CENTRE
 * AXIS, where the hole starts at y 125; read column by column it reaches y 99,
 * because every artwork has an ornamented head the hole follows upward. The
 * fill began at 116 and cut 17 px off that notch.
 */
describe("the white window", () => {
  const template = readFileSync("src/lib/catalog/card-template.ts", "utf8");
  const card = code(CARD);
  const zone = template.match(/export const WINDOW_FILL = zone\((\d+), (\d+), (\d+), (\d+)\)/);
  const [left, right, top, height] = (zone ?? []).slice(1).map(Number);

  it("is its own layer, not something the figure's picture provides", () => {
    /*
     * The architecture the operator asked for, and the reason for it: a
     * catalogue picture is `object-contain`, so it letterboxes, and its own
     * background reaches only as far as its own aspect ratio does. The window
     * cannot depend on that. It is filled by a layer of its own, underneath.
     */
    expect(card).toContain("bg-template-window");
    expect(readFileSync("src/app/globals.css", "utf8")).toContain("--template-window: #ffffff;");
    const at = card.indexOf("bg-template-window");
    expect(at, "no white window layer").toBeGreaterThan(-1);
    // Before the picture and before the artwork: it is the bottom layer.
    expect(at).toBeLessThan(card.indexOf("src={picture}"));
    expect(at).toBeLessThan(card.indexOf("src={template.src}"));
  });

  it("drops the name by one small central amount, and by nothing else", () => {
    /*
     * The operator withdrew this once — `special.png` was re-exported instead
     * — and then asked for it again after seeing a two-line name. "Elite
     * Boomer - ohne OVP" very nearly fills the 10.48 % row, so its first line
     * sat hard against the frame under the window with no air at all.
     *
     * A TRANSFORM, NOT PADDING: padding would shrink a box the long names
     * already fill. What it moves into is the top of the market row, which is
     * empty by construction — that row is `justify-end`.
     *
     * Small, and central. The value is a share of the CARD's width, so it
     * scales with the card, and it is declared once for all six types.
     */
    expect(card).toContain("transform: `translateY(${NAME_DROP})`");
    const template = readFileSync("src/lib/catalog/card-template.ts", "utf8");
    const drop = Number(template.match(/export const NAME_DROP = "([\d.]+)cqw";/)?.[1]);
    expect(drop, "NAME_DROP is missing or not in cqw").toBeGreaterThan(0);
    expect(drop, "this is a nudge, not a layout change").toBeLessThanOrEqual(2.5);

    /* One offset, no per-type escape hatches, and the row itself untouched. */
    expect(template.match(/export const NAME_DROP/g)).toHaveLength(1);
    for (const forbidden of [
      "specialNameOffset", "eliteNameOffset", "prestigeNameOffset", "longNameOffset",
    ]) {
      expect(template + card, forbidden).not.toContain(forbidden);
    }
    expect(template).toContain('{ area: "name", height: 10.48 }');

    /*
     * And it cannot reach the market value.
     *
     * The name row is 10.48 % of the card's HEIGHT while the drop and the
     * type size are shares of its WIDTH, so the comparison goes through the
     * aspect ratio. In those terms the row is 16.3 cqw tall and two lines at
     * the size the clamp actually reaches are 14.3, leaving 1.0 above and
     * below a centred name. The translate spends that lower gap and then
     * overhangs the row's foot by the remainder.
     *
     * What is underneath is the market row: 11.52 % tall, `justify-end`, with
     * a label and a price of roughly 12 cqw sitting at its foot. About five
     * cqw at its top are empty by construction, and that is the budget the
     * overhang has to stay inside.
     */
    const ratio = 1562 / 1007;
    const rowInWidth = 10.48 * ratio;        // the name row, as a share of the width
    const twoLines = 2 * 1.15 * 6.2;         // clamp's cqw term, twice, at leading 1.15
    const slack = (rowInWidth - twoLines) / 2;
    expect(slack, "two lines no longer fit the row at all").toBeGreaterThan(0);
    const overhang = Math.max(0, drop - slack);
    expect(overhang, "the name would reach the market value").toBeLessThan(5);
    // And the point of the exercise: more air above the first line than before.
    expect(slack + drop).toBeGreaterThan(slack);
  });

  it("is positioned from WINDOW_FILL, in one place, for every card type", () => {
    for (const side of ["top", "right", "bottom", "left"]) {
      expect(card, side).toContain(`${side}: WINDOW_FILL.${side}`);
    }
    // One rectangle; no per-type override anywhere.
    expect(template.match(/export const WINDOW_FILL/g)).toHaveLength(1);
    for (const forbidden of ["specialWindow", "prestigeWindow", "darkWindow", "chaseWindow"]) {
      expect(template, forbidden).not.toContain(forbidden);
    }
  });

  it("overscans past the deepest notch, and stops before the card's edge", () => {
    /*
     * Both margins were measured against all six artworks, not guessed:
     *
     *   deepest notch    y  99  (card, chase)
     *   fill starts      y  80   → 19 px of cover
     *   frame stops being opaque across the band at y ~50 (prestige)
     *                            → 30 px before white would show outside
     */
    expect(top, "the fill must start above the deepest notch at y 99").toBeLessThan(99);
    expect(top, "and stay behind the frame, which thins out around y 50").toBeGreaterThan(55);
    // Horizontally and at the foot the original values were never in doubt.
    expect(left).toBeLessThanOrEqual(83);
    expect(right).toBeGreaterThanOrEqual(923);
    expect(top + height, "the hole ends at y 819").toBeGreaterThanOrEqual(830);
  });

  it("stays behind the artwork — it fills the hole, it does not cover the card", () => {
    /*
     * DOM order alone does not settle this: a z-index on the white layer
     * would lift it over the artwork and paint a white rectangle across the
     * frame. It has to stay in the flow, underneath.
     */
    const at = card.indexOf('className="absolute bg-template-window"');
    expect(at, "the white layer's class list changed shape").toBeGreaterThan(-1);
    const tag = card.slice(card.lastIndexOf("<div", at), card.indexOf(">", card.indexOf("aria-hidden", at)));
    expect(tag).not.toMatch(/\bz-\d+\b/);
    expect(tag).not.toContain("isolate");
    expect(tag).not.toContain("relative");
  });

  it("does not stretch the figure to hide the problem", () => {
    // The fix is the layer underneath. The picture keeps its aspect ratio.
    expect(card).toContain('className="h-full w-full object-contain"');
    expect(card).not.toContain("object-cover");
    expect(card).not.toContain("object-fill");
  });
});

/**
 * The ownership medallion straddles the window's edge (V3.6).
 */
describe("the collected overlay's released geometry", () => {
  /* Prose removed: the file explains at length what `INSET.image` used to do,
     naming the very symbol asserted against below. */
  const seal = code("src/components/catalog/collected-seal.tsx");
  const card = code(CARD);
  const size = Number(seal.match(/^const SIZE = "([\d.]+)cqw";$/m)?.[1]);
  const drop = Number(seal.match(/^const DROP = "([\d.]+)cqw";$/m)?.[1]);

  it("grew, and is still one number", () => {
    expect(size).toBe(20.5);
    expect(size).toBeGreaterThan(18); // the V3.6 growth cannot be undone silently
    expect(seal).toContain("width: SIZE, height: SIZE");
  });

  it("is anchored to the window's edge, not to the image slot's padding", () => {
    /*
     * `INSET.image` is 10.8 % — the padding of the slot the picture sits in —
     * and left the medallion floating inside the white. `WINDOW_FILL.right`
     * is 7.65 %, the window's own outer edge, so the seal now covers the last
     * of the white and the frame beside it. Derived from the file that
     * measures it, so moving the window moves the seal with it.
     */
    expect(seal).toContain("right: RIGHT");
    expect(seal).toContain("const RIGHT = `calc(${WINDOW_FILL.right} / 2)`;");
    expect(seal).not.toContain("INSET");
  });

  it("sits lower than dead centre on that edge", () => {
    /*
     * 3 cqw in the first pass, 6 now: the operator looked at it and wanted
     * the medallion further from the top of the card. Pinned exactly, and
     * held above the earlier value so the second correction cannot be
     * silently undone by the first.
     */
    expect(drop).toBe(6);
    expect(drop).toBeGreaterThan(3);
    expect(seal).toContain("calc(${WINDOW_TOP}% - ${SIZE} / 2 + ${DROP})");
  });

  it("still fits inside the card, and still clears the name", () => {
    const ratio = 1562 / 1007;
    const inset = (1007 - 930) / 1007 * 100; // WINDOW_FILL.right, in per cent
    // Horizontal: right edge at `inset` from the right, left edge `size` in.
    expect(inset + size).toBeLessThan(100);
    expect(100 - inset, "must not reach the card's outer edge").toBeLessThan(98);
    // Vertical, through the aspect ratio because size is a share of the WIDTH.
    const windowTop = 7.42;
    const top = windowTop - (size / 2 - drop) / ratio;
    const bottom = top + size / ratio;
    expect(top, "hangs off the top of the card").toBeGreaterThan(0);
    expect(bottom, "reaches the name row at 51.95 %").toBeLessThan(51.95);
    // And it really does straddle: part above the window's edge, part below.
    expect(top).toBeLessThan(windowTop);
    expect(bottom).toBeGreaterThan(windowTop);
  });

  it("is the same geometry on all six card types", () => {
    expect(seal).not.toMatch(/cardType|standard|special|legendary|chase|prestige/);
    expect(seal).toContain("export function CollectedSeal() {");
    expect(seal).toContain("pointer-events-none");
    const wrapper = seal.slice(seal.indexOf("export function CollectedSeal"));
    expect(wrapper).toContain('aria-hidden="true"');
  });

  it("paints above the artwork, and the white window paints below it", () => {
    /*
     * The order the operator asked for, read off the source: white window,
     * picture, artwork, the slots on top of it, and the medallion last with
     * its own stacking context so it can cover the frame.
     */
    const at = {
      white: card.indexOf("bg-template-window"),
      picture: card.indexOf("src={picture}"),
      artwork: card.indexOf("src={template.src}"),
      seal: card.indexOf("<CollectedSeal />"),
    };
    expect(at.white).toBeLessThan(at.picture);
    expect(at.picture).toBeLessThan(at.artwork);
    expect(at.artwork).toBeLessThan(at.seal);
    expect(seal).toContain("z-20");
  });
});
