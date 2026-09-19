/**
 * The two Orderbuch classifications (0063).
 *
 * The Orderbuch now sorts a record along three independent axes, and the only
 * way to keep them independent is to say so in one place:
 *
 *   CHANNEL         Intern / Extern — where the sale happened. `sales-view.ts`.
 *   CLASSIFICATION  Test or not — whether the record is real business.
 *   COMPLETENESS    Unvollständig — whether the RECORD is missing something.
 *   ACTION          Offen — whether a physical booking is still owed (0066).
 *
 * The last two are the pair most easily confused, so: a sale can be complete
 * to the cent and still be open because nothing has left the shelf, and an
 * incomplete one can have nothing left to book. `is_open` asks exactly what
 * `seller_book_*_item` would accept, so the filter never promises an action
 * the database would refuse — imported records are therefore never open.
 *
 * A test sale is still an external sale. An incomplete record is still a real
 * one. A test record may also be incomplete — sale 312 on Staging is exactly
 * that — and nothing here forces the two into one enum.
 *
 * WHERE EACH ANSWER COMES FROM
 *
 * `isTest` is a stored boolean for a hand-made purchase or external sale and a
 * derivation from `orders.commerce_mode` for an internal one; the database
 * decides which, in `sale_is_test()`, and hands the screen one answer.
 *
 * `isIncomplete` is derived from the row's current state on every read and
 * stored nowhere — see the rules at the head of `0063`. A purchase that gets
 * its date leaves the class by itself; a stored flag would have needed
 * somebody to remember.
 */

/** The filter as it appears in the URL and on the chips. */
export type OrderbookStatus = "alle" | "offen" | "unvollstaendig" | "test";

/**
 * In the order the chips are rendered.
 *
 * `alle` first and default, because the normal business ledger is what the
 * owner opens the Orderbuch for. It means "all NORMAL records" — test rows are
 * out of it — which is why the Test chip always shows its count beside it:
 * nothing is hidden without the screen saying where it went.
 */
export const ORDERBOOK_STATUSES: readonly OrderbookStatus[] =
  ["alle", "offen", "unvollstaendig", "test"];

/** `?status=` → what the screen should show. Anything unknown is `alle`. */
export function parseStatus(raw: string | undefined): OrderbookStatus {
  return raw === "unvollstaendig" || raw === "test" || raw === "offen" ? raw : "alle";
}

/**
 * What the database calls the same thing.
 *
 * `any` is not reachable from the URL. It exists for the year filter, which
 * has to offer 2026 even while the Test view is the one on screen — otherwise
 * selecting Test would silently drop the years only test rows live in.
 */
export type StatusScope = "normal" | "incomplete" | "open" | "test" | "any";

export function rpcStatus(status: OrderbookStatus): StatusScope {
  if (status === "unvollstaendig") return "incomplete";
  if (status === "offen") return "open";
  if (status === "test") return "test";
  return "normal";
}

/**
 * How many records each class holds in the CURRENT view.
 *
 * Counted after the year, month, search and scope filters and before the
 * classification one, so `Test 1` means "one test record among what you are
 * looking at", not "one in the database".
 */
export type ClassificationCounts = {
  /** Records that are not tests. The default view. */
  normal: number;
  /** Non-test records that still need work. A subset of `normal`. */
  incomplete: number;
  /**
   * Non-test records with a PHYSICAL action outstanding (0066). A subset of
   * `normal`, and independent of `incomplete`: a record may be one, both or
   * neither.
   */
  open: number;
  /** Test records, finished or not. Disjoint from `normal`. */
  test: number;
};

export const EMPTY_COUNTS: ClassificationCounts =
  { normal: 0, incomplete: 0, open: 0, test: 0 };

/** The count that belongs beside one chip. */
export function countFor(counts: ClassificationCounts, status: OrderbookStatus): number {
  if (status === "unvollstaendig") return counts.incomplete;
  if (status === "offen") return counts.open;
  if (status === "test") return counts.test;
  return counts.normal;
}

/** What the RPC returned, as the screen needs it. Missing keys read as zero. */
export function readCounts(raw: unknown): ClassificationCounts {
  if (raw === null || typeof raw !== "object") return EMPTY_COUNTS;
  const c = raw as Record<string, unknown>;
  const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
  return { normal: n(c.normal), incomplete: n(c.incomplete), open: n(c.open), test: n(c.test) };
}
