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
import { expectedBlock, isTakeable } from "./decide.ts";
import type { FindingField } from "./diff.ts";
import type { SelectionProblem } from "./selection.ts";
import type { Finding, JsonScalar, Match } from "./view.ts";

export const FIELD_STATES = ["MISSING_IN_SKYISLES", "EQUAL", "CONFLICT", "UNCERTAIN", "READ_ONLY_DIFFERENCE"] as const;
export type FieldState = (typeof FIELD_STATES)[number];

/** The fields the confirm action may write — 0180's whitelist without the day. */
export const CONFIRM_FIELDS = ["items_net", "shipping", "external_order_ref"] as const satisfies readonly FindingField[];
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
  for (const finding of match.findings) {
    const { state, reason } = classifyFinding(match, finding);
    const entry = { finding, state, reason };
    if (state === "MISSING_IN_SKYISLES") plan.supplements.push(entry);
    else if (state === "CONFLICT") plan.conflicts.push(entry);
    else if (state === "EQUAL") plan.done += 1;
    else plan.checks.push(entry);
  }
  return plan;
}

/** Anything for "Abgleichen" to show. */
export const isRelevant = (p: MatchPlan): boolean => p.supplements.length + p.conflicts.length + p.checks.length > 0;

/** A suggested sales value is not a pair — the extra candidates of the ±3 day search window and the like. */
export const isExtraCandidate = (m: Pick<Match, "category">): boolean => m.category === "not_comparable";

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
  return {
    additions: writes.filter((i) => i.field === "external_order_ref").length,
    corrections: writes.filter((i) => i.field !== "external_order_ref").length,
    kept: items.length - writes.length,
    sales: sales.size,
  };
}
