/**
 * What "Abgleichen" does with one order — the simple model of the CSV
 * reconciliation (ADR-0178, final simplification).
 *
 * FIVE STATES PER FIELD, ONE PLACE THAT DECIDES THEM
 *
 *   MISSING_IN_SKYISLES   SkyIsles has nothing, the report has a value, the
 *                         pair is certain and nothing blocks it — it is
 *                         preselected as an addition. Today that is the
 *                         order number only: every amount SkyIsles stores is
 *                         a number, and 0,00 € is a value, never "missing".
 *   EQUAL                 no finding, or one already taken over — nothing to do.
 *   CONFLICT              both sides have a value and they differ, on a
 *                         field the reconciliation may write (goods value,
 *                         shipping) — the operator chooses.
 *   UNCERTAIN             the pairing is not proven enough, the sale is a
 *                         test, cancelled, refunded (amounts) or changed
 *                         since the analysis — nothing is offered, a short
 *                         reason is shown.
 *   READ_ONLY_DIFFERENCE  date, figures, pieces, total — shown, never taken
 *                         over. Corrected in the Orderbuch, if at all.
 *
 * WHAT CAN BE WRITTEN. `CONFIRM_FIELDS` — goods value, shipping, order
 * number. The day is no longer taken over by the reconciliation at all,
 * although 0180 could: a date is shown as a hint, and the confirm action
 * refuses it on its own (`server/actions.ts`).
 *
 * NOTHING HERE WRITES OR DECIDES FOR THE DATABASE. The plan only says what
 * the dialog preselects and offers. `seller_recon_decide`, `_preview` and
 * `_apply` judge every item again; an item this file offers too eagerly is
 * refused there, never applied.
 */
import { compareMatch } from "./compare.ts";
import { expectedBlock, isTakeable } from "./decide.ts";
import { judgesFigures, liveDifferences } from "./live.ts";
import type { FindingField } from "./diff.ts";
import type { SelectionProblem } from "./selection.ts";
import type { Finding, JsonScalar, Match } from "./view.ts";

export const FIELD_STATES = ["MISSING_IN_SKYISLES", "EQUAL", "CONFLICT", "UNCERTAIN", "READ_ONLY_DIFFERENCE"] as const;
export type FieldState = (typeof FIELD_STATES)[number];

/** The fields the confirm action may write — 0180's whitelist without the day. */
/*
 * WHAT "ANGABEN ABGLEICHEN" TAKES OVER (2026-11-09): goods value and shipping —
 * the financial values. The order number left this set: assigning a sale to
 * an order is its own act ("Bestellnummer übernehmen", `ORDER_NUMBER_FIELD`),
 * never mixed into the financial confirmation. The day was never in it.
 */
export const CONFIRM_FIELDS = ["items_net", "shipping"] as const satisfies readonly FindingField[];
/** The one field of the separate order-number act. */
export const ORDER_NUMBER_FIELD = "external_order_ref" as const satisfies FindingField;
export type ConfirmField = (typeof CONFIRM_FIELDS)[number];
export const isConfirmField = (f: unknown): f is ConfirmField => (CONFIRM_FIELDS as readonly unknown[]).includes(f);

/**
 * Why a difference is not taken over. A 0180 reason code where the database
 * has one, else what the simple model adds:
 *
 *   date       the day is never taken over here
 *   positions  figure or pieces — the Orderbuch
 *   total      follows from goods, shipping and refunds — the Orderbuch
 *   stale      the sale changed since the analysis
 *   closed     the session is closed
 *   no_value   one side is empty where a value was expected
 */
export type PlanReason = SelectionProblem | "date" | "positions" | "total" | "closed" | "no_value";

export type Classified = { state: FieldState; reason: PlanReason | null };

const blank = (v: JsonScalar): boolean => v === null || (typeof v === "string" && v.trim() === "");

/** The state of one finding of a match. */
export function classifyFinding(
  match: Pick<Match, "category" | "certainty" | "ledger">,
  finding: Pick<Finding, "field" | "kind" | "shown" | "applied" | "lock">,
): Classified {
  // Taken over: SkyIsles now holds the report's value.
  if (finding.applied) return { state: "EQUAL", reason: null };
  if (finding.field === "sold_on") return { state: "READ_ONLY_DIFFERENCE", reason: "date" };
  if (finding.field === "figure" || finding.field === "pieces") return { state: "READ_ONLY_DIFFERENCE", reason: "positions" };
  if (finding.field === "total" || !isTakeable(finding.field)) return { state: "READ_ONLY_DIFFERENCE", reason: "total" };

  const block = expectedBlock(match, finding);
  if (block !== null) return { state: "UNCERTAIN", reason: block };
  if (finding.lock === "stale") return { state: "UNCERTAIN", reason: "stale" };
  if (finding.lock === "session_not_open") return { state: "UNCERTAIN", reason: "closed" };

  const { ledger, external } = finding.shown;
  if (finding.field === "external_order_ref") {
    // An order number SkyIsles already has is never overwritten (0180 `ref_present`).
    if (!blank(ledger)) return { state: "UNCERTAIN", reason: "ref_present" };
    return blank(external) ? { state: "UNCERTAIN", reason: "no_value" } : { state: "MISSING_IN_SKYISLES", reason: null };
  }
  if (blank(ledger) || blank(external)) return { state: "UNCERTAIN", reason: "no_value" };
  return { state: "CONFLICT", reason: null };
}

/** A field without a finding: equal on a certain pair, otherwise unproven. */
export function fieldState(match: Pick<Match, "category" | "findings">, field: FindingField): FieldState | null {
  if (match.findings.some((f) => f.field === field)) return null;
  return match.category === "exact" || match.category === "deviating" ? "EQUAL" : "UNCERTAIN";
}

export type PlanEntry = { finding: Finding; state: FieldState; reason: PlanReason | null };

export type MatchPlan = {
  matchId: number;
  saleId: number | null;
  orderRef: string | null;
  /** Preselected additions (A). */
  supplements: PlanEntry[];
  /** The operator chooses (B). */
  conflicts: PlanEntry[];
  /** Shown, never taken over here (C) — read-only and uncertain alike. */
  checks: PlanEntry[];
  /** Findings already taken over. */
  done: number;
};

export function planMatch(match: Match): MatchPlan {
  const plan: MatchPlan = {
    matchId: match.id, saleId: match.sale?.id ?? null, orderRef: match.order?.orderRef ?? null,
    supplements: [], conflicts: [], checks: [], done: 0,
  };
  // A sale changed since the analysis: a stored finding the sale no longer shows is resolved (`live.ts`).
  // A figure only when the current positions were judged again (`judgesFigures`).
  const live = liveDifferences(match);
  const figures = judgesFigures(match);
  for (const finding of match.findings) {
    if (live !== null && (finding.field !== "figure" || figures) && !finding.applied
        && !(live as ReadonlySet<string>).has(finding.field)) {
      plan.done += 1;
      continue;
    }
    const { state, reason } = classifyFinding(match, finding);
    const entry = { finding, state, reason };
    if (state === "MISSING_IN_SKYISLES") plan.supplements.push(entry);
    else if (state === "CONFLICT") plan.conflicts.push(entry);
    else if (state === "EQUAL") plan.done += 1;
    else plan.checks.push(entry);
  }
  return plan;
}

/**
 * The plan as "Angaben abgleichen" sees it: without the order number, which
 * has its own act. The card's category still comes from the whole plan.
 */
export function financialPlan(p: MatchPlan): MatchPlan {
  const keep = (e: PlanEntry) => e.finding.field !== ORDER_NUMBER_FIELD;
  return { ...p, supplements: p.supplements.filter(keep), conflicts: p.conflicts.filter(keep), checks: p.checks.filter(keep) };
}

/**
 * The order number of a pair, when SkyIsles lacks it and the report has it —
 * the case for "Bestellnummer übernehmen". Null otherwise (present, unknown,
 * or nothing to take). The database judges it again (0180 / 0186).
 */
export function orderNumberEntry(p: MatchPlan): PlanEntry | null {
  return p.supplements.find((e) => e.finding.field === ORDER_NUMBER_FIELD) ?? null;
}

/**
 * The order number a certain pair lacks — whatever the session's state.
 * `orderNumberEntry` answers for an OPEN session (0180 can take it over
 * then); this one also for a closed one, where only the explicit
 * assignment with excluded rivals (0186) can still write it. Null: the pair
 * is not certain, the number is present, the report has none, or it is done.
 */
export function missingOrderNumber(m: Match): Finding | null {
  if (m.sale === null || m.order === null || (m.category !== "exact" && m.category !== "deviating")) return null;
  // The sale carries a number NOW (taken over, or typed in the Orderbuch since): nothing to add.
  if (m.ledger?.current.externalOrderRef) return null;
  const f = m.findings.find((x) => x.field === ORDER_NUMBER_FIELD && !x.applied);
  if (!f) return null;
  return classifyFinding(m, { ...f, lock: null }).state === "MISSING_IN_SKYISLES" ? f : null;
}

/** Why "Eindeutige Bestellnummern übernehmen" leaves a missing number out — a forecast; the database decides again. */
export type BulkSkip = "rivals" | "competitors" | "stale" | "closed" | "not_takeable";
export type BulkCase = { matchId: number; orderRef: string; saleId: number };

/**
 * "Eindeutige Bestellnummern übernehmen" (2026-11-09): every certain pair of
 * the WHOLE session (never one page or one filter) whose sale lacks the
 * number. Takeable: what 0180 would take over now — no rivals, no competing
 * candidate, unchanged since the analysis, open session. Everything else is
 * listed as skipped, with its reason: a rival is never released in bulk (that
 * is the single, explicit act of 0186). Built only from what the page already
 * knows; the server and the database check each case again before writing.
 */
export function bulkOrderNumbers(matches: readonly Match[]): {
  takeable: BulkCase[]; skipped: (BulkCase & { reason: BulkSkip })[];
} {
  const takeable: BulkCase[] = [];
  const skipped: (BulkCase & { reason: BulkSkip })[] = [];
  for (const m of matches) {
    const f = missingOrderNumber(m);
    if (f === null) continue;
    const c: BulkCase = { matchId: m.id, orderRef: m.order!.orderRef, saleId: m.sale!.id };
    const reason: BulkSkip | null =
      (m.rivals?.length ?? 0) + (m.rivalOrders?.length ?? 0) > 0 ? "rivals"
      : m.competitors.length > 0 ? "competitors"
      : f.lock === "session_not_open" ? "closed"
      : f.lock === "stale" ? "stale"
      : orderNumberEntry(planMatch(m)) === null ? "not_takeable"
      : null;
    if (reason === null) takeable.push(c);
    else skipped.push({ ...c, reason });
  }
  return { takeable, skipped };
}

/** Anything for "Angaben abgleichen" to show — the order number aside. */
export const isRelevant = (p: MatchPlan): boolean => {
  const f = financialPlan(p);
  return f.supplements.length + f.conflicts.length + f.checks.length > 0;
};

/** A suggested sales value is not a pair — the extra candidates of the ±3 day search window and the like. */
export const isExtraCandidate = (m: Pick<Match, "category">): boolean => m.category === "not_comparable";

/*
 * ONE CATEGORY PER ORDER — what the operator sees (2026-11-08).
 *
 * The database's own categories (`exact`, `deviating`, …) describe the
 * analysis; they cannot say "an order number is missing, nothing else" —
 * `exact` would read "Stimmt überein" next to a missing number. The screen
 * therefore files every order under exactly one OUTCOME, derived from the
 * same plan "Abgleichen" uses:
 *
 *   deviation   a value differs, or the pairing is not proven: a conflict,
 *               a date, a figure, pieces or total that differ, a finding that
 *               cannot be judged, an unsure pair (`probable`, `ambiguous`), a
 *               value the database could not prove. Wins over everything else —
 *               an order with a missing number AND another date is here, and
 *               "Abgleichen" still adds its number.
 *   supplement  only additions are left (a missing order number on a certain
 *               pair), nothing else differs.
 *   identical   a certain pair (`exact`/`deviating`) with no open finding —
 *               nothing ever found, or everything taken over.
 *   unmatched   one side only: an order with no sale (`external_only`), a
 *               sale in the period with no order (`ledger_only`). Never
 *               "identical", and kept apart from the three.
 *   extra       a sale loaded only as a candidate (`not_comparable`) — the
 *               extra candidates, listed apart as before.
 *
 * A SALE CHANGED SINCE THE ANALYSIS (corrected in the Orderbuch) is judged
 * again on what SkyIsles holds now, by the analysis' own rule (`live.ts`):
 * the date, amounts, total, piece count and order number as they are NOW;
 * a stored figure finding stays a deviation, because the figures cannot be
 * re-read. Nothing is claimed from the old findings alone.
 *
 * Unknown never becomes "identical": no ledger, an unproven value or an unsure
 * pair all land in `deviation`. Nothing here writes or decides — the database
 * judges every take-over again.
 */
export const ORDER_OUTCOMES = ["deviation", "supplement", "identical", "unmatched", "extra"] as const;
export type OrderOutcome = (typeof ORDER_OUTCOMES)[number];
/** The three the operator works with, in the order the screen names them. */
export const MAIN_OUTCOMES = ["identical", "supplement", "deviation"] as const satisfies readonly OrderOutcome[];

export function orderOutcome(m: Match): OrderOutcome {
  if (m.category === "not_comparable") return "extra";
  if (m.category === "external_only" || m.category === "ledger_only") return "unmatched";
  if (m.category === "probable" || m.category === "ambiguous") return "deviation";
  // A pair without its SkyIsles side is not proven equal.
  if (m.ledger === null) return "deviation";
  // Changed since the analysis: judged again on what SkyIsles holds NOW (`live.ts`).
  const live = liveDifferences(m);
  if (live !== null) {
    // The figures: judged again on the current positions when they are known, else as the analysis saw them.
    const figure = judgesFigures(m) ? live.has("figure") : m.findings.some((f) => f.field === "figure" && !f.applied);
    if (figure || [...live].some((f) => f !== "external_order_ref" && f !== "figure")) return "deviation";
    return live.has("external_order_ref") ? "supplement" : "identical";
  }
  const p = planMatch(m);
  // The outcome describes the DATA, not whether this session can still act on it: a missing
  // number in a closed session is still missing ("Ergänzen"), a differing value still differs.
  const closedAddition = (e: PlanEntry) => e.reason === "closed"
    && classifyFinding(m, { ...e.finding, lock: null }).state === "MISSING_IN_SKYISLES";
  if (p.conflicts.length > 0 || p.checks.some((e) => !closedAddition(e))) return "deviation";
  // An unresolved comparison: a value the database could not prove (`unknown`), or one only unconfirmed.
  if (isUnproven(m)) return "deviation";
  if (p.supplements.length > 0 || p.checks.some(closedAddition)) return "supplement";
  return "identical";
}

/** A pair whose comparison is not fully proven — never "identical" (`compare.ts`, statuses). */
export function isUnproven(m: Match): boolean {
  const c = compareMatch(m);
  const open = (s: string) => s === "unknown" || s === "unconfirmed_deviation";
  return c.fields.some((f) => open(f.status)) || open(c.figures.status);
}

/** Findings of an order already taken over — "erledigt". */
export const appliedCount = (m: Pick<Match, "findings">): number => m.findings.filter((f) => f.applied).length;

/** Was this order judged again on the sale as it is now (`live.ts`)? */
export const isReassessed = (m: Pick<Match, "order" | "ledger" | "findings" | "livePieces">): boolean => liveDifferences(m) !== null;

/*
 * THE WORK, APART FROM THE DATA (2026-11-08).
 *
 *   open      something to do, nothing done yet
 *   partial   something done — a value taken over, or the sale corrected in
 *             the Orderbuch — but the data still differs or misses something
 *   done      something was done and the order is identical now
 *   null      nothing to do (identical from the start), or nothing the
 *             reconciliation can settle (one-sided rows, extra candidates)
 *
 * A number taken over while the date still differs is "partial", never "done".
 */
export const WORK_STATES = ["open", "partial", "done"] as const;
export type WorkState = (typeof WORK_STATES)[number];

export function workState(m: Match): WorkState | null {
  const outcome = orderOutcome(m);
  if (outcome === "unmatched" || outcome === "extra") return null;
  const touched = appliedCount(m) > 0 || m.ledger?.state === "changed" || m.ledger?.state === "applied";
  if (outcome === "identical") return touched ? "done" : null;
  return touched ? "partial" : "open";
}

export function workCounts(matches: readonly Match[]): Record<WorkState, number> {
  const counts: Record<WorkState, number> = { open: 0, partial: 0, done: 0 };
  for (const m of matches) {
    const w = workState(m);
    if (w) counts[w] += 1;
  }
  return counts;
}

/** How many orders per outcome. */
export function outcomeCounts(matches: readonly Match[]): Record<OrderOutcome, number> {
  const counts = Object.fromEntries(ORDER_OUTCOMES.map((o) => [o, 0])) as Record<OrderOutcome, number>;
  for (const m of matches) counts[orderOutcome(m)] += 1;
  return counts;
}

/** What needs the operator first: differences, then additions, then one-sided, then identical. */
const OUTCOME_RANK: Record<OrderOutcome, number> = { deviation: 0, supplement: 1, unmatched: 2, identical: 3, extra: 4 };
export function byOutcome(matches: readonly Match[]): Match[] {
  return matches.map((m, i) => ({ m, i, r: OUTCOME_RANK[orderOutcome(m)] }))
    .sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.m);
}

export type ConflictChoice = "take_external" | "keep_ledger";

/** One decision the confirm action records — the values exactly as shown. */
export type ConfirmItem = {
  findingId: number;
  field: ConfirmField;
  decision: ConflictChoice;
  shownLedger: JsonScalar;
  shownExternal: JsonScalar;
};

/**
 * The operator's choices in the dialog: per conflict the chosen side, per
 * addition whether it stays selected. Preset from an earlier decision.
 */
export type Choices = { conflicts: ReadonlyMap<number, ConflictChoice>; skipped: ReadonlySet<number> };

export function initialChoices(plans: readonly MatchPlan[]): Choices {
  const conflicts = new Map<number, ConflictChoice>();
  const skipped = new Set<number>();
  for (const p of plans) {
    for (const { finding: f } of p.conflicts) {
      const d = f.decision?.decision;
      if (d === "take_external" || d === "keep_ledger") conflicts.set(f.id, d);
    }
    for (const { finding: f } of p.supplements) {
      // An addition someone explicitly kept or deferred before stays unselected.
      if (f.decision?.decision === "keep_ledger" || f.decision?.decision === "defer") skipped.add(f.id);
    }
  }
  return { conflicts, skipped };
}

const item = (f: Finding, decision: ConflictChoice): ConfirmItem | null =>
  isConfirmField(f.field)
    ? { findingId: f.id, field: f.field, decision, shownLedger: f.shown.ledger, shownExternal: f.shown.external }
    : null;

/** Exactly what a confirmation sends. Never a date, a figure, a total or an uncertain field. */
export function confirmItems(plans: readonly MatchPlan[], choices: Choices): ConfirmItem[] {
  const out: ConfirmItem[] = [];
  for (const p of plans) {
    for (const { finding: f } of p.supplements) {
      if (choices.skipped.has(f.id)) continue;
      const i = item(f, "take_external");
      if (i) out.push(i);
    }
    for (const { finding: f } of p.conflicts) {
      const choice = choices.conflicts.get(f.id);
      const i = choice ? item(f, choice) : null;
      if (i) out.push(i);
    }
  }
  return out;
}

/** Conflicts still without a choice. */
export function openConflicts(plans: readonly MatchPlan[], choices: Choices): number {
  return plans.reduce((n, p) => n + p.conflicts.filter((e) => !choices.conflicts.has(e.finding.id)).length, 0);
}

/** What a confirmation would change: values taken over, and in how many sales. */
export function confirmSummary(plans: readonly MatchPlan[], items: readonly ConfirmItem[]): {
  additions: number; corrections: number; kept: number; sales: number;
} {
  const writes = items.filter((i) => i.decision === "take_external");
  const ids = new Set(writes.map((i) => i.findingId));
  const sales = new Set(plans.filter((p) => [...p.supplements, ...p.conflicts].some((e) => ids.has(e.finding.id)))
    .map((p) => p.saleId));
  const supplementIds = new Set(plans.flatMap((p) => p.supplements.map((e) => e.finding.id)));
  return {
    additions: writes.filter((i) => supplementIds.has(i.findingId)).length,
    corrections: writes.filter((i) => !supplementIds.has(i.findingId)).length,
    kept: items.length - writes.length,
    sales: sales.size,
  };
}
