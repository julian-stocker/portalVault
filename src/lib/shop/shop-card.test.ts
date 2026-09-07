import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { buyableOffers, summarizeOffers, type Offer } from "@/lib/shop/offer";

/**
 * The buy action on a catalog card (V7).
 *
 * Two rules carry it. Nothing is shown unless something can actually be
 * bought — no disabled button, no "Nicht auf Lager". And the action is a
 * sibling of the card body, so pressing it can never toggle a collection or
 * open a detail page.
 */
function offer(overrides: Partial<Offer> = {}): Offer {
  return { skyId: "SKY-0001", condition: "loose", price: 4.49, available: true, ...overrides };
}

/** The file without its comments — what it does, not what it says. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith("*") && !trimmed.startsWith("//") && !trimmed.startsWith("/*");
    })
    .join("\n");
}

const ACTION = "src/components/shop/shop-action.tsx";
const CARD = "src/components/catalog/catalog-card.tsx";
const FIGURE = "src/components/catalog/figure-card.tsx";
const PANEL = "src/components/shop/offer-panel.tsx";

describe("when the shop area appears", () => {
  it("not at all when nothing is offered", () => {
    expect(summarizeOffers([])).toEqual({ kind: "none" });
  });

  it("not at all when it is listed but unavailable", () => {
    expect(summarizeOffers([offer({ available: false })])).toEqual({ kind: "none" });
  });

  it("for a buyable loose offer", () => {
    expect(summarizeOffers([offer()])).toEqual({ kind: "single", price: 4.49, condition: "loose" });
  });

  it("for a buyable boxed offer", () => {
    expect(summarizeOffers([offer({ condition: "boxed", price: 7.99 })])).toEqual({
      kind: "single",
      price: 7.99,
      condition: "boxed",
    });
  });

  it("as 'ab X' when both are buyable at different prices", () => {
    expect(
      summarizeOffers([offer(), offer({ condition: "boxed", price: 7.99 })]),
    ).toEqual({ kind: "from", price: 4.49 });
  });

  it("as one price when both are buyable at the same price", () => {
    // "ab 4,49 €" beside nothing cheaper than 4,49 € reads as though
    // something were being withheld.
    expect(
      summarizeOffers([offer(), offer({ condition: "boxed" })]),
    ).toEqual({ kind: "single", price: 4.49, condition: "loose" });
  });

  it("as the one that is buyable when only one of two is", () => {
    const summary = summarizeOffers([
      offer({ condition: "loose", available: false }),
      offer({ condition: "boxed", price: 7.99 }),
    ]);
    expect(summary).toEqual({ kind: "single", price: 7.99, condition: "boxed" });
    expect(buyableOffers([
      offer({ condition: "loose", available: false }),
      offer({ condition: "boxed", price: 7.99 }),
    ]).map((o) => o.condition)).toEqual(["boxed"]);
  });
});

describe("what the card says", () => {
  const action = code(ACTION);

  it("names no brand on the button", () => {
    // "SkyIsles 4,49 €" said in a word what the website already says.
    expect(action).not.toContain("SkyIsles");
    expect(code(CARD)).not.toContain("SkyIsles");
  });

  it("never says 'not in stock'", () => {
    for (const file of [action, code(CARD), code(FIGURE), code(PANEL)]) {
      expect(file).not.toContain("soldOut");
      expect(file).not.toContain("Nicht auf Lager");
    }
  });

  it("renders nothing at all for 'none'", () => {
    expect(action).toContain('if (summary.kind === "none") return null;');
  });

  it("offers no disabled or greyed-out shop surface", () => {
    expect(action).not.toContain("disabled");
    expect(action).not.toContain("opacity-");
  });

  it("uses the shared cart glyph, not an emoji", () => {
    expect(action).toContain("<CartGlyph");
    expect(action).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });

  it("uses the existing warm accent tokens", () => {
    // No new colour invented for one button.
    expect(action).toContain("bg-accent");
    expect(action).toContain("text-on-accent");
    expect(action).not.toMatch(/#[0-9a-fA-F]{6}/);
  });

  it("is a compact pill, not a bar", () => {
    // V9: a full-width gold button made a card you can buy structurally
    // different from one you cannot, and it was the loudest thing on a
    // display piece.
    expect(action).toContain("inline-flex h-10 shrink-0");
    expect(action).not.toMatch(/const BUY =[\s\S]{0,200}flex-1/);
    expect(action).not.toMatch(/const BUY =[\s\S]{0,200}w-full/);
  });

  it("carries a glyph and a price and no word", () => {
    // "Kaufen", "Shop" or the brand would all repeat the context.
    for (const word of ["Kaufen", "Shop", "SkyIsles", "Angebot"]) {
      expect(action).not.toContain(`de.shop.${word.toLowerCase()}`);
    }
    expect(action).toContain("<CartGlyph />");
    expect(action).toContain("formatPrice(summary.price)");
  });
});

describe("the market price stays information", () => {
  const figure = code(FIGURE);

  it("keeps its own line, with the element chip beside it", () => {
    expect(figure).toContain("de.catalog.noPrice : formatPrice(figure.marketPrice)");
    expect(figure).toContain("items-baseline justify-between");
    expect(figure).toContain("elementChipClass(figure.element)");
  });

  it("is not rendered in a shop style", () => {
    // The offer used to sit directly under it in the same block. It is an
    // action now and lives in the footer area.
    const body = figure.slice(figure.indexOf("const inner = ("), figure.indexOf("const bodyClass"));
    expect(body).not.toContain("offerSlot");
    expect(figure).not.toContain("text-shop-on-card");
  });
});

describe("click boundaries", () => {
  const figure = code(FIGURE);

  it("puts the buy action outside the clickable body", () => {
    // The body is a link or a toggle; the footer is a sibling of it, so
    // nothing needs an event stopped from bubbling.
    const tail = figure.slice(figure.indexOf("{footer ?"));
    expect(tail).toContain("{footer ?");
    const body = figure.slice(figure.indexOf("const inner = ("), figure.indexOf("const bodyClass"));
    // Neither is rendered inside the body — the word may appear in a JSX
    // comment there, the value may not.
    expect(body).not.toContain("{offerSlot}");
    expect(body).not.toContain("{footer}");
  });

  it("never stops propagation, because it never has to", () => {
    for (const file of [code(ACTION), figure, code(CARD)]) {
      expect(file).not.toContain("stopPropagation");
      expect(file).not.toContain("preventDefault");
    }
  });

  it("keeps a 40 px touch target", () => {
    // `h-10` exactly, so the pill is the same height as the empty row it
    // sits in — that is what keeps every card the same shape (V9).
    expect(code(ACTION)).toContain("h-10");
  });
});

describe("who sees it", () => {
  const card = code(CARD);

  it("is built once and reaches both collector branches", () => {
    // One `shop`, placed once inside one `footer`, and that footer is handed
    // to the signed-out branch and the signed-in one.
    expect((card.match(/const shop =/g) ?? []).length).toBe(1);
    expect((card.match(/\{shop\}/g) ?? []).length).toBe(1);
    expect((card.match(/footer=\{footer\}/g) ?? []).length).toBe(2);
  });

  it("never reaches the administrator's card", () => {
    const adminBranch = card.slice(card.indexOf("if (admin) {"), card.indexOf("const footer = ("));
    expect(adminBranch).not.toContain("offerSlot");
    expect(adminBranch).not.toContain("ShopAction");
  });

  it("does not depend on ownership", () => {
    // Somebody who owns one may want a second. The offer is not a hint about
    // what is missing.
    expect(card).not.toMatch(/collected \?\s*null\s*:\s*<ShopAction/);
    expect(card).not.toMatch(/!collected && offers/);
  });
});

describe("the cart is untouched by any of this", () => {
  it("still stores sky_id + condition and writes no table", () => {
    const action = code(ACTION);
    expect(action).toContain("add({ skyId, condition: offer.condition");
    expect(action).not.toContain("@/lib/supabase");
    expect(action).not.toContain(".rpc(");
    expect(action).not.toContain("reserved");
    expect(action).not.toContain("use server");
  });
});


describe("every card is the same shape (V9.1)", () => {
  const figure = code(FIGURE);
  const card = code(CARD);

  it("has one footer and no separate action row", () => {
    // V9 had two rows below the body — a 40 px action row and a centred Info
    // link. They are one row now: Info left, the buy action right.
    expect(figure).not.toContain("offerSlot");
    expect((figure.match(/\{footer \?/g) ?? []).length).toBe(1);
  });

  it("renders the footer row unconditionally, with its own minimum height", () => {
    // No `offer ? … : …` anywhere in the geometry: the row is always there
    // and always at least 40 px, so a card that can be bought and one that
    // cannot end at the same place.
    expect(card).toContain('<div className="flex min-h-10 items-center justify-between gap-2">');
  });

  it("uses a constant margin above the footer", () => {
    expect(figure).toContain('{footer ? <div className="relative mt-2">{footer}</div> : null}');
    expect(figure).not.toMatch(/mt-\d[^"]*" : "mt-/);
  });

  it("keeps Info on the left however the right side is filled", () => {
    // justify-between with Info first: it cannot drift right when the pill
    // is missing.
    const footer = card.slice(card.indexOf("const footer = ("), card.indexOf("// Signed out"));
    expect(footer.indexOf("ACTION_LINK")).toBeLessThan(footer.indexOf("{shop}"));
    expect(footer).toContain("justify-between");
  });

  it("puts nothing in the right of the row when there is no offer", () => {
    // `shop` is null, and null renders nothing at all — no placeholder, no
    // disabled button, no reserved gap.
    expect(card).toContain("offers.length > 0 ? (");
    expect(card).toContain(") : null;");
  });

  it("never gives the showcase a buy action", () => {
    // The collection has a footer of its own — the remove action — and the
    // related figures beside a detail page have none at all. Neither carries
    // a shop: the catalog is where something is bought.
    const collection = code("src/components/collection/collection-view.tsx");
    expect(collection).toContain("footer={");
    expect(collection).not.toContain("ShopAction");
    const detail = code("src/app/(public)/skylanders/[slug]/page.tsx");
    expect(detail).not.toContain("footer=");
    expect(detail).not.toContain("ShopAction");
  });
});

describe("the Info link (V9.1)", () => {
  const card = code(CARD);

  it("is a quiet link, not a full-width button", () => {
    expect(card).toContain("ACTION_LINK");
    expect(card).not.toContain("ACTION_CARD");
    const action = readFileSync("src/components/ui/action.ts", "utf8");
    expect(action).toContain("export const ACTION_LINK");
    // Same weight as the administrator's "Details".
    expect(action).toMatch(/ACTION_LINK =[\s\S]{0,200}underline/);
  });

  it("keeps a real touch target even though it reads as text", () => {
    const action = readFileSync("src/components/ui/action.ts", "utf8");
    expect(action).toMatch(/ACTION_LINK =[\s\S]{0,240}min-h-10/);
    // Never full width: it must not push the buy action out of the row.
    expect(action).not.toMatch(/ACTION_LINK =[\s\S]{0,240}w-full/);
  });

  it("gives way to a wide price rather than overflowing the card", () => {
    // "ab € 58,90" beside the label exceeds a 161 px card at 390 px. Two
    // shrink-0 siblings would overflow; the label truncates instead.
    const action = readFileSync("src/components/ui/action.ts", "utf8");
    expect(action).toMatch(/ACTION_LINK =[\s\S]{0,240}min-w-0/);
    expect(code(CARD)).toContain('<span className="truncate">{de.catalog.info}</span>');
    // The pill itself never shrinks — the price stays readable.
    expect(code(ACTION)).toContain("inline-flex h-10 shrink-0");
  });

  it("sits at the left end and reads as an action", () => {
    const action = readFileSync("src/components/ui/action.ts", "utf8");
    expect(action).toMatch(/ACTION_LINK =[\s\S]{0,220}text-xs font-medium/);
    expect(action).not.toMatch(/ACTION_LINK =[\s\S]{0,220}justify-center/);
  });

  it("still opens the figure's page, with an accessible name", () => {
    expect(card).toContain("href={`/skylanders/${figure.slug}`}");
    expect(card).toContain("aria-label={de.catalog.infoFor(figure.displayName)}");
  });
});


describe("the condition chooser (V9.1)", () => {
  const action = code(ACTION);

  it("opens over the footer rather than inside it", () => {
    // In flow it would either squeeze the Info link or make the card taller
    // than its neighbours. Anchored to the footer's bottom edge, the card's
    // geometry does not move at all.
    expect(action).toContain("absolute inset-x-0 bottom-0 z-10");
    expect(action).toContain("bg-card");
  });

  it("still names every buyable condition with its price", () => {
    expect(action).toContain("buyable.map((offer) => (");
    expect(action).toContain("conditionLabel(offer.condition)");
    expect(action).toContain("formatPrice(offer.price)");
    expect(action).toContain("de.shop.addToCartFor(");
  });

  it("leaves the closed state a pill in the footer", () => {
    expect(action).toContain("const BUY =");
    expect(action).toContain("inline-flex h-10 shrink-0");
  });
});
