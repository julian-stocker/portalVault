/**
 * Where the reconciliation lives, in one place.
 *
 * `sessionHref` is the address a session opens at: its comparison page
 * (phase 4 step 5). `sessionPageHref` adds the page and the category filter —
 * only the session id, a category word and a page number ever go into a URL,
 * never a value from a report.
 */
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

/** A session id from a URL segment or `?sitzung=`, if it is one at all. */
export function parseSessionParam(value: string | undefined | null): number | null {
  return value && /^[1-9][0-9]{0,15}$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
}
