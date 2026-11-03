/**
 * The server layer, read as source — the same way the other Orderbuch
 * actions are guarded (`src/lib/orderbook/*.test.ts`).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ACTIONS = readFileSync("src/lib/reconciliation/server/actions.ts", "utf8");
const QUERIES = readFileSync("src/lib/reconciliation/server/queries.ts", "utf8");
const PAYLOAD = readFileSync("src/lib/reconciliation/server/payload.ts", "utf8");

/** Each exported async function's body. */
function exported(source: string): Map<string, string> {
  const found = new Map<string, string>();
  const pattern = /export async function (\w+)\(/g;
  const starts = [...source.matchAll(pattern)];
  starts.forEach((m, i) => found.set(m[1], source.slice(m.index, starts[i + 1]?.index ?? source.length)));
  return found;
}

describe("the reconciliation's server actions", () => {
  it("are server actions", () => {
    expect(ACTIONS.split("\n").find((l) => l.trim() !== "" && !l.trim().startsWith("*") && !l.trim().startsWith("/**")))
      .toBe('"use server";');
  });

  it("check availability and the seller role before any database call — every one of them", () => {
    const bodies = exported(ACTIONS);
    expect([...bodies.keys()].sort()).toEqual([
      "analyseReconciliation", "applyReconciliation", "closeReconciliation", "decideFinding",
      "discardReconciliation", "thinReconciliationSnapshots",
    ]);
    for (const [name, body] of bodies) {
      const gated = body.indexOf("await gate()") >= 0 ? body.indexOf("await gate()") : body.indexOf("sessionCall(");
      expect(gated, name).toBeGreaterThan(-1);
      const rpc = body.indexOf(".rpc(");
      if (rpc >= 0) expect(gated, name).toBeLessThan(rpc);
    }
    expect(ACTIONS).toMatch(/async function gate\(\)[\s\S]*reconciliationAvailable\(\)[\s\S]*canOperateSeller\(\)/);
  });

  it("are Staging-only, fail-closed, by the configured project — not by a flag", () => {
    expect(ACTIONS).toContain("isStagingProjectUrl(process.env.NEXT_PUBLIC_SUPABASE_URL)");
    expect(QUERIES).toContain("isStagingProjectUrl(process.env.NEXT_PUBLIC_SUPABASE_URL)");
  });

  it("validate the upload before anything else and send only the built payload", () => {
    const analyse = exported(ACTIONS).get("analyseReconciliation") as string;
    expect(analyse.indexOf("validateUpload(input)")).toBeLessThan(analyse.indexOf(".rpc("));
    expect(analyse).toContain('rpc("seller_recon_create", { p_payload: payload })');
  });

  it("send the shown values with every decision (the 0156 pattern)", () => {
    const decide = exported(ACTIONS).get("decideFinding") as string;
    expect(decide).toContain("p_shown_ledger: input.shownLedger");
    expect(decide).toContain("p_shown_external: input.shownExternal");
  });

  it("send the confirmed count with the application", () => {
    expect(exported(ACTIONS).get("applyReconciliation")).toContain("p_expected: expected");
  });

  it("never use the service role and never read a table directly", () => {
    for (const source of [ACTIONS, QUERIES, PAYLOAD]) {
      expect(source).not.toMatch(/SERVICE_ROLE|service_role|serviceRole/);
      expect(source).not.toMatch(/\.from\(/);
    }
  });

  it("turn the database's refusals into German sentences, including PT409", () => {
    expect(ACTIONS).toMatch(/error\.code === "PT409"/);
    expect(ACTIONS).toContain("copy.errors.stale");
    expect(ACTIONS).toContain("copy.errors.countChanged");
  });
});

describe("the existing Verkauf actions", () => {
  it("now name a stale sale instead of the generic failure", () => {
    const sales = readFileSync("src/lib/orderbook/sales-actions.ts", "utf8");
    expect(sales).toMatch(/if \(error\.code === "PT409"\) return copy\.errors\.staleSale;/);
  });
});
