/**
 * The Staging verification — what it runs, and the rules it keeps — tested
 * without a database. The `--apply` half needs Staging and a separate
 * approval; everything that can be decided before it is decided here.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { localPlan } from "@/../tools/verify-sales-reconciliation.mts";
import { EXPECTED_CATEGORIES, SCENARIO, orderRef, ownCandidates, scenarioReport } from "./staging-scenario";
import { ledgerSale } from "./ledger-fixture";

const TOOL = readFileSync("tools/verify-sales-reconciliation.mts", "utf8");

describe("the scenario", () => {
  it("reconciles locally exactly as the nine known cases demand", () => {
    const plan = localPlan("t1");
    expect(plan.categories).toMatchObject(EXPECTED_CATEGORIES);
    expect([plan.decisions, plan.expectedApplied, plan.expectedDocumented]).toEqual([11, 6, 5]);
  });

  it("lives entirely in 2001, far from every real sale", () => {
    for (const c of SCENARIO) {
      expect(c.sale.sold.startsWith("2001-"), c.key).toBe(true);
      expect(c.order.sold.startsWith("2001-"), c.key).toBe(true);
    }
  });

  it("names its orders uniquely per run, recognisably synthetic, in the reference shape", () => {
    const a = SCENARIO.map((_, i) => orderRef("aaa", i));
    const b = SCENARIO.map((_, i) => orderRef("bbb", i));
    expect(new Set([...a, ...b]).size).toBe(a.length * 2);
    for (const r of a) expect(r).toMatch(/^VR[a-z0-9]+-\d{4}$/);
    expect(scenarioReport("aaa")).toContain(orderRef("aaa", 0));
  });

  it("gives its pieces raw names only — no SKY-ID, so no hold and no stock", () => {
    expect(TOOL).toContain("p_items: c.sale.pieces.map((raw) => ({ raw_name: raw }))");
    expect(TOOL).not.toMatch(/sky_id:/);
  });

  it("lets only the run's own sales into the comparison, with the test flag lifted for it alone", () => {
    const own = ledgerSale({ id: 7, sold: "2001-02-01", net: 1, isTest: true, pieces: ["Zap"] });
    const real = ledgerSale({ id: 8, sold: "2001-02-01", net: 1, pieces: ["Zap"] });
    const kept = ownCandidates([own, real], new Set([7]));
    expect(kept.map((s) => [s.saleId, s.isTest])).toEqual([[7, false]]);
  });
});

describe("the tool's rules, read as source", () => {
  const main = TOOL.slice(TOOL.indexOf("async function main()"));

  it("checks the target is Staging before anything else, and knows no Production path", () => {
    expect(main.indexOf('requireStaging("verify:sales-reconciliation")')).toBeGreaterThan(-1);
    expect(main.indexOf("requireStaging(")).toBeLessThan(main.indexOf("createClient("));
    for (const word of ["requireProduction", ".env.local", "zmiwxswrpkmizvqsgype"]) expect(TOOL).not.toContain(word);
  });

  it("is a dry run unless --apply is given, and the dry run returns before any client exists", () => {
    expect(main).toContain('process.argv.includes("--apply")');
    const dry = main.indexOf("if (!apply)");
    expect(dry).toBeGreaterThan(-1);
    expect(dry).toBeLessThan(main.indexOf("createClient("));
    expect(main.slice(dry, main.indexOf("createClient("))).toContain("return;");
  });

  it("creates ONLY test sales, and writes sales only through the seller functions", () => {
    const creates = [...TOOL.matchAll(/seller_create_sale_with_details/g)].length;
    const tests = [...TOOL.matchAll(/p_is_test: true/g)].length;
    expect(creates).toBe(tests);
    expect(TOOL).not.toMatch(/\.from\("sales"\)\.(insert|update|delete|upsert)/);
    expect(TOOL).not.toMatch(/\.from\("sale_items"\)\.(insert|update|delete|upsert)/);
  });

  it("filters the candidates to its own sales before matching", () => {
    expect(main.indexOf("ownCandidates(all, ownIds)")).toBeLessThan(main.indexOf("analyse(plan.report"));
  });

  it("compares stock, movements, legacy events and every real sale before and after", () => {
    for (const s of ["after.stock === before.stock", "after.movements === before.movements",
      "after.legacy === before.legacy", "after.realSales === before.realSales"]) expect(TOOL).toContain(s);
  });

  it("removes its temporary operator in every case", () => {
    expect(main).toMatch(/finally \{[\s\S]*seller_operators[\s\S]*deleteUser/);
  });
});
