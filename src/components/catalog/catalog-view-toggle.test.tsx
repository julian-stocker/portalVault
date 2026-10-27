// @vitest-environment jsdom
/**
 * THE SWITCH, ACTUALLY CLICKED — AND ACTUALLY HYDRATED (UX-01C, ADR-0148).
 *
 * Two promises of this step cannot be read out of the source, and one of them
 * is the one that breaks silently in production:
 *
 *   1. "the view changes without a reload" — a source read sees a handler,
 *      not whether React re-rendered with the new value
 *   2. "KEIN HYDRATION-MISMATCH" — this is a property of two renders agreeing,
 *      so proving it needs both renders. The server markup is produced here
 *      with `renderToString` while storage says something else, then hydrated
 *      with `hydrateRoot`, and React's own console warning is the assertion.
 *      That is the closest a test gets to the browser's verdict.
 *
 * The harness below is deliberately the same three lines both views use
 * (`useSyncExternalStore(subscribe, read, server)`), so what is proved here
 * is what runs on `/`, `/favoriten` and `/shop`.
 */
import { act, createElement, useSyncExternalStore } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { catalogViewStore, layoutFor } from "@/components/catalog/catalog-view-mode";
import { CatalogViewToggle } from "@/components/catalog/catalog-view-toggle";
import { de } from "@/lib/i18n/de";

/* ------------------------------------------------------------------ harness */

/** Exactly what `CatalogView` and `ShopView` do, and nothing more. */
function Harness() {
  const view = useSyncExternalStore(
    catalogViewStore.subscribe,
    catalogViewStore.read,
    catalogViewStore.server,
  );
  return createElement(
    "div",
    null,
    createElement("span", { "data-view": view, "data-layout": layoutFor(view) }, view),
    createElement(CatalogViewToggle, { view, onSelect: catalogViewStore.write }),
  );
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function fresh() {
  container = document.createElement("div");
  document.body.appendChild(container);
  return container;
}

async function mount(node: React.ReactNode) {
  root = createRoot(fresh());
  await act(async () => { root!.render(node); });
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

const button = (label: string): HTMLElement => {
  const found = [...document.querySelectorAll("button")]
    .find((b) => b.textContent?.includes(label));
  if (!found) throw new Error(`no button "${label}"`);
  return found;
};

const state = (): string | null =>
  document.querySelector("[data-view]")?.getAttribute("data-view") ?? null;

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  container?.remove();
  root = null;
  container = null;
  window.localStorage.clear();
});

/* ========================================================================
 * THE CONTROL
 * ===================================================================== */

describe("the switch is two buttons with a pressed state", () => {
  it("names the group and both options", async () => {
    await mount(createElement(CatalogViewToggle, { view: "cards", onSelect: () => {} }));
    const group = document.querySelector('[role="group"]');
    expect(group?.getAttribute("aria-label")).toBe(de.catalog.viewLabel);
    expect(button(de.catalog.view.cards)).toBeTruthy();
    expect(button(de.catalog.view.rows)).toBeTruthy();
  });

  it("exactly one is pressed, and it is the one on screen", async () => {
    await mount(createElement(CatalogViewToggle, { view: "rows", onSelect: () => {} }));
    expect(button(de.catalog.view.rows).getAttribute("aria-pressed")).toBe("true");
    expect(button(de.catalog.view.cards).getAttribute("aria-pressed")).toBe("false");
    const pressed = [...document.querySelectorAll('[aria-pressed="true"]')];
    expect(pressed).toHaveLength(1);
  });

  it("reports the option that was pressed, not a toggle", async () => {
    /* End state, like every other control in this product (ADR-0027):
       pressing "Karten" twice means cards twice, not cards then rows. */
    const chosen: string[] = [];
    await mount(createElement(CatalogViewToggle, {
      view: "cards", onSelect: (v: "cards" | "rows") => chosen.push(v),
    }));
    await click(button(de.catalog.view.rows));
    await click(button(de.catalog.view.rows));
    await click(button(de.catalog.view.cards));
    expect(chosen).toEqual(["rows", "rows", "cards"]);
  });
});

/* ========================================================================
 * SWITCHING, WITHOUT A RELOAD
 * ===================================================================== */

describe("switching redraws in place", () => {
  it("a click changes the rendered view in the same tree", async () => {
    await mount(createElement(Harness));
    expect(state()).toBe("cards");
    await click(button(de.catalog.view.rows));
    expect(state()).toBe("rows");
    expect(document.querySelector("[data-layout]")?.getAttribute("data-layout")).toBe("row");
  });

  it("and remembers it, so the next visit opens on the list", async () => {
    await mount(createElement(Harness));
    await click(button(de.catalog.view.rows));
    expect(window.localStorage.getItem("skyisles.catalog.view")).toBe("rows");

    /* A second mount stands for the next page load. */
    await act(async () => { root?.unmount(); });
    container?.remove();
    await mount(createElement(Harness));
    expect(state()).toBe("rows");
  });

  it("back to cards, and the remembered value follows", async () => {
    window.localStorage.setItem("skyisles.catalog.view", "rows");
    await mount(createElement(Harness));
    expect(state()).toBe("rows");
    await click(button(de.catalog.view.cards));
    expect(state()).toBe("cards");
    expect(window.localStorage.getItem("skyisles.catalog.view")).toBe("cards");
  });

  it("another tab's choice arrives without a reload", async () => {
    await mount(createElement(Harness));
    expect(state()).toBe("cards");
    /* What the browser does when a second tab writes the key. */
    window.localStorage.setItem("skyisles.catalog.view", "rows");
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: "skyisles.catalog.view" }));
    });
    expect(state()).toBe("rows");
  });

  it("an unrelated key does not disturb it", async () => {
    await mount(createElement(Harness));
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: "skyisles.collection.view" }));
    });
    expect(state()).toBe("cards");
  });
});

/* ========================================================================
 * HYDRATION — THE PROMISE THAT BREAKS SILENTLY
 * ===================================================================== */

describe("the first client paint matches the server's", () => {
  it("hydrates without a mismatch although storage says something else", async () => {
    /*
     * THE CASE THAT WOULD FAIL WITH A `useEffect` + `setState`, AND WITH A
     * PLAIN `localStorage` READ DURING RENDER.
     *
     * The server has no storage, so it renders the fallback. The browser has
     * "rows" in storage. If the first client render read storage, React
     * would be handed a different tree than the HTML it is hydrating and
     * would warn — which is exactly what `useSyncExternalStore`'s third
     * argument prevents: the first render uses the SERVER snapshot, then the
     * store's value is swapped in.
     */
    const html = renderToString(createElement(Harness));
    expect(html, "the server renders the fallback").toContain('data-view="cards"');

    window.localStorage.setItem("skyisles.catalog.view", "rows");

    const target = fresh();
    target.innerHTML = html;

    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    });
    try {
      await act(async () => { root = hydrateRoot(target, createElement(Harness)); });
    } finally {
      spy.mockRestore();
    }

    const complaints = errors.filter((e) => /hydrat|did not match|mismatch/i.test(e));
    expect(complaints, `React complained: ${complaints.join(" | ")}`).toEqual([]);

    /* And it did not merely stay silent — it arrived at the stored value. */
    expect(state()).toBe("rows");
  });

  it("the server snapshot never reads storage, which is what makes that safe", async () => {
    window.localStorage.setItem("skyisles.catalog.view", "rows");
    const html = renderToString(createElement(Harness));
    expect(html).toContain('data-view="cards"');
    expect(html).not.toContain('data-view="rows"');
  });

  it("and an unreadable storage hydrates to the fallback instead of throwing", async () => {
    const real = window.localStorage;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: () => { throw new Error("blocked"); },
        setItem: () => {}, removeItem: () => {}, clear: () => {},
        key: () => null, length: 0,
      },
    });
    try {
      const html = renderToString(createElement(Harness));
      const target = fresh();
      target.innerHTML = html;
      await act(async () => { root = hydrateRoot(target, createElement(Harness)); });
      expect(state()).toBe("cards");
    } finally {
      Object.defineProperty(window, "localStorage", { configurable: true, value: real });
    }
  });
});
