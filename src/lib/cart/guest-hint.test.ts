import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { de } from "@/lib/i18n/de";

/**
 * Where the basket is kept, said only to the people it is true of.
 *
 * Until ADR-0061 there was one basket and it lived in `localStorage`, so
 * "Der Warenkorb wird nur in diesem Browser gespeichert." was true for
 * everybody and was rendered unconditionally in two places. A signed-in
 * basket now lives in `cart_items` and follows the account across devices —
 * which turned that sentence into the opposite of what had just been built,
 * told to exactly the people who had solved the problem.
 *
 * The condition has to be decided on the SERVER. `currentPrincipal()` is a
 * module variable bound in an effect: during render it still reads "guest"
 * and never re-renders when it changes, so a client-side check would show a
 * signed-in visitor the guest notice permanently.
 */
const CART_VIEW = "src/components/cart/cart-view.tsx";
const OFFER_PANEL = "src/components/shop/offer-panel.tsx";
const CART_PAGE = "src/app/(public)/cart/page.tsx";
const FIGURE_PAGE = "src/app/(public)/skylanders/[slug]/page.tsx";

const source = (path: string) => readFileSync(path, "utf8");

/** Source with comments removed, so an assertion tests code and not prose. */
const code = (path: string) =>
  source(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/^\s*\/\/.*$/gm, "");

describe("the sentence itself", () => {
  it("is about this browser, and offers the way out", () => {
    expect(de.cart.guestOnly).toContain("Browser");
    expect(de.cart.guestOnlyHint).toMatch(/[Mm]elde dich an/);
  });

  it("no longer claims anything about a signed-in basket", () => {
    // The old key is gone rather than left unused: an unused string is one
    // somebody renders again by accident.
    expect(de.cart).not.toHaveProperty("localOnly");
  });
});

describe("both places ask before they say it", () => {
  it.each([CART_VIEW, OFFER_PANEL])("%s renders the notice only for a guest", (file) => {
    const code = source(file);
    expect(code).toContain("guest ? (");
    expect(code).toContain("de.cart.guestOnly");
    // Never unconditionally: that was the defect.
    expect(code).not.toMatch(/^\s*<p[^>]*>\{de\.cart\.guest/m);
  });

  it.each([CART_VIEW, OFFER_PANEL])("%s takes the answer as a prop", (file) => {
    expect(source(file)).toMatch(/guest:\s*boolean/);
  });

  it.each([CART_VIEW, OFFER_PANEL])("%s does not read the principal itself", (file) => {
    /*
     * The reason this is a prop at all. Reading it during render would pin
     * the notice to "guest" for everybody, forever. Against `code` and not
     * `source`: the comment in the component explains precisely why not, and
     * names the function while doing so.
     */
    expect(code(file)).not.toContain("currentPrincipal");
  });
});

describe("the server decides, so the first paint is already right", () => {
  it("the cart page reads the session", () => {
    const page = source(CART_PAGE);
    expect(page).toContain("currentUser()");
    expect(page).toContain("guest={user === null}");
  });

  it("the figure page reuses the session it already had", () => {
    // It fetches `supabase.auth.getUser()` for the collect button anyway; a
    // second round trip for the same answer would be waste.
    const page = source(FIGURE_PAGE);
    expect(page).toContain("guest={auth.user === null}");
    expect((page.match(/auth\.getUser\(\)/g) ?? []).length).toBe(1);
  });
});

describe("the stale claims in the comments are gone", () => {
  it("the offer panel no longer says the cart only writes localStorage", () => {
    const code = source(OFFER_PANEL);
    expect(code).not.toContain("there are no orders in V1");
    expect(code).not.toMatch(/Adding to the cart writes `localStorage`/);
    // And says what is true instead, so the next reader is not left guessing.
    expect(code).toContain("cart_items");
    expect(code).toContain("ADR-0061");
  });

  it("but keeps the claim that is still true", () => {
    // Nothing here reserves stock. That was true before ADR-0061 and is
    // true after it, and losing it in a comment rewrite would be a real loss.
    expect(source(OFFER_PANEL)).toContain("ADR-0050");
  });
});
