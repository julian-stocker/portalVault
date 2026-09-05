import { describe, expect, it } from "vitest";

import {
  DEFAULT_VIEW_MODE,
  VIEW_MODES,
  isViewMode,
} from "@/components/collection/view-mode";

describe("the collection view mode", () => {
  it("offers exactly two ways to look at a collection", () => {
    expect(VIEW_MODES).toEqual(["symbols", "table"]);
  });

  // V4.2: a large collection is read before it is browsed, so the table is
  // what opens. The cards are one click and one stored preference away.
  it("starts on the table", () => {
    expect(DEFAULT_VIEW_MODE).toBe("table");
  });

  // The default may not quietly overrule someone who chose the cards: the
  // stored value wins whenever it is one this build knows.
  it("keeps a remembered choice over the default", async () => {
    const { readViewMode } = await import("@/components/collection/view-mode");
    const store = new Map<string, string>([["skyisles.collection.view", "symbols"]]);
    const original = globalThis.window;
    Object.defineProperty(globalThis, "window", {
      value: { localStorage: { getItem: (key: string) => store.get(key) ?? null } },
      configurable: true,
      writable: true,
    });
    try {
      expect(readViewMode()).toBe("symbols");
    } finally {
      if (original === undefined) delete (globalThis as { window?: unknown }).window;
      else Object.defineProperty(globalThis, "window", { value: original, configurable: true });
    }
  });

  it("accepts only the two it knows", () => {
    expect(isViewMode("symbols")).toBe(true);
    expect(isViewMode("table")).toBe(true);
    for (const value of ["grid", "", null, undefined, 1, {}]) {
      expect(isViewMode(value), String(value)).toBe(false);
    }
  });
});

describe("the stored choice cannot break the first paint", () => {
  it("gives the server the default, whatever a browser might remember", async () => {
    const { serverViewMode } = await import("@/components/collection/view-mode");
    expect(serverViewMode()).toBe(DEFAULT_VIEW_MODE);
  });

  it("falls back to the default when storage is unreadable", async () => {
    const { readViewMode } = await import("@/components/collection/view-mode");
    // No `window` in this environment at all — the same shape of failure as
    // private mode or storage disabled by policy.
    expect(readViewMode()).toBe(DEFAULT_VIEW_MODE);
  });
});
