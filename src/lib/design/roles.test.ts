import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * V3.1 — gold means possession.
 *
 * `--accent` carried four meanings at once: buying, focus, the active nav
 * pill and the ownership frame. On an owned card that meant the buy pill and
 * the frame around it were the same colour, so the loudest thing on the card
 * said both "this is yours" and "this costs money".
 *
 * These tests hold the four languages apart, and they COMPUTE the contrast
 * ratios rather than asserting that a string is present — a token can be
 * renamed correctly and still be unreadable.
 *
 *   GOLD      possession            SILVER   trade
 *   NEUTRAL   nav, actions, state   BRAND    the wordmark
 *
 * The rule is about MEANING. Decorative gold — the wordmark, the forged
 * header and footer edges — stays, and is named so that a sweep over
 * `--own-*` cannot take it.
 */

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

/** CIE Lab. */
function labOf(hex: string): [number, number, number] {
  const [r, g, b] = rgb(hex).map(channel);
  const t = (v: number) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
  const x = t((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.9505);
  const y = t(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const z = t((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.089);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

/**
 * Perceptual distance (CIE76).
 *
 * Useful for "are these two the same colour", useless for "are these the same
 * MATERIAL": it folds lightness in with hue, so a polished and a forged face
 * of one metal score as far apart as two unrelated colours. Where the
 * question is about material, `hueAngle` and `chroma` are asked instead.
 */
function distance(a: string, b: string): number {
  const A = labOf(a);
  const B = labOf(b);
  return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
}

/** Lab hue angle in degrees. Two colours of one metal share it. */
function hueAngle(hex: string): number {
  const [, a, b] = labOf(hex);
  const deg = (Math.atan2(b, a) * 180) / Math.PI;
  return deg < 0 ? deg + 360 : deg;
}

/** Lab chroma — how far from grey. A metal has some; a dead neutral has none. */
function chroma(hex: string): number {
  const [, a, b] = labOf(hex);
  return Math.hypot(a, b);
}

/** Lab lightness. */
function lightness(hex: string): number {
  return labOf(hex)[0];
}

/** Composites `fg` at `alpha` over `bg` — what a `bg-deep/90` actually is. */
function over(fg: string, alpha: number, bg: string): string {
  const [f, b] = [rgb(fg), rgb(bg)];
  return (
    "#" +
    [0, 1, 2]
      .map((i) => Math.round((f[i] * alpha + b[i] * (1 - alpha)) * 255).toString(16).padStart(2, "0"))
      .join("")
  );
}

/* ------------------------------------------------------- the tokens in use */

const CSS = readFileSync("src/app/globals.css", "utf8");

/**
 * A token's resolved hex, read from the file that defines it.
 *
 * Follows one level of `var(--other)`, because several roles are deliberately
 * aliases — `--link` is `--action-neutral-edge`, and naming the role is the
 * point even when the value is shared.
 */
function token(name: string, depth = 0): string {
  const match = CSS.match(new RegExp(`^\\s*--${name}:\\s*(#[0-9a-f]{6}|var\\(--[a-z-]+\\))`, "im"));
  expect(match, `--${name} is not defined`).not.toBeNull();
  const value = match![1];
  if (value.startsWith("#")) return value;
  expect(depth, `--${name} aliases too deeply to resolve`).toBeLessThan(3);
  return token(value.slice(6, -1), depth + 1);
}

const GOLD = token("own-ink");
const SILVER_INK = token("trade-ink");
const SILVER = token("trade-solid");
const FOCUS = token("focus");
const CARD = token("card");
const CANVAS = token("canvas");
const NIGHT = "#0a0918";
const OWNED_CARD = "#f0dfb6";

/** Every ground a focus ring can land on in this product. */
const GROUNDS: [string, string][] = [
  ["gold", GOLD],
  ["silver", SILVER],
  ["ivory card", CARD],
  ["owned card", OWNED_CARD],
  ["sky at dusk", CANVAS],
  ["sky at night", NIGHT],
  ["panel", token("surface")],
  ["deep panel", token("deep")],
  ["white plate", "#ffffff"],
];

// ---------------------------------------------------------------------------

describe("silver is a metal, not a disabled grey", () => {
  it("reads as struck on the ivory card", () => {
    // Disabled lives on LOW contrast. This is the far end of the scale.
    expect(contrast(SILVER_INK, CARD)).toBeGreaterThan(7);
  });

  it("and on the gold card an owned figure sits on", () => {
    expect(contrast(SILVER_INK, OWNED_CARD)).toBeGreaterThan(4.5);
  });

  it("has a cool cast rather than none at all", () => {
    // The measurable difference between silver and grey: a matched-lightness
    // neutral must be perceptibly apart from it.
    expect(distance(SILVER_INK, "#40454a")).toBeGreaterThan(3);
    expect(distance(SILVER, "#cfcfcf")).toBeGreaterThan(3);
  });

  it("is not mistakable for the undead element ink on the same card", () => {
    // The one collision on a figure card: --element-ink-undead is a blue-grey
    // too. A lighter silver (#4d5866) measured 7.8 here, which is too close.
    expect(distance(SILVER_INK, token("element-ink-undead"))).toBeGreaterThan(12);
  });

  it("is not mistakable for secondary card text", () => {
    expect(distance(SILVER_INK, token("on-card-muted"))).toBeGreaterThan(12);
  });
});

/**
 * The three positive guarantees.
 *
 * These are the tests that matter, and the reason is V3.1's own defect: the
 * buy pill was given a colour measured against the dark sky and then placed
 * on an ivory card, where it came out at 1.39:1. A negative test — "the
 * polished silver would be unreadable there" — would not have caught that,
 * because nobody had thought to write it about a combination they did not
 * know they had built.
 *
 * So each one enumerates the surfaces a colour is ACTUALLY used on, and
 * asserts it is legible on every one of them. The negative guards further
 * down are kept, but they are the smaller half.
 */

/** Every ground a card-level control can sit on. */
const CARD_GROUNDS: [string, string][] = [
  ["a card nobody owns", CARD],
  ["an owned card, top of the gradient", "#f9ebc9"],
  ["an owned card, middle", "#f4e3be"],
  ["an owned card, bottom", "#f0dfb6"],
];

describe("guarantee 1 — the card's silver is legible on every card", () => {
  const forged = () => token("trade-on-card");

  it.each(CARD_GROUNDS)("%s: the fill separates from the card", (_, ground) => {
    // 1.4.11: a control's boundary against what is behind it.
    expect(contrast(forged(), ground)).toBeGreaterThanOrEqual(3);
  });

  it.each(CARD_GROUNDS)("%s: and it separates well, not just legally", (_, ground) => {
    expect(contrast(forged(), ground)).toBeGreaterThan(7);
  });

  it("its label is legible on it", () => {
    expect(contrast(forged(), token("on-trade-on-card"))).toBeGreaterThanOrEqual(4.5);
  });

  it("so is its hover, on every card", () => {
    for (const [, ground] of CARD_GROUNDS) {
      expect(contrast(token("trade-on-card-hover"), ground)).toBeGreaterThanOrEqual(3);
    }
    expect(contrast(token("trade-on-card-hover"), token("on-trade-on-card"))).toBeGreaterThanOrEqual(4.5);
  });

  it("and the hover is perceptible at all", () => {
    expect(distance(token("trade-on-card"), token("trade-on-card-hover"))).toBeGreaterThan(5);
  });
});

describe("guarantee 2 — the polished silver is legible on every surface it is used on", () => {
  const sky = CANVAS;
  const surfaces: [string, string][] = [
    // checkout submit and the cart's panel: PANEL = bg-deep/90
    ["checkout panel (deep/90 over sky)", over(token("deep"), 0.9, sky)],
    ["cart panel (deep/90 over night)", over(token("deep"), 0.9, NIGHT)],
    // the offer panel: bg-surface/60 inside the figure page's bg-deep/85
    ["offer panel (surface/60 over deep/85)", over(token("surface"), 0.6, over(token("deep"), 0.85, sky))],
    // the cart badge sits on the nav bar: bg-deep/80
    ["nav bar (deep/80 over sky)", over(token("deep"), 0.8, sky)],
    // the floating cart is fixed and passes over the page itself
    ["the sky it floats over", sky],
    ["the sky at night", NIGHT],
  ];

  it.each(surfaces)("%s: the fill reads as an object on it", (_, ground) => {
    expect(contrast(token("trade-solid"), ground)).toBeGreaterThan(7);
  });

  it.each(surfaces)("%s: so does the hover", (_, ground) => {
    expect(contrast(token("trade-solid-hover"), ground)).toBeGreaterThan(7);
  });

  it("its label is legible on it", () => {
    expect(contrast(token("trade-solid"), token("on-trade"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token("trade-solid-hover"), token("on-trade"))).toBeGreaterThanOrEqual(4.5);
  });

  it("the floating cart carries a dark edge, because it also passes over cards", () => {
    /*
     * The one place the polished silver meets a light ground: the floating
     * cart is `fixed` and scrolls over the grid. Its fill alone measures
     * 1.39:1 on an ivory card. The pair is what covers both — the fill on
     * the sky, the ring on a card — exactly as the focus ring does.
     */
    for (const [, ground] of CARD_GROUNDS) {
      expect(contrast(token("on-trade"), ground)).toBeGreaterThanOrEqual(3);
    }
    const floating = readFileSync("src/components/cart/floating-cart.tsx", "utf8");
    expect(floating).toContain("ring-2 ring-on-trade");
    expect(floating, "a 10% ring is not an edge").not.toContain("ring-on-trade/10");
  });
});

describe("guarantee 3 — text on the owned gold ground stays readable", () => {
  const STOPS: [string, string][] = [
    ["top", "#f9ebc9"],
    ["middle", "#f4e3be"],
    ["bottom", "#f0dfb6"],
  ];

  /** Small text on a card: the series label and the element chip are 11 px. */
  const AA_SMALL = 4.5;

  it.each(STOPS)("%s: the card's body ink clears AA with room to spare", (_, stop) => {
    expect(contrast(token("on-card"), stop)).toBeGreaterThan(10);
  });

  it.each(STOPS)("%s: the ownership line clears AA", (_, stop) => {
    /*
     * The line that carries possession in words. It was written in
     * `--own-ink` for one build — a colour made for the dark sky, which
     * measures 1.98:1 on ivory and 1.66:1 on this ground. Invisible exactly
     * where the state matters most, and caught by this guarantee rather than
     * by looking at it.
     */
    expect(contrast(token("own-ink-on-card"), stop)).toBeGreaterThanOrEqual(AA_SMALL);
    expect(contrast(token("own-ink-on-card"), CARD)).toBeGreaterThanOrEqual(AA_SMALL);
  });

  it("the dark-sky gold would have been unreadable there", () => {
    expect(contrast(token("own-ink"), CARD)).toBeLessThan(2.5);
  });

  it.each(STOPS)("%s: the muted ink clears AA", (_, stop) => {
    // The series label. This is the ink that decides how dark the ground may
    // get, and it is why the gradient was NOT deepened in V3.1a.
    expect(contrast(token("on-card-muted"), stop)).toBeGreaterThanOrEqual(AA_SMALL);
  });

  it("a deeper ground would break that, which is why it stays", () => {
    expect(contrast(token("on-card-muted"), "#ebd5a0")).toBeLessThan(AA_SMALL);
  });

  it.each([
    "magic", "tech", "water", "fire", "life",
    "undead", "earth", "air", "light", "dark",
  ])("the %s element ink clears AA on every stop", (element) => {
    /*
     * Calibrated in V3.2. Eight of the ten missed AA on this ground, and
     * `--element-ink-light` missed it on the plain ivory card too, at 4.43:1
     * — true since the chips were introduced. This replaces the ratchet that
     * recorded the shortfall while the card was being redesigned, so the
     * colours were tuned once against the final ground rather than twice.
     */
    for (const [, stop] of STOPS) {
      expect(contrast(token(`element-ink-${element}`), stop)).toBeGreaterThanOrEqual(AA_SMALL);
    }
    expect(contrast(token(`element-ink-${element}`), CARD)).toBeGreaterThanOrEqual(AA_SMALL);
  });

  it("and they are still tellable apart from one another", () => {
    // Darkening ten colours towards the same corner risks collapsing them
    // together. The closest pair is water/air.
    const inks = ["magic", "tech", "water", "fire", "life", "undead", "earth", "air", "light", "dark"]
      .map((e) => token(`element-ink-${e}`));
    let closest = Infinity;
    for (let i = 0; i < inks.length; i++) {
      for (let j = i + 1; j < inks.length; j++) {
        closest = Math.min(closest, distance(inks[i], inks[j]));
      }
    }
    expect(closest).toBeGreaterThan(8);
  });

});

describe("guards — the combinations that must never be built", () => {
  /*
   * Subordinate to the three guarantees above, and kept for one reason: they
   * name the specific mistake that was made, so it cannot be made twice. A
   * guard proves a wrong pairing stays wrong; only a guarantee proves the
   * right one is right.
   */
  it("the polished silver is never put on a card", () => {
    expect(contrast(SILVER, CARD)).toBeLessThan(2);
    expect(contrast(SILVER, "#f0dfb6")).toBeLessThan(2);
    /*
     * Since V3.3 the card's silver is PAINTED INTO THE ARTWORK — the plate at
     * the foot of `silver.png` and `gold.png`. The row puts ink on it and no
     * fill of its own, so neither silver token is a surface there.
     */
    const link = readFileSync("src/components/shop/offer-link.tsx", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(link).not.toMatch(/bg-(trade|own|accent)/);
  });

  it("the forged silver is never put on a dark panel", () => {
    expect(contrast(token("trade-on-card"), CANVAS)).toBeLessThan(3);
    const action = readFileSync("src/components/ui/action.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(action, "ACTION_TRADE sits on dark panels").not.toContain("ACTION_TRADE =\n  `${BASE} focus-ring bg-trade-on-card");
  });
});

describe("the ownership frame carries the state on its own", () => {
  /*
   * Until V3.1 a saturated gold BUY pill sat in the footer of every owned,
   * buyable card and was carrying part of the ownership signal by accident.
   * Moving trade to silver left the frame to say it alone, and it was not
   * strong enough. The ground could not be deepened to compensate — one step
   * down puts `--on-card-muted` at 4.21:1 and the series label below AA — so
   * the weight went into the frame, which carries no text.
   */
  const frame = CSS.slice(CSS.indexOf("--gold-frame:"), CSS.indexOf(";", CSS.indexOf("--gold-frame:")));

  it("is three struck lines, not a glow", () => {
    expect(frame).toContain("0 0 0 1px"); // sheen
    expect(frame).toContain("0 0 0 5px"); // body
    expect(frame).toContain("0 0 0 6px"); // dark seat
    expect(frame).not.toMatch(/0 0 \d+px \d+px rgb\(2[0-9]{2}/); // no bloom
  });

  it("separates an owned card from the sky more than a plain one does", () => {
    // 7.2:1 for the frame body against 3.6:1 for the bronze edge of a card
    // nobody owns. That difference IS the state.
    expect(contrast("#d29a3c", CANVAS)).toBeGreaterThan(6.5);
    expect(contrast("#8a6a45", CANVAS)).toBeLessThan(4.5);
  });

  it("the gold ground stays where the text can still be read", () => {
    // The bottom stop of --own-ground. One step darker and the muted ink
    // falls under 4.5:1.
    expect(contrast("#f0dfb6", token("on-card-muted"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#ebd5a0", token("on-card-muted"))).toBeLessThan(4.5);
  });
});

describe("silver and gold are two different metals", () => {
  it("both silver faces are ONE metal: same hue, same chroma, different lightness", () => {
    /*
     * THIS TEST WAS WRONG, AND IT PASSED ANYWAY.
     *
     * It read `distance(trade-on-card, trade-ink) < 5` — and those two tokens
     * hold the SAME value, so it compared a colour with itself, scored ΔE 0,
     * and claimed to have compared the two faces. The two faces are ΔE 56
     * apart, and they are meant to be: the entire difference is lightness,
     * which is what makes one polished and the other forged.
     *
     * Total ΔE is the wrong instrument for "same material" — it folds
     * lightness in with hue. Hue and chroma are the right ones, and they are
     * what the claim was always about.
     */
    const polished = token("trade-solid");
    const forged = token("trade-on-card");

    // The same hue, to within a degree. 264.6° and 264.2°.
    expect(Math.abs(hueAngle(polished) - hueAngle(forged))).toBeLessThan(2);
    // Comparable chroma: both carry the cool cast, neither is dead grey.
    expect(Math.abs(chroma(polished) - chroma(forged))).toBeLessThan(3);
    expect(Math.min(chroma(polished), chroma(forged))).toBeGreaterThan(4);
    // Lightness is where they differ, deliberately and by a lot.
    expect(Math.abs(lightness(polished) - lightness(forged))).toBeGreaterThan(40);
  });

  it("and hue is what separates silver from gold — 264° against 76°", () => {
    for (const silver of [token("trade-solid"), token("trade-on-card")]) {
      const apart = Math.abs(hueAngle(silver) - hueAngle(GOLD));
      expect(Math.min(apart, 360 - apart)).toBeGreaterThan(120);
    }
  });

  it("are far apart perceptually", () => {
    expect(distance(SILVER, GOLD)).toBeGreaterThan(40);
  });

  it("are equally loud against the sky — silver is not a quieter gold", () => {
    expect(contrast(SILVER, CANVAS)).toBeGreaterThan(8);
    expect(contrast(GOLD, CANVAS)).toBeGreaterThan(7);
  });

  it("carry legible ink", () => {
    expect(contrast(SILVER, token("on-trade"))).toBeGreaterThan(7);
    expect(contrast(GOLD, token("on-own"))).toBeGreaterThan(7);
  });
});

describe("the focus ring is visible on every ground it can land on", () => {
  const HALO = "#0a0918"; // --focus-halo, at full opacity

  it.each(GROUNDS)("%s: at least one ring member reaches 3:1", (_, ground) => {
    /*
     * The whole reason focus is a PAIR. No single colour clears 3:1 on both
     * the ivory card and the night sky, so the bright ring carries dark
     * grounds and the dark halo carries light ones.
     */
    expect(Math.max(contrast(FOCUS, ground), contrast(HALO, ground))).toBeGreaterThanOrEqual(3);
  });

  it("the two members are legible against each other", () => {
    expect(contrast(FOCUS, HALO)).toBeGreaterThan(10);
  });

  it("beats what it replaced — gold focus on a gold button was invisible", () => {
    // 1.16:1. The ring existed in the class list and nowhere on screen.
    expect(contrast(token("ring"), GOLD)).toBeLessThan(2);
    expect(Math.max(contrast(FOCUS, GOLD), contrast(HALO, GOLD))).toBeGreaterThan(3);
  });

  it("is one treatment, written once", () => {
    expect(CSS).toContain(".focus-ring:focus-visible");
    expect(CSS).toContain("outline: 2px solid var(--focus)");
    expect(CSS).toContain("box-shadow: 0 0 0 6px var(--focus-halo)");
    // Forced colours supply their own; ours must step aside rather than smear.
    expect(CSS).toContain("@media (forced-colors: active)");
  });
});

describe("the neutral primary is an action without being a metal", () => {
  it("carries legible ink", () => {
    expect(contrast(token("action-neutral"), token("foreground"))).toBeGreaterThan(7);
  });

  it("has a boundary that clears 3:1, because its fill does not", () => {
    // WCAG 1.4.11. A tonal fill alone measures 1.6:1 against the sky, which
    // reads as a panel; the edge is what makes it a control.
    expect(contrast(token("action-neutral"), CANVAS)).toBeLessThan(3);
    expect(contrast(token("action-neutral-edge"), CANVAS)).toBeGreaterThanOrEqual(3);
    expect(contrast(token("action-neutral-edge"), NIGHT)).toBeGreaterThanOrEqual(3);
  });

  it("is quieter than both metals, so it never outranks them", () => {
    const neutral = contrast(token("action-neutral"), CANVAS);
    expect(neutral).toBeLessThan(contrast(GOLD, CANVAS));
    expect(neutral).toBeLessThan(contrast(SILVER, CANVAS));
  });

  it("a link is distinguishable from body text without borrowing gold", () => {
    expect(contrast(token("link"), CANVAS)).toBeGreaterThanOrEqual(3);
    expect(distance(token("link"), GOLD)).toBeGreaterThan(40);
  });
});

describe("no scheme variants are needed", () => {
  it("silver only gets better at night", () => {
    // The scheme changes the hour, not the polarity: the sky darkens and the
    // ivory card stays ivory. Both silver roles therefore hold in both.
    expect(contrast(SILVER, NIGHT)).toBeGreaterThan(contrast(SILVER, CANVAS));
    expect(contrast(SILVER_INK, CARD)).toBeGreaterThan(7);
  });

  it("the dark block redefines no role token", () => {
    const dark = CSS.slice(
      CSS.indexOf("@media (prefers-color-scheme: dark)"),
      CSS.indexOf("@theme inline"),
    );
    for (const role of ["own-ink", "trade-ink", "trade-solid", "focus", "action-neutral"]) {
      expect(dark, `--${role} must not differ by scheme`).not.toContain(`--${role}:`);
    }
  });
});

// ---------------------------------------------------------------------------

describe("gold no longer works as a state or an action", () => {
  /** Every .ts/.tsx under src, minus tests. */
  function sources(dir = "src"): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) return sources(path);
      if (!/\.tsx?$/.test(path) || path.includes(".test.")) return [];
      return [path];
    });
  }

  const files = sources();

  it("finds a meaningful number of files to check", () => {
    expect(files.length).toBeGreaterThan(60);
  });

  it("no component styles anything with the accent token", () => {
    /*
     * `accent-trade-solid` is Tailwind's native `accent-color` utility for a
     * checkbox, not this token, so the pattern requires the word to end.
     */
    for (const file of files) {
      const code = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      const hits = [...code.matchAll(/\b(?:bg|text|ring|border|from|via|to|shadow|fill)-accent\b/g)];
      expect(hits.map((h) => h[0]), `${file} still styles with --accent`).toEqual([]);
    }
  });

  it("the buy control is silver, not gold", () => {
    const action = readFileSync("src/components/ui/action.ts", "utf8");
    // On the dark panels: the polished face.
    expect(action).toContain("bg-trade-solid text-on-trade");
    // On the card there is no buy control any more (V3.2) and no silver fill
    // either (V3.3) — the plate is in the artwork, the row only inks it.
    const link = readFileSync("src/components/shop/offer-link.tsx", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(link).not.toContain("shadow-gold");
    expect(link).not.toMatch(/bg-(own|trade|accent)/);
  });

  it("the ownership card is still gold — now as artwork", () => {
    /*
     * V3.3 replaced the CSS surface with two finished templates. The language
     * is unchanged and the assertion moved with it: an owned figure is drawn
     * on `gold.png`, and gold appears nowhere else on the tile.
     */
    const template = readFileSync("src/lib/catalog/card-template.ts", "utf8");
    expect(template).toContain('owned: { src: "/images/cards/gold.webp"');
    expect(template).toContain('plain: { src: "/images/cards/silver.webp"');
    const card = readFileSync("src/components/catalog/figure-card.tsx", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(card).toContain("owned ? TEMPLATE.owned : TEMPLATE.plain");
    expect(card).not.toMatch(/shadow-gold|own-ground|own-frame/);
  });

  it("the wordmark keeps brand gold, named as its own thing", () => {
    expect(readFileSync("src/components/layout/wordmark.tsx", "utf8")).toContain("text-brand");
    expect(CSS).toContain("--brand:");
  });

  it("the world's forged edges keep theirs, also named", () => {
    expect(readFileSync("src/components/layout/site-nav.tsx", "utf8")).toContain("border-world-edge");
    expect(CSS).toContain("--world-edge:");
  });
});

describe("genuine semantic states were not neutralised", () => {
  it("a failed mail is an error", () => {
    const panel = readFileSync("src/components/admin/order-mail-panel.tsx", "utf8");
    expect(panel).toContain('state === "failed") return "font-semibold text-danger"');
  });

  it("a saved edit is a success", () => {
    expect(readFileSync("src/components/admin/figure-editor.tsx", "utf8")).toContain(
      'state === "saved" ? "text-success"',
    );
  });

  it("both were wearing gold before V3.1, which is why they are checked", () => {
    // Not a rename: the meaning was wrong. `--success` and `--danger` already
    // existed and were the right answer all along.
    expect(CSS).toContain("--success:");
    expect(CSS).toContain("--danger:");
  });
});
