/**
 * Where the reconciliation lives, in one place.
 *
 * `sessionHref` is the address a session opens at. Until the session page
 * exists (phase 4 step 5) it is the overview with the session marked — a
 * page that exists, never a 404. Step 5 changes this one function to
 * `/business/orderbuch/abgleich/<id>`.
 */
export const RECONCILIATION_PATH = "/business/orderbuch/abgleich";

export function sessionHref(id: number): string {
  return `${RECONCILIATION_PATH}?sitzung=${id}`;
}

/** The `?sitzung=` value, if it is a session id at all. */
export function parseSessionParam(value: string | undefined | null): number | null {
  return value && /^[1-9][0-9]{0,15}$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
}
