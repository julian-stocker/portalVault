import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  SYNCABLE_HEADER_FIELDS, UNPERSISTED_FIELDS, VERIFIABLE_HEADER_FIELDS,
  classifyGroup, classifyPurchaseGroup, importGateOpen, mayRestamp, mayRestampPurchase,
  needsSoldAt, planGroups, saleDateDiff,
  type GroupFacts, type PurchaseFacts,
} from "./legacy-sync-groups";

/**
 * The fingerprint gate (0088/0089).
 *
 * A stale fingerprint says only THAT something changed. Stamping it without
 * knowing WHAT turns every unexamined difference into a silently accepted
 * one — and the database would then claim to match a workbook it does not.
 */
const facts = (over: Partial<GroupFacts>): GroupFacts => ({
  saleId: 1, headerRow: 100, fingerprintMatches: false,
  headerDiffs: [], itemsChanged: false, allVerifiableCompared: true, ...over,
});

describe("the three explanations a stale fingerprint may have", () => {
  it("A — item rows changed, and 0088 writes them", () => {
    const verdict = classifyGroup(facts({ itemsChanged: true }));
    expect(verdict.kind).toBe("item");
    expect(mayRestamp(verdict)).toBe(true);
    expect(needsSoldAt(verdict)).toBeNull();
  });

  it("B — sold_at changed, and 0089 writes it", () => {
    const verdict = classifyGroup(facts({
      headerDiffs: [{ field: "date", from: "", to: "2026-02-10" }],
    }));
    expect(verdict).toEqual({ kind: "sold_at", from: "", to: "2026-02-10" });
    expect(mayRestamp(verdict)).toBe(true);
    expect(needsSoldAt(verdict)).toEqual({ to: "2026-02-10" });
  });

  it("both at once is still fully explained", () => {
    const verdict = classifyGroup(facts({
      itemsChanged: true, headerDiffs: [{ field: "date", from: "", to: "2026-03-18" }],
    }));
    expect(verdict.kind).toBe("item_and_sold_at");
    expect(mayRestamp(verdict)).toBe(true);
    expect(needsSoldAt(verdict)).toEqual({ to: "2026-03-18" });
  });

  /*
   * C — the #228 case. `money.AE` is hashed but stored nowhere, so its
   * change is invisible to every comparison. Allowed only as a conclusion by
   * exhaustion: every field that CAN be checked was checked and matched.
   */
  it("C — only an unpersisted component can differ, and everything else matched", () => {
    const verdict = classifyGroup(facts({}));
    expect(verdict.kind).toBe("unpersisted");
    expect(mayRestamp(verdict)).toBe(true);
    expect(needsSoldAt(verdict)).toBeNull();
  });

  it("refuses the unpersisted conclusion when the comparison was incomplete", () => {
    // Exhaustion is only an argument if the set really was exhausted.
    const verdict = classifyGroup(facts({ allVerifiableCompared: false }));
    expect(verdict.kind).toBe("unexplained");
    expect(mayRestamp(verdict)).toBe(false);
  });
});

describe("fail closed", () => {
  it("refuses a header field that has no write path", () => {
    for (const field of ["buyer", "moneyU", "headerRow"] as const) {
      const verdict = classifyGroup(facts({
        headerDiffs: [{ field, from: "alt", to: "neu" }],
      }));
      expect(verdict.kind, field).toBe("unexplained");
      expect(mayRestamp(verdict), field).toBe(false);
    }
  });

  it("is not talked round by a harmless item change alongside it", () => {
    // The unsyncable field must win, or a buyer correction would ride in
    // under cover of a flag correction and never be written.
    const verdict = classifyGroup(facts({
      itemsChanged: true,
      headerDiffs: [{ field: "buyer", from: "a", to: "b" },
                    { field: "date", from: "", to: "2026-02-10" }],
    }));
    expect(verdict.kind).toBe("unexplained");
    expect(mayRestamp(verdict)).toBe(false);
  });

  it("refuses a matching fingerprint that contradicts the data", () => {
    for (const over of [{ itemsChanged: true }, { headerDiffs: [{ field: "date" as const, from: "", to: "x" }] }]) {
      const verdict = classifyGroup(facts({ fingerprintMatches: true, ...over }));
      expect(verdict.kind).toBe("unexplained");
    }
  });

  it("asks for no stamp where nothing differs", () => {
    const verdict = classifyGroup(facts({ fingerprintMatches: true }));
    expect(verdict.kind).toBe("in_sync");
    expect(mayRestamp(verdict)).toBe(false);
  });
});

describe("the group plan", () => {
  it("collects stamps, date writes and refusals apart from each other", () => {
    const plan = planGroups([
      facts({ saleId: 10, itemsChanged: true }),
      facts({ saleId: 51, headerDiffs: [{ field: "date", from: "", to: "2026-02-10" }] }),
      facts({ saleId: 99, headerDiffs: [{ field: "date", from: "", to: "2026-03-18" }] }),
      facts({ saleId: 228 }),
      facts({ saleId: 7, fingerprintMatches: true }),
      facts({ saleId: 99999, headerDiffs: [{ field: "buyer", from: "a", to: "b" }] }),
    ]);
    expect(plan.restamp.sort((a, b) => a - b)).toEqual([10, 51, 99, 228]);
    expect(plan.soldAtWrites).toEqual([
      { saleId: 51, soldAt: "2026-02-10" }, { saleId: 99, soldAt: "2026-03-18" },
    ]);
    expect(plan.unexplained.map((u) => u.saleId)).toEqual([99999]);
    expect(plan.verdicts.get(7)?.kind).toBe("in_sync");
  });

  it("never stamps a group it could not explain", () => {
    const plan = planGroups([facts({ saleId: 5, allVerifiableCompared: false })]);
    expect(plan.restamp).toEqual([]);
    expect(plan.soldAtWrites).toEqual([]);
    expect(plan.unexplained).toHaveLength(1);
  });
});

describe("the gate before the new groups are imported", () => {
  it("opens only when every existing group is recognised again", () => {
    expect(importGateOpen({ existingStillEligible: 0, newGroupsEligible: 4, expectedNewGroups: 4 }))
      .toBe(true);
  });

  it("stays shut while one existing group is still eligible", () => {
    expect(importGateOpen({ existingStillEligible: 1, newGroupsEligible: 4, expectedNewGroups: 4 }))
      .toBe(false);
  });

  it("stays shut when the number of new groups is not what was planned", () => {
    expect(importGateOpen({ existingStillEligible: 0, newGroupsEligible: 5, expectedNewGroups: 4 }))
      .toBe(false);
    expect(importGateOpen({ existingStillEligible: 0, newGroupsEligible: 3, expectedNewGroups: 4 }))
      .toBe(false);
  });
});

describe("the field inventory is stated, not implied", () => {
  it("names every verifiable canonical header field", () => {
    expect([...VERIFIABLE_HEADER_FIELDS]).toEqual(["headerRow", "date", "buyer", "moneyU"]);
  });

  it("names the one that is hashed but never stored", () => {
    expect([...UNPERSISTED_FIELDS]).toEqual(["moneyAE"]);
  });

  it("gives a write path to exactly one of them", () => {
    expect([...SYNCABLE_HEADER_FIELDS]).toEqual(["date"]);
  });
});

/** What 0089 may touch, asserted against the migration itself. */
describe("0089 writes one column and is service_role only", () => {
  const SQL = readFileSync("supabase/migrations/0089_legacy_sale_group_sync.sql", "utf8")
    .split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");

  it("grants execute to service_role and to nobody else", () => {
    expect(SQL).toMatch(/revoke all on function public\.system_sync_legacy_sale_group\(bigint, date\)\s*\n?\s*from public, anon, authenticated;/);
    expect(SQL).toMatch(/grant execute on function public\.system_sync_legacy_sale_group\(bigint, date\) to service_role;/);
    expect(SQL).not.toMatch(/to authenticated|to anon/);
  });

  it("runs as definer with an empty search path", () => {
    expect(SQL).toContain("security definer");
    expect(SQL).toContain("set search_path = ''");
  });

  it("refuses everything that is not an untouched workbook sale", () => {
    for (const guard of [
      "v_sale.source is distinct from 'excel_order_2026'",
      "v_sale.order_id is not null",
      "p_sold_at is null",
      "p_sold_at < date '2026-01-01'",
    ]) expect(SQL, guard).toContain(guard);
  });

  it("sets sold_at and nothing else", () => {
    const update = /update public\.sales\s*\n([\s\S]*?)\swhere /.exec(SQL);
    expect(update).not.toBeNull();
    expect(update![1]).toContain("sold_at = p_sold_at");
    for (const forbidden of ["buyer_ref", "items_subtotal", "shipping_charged", "discount_amount",
                             "shipped_at", "cancelled_at", "stock_released_at",
                             "import_fingerprint", "is_test", "source", "order_id ="]) {
      expect(update![1], forbidden).not.toContain(forbidden);
    }
  });

  it("creates no stock effect and deletes nothing", () => {
    for (const forbidden of ["shop_inventory", "inventory_movements", "legacy_stock_events",
                             "sale_items", "sale_fees", "sale_refunds", "orderbook_audit"]) {
      expect(SQL, forbidden).not.toContain(forbidden);
    }
    expect(SQL).not.toMatch(/\bdelete\b|\btruncate\b|\bdrop table\b/i);
  });
});

/**
 * The preview tool must actually use the gate.
 *
 * A classifier nobody calls protects nothing, and the one thing that must
 * never happen is a fingerprint stamped past an unexplained difference.
 */
describe("the tool is wired to the gate", () => {
  const TOOL = readFileSync("tools/sync-legacy-orderbook.mts", "utf8");

  it("asks the planner rather than its own row diff", () => {
    // `planSales` is the only thing that knows all eight canonical inputs.
    expect(TOOL).toContain("planSales(");
    expect(TOOL).toContain("planGroups(");
    expect(TOOL).toContain("sale.import_fingerprint === p.fingerprint");
  });

  it("compares every verifiable canonical header field", () => {
    for (const field of ['field: "headerRow"', 'field: "buyer"', 'field: "moneyU"']) {
      expect(TOOL, field).toContain(field);
    }
    // Das Datum läuft über `saleDateDiff`, damit ein fehlender Mappenwert
    // kein Widerspruch ist — die Regel steht an einer Stelle, nicht im Werkzeug.
    expect(TOOL).toContain("const dateDiff = saleDateDiff(txt(sale.sold_at), txt(p.date));");
    expect(TOOL).toContain("if (dateDiff !== null) headerDiffs.push(dateDiff);");
  });

  it("proves the purchase date explanation instead of assuming it", () => {
    // Der frühere Abdruck wird nachgerechnet — über `preview.all`, wie der
    // Abdruck selbst — und nur ein Treffer zählt als Erklärung.
    expect(TOOL).toContain("const dateless = await purchaseFingerprint(");
    expect(TOOL).toContain("{ headerRow: p.headerRow, date: null, totalCost: p.totalCost } as never");
    expect(TOOL).toContain("p.preview.all as never");
    expect(TOOL).toContain("matchesDatelessFingerprint: txt(row?.import_fingerprint) === dateless");
    expect(TOOL).toContain("classifyPurchaseGroup({");
  });

  it("counts the comparison as incomplete without a known header row", () => {
    expect(TOOL).toContain("allVerifiableCompared: knownHeader !== undefined");
  });

  it("refuses to call the plan clean while a group is unexplained", () => {
    expect(TOOL).toContain("groupPlan.unexplained.length === 0");
  });

  it("writes only through the gated 0088/0089 functions", () => {
    // Kein direktes Schreiben an einer Tabelle vorbei am Gate.
    for (const fn of ["system_sync_legacy_sale_item", "system_sync_legacy_purchase_item",
                      "system_add_legacy_purchase_item", "system_sync_legacy_sale_group",
                      "system_set_legacy_sale_fingerprint", "system_set_legacy_purchase_fingerprint"]) {
      expect(TOOL, fn).toContain(fn);
    }
    expect(TOOL).not.toMatch(/\.from\("[a-z_]+"\)\s*\.\s*(update|insert|delete|upsert)/);
  });

  it("writes nothing without --apply and nothing on an unclean plan", () => {
    expect(TOOL).toContain('const APPLY = process.argv.includes("--apply")');
    expect(TOOL).toContain("Es wurde nichts geschrieben");
    expect(TOOL).toContain('if (!clean) { console.error("ABBRUCH: der Plan ist nicht konfliktfrei.")');
  });

  it("checks every row again before the first write", () => {
    // Optimistische Nebenläufigkeitsprüfung: weicht eine Zeile ab, passiert
    // gar nichts statt die Hälfte.
    expect(TOOL).toContain("Optimistische Prüfung");
    expect(TOOL).toContain("geplant");
    expect(TOOL).toContain("Nichts geschrieben");
  });

  it("recomputes fingerprints from the updated database", () => {
    // Kein vorher berechneter Wert wird wiederverwendet.
    expect(TOOL).toContain("const salesAfter = await page<SaleRow>(\"sales\")");
    expect(TOOL).toContain("plansAfter");
    expect(TOOL).toContain("batchAfter");
  });

  it("creates no stock effect of any kind", () => {
    for (const forbidden of ["shop_inventory", "inventory_movements", "legacy_stock_events",
                             "record_inventory_movement"]) {
      expect(TOOL, forbidden).not.toContain(forbidden);
    }
  });

});

/**
 * Die Verkaufsgruppe ab Kopfzeile 545 und die dreizehn undatierten Einkäufe.
 *
 * Beide Fälle haben dieselbe Ursache: der Abdruck hasht das Datum, und beim
 * Import war dort `null` — einmal, weil die Zelle einen Tippfehler trägt
 * (`16.04.206`), dreizehnmal, weil die Gruppe damals noch undatiert war.
 * Das Datum kam später über `apply-workbook-dates.mts` in die Datenbank,
 * ohne den Abdruck anzufassen. Was aussah wie ein Widerspruch, ist die
 * Vorgeschichte derselben Gruppe.
 */
describe("a date the workbook cannot state is not a contradiction", () => {
  it("makes no diff when the workbook has no date and the database has one", () => {
    expect(saleDateDiff("2026-04-16", "")).toBeNull();
    expect(saleDateDiff("2026-04-16", "   ")).toBeNull();
  });

  it("makes no diff when both agree", () => {
    expect(saleDateDiff("2026-04-16", "2026-04-16")).toBeNull();
    // Der gespeicherte Wert darf ein Zeitstempel sein.
    expect(saleDateDiff("2026-04-16T00:00:00+00:00", "2026-04-16")).toBeNull();
  });

  it("still reports a real disagreement", () => {
    expect(saleDateDiff("2026-04-16", "2026-04-17"))
      .toEqual({ field: "date", from: "2026-04-16", to: "2026-04-17" });
    // Und auch dann, wenn die Datenbank noch gar kein Datum trägt.
    expect(saleDateDiff("", "2026-03-18"))
      .toEqual({ field: "date", from: "", to: "2026-03-18" });
  });

  it("feeds the ordinary classification, which stays fail-closed", () => {
    const base: GroupFacts = {
      saleId: 1, headerRow: 545, fingerprintMatches: true,
      headerDiffs: [], itemsChanged: false, allVerifiableCompared: true,
    };
    // Kein Diff mehr → die Gruppe ist schlicht in_sync.
    expect(classifyGroup(base)).toEqual({ kind: "in_sync" });
    // Ein echter Datumsunterschied bleibt ein Widerspruch, wenn der Abdruck passt.
    expect(classifyGroup({ ...base, headerDiffs: [saleDateDiff("2026-04-16", "2026-04-17")!] }).kind)
      .toBe("unexplained");
  });
});

describe("a purchase whose date was applied after the import", () => {
  const facts = (over: Partial<PurchaseFacts> = {}): PurchaseFacts => ({
    purchaseId: 1, headerRow: 1989,
    fingerprintMatches: false,
    matchesDatelessFingerprint: true,
    workbookDate: "2026-08-21",
    storedDate: "2026-08-21",
    itemsChanged: false,
    headerRowMatches: true,
    totalCostMatches: true,
    legacySource: true,
    hasMovement: false,
    ...over,
  });

  it("is explained only when the older fingerprint is actually reproduced", () => {
    const verdict = classifyPurchaseGroup(facts());
    expect(verdict).toEqual({ kind: "date_already_applied", date: "2026-08-21" });
    expect(mayRestampPurchase(verdict)).toBe(true);
  });

  it("refuses when the dateless fingerprint does not match", () => {
    /*
     * Ohne diesen Beweis wäre die Erklärung eine Vermutung: „der Abdruck ist
     * bestimmt alt". Genau das soll dieses Tor verhindern.
     */
    const verdict = classifyPurchaseGroup(facts({ matchesDatelessFingerprint: false }));
    expect(verdict.kind).toBe("unexplained");
    expect(mayRestampPurchase(verdict)).toBe(false);
  });

  it("refuses when the database does not already carry that very date", () => {
    expect(classifyPurchaseGroup(facts({ storedDate: "2026-08-22" })).kind).toBe("unexplained");
    expect(classifyPurchaseGroup(facts({ storedDate: "" })).kind).toBe("unexplained");
  });

  it("refuses when the workbook itself has no date", () => {
    expect(classifyPurchaseGroup(facts({ workbookDate: "", storedDate: "" })).kind)
      .toBe("unexplained");
  });

  /*
   * DIE VIER GRUPPEN, DIE NICHT HIERHER GEHÖREN — Kopfzeilen 2088, 2268,
   * 2278 und 2283.
   *
   * Bei ihnen hat sich zusätzlich eine Positionszeile geändert. Dann ist der
   * gespeicherte Abdruck nicht mehr der frühere Zustand DIESER Gruppe, und
   * es bleibt beim gewöhnlichen Weg — erst die Zeilen korrigieren, danach
   * stempeln. `item` ist deshalb kein Freibrief, sondern die Zusage, dass
   * dieser Lauf die Ursache tatsächlich behebt.
   */
  it("never explains a group by its date when a row changed as well", () => {
    const verdict = classifyPurchaseGroup(facts({ itemsChanged: true }));
    expect(verdict).toEqual({ kind: "item" });
    expect(verdict.kind).not.toBe("date_already_applied");
  });

  it("fails closed on every header component it cannot explain", () => {
    for (const over of [{ headerRowMatches: false }, { totalCostMatches: false },
                        { legacySource: false }, { hasMovement: true }] as const) {
      const verdict = classifyPurchaseGroup(facts(over));
      expect(verdict.kind, JSON.stringify(over)).toBe("unexplained");
      expect(mayRestampPurchase(verdict)).toBe(false);
    }
  });

  it("fails closed on a combination nobody has described", () => {
    // Abdruck weicht ab, nichts Prüfbares erklärt es, kein Datumsbeweis.
    const verdict = classifyPurchaseGroup(facts({
      matchesDatelessFingerprint: false, workbookDate: "2026-08-21", storedDate: "2026-08-21",
    }));
    expect(verdict.kind).toBe("unexplained");
  });

  it("calls a matching fingerprint in_sync, and a matching one with changed rows a contradiction", () => {
    expect(classifyPurchaseGroup(facts({ fingerprintMatches: true })).kind).toBe("in_sync");
    expect(classifyPurchaseGroup(facts({ fingerprintMatches: true, itemsChanged: true })).kind)
      .toBe("unexplained");
  });
});
