/**
 * Reconstructing the 2026 business stock history from `Order 2026` (ADR-0102).
 *
 * THE CUT IS 2026-01-01 AND IT IS A BUSINESS DECISION, NOT A FILTER.
 *
 * Everything before it — the whole `Order 2025` sheet, and the fifteen
 * December-2025 purchase groups that sit at the top of the 2026 sheet — is the
 * owner's private activity. It never becomes a SkyIsles purchase, sale or
 * visible history. What the private period left behind is absorbed silently
 * into one technical opening balance, which is the only trace of it.
 *
 * WHAT THE WORKBOOK'S MARKERS MEAN, MEASURED RATHER THAN ASSUMED
 *
 *   purchase column D = `x`   put into stock
 *   purchase column D = `-`   not put into stock. 43 of the 47 such rows also
 *                             carry `C = b` (damaged) and not one of them
 *                             resolves to a catalog figure.
 *   purchase C/D both empty   not processed yet. All 111 sit in the six
 *                             newest groups, 2026-08-25 to 08-30. The markers
 *                             are filled when the parcel is worked through.
 *   sale column L = `x`       taken out of stock. Reproduces the workbook's
 *                             own sold counter on 810 of 830 rows; no other
 *                             reading comes close.
 *   sale column L = `r`       a return. They come in pairs per buyer.
 *   sale row without a number the workbook's own `Korrektur >` rows. It counts
 *                             them as outgoing itself: for `I!74` the sold
 *                             counter reads 5 = 3 sales + 2 corrections.
 *
 * THE IDENTITY IS THE FORMULA, NEVER THE FREE TEXT. `O` holds what the owner
 * typed (`Kaos`); the market-value cell holds `=T!I124`, which names one stock
 * row exactly. Four catalog figures are called Kaos, so the name alone cannot
 * decide — and where an importer once let it, it filed a Trap Team sale under
 * an Imaginators figure (0080).
 *
 * THE RECONSTRUCTION RUNS BACKWARDS, AND SAYS SO.
 *
 * The workbook's final stock is the one number we trust. So the start is
 * derived from it rather than the other way round:
 *
 *     raw_start = final - purchases + sales - corrections
 *
 * Where that is negative the workbook records more purchases than its own
 * final stock and sales can account for. The opening balance is then clamped
 * to zero and the remainder becomes a `legacy_adjustment` at the same date.
 * Both are technical values. Neither claims anything about a physical shelf,
 * and a negative adjustment least of all — which is why nothing may render a
 * running historical balance out of these rows.
 */

import { cellAt, type CellGrid } from "../import/cell-grid.ts";
import { SWAP_FORCE_HALF, normalise, serialToIso } from "./order-2026.ts";

/** The business start. Everything earlier is private and excluded. */
export const BUSINESS_CUT = "2026-01-01";

/** The workbook carries no condition dimension; all legacy stock is loose. */
export const LEGACY_CONDITION = "loose";

/** Bumping this re-imports everything under new identities, which is the point. */
export const FINGERPRINT_PREFIX = "legacy-2026-v1";

/**
 * Date cells repaired by hand, each because the workbook itself pins the
 * answer — never because a row would otherwise be inconvenient.
 *
 * `16.04.206` sits between a group dated 2026-04-14 and one dated 2026-04-16
 * in a strictly chronological sheet, and the year is short by a digit.
 *
 * The group dated 2026-12-31 is NOT here. It is the first sale group of a
 * chronological sheet and therefore almost certainly 2025-12-31, but "almost
 * certainly" is not a repair: it is excluded as a future date and reported.
 */
export const DATE_REPAIRS: Readonly<Record<string, string>> = {
  "16.04.206": "2026-04-16",
};

export type OrderSide = "purchase" | "sale";

/** One worksheet row of either order block, already pulled out of the XML. */
export type OrderRow = {
  row: number;
  /** The repeated `Datum`/`Date` header that opens a group. */
  header: boolean;
  /** The raw date cell. Only the row right after a header carries one. */
  dateRaw: string;
  /** The free text the owner typed. Provenance only. */
  name: string;
  /** Formula behind the market-value cell, without the `=`. The identity. */
  reference: string;
  /** Purchase column C. Always empty on the sale side. */
  conditionFlag: string;
  /** Purchase column D, sale column L — the stock marker. */
  stockFlag: string;
  /** The running position number. Empty means this is not a position. */
  position: string;
};

export type Exclusion =
  | "damaged"
  | "no_reference"
  | "not_a_figure"
  | "unreadable_date"
  | "future_date"
  | "before_cut"
  | "not_stock_relevant";

export type LegacyEventKind = "purchase" | "sale" | "correction";

export type LegacyEvent = {
  kind: LegacyEventKind;
  sourceSheet: string;
  sourceRow: number;
  /** ISO date of the group, or "" when the workbook's cell cannot be read. */
  occurredAt: string;
  rawName: string;
  reference: string | null;
  skyId: string | null;
  /** Signed: +1 into stock, -1 out. */
  quantity: number;
  /** Null means the event is imported. */
  excluded: Exclusion | null;
};

/** How a stock-sheet reference becomes a figure, or does not. */
export type Resolver = (reference: string) =>
  { skyId: string | null; reason: Exclusion | null };

/** `T!I124` → the reference key, or null when the cell is not one. */
export function referenceKey(formula: string): string | null {
  const match = formula.replace(/^=/, "").match(/^'?([A-Za-z0-9 ]+)'?!\$?I\$?(\d+)$/);
  return match ? `${match[1].trim()}!${match[2]}` : null;
}

/** The workbook's damage markers, in the name or in the condition column. */
export function isDamaged(name: string, conditionFlag: string): boolean {
  return /\(\s*[BbDd]\s*\)/.test(name)
    || /BESCH[ÄA]DIGT/i.test(name)
    || conditionFlag.trim().toLowerCase() === "b";
}

/** A group's date: the serial, or one of the documented repairs. */
export function groupDate(raw: string): string {
  return DATE_REPAIRS[raw] ?? serialToIso(raw) ?? "";
}

/**
 * Turn one order block into events.
 *
 * `today` is passed in rather than read from the clock: a migration that
 * classifies differently depending on when it runs is not reproducible, and
 * the future-dated group is decided by exactly this comparison.
 */
export function classifyLegacyRows(
  rows: readonly OrderRow[],
  side: OrderSide,
  options: { sheet: string; resolve: Resolver; today: string },
): LegacyEvent[] {
  const events: LegacyEvent[] = [];
  let current = "";

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (row.header) continue;

    // The date belongs to the group's first row and to no other. A stray
    // character further down a group (`Order 2026!K185` holds a lone `.`)
    // must not be mistaken for a new, unreadable group date.
    //
    // ADJACENCY IS CHECKED BY ROW NUMBER, not by array position. A worksheet
    // row with no cells at all never reaches this array, so "the previous
    // element" and "the row above" are not the same thing — and reading the
    // date off the wrong row turned 66 dated sales into undated ones the
    // first time this ran against real data.
    const previous = i > 0 ? rows[i - 1] : null;
    if (previous !== null && previous.header && previous.row === row.row - 1) {
      current = groupDate(row.dateRaw);
    }

    if (row.name === "") continue;

    const reference = referenceKey(row.reference);
    // A sale row without a running number is not a position. Those are the
    // workbook's `Korrektur >` lines, and they carry no stock marker of their
    // own worth testing — the workbook counts them as outgoing regardless.
    const isCorrection = side === "sale" && row.position === "";
    const kind: LegacyEventKind =
      isCorrection ? "correction" : side === "purchase" ? "purchase" : "sale";

    const resolved = reference === null
      ? { skyId: null, reason: null as Exclusion | null }
      : options.resolve(reference);

    let excluded: Exclusion | null = null;
    if (isDamaged(row.name, row.conditionFlag)) excluded = "damaged";
    else if (reference === null) excluded = "no_reference";
    else if (resolved.skyId === null) excluded = resolved.reason ?? "not_a_figure";
    else if (current === "") excluded = "unreadable_date";
    else if (current > options.today) excluded = "future_date";
    else if (current < BUSINESS_CUT) excluded = "before_cut";
    else if (!isCorrection && row.stockFlag !== "x") excluded = "not_stock_relevant";

    events.push({
      kind,
      sourceSheet: options.sheet,
      sourceRow: row.row,
      occurredAt: current,
      rawName: row.name,
      reference,
      skyId: resolved.skyId,
      quantity: kind === "purchase" ? 1 : -1,
      excluded,
    });
  }

  return events;
}

export type PositionPlan = {
  skyId: string;
  condition: string;
  /** The workbook's final stock for this figure. */
  finalStock: number;
  purchases: number;
  sales: number;
  corrections: number;
  /** What the backwards calculation produced, negative included. */
  rawStart: number;
  /** The clamped technical starting value written at the cut. */
  openingBalance: number;
  /** The remainder, negative or zero. Written only when non-zero. */
  legacyAdjustment: number;
  /** opening + adjustment + events. Must equal `finalStock`. */
  reconstructedFinal: number;
};

/**
 * Derive one position's technical start from its documented events.
 *
 * Deliberately NOT a search for a start that keeps every intermediate balance
 * non-negative. The owner weighed that and chose closure over plausibility:
 * the legacy data cannot support a defensible historical curve, so the
 * reconstruction states a start, lists what is documented, and guarantees only
 * the end. A screen that drew a running line through these points would be
 * inventing the very precision this decision gave up.
 */
export function planPosition(
  skyId: string,
  finalStock: number,
  events: readonly LegacyEvent[],
  condition: string = LEGACY_CONDITION,
): PositionPlan {
  const included = events.filter((event) => event.excluded === null);
  const purchases = included.filter((event) => event.kind === "purchase").length;
  const sales = included.filter((event) => event.kind === "sale").length;
  const corrections = included.filter((event) => event.kind === "correction").length;

  const net = included.reduce((sum, event) => sum + event.quantity, 0);
  const rawStart = finalStock - net;
  const openingBalance = Math.max(0, rawStart);
  const legacyAdjustment = Math.min(0, rawStart);

  return {
    skyId,
    condition,
    finalStock,
    purchases,
    sales,
    corrections,
    rawStart,
    openingBalance,
    legacyAdjustment,
    reconstructedFinal: openingBalance + legacyAdjustment + net,
  };
}

/**
 * The identity of one reconstructed event.
 *
 * Readable rather than hashed, because these get audited by eye and a row
 * whose provenance is a hex string cannot be checked against the workbook.
 */
export function eventFingerprint(event: Pick<LegacyEvent, "kind" | "sourceSheet" | "sourceRow">): string {
  return `${FINGERPRINT_PREFIX}|${event.kind}|${event.sourceSheet}!${event.sourceRow}`;
}

export function technicalFingerprint(
  kind: "opening_balance" | "legacy_adjustment",
  skyId: string,
  condition: string = LEGACY_CONDITION,
): string {
  return `${FINGERPRINT_PREFIX}|${kind}|${skyId}|${condition}`;
}

export type PlanProblem = { skyId: string; problem: string };

/**
 * The gate the importer must pass before it writes anything.
 *
 * Fail-closed on the two things that would make the reconstruction worthless:
 * an opening balance below zero, and an end state that is not the workbook's.
 * A negative `legacy_adjustment` is explicitly fine and is not a problem here.
 */
export function planProblems(plans: readonly PositionPlan[]): PlanProblem[] {
  const problems: PlanProblem[] = [];
  for (const plan of plans) {
    if (plan.openingBalance < 0) {
      problems.push({ skyId: plan.skyId, problem: `opening balance is ${plan.openingBalance}` });
    }
    if (plan.reconstructedFinal !== plan.finalStock) {
      problems.push({
        skyId: plan.skyId,
        problem: `reconstructed ${plan.reconstructedFinal} but the workbook says ${plan.finalStock}`,
      });
    }
    if (plan.legacyAdjustment > 0) {
      problems.push({ skyId: plan.skyId, problem: `adjustment ${plan.legacyAdjustment} is positive` });
    }
  }
  return problems;
}

/**
 * Where each block keeps what, by worksheet letter.
 *
 * The letters and the printed headers disagree on the sale side and always
 * have: the columns HEADED `T` and `S` are worksheet `L` and `M`, while
 * worksheet `T` is the destination country. Naming them by worksheet letter
 * is the only way not to file countries as stock markers.
 */
export const ORDER_2026_PURCHASE_COLUMNS = {
  date: "A", name: "F", value: "G", condition: "C", stock: "D", position: "E",
} as const;

export const ORDER_2026_SALE_COLUMNS = {
  date: "K", name: "O", value: "P", condition: "", stock: "L", position: "N",
} as const;

/**
 * Row 4 carries the first group header of BOTH blocks.
 *
 * Starting at row 5 — the first row with data — looks right and silently
 * leaves the first group of each block without a date. Rows 1 to 3 are the
 * German captions and the grand totals and must stay out, so the window
 * starts exactly here.
 */
export const FIRST_HEADER_ROW = 4;

export type OrderColumns = {
  date: string; name: string; value: string;
  condition: string; stock: string; position: string;
};

/** Shape one order block out of a worksheet grid. */
export function orderRowsFromGrid(grid: CellGrid, columns: OrderColumns): OrderRow[] {
  return [...grid.keys()]
    .sort((a, b) => a - b)
    .filter((row) => row >= FIRST_HEADER_ROW)
    .map((row) => {
      const date = cellAt(grid, row, columns.date).value;
      return {
        row,
        header: date === "Datum" || date === "Date",
        dateRaw: date,
        name: cellAt(grid, row, columns.name).value,
        reference: cellAt(grid, row, columns.value).formula,
        conditionFlag: columns.condition === "" ? "" : cellAt(grid, row, columns.condition).value,
        stockFlag: cellAt(grid, row, columns.stock).value,
        position: cellAt(grid, row, columns.position).value,
      };
    });
}

/** The eight sheets the workbook keeps stock on. `ZB` and `DI A` are not figures. */
export const WORKBOOK_SHEETS = ["SA", "G", "SF", "T", "SC", "I", "ZB", "DI A"] as const;
const FIGURE_SHEETS: ReadonlySet<string> = new Set(["SA", "G", "SF", "T", "SC", "I"]);

/** First data row of a stock sheet. Rows 1-3 are captions. */
export const FIRST_STOCK_ROW = 4;

export type WorkbookPositions = {
  /** `T!124` → SKY-ID, for every row that resolves to exactly one figure. */
  skyOfReference: Map<string, string>;
  /** Why a reference does not name a figure. */
  reasonOfReference: Map<string, Exclusion>;
  /** Column F summed per figure — the final physical stock, and the target. */
  finalStock: Map<string, number>;
};

/**
 * Read the eight stock sheets into figures and their final stock.
 *
 * ONE PLACE, ON PURPOSE. The history importer, its verifier and the stock
 * reconciliation all need exactly this, and the last time a reader like this
 * existed three times over, one of the copies had a regex defect that the
 * other two did not. A reconciliation that resolved figures even slightly
 * differently from the import would move real stock on a different reading of
 * the same file.
 *
 * `catalogIndex` comes from `indexCatalog`, which keys on `series|name` both
 * exactly and normalised. A row that matches no entry, or more than one, is
 * not a figure here — there is no fuzzy fallback and there must not be.
 */
export function resolveWorkbookPositions(
  grids: ReadonlyMap<string, CellGrid>,
  catalogIndex: ReadonlyMap<string, readonly { skyId: string }[]>,
): WorkbookPositions {
  const skyOfReference = new Map<string, string>();
  const reasonOfReference = new Map<string, Exclusion>();
  const finalStock = new Map<string, number>();

  for (const sheet of WORKBOOK_SHEETS) {
    const grid = grids.get(sheet);
    if (!grid) continue;

    for (const row of [...grid.keys()].sort((a, b) => a - b)) {
      if (row < FIRST_STOCK_ROW) continue;
      const name = cellAt(grid, row, "B").value;
      if (name === "") continue;

      const key = `${sheet}!${row}`;
      if (!FIGURE_SHEETS.has(sheet)
          || SWAP_FORCE_HALF.test(name)
          || isDamaged(name, "")) {
        reasonOfReference.set(key, "not_a_figure");
        continue;
      }

      const hit = catalogIndex.get(`${sheet}|${name}`)
        ?? catalogIndex.get(`${sheet}|${normalise(name)}`)
        ?? [];
      if (hit.length !== 1) {
        reasonOfReference.set(key, "not_a_figure");
        continue;
      }

      skyOfReference.set(key, hit[0].skyId);
      finalStock.set(hit[0].skyId,
        (finalStock.get(hit[0].skyId) ?? 0) + (Number(cellAt(grid, row, "F").value) || 0));
    }
  }

  return { skyOfReference, reasonOfReference, finalStock };
}

/** The resolver `classifyLegacyRows` wants, built from resolved positions. */
export function resolverFor(positions: WorkbookPositions): Resolver {
  return (reference) => ({
    skyId: positions.skyOfReference.get(reference) ?? null,
    reason: positions.skyOfReference.has(reference)
      ? null
      : (positions.reasonOfReference.get(reference) ?? "not_a_figure"),
  });
}

/**
 * Where the real catalog stops and the test figures begin.
 *
 * SKY-IDs are permanent identities and are never derived or reused
 * (CLAUDE.md), so the boundary cannot be guessed from a name — `Inventory
 * Fixture` and `Smoke Test Figur` carry ordinary series codes, one of them is
 * even `is_active`. What separates them is the reserved numeric range the
 * test suites allocate from: the real catalog ends in the low 800s, fixtures
 * live from 9000 up.
 *
 * This matters because the stock reconciliation targets the workbook, and a
 * fixture is in no workbook. Treating one as "a figure the workbook says we
 * hold zero of" would empty the position every RLS and inventory suite
 * depends on — quietly, and on the first run.
 */
export const FIRST_FIXTURE_NUMBER = 9000;

export function isFixtureSkyId(skyId: string): boolean {
  const match = /^SKY-(\d+)$/.exec(skyId);
  return match !== null && Number(match[1]) >= FIRST_FIXTURE_NUMBER;
}
