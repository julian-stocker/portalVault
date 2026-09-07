import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  DEFAULT_OWNERSHIP,
  filterByOwnership,
  isOwnershipActive,
  isOwnershipMode,
  matchesOwnership,
  offersOwnershipFilter,
  OWNERSHIP_MODES,
} from "@/lib/catalog/ownership";
import { matchesGroup } from "@/lib/catalog/group";
import { filterFigures } from "@/lib/catalog/search";
import { normalizeForSearch } from "@/lib/catalog/search";
import type { CatalogFigure } from "@/lib/catalog/types";

/**
 * "Alle · Besitz · Fehlen" (V7).
 *
 * Three named states replacing a toggle that was highlighted while owned
 * figures were hidden. What matters here is that exactly one state describes
 * what is on screen, and that this filter narrows the same pool everything
 * else narrows — so every combination works without being written twice.
 */
function figure(skyId: string, overrides: Partial<CatalogFigure> = {}): CatalogFigure {
  const name = overrides.name ?? `Figure ${skyId}`;
  return {
    skyId,
    name,
    slug: skyId.toLowerCase(),
    seriesCode: "SA",
    seriesLabel: "Spyro's Adventure",
    seriesPosition: 0,
    categoryPosition: 0,
    categoryName: "Figuren",
    categoryId: 1,
    catalogGroup: "figure",
    displayName: name,
    sortBaseName: name,
    sortVariantLabel: null,
    searchIndex: normalizeForSearch(name),
    marketPrice: 10,
    imageFile: null,
    imageOverridePath: null,
    isActive: true,
    catalogVisible: true,
    canonicalName: name,
    displayNameOverride: null,
    element: null,
    characterId: null,
    ...overrides,
  };
}

const OWNED = new Set(["SKY-0001", "SKY-0003"]);
const CATALOG = [figure("SKY-0001"), figure("SKY-0002"), figure("SKY-0003"), figure("SKY-0004")];

describe("the three states", () => {
  it("are exactly these, in this order", () => {
    expect([...OWNERSHIP_MODES]).toEqual(["all", "owned", "missing"]);
  });

  it("open on 'Alle'", () => {
    expect(DEFAULT_OWNERSHIP).toBe("all");
  });

  it("recognise nothing else", () => {
    expect(isOwnershipMode("all")).toBe(true);
    for (const value of ["", "owned_only", "ownedOnly", "true", null, 1, undefined]) {
      expect(isOwnershipMode(value)).toBe(false);
    }
  });
});

describe("what each state shows", () => {
  it("Alle: owned and missing together", () => {
    expect(filterByOwnership(CATALOG, OWNED, "all").map((f) => f.skyId)).toEqual([
      "SKY-0001",
      "SKY-0002",
      "SKY-0003",
      "SKY-0004",
    ]);
  });

  it("Besitz: only what is owned", () => {
    expect(filterByOwnership(CATALOG, OWNED, "owned").map((f) => f.skyId)).toEqual([
      "SKY-0001",
      "SKY-0003",
    ]);
  });

  it("Fehlen: only what is not", () => {
    expect(filterByOwnership(CATALOG, OWNED, "missing").map((f) => f.skyId)).toEqual([
      "SKY-0002",
      "SKY-0004",
    ]);
  });

  it("Besitz and Fehlen together are Alle, with no overlap", () => {
    const owned = filterByOwnership(CATALOG, OWNED, "owned");
    const missing = filterByOwnership(CATALOG, OWNED, "missing");
    expect(owned.length + missing.length).toBe(CATALOG.length);
    expect(owned.some((f) => missing.includes(f))).toBe(false);
  });

  it("keeps the catalog's order", () => {
    // The grid is sorted before it gets here; a filter may remove, never
    // reorder.
    const ids = filterByOwnership(CATALOG, OWNED, "missing").map((f) => f.skyId);
    expect(ids).toEqual([...ids].sort());
  });

  it("treats an empty ownership set as owning nothing", () => {
    expect(filterByOwnership(CATALOG, new Set(), "owned")).toEqual([]);
    expect(filterByOwnership(CATALOG, new Set(), "missing")).toHaveLength(4);
    // Which is exactly what an anonymous visitor would see if the filter
    // were ever shown to them — it is not.
    expect(filterByOwnership(CATALOG, new Set(), "all")).toHaveLength(4);
  });

  it("is not inverted", () => {
    // The whole point. The state named "owned" shows owned figures.
    expect(matchesOwnership(figure("SKY-0001"), OWNED, "owned")).toBe(true);
    expect(matchesOwnership(figure("SKY-0002"), OWNED, "owned")).toBe(false);
    expect(matchesOwnership(figure("SKY-0002"), OWNED, "missing")).toBe(true);
    expect(matchesOwnership(figure("SKY-0001"), OWNED, "missing")).toBe(false);
  });
});

describe("combining with the other filters", () => {
  const MIXED = [
    figure("SKY-0001", { seriesCode: "G", catalogGroup: "swapper", name: "Blast Zone" }),
    figure("SKY-0002", { seriesCode: "G", catalogGroup: "swapper", name: "Free Ranger" }),
    figure("SKY-0003", { seriesCode: "G", catalogGroup: "giant", name: "Bouncer" }),
    figure("SKY-0004", { seriesCode: "SA", catalogGroup: "swapper", name: "Blast Zone" }),
  ];
  const HELD = new Set(["SKY-0001", "SKY-0003"]);

  /** Exactly the order CatalogView applies: ownership, group, then search. */
  function view(mode: Parameters<typeof filterByOwnership>[2], group: "swapper" | null, query: string) {
    const pool = filterByOwnership(MIXED, HELD, mode).filter((f) => matchesGroup(f, group));
    return filterFigures(pool, { query, seriesCode: "G" }).map((f) => f.skyId);
  }

  it("Giants + Swapper + Fehlen", () => {
    expect(view("missing", "swapper", "")).toEqual(["SKY-0002"]);
  });

  it("Giants + Besitz", () => {
    expect(view("owned", null, "")).toEqual(["SKY-0001", "SKY-0003"]);
  });

  it("Giants + Swapper + Besitz", () => {
    expect(view("owned", "swapper", "")).toEqual(["SKY-0001"]);
  });

  it("narrows a search as well", () => {
    expect(view("all", null, "blast")).toEqual(["SKY-0001"]);
    expect(view("missing", null, "blast")).toEqual([]);
    expect(view("owned", null, "blast")).toEqual(["SKY-0001"]);
  });

  it("never crosses into another series", () => {
    // SKY-0004 is the same name in a different game and must not appear.
    expect(view("all", "swapper", "blast")).toEqual(["SKY-0001"]);
  });
});

describe("who is offered it", () => {
  it("a signed-in collector, and nobody else", () => {
    expect(offersOwnershipFilter({ signedIn: true, admin: false })).toBe(true);
    expect(offersOwnershipFilter({ signedIn: false, admin: false })).toBe(false);
    expect(offersOwnershipFilter({ signedIn: true, admin: true })).toBe(false);
  });

  it("is absent rather than disabled", () => {
    // A control that is present but meaningless is worse than no control.
    const filter = readFileSync("src/components/catalog/ownership-filter.tsx", "utf8");
    expect(filter).not.toContain("disabled");
    const view = readFileSync("src/components/catalog/catalog-view.tsx", "utf8");
    expect(view).toMatch(/offersOwnershipFilter\(\{ signedIn, admin \}\) \? \(/);
  });
});

describe("resting state", () => {
  it("'Alle' is not something to reset", () => {
    expect(isOwnershipActive(DEFAULT_OWNERSHIP)).toBe(false);
    expect(isOwnershipActive("owned")).toBe(true);
    expect(isOwnershipActive("missing")).toBe(true);
  });
});
