/**
 * Which checkout field a validation problem belongs to.
 *
 * `de.checkout.errorInvalid` has always read "Bitte prüfe die **markierten**
 * Angaben", and until now nothing was marked: `validateDraft()` answers about
 * the draft as a whole — `incomplete_address` means "one of six fields is
 * blank" and says nothing about which. So the customer was handed nine inputs
 * and a sentence.
 *
 * THIS IS A MIRROR, NOT A SECOND RULE
 *
 * `validateDraft()` decides whether an order may be placed, and it keeps
 * deciding that alone. The blank test below is the same `blank()` it uses, and
 * it only ever runs on fields whose problem `validateDraft()` has already
 * reported. Nothing here can accept a draft the server refuses, or refuse one
 * the server accepts — the same relationship `canShip()` has with
 * `admin_mark_order_shipped()`.
 *
 * Deliberately no `required` attribute on the inputs either. Native validation
 * would replace these messages with a browser bubble in the browser's own
 * wording, and would gate submission before the one validator that matters
 * ever ran.
 */
import type { DraftProblem } from "@/lib/commerce/order";

/** Every field the checkout form renders that can carry an error. */
export type CheckoutField =
  | "email"
  | "firstName"
  | "lastName"
  | "street"
  | "houseNumber"
  | "postalCode"
  | "city";

/**
 * The six address fields `validateDraft()` requires, in the order they appear
 * on screen — which is also the order the focus rule follows.
 *
 * `company` and `addressLine2` are absent because they are optional, and they
 * are the two the form labels "(optional)".
 */
export const REQUIRED_ADDRESS_FIELDS = [
  "firstName",
  "lastName",
  "street",
  "houseNumber",
  "postalCode",
  "city",
] as const satisfies readonly CheckoutField[];

/** Screen order, email first: the form asks for contact before address. */
export const CHECKOUT_FIELD_ORDER = [
  "email",
  ...REQUIRED_ADDRESS_FIELDS,
] as const satisfies readonly CheckoutField[];

/** What the form holds. Only the fields that can be marked are read. */
export type CheckoutFieldValues = Partial<Record<CheckoutField, string>>;

/** Why one field is marked. Maps to a sentence in `de.checkout.fieldError`. */
export type FieldProblem = "required" | "email";

/** Same test `validateDraft()` uses — whitespace is not an entry. */
function blank(value: string | undefined): boolean {
  return typeof value !== "string" || value.trim() === "";
}

/**
 * The fields to mark, given what the server objected to and what is on screen.
 *
 * `incomplete_address` expands to every required address field that is blank —
 * which is exactly the set that made `validateDraft()` report it. A problem
 * that belongs to no field (`no_items`, `invalid_country`, …) contributes
 * nothing here and stays in the summary message above the button, because
 * there is no input it could point at.
 */
export function fieldProblems(
  problems: readonly DraftProblem[],
  values: CheckoutFieldValues,
): ReadonlyMap<CheckoutField, FieldProblem> {
  const marked = new Map<CheckoutField, FieldProblem>();

  if (problems.includes("invalid_email")) marked.set("email", "email");

  if (problems.includes("incomplete_address")) {
    for (const field of REQUIRED_ADDRESS_FIELDS) {
      if (blank(values[field])) marked.set(field, "required");
    }
  }

  return marked;
}

/**
 * Where the cursor goes, or null when nothing on screen is marked.
 *
 * Screen order rather than the order problems arrived in: the customer should
 * land on the first thing they can fix reading downwards, not on whichever
 * check happened to run first.
 */
export function firstMarkedField(
  marked: ReadonlyMap<CheckoutField, FieldProblem>,
): CheckoutField | null {
  return CHECKOUT_FIELD_ORDER.find((field) => marked.has(field)) ?? null;
}

/**
 * The problems that still belong in the summary above the button.
 *
 * Anything already shown at its own field is dropped: saying "Bitte fülle alle
 * Pflichtfelder aus" underneath six fields that each say "Bitte ausfüllen" is
 * the same instruction three times over.
 */
const FIELD_BOUND: ReadonlySet<DraftProblem> = new Set<DraftProblem>([
  "invalid_email",
  "incomplete_address",
]);

export function summaryProblems(problems: readonly DraftProblem[]): DraftProblem[] {
  return problems.filter((problem) => !FIELD_BOUND.has(problem));
}
