/**
 * The two pages that read `admin_shop_settings()` ask for the seller operator
 * themselves, BEFORE their first read (2026-11-11).
 *
 * Why: Next renders layout and page in parallel. The layout's `notFound()`
 * answered an anonymous request with 404, but the page had already started
 * `fetchShopSettings()` as `anon` — which holds no EXECUTE on the function
 * (0007) — and the server logged "permission denied for function
 * admin_shop_settings". Reproduced on the dev server with an anonymous GET of
 * `/business/inventory` and `/business/offers`.
 *
 * The fix is in the pages, not in the database: the grants stay exactly as
 * 0007 set them, and the function body keeps its own operator check (0041).
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const code = (p: string) =>
  readFileSync(p, "utf8").split("\n").filter((l) => !/^\s*(\*|\/\*|\/\/)/.test(l)).join("\n");

const PAGES = [
  "src/app/(business)/business/inventory/page.tsx",
  "src/app/(business)/business/offers/page.tsx",
];

describe("pages reading admin_shop_settings() gate before they read", () => {
  it.each(PAGES)("%s: the operator gate comes before the first data read", (path) => {
    const page = code(path);
    const gate = page.indexOf("if (!(await canOperateSeller())) notFound();");
    expect(gate, "gate missing").toBeGreaterThan(-1);
    const firstRead = page.indexOf("await Promise.all(");
    expect(firstRead).toBeGreaterThan(gate);
    expect(page.indexOf("fetchShopSettings()")).toBeGreaterThan(gate);
    expect(page).toContain('import { notFound } from "next/navigation";');
  });

  it("the gate is the request-cached capability, not a second query", () => {
    const caps = readFileSync("src/lib/auth/capabilities.ts", "utf8");
    expect(caps).toContain("export const capabilities = cache(async ()");
    expect(caps).toMatch(/export async function canOperateSeller\(\)[\s\S]*?\(await capabilities\(\)\)\.sellerOperator/);
    /* Anonymous: no round trip at all. */
    expect(caps).toContain("if (!(await currentUser())) return NO_CAPABILITIES;");
  });

  it("every app caller of admin_shop_settings() sits behind such a page", () => {
    /* One reader in the app: `fetchShopSettings`, used by exactly these pages. */
    const reader = code("src/lib/admin/inventory.ts");
    expect((reader.match(/rpc\("admin_shop_settings"\)/g) ?? []).length).toBe(1);
    for (const path of PAGES) expect(code(path)).toContain("fetchShopSettings()");
  });

  it("the database side is unchanged: EXECUTE for authenticated only, operator check in the body", () => {
    const grants = readFileSync("supabase/migrations/0007_shop_pricing_and_images.sql", "utf8");
    expect(grants).toContain("revoke all on function public.admin_shop_settings()                 from public, anon;");
    expect(grants).toContain("grant execute on function public.admin_shop_settings()                to authenticated;");
    const body = readFileSync("supabase/migrations/0041_three_account_authorization.sql", "utf8");
    const at = body.indexOf("create or replace function public.admin_shop_settings()");
    expect(body.slice(at, body.indexOf("$$;", at))).toContain("if not public.can_operate_active_seller() then");
    /* No later migration grants or revokes anything on it. */
    for (const file of readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql") && f.slice(0, 4) > "0007")) {
      const sql = readFileSync(`supabase/migrations/${file}`, "utf8");
      expect(sql, file).not.toMatch(/(grant|revoke)[^;]*admin_shop_settings/i);
    }
  });

  it("the reader still refuses to swallow a failure", () => {
    expect(code("src/lib/admin/inventory.ts")).toContain("if (error) throw new Error(`shop settings: ${error.message}`);");
  });
});
