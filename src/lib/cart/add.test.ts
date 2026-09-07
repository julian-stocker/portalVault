import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { decideAdd, wantedQuantity, type AddArticle } from "@/lib/cart/add";
import { de } from "@/lib/i18n/de";

/**
 * Adding one more (V11).
 *
 * The rules live in `decideAdd`, which is pure: given the server's verdict
 * and what the cart already holds, what happens and what is said. The hook
 * around it only reads the store, awaits the server and writes.
 */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith("*") && !trimmed.startsWith("//") && !trimmed.startsWith("/*");
    })
    .join("\n");
}

const HOOK = "src/components/cart/use-add-to-cart.ts";

const BASH: AddArticle = { name: "Bash", condition: "loose", price: 4.49 };

describe("the quantity that is asked about", () => {
  it("is the total the line would reach, not the increment", () => {
    expect(wantedQuantity(0)).toBe(1);
    expect(wantedQuantity(2)).toBe(3);
  });
});

describe("when the server allows it", () => {
  it("adds, and calls a new line new", () => {
    const decision = decideAdd("allowed", BASH, 0);
    expect(decision.add).toBe(true);
    expect(decision.toast).toEqual({
      kind: "added",
      name: "Bash",
      condition: "loose",
      price: 4.49,
    });
  });

  it("adds, and calls an existing line increased", () => {
    const decision = decideAdd("allowed", BASH, 1);
    expect(decision.add).toBe(true);
    expect(decision.toast).toEqual({
      kind: "increased",
      name: "Bash",
      condition: "loose",
      quantity: 2,
    });
  });

  it("reports the quantity the line has reached", () => {
    const decision = decideAdd("allowed", BASH, 4);
    expect(decision.toast).toMatchObject({ kind: "increased", quantity: 5 });
  });
});

describe("when the server refuses", () => {
  it("does not add", () => {
    expect(decideAdd("denied", BASH, 2).add).toBe(false);
  });

  it("says so without naming a number", () => {
    const { toast } = decideAdd("denied", BASH, 2);
    expect(toast).toEqual({ kind: "denied" });
    // The type gives a refusal nowhere to put a count; this is the value
    // saying the same thing.
    expect(Object.keys(toast)).toEqual(["kind"]);
  });
});

describe("when the check could not be made", () => {
  it("does not add — an unverified increase does not happen", () => {
    expect(decideAdd("unchecked", BASH, 0).add).toBe(false);
    expect(decideAdd("unchecked", BASH, 3).add).toBe(false);
  });

  it("is a different sentence from a refusal", () => {
    expect(decideAdd("unchecked", BASH, 0).toast).toEqual({ kind: "unchecked" });
    expect(de.shop.toastUnchecked).not.toBe(de.shop.toastDenied);
  });

  it("claims nothing about stock", () => {
    for (const text of [de.shop.toastDenied, de.shop.toastUnchecked]) {
      expect(text).not.toMatch(/\d/);
      expect(text).not.toMatch(/reserv|zurückgelegt|garantiert|Lager|Bestand/i);
    }
  });
});

describe("only one verdict ever grows the cart", () => {
  it("is 'allowed', and nothing else", () => {
    const verdicts = ["allowed", "denied", "unchecked"] as const;
    const adding = verdicts.filter((verdict) => decideAdd(verdict, BASH, 0).add);
    expect(adding).toEqual(["allowed"]);
  });
});

describe("the hook around it", () => {
  const hook = code(HOOK);

  it("asks the server before it writes", () => {
    const asked = hook.indexOf("await checkCartQuantity");
    const written = hook.indexOf("if (decision.add) add(article);");
    expect(asked).toBeGreaterThan(-1);
    expect(written).toBeGreaterThan(asked);
  });

  it("guards a trigger against its own second tap", () => {
    // A ref, checked and set before the first await: a useState guard would
    // still read `false` for a tap in the same frame.
    expect(hook).toContain("const busy = useRef(false);");
    expect(hook).toContain("if (busy.current) return;");
    expect(hook).toContain("busy.current = true;");
    const guard = hook.indexOf("if (busy.current) return;");
    expect(guard).toBeLessThan(hook.indexOf("await checkCartQuantity"));
  });

  it("releases the guard however the attempt ends", () => {
    expect(hook).toContain("} finally {");
    expect(hook).toContain("busy.current = false;");
  });

  it("makes no decisions of its own", () => {
    // Every branch is in decideAdd. The hook must not grow a second copy.
    expect(hook).toContain("decideAdd(verdict, article, held)");
    expect(hook).not.toContain('kind: "denied"');
    expect(hook).not.toContain('kind: "added"');
  });

  it("reserves nothing and writes no table", () => {
    expect(hook).not.toMatch(/reserv/i);
    expect(hook).not.toMatch(/\border\b|checkout/i);
  });
});

describe("all three add surfaces go through it", () => {
  it("the catalog pill, the figure page and the cart's plus", () => {
    for (const path of [
      "src/components/shop/shop-action.tsx",
      "src/components/shop/offer-panel.tsx",
      "src/components/cart/cart-view.tsx",
    ]) {
      expect(code(path)).toContain("useAddToCart()");
    }
  });

  it("and none of them still adds without asking", () => {
    for (const path of [
      "src/components/shop/shop-action.tsx",
      "src/components/shop/offer-panel.tsx",
    ]) {
      const source = code(path);
      expect(source).not.toContain("showCartToast");
      expect(source).not.toMatch(/\badd\(\{/);
    }
  });
});
