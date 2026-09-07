/**
 * An order, as the application knows it.
 *
 * Deliberately thin. The rules that must hold — what something costs, whether
 * it may be sold, whether there is enough of it — all live in the database
 * (migration 0010), because they are the rules a browser must not be able to
 * influence. What lives here is the vocabulary, and the validation of a draft
 * before it is worth a round trip.
 *
 * WHAT THE CLIENT MAY SAY, AND WHAT IT MAY NOT
 *
 * A checkout draft carries **what somebody wants**: which article, in which
 * condition, how many, and where to send it. It carries no prices, no totals,
 * no discounts and no claim about stock. `create_order()` reads every one of
 * those from the database, and an order created from a draft that claimed a
 * figure costs one cent is an order at the real price.
 *
 * Nothing here reserves anything or touches storage. The cart stays local and
 * non-binding (ADR-0043); reserving begins at checkout, in SQL.
 */
import { MAX_LINE_QUANTITY } from "@/lib/cart/cart";
import { isOfferCondition, type OfferCondition } from "@/lib/shop/offer";

/**
 * The two axes, mirrored from the CHECK constraints in 0010.
 *
 * `src/lib/commerce/schema.test.ts` reads the migration and fails if either
 * list drifts from the database — the same coupling `non_collectible_categories()`
 * has with `collectible.ts`.
 */
export const PAYMENT_STATUSES = [
  "pending",
  "paid",
  "failed",
  "expired",
  "cancelled",
  "refunded",
  "partially_refunded",
] as const;

export const FULFILLMENT_STATUSES = [
  "unfulfilled",
  "preparing",
  "shipped",
  "completed",
  "cancelled",
] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export type FulfillmentStatus = (typeof FULFILLMENT_STATUSES)[number];

/** One article somebody wants. No money: the server decides that. */
export type DraftItem = {
  skyId: string;
  condition: OfferCondition;
  quantity: number;
};

/** Where it goes. A snapshot, never a link to an editable profile address. */
export type DraftAddress = {
  firstName: string;
  lastName: string;
  company?: string;
  street: string;
  houseNumber: string;
  addressLine2?: string;
  postalCode: string;
  city: string;
  /** ISO-3166 alpha-2. Deliberately **not** checked against a country list. */
  countryCode: string;
  phone?: string;
};

export type OrderDraft = {
  email: string;
  items: readonly DraftItem[];
  address: DraftAddress;
};

/**
 * Why a draft cannot become an order.
 *
 * One reason per problem, and all of them are about the shape of the request.
 * Whether an article is actually purchasable is not decided here — that answer
 * belongs to the database and arrives from `create_order()`.
 */
export type DraftProblem =
  | "no_items"
  | "too_many_items"
  | "invalid_item"
  | "invalid_quantity"
  | "duplicate_item"
  | "invalid_email"
  | "incomplete_address"
  | "invalid_country";

const SKY_ID = /^SKY-[0-9]{4}$/;

/** Deliberately loose. Address syntax is not a useful gate; delivery is. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const COUNTRY = /^[A-Za-z]{2}$/;

/** A basket nobody legitimately fills. Guards the JSON payload, not stock. */
export const MAX_ORDER_ITEMS = 50;

function blank(value: string | undefined): boolean {
  return typeof value !== "string" || value.trim() === "";
}

/**
 * Everything wrong with a draft, in one pass.
 *
 * Returns a list rather than throwing on the first problem: a checkout form
 * that reports one error at a time is a form people abandon.
 */
export function validateDraft(draft: OrderDraft): DraftProblem[] {
  const problems: DraftProblem[] = [];

  if (!EMAIL.test(draft.email ?? "")) problems.push("invalid_email");

  if (!Array.isArray(draft.items) || draft.items.length === 0) {
    problems.push("no_items");
  } else {
    if (draft.items.length > MAX_ORDER_ITEMS) problems.push("too_many_items");

    const seen = new Set<string>();
    for (const item of draft.items) {
      if (!SKY_ID.test(item?.skyId ?? "") || !isOfferCondition(item?.condition)) {
        problems.push("invalid_item");
        continue;
      }
      if (
        !Number.isInteger(item.quantity) ||
        item.quantity < 1 ||
        item.quantity > MAX_LINE_QUANTITY
      ) {
        problems.push("invalid_quantity");
      }
      // The cart's own identity rule (ADR-0043). Two lines for one article
      // could never be reconciled against one reservation.
      const key = `${item.skyId}/${item.condition}`;
      if (seen.has(key)) problems.push("duplicate_item");
      seen.add(key);
    }
  }

  const address = draft.address;
  if (
    !address ||
    blank(address.firstName) ||
    blank(address.lastName) ||
    blank(address.street) ||
    blank(address.houseNumber) ||
    blank(address.postalCode) ||
    blank(address.city)
  ) {
    problems.push("incomplete_address");
  }
  if (!address || !COUNTRY.test(address.countryCode ?? "")) {
    problems.push("invalid_country");
  }

  // One entry per problem, however many items triggered it.
  return [...new Set(problems)];
}

/**
 * The draft as `create_order()` wants it.
 *
 * Snake case and nothing else: the payload is a statement of intent, and
 * every field it does not carry is a field the server decides. If a price ever
 * appears in this function, something has gone wrong.
 */
export function draftPayload(draft: OrderDraft): {
  p_email: string;
  p_items: { sky_id: string; condition: string; quantity: number }[];
  p_address: Record<string, string | null>;
} {
  return {
    p_email: draft.email.trim(),
    p_items: draft.items.map((item) => ({
      sky_id: item.skyId,
      condition: item.condition,
      quantity: item.quantity,
    })),
    p_address: {
      first_name: draft.address.firstName.trim(),
      last_name: draft.address.lastName.trim(),
      company: draft.address.company?.trim() || null,
      street: draft.address.street.trim(),
      house_number: draft.address.houseNumber.trim(),
      address_line_2: draft.address.addressLine2?.trim() || null,
      postal_code: draft.address.postalCode.trim(),
      city: draft.address.city.trim(),
      country_code: draft.address.countryCode.trim().toUpperCase(),
      phone: draft.address.phone?.trim() || null,
    },
  };
}
