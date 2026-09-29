import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";

/**
 * The shop as a place you can manage, and the account as a place you cannot
 * mistake for settings (ADR-0080).
 *
 * Two failures of information architecture, both found by using the product:
 * the account hub wore a cog, and `/business` was four stacked panels under
 * two links — so the seller's legal address sat two scrolls below the order
 * count. Nothing about authorization changed here; what changed is where
 * things are and what they are called.
 */
const source = (path: string) => readFileSync(path, "utf8");
const code = (path: string) =>
  source(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*--.*$/gm, "")
    .replace(/^\s*\/\/.*$/gm, "");

const B = "src/app/(business)/business";
const hub = code(`${B}/page.tsx`);
const nav = code("src/components/layout/site-nav.tsx");
const copy = source("src/lib/i18n/de.ts");

describe("the account is an account, not a settings screen", () => {
  it("no longer draws a cog for it", () => {
    /*
     * The label already said "Mein Konto" and a comment already argued against
     * the word "Einstellungen" — above a cog. An affordance outvotes a label
     * it contradicts. Das Kartensymbol, das den Zahn ablöste, ist inzwischen
     * selbst weg: es gibt nur noch einen Konto-Knopf, und der trägt das
     * Personensymbol.
     */
    expect(nav).not.toContain("SettingsGlyph");
    expect(nav).not.toContain("function SettingsAction(");
    expect(nav).not.toContain("AccountHubGlyph");
    expect(nav).toContain("function ProfileAction(");
  });

  it("still leads to the hub, by its own accessible name", () => {
    /*
     * SEIT 0099 ENTSCHEIDET DIE AKTIVE ROLLE ÜBER DIE TÜR.
     *
     * Vorher führte dieses Symbol jeden nach `/account` — auch ein
     * Betriebskonto, für das `/account` die Käuferperspektive ist („Meine
     * Bestellungen") und das nach ADR-0078 gar nicht kaufen kann. Es bleibt
     * bei EINER Tür je Person; welche es ist, hängt jetzt an der Rolle.
     */
    expect(nav).toContain('href={!signedIn ? "/login" : business ? "/business" : "/account"}');
    expect(nav).toContain("de.nav.profile");
    expect(copy).toContain('account: "Mein Konto"');
  });

  it("calls no user-facing surface Einstellungen", () => {
    // `Shop-Einstellungen` and `Versand-Einstellungen` are configuration and
    // may keep the word; the personal account may not.
    const account = code("src/app/(app)/account/page.tsx");
    expect(account).not.toContain("Einstellungen");
    expect(account).toContain("de.account.title");
    expect(copy).toContain('title: "Mein Konto"');
  });

  it("keeps exactly one logout implementation, shown in each account area", () => {
    /*
     * Keine Seite schreibt das Formular mehr selbst — es gibt eine Komponente
     * und einen Endpunkt. Seit ADR-0111 führt die Rolle in zwei verschiedene
     * Kontobereiche, und jeder von beiden zeigt sie: ein Betriebskonto landet
     * auf `/business`, und ein Kontobereich ohne Ausgang ist eine Sackgasse.
     */
    const inline = (readdirSync("src/app", { recursive: true }) as string[])
      .filter((name) => name.endsWith(".tsx"))
      .map((name) => `src/app/${name}`)
      .filter((file) => readFileSync(file, "utf8").includes('action="/auth/signout"'));
    expect(inline).toEqual([]);

    const shows = (readdirSync("src/app", { recursive: true }) as string[])
      .filter((name) => name.endsWith(".tsx"))
      .map((name) => `src/app/${name}`)
      .filter((file) => readFileSync(file, "utf8").includes("<SignOutForm />"))
      .sort();
    expect(shows).toEqual([
      "src/app/(app)/account/page.tsx",
      "src/app/(business)/business/page.tsx",
    ]);
  });

  it("puts logout in no working screen — only in the two account hubs", () => {
    /*
     * REVIDIERT MIT ADR-0111, und nur zur Hälfte. Die Regel war: kein
     * Abmelden in einem Verwaltungsbereich, weil es eine Rollenhandlung
     * daraus machte. Sie galt, solange das Konto-Symbol jede Rolle nach
     * `/account` führte.
     *
     * Seit die Rolle die Tür bestimmt, ist `/business` der Kontobereich des
     * Betriebs — der Knopf gehört dorthin und nirgends sonst. Auf keinem
     * Arbeitsbildschirm (Lager, Bestellungen, Orderbuch, Berichte, Admin)
     * steht er, und das bleibt geprüft.
     */
    const managed = (readdirSync("src/app", { recursive: true }) as string[])
      .filter((name) => name.endsWith(".tsx"))
      .filter((name) => name.startsWith("(business)") || name.startsWith("(admin)"))
      .filter((name) => name !== "(business)/business/page.tsx")
      .map((name) => `src/app/${name}`);
    expect(managed.length).toBeGreaterThan(8);
    for (const file of managed) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toContain("signout");
      expect(source, file).not.toContain("SignOutForm");
    }
  });
});

describe("the shop has a management home", () => {
  it("reaches every area it owns", () => {
    for (const href of [
      "/business/profile", "/business/offers", "/business/inventory",
      "/business/orders", "/business/shipping", "/business/legal",
    ]) {
      expect(hub, href).toContain(href);
    }
  });

  it("navigates rather than edits", () => {
    // The dashboard is an overview; the fields belong to the area that owns
    // them. A form here would be the page this replaced.
    for (const panel of ["<ShopProfilePanel", "<SellerSettings", "<CommercePanel", "<ShopSettings"]) {
      expect(hub, panel).not.toContain(panel);
    }
  });

  it("interrupts only for work that exists", () => {
    expect(hub).toContain("hasOpenWork(openOrders)");
    expect(hub).toContain("orders.needsResolutionCount(openOrders.needsResolution)");
  });

  it("names the shop from seller data, never from the account username", () => {
    expect(hub).toContain("fetchSellerPublic()");
    expect(hub).toContain("seller.displayName");
    expect(hub).not.toContain("username");
    expect(hub).not.toContain("profile.username");
  });

  it("shows no ratings, because there are none", () => {
    /*
     * `site-footer.tsx` settled this rule for the product: only destinations
     * that exist are linked, because a dead link is worse than a missing one.
     * There is no rating schema, no data and no page — so the section is
     * recorded in the ADR and not drawn here.
     */
    for (const word of ["Bewertung", "rating", "Rezension", "review"]) {
      expect(hub.toLowerCase(), word).not.toContain(word.toLowerCase());
    }
  });
});

describe("each area owns its own subject, once", () => {
  const pages = {
    profile: code(`${B}/profile/page.tsx`),
    offers: code(`${B}/offers/page.tsx`),
    shipping: code(`${B}/shipping/page.tsx`),
    legal: code(`${B}/legal/page.tsx`),
  };

  it("splits the five settings groups across the pages that own them", () => {
    expect(pages.shipping).toContain('groups={["shipping"]}');
    expect(pages.legal).toContain('groups={["seller", "contact", "tax", "withdrawal"]}');
    // No group is rendered twice.
    expect(pages.profile).not.toContain("ShopProfilePanel");
    expect(pages.offers).not.toContain("ShopProfilePanel");
  });

  it("puts the public trade name on the profile and the legal name elsewhere", () => {
    expect(pages.profile).toContain("<SellerSettings");
    expect(pages.legal).toContain('"seller"');
    expect(pages.profile).not.toContain("legalName");
  });

  it("keeps shop-wide commerce controls apart from per-figure ones", () => {
    expect(pages.offers).toContain("<CommercePanel");
    expect(pages.offers).toContain("<ShopSettings");
    // And points at the place per-figure listing actually lives.
    expect(pages.offers).toContain("/business/inventory");
  });

  it("states the missing seller icon instead of faking one", () => {
    expect(pages.profile).toContain("profileIconMissing");
    expect(copy).toContain("Ein Händler-Icon gibt es noch nicht.");
    // No upload, no storage call, no empty frame pretending to be one.
    expect(pages.profile).not.toContain("upload");
    expect(pages.profile).not.toContain("storage");
  });

  it("reaches no platform setting and no canonical catalog", () => {
    /*
     * Routes, not module paths: several of these components still live under
     * `components/admin/` from when there was one operator area, and moving
     * the directory would be churn without a reader (ADR-0080). What matters
     * is that no page LINKS into the platform area.
     */
    for (const [name, page] of Object.entries(pages)) {
      expect(page, name).not.toContain("supportEmail");
      expect(page, name).not.toContain("<PlatformSettings");
      expect(page, name).not.toMatch(/href[=:]\s*"\/admin/);
      expect(page, name).not.toContain("admin_set_catalog");
    }
  });
});

describe("two meanings of Bestellungen", () => {
  it("says whose orders the shop's list holds", () => {
    expect(code(`${B}/orders/page.tsx`)).toContain("de.business.ordersPageHint");
    expect(copy).toContain("Bestellungen, die Kundschaft bei dir aufgegeben hat.");
  });

  it("keeps the customer's own list under the account, with its own words", () => {
    const account = code("src/app/(app)/account/page.tsx");
    expect(account).toContain("/account/orders");
    expect(copy).toContain('orders: {');
    // The two never share a sentence.
    expect(copy).not.toContain("Meine Bestellungen bei dir");
  });
});

describe("navigation hierarchy", () => {
  it("keeps Shop as the primary entry and Lager as the frequent shortcut", () => {
    /*
     * Stock is the one seller task touched many times a day — a price, a
     * quantity, a listing — so it keeps its own destination. Everything else
     * is reached through the Shop hub rather than accumulating in the bar.
     */
    const shop = nav.indexOf('href: "/business"');
    const lager = nav.indexOf('href: "/business/inventory"');
    expect(shop).toBeGreaterThan(-1);
    expect(lager).toBeGreaterThan(shop);
    // Nothing else from the shop leaked into the bar.
    for (const href of ["/business/legal", "/business/shipping", "/business/offers", "/business/profile"]) {
      expect(nav, href).not.toContain(href);
    }
  });

  it("offers the shop only to a seller and the platform only to an admin", () => {
    expect(nav).toContain("applies: (viewer) => viewer.business");
    expect(nav).toContain("applies: (viewer) => viewer.admin");
    expect(nav).toContain("applies: (viewer) => viewer.collector");
  });
});

describe("what this redesign did not touch", () => {
  it("left every route guard as it was", () => {
    expect(code("src/app/(business)/layout.tsx")).toContain("if (!sellerOperator) notFound();");
    expect(code("src/app/(admin)/layout.tsx")).toContain("if (!platformAdmin) notFound();");
  });

  it("left the order-review recovery where it belongs", () => {
    const detail = code(`${B}/orders/[orderNumber]/page.tsx`);
    expect(detail).toContain("<OrderReviewPanel");
    expect(code("src/app/(admin)/admin/page.tsx")).not.toContain("OrderReviewPanel");
  });

  it("needed no migration to rearrange the shop", () => {
    /*
     * The redesign moved pages and renamed a glyph; nothing about it touched
     * the database (ADR-0080). `0044` came later and for a different reason —
     * two KPIs that must be aggregated in the database rather than by
     * fetching a year of orders (ADR-0081) — so what is asserted here is that
     * no migration mentions the rearrangement.
     */
    const migrations = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql"));
    for (const file of migrations) {
      const body = readFileSync(`supabase/migrations/${file}`, "utf8");
      expect(body, file).not.toContain("business/profile");
      expect(body, file).not.toContain("AccountHubGlyph");
    }
  });
});
