import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ELEMENTS } from "@/lib/catalog/character";
import { ELEMENT_ICON } from "@/components/catalog/element-icon";
import { ELEMENT_LABELS, asElement } from "@/lib/catalog/element";

/**
 * The element mark (UX-01C, ADR-0148).
 *
 * THE RULE THIS FILE EXISTS TO HOLD. The row shows the element as an icon
 * instead of a word, and the project has no element artwork — so the mark is
 * a placeholder. What must never happen is that the placeholder quietly
 * becomes a FAKE: ten invented shapes that look like the game's own emblems.
 * One shape, ten colours, and a documented swap point for real files.
 */

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const code = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const ICON = "src/components/catalog/element-icon.tsx";
const SRC = read(ICON);
const CODE = code(SRC);

describe("all ten elements are supported, and nothing beyond them", () => {
  it("the swap map names every element exactly once", () => {
    /*
     * A FULL MAP RATHER THAN A LOOKUP WITH A DEFAULT, so that adding an
     * eleventh element to `ELEMENTS` fails the type check here instead of
     * shipping an element the icon does not know about.
     */
    expect(Object.keys(ELEMENT_ICON).sort()).toEqual([...ELEMENTS].sort());
  });

  it("and every one of them has a German name to be announced by", () => {
    for (const element of ELEMENTS) {
      expect(ELEMENT_LABELS[element], element).toBeTruthy();
    }
  });

  it("no real icon files exist yet, so all ten are null", () => {
    /* When files arrive this test is the one that changes — deliberately, so
       adding artwork is a visible decision rather than a silent commit. */
    for (const element of ELEMENTS) {
      expect(ELEMENT_ICON[element], element).toBeNull();
    }
  });
});

describe("the fallback is clean", () => {
  it("an unknown value is not an element, and the component renders nothing", () => {
    expect(asElement("Plasma")).toBeNull();
    expect(asElement(null)).toBeNull();
    expect(asElement(undefined)).toBeNull();
    expect(asElement("")).toBeNull();
    /* The guard is the shared one, and the early return is unconditional. */
    expect(CODE).toContain("asElement(element)");
    expect(CODE).toContain("if (known === null) return null;");
  });

  it("457 of 561 collectibles have no element, and their rows must look finished", () => {
    /* Which is why the answer is "render nothing", never a grey default
       colour that would read as an eleventh element (ADR-0034). */
    expect(CODE).not.toMatch(/\bdefault\b.*[Ee]lement/);
    expect(CODE).not.toContain("text-muted");
  });
});

describe("no invented element graphic", () => {
  it("one shape for all ten, told apart by colour", () => {
    /*
     * THE WHOLE POINT. Ten different shapes would be made-up emblems passed
     * off as the game's own. One rune plus the ten colours that already exist
     * says "this figure has an element, and it has an identity" and claims
     * nothing more.
     */
    const shapes = CODE.match(/<(circle|path|rect|polygon|ellipse)\b/g) ?? [];
    expect(shapes.length, "more than a couple of primitives looks like artwork")
      .toBeLessThanOrEqual(2);
    expect(CODE).not.toMatch(/\bd="[Mm]/); // no hand-drawn path data
    expect(CODE.match(/<svg/g) ?? []).toHaveLength(1);
  });

  it("the colour comes from the ten tokens that already exist", () => {
    expect(CODE).toContain("elementPanelClass(known)");
    /* And no second colour table: `currentColor` throughout the drawing. */
    expect(CODE).not.toMatch(/#[0-9a-fA-F]{6}/);
    expect(CODE.match(/currentColor/g) ?? []).not.toHaveLength(0);
  });

  it("the mark is never silent for assistive technology", () => {
    /*
     * `element.ts` states the rule this icon bends: "Colour is never the only
     * signal — the label always names the element." On the row it IS the only
     * visible signal, which was the operator's decision — so the name has to
     * reach both a pointer and a screen reader.
     */
    expect(CODE).toContain("title={label}");
    expect(CODE).toContain('<span className="sr-only">{label}</span>');
    expect(CODE).toContain('aria-hidden="true"');
    /* And the honest cost is written down where the decision is. */
    expect(SRC).toMatch(/THE HONEST COST/);
  });

  it("every other surface still spells the element out", () => {
    /* Directly through `elementLabel`, or through `ElementChip`, which is
       built on it — either way the word is on the screen. */
    for (const surface of [
      "src/components/catalog/figure-card.tsx",
      "src/components/collection/collection-table.tsx",
      "src/components/catalog/quick-view.tsx",
      "src/components/catalog/character-panel.tsx",
    ]) {
      expect(code(read(surface)), surface).toMatch(/elementLabel|ElementChip/);
    }
    expect(code(read("src/components/catalog/character-panel.tsx")),
      "ElementChip is what spells it out").toContain("elementLabel(");
    /* The row is the one that does not. */
    expect(code(read("src/components/catalog/figure-row.tsx")))
      .not.toContain("elementLabel");
  });
});

describe("the icons can be swapped for files without touching the component", () => {
  it("a path renders a file, a null renders the rune", () => {
    expect(CODE).toContain("const file = ELEMENT_ICON[known];");
    expect(CODE).toMatch(/file \?/);
    expect(CODE).toContain("<Rune />");
  });

  it("and the component itself is the only place that branches on it", () => {
    /* So partial adoption works: three real icons and seven runes render
       side by side with no condition anywhere else. */
    const row = code(read("src/components/catalog/figure-row.tsx"));
    expect(row).not.toContain("ELEMENT_ICON");
  });

  it("but the tile does not draw it at all since the UX-01E correction", () => {
    /*
     * THE RUNE CAME OFF ONE SURFACE, AND NOTHING ELSE CHANGED. At the desktop
     * review the operator asked for the element mark to go from the tile for
     * now, so the top left is the figure's name alone.
     *
     * This component, its ten colours and its swap point are untouched — it
     * is still where real artwork will land — and the element DATA is
     * untouched, which the surfaces below prove: every one of them still
     * spells the element out in words.
     */
    const row = code(read("src/components/catalog/figure-row.tsx"));
    expect(row).not.toContain("<ElementIcon");
    expect(row).not.toContain("element-icon");
    expect(row).not.toContain("figure.element");
    /* The component still exists and still supports all ten. */
    expect(Object.keys(ELEMENT_ICON)).toHaveLength(10);
    /* And the word is still on every surface that had it. */
    for (const surface of [
      "src/components/catalog/figure-card.tsx",
      "src/components/collection/collection-table.tsx",
      "src/components/catalog/quick-view.tsx",
      "src/components/catalog/character-panel.tsx",
    ]) {
      expect(code(read(surface)), surface).toMatch(/elementLabel|ElementChip/);
    }
  });

  it("it brings no query, no action and no state", () => {
    for (const forbidden of ['"use client"', '"use server"', "useState", "fetch(",
                             "@/lib/supabase"]) {
      expect(SRC, `the icon contains ${forbidden}`).not.toContain(forbidden);
    }
  });
});
