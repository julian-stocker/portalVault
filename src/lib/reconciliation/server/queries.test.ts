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

const { fetchReconciliationSessions, reconciliationEnvironment } = await import("./queries");
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
