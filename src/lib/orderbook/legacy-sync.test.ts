import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  planIsClean, planIsEmpty, planLegacySync,
  type StoredLine, type WorkbookLine,
} from "./legacy-sync";

/**
 * The row-based legacy sync (0088).
 *
 * The rule the whole thing exists for: a corrected workbook must UPDATE the
 * line it already imported, never add a second one. The old importers could
 * not do that — their fingerprint hashes the rows, so correcting a flag made
 * the group unrecognisable and it came back in as a duplicate.
 */
const line = (over: Partial<WorkbookLine> & { sourceRow: number }): WorkbookLine => ({
  headerRow: 100, position: 1, rawName: "Spyro", skyId: "SKY-0053",
  stockFlag: "x", secondFlag: "x", ...over,
});
const stored = (over: Partial<StoredLine> & { id: number }): StoredLine => ({
  groupId: 7, sourceRow: over.id, rawName: "Spyro", skyId: "SKY-0053",
  stockFlag: "x", secondFlag: "x", ...over,
});

describe("a corrected line is updated, never duplicated", () => {
  it("updates the existing row when a flag changes", () => {
    const plan = planLegacySync(
      [line({ sourceRow: 101, stockFlag: "l" })],
      [stored({ id: 500, sourceRow: 101 })],
    );
    expect(plan.updates).toHaveLength(1);
    expect(plan.insertsIntoExistingGroup).toHaveLength(0);
    expect(plan.newGroups.size).toBe(0);
    expect(plan.updates[0].id).toBe(500);
    expect(plan.updates[0].changes).toEqual([{ field: "stock_flag", from: "x", to: "l" }]);
  });

  it("updates on a name correction", () => {
    const plan = planLegacySync(
      [line({ sourceRow: 101, rawName: "Ignitor S2" })],
      [stored({ id: 500, sourceRow: 101, rawName: "Ignitor" })],
    );
    expect(plan.updates[0].changes).toEqual([
      { field: "raw_name", from: "Ignitor", to: "Ignitor S2" },
    ]);
  });

  it("updates on a SKY-ID correction, because mapping is fixable", () => {
    const plan = planLegacySync(
      [line({ sourceRow: 101, skyId: "SKY-0419" })],
      [stored({ id: 500, sourceRow: 101, skyId: "SKY-0563" })],
    );
    expect(plan.updates[0].changes).toEqual([
      { field: "sky_id", from: "SKY-0563", to: "SKY-0419" },
    ]);
  });

  /*
   * A MAPPING IS SET OR CORRECTED, NEVER THROWN AWAY.
   *
   * 23 imported sale rows carry a SKY-ID the workbook itself cannot produce
   * — the importer found them from the owner's references elsewhere (0071).
   * The first preview proposed clearing all 23, because column P is empty on
   * those rows. That would have destroyed real mappings.
   */
  it("never clears a stored SKY-ID just because the workbook resolves none", () => {
    const plan = planLegacySync(
      [line({ sourceRow: 101, skyId: null })],
      [stored({ id: 500, sourceRow: 101, skyId: "SKY-0278" })],
    );
    expect(planIsEmpty(plan)).toBe(true);
    expect(plan.updates).toHaveLength(0);
  });

  it("also leaves it alone for an empty resolution", () => {
    const plan = planLegacySync(
      [line({ sourceRow: 101, skyId: "" })],
      [stored({ id: 500, sourceRow: 101, skyId: "SKY-0278" })],
    );
    expect(planIsEmpty(plan)).toBe(true);
  });

  it("still fills an empty mapping when the workbook has one", () => {
    const plan = planLegacySync(
      [line({ sourceRow: 101, skyId: "SKY-0167" })],
      [stored({ id: 500, sourceRow: 101, skyId: null })],
    );
    expect(plan.updates[0].changes).toEqual([{ field: "sky_id", from: "", to: "SKY-0167" }]);
  });

  it("reports several changes on one row together", () => {
    const plan = planLegacySync(
      [line({ sourceRow: 101, stockFlag: "-", secondFlag: "-", rawName: "Terrafin S2" })],
      [stored({ id: 500, sourceRow: 101, rawName: "Terrafin S2", stockFlag: "-", secondFlag: "x" })],
    );
    expect(plan.updates[0].changes.map((c) => c.field)).toEqual(["second_flag"]);
  });

  /*
   * IDENTITY IS THE SOURCE ROW AND NOTHING ELSE.
   *
   * Every other field is a candidate for correction, so matching on any of
   * them would lose the row precisely when it was corrected.
   */
  it("matches on the source row even when every other field changed", () => {
    const plan = planLegacySync(
      [line({ sourceRow: 101, rawName: "völlig anders", skyId: "SKY-9999",
              stockFlag: "r", secondFlag: "-" })],
      [stored({ id: 500, sourceRow: 101 })],
    );
    expect(plan.updates).toHaveLength(1);
    expect(plan.insertsIntoExistingGroup).toHaveLength(0);
    expect(plan.updates[0].changes).toHaveLength(4);
  });
});

describe("what is genuinely new", () => {
  it("adds a new row to the group it belongs to", () => {
    const plan = planLegacySync(
      [line({ sourceRow: 101 }), line({ sourceRow: 102, rawName: "Gill Grunt" })],
      [stored({ id: 500, sourceRow: 101, groupId: 7 })],
    );
    expect(plan.insertsIntoExistingGroup).toHaveLength(1);
    expect(plan.insertsIntoExistingGroup[0].groupId).toBe(7);
    expect(plan.insertsIntoExistingGroup[0].line.sourceRow).toBe(102);
    expect(plan.newGroups.size).toBe(0);
  });

  it("collects a whole new group under its header row", () => {
    const plan = planLegacySync(
      [line({ sourceRow: 200, headerRow: 199 }), line({ sourceRow: 201, headerRow: 199 })],
      [],
    );
    expect(plan.insertsIntoExistingGroup).toHaveLength(0);
    expect(plan.newGroups.get(199)).toHaveLength(2);
  });

  it("keeps a new group apart from an existing one", () => {
    const plan = planLegacySync(
      [line({ sourceRow: 101, headerRow: 100 }), line({ sourceRow: 300, headerRow: 299 })],
      [stored({ id: 500, sourceRow: 101, groupId: 7 })],
    );
    expect(plan.unchanged).toBe(1);
    expect(plan.newGroups.get(299)).toHaveLength(1);
    expect(plan.insertsIntoExistingGroup).toHaveLength(0);
  });
});

describe("a second run does nothing", () => {
  it("is idempotent when the workbook and the database agree", () => {
    const rows = [line({ sourceRow: 101 }), line({ sourceRow: 102, rawName: "Bash" })];
    const plan = planLegacySync(rows, [
      stored({ id: 500, sourceRow: 101 }),
      stored({ id: 501, sourceRow: 102, rawName: "Bash" }),
    ]);
    expect(planIsEmpty(plan)).toBe(true);
    expect(planIsClean(plan)).toBe(true);
    expect(plan.unchanged).toBe(2);
    expect(plan.groupsNeedingFingerprint.size).toBe(0);
  });

  it("ignores whitespace so a trimmed cell is not an endless diff", () => {
    const plan = planLegacySync(
      [line({ sourceRow: 101, stockFlag: "x ", rawName: " Spyro" })],
      [stored({ id: 500, sourceRow: 101 })],
    );
    expect(planIsEmpty(plan)).toBe(true);
  });

  it("treats an empty flag and a null flag as the same absence", () => {
    const plan = planLegacySync(
      [line({ sourceRow: 101, secondFlag: "" })],
      [stored({ id: 500, sourceRow: 101, secondFlag: null })],
    );
    expect(planIsEmpty(plan)).toBe(true);
  });
});

/**
 * Der Vorfall, der diese Gruppe erzwungen hat: `sale_item #1219`
 * (Verkauf #303, Quellzeile 1506) hieß in der Arbeitsmappe `"Eruptor "`,
 * mit abschließendem Leerzeichen. Der Phase-A-Sync aktualisierte an dieser
 * Zeile `legacy_stock_flag`, und weil `system_sync_legacy_sale_item` alle
 * vier Spalten schreibt und das Werkzeug den Namen zuvor durch `txt()`
 * schickte, verschwand das Leerzeichen als Beifang.
 *
 * Namen kommen roh vom Verkäufer (CLAUDE.md, Regel 4). Vergleichen darf
 * normalisiert werden — geschrieben wird der Rohwert.
 */
describe("raw_name is preserved exactly as the workbook writes it", () => {
  it("keeps a trailing space on the line a flag change updates", () => {
    const plan = planLegacySync(
      [line({ sourceRow: 1506, rawName: "Eruptor ", stockFlag: "x" })],
      [stored({ id: 1219, sourceRow: 1506, rawName: "Eruptor ", stockFlag: null })],
    );
    expect(plan.updates).toHaveLength(1);
    // Der Auslöser ist das Flag, nicht der Name …
    expect(plan.updates[0].changes).toEqual([{ field: "stock_flag", from: "", to: "x" }]);
    // … und der Wert, den das Werkzeug schreibt, trägt sein Leerzeichen noch.
    expect(plan.updates[0].line.rawName).toBe("Eruptor ");
    expect(plan.updates[0].line.rawName).not.toBe("Eruptor");
  });

  it("does not churn when only the whitespace differs", () => {
    // Weder in die eine Richtung …
    expect(planIsEmpty(planLegacySync(
      [line({ sourceRow: 1506, rawName: "Eruptor " })],
      [stored({ id: 1219, sourceRow: 1506, rawName: "Eruptor" })],
    ))).toBe(true);
    // … noch in die andere, und ein zweiter Lauf bleibt leer.
    const plan = planLegacySync(
      [line({ sourceRow: 1506, rawName: "Eruptor " })],
      [stored({ id: 1219, sourceRow: 1506, rawName: "Eruptor " })],
    );
    expect(planIsEmpty(plan)).toBe(true);
    expect(plan.unchanged).toBe(1);
    expect(plan.groupsNeedingFingerprint.size).toBe(0);
  });

  it("carries the raw name into an insert as well", () => {
    const plan = planLegacySync(
      [line({ sourceRow: 101 }), line({ sourceRow: 1506, rawName: "Eruptor " })],
      [stored({ id: 500, sourceRow: 101 })],
    );
    expect(plan.insertsIntoExistingGroup[0].line.rawName).toBe("Eruptor ");
  });

  it("the tool hands the importer's own name through, unnormalised", () => {
    const TOOL = readFileSync("tools/sync-legacy-orderbook.mts", "utf8");
    // Die beiden Zeilenquellen — Verkauf und Einkauf — reichen roh durch.
    expect(TOOL.match(/rawName: i\.rawName,/g)).toHaveLength(2);
    expect(TOOL).not.toContain("rawName: txt(");
    // Und geschrieben wird genau dieser Wert, nicht der normalisierte Diff.
    expect(TOOL).toContain("p_raw_name: u.line.rawName");
    expect(TOOL).toContain("p_raw_name: i.line.rawName");
  });
});

describe("fail closed", () => {
  it("refuses a row the workbook no longer has, and deletes nothing", () => {
    const plan = planLegacySync([], [stored({ id: 500, sourceRow: 101 })]);
    expect(planIsClean(plan)).toBe(false);
    expect(plan.problems[0].kind).toBe("missing_in_workbook");
    // There is no delete in the plan's shape at all — that is the point.
    expect(Object.keys(plan)).not.toContain("deletes");
  });

  it("refuses a duplicate source row on either side", () => {
    const dbSide = planLegacySync(
      [line({ sourceRow: 101 })],
      [stored({ id: 500, sourceRow: 101 }), stored({ id: 501, sourceRow: 101 })],
    );
    expect(dbSide.problems.some((p) => p.kind === "duplicate_source_row")).toBe(true);

    const bookSide = planLegacySync(
      [line({ sourceRow: 101 }), line({ sourceRow: 101, rawName: "Zwei" })],
      [stored({ id: 500, sourceRow: 101 })],
    );
    expect(bookSide.problems.some((p) => p.kind === "duplicate_source_row")).toBe(true);
  });

  it("refuses a workbook group whose rows live in two database groups", () => {
    const plan = planLegacySync(
      [line({ sourceRow: 101, headerRow: 100 }), line({ sourceRow: 102, headerRow: 100 })],
      [stored({ id: 500, sourceRow: 101, groupId: 7 }),
       stored({ id: 501, sourceRow: 102, groupId: 8 })],
    );
    expect(plan.problems.some((p) => p.kind === "group_split")).toBe(true);
  });

  it("refuses a stored legacy row without a source row", () => {
    const plan = planLegacySync([], [stored({ id: 500, sourceRow: null })]);
    expect(plan.problems[0].kind).toBe("stored_without_source");
  });

  it("does not place a new row into a group it could not resolve", () => {
    // The group is split, so nothing may be added to either half.
    const plan = planLegacySync(
      [line({ sourceRow: 101, headerRow: 100 }), line({ sourceRow: 102, headerRow: 100 }),
       line({ sourceRow: 103, headerRow: 100 })],
      [stored({ id: 500, sourceRow: 101, groupId: 7 }),
       stored({ id: 501, sourceRow: 102, groupId: 8 })],
    );
    expect(plan.insertsIntoExistingGroup).toHaveLength(0);
    expect(planIsClean(plan)).toBe(false);
  });
});

describe("fingerprints follow the content", () => {
  it("marks a group whose row changed", () => {
    const plan = planLegacySync(
      [line({ sourceRow: 101, stockFlag: "r" })],
      [stored({ id: 500, sourceRow: 101, groupId: 7 })],
    );
    expect([...plan.groupsNeedingFingerprint]).toEqual([7]);
  });

  it("marks a group that gained a row", () => {
    const plan = planLegacySync(
      [line({ sourceRow: 101 }), line({ sourceRow: 102 })],
      [stored({ id: 500, sourceRow: 101, groupId: 7 })],
    );
    expect([...plan.groupsNeedingFingerprint]).toEqual([7]);
  });

  it("marks nothing when nothing changed", () => {
    const plan = planLegacySync([line({ sourceRow: 101 })], [stored({ id: 500, sourceRow: 101 })]);
    expect(plan.groupsNeedingFingerprint.size).toBe(0);
  });
});

/**
 * The guarantees that live in SQL, asserted against the migration text.
 *
 * These are the ones a unit test cannot exercise — they are refusals inside
 * `security definer` functions — so what is checked here is that the refusal
 * is written at all, and that nothing outside the workbook's own columns can
 * be reached through them.
 */
describe("the write path is narrow and service_role only", () => {
  const SQL = readFileSync("supabase/migrations/0088_legacy_orderbook_sync.sql", "utf8")
    .split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
  const FUNCTIONS = [
    "system_sync_legacy_sale_item", "system_sync_legacy_purchase_item",
    "system_add_legacy_sale_item", "system_add_legacy_purchase_item",
    "system_set_legacy_sale_fingerprint", "system_set_legacy_purchase_fingerprint",
  ];

  it("grants execute to service_role and to nobody else", () => {
    for (const fn of FUNCTIONS) {
      expect(SQL, fn).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\)\\s*\\n?\\s*from public, anon, authenticated;`));
      expect(SQL, fn).toMatch(new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\)\\s*\\n?\\s*to service_role;`));
    }
    expect(SQL).not.toMatch(/to authenticated/);
    expect(SQL).not.toMatch(/to anon/);
  });

  it("runs as definer with an empty search path", () => {
    expect((SQL.match(/security definer/g) ?? []).length).toBe(FUNCTIONS.length);
    expect((SQL.match(/set search_path = ''/g) ?? []).length).toBe(FUNCTIONS.length);
  });

  it("refuses anything that is not a workbook row", () => {
    for (const guard of [
      "v_sale.source is distinct from 'excel_order_2026'",
      "v_purchase.source is distinct from 'excel_order_2026'",
      "v_sale.order_id is not null",
      "v_item.source_row is null",
    ]) {
      expect(SQL, guard).toContain(guard);
    }
  });

  /*
   * THE COLUMNS IT CANNOT REACH.
   *
   * A corrected flag must not clear `settled_at` — that timestamp is our
   * bookkeeping, not a finding about the object — and it must not touch a
   * movement, a price or a cost. The narrowest way to guarantee that is for
   * those columns never to appear in an UPDATE list.
   */
  it("writes only the workbook's own columns", () => {
    for (const update of SQL.matchAll(/update public\.\w+\s*\n([\s\S]*?)\swhere /g)) {
      const body = update[1];
      for (const forbidden of ["settled_at", "not_shipped_at", "returned_at",
                               "return_announced_at", "movement_id", "return_movement_id",
                               "market_price", "unit_cost", "total_cost", "position ="]) {
        expect(body, forbidden).not.toContain(forbidden);
      }
    }
  });

  it("creates no stock effect of any kind", () => {
    for (const forbidden of ["shop_inventory", "inventory_movements", "legacy_stock_events",
                             "record_inventory_movement", "apply_inventory_movement"]) {
      expect(SQL, forbidden).not.toContain(forbidden);
    }
  });

  it("touches no fee, refund, adjustment or audit table", () => {
    for (const table of ["sale_fees", "sale_refunds", "settlement_adjustments", "orderbook_audit"]) {
      expect(SQL, table).not.toContain(table);
    }
  });

  it("refuses to hand a source row to a second position", () => {
    expect((SQL.match(/is already taken by another/g) ?? []).length).toBe(2);
  });

  it("refuses a fingerprint another group already carries", () => {
    expect((SQL.match(/already belongs to another/g) ?? []).length).toBe(2);
  });

  it("deletes nothing and drops nothing", () => {
    expect(SQL).not.toMatch(/\bdelete\b/i);
    expect(SQL).not.toMatch(/\btruncate\b/i);
    expect(SQL).not.toMatch(/\bdrop table\b|\bdrop function\b/i);
  });
});

/**
 * THE POSITION SET BELONGS TO THE IMPORTER (0088, nach dem Vorfall vom
 * 2026-09-22).
 *
 * Die erste Fassung des Werkzeugs bestimmte selbst, was eine Position ist,
 * und fügte 79 als `IGNORED_DAMAGED` klassifizierte Zeilen in die
 * Einkaufshistorie ein. Diese Tests halten fest, dass die Klassifikation
 * nicht mehr zweimal existiert.
 */
describe("the sync never invents a position the importer would not import", () => {
  const TOOL = readFileSync("tools/sync-legacy-orderbook.mts", "utf8");

  it("takes purchase positions from planBatch's migrated list", () => {
    expect(TOOL).toContain("planBatch(");
    expect(TOOL).toContain("p.preview.migrated as unknown as MigratedItem[]");
    // Und nicht mehr aus den Rohzeilen des Blatts.
    expect(TOOL).not.toContain("orderRowsFromGrid");
  });

  it("takes sale positions from planSales' item list", () => {
    expect(TOOL).toContain("planSales(");
    expect(TOOL).toContain("p.items.map((i) => ({");
  });

  it("uses no name heuristic of its own to exclude a row", () => {
    /*
     * `(B)` und `(D)` sind Hinweise im Namen, keine Regel — die Entscheidung
     * trifft die Klassifikation des Importers. Geprüft wird der AUSGEFÜHRTE
     * Code; im Kopfkommentar darf der Vorfall benannt werden.
     */
    const code = TOOL.split("\n")
      .filter((l) => { const t = l.trimStart();
        return !t.startsWith("*") && !t.startsWith("//") && !t.startsWith("/*"); })
      .join("\n");
    for (const heuristic of ["(B)", "(D)", "damaged", "IGNORED_", "isDamaged"]) {
      expect(code, heuristic).not.toContain(heuristic);
    }
  });

  it("still refuses to stamp an unexplained purchase group", () => {
    expect(TOOL).toContain("purchaseUnexplained");
    expect(TOOL).toContain("purchaseUnexplained.length === 0");
    expect(TOOL).toContain("ist eligible, aber nicht erklärt");
  });
});

describe("what the planner excludes never becomes an insert", () => {
  /*
   * Das Planmodul bekommt nur noch die Zeilen, die der Importer übernehmen
   * würde. Eine ausgeschlossene Zeile ist damit für den Plan schlicht
   * nicht vorhanden — sie kann kein INSERT auslösen.
   */
  it("plans no insert for a row the importer left out", () => {
    const plan = planLegacySync(
      // Der Aufrufer übergibt nur migrierte Zeilen; die ausgeschlossene
      // Zeile 999 taucht hier gar nicht auf.
      [line({ sourceRow: 101 })],
      [stored({ id: 500, sourceRow: 101 })],
    );
    expect(planIsEmpty(plan)).toBe(true);
    expect(plan.insertsIntoExistingGroup).toHaveLength(0);
  });

  it("plans an insert for a migrated row that is missing", () => {
    const plan = planLegacySync(
      [line({ sourceRow: 101 }), line({ sourceRow: 102, rawName: "Neu" })],
      [stored({ id: 500, sourceRow: 101 })],
    );
    expect(plan.insertsIntoExistingGroup).toHaveLength(1);
    expect(plan.insertsIntoExistingGroup[0].line.sourceRow).toBe(102);
  });

  /*
   * Und der umgekehrte Fall, der den Vorfall aufgedeckt hat: eine Zeile
   * steht in der Datenbank, die der Importer nicht kennt. Das ist ein
   * Konflikt, kein stiller Zustand — sonst bleibt sie für immer liegen.
   */
  it("reports a stored row the importer does not classify as a position", () => {
    const plan = planLegacySync(
      [line({ sourceRow: 101 })],
      [stored({ id: 500, sourceRow: 101 }), stored({ id: 501, sourceRow: 999, rawName: "chill (B)" })],
    );
    expect(planIsClean(plan)).toBe(false);
    expect(plan.problems[0].kind).toBe("missing_in_workbook");
    expect(plan.problems[0].detail).toContain("999");
    // Und sie wird NICHT gelöscht — der Plan kennt keine Löschung.
    expect(Object.keys(plan)).not.toContain("deletes");
  });
});
