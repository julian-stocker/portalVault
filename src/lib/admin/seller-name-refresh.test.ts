/**
 * The trade name after a profile change (2026-11-09).
 *
 * `sellers.display_name` is the one source of the shop's name on the
 * commerce surfaces (catalog quick view, shop, checkout, favourites, "Über
 * SkyIsles", business overview — all `fetchSellerPublic()`). Saving it must
 * refresh every one of them, not only `/admin`, where the form lived before
 * ADR-0077 moved it to `/business/profile` — and must send nothing but the
 * three profile fields.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const MOCK = vi.hoisted(() => ({ revalidated: [] as unknown[][], calls: [] as { fn: string; args: unknown }[], allowed: true }));
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => { MOCK.revalidated.push(a); } }));
vi.mock("@/lib/auth/capabilities", () => ({ canOperateSeller: async () => MOCK.allowed, isPlatformAdmin: async () => false }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: async (fn: string, args: unknown) => { MOCK.calls.push({ fn, args }); return { data: null, error: null }; } }),
}));

const { setSellerContact } = await import("./actions");

beforeEach(() => { MOCK.revalidated = []; MOCK.calls = []; MOCK.allowed = true; });

describe("saving the trade name", () => {
  it("writes only the three profile fields — and refreshes the whole site, not only /admin", async () => {
    expect(await setSellerContact("  skyisles.shop ", "info@skyisles.de", "")).toEqual({ ok: true });
    expect(MOCK.calls).toEqual([{ fn: "admin_set_seller_contact",
      args: { p_display_name: "skyisles.shop", p_contact_email: "info@skyisles.de", p_reply_to: null } }]);
    expect(MOCK.revalidated).toEqual([["/", "layout"]]);
  });

  it("refused: nothing written, nothing refreshed", async () => {
    MOCK.allowed = false;
    expect((await setSellerContact("x", "", "")).ok).toBe(false);
    expect(MOCK.calls).toEqual([]);
    expect(MOCK.revalidated).toEqual([]);
  });

  it("the form shows the saved state at once (router.refresh after success)", () => {
    const form = readFileSync("src/components/admin/seller-settings.tsx", "utf8");
    expect(form).toMatch(/if \(result\.ok\) \{\s*setSaved\(true\);[\s\S]*?router\.refresh\(\);/);
  });

  it("Geschäftsdaten refresh their own pages too (/business/legal and /business/shipping, M-05A)", () => {
    const actions = readFileSync("src/lib/admin/actions.ts", "utf8");
    const details = actions.slice(actions.indexOf("export async function setSellerDetails"));
    expect(details.slice(0, details.indexOf("\n}\n"))).toContain('["/admin", ...SHOP_PROFILE_PAGES]');
    expect(actions).toContain('const SHOP_PROFILE_PAGES: readonly RevalidationTarget[] = ["/business/legal", "/business/shipping"];');
  });
});
