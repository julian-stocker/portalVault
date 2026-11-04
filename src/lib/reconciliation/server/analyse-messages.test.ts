/**
 * What analyseReconciliation can put on screen when it refuses (phase 4, step 4).
 *
 * The action is called for real; only Supabase, the role check and the cache
 * are replaced. Every refusal path is driven — gate, upload check, merge, and
 * each database error code — and every answer must be one of the fixed
 * sentences in `ANALYSE_MESSAGES`, never a database text or a report value.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type RpcError = { code: string; message: string };
const MOCK = vi.hoisted(() => ({
  allowed: true,
  failAt: null as string | null,
  error: null as RpcError | null,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: async (fn: string) => {
      if (fn === MOCK.failAt) return { data: null, error: MOCK.error };
      if (fn === "seller_recon_candidates") return { data: [], error: null };
      if (fn === "seller_recon_aliases") return { data: {}, error: null };
      if (fn === "seller_recon_create") return { data: 1, error: null };
      return { data: null, error: { code: "XX000", message: "unexpected" } };
    },
  }),
}));
vi.mock("@/lib/auth/capabilities", () => ({ canOperateSeller: async () => MOCK.allowed }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { analyseReconciliation } = await import("./actions");
const { ANALYSE_MESSAGES } = await import("../messages");
const { STAGING_PROJECT_REF } = await import("@/lib/admin/catalog-source");
const { fileFingerprint } = await import("../dedupe");
const { parseSalesReport } = await import("../registry");
const { sha256Text } = await import("../sha256");
const { ebayReport } = await import("../testing/ebay-fixture");
type FixtureOrder = import("../testing/ebay-fixture").FixtureOrder;

/** What a careless database text might carry: an address and an order number. */
const LEAK = "kaeuferin@example.invalid 01-00001-00001 SELECT";

const order = (n: number, over: Partial<FixtureOrder> = {}): FixtureOrder => ({
  ref: `01-0000${n}-0000${n}`, record: 1000 + n, sold: `2026-03-0${n}`, lines: [{ unit: 10, character: `Figur ${n}` }], ...over,
});

async function upload(text: string) {
  const parsed = parseSalesReport(text, "eBay-OrdersReport.csv");
  if (!parsed.ok) throw new Error(parsed.error.code);
  return { fingerprint: await fileFingerprint(text, sha256Text), report: parsed.report };
}

async function refusal(input: unknown): Promise<string> {
  const result = await analyseReconciliation(input);
  if (result.ok) throw new Error("expected a refusal");
  return result.message;
}

let before: string | undefined;
beforeEach(() => {
  before = process.env.NEXT_PUBLIC_SUPABASE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${STAGING_PROJECT_REF}.supabase.co`;
  Object.assign(MOCK, { allowed: true, failAt: null, error: null });
});
afterEach(() => { process.env.NEXT_PUBLIC_SUPABASE_URL = before; vi.restoreAllMocks(); });

describe("every refusal is a known fixed sentence", () => {
  it("the gate: not Staging, not the seller operator", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    expect(ANALYSE_MESSAGES.has(await refusal({}))).toBe(true);
    process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${STAGING_PROJECT_REF}.supabase.co`;
    MOCK.allowed = false;
    expect(ANALYSE_MESSAGES.has(await refusal({}))).toBe(true);
  });

  it("the upload check, the merge", async () => {
    const march = await upload(ebayReport([order(1), order(2)]));
    const changed = await upload(ebayReport([order(2, { total: 1 })]));
    for (const input of [
      null, { channel: "ebay", files: [] }, { channel: "ebay", files: [{ fingerprint: LEAK, report: LEAK }] },
      { channel: "ebay", files: [march, changed] },
    ]) {
      const message = await refusal(input);
      expect(ANALYSE_MESSAGES.has(message)).toBe(true);
      expect(message).not.toContain("kaeuferin");
    }
  });

  it.each(["42501", "PT409", "23505", "23514", "23001", "XX000", "P0001", "08006"])(
    "database error %s at every call: a fixed sentence, the database text stays in the server log",
    async (code) => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const input = { channel: "ebay", files: [await upload(ebayReport([order(1)]))] };
      for (const fn of ["seller_recon_candidates", "seller_recon_aliases", "seller_recon_create"]) {
        Object.assign(MOCK, { failAt: fn, error: { code, message: `${LEAK} confirmation counted` } });
        const message = await refusal(input);
        expect(ANALYSE_MESSAGES.has(message)).toBe(true);
        expect(message).not.toContain("kaeuferin");
        expect(message).not.toContain("SELECT");
      }
      log.mockRestore();
    },
  );
});

describe("the source", () => {
  it("analyseReconciliation builds its refusals only from copy or from message()", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("src/lib/reconciliation/server/actions.ts", "utf8");
    const body = source.slice(source.indexOf("export async function analyseReconciliation"), source.indexOf("export type DecisionInput"));
    const refusals = (body.match(/message: [^}]+/g) ?? []).filter((r) => !r.startsWith("message: string"));
    expect(refusals.length).toBeGreaterThan(0);
    for (const r of refusals) expect(r.trim()).toMatch(/^message: (copy\.errors\.\w+|de\.admin\.\w+|message\(\w+\.error\)) ?$/);
    // gate() answers with copy too.
    const gate = source.slice(source.indexOf("async function gate"), source.indexOf("export async function analyseReconciliation"));
    for (const r of (gate.match(/message: [^}]+/g) ?? []).filter((m) => !m.startsWith("message: string"))) expect(r.trim()).toMatch(/^message: (copy\.errors\.\w+|de\.admin\.\w+)$/);
  });

  it("message() returns copy only — the raw database text goes to the log, never into the answer", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("src/lib/reconciliation/server/actions.ts", "utf8");
    const fn = source.slice(source.indexOf("function message("), source.indexOf("async function gate"));
    const returns = fn.match(/return [^;]+;/g) ?? [];
    expect(returns.length).toBeGreaterThan(0);
    for (const r of returns) expect(r).not.toMatch(/error\.message\s*;|error\.details|error\.hint/);
  });
});
