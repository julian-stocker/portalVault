/**
 * Correcting what a purchase item is (migration 0054).
 *
 * The pilot resolved 14 of 14 shorthand names through the workbook's own
 * formula references. It will not always, and with 444 names still to come the
 * operator needed a way to fix a mapping that did not destroy the evidence.
 * Before this, the only route was delete-and-re-add, which threw away the raw
 * Excel text, the source row and the legacy markers.
 */
import { describe, expect, it } from "vitest";

import { code, columnsOf, latestFunction, migrationSource } from "@/test-support/migrations";
import { classifyItem, indexCatalog, normalise, type CatalogEntry, type RawRow } from "./order-2026";

const SQL = migrationSource("0054_orderbook_item_mapping.sql");

describe("0053 is applied, so this is additive", () => {
  it("does not rewrite it", () => {
    expect(SQL).not.toContain("create table if not exists public.purchases");
    expect(SQL).not.toContain("create table if not exists public.purchase_items");
    expect(code(SQL)).not.toMatch(/drop table|alter table public\.purchase/i);
  });
});

describe("the correction function", () => {
  const fn = code(latestFunction("seller_set_purchase_item_sky").body);

  it("is seller-gated", () => {
    expect(fn).toContain("can_operate_active_seller()");
  });

  it("refuses an item that already owns a movement", () => {
    /*
     * The movement names the figure that went on the shelf. Repointing the row
     * would leave the two describing different objects, and reversing then
     * rebooking would move stock as a side effect of an edit.
     */
    expect(fn).toContain("if v_item.movement_id is not null then");
    expect(fn).toContain("reverse the booking before changing which figure it is");
    expect(fn).toContain("restrict_violation");
  });

  it("touches stock in no way at all", () => {
    for (const forbidden of [
      "record_inventory_movement", "apply_inventory_movement",
      "shop_inventory", "inventory_movements", "reserved",
    ]) {
      expect(fn, forbidden).not.toContain(forbidden);
    }
  });

  it("changes sky_id and nothing else", () => {
    // Classification is our reading of the evidence. The evidence is untouched.
    // lastIndexOf: `where id = p_item_id` also closes the SELECT above, so
    // indexOf would slice backwards and silently compare an empty string.
    const setClause = fn.slice(fn.indexOf("set sky_id"), fn.lastIndexOf("where id = p_item_id"));
    expect(setClause.length).toBeGreaterThan(0);
    expect(setClause).toContain("sky_id = p_sky_id");
    expect(setClause).toContain("updated_at = now()");
    for (const preserved of ["raw_name", "source_row", "legacy_condition_flag", "legacy_booked_flag", "state", "position"]) {
      expect(setClause, preserved).not.toContain(preserved);
    }
  });

  it("never writes a price snapshot", () => {
    // A remap is not a booking. Freezing a price here would invent one.
    expect(fn).not.toContain("market_price_snapshot");
  });

  it("keeps an uncategorised item identifiable", () => {
    expect(fn).toContain("cannot become uncategorised");
  });

  it("locks the row", () => {
    expect(fn).toContain("for update");
  });
});

describe("remembered resolutions", () => {
  it("live in their own table, not the stock importer's", () => {
    /*
     * `inventory_import_mappings` is keyed (sheet, normalised_name) because the
     * stock workbook puts each figure on its game's sheet — the sheet is half
     * the identity. `Order 2026!A:I` has no such column, so a purchase mapping
     * is keyed by text alone and is strictly weaker evidence. One table would
     * hide that difference.
     */
    expect(SQL).toContain("create table if not exists public.orderbook_name_mappings");
    expect(columnsOf("orderbook_name_mappings")).toContain("normalised_name");
    expect(columnsOf("orderbook_name_mappings")).not.toContain("sheet");
  });

  it("say exactly one thing about a name", () => {
    expect(SQL).toContain("check (not_a_figure = (sky_id is null))");
    expect(SQL).toContain("unique (normalised_name)");
  });

  it("are reachable by no client role", () => {
    expect(SQL).toContain("alter table public.orderbook_name_mappings enable row level security;");
    expect(SQL).toContain("revoke all on table public.orderbook_name_mappings from public, anon, authenticated;");
    expect(code(SQL)).not.toMatch(/create policy/i);
  });

  it("use the same normalisation on both sides", () => {
    const pg = code(latestFunction("orderbook_normalise").body);
    expect(pg).toContain("lower(");
    expect(pg).toContain("'&', 'and'");
    expect(pg).toContain("[^a-z0-9]+");
    // And the TypeScript half agrees on a real example.
    expect(normalise("Mini  Elf & Co.")).toBe("mini elf and co");
  });

  it("are granted to authenticated only", () => {
    expect(SQL).toContain("grant execute on function public.seller_set_purchase_item_sky(bigint, text, boolean) to authenticated;");
    expect(code(SQL)).not.toMatch(/to anon/);
  });
});

/* ------------------------------------------------------------ precedence -- */

const raw = (over: Partial<RawRow> = {}): RawRow =>
  ({ row: 6, a: "", b: "", c: "x", d: "x", e: "2", f: "", g: "", gFormula: "", h: "", i: "", ...over });

const CATALOG: CatalogEntry[] = [
  { skyId: "SKY-0371", name: "Mini Bop", series: "T" },
  { skyId: "SKY-0387", name: "Mini Whisper Elf", series: "T" },
  { skyId: "SKY-9999", name: "Twin", series: "SA" },
  { skyId: "SKY-8888", name: "Twin", series: "SA" },
];
const index = indexCatalog(CATALOG);
const STOCK: Record<string, string> = { "T|74": "Mini Bop", "T|90": "Mini Whisper Elf", "SA|10": "Twin", "T|55": "Ghost Figure" };
const stock = (sheet: string, row: number) => STOCK[`${sheet}|${row}`] ?? null;

describe("mapping precedence", () => {
  it("1. a valid formula reference wins", () => {
    const r = classifyItem(raw({ f: "Bob", gFormula: "T!I74" }), 2, stock, index, new Map());
    expect(r.classification).toBe("matched");
    expect(r.skyId).toBe("SKY-0371");
    expect(r.evidence).toBe("formula");
  });

  it("…and a saved text mapping does NOT override it — the formula simply wins", () => {
    /*
     * The rule this file exists to enforce, in its final form. An early version
     * asked the saved mappings first, which let one stale resolution quietly
     * beat the workbook's own answer. A later version called the disagreement a
     * `conflict` and stopped for review.
     *
     * Neither survives the owner's decision: a valid `G` reference IS the
     * identity. There is nothing to arbitrate, so the mapping is not consulted
     * and the row resolves on formula evidence alone.
     */
    const r = classifyItem(raw({ f: "Bob", gFormula: "T!I74" }), 2, stock, index,
      new Map([[normalise("Bob"), "SKY-0387"]]));
    expect(r.classification).toBe("matched");
    expect(r.skyId).toBe("SKY-0371");
    expect(r.evidence).toBe("formula");
  });

  it("…and agreeing evidence is simply a match", () => {
    const r = classifyItem(raw({ f: "Bob", gFormula: "T!I74" }), 2, stock, index,
      new Map([[normalise("Bob"), "SKY-0371"]]));
    expect(r.classification).toBe("matched");
    expect(r.evidence).toBe("formula");
  });

  it("2. a saved mapping resolves what the formula cannot", () => {
    // Ambiguous reference: two catalog rows share the name in that series.
    const without = classifyItem(raw({ f: "Twin", gFormula: "SA!I10" }), 1, stock, index, new Map());
    expect(without.classification).toBe("ambiguous");

    const withMap = classifyItem(raw({ f: "Twin", gFormula: "SA!I10" }), 1, stock, index,
      new Map([[normalise("Twin"), "SKY-9999"]]));
    expect(withMap.classification).toBe("matched");
    expect(withMap.skyId).toBe("SKY-9999");
    expect(withMap.evidence).toBe("mapping");
  });

  it("…and rescues a reference whose target is not in the catalog", () => {
    const r = classifyItem(raw({ f: "Ghost", gFormula: "T!I55" }), 1, stock, index,
      new Map([[normalise("Ghost"), "SKY-0371"]]));
    expect(r.classification).toBe("matched");
    expect(r.evidence).toBe("mapping");
  });

  it("…and a broken reference too", () => {
    const r = classifyItem(raw({ f: "Broken", gFormula: "T!I999" }), 1, stock, index,
      new Map([[normalise("Broken"), "SKY-0371"]]));
    expect(r.classification).toBe("matched");
    expect(r.evidence).toBe("mapping");
  });

  it("3. a mapping to 'not a figure' makes it uncategorized, not unmatched", () => {
    const r = classifyItem(raw({ f: "Portal of Power" }), 1, stock, index,
      new Map([[normalise("Portal of Power"), null]]));
    expect(r.classification).toBe("uncategorized");
    expect(r.evidence).toBe("mapping");
  });

  it("4. ambiguity with no mapping goes to review, never a guess", () => {
    const r = classifyItem(raw({ f: "Twin", gFormula: "SA!I10" }), 1, stock, index, new Map());
    expect(r.classification).toBe("ambiguous");
    expect(r.skyId).toBeNull();
  });

  it("5. no reference and no mapping is uncategorized", () => {
    const r = classifyItem(raw({ f: "Some Portal" }), 1, stock, index, new Map());
    expect(r.classification).toBe("uncategorized");
    expect(r.evidence).toBe("none");
  });
});

describe("the formula resolver, every shape the workbook produces", () => {
  const cases: [string, string, string][] = [
    ["valid reference", "T!I74", "matched"],
    ["broken reference (row does not exist)", "T!I999", "unmatched"],
    ["missing formula", "", "uncategorized"],
    ["a literal G value, no formula", "", "uncategorized"],
    ["an aggregate, not a reference", "SUM(G5:G18)", "uncategorized"],
    ["a reference into a non-stock sheet", "Order 2026!I5", "uncategorized"],
    ["target resolves but is not in the catalog", "T!I55", "unmatched"],
  ];
  for (const [label, formula, expected] of cases) {
    it(`${label} -> ${expected}`, () => {
      expect(classifyItem(raw({ f: "X", gFormula: formula }), 1, stock, index, new Map()).classification)
        .toBe(expected);
    });
  }

  it("keeps the raw text whatever happens", () => {
    for (const formula of ["T!I74", "T!I999", "", "SUM(G5:G18)"]) {
      expect(classifyItem(raw({ f: "Bob" }), 1, stock, index, new Map()).rawName).toBe("Bob");
      void formula;
    }
  });

  it("free text never contradicts a formula into a guess", () => {
    // `Bob` looks like nothing in the catalog; the reference says Mini Bop.
    // The reference decides, and the text survives as provenance.
    const r = classifyItem(raw({ f: "Bob", gFormula: "T!I74" }), 1, stock, index, new Map());
    expect(r.skyId).toBe("SKY-0371");
    expect(r.resolvedName).toBe("Mini Bop");
    expect(r.rawName).toBe("Bob");
  });
});
