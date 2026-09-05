import { describe, expect, it } from "vitest";

import catalog from "../../../data/catalog/products.json" with { type: "json" };
import type { SeriesOption } from "@/lib/catalog/types";
import { defaultSeriesCode } from "./series-nav.ts";

const SERIES: SeriesOption[] = [
  { code: "SA", label: "Spyro's Adventure", position: 0 },
  { code: "G", label: "Giants", position: 1 },
  { code: "T", label: "Trap Team", position: 3 },
];

describe("defaultSeriesCode", () => {
  it("takes the first series, which is the earliest game", () => {
    expect(defaultSeriesCode(SERIES)).toBe("SA");
  });

  it("keeps the order a database decision rather than sorting again", () => {
    // Handed a differently ordered list, it takes that list's first entry.
    expect(defaultSeriesCode([SERIES[1], SERIES[0]])).toBe("G");
  });

  it("returns an empty code for an empty catalog rather than inventing one", () => {
    expect(defaultSeriesCode([])).toBe("");
  });

  it("resolves to a real series of the actual catalog", () => {
    // The export carries no `position`; the database supplies it, and the
    // order of the array is the same order.
    const fromCatalog = catalog.series.map((series, index) => ({
      code: series.code,
      label: series.label,
      position: index,
    }));
    expect(catalog.series.map((series) => series.code)).toContain(defaultSeriesCode(fromCatalog));
  });
});

describe("the catalog series navigation", () => {
  it("offers exactly the six games, and no 'all' option", () => {
    // ADR-0038: the catalog always has a game selected. "Alle" was removed
    // together with the short codes.
    expect(catalog.series).toHaveLength(6);
    expect(catalog.series.map((series) => series.code)).not.toContain("all");
  });

  it("every series carries a full title for the tab to show", () => {
    for (const series of catalog.series) {
      expect(series.label.length, series.code).toBeGreaterThan(1);
      expect(series.label).not.toBe(series.code);
    }
  });
});
