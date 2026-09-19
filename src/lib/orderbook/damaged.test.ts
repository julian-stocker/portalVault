/**
 * Damaged historical rows are not migrated at all.
 *
 * THE DECISION, AND WHY IT REPLACES THE LAST ONE
 *
 * The previous design gave a damaged copy a canonical `sky_id`, kept it as a
 * `reconciled_legacy` item and left its market value an open question. The
 * owner has withdrawn that: these figures were thrown away years ago and are
 * never sold, so an Orderbuch row for one is an identity, a valuation and an
 * operator decision spent on an object that does not exist.
 *
 * WHAT THAT COSTS IF IT LEAKS THE OTHER WAY
 *
 * The rule cuts rows out of an audited dataset, so the two failure directions
 * are not symmetric. Ignoring one row too many silently loses a purchased item
 * from the ledger; ignoring one too few puts a discarded figure back in the
 * Orderbuch. Both are wrong, and neither announces itself — which is why the
 * union of the three signals, the count, and the untouched purchase total are
 * pinned here rather than left to the preview to describe.
 */
import { describe, expect, it } from "vitest";

import { code, latestFunction } from "@/test-support/migrations";
import {
  classifyGroup, classifyItem, indexCatalog, isLegacyDamaged,
  type CatalogEntry, type RawRow,
} from "./order-2026";

const IMPORT_FN = code(latestFunction("seller_import_purchase_group").body);

const raw = (over: Partial<RawRow> = {}): RawRow =>
  ({ row: 6, a: "", b: "", c: "x", d: "x", e: "2", f: "Something", g: "", gFormula: "", h: "", i: "", ...over });

const CATALOG: CatalogEntry[] = [
  { skyId: "SKY-0371", name: "Mini Bop", series: "T" },
  { skyId: "SKY-0157", name: "Drobot Light Core", series: "G" },
  { skyId: "SKY-0028", name: "Drobot", series: "SA" },
];
const index = indexCatalog(CATALOG);
const STOCK: Record<string, string> = {
  "T|74": "Mini Bop", "G|55": "Drobot Light Core", "G|54": "Drobot", "SA|32": "Drobot",
  "ZB|8": "0000502 (G)",
};
const stock = (sheet: string, row: number) => STOCK[`${sheet}|${row}`] ?? null;
const classify = (r: RawRow, mappings = new Map<string, string | null>()) =>
  classifyItem(r, 1, stock, index, mappings);

describe("any one legacy damage signal is enough", () => {
  it("column C = b", () => {
    expect(classify(raw({ c: "b", f: "Roller Brawl" })).classification).toBe("ignored_damaged");
  });

  it("the name carries (B)", () => {
    expect(classify(raw({ f: "Flameslinger (B)" })).classification).toBe("ignored_damaged");
  });

  it("the name carries (D) — which means beschädigt, not Dark", () => {
    expect(classify(raw({ f: "Golden Queen (D)" })).classification).toBe("ignored_damaged");
  });

  it("lower case counts, for both the column and the suffix", () => {
    expect(classify(raw({ c: "B", f: "x" })).classification).toBe("ignored_damaged");
    expect(classify(raw({ f: "roller brawl (b)" })).classification).toBe("ignored_damaged");
    expect(classify(raw({ f: "hex s2 (d)" })).classification).toBe("ignored_damaged");
  });

  it("and the signals do NOT have to agree", () => {
    /*
     * Measured on the workbook: 8 rows carry `C = b` with no suffix, and 7
     * carry a suffix while `C` says `x` or nothing. Requiring both would miss
     * fifteen damaged rows; requiring a specific one would miss one group.
     */
    expect(isLegacyDamaged({ c: "b", f: "Hot Dog" })).toBe(true);        // column only
    expect(isLegacyDamaged({ c: "x", f: "Hex (B)" })).toBe(true);        // suffix only
    expect(isLegacyDamaged({ c: "", f: "hex s2 (b)" })).toBe(true);      // suffix, C unset
    expect(isLegacyDamaged({ c: "x", f: "Hex" })).toBe(false);
  });
});

describe("what the damage marker must NOT swallow", () => {
  it("(Dark) is a variant name, not a damage marker", () => {
    // `Blast Zone (Dark)` and `Dark Golden Queen` are real catalog figures.
    expect(isLegacyDamaged({ c: "x", f: "Blast Zone (Dark)" })).toBe(false);
    expect(isLegacyDamaged({ c: "x", f: "Dark Golden Queen" })).toBe(false);
  });

  it("a parenthesised series or article code is not a damage marker", () => {
    for (const name of ["0000502 (G)", "0000547 (SF)", "Hex (Pearl)", "Flashwing (Jade)"]) {
      expect(isLegacyDamaged({ c: "x", f: name }), name).toBe(false);
    }
  });

  it("C = '-' or 'x' is not damage", () => {
    expect(isLegacyDamaged({ c: "-", f: "Chill" })).toBe(false);
    expect(isLegacyDamaged({ c: "x", f: "Chill" })).toBe(false);
  });
});

describe("damage is asked before anything else", () => {
  it("a damaged row with a perfectly good formula is still ignored", () => {
    /*
     * The one that matters. `T!I74` resolves to Mini Bop and would have matched
     * cleanly — the row is dropped anyway, because the figure is gone.
     */
    const r = classify(raw({ c: "b", f: "Bob", gFormula: "T!I74" }));
    expect(r.classification).toBe("ignored_damaged");
    expect(r.skyId).toBeNull();
    expect(r.evidence).toBe("none");
  });

  it("a damaged row with a saved mapping is still ignored", () => {
    const r = classify(raw({ f: "Chill (B)" }), new Map([["chill b", "SKY-0371"]]));
    expect(r.classification).toBe("ignored_damaged");
    expect(r.skyId).toBeNull();
  });

  it("and it never acquires an identity to remember", () => {
    // Nothing to map: a damaged name needs no future resolution.
    const r = classify(raw({ c: "b", f: "Drobot LC (B)", gFormula: "G!I55" }));
    expect(r.skyId).toBeNull();
    expect(r.resolvedName).toBeNull();
  });
});

describe("a non-figure is kept, not ignored — the distinction is the point", () => {
  it("a portal stays an uncategorized purchase item", () => {
    /*
     * A portal cost money and was not thrown away. It has no catalog figure and
     * never will, but it belongs to the purchase. A damaged figure is the
     * opposite case: it HAS an identity and is gone.
     *
     * It used to read `unmatched` — "we looked and found nothing" — which was
     * true of the catalog and wrong about the object. The `ZB` destination says
     * outright that it is Zubehör, so the row is intentionally uncategorized.
     */
    const r = classify(raw({ f: "0000502 (G)", gFormula: "ZB!I8" }));
    expect(r.classification).not.toBe("ignored_damaged");
    expect(r.classification).toBe("uncategorized");
    expect(r.evidence).toBe("formula");
    expect(r.skyId).toBeNull();
    expect(r.rawName).toBe("0000502 (G)");
  });

  it("a Swap Force half with no reference stays uncategorized", () => {
    const r = classify(raw({ f: "Blastzone - OBERTEIL" }));
    expect(r.classification).toBe("uncategorized");
    expect(r.skyId).toBeNull();
  });

  it("and a remembered non-figure is uncategorized by mapping, still not ignored", () => {
    const r = classify(raw({ f: "0000547 (SF)" }), new Map([["0000547 sf", null]]));
    expect(r.classification).toBe("uncategorized");
    expect(r.evidence).toBe("mapping");
  });
});

describe("the G reference is the identity, whatever F says", () => {
  it("row 69: `Drobot S2` follows G!I55 to Drobot Light Core", () => {
    /*
     * `S2` means the Giants copy at `G!I54` in 155 of 155 rows the owner wrote,
     * so this row's own text argues for SKY-0028/SKY-0156. The formula says
     * `G!I55`. The formula is where the price always came from, so the formula
     * is the answer — and this is NOT an anomaly to review.
     */
    const r = classify(raw({ row: 69, f: "Drobot S2", gFormula: "G!I55", g: "1.49" }));
    expect(r.classification).toBe("matched");
    expect(r.skyId).toBe("SKY-0157");
    expect(r.resolvedName).toBe("Drobot Light Core");
    expect(r.evidence).toBe("formula");
    expect(r.note).toBeNull();          // nothing flagged, nothing to decide
    expect(r.rawName).toBe("Drobot S2"); // provenance kept verbatim
  });

  it("misleading free text never rejects or overrides a resolved reference", () => {
    const r = classify(raw({ f: "Completely Wrong Name", gFormula: "T!I74" }));
    expect(r.classification).toBe("matched");
    expect(r.skyId).toBe("SKY-0371");
    expect(r.rawName).toBe("Completely Wrong Name");
  });
});

describe("the preview accounts for every source row", () => {
  const items = [
    raw({ row: 10, f: "Bob", gFormula: "T!I74" }),          // matched
    raw({ row: 11, c: "b", f: "Chill (B)" }),               // damaged, both signals
    raw({ row: 12, f: "Golden Queen (D)" }),                // damaged, suffix only
    raw({ row: 13, c: "b", f: "Hot Dog" }),                 // damaged, column only
    raw({ row: 14, f: "Blastzone - OBERTEIL" }),            // uncategorized
    raw({ row: 15, f: "Drobot S2", gFormula: "G!I55" }),    // matched via formula
  ];
  const preview = classifyGroup(items, stock, index, new Map());

  it("source = migrated + ignored + invalid, with nothing unaccounted for", () => {
    expect(preview.sourceRows).toBe(6);
    expect(preview.migrated).toHaveLength(3);
    expect(preview.ignoredDamaged).toHaveLength(3);
    expect(preview.invalid).toHaveLength(0);
    expect(preview.migrated.length + preview.ignoredDamaged.length + preview.invalid.length)
      .toBe(preview.sourceRows);
  });

  it("counts a row carrying two damage signals once", () => {
    // Row 11 has C=b AND (B). One row, one count.
    expect(preview.byClassification.ignored_damaged).toBe(3);
  });

  it("ignored rows are returned, not just counted", () => {
    expect(preview.ignoredDamaged.map((i) => i.sourceRow)).toEqual([11, 12, 13]);
    // …and keep their raw name, so the audit can show what was discarded.
    expect(preview.ignoredDamaged.map((i) => i.rawName)).toEqual(
      ["Chill (B)", "Golden Queen (D)", "Hot Dog"]);
  });

  it("no ignored row carries an identity into the migrated set", () => {
    for (const item of preview.ignoredDamaged) expect(item.skyId).toBeNull();
    expect(preview.migrated.some((i) => i.rawName.includes("(B)"))).toBe(false);
    expect(preview.migrated.some((i) => i.rawName.includes("(D)"))).toBe(false);
  });

  it("positions are contiguous over the MIGRATED items, with no gap where a row was dropped", () => {
    /*
     * Counting positions over source rows would leave 1, 5, 6 here, and every
     * later reader would have to guess whether the gap meant "discarded" or
     * "lost".
     */
    expect(preview.migrated.map((i) => i.position)).toEqual([1, 2, 3]);
    expect(preview.migrated.map((i) => i.sourceRow)).toEqual([10, 14, 15]);
  });

  it("the source row of every migrated item still points back at the workbook", () => {
    for (const item of preview.migrated) expect(item.sourceRow).toBeGreaterThan(0);
  });
});

describe("skipping damaged rows cannot touch the purchase total", () => {
  it("total_cost comes from the group header, never from the items", () => {
    /*
     * The parcel cost what it cost. There is no per-item acquisition cost to
     * subtract, and inventing one would rewrite history to make an arithmetic
     * identity hold.
     */
    const withDamaged = classifyGroup(
      [raw({ row: 1, f: "Bob", gFormula: "T!I74" }), raw({ row: 2, c: "b", f: "Chill (B)" })],
      stock, index, new Map());
    const withoutDamaged = classifyGroup(
      [raw({ row: 1, f: "Bob", gFormula: "T!I74" })], stock, index, new Map());

    // The classifier never returns a cost at all — that is the guarantee.
    expect(withDamaged).not.toHaveProperty("totalCost");
    expect(withDamaged.migrated).toEqual(withoutDamaged.migrated);
  });

  it("and the import function takes the cost as its own argument", () => {
    // `p_total_cost` is a parameter of seller_import_purchase_group, never
    // derived from `p_items` — so dropping items cannot move it.
    expect(IMPORT_FN).toContain("p_total_cost");
    expect(IMPORT_FN).not.toMatch(/sum\s*\(\s*[^)]*r->>/i);
  });
});

describe("an ignored row reaches neither the purchase nor the ledger", () => {
  it("the import payload is built from `migrated`, and nothing else has a position", () => {
    const preview = classifyGroup(
      [raw({ row: 1, c: "b", f: "Chill (B)" })], stock, index, new Map());
    expect(preview.migrated).toHaveLength(0);
    // Position 0 is not a payload position; it marks a row that is not going.
    expect(preview.ignoredDamaged[0].position).toBe(0);
  });

  it("the historical import creates no movement for ANY row, ignored or not", () => {
    /*
     * The stronger guarantee, and the one that makes the damage rule safe: the
     * import writes `reconciled_legacy` and never calls the ledger, so there is
     * no path by which recognising damage could move stock.
     */
    expect(IMPORT_FN).toContain("'reconciled_legacy'");
    expect(IMPORT_FN).not.toContain("record_inventory_movement");
    expect(IMPORT_FN).not.toContain("apply_inventory_movement");
    expect(IMPORT_FN).not.toContain("shop_inventory");
  });
});
