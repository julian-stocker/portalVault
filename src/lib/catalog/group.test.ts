import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  CATALOG_GROUPS,
  GROUP_LABELS,
  groupLabel,
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
