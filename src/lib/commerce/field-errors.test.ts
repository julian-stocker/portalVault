import { describe, expect, it } from "vitest";

import {
  CHECKOUT_FIELD_ORDER,
  REQUIRED_ADDRESS_FIELDS,
  fieldProblems,
  firstMarkedField,
  summaryProblems,
  type CheckoutFieldValues,
} from "@/lib/commerce/field-errors";
import { validateDraft, type DraftProblem, type OrderDraft } from "@/lib/commerce/order";
import { DEFAULT_SHIPPING_METHOD, DELIVERY_COUNTRY } from "@/lib/commerce/shipping";

const FILLED: CheckoutFieldValues = {
  email: "sammler@example.com",
  firstName: "Ada",
  lastName: "Lovelace",
  street: "Hauptstraße",
  houseNumber: "7",
  postalCode: "10115",
  city: "Berlin",
};

describe("fieldProblems", () => {
  it("marks nothing when there are no problems", () => {
    expect(fieldProblems([], FILLED).size).toBe(0);
  });

  it("marks the e-mail field for invalid_email", () => {
    const marked = fieldProblems(["invalid_email"], { ...FILLED, email: "keine-adresse" });
    expect(marked.get("email")).toBe("email");
    expect(marked.size).toBe(1);
  });

  it("marks only the address fields that are actually blank", () => {
    const marked = fieldProblems(["incomplete_address"], {
      ...FILLED,
      street: "",
      city: "   ",
    });
    expect([...marked.keys()].sort()).toEqual(["city", "street"]);
    expect(marked.get("street")).toBe("required");
  });

  it("treats whitespace as blank, exactly as validateDraft does", () => {
    const marked = fieldProblems(["incomplete_address"], { ...FILLED, lastName: "\t \n" });
    expect(marked.has("lastName")).toBe(true);
  });

  it("never marks the optional fields", () => {
    const marked = fieldProblems(["incomplete_address"], {});
    // `company` and `addressLine2` are not CheckoutFields at all, so the six
    // required ones are the most that can ever be marked from an address.
    expect(marked.size).toBe(REQUIRED_ADDRESS_FIELDS.length);
  });

  it("ignores problems that belong to no field", () => {
    const problems: DraftProblem[] = [
      "no_items",
      "too_many_items",
      "invalid_item",
      "invalid_quantity",
      "duplicate_item",
      "invalid_country",
      "invalid_shipping_method",
    ];
    expect(fieldProblems(problems, {}).size).toBe(0);
  });
});

describe("firstMarkedField", () => {
  it("returns null when nothing is marked", () => {
    expect(firstMarkedField(new Map())).toBeNull();
  });

  it("follows screen order, not the order problems arrived in", () => {
    const marked = fieldProblems(["incomplete_address", "invalid_email"], {
      email: "",
      city: "",
      firstName: "",
    });
    expect(firstMarkedField(marked)).toBe("email");
  });

  it("picks the topmost address field when the e-mail is fine", () => {
    const marked = fieldProblems(["incomplete_address"], {
      ...FILLED,
      city: "",
      lastName: "",
    });
    expect(firstMarkedField(marked)).toBe("lastName");
  });

  it("orders email before every address field", () => {
    expect(CHECKOUT_FIELD_ORDER[0]).toBe("email");
    expect([...CHECKOUT_FIELD_ORDER].slice(1)).toEqual([...REQUIRED_ADDRESS_FIELDS]);
  });
});

describe("summaryProblems", () => {
  it("drops what is already shown at a field", () => {
    expect(summaryProblems(["invalid_email", "incomplete_address"])).toEqual([]);
  });

  it("keeps what no field could point at", () => {
    expect(summaryProblems(["invalid_email", "no_items", "invalid_country"])).toEqual([
      "no_items",
      "invalid_country",
    ]);
  });
});

/**
 * The point of the mirror: every problem `validateDraft()` can report about a
 * field is one this module knows how to place.
 */
describe("agreement with validateDraft", () => {
  const draft = (over: Partial<OrderDraft> = {}): OrderDraft => ({
    email: "sammler@example.com",
    items: [{ skyId: "SKY-0042", condition: "loose", quantity: 1 }],
    address: {
      firstName: "Ada",
      lastName: "Lovelace",
      street: "Hauptstraße",
      houseNumber: "7",
      postalCode: "10115",
      city: "Berlin",
      countryCode: DELIVERY_COUNTRY,
    },
    shippingMethod: DEFAULT_SHIPPING_METHOD,
    ...over,
  });

  it("marks nothing for a draft the validator accepts", () => {
    const problems = validateDraft(draft());
    expect(problems).toEqual([]);
    expect(fieldProblems(problems, FILLED).size).toBe(0);
  });

  it("marks every blank field the validator complained about", () => {
    const values: CheckoutFieldValues = { ...FILLED, firstName: "", postalCode: "" };
    const problems = validateDraft(
      draft({
        address: {
          firstName: "",
          lastName: "Lovelace",
          street: "Hauptstraße",
          houseNumber: "7",
          postalCode: "",
          city: "Berlin",
          countryCode: DELIVERY_COUNTRY,
        },
      }),
    );

    expect(problems).toContain("incomplete_address");
    const marked = fieldProblems(problems, values);
    expect([...marked.keys()].sort()).toEqual(["firstName", "postalCode"]);
  });

  it("marks the e-mail the validator rejected", () => {
    const problems = validateDraft(draft({ email: "nicht gültig" }));
    expect(problems).toContain("invalid_email");
    expect(fieldProblems(problems, { ...FILLED, email: "nicht gültig" }).get("email")).toBe(
      "email",
    );
  });

  /**
   * A marking that cannot be cleared would trap the customer in a loop: the
   * form says "fix this", they fix it, and the mark stays.
   */
  it("clears once the fields are filled in", () => {
    const problems: DraftProblem[] = ["incomplete_address"];
    expect(fieldProblems(problems, FILLED).size).toBe(0);
  });
});
