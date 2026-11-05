/**
 * The Staging run for 0180 (`tools/verify-recon-0180.mts`) — what it runs and
 * the rules it keeps, tested without a database. Its `--apply` half needs
 * 0180 on Staging and a separate approval.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { localCategories } from "@/../tools/verify-recon-0180.mts";
import { EXPECTED_0180, orderRef0180, POSITIVE_PATH_BLOCKED, SCENARIO_0180, scenarioReport0180 } from "./staging-scenario-0180";

const TOOL = readFileSync("tools/verify-recon-0180.mts", "utf8");
const OLD_TOOL = readFileSync("tools/verify-sales-reconciliation.mts", "utf8");
const main = TOOL.slice(TOOL.indexOf("async function main()"));

describe("the scenario", () => {
  it("reconciles locally into a deterministic correction, a unique pair and a reported cancellation", () => {
    expect(localCategories("t1")).toEqual(EXPECTED_0180);
  });

  it("lives entirely in 2001, with recognisably synthetic order numbers unique per run", () => {
    for (const c of SCENARIO_0180) expect(c.sale.sold.startsWith("2001-") && c.order.sold.startsWith("2001-"), c.key).toBe(true);
    const refs = ["a", "b"].flatMap((run) => SCENARIO_0180.map((_, i) => orderRef0180(run, i)));
    expect(new Set(refs).size).toBe(refs.length);
    for (const r of refs) expect(r).toMatch(/^VS[a-z0-9]+-\d{4}$/);
    expect(scenarioReport0180("a")).toContain(orderRef0180("a", 2));
  });
});

describe("the tool's rules, read as source", () => {
  it("checks Staging first; the dry run returns before any client exists", () => {
    expect(main.indexOf('requireStaging("verify:recon-0180")')).toBeGreaterThan(-1);
    expect(main.indexOf("requireStaging(")).toBeLessThan(main.indexOf("createClient("));
    const dry = main.indexOf("if (!apply)");
    expect(dry).toBeLessThan(main.indexOf("anonClient()"));
    expect(main.slice(dry, main.indexOf("const URL_"))).toContain("return;");
    for (const word of ["requireProduction", ".env.local", "zmiwxswrpkmizvqsgype"]) expect(TOOL).not.toContain(word);
  });

  it("writes nothing before it has seen 0180 stand", () => {
    expect(main.indexOf('rpc("seller_recon_preview", { p_session_id: 0')).toBeLessThan(main.indexOf("seller_create_sale_with_details"));
    expect(main).toMatch(/PGRST202[\s\S]*throw new Error\("0180 is not on Staging/);
  });

  it("creates ONLY test sales, never reclassifies one, never touches a table directly", () => {
    expect([...TOOL.matchAll(/seller_create_sale_with_details/g)].length).toBe([...TOOL.matchAll(/p_is_test: true/g)].length);
    for (const word of ["seller_set_sale_test", "p_is_test: false", ".from(", "sky_id:"]) expect(TOOL, word).not.toContain(word);
    expect(main.indexOf("ownCandidates(")).toBeLessThan(main.indexOf("matchOrders("));
  });

  it("uses no service role, manages no account, prints no credential", () => {
    for (const word of ["auth.admin", "createUser", "deleteUser", "SERVICE_ROLE_KEY\")"]) expect(main, word).not.toContain(word);
    expect(main.indexOf("delete process.env.SUPABASE_SERVICE_ROLE_KEY")).toBeLessThan(main.indexOf("createClient("));
    for (const line of main.split("\n").filter((l) => /console\.(log|error)|check\(|throw new Error/.test(l))) {
      expect(line, line).not.toMatch(/EMAIL|PASSWORD|signIn\.data/);
    }
  });

  it("prints no database text — codes and reason codes only", () => {
    expect(TOOL).toContain("throw new Error(`${label}: ${r.error.code ?? \"error\"}`)");
    expect(main).not.toMatch(/error\.message|error\?\.message/);
  });

  it("calls the apply only to be refused: never with its own preview of something applicable", () => {
    const applies = [...main.matchAll(/rpc\("seller_recon_apply", \{[^}]*\}/g)].map((m) => m[0]);
    expect(applies.length).toBe(3);
    for (const a of applies) expect(a).toMatch(/p_decision_ids: \[keep\]|p_expected: 0/);
    // `keep` is a keep_ledger note — 0180 never applies it (no_change).
    expect(main).toContain('decide(finding("cancel-total", "total"), "keep_ledger")');
  });

  it("checks the refusals 0180 promises: old apply, manual, take_external on test sales, selection, token, anon", () => {
    for (const s of ["the retired apply(session, expected) is refused", "manual on a day is refused", "manual cancellation is refused",
      "take_external on a test sale is refused (test_sale)", "adding a reference to a test sale is refused (test_sale)",
      "an empty selection", "a doubled id", "a malformed token", "another token", "anon cannot preview", "anon cannot apply",
      "this run's sales are unchanged"]) {
      expect(main, s).toContain(s);
    }
  });

  it("never counts the open positive path as passed: a clean run is exit 3, incomplete", () => {
    expect(POSITIVE_PATH_BLOCKED.length).toBeGreaterThan(0);
    expect(TOOL).toMatch(/if \(ranOnStaging && POSITIVE_PATH_BLOCKED\.length > 0\)[\s\S]*process\.exit\(3\)/);
    const cleanup = main.slice(main.indexOf("} finally {"));
    expect(cleanup).toContain("OFFEN");
    for (const call of ["seller_recon_discard", "seller_recon_close", ".rpc("]) expect(cleanup, call).not.toContain(call);
  });
});

describe("the retired run of 0169–0174", () => {
  it("stops before writing once 0180 stands", () => {
    const m = OLD_TOOL.slice(OLD_TOOL.indexOf("async function main()"));
    const guard = m.indexOf('rpc("seller_recon_preview"');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(m.indexOf("seller_create_sale_with_details"));
    expect(m).toContain("this run (0169–0174) is retired");
  });
});
