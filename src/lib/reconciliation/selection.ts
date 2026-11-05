/**
 * The preview of SELECTED decisions (0180, ADR-0178) — read and checked.
 *
 * `seller_recon_preview(session, decision_ids)` judges exactly the decisions
 * the operator selected and returns a token; `seller_recon_apply(session,
 * decision_ids, token)` applies exactly those, bound to that token. This file
 * reads the preview's answer strictly (an unknown shape is an error, never a
 * guess) and derives what a screen must show before anybody confirms.
 *
 * A LARGE DATE GAP. A `deterministic` pair (the sale already carries the
 * report's order number) may correct the day by any distance — the number
 * proves the identity, the ±3 day window is evidence only for `unique`. A
 * correction of more than three days is nevertheless unusual, so the preview
 * names it (`largeDateGap`) and the apply action refuses unless the operator
 * confirmed exactly those decisions. The secure reference is never a reason
 * to take a day over without looking.
 *
 * WHY THE PREVIEW SUFFICES. It carries `old.soldOn` (the sale now — equal to
 * the sale at analysis, since a changed sale is `stale` and refused) and
 * `target.soldOn` (the stored order's day). And an admissible `sold_on`
 * change is always `deterministic`: 0180 refuses a `unique` pair every field
 * but the order number (`unique_ref_only`). So the gap needs no new key.
 *
 * The values stay in the action's answer — never in a URL, never in a log.
 */

/** Every reason code 0180 can give — `sales_recon_take_check` and `sales_recon_decision_problem`. */
export const SELECTION_PROBLEMS = [
  "unknown_decision", "not_latest", "already_applied", "manual", "no_change",
  "unknown_finding", "field_not_takeable", "finding_kind", "not_a_pair", "uncertain", "competitors",
  "not_external", "test_sale", "cancelled", "refunded", "stale", "ref_mismatch", "unique_ref_only",
  "ref_present", "window", "report_mismatch", "ledger_mismatch", "no_difference", "ref_taken",
  "no_lines", "rival_sale", "rival_order",
] as const;
export type SelectionProblem = (typeof SELECTION_PROBLEMS)[number];

/** The four fields an apply can ever write (the whitelist of 0180). */
export const SELECTION_FIELDS = ["sold_on", "items_net", "shipping", "external_order_ref"] as const;

/** At most this many decisions per selection — the database's own limit. */
export const MAX_SELECTION = 500;

/** More days than this between SkyIsles and the report is a large date gap. */
export const LARGE_DATE_GAP_DAYS = 3;

export class SelectionContractError extends Error {
  // A plain field, not a parameter property: the Staging tools load this file with Node's type stripping.
  readonly path: string;
  constructor(path: string, reason: string) {
    super(`preview contract: ${path} ${reason}`);
    this.name = "SelectionContractError";
    this.path = path;
  }
}

export type DateGap = { from: string; to: string; days: number };

export type SelectionChange = {
  decisionId: number;
  /** NULL = applicable. */
  problem: SelectionProblem | null;
  field: string | null;
  saleId: number | null;
  orderRef: string | null;
  old: Readonly<Record<string, unknown>> | null;
  target: Readonly<Record<string, unknown>> | null;
  /** A day correction: the sale's day and the report's, and the distance. */
  dateGap: DateGap | null;
  /** More than three days — must be confirmed explicitly (see the file head). */
  largeDateGap: boolean;
};

export type SelectionPreview = {
  sessionId: number;
  sessionOpen: boolean;
  count: number;
  problems: number;
  admissible: boolean;
  staleSales: number;
  token: string | null;
  changes: readonly SelectionChange[];
};

type Obj = Record<string, unknown>;

function obj(v: unknown, path: string): Obj {
  if (v === null || typeof v !== "object" || Array.isArray(v)) throw new SelectionContractError(path, "is not an object");
  return v as Obj;
}
function has(o: Obj, key: string, path: string): unknown {
  if (!(key in o)) throw new SelectionContractError(`${path}.${key}`, "is missing");
  return o[key];
}
function int(o: Obj, key: string, path: string): number {
  const v = has(o, key, path);
  if (typeof v !== "number" || !Number.isSafeInteger(v)) throw new SelectionContractError(`${path}.${key}`, "is not an integer");
  return v;
}
function optInt(o: Obj, key: string, path: string): number | null {
  return has(o, key, path) === null ? null : int(o, key, path);
}
function bool(o: Obj, key: string, path: string): boolean {
  const v = has(o, key, path);
  if (typeof v !== "boolean") throw new SelectionContractError(`${path}.${key}`, "is not a boolean");
  return v;
}
function optStr(o: Obj, key: string, path: string): string | null {
  const v = has(o, key, path);
  if (v === null) return null;
  if (typeof v !== "string") throw new SelectionContractError(`${path}.${key}`, "is not text");
  return v;
}
function optObj(o: Obj, key: string, path: string): Readonly<Obj> | null {
  const v = has(o, key, path);
  return v === null ? null : Object.freeze({ ...obj(v, `${path}.${key}`) });
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Whole days from `a` to `b`, both ISO days; NULL if either is not one. */
export function dayDistance(a: unknown, b: unknown): number | null {
  if (typeof a !== "string" || typeof b !== "string" || !ISO_DAY.test(a) || !ISO_DAY.test(b)) return null;
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.round(ms / 86_400_000) : null;
}

function changeView(raw: unknown, i: number): SelectionChange {
  const path = `changes[${i}]`;
  const o = obj(raw, path);
  const problem = optStr(o, "problem", path);
  if (problem !== null && !(SELECTION_PROBLEMS as readonly string[]).includes(problem)) {
    throw new SelectionContractError(`${path}.problem`, "is not a known reason");
  }
  const field = optStr(o, "field", path);
  const old = optObj(o, "old", path);
  const target = optObj(o, "target", path);
  if (problem === null && (field === null || !(SELECTION_FIELDS as readonly string[]).includes(field))) {
    throw new SelectionContractError(`${path}.field`, "is not on the whitelist");
  }
  if (problem === null && (old === null || target === null)) {
    throw new SelectionContractError(path, "is applicable without old and target value");
  }
  let dateGap: DateGap | null = null;
  if (field === "sold_on" && old && target) {
    const days = dayDistance(old.soldOn, target.soldOn);
    if (days !== null) dateGap = { from: old.soldOn as string, to: target.soldOn as string, days };
  }
  return {
    decisionId: int(o, "decisionId", path),
    problem: problem as SelectionProblem | null,
    field,
    saleId: optInt(o, "saleId", path),
    orderRef: optStr(o, "orderRef", path),
    old,
    target,
    dateGap,
    // Only an applicable change needs confirming; a refused one is refused anyway.
    largeDateGap: problem === null && dateGap !== null && Math.abs(dateGap.days) > LARGE_DATE_GAP_DAYS,
  };
}

/** The answer of `seller_recon_preview`, checked key by key. */
export function selectionPreviewView(raw: unknown): SelectionPreview {
  const o = obj(raw, "preview");
  const changes = has(o, "changes", "preview");
  if (!Array.isArray(changes)) throw new SelectionContractError("preview.changes", "is not a list");
  const token = optStr(o, "token", "preview");
  if (token !== null && !/^[0-9a-f]{64}$/.test(token)) throw new SelectionContractError("preview.token", "is not a token");
  const view: SelectionPreview = {
    sessionId: int(o, "sessionId", "preview"),
    sessionOpen: bool(o, "sessionOpen", "preview"),
    count: int(o, "count", "preview"),
    problems: int(o, "problems", "preview"),
    admissible: bool(o, "admissible", "preview"),
    staleSales: int(o, "staleSales", "preview"),
    token,
    changes: Object.freeze(changes.map(changeView)),
  };
  if (view.admissible && (view.token === null || view.problems !== 0 || view.changes.some((c) => c.problem !== null))) {
    throw new SelectionContractError("preview.admissible", "contradicts its changes");
  }
  return Object.freeze(view);
}

/** The decisions whose day correction must be confirmed before an apply. */
export function largeDateGapDecisions(preview: SelectionPreview): number[] {
  return preview.changes.filter((c) => c.largeDateGap).map((c) => c.decisionId).sort((a, b) => a - b);
}

/**
 * A selection as the browser sends it: positive integers, distinct, 1 to
 * 500, sorted for the database (the token binds the sorted set anyway).
 * NULL if it is not one — nothing is guessed, nothing dropped.
 */
export function selectionIds(input: unknown): number[] | null {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_SELECTION) return null;
  if (!input.every((x) => typeof x === "number" && Number.isSafeInteger(x) && x > 0)) return null;
  const ids = [...(input as number[])].sort((a, b) => a - b);
  return ids.some((x, i) => i > 0 && x === ids[i - 1]) ? null : ids;
}

export const isToken = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
export const isId = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
