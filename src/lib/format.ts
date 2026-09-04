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

const dateFormat = new Intl.DateTimeFormat(LOCALE, {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Formats an ISO date (YYYY-MM-DD).
 *
 * Parsed as UTC noon rather than midnight: a date-only string is midnight UTC,
 * which in a negative-offset timezone would render as the previous day.
 */
export function formatDate(value: string | null | undefined): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "–";
  return dateFormat.format(new Date(`${value}T12:00:00Z`));
}
