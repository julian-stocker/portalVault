/**
 * Reading eBay's German cell formats.
 *
 * MEASURED ON THE REAL REPORTS (Jan–Sep 2026, 5 075 date cells, every amount):
 *
 *   money   `1,30 €`, `1.234,56 €` — German decimals, a dot for thousands, a
 *           space and the euro sign. No other currency appeared.
 *   dates   `31-Aug-26` — two-digit day, ENGLISH month abbreviation, two-digit
 *           year. Never a time of day.
 *
 * Both readers are strict: something that does not look like this is an
 * error the caller reports, not a value guessed into shape.
 */

import { roundMoney } from "@/lib/orderbook/sales-money";
import type { IsoDay } from "../types";

export type Read<T> = { ok: true; value: T } | { ok: false; reason: "invalid" | "foreign_currency" };

const MONEY = /^(-?)(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})\s*(€|EUR)?$/;
const OTHER_CURRENCY = /^-?[\d.,]+\s*([A-Z]{3}|[$£¥])$/;

/** `1.234,56 €` → 1234.56. An empty cell is `null`: "the report says nothing". */
export function parseEbayMoney(raw: string): Read<number | null> {
  const value = raw.trim();
  if (value === "") return { ok: true, value: null };
  const match = MONEY.exec(value);
  if (!match) {
    return { ok: false, reason: OTHER_CURRENCY.test(value) ? "foreign_currency" : "invalid" };
  }
  const [, sign, whole, cents] = match;
  const amount = Number(`${whole.replace(/\./g, "")}.${cents}`);
  return { ok: true, value: roundMoney(sign === "-" ? -amount : amount) };
}

const MONTHS: Readonly<Record<string, number>> = {
  Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
};
const DAY = /^(\d{2})-([A-Z][a-z]{2})-(\d{2})$/;

/**
 * `31-Aug-26` → `2026-08-31`. An empty cell is `null`.
 *
 * The century is fixed to 20xx: SkyIsles' business history begins in 2026, and
 * a report from before 2000 does not exist.
 */
export function parseEbayDate(raw: string): Read<IsoDay | null> {
  const value = raw.trim();
  if (value === "") return { ok: true, value: null };
  const match = DAY.exec(value);
  if (!match) return { ok: false, reason: "invalid" };
  const day = Number(match[1]);
  const month = MONTHS[match[2]];
  const year = 2000 + Number(match[3]);
  if (!month) return { ok: false, reason: "invalid" };
  // Round-trip through UTC so that `31-Feb-26` is refused instead of rolled over.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return { ok: false, reason: "invalid" };
  return { ok: true, value: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` };
}

/** A positive whole quantity, or null. */
export function parseQuantity(raw: string): number | null {
  const value = raw.trim();
  if (!/^\d+$/.test(value)) return null;
  const n = Number(value);
  return n >= 1 ? n : null;
}
