import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { CATALOG_GROUPS } from "@/lib/catalog/group";
import { isOfferCondition } from "@/lib/shop/offer";

/**
 * The two committed staging fixtures, checked as data.
 *
 * Neither file is application code, but both decide what a human sees when
 * they judge the UX — and a fixture that quietly loses a state is a review
 * that quietly stops covering it. These tests are the reproducibility
 * guarantee: rebuild staging from the repository and the same states come
 * back.
 *
 * No database here. The seeds are verified against the real thing by running
 * them; this is about the files being complete and internally consistent.
 */

type Assignment = { series: string; category: string; group: string | null; why: string };
type Position = {
  skyId: string;
  name: string;
  series: string;
  condition: string;
  quantity: number;
  salePrice: number | null;
  isListed: boolean;
  state: string;
};

const groups = JSON.parse(
  readFileSync("data/catalog/category-groups.json", "utf8"),
) as { approved: string; groups: Assignment[] };

const shop = JSON.parse(
  readFileSync("data/catalog/staging-shop-fixtures.json", "utf8"),
) as { approved: string; positions: Position[] };

const catalog = JSON.parse(readFileSync("data/catalog/products.json", "utf8")) as {
  series: { code: string; label: string; categories: string[] }[];
  items: { id: string; name: string; series: string; category: string; price: number | null }[];
};

const SERIES = ["SA", "G", "SF", "T", "SC", "I"] as const;

describe("the category group mapping", () => {
  it("covers every category the catalog actually has", () => {
    const inCatalog = new Set(catalog.items.map((item) => `${item.series} ${item.category}`));
    const inFile = new Set(groups.groups.map((row) => `${row.series} ${row.category}`));
    expect([...inCatalog].filter((key) => !inFile.has(key))).toEqual([]);
    expect([...inFile].filter((key) => !inCatalog.has(key))).toEqual([]);
  });

  it("uses only groups the model defines — none invented", () => {
    for (const row of groups.groups) {
      if (row.group === null) continue;
      expect(CATALOG_GROUPS, `${row.series}/${row.category}`).toContain(row.group);
    }
  });

  /** Games are not collectibles (ADR-0029) and never appear in the catalog. */
  it("leaves every Spiele row unclassified, and only those", () => {
    const nulls = groups.groups.filter((row) => row.group === null);
    expect(nulls).toHaveLength(6);
    expect(nulls.every((row) => row.category === "Spiele")).toBe(true);
    expect(groups.groups.filter((row) => row.category === "Spiele")).toHaveLength(6);
  });

  it("classifies the other 24 rows", () => {
    expect(groups.groups.filter((row) => row.group !== null)).toHaveLength(24);
  });

  it("exercises all ten groups, so every tab can be seen", () => {
    const used = new Set(groups.groups.map((row) => row.group).filter(Boolean));
    expect([...used].sort()).toEqual([...CATALOG_GROUPS].sort());
  });

  it("gives every row a reason a human can check", () => {
    for (const row of groups.groups) {
      expect(row.why.length, `${row.series}/${row.category}`).toBeGreaterThan(20);
    }
  });
});

describe("the staging shop fixture", () => {
  const positions = shop.positions;

  it("names only figures the canonical catalog contains", () => {
    const known = new Map(catalog.items.map((item) => [item.id, item]));
    for (const p of positions) {
      const figure = known.get(p.skyId);
      expect(figure, `${p.skyId} is not a canonical figure`).toBeTruthy();
      // The name in the file is a comment for a human; it must not drift.
      expect(figure!.name, p.skyId).toBe(p.name);
      expect(figure!.series, p.skyId).toBe(p.series);
    }
  });

  /**
   * `SKY-9101` carries the payment smoke and `SKY-9998` the RLS one. Both have
   * orders, reservations and journal rows that cannot be recreated. The seed
   * refuses them at runtime; this refuses them at review time.
   */
  it("never names a protected smoke fixture", () => {
    for (const p of positions) {
      expect(p.skyId.startsWith("SKY-9"), `${p.skyId} is a fixture id`).toBe(false);
    }
  });

  it("has no duplicate position", () => {
    const keys = positions.map((p) => `${p.skyId}/${p.condition}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("uses only real conditions and sane numbers", () => {
    for (const p of positions) {
      expect(isOfferCondition(p.condition), p.skyId).toBe(true);
      expect(Number.isInteger(p.quantity) && p.quantity >= 0, p.skyId).toBe(true);
      expect(p.salePrice === null || p.salePrice > 0, p.skyId).toBe(true);
      expect(typeof p.isListed, p.skyId).toBe("boolean");
    }
  });

  it("is roughly the size that was asked for", () => {
    expect(positions.length).toBeGreaterThanOrEqual(24);
    expect(positions.length).toBeLessThanOrEqual(30);
    const figures = new Set(positions.map((p) => p.skyId));
    expect(figures.size).toBeGreaterThanOrEqual(18);
    expect(figures.size).toBeLessThanOrEqual(24);
  });

  it("covers all six games", () => {
    const covered = new Set(positions.map((p) => p.series));
    expect([...covered].sort()).toEqual([...SERIES].sort());
  });

  it("covers short and long names", () => {
    const lengths = positions.map((p) => p.name.length);
    expect(Math.min(...lengths)).toBeLessThanOrEqual(4);
    expect(Math.max(...lengths)).toBeGreaterThanOrEqual(35);
  });

  it("covers a wide price range", () => {
    const known = new Map(catalog.items.map((item) => [item.id, item]));
    const prices = positions
      .map((p) => p.salePrice ?? known.get(p.skyId)?.price ?? null)
      .filter((value): value is number => value !== null);
    expect(Math.min(...prices)).toBeLessThan(2);
    expect(Math.max(...prices)).toBeGreaterThan(200);
  });
});

/**
 * The nine public states the review has to be able to look at. Each is
 * expressed as a predicate over the fixture, so a file that loses one fails
 * here rather than in somebody's eyes three screens later.
 */
describe("every shop UX state is represented", () => {
  const positions = shop.positions;
  const byFigure = new Map<string, Position[]>();
  for (const p of positions) {
    if (!byFigure.has(p.skyId)) byFigure.set(p.skyId, []);
    byFigure.get(p.skyId)!.push(p);
  }

  const priced = new Map(catalog.items.map((item) => [item.id, item.price]));
  const effective = (p: Position): number | null =>
    p.salePrice ?? (priced.get(p.skyId) === null ? null : Math.round((priced.get(p.skyId)! * 90) / 100 * 100) / 100);
  const buyable = (p: Position) => p.isListed && p.quantity > 0 && effective(p) !== null;

  const CASES: Record<string, () => boolean> = {
    "automatic price from the market price": () =>
      positions.some((p) => p.salePrice === null && buyable(p) && priced.get(p.skyId) !== null),

    "manual price": () => positions.some((p) => p.salePrice !== null && buyable(p)),

    "loose only": () =>
      [...byFigure.values()].some((list) => list.length === 1 && list[0].condition === "loose"),

    "boxed only": () =>
      [...byFigure.values()].some((list) => list.length === 1 && list[0].condition === "boxed"),

    "loose and boxed at different prices": () =>
      [...byFigure.values()].some(
        (list) =>
          list.length === 2 &&
          list.every(buyable) &&
          effective(list[0]) !== effective(list[1]),
      ),

    "loose and boxed at the same price": () =>
      [...byFigure.values()].some(
        (list) =>
          list.length === 2 &&
          list.every(buyable) &&
          effective(list[0]) === effective(list[1]),
      ),

    "listed and available": () => positions.some(buyable),

    "listed and sold out": () =>
      positions.some((p) => p.isListed && p.quantity === 0),

    "not listed at all": () => positions.some((p) => !p.isListed),

    "no market price, so no shop price is possible": () =>
      positions.some((p) => p.salePrice === null && priced.get(p.skyId) === null && p.isListed),
  };

  for (const [label, holds] of Object.entries(CASES)) {
    it(label, () => {
      expect(holds(), `no fixture position produces "${label}"`).toBe(true);
    });
  }

  /**
   * The mixed case: one condition buyable, the other sold out. The card must
   * offer only the price it can actually honour.
   */
  it("a figure whose second condition is sold out", () => {
    const mixed = [...byFigure.values()].some(
      (list) => list.length === 2 && list.some(buyable) && list.some((p) => p.quantity === 0),
    );
    expect(mixed).toBe(true);
  });
});
