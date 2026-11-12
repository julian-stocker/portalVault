/**
 * Production release F0: the two operator features whose migrations are on
 * Staging only (0181, 0184) are switched off everywhere else — the screen does
 * not offer them, and the server actions refuse before any database call.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const MOCK = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: async (name: string) => { MOCK.calls.push(name); return { data: name === "seller_sale_item_corrections" ? [] : {}, error: null }; },
  }),
}));
vi.mock("@/lib/auth/capabilities", () => ({ canOperateSeller: async () => true }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { legacySaleItemCorrectionsAvailable, saleWithoutHoldAvailable } = await import("./schema-features");
const actions = await import("@/lib/orderbook/sales-actions");
const { de } = await import("@/lib/i18n/de");

const STAGING = "https://qqxcpesbwfxzgytkdsac.supabase.co";
const PRODUCTION = "https://zmiwxswrpkmizvqsgype.supabase.co";
const refused = { ok: false, message: de.business.sales.errors.legacyCorrectionUnavailable };

beforeEach(() => { MOCK.calls = []; });
afterEach(() => { vi.unstubAllEnvs(); });

describe("the switch", () => {
  it.each([
    [STAGING, true],
    [`${STAGING}/`, true],
    [PRODUCTION, false],
    ["", false],
    ["not a url", false],
    ["https://qqxcpesbwfxzgytkdsac.supabase.co.evil.example", false],
  ])("%s → %s, for both features", (url, expected) => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
    expect(legacySaleItemCorrectionsAvailable()).toBe(expected);
    expect(saleWithoutHoldAvailable()).toBe(expected);
  });
});

describe("0181 actions on Production: refused before the database", () => {
  beforeEach(() => { vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", PRODUCTION); });

  it("correct, add and remove answer with a sentence and call nothing", async () => {
    expect(await actions.correctLegacySaleItem(1, "SKY-0001", 152, "v1")).toEqual(refused);
    expect(await actions.addLegacySaleItem(152, "SKY-0001", null, "v1")).toEqual(refused);
    expect(await actions.removeLegacyAddedItem(1, 152, "v1")).toEqual(refused);
    expect(MOCK.calls).toEqual([]);
  });

  it("the correction trail is empty and not read", async () => {
    expect(await actions.loadSaleItemCorrections(152)).toEqual([]);
    expect(MOCK.calls).toEqual([]);
  });
});

describe("0181 actions on Staging: unchanged", () => {
  beforeEach(() => { vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", STAGING); });

  it("each reaches its function, then re-reads the sale", async () => {
    await actions.correctLegacySaleItem(1, "SKY-0001", 152, "v1");
    await actions.addLegacySaleItem(152, "SKY-0001", null, "v1");
    await actions.removeLegacyAddedItem(1, 152, "v1");
    await actions.loadSaleItemCorrections(152);
    expect(MOCK.calls).toEqual([
      "seller_correct_legacy_sale_item", "seller_sale",
      "seller_add_legacy_sale_item", "seller_sale",
      "seller_remove_legacy_added_item", "seller_sale",
      "seller_sale_item_corrections",
    ]);
  });
});

describe("no way around the switch in the source", () => {
  const SRC = readFileSync("src/lib/orderbook/sales-actions.ts", "utf8");

  it.each([
    "seller_correct_legacy_sale_item", "seller_add_legacy_sale_item",
    "seller_remove_legacy_added_item", "seller_sale_item_corrections",
  ])("%s is called in exactly one function, and that function checks the switch first", (rpc) => {
    const uses = SRC.split(`"${rpc}"`).length - 1;
    expect(uses).toBe(1);
    const at = SRC.indexOf(`"${rpc}"`);
    const fnStart = SRC.lastIndexOf("export async function", at);
    expect(SRC.slice(fnStart, at)).toContain("legacySaleItemCorrectionsAvailable()");
  });

  it("p_hold false is only sent after the 0184 switch", () => {
    const send = SRC.indexOf("{ p_hold: false }");
    const gate = SRC.indexOf("!saleWithoutHoldAvailable()");
    expect(gate).toBeGreaterThan(0);
    expect(gate).toBeLessThan(send);
    expect(SRC.lastIndexOf("export async function", send)).toBe(SRC.lastIndexOf("export async function", gate));
  });

  it("no other source file calls a 0181 function", async () => {
    const { execSync } = await import("node:child_process");
    const hits = execSync(
      "grep -rlE 'seller_(correct_legacy_sale_item|add_legacy_sale_item|remove_legacy_added_item|sale_item_corrections)\"' src"
        + " --include='*.ts' --include='*.tsx' --exclude='*.test.ts' --exclude='*.test.tsx' || true",
      { encoding: "utf8" },
    ).trim().split("\n").filter(Boolean);
    expect(hits).toEqual(["src/lib/orderbook/sales-actions.ts"]);
  });
});
