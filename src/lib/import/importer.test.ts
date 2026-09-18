import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  IMPORT_CONDITION,
  SUPPORTED_SHEETS,
  classifyRow,
  normaliseName,
  reconcile,
  type Baseline,
  type CatalogEntry,
  type SavedMapping,
} from "@/lib/import/classify";
import { FIRST_DATA_ROW, parseSharedStrings, parseSheet } from "@/lib/import/sheet-rows";
import { latestFunction, migrationSource } from "@/test-support/migrations";

/**
 * The spreadsheet reconciliation (ADR-0087).
 *
 * The classifier and the reconciler are pure, so everything that decides what
 * happens to a row is tested here without a workbook. The fixtures are real
 * lines from the owner's file — including the four that caused the most
 * trouble: `Bash` (two games), `Elite Boomer - ohne OVP` (loose, despite the
 * letters OVP), `Free Ranger - OBERTEIL` (half a figure) and `Game (PC)`
 * (a valid SKY-ID that is not a figure).
 */

const SQL = migrationSource("0048_inventory_import.sql");

/** Executable SQL only: a header that explains a rule has to name it. */
const sqlCode = (sql: string) =>
  sql.replace(/^\s*--.*$/gm, "").replace(/comment on [\s\S]*?;\s*$/gim, "");

/** Executable TypeScript only, for the same reason. */
const tsCode = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Real rows from the real catalog. */
const CATALOG: CatalogEntry[] = [
  { skyId: "SKY-0001", name: "Game (PC)", series: "SA", category: "Spiele" },
  { skyId: "SKY-0011", name: "Bash", series: "SA", category: "Figuren" },
  { skyId: "SKY-0120", name: "Bash", series: "G", category: "Giants Series 2 Figuren" },
  { skyId: "SKY-0015", name: "Elite Boomer - ohne OVP", series: "SA", category: "Figuren" },
  { skyId: "SKY-0301", name: "Free Ranger", series: "SF", category: "SWAP Force" },
  { skyId: "SKY-0410", name: "Kaos in OVP", series: "I", category: "Senseis" },
  { skyId: "SKY-0063", name: "Hex", series: "G", category: "Figuren" },
];

function index(entries: CatalogEntry[]) {
  const bySeries = new Map<string, Map<string, CatalogEntry[]>>();
  const byId = new Map<string, CatalogEntry>();
  for (const entry of entries) {
    byId.set(entry.skyId, entry);
    if (!bySeries.has(entry.series)) bySeries.set(entry.series, new Map());
    const forSeries = bySeries.get(entry.series)!;
    forSeries.set(entry.name, [...(forSeries.get(entry.name) ?? []), entry]);
  }
  return { bySeries, byId };
}

const { bySeries, byId } = index(CATALOG);

function classify(
  sheet: string,
  name: string,
  storage: number | null,
  mappings: Map<string, SavedMapping> = new Map(),
) {
  return classifyRow({
    sheet,
    name,
    storage,
    bySeriesName: bySeries.get(sheet) ?? new Map(),
    mappings,
    byId,
  });
}

describe("what belongs to this importer", () => {
  it("a complete loose figure does", () => {
    const row = classify("SA", "Bash", 5);
    expect(row.classification).toBe("SUPPORTED_COMPLETE_LOOSE_FIGURE");
    expect(row.skyId).toBe("SKY-0011");
    expect(row.desiredQuantity).toBe(5);
  });

  it("the sheet decides which Bash it is", () => {
    /*
     * 32 names occur in more than one game in the real catalog. Matching on the
     * name alone would put Giants stock on a Spyro's Adventure figure — which
     * is why the sheet is part of the key and not decoration.
     */
    expect(classify("SA", "Bash", 1).skyId).toBe("SKY-0011");
    expect(classify("G", "Bash", 1).skyId).toBe("SKY-0120");
  });

  it("a game does NOT, even though it has a real SKY-ID", () => {
    const row = classify("SA", "Game (PC)", 3);
    expect(row.classification).toBe("IGNORED_GAME");
    // Not unmatched: it was found, and deliberately left alone.
    expect(row.desiredQuantity).toBeNull();
  });

  it("a Swap Force half does not, and is never paired automatically", () => {
    for (const name of ["Free Ranger - OBERTEIL", "Free Ranger - UNTERTEIL"]) {
      const row = classify("SF", name, 3);
      expect(row.classification, name).toBe("IGNORED_SWAP_FORCE_HALF");
      expect(row.desiredQuantity, name).toBeNull();
    }
    // And the whole figure is unaffected by the halves existing.
    expect(classify("SF", "Free Ranger", 2).classification).toBe(
      "SUPPORTED_COMPLETE_LOOSE_FIGURE",
    );
  });

  it("a damaged legacy row does not", () => {
    expect(classify("G", "Hex - BESCHÄDIGT", 0).classification).toBe("IGNORED_DAMAGED");
  });

  it("an explicitly boxed row does not", () => {
    expect(classify("I", "Kaos in OVP", 1).classification).toBe("IGNORED_OVP");
  });

  it("but `ohne OVP` means WITHOUT the box, and is in scope", () => {
    /*
     * The mistake this test exists for: a plain /OVP/ throws out fourteen
     * `Elite … - ohne OVP` rows, which are exactly the complete loose figures
     * the importer is for.
     */
    const row = classify("SA", "Elite Boomer - ohne OVP", 2);
    expect(row.classification).toBe("SUPPORTED_COMPLETE_LOOSE_FIGURE");
    expect(row.skyId).toBe("SKY-0015");
  });

  it("a sheet outside the six is not read at all", () => {
    for (const sheet of ["ZB", "DI A", "Summary", "Order 2026"]) {
      expect(classify(sheet, "Anything", 1).classification, sheet).toBe("IGNORED_SHEET");
    }
    expect(SUPPORTED_SHEETS).toEqual(["SA", "G", "SF", "T", "SC", "I"]);
  });

  it("an empty Storage cell is unknown, not zero", () => {
    // Zero is a reconciliation target. Blank is a row not to act on.
    const row = classify("SA", "Bash", null);
    expect(row.classification).toBe("INVALID_ROW");
    expect(row.desiredQuantity).toBeNull();
  });

  it("a name the catalog does not have is a problem, not a decision", () => {
    expect(classify("SA", "Not A Figure", 1).classification).toBe("UNMATCHED_RELEVANT");
  });

  it("never guesses: matching is exact, with no fuzzy fallback", () => {
    /*
     * One character off is not a match, and neither is different case. A
     * near-match that silently writes stock is the one failure this design
     * will not risk — so normalisation is used for saved resolutions only,
     * never to decide what a row is.
     *
     * Whitespace is the parser's job, not the classifier's: `parseSheet`
     * trims, so a padded cell never reaches here.
     */
    expect(classify("SA", "Bash", 1).classification).toBe("SUPPORTED_COMPLETE_LOOSE_FIGURE");
    for (const near of ["Bashh", "bash", "Bash ", "Bash-"]) {
      expect(classify("SA", near, 1).classification, near).toBe("UNMATCHED_RELEVANT");
    }
    const xml =
      '<worksheet><sheetData><row r="4">' +
      '<c r="B4" t="inlineStr"><is><t>  Bash  </t></is></c><c r="F4"><v>1</v></c>' +
      "</row></sheetData></worksheet>";
    expect(parseSheet("SA", xml, []) [0].name).toBe("Bash");
  });
});

describe("a resolution the owner made once", () => {
  it("wins over every rule, so the question is asked once", () => {
    const mappings = new Map<string, SavedMapping>([
      [`SF ${normaliseName("Free Ranger - OBERTEIL")}`, { skyId: "SKY-0301", ignored: false }],
    ]);
    const row = classify("SF", "Free Ranger - OBERTEIL", 2, mappings);
    expect(row.classification).toBe("SUPPORTED_COMPLETE_LOOSE_FIGURE");
    expect(row.skyId).toBe("SKY-0301");
  });

  it("can also be an explicit refusal", () => {
    const mappings = new Map<string, SavedMapping>([
      [`SA ${normaliseName("Not A Figure")}`, { skyId: null, ignored: true }],
    ]);
    expect(classify("SA", "Not A Figure", 1, mappings).classification).toBe("IGNORED_SHEET");
  });

  it("survives a re-save: the key is normalised", () => {
    expect(normaliseName("Free Ranger - OBERTEIL")).toBe(normaliseName("free  ranger – OBERTEIL"));
    expect(normaliseName("Spyro's Adventure")).toBe("spyros adventure");
  });
});

describe("the spreadsheet is the truth about physical stock", () => {
  const shelf = (quantity: number, reserved = 0): Baseline => ({
    quantity,
    reserved,
    lastMovementAt: null,
    lastImportDesired: null,
  });

  it("synchronises upward", () => {
    expect(reconcile(5, shelf(3))).toMatchObject({ status: "pending", delta: 2 });
  });

  it("synchronises downward", () => {
    expect(reconcile(2, shelf(4))).toMatchObject({ status: "pending", delta: -2 });
  });

  it("zero is a real target, not a blank", () => {
    // The highest-risk path, and it is meant to work: the sheet says the shelf
    // is empty, so the shelf becomes empty.
    expect(reconcile(0, shelf(3))).toMatchObject({ status: "pending", delta: -3 });
  });

  it("equal means no movement at all", () => {
    expect(reconcile(5, shelf(5))).toMatchObject({ status: "unchanged", delta: 0 });
  });

  it("is naturally idempotent: the second run has nothing to do", () => {
    const first = reconcile(5, shelf(3));
    expect(first.delta).toBe(2);
    // After applying it the shelf holds 5, so the same sheet proposes nothing.
    expect(reconcile(5, shelf(3 + first.delta))).toMatchObject({
      status: "unchanged",
      delta: 0,
    });
  });
});

describe("SkyIsles does not second-guess the owner's instruction", () => {
  /*
   * An earlier version refused these. It was wrong in one consistent way: the
   * owner runs an import *because* the spreadsheet and the shop disagree, so
   * treating the disagreement as evidence that he is mistaken inverts the
   * purpose of the feature. These cases must all synchronise.
   */
  const withHistory = (quantity: number, over: Partial<Baseline> = {}): Baseline => ({
    quantity,
    reserved: 0,
    lastMovementAt: "2026-09-05T10:00:00Z",
    lastImportDesired: 5,
    ...over,
  });

  it("a sale after the workbook was saved does not block an increase", () => {
    expect(reconcile(5, withHistory(4))).toMatchObject({ status: "pending", delta: 1 });
  });

  it("an unchanged sheet value does not block an increase", () => {
    expect(reconcile(5, withHistory(4, { lastMovementAt: null }))).toMatchObject({
      status: "pending",
      delta: 1,
    });
  });

  it("a manual correction after the save does not block a decrease", () => {
    expect(reconcile(5, withHistory(8))).toMatchObject({ status: "pending", delta: -3 });
  });

  it("a previous import with another target does not block the new one", () => {
    expect(reconcile(5, withHistory(3, { lastImportDesired: 4 }))).toMatchObject({
      status: "pending",
      delta: 2,
    });
  });

  it("and `reconcile` cannot even see the workbook's clock", () => {
    // It takes two arguments. The save time is displayed, never consulted.
    expect(reconcile.length).toBe(2);
  });
});

describe("a reservation is the one real conflict", () => {
  it("refuses a target below the reserved count", () => {
    /*
     * quantity 5, reserved 3, sheet says 2. Those three units are promised to
     * a checkout in flight; a stock-take may not un-promise them. Caught here
     * so the PREVIEW can say so — without it the row looks ready and the whole
     * import aborts at commit on a constraint nobody was shown.
     */
    const result = reconcile(2, {
      quantity: 5,
      reserved: 3,
      lastMovementAt: null,
      lastImportDesired: null,
    });
    expect(result.status).toBe("conflict");
    expect(result.note).toContain("reserviert");
  });

  it("allows a target exactly at the reserved count", () => {
    expect(
      reconcile(3, { quantity: 5, reserved: 3, lastMovementAt: null, lastImportDesired: null }),
    ).toMatchObject({ status: "pending", delta: -2 });
  });

  it("never clamps, and never pretends it worked", () => {
    const result = reconcile(0, {
      quantity: 4,
      reserved: 2,
      lastMovementAt: null,
      lastImportDesired: null,
    });
    expect(result.status).toBe("conflict");
    // The delta it would have needed is reported, not quietly reduced to -2.
    expect(result.delta).toBe(-4);
  });

  it("does not stand in the way of an increase", () => {
    expect(
      reconcile(9, { quantity: 5, reserved: 3, lastMovementAt: null, lastImportDesired: null }),
    ).toMatchObject({ status: "pending", delta: 4 });
  });

  it("and the database refuses it again regardless", () => {
    const foundation = migrationSource("0003_shop_foundation.sql");
    expect(foundation).toContain("and quantity + p_delta >= reserved");
  });
});

describe("the sheet parser reads two cells and skips the rest", () => {
  const shared = parseSharedStrings(
    "<sst><si><t>Bash</t></si><si><t>Spyros Adventure</t></si></sst>",
  );

  it("resolves shared strings", () => {
    expect(shared).toEqual(["Bash", "Spyros Adventure"]);
  });

  it("skips the header, the totals row and the blank", () => {
    expect(FIRST_DATA_ROW).toBe(4);
    const xml =
      '<worksheet><sheetData>' +
      '<row r="1"><c r="B1" t="s"><v>1</v></c></row>' +
      '<row r="2"><c r="F2"><v>299</v></c></row>' +   // the totals row
      '<row r="4"><c r="B4" t="s"><v>0</v></c><c r="F4"><v>5</v></c></row>' +
      "</sheetData></worksheet>";
    const rows = parseSheet("SA", xml, shared);
    expect(rows).toEqual([{ sheet: "SA", sourceRow: 4, name: "Bash", storage: 5 }]);
  });

  it("treats the picture cell in column A as normal, not as an error", () => {
    // Every figure row has `#VALUE!` in A: it is an in-cell image with no text
    // form. A parser that stopped there would read nothing at all.
    const xml =
      '<worksheet><sheetData><row r="5">' +
      '<c r="A5" t="e" vm="1"><v>#VALUE!</v></c>' +
      '<c r="B5" t="s"><v>0</v></c><c r="F5"><v>2</v></c>' +
      "</row></sheetData></worksheet>";
    expect(parseSheet("SA", xml, shared)[0]).toMatchObject({ name: "Bash", storage: 2 });
  });

  it("reads the cached value of a formula cell", () => {
    // `F = D − E` is a live formula in many rows. The cached value is what
    // Excel last computed, and it is what the owner sees.
    const xml =
      '<worksheet><sheetData><row r="6">' +
      '<c r="B6" t="s"><v>0</v></c><c r="F6"><f>D6-E6</f><v>7</v></c>' +
      "</row></sheetData></worksheet>";
    expect(parseSheet("SA", xml, shared)[0].storage).toBe(7);
  });

  it("rejects a non-integer or negative count rather than rounding it", () => {
    for (const value of ["2.5", "-1"]) {
      const xml =
        '<worksheet><sheetData><row r="7">' +
        `<c r="B7" t="s"><v>0</v></c><c r="F7"><v>${value}</v></c>` +
        "</row></sheetData></worksheet>";
      expect(parseSheet("SA", xml, shared)[0].storage, value).toBeNull();
    }
  });

  it("ignores a row with no name", () => {
    const xml =
      '<worksheet><sheetData><row r="8"><c r="F8"><v>3</v></c></row></sheetData></worksheet>';
    expect(parseSheet("SA", xml, shared)).toEqual([]);
  });
});

describe("what the database guarantees", () => {
  it("an ignored row cannot carry a delta", () => {
    // The constraint that makes "a game is left completely alone" a fact.
    expect(SQL).toContain("inventory_import_rows_ignored_is_inert");
    expect(SQL).toContain(
      "check (classification not like 'IGNORED%' or (delta is null and movement_id is null))",
    );
  });

  it("an import can only be applied once", () => {
    const fn = latestFunction("seller_apply_import").body;
    expect(fn).toContain("for update");
    expect(fn).toContain("if v_import.state <> 'preview' then");
    expect(fn).toContain("this import has already been settled");
  });

  it("only pending rows are applied, so a conflict is genuinely skipped", () => {
    /*
     * The reservation protection depends entirely on this clause. Without it a
     * row the preview marked `conflict` would be processed anyway, and the
     * whole import would abort at commit on the constraint the conflict was
     * there to avoid.
     */
    const fn = latestFunction("seller_apply_import").body;
    expect(fn).toContain("and status = 'pending'");
    expect(fn).toContain("classification = 'SUPPORTED_COMPLETE_LOOSE_FIGURE'");
  });

  it("the delta is recomputed at apply time, not trusted from the preview", () => {
    // Something may have sold between preview and confirmation.
    const fn = latestFunction("seller_apply_import").body;
    expect(fn).toContain("v_delta := v_row.desired_quantity - v_current");
  });

  it("stock is moved through the existing ledger, never written directly", () => {
    const fn = latestFunction("seller_apply_import").body;
    expect(fn).toContain("public.record_inventory_movement(");
    expect(fn).toContain("'correction'");
    expect(fn).not.toContain("update public.shop_inventory");
  });

  it("the whole import is one transaction", () => {
    // A plpgsql function is one transaction: row 3 failing takes 1 and 2 with
    // it, so there is no half-applied state to explain.
    const fn = latestFunction("seller_apply_import").body;
    expect(fn).toContain("language plpgsql");
    expect(fn).not.toContain("commit");
  });

  it("and the floor is the database's, unchanged since 0003", () => {
    const foundation = migrationSource("0003_shop_foundation.sql");
    expect(foundation).toContain("and quantity + p_delta >= reserved");
    /*
     * 0048 READS `reserved` — the preview shows it — but never enforces a
     * floor of its own. That distinction is the point: one place decides
     * whether stock may fall, and it has since 0003.
     */
    expect(sqlCode(SQL)).toContain("i.reserved");
    expect(sqlCode(SQL)).not.toMatch(/>=\s*reserved|reserved\s*<=/);
    expect(sqlCode(SQL)).not.toContain("update public.shop_inventory");
  });

  it("every function is seller-gated", () => {
    for (const name of [
      "seller_import_baseline",
      "seller_create_import",
      "seller_apply_import",
      "seller_discard_import",
      "seller_save_import_mapping",
    ]) {
      expect(latestFunction(name).body, name).toContain(
        "if not public.can_operate_active_seller() then",
      );
    }
  });

  it("nothing is granted to anon", () => {
    const grants = [
      ...SQL.matchAll(/grant execute on function public\.\w+\s*\([^)]*\)\s*to ([^;]+);/g),
    ];
    expect(grants.length).toBeGreaterThan(4);
    for (const grant of grants) expect(grant[1]).not.toContain("anon");
  });

  it("no storage bucket is created, because no file is uploaded", () => {
    expect(SQL).not.toContain("storage.buckets");
    expect(SQL).not.toContain("storage.objects");
  });
});

describe("the file never leaves the device", () => {
  const reader = readFileSync("src/lib/import/xlsx-reader.ts", "utf8");
  const component = readFileSync("src/components/admin/inventory-import.tsx", "utf8");

  it("reads slices rather than the whole file", () => {
    // `File.slice()` returns a view, not a copy. That is what makes reading
    // 0.75 MB of a 450 MB file possible on a phone.
    expect(reader).toContain("file.slice(");
    expect(reader).not.toContain("file.arrayBuffer()");
  });

  it("uploads nothing", () => {
    for (const source of [reader, component]) {
      expect(source).not.toContain("storage.from");
      expect(source).not.toContain("FormData");
      expect(source).not.toMatch(/fetch\(["'`]\/api/);
    }
  });

  it("refuses a member that claims to expand implausibly", () => {
    // The only shape of attack a ZIP reader has to care about. The real
    // workbook's largest needed member inflates 7.2×.
    expect(reader).toContain("MAX_MEMBER_BYTES");
    expect(reader).toContain("entry.uncompressedSize > MAX_MEMBER_BYTES");
  });

  it("refuses ZIP64 rather than misreading it", () => {
    expect(reader).toContain("0xffffffff");
    expect(reader).toContain('"too-large"');
  });

  it("finds a sheet by name, never by guessing a file number", () => {
    // In this workbook `SA` is sheet2.xml, not sheet1.xml — which the comment
    // says, so the assertion reads the code.
    expect(reader).toContain("r:id=");
    expect(tsCode(reader)).not.toMatch(/sheet\$\{|sheet1\.xml/);
  });

  it("reads the workbook's own save time for the stale check", () => {
    expect(reader).toContain("dcterms:modified");
  });

  it("only writes loose", () => {
    expect(IMPORT_CONDITION).toBe("loose");
    expect(component).toContain("IMPORT_CONDITION");
  });
});
