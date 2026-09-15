import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  DEFAULT_AVAILABILITY,
  hasBuyableOffer,
  isAvailabilityActive,
  matchesAvailability,
} from "@/lib/catalog/availability";
import { catalogFilterCount } from "@/lib/catalog/ownership";
import type { Offer } from "@/lib/shop/offer";

/**
 * "Mit Angebot" (V3.3).
 *
 * Its own dimension. The mistake it exists to avoid is a third option inside
 * `Alle | In Besitz | Fehlend`, which would make "missing AND buyable" —
 * the combination somebody with money actually wants — unexpressible.
 *
 * And its truth is the card's truth: `summarizeOffers()`, the same call the
 * trade row makes. A listed position that is out of stock shows no offer on
 * the card, so it must not pass this filter either.
 */
const offer = (over: Partial<Offer> = {}): Offer => ({
  skyId: "SKY-0007",
  condition: "loose",
  price: 4.49,
  available: true,
  ...over,
});

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("what counts as an offer", () => {
  it("is not merely a listed position", () => {
    // The card shows nothing for this figure; the filter must agree.
    expect(hasBuyableOffer([offer({ available: false })])).toBe(false);
  });

  it("is one that can actually be bought", () => {
    expect(hasBuyableOffer([offer()])).toBe(true);
  });

  it("counts a buyable loose one among unbuyable ones", () => {
    expect(
      hasBuyableOffer([offer({ available: false }), offer({ condition: "loose", available: true })]),
    ).toBe(true);
  });

  it("does not count a boxed one — V1 does not sell OVP (V3.3)", () => {
    expect(hasBuyableOffer([offer({ condition: "boxed", available: true })])).toBe(false);
  });

  it("treats nothing and an empty list alike", () => {
    expect(hasBuyableOffer(undefined)).toBe(false);
    expect(hasBuyableOffer([])).toBe(false);
  });

  it("asks the one V1 commerce truth, not a predicate of its own", () => {
    /*
     * The filter, the card's trade row, the quick view, the figure page and
     * the shop grid all resolve to `hasV1BuyableOffer`. They differed once —
     * the row asked "is anything available", the dialog asked "is anything
     * loose" — and a boxed-only figure fell between them.
     */
    const src = code("src/lib/catalog/availability.ts");
    expect(src).toContain("hasV1BuyableOffer");
    expect(src).not.toContain("offers.length");
    expect(src).not.toContain(".filter(");
    expect(src).not.toContain('"loose"');
    expect(src).not.toContain('"boxed"');
  });
});

describe("the mode", () => {
  it("lets everything through by default", () => {
    expect(DEFAULT_AVAILABILITY).toBe("all");
    expect(matchesAvailability(undefined, "all")).toBe(true);
    expect(matchesAvailability([offer({ available: false })], "all")).toBe(true);
    expect(isAvailabilityActive("all")).toBe(false);
  });

  it("narrows to buyable when asked", () => {
    expect(matchesAvailability([offer()], "available")).toBe(true);
    expect(matchesAvailability([offer({ available: false })], "available")).toBe(false);
    expect(matchesAvailability(undefined, "available")).toBe(false);
    expect(isAvailabilityActive("available")).toBe(true);
  });
});

describe("it combines with the other filters rather than replacing one", () => {
  it("is counted on top of ownership, not instead of it", () => {
    expect(catalogFilterCount(null, "missing", "available")).toBe(2);
    expect(catalogFilterCount(null, "owned", "available")).toBe(2);
    expect(catalogFilterCount(null, "all", "available")).toBe(1);
  });

  it("reaches three with a type as well", () => {
    expect(catalogFilterCount("figure", "missing", "available")).toBe(3);
  });

  it("still counts nothing when nothing is narrowed", () => {
    expect(catalogFilterCount(null, "all", "all")).toBe(0);
  });

  it("is applied in the same pool as the others, so every combination works", () => {
    const view = code("src/components/catalog/catalog-view.tsx");
    const pool = view.slice(view.indexOf("const pool = useMemo"), view.indexOf("const tabs"));
    expect(pool).toContain("matchesOwnership");
    expect(pool).toContain("matchesGroup");
    expect(pool).toContain("matchesAvailability");

    /*
     * The DEPENDENCY LIST, not the body. An earlier version of this looked
     * for the words anywhere in the memo and stayed green when they were
     * dropped from the array — where their absence means the grid keeps a
     * stale pool after the filter changes.
     */
    const deps = pool.slice(pool.lastIndexOf("}, ["), pool.lastIndexOf("]"));
    for (const dep of ["ownership", "group", "availability", "offers"]) {
      expect(deps, `${dep} must be a dependency of the pool`).toContain(dep);
    }
  });

  it("is never folded into the ownership control", () => {
    const ownership = code("src/lib/catalog/ownership.ts");
    expect(ownership).toContain('OWNERSHIP_MODES = ["all", "owned", "missing"]');
    expect(ownership).not.toContain("available");
  });
});

describe("it costs no request", () => {
  it("reads the offers the page already handed down", () => {
    const src = code("src/lib/catalog/availability.ts");
    for (const forbidden of ["fetch(", "await", "createClient", "supabase", "useEffect"]) {
      expect(src, `${forbidden} would make a filter load something`).not.toContain(forbidden);
    }
  });

  it("and the catalog page asks for nothing new", () => {
    const page = code("src/app/(public)/(catalog)/page.tsx");
    // The same one call that already fed the cards and the quick view.
    expect(page.match(/fetchOffers\(\)/g)).toHaveLength(1);
  });

  it("the filter panel loads nothing when it opens", () => {
    const sheet = code("src/components/ui/filter-sheet.tsx");
    for (const forbidden of ["fetch(", "useEffect", "createClient"]) {
      expect(sheet).not.toContain(forbidden);
    }
  });
});

describe("the collection stays commerce-free", () => {
  it("has no availability filter", () => {
    const view = code("src/components/collection/collection-view.tsx");
    for (const commerce of ["availability", "Availability", "Mit Angebot", "OfferLink", "fetchOffers"]) {
      expect(view, `${commerce} is not part of this page`).not.toContain(commerce);
    }
  });

  it("and its page still loads no offers", () => {
    const page = code("src/app/(app)/collection/page.tsx");
    expect(page).not.toContain("fetchOffers");
    expect(page).not.toContain("offerRecord");
  });
});
