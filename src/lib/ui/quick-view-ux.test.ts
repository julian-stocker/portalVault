import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { de } from "@/lib/i18n/de";

/**
 * The quick view as a dialog, as a piece of the catalog, and as a promise
 * about requests (IR-001).
 *
 * This product has no DOM in its tests — `vitest.config.mts` collects
 * `*.test.ts` and nothing renders — so what a click does is checked in the
 * browser and what the source guarantees is checked here. The split is the
 * same one `lib/cart/add.ts` uses: the decidable part is a pure function with
 * its own tests, and these hold the structure around it.
 */
function source(path: string): string {
  return readFileSync(path, "utf8");
}

/**
 * The source with comments stripped.
 *
 * Every file below explains itself at length, and those explanations name the
 * very words these assertions search for — `prefetch`, `router.push`,
 * `localStorage`. Matching raw text would let a comment satisfy a test.
 */
function code(path: string): string {
  return source(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const MODAL = "src/components/ui/modal.tsx";
const QUICK_VIEW = "src/components/catalog/quick-view.tsx";
const OFFER_LINK = "src/components/shop/offer-link.tsx";
const CATALOG_VIEW = "src/components/catalog/catalog-view.tsx";
const SHOP_VIEW = "src/components/shop/shop-view.tsx";
const CARD = "src/components/catalog/catalog-card.tsx";
const FIGURE_CARD = "src/components/catalog/figure-card.tsx";
const TOAST = "src/components/cart/cart-toast.tsx";

describe("opening the quick view is not a navigation", () => {
  it("the offer link intercepts an ordinary left click", () => {
    const src = code(OFFER_LINK);
    expect(src).toContain("onOpen");
    expect(src).toContain("event.preventDefault()");
  });

  it("but leaves a modified click alone, so a new tab still works", () => {
    const src = code(OFFER_LINK);
    for (const modifier of ["metaKey", "ctrlKey", "shiftKey"]) {
      expect(src, `${modifier} must still navigate`).toContain(`event.${modifier}`);
    }
    expect(src).toContain("event.button !== 0");
  });

  it("stays a real link, so its target is still a page", () => {
    // Not a <button>: without JavaScript, and for "open in new tab", the
    // href is the only thing that leads anywhere.
    expect(code(OFFER_LINK)).toContain("<Link");
    expect(code(OFFER_LINK)).toContain("/skylanders/");
  });

  it("does not push a route or write the URL when it opens", () => {
    for (const file of [OFFER_LINK, QUICK_VIEW, CATALOG_VIEW, SHOP_VIEW]) {
      const src = code(file);
      expect(src, `${file} must not navigate`).not.toContain("router.push");
      expect(src, `${file} must not navigate`).not.toContain("useRouter");
      expect(src, `${file} must not write the URL`).not.toContain("history.pushState");
      expect(src, `${file} must not use query state`).not.toContain("useSearchParams");
    }
  });
});

describe("the performance fix of a0353cb is not undone", () => {
  it("figure links are still not prefetched", () => {
    // The commit this protects removed the per-figure prefetch because every
    // one of those requests ran the proxy's session check.
    for (const file of [OFFER_LINK, FIGURE_CARD, QUICK_VIEW]) {
      const src = code(file);
      if (!src.includes("/skylanders/")) continue;
      expect(src, `${file} links to a figure page`).toMatch(/prefetch=\{[^}]*false/);
    }
  });

  it("opens from data the grid already has, and fetches nothing", () => {
    for (const file of [QUICK_VIEW, "src/lib/ui/quick-view.ts"]) {
      const src = code(file);
      for (const forbidden of ["fetch(", "useEffect", "createClient", "supabase", "await "]) {
        expect(src, `${file} must not load anything`).not.toContain(forbidden);
      }
    }
  });

  it("renders one dialog for the whole grid, not one per card", () => {
    // A dialog per card would be N subscriptions and N subtrees for a thing
    // that is open at most once.
    for (const file of [CATALOG_VIEW, SHOP_VIEW]) {
      expect(code(file).match(/<QuickView/g), `${file}`).toHaveLength(1);
    }
    /*
     * The JSX, not the word. The card legitimately CALLS
     * `hasQuickViewOffer` to decide whether to offer the dialog; what it must
     * not do is render one — that would put a dialog inside an `@container`
     * that cannot position it, once per card.
     */
    expect(code(CARD)).not.toContain("<QuickView");
    expect(code(FIGURE_CARD)).not.toContain("<QuickView");
  });

  it("holds the open figure as an id, so the card stays free of the dialog", () => {
    for (const file of [CATALOG_VIEW, SHOP_VIEW]) {
      expect(code(file)).toContain("quickViewSkyId");
    }
    /*
     * The card reports the intent and keeps none of the dialog. Its own
     * `useState` for collected/failed is its business and stays — what must
     * not appear here is dialog state, which would put one dialog per card
     * inside a container that cannot position it.
     */
    expect(code(CARD)).toContain("onOpenOffers");
    expect(code(CARD)).not.toContain("quickView");
    expect(code(CARD)).not.toContain("Modal");
  });
});

describe("the dialog is a dialog", () => {
  const modal = code(MODAL);

  it("is announced as a modal dialog with a name", () => {
    expect(modal).toContain('role="dialog"');
    expect(modal).toContain('aria-modal="true"');
    expect(modal).toContain("aria-labelledby={labelledBy}");
    // The name comes from the heading that is actually on screen.
    expect(code(QUICK_VIEW)).toContain("id={headingId}");
  });

  it("escapes, and stops listening afterwards", () => {
    expect(modal).toContain('event.key === "Escape"');
    expect(modal).toContain('document.addEventListener("keydown"');
    expect(modal).toContain('document.removeEventListener("keydown"');
  });

  it("closes on the backdrop but never on a click inside", () => {
    // `target === currentTarget` is what separates the two, and mousedown
    // rather than click keeps a selection that ends outside from closing it.
    expect(modal).toContain("onMouseDown");
    expect(modal).toContain("event.target === event.currentTarget");
  });

  it("keeps Tab inside the panel", () => {
    expect(modal).toContain('event.key !== "Tab"');
    expect(modal).toContain("event.shiftKey");
  });

  it("focuses the panel on open rather than the buy button", () => {
    expect(modal).toContain("panel.current?.focus()");
    expect(modal).toContain("tabIndex={-1}");
  });

  it("gives focus back, and checks the opener is still there first", () => {
    expect(modal).toContain("document.contains(opener)");
  });

  it("locks the page behind it and restores what was there", () => {
    expect(modal).toContain('body.style.overflow = "hidden"');
    /*
     * The restore has to assign the remembered values back, not merely
     * declare them. An earlier version of this test looked for the
     * identifiers alone and stayed green when the cleanup was changed to
     * `= ""` — which would clear an overflow the page had set for its own
     * reasons instead of putting back what was there.
     */
    expect(modal).toContain("body.style.overflow = previousOverflow;");
    expect(modal).toContain("body.style.paddingRight = previousPadding;");
    // Hiding the scrollbar widens the page; compensating keeps it still.
    expect(modal).toContain("clientWidth");
  });

  it("escapes every containing block by portalling to the body", () => {
    // `FigureCard` is an `@container`, which is a containing block for fixed
    // descendants: a dialog rendered inside it would size itself to a card.
    expect(modal).toContain("createPortal");
    expect(modal).toContain("document.body");
    expect(code(FIGURE_CARD)).toContain("@container");
  });

  it("has a 44 px close target", () => {
    const quick = code(QUICK_VIEW);
    expect(quick).toMatch(/h-11 w-11/);
    expect(quick).toContain("de.quickView.close");
  });
});

describe("the dialog behaves on a phone", () => {
  const modal = code(MODAL);
  const quick = code(QUICK_VIEW);

  it("measures its height in dvh, not vh", () => {
    // On iOS Safari `vh` is the tallest the viewport ever gets, so a 90vh
    // panel runs under the address bar.
    expect(modal).toContain("dvh");
    expect(modal).not.toMatch(/max-h-\[min\(\d+vh/);
  });

  it("respects the safe area", () => {
    expect(modal).toContain("env(safe-area-inset-bottom)");
  });

  it("scrolls inside itself and does not chain to the page", () => {
    expect(quick).toContain("overflow-y-auto");
    expect(quick).toContain("overscroll-contain");
    expect(quick).toContain("min-h-0");
  });

  it("cannot overflow sideways", () => {
    expect(quick).toContain("min-w-0");
    expect(quick).toContain("break-words");
    // The panel fills the width it is given and is only capped above it, so
    // it can never be wider than the screen.
    expect(modal).toContain("flex w-full ${WIDTH[size]}");
    expect(modal).toMatch(/md: "max-w-\w+"/);
  });

  it("keeps a tall figure and a wide vehicle in the same footprint", () => {
    expect(quick).toContain("aspect-square");
  });
});

describe("the dialog reads as a product, not as a form", () => {
  const quick = code(QUICK_VIEW);

  it("puts the picture beside the facts", () => {
    // A thumbnail beside a column of labels was what made the first draft
    // read like an admin screen.
    expect(quick).toMatch(/sm:grid-cols-\[minmax\(\d+px,\s?\d+px\)_minmax\(0,1fr\)\]/);
  });

  it("carries no rules at all, and no footer bar", () => {
    /*
     * The bordered action bar across the foot gave the quietest thing in the
     * dialog the heaviest shape and left a band of empty floor under it. The
     * way on is a sentence inside the column now, so there is nothing left
     * to separate.
     */
    expect(quick).not.toContain("border-t border-world-edge");
    expect(quick).not.toContain("border-b border-world-edge");
  });

  it("offers the detail page as a quiet line, not as a button", () => {
    expect(quick).toContain("de.quickView.toDetail");
    expect(quick).not.toContain("ACTION_NEUTRAL");
    expect(quick).not.toContain("ACTION_PRIMARY");
    // Still a real link: middle-click and "open in new tab" keep working,
    // and the per-figure prefetch stays withdrawn (a0353cb).
    expect(quick).toContain("prefetch={false}");
  });

  it("lets the catalog stay readable behind the dialog", () => {
    // 12 px of blur turned the grid into fog and made the dialog read as a
    // new page. Focus comes from the darkening and the panel's contrast.
    const modal = code(MODAL);
    const blur = modal.match(/backdrop-blur-\[(\d+)px\]/);
    expect(blur, "the blur must be an explicit small value").not.toBeNull();
    expect(Number(blur![1])).toBeLessThanOrEqual(4);
    expect(modal).not.toContain("backdrop-blur-md");
  });

  it("frames the price zone and nothing else", () => {
    // One bordered block in the whole dialog. Hierarchy is carried by size
    // and colour, not by boxes inside boxes.
    expect(quick.match(/rounded-sky-md/g)).toHaveLength(2); // the plate and the price zone
    expect(quick).not.toContain("rounded-sky-lg");
  });

  it("wears the small facts as chips rather than announcing them with labels", () => {
    expect(quick).toContain("<Chip>");
    expect(quick).not.toContain("<dl");
    expect(quick).not.toContain("<dt");
  });

  it("says nothing in a footnote about what the detail page has", () => {
    expect(quick).not.toContain("detailHint");
    expect(code("src/lib/i18n/de.ts")).not.toContain("detailHint");
  });

  it("invents no gallery for the single picture that exists", () => {
    for (const forbidden of ["thumbnail", "Thumbnail", "carousel", "gallery", "nextImage"]) {
      expect(quick).not.toContain(forbidden);
    }
    expect(quick.match(/<img/g)).toHaveLength(1);
  });

  it("keeps the offers silver and the gold on the frame (V3.1)", () => {
    // Gold means ownership. Nothing in this dialog is about owning anything,
    // so no commerce surface may borrow it.
    expect(quick).toContain("ring-trade-line");
    expect(quick).toContain("text-trade-solid/80");
    expect(quick).not.toContain("text-own-ink");
    expect(quick).not.toContain("ACTION_OWN");
    expect(code(MODAL)).toContain("ring-gold-line");
  });

  it("separates the market value from the offers", () => {
    // They were one bordered block, which read as a single price. What a
    // figure is worth and what somebody asks for one are different facts
    // (ADR-0033).
    const market = quick.indexOf("de.catalog.marketValue");
    const offers = quick.indexOf("de.quickView.offersCount");
    expect(market).toBeGreaterThan(-1);
    expect(offers).toBeGreaterThan(market);
    // The market value is a line, not a panel of its own.
    expect(quick.slice(market - 400, market)).not.toContain("ring-trade-line");
  });

  it("stays a popover over the catalog rather than a page", () => {
    // Reported from Safari: at 896 px wide and 90dvh tall with 16 px of
    // margin, the dialog read as a new page rather than as something laid
    // over the grid. The catalog has to stay visible around all four edges.
    const modal = code(MODAL);
    const width = modal.match(/lg: "max-w-\[(\d+)px\]"/);
    expect(width, "the wide size must be an explicit pixel cap").not.toBeNull();
    expect(Number(width![1])).toBeLessThanOrEqual(740);
    expect(modal).not.toContain("max-w-4xl");
    expect(code(QUICK_VIEW)).toContain('size="lg"');
  });
});

describe("the picture is sized by the layout, never by the window", () => {
  const quick = code(QUICK_VIEW);

  /** Everything between `className={` … `}` that mentions the image plate. */
  const plate =
    quick.slice(quick.indexOf("bg-template-window") - 700, quick.indexOf("bg-template-window") + 200);

  it("caps the picture in pixels at both ends", () => {
    // Reported from Safari: with a percentage width the plate grew with the
    // dialog until it filled it and pushed the name below the fold.
    // Smaller on a phone than on a desktop: the plate used to take 220 px of
    // a 390 px screen and pushed the offer below the fold (V3.2).
    expect(plate).toContain("max-w-[150px]");
    expect(plate).toMatch(/sm:max-w-\[\d+px\]/);
    // Sized for a 760 px dialog, not for a 896 px one: driving the plate back
    // to 320 px would fill the narrower popover all over again.
    expect(plate).toContain("md:max-w-[230px]");
  });

  it("uses no viewport- or container-relative width for the picture", () => {
    for (const relative of ["vw", "vh", "w-[min(", "%)]", "38%"]) {
      expect(plate, `${relative} makes the size depend on the window`).not.toContain(relative);
    }
    // `w-full` is fine — it fills what the column allows, and the column is
    // what carries the bound.
    expect(plate).toContain("w-full");
  });

  it("bounds the first grid column in pixels, not as a share of the dialog", () => {
    expect(quick).toContain("sm:grid-cols-[minmax(170px,210px)_minmax(0,1fr)]");
    expect(quick).toContain("md:grid-cols-[minmax(190px,230px)_minmax(0,1fr)]");
    expect(quick).not.toContain("38%");
  });

  it("goes two-column early enough for a laptop window that is not maximised", () => {
    // The dialog is capped at 896 px, so 640 px of viewport is already enough
    // for a picture beside its facts. Waiting for `md:` (768 px) rendered the
    // phone layout on a desktop.
    expect(quick).toMatch(/sm:grid-cols-\[/);
    const gridLine = quick.slice(quick.indexOf("grid gap-5 p-5"), quick.indexOf("grid gap-5 p-5") + 260);
    expect(gridLine).not.toMatch(/lg:grid-cols-\[/);
  });

  it("is bounded by its own column as well as by its own max-width", () => {
    // Two independent ceilings, so neither the grid nor the plate alone can
    // let the picture grow.
    const column = quick.match(/md:grid-cols-\[minmax\(\d+px,(\d+)px\)/);
    const plateCap = quick.match(/md:max-w-\[(\d+)px\]/);
    expect(column).not.toBeNull();
    expect(plateCap).not.toBeNull();
    expect(Number(plateCap![1])).toBeLessThanOrEqual(Number(column![1]));
  });
});

describe("the dialog is as tall as its content, and no taller", () => {
  const modal = code(MODAL);
  const quick = code(QUICK_VIEW);

  it("caps the height well below the viewport", () => {
    const desktop = modal.match(/sm:max-h-\[(\d+)dvh\]/);
    expect(desktop, "the desktop ceiling must be a dvh value").not.toBeNull();
    expect(Number(desktop![1])).toBeLessThanOrEqual(75);
    expect(modal).not.toContain("90dvh");
  });

  it("states a ceiling, never a height", () => {
    // `h-*` would make the panel that tall whatever is in it.
    for (const stretcher of ["h-screen", "h-dvh", "h-full", "min-h-screen", "min-h-["]) {
      expect(modal, `${stretcher} would fix the panel's height`).not.toContain(stretcher);
    }
  });

  it("does not let the scrolling region reach for the ceiling", () => {
    /*
     * `flex-1` is `flex: 1 1 0%`: it tells the body to claim whatever the
     * panel has, which in a panel with a max-height means growing to that
     * maximum even for three lines of content. The default `flex-shrink: 1`
     * is the half that was wanted — give way once the ceiling is reached,
     * and otherwise be the size of the content.
     */
    expect(quick).toContain("min-h-0 overflow-y-auto overscroll-contain");
    expect(quick).not.toContain("flex-1");
  });

  it("keeps a visible margin on every side", () => {
    expect(modal).toContain("p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:p-8");
  });
});

describe("the offers are a list, and it is honest about what it knows", () => {
  const quick = code(QUICK_VIEW);
  const model = code("src/lib/ui/quick-view.ts");

  it("renders one entry per offer rather than a fixed pair of rows", () => {
    expect(quick).toContain("model.offers.map");
    expect(quick).toContain("<ul");
    expect(quick).toContain("<li");
    // Each entry carries its own action; there is no single buy button in
    // the foot that would be ambiguous once there are two rows.
    const foot = quick.slice(quick.lastIndexOf("border-t border-world-edge"));
    expect(foot).not.toContain("OfferAddButton");
  });

  it("trades loose copies only, decided in the model and not in the markup", () => {
    // The rule is the product's, not this dialog's: it lives in
    // `lib/shop/offer.ts` and the quick view reads it like everyone else.
    expect(model).toContain("v1BuyableOffers");
    expect(code("src/lib/shop/offer.ts")).toContain('V1_CONDITION: OfferCondition = "loose"');
    expect(code("src/lib/shop/offer.ts")).toContain("offer.condition === V1_CONDITION");
    // The renderer must not carry a condition test of its own.
    expect(quick).not.toContain('"boxed"');
    expect(quick).not.toContain("condition ===");
  });

  it("does not offer the dialog when there is nothing loose to sell", () => {
    // The card stays a link to the figure page, which has the boxed offer.
    expect(code(CARD)).toContain("hasQuickViewOffer(offers)");
    expect(code(CARD)).toContain("quickBuy ? onOpenOffers : undefined");
  });

  it("names the seller from data, never from a constant", () => {
    // The trade name arrives as a prop from `seller_public()` (migration
    // 0027). Written into the markup it would be a second source of truth
    // for a legal name (ADR-0059) — and wrong the moment it is renamed.
    expect(quick).toContain("seller.displayName");
    for (const hardcoded of ["yulez", "collectibles", "SkyIsles Seller"]) {
      expect(quick, `${hardcoded} must not be in the code`).not.toContain(hardcoded);
    }
  });

  it("renders no seller block at all when none is published", () => {
    // `null` happens before the migration is applied and for an
    // administrator. A placeholder name would be a false statement about who
    // the customer is contracting with.
    expect(quick).toContain("{seller ? (");
    expect(quick).not.toMatch(/seller\?\.displayName\s*\?\?/);
    expect(quick).not.toContain('|| "');
  });

  it("takes the seller from the page payload, never from a fetch", () => {
    // One call per page render, memoised — not one per card and not one when
    // the dialog opens.
    const reader = code("src/lib/shop/seller.ts");
    expect(reader).toContain("cache(");
    expect(quick).not.toContain("fetchSellerPublic");
    expect(quick).not.toContain("useEffect");
  });

  it("states the seller's kind as a platform sentence, not as a column", () => {
    // Only commercial sellers trade on SkyIsles, so the line is true of every
    // seller and is not stored per row (ADR-0021, ADR-0064).
    expect(quick).toContain("de.quickView.sellerKind");
    expect(code("src/lib/shop/seller.ts")).not.toContain("is_commercial");
  });

  it("shows no rating, because no rating model exists", () => {
    for (const fake of ["rating", "Bewertung", "stars", "Sterne", "review", "5,0", "★"]) {
      expect(quick, `${fake} has no data behind it`).not.toContain(fake);
    }
    // And the projection carries no field one could be built from by accident.
    expect(code("src/lib/shop/seller.ts")).not.toContain("rating");
  });

  it("shows no shipping cost, because it depends on the whole basket", () => {
    for (const fake of ["Versand", "shipping", "Lieferzeit", "delivery"]) {
      expect(quick, `${fake} cannot be stated per article`).not.toContain(fake);
    }
  });

  it("states no stock level — availability is a boolean already spent", () => {
    // Every offer in the model is available by construction, so a label
    // would be a constant; and a count is not public (migration 0006).
    expect(quick).not.toContain("offer.available");
    expect(quick).not.toContain("quantity");
  });
});

describe("one offer is one compact line", () => {
  const quick = code(QUICK_VIEW);
  const row = quick.slice(quick.indexOf("key={offer.condition}"), quick.indexOf("</li>"));

  it("does not wrap the row, and gives no child the full width", () => {
    /*
     * The seller block carried `w-full` inside a `flex-wrap` row, which forced
     * condition, price and the button onto a line of their own and made a
     * single loose offer look like a form.
     */
    expect(row).not.toContain("flex-wrap");
    expect(row).not.toContain("w-full");
    expect(row).toContain("flex items-center justify-between");
  });

  it("names no condition, anywhere in the row", () => {
    /*
     * "Lose € 4,49" labelled the only thing there is. V1 sells loose figures
     * and nothing else, so the word distinguished the offer from nothing.
     *
     * If a second condition is ever sold, the label belongs back here —
     * `OFFER_CONDITIONS` still has two entries, and `conditionLabel()` still
     * translates both for the cart, the checkout and the order mail, where a
     * historical boxed line still has to say what it was.
     */
    expect(row).not.toContain("conditionLabel");
    expect(quick).not.toContain("@/lib/shop/condition");

    // `key={offer.condition}` is React bookkeeping and stays; what must not
    // come back is the condition read as something to display.
    const rendered = row.slice(row.indexOf("key={offer.condition}") + 21);
    expect(rendered).not.toContain("offer.condition");
  });

  it("prints the price once, on the button that charges it (V3.4)", () => {
    /*
     * The row used to show 12,99 € on the left and a button reading "In den
     * Warenkorb" on the right. Amber already says a purchase starts here and
     * the glyph already says where it goes, so the words were the third
     * telling of one fact — and the price was the second telling of another.
     * The button carries the price now and the row carries none.
     */
    expect(row).not.toContain("formatPrice");
    const panel = code("src/components/shop/offer-panel.tsx");
    expect(panel).toContain("<span className=\"tabular-nums\">{formatPrice(offer.price)}</span>");
  });

  it("leaves the seller as the only thing on the left of the row", () => {
    const seller = row.indexOf("seller.displayName");
    expect(seller).toBeGreaterThan(-1);
    const left = row.slice(row.indexOf('<div className="flex min-w-0 flex-col'), row.indexOf("<OfferAddButton"));
    expect(left.length).toBeGreaterThan(40);
    expect(left).toContain("seller.displayName");
    expect(left).not.toContain("formatPrice");
  });

  it("still says the whole sentence to a screen reader", () => {
    /*
     * A visible label of "12,99 €" is not a sentence. The `aria-label`
     * replaces it entirely, so the compact button must keep naming the
     * figure, the price and what pressing it does.
     */
    const panel = code("src/components/shop/offer-panel.tsx");
    expect(panel).toContain("de.shop.addToCartFor(label, formatPrice(offer.price))");
    expect(panel).toContain("de.shop.addAnotherFor(label, formatPrice(offer.price))");
    expect(de.shop.addToCartFor("Hex", "12,99 €")).toBe("Hex für 12,99 € in den Warenkorb legen");
    expect(de.shop.addAnotherFor("Hex", "12,99 €")).toContain("Hex");
    expect(de.shop.addAnotherFor("Hex", "12,99 €")).toContain("12,99 €");
  });

  it("says no condition to a screen reader either", () => {
    // The quick view drops it; the figure page keeps it, because that surface
    // is where a condition could still become a choice.
    const panel = code("src/components/shop/offer-panel.tsx");
    expect(panel).toContain(
      "const label = compact ? name : `${name} (${conditionLabel(offer.condition)})`;",
    );
  });

  it("uses a compact buy pill that still clears 44 px on touch", () => {
    expect(row).toContain("compact");
    const token = code("src/components/ui/action.ts");
    const compact = token.slice(token.indexOf("ACTION_COMMERCE_COMPACT"));
    // Small only from `sm:` up — a pointer is exact, a thumb is not.
    expect(compact).toContain("min-h-11");
    expect(compact).toContain("sm:min-h-8");
  });

  it("wears the commerce amber, not the silver of the row around it", () => {
    /*
     * The offer row is information and stays silver. The button is the one
     * thing on it that starts a purchase, and until V3.2 it borrowed silver
     * too — which made the act of buying look like another line of the offer.
     */
    const token = code("src/components/ui/action.ts");
    const commerce = token.slice(token.indexOf("const COMMERCE ="), token.indexOf("export const ACTION_LINK"));
    // The resting surface is an inline style now (see below); what stays in
    // the class string is the edge and the two interaction states.
    expect(commerce).toContain("ring-commerce-line");
    expect(commerce).toContain("hover:bg-commerce-hover");
    expect(commerce).toContain("active:bg-commerce-pressed");
    expect(commerce).toContain("focus-ring");
    // Not the ownership gold, and not a literal.
    expect(commerce).not.toContain("own-ink");
    expect(commerce).not.toMatch(/#[0-9a-f]{6}/);
    expect(code("src/components/shop/offer-panel.tsx")).toContain("ACTION_COMMERCE_COMPACT");
  });

  it("carries the amber as a value, not only as a class", () => {
    /*
     * The regression this exists to stop: the button came back dark with a
     * pale outline. `bg-commerce` and `text-on-commerce` generate correctly,
     * sit on the right element and are backed by `--commerce` in `:root` —
     * all verified in the served stylesheet — and it still rendered without
     * them. A class only paints if its rule arrives.
     *
     * It still points at the tokens, so `globals.css` stays the one place
     * the colour is decided.
     */
    const action = code("src/components/ui/action.ts");
    expect(action).toContain("export const COMMERCE_SURFACE");
    expect(action).toContain('backgroundColor: "var(--commerce)"');
    expect(action).toContain('color: "var(--on-commerce)"');
    // Not a hex: the role lives in the stylesheet, not in the component.
    const surface = action.slice(action.indexOf("export const COMMERCE_SURFACE"));
    expect(surface.slice(0, surface.indexOf("}"))).not.toMatch(/#[0-9a-f]{6}/);

    const panel = code("src/components/shop/offer-panel.tsx");
    expect(panel).toContain("style={compact ? COMMERCE_SURFACE : undefined}");
  });

  it("is not the ownership gold, on any surface", () => {
    const action = code("src/components/ui/action.ts");
    const commerce = action.slice(action.indexOf("const COMMERCE ="), action.indexOf("export const ACTION_LINK"));
    for (const gold of ["own-ink", "own-line", "accent", "gold"]) {
      expect(commerce, `${gold} is ownership, not buying`).not.toContain(gold);
    }
  });

  it("gives the two surfaces two different buttons, on purpose", () => {
    /*
     * A screenshot of a grey "In den Warenkorb" is not evidence of a bug
     * until it says WHICH button it is. There are two, and the contract is
     * that they differ:
     *
     *   quick view   compact      amber   — the one place a purchase starts
     *   figure page  not compact  silver  — the offer panel, still trade
     *
     * The figure page is not made amber by this, and a future sweep that
     * "unifies" them has to fail here first.
     */
    const panel = code("src/components/shop/offer-panel.tsx");
    expect(panel).toMatch(/compact \? ACTION_COMMERCE_COMPACT : ACTION_SHOP/);
    expect(panel).toContain("style={compact ? COMMERCE_SURFACE : undefined}");

    // The quick view is the caller that passes it.
    expect(code(QUICK_VIEW)).toContain("compact");

    // The figure page's panel renders the button without it.
    const page = code("src/app/(public)/skylanders/[slug]/page.tsx");
    expect(page).toContain("<OfferPanel");
    expect(page).not.toContain("compact");
  });

  it("leaves the figure page's offer panel on silver", () => {
    // The new role is applied where a purchase starts, not by a sweep over
    // every button that ever said "In den Warenkorb".
    const panel = code("src/components/shop/offer-panel.tsx");
    expect(panel).toContain("ACTION_SHOP");
    expect(panel).toMatch(/compact \? ACTION_COMMERCE_COMPACT : ACTION_SHOP/);
  });

  it("grows by adding entries, not by changing shape", () => {
    expect(quick).toContain("model.offers.map");
    expect(quick).toContain("<li");
  });
});

describe("the overlays stack in the right order", () => {
  it("the dialog is above the header and the phone's bottom bar", () => {
    // The floating cart used to be the third thing in this ladder. V3.4
    // removed it; what is left below the dialog is the masthead at z-30 and
    // the bottom navigation at z-20.
    expect(code(MODAL)).toContain("z-50");
    const nav = code("src/components/layout/site-nav.tsx");
    expect(nav).toContain("sticky top-0 z-30");
    expect(nav).toContain("fixed inset-x-0 bottom-0 z-20");
  });

  it("but the cart confirmation is above the dialog", () => {
    // It is the answer to the action taken inside the dialog. Underneath it,
    // adding to the cart would happen with no visible result.
    expect(code(TOAST)).toContain("z-60");
    expect(code(TOAST)).not.toContain("z-40");
    expect(code(TOAST)).toContain('role="status"');
  });
});

describe("commerce is reused, not rebuilt", () => {
  const quick = code(QUICK_VIEW);

  it("buys through the same button the figure page uses", () => {
    // The layout here is its own, but the control is shared: which cart line
    // it belongs to, whether one is already in it, and the accessible name
    // are decided in one place and cannot drift between the two surfaces.
    expect(quick).toContain("OfferAddButton");
    expect(quick).toContain("@/components/shop/offer-panel");
    expect(code("src/components/shop/offer-panel.tsx")).toContain("useAddToCart");
    expect(code("src/components/shop/offer-panel.tsx")).toContain("export function OfferAddButton");
  });

  it("carries no cart logic of its own", () => {
    for (const forbidden of ["localStorage", "addToCart(", "useCart(", "decideAdd", "showCartToast"]) {
      expect(quick, `${forbidden} belongs to the cart, not here`).not.toContain(forbidden);
    }
  });

  it("names no seller and invents no rating", () => {
    // `sellers` is unreadable to a visitor until a `seller_public()` exists,
    // and a trade name written into i18n would be a second source of truth.
    for (const forbidden of ["yulez", "Verkäufer", "Bewertung", "rating", "Versandkosten"]) {
      expect(quick, `${forbidden} is not in the data`).not.toContain(forbidden);
    }
  });

  it("offers the detail page as the way to everything else", () => {
    expect(quick).toContain("de.quickView.toDetail");
    expect(quick).toContain("`/skylanders/${model.slug}`");
  });

  it("keeps the buy action silver and the frame gold (V3.1)", () => {
    // Gold means ownership. A gold buy button would say the opposite of what
    // the colour means everywhere else in the product.
    expect(quick).not.toContain("ACTION_OWN");
    expect(code(MODAL)).toContain("ring-gold-line");
    expect(code("src/components/shop/offer-panel.tsx")).toContain("ACTION_SHOP");
  });
});
