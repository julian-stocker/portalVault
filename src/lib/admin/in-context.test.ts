import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";

/**
 * The administrator works in the catalog, not beside it (ADR-0042).
 *
 * These guard the architecture the decision rests on: one catalog, one card,
 * one set of mutations. A second component tree for administrators would
 * drift from the collector's within a release, and a second mutation would
 * be a second thing to secure.
 */
function source(path: string): string {
  return readFileSync(path, "utf8");
}

/** The file without its comments — for asking what the code does, not what it says. */
function code(path: string): string {
  return source(path)
    .split("\n")
    .filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith("*") && !trimmed.startsWith("//") && !trimmed.startsWith("/*");
    })
    .join("\n");
}

const VIEW = "src/components/catalog/catalog-view.tsx";
const CARD = "src/components/catalog/catalog-card.tsx";
const FIGURE = "src/components/catalog/figure-card.tsx";
const PAGE = "src/app/(public)/(catalog)/page.tsx";
const NAV = "src/components/layout/site-nav.tsx";
const ACTIONS = "src/components/admin/card-actions.tsx";
const INLINE = "src/components/admin/inline-name.tsx";

describe("one catalog, one card", () => {
  it("has no second catalog view and no second card component", () => {
    for (const forbidden of [
      "src/components/admin/admin-catalog-view.tsx",
      "src/components/admin/admin-catalog-card.tsx",
      "src/components/catalog/admin-catalog-card.tsx",
    ]) {
      expect(() => source(forbidden), forbidden).toThrow();
    }
  });

  it("branches inside CatalogCard rather than beside it", () => {
    const card = source(CARD);
    expect(card).toContain("if (admin) {");
    // Both branches render the same presentation component.
    expect((card.match(/<FigureCard/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("keeps presentation in FigureCard, which knows nothing about roles", () => {
    const figure = code(FIGURE);
    expect(figure).not.toContain("isAdmin");
    expect(figure).not.toMatch(/\badmin\b/);
    // It gained slots, not decisions.
    for (const slot of ["nameSlot", "statusBadge", "interactive", "muted"]) {
      expect(figure, slot).toContain(slot);
    }
  });

  it("renders both modes through one card factory", () => {
    const view = source(VIEW);
    expect(view).toContain("function card(original: CatalogFigure)");
    expect((view.match(/<CatalogCard/g) ?? []).length).toBe(1);
  });
});

describe("the role comes from the server", () => {
  it("is asked on the page, from the database predicate", () => {
    const page = source(PAGE);
    expect(page).toContain("const admin = await isAdmin();");
    expect(page).toContain('from "@/lib/auth/admin"');
  });

  it("is never derived in the browser", () => {
    // Read from the code, not from the comments that explain where the
    // decision really happens.
    for (const path of [VIEW, CARD, ACTIONS, INLINE]) {
      expect(code(path), path).not.toMatch(/@gmail|email|is_shop_admin|jwt|role\s*===/i);
    }
  });

  it("loads hidden figures only for an administrator", () => {
    expect(source(PAGE)).toContain("fetchCatalog({ includeHidden: admin })");
  });

  it("drops exactly one filter for that, keeping the rest", () => {
    const queries = source("src/lib/catalog/queries.ts");
    const fn = queries.slice(queries.indexOf("export async function fetchCatalog"), queries.indexOf("/** One figure by its slug"));
    // Software and inactive rows stay out in both modes: admin mode is the
    // collector catalog plus its hidden entries, not the whole table.
    expect(fn).toContain('.eq("is_active", true)');
    expect(fn).toContain("if (!options.includeHidden)");
    expect(fn).toContain("collectibleOnly(");
  });
});

describe("what an administrator's card offers", () => {
  const card = source(CARD);

  it("shows the same name a collector sees (V3.8)", () => {
    /*
     * The inline editor with a pencil is gone. It was a second way to change
     * one of five fields, in a place where the other four could not be seen,
     * and it made the admin card the only card in the catalogue whose name
     * looked different. Editing is one door now.
     */
    expect(card).not.toContain("<InlineName");
    expect(card).not.toContain("nameSlot=");
    expect(source(CARD)).not.toContain('from "@/components/admin/inline-name"');
    // The component itself stays: the detail page still uses it.
    expect(existsSync(INLINE)).toBe(true);
    expect(source("src/app/(admin)/admin/catalog/[skyId]/page.tsx")).toContain("FigureEditor");
  });

  it("does not let a tap on the card change anything", () => {
    // Not a tap on the card: on a phone that is one mis-tap away from taking
    // a figure out of the public catalog.
    expect(card).toContain("interactive={false}");
  });

  it("carries exactly one action, and it opens the editor (V3.8)", () => {
    /*
     * THE BUG THIS REPLACED. The trade row is 9.05 % of the card's height —
     * 29 px on a two-column phone — and it used to hold a 40 px button, a
     * link and an error line stacked on top of each other. The row clips, so
     * the button was cut and the link was invisible.
     *
     * One control, in the same box the public offer line uses.
     */
    const actions = code(ACTIONS);
    expect(actions).toContain("AdminEditAction");
    expect(actions.match(/<button/g) ?? []).toHaveLength(1);
    expect(actions).not.toContain("<Link");
    expect(actions).not.toContain("aria-pressed");
    // The public row's geometry, not a second one.
    expect(actions).toContain("h-full w-full");
    expect(actions).not.toContain("min-h-");
    expect(actions).not.toContain("flex-col");
  });

  it("marks a hidden figure rather than dropping it", () => {
    expect(card).toContain("muted={!visible}");
    expect(card).toContain("<HiddenBadge />");
  });

  it("opens the dialog rather than navigating away (V3.8)", () => {
    /*
     * The detail page still exists and is still reachable from
     * /admin/catalog. What changed is that fixing one field no longer costs a
     * page load and a trip back.
     */
    expect(card).toContain("<AdminEditAction");
    expect(card).toContain("onEdit={() => onEdit?.(figure)}");
    expect(source(ACTIONS)).not.toContain("/admin/catalog/");
    expect(source(VIEW)).toContain("<AdminFigureModal");
    expect(existsSync("src/app/(admin)/admin/catalog/[skyId]/page.tsx")).toBe(true);
  });

  it("offers no collection action", () => {
    const branch = card.slice(card.indexOf("if (admin) {"), card.indexOf("const trade ="));
    expect(branch).not.toContain("onToggle");
    expect(branch).not.toContain("setCollected");
    expect(branch).not.toContain("initialCollected");
  });
});

describe("the same mutations as /admin, not new ones", () => {
  it("reuses the existing server actions, and adds none (V3.8)", () => {
    /*
     * The dialog writes five fields. All five actions existed before it did;
     * it orchestrates them, it does not replace them — and the detail page
     * still calls the same ones.
     */
    const modal = source("src/components/admin/figure-modal.tsx");
    for (const action of [
      "setDisplayNameOverride", "setCardType", "setImageOverride",
      "setCatalogVisible", "setAdminNote",
    ]) {
      expect(modal, action).toContain(action);
    }
    expect(modal).toContain('from "@/lib/admin/actions"');
    expect(source(INLINE)).toContain('import { setDisplayNameOverride } from "@/lib/admin/actions"');
  });

  it("adds no database function of its own", () => {
    // The in-context catalog reuses the editorial mutations rather than
    // growing its own (ADR-0042). The list is pinned so a new one has to be
    // a deliberate addition, named here — as the last ones were: the shop
    // percentage (ADR-0045), the image override (ADR-0046), the four
    // commerce-mode functions (ADR-0060) and — since 0026 — one writer each
    // for the seller and the platform (ADR-0059, ADR-0064). None of them is
    // called by the catalog card.
    const actions = source("src/lib/admin/actions.ts");
    const rpcs = [...actions.matchAll(/"(admin_[a-z_]+)"/g)].map((m) => m[1]);
    expect(new Set(rpcs)).toEqual(
      new Set([
        "admin_set_catalog_visible",
        "admin_set_card_type",
        "admin_set_display_name_override",
        "admin_set_admin_note",
        "admin_set_catalog_group",
        "admin_set_shop_percentage",
        "admin_set_image_override",
        // ADR-0060 — the commerce mode, its testers, the account search and
        // the sandbox stock reversal. All on /admin, none in the catalog.
        "admin_set_commerce_mode",
        "admin_set_commerce_tester",
        "admin_find_accounts",
        "admin_revert_sandbox_stock",
        // ADR-0064 — two subjects, so one narrow writer each. Setting the
        // platform's address must not be able to reach the seller's.
        "admin_set_seller_contact",
        "admin_set_platform_contact",
      ]),
    );
  });

  it("still checks in the database, not in the component", () => {
    const sql = source("supabase/migrations/0004_catalog_editorial.sql");
    for (const fn of ["admin_set_catalog_visible", "admin_set_display_name_override"]) {
      const body = sql.slice(sql.indexOf(`function public.${fn}`), sql.indexOf("$$;", sql.indexOf(`function public.${fn}`)));
      expect(body, fn).toContain("if not public.is_shop_admin() then");
    }
  });
});

describe("the collector's catalog is untouched", () => {
  const view = source(VIEW);

  it("keeps the ownership filter for collectors and hides it from an admin", () => {
    // Three named states since V7; the condition that decides who is offered
    // it lives in one function rather than in a JSX ternary (ADR-0042).
    expect(view).toContain("offersOwnershipFilter({ signedIn, admin })");
    expect(view).toContain("<OwnershipFilter");
    // An administrator's pool skips the narrowing entirely rather than being
    // given a third value meaning "not applicable".
    expect(view).toMatch(/const owning = admin\s*\n?\s*\? figures/);
  });

  it("keeps collect and remove on a collector's card", () => {
    const card = source(CARD);
    const collector = card.slice(card.indexOf("const trade ="));
    expect(collector).toContain("onToggle");
    // The "Info" link is gone in V3.2 — the card body already leads to the
    // detail page. What a collector's card still offers beyond the toggle is
    // the trade row, and only when something is actually offered.
    expect(collector).toContain("OfferLink");
    // V3.3: the plate is always drawn; OfferLink decides what stands on it.
    expect(collector).toContain("notice");
  });

  it("leaves search and series navigation shared", () => {
    expect(view).toContain("groupSearchResults(pool");
    expect(view).toContain("<SeriesTabs");
  });
});

describe("navigation follows the role", () => {
  const nav = source(NAV);

  it("composes destinations by condition, never by replacing a slot", () => {
    // "Admin" does not take "Sammlung"'s place. Each destination states when
    // it applies, and the bar is what is left (ADR-0042) — which is what
    // makes adding "Lager" later a one-line change.
    expect(nav).toContain("const DESTINATIONS");
    expect(nav).toContain("applies: (viewer) => viewer.admin");
    expect(nav).toContain("applies: (viewer) => !viewer.admin");
    expect(nav).toContain("DESTINATIONS.filter((destination) => destination.applies(viewer))");
    // No branch that returns a whole hand-built list per role.
    expect(code(NAV)).not.toMatch(/if \(admin\) \{\s*return \[/);
  });

  it("gives the collection to collectors and administration to operators", () => {
    const collection = nav.slice(nav.indexOf('href: "/collection"'), nav.indexOf('href: "/admin"'));
    expect(collection).toContain("applies: (viewer) => !viewer.admin");
    const admin = nav.slice(nav.indexOf('href: "/admin"'), nav.indexOf('href: "/settings"'));
    expect(admin).toContain("applies: (viewer) => viewer.admin");
  });

  it("keeps the order the list defines", () => {
    // Katalog · Sammlung · Lager · Admin
    //
    // The account used to close this list as a fifth entry. V3.4.1 took it
    // out of the bar entirely: it is a platform action, not a collector area,
    // and it lives in the masthead beside the cart now.
    const order = ["/", "/collection", "/admin/inventory", "/admin"].map((href) =>
      nav.indexOf(`href: "${href}"`),
    );
    expect(order.every((at) => at > -1)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("no longer offers the account as a destination", () => {
    expect(nav).not.toContain('href: "/account"');
    expect(nav).not.toContain('section: "account"');
  });

  it("gives the operator stock as a destination of its own", () => {
    // Added as one more entry with its own condition — nothing moved, and
    // "Sammlung" was not renamed into it (ADR-0037).
    const inventory = nav.slice(
      nav.indexOf('href: "/admin/inventory"'),
      nav.indexOf('href: "/admin"', nav.indexOf('href: "/admin/inventory"') + 10),
    );
    expect(inventory).toContain("applies: (viewer) => viewer.admin");
    expect(inventory).toContain("de.nav.inventory");
  });

  it("marks the mode without rebuilding the site", () => {
    expect(nav).toContain("de.admin.modeBadge");
  });
});

describe("the inline name editor", () => {
  const inline = source(INLINE);

  it("opens with the name that is on screen, not an empty box", () => {
    expect(inline).toContain("useState(override ?? displayName)");
    expect(inline).not.toContain('useState(override ?? "")');
  });

  it("clears the override when the field is emptied", () => {
    expect(inline).toContain("const next = explicitReset || typed === derived ? \"\" : typed;");
  });

  it("clears it when the derived name is typed back, rather than storing it twice", () => {
    expect(inline).toContain("const derived = override === null ? displayName : derivedName;");
  });

  it("offers an explicit way back, but only while an override exists", () => {
    expect(inline).toContain("onMouseDown={() => save(true)}");
    expect(inline).toContain("de.admin.resetName");
    expect(inline).toMatch(/override !== null \? \(\s*<button/);
  });

  it("carries no long explanation on the card", () => {
    // 150 px wide on a phone; the sentence belongs on the detail page.
    expect(inline).not.toContain("de.admin.overrideHint");
  });

  it("still leaves the canonical name and the slug alone", () => {
    expect(code(INLINE)).not.toMatch(/slug|canonicalName\s*=/);
  });
});

/**
 * The product group is a second navigation level, shared by both roles
 * (ADR-0041). One component, one derivation, one pool.
 */
describe("the product group sub-navigation", () => {
  const view = source(VIEW);

  it("has one tab component, not one per role", () => {
    for (const forbidden of [
      "src/components/catalog/admin-group-tabs.tsx",
      "src/components/admin/group-tabs.tsx",
    ]) {
      expect(() => source(forbidden), forbidden).toThrow();
    }
    expect((view.match(/<ProductGroupTabs/g) ?? []).length).toBe(1);
  });

  it("narrows the same pool the ownership filter narrows", () => {
    // No second search pipeline: search and the cross-series search read the
    // pool and never learn that a group filter exists.
    expect(view).toContain("owning.filter((figure) => matchesGroup(figure, group))");
    expect(view).toContain("groupSearchResults(pool");
    expect(view).toContain("filterFigures(pool");
  });

  it("resets the group when the game changes", () => {
    const setter = view.slice(view.indexOf("function setSeriesCode(code: string)"));
    expect(setter.slice(0, 200)).toContain("setGroup(null)");
  });

  it("counts before search, ownership and the group itself", () => {
    // The numbers describe the game, so they do not move while typing.
    expect(view).toContain("groupTabs(figures.filter((figure) => figure.seriesCode === seriesCode)");
  });

  it("counts an administrator's catalog, which includes hidden figures", () => {
    // `figures` is whatever the page loaded, and for an administrator that
    // is the catalog including hidden entries (ADR-0042). Nobody else's
    // catalog contains them, so nobody else's counts can show them.
    expect(source(PAGE)).toContain("fetchCatalog({ includeHidden: admin })");
  });

  it("counts as an active filter, so the reset is offered", () => {
    expect(view).toContain(
      'query.trim() !== "" || (!admin && isOwnershipActive(ownership)) || group !== null',
    );
    const reset = view.slice(view.indexOf("function reset()"), view.indexOf("}", view.indexOf("function reset()")));
    expect(reset).toContain("setGroup(null)");
  });

  it("carries the group through a sign-in and back", () => {
    // Same treatment as series and query (ADR-0027): read once from the URL,
    // never written back — the catalog's state stays in the client.
    expect(view).toContain('params.set("group", group)');
    expect(source(PAGE)).toContain("isCatalogGroup(params.group) ? params.group : null");
  });

  it("says nothing about variants or completion", () => {
    const tabs = source("src/components/catalog/group-tabs.tsx");
    expect(tabs).not.toMatch(/special|variant|completion|legendary/i);
  });
});
