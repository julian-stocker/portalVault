import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ELEMENTS } from "@/lib/catalog/character";
import { ELEMENT_ICON } from "@/components/catalog/element-icon";
import { ELEMENT_LABELS, asElement } from "@/lib/catalog/element";

/**
 * The element emblem (UX-01C, ADR-0148; real artwork since UX-Design).
 *
 * THE RULES THIS FILE HOLDS. The emblems are the operator's own files, never
 * a drawing of ours; an element without a file shows NOTHING, not a
 * placeholder; and the element is always named in words for a pointer and a
 * screen reader.
 */

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const code = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const ICON = "src/components/catalog/element-icon.tsx";
const SRC = read(ICON);
const CODE = code(SRC);

describe("all ten elements are known, and nothing beyond them", () => {
  it("the swap map names every element exactly once", () => {
    /* A full map, so an eleventh element fails the type check here. */
    expect(Object.keys(ELEMENT_ICON).sort()).toEqual([...ELEMENTS].sort());
  });

  it("and every one of them has a German name to be announced by", () => {
    for (const element of ELEMENTS) {
      expect(ELEMENT_LABELS[element], element).toBeTruthy();
    }
  });
});

describe("the emblems are the designer's files", () => {
  it("eight elements have one, and each points at its own file", () => {
    expect(ELEMENT_ICON).toEqual({
      Magic: "/images/elements/magic.webp",
      Tech: "/images/elements/technic.webp",
      Water: "/images/elements/water.webp",
      Fire: "/images/elements/fire.webp",
      Life: "/images/elements/life.webp",
      Undead: "/images/elements/undead.webp",
      Earth: "/images/elements/earth.webp",
      Air: "/images/elements/air.webp",
      Light: null,
      Dark: null,
    });
  });

  it("every path in the map is a shipped file", () => {
    for (const [element, path] of Object.entries(ELEMENT_ICON)) {
      if (path === null) continue;
      expect(existsSync(join(process.cwd(), "public", path)), `${element}: ${path}`).toBe(true);
    }
  });

  it("no paths are shared — each element its own emblem", () => {
    const paths = Object.values(ELEMENT_ICON).filter((p): p is string => p !== null);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("and nothing is drawn here — no SVG, no rune, no colour table", () => {
    expect(CODE).not.toContain("<svg");
    expect(CODE).not.toContain("Rune");
    expect(CODE).not.toMatch(/#[0-9a-fA-F]{6}/);
  });
});

describe("the fallback is clean: nothing, never a placeholder", () => {
  it("an unknown value is not an element, and the component renders nothing", () => {
    expect(asElement("Plasma")).toBeNull();
    expect(asElement(null)).toBeNull();
    expect(asElement(undefined)).toBeNull();
    expect(asElement("")).toBeNull();
    expect(CODE).toContain("asElement(element)");
    expect(CODE).toContain("if (known === null) return null;");
  });

  it("an element without a file renders nothing, too", () => {
    expect(CODE).toContain("if (file === null || failed) return null;");
  });

  it("and a file that fails to load leaves the box empty, not broken", () => {
    expect(CODE).toContain("onError={() => setFailed(true)}");
  });
});

describe("the element is always named in words", () => {
  it("title for a pointer, sr-only for a screen reader, the picture silent", () => {
    expect(CODE).toContain("title={decorative ? undefined : label}");
    expect(CODE).toContain('<span className="sr-only">{label}</span>');
    expect(CODE).toContain('alt=""');
    expect(CODE).toContain('aria-hidden="true"');
  });

  it("every other surface still spells the element out", () => {
    for (const surface of [
      "src/components/catalog/figure-card.tsx",
      "src/components/collection/collection-table.tsx",
      "src/components/catalog/quick-view.tsx",
      "src/components/catalog/character-panel.tsx",
    ]) {
      expect(code(read(surface)), surface).toMatch(/elementLabel|ElementChip/);
    }
  });

  it("and the component itself is the only place that branches on the map", () => {
    const row = code(read("src/components/catalog/figure-row.tsx"));
    expect(row).not.toContain("ELEMENT_ICON");
  });

  it("the tile does not show the emblem at all — only the figure page does", () => {
    /* Two rounds on the tile (beside the market value, then before the name)
       and the operator took it off both: the tiles stay as they were. */
    const row = code(read("src/components/catalog/figure-row.tsx"));
    expect(row).not.toContain("ElementIcon");
    expect(row).not.toContain("element-icon");
    expect(row).not.toContain("figure.element");
    const page = code(read("src/app/(public)/skylanders/[slug]/page.tsx"));
    expect(page).toContain("<ElementIcon element={figure.element} decorative");
  });

  it("it brings no query and no action — only the load-failure state", () => {
    for (const forbidden of ['"use server"', "fetch(", "@/lib/supabase"]) {
      expect(SRC, `the icon contains ${forbidden}`).not.toContain(forbidden);
    }
  });
});
