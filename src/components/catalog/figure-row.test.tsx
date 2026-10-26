// @vitest-environment jsdom
/**
 * THE ROW, ACTUALLY RENDERED AND ACTUALLY CLICKED (UX-01B, ADR-0148).
 *
 * WHY THIS FILE HAS TO EXIST BESIDE THE SOURCE-TEXT TESTS.
 *
 * `figure-row.test.ts` can read that `{trade}` does not appear between the
 * toggle's tags. What it cannot read is whether the offer link ends up INSIDE
 * the toggle in the tree React actually builds — a wrapper added later, a
 * fragment moved one level up, and the source still looks right while the DOM
 * has a link nested in a button. That is the exact class of defect this
 * project has been bitten by twice (ADR-0133, and the heart in `0145`), and
 * the answer both times was to render and ask the DOM.
 *
 * Three things are asked here, and all three are about containment and
 * behaviour rather than about appearance:
 *
 *   1. the offer and the heart are SIBLINGS of the toggle, not children
 *   2. a click on one of them does not collect the figure
 *   3. ownership, wanting and the reserved alarm slot do not influence
 *      each other
 *
 * WHAT DOES NOT HAPPEN HERE, honestly: no browser, no layout engine, no
 * pixels. jsdom computes no geometry, so "does the name fit at 360 px" is
 * answered by arithmetic in `figure-row.test.ts` and by a real browser at
 * acceptance. This file answers the questions arithmetic cannot.
 */
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CatalogFigure } from "@/lib/catalog/types";
import { de } from "@/lib/i18n/de";

/* A real anchor is all `next/link` has to be here. */
vi.mock("next/link", () => ({
  default: function LinkStandIn(
    { href, children, ...rest }: { href: string; children?: ReactNode } & Record<string, unknown>,
  ) {
    return createElement("a", { href, ...rest }, children);
  },
}));

/* ------------------------------------------------------------------ fixtures */

function figure(over: Partial<CatalogFigure> = {}): CatalogFigure {
  return {
    skyId: "SKY-0007", name: "Bash", slug: "bash",
    seriesCode: "SA", seriesLabel: "Spyro's Adventure",
    seriesPosition: 0, categoryPosition: 0, categoryName: "Figuren", categoryId: 1,
    catalogGroup: "figure", cardType: "standard", catalogVisible: true,
    canonicalName: "Bash", displayNameOverride: null, marketPrice: 4.99,
    imageFile: null, imageOverridePath: null,
    displayName: "Bash", sortBaseName: "Bash", sortVariantLabel: null,
    searchIndex: "bash", isActive: true, element: "Earth", characterId: null,
    ...over,
  };
}

/* ------------------------------------------------------------------ harness */

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function mount(node: ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(node); });
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

/** Mounts a row. `onToggle` is counted unless the caller supplies its own. */
const toggles: string[] = [];

async function row(props: Record<string, unknown> = {}) {
  const { FigureRow } = await import("./figure-row");
  await mount(createElement(FigureRow, {
    figure: figure(),
    ownership: "catalog",
    onToggle: () => toggles.push("toggle"),
    toggleLabel: de.catalog.collect,
    /* Two stand-ins for the two slots. Real controls of their own, because
       the question is whether a click on them reaches the toggle. */
    trade: createElement("a", { href: "/skylanders/bash#angebote", "data-id": "offer" }, "Angebot"),
    favoriteSlot: createElement("button", { type: "button", "data-id": "heart" }, "Herz"),
    ...props,
  } as never));
}

const article = (): HTMLElement => {
  const found = document.querySelector("article");
  if (found === null) throw new Error("no row rendered");
  return found as HTMLElement;
};

const toggle = (): HTMLElement => {
  const found = article().querySelector("button:not([data-id])");
  if (found === null) throw new Error("no toggle rendered");
  return found as HTMLElement;
};

const byId = (id: string): HTMLElement => {
  const found = document.querySelector(`[data-id="${id}"]`);
  if (found === null) throw new Error(`no ${id} rendered`);
  return found as HTMLElement;
};

beforeEach(() => {
  toggles.length = 0;
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  container?.remove();
  root = null;
  container = null;
});

/* ========================================================================
 * CONTAINMENT
 * ===================================================================== */

describe("the toggle, the offer and the heart are three separate targets", () => {
  it("renders the toggle as a button and nothing interactive inside it", async () => {
    await row();
    const inside = toggle().querySelectorAll("a, button, input, select, textarea");
    expect([...inside].map((el) => el.tagName), "nested interactive element").toEqual([]);
  });

  it("the offer is a sibling of the toggle, in the DOM and not only in the source", async () => {
    await row();
    expect(toggle().contains(byId("offer")), "the offer is inside the toggle").toBe(false);
    expect(article().contains(byId("offer"))).toBe(true);
  });

  it("and so is the heart", async () => {
    await row();
    expect(toggle().contains(byId("heart")), "the heart is inside the toggle").toBe(false);
    expect(article().contains(byId("heart"))).toBe(true);
  });

  it("a click on the offer does not collect the figure", async () => {
    await row();
    await click(byId("offer"));
    expect(toggles).toEqual([]);
  });

  it("a click on the heart does not collect the figure", async () => {
    await row();
    await click(byId("heart"));
    expect(toggles).toEqual([]);
  });

  it("but a click on the row's identity block does", async () => {
    await row();
    await click(toggle());
    expect(toggles).toEqual(["toggle"]);
  });

  it("the toggle says what it is and what pressing it will do", async () => {
    await row({ collected: true, toggleLabel: de.catalog.collectedHint });
    expect(toggle().getAttribute("aria-pressed")).toBe("true");
    expect(toggle().textContent).toContain(de.catalog.collectedHint);
    expect(toggle().textContent).toContain("Bash");
  });
});

/* ========================================================================
 * THE THREE GROUNDS
 * ===================================================================== */

describe("the ground says whether the figure is owned", () => {
  it("owned: the warm ground, a gold edge and a glow at the edge", async () => {
    await row({ collected: true, knowsCollection: true });
    const cls = article().className;
    expect(cls).toContain("bg-own-subtle/70");
    expect(cls).toContain("ring-own-line-strong");
    expect(cls).toContain("shadow-[0_0_18px_-8px_var(--own-line-strong)]");
  });

  it("and it says so in words as well, for anyone the gold does not reach", async () => {
    await row({ collected: true, knowsCollection: true });
    expect(article().textContent).toContain(de.catalog.collectedBadge);
  });

  it("missing, on a surface that knows: the quiet ground, and nothing else", async () => {
    await row({ collected: false, knowsCollection: true });
    const cls = article().className;
    expect(cls).toContain("bg-deep/55");
    expect(cls).not.toContain("own-subtle");
    expect(cls).not.toContain("own-line-strong");
  });

  it("and on a surface that cannot know: the plain in-world ground", async () => {
    /* A signed-out catalogue must not draw every row as "not yours" — that
       says nothing about ownership and merely fades the list. */
    await row({ collected: false, knowsCollection: false });
    expect(article().className).toContain("bg-deep/70");
  });

  it("the showcase marks nothing, even when the figure is owned", async () => {
    /*
     * The figure page's siblings are not asked the ownership question, and
     * `marksOwnership` is what refuses it — the same boundary the card has
     * always drawn.
     *
     * Checked on the VISIBLE marker, which is the diamond in the meta line.
     * A toggle's assistive state text still says "In deiner Sammlung" from
     * `collected`, exactly as the card's does, and that is correct: it
     * describes what pressing the control would undo, not what the surface
     * claims about ownership. In production the showcase passes no
     * `collected` at all, so the two never meet.
     */
    await row({ ownership: "showcase", collected: true, knowsCollection: true });
    expect(article().className).toContain("bg-deep/70");
    expect(article().textContent, "the showcase drew the ownership marker")
      .not.toContain("◆");
  });

  it("copies are named above one and never at one", async () => {
    await row({ collected: true, knowsCollection: true, quantity: 3 });
    expect(article().textContent).toContain("3×");
    await act(async () => { root?.unmount(); });
    container?.remove();
    await row({ collected: true, knowsCollection: true, quantity: 1 });
    expect(article().textContent).not.toContain("1×");
  });
});

/* ========================================================================
 * THE PHOTOGRAPH
 * ===================================================================== */

describe("the photograph is never touched", () => {
  it("no filter, no opacity and no transform on the picture, owned or not", async () => {
    for (const collected of [true, false]) {
      await row({
        collected,
        knowsCollection: true,
        figure: figure({ imageFile: "bash.webp" }),
      });
      const img = article().querySelector("img");
      expect(img, "the picture renders").not.toBeNull();
      expect(img!.className).not.toMatch(/opacity|saturate|grayscale|scale/);
      expect(img!.style.filter).toBe("");
      expect(img!.style.opacity).toBe("");
      /* And the row itself does not scale: no layout jump between states. */
      expect(article().style.transform).toBe("");
      await act(async () => { root?.unmount(); });
      container?.remove();
    }
  });

  it("a figure without a picture keeps the stage and says so", async () => {
    await row({ figure: figure({ imageFile: null, imageOverridePath: null }) });
    expect(article().querySelector("img")).toBeNull();
    expect(article().textContent).toContain(de.catalog.noImage);
  });
});

/* ========================================================================
 * INDEPENDENCE
 * ===================================================================== */

describe("possession, wanting and the reserved alarm slot are independent", () => {
  it("a heart changes nothing about the ground", async () => {
    await row({ collected: true, knowsCollection: true, favoriteSlot: null });
    const withoutHeart = article().className;
    await act(async () => { root?.unmount(); });
    container?.remove();
    await row({ collected: true, knowsCollection: true });
    expect(article().className).toBe(withoutHeart);
  });

  it("and the row renders in all four combinations of owned and wanted", async () => {
    for (const collected of [true, false]) {
      for (const wanted of [true, false]) {
        await row({
          collected,
          knowsCollection: true,
          favoriteSlot: wanted
            ? createElement("button", { type: "button", "data-id": "heart" }, "Herz")
            : null,
        });
        expect(article(), `${collected}/${wanted}`).not.toBeNull();
        expect(document.querySelectorAll('[data-id="heart"]')).toHaveLength(wanted ? 1 : 0);
        await act(async () => { root?.unmount(); });
        container?.remove();
      }
    }
  });

  it("the action column holds its two slots open with only the heart in it", async () => {
    await row();
    const column = byId("heart").parentElement!;
    expect(column.className).toContain("min-h-22");
    expect(column.className).toContain("w-11");
  });

  it("the bell slot lands under the heart when it eventually arrives", async () => {
    /* UX-02 passes a second control; the column already has room, so nothing
       about the row's geometry changes on that day. */
    await row({ bellSlot: createElement("button", { type: "button", "data-id": "bell" }, "Glocke") });
    const column = byId("heart").parentElement!;
    expect(column.contains(byId("bell"))).toBe(true);
    expect([...column.children].indexOf(byId("heart")))
      .toBeLessThan([...column.children].indexOf(byId("bell")));
    expect(toggle().contains(byId("bell"))).toBe(false);
  });

  it("no action column at all when a surface offers neither", async () => {
    await row({ favoriteSlot: null, bellSlot: null });
    expect(article().querySelector(".min-h-22")).toBeNull();
  });
});

/* ========================================================================
 * PRICES AND EDITIONS
 * ===================================================================== */

describe("what the row says about money and editions", () => {
  it("labels the market value, because an asking price stands beside it", async () => {
    await row();
    expect(article().textContent).toContain(de.catalog.marketValue);
    expect(article().textContent).toContain("4,99");
  });

  it("an unknown price is a state, never a zero", async () => {
    await row({ figure: figure({ marketPrice: null }) });
    expect(article().textContent).toContain(de.catalog.noPrice);
    expect(article().textContent).not.toContain("0,00");
  });

  it("the boost changes the printed number and nothing else", async () => {
    await row({ marketBoostPercent: 10 });
    expect(article().textContent).toContain("5,49");
  });

  it("names the edition, because a row has no artwork to show it with", async () => {
    await row({ figure: figure({ cardType: "legendary" }) });
    expect(article().textContent).toContain("Legendary");
  });

  it("and says nothing when the figure is a plain one", async () => {
    await row({ figure: figure({ cardType: "standard" }) });
    expect(article().textContent).not.toContain("Standard");
  });
});

/* ========================================================================
 * THE ERROR PATH
 * ===================================================================== */

describe("a failed collect", () => {
  it("is announced, and it covers nothing", async () => {
    await row({ failed: true });
    const alert = article().querySelector('[role="alert"]');
    expect(alert, "the failure is announced").not.toBeNull();
    expect(alert!.textContent).toContain(de.catalog.collectFailed);
    expect(alert!.className, "the message is laid over something")
      .not.toContain("absolute");
  });

  it("and is absent when nothing failed", async () => {
    await row();
    expect(article().querySelector('[role="alert"]')).toBeNull();
  });
});

/* ========================================================================
 * THE SIGNED-OUT ROW
 * ===================================================================== */

describe("signed out the identity block is a link, not a toggle", () => {
  it("leads where the visitor has to go, and toggles nothing", async () => {
    await row({ onToggle: undefined, href: "/login?next=%2F" });
    const link = article().querySelector("a:not([data-id])");
    expect(link, "the identity block is a link").not.toBeNull();
    expect(link!.getAttribute("href")).toBe("/login?next=%2F");
    expect(article().querySelector("button:not([data-id])")).toBeNull();
  });

  it("and the offer is still its own target beside it", async () => {
    await row({ onToggle: undefined, href: "/login?next=%2F" });
    const link = article().querySelector("a:not([data-id])") as HTMLElement;
    expect(link.contains(byId("offer"))).toBe(false);
  });
});
