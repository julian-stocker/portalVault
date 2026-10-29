/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { AvailabilityBell } from "@/components/catalog/availability-bell";
import { de } from "@/lib/i18n/de";
import { ROW, barWidth } from "@/lib/catalog/row-template";

/**
 * The prepared availability bell (UX-01E, ADR-0148).
 *
 * THE ONE THING THIS FILE EXISTS TO HOLD: the mark is visible, and it is
 * unmistakably not working. UX-02's chain is designed (ADR-0146, ADR-0147)
 * and migrations `0150`/`0151` are written, but they are applied nowhere —
 * `availability_alerts` does not exist on staging, which was checked. So
 * there is nothing to press, and nothing here may pretend otherwise.
 *
 * The second thing: UX-02 must not need a layout pass. The box is the final
 * 44 px now, so that day is one `disabled` away.
 */

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const code = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const SRC = read("src/components/catalog/availability-bell.tsx");
const CODE = code(SRC);
const HEART = read("src/components/catalog/favorite-heart.tsx");
const INFO = read("src/components/catalog/info-link.tsx");
const CARD = code(read("src/components/catalog/catalog-card.tsx"));

let root: Root | null = null;
let container: HTMLElement | null = null;

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  container?.remove();
  root = null;
  container = null;
});

async function render() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => { root!.render(createElement(AvailabilityBell)); });
  return container.querySelector("button")!;
}

describe("it is visibly there and unmistakably disabled", () => {
  it("a real disabled button, so no input mode can reach it", async () => {
    /*
     * `disabled` AND NOT A GREY SPAN. A span dressed to look dimmed would
     * LOOK disabled without being it: still clickable, still focusable, and
     * announced as nothing in particular. A disabled button is unreachable by
     * pointer, keyboard and assistive technology alike, and announces itself
     * as unavailable without any aria of its own.
     */
    const bell = await render();
    expect(bell.tagName).toBe("BUTTON");
    expect(bell.getAttribute("type")).toBe("button");
    expect(bell.disabled).toBe(true);
    /* Disabled buttons are not in the tab order — checked rather than
       assumed, because a `tabindex` would undo it. */
    expect(bell.getAttribute("tabindex")).toBeNull();
  });

  it("and it says what is coming, rather than looking broken", async () => {
    const bell = await render();
    expect(bell.getAttribute("title")).toBe(de.catalog.alarmPending);
    expect(bell.querySelector(".sr-only")?.textContent).toBe(de.catalog.alarmPending);
    expect(de.catalog.alarmPending).toBe("Benachrichtigungen folgen");
  });

  it("it pretends no alarm: no handler, no query, no state", () => {
    /*
     * "Prepare it visibly" is one small step from "wire it up quietly", so
     * the step is held by a test rather than by intention.
     */
    for (const forbidden of ["onClick", "onChange", "useState", "useEffect", "fetch(",
                             "@/lib/supabase", "rpc(", "availability_alerts",
                             "arm_", "'use client'", '"use client"']) {
      expect(CODE, `the bell contains ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("the glyph is drawn quietly and reads as inactive", async () => {
    const bell = await render();
    expect(bell.className).toContain("cursor-not-allowed");
    expect(bell.querySelector("span")!.className).toContain("text-muted/45");
    /* No hover response, because there is nothing to respond to. */
    expect(CODE).not.toContain("group-hover/bell:bg-");
  });
});

describe("UX-02 will need no layout pass", () => {
  it("the box is already the final 44 px, like the other two marks", async () => {
    const bell = await render();
    expect(bell.className).toContain("h-11 w-11");
    expect(ROW.touch).toBe(44);
  });

  it("and it is the same box, character for character, as heart and info", () => {
    /*
     * Three marks stand side by side in the bar now. Two drifting apart was
     * already worth a test at UX-01D; three is more so. Copied rather than
     * imported for the reason `EditionBanner` gives about the variant seal —
     * but copied text needs a test, or it is just text.
     */
    for (const shape of [
      "pointer-events-auto flex h-11 w-11 items-start justify-end",
      "grid place-items-center rounded-full p-1.5 transition-colors duration-150",
      "block h-[22px] w-[22px]",
    ]) {
      expect(SRC, `bell: ${shape}`).toContain(shape);
      expect(HEART, `heart: ${shape}`).toContain(shape);
      expect(INFO, `info: ${shape}`).toContain(shape);
    }
  });

  it("and the row's arithmetic already counts it at full size", () => {
    /*
     * THE ONE PLACE RESERVING IS HONEST: a number for a test to check, not a
     * hole on screen. With no bell the bar is two slots wide and that is all
     * that is drawn — but the day it works, nothing has to be recomputed.
     */
    expect(barWidth(true) - barWidth()).toBe(ROW.touch);
    expect(barWidth(true)).toBe(3 * ROW.touch);
  });
});

describe("it reaches the tile, and only the tile", () => {
  it("the card hands it to the row and never to FigureCard", () => {
    expect(CARD).toContain('const bell = accountType === "user" ? <AvailabilityBell /> : null;');
    /* Both row branches — signed in and signed out — and neither card one. */
    expect((CARD.match(/bellSlot=\{bell\}/g) ?? [])).toHaveLength(2);
    /* Each `<FigureCard …/>` element on its own, not everything after it:
       the row branch follows in the same file and would be swept in. */
    const cardElements = [...CARD.matchAll(/<FigureCard[\s\S]*?\/>/g)].map((m) => m[0]);
    expect(cardElements.length).toBeGreaterThanOrEqual(2);
    for (const element of cardElements) {
      expect(element, "the classic card must not get a bell")
        .not.toContain("bellSlot");
    }
  });

  it("and the row shows it only where there is nothing to buy", () => {
    /* The condition lives in `FigureRow` on `!offered` — one flag, inverted,
       no second rule. Held in detail by the row's own tests. */
    const rowCode = code(read("src/components/catalog/figure-row.tsx"));
    expect(rowCode).toContain("{!offered && bellSlot ?");
    /* And the card passes it unconditionally, so the row owns the rule. */
    expect(CARD).not.toContain("quickBuy ? null :");
    expect(CARD).not.toContain("offered ? undefined : bell");
  });
});
