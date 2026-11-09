/**
 * Where the reconciliation lives, in one place.
 *
 * `sessionHref` is the address a session opens at: its comparison page
 * (phase 4 step 5). `sessionPageHref` adds the page and the category filter —
 * only the session id, a category word and a page number ever go into a URL,
 * never a value from a report.
 */
import type { OrderOutcome } from "./plan";
import type { Category } from "./view";

export const RECONCILIATION_PATH = "/business/orderbuch/abgleich";

export function sessionHref(id: number): string {
  return `${RECONCILIATION_PATH}/${id}`;
}

/** `?kategorie=` and `?seite=` as `pageRequest` reads them; page 1 and "all" are left out. */
export function sessionPageHref(id: number, at: { category?: Category | null; page?: number } = {}): string {
  const query = new URLSearchParams();
  if (at.category) query.set("kategorie", at.category);
  if (at.page && at.page > 1) query.set("seite", String(at.page));
  const q = query.toString();
  return q ? `${sessionHref(id)}?${q}` : sessionHref(id);
}

/*
 * THE RESULT FILTER (2026-11-08). One German word per outcome in `?ansicht=`;
 * no word means "all". Anything else is "all" too — never an error, never echoed.
 */
export const VIEW_WORDS = {
  identical: "identisch",
  supplement: "ergaenzen",
  deviation: "abweichung",
  unmatched: "nicht-zugeordnet",
} as const satisfies Partial<Record<OrderOutcome, string>>;
export type ResultView = keyof typeof VIEW_WORDS;

export function parseViewParam(value: string | undefined | null): ResultView | null {
  const hit = (Object.entries(VIEW_WORDS) as [ResultView, string][]).find(([, word]) => word === value);
  return hit ? hit[0] : null;
}

export function sessionViewHref(id: number, view: ResultView | null): string {
  return view ? `${sessionHref(id)}?ansicht=${VIEW_WORDS[view]}` : sessionHref(id);
}

/** A session id from a URL segment or `?sitzung=`, if it is one at all. */
export function parseSessionParam(value: string | undefined | null): number | null {
  return value && /^[1-9][0-9]{0,15}$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
}

/*
 * FROM THE RECONCILIATION INTO THE ORDERBUCH AND BACK (2026-11-08).
 *
 * "Im Orderbuch bearbeiten" opens the sale's existing edit dialog on the sales
 * list (`?verkauf=<id>`) — the one place a date is corrected. It carries where
 * it came from as three CHECKED parts, never as a URL:
 *
 *   ?abgleich=<session id>   digits, `parseSessionParam`
 *   ?bestellung=<match id>   digits, `parseSessionParam`
 *   ?ansicht=<word>          one of `VIEW_WORDS`, else none
 *
 * The way back is BUILT from those parts (`returnHref`): the result page of
 * that session, its filter, and the card of that order (`#recon-match-<id>`).
 * Nothing from the address bar is ever echoed as a link target, so there is no
 * redirect to anywhere else. Without the parts the sales list behaves as before.
 */
export const ORDERBOOK_SALES_PATH = "/business/orderbuch/verkauf";

export type ReturnTarget = { sessionId: number; matchId: number; view: ResultView | null };

/** The three checked parts — all three ids valid, or nothing. */
export function parseReturn(q: { abgleich?: string | null; bestellung?: string | null; ansicht?: string | null }): ReturnTarget | null {
  const sessionId = parseSessionParam(q.abgleich);
  const matchId = parseSessionParam(q.bestellung);
  if (sessionId === null || matchId === null) return null;
  return { sessionId, matchId, view: parseViewParam(q.ansicht) };
}

/** The parts as query parameters, in a fixed order. */
export function returnQuery(t: ReturnTarget): string {
  const q = new URLSearchParams({ abgleich: String(t.sessionId), bestellung: String(t.matchId) });
  if (t.view) q.set("ansicht", VIEW_WORDS[t.view]);
  return q.toString();
}

/** Back to the same session, the same filter, the same order card. */
export function returnHref(t: ReturnTarget): string {
  return `${sessionViewHref(t.sessionId, t.view)}#recon-match-${t.matchId}`;
}

/** An internal Orderbuch href with the way back appended — or unchanged without one. */
export function withReturn(href: string, t: ReturnTarget | null): string {
  if (t === null) return href;
  return `${href}${href.includes("?") ? "&" : "?"}${returnQuery(t)}`;
}

/**
 * "Externen Verkauf anlegen" for an unmatched order (0184): the EXISTING
 * create dialog, told which session and card it came from — the page reads
 * the order itself from there, and returns to that card after saving.
 */
export function newSaleFromReportHref(back: ReturnTarget): string {
  return withReturn(`${ORDERBOOK_SALES_PATH}/neu`, back);
}

/** The sale's edit dialog on the sales list, remembering the way back. */
export function orderbookEditHref(saleId: number, back: ReturnTarget | null): string {
  return withReturn(`${ORDERBOOK_SALES_PATH}?verkauf=${saleId}`, back);
}

/** Where a sale's positions are kept — its own page, at the positions (`#positionen`). */
export const SALE_ITEMS_ANCHOR = "positionen";

/**
 * The sale's positions (figures and count) on its own page, remembering the
 * way back (2026-11-08). The same checked parts as the edit dialog — never a
 * URL — so the page builds "Zurück zum Abgleich" from them.
 */
export function orderbookItemsHref(saleId: number, back: ReturnTarget | null): string {
  return `${withReturn(`${ORDERBOOK_SALES_PATH}/${saleId}`, back)}#${SALE_ITEMS_ANCHOR}`;
}
