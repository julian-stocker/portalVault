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
import { AvailabilityBell } from "@/components/catalog/availability-bell";
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
    searchIndex: "bash", isActive: true, element: "Earth", characterId: null, baseSkyId: null,
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

/** The signed-out variant: the overlay is a link instead of a button. */
const overlayLink = (): HTMLElement => {
  const found = article().querySelector("a:not([data-id])");
  if (found === null) throw new Error("no overlay link rendered");
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

  it("and it says so WITHOUT a mark of its own since UX-01E", async () => {
    /*
     * The visible mark was a gold diamond before the element. After the
     * desktop review the operator asked for the top left to be the element
     * and the name and nothing else, with the gold highlight carrying
     * ownership on its own.
     *
     * THE HIDDEN SENTENCE STAYED, and that is the half worth testing. It is
     * the only place on the row that says how many copies are owned; it is
     * invisible, so removing it would have cost a screen reader information
     * while changing nothing on screen; and it survives a forced-colours
     * display, where the gold is repainted away.
     */
    await row({ collected: true, knowsCollection: true });
    expect(article().textContent, "no diamond is drawn").not.toContain("\u25c6");
    const hidden = [...article().querySelectorAll(".sr-only")]
      .map((el) => el.textContent ?? "").join(" ");
    expect(hidden, "the sentence is still there for assistive tech")
      .toContain(de.catalog.collectedBadge);
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
      .not.toContain("\u25c6");
  });

  it("copies are named above one and never at one", async () => {
    /* In the hidden sentence now, with the ownership mark it belongs to. */
    const hidden = () => [...article().querySelectorAll(".sr-only")]
      .map((el) => el.textContent ?? "").join(" ");
    await row({ collected: true, knowsCollection: true, quantity: 3 });
    expect(hidden()).toContain("3");
    await act(async () => { root?.unmount(); });
    container?.remove();
    await row({ collected: true, knowsCollection: true, quantity: 1 });
    expect(hidden()).not.toMatch(/\b1 ?×/);
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

  const infoAction = (): HTMLAnchorElement =>
    article().querySelector<HTMLAnchorElement>('a[aria-label^="Info zu"]')!;
  /*
   * Each slot sits in a positioned span, so the bar is one level up — and it
   * is found through the INFO action rather than the heart, because the info
   * action is the one slot that is always there. A surface with favourites
   * switched off still has a bar.
   */
  const actionBar = (): HTMLElement => infoAction().parentElement!.parentElement!;

  it("the bar is horizontal, hard right, and reserves no height", async () => {
    /*
     * UX-01D. It was a 44 px COLUMN at the row's far edge, which took 50 px
     * of width off the text block for one heart and left the rest of it
     * empty. The marks are a bar on the identity line now; the width went to
     * the name and to the price line, which is why the offer chip can reach
     * the row's own edge.
     */
    await row();
    expect(actionBar().className).toBe("ml-auto flex shrink-0 items-center");
    expect(actionBar().className).not.toContain("flex-col");
    expect(actionBar().className).not.toContain("min-h");
  });

  it("and it stands on the identity line, beside the name", async () => {
    await row();
    const line = actionBar().parentElement!;
    expect(line.textContent).toContain("Bash");
    expect(line.className).toContain("items-center");
  });

  it("the bar is NOT positioned, and each slot is", async () => {
    /*
     * The defect this fixes: a positioned box painted its empty space above
     * the collect overlay and swallowed every tap there.
     */
    await row();
    expect(actionBar().className).not.toContain("relative");
    expect(byId("heart").parentElement!.className).toBe("relative");
    expect(infoAction().parentElement!.className).toBe("relative");
  });

  it("with an offer the order is info, then favourite", async () => {
    await row({ offered: true });
    const slots = [...actionBar().children];
    expect(slots).toHaveLength(2);
    expect(slots.findIndex((el) => el.contains(infoAction())))
      .toBeLessThan(slots.findIndex((el) => el.contains(byId("heart"))));
  });

  it("and without one the bell comes first — bell, info, favourite", async () => {
    /*
     * THE ORDER THE OPERATOR SPECIFIED, and the condition that goes with it:
     * the bell answers "tell me when this is available", which is a question
     * about a figure that cannot be bought. Nothing passes a bell yet, so
     * this is the arrangement waiting for UX-02 rather than a control on
     * screen.
     */
    await row({
      offered: false,
      bellSlot: createElement("span", { "data-id": "bell" }, "Glocke"),
    });
    const slots = [...actionBar().children];
    expect(slots).toHaveLength(3);
    const at = (el: Element) => slots.findIndex((slot) => slot.contains(el));
    expect(at(byId("bell"))).toBeLessThan(at(infoAction()));
    expect(at(infoAction())).toBeLessThan(at(byId("heart")));
    expect(toggle().contains(byId("bell"))).toBe(false);
  });

  it("and a row with something to buy shows NO bell, even if one is passed", async () => {
    /*
     * One flag, inverted, and no second rule: `offered` dresses the offer
     * chip and decides the bell. A figure you can buy needs no reminder.
     */
    await row({
      offered: true,
      bellSlot: createElement("span", { "data-id": "bell" }, "Glocke"),
    });
    expect(article().querySelector('[data-id="bell"]')).toBeNull();
    expect([...actionBar().children]).toHaveLength(2);
  });

  it("the info action leads to the figure's own page, and is not prefetched", async () => {
    /*
     * REUSE, NOT A NEW SURFACE. `/skylanders/<slug>` is the detail page the
     * vertical card's body has always led to; a row's body is the collect
     * toggle instead, which is exactly why the row needs this second way
     * there. `QuickView` could not do it: it is a BUYING dialog and
     * `quickViewModel()` returns null without an offer — the state that needs
     * an info action most.
     */
    await row();
    expect(infoAction().getAttribute("href")).toBe("/skylanders/bash");
    expect(infoAction().getAttribute("aria-label")).toBe("Info zu Bash");
    /* Not prefetched — asserted on the source in `figure-row.test.ts`,
       because `prefetch` is a Next prop and leaves no trace in the DOM. */
  });

  it("the REAL bell renders disabled, and only where there is nothing to buy", async () => {
    /*
     * UX-01E made the bell visible, so this renders the component the
     * application actually passes rather than a stand-in. Two statements in
     * one: it is there without an offer and absent with one, and it cannot be
     * pressed either way.
     */
    await row({ offered: false, bellSlot: createElement(AvailabilityBell) });
    const bell = article().querySelector<HTMLButtonElement>("button[disabled]")!;
    expect(bell, "a bell without an offer").toBeTruthy();
    expect(bell.disabled).toBe(true);
    expect(bell.getAttribute("title")).toBe(de.catalog.alarmPending);
    /* It is in the bar, first, and inside its own positioned slot. */
    const slots = [...actionBar().children];
    expect(slots).toHaveLength(3);
    expect(slots[0].contains(bell)).toBe(true);
    expect(slots[0].className).toBe("relative");
  });

  it("and the bell covers neither the info nor the favourite target", async () => {
    /*
     * THE OPERATOR'S REQUIREMENT, and the reason the marks are 44 px boxes
     * side by side rather than glyphs with expanded hit areas: three separate
     * elements in three separate slots, in document order, none of them
     * positioned over another. Two overlapping 44 px targets would make it
     * undecidable which one a thumb hit.
     */
    await row({ offered: false, bellSlot: createElement(AvailabilityBell) });
    const bell = article().querySelector<HTMLButtonElement>("button[disabled]")!;
    const marks = [bell, infoAction(), byId("heart")];
    for (const mark of marks) {
      /* Each in its own slot, and no slot contains another's mark. */
      const slot = mark.parentElement!;
      expect(slot.className).toBe("relative");
      for (const other of marks) {
        if (other !== mark) expect(slot.contains(other)).toBe(false);
      }
    }
    /*
     * 44 px boxes, so adjacent glyph centres are 44 px apart. Only the two
     * REAL components are measured here — the heart in this file is a
     * stand-in with no classes of its own, and its box is held against the
     * other two in `availability-bell.test.tsx`.
     */
    expect(bell.className).toContain("h-11 w-11");
    expect(infoAction().className).toContain("h-11 w-11");
    /* And the disabled bell takes no pointer events away from them. */
    expect(bell.className).toContain("cursor-not-allowed");
  });

  it("the info action is always there — it is the one that never depends on state", async () => {
    await row({ favoriteSlot: null, bellSlot: null });
    expect(infoAction()).toBeTruthy();
    expect([...actionBar().children]).toHaveLength(1);
  });
});

/* ========================================================================
 * PRICES AND EDITIONS
 * ===================================================================== */

describe("the offer is dressed as an action", () => {
  /** The 44 px wrapper around `OfferLink` — the actual touch target. */
  const pill = (): HTMLElement => byId("offer").parentElement!;
  /** The visible chip: the inset layer the wrapper paints. */
  const chip = (): HTMLElement => pill().querySelector("[aria-hidden]")!;

  it("the target is 44 px and the visible chip is inset inside it", async () => {
    /* The operator allowed the two to differ. The ring is drawn 9 px in from
       the top and the bottom, so it reads as 26 px; the link fills the whole
       44 and is what a finger hits. */
    await row({ offered: true });
    expect(pill().className).toContain("min-h-11");
    expect(chip().className).toContain("absolute inset-x-0 inset-y-[10px]");
    expect(chip().className).toContain("pointer-events-none");
  });

  it("a figure with something to sell gets the silver action", async () => {
    await row({ offered: true });
    expect(chip().className).toContain("bg-trade-solid/12");
    expect(chip().className).toContain("ring-trade-line");
    expect(chip().className).toContain("group-hover:bg-trade-solid/22");
    expect(chip().className).toContain("group-focus-within:");
  });

  it("and one with nothing gets the quiet chip, with no hover promise", async () => {
    await row({ offered: false });
    expect(chip().className).toContain("bg-deep/40");
    expect(chip().className).not.toContain("group-hover:");
    expect(chip().className).not.toContain("trade-solid");
  });

  it("the chip hugs its label rather than stretching into a bar", async () => {
    await row({ offered: true });
    expect(pill().className).toContain("ml-auto");
    expect(pill().className).toContain("shrink-0");
    /* And it adds no padding of its own — `OfferLink` brings it. */
    expect(pill().className).not.toMatch(/\bpx-\d/);
  });

  it("and it is still a sibling of the toggle, not a child", async () => {
    await row({ offered: true });
    expect(toggle().contains(pill())).toBe(false);
  });

  it("the series shares that line where a surface asks for it", async () => {
    /* `/shop` mixes all six games, so the series is the one thing a row
       there cannot be assumed to share with its neighbours. */
    await row({ showSeries: true });
    expect(article().textContent).toContain("Spyro's Adventure");
  });

  it("and the catalogue, which has a series tab, does not repeat it", async () => {
    await row({ showSeries: false });
    expect(article().textContent).not.toContain("Spyro's Adventure");
  });

  it("a figure out of range says so instead of naming its game", async () => {
    await row({ showSeries: true, figure: figure({ isActive: false }) });
    expect(article().textContent).toContain(de.catalog.inactive);
    expect(article().textContent).not.toContain("Spyro's Adventure");
  });
});

describe("a special edition is a strip under the picture", () => {
  /** The white stage that holds the photograph. */
  const stage = (): HTMLElement => article().querySelector(".bg-plate")!;
  /** The column that holds the stage AND the edition strip (UX-01E). */
  const column = (): HTMLElement => stage().parentElement!;

  it("a standard figure gets none", async () => {
    await row({ figure: figure({ cardType: "standard" }) });
    expect(column().textContent).not.toMatch(/standard/i);
    /* Nothing is reserved for it either — the column is the stage alone. */
    expect(column().children).toHaveLength(1);
  });

  it("every other modelled type gets one, named from the label map", async () => {
    for (const [type, label] of [["legendary", "Legendary"], ["prestige", "Prestige"],
                                 ["chase", "Chase"], ["dark", "Dark"],
                                 ["special", "Special"], ["elite", "Elite"]] as const) {
      await row({ figure: figure({ cardType: type, types: [type],
                                   visibleType: type }) });
      expect(column().textContent, type).toContain(label);
      await act(async () => { root?.unmount(); });
      container?.remove();
    }
  });

  it("it sits BELOW the picture and overlays no artwork at all (UX-01E)", async () => {
    await row({ figure: figure({ cardType: "chase", types: ["chase"],
                                 visibleType: "chase", imageFile: "x.webp" }) });
    const strip = [...column().querySelectorAll("span")]
      .find((el) => el.textContent === "Chase")!;
    /* In flow, under the stage, the full width of the column. */
    expect(strip.className).not.toContain("absolute");
    expect(strip.className).toContain("block w-full");
    expect(strip.className).toContain("pointer-events-none");
    expect(stage().contains(strip), "not inside the stage any more").toBe(false);
    expect(column().contains(strip), "but still in the picture column").toBe(true);
    /* And it comes AFTER the stage, which is what "below" means here. */
    const parts = [...column().children];
    expect(parts.indexOf(stage())).toBeLessThan(parts.findIndex((el) => el.contains(strip) || el === strip));
  });

  it("and the picture is whole — not cropped, not shrunk, not dimmed", async () => {
    await row({ figure: figure({ cardType: "legendary", types: ["legendary"],
                                 visibleType: "legendary",
                                 imageFile: "x.webp" }) });
    /* The stage keeps its full square, with or without a strip beneath it. */
    expect(stage().className).toContain("h-16 w-16");
    expect(stage().className).toContain("sm:h-18 sm:w-18");
    const img = stage().querySelector("img")!;
    expect(img.className).toContain("h-full w-full object-contain");
    expect(img.className).not.toMatch(/opacity|saturate|grayscale|scale|brightness/);
  });

  it("the photograph is not touched by it", async () => {
    await row({ figure: figure({ cardType: "legendary", types: ["legendary"],
                                 visibleType: "legendary",
                                 imageFile: "x.webp" }) });
    const img = stage().querySelector("img")!;
    expect(img.className).not.toMatch(/opacity|saturate|grayscale|scale|brightness/);
    expect(img.style.filter).toBe("");
  });

  it("the two tiers come from EDITION_RANK, not from a new opinion", async () => {
    await row({ figure: figure({ cardType: "legendary", types: ["legendary"],
                                 visibleType: "legendary" }) });
    const bright = [...column().querySelectorAll("span")]
      .find((el) => el.textContent === "Legendary")!.className;
    await act(async () => { root?.unmount(); });
    container?.remove();
    await row({ figure: figure({ cardType: "chase", types: ["chase"],
                                 visibleType: "chase" }) });
    const quiet = [...column().querySelectorAll("span")]
      .find((el) => el.textContent === "Chase")!.className;
    expect(bright).not.toBe(quiet);
    expect(bright).toContain("#241f19");
    expect(quiet).toContain("#3a3442");
  });

  it("and the information area no longer carries an edition chip", async () => {
    await row({ figure: figure({ cardType: "prestige" }) });
    const text = article().querySelector(".flex-1")!;
    expect(text.textContent).not.toContain("Prestige");
  });
});

describe("the element is not on the tile at all", () => {
  it("no mark, no word, for a figure that HAS an element (UX-01E correction)", async () => {
    /*
     * The tile drew the element as an abstract rune — one shape in ten
     * colours, a placeholder because the project has no element artwork. At
     * the desktop review the operator asked for it to go for now, so the top
     * left is the figure's name alone.
     *
     * The element DATA is untouched and every other surface still names it;
     * `element-icon.test.ts` holds that, and the component remains as the
     * swap point for real files.
     */
    await row();
    expect(article().querySelector('[title="Erde"]'), "no element mark").toBeNull();
    expect(article().textContent, "and no element word").not.toContain("Erde");
    /* The only `title` left on the tile is the name's own full text. */
    const titled = [...article().querySelectorAll("[title]")]
      .map((el) => el.getAttribute("title"));
    /* The only `title` left on the tile is the name's own full text. The
       harness passes no bell here, so nothing else carries one. */
    expect(titled).toEqual(["Bash"]);
  });

  it("and nothing for the 457 figures without one either", async () => {
    await row({ figure: figure({ element: null }) });
    expect(article().textContent).not.toContain("Erde");
  });

  it("an unknown stored value renders nothing rather than a default", async () => {
    await row({ figure: { ...figure(), element: "Plasma" } as never });
    expect(article().textContent).not.toContain("Plasma");
  });

  it("it sits before the name, not after it", async () => {
    await row();
    const line = article().querySelector("div.items-center")!;
    const icon = line.querySelector('[title="Erde"]')!;
    const name = [...line.querySelectorAll("span")].find(
      (el) => el.textContent === "Bash");
    expect(name, "the name is on the first line").toBeTruthy();
    expect([...line.querySelectorAll("*")].indexOf(icon))
      .toBeLessThan([...line.querySelectorAll("*")].indexOf(name!));
  });
});

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
    /*
     * SEIT CAT-10 KOMMT DER NAME AUS `visibleType` und nicht aus
     * `cardType`: der eine ist das BANNER, der andere die KARTENKUNST der
     * senkrechten Karte. Die Zeile hat keine Kartenkunst zu zeigen — das ist
     * weiterhin der Grund, warum sie die Ausgabe BENENNT —, aber WELCHE sie
     * benennt, entscheidet jetzt die Auswahl des Administrators.
     */
    await row({ figure: figure({ cardType: "legendary", types: ["legendary"],
                                 visibleType: "legendary" }) });
    expect(article().textContent).toContain("Legendary");
  });

  it("und eine Figur MIT Kartenkunst, aber OHNE Auswahl zeigt keines", async () => {
    /*
     * DER UNTERSCHIED, DEN CAT-10 EINFUEHRT, als Test. `card_type` bleibt
     * `legendary` — die senkrechte Karte in Shop und Sammlung wird weiter
     * auf das Legendary-Artwork gedruckt —, aber die Kachel zeigt kein
     * Banner, solange niemand eines gewaehlt hat. Ein abgeleitetes Banner
     * waere eine Veraenderung des oeffentlichen Katalogs ohne Entscheidung
     * (Entscheidung D4).
     */
    await row({ figure: figure({ cardType: "legendary", types: ["legendary"],
                                 visibleType: null }) });
    expect(article().textContent).not.toContain("Legendary");
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
    expect(overlayLink().getAttribute("href")).toBe("/login?next=%2F");
    expect(article().querySelector("button:not([data-id])")).toBeNull();
  });

  it("and the offer is still its own target beside it", async () => {
    await row({ onToggle: undefined, href: "/login?next=%2F" });
    expect(overlayLink().contains(byId("offer"))).toBe(false);
  });

  it("the overlay names the figure, since its content is hidden text", async () => {
    await row({ onToggle: undefined, href: "/login?next=%2F" });
    expect(overlayLink().textContent).toContain("Bash");
  });
});
