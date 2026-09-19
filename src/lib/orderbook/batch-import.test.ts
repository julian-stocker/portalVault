/**
 * The batch importer (ADR-0088).
 *
 * WHY THIS FILE EXISTS AT ALL
 *
 * The pilot was applied by a script that was written once, run once and
 * deleted. Everything worth trusting in it — which group is which, what counts
 * as already imported, what must never be written — lived only in that script.
 * When the same logic had to be rebuilt here, the single most load-bearing
 * detail turned out to be a regex in the sheet parser: a self-closing
 * `<c r="A6"/>` swallowed the two cells after it, column C read as empty on
 * every row but the first, and the fingerprint of the ONE purchase already in
 * the database silently stopped matching. The importer cheerfully offered to
 * import purchase #6 a second time.
 *
 * Nothing about that was visible from the output. It is visible here.
 */
import { describe, expect, it } from "vitest";

import { code, latestFunction } from "@/test-support/migrations";
import {
  applyBatch, buildPayload, canonicalPurchaseIdentity, isDuplicateFingerprint,
  planBatch, planGroup, purchaseFingerprint, sourceNote,
  PURCHASE_FINGERPRINT_VERSION,
  type GroupPlan, type PlanDeps,
} from "./batch-import.ts";
import {
  groupRows, indexCatalog, parseOrderSheet,
  type CatalogEntry, type PurchaseGroup, type RawRow,
} from "./order-2026.ts";

const CATALOG: CatalogEntry[] = [
  { skyId: "SKY-0371", name: "Mini Bop", series: "T" },
  { skyId: "SKY-0387", name: "Mini Whisper Elf", series: "T" },
  { skyId: "SKY-0157", name: "Drobot Light Core", series: "G" },
  { skyId: "SKY-0028", name: "Drobot", series: "SA" },
];
const STOCK: Record<string, string> = {
  "T|74": "Mini Bop", "T|90": "Mini Whisper Elf",
  "G|55": "Drobot Light Core", "G|54": "Drobot", "SA|32": "Drobot",
  "ZB|8": "0000502 (G)",
};
const deps = (over: Partial<PlanDeps> = {}): PlanDeps => ({
  stockName: (sheet, row) => STOCK[`${sheet}|${row}`] ?? null,
  bySheetName: indexCatalog(CATALOG),
  mappings: new Map(),
  imported: new Set<string>(),
  ...over,
});

const raw = (over: Partial<RawRow> = {}): RawRow =>
  ({ row: 1, a: "", b: "", c: "x", d: "x", e: "1", f: "Bob", g: "", gFormula: "T!I74", h: "", i: "", ...over });

const group = (over: Partial<PurchaseGroup> = {}): PurchaseGroup => ({
  headerRow: 4, firstRow: 5, lastRow: 6, date: "2025-12-06", rawDate: "45997",
  totalCost: 288.14, items: [raw({ row: 5 })], ...over,
});

describe("the fingerprint is the identity, and it already has a value in the database", () => {
  it("is the exact scheme purchase #6 was imported with", () => {
    /*
     * Load-bearing in a way a version string usually is not. Purchase #6 on
     * Staging carries a fingerprint computed from this constant; change it and
     * the group that IS imported looks new, and the importer offers a twin.
     */
    expect(PURCHASE_FINGERPRINT_VERSION).toBe("orderbuch-order2026-1");
  });

  it("reproduces purchase #6's stored fingerprint from the workbook's own cells", async () => {
    /*
     * The real pilot group, transcribed from `Order 2026!A:I` rows 5–18 with
     * the sky_ids the database actually holds. If the parser, the classifier or
     * the canonical form drifts, this is what notices.
     */
    const rows: [number, string, string][] = [
      [5, "Mini Jini", "SKY-0377"], [6, "Bob", "SKY-0371"], [7, "Trigger Snappy", "SKY-0384"],
      [8, "Pet Vac", "SKY-0378"], [9, "Barkley", "SKY-0369"], [10, "Thumpling", "SKY-0383"],
      [11, "Small Fry", "SKY-0380"], [12, "Spry", "SKY-0381"], [13, "Terrabite", "SKY-0382"],
      [14, "Drobit", "SKY-0373"], [15, "Breeze", "SKY-0372"], [16, "Mini Elf", "SKY-0387"],
      [17, "Gill Runt", "SKY-0375"], [18, "Weeruptor", "SKY-0385"],
    ];
    const classified = rows.map(([sourceRow, rawName, skyId], index) => ({
      sourceRow, position: index + 1, rawName,
      legacyConditionFlag: "x", legacyBookedFlag: "x",
      resolvedName: null, sheet: "T", classification: "matched" as const,
      skyId, evidence: "formula" as const, note: null,
    }));
    const fingerprint = await purchaseFingerprint(
      { headerRow: 4, date: "2025-12-06", totalCost: 288.14 }, classified);
    expect(fingerprint).toBe("2f5fbb11a50f267b4058a063a2ee9d4659b0aced93860dadfe6d07093a65cb57");
  });

  it("is recognised by fingerprint, never by database id", async () => {
    // "Is this purchase #6?" is not a question the workbook can answer.
    const source = code(await Promise.resolve(canonicalPurchaseIdentity(group(), [])));
    expect(source).not.toContain('"id"');
    const plan = await planGroup(group(), deps({ imported: new Set(["nope"]) }));
    expect(plan.status).toBe("eligible");
    const second = await planGroup(group(), deps({ imported: new Set([plan.fingerprint]) }));
    expect(second.status).toBe("already_imported");
  });

  it("covers the SOURCE rows, damaged ones included", async () => {
    /*
     * The fingerprint answers "is this the same parcel?" and the parcel did
     * contain the damaged rows. Keying it on the migrated subset would make
     * every already-imported purchase look new the next time the damage rule
     * moved.
     */
    const withDamaged = group({ items: [raw({ row: 5 }), raw({ row: 6, c: "b", f: "Chill (B)", gFormula: "" })] });
    const withoutDamaged = group({ items: [raw({ row: 5 })] });
    expect(await purchaseFingerprint(withDamaged, (await planGroup(withDamaged, deps())).preview.all))
      .not.toBe(await purchaseFingerprint(withoutDamaged, (await planGroup(withoutDamaged, deps())).preview.all));
  });

  it("separates two purchases made on the same day", async () => {
    // 2025-12-06 is two parcels. Only the header row tells them apart.
    const first = group({ headerRow: 4, firstRow: 5, lastRow: 18 });
    const second = group({ headerRow: 19, firstRow: 20, lastRow: 63 });
    expect((await planGroup(first, deps())).fingerprint)
      .not.toBe((await planGroup(second, deps())).fingerprint);
  });
});

describe("planning writes nothing", () => {
  it("planGroup and planBatch take no database handle at all", async () => {
    /*
     * Structural, not incidental: `PlanDeps` carries a stock lookup, a catalog
     * index, saved mappings and a set of fingerprints. There is no client to
     * call, so a preview cannot write however it is invoked.
     */
    const plan = await planBatch([group()], deps());
    expect(plan.eligible).toHaveLength(1);
    expect(Object.keys(deps()).sort()).toEqual(["bySheetName", "imported", "mappings", "stockName"]);
  });

  it("the source note points back at the workbook, not at anything it created", () => {
    expect(sourceNote({ headerRow: 4, firstRow: 5, lastRow: 18,
                        date: "2025-12-06", rawDate: "45997" }))
      .toBe("Order 2026, Kopfzeile 4, Zeilen 5–18");
    // An undated group carries the workbook's broken date as provenance —
    // the only trace left of a cell that no longer exists.
    expect(sourceNote({ headerRow: 1946, firstRow: 1947, lastRow: 1988,
                        date: null, rawDate: "#REF!" }))
      .toBe("Order 2026, Kopfzeile 1946, Zeilen 1947–1988 · Kaufdatum im Workbook: #REF!");
  });
});

describe("what reaches the payload", () => {
  it("excludes damaged rows and numbers the rest contiguously", async () => {
    const plan = await planGroup(group({
      items: [
        raw({ row: 5, f: "Bob", gFormula: "T!I74" }),
        raw({ row: 6, c: "b", f: "Chill (B)", gFormula: "T!I74" }),
        raw({ row: 7, f: "Golden Queen (D)", gFormula: "" }),
        raw({ row: 8, f: "Mini Elf", gFormula: "T!I90" }),
      ],
    }), deps());

    expect(plan.preview.ignoredDamaged).toHaveLength(2);
    expect(plan.payload.map((i) => i.source_row)).toEqual([5, 8]);
    expect(plan.payload.map((i) => i.position)).toEqual([1, 2]);
    // No gap at 2 and 3 where the two damaged rows were.
    expect(plan.payload.every((i) => !i.raw_name.includes("(B)") && !i.raw_name.includes("(D)"))).toBe(true);
  });

  it("keeps the raw Excel name even where the figure is named differently", async () => {
    const plan = await planGroup(group({ items: [raw({ row: 5, f: "Bob", gFormula: "T!I74" })] }), deps());
    expect(plan.payload[0]).toMatchObject({ raw_name: "Bob", sky_id: "SKY-0371", source_row: 5 });
  });

  it("row 69: the G reference wins over the text, and that is not an anomaly", async () => {
    const plan = await planGroup(group({
      items: [raw({ row: 69, f: "Drobot S2", gFormula: "G!I55" })],
    }), deps());
    expect(plan.payload[0]).toMatchObject({ raw_name: "Drobot S2", sky_id: "SKY-0157" });
    expect(plan.status).toBe("eligible");
    expect(plan.reason).toBeNull();
  });

  it("a saved mapping does not override a resolvable reference", async () => {
    const plan = await planGroup(group({ items: [raw({ row: 5, f: "Bob", gFormula: "T!I74" })] }),
      deps({ mappings: new Map([["bob", "SKY-0387"]]) }));
    expect(plan.payload[0].sky_id).toBe("SKY-0371");
  });

  it("a remembered non-figure imports as an item with no figure", async () => {
    const plan = await planGroup(group({
      items: [raw({ row: 5, f: "0000502 (G)", gFormula: "ZB!I8" })],
    }), deps({ mappings: new Map([["0000502 g", null]]) }));
    expect(plan.preview.byClassification.uncategorized).toBe(1);
    expect(plan.preview.byClassification.unmatched).toBe(0);
    expect(plan.payload).toHaveLength(1);
    expect(plan.payload[0]).toMatchObject({ sky_id: null, raw_name: "0000502 (G)" });
  });

  it("condition is `loose` and never guessed from a name", () => {
    const payload = buildPayload([{
      sourceRow: 5, position: 1, rawName: "Something OVP", legacyConditionFlag: "x",
      legacyBookedFlag: "x", resolvedName: null, sheet: null,
      classification: "uncategorized", skyId: null, evidence: "none", note: null,
    }]);
    expect(payload[0].condition).toBe("loose");
  });
});

describe("the purchase total is the workbook's, whatever is dropped", () => {
  it("planGroup carries the group's own Ausgaben and never recomputes it", async () => {
    const withDamaged = await planGroup(group({
      totalCost: 77.27,
      items: [raw({ row: 5 }), ...[6, 7, 8, 9].map((row) => raw({ row, c: "b", f: `X (B)`, gFormula: "" }))],
    }), deps());
    expect(withDamaged.totalCost).toBe(77.27);
    expect(withDamaged.payload).toHaveLength(1);
    // Four of five rows discarded, and the parcel still cost 77,27.
  });

  it("and the database function takes it as its own argument", () => {
    const fn = code(latestFunction("seller_import_purchase_group").body);
    expect(fn).toContain("p_total_cost");
    expect(fn).not.toMatch(/sum\s*\(\s*[^)]*r->>/i);
  });
});

describe("only the canonical writer writes", () => {
  it("the batch importer contains no insert of its own", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("src/lib/orderbook/batch-import.ts", "utf8");
    for (const forbidden of ["from(\"purchases\")", "from(\"purchase_items\")", "insert(", "upsert("]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("the entry point calls seller_import_purchase_group and nothing else that writes", async () => {
    const { readFileSync } = await import("node:fs");
    const tool = readFileSync("tools/import-orderbook.mts", "utf8");
    expect(tool).toContain('client.rpc("seller_import_purchase_group"');
    for (const forbidden of ["record_inventory_movement", "seller_book_purchase_item",
                             "SUPABASE_SERVICE_ROLE_KEY", ".insert(", ".delete("]) {
      expect(tool, forbidden).not.toContain(forbidden);
    }
  });

  it("and that function creates no movement for any row", () => {
    const fn = code(latestFunction("seller_import_purchase_group").body);
    expect(fn).toContain("'reconciled_legacy'");
    for (const forbidden of ["record_inventory_movement", "apply_inventory_movement", "shop_inventory"]) {
      expect(fn, forbidden).not.toContain(forbidden);
    }
  });
});

describe("applying a batch", () => {
  const plans = async (): Promise<GroupPlan[]> => [
    await planGroup(group({ headerRow: 4 }), deps()),
    await planGroup(group({ headerRow: 19 }), deps()),
    await planGroup(group({ headerRow: 64 }), deps()),
  ];

  it("writes each group once, in worksheet order", async () => {
    const seen: number[] = [];
    let id = 100;
    const result = await applyBatch(await plans(), async (p) => { seen.push(p.headerRow); return { id: id += 1 }; });
    expect(seen).toEqual([4, 19, 64]);
    expect(result.imported).toBe(3);
    expect(result.failedAt).toBeNull();
  });

  it("skips an already-imported group without calling the database", async () => {
    const list = await plans();
    const already = { ...list[0], status: "already_imported" as const };
    const called: number[] = [];
    const result = await applyBatch([already, ...list.slice(1)], async (p) => {
      called.push(p.headerRow); return { id: 1 };
    });
    expect(called).not.toContain(4);
    expect(result.skipped).toBe(1);
    expect(result.imported).toBe(2);
  });

  it("treats a unique-violation as already imported, not as a failure", async () => {
    /*
     * The race: two runs, one fingerprint. The loser must not report an error
     * and must certainly not retry — the outcome it wanted has happened.
     */
    const result = await applyBatch(await plans(), async () => ({ duplicate: true as const }));
    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(3);
    expect(result.failedAt).toBeNull();
    expect(result.results.every((r) => r.outcome === "already_imported")).toBe(true);
  });

  it("recognises what Postgres actually says when the index refuses", () => {
    expect(isDuplicateFingerprint({ code: "23505" })).toBe(true);
    expect(isDuplicateFingerprint({ message: 'duplicate key value violates unique constraint "purchases_import_fingerprint_uniq"' })).toBe(true);
    expect(isDuplicateFingerprint({ code: "42501", message: "seller operator role required" })).toBe(false);
  });

  it("stops at the first real failure and reports exactly what got through", async () => {
    const result = await applyBatch(await plans(), async (p) =>
      p.headerRow === 19 ? { error: "boom" } : { id: 200 });
    expect(result.imported).toBe(1);
    expect(result.failedAt).toBe(19);
    // The third group was never attempted — not "maybe written".
    expect(result.results).toHaveLength(2);
    expect(result.results[1]).toMatchObject({ headerRow: 19, outcome: "failed", message: "boom" });
  });

  it("never deletes an earlier success to make the batch look atomic", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("src/lib/orderbook/batch-import.ts", "utf8");
    for (const forbidden of ["seller_delete_purchase", "rollback", "compensat"]) {
      expect(source.toLowerCase(), forbidden).not.toContain(forbidden);
    }
  });

  it("a re-run after a partial failure imports only what is missing", async () => {
    // First run: group 19 fails, group 4 is in.
    const first = await applyBatch(await plans(), async (p) =>
      p.headerRow === 19 ? { error: "network" } : { id: 300 });
    expect(first.imported).toBe(1);

    // Second run: group 4's fingerprint is now taken, so it is skipped.
    const done = new Set([(await plans())[0].fingerprint]);
    const replanned = await planBatch(
      [group({ headerRow: 4 }), group({ headerRow: 19 }), group({ headerRow: 64 })],
      deps({ imported: done }));
    expect(replanned.alreadyImported).toHaveLength(1);
    expect(replanned.eligible).toHaveLength(2);

    const second = await applyBatch(replanned.plans, async () => ({ id: 400 }));
    expect(second.imported).toBe(2);
    expect(second.skipped).toBe(1);
  });
});

describe("a group whose source is unsound is blocked, not guessed at", () => {
  it("a missing date is NOT unsound — it is a purchase waiting for one", async () => {
    /*
     * This asserted `blocked` until the owner decided otherwise, and he was
     * right: thirteen groups carry `#REF!` where their date formula was, and
     * the money was still spent. They import with `purchased_at` NULL.
     */
    const plan = await planGroup(group({ date: null, rawDate: "#REF!" }), deps());
    expect(plan.status).toBe("eligible");
    expect(plan.date).toBeNull();
    expect(plan.reason).toBeNull();
    // …and the broken source date survives as provenance.
    expect(plan.note).toContain("#REF!");
  });

  it("and no date is ever invented for it", async () => {
    const plan = await planGroup(group({ date: null, rawDate: "#REF!" }), deps());
    // Not January the first, not the neighbour's date, not today — null.
    expect(plan.date).toBeNull();
    expect(typeof plan.date).not.toBe("string");
  });

  it("no Ausgaben", async () => {
    expect((await planGroup(group({ totalCost: null }), deps())).status).toBe("blocked");
  });

  it("an Excel error value among the item names", async () => {
    const plan = await planGroup(group({ items: [raw({ row: 5, f: "#REF!", gFormula: "" })] }), deps());
    expect(plan.status).toBe("blocked");
    expect(plan.reason).toContain("Excel-Fehlerwert");
  });

  it("and a blocked group stops the batch before it is written", async () => {
    const blocked = await planGroup(group({ headerRow: 19, totalCost: null }), deps());
    const fine = await planGroup(group({ headerRow: 4 }), deps());
    const written: number[] = [];
    const result = await applyBatch([fine, blocked], async (p) => { written.push(p.headerRow); return { id: 1 }; });
    expect(written).toEqual([4]);
    expect(result.failedAt).toBe(19);
  });
});

describe("the sheet parser, where the fingerprint actually broke", () => {
  const xml = (body: string) => `<sheetData>${body}</sheetData>`;

  it("a self-closing cell does not swallow the cells after it", () => {
    /*
     * THE BUG, PINNED. `[^>]*` eats the `/` of `<c r="A6" s="6"/>` and then
     * matches the `>…</c>` branch, consuming B6 and C6 with it. Column C read
     * as empty on every row but the first of each group, and the fingerprint of
     * the one purchase already in the database stopped matching.
     */
    const rows = parseOrderSheet(xml(
      `<row r="6"><c r="A6" s="6"/><c r="B6" s="10"/><c r="C6" t="s"><v>0</v></c>` +
      `<c r="D6" t="s"><v>0</v></c><c r="F6" t="s"><v>1</v></c>` +
      `<c r="G6"><f>T!I74</f><v>4.39</v></c></row>`), ["x", "Bob"]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ row: 6, a: "", b: "", c: "x", d: "x", f: "Bob", gFormula: "T!I74" });
  });

  it("reads the formula, not the cached price — the price cannot name a figure", () => {
    const rows = parseOrderSheet(xml(
      `<row r="5"><c r="G5"><f>T!I80</f><v>4.49</v></c></row>`), []);
    expect(rows[0].gFormula).toBe("T!I80");
    expect(rows[0].g).toBe("4.49");
  });

  it("keeps #REF! instead of dropping it", () => {
    // A broken date must look broken, not missing.
    const rows = parseOrderSheet(xml(`<row r="1947"><c r="A1947" t="e"><f>#REF!</f><v>#REF!</v></c></row>`), []);
    expect(rows[0].a).toBe("#REF!");
  });

  it("groups split on the `Date` header, so same-day parcels stay apart", () => {
    const rows: RawRow[] = [
      { ...raw({ row: 4, a: "Date", f: "" }) },
      { ...raw({ row: 5, a: "45997", b: "288.14", f: "Bob" }) },
      { ...raw({ row: 19, a: "Date", f: "" }) },
      { ...raw({ row: 20, a: "45997", b: "67.02", f: "Warnado" }) },
    ];
    const groups = groupRows(rows);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.date)).toEqual(["2025-12-06", "2025-12-06"]);
    expect(groups.map((g) => g.totalCost)).toEqual([288.14, 67.02]);
  });
});
