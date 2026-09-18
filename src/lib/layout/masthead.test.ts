import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";

import { GUEST_CART_KEY, cartCount, decodeCart, encodeCart, addLine } from "@/lib/cart/cart";
import { GUEST } from "@/lib/auth/principal";
import { addToCart, bindPrincipal, getSnapshot, resetCartStore } from "@/lib/cart/store";
import { de } from "@/lib/i18n/de";

/**
 * The masthead (V3.4), and the floating cart it replaced.
 *
 * WHAT WAS WRONG
 *
 * On a phone there were two ways to the cart: a 20 px glyph beside the
 * wordmark and a 52 px silver disc fixed over the bottom right of the page.
 * The disc was the one people saw — it sat on top of the figure images — and
 * it was the one that never changed when the header's cart was given the
 * commerce amber, because they are different components. Two entry points is
 * one too many; the floating one is gone.
 *
 * The header itself read as an overlay for the same reason: 80 % ground, a
 * backdrop blur, a 28 px shadow at 40 % black, and the sky drawn behind it.
 * It is opaque now, and the world starts underneath it.
 *
 * This file replaces `floating-cart.test.ts`, which described a component
 * that no longer exists. The cart-store assertions it carried are kept —
 * they were never about the button.
 */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith("*") && !trimmed.startsWith("//") && !trimmed.startsWith("/*");
    })
    .join("\n");
}

const NAV = "src/components/layout/site-nav.tsx";
const BADGE = "src/components/cart/cart-badge.tsx";
const PUBLIC_LAYOUT = "src/app/(public)/layout.tsx";
const APP_LAYOUT = "src/app/(app)/layout.tsx";

const nav = code(NAV);

describe("the floating cart is gone, not hidden", () => {
  it("has no file", () => {
    /*
     * Deleted rather than left unmounted. A component nobody renders is a
     * component somebody renders again — `collected-crown.tsx` came back
     * twice before a test said it must not exist.
     */
    expect(existsSync("src/components/cart/floating-cart.tsx")).toBe(false);
  });

  it("is imported and rendered nowhere", () => {
    for (const path of [NAV, PUBLIC_LAYOUT, APP_LAYOUT, "src/app/(admin)/layout.tsx"]) {
      expect(code(path), path).not.toContain("FloatingCart");
      expect(code(path), path).not.toContain("floating-cart");
    }
  });

  it("leaves no condition behind that used to gate it", () => {
    expect(nav).not.toContain("floatingCart");
  });
});

describe("there is exactly one cart entry point", () => {
  it("is the header's, mounted once", () => {
    expect(nav.match(/<CartBadge \/>/g)).toHaveLength(1);
  });

  it("is in the header rather than floating over the page", () => {
    const header = nav.slice(nav.indexOf("<header"), nav.indexOf("</header>"));
    expect(header).toContain("<CartBadge />");
  });

  it("is not offered to the administrator", () => {
    // SkyIsles does not buy from itself (ADR-0042). The account beside it
    // stays, because an operator has one.
    expect(nav).toContain("{admin ? null : <CartBadge />}");
  });

  it("is present on the cart page too", () => {
    // The floating button was suppressed on /cart, because a shortcut to the
    // page you are on has nothing to do. A header is not a shortcut.
    expect(nav).not.toContain('active !== "cart"');
  });

  it("carries no second cart control anywhere in the application", () => {
    for (const file of ["src/components/cart/cart-view.tsx", "src/components/catalog/catalog-view.tsx"]) {
      expect(code(file), file).not.toContain("FloatingCart");
    }
  });
});

describe("the header sits at the top edge instead of over the page", () => {
  /*
   * The header's OWN attributes, up to the `>` that closes its opening tag.
   *
   * Slicing to `</header>` would swallow the phone's bottom bar, which lives
   * inside it and legitimately carries `bg-deep/95 backdrop-blur-md` — the
   * assertions below would then read the bar's ground as the header's.
   */
  const header = (() => {
    const at = nav.indexOf("<header");
    expect(at, "no header").toBeGreaterThan(-1);
    return nav.slice(at, nav.indexOf("\n    >", at));
  })();

  it("is sticky at the top, not fixed and not static", () => {
    // Flush on load because it is in the flow; still there after scrolling,
    // which is what makes a single header-bound cart reachable.
    expect(header).toContain("sticky top-0");
    expect(header).not.toContain("fixed top-0");
  });

  it("has an opaque ground", () => {
    expect(header).toContain("bg-deep ");
    expect(header).not.toContain("bg-deep/");
  });

  it("carries no backdrop blur", () => {
    expect(header).not.toContain("backdrop-blur");
  });

  it("casts no drop shadow", () => {
    // A shadow is how an element says it is above what it covers.
    expect(header).not.toMatch(/shadow-\[/);
    expect(header).not.toMatch(/\bshadow-(raised|card|lg|xl|2xl)\b/);
  });

  it("keeps the hairline that closes it", () => {
    expect(header).toContain("border-b border-world-edge");
  });

  it("stays below the modal and the confirmation in the stack", () => {
    expect(header).toContain("z-30");
    const modal = code("src/components/ui/modal.tsx");
    expect(modal).toContain("z-50");
    expect(code("src/components/cart/cart-toast.tsx")).toContain("z-60");
  });
});

describe("the world begins under the masthead", () => {
  for (const [name, path] of [
    ["public", PUBLIC_LAYOUT],
    ["app", APP_LAYOUT],
  ] as const) {
    it(`${name}: WorldZone is rendered after the header, inside the content wrapper`, () => {
      const layout = code(path);
      const nav_ = layout.indexOf("<SiteNav");
      const world = layout.indexOf("<WorldZone");
      expect(nav_, "SiteNav is missing").toBeGreaterThan(-1);
      expect(world, "WorldZone is missing").toBeGreaterThan(-1);
      expect(world, "the world must come after the header").toBeGreaterThan(nav_);
    });

    it(`${name}: the wrapper it is positioned against is the content, not the page`, () => {
      // `WorldZone` is `absolute inset-x-0 top-0`; its `top-0` is only "below
      // the masthead" if the nearest positioned ancestor starts there.
      const layout = code(path);
      const wrapper = layout.indexOf('<div className="relative flex-1">');
      expect(wrapper, "the content wrapper must be relative").toBeGreaterThan(-1);
      expect(layout.indexOf("<WorldZone")).toBeGreaterThan(wrapper);
    });
  }

  it("the world itself still draws behind its own content", () => {
    expect(code("src/components/layout/world-zone.tsx")).toContain("absolute inset-x-0 top-0 -z-10");
  });
});

describe("the phone keeps its bottom bar", () => {
  it("the navigation is still fixed to the bottom below md:", () => {
    expect(nav).toContain("fixed inset-x-0 bottom-0 z-20");
    expect(nav).toContain("md:static");
  });

  it("NavSpacer still reserves the room it needs", () => {
    expect(nav).toContain("export function NavSpacer");
    expect(nav).toContain("h-[calc(2.75rem+env(safe-area-inset-bottom))] md:hidden");
    for (const path of [PUBLIC_LAYOUT, APP_LAYOUT]) {
      expect(code(path), path).toContain("<NavSpacer />");
    }
  });

  it("the header is a row at every width, so the cart can sit at its right end", () => {
    const at = nav.indexOf("<header");
    const header = nav.slice(at, nav.indexOf("\n    >", at));
    expect(header).toContain("flex items-center");
    expect(header).not.toContain("md:flex ");
  });
});

describe("the bar carries marks, the header carries actions (V3.4.1)", () => {
  const glyphs = code("src/components/layout/nav-glyphs.tsx");

  it("draws its own icons in the house style rather than installing a set", () => {
    // `cart-glyph.tsx` set the style; a second grid and a second stroke
    // weight would make the one icon this product already had the odd one.
    const cart = code("src/components/shop/cart-glyph.tsx");
    for (const source of [glyphs, cart]) {
      expect(source).toContain('viewBox: "0 0 24 24"');
      expect(source).toContain('stroke: "currentColor"');
      expect(source).toContain('strokeWidth: "1.8"');
    }
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const set of ["lucide-react", "react-icons", "@heroicons/react", "feather-icons"]) {
      expect(deps[set], `${set} must not be installed`).toBeUndefined();
    }
  });

  it("keeps every nav mark neutral — no ownership gold, no commerce amber", () => {
    /*
     * The collection's icon is the one at risk: it is the door to the page
     * that lists owned figures, not a figure somebody owns. A gold door would
     * say the whole section is a possession.
     */
    expect(glyphs).not.toMatch(/own-ink|--own|commerce|amber|gold/i);
    expect(glyphs.match(/currentColor/g)?.length).toBeGreaterThan(0);
    expect(glyphs).not.toMatch(/#[0-9a-f]{3,6}/i);
  });

  it("gives every destination a mark, so no viewer sees a half-drawn bar", () => {
    // An administrator sees the catalogue beside their own two destinations.
    for (const glyph of ["CatalogGlyph", "CollectionGlyph", "InventoryGlyph", "AdminGlyph"]) {
      expect(glyphs, `${glyph} is missing`).toContain(`export function ${glyph}`);
      expect(nav, `${glyph} is not used`).toContain(`icon: ${glyph},`);
    }
    // One icon per destination. `icon: [A-Z]` so the field's own type
    // declaration at the head of the list is not counted as a fifth.
    const list = nav.slice(nav.indexOf("const DESTINATIONS"), nav.indexOf("function itemsFor"));
    expect(list.match(/icon: [A-Z]\w+/g) ?? []).toHaveLength((list.match(/href: "/g) ?? []).length);
  });

  it("shows the mark on the phone only", () => {
    // From md: up the navigation is a row of words in the masthead; a mark
    // beside each would turn it into a toolbar.
    expect(nav).toContain('<item.icon className="h-[18px] w-[18px] md:hidden" />');
  });

  it("does not make the bar taller, because NavSpacer reserves its height", () => {
    /*
     * Beside the label, not above it. Above is the usual shape for a phone
     * bar and would need more than the 2.75rem two layouts reserve.
     */
    // `AttentionBadge` is declared BEFORE `NavItem`, so slicing to it ran
    // backwards and produced an empty string that contained everything.
    const item = nav.slice(nav.indexOf("function NavItem("));
    expect(item.length, "the NavItem slice is empty").toBeGreaterThan(200);
    expect(item).toContain("min-h-11");
    expect(item).toContain("items-center justify-center gap-1.5");
    expect(item).not.toContain("flex-col");
    expect(nav).toContain("h-[calc(2.75rem+env(safe-area-inset-bottom))] md:hidden");
  });

  it("keeps the active state the bar already had", () => {
    expect(nav).toContain('aria-current={active ? "page" : undefined}');
    expect(nav).toContain("font-medium text-on-deep");
  });
});

/**
 * The two account actions (V3.4.2).
 *
 * V3.4.1 put one icon in the header and forbade a second, because a word in
 * the bar plus an icon up here would have been two ways into one room. This
 * is a different arrangement and the rule still holds: the two lead to two
 * different pages, and the active state can light up on only one of them.
 *
 *   name + person  ->  /account/profile
 *   cog            ->  /account
 */
describe("the header carries a profile and an account action", () => {
  const profileFn = nav.slice(nav.indexOf("function ProfileAction("), nav.indexOf("function AccountHubAction("));
  const settingsFn = nav.slice(nav.indexOf("function AccountHubAction("), nav.indexOf("function NavItem("));
  const group = nav.slice(nav.indexOf('<div className="ml-auto flex min-w-0 items-center'));

  it("has a slice of each to inspect", () => {
    expect(profileFn.length).toBeGreaterThan(200);
    expect(settingsFn.length).toBeGreaterThan(200);
    expect(group.length).toBeGreaterThan(100);
  });

  it("sends the two to two different pages", () => {
    expect(profileFn).toContain('href={signedIn ? "/account/profile" : "/login"}');
    expect(settingsFn).toContain('href="/account"');
    // The rule V3.4.1 established, kept: nothing leads twice to one place.
    expect(profileFn).not.toContain('href="/account"');
  });

  it("offers no settings to somebody who is not signed in", () => {
    expect(group).toContain("{signedIn ? <AccountHubAction active={accountHubActive} /> : null}");
  });

  it("orders them name, person, account card, cart", () => {
    const profile = group.indexOf("<ProfileAction");
    const settings = group.indexOf("<AccountHubAction");
    const cart = group.indexOf("<CartBadge />");
    expect(profile).toBeGreaterThan(-1);
    expect(settings).toBeGreaterThan(profile);
    expect(cart).toBeGreaterThan(settings);
    // Inside the profile link: the name, then the glyph.
    const name = profileFn.indexOf("{name}");
    const glyph = profileFn.indexOf("<AccountGlyph");
    expect(name).toBeGreaterThan(-1);
    expect(glyph).toBeGreaterThan(name);
  });

  it("gives both an accessible name, since neither shows a label", () => {
    expect(profileFn).toContain("aria-label={label}");
    expect(profileFn).toContain(
      "const label = !signedIn ? de.nav.signIn : name ? de.nav.profileOf(name) : de.nav.profile;",
    );
    expect(settingsFn).toContain("aria-label={de.nav.account}");
    // Existing German, not invented words.
    expect(de.nav.profile).toBe("Profil");
    expect(de.nav.account).toBe("Mein Konto");
    expect(de.nav.signIn).toBe("Anmelden");
    // The label carries the visible name, because aria-label replaces content.
    expect(de.nav.profileOf("yulez")).toContain("yulez");
  });

  it("shows nothing at all when there is no username", () => {
    /*
     * `null` twice over: signed out, or signed in before onboarding. No dash,
     * no empty box — furniture standing in for a fact that does not exist.
     */
    expect(profileFn).toContain("const name = signedIn ? username : null;");
    expect(profileFn).toMatch(/\{name \? \(/);
    expect(profileFn).toContain(") : null}");
    expect(nav).toContain("username?: string | null;");
  });

  it("keeps both neutral — not the ownership gold, not the commerce amber", () => {
    for (const [what, fn] of [["profile", profileFn], ["settings", settingsFn]] as const) {
      expect(fn, what).toContain("text-on-deep-muted hover:text-on-deep");
      expect(fn, what).not.toContain("commerce");
      expect(fn, what).not.toMatch(/own-ink|brand|gold/);
    }
  });

  it("clears 44 px on both and keeps a visible focus", () => {
    // The profile's target is the glyph's own box, so the name cannot squeeze it.
    expect(profileFn).toContain('<span className="flex h-11 w-11 shrink-0 items-center justify-center">');
    expect(profileFn).toContain("focus-ring");
    expect(settingsFn).toContain("flex h-11 w-11 shrink-0 items-center justify-center");
    expect(settingsFn).toContain("focus-ring");
    // Marks stay 18 px; shrinking an icon is not how space is found.
    expect(profileFn).toContain('<AccountGlyph className="h-[18px] w-[18px]" />');
    expect(settingsFn).toContain('<AccountHubGlyph className="h-[18px] w-[18px]" />');
  });

  it("is offered to the administrator, unlike the cart", () => {
    // An operator has an account; they simply do not shop here.
    expect(group.slice(0, group.indexOf("<ProfileAction"))).not.toContain("admin ?");
    expect(group).toContain("{admin ? null : <CartBadge />}");
  });
});

/**
 * The name may only grow and shrink to the left.
 *
 * The three marks on the right are the fixed points of this header; a
 * twenty-character username must eat into empty space, never into them.
 */
describe("a long username moves nothing", () => {
  const profileFn = nav.slice(nav.indexOf("function ProfileAction("), nav.indexOf("function AccountHubAction("));

  it("keeps the min-w-0 chain unbroken", () => {
    /*
     * Every link in the chain, because a flex item's default `min-width:auto`
     * refuses to shrink below its content — one missing `min-w-0` anywhere
     * above the text and `truncate` never gets its turn.
     */
    expect(nav).toContain('<div className="ml-auto flex min-w-0 items-center');   // the group
    expect(profileFn).toContain("focus-ring flex min-w-0 items-center gap-1.5");  // the link
    expect(profileFn).toContain('<span className="min-w-0 truncate text-right');  // the text
  });

  it("anchors the group to the right", () => {
    // `ml-auto` is what makes the name grow leftwards instead of pushing.
    expect(nav).toContain('className="ml-auto flex min-w-0 items-center');
  });

  it("truncates rather than wraps", () => {
    // `truncate` is overflow-hidden + text-ellipsis + whitespace-nowrap.
    expect(profileFn).toContain("truncate");
    expect(profileFn).toContain("text-right");
    expect(profileFn).not.toContain("break-words");
    expect(profileFn).not.toContain("flex-wrap");
  });

  it("holds every icon box rigid", () => {
    const boxes = nav.match(/h-11 w-11 shrink-0/g) ?? [];
    expect(boxes.length, "profile and settings both need a rigid box").toBeGreaterThanOrEqual(2);
    expect(code(BADGE)).toContain("min-h-11 min-w-11");
  });

  it("introduces no new breakpoint to hide the name behind", () => {
    // The name uses whatever width is left, on every device.
    expect(nav).not.toMatch(/min-\[\d+px\]:/);
    expect(profileFn).not.toContain("hidden ");
  });

  it("cannot make the header a second row", () => {
    const at = nav.indexOf("<header");
    const header = nav.slice(at, nav.indexOf("\n    >", at));
    expect(header).toContain("flex items-center");
    expect(header).not.toContain("flex-wrap");
    // The brand never shrinks, so the name is the only elastic thing here.
    expect(nav).toContain('<div className="relative flex shrink-0 items-center gap-2">');
  });
});

/**
 * Exactly one of the two is ever the current page.
 */
describe("the active state splits between profile and account", () => {
  it("reads one level finer than activeSection(), and only here", () => {
    expect(nav).toContain('const profileActive = (pathname ?? "/") === "/account/profile";');
    expect(nav).toContain("const accountHubActive = inAccount && !profileActive;");
    expect(nav).toContain('const inAccount = active === "account";');
  });

  it("leaves the section model alone", () => {
    // Widening `activeSection()` would change what /settings and /onboarding
    // mean everywhere else for the sake of one header.
    const sections = readFileSync("src/lib/nav/sections.ts", "utf8");
    expect(sections).toContain('if (path === "/account" || path.startsWith("/account/")) return "account";');
    expect(sections).not.toContain('"account-profile"');
  });

  it("never marks both, on any account route", () => {
    // The rule expressed as arithmetic over the real paths.
    const inAccount = (p: string) => p === "/account" || p.startsWith("/account/") || p === "/settings" || p === "/onboarding";
    for (const path of [
      "/account", "/account/profile", "/account/security", "/account/contact",
      "/account/orders", "/account/orders/SI-2026-001042", "/settings", "/onboarding", "/",
    ]) {
      const profile = path === "/account/profile";
      const settings = inAccount(path) && !profile;
      expect([profile, settings].filter(Boolean).length, path).toBeLessThanOrEqual(1);
      // And inside the account area exactly one of them is always current,
      // so the header never goes blank where it should be marked.
      if (inAccount(path)) {
        expect([profile, settings].filter(Boolean).length, path).toBe(1);
      }
    }
  });
});

/**
 * Where the username comes from, and what it costs.
 */
describe("the username reaches the header on the server", () => {
  const layouts = {
    public: code("src/app/(public)/layout.tsx"),
    app: code("src/app/(app)/layout.tsx"),
    admin: code("src/app/(admin)/layout.tsx"),
  };

  it("is a server prop, never a browser fetch", () => {
    for (const [name, layout] of Object.entries(layouts)) {
      expect(layout, name).toContain("username=");
    }
    const profileAction = nav.slice(nav.indexOf("function ProfileAction("));
    expect(profileAction).not.toContain("useEffect");
    expect(profileAction).not.toContain("fetch(");
    expect(nav).not.toContain('"use swr"');
  });

  it("costs the app layout nothing — it already had the profile", () => {
    expect(layouts.app.match(/currentProfile\(\)/g)).toHaveLength(1);
    expect(layouts.app).toContain("username={profile.username}");
  });

  it("joins the work the public layout was already doing", () => {
    expect(layouts.public).toContain("const [user, caps, profile] = await Promise.all([");
    expect(layouts.public).toContain("currentProfile(),");
    expect(layouts.public.match(/currentProfile\(\)/g)).toHaveLength(1);
  });

  it("does not mix the admin gate with header decoration", () => {
    // The gate is the platform capability alone since 0041 (ADR-0077).
    const gate = layouts.admin.indexOf("if (!platformAdmin) notFound();");
    const fetchAfter = layouts.admin.indexOf("currentProfile()");
    expect(gate).toBeGreaterThan(-1);
    expect(fetchAfter, "the profile must be read after the gate").toBeGreaterThan(gate);
    expect(layouts.admin.slice(gate, gate + 60)).not.toContain("currentProfile");
  });

  it("uses the shared memoised helper rather than a query of its own", () => {
    for (const [name, layout] of Object.entries(layouts)) {
      expect(layout, name).not.toContain('from("profiles")');
    }
    expect(readFileSync("src/lib/auth/profile.ts", "utf8")).toContain("export const currentProfile = cache(");
  });

  it("reads nothing from delivery data", () => {
    // `customer_contacts` and `order_addresses` hold real names. They are
    // commerce records, not identity, and the header must not touch them.
    for (const [name, layout] of Object.entries(layouts)) {
      expect(layout, name).not.toContain("customer_contacts");
      expect(layout, name).not.toContain("order_addresses");
    }
    expect(nav).not.toContain("first_name");
  });
});

describe("the header cart wears the commerce role, its count does not", () => {
  const badge = code(BADGE);

  it("the glyph is amber", () => {
    expect(badge).toContain("style={COMMERCE_INK}");
    expect(badge).toContain("hover:text-commerce-hover");
  });

  it("the count stays silver — a quantity is status, not a purchase", () => {
    const bubble = badge.slice(badge.indexOf("<span"));
    expect(bubble).toContain("bg-trade-solid");
    expect(bubble).toContain("text-on-trade");
    expect(bubble).not.toContain("commerce");
  });

  it("names itself and its count for a screen reader", () => {
    expect(badge).toContain("aria-label={count > 0");
    expect(de.cart.open).toBeTruthy();
    expect(de.cart.pieces(3)).toContain("3");
  });

  it("clears the 44 px target", () => {
    expect(badge).toContain("min-h-11 min-w-11");
  });
});

/**
 * The cart store, which never belonged to the floating button.
 *
 * Carried over from `floating-cart.test.ts` so removing a component does not
 * quietly remove the proof that the header reads the same basket the rest of
 * the application writes.
 */
function fakeStorage() {
  const entries = new Map<string, string>();
  return {
    entries,
    getItem: (k: string) => entries.get(k) ?? null,
    setItem: (k: string, v: string) => void entries.set(k, v),
  };
}
let storage: ReturnType<typeof fakeStorage>;

beforeEach(() => {
  storage = fakeStorage();
  vi.stubGlobal("window", {
    localStorage: storage,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  resetCartStore();
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetCartStore();
});

const BASH = {
  skyId: "SKY-0007",
  condition: "loose" as const,
  name: "Bash",
  imageSrc: null,
  price: 4.49,
};

describe("the cart architecture is untouched", () => {
  it("the header counts pieces, so it follows every change", () => {
    bindPrincipal(GUEST);
    addToCart(BASH);
    addToCart(BASH);
    expect(cartCount(getSnapshot().cart)).toBe(2);
  });

  it("reads the one guest store, not a second one", () => {
    bindPrincipal(GUEST);
    addToCart(BASH);
    expect(storage.entries.has(GUEST_CART_KEY)).toBe(true);
    expect([...storage.entries.keys()]).toHaveLength(1);
  });

  it("reads a guest cart written before the masthead existed", () => {
    storage.entries.set(GUEST_CART_KEY, encodeCart(addLine([], BASH)));
    bindPrincipal(GUEST);
    expect(cartCount(getSnapshot().cart)).toBe(1);
    expect(decodeCart(storage.entries.get(GUEST_CART_KEY)!)).toHaveLength(1);
  });
});
