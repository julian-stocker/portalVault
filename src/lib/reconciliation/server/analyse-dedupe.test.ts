/**
 * analyseReconciliation and repeated files (phase 4, step 3A).
 *
 * The action is called for real; only Supabase, the role check and the
 * cache are replaced. What it sends to `seller_recon_create` is what it would
 * store — so the tests read the payload, not the action's internals.
 *
 * THE DEFECT THIS PINS. The action skipped repeated files by FILE NAME: two
 * identical files both called `eBay-OrdersReport.csv` made the name "a
 * duplicate", and the filter then removed BOTH — the original too.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Call = { fn: string; args: Record<string, unknown> };
const MOCK = vi.hoisted(() => ({ calls: [] as Call[] }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: async (fn: string, args: Record<string, unknown> = {}) => {
      MOCK.calls.push({ fn, args });
      if (fn === "seller_recon_candidates") return { data: [], error: null };
      if (fn === "seller_recon_aliases") return { data: {}, error: null };
      if (fn === "seller_recon_create") return { data: 1, error: null };
      return { data: null, error: { code: "XX000", message: "unexpected" } };
    },
  }),
}));
vi.mock("@/lib/auth/capabilities", () => ({ canOperateSeller: async () => true }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { analyseReconciliation } = await import("./actions");
const { STAGING_PROJECT_REF } = await import("@/lib/admin/catalog-source");
const { de } = await import("@/lib/i18n/de");
const { buildPreview } = await import("../preview");
const { fileFingerprint } = await import("../dedupe");
const { parseSalesReport } = await import("../registry");
const { sha256Text } = await import("../sha256");
const { ebayReport } = await import("../testing/ebay-fixture");
type FixtureOrder = import("../testing/ebay-fixture").FixtureOrder;
type SessionPayload = import("./payload").SessionPayload;

const errors = de.business.reconciliation.errors;

const order = (n: number, over: Partial<FixtureOrder> = {}): FixtureOrder => ({
  ref: `01-0000${n}-0000${n}`, record: 1000 + n, sold: `2026-03-0${n}`, lines: [{ unit: 10, character: `Figur ${n}` }], ...over,
});
const MARCH = ebayReport([order(1), order(2)]);
const APRIL = ebayReport([order(3, { sold: "2026-04-01" }), order(4, { sold: "2026-04-02" })]);

/** One file as the browser would send it. */
async function upload(name: string, text: string) {
  const parsed = parseSalesReport(text, name);
  if (!parsed.ok) throw new Error(parsed.error.code);
  return { fingerprint: await fileFingerprint(text, sha256Text), report: parsed.report };
}

/** Run the action; return its answer and the payload it stored (if any). */
async function analyse(files: Awaited<ReturnType<typeof upload>>[]) {
  MOCK.calls = [];
  const result = await analyseReconciliation({ channel: "ebay", files });
  const create = MOCK.calls.find((c) => c.fn === "seller_recon_create");
  return { result, payload: (create?.args.p_payload ?? null) as SessionPayload | null };
}

let before: string | undefined;
beforeEach(() => { before = process.env.NEXT_PUBLIC_SUPABASE_URL; process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${STAGING_PROJECT_REF}.supabase.co`; });
afterEach(() => { process.env.NEXT_PUBLIC_SUPABASE_URL = before; });

describe("repeated files in analyseReconciliation", () => {
  it("same name, same content: counted ONCE — not dropped twice (the defect)", async () => {
    const f = await upload("eBay-OrdersReport.csv", MARCH);
    const { result, payload } = await analyse([f, f]);
    expect(result).toEqual({ ok: true, sessionId: 1 });
    expect(payload?.files.map((x) => x.fileName)).toEqual(["eBay-OrdersReport.csv"]);
    expect(payload?.orders.map((o) => o.orderRef)).toEqual(["01-00001-00001", "01-00002-00002"]);
    expect(payload?.coverage.coveredFrom).toBe("2026-03-01");
  });

  it("different name, same content: counted once, the first one kept", async () => {
    const { result, payload } = await analyse([await upload("maerz.csv", MARCH), await upload("maerz (1).csv", MARCH)]);
    expect(result.ok).toBe(true);
    expect(payload?.files.map((x) => x.fileName)).toEqual(["maerz.csv"]);
    expect(payload?.orders).toHaveLength(2);
  });

  it("same name, different content: BOTH files count", async () => {
    const { result, payload } = await analyse([
      await upload("eBay-OrdersReport.csv", MARCH), await upload("eBay-OrdersReport.csv", APRIL),
    ]);
    expect(result.ok).toBe(true);
    expect(payload?.files).toHaveLength(2);
    expect(new Set(payload?.files.map((x) => x.fingerprint)).size).toBe(2);
    expect(payload?.orders).toHaveLength(4);
    expect(payload?.coverage).toMatchObject({ coveredFrom: "2026-03-01", coveredTo: "2026-04-02" });
  });

  it("a repeat after a different file is still recognised by content", async () => {
    const m = await upload("eBay-OrdersReport.csv", MARCH);
    const { payload } = await analyse([m, await upload("eBay-OrdersReport.csv", APRIL), m]);
    expect(payload?.files).toHaveLength(2);
    expect(payload?.orders).toHaveLength(4);
  });

  it("overlapping exports keep the existing rule: the same order once", async () => {
    const overlap = ebayReport([order(2), order(3, { sold: "2026-03-03" })]);
    const { result, payload } = await analyse([await upload("a.csv", MARCH), await upload("a.csv", overlap)]);
    expect(result.ok).toBe(true);
    expect(payload?.files).toHaveLength(2);
    expect(payload?.orders.map((o) => o.orderRef).sort()).toEqual(["01-00001-00001", "01-00002-00002", "01-00003-00003"]);
  });

  it("the same order with different content in a same-named file is still a conflict", async () => {
    const changed = ebayReport([order(2, { total: 1 })]);
    const { result, payload } = await analyse([await upload("a.csv", MARCH), await upload("a.csv", changed)]);
    expect(result).toEqual({ ok: false, message: errors.conflictingOrders });
    expect(payload).toBeNull();
  });
});

describe("a same name hides nothing", () => {
  it("a file with contact data is refused even when a clean file of the same name comes first", async () => {
    const clean = await upload("eBay-OrdersReport.csv", MARCH);
    const dirty = await upload("eBay-OrdersReport.csv", ebayReport([order(5, { lines: [{ unit: 1, title: "Fragen an kontakt@example.invalid" }] })]));
    for (const files of [[clean, dirty], [dirty, clean]]) {
      const { result, payload } = await analyse(files);
      expect(result).toEqual({ ok: false, message: errors.invalidUpload });
      expect(payload).toBeNull();
    }
  });

  it("a malformed file is refused even under a known file's name and fingerprint", async () => {
    const clean = await upload("eBay-OrdersReport.csv", MARCH);
    const broken = { fingerprint: clean.fingerprint, report: { ...clean.report, orders: [{ ...clean.report.orders[0], buyerName: "X" }] } };
    const { result, payload } = await analyse([clean, broken as never]);
    expect(result).toEqual({ ok: false, message: errors.invalidUpload });
    expect(payload).toBeNull();
  });

  it("in the source, every file is validated before any is dropped as a repeat", async () => {
    const { readFileSync } = await import("node:fs");
    const action = readFileSync("src/lib/reconciliation/server/actions.ts", "utf8");
    const validated = action.indexOf("validateUpload(input)");
    expect(validated).toBeGreaterThan(-1);
    expect(validated).toBeLessThan(action.indexOf("distinctFiles(upload.files)"));
    expect(validated).toBeLessThan(action.indexOf("mergeReports(upload.files"));
    // validateUpload itself walks every file before it returns.
    const payload = readFileSync("src/lib/reconciliation/server/payload.ts", "utf8");
    expect(payload).toContain("for (const [i, raw] of top.files.entries())");
  });

  it("nothing is asked of the database before the whole upload has been checked", async () => {
    const clean = await upload("a.csv", MARCH);
    const dirty = await upload("a.csv", ebayReport([order(5, { lines: [{ unit: 1, title: "kontakt@example.invalid" }] })]));
    await analyse([clean, dirty]);
    expect(MOCK.calls).toEqual([]);
  });
});

describe("browser preview and server action agree", () => {
  const cases: [string, [string, string][]][] = [
    ["one file", [["a.csv", MARCH]]],
    ["same name, same content", [["eBay-OrdersReport.csv", MARCH], ["eBay-OrdersReport.csv", MARCH]]],
    ["different name, same content", [["a.csv", MARCH], ["b.csv", MARCH]]],
    ["same name, different content", [["eBay-OrdersReport.csv", MARCH], ["eBay-OrdersReport.csv", APRIL]]],
    ["overlap", [["a.csv", MARCH], ["b.csv", ebayReport([order(2), order(3, { sold: "2026-03-03" })])]]],
  ];

  it.each(cases)("%s: the same files and orders — from the preview's upload and from the raw selection", async (_, selection) => {
    const preview = await buildPreview(selection.map(([name, text]) => ({ name, size: text.length, text })), sha256Text);
    expect(preview.upload).not.toBeNull();
    const raw = await Promise.all(selection.map(([name, text]) => upload(name, text)));
    for (const files of [preview.upload!.files, raw]) {
      const { result, payload } = await analyse(files);
      expect(result.ok).toBe(true);
      expect(payload?.files.map((f) => f.fingerprint)).toEqual(preview.upload!.files.map((f) => f.fingerprint));
      expect(payload?.orders).toHaveLength(preview.orders);
      expect(payload?.coverage.coveredFrom).toBe(preview.firstSoldOn);
      expect(payload?.coverage.coveredTo).toBe(preview.lastSoldOn);
    }
  });
});
