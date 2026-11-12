/**
 * `fetchSellerLegal()` (ADR-0184, AP5): the public seller identity, read with
 * the anon key, typed, checked for required fields — and never replaced by a
 * fallback when something is missing or the call fails.
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

const MOCK = vi.hoisted(() => ({
  created: [] as { url: string; key: string; options: Record<string, unknown> }[],
  calls: [] as string[],
  answer: { data: null as unknown, error: null as { code?: string } | null },
  throws: false,
  connection: 0,
}));
vi.mock("next/server", () => ({ connection: async () => { MOCK.connection += 1; } }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: (url: string, key: string, options: Record<string, unknown>) => {
    MOCK.created.push({ url, key, options });
    return {
      rpc: async (name: string) => {
        MOCK.calls.push(name);
        if (MOCK.throws) throw new Error("fetch failed");
        return MOCK.answer;
      },
    };
  },
}));

const { classifySellerLegal, fetchSellerLegal, interpretSellerLegal, mapSellerLegalRow } = await import("./public");
const { SELLER_LEGAL_FIXTURE, SELLER_LEGAL_ROW } = await import("@/test-support/seller-legal");

afterEach(() => {
  MOCK.created.length = 0; MOCK.calls.length = 0; MOCK.throws = false; MOCK.connection = 0;
  MOCK.answer = { data: null, error: null };
  vi.restoreAllMocks();
});

const quiet = () => {};

describe("the nineteen fields, typed", () => {
  it("maps every column of seller_legal_public() and nothing else", () => {
    expect(mapSellerLegalRow(SELLER_LEGAL_ROW)).toEqual(SELLER_LEGAL_FIXTURE);
    expect(Object.keys(mapSellerLegalRow(SELLER_LEGAL_ROW))).toHaveLength(19);
  });

  it("matches the column list the migration promises", () => {
    const migration = readFileSync("supabase/migrations/0190_seller_legal_public.sql", "utf8");
    const returns = migration.slice(migration.indexOf("returns table ("), migration.indexOf("language sql"));
    const columns = [...returns.matchAll(/^\s+([a-z_0-9]+)\s+(text|boolean)/gm)].map((m) => m[1]);
    expect(columns).toEqual(Object.keys(SELLER_LEGAL_ROW));
  });

  it("an empty string is no value", () => {
    expect(mapSellerLegalRow({ ...SELLER_LEGAL_ROW, w_id: "  ", vat_id: "" })).toMatchObject({ wId: null, vatId: null });
  });

  it("a value of the wrong type is refused, not coerced", () => {
    expect(() => mapSellerLegalRow({ ...SELLER_LEGAL_ROW, small_business_19: "true" })).toThrow();
    expect(() => mapSellerLegalRow({ ...SELLER_LEGAL_ROW, legal_name: 42 })).toThrow();
  });
});

describe("complete and incomplete seller data", () => {
  it("a complete row is ok", () => {
    expect(classifySellerLegal(SELLER_LEGAL_FIXTURE)).toEqual({ status: "ok", seller: SELLER_LEGAL_FIXTURE });
  });

  it("a missing required field is named — with the identity model's codes", () => {
    const result = classifySellerLegal({ ...SELLER_LEGAL_FIXTURE, legalName: null, city: null, contactEmail: null });
    expect(result).toEqual({ status: "incomplete", missing: ["legal.legalName", "legal.city", "shop.contactEmail"] });
  });

  it("tax and register details are optional", () => {
    const result = classifySellerLegal({ ...SELLER_LEGAL_FIXTURE, vatId: null, wId: null, registerCourt: null });
    expect(result.status).toBe("ok");
  });
});

describe("RPC failures and the missing function", () => {
  it("PGRST202 (0190 not applied) is function_missing, not an empty Impressum", () => {
    expect(interpretSellerLegal({ data: null, error: { code: "PGRST202" } }, quiet))
      .toEqual({ status: "unavailable", reason: "function_missing" });
  });

  it("any other error is rpc_error", () => {
    expect(interpretSellerLegal({ data: null, error: { code: "42501" } }, quiet))
      .toEqual({ status: "unavailable", reason: "rpc_error" });
  });

  it("no active seller is no_active_seller", () => {
    expect(interpretSellerLegal({ data: [], error: null }, quiet))
      .toEqual({ status: "unavailable", reason: "no_active_seller" });
  });

  it("an answer that is not a row set, or a row of the wrong shape, is malformed", () => {
    expect(interpretSellerLegal({ data: { x: 1 }, error: null }, quiet)).toMatchObject({ reason: "malformed" });
    expect(interpretSellerLegal({ data: [{ ...SELLER_LEGAL_ROW, legal_name: 7 }], error: null }, quiet))
      .toMatchObject({ reason: "malformed" });
  });

  it("logs codes, never a value from the row", () => {
    const lines: string[] = [];
    interpretSellerLegal({ data: [{ ...SELLER_LEGAL_ROW, city: null }], error: null }, (l) => lines.push(l));
    interpretSellerLegal({ data: null, error: { code: "PGRST202" } }, (l) => lines.push(l));
    interpretSellerLegal({ data: [{ ...SELLER_LEGAL_ROW, legal_name: 7 }], error: null }, (l) => lines.push(l));
    expect(lines).toHaveLength(3);
    const all = lines.join("\n");
    for (const value of Object.values(SELLER_LEGAL_ROW)) {
      if (typeof value === "string" && value.length > 3) expect(all).not.toContain(value);
    }
    expect(all).toContain("legal.city");
  });
});

describe("fetchSellerLegal()", () => {
  it("reads per request, with the anon key and no session", async () => {
    vi.spyOn(console, "error").mockImplementation(quiet);
    MOCK.answer = { data: [SELLER_LEGAL_ROW], error: null };
    const result = await fetchSellerLegal();
    expect(result).toEqual({ status: "ok", seller: SELLER_LEGAL_FIXTURE });
    expect(MOCK.calls).toEqual(["seller_legal_public"]);
    expect(MOCK.connection).toBe(1);
    expect(MOCK.created[0].key).toBe(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    expect(MOCK.created[0].options).toMatchObject({ auth: { persistSession: false, autoRefreshToken: false } });
  });

  it("a request that throws is unavailable, never an exception on every page", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(quiet);
    MOCK.throws = true;
    await expect(fetchSellerLegal()).resolves.toEqual({ status: "unavailable", reason: "rpc_error" });
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("uses no service key, no cookies and no fallback identity", () => {
    const source = readFileSync("src/lib/identity/public.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(source).not.toMatch(/SERVICE_ROLE|service_role|SUPABASE_SERVICE/);
    expect(source).not.toMatch(/next\/headers|cookies\(/);
    expect(source).not.toMatch(/seller-identity|SELLER_IDENTITY|yulez/i);
    expect(source).toContain('rpc("seller_legal_public")');
  });
});
