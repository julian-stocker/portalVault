/**
 * What the reconciliation screen reads — the database's answers, typed.
 *
 * `seller_recon_sessions()` and `seller_recon_session()` (0172) return JSON.
 * `server/queries.ts` hands it over as `Record<string, unknown>`; this file
 * turns it into the types the screen renders, and refuses anything that is
 * not in the shape the contract promises.
 *
 * DESCRIBES, NEVER DECIDES
 *
 * Nothing here matches, diffs, counts pending decisions or predicts what an
 * application would change. Which decisions a finding allows comes from the
 * database (`allowedDecisions`, computed by `sales_recon_allowed`), not from
 * `diff.ts`. `lock` only RESTATES three facts the database already returned
 * (session state, `applied`, `stale`) so a control can be disabled — the
 * database refuses the same calls on its own (`seller_recon_decide`).
 *
 * TWO KEY CONVENTIONS, BECAUSE THE FUNCTIONS BUILD THEM TWO WAYS
 *
 *   snake_case   `session`, `files` and a match's `order` — `to_jsonb(row)`
 *   camelCase    the session list, a match, its `sale`, `ledger` and
 *                `findings`, and the order's `lines` (stored as the payload
 *                sent them)
 *
 * THE SHOWN VALUES STAY RAW. `seller_recon_decide` compares the two values the
 * screen showed with the stored ones (0156 pattern, PT409 otherwise). So
 * `Finding.shown` keeps them exactly as they arrived — never formatted, never
 * rounded, never converted — and a later decision sends them back unchanged.
 *
 * A broken answer throws `ViewContractError`, naming the path and never a
 * value: a report title or an order number does not belong in a server log.
 */

import type { CauseCode, Category as DiffCategory, Decision, FindingField } from "./diff.ts";
import type { Certainty as MatchCertainty, NotComparableReason } from "./match.ts";
import type { LedgerPiece, ReportIssue } from "./types.ts";

// ---------------------------------------------------------------------------
// The vocabularies — each exactly the list of its CHECK constraint in 0169
// (`view.test.ts` compares them with the migration text).
// ---------------------------------------------------------------------------

export const SESSION_STATES = ["open", "closed", "discarded"] as const;
export type SessionState = (typeof SESSION_STATES)[number];

export const CATEGORIES = [
  "exact", "deviating", "probable", "ambiguous", "external_only", "ledger_only", "not_comparable",
] as const;
export type Category = (typeof CATEGORIES)[number];

/**
 * The categories that ARE an order/sale pair — exactly the ones 0169's
 * `sales_recon_matches_shape` requires an order AND a sale for. Every other
 * stored match row is one side only: an order (`external_only`) or a sale
 * (`ledger_only`, `not_comparable`).
 */
export const PAIR_CATEGORIES = ["exact", "deviating", "probable", "ambiguous"] as const satisfies readonly Category[];

/**
 * How the stored match rows of a summary divide — counted, never computed
 * from anything but the stored per-category numbers.
 *
 *   pairs        an order and a sale side by side
 *   reportOnly   an order with no sale (`external_only`)
 *   ledgerOnly   a sale INSIDE the covered period with no order — the only
 *                row that can mean "missing from the report"
 *   unpaired     a sale loaded as a candidate that cannot be judged
 *                (`not_comparable`: outside the period but inside the ±3 day
 *                search window, an edge day, a gap, a test sale) — never a
 *                missing order
 *   records      every stored match row, the sum of the above
 */
export function pairingCounts(categories: Record<Category, number>): {
  pairs: number; reportOnly: number; ledgerOnly: number; unpaired: number; records: number;
} {
  const pairs = PAIR_CATEGORIES.reduce((n, c) => n + categories[c], 0);
  const reportOnly = categories.external_only;
  const ledgerOnly = categories.ledger_only;
  const unpaired = categories.not_comparable;
  return { pairs, reportOnly, ledgerOnly, unpaired, records: pairs + reportOnly + ledgerOnly + unpaired };
}

export const CERTAINTIES = ["deterministic", "unique", "probable", "ambiguous"] as const;
export type Certainty = (typeof CERTAINTIES)[number];

export const NOT_COMPARABLE_REASONS = [
  "test", "no_date", "before_coverage", "after_coverage", "inside_gap", "no_coverage", "edge_day",
] as const satisfies readonly NotComparableReason[];

export const FINDING_FIELDS = [
  "sold_on", "items_net", "shipping", "pieces", "figure", "total", "external_order_ref",
] as const satisfies readonly FindingField[];

export const FINDING_KINDS = ["deviation", "addition"] as const;
export type FindingKind = (typeof FINDING_KINDS)[number];

export const DECISIONS = ["take_external", "keep_ledger", "manual", "defer"] as const satisfies readonly Decision[];

export const CAUSE_CODES = [
  "matches_payment_date", "matches_shipping_date", "ledger_discount_not_in_report",
  "report_total_zero_not_shipped", "report_total_zero_after_shipping", "report_total_reduced",
  "report_total_increased", "ledger_cancelled", "ledger_refund_not_in_report", "follows_from_other_fields",
] as const satisfies readonly CauseCode[];

/** The reader's codes (`types.ts`), for the check before an upload. */
export const REPORT_ISSUE_CODES = [
  "ragged_row", "invalid_date", "invalid_money", "invalid_quantity", "foreign_currency",
  "line_without_reference", "summary_without_lines", "several_summaries", "several_lines_without_summary",
  "items_value_mismatch", "quantity_mismatch", "record_number_differs",
] as const satisfies readonly ReportIssue["code"][];

// Each list is complete: a code added to the model without a list entry fails the typecheck here.
type Missing<All, Listed> = Exclude<All, Listed>;
const complete = <T extends never>(): T | undefined => undefined;
complete<Missing<DiffCategory, Category>>();
complete<Missing<MatchCertainty, Certainty>>();
complete<Missing<NotComparableReason, (typeof NOT_COMPARABLE_REASONS)[number]>>();
complete<Missing<FindingField, (typeof FINDING_FIELDS)[number]>>();
complete<Missing<Decision, (typeof DECISIONS)[number]>>();
complete<Missing<CauseCode, (typeof CAUSE_CODES)[number]>>();
complete<Missing<ReportIssue["code"], (typeof REPORT_ISSUE_CODES)[number]>>();

/** How far SkyIsles' value at analysis is proven (0179, `sales_recon_proven`). */
export const LEDGER_BASES = ["stored", "derived", "unknown"] as const;
export type LedgerBasis = (typeof LEDGER_BASES)[number];

/** How the sale relates to the analysed version (0178). */
export const LEDGER_STATES = ["unchanged", "applied", "changed"] as const;
export type LedgerState = (typeof LEDGER_STATES)[number];

/** The five fields `ledger.atAnalysis` carries, in the order the screen shows them. */
export const LEDGER_FIELDS = ["soldOn", "itemsNet", "shipping", "expectedTotal", "pieces"] as const;
export type LedgerField = (typeof LEDGER_FIELDS)[number];

/** `seller_recon_session` serves 1 to 200 rows per page (0172). */
export const PAGE_LIMIT_MAX = 200;
export const PAGE_LIMIT_DEFAULT = 50;

// ---------------------------------------------------------------------------
// The types the screen renders
// ---------------------------------------------------------------------------

/** One scalar exactly as the database stored it. */
export type JsonScalar = string | number | null;

export type MoneyTotals = { positive: number; negative: number; balance: number; count: number };

/**
 * The session's counts (`summarize()` in `diff.ts`, stored as numbers only).
 * Informational: when it does not have this shape the screen shows no
 * summary rather than refusing the session.
 */
export type SessionSummary = {
  categories: Record<Category, number>;
  byMonth: Record<string, Record<Category, number>>;
  money: Record<"items_net" | "shipping" | "total", MoneyTotals>;
  deviations: Record<Exclude<FindingField, "external_order_ref">, number>;
  referenceAdditions: number;
};

/** One row of `seller_recon_sessions()`. */
export type SessionListItem = {
  id: number;
  channel: string;
  state: SessionState;
  coveredFrom: string | null;
  coveredTo: string | null;
  chainComplete: boolean;
  createdAt: string;
  closedAt: string | null;
  discardedAt: string | null;
  snapshotsPurgedAt: string | null;
  summary: SessionSummary | null;
  /** Number of files. */
  files: number;
  /** Findings with at least one decision of any kind — `defer` included. */
  decided: number;
  /** Rows in `sales_recon_applications`. */
  applied: number;
};

export type SessionHeader = {
  id: number;
  channel: string;
  parser: string;
  parserVersion: number;
  state: SessionState;
  coveredFrom: string | null;
  coveredTo: string | null;
  recordFirst: number | null;
  recordLast: number | null;
  chainComplete: boolean;
  summary: SessionSummary | null;
  createdAt: string;
  closedAt: string | null;
  discardedAt: string | null;
  snapshotsPurgedAt: string | null;
};

export type SessionFile = {
  id: number;
  fileName: string;
  fingerprint: string;
  footerCount: number | null;
  orders: number;
  firstSoldOn: string | null;
  lastSoldOn: string | null;
  recordFirst: number | null;
  recordLast: number | null;
};

export type OrderLine = {
  lineRef: string | null;
  listingId: string;
  title: string;
  variant: string | null;
  name: string;
  quantity: number;
  unitPrice: number;
  value: number;
};

export type SessionOrder = {
  id: number;
  channel: string;
  orderRef: string;
  recordNo: number | null;
  soldOn: string;
  paidOn: string | null;
  shippedOn: string | null;
  itemsValue: number;
  shipping: number;
  total: number;
  pieces: number;
  combined: boolean;
  destinationCountry: string | null;
  shippingService: string | null;
  sourceFile: string;
  /** Null once the session's snapshots were purged. */
  lines: OrderLine[] | null;
};

/** The sale AS IT IS NOW, not as the analysis saw it. */
export type SessionSale = {
  id: number;
  soldOn: string | null;
  itemsSubtotal: number | null;
  discount: number | null;
  shipping: number | null;
  cancelledOn: string | null;
  externalOrderRef: string | null;
  source: string;
  /** The sale changed since the analysis (`updated_at` ≠ snapshot). */
  stale: boolean;
};

export type Cause = { code: string; known: boolean; amount: number | null };

export type CurrentDecision = {
  id: number;
  decision: Decision;
  /** Shape depends on the field (0169 comment); shown, never interpreted here. */
  manualValue: Readonly<Record<string, unknown>> | null;
  reason: string | null;
  decidedAt: string;
};

/**
 * Why a finding cannot be decided right now — the database's own refusals
 * restated, so the screen can say it before a click. Null: decidable.
 */
export type FindingLock = "session_not_open" | "applied" | "stale" | null;

export type Finding = {
  id: number;
  key: string;
  field: FindingField;
  kind: FindingKind;
  /** Exactly as stored — send these back to `seller_recon_decide` unchanged. */
  shown: { readonly ledger: JsonScalar; readonly external: JsonScalar };
  delta: number | null;
  causes: Cause[];
  /** From the database, in its order. The screen offers these and no others. */
  allowedDecisions: Decision[];
  decision: CurrentDecision | null;
  applied: boolean;
  lock: FindingLock;
};

export type Competitor = { orderRef: string; saleId: number; score: number };

/**
 * One field of `ledger.atAnalysis`, exactly as the database proved it.
 *
 *   stored    the finding's SkyIsles value — recorded at analysis; under
 *             `changed` it is that record, not re-proven
 *   derived   no finding, and the database showed the report value equals
 *             what SkyIsles held then
 *   unknown   no proof — `value` is null, never a stand-in
 */
export type AtAnalysisValue = { readonly value: JsonScalar; readonly basis: LedgerBasis };

/** What SkyIsles holds NOW (`sales_recon_sale_values`, 0178). */
export type LedgerCurrent = {
  soldOn: string | null;
  itemsSubtotal: number;
  discount: number;
  itemsNet: number;
  shipping: number;
  refundsTotal: number;
  cancelledOn: string | null;
  expectedTotal: number;
  pieces: number;
  externalOrderRef: string | null;
  isTest: boolean;
};

/**
 * The SkyIsles side of a match (0178, proof since 0179). Null exactly when
 * the match has no sale. Nothing here is computed on the client: the screen
 * shows `atAnalysis` as the database proved it.
 */
export type Ledger = {
  state: LedgerState;
  version: { analysed: string | null; current: string | null };
  current: LedgerCurrent;
  atAnalysis: Readonly<Record<LedgerField, AtAnalysisValue>>;
};

export type Match = {
  id: number;
  category: Category;
  certainty: Certainty | null;
  score: number | null;
  dateDelta: number | null;
  competitors: Competitor[];
  reason: NotComparableReason | null;
  order: SessionOrder | null;
  sale: SessionSale | null;
  /** Null exactly when `sale` is null. */
  ledger: Ledger | null;
  findings: Finding[];
  /**
   * The sale's positions as they are NOW — attached by the session page, never
   * read from the session (`attachLivePieces`, `live.ts`). Absent: the figures
   * are not judged again.
   */
  livePieces?: {
    pieces: readonly LedgerPiece[];
    /** The aliases of exactly these figures, `[skyId, names]`. */
    aliases: readonly (readonly [string, readonly string[]])[];
  };
  /**
   * The unpaired sales that make 0180 refuse taking over the order number
   * (`rival_sale`) — recomputed by the database's own rule for display
   * (`rivals.ts`, attached by `attachRivals`). Absent: not computed; empty:
   * none. Display only: the decision stays the database's.
   */
  rivals?: readonly RivalSale[];
  /** The unpaired ORDERS of the session that would rival this pair (`rival_order`). Absent: not computed. */
  rivalOrders?: readonly RivalOrder[];
  /**
   * For an unmatched order: the sale that carries its number now (created
   * from the report, 0183, or by hand) — `null` none, absent not looked up.
   */
  createdSaleId?: number | null;
  /**
   * For an unmatched order no sale carries the number of: the existing sales
   * it could be, scored again at page load (`candidates.ts`) — a
   * recommendation, never an assignment. Absent: not computed.
   */
  candidates?: { shown: readonly CandidateExplanation[]; more: number };
  /** For an unmatched order whose number a sale carries now: that sale, compared again. */
  linkedComparison?: CandidateExplanation;
};

import type { CandidateExplanation } from "./candidates";

/** One unpaired sale the database would see as a rival of a pair (`rival_sale`, 0180). */
export type RivalSale = {
  saleId: number;
  soldOn: string;
  /** The figure names this sale shares with the report's lines, as SkyIsles writes them. */
  shared: readonly string[];
  /** All of its positions, raw — so the operator can judge which order it really is. */
  pieces: readonly string[];
  /** Its version as read — an exclusion (0186) holds only for exactly this state. */
  updatedAt: string | null;
};

/** Another unpaired order of the session the database would see as a rival (`rival_order`, 0180). */
export type RivalOrder = { orderId: number; orderRef: string; soldOn: string; shared: readonly string[] };

export type PageInfo = {
  category: Category | null;
  offset: number;
  limit: number;
  /** Matches in the category (or all), across every page. */
  total: number;
  /** 1-based; 1 when there is nothing. */
  page: number;
  pages: number;
  previousOffset: number | null;
  nextOffset: number | null;
};

export type SessionPage = {
  session: SessionHeader;
  files: SessionFile[];
  matches: Match[];
  page: PageInfo;
};

export type PageRequest = { category: Category | null; offset: number; limit: number };

// ---------------------------------------------------------------------------
// Reading primitives — each names a path on failure, never a value
// ---------------------------------------------------------------------------

export class ViewContractError extends Error {
  constructor(readonly path: string, problem: string) {
    super(`reconciliation view: ${path}: ${problem}`);
    this.name = "ViewContractError";
  }
}

type Obj = Record<string, unknown>;

function obj(value: unknown, path: string): Obj {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new ViewContractError(path, "not an object");
  return value as Obj;
}

function arr(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new ViewContractError(path, "not a list");
  return value;
}

function has(o: Obj, key: string, path: string): unknown {
  if (!(key in o)) throw new ViewContractError(`${path}.${key}`, "missing");
  return o[key];
}

function str(o: Obj, key: string, path: string): string {
  const v = has(o, key, path);
  if (typeof v !== "string") throw new ViewContractError(`${path}.${key}`, "not text");
  return v;
}

function optStr(o: Obj, key: string, path: string): string | null {
  const v = has(o, key, path);
  if (v === null) return null;
  if (typeof v !== "string") throw new ViewContractError(`${path}.${key}`, "not text");
  return v;
}

/** PostgREST may deliver a numeric as a string; anything else is refused. */
function toNumber(v: unknown, path: string): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n)) throw new ViewContractError(path, "not a number");
  return n;
}

function num(o: Obj, key: string, path: string): number {
  return toNumber(has(o, key, path), `${path}.${key}`);
}

function optNum(o: Obj, key: string, path: string): number | null {
  const v = has(o, key, path);
  return v === null ? null : toNumber(v, `${path}.${key}`);
}

function int(o: Obj, key: string, path: string): number {
  const n = num(o, key, path);
  if (!Number.isSafeInteger(n)) throw new ViewContractError(`${path}.${key}`, "not a whole number");
  return n;
}

function optInt(o: Obj, key: string, path: string): number | null {
  const n = optNum(o, key, path);
  if (n !== null && !Number.isSafeInteger(n)) throw new ViewContractError(`${path}.${key}`, "not a whole number");
  return n;
}

function bool(o: Obj, key: string, path: string): boolean {
  const v = has(o, key, path);
  if (typeof v !== "boolean") throw new ViewContractError(`${path}.${key}`, "not true or false");
  return v;
}

function oneOf<T extends string>(o: Obj, key: string, list: readonly T[], path: string): T {
  const v = str(o, key, path);
  if (!(list as readonly string[]).includes(v)) throw new ViewContractError(`${path}.${key}`, "unknown value");
  return v as T;
}

function optOneOf<T extends string>(o: Obj, key: string, list: readonly T[], path: string): T | null {
  return has(o, key, path) === null ? null : oneOf(o, key, list, path);
}

function scalar(o: Obj, key: string, path: string): JsonScalar {
  const v = has(o, key, path);
  if (v === null || typeof v === "string" || (typeof v === "number" && Number.isFinite(v))) return v;
  throw new ViewContractError(`${path}.${key}`, "not a single value");
}

// ---------------------------------------------------------------------------
// The summary — tolerant, because it is only shown
// ---------------------------------------------------------------------------

function countRecord<K extends string>(value: unknown, keys: readonly K[]): Record<K, number> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const out = {} as Record<K, number>;
  for (const k of keys) {
    const n = (value as Obj)[k];
    if (typeof n !== "number" || !Number.isFinite(n)) return null;
    out[k] = n;
  }
  return out;
}

const DEVIATION_FIELDS = ["sold_on", "items_net", "shipping", "pieces", "figure", "total"] as const;
const MONEY_FIELDS = ["items_net", "shipping", "total"] as const;
const MONEY_KEYS = ["positive", "negative", "balance", "count"] as const;

/** `null` when the stored summary is not in the shape `summarize()` writes. */
export function summaryView(value: unknown): SessionSummary | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const s = value as Obj;
  const categories = countRecord(s.categories, CATEGORIES);
  const deviations = countRecord(s.deviations, DEVIATION_FIELDS);
  const moneyRaw = s.money;
  if (!categories || !deviations || moneyRaw === null || typeof moneyRaw !== "object") return null;
  const money = {} as SessionSummary["money"];
  for (const f of MONEY_FIELDS) {
    const t = countRecord((moneyRaw as Obj)[f], MONEY_KEYS);
    if (!t) return null;
    money[f] = t;
  }
  const byMonth: SessionSummary["byMonth"] = {};
  if (s.byMonth === null || typeof s.byMonth !== "object" || Array.isArray(s.byMonth)) return null;
  for (const [month, counts] of Object.entries(s.byMonth as Obj)) {
    const c = countRecord(counts, CATEGORIES);
    if (!c) return null;
    byMonth[month] = c;
  }
  if (typeof s.referenceAdditions !== "number") return null;
  return { categories, byMonth, money, deviations, referenceAdditions: s.referenceAdditions };
}

// ---------------------------------------------------------------------------
// seller_recon_sessions()
// ---------------------------------------------------------------------------

export function sessionListView(value: unknown): SessionListItem[] {
  return arr(value, "sessions").map((raw, i) => {
    const p = `sessions[${i}]`;
    const o = obj(raw, p);
    return {
      id: int(o, "id", p),
      channel: str(o, "channel", p),
      state: oneOf(o, "state", SESSION_STATES, p),
      coveredFrom: optStr(o, "coveredFrom", p),
      coveredTo: optStr(o, "coveredTo", p),
      chainComplete: bool(o, "chainComplete", p),
      createdAt: str(o, "createdAt", p),
      closedAt: optStr(o, "closedAt", p),
      discardedAt: optStr(o, "discardedAt", p),
      snapshotsPurgedAt: optStr(o, "snapshotsPurgedAt", p),
      summary: summaryView(has(o, "summary", p)),
      files: int(o, "files", p),
      decided: int(o, "decided", p),
      applied: int(o, "applied", p),
    };
  });
}

// ---------------------------------------------------------------------------
// seller_recon_session(id, category, offset, limit)
// ---------------------------------------------------------------------------

function headerView(raw: unknown): SessionHeader {
  const p = "session";
  const o = obj(raw, p);
  return {
    id: int(o, "id", p),
    channel: str(o, "channel", p),
    parser: str(o, "parser", p),
    parserVersion: int(o, "parser_version", p),
    state: oneOf(o, "state", SESSION_STATES, p),
    coveredFrom: optStr(o, "covered_from", p),
    coveredTo: optStr(o, "covered_to", p),
    recordFirst: optInt(o, "record_first", p),
    recordLast: optInt(o, "record_last", p),
    chainComplete: bool(o, "chain_complete", p),
    summary: summaryView(has(o, "summary", p)),
    createdAt: str(o, "created_at", p),
    closedAt: optStr(o, "closed_at", p),
    discardedAt: optStr(o, "discarded_at", p),
    snapshotsPurgedAt: optStr(o, "snapshots_purged_at", p),
  };
}

function fileView(raw: unknown, i: number): SessionFile {
  const p = `files[${i}]`;
  const o = obj(raw, p);
  return {
    id: int(o, "id", p),
    fileName: str(o, "file_name", p),
    fingerprint: str(o, "fingerprint", p),
    footerCount: optInt(o, "footer_count", p),
    orders: int(o, "orders", p),
    firstSoldOn: optStr(o, "first_sold_on", p),
    lastSoldOn: optStr(o, "last_sold_on", p),
    recordFirst: optInt(o, "record_first", p),
    recordLast: optInt(o, "record_last", p),
  };
}

function lineView(raw: unknown, path: string): OrderLine {
  const o = obj(raw, path);
  return {
    lineRef: optStr(o, "lineRef", path),
    listingId: str(o, "listingId", path),
    title: str(o, "title", path),
    variant: optStr(o, "variant", path),
    name: str(o, "name", path),
    quantity: int(o, "quantity", path),
    unitPrice: num(o, "unitPrice", path),
    value: num(o, "value", path),
  };
}

function orderView(raw: unknown, path: string): SessionOrder | null {
  if (raw === null) return null;
  const o = obj(raw, path);
  const lines = has(o, "lines", path);
  return {
    id: int(o, "id", path),
    channel: str(o, "channel", path),
    orderRef: str(o, "order_ref", path),
    recordNo: optInt(o, "record_no", path),
    soldOn: str(o, "sold_on", path),
    paidOn: optStr(o, "paid_on", path),
    shippedOn: optStr(o, "shipped_on", path),
    itemsValue: num(o, "items_value", path),
    shipping: num(o, "shipping", path),
    total: num(o, "total", path),
    pieces: int(o, "pieces", path),
    combined: bool(o, "combined", path),
    destinationCountry: optStr(o, "destination_country", path),
    shippingService: optStr(o, "shipping_service", path),
    sourceFile: str(o, "source_file", path),
    lines: lines === null ? null : arr(lines, `${path}.lines`).map((l, k) => lineView(l, `${path}.lines[${k}]`)),
  };
}

function saleView(raw: unknown, path: string): SessionSale | null {
  if (raw === null) return null;
  const o = obj(raw, path);
  return {
    id: int(o, "id", path),
    soldOn: optStr(o, "soldOn", path),
    itemsSubtotal: optNum(o, "itemsSubtotal", path),
    discount: optNum(o, "discount", path),
    shipping: optNum(o, "shipping", path),
    cancelledOn: optStr(o, "cancelledOn", path),
    externalOrderRef: optStr(o, "externalOrderRef", path),
    source: str(o, "source", path),
    stale: bool(o, "stale", path),
  };
}

function causeView(raw: unknown, path: string): Cause {
  const o = obj(raw, path);
  const code = str(o, "code", path);
  // `amount` is optional in the stored cause (only some codes carry one).
  const amount = "amount" in o ? optNum(o, "amount", path) : null;
  return { code, known: (CAUSE_CODES as readonly string[]).includes(code), amount };
}

function decisionView(raw: unknown, path: string): CurrentDecision | null {
  if (raw === null) return null;
  const o = obj(raw, path);
  const manual = has(o, "manualValue", path);
  return {
    id: int(o, "id", path),
    decision: oneOf(o, "decision", DECISIONS, path),
    manualValue: manual === null ? null : Object.freeze({ ...obj(manual, `${path}.manualValue`) }),
    reason: optStr(o, "reason", path),
    decidedAt: str(o, "decidedAt", path),
  };
}

function findingView(raw: unknown, path: string, sessionOpen: boolean, stale: boolean): Finding {
  const o = obj(raw, path);
  const allowed = arr(has(o, "allowedDecisions", path), `${path}.allowedDecisions`).map((d, k) => {
    if (typeof d !== "string" || !(DECISIONS as readonly string[]).includes(d)) {
      throw new ViewContractError(`${path}.allowedDecisions[${k}]`, "unknown decision");
    }
    return d as Decision;
  });
  if (allowed.length === 0) throw new ViewContractError(`${path}.allowedDecisions`, "empty");
  const applied = bool(o, "applied", path);
  return {
    id: int(o, "id", path),
    key: str(o, "key", path),
    field: oneOf(o, "field", FINDING_FIELDS, path),
    kind: oneOf(o, "kind", FINDING_KINDS, path),
    shown: Object.freeze({ ledger: scalar(o, "ledger", path), external: scalar(o, "external", path) }),
    delta: optNum(o, "delta", path),
    causes: arr(has(o, "causes", path), `${path}.causes`).map((c, k) => causeView(c, `${path}.causes[${k}]`)),
    allowedDecisions: allowed,
    decision: decisionView(has(o, "decision", path), `${path}.decision`),
    applied,
    // The order of the database's own checks in `seller_recon_decide`.
    lock: !sessionOpen ? "session_not_open" : applied ? "applied" : stale ? "stale" : null,
  };
}

function competitorView(raw: unknown, path: string): Competitor {
  const o = obj(raw, path);
  return { orderRef: str(o, "orderRef", path), saleId: int(o, "saleId", path), score: num(o, "score", path) };
}

function atAnalysisView(raw: unknown, path: string): AtAnalysisValue {
  const o = obj(raw, path);
  const basis = oneOf(o, "basis", LEDGER_BASES, path);
  const value = scalar(o, "value", path);
  // The 0179 contract: no proof, no value — and a proven value is never empty.
  if (basis === "unknown" && value !== null) throw new ViewContractError(`${path}.value`, "unknown with a value");
  if (basis !== "unknown" && value === null) throw new ViewContractError(`${path}.value`, "proven without a value");
  return Object.freeze({ value, basis });
}

function ledgerView(raw: unknown, path: string): Ledger | null {
  if (raw === null) return null;
  const o = obj(raw, path);
  const version = obj(has(o, "version", path), `${path}.version`);
  const current = obj(has(o, "current", path), `${path}.current`);
  const at = obj(has(o, "atAnalysis", path), `${path}.atAnalysis`);
  const cp = `${path}.current`;
  const atAnalysis = {} as Record<LedgerField, AtAnalysisValue>;
  for (const f of LEDGER_FIELDS) atAnalysis[f] = atAnalysisView(has(at, f, `${path}.atAnalysis`), `${path}.atAnalysis.${f}`);
  return {
    state: oneOf(o, "state", LEDGER_STATES, path),
    version: { analysed: optStr(version, "analysed", `${path}.version`), current: optStr(version, "current", `${path}.version`) },
    current: {
      soldOn: optStr(current, "soldOn", cp),
      itemsSubtotal: num(current, "itemsSubtotal", cp),
      discount: num(current, "discount", cp),
      itemsNet: num(current, "itemsNet", cp),
      shipping: num(current, "shipping", cp),
      refundsTotal: num(current, "refundsTotal", cp),
      cancelledOn: optStr(current, "cancelledOn", cp),
      expectedTotal: num(current, "expectedTotal", cp),
      pieces: int(current, "pieces", cp),
      externalOrderRef: optStr(current, "externalOrderRef", cp),
      isTest: bool(current, "isTest", cp),
    },
    atAnalysis: Object.freeze(atAnalysis),
  };
}

function matchView(raw: unknown, i: number, sessionOpen: boolean): Match {
  const p = `matches[${i}]`;
  const o = obj(raw, p);
  const sale = saleView(has(o, "sale", p), `${p}.sale`);
  const stale = sale?.stale ?? false;
  const ledger = ledgerView(has(o, "ledger", p), `${p}.ledger`);
  if ((sale === null) !== (ledger === null)) throw new ViewContractError(`${p}.ledger`, sale ? "missing for a sale" : "without a sale");
  return {
    id: int(o, "id", p),
    category: oneOf(o, "category", CATEGORIES, p),
    certainty: optOneOf(o, "certainty", CERTAINTIES, p),
    score: optNum(o, "score", p),
    dateDelta: optInt(o, "dateDelta", p),
    competitors: arr(has(o, "competitors", p), `${p}.competitors`).map((c, k) => competitorView(c, `${p}.competitors[${k}]`)),
    reason: optOneOf(o, "reason", NOT_COMPARABLE_REASONS, p),
    order: orderView(has(o, "order", p), `${p}.order`),
    sale,
    ledger,
    findings: arr(has(o, "findings", p), `${p}.findings`).map((f, k) => findingView(f, `${p}.findings[${k}]`, sessionOpen, stale)),
  };
}

function pageInfo(request: PageRequest, total: number): PageInfo {
  const { offset, limit } = request;
  return {
    category: request.category,
    offset,
    limit,
    total,
    page: Math.floor(offset / limit) + 1,
    pages: Math.max(1, Math.ceil(total / limit)),
    previousOffset: offset > 0 ? Math.max(0, offset - limit) : null,
    nextOffset: offset + limit < total ? offset + limit : null,
  };
}

/**
 * One page of one session. `request` is what was passed to the function —
 * the answer does not repeat it, and the page arithmetic needs it.
 */
export function sessionPageView(value: unknown, request: PageRequest): SessionPage {
  const o = obj(value, "page");
  const session = headerView(has(o, "session", "page"));
  const open = session.state === "open";
  const total = int(o, "total", "page");
  return {
    session,
    files: arr(has(o, "files", "page"), "files").map(fileView),
    matches: arr(has(o, "matches", "page"), "matches").map((m, i) => matchView(m, i, open)),
    page: pageInfo(request, total),
  };
}

/**
 * The page a URL asks for — `?kategorie=deviating&seite=2`. Anything unknown
 * falls back to the first page of everything; the result is always a request
 * `seller_recon_session` accepts (limit 1–200, offset ≥ 0).
 */
export function pageRequest(
  params: { kategorie?: string | null; seite?: string | null },
  limit: number = PAGE_LIMIT_DEFAULT,
): PageRequest {
  const safeLimit = Number.isSafeInteger(limit) ? Math.min(Math.max(limit, 1), PAGE_LIMIT_MAX) : PAGE_LIMIT_DEFAULT;
  const category = (CATEGORIES as readonly string[]).includes(params.kategorie ?? "") ? (params.kategorie as Category) : null;
  const page = /^[1-9][0-9]{0,5}$/.test(params.seite ?? "") ? Number(params.seite) : 1;
  return { category, offset: (page - 1) * safeLimit, limit: safeLimit };
}
