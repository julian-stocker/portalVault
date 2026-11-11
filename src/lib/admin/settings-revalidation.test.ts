/**
 * M-05A (2026-11-10) — the five shop settings actions refresh the page their
 * form is on, and every page that reads the value.
 *
 * Until then each revalidated `/admin`, where the forms lived before ADR-0077,
 * but not the `/business` page they are on now: the page one had just saved
 * on kept showing the old values (the same defect as the seller name). The
 * strategy is deliberately narrow — named pages, not `revalidatePath("/",
 * "layout")` — and keeps every path that was revalidated before.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const MOCK = vi.hoisted(() => ({
  revalidated: [] as unknown[][],
  calls: [] as { fn: string; args: unknown }[],
  allowed: true,
  error: null as null | { code: string; message: string },
}));
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => { MOCK.revalidated.push(a); } }));
vi.mock("@/lib/auth/capabilities", () => ({ canOperateSeller: async () => MOCK.allowed, isPlatformAdmin: async () => false }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: async (fn: string, args: unknown) => { MOCK.calls.push({ fn, args }); return { data: null, error: MOCK.error }; },
  }),
}));

const { setShopPercentage, setCommerceMode, setShippingCountry, setShopPolicies, setSellerDetails } = await import("./actions");

beforeEach(() => { MOCK.revalidated = []; MOCK.calls = []; MOCK.allowed = true; MOCK.error = null; });

const paths = () => MOCK.revalidated.map((a) => (a.length === 1 ? a[0] : `${a[0]}|${a[1]}`));

/* The five actions, each with a valid call, its RPC and the pages it must refresh. */
const CASES = [
  { name: "setShopPercentage", run: () => setShopPercentage(30), rpc: "admin_set_shop_percentage",
    form: ["/business/offers"],
    reads: ["/", "/shop", "/zubehoer", "/favoriten", "/cart", "/checkout", "/business/inventory",
      "/(public)/skylanders/[slug]|page", "/(public)/zubehoer/[slug]|page"] },
  { name: "setCommerceMode", run: () => setCommerceMode("sandbox"), rpc: "admin_set_commerce_mode",
    form: ["/business/offers"], reads: ["/checkout", "/cart"] },
  { name: "setShippingCountry", run: () => setShippingCountry("at", "Österreich", true), rpc: "admin_set_shipping_country",
    form: ["/business/shipping", "/business/legal", "/business/profile"], reads: ["/checkout", "/versand"] },
  { name: "setShopPolicies", run: () => setShopPolicies({ dispatchStatement: "Versand in 2 Tagen" }), rpc: "admin_set_shop_policies",
    form: ["/business/profile", "/business/legal", "/business/shipping"], reads: ["/checkout", "/cart"] },
  { name: "setSellerDetails", run: () => setSellerDetails({ city: "Teststadt" }), rpc: "admin_set_seller_details",
    form: ["/business/profile", "/business/legal", "/business/shipping"], reads: [] },
] as const;

describe.each(CASES)("$name", (c) => {
  it("success: refreshes the page(s) of its form and every page that reads the value", async () => {
    expect(await c.run()).toEqual({ ok: true });
    expect(MOCK.calls.map((x) => x.fn)).toEqual([c.rpc]);
    for (const p of [...c.form, ...c.reads]) expect(paths(), p).toContain(p);
  });

  it("…and still refreshes /admin as before (nothing that was revalidated is dropped)", async () => {
    await c.run();
    expect(paths()).toContain("/admin");
  });

  it("…without a site-wide purge", async () => {
    await c.run();
    expect(MOCK.revalidated).not.toContainEqual(["/", "layout"]);
  });

  it("the database refuses: no success, nothing refreshed", async () => {
    MOCK.error = { code: "42501", message: "seller operator role required" };
    const r = await c.run();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).not.toMatch(/gespeichert|saved/i);
    expect(MOCK.revalidated).toEqual([]);
  });

  it("not allowed: no call, nothing refreshed", async () => {
    MOCK.allowed = false;
    expect((await c.run()).ok).toBe(false);
    expect(MOCK.calls).toEqual([]);
    expect(MOCK.revalidated).toEqual([]);
  });
});

describe("every path refreshed is a real page", () => {
  /* All page routes under src/app, as URL paths and as file patterns (with groups). */
  const pages: { url: string; file: string }[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (e === "page.tsx") {
        const file = `/${p.slice("src/app/".length, -"/page.tsx".length)}`.replace(/^\/page\.tsx$/, "/");
        pages.push({ file: file === "/" ? "/" : file, url: file.replace(/\/\([^)]+\)/g, "") || "/" });
      }
    }
  };
  walk("src/app");

  it.each(CASES)("$name revalidates only existing routes", async (c) => {
    await c.run();
    for (const a of MOCK.revalidated) {
      if (a.length === 1) {
        expect(pages.some((p) => p.url === a[0]), `${String(a[0])} is no page`).toBe(true);
      } else {
        expect(a[1]).toBe("page");
        expect(existsSync(join("src/app", `${String(a[0])}/page.tsx`)), `${String(a[0])} is no page file`).toBe(true);
      }
    }
  });
});

describe("the two forms without their own refresh do not need one", () => {
  /*
   * `revalidatePath` from a Server Function updates the UI at once when the
   * page being viewed is among the paths (Next 16 docs, revalidatePath). Both
   * forms' pages are now in their actions' lists, so `router.refresh()` would
   * only repeat the request.
   */
  it.each([
    ["src/components/admin/commerce-panel.tsx", "/business/offers", "setCommerceMode"],
    ["src/components/admin/shop-profile-panel.tsx", "/business/shipping", "setShippingCountry"],
  ])("%s is shown on a page its action refreshes", (component, page, action) => {
    const pageFile = readFileSync(`src/app/(business)${page}/page.tsx`, "utf8");
    const name = /export function ([A-Z]\w+)/.exec(readFileSync(component, "utf8"))![1];
    expect(pageFile).toContain(`<${name}`);
    expect(CASES.find((c) => c.name === action)!.form).toContain(page);
  });
});
