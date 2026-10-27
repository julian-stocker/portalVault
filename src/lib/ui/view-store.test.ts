// @vitest-environment jsdom
/**
 * The remembered view choice, exercised against a real `localStorage`
 * (UX-01C, ADR-0148).
 *
 * WHY THIS IS A DOM TEST AND NOT A SOURCE READ. Four of the five promises in
 * `view-store.ts` are about what happens at runtime: that a stored value
 * survives, that an unknown one does not, that a throwing storage falls back
 * instead of taking the page down, and that another tab's write arrives. A
 * source read can see the `try`, not what it catches.
 *
 * The fifth — "the first client paint matches the server's" — is the one
 * thing no unit test can prove. What IS provable here is its precondition:
 * `server()` returns the fallback and never touches storage, so the server's
 * tree cannot depend on a value the server does not have. The remaining risk
 * is named in the report, not hidden.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createViewStore } from "@/lib/ui/view-store";

type Mode = "cards" | "rows";

const spec = { key: "test.view", values: ["cards", "rows"] as const, fallback: "cards" as Mode };

/** A fresh store per test: listener sets must not leak between cases. */
function store() {
  return createViewStore<Mode>(spec);
}

/** The real one, so a test that replaces it can put it back. */
const realStorage = window.localStorage;

function replaceStorage(fake: Storage) {
  Object.defineProperty(window, "localStorage", { value: fake, configurable: true });
}

beforeEach(() => {
  replaceStorage(realStorage);
  window.localStorage.clear();
});

afterEach(() => {
  replaceStorage(realStorage);
  window.localStorage.clear();
});

describe("what a store is", () => {
  it("carries its key, its values and its fallback", () => {
    const s = store();
    expect(s.key).toBe("test.view");
    expect(s.values).toEqual(["cards", "rows"]);
    expect(s.fallback).toBe("cards");
  });

  it("recognises only the values it was given", () => {
    const s = store();
    expect(s.is("cards")).toBe(true);
    expect(s.is("rows")).toBe(true);
    for (const wrong of ["table", "symbols", "", "CARDS", null, undefined, 3, {}]) {
      expect(s.is(wrong), String(wrong)).toBe(false);
    }
  });
});

describe("reading and writing", () => {
  it("falls back when nothing was ever stored", () => {
    expect(store().read()).toBe("cards");
  });

  it("keeps a remembered choice over the fallback", () => {
    const s = store();
    s.write("rows");
    expect(window.localStorage.getItem("test.view")).toBe("rows");
    expect(s.read()).toBe("rows");
  });

  it("and a second store on the same key sees it — that is what persistence is", () => {
    store().write("rows");
    expect(store().read()).toBe("rows");
  });

  it("ignores a stored value it does not know, instead of showing it", () => {
    /* A value from an older build, or from a renamed mode. Falling back is
       the only safe answer: the alternative is a mode nothing can draw. */
    window.localStorage.setItem("test.view", "table");
    expect(store().read()).toBe("cards");
  });

  it("survives a storage that throws on read", () => {
    replaceStorage({
      getItem: () => { throw new Error("blocked"); },
      setItem: () => {},
      removeItem: () => {}, clear: () => {}, key: () => null, length: 0,
    } as unknown as Storage);
    expect(() => store().read()).not.toThrow();
    expect(store().read()).toBe("cards");
  });

  it("and a storage that throws on write — the switch still answers", () => {
    const heard: string[] = [];
    replaceStorage({
      getItem: () => null,
      setItem: () => { throw new Error("quota"); },
      removeItem: () => {}, clear: () => {}, key: () => null, length: 0,
    } as unknown as Storage);
    const s = store();
    s.subscribe(() => heard.push("change"));
    expect(() => s.write("rows")).not.toThrow();
    /*
     * THE PART THAT MATTERS. A private window cannot remember the choice,
     * but the switch must still work for the length of the visit — so the
     * notification happens whether or not storage accepted the value.
     */
    expect(heard).toEqual(["change"]);
  });
});

describe("the server snapshot", () => {
  it("is the fallback, whatever a browser might remember", () => {
    /*
     * The precondition for a matching first paint: the server renders the
     * fallback, so the tree it produces cannot depend on storage.
     */
    const s = store();
    s.write("rows");
    expect(s.server()).toBe("cards");
    expect(s.server()).toBe(s.fallback);
  });

  it("and it reads no storage at all, so it cannot throw", () => {
    const get = vi.fn(() => "rows");
    replaceStorage({
      getItem: get, setItem: () => {},
      removeItem: () => {}, clear: () => {}, key: () => null, length: 0,
    } as unknown as Storage);
    expect(store().server()).toBe("cards");
    expect(get).not.toHaveBeenCalled();
  });
});

describe("subscribing", () => {
  it("hears this tab's own write", () => {
    const heard: string[] = [];
    const s = store();
    s.subscribe(() => heard.push(s.read()));
    s.write("rows");
    expect(heard).toEqual(["rows"]);
  });

  it("hears another tab through the storage event", () => {
    const heard: number[] = [];
    const s = store();
    s.subscribe(() => heard.push(1));
    window.dispatchEvent(new StorageEvent("storage", { key: "test.view" }));
    expect(heard).toHaveLength(1);
  });

  it("and a cleared storage, which concerns every key", () => {
    const heard: number[] = [];
    const s = store();
    s.subscribe(() => heard.push(1));
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    expect(heard).toHaveLength(1);
  });

  it("but not an unrelated key", () => {
    /* Otherwise every store in the page wakes on every write anywhere, and
       React is asked for a snapshot that has not changed. */
    const heard: number[] = [];
    const s = store();
    s.subscribe(() => heard.push(1));
    window.dispatchEvent(new StorageEvent("storage", { key: "something.else" }));
    expect(heard).toEqual([]);
  });

  it("stops hearing after unsubscribing, and removes its window listener", () => {
    const heard: number[] = [];
    const s = store();
    const off = s.subscribe(() => heard.push(1));
    s.write("rows");
    off();
    s.write("cards");
    window.dispatchEvent(new StorageEvent("storage", { key: "test.view" }));
    expect(heard).toHaveLength(1);
  });
});

describe("two stores never share state", () => {
  it("a write to one does not notify the other", () => {
    /*
     * THE WHOLE REASON THE LISTENER SET IS PER INSTANCE. The catalogue and
     * the collection answer different questions; if one woke the other,
     * React would re-render a view whose snapshot had not moved.
     */
    const catalogue = createViewStore<Mode>(spec);
    const other = createViewStore<"a" | "b">({
      key: "test.other", values: ["a", "b"] as const, fallback: "a",
    });
    const heard: string[] = [];
    catalogue.subscribe(() => heard.push("catalogue"));
    other.subscribe(() => heard.push("other"));

    catalogue.write("rows");
    expect(heard).toEqual(["catalogue"]);

    other.write("b");
    expect(heard).toEqual(["catalogue", "other"]);
  });

  it("and neither can read or overwrite the other's value", () => {
    const one = createViewStore<Mode>(spec);
    const two = createViewStore<Mode>({ ...spec, key: "test.two", fallback: "rows" });
    one.write("rows");
    two.write("cards");
    expect(one.read()).toBe("rows");
    expect(two.read()).toBe("cards");
    expect(window.localStorage.getItem("test.view")).toBe("rows");
    expect(window.localStorage.getItem("test.two")).toBe("cards");
  });
});
