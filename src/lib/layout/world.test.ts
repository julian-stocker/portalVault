import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Structural guard for the world background.
 *
 * `/` and `/collection` live in different route groups, so anything that
 * owns the world at page level unmounts on the way between them and the
 * background disappears after a client navigation — exactly the bug V3.3
 * fixed. Owning it in both layouts is what makes the two routes behave the
 * same whether they were loaded directly or navigated to.
 *
 * Reading the source rather than rendering: this is a question about where a
 * component is mounted, which no snapshot of the output would answer.
 */
const COLLECTOR_LAYOUTS = [
  "src/app/(public)/layout.tsx",
  "src/app/(app)/layout.tsx",
] as const;

function source(path: string): string {
  return readFileSync(path, "utf8");
}

describe("the world background is owned by the layouts", () => {
  it.each(COLLECTOR_LAYOUTS)("%s mounts WorldZone", (path) => {
    expect(source(path)).toMatch(/<WorldZone[ /]/);
  });

  it.each(COLLECTOR_LAYOUTS)("%s positions it against the page, not the viewport", (path) => {
    // The layout's own wrapper has to be the containing block, or an
    // absolutely positioned world would escape to the document.
    expect(source(path)).toContain('className="relative min-h-screen"');
  });

  it("no page owns it, so navigation between the route groups cannot lose it", () => {
    for (const path of [
      "src/app/(public)/(catalog)/page.tsx",
      "src/app/(app)/collection/page.tsx",
    ]) {
      expect(source(path)).not.toContain("WorldZone");
    }
  });

  it("the world sits behind its page and never over it", () => {
    const world = source("src/components/layout/world-zone.tsx");
    expect(world).toContain("-z-10");
    expect(world).toContain("pointer-events-none");
    expect(world).toContain('aria-hidden="true"');
  });

  it("ships both widths of every artwork, so a phone never fetches a large one", () => {
    const world = source("src/components/layout/world-zone.tsx");
    for (const asset of [
      "skyisles-portal-hero.webp",
      "skyisles-portal-hero-sm.webp",
      "skyisles-backdrop.webp",
      "skyisles-backdrop-sm.webp",
    ]) {
      expect(world, asset).toContain(asset);
    }
    expect(world).toContain("960w");
    expect(world).toContain("1920w");
  });

  it("gives the catalog the portal and the collection the wide world", () => {
    // A permanent split (ADR-0038, V4): one landmark for the catalog, a view
    // with no single focus behind the collection's showcase plate.
    expect(source("src/app/(public)/layout.tsx")).toContain("<WorldZone />");
    expect(source("src/app/(app)/layout.tsx")).toContain('<WorldZone variant="world" />');
  });
});

describe("the collector world does not invert with the colour scheme", () => {
  const css = source("src/app/globals.css");

  it("declares a dark colour scheme rather than offering both", () => {
    // `light dark` let a UA light theme paint a white canvas and white form
    // controls, which took the art direction apart (ADR-0038, V3.3).
    expect(css).toContain("color-scheme: dark;");
    expect(css).not.toContain("color-scheme: light dark;");
  });

  it("keeps the page ground dark in both preferences", () => {
    const grounds = [...css.matchAll(/--canvas:\s*#([0-9a-f]{6})/gi)].map((m) => m[1]);
    expect(grounds.length).toBeGreaterThanOrEqual(2);
    for (const hex of grounds) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      // Rec. 601 luma; anything above ~64 would no longer be a night sky.
      expect(0.299 * r + 0.587 * g + 0.114 * b, `--canvas #${hex}`).toBeLessThan(64);
    }
  });

  it("keeps the collectible card light in both preferences", () => {
    const cards = [...css.matchAll(/--card:\s*#([0-9a-f]{6})/gi)].map((m) => m[1]);
    expect(cards.length).toBeGreaterThanOrEqual(1);
    for (const hex of cards) {
      const r = parseInt(hex.slice(0, 2), 16);
      expect(r, `--card #${hex}`).toBeGreaterThan(200);
    }
  });
});
