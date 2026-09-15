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
    // SkyIsles does not buy from itself (ADR-0042).
    expect(nav).toMatch(/\{admin \? null : \(\s*<div className="ml-auto/);
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
