/**
 * The session list's reader: two gates before the database, and three
 * distinguishable answers — so an empty list never hides a failure.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const MOCK = vi.hoisted(() => ({
  rpc: vi.fn(async (): Promise<{ data: unknown; error: { code: string } | null }> => ({ data: [], error: null })),
  seller: true,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: MOCK.rpc }) }));
vi.mock("@/lib/auth/capabilities", () => ({ canOperateSeller: async () => MOCK.seller }));

const { fetchReconciliationSession, fetchReconciliationSessions, reconciliationEnvironment } = await import("./queries");
const { STAGING_PROJECT_REF } = await import("@/lib/admin/catalog-source");

const STAGING = `https://${STAGING_PROJECT_REF}.supabase.co`;
const PRODUCTION = "https://zmiwxswrpkmizvqsgype.supabase.co";

const row = {
  id: 3, channel: "ebay", state: "closed", coveredFrom: "2026-01-01", coveredTo: "2026-01-31", chainComplete: true,
  createdAt: "2026-11-03T10:00:00+00:00", closedAt: "2026-11-03T11:00:00+00:00", discardedAt: null,
  snapshotsPurgedAt: null, summary: {}, files: 1, decided: 0, applied: 0,
};

let before: string | undefined;
beforeEach(() => {
  before = process.env.NEXT_PUBLIC_SUPABASE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_URL = STAGING;
  MOCK.rpc.mockReset();
  MOCK.rpc.mockResolvedValue({ data: [], error: null });
  MOCK.seller = true;
});
afterEach(() => { process.env.NEXT_PUBLIC_SUPABASE_URL = before; });

describe("where the reconciliation exists", () => {
  it("Staging yes; Production, nothing and lookalikes no — fail-closed", () => {
    expect(reconciliationEnvironment()).toBe(true);
    for (const url of [PRODUCTION, "", "no url", `${STAGING}.evil.example`]) {
      process.env.NEXT_PUBLIC_SUPABASE_URL = url;
      expect(reconciliationEnvironment(), url).toBe(false);
    }
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    expect(reconciliationEnvironment()).toBe(false);
  });
});

describe("fetchReconciliationSessions", () => {
  it("Production: unavailable, and the database is not asked", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = PRODUCTION;
    expect(await fetchReconciliationSessions()).toEqual({ status: "unavailable" });
    expect(MOCK.rpc).not.toHaveBeenCalled();
  });

  it("not the seller operator: unavailable, and the database is not asked", async () => {
    MOCK.seller = false;
    expect(await fetchReconciliationSessions()).toEqual({ status: "unavailable" });
    expect(MOCK.rpc).not.toHaveBeenCalled();
  });

  it("calls only seller_recon_sessions, without arguments", async () => {
    await fetchReconciliationSessions();
    expect(MOCK.rpc).toHaveBeenCalledTimes(1);
    expect(MOCK.rpc).toHaveBeenCalledWith("seller_recon_sessions");
  });

  it("an empty list is ok and empty — not an error", async () => {
    expect(await fetchReconciliationSessions()).toEqual({ status: "ok", sessions: [] });
  });

  it("maps the rows through sessionListView", async () => {
    MOCK.rpc.mockResolvedValue({ data: [row], error: null });
    const result = await fetchReconciliationSessions();
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.sessions[0]).toMatchObject({ id: 3, state: "closed", summary: null });
  });

  it("a refusal of the function is an error, not an empty list", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    MOCK.rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    expect(await fetchReconciliationSessions()).toEqual({ status: "error" });
    log.mockRestore();
  });

  it("an answer in an unknown shape is an error — and only the path is logged", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    MOCK.rpc.mockResolvedValue({ data: [{ ...row, state: "archived", channel: "Erika Mustermann" }], error: null });
    expect(await fetchReconciliationSessions()).toEqual({ status: "error" });
    expect(log).toHaveBeenCalledWith("reconciliation sessions:", "sessions[0].state");
    expect(JSON.stringify(log.mock.calls)).not.toContain("Erika");
    log.mockRestore();
  });
});

describe("fetchReconciliationSession — one page of one session", () => {
  const REQUEST = { category: "deviating" as const, offset: 50, limit: 50 };
  const answer = {
    session: {
      id: 3, channel: "ebay", parser: "ebay-orders-report-de", parser_version: 1, state: "closed",
      covered_from: "2026-01-01", covered_to: "2026-01-31", record_first: 1, record_last: 9, chain_complete: true,
      summary: null, created_at: "2026-11-03T10:00:00+00:00", closed_at: null, discarded_at: null, snapshots_purged_at: null,
    },
    files: [], total: 0, matches: [],
  };

  it("Production or not the seller operator: unavailable, and the database is not asked", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = PRODUCTION;
    expect(await fetchReconciliationSession(3, REQUEST)).toEqual({ status: "unavailable" });
    process.env.NEXT_PUBLIC_SUPABASE_URL = STAGING;
    MOCK.seller = false;
    expect(await fetchReconciliationSession(3, REQUEST)).toEqual({ status: "unavailable" });
    expect(MOCK.rpc).not.toHaveBeenCalled();
  });

  it("asks seller_recon_session with exactly the page — the server pages, not the browser", async () => {
    MOCK.rpc.mockResolvedValue({ data: answer, error: null });
    await fetchReconciliationSession(3, REQUEST);
    expect(MOCK.rpc).toHaveBeenCalledWith("seller_recon_session", { p_id: 3, p_category: "deviating", p_offset: 50, p_limit: 50 });
  });

  it("maps the answer through sessionPageView, with the page arithmetic of the request", async () => {
    MOCK.rpc.mockResolvedValue({ data: { ...answer, total: 120 }, error: null });
    const r = await fetchReconciliationSession(3, REQUEST);
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.page.page).toMatchObject({ page: 2, pages: 3, previousOffset: 0, nextOffset: 100 });
  });

  it("no such session (P0002) is not_found — a 404, not an alert", async () => {
    MOCK.rpc.mockResolvedValue({ data: null, error: { code: "P0002" } });
    expect(await fetchReconciliationSession(999999999, REQUEST)).toEqual({ status: "not_found" });
  });

  it("any other refusal is an error, and only its code is logged", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const code of ["42501", "23514", "PT409"]) {
      MOCK.rpc.mockResolvedValue({ data: null, error: { code } });
      expect(await fetchReconciliationSession(3, REQUEST)).toEqual({ status: "error" });
    }
    expect(log.mock.calls).toEqual([["reconciliation session:", "42501"], ["reconciliation session:", "23514"], ["reconciliation session:", "PT409"]]);
    log.mockRestore();
  });

  it("an answer in an unknown shape is an error — the path is logged, never a report value", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    MOCK.rpc.mockResolvedValue({ data: { ...answer, total: 1, matches: [{ id: 1, category: "maybe", order_ref: "01-99999-PRIVAT", title: "Erika Mustermann" }] }, error: null });
    expect(await fetchReconciliationSession(3, REQUEST)).toEqual({ status: "error" });
    expect(log).toHaveBeenCalledWith("reconciliation session:", expect.stringMatching(/^matches\[0\]\./));
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/Erika|PRIVAT/);
    log.mockRestore();
  });
});
