/**
 * When a purchase date is acceptable — the SAME window the database enforces.
 *
 * WHY THIS IS ITS OWN FILE. The rule lives in three places that must agree:
 * the form (so the operator sees a red field instead of a server error), the
 * server action (so a request that skips the form is refused too), and
 * `seller_create_purchase_with_items` (so nothing but the database is trusted).
 * A rule copied into three files is a rule that drifts; this is the one the
 * first two import, and `purchase-date-rule.test.ts` pins it against the SQL.
 *
 * WHAT IT DOES NOT DO. It says nothing about EXISTING purchases. `0058` made
 * `purchases.purchased_at` nullable on purpose — thirteen `#REF!` groups of
 * the workbook carry no date, and inventing one would be worse than having
 * none. Those rows stay, stay findable under `?jahr=ohne`, and stay
 * correctable. This rule applies to creating a regular purchase and to
 * nothing else.
 */

/** The first Skylanders release. Before it there was nothing to buy. */
export const EARLIEST_PURCHASE_DATE = "2011-01-01";

/**
 * Why a date was refused, or `null` when it is fine.
 *
 * Two reasons and not one: "you forgot it" and "that cannot be a date" are
 * different mistakes, and the operator fixes them differently.
 */
export type PurchaseDateProblem = "required" | "invalid";

/** Today in ISO form, local time — the same day the operator sees. */
function isoToday(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Is this string a real calendar day?
 *
 * `new Date("2026-02-31")` does not throw — it rolls over to March 3rd. So the
 * parsed date is formatted back and compared: a day that survives the round
 * trip existed, a day that moved did not.
 */
function isCalendarDate(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.toISOString().slice(0, 10) === iso;
}

/**
 * Check a purchase date the way the database will.
 *
 * ISO strings compare lexicographically in date order, so no arithmetic is
 * needed for the window — and none is wanted: a `Date` subtraction would drag
 * time zones into a question that is about calendar days.
 */
export function purchaseDateProblem(
  raw: string | null | undefined,
  now: Date = new Date(),
): PurchaseDateProblem | null {
  const value = (raw ?? "").trim();
  if (value === "") return "required";
  if (!isCalendarDate(value)) return "invalid";
  /*
   * The typo this window exists for is `0202-03-14`: a formally valid date
   * that would put a purchase in the third century and wreck every yearly
   * total. A date in the future is the other half of the same mistake.
   */
  if (value < EARLIEST_PURCHASE_DATE) return "invalid";
  if (value > isoToday(now)) return "invalid";
  return null;
}
