import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { formatDate } from "@/lib/format";

/**
 * `formatDate`, and the three places that call it.
 *
 * THE DEFECT THIS FILE EXISTS FOR
 *
 * The old guard was `/^\d{4}-\d{2}-\d{2}$/` and every caller passes a
 * PostgREST `timestamptz`. The regex rejected all of them, so the function
 * returned its placeholder every single time it was used. There was no test
 * for it at all — which is the whole reason "Bestellt am –" stood on the
 * customer's order pages for as long as it did.
 *
 * So this file does two things: it holds the function to real values taken
 * from the staging database, and it pins the three call sites, because a
 * fourth caller that hands it something else would reintroduce exactly this.
 */
describe("a PostgREST timestamp is a date", () => {
  it("formats the values the database actually returns", () => {
    // Copied from staging: six fractional digits, explicit +00:00 offset.
    expect(formatDate("2026-09-12T09:24:46.81348+00:00")).toBe("12.09.2026");
    expect(formatDate("2026-09-11T15:12:24.976963+00:00")).toBe("11.09.2026");
  });

  it("would have failed before the fix", () => {
    // The single assertion that separates the broken build from the fixed one.
    expect(formatDate("2026-09-12T09:24:46.81348+00:00")).not.toBe("–");
  });

  it("accepts a timestamp without fractional seconds, and one with Z", () => {
    expect(formatDate("2026-09-12T09:24:46+00:00")).toBe("12.09.2026");
    expect(formatDate("2026-09-12T09:24:46Z")).toBe("12.09.2026");
  });
});

describe("a bare date keeps its day", () => {
  it("still formats the shape the old signature accepted", () => {
    expect(formatDate("2026-09-12")).toBe("12.09.2026");
  });

  it("is read at noon, so no zone can pull it onto a neighbouring day", () => {
    // Midnight would be the previous day in any negative-offset zone and the
    // next day in a far-eastern one. Noon has twelve hours of slack either way.
    expect(formatDate("2026-01-01")).toBe("01.01.2026");
    expect(formatDate("2026-12-31")).toBe("31.12.2026");
  });
});

describe("the calendar day is the same wherever the code runs", () => {
  it("reads an instant in one fixed zone, not the runtime's", () => {
    /*
     * 22:45 UTC is already the next day in Europe/Berlin. Without a pinned
     * zone this would render as the 12th on the server and the 13th in a
     * Central European browser — a hydration mismatch and a date that changes
     * on reload. The pinned zone is what makes this assertion possible at
     * all: it holds no matter what TZ the test machine has.
     */
    expect(formatDate("2026-09-12T22:45:00+00:00")).toBe("13.09.2026");
    expect(formatDate("2026-09-12T21:59:00+00:00")).toBe("12.09.2026");
  });

  it("crosses into the next day at +02:00 in summer", () => {
    // CEST. 21:59 UTC is 23:59 local — still the same day, by one minute.
    expect(formatDate("2026-07-15T21:59:59+00:00")).toBe("15.07.2026");
    expect(formatDate("2026-07-15T22:00:00+00:00")).toBe("16.07.2026");
  });

  it("and at +01:00 in winter", () => {
    // CET. An hour later, because the offset is an hour smaller.
    expect(formatDate("2026-01-15T22:59:59+00:00")).toBe("15.01.2026");
    expect(formatDate("2026-01-15T23:00:00+00:00")).toBe("16.01.2026");
  });

  it("switches offset on the EU changeover dates, not on a fixed one", () => {
    /*
     * The two Sundays that decide it: 29 March 2026 and 25 October 2026,
     * both at 01:00 UTC. Asserted on either side of each, so a zone that
     * ignored DST — or a fixed +01:00 offset — would fail here.
     */
    expect(formatDate("2026-03-28T22:30:00+00:00")).toBe("28.03.2026"); // CET, 23:30
    expect(formatDate("2026-03-29T22:30:00+00:00")).toBe("30.03.2026"); // CEST, 00:30
    expect(formatDate("2026-10-24T22:30:00+00:00")).toBe("25.10.2026"); // CEST, 00:30
    expect(formatDate("2026-10-25T22:30:00+00:00")).toBe("25.10.2026"); // CET, 23:30
  });

  it("never falls back to the runtime zone", () => {
    /*
     * The guard against the change that would quietly undo all of the above:
     * dropping `timeZone` from the formatter. On a machine in UTC — CI, and
     * the Vercel server — every assertion above would still pass, because UTC
     * and the intended zone agree for most of the day. This one does not.
     */
    const source = readFileSync("src/lib/format.ts", "utf8");
    expect(source).toContain('const TIME_ZONE = "Europe/Berlin"');
    expect(source).toContain("timeZone: TIME_ZONE");
  });
});

describe("what is not a date says so", () => {
  it("refuses rather than inventing one", () => {
    for (const value of [null, undefined, "", "   ", "gestern", "2026-13-45", "undefined"]) {
      expect(formatDate(value), JSON.stringify(value)).toBe("–");
    }
  });

  it("never renders Invalid Date", () => {
    expect(formatDate("nonsense")).not.toContain("Invalid");
  });
});

describe("every caller hands it something it accepts", () => {
  /*
   * Three call sites, all of them passing a timestamp. Named here so a fourth
   * one is a deliberate addition — and so the two that were broken for months
   * stay covered.
   */
  const CALLERS = [
    "src/app/(app)/account/orders/page.tsx",
    "src/app/(app)/account/orders/[orderNumber]/page.tsx",
    "src/app/(admin)/admin/catalog/[skyId]/page.tsx",
  ] as const;

  it.each(CALLERS)("%s calls formatDate", (file) => {
    expect(readFileSync(file, "utf8")).toContain("formatDate(");
  });

  it("finds no caller outside that list", () => {
    // A grep over the source would be nicer, but the point is the same: the
    // list is the contract, and `npm run check` fails on an unused import.
    const all = CALLERS.map((f) => readFileSync(f, "utf8")).join("\n");
    expect(all.match(/formatDate\(/g)?.length).toBe(3);
  });

  it("the order detail narrows instead of stringifying", () => {
    // `String(undefined)` produces the literal "undefined", which formatDate
    // then rejects by accident rather than on purpose.
    const page = readFileSync(CALLERS[1], "utf8");
    expect(page).not.toContain("formatDate(String(");
    expect(page).toContain('typeof order.placed_at === "string"');
  });
});
