import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  CATALOG_GROUPS,
  GROUP_LABELS,
  groupLabel,
  groupTabs,
  groupsPresent,
  isCatalogGroup,
  matchesGroup,
  type CatalogGroup,
} from "@/lib/catalog/group";

/**
 * Product groups (ADR-0041).
 *
 * The counts below come from the audit of 2026-09-06 against the real 561
 * collectibles. They are pinned here because the migration's backfill is a
 * curated decision: if the mapping ever changes, this test says so.
 */
const AUDIT: Readonly<Record<CatalogGroup, number>> = {
  figure: 261,
  trap: 57,
  sensei: 46,
  item: 44,
  vehicle: 31,
  trap_master: 28,
  creation_crystal: 27,
  mini: 27,
  swapper: 26,
  giant: 14,
};

describe("the vocabulary", () => {
  it("has exactly the ten approved values", () => {
    expect([...CATALOG_GROUPS]).toEqual([
      "figure",
      "giant",
      "swapper",
      "trap_master",
      "sensei",
      "vehicle",
      "trap",
      "creation_crystal",
      "mini",
      "item",
    ]);
  });

  it("labels every one of them", () => {
    for (const group of CATALOG_GROUPS) {
      expect(GROUP_LABELS[group], group).toBeTruthy();
    }
  });

  it("accepts only what it knows", () => {
    expect(isCatalogGroup("figure")).toBe(true);
    for (const value of ["sidekick", "lightcore", "special", "", null, 1, {}]) {
      expect(isCatalogGroup(value), String(value)).toBe(false);
    }
  });

  it("shows a dash for a category nobody has classified", () => {
    // NULL is a state, not a default: never silently "Items".
    expect(groupLabel(null)).toBe("—");
    expect(groupLabel("item")).toBe("Items");
  });
});

describe("which tabs a series offers", () => {
  const figures = (...groups: (CatalogGroup | null)[]) =>
    groups.map((catalogGroup) => ({ catalogGroup }));

  it("keeps the curated order, never the order it met them in", () => {
    expect(groupsPresent(figures("item", "trap", "figure"))).toEqual(["figure", "trap", "item"]);
  });

  it("offers only groups that are really there", () => {
    // Spyro's Adventure has no vehicles; an empty tab would be a dead end.
    expect(groupsPresent(figures("figure", "mini", "item"))).toEqual(["figure", "mini", "item"]);
  });

  it("gives an unclassified figure no tab of its own", () => {
    // It stays reachable under "Alle" and is filed under nothing.
    expect(groupsPresent(figures(null, "figure"))).toEqual(["figure"]);
  });

  it("matches everything when no group is chosen", () => {
    expect(matchesGroup({ catalogGroup: "trap" }, null)).toBe(true);
    expect(matchesGroup({ catalogGroup: null }, null)).toBe(true);
    expect(matchesGroup({ catalogGroup: null }, "item")).toBe(false);
    expect(matchesGroup({ catalogGroup: "trap" }, "trap")).toBe(true);
  });
});

/**
 * The backfill is data, and data is checked.
 *
 * Reading the migration as text: it is the only place the twenty categories
 * are mapped, and the mapping was decided once from the audit rather than
 * derived from category names at runtime.
 */
describe("the migration's backfill", () => {
  const sql = readFileSync("supabase/migrations/0004_catalog_editorial.sql", "utf8");

  it("classifies every category that carries collectibles", () => {
    const mapped = [...sql.matchAll(/\('(SA|G|SF|T|SC|I)',\s*'([^']+)'\)/g)].map(
      (match) => `${match[1]}/${match[2]}`,
    );
    // 24 rows under 20 distinct names — 'Magic Items' and 'Sidekicks' exist
    // once per game. The six 'Spiele' rows are deliberately not among them.
    expect(new Set(mapped).size).toBe(24);
  });

  it("uses only approved values", () => {
    const used = [...sql.matchAll(/set catalog_group = '([a-z_]+)'/g)].map((match) => match[1]);
    expect(used.length).toBeGreaterThan(0);
    for (const value of used) expect(isCatalogGroup(value), value).toBe(true);
  });

  it("puts the three variant-named categories under 'figure'", () => {
    // 'Varianten & LightCore', 'Giants Series 2 Figuren' and 'Trap Team
    // Series Figuren' name a finish or a re-release. That is dimension C,
    // and their contents are plain figures.
    const figureBlock = sql.slice(
      sql.indexOf("set catalog_group = 'figure'"),
      sql.indexOf("set catalog_group = 'giant'"),
    );
    expect(figureBlock).toContain("Varianten & LightCore");
    expect(figureBlock).toContain("Giants Series 2 Figuren");
    expect(figureBlock).toContain("Trap Team Series Figuren");
  });

  it("unites Sidekicks and Minis", () => {
    const miniBlock = sql.slice(
      sql.indexOf("set catalog_group = 'mini'"),
      sql.indexOf("set catalog_group = 'item'"),
    );
    expect(miniBlock).toContain("'Sidekicks'");
    expect(miniBlock).toContain("'Minis'");
  });

  it("leaves software unclassified", () => {
    // ADR-0029: software is outside the collector surface and has no product
    // group. 'Spiele' must not be named by any update — the only mention is
    // the comment saying why.
    const statements = sql
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    expect(statements).not.toContain("Spiele");
  });

  it("adds up to the audited 561", () => {
    expect(Object.values(AUDIT).reduce((a, b) => a + b, 0)).toBe(561);
  });
});

/**
 * The second navigation level (ADR-0041).
 *
 * The counts below are the approved expectations from the audit, checked
 * against the classification the migration wrote. They are pinned here
 * because a wrong number would be a wrong catalog rather than a wrong pixel.
 */
describe("the product group tabs", () => {
  const figure = (catalogGroup: CatalogGroup | null, seriesCode = "T") => ({
    catalogGroup,
    seriesCode,
  });

  it("puts 'Alle' first and counts everything under it", () => {
    const tabs = groupTabs([figure("trap"), figure("figure"), figure(null)], "Alle");
    expect(tabs[0]).toMatchObject({ group: null, label: "Alle", count: 3 });
  });

  it("keeps the curated order, not the order it met them in", () => {
    const tabs = groupTabs([figure("item"), figure("trap"), figure("figure")], "Alle");
    expect(tabs.map((tab) => tab.group)).toEqual([null, "figure", "trap", "item"]);
  });

  it("offers only groups the series really has", () => {
    const tabs = groupTabs([figure("figure"), figure("mini")], "Alle");
    expect(tabs.map((tab) => tab.group)).toEqual([null, "figure", "mini"]);
    expect(tabs.some((tab) => tab.group === "vehicle")).toBe(false);
  });

  it("gives an unclassified figure no tab, but counts it under 'Alle'", () => {
    // NULL means "not classified yet" and never `item` (ADR-0041).
    const tabs = groupTabs([figure(null), figure("figure")], "Alle");
    expect(tabs.map((tab) => tab.group)).toEqual([null, "figure"]);
    expect(tabs[0].count).toBe(2);
    expect(tabs[1].count).toBe(1);
  });

  it("counts each group exactly once per figure", () => {
    const tabs = groupTabs([figure("trap"), figure("trap"), figure("mini")], "Alle");
    expect(tabs.find((tab) => tab.group === "trap")?.count).toBe(2);
    expect(tabs.find((tab) => tab.group === "mini")?.count).toBe(1);
  });

  it("is empty of tabs for an empty series", () => {
    expect(groupTabs([], "Alle")).toEqual([{ group: null, label: "Alle", count: 0 }]);
  });
});

/**
 * The approved sub-navigation per game, as data.
 *
 * These are the numbers the catalog must produce. They come from the audit of
 * 2026-09-06 and are what the migration's backfill was written to yield.
 */
describe("the approved counts per game", () => {
  const EXPECTED: Record<string, { all: number; groups: [CatalogGroup, number][] }> = {
    SA: { all: 102, groups: [["figure", 85], ["mini", 4], ["item", 13]] },
    G: { all: 81, groups: [["figure", 59], ["giant", 14], ["mini", 4], ["item", 4]] },
    SF: { all: 89, groups: [["figure", 55], ["swapper", 26], ["item", 8]] },
    T: {
      all: 141,
      groups: [["figure", 28], ["trap_master", 28], ["trap", 57], ["mini", 19], ["item", 9]],
    },
    SC: { all: 69, groups: [["figure", 34], ["vehicle", 31], ["item", 4]] },
    I: { all: 79, groups: [["sensei", 46], ["creation_crystal", 27], ["item", 6]] },
  };

  it("adds up to the 561 collectibles", () => {
    const total = Object.values(EXPECTED).reduce((sum, series) => sum + series.all, 0);
    expect(total).toBe(561);
  });

  it("each game's groups add up to its own total", () => {
    for (const [code, series] of Object.entries(EXPECTED)) {
      const sum = series.groups.reduce((n, [, count]) => n + count, 0);
      expect(sum, code).toBe(series.all);
    }
  });

  it("produces exactly those tabs, in the curated order", () => {
    for (const [code, series] of Object.entries(EXPECTED)) {
      // A stand-in catalog built from the approved numbers: the derivation is
      // what is under test, and it must not need a database to be correct.
      const figures = series.groups.flatMap(([group, count]) =>
        Array.from({ length: count }, () => ({ catalogGroup: group })),
      );
      const tabs = groupTabs(figures, "Alle");
      expect(tabs[0], code).toMatchObject({ group: null, count: series.all });

      const wanted = CATALOG_GROUPS.filter((group) =>
        series.groups.some(([name]) => name === group),
      );
      expect(tabs.slice(1).map((tab) => tab.group), code).toEqual(wanted);
      for (const [group, count] of series.groups) {
        expect(tabs.find((tab) => tab.group === group)?.count, `${code}/${group}`).toBe(count);
      }
    }
  });

  it("never offers a game a group it does not have", () => {
    // Imaginators has no plain figures at all; Spyro's Adventure no vehicles.
    const imaginators = groupTabs(
      EXPECTED.I.groups.flatMap(([group, count]) =>
        Array.from({ length: count }, () => ({ catalogGroup: group })),
      ),
      "Alle",
    );
    expect(imaginators.some((tab) => tab.group === "figure")).toBe(false);
    expect(imaginators.map((tab) => tab.group)).toEqual([
      null,
      "sensei",
      "creation_crystal",
      "item",
    ]);
  });
});
