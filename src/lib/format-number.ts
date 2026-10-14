/**
 * Number rendering that does not depend on the runtime's locale data.
 *
 * ============================================================================
 * THE DEFECT THIS EXISTS FOR
 * ============================================================================
 *
 * A hydration mismatch in the Orderbuch:
 *
 *     Server: 2.118 Artikel
 *     Client: 2 118 Artikel
 *
 * Both sides called the same code — `items.toLocaleString("de-AT")`. They
 * disagreed because the separator is not part of the code. It comes from the
 * CLDR data inside whichever ICU the runtime was built with, and Austrian
 * German's group separator CHANGED between CLDR versions: it used to be `.`
 * and is now a no-break space. Node and the browser ship different ICU
 * versions, so the server wrote one string into the HTML and React rebuilt
 * the other.
 *
 * Measured on this machine, Node v26.7.0 / ICU 78 / CLDR 48:
 *
 *     new Intl.NumberFormat("de-AT").format(2118)      →  "2 118"
 *     new Intl.NumberFormat("de-DE").format(2118)      →  "2.118"
 *
 * This is not a bug in `de-AT` and not something a newer Node fixes. Any
 * `Intl`-formatted text that is rendered on the server AND re-rendered during
 * hydration carries the same risk, for any locale whose data is revised.
 *
 * ============================================================================
 * AND IT IS WORSE THAN A SERVER/CLIENT SPLIT
 * ============================================================================
 *
 * In ONE AND THE SAME ICU 78, `de-AT` groups differently depending on the
 * style — this is real CLDR data, not a glitch:
 *
 *     currency  →  "€ 12.345,67"     group separator "."
 *     decimal   →  "12 345,678"      group separator U+00A0
 *     percent   →  "1 234,5 %"       group separator U+00A0
 *
 * So the Orderbuch summary showed `€ 12.345,67` next to `2 118 Artikel` — the
 * same magnitude grouped two different ways, on the same line, by design.
 * No hydration involved. That alone is reason enough to pin the pattern.
 *
 * ============================================================================
 * WHAT IS PINNED, AND WHY THESE VALUES
 * ============================================================================
 *
 * `.` for groups and `,` for the decimal: the German convention, what the
 * browser already rendered for counts, what ICU already rendered for
 * currency, and what the legacy frontend has always shown. The currency
 * symbol keeps its Austrian place — in front, with a no-break space — which
 * is where BOTH runtimes and `../webpage/site/js/format.js` put it. Nothing
 * here changes a number; only which characters stand between its digits.
 *
 * NO IMPORTS, DELIBERATELY. `de.ts` needs this for its copy functions and
 * `format.ts` needs it too, while `format.ts` imports `de.ts` for the locale.
 * A module with no imports of its own cannot close that circle.
 */

/** Between thousands. Austrian currency grouping, and German convention. */
const GROUP = ".";
/** Before the fraction. */
const DECIMAL = ",";
/** What ICU puts between the currency symbol and the amount: U+00A0. */
const NBSP = " ";
/** ICU writes a plain hyphen-minus for negative numbers, so we do too. */
const MINUS = "-";

/** Three-digit groups, from the right. `1234567` → `1.234.567`. */
function group(digits: string): string {
  let out = "";
  for (let i = 0; i < digits.length; i++) {
    /* A separator before every digit whose distance from the end is a
       multiple of three — never in front of the first digit. */
    if (i > 0 && (digits.length - i) % 3 === 0) out += GROUP;
    out += digits[i];
  }
  return out;
}

/** Add one to a string of digits. `"99"` → `"100"`. */
function increment(digits: string): string {
  let i = digits.length - 1;
  const out = digits.split("");
  for (; i >= 0; i--) {
    if (out[i] !== "9") { out[i] = String(Number(out[i]) + 1); return out.join(""); }
    out[i] = "0";
  }
  return "1" + out.join("");
}

/**
 * Round to at most `max` fraction digits — the way ICU does it.
 *
 * NOT `toFixed`, and the difference is money. `toFixed` rounds the double's
 * exact binary value: `(1.005).toFixed(2)` is `"1.00"`, because 1.005 is
 * really 1.00499999999999989…. ICU rounds the SHORTEST decimal that reads
 * back as that double — `"1.005"` — and so answers `1,01`. Measured, not
 * assumed: `Intl.NumberFormat("de-AT", { maximumFractionDigits: 2 })
 * .format(1.005)` is `"1,01"` here.
 *
 * A first version of this file used `toFixed` and a comment claiming the two
 * agreed. The test below caught it. Half a cent is exactly the case an
 * invoice argues about, so the rounding stays ICU's.
 *
 * `String(value)` gives that shortest representation. Above 1e21 it turns
 * exponential and this falls back to `toFixed`; no amount or count in this
 * product comes near it.
 */
function roundLikeIcu(abs: number, max: number): string {
  const text = abs.toString();
  if (text.includes("e")) return abs.toFixed(max);

  const dot = text.indexOf(".");
  if (dot === -1) return text;

  const frac = text.slice(dot + 1);
  if (frac.length <= max) return text;

  const kept = text.slice(0, dot) + frac.slice(0, max);
  /* Half away from zero — ICU's default `halfExpand`. */
  const digits = frac.charCodeAt(max) - 48 >= 5 ? increment(kept) : kept;

  const cut = digits.length - max;
  const whole = digits.slice(0, cut) || "0";
  return max > 0 ? `${whole}.${digits.slice(cut)}` : whole;
}

/**
 * The sign, the grouped integer part and the fraction.
 *
 * Trailing zeros beyond `min` are dropped and missing ones padded — the same
 * thing `Intl` does with `minimumFractionDigits` and `maximumFractionDigits`.
 */
function split(value: number, min: number, max: number): string {
  /* `-0` must not come out as `-0`. */
  const n = value === 0 ? 0 : value;
  const sign = n < 0 ? MINUS : "";

  const text = roundLikeIcu(Math.abs(n), max);
  const [whole, rest = ""] = text.split(".");

  let frac = rest;
  while (frac.length > min && frac.endsWith("0")) frac = frac.slice(0, -1);
  while (frac.length < min) frac += "0";

  return sign + (frac.length > 0 ? group(whole) + DECIMAL + frac : group(whole));
}

/** ICU writes `∞` for an infinite value; matched so nothing reads `Infinity`. */
function infinite(value: number): string | null {
  if (Number.isFinite(value)) return null;
  if (Number.isNaN(value)) return null;
  return value > 0 ? "∞" : `${MINUS}∞`;
}

/**
 * A plain number: no fixed fraction, at most three decimals.
 *
 * Mirrors `new Intl.NumberFormat(locale)`, whose defaults are a minimum of 0
 * and a maximum of 3 fraction digits. Counts are integers and come out
 * without a decimal part at all.
 */
export function plainNumber(value: number): string {
  return infinite(value) ?? split(value, 0, 3);
}

/** A number with a fixed number of decimals — factors, rates, shares. */
export function fixedNumber(value: number, digits: number): string {
  return infinite(value) ?? split(value, digits, digits);
}

/** A number with a range of decimals, written as sparsely as allowed. */
export function rangedNumber(value: number, min: number, max: number): string {
  return infinite(value) ?? split(value, min, max);
}

/** Euro, the Austrian way: symbol first, no-break space, two decimals. */
export function euroAmount(value: number): string {
  const amount = infinite(value) ?? split(value, 2, 2);
  /* The sign belongs in front of the symbol, as ICU places it:
     `-€ 5,00` — `formatToParts` gives minusSign, currency, literal. */
  return amount.startsWith(MINUS)
    ? `${MINUS}€${NBSP}${amount.slice(MINUS.length)}`
    : `€${NBSP}${amount}`;
}

/** A fraction between 0 and 1, written as a percentage with one decimal. */
export function percentAmount(value: number, digits = 1): string {
  return infinite(value) ?? `${split(value * 100, digits, digits)}${NBSP}%`;
}
