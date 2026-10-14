/**
 * Formatting of numbers, prices, percentages and dates.
 *
 * Deliberately in a single place: a second language later becomes a parameter
 * instead of a search through the codebase (ADR-0012). The appearance follows
 * the legacy frontend (`site/js/format.js`).
 *
 * NUMBERS ARE NO LONGER FORMATTED BY `Intl`. The pattern is pinned in
 * `format-number.ts`, because a locale's separators live in the runtime's ICU
 * data and therefore differ between Node and the browser — which is a
 * hydration mismatch. The reasoning and the measurements are in that file.
 * Dates keep `Intl` and an explicit locale; the paragraph below `LOCALE`
 * says why that is a different case and not an oversight.
 */
import { de } from "@/lib/i18n/de";
import { euroAmount, percentAmount, plainNumber } from "@/lib/format-number";

const LOCALE = de.locale;

/*
 * NUMBERS NO LONGER GO THROUGH `Intl` — DATES STILL DO.
 *
 * Three `Intl.NumberFormat` instances stood here, built from `de.locale`.
 * They produced a hydration mismatch in the Orderbuch, because the separator
 * they insert is not in this file: it is CLDR data inside the runtime's ICU,
 * and Austrian German's group separator was revised between CLDR versions.
 * The server wrote `2 118` and the browser rebuilt `2.118`. `format-number.ts`
 * explains it in full, with the measurements.
 *
 * The date formatters below keep `Intl`, and that is not an inconsistency.
 * A calendar is a calendar: `de-AT` and `de-DE` both write `14.10.2026`, the
 * pattern has not been revised, and reimplementing month arithmetic and time
 * zones by hand would trade a cosmetic risk for a real one. `TIME_ZONE` is
 * pinned right below for the same family of reason.
 */

/**
 * Formats a price as currency. `null` means "no known market price" and is
 * explicitly not the same as 0 — 15 of the 600 catalog items have no price
 * (ADR-0010).
 */
export function formatPrice(value: number | null | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "–";
  }
  return euroAmount(value);
}

/**
 * An amount that reduces what is left, written as the deduction it is.
 *
 * PRÄSENTATION, SONST NICHTS. Refunds, Gebühren und Rabatte stehen in der
 * Datenbank als positive Beträge, und daran ändert sich nichts: `order_refunds
 * .amount` hat einen CHECK auf `> 0`, und jede Summe im System rechnet damit
 * weiter wie bisher. Nur der Bildschirm sagt, in welche Richtung das Geld
 * ging — „5,83 €" unter „Rückerstattung" liest sich sonst wie eine Einnahme.
 *
 * Eine Null bekommt kein Minus: „−0,00 €" behauptet eine Bewegung, die es
 * nicht gab. Ein bereits negativer Wert wird nicht zweimal gedreht.
 */
export function formatDeduction(value: number | null | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) return formatPrice(value);
  if (value === 0) return formatPrice(0);
  return `\u2212${formatPrice(Math.abs(value))}`;
}

export function formatNumber(value: number | null | undefined): string {
  return plainNumber(typeof value === "number" ? value : 0);
}

/** Expects a fraction between 0 and 1, not 0 to 100. */
export function formatPercent(value: number | null | undefined): string {
  return percentAmount(typeof value === "number" ? value : 0);
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

const partsFormat = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: TIME_ZONE,
});

/** A calendar day, as Berlin has it. */
export type BerlinDay = { year: number; month: number; day: number };

/**
 * What day it is where this product's calendar lives.
 *
 * `new Date().getFullYear()` would be the runtime's year, and the runtime is
 * UTC on the server. For most of the year the two agree; on 31 December at
 * 23:30 in Berlin they do not, and the order archive would open on a year that
 * has not started — the same defect one hour earlier at the end of every
 * month. Same reasoning as `TIME_ZONE` above: the calendar is Berlin's, so the
 * day is read in Berlin.
 *
 * `en-CA` only because it yields `YYYY-MM-DD` with no adornment; the zone is
 * what matters.
 */
export function berlinToday(now: Date = new Date()): BerlinDay {
  const [year, month, day] = partsFormat.format(now).split("-").map(Number);
  return { year, month, day };
}
