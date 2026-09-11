import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { REQUIRED_ADDRESS_FIELDS } from "@/lib/commerce/field-errors";

/**
 * The two things the checkout gained before the beta: fields that are actually
 * marked when they are wrong (F4), and a block that says who is selling, how
 * it ships and who takes the money (F2).
 *
 * The placing logic is `field-errors.ts` and is tested on its own. This is the
 * wiring — plus the guarantee that the rules underneath are untouched.
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

const VIEW = "src/components/checkout/checkout-view.tsx";
const ORDER = "src/lib/commerce/order.ts";
const ACTIONS = "src/lib/commerce/actions.ts";

const view = code(VIEW);

describe("every required field can be marked", () => {
  it("passes a problem to the e-mail field", () => {
    expect(view).toContain('problem={marked.get("email")}');
  });

  it("passes one to each required address field", () => {
    for (const field of REQUIRED_ADDRESS_FIELDS) {
      expect(view, `${field} is never marked`).toContain(`problem={marked.get("${field}")}`);
    }
  });

  it("marks by re-testing what is on screen, so a mark clears as you type", () => {
    expect(view).toContain("fieldProblems(problems, fields)");
  });
});

describe("a marked field is marked four ways", () => {
  it("announces itself", () => {
    expect(view).toContain("aria-invalid={problem ? true : undefined}");
    expect(view).toContain("aria-describedby={problem ? errorId : undefined}");
  });

  it("shows a ring and a sentence", () => {
    expect(view).toContain("className={problem ? FIELD_INVALID : FIELD}");
    expect(view).toContain("FIELD_MESSAGE[problem]");
  });

  it("takes the cursor to the first one, once per failed submit", () => {
    expect(view).toContain("firstMarkedField(marked)");
    expect(view).toContain("setFocusRequest((n) => n + 1)");
    expect(view).toContain("input.focus()");
  });

  /**
   * Native `required` would gate the submit before `validateDraft()` — the one
   * validator that decides — ever ran, and would replace these sentences with
   * a browser bubble in the browser's own wording.
   */
  it("does not add native required validation", () => {
    expect(view).not.toContain("required={true}");
    expect(view).not.toContain("required\n");
  });
});

describe("the summary stops repeating what the fields already say", () => {
  it("renders only the problems no field could point at", () => {
    expect(view).toContain("summaryProblems(problems)");
    expect(view).toContain("remainingProblems.map");
    expect(view).not.toContain("problems.map((problem) =>");
  });
});

describe("the trust block", () => {
  it("names the seller", () => {
    expect(view).toContain("copy.seller");
    expect(view).toContain("copy.sellerLabel");
  });

  it("names Stripe", () => {
    expect(view).toContain("copy.paymentValue");
    const trust = readFileSync("src/lib/i18n/de.ts", "utf8");
    expect(trust).toContain('paymentValue: "Stripe"');
  });

  it("shows the shipping the customer actually selected, never a figure of its own", () => {
    expect(view).toContain("copy.shippingValue(");
    // The amount comes from the quoted option, which came from
    // `shipping_quote()`. This component computes no money.
    expect(view).toContain("method.amount === 0 ? de.checkout.shippingFree : formatPrice(method.amount)");
  });

  /**
   * The legal texts do not exist, so the block says nothing about them. It
   * used to say they "werden vor der öffentlichen Beta ergänzt" — a note to
   * the developer, rendered into a paying customer's checkout.
   */
  it("says nothing about Widerruf and AGB, and links nowhere empty", () => {
    expect(view).not.toContain("legalPending");
    expect(view).not.toContain("legalLabel");
    for (const slug of ["/widerruf", "/agb", "/impressum", "/datenschutz", "/kontakt"]) {
      expect(view).not.toContain(slug);
    }
  });

  /**
   * No delivery time is defined anywhere in the product, so none is promised.
   * A number invented here would be the first thing SkyIsles is measured on.
   */
  it("promises no delivery time", () => {
    const copy = readFileSync("src/lib/i18n/de.ts", "utf8");
    const block = copy.slice(copy.indexOf("trust: {"), copy.indexOf("fieldError: {"));
    expect(block).not.toMatch(/Werktag|\d\s*[–-]\s*\d\s*Tag|innerhalb von \d/);
  });
});

describe("the rules underneath are untouched", () => {
  it("validateDraft still decides, and still reports the same problems", () => {
    const order = code(ORDER);
    expect(order).toContain('problems.push("incomplete_address")');
    expect(order).toContain('problems.push("invalid_email")');
    expect(order).toContain("export function validateDraft");
  });

  it("placeOrder still validates server-side before calling create_order", () => {
    const actions = code(ACTIONS);
    expect(actions).toContain("const problems = validateDraft(draft);");
    expect(actions).toContain('if (problems.length > 0) return { ok: false, reason: "invalid", problems };');
  });

  it("the payable button still carries the legally required label", () => {
    expect(view).toContain("de.checkout.submit");
    const copy = readFileSync("src/lib/i18n/de.ts", "utf8");
    expect(copy).toContain('submit: "Zahlungspflichtig bestellen"');
  });
});
