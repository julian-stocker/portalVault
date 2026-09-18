import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";

import {
  NO_SHOP_SETTINGS,
  complaintsContact,
  enabledCountries,
  readShopSettings,
  withdrawalContact,
} from "@/lib/admin/shop-profile-model";

/**
 * USER / SHOP / ADMIN as responsibility domains (ADR-0075).
 *
 * The thing worth protecting here is not that the settings save. It is that
 * two questions which one person happens to answer stay two questions: who
 * sells, and who runs the site. Everything below is a way of noticing if they
 * fuse back together.
 */
const MIGRATION = "supabase/migrations/0040_shop_platform_responsibilities.sql";
const source = (path: string) => readFileSync(path, "utf8");
const code = (path: string) =>
  source(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*--.*$/gm, "")
    .replace(/^\s*\/\/.*$/gm, "");

const sql = code(MIGRATION);
const copy = source("src/lib/i18n/de.ts");

function fn(name: string): string {
  const at = sql.indexOf(`create or replace function public.${name}(`);
  expect(at, name).toBeGreaterThan(-1);
  return sql.slice(at, sql.indexOf("$$;", at));
}

describe("the seller stays singular", () => {
  it("introduces no seller_id anywhere", () => {
    expect(sql).not.toContain("seller_id");
    for (const file of [
      "src/lib/admin/shop-profile-model.ts",
      "src/lib/admin/shop-profile.ts",
      "src/components/admin/shop-profile-panel.tsx",
    ]) {
      expect(source(file), file).not.toContain("seller_id");
    }
  });

  it("keeps the one-active-seller rule and adds no second seller", () => {
    expect(sql).not.toContain("sellers_one_active");
    expect(source("supabase/migrations/0026_platform_and_seller.sql")).toContain("sellers_one_active");
    expect(sql).not.toMatch(/insert\s+into\s+public\.sellers/i);
  });

  it("builds no marketplace", () => {
    for (const forbidden of [
      "onboarding", "commission", "payout", "ranking", "marketplace", "marktplatz",
    ]) {
      expect(sql.toLowerCase(), forbidden).not.toContain(forbidden);
    }
  });

  it("adds no role and no RBAC", () => {
    // `is_shop_admin()` remains the only predicate.
    expect(sql).toContain("public.is_shop_admin()");
    for (const forbidden of ["create role", "shop_operator", "platform_admin", "has_role"]) {
      expect(sql.toLowerCase(), forbidden).not.toContain(forbidden);
    }
  });
});

describe("identity is recorded, never invented", () => {
  it("adds the identity columns as nullable", () => {
    for (const column of [
      "legal_name", "trading_name", "legal_form", "street", "postal_code", "city",
      "country_code", "phone", "direct_contact", "register_court", "register_number",
      "vat_id", "w_id",
    ]) {
      expect(sql, column).toContain(`add column if not exists ${column}`);
    }
  });

  it("seeds no identity value at all", () => {
    /*
     * The heart of it. A placeholder in an Impressum column is not a
     * half-finished setting; it is a false statement about a real person
     * waiting to be published.
     */
    // No DML writes an identity value. (The trading name appears once in a
    // `comment on` doc string as an example — documentation, not data.)
    expect(sql).not.toMatch(/update\s+public\.sellers\s+set/i);
    expect(sql).not.toMatch(/insert\s+into\s+public\.sellers/i);
    for (const invented of [
      "Musterstraße", "Max Mustermann", "DE123456789",
      "support@skyisles", "@skyisles.app", "@skyisles.de",
    ]) {
      expect(sql, invented).not.toContain(invented);
    }
  });

  it("refuses a blank where a value would look filled in", () => {
    expect(sql).toContain("sellers_%1$s_shape");
    expect(sql).toContain("length(btrim(%1$s)) > 0");
  });

  it("starts empty in the model as well", () => {
    for (const value of Object.values(NO_SHOP_SETTINGS.identity)) {
      expect(value).toBeNull();
    }
  });
});

describe("the two contacts are one address and one fallback", () => {
  const contacts = {
    contactEmail: "shop@example.test",
    replyTo: null,
    withdrawalContactEmail: null,
    complaintsContactEmail: null,
  };

  it("falls back to the seller address when unset", () => {
    expect(withdrawalContact(contacts)).toBe("shop@example.test");
    expect(complaintsContact(contacts)).toBe("shop@example.test");
  });

  it("uses a separate address when one is given", () => {
    expect(withdrawalContact({ ...contacts, withdrawalContactEmail: "widerruf@example.test" }))
      .toBe("widerruf@example.test");
    expect(complaintsContact({ ...contacts, complaintsContactEmail: "reklamation@example.test" }))
      .toBe("reklamation@example.test");
  });

  it("yields null when the seller has no address either", () => {
    expect(withdrawalContact({ ...contacts, contactEmail: null })).toBeNull();
  });

  it("resolves the same way in the database, so there is one rule", () => {
    expect(sql).toContain("coalesce(v_seller.withdrawal_contact_email, v_seller.contact_email)");
    expect(sql).toContain("coalesce(v_seller.complaints_contact_email, v_seller.contact_email)");
  });

  it("never copies the seller address into the fallback columns", () => {
    // A copy looks identical today and stops following the original tomorrow.
    const writer = fn("admin_set_shop_policies");
    expect(writer).not.toMatch(/withdrawal_contact_email\s*=\s*[^p]*contact_email\b(?!\))/);
    expect(sql).not.toContain("set withdrawal_contact_email = s.contact_email");
  });
});

describe("platform and seller contacts are different things", () => {
  it("stores them in different tables", () => {
    expect(sql).toContain("alter table public.platform_settings");
    expect(sql).toContain("add column if not exists support_email text");
    // The seller's address stays on `sellers`.
    const reader = fn("admin_shop_profile").replace(/ +/g, " ");
    expect(reader).toContain("'support_email', v_platform.support_email");
    expect(reader).toContain("'contact_email', v_seller.contact_email");
  });

  it("hard-codes no platform address", () => {
    expect(sql).not.toContain("support@");
    expect(source("src/components/admin/shop-profile-panel.tsx")).not.toContain("support@");
    expect(copy).not.toContain("support@skyisles");
  });

  it("targets the table by its CURRENT name", () => {
    /*
     * `0019` created it as `business_settings`; `0026` renamed it to
     * `platform_settings`. The first draft of 0040 read the column list out of
     * 0019, never followed the rename, and failed on Staging with
     * "relation public.business_settings does not exist". Reading a migration
     * is not the same as reading the schema.
     */
    expect(sql).not.toMatch(/(alter|insert into|from|update)\s+table?\s*public\.business_settings/);
    expect(sql).toContain("public.platform_settings");
  });

  it("renames nothing destructively", () => {
    expect(sql).not.toMatch(/alter\s+table\s+\S+\s+rename/i);
    expect(sql).not.toMatch(/drop\s+column/i);
  });

  it("says in each panel which address answers which question", () => {
    // The seller's contacts sit in the shop profile …
    expect(copy).toContain("Der Verkäufer — Bestellungen, Ware, Versand.");
    // … and the platform's support address in the platform panel (ADR-0077).
    expect(copy).toContain("supportEmailHint");
    expect(copy).toContain("Für Fragen zu SkyIsles selbst");
    expect(copy).not.toContain("platformSupportHint");
    // The seller's own name is never typed into copy — it comes from the
    // database, so renaming the shop is one row and not a grep.
    expect(copy).not.toContain("yulez.collectibles");
  });
});

describe("policies", () => {
  it("defaults to the small-business regime, as a regime and not a rate", () => {
    expect(sql).toContain("add column if not exists small_business_19 boolean not null default true");
    expect(NO_SHOP_SETTINGS.policies.smallBusiness19).toBe(true);
    /*
     * § 25a is not represented. It appears once in a `comment on` doc string
     * saying exactly that, so the assertion is about columns and constraints
     * rather than about the word never being written down.
     */
    expect(sql).not.toMatch(/add column[^;]*25a/i);
    expect(sql).not.toContain("margin_scheme");
  });

  it("defaults dispute participation to false and pairs the body with it", () => {
    expect(sql).toContain("add column if not exists dispute_participation boolean not null default false");
    expect(sql).toContain("sellers_dispute_body_only_when_participating");
    expect(NO_SHOP_SETTINGS.policies.disputeParticipation).toBe(false);
  });

  it("defaults return postage to the customer", () => {
    expect(sql).toContain("add column if not exists return_postage_borne_by text not null default 'customer'");
    expect(sql).toContain("check (return_postage_borne_by in ('customer', 'seller'))");
    expect(NO_SHOP_SETTINGS.policies.returnPostageBorneBy).toBe("customer");
  });

  it("promises no delivery time until one is decided", () => {
    expect(sql).toContain("add column if not exists dispatch_statement text");
    expect(NO_SHOP_SETTINGS.policies.dispatchStatement).toBeNull();
    // No invented window anywhere.
    expect(sql).not.toMatch(/\d+\s*[-–]\s*\d+\s*Werktage/);
  });
});

describe("shipping is configuration, and the server decides", () => {
  it("seeds Germany and nothing else", () => {
    expect(sql).toContain("values ('DE', 'Deutschland', true, 1)");
    const seed = sql.slice(sql.indexOf("insert into public.shipping_countries"));
    expect(seed.slice(0, seed.indexOf(";"))).not.toMatch(/'(AT|CH|FR|NL|BE|IT|ES|PL)'/);
  });

  it("keeps today's carriers and prices exactly", () => {
    expect(sql).toContain("('hermes', 'Hermes', 5.49, 1)");
    expect(sql).toContain("('dhl',    'DHL',    6.49, 2)");
    expect(sql).toContain("free_shipping_threshold numeric(10,2) not null default 75.00");
    /*
     * 0040 put it on `shop_settings` and was applied to Staging that way, so
     * it stays there in this file and MOVES in 0041 — a migration that has
     * run is not rewritten (ADR-0077). The move itself is checked in
     * `three-accounts.test.ts`.
     */
    expect(sql).toContain("shop_settings_free_shipping_threshold_sane");
  });

  it("makes create_order ask the configuration instead of a literal", () => {
    const order = fn("create_order");
    expect(order).toContain("if not public.shipping_country_allowed(v_country) then");
    expect(order).not.toContain("v_country <> 'DE'");
    expect(order).not.toContain("SkyIsles delivers to Germany only");
  });

  it("changed nothing else in create_order", () => {
    /*
     * The function is the entire checkout and had to be reproduced whole,
     * so the parts that must not have moved are named here.
     */
    const order = fn("create_order");
    for (const kept of [
      "public.shop_price(i.sale_price, s.market_price, st.price_percentage)",
      "insert into public.order_lines",
      "perform public.reserve_for_order(v_order_id)",
      "v_subtotal + v_shipping",
      "public.shipping_amount_for(p_shipping_method, v_subtotal)",
    ]) {
      expect(order, kept).toContain(kept);
    }
  });

  it("answers the country question in one place", () => {
    const allowed = fn("shipping_country_allowed");
    expect(allowed).toContain("from public.shipping_countries c");
    expect(allowed).toContain("and c.is_enabled");
    expect(allowed).toContain("security definer");
  });

  it("is not decided by the client", () => {
    // The checkout mirrors the list for its form; the server refuses the order.
    const order = fn("create_order");
    expect(order).toContain("raise exception 'this shop does not deliver to %'");
  });

  it("keeps the readers' signatures so every caller is untouched", () => {
    expect(sql).toContain("create or replace function public.free_shipping_threshold()\nreturns numeric");
    expect(sql).toContain("returns table (code text, name text, base_price numeric, sort_order integer)");
  });

  it("offers only enabled countries to a form", () => {
    expect(
      enabledCountries([
        { countryCode: "DE", label: "Deutschland", isEnabled: true },
        { countryCode: "AT", label: "Österreich", isEnabled: false },
      ]).map((c) => c.countryCode),
    ).toEqual(["DE"]);
  });
});

describe("reading the settings document", () => {
  it("survives a database without 0040", () => {
    expect(readShopSettings(null)).toEqual(NO_SHOP_SETTINGS);
    expect(readShopSettings({})).toMatchObject({ policies: { smallBusiness19: true } });
  });

  it("turns an empty string into 'not supplied'", () => {
    const settings = readShopSettings({ seller: { legal_name: "  ", city: "Wien" } });
    expect(settings.identity.legalName).toBeNull();
    expect(settings.identity.city).toBe("Wien");
  });

  it("reads numeric money that PostgREST sends as a string", () => {
    expect(readShopSettings({ shop: { free_shipping_threshold: "75.00" } })
      .policies.freeShippingThreshold).toBe(75);
  });

  it("asks the role before the database", () => {
    expect(code("src/lib/admin/shop-profile.ts"))
      .toContain("if (!(await canOperateSeller())) return NO_SHOP_SETTINGS;");
  });
});

describe("two areas, because they are two authorities", () => {
  const adminPage = code("src/app/(admin)/admin/page.tsx");
  const businessPage = code("src/app/(business)/business/page.tsx");

  it("gives the seller its own route group with its own gate", () => {
    /*
     * 0041 turned the headings of ADR-0075 into routes. A platform
     * administrator who was never granted the shop gets a 404 at /business,
     * and a seller operator gets one at /admin — neither implies the other
     * (ADR-0077).
     */
    expect(code("src/app/(business)/layout.tsx")).toContain("if (!sellerOperator) notFound();");
    expect(code("src/app/(admin)/layout.tsx")).toContain("if (!platformAdmin) notFound();");
  });

  it("puts commerce under /business and nothing commercial under /admin", () => {
    /*
     * Since the shop became a management area the panels live on the page
     * whose subject they are (ADR-0080); the hub links to them. What matters
     * here is unchanged: none of them is reachable from the platform area.
     */
    const businessArea = [
      "src/app/(business)/business/page.tsx",
      "src/app/(business)/business/offers/page.tsx",
      "src/app/(business)/business/profile/page.tsx",
      "src/app/(business)/business/legal/page.tsx",
      "src/app/(business)/business/shipping/page.tsx",
    ].map(code).join("\n");

    for (const panel of ["<CommercePanel", "<ShopSettings", "<SellerSettings", "<ShopProfilePanel"]) {
      expect(businessArea, panel).toContain(panel);
      expect(adminPage, panel).not.toContain(panel);
    }
    // The hub is a list of areas, so the routes appear as data rather than
    // as JSX attributes.
    expect(businessPage).toContain('href="/business/orders?open=1"');
    expect(businessPage).toContain('href: "/business/inventory"');
  });

  it("puts the platform on the admin page and nothing platform-ish on the business page", () => {
    for (const panel of ["<TesterPanel", "<PlatformSettings", "<BusinessAccountsPanel"]) {
      expect(adminPage, panel).toContain(panel);
      expect(businessPage, panel).not.toContain(panel);
    }
    // The catalog belongs to SkyIsles (ADR-0076) and is not reachable from
    // the seller's home.
    expect(adminPage).toContain('href="/admin/catalog"');
    expect(businessPage).not.toContain("/admin/catalog");
  });

  it("creates no empty page for symmetry", () => {
    // Existing routes and existing components, regrouped. Nothing was
    // invented to balance a column — and no ratings card, because there is
    // nothing behind it (ADR-0080).
    expect(adminPage).toContain('href="/admin/catalog/categories"');
    expect(businessPage).not.toContain("Bewertung");
  });

  it("groups the shop settings the way an operator asks the questions", () => {
    for (const group of [
      "sellerHeading", "contactHeading", "taxHeading", "shippingHeading", "withdrawalHeading",
    ]) {
      expect(copy, group).toContain(group);
    }
  });
});

describe("customer-facing copy names the right seller", () => {
  it("no longer claims SkyIsles sells", () => {
    expect(copy).not.toContain("Verkäufer ist SkyIsles");
    expect(copy).not.toContain("Diese Figuren verkauft SkyIsles gerade selbst");
    expect(copy).not.toContain("Es gibt genau einen Verkäufer, und das ist");
    expect(copy).not.toContain("SkyIsles verkauft ausgewählte Figuren selbst");
  });

  it("takes the name from the seller reader rather than a literal", () => {
    // The name must not be typed into copy or components.
    for (const file of [
      "src/lib/i18n/de.ts",
      "src/components/checkout/checkout-view.tsx",
      "src/app/(public)/shop/page.tsx",
      "src/app/(public)/ueber-skyisles/page.tsx",
    ]) {
      expect(source(file), file).not.toContain("yulez.collectibles");
    }
    expect(code("src/app/(public)/checkout/page.tsx")).toContain("fetchSellerPublic()");
    expect(code("src/app/(public)/shop/page.tsx")).toContain("de.shop.page.intro(seller.displayName)");
  });

  it("falls back to a neutral sentence rather than a guessed name", () => {
    expect(copy).toContain("sellerFallback");
    expect(copy).toContain("introFallback");
    expect(copy).toContain("shopBodyFallback");
    expect(code("src/components/checkout/checkout-view.tsx"))
      .toContain("sellerName ? copy.seller(sellerName) : copy.sellerFallback");
  });

  it("labels the checkout row as the sale, not as SkyIsles", () => {
    expect(copy).toContain('sellerLabel: "Verkauf durch"');
  });

  it("still says this is not a marketplace", () => {
    expect(copy).toContain("vermittelt nicht zwischen Händlern");
    expect(copy).toContain("kein Marktplatz");
  });
});

describe("the catalog stays a catalog", () => {
  it("keeps FigureCard seller-neutral", () => {
    const card = source("src/components/catalog/figure-card.tsx");
    expect(card).not.toContain("seller");
    expect(copy).toContain('offersFromLabel: "Angebote ab"');
  });

  it("keeps QuickView as the surface that names the seller", () => {
    const quickView = source("src/components/catalog/quick-view.tsx");
    expect(quickView).toContain("{seller.displayName}");
    expect(quickView).toContain("{de.quickView.sellerKind}");
    expect(copy).toContain('sellerKind: "Gewerblicher Verkäufer"');
  });
});

describe("USER is untouched", () => {
  it("changes no account, profile or collection surface", () => {
    // Nothing in this migration reaches the collector's own data.
    for (const table of ["profiles", "collection_items", "auth.users"]) {
      expect(sql, table).not.toMatch(new RegExp(`alter table [^;]*${table}`, "i"));
    }
  });

  it("leaves the customer's order view alone", () => {
    const page = source("src/app/(app)/account/orders/[orderNumber]/page.tsx");
    expect(page).toContain("copy.shipmentStatus");
    expect(page).not.toContain("shop-settings");
  });
});

describe("no secrets, no over-exposure", () => {
  it("exposes nothing new through a public reader", () => {
    // `seller_public()` is untouched: the customer still sees a display name.
    expect(sql).not.toContain("seller_public");
    expect(source("src/lib/shop/seller.ts")).toContain("displayName: string;");
  });

  it("keeps the settings readers admin-only", () => {
    for (const name of [
      "admin_shop_profile", "admin_set_seller_details",
      "admin_set_shop_policies", "admin_set_shipping_country",
    ]) {
      expect(fn(name), name).toContain("if not public.is_shop_admin() then");
    }
  });

  it("gives anon nothing beyond the country list a checkout form needs", () => {
    expect(sql).toContain("revoke all on public.shipping_countries from anon, authenticated");
    expect(sql).toContain("grant select on public.shipping_countries to anon, authenticated");
    // Methods and prices stay behind shipping_quote().
    expect(sql).toContain("revoke all on public.shipping_methods from anon, authenticated");
    expect(sql).not.toContain("grant select on public.shipping_methods to anon");
  });

  it("stores no secret", () => {
    /*
     * `create_order()` is reproduced whole and legitimately hashes a payment
     * token, so the sweep covers everything this migration ADDS rather than
     * the function it had to carry across unchanged.
     */
    const added = sql.slice(0, sql.indexOf("create or replace function public.create_order("));
    for (const forbidden of ["api_key", "secret", "token", "password", "sk_live", "service_role"]) {
      expect(added.toLowerCase(), forbidden).not.toContain(forbidden);
    }
  });
});

describe("what 0040 leaves for Legal V1", () => {
  it("publishes nothing yet", () => {
    for (const route of ["impressum", "datenschutz", "widerruf", "agb"]) {
      expect(sql, route).not.toContain(route);
    }
  });

  it("adds no contract versioning to orders", () => {
    expect(sql).not.toContain("terms_version");
    expect(sql).not.toContain("withdrawal_version");
    expect(sql).not.toMatch(/alter table public\.orders/i);
  });

  it("does not depend on 0035", () => {
    expect(sql).not.toContain("system_set_image_override");
  });

  it("does not touch performance telemetry or fulfilment", () => {
    for (const forbidden of [
      "perf_navigations", "perf_interactions", "admin_unmark_order_shipped",
      "orders_protect_fulfillment", "series_snapshot",
    ]) {
      expect(sql, forbidden).not.toContain(forbidden);
    }
  });
});

describe("the catalog belongs to SkyIsles (ADR-0076)", () => {
  const migrations = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();

  it("gives no client role a write privilege on a canonical catalog table", () => {
    /*
     * The invariant that makes a second Business cheap: every collector and
     * every seller reads ONE catalog, and only an administrator corrects it.
     * A grant or a write policy here would be the first duplicate.
     */
    for (const table of ["skylanders", "categories", "series", "catalog_editorial"]) {
      for (const file of migrations) {
        const body = code(`supabase/migrations/${file}`);
        expect(
          body,
          `${file} grants a write on public.${table}`,
        ).not.toMatch(new RegExp(`grant[^;]*\\b(insert|update|delete|all)\\b[^;]*on public\\.${table}\\b`, "i"));
        expect(
          body,
          `${file} adds a write policy on public.${table}`,
        ).not.toMatch(new RegExp(`create policy[^;]*on public\\.${table}[^;]*for (insert|update|delete|all)`, "i"));
      }
    }
  });

  it("attaches commerce to the catalog instead of copying it", () => {
    // `shop_inventory` references the figure; it does not restate it.
    const inventory = code("supabase/migrations/0003_shop_foundation.sql");
    expect(inventory).toMatch(/sky_id\s+text\s+not null/);
    for (const canonical of ["image_file", "series_code", "element", "card_type"]) {
      expect(
        inventory.slice(
          inventory.indexOf("create table public.shop_inventory"),
          inventory.indexOf(");", inventory.indexOf("create table public.shop_inventory")),
        ),
        `shop_inventory duplicates the canonical column ${canonical}`,
      ).not.toContain(canonical);
    }
  });

  it("keeps seller-owned settings off the platform singleton", () => {
    /*
     * `shop_settings` is `check (id)` — one row, for ever. A seller's postage
     * policy cannot live there once a second seller exists.
     *
     * 0040 put it there and was applied to Staging that way, so the move
     * happens in 0041 rather than by rewriting a migration that has run.
     */
    const platformSingleton = code("supabase/migrations/0007_shop_pricing_and_images.sql");
    expect(platformSingleton).toContain("constraint shop_settings_singleton check (id)");
    const later = code("supabase/migrations/0041_three_account_authorization.sql");
    expect(later).toMatch(/alter table public\.sellers[\s\S]{0,300}free_shipping_threshold/);
    expect(later).toContain("update public.sellers s");
  });

  it("still introduces no seller_id — the future is additive, not present", () => {
    expect(sql).not.toContain("seller_id");
  });
});
