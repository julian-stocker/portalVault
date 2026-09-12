/**
 * Formatting of numbers, prices and percentages.
 *
 * Deliberately in a single place and with an explicit locale: a second
 * language later becomes a parameter instead of a search through the codebase
 * (ADR-0012). The locale matches the legacy frontend (site/js/format.js).
 *
 * Formatters are created once and reused — Intl instances are comparatively
 * expensive to construct.
 */
import { de } from "@/lib/i18n/de";

const LOCALE = de.locale;
const CURRENCY = "EUR";

const moneyFormat = new Intl.NumberFormat(LOCALE, {
  style: "currency",
  currency: CURRENCY,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const numberFormat = new Intl.NumberFormat(LOCALE);

const percentFormat = new Intl.NumberFormat(LOCALE, {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/**
 * Formats a price as currency. `null` means "no known market price" and is
 * explicitly not the same as 0 — 15 of the 600 catalog items have no price
 * (ADR-0010).
 */
export function formatPrice(value: number | null | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "–";
  }
  return moneyFormat.format(value);
}

export function formatNumber(value: number | null | undefined): string {
  return numberFormat.format(typeof value === "number" ? value : 0);
}

/** Expects a fraction between 0 and 1, not 0 to 100. */
export function formatPercent(value: number | null | undefined): string {
  return percentFormat.format(typeof value === "number" ? value : 0);
}

/**
 * The zone the displayed calendar day is read in.
 *
 * Pinned rather than left to the runtime, and that is the point. An instant
 * has no calendar day of its own — `2026-09-12T22:45:00Z` is the 12th in UTC
 * and the 13th in Berlin. With no `timeZone`, `Intl` uses whatever zone the
 * code happens to run in: UTC on the server, the visitor's zone in the
 * browser. The same order would then render two different days depending on
 * where it was rendered, which is a hydration mismatch and a date that
 * changes on reload.
 *
 * Berlin as the canonical name for CET/CEST — the zone the German-speaking
 * market keeps. It is not about where the seller sits: Berlin and Vienna are
 * the same offset with the same EU changeover rules, so the choice is which
 * name stands for that zone, not which city is served. For a customer in it,
 * this is also the day they experienced: an order placed at 00:45 local shows
 * as that day, not the one before.
 *
 * A visitor outside CET/CEST therefore sees the seller's calendar day. That
 * is deliberate — a shipping date that means one thing to the shop and
 * another to the customer is worse than one that is consistently the shop's.
 */
const TIME_ZONE = "Europe/Berlin";

const dateFormat = new Intl.DateTimeFormat(LOCALE, {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: TIME_ZONE,
});

/** A bare calendar date, with no time and no offset. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Formats a calendar date, from either a date or a timestamp.
 *
 * THE DEFECT THIS REPLACES
 *
 * The old body accepted `YYYY-MM-DD` and nothing else. Every caller passes a
 * PostgREST `timestamptz` — `2026-09-12T09:24:46.81348+00:00` — so the guard
 * rejected all of them and the function returned its placeholder every single
 * time. "Bestellt am –" on the customer's order list and order page was not a
 * missing value; it was this. The administrator's order pages format dates
 * themselves with `toLocaleString`, which is why the defect was invisible to
 * the operator and permanent for the customer.
 *
 * TWO SHAPES, ONE DAY
 *
 * A bare date is read at UTC noon rather than midnight, so no zone can pull it
 * onto a neighbouring day — the reason the old code did this, kept. A
 * timestamp is a real instant and is simply read in `TIME_ZONE`.
 *
 * Anything unparseable still returns the placeholder, deliberately: a date is
 * either known or it is not, and inventing one would be worse than saying so.
 */
export function formatDate(value: string | null | undefined): string {
  if (typeof value !== "string" || value.trim() === "") return "–";

  const instant = DATE_ONLY.test(value)
    ? new Date(`${value}T12:00:00Z`)
    : new Date(value);

  if (Number.isNaN(instant.getTime())) return "–";
  return dateFormat.format(instant);
}
