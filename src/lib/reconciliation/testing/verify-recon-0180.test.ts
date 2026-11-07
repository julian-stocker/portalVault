/**
 * The acceptance tool for 0180 (`tools/verify-recon-0180.mts`): it creates
 * nothing on Staging, and it reports "complete" only with the evidence of
 * the rolled-back probe (B) and of the real-server concurrency run (C).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CONCURRENCY_TESTS, concurrencyEvidence, PROBE_CHECKS, probeEvidence, verdict,
} from "@/../tools/verify-recon-0180.mts";

const TOOL = readFileSync("tools/verify-recon-0180.mts", "utf8");
const PROBE = readFileSync("supabase/operations/staging-0180-probe.sql", "utf8");
const CONCURRENCY = readFileSync("src/lib/reconciliation/pg/concurrency-0180.test.ts", "utf8");
const main = TOOL.slice(TOOL.indexOf("async function main()"));

const probeLine = (n = PROBE_CHECKS, failing: number[] = []) =>
  `PRUEFLAUF 0180 ZURUECKGEROLLT — ${n - failing.length}/${n} bestanden | `
  + Array.from({ length: n }, (_, i) => `${i + 1} ${failing.includes(i + 1) ? "FEHLT" : "ok"} Pruefung ${i + 1}`).join(" | ");
const report = (statuses: string[], file = "/x/src/lib/reconciliation/pg/concurrency-0180.test.ts") => JSON.stringify({
  testResults: [{ name: file, assertionResults: statuses.map((status) => ({ status, ancestorTitles: ["0180 on a real PostgreSQL server, several connections"] })) }],
});

describe("the evidence of B and C", () => {
  it("B: only the full success line, every check once, nothing FEHLT", () => {
    expect(probeEvidence(probeLine()).ok).toBe(true);
    expect(probeEvidence(probeLine(PROBE_CHECKS, [12])).ok).toBe(false);
    expect(probeEvidence(probeLine(PROBE_CHECKS - 1)).ok).toBe(false);
    expect(probeEvidence("ABBRUCH R1: Umgebungsstempel nicht gefunden").ok).toBe(false);
    expect(probeEvidence(null).ok).toBe(false);
  });

  it("B: the number of checks is the probe's own", () => {
    expect(PROBE).toContain("probe_record(" + PROBE_CHECKS + ",");
    expect(PROBE).not.toContain("probe_record(" + (PROBE_CHECKS + 1) + ",");
    expect(PROBE).not.toContain("probe_expect(" + (PROBE_CHECKS + 1) + ",");
  });

  it("C: every real-server test ran and passed — skipped counts as missing", () => {
    expect(concurrencyEvidence(report(Array(CONCURRENCY_TESTS).fill("passed"))).ok).toBe(true);
    expect(concurrencyEvidence(report(Array(CONCURRENCY_TESTS).fill("skipped"))).ok).toBe(false);
    expect(concurrencyEvidence(report([...Array(CONCURRENCY_TESTS - 1).fill("passed"), "failed"])).ok).toBe(false);
    expect(concurrencyEvidence(report(Array(CONCURRENCY_TESTS).fill("passed"), "/x/other.test.ts")).ok).toBe(false);
    expect(concurrencyEvidence("not json").ok).toBe(false);
  });

  it("C: the number of tests is the file's own", () => {
    const block = CONCURRENCY.slice(CONCURRENCY.indexOf('describe.skipIf(!ENABLED)'), CONCURRENCY.indexOf('describe("the isolation'));
    expect([...block.matchAll(/^\s+it\(/gm)].length).toBe(CONCURRENCY_TESTS);
  });

  it("complete only live, with B and C; a failed check is 1; anything missing is 3", () => {
    const ok = { ok: true };
    const no = { ok: false };
    const pass = [{ name: "x", passed: true, detail: "" }];
    expect(verdict(pass, true, ok, ok)).toBe(0);
    expect(verdict(pass, true, ok, no)).toBe(3);
    expect(verdict(pass, true, no, ok)).toBe(3);
    expect(verdict(pass, false, ok, ok)).toBe(3);
    expect(verdict([{ name: "x", passed: false, detail: "" }], true, ok, ok)).toBe(1);
  });
});

describe("the tool creates nothing on Staging", () => {
  it("calls no function that writes when it is not refused — only refusals", () => {
    const calls = [...main.matchAll(/\.rpc\("(\w+)"/g)].map((m) => m[1]);
    expect(new Set(calls)).toEqual(new Set(["seller_recon_preview", "seller_recon_apply", "seller_recon_decide"]));
    for (const word of ["seller_create_sale", "seller_recon_create", "seller_update_sale", "seller_set_sale_test", '.from("']) {
      expect(TOOL, word).not.toContain(word);
    }
    // Every apply names session 0, which does not exist — or a token that is refused before the lock.
    for (const m of main.matchAll(/rpc\("seller_recon_apply", \{([^}]*)\}/g)) expect(m[1]).toContain("p_session_id: 0");
    // The one decide is anonymous, and refused.
    expect(main).toMatch(/anon\.rpc\("seller_recon_decide"/);
    expect(main).not.toMatch(/op\.rpc\("seller_recon_decide"/);
  });

  it("checks Staging first, uses no service role and prints no credential", () => {
    expect(main.indexOf('requireStaging("verify:recon-0180")')).toBeLessThan(main.indexOf("createClient("));
    expect(main.indexOf("delete process.env.SUPABASE_SERVICE_ROLE_KEY")).toBeLessThan(main.indexOf("createClient("));
    for (const line of main.split("\n").filter((l) => /console\.(log|error)|check\(|throw new Error/.test(l))) {
      expect(line, line).not.toMatch(/EMAIL|PASSWORD|signIn\.data/);
    }
    for (const word of ["zmiwxswrpkmizvqsgype", ".env.local", "auth.admin"]) expect(TOOL).not.toContain(word);
  });

  it("signs out in a finally, this session only — not every session of the operator", () => {
    expect(main).toMatch(/finally \{\s+(\/\/[^\n]*\n\s+)?await op\.auth\.signOut\(\{ scope: "local" \}\);/);
    expect(main.match(/signOut\(/g)).toHaveLength(1);
  });

  it("is offline unless --live is given", () => {
    const offline = main.indexOf("if (live)");
    expect(offline).toBeGreaterThan(-1);
    expect(offline).toBeLessThan(main.indexOf("createClient("));
  });
});
