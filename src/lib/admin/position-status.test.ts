/**
 * `positionStatus()` — one answer per position, from the rules that already
 * exist (Lagerverwaltung V2, AP1).
 *
 * Each case is a real shape from the stock list: a figure on sale, a released
 * figure without a price, a sold-out listing, a figure in stock that nobody
 * released, an unreleased portal, an OVP row from before 0108.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { InventoryPosition } from "@/lib/admin/inventory-model";
import { isOffered } from "@/lib/admin/inventory-overview";
import type { CatalogFigure } from "@/lib/catalog/types";
import { de } from "@/lib/i18n/de";
import {
  POSITION_STATUSES, isPositionStatusKind, positionStatus, positionStatusCopy,
} from "./position-status";

function figure(over: Partial<CatalogFigure> = {}): CatalogFigure {
  return {
    skyId: "SKY-0001", name: "Bash", slug: "bash", seriesCode: "SA", seriesLabel: "SA",
    seriesPosition: 0, categoryPosition: 0, categoryName: "Figuren", categoryId: 1,
    catalogGroup: "figure", cardType: "standard", catalogVisible: true, canonicalName: "Bash",
    displayNameOverride: null, marketPrice: 10, imageFile: null, imageOverridePath: null,
    displayName: "Bash", sortBaseName: "Bash", sortVariantLabel: null,
    searchIndex: "bash", isActive: true, element: null, characterId: null, baseSkyId: null,
    itemType: "figure", ...over,
  };
}

function position(over: Partial<InventoryPosition> = {}): InventoryPosition {
  const quantity = over.quantity ?? 2;
  const reserved = over.reserved ?? 0;
  return {
    inventoryId: 1, skyId: "SKY-0001", condition: "loose",
    quantity, reserved, available: over.available ?? quantity - reserved,
    salePrice: null, effectivePrice: 9, priceSource: "automatic", isListed: true,
    note: null, updatedAt: "2026-11-10T00:00:00Z", figure: figure(), ...over,
  };
}

const PORTAL = (released: boolean, reason: string | null = null) =>
  position({
    skyId: "SKY-0700",
    figure: figure({ skyId: "SKY-0700", itemType: "portal", catalogVisible: false }),
    isListed: false,
    saleState: {
      itemType: "portal", saleReleased: released, deliveryScope: null, uskRating: null,
      sellable: false, reason,
    },
  });

describe("positionStatus — each kind from an existing rule", () => {
  it("released, priced, in stock, visible: offered — exactly when isOffered() says so", () => {
    const p = position();
    expect(isOffered(p)).toBe(true);
    expect(positionStatus(p)).toEqual({ kind: "offered", attention: "none" });
  });

  it("released without a shop price: a fix", () => {
    expect(positionStatus(position({ effectivePrice: null })))
      .toEqual({ kind: "listed_no_price", attention: "fix" });
  });

  it("no price outranks sold out — the price is what the operator can fix", () => {
    expect(positionStatus(position({ effectivePrice: null, quantity: 0 })).kind)
      .toBe("listed_no_price");
  });

  it("released, but the catalog row is hidden, inactive or missing: a fix", () => {
    for (const p of [
      position({ figure: figure({ catalogVisible: false }) }),
      position({ figure: figure({ isActive: false }) }),
      position({ figure: null }),
    ]) {
      expect(positionStatus(p)).toEqual({ kind: "listed_hidden", attention: "fix" });
    }
  });

  it("released and priced with nothing free: a sold-out listing, nothing to do", () => {
    expect(positionStatus(position({ quantity: 0 })))
      .toEqual({ kind: "listed_sold_out", attention: "none" });
    /* Everything reserved counts as nothing free — `available`, not `quantity`. */
    expect(positionStatus(position({ quantity: 2, reserved: 2 })).kind).toBe("listed_sold_out");
  });

  it("pieces free but not released: a decision, never an automatic release", () => {
    expect(positionStatus(position({ isListed: false })))
      .toEqual({ kind: "release_open", attention: "decision" });
  });

  it("not released and nothing free: nothing to do", () => {
    expect(positionStatus(position({ isListed: false, quantity: 0 })))
      .toEqual({ kind: "unlisted", attention: "none" });
  });

  it("an accessory without a sale release is not shop goods (ADR-0128)", () => {
    expect(positionStatus(PORTAL(false))).toEqual({ kind: "accessory", attention: "none" });
  });

  it("a released accessory follows the figure rules", () => {
    const released = { ...PORTAL(true), isListed: true, figure: figure({ itemType: "portal" }) };
    expect(positionStatus(released).kind).toBe(isOffered(released) ? "offered" : "listed_sold_out");
  });

  it("an OVP row is historical whatever its flags say (0108)", () => {
    expect(positionStatus(position({ condition: "boxed" })))
      .toEqual({ kind: "historical", attention: "none" });
    expect(positionStatus(position({ condition: "boxed", isListed: false, effectivePrice: null })).kind)
      .toBe("historical");
  });

  it("is pure: the position is not changed", () => {
    const p = position({ isListed: false });
    const before = JSON.stringify(p);
    positionStatus(p);
    positionStatusCopy(p);
    expect(JSON.stringify(p)).toBe(before);
  });
});

describe("positionStatusCopy — German words for every kind", () => {
  it("has a label and a sentence for each kind", () => {
    for (const kind of POSITION_STATUSES) {
      const entry = de.inventory.status[kind];
      expect(entry.label.length, kind).toBeGreaterThan(0);
      expect(entry.hint.length, kind).toBeGreaterThan(10);
    }
  });

  it("says what to do where something has to be done", () => {
    expect(positionStatusCopy(position({ effectivePrice: null })).hint).toContain("Preis setzen");
    expect(positionStatusCopy(position({ isListed: false })).hint).toContain("nach deiner Freigabe");
  });

  it("asks for a price before a release when there is none", () => {
    const copy = positionStatusCopy(position({ isListed: false, effectivePrice: null }));
    expect(copy.label).toBe("Freigabe offen");
    expect(copy.hint).toBe(de.inventory.status.releaseOpenNoPrice);
  });

  it("an accessory says the database's own reason, translated, never recomputed", () => {
    expect(positionStatusCopy(PORTAL(false, "delivery scope missing")).hint)
      .toBe(de.inventory.saleReasons["delivery scope missing"]);
    expect(positionStatusCopy(PORTAL(false)).hint).toBe(de.inventory.status.accessory.hint);
    /* An unknown reason falls back to the general sentence, not a raw code. */
    expect(positionStatusCopy(PORTAL(false, "something new")).hint)
      .toBe(de.inventory.status.accessory.hint);
  });

  it("recognises its own kinds only", () => {
    expect(isPositionStatusKind("offered")).toBe(true);
    expect(isPositionStatusKind("delete")).toBe(false);
    expect(isPositionStatusKind(null)).toBe(false);
  });
});

describe("the module only reads", () => {
  const SOURCE = readFileSync("src/lib/admin/position-status.ts", "utf8");

  it("calls no action and no database", () => {
    for (const forbidden of [
      "setListing", "setSaleRelease", "bookMovement", "supabase", "rpc(", "\"use server\"",
    ]) {
      expect(SOURCE, forbidden).not.toContain(forbidden);
    }
  });

  it("reuses the existing rules instead of restating them", () => {
    expect(SOURCE).toContain("isOffered(position)");
    expect(SOURCE).toContain("isShopGoods(position)");
    expect(SOURCE).toContain("isOperativeCondition(position.condition)");
  });
});
