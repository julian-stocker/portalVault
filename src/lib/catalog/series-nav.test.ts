import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { knownSeriesCodes, seriesShort } from "./series-nav.ts";

/**
 * The short codes in the series tabs.
 *
 * The point of the table is that all seven tabs fit a 360 px screen, so the
 * tests care about two things: that it covers the real series, and that the
 * forms stay short and distinct.
 */
const catalog = JSON.parse(readFileSync("data/catalog/products.json", "utf8")) as {
  series: { code: string; label: string }[];
};

describe("seriesShort", () => {
  it("covers exactly the six series the catalog holds", () => {
    expect(knownSeriesCodes().sort()).toEqual(catalog.series.map((s) => s.code).sort());
  });

  it("gives Trap Team a readable form — 'T' alone says nothing", () => {
    expect(seriesShort("T")).toBe("TT");
  });

  it("keeps the other codes as they are", () => {
    expect(seriesShort("SA")).toBe("SA");
    expect(seriesShort("G")).toBe("G");
    expect(seriesShort("SF")).toBe("SF");
    expect(seriesShort("SC")).toBe("SC");
    expect(seriesShort("I")).toBe("I");
  });

  it("keeps every form short enough for a tab", () => {
    for (const series of catalog.series) {
      expect(seriesShort(series.code).length, series.label).toBeLessThanOrEqual(3);
    }
  });

  it("gives every series its own form", () => {
    const shorts = catalog.series.map((series) => seriesShort(series.code));
    expect(new Set(shorts).size).toBe(catalog.series.length);
  });

  it("shows the raw code for a series it does not know", () => {
    // Visible and slightly ugly beats vanishing: a new series announces
    // itself instead of rendering an empty tab.
    expect(seriesShort("ZB")).toBe("ZB");
    expect(seriesShort("")).toBe("");
  });

  it("defines no colours — series is navigation, element is data", () => {
    // Guards the boundary in ADR-0035: a hue table creeping in here would
    // put series and element colour on the same screen.
    const source = readFileSync("src/lib/catalog/series-nav.ts", "utf8");
    const code = source
      .split("\n")
      .filter((line) => {
        const trimmed = line.trimStart();
        return !trimmed.startsWith("*") && !trimmed.startsWith("//") && !trimmed.startsWith("/*");
      })
      .join("\n");
    expect(code).not.toMatch(/#[0-9a-f]{6}|bg-|text-element|--series/i);
  });
});
