import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";

/**
 * Three phones (ADR-0077).
 *
 *   A  a collector      — no capability, no badge, no privileged area
 *   B  the shop         — runs yulez.collectibles, cannot touch the catalog
 *   C  the platform     — runs SkyIsles, cannot sell
 *
 * The thing worth protecting is not that each phone can do its job. It is that
 * neither capability leaks into the other while one person holds both, because
 * that is exactly the state in which a leak is invisible.
 */
const MIGRATIONS = "supabase/migrations";
const M41 = `${MIGRATIONS}/0041_three_account_authorization.sql`;
const source = (path: string) => readFileSync(path, "utf8");
const code = (path: string) =>
  source(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*--.*$/gm, "")
    .replace(/^\s*\/\/.*$/gm, "");

const sql = code(M41);

/** The body of one function as 0041 defines it. */
function fn(name: string): string {
  const at = sql.indexOf(`create or replace function public.${name}(`);
  expect(at, `${name} is not defined in 0041`).toBeGreaterThan(-1);
  return sql.slice(at, sql.indexOf("$$;", at));
}

/** Which predicate guards this function, as written. */
function guard(name: string): "platform" | "seller" | "none" {
  const body = fn(name);
  if (body.includes("if not public.is_platform_admin() then")) return "platform";
  if (body.includes("if not public.can_operate_active_seller() then")) return "seller";
  return "none";
}

const BUSINESS_RPCS = [
  "admin_orders", "admin_order", "admin_mark_order_shipped", "admin_unmark_order_shipped",
  "admin_set_tracking_number", "admin_shop_inventory", "admin_inventory_movements",
  "record_inventory_movement", "set_shop_listing", "admin_shop_listing_audit",
  "admin_set_shop_percentage", "admin_shop_settings", "admin_commerce_state",
  "admin_set_commerce_mode", "admin_revert_sandbox_stock", "admin_seller",
  "admin_set_seller_contact", "admin_shop_profile", "admin_set_seller_details",
  "admin_set_shop_policies", "admin_set_shipping_country",
];

const ADMIN_RPCS = [
  "admin_set_catalog_visible", "admin_set_display_name_override", "admin_set_admin_note",
  "admin_set_catalog_group", "admin_catalog_changes", "admin_set_image_override",
  "admin_set_card_type", "admin_create_figure", "admin_platform_settings",
  "admin_set_platform_contact", "admin_find_accounts", "admin_tester_state",
  "admin_set_tester", "admin_set_tester_permission", "admin_set_commerce_tester",
  "admin_perf_runs", "admin_perf_report", "admin_prune_perf_navigations",
  "admin_perf_interactions", "admin_prune_perf_interactions",
  "admin_seller_operators", "admin_set_seller_operator",
];

describe("the two capabilities are orthogonal", () => {
  it("neither predicate calls the other", () => {
    /*
     * The single most important line in this file. If either predicate ever
     * consults the other, "Admin implies Business" is back and no test below
     * would notice, because one person holds both today.
     */
    expect(fn("is_platform_admin")).not.toContain("can_operate");
    expect(fn("can_operate_active_seller")).not.toContain("is_platform_admin");
    expect(fn("can_operate_seller")).not.toContain("is_platform_admin");
  });

  it("reads its own table and nothing else", () => {
    expect(fn("is_platform_admin")).toContain("from public.platform_admins p");
    expect(fn("can_operate_active_seller")).toContain("from public.sellers s");
    expect(fn("can_operate_active_seller")).toContain("join public.seller_operators o");
  });

  it("honours the enabled flag — a withdrawn operator is not an operator", () => {
    /*
     * The row survives a withdrawal on purpose, so that access which existed
     * stays visible (see below). That makes `is_enabled` load-bearing: without
     * it, disabling somebody would change what the screen says and nothing
     * about what they may do.
     *
     * Both predicates, because `can_operate_seller(id)` is what a second
     * seller would use and would otherwise rot unnoticed.
     */
    for (const name of ["can_operate_active_seller", "can_operate_seller"]) {
      expect(fn(name), `${name} ignores is_enabled`).toContain("o.is_enabled");
    }
    // And the active seller must actually be active.
    expect(fn("can_operate_active_seller")).toContain("s.is_active");
  });

  it("resolves from auth.uid(), never from an address or a name", () => {
    for (const name of ["is_platform_admin", "can_operate_seller", "can_operate_active_seller"]) {
      expect(fn(name), name).toContain("(select auth.uid())");
      for (const forbidden of ["email", "username", "display_name"]) {
        expect(fn(name).toLowerCase(), `${name} authorises on ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("names no account anywhere in the migration", () => {
    // The bootstrap reads a table; it does not carry a UUID or an address.
    expect(sql).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(sql).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  });

  it("does not make the deprecated predicate a union of the two", () => {
    const shim = fn("is_shop_admin");
    expect(shim).toContain("select public.is_platform_admin();");
    expect(shim).not.toContain("can_operate");
  });

  it("reports both capabilities separately to the application", () => {
    const mine = fn("my_capabilities");
    expect(mine).toContain("'is_platform_admin', public.is_platform_admin()");
    expect(mine).toContain("'can_operate_seller', public.can_operate_active_seller()");
  });
});

describe("PHONE A — a collector", () => {
  it("holds neither capability by default", () => {
    /*
     * USER is the absence of a row, not a row saying "user" — and 0041 seeds
     * no operator. The only insert is inside `admin_set_seller_operator()`,
     * which a human calls afterwards; nothing here grants the shop to anybody.
     */
    const writer = fn("admin_set_seller_operator");
    const seeds = sql.replace(writer, "");
    expect(seeds).not.toMatch(/insert into public\.seller_operators/i);
    const caps = code("src/lib/auth/capabilities.ts");
    expect(caps).toContain('accountType: "user"');
    expect(caps).toContain("platformAdmin: false");
    expect(caps).toContain("sellerOperator: false");
  });

  it("is refused at both areas", () => {
    expect(code("src/app/(business)/layout.tsx")).toContain("if (!sellerOperator) notFound();");
    expect(code("src/app/(admin)/layout.tsx")).toContain("if (!platformAdmin) notFound();");
  });

  it("gets 404 rather than 403, so neither area announces itself", () => {
    for (const layout of ["src/app/(business)/layout.tsx", "src/app/(admin)/layout.tsx"]) {
      expect(code(layout), layout).toContain("notFound()");
      expect(code(layout), layout).not.toContain("403");
    }
  });

  it("wears no badge", () => {
    const nav = code("src/components/layout/site-nav.tsx");
    expect(nav).toContain("{business ? (");
    expect(nav).toContain("{admin ? (");
    // Both default to false, so a collector renders neither.
    expect(nav).toContain("admin = false");
    expect(nav).toContain("business = false");
  });

  it("is refused by every privileged function in the database", () => {
    for (const name of [...BUSINESS_RPCS, ...ADMIN_RPCS]) {
      expect(guard(name), `${name} has no guard`).not.toBe("none");
    }
  });

  it("keeps its own collection untouched by any of this", () => {
    for (const table of ["collection_items", "profiles"]) {
      expect(sql, table).not.toMatch(new RegExp(`alter table public\\.${table}`, "i"));
    }
  });
});

describe("PHONE B — the shop", () => {
  it("guards every commercial function with the seller capability", () => {
    for (const name of BUSINESS_RPCS) {
      expect(guard(name), `${name} should be seller-guarded`).toBe("seller");
    }
  });

  it("reaches its own area and not the platform's", () => {
    expect(code("src/app/(business)/layout.tsx")).toContain("if (!sellerOperator) notFound();");
    // Being a seller operator is never a way into /admin.
    expect(code("src/app/(admin)/layout.tsx")).not.toContain("sellerOperator) notFound()");
  });

  it("cannot touch the canonical catalog", () => {
    for (const name of [
      "admin_set_catalog_visible", "admin_set_display_name_override", "admin_set_card_type",
      "admin_set_image_override", "admin_create_figure", "admin_set_catalog_group",
    ]) {
      expect(guard(name), `${name} must stay platform-only`).toBe("platform");
    }
  });

  it("cannot manage Business access, testers or platform settings", () => {
    for (const name of [
      "admin_set_seller_operator", "admin_seller_operators",
      "admin_set_tester", "admin_set_tester_permission", "admin_tester_state",
      "admin_set_platform_contact", "admin_platform_settings",
    ]) {
      expect(guard(name), `${name} must stay platform-only`).toBe("platform");
    }
  });

  it("cannot widen its own shop's access", () => {
    // A shop adding its own second operator would be access granting itself.
    expect(fn("admin_set_seller_operator")).toContain("if not public.is_platform_admin() then");
  });

  it("has a management home that reaches every part of the shop", () => {
    const page = code("src/app/(business)/business/page.tsx");
    for (const href of [
      "/business/profile", "/business/offers", "/business/inventory",
      "/business/orders", "/business/shipping", "/business/legal",
    ]) {
      expect(page, href).toContain(href);
    }
  });

  it("has no platform setting on its screen at all", () => {
    /*
     * The placement half of the same boundary. The database refuses a seller
     * who calls `admin_set_platform_support()` — but a field that appears on
     * the seller's screen teaches the wrong ownership even when the save
     * fails, and a future refactor could easily wire it to a writer that
     * does not refuse (ADR-0077).
     */
    const panel = source("src/components/admin/shop-profile-panel.tsx");
    const markup = code("src/components/admin/shop-profile-panel.tsx");
    expect(markup).not.toContain("supportEmail");
    expect(markup).not.toContain("setPlatformSupport");
    expect(markup).not.toContain("platform.");
    // No input labelled as the platform's, however it is spelled.
    expect(markup).not.toMatch(/id="c-support"|Plattform-Support|platformSupport/);
    // The comment explaining why it is absent stays — it is the only mention.
    expect(panel).toContain("THE PLATFORM'S SUPPORT ADDRESS IS NOT HERE");
  });

  it("wears the Business badge", () => {
    expect(source("src/lib/i18n/de.ts")).toContain('modeBadge: "Business"');
    expect(code("src/components/layout/site-nav.tsx")).toContain("de.business.modeBadge");
  });
});

describe("PHONE C — the platform", () => {
  it("guards every platform function with the platform capability", () => {
    for (const name of ADMIN_RPCS) {
      expect(guard(name), `${name} should be platform-guarded`).toBe("platform");
    }
  });

  it("does not get the shop for free", () => {
    // The bootstrap copies shop_admins into platform_admins and stops there.
    expect(sql).toContain("insert into public.platform_admins (user_id, note)");
    expect(sql).toContain("from public.shop_admins a");
    expect(sql).not.toMatch(/insert into public\.seller_operators[\s\S]{0,200}shop_admins/i);
  });

  it("is refused at the seller's area unless explicitly granted", () => {
    const layout = code("src/app/(business)/layout.tsx");
    expect(layout).toContain("if (!sellerOperator) notFound();");
    expect(layout).not.toContain("platformAdmin) notFound()");
    expect(layout).not.toMatch(/sellerOperator\s*\|\|\s*platformAdmin/);
  });

  it("cannot mutate stock, prices or orders unless explicitly granted", () => {
    for (const name of [
      "record_inventory_movement", "set_shop_listing", "admin_set_shop_percentage",
      "admin_mark_order_shipped", "admin_unmark_order_shipped", "admin_set_tracking_number",
    ]) {
      expect(guard(name), `${name} must stay seller-only`).toBe("seller");
    }
  });

  it("edits the platform support address on its own screen", () => {
    const panel = code("src/components/admin/platform-settings.tsx");
    expect(panel).toContain("setPlatformSupport(support)");
    expect(panel).toContain('id="platform-support"');
    expect(panel).toContain("copy.supportEmail");
    // Fed from the platform's own reader, not the seller's.
    expect(code("src/app/(admin)/admin/page.tsx")).toContain("supportEmail={platform.supportEmail}");
    expect(code("src/lib/admin/platform.ts")).toContain("supportEmail: row.support_email ?? null");
  });

  it("owns the catalog, the testers and the platform contact", () => {
    const page = code("src/app/(admin)/admin/page.tsx");
    expect(page).toContain('href="/admin/catalog"');
    expect(page).toContain("<TesterPanel");
    expect(page).toContain("<PlatformSettings");
    expect(page).toContain("<BusinessAccountsPanel");
  });

  it("has nothing commercial on its page", () => {
    const page = code("src/app/(admin)/admin/page.tsx");
    for (const panel of ["<CommercePanel", "<ShopSettings", "<SellerSettings", "<ShopProfilePanel"]) {
      expect(page, panel).not.toContain(panel);
    }
    expect(page).not.toContain("/business/orders");
  });

  it("wears the Admin badge", () => {
    expect(code("src/components/layout/site-nav.tsx")).toContain("de.admin.modeBadge");
  });
});

describe("ONE ACCOUNT, ONE TYPE — there is no BOTH", () => {
  const sql42 = code(`${MIGRATIONS}/0042_strict_account_types.sql`);
  const fn42 = (name: string) => {
    const at = sql42.indexOf(`create or replace function public.${name}(`);
    expect(at, `${name} is not defined in 0042`).toBeGreaterThan(-1);
    return sql42.slice(at, sql42.indexOf("$$;", at));
  };

  it("refuses a shop to an administrator, in a trigger", () => {
    /*
     * A trigger, not a CHECK: the invariant spans two tables, and absence in
     * another table is not something a CHECK or a foreign key can express.
     * It has to survive a direct RPC call, a direct INSERT and the service
     * role — which a guard inside the grant function would not.
     */
    expect(sql42).toContain("before insert or update on public.seller_operators");
    expect(fn42("seller_operators_exclusive")).toContain("from public.platform_admins a");
    expect(fn42("seller_operators_exclusive")).toContain("raise exception");
  });

  it("refuses administration to a shop operator, in a trigger", () => {
    expect(sql42).toContain("before insert or update on public.platform_admins");
    expect(fn42("platform_admins_exclusive")).toContain("from public.seller_operators o");
    expect(fn42("platform_admins_exclusive")).toContain("o.is_enabled");
  });

  it("looks at enabled membership only, so a revoked shop unblocks the change", () => {
    // Revoke then grant is the explicit transition the product wants; a
    // withdrawn row keeps its history and must not be a permanent veto.
    expect(fn42("seller_operators_exclusive")).toContain("if new.is_enabled");
    expect(fn42("platform_admins_exclusive")).toContain("and o.is_enabled");
  });

  it("says why in the grant paths as well as in the triggers", () => {
    expect(fn42("admin_set_seller_operator")).toContain("cannot also operate a shop");
    expect(fn42("admin_set_platform_admin")).toContain("cannot also administer SkyIsles");
  });

  it("never silently removes the other membership", () => {
    // Granting one must refuse, not quietly revoke the other.
    expect(fn42("admin_set_platform_admin")).not.toMatch(/update public\.seller_operators|delete from public\.seller_operators/i);
    expect(fn42("admin_set_seller_operator")).not.toMatch(/delete from public\.platform_admins/i);
  });

  it("will not strand the platform without an administrator", () => {
    expect(fn42("admin_set_platform_admin")).toContain("the last platform administrator cannot be removed");
  });

  it("derives one account type in the database, not from two booleans", () => {
    const mine = fn42("my_capabilities");
    expect(mine).toContain("'account_type', case");
    expect(mine).toContain("then 'admin'");
    expect(mine).toContain("then 'business'");
    expect(mine).toContain("else 'user'");
  });

  it("offers no both-badge state in the bar", () => {
    // The two badges remain independent renders, but the database cannot
    // produce an account that would show both.
    const nav = code("src/components/layout/site-nav.tsx");
    expect(nav).toContain("{business ? (");
    expect(nav).toContain("{admin ? (");
  });
});

describe("the collection belongs to collectors alone", () => {
  const sql42 = code(`${MIGRATIONS}/0042_strict_account_types.sql`);

  it("closes read as well as write", () => {
    // "Inaccessible", not "frozen": a Business account's old shelf is hidden.
    for (const verb of ["select", "insert", "update", "delete"]) {
      expect(sql42, verb).toContain(`collection_items_${verb}_own`);
    }
    expect((sql42.match(/public\.is_collector_account\(\)/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });

  it("replaces the old policies rather than adding to them", () => {
    /*
     * A second permissive policy ORs with the first and grants MORE. Every one
     * of the four is dropped and recreated.
     */
    for (const verb of ["select", "insert", "update", "delete"]) {
      expect(sql42, verb).toContain(`drop policy if exists collection_items_${verb}_own`);
    }
  });

  it("keeps the owner check as well as the collector check", () => {
    expect(sql42).toContain("(select auth.uid()) = user_id and public.is_collector_account()");
  });

  it("deletes nothing when an account changes type", () => {
    // The rows survive; only access moves. Revoking the shop brings the whole
    // collection back untouched.
    expect(sql42).not.toMatch(/delete from public\.collection_items/i);
    expect(sql42).not.toMatch(/truncate/i);
  });

  it("is refused in the application before the row policy, so the answer is clear", () => {
    const action = code("src/lib/collection/actions.ts");
    expect(action).toContain("if (!(await isCollector())) return { ok: false, reason: \"auth\" };");
    expect(code("src/app/(app)/collection/page.tsx")).toContain("if (!(await isCollector())) notFound();");
  });

  it("leaves the catalog readable by all three types", () => {
    // Catalog read is common; only the collection narrowed (ADR-0076).
    expect(sql42).not.toMatch(/policy[^;]*on public\.skylanders/i);
    expect(sql42).not.toMatch(/revoke[^;]*on public\.skylanders/i);
  });
});

describe("Business access is managed, and the history is kept", () => {
  it("disables rather than deletes", () => {
    expect(sql).toContain("is_enabled boolean not null default true");
    expect(fn("admin_set_seller_operator")).not.toMatch(/delete\s+from\s+public\.seller_operators/i);
  });

  it("takes an account id, never an address", () => {
    expect(sql).toContain("p_user_id uuid");
    const writer = fn("admin_set_seller_operator");
    expect(writer.toLowerCase()).not.toContain("email");
  });

  it("exposes no auth.users data through the listing", () => {
    // Username from `profiles`, which is already world-readable. No e-mail.
    const reader = fn("admin_seller_operators");
    expect(reader).toContain("left join public.profiles p");
    expect(reader.toLowerCase()).not.toContain("auth.users");
    expect(reader.toLowerCase()).not.toContain("email");
  });

  it("gives no client role a privilege on either capability table", () => {
    for (const table of ["platform_admins", "seller_operators"]) {
      expect(sql, table).toContain(`alter table public.${table} enable row level security`);
      expect(sql, table).toContain(`revoke all on public.${table} from anon, authenticated`);
      expect(sql, table).not.toMatch(new RegExp(`create policy[^;]*on public\\.${table}`, "i"));
    }
  });
});

describe("nothing else moved", () => {
  it("adds no seller_id to orders, inventory or the catalog", () => {
    for (const table of ["orders", "order_lines", "shop_inventory", "skylanders"]) {
      expect(sql, table).not.toMatch(new RegExp(`alter table public\\.${table}[^;]*seller_id`, "i"));
    }
  });

  it("keeps one active seller and builds no marketplace", () => {
    expect(sql).not.toContain("sellers_one_active");
    for (const forbidden of ["onboarding", "commission", "payout", "ranking", "marketplace"]) {
      expect(sql.toLowerCase(), forbidden).not.toContain(forbidden);
    }
  });

  it("preserves 0039's fulfilment behaviour exactly", () => {
    /*
     * The four functions 0039 shipped are carried across with the guard
     * swapped and nothing else. Their behaviour is what the operator verified
     * on Staging.
     */
    expect(fn("admin_unmark_order_shipped")).toContain("set fulfillment_status = 'unfulfilled'");
    expect(fn("admin_unmark_order_shipped")).toContain("'order_unshipped'");
    expect(fn("admin_unmark_order_shipped")).not.toContain("tracking_number =");
    expect(fn("admin_mark_order_shipped")).toContain("coalesce(v_tracking, v_order.tracking_number)");
    expect(fn("admin_order")).toContain("'series', l.series_snapshot");
  });

  it("drops exactly the two functions whose shape had to change", () => {
    /*
     * A reclassification that quietly reshaped a function would be invisible,
     * so the drops are enumerated rather than merely forbidden.
     *
     * `admin_set_shop_policies` loses `p_support_email` — leaving 0040's
     * ten-argument version standing would leave a seller able to write a
     * platform setting. `admin_platform_settings` gains `support_email`, and
     * a return type cannot change in place.
     */
    const dropped = [...sql.matchAll(/drop function if exists public\.([a-z_]+)/gi)]
      .map((m) => m[1])
      .sort();
    expect(dropped).toEqual(["admin_platform_settings", "admin_set_shop_policies"]);
    const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"));
    expect(files).toContain("0041_three_account_authorization.sql");
  });

  it("keeps the platform support address out of the seller's reach", () => {
    // The bug this cleanup fixed: a seller-guarded writer that wrote
    // `platform_settings`. No route change would have closed it.
    const sellerWriter = fn("admin_set_shop_policies");
    expect(sellerWriter).toContain("if not public.can_operate_active_seller() then");
    expect(sellerWriter).not.toContain("platform_settings");
    expect(sellerWriter).not.toContain("support_email");

    const platformWriter = fn("admin_set_platform_support");
    expect(platformWriter).toContain("if not public.is_platform_admin() then");
    expect(platformWriter).toContain("public.platform_settings");

    // And the seller's reader no longer returns it either.
    expect(fn("admin_shop_profile")).not.toContain("v_platform");
  });
});

describe("navigation offers only what the guard would admit", () => {
  const nav = code("src/components/layout/site-nav.tsx");

  /** The block of the destination list for one href. */
  function destination(href: string): string {
    const at = nav.indexOf(`href: "${href}"`);
    expect(at, href).toBeGreaterThan(-1);
    // To the end of THIS entry: the last one is followed by `];`, not by a
    // sibling, and slicing to end-of-file would swallow unrelated code.
    const sibling = nav.indexOf("\n  {", at);
    const listEnd = nav.indexOf("\n];", at);
    const end = sibling > 0 && (listEnd < 0 || sibling < listEnd) ? sibling : listEnd;
    return nav.slice(at, end > 0 ? end : nav.length);
  }

  it("decides from the capability model, never from a name or an address", () => {
    expect(nav).toContain("type Viewer = { signedIn: boolean; admin: boolean; business: boolean; collector: boolean }");
    for (const forbidden of ["email", "displayName", "seller.displayName", "pathname ===" ]) {
      const at = nav.indexOf("const DESTINATIONS");
      const list = nav.slice(at, nav.indexOf("function itemsFor"));
      expect(list, forbidden).not.toContain(forbidden);
    }
  });

  it("offers the shop and the shelf to the seller, not to the administrator", () => {
    /*
     * The bug this fixed: an administrator saw "Lager", followed it, and got
     * 404 — the guard was right and the link was wrong. Loosening the guard
     * would have been the wrong repair.
     */
    expect(destination("/business")).toContain("applies: (viewer) => viewer.business");
    expect(destination("/business/inventory")).toContain("applies: (viewer) => viewer.business");
    expect(destination("/business/inventory")).not.toContain("viewer.admin");
  });

  it("offers the platform area to the administrator only", () => {
    expect(destination("/admin")).toContain("applies: (viewer) => viewer.admin");
    expect(destination("/admin")).not.toContain("viewer.business");
  });

  it("puts the flagged-order badge on the shop, where it can be acted on", () => {
    // A paid order that booked no stock is the seller's to resolve; until 0041
    // the badge sat on "Admin", which is now the wrong desk.
    expect(destination("/business")).toContain("badge: (counts) => counts.needsResolution");
    expect(destination("/admin")).not.toContain("badge:");
  });

  it("gives the collection to collectors alone", () => {
    /*
     * One account, one type (ADR-0078): only a USER has a collection. An
     * administrator is a platform account, not a collector with extra
     * buttons — and the row policies refuse them the table outright, so the
     * link would lead to an empty page even if it were drawn.
     */
    expect(destination("/collection")).toContain("applies: (viewer) => viewer.collector");
    expect(nav).toContain("collector: !admin && !business");
  });

  it("is fed by the same answer the route guards use", () => {
    for (const layout of [
      "src/app/(public)/layout.tsx", "src/app/(app)/layout.tsx",
      "src/app/(admin)/layout.tsx", "src/app/(business)/layout.tsx",
    ]) {
      const body = code(layout);
      expect(body, layout).toContain("capabilities()");
      // `business` bare is JSX for `business={true}`.
      expect(body, layout).toMatch(/business(=|\n)/);
    }
  });
});

describe("the server gate matches the database predicate", () => {
  const actions = code("src/lib/admin/actions.ts");

  it("asks per action rather than once for everything", () => {
    expect(actions).toContain('type Capability = "platform" | "seller"');
    expect(actions).toContain('capability === "platform" ? isPlatformAdmin() : canOperateSeller()');
    // The old single gate is gone; nothing may fall back to it.
    expect(actions).not.toContain("await isAdmin()");
  });

  it("gates the seller's readers on the seller capability", () => {
    /*
     * These mirror RPCs that 0041 re-guarded. A reader still asking for the
     * platform would hand a Business account an empty shop — the database
     * would have allowed it and the application would have refused.
     */
    for (const file of [
      "src/lib/admin/order-queries.ts", "src/lib/admin/order-actions.ts",
      "src/lib/admin/commerce.ts", "src/lib/admin/seller.ts", "src/lib/admin/shop-profile.ts",
    ]) {
      expect(code(file), file).toContain("canOperateSeller()");
      expect(code(file), file).not.toContain("isAdmin()");
    }
  });

  it("gates the platform's readers on the platform capability", () => {
    for (const file of ["src/lib/admin/platform.ts", "src/lib/admin/seller-operators.ts"]) {
      expect(code(file), file).toContain("isPlatformAdmin()");
    }
  });
});

describe("signing out belongs to the account, whoever the account is", () => {
  it("is rendered exactly once, on the account hub", () => {
    /*
     * This test used to expect the hub and passed while the defect was
     * visible in the browser — `/settings` permanently redirects to
     * `/account`, so the hub IS the Settings surface and the button was on it
     * (ADR-0085). Asserting the route it happened to be on is not the same as
     * asserting where it belongs.
     *
     * Every `.tsx` under `src/app`, not a sample: a second one anywhere fails.
     */
    const renders = (readdirSync("src/app", { recursive: true }) as string[])
      .filter((name) => name.endsWith(".tsx"))
      .map((name) => `src/app/${name}`)
      .filter((file) => readFileSync(file, "utf8").includes('action="/auth/signout"'));
    expect(renders).toEqual(["src/app/(app)/account/page.tsx"]);
  });

  it("and the same one for a collector, a seller and an administrator", () => {
    // Logging out ends a session, which every account type has. Duplicating
    // it into the Business or Admin areas would make it a role action.
    const profile = source("src/app/(app)/account/page.tsx");
    expect(profile).not.toContain("capabilities");
    expect(profile).not.toContain("sellerOperator");
    expect(profile).not.toContain("platformAdmin");
    expect(profile).not.toContain("accountType");
  });

  it("is a POST, so no prefetch can end a session", () => {
    const page = source("src/app/(app)/account/page.tsx");
    expect(page).toContain('method="post"');
    expect(page).toContain("de.nav.signOut");
  });

  it("and there is only one way to sign out at all", () => {
    /*
     * A spare `signOutAction()` sat in `auth/actions.ts`, exported and
     * imported by nothing. The next person needing a sign-out button would
     * have found two implementations and picked one — and then there would be
     * two in the interface too.
     */
    expect(code("src/lib/auth/actions.ts")).not.toContain("signOutAction");
    const routes = (readdirSync("src/app", { recursive: true }) as string[])
      .filter((name) => name.endsWith("route.ts"))
      .map((name) => `src/app/${name}`)
      .filter((file) => readFileSync(file, "utf8").includes("auth.signOut()"));
    expect(routes).toEqual(["src/app/auth/signout/route.ts"]);
  });

  it("is not in any management surface", () => {
    for (const file of [
      "src/app/(admin)/admin/page.tsx", "src/app/(business)/business/page.tsx",
      "src/components/admin/platform-settings.tsx", "src/components/admin/shop-profile-panel.tsx",
    ]) {
      expect(source(file), file).not.toContain("signout");
    }
  });
});

describe("the grant screen states the exclusivity before the attempt", () => {
  const panel = code("src/components/admin/business-accounts-panel.tsx");

  it("refuses an admin account with a sentence, not a failed save", () => {
    expect(panel).toContain("match.isAdmin ? (");
    expect(panel).toContain("copy.isAdminAccount");
    expect(source("src/lib/i18n/de.ts")).toContain("Adminkonto — kein Shopzugang möglich");
  });

  it("says what a revocation means", () => {
    // Back to a collector account, with the collection intact — the sentence
    // an operator needs before withdrawing access, not after.
    expect(panel).toContain("copy.revokedBecomesUser");
    expect(source("src/lib/i18n/de.ts")).toContain("Die Sammlung bleibt erhalten.");
  });

  it("still stores an account id, never an address", () => {
    // The grant helper takes the id; the address only ever finds the account.
    expect(panel).toContain("grant(match.userId, true)");
    expect(panel).toContain("setSellerOperator(userId, enabled)");
    expect(panel).not.toMatch(/setSellerOperator\(\s*(match|operator)\.email/);
  });
});
