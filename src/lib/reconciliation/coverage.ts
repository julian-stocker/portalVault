/**
 * Which period a set of reports covers, and how sure that is.
 *
 * THE RECORD NUMBER CHAIN
 *
 * eBay numbers its sales records (`Verkaufsprotokollnummer`) without gaps,
 * and an order consumes numbers in a fixed pattern, measured on all 310
 * transitions of the 2026 reports without a single exception:
 *
 *     an order of one position         1 number
 *     an order of n positions          n + 1 numbers — one per position, then
 *                                      the order itself takes the highest
 *
 * So `1498 → 1513` between March and April is not a gap: the next order has
 * 14 positions and consumes 15 numbers. A real gap — a number nobody holds —
 * means an order is missing from the files, and the days it spans are
 * reported as uncertain.
 *
 * The rule is derived from the data, not documented by eBay. It is applied as
 * evidence, never as a reason to invent an order.
 *
 * WHAT IS NEVER KNOWN
 *
 * The record before the first and after the last. Whether an order on the
 * first or last covered day lies just outside the files cannot be decided from
 * the files, so those two days are "edge days".
 */

import type { ExternalOrder, ExternalReport, IsoDay } from "./types";

/** Record numbers an order consumes. */
export const recordsConsumed = (order: Pick<ExternalOrder, "combined" | "lines">): number =>
  order.combined ? order.lines.length + 1 : 1;

export type RecordGap = {
  afterRecord: number;
  afterSoldOn: IsoDay;
  beforeRecord: number;
  beforeSoldOn: IsoDay;
  /** Numbers nobody in the files holds. Negative: two orders claim the same numbers. */
  missingNumbers: number;
};

export type FileCoverage = {
  fileName: string;
  orders: number;
  footerCount: number | null;
  /** null when the file has no footer to compare with. */
  footerMatches: boolean | null;
  firstSoldOn: IsoDay | null;
  lastSoldOn: IsoDay | null;
  /** Orders per calendar month, `2026-03` → 42. More than one key is worth a look. */
  months: Record<string, number>;
  recordFirst: number | null;
  recordLast: number | null;
  gaps: RecordGap[];
};

export type DayVerdict =
  | { comparable: true; edge: boolean }
  | { comparable: false; reason: "before_coverage" | "after_coverage" | "inside_gap" | "no_coverage" };

export type Coverage = {
  files: FileCoverage[];
  firstSoldOn: IsoDay | null;
  lastSoldOn: IsoDay | null;
  recordFirst: number | null;
  recordLast: number | null;
  /** Gaps in the combined chain, across file borders. */
  gaps: RecordGap[];
  chainComplete: boolean;
  ordersWithoutRecordNo: number;
  /** Pairs of files whose date ranges overlap. Not an error — an overlap is deduplicated. */
  overlappingFiles: { a: string; b: string }[];
};

/** Walk the chain in record order and return every place where it breaks. */
export function chainGaps(orders: readonly ExternalOrder[]): RecordGap[] {
  const numbered = orders.filter((o) => o.recordNo !== null)
    .sort((a, b) => (a.recordNo as number) - (b.recordNo as number));
  const gaps: RecordGap[] = [];
  for (let i = 1; i < numbered.length; i += 1) {
    const prev = numbered[i - 1];
    const next = numbered[i];
    const missing = (next.recordNo as number) - recordsConsumed(next) - (prev.recordNo as number);
    if (missing !== 0) {
      gaps.push({
        afterRecord: prev.recordNo as number, afterSoldOn: prev.soldOn,
        beforeRecord: next.recordNo as number, beforeSoldOn: next.soldOn,
        missingNumbers: missing,
      });
    }
  }
  return gaps;
}

function dayRange(orders: readonly ExternalOrder[]): [IsoDay | null, IsoDay | null] {
  if (orders.length === 0) return [null, null];
  const days = orders.map((o) => o.soldOn).sort();
  return [days[0], days[days.length - 1]];
}

function recordRange(orders: readonly ExternalOrder[]): [number | null, number | null] {
  const numbers = orders.map((o) => o.recordNo).filter((n): n is number => n !== null);
  return numbers.length === 0 ? [null, null] : [Math.min(...numbers), Math.max(...numbers)];
}

export function fileCoverage(report: ExternalReport): FileCoverage {
  const [firstSoldOn, lastSoldOn] = dayRange(report.orders);
  const [recordFirst, recordLast] = recordRange(report.orders);
  const months: Record<string, number> = {};
  for (const o of report.orders) months[o.soldOn.slice(0, 7)] = (months[o.soldOn.slice(0, 7)] ?? 0) + 1;
  return {
    fileName: report.fileName,
    orders: report.orders.length,
    footerCount: report.footerCount,
    footerMatches: report.footerCount === null ? null : report.footerCount === report.orders.length,
    firstSoldOn, lastSoldOn, months, recordFirst, recordLast,
    gaps: chainGaps(report.orders),
  };
}

/**
 * Coverage of all reports together. `orders` is the merged, deduplicated set
 * (`mergeReports`) — the chain is checked across file borders on it.
 */
export function coverageOf(reports: readonly ExternalReport[], orders: readonly ExternalOrder[]): Coverage {
  const files = reports.map(fileCoverage);
  const [firstSoldOn, lastSoldOn] = dayRange(orders);
  const [recordFirst, recordLast] = recordRange(orders);
  const gaps = chainGaps(orders);

  const overlappingFiles: Coverage["overlappingFiles"] = [];
  for (let i = 0; i < files.length; i += 1) {
    for (let j = i + 1; j < files.length; j += 1) {
      const a = files[i];
      const b = files[j];
      if (!a.firstSoldOn || !a.lastSoldOn || !b.firstSoldOn || !b.lastSoldOn) continue;
      if (a.firstSoldOn <= b.lastSoldOn && b.firstSoldOn <= a.lastSoldOn) {
        overlappingFiles.push({ a: a.fileName, b: b.fileName });
      }
    }
  }

  return {
    files, firstSoldOn, lastSoldOn, recordFirst, recordLast, gaps,
    chainComplete: gaps.length === 0 && orders.every((o) => o.recordNo !== null),
    ordersWithoutRecordNo: orders.filter((o) => o.recordNo === null).length,
    overlappingFiles,
  };
}

/**
 * Can a SkyIsles sale on this day be judged against the reports?
 *
 * Outside the covered period, or inside a chain gap: no — a sale there with no
 * report counterpart proves nothing. On the first or last covered day: yes,
 * but marked as an edge, because an order on that day may sit outside the files.
 */
export function judgeDay(coverage: Coverage, day: IsoDay | null): DayVerdict {
  if (!coverage.firstSoldOn || !coverage.lastSoldOn || day === null) return { comparable: false, reason: "no_coverage" };
  if (day < coverage.firstSoldOn) return { comparable: false, reason: "before_coverage" };
  if (day > coverage.lastSoldOn) return { comparable: false, reason: "after_coverage" };
  if (coverage.gaps.some((g) => g.missingNumbers > 0 && day >= g.afterSoldOn && day <= g.beforeSoldOn)) {
    return { comparable: false, reason: "inside_gap" };
  }
  return { comparable: true, edge: day === coverage.firstSoldOn || day === coverage.lastSoldOn };
}
