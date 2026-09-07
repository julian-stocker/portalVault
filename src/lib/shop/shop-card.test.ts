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
    // The body is a link or a toggle; the offer and the footer are siblings
    // of it, so nothing needs an event stopped from bubbling.
    const tail = figure.slice(figure.indexOf("{offerSlot ?"));
    expect(tail).toContain("{offerSlot ?");
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
    expect(code(ACTION)).toContain("min-h-10");
  });
});

describe("who sees it", () => {
  const card = code(CARD);

  it("is built once and given to both collector branches", () => {
    expect(card).toContain("const shop =");
    expect((card.match(/offerSlot=\{shop\}/g) ?? []).length).toBe(2);
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
