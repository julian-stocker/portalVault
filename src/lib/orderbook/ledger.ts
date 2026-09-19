/**
 * The Orderbuch as a ledger (ADR-0088).
 *
 * Pure arithmetic and text handling for the workbench screen. The database
 * does the filtering and searching — `seller_orderbook_ledger()` — and this
 * holds the two decisions that are easy to get quietly wrong in a component:
 * what the summary factor means, and what a row's status is.
 */

import type { OrderbookStatus } from "./classification";

export type LedgerMatch = { id: number; position: number; name: string };

export type LedgerRow = {
  id: number;
  /** NULL when the date is not known yet — never a placeholder. */
  purchasedAt: string | null;
  totalCost: number;
  currency: string;
  source: string;
  note: string | null;
  itemCount: number;
  bookedCount: number;
  openCount: number;
  knownValue: number;
  knownItems: number;
  factor: number | null;
  /** Items that matched the search, so the row can open on the right place. */
  matchItems: LedgerMatch[];
  /** A deliberate test purchase, not real expenditure (0063). */
  isTest: boolean;
  /** Still needs work — no date, or hand-made with nothing in it (0063). */
  isIncomplete: boolean;
  /** A physical booking is still owed — `Einbuchen` would accept it (0066). */
  isOpen: boolean;
};

export type LedgerSummary = {
  purchaseCount: number;
  itemCount: number;
  totalCost: number;
  knownValue: number;
  knownItems: number;
  factor: number | null;
  /** At least one item in the set has no market price. */
  incomplete: boolean;
};

export const EMPTY_SUMMARY: LedgerSummary = {
  purchaseCount: 0, itemCount: 0, totalCost: 0,
  knownValue: 0, knownItems: 0, factor: null, incomplete: false,
};

/**
 * The summary factor.
 *
 * SUM(Ausgaben) / SUM(Marktwert) — one ratio over the whole filtered set, and
 * deliberately NOT the mean of the per-purchase factors.
 *
 * The two are different numbers, not rounding apart. Averaging weights a
 * three-item parcel exactly like a sixty-five-item one: on the real December
 * 2025 data it reads 0,3771 where the true ratio is 0,3970. That is a 5 %
 * error in a number the owner uses to judge whether a parcel was worth buying,
 * and nothing about the screen would look wrong.
 *
 * `null`, never zero, when nothing is valued: "no market value known" is not
 * the claim "worth nothing".
 */
export function summaryFactor(totalCost: number, knownValue: number): number | null {
  if (!Number.isFinite(knownValue) || knownValue <= 0) return null;
  return totalCost / knownValue;
}

/** The mean of per-purchase factors. Exported ONLY so a test can prove it differs. */
export function averageOfFactors(factors: readonly (number | null)[]): number | null {
  const known = factors.filter((f): f is number => f !== null && Number.isFinite(f));
  if (known.length === 0) return null;
  return known.reduce((sum, f) => sum + f, 0) / known.length;
}

/**
 * Newest first, and for one day the later import first.
 *
 * Two parcels bought on 2025-12-06 are two purchases, and without the second
 * key their order would be whatever the database felt like returning — stable
 * enough in testing to look deliberate and unstable enough to reorder the
 * screen one day. `id` descending is the tiebreak because a higher id is the
 * later import.
 */
export function sortLedger<T extends { purchasedAt: string | null; id: number }>(
  rows: readonly T[],
): T[] {
  return [...rows].sort((a, b) => {
    /*
     * UNDATED LAST, AS A BLOCK.
     *
     * The tempting shortcut is to treat a missing date as the empty string,
     * which sorts it below every real date and happens to look right. It is
     * not right: it says a dateless purchase is older than all of them, which
     * is a claim the workbook does not make. Explicit instead — they sit
     * together at the end, ordered by id, visibly waiting for dates.
     */
    if (a.purchasedAt === null || b.purchasedAt === null) {
      if (a.purchasedAt === b.purchasedAt) return b.id - a.id;
      return a.purchasedAt === null ? 1 : -1;
    }
    return a.purchasedAt === b.purchasedAt ? b.id - a.id : (a.purchasedAt < b.purchasedAt ? 1 : -1);
  });
}

/**
 * What the operator typed, ready for the database.
 *
 * German decimals only: `67,02` is the same money as `67.02`. Nothing else is
 * normalised — no rounding, no tolerance, no nearest match. A financial search
 * that returns approximately the right money is worse than one that returns
 * nothing, because the wrong parcel looks like an answer.
 */
export function normaliseSearch(term: string): string | null {
  const trimmed = term.trim();
  return trimmed === "" ? null : trimmed;
}

/** Is this a number the way the owner writes one? */
export function looksNumeric(term: string): boolean {
  return /^\d{1,3}(?:[.,]\d{1,3})*(?:[.,]\d+)?$/.test(term.trim()) || /^\d+[.,]?\d*$/.test(term.trim());
}

export type RowStatus =
  /** Historical: settled for Orderbuch purposes, owning no movement. */
  | "settled"
  /** Every unit booked. */
  | "complete"
  /** Work outstanding. */
  | "open";

/**
 * What the compact status cell says.
 *
 * `settled` is the historical case and it is PRESENTATION ONLY. The row is
 * `reconciled_legacy` with `movement_id` NULL and stays that way: the tick
 * means "nothing left to do here", not "a movement exists". The accessible
 * name spells that out, because a bare ✓ in a ledger otherwise reads as
 * "booked into stock" — which would be a false statement about inventory.
 */
export function rowStatus(row: { source: string; bookedCount: number; itemCount: number }): RowStatus {
  if (row.source === "excel_order_2026") return "settled";
  if (row.itemCount > 0 && row.bookedCount === row.itemCount) return "complete";
  return "open";
}

/** The same question for one item. */
export function itemStatus(item: { state: string }): RowStatus {
  if (item.state === "reconciled_legacy") return "settled";
  if (item.state === "booked") return "complete";
  return "open";
}

/**
 * May this item show an `Einchecken` action?
 *
 * A historical row never may: it is already accounted for, and `0053` refuses
 * it in the database anyway. Offering a button the server will reject is worse
 * than offering none.
 */
export function canCheckIn(item: { state: string; skyId: string | null }): boolean {
  if (item.state === "reconciled_legacy" || item.state === "booked") return false;
  if (item.skyId === null) return false;
  return item.state === "ordered" || item.state === "arrived";
}

/**
 * The Orderbuch URL for a given view.
 *
 * A search is a URL, not component state. That is what makes a result
 * shareable and reachable with the browser's own back button — and it is what
 * lets the detail page carry the entire view home in one parameter instead of
 * dumping the operator back at an unfiltered ledger.
 */
/** The year filter's third state: purchases whose date nobody knows yet. */
export const UNDATED = "ohne";

export type YearFilter = number | typeof UNDATED | undefined;

export function ledgerHref(
  year?: YearFilter, month?: number, q?: string | null, status: OrderbookStatus = "alle",
): string {
  const params = new URLSearchParams();
  if (year !== undefined) params.set("jahr", String(year));
  // A month inside "Ohne Datum" is meaningless — there is no date to be in a
  // month of — so the parameter is dropped rather than silently ignored.
  if (month && year !== UNDATED) params.set("monat", String(month));
  if (q) params.set("q", q);
  // `alle` is the default and stays out of the URL, so the plain Orderbuch
  // address keeps meaning the plain Orderbuch.
  if (status !== "alle") params.set("status", status);
  const query = params.toString();
  return query ? `/business/orderbuch?${query}` : "/business/orderbuch";
}

/** `?jahr=` → what the database should be asked. */
export function parseYearFilter(raw: string | undefined): YearFilter {
  if (raw === UNDATED) return UNDATED;
  const year = Number(raw);
  return raw && Number.isInteger(year) ? year : undefined;
}

/**
 * Where the detail page's back link points.
 *
 * Only a path inside the Orderbuch is accepted. `?zurueck=` arrives from the
 * URL bar, so an unchecked value is an open redirect with a "Zurück" label on
 * it — the most trustworthy button on the page.
 */
export function safeBackHref(raw: string | undefined): string {
  if (!raw) return "/business/orderbuch";
  const decoded = (() => { try { return decodeURIComponent(raw); } catch { return ""; } })();

  /*
   * A PATH, NOT A PREFIX. `startsWith("/business/orderbuch")` also accepts
   * `/business/orderbuchXXX/../../admin`, which a browser resolves to `/admin`
   * — so the check has to end at a boundary the path actually has, and reject
   * any traversal outright.
   */
  const [path] = decoded.split(/[?#]/, 1);
  if (path !== "/business/orderbuch" && !path.startsWith("/business/orderbuch/")) {
    return "/business/orderbuch";
  }
  if (decoded.startsWith("//") || decoded.includes("..") || decoded.includes("\\")) {
    return "/business/orderbuch";
  }
  return decoded;
}
