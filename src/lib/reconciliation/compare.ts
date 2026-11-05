/**
 * The comparison screen's rows — what the database said, put side by side.
 *
 * NO SECOND COMPARISON. Whether two values differ was decided by the analysis
 * (`diff.ts`, stored as findings); how far SkyIsles' value at analysis is
 * proven was decided by the database (`ledger.atAnalysis`, 0179). This file
 * only combines those two answers into one word per field. It never compares
 * a report value with a SkyIsles value itself, never computes a historical
 * value, and never turns an unknown into a number.
 *
 * THE WORDS, AND WHY EACH IS WHAT IT IS
 *
 *   match                  no finding, and the database PROVED the report
 *                          value equals what SkyIsles held (`derived`)
 *   deviation              a finding, recorded for a CERTAIN pair, and the
 *                          database kept its value (`stored`)
 *   unconfirmed_deviation  a finding on a `probable` pair — the difference
 *                          may belong to another sale, so it is not shown as
 *                          a settled deviation (`diff.ts`, Summary)
 *   addition               SkyIsles has no order number where the report has
 *                          one — a gap to fill, not an error (`diff.ts`)
 *   no_finding             figures and order number: compared by the analysis,
 *                          no finding — but no proof of the value either
 *   unknown                a pair, but no proof (no value at analysis, or a
 *                          recorded value the database could not confirm)
 *   not_compared           not a pair: nothing was compared at all
 *
 * Only `match` is green and only `deviation` is red; everything else is
 * neutral — a guess is never coloured like a fact. A whole row is green only
 * for a CERTAIN pair whose five proven fields all match.
 */
import type { FindingField } from "./diff.ts";
import type {
  AtAnalysisValue, Category, Finding, JsonScalar, LedgerField, LedgerState, Match, OrderLine,
} from "./view.ts";

export type FieldStatus =
  | "match" | "deviation" | "unconfirmed_deviation" | "addition" | "no_finding" | "unknown" | "not_compared";

export type Tone = "match" | "deviation" | "neutral";

export function toneOf(status: FieldStatus): Tone {
  return status === "match" ? "match" : status === "deviation" ? "deviation" : "neutral";
}

/** How a value is written: a day, an amount, a count, or text. */
export type ValueKind = "date" | "money" | "count" | "text";

export type ComparisonField = {
  field: Exclude<FindingField, "figure">;
  kind: ValueKind;
  /** The report's value; null when the match has no order. */
  csv: JsonScalar;
  /** SkyIsles at analysis, as proven — null when there is no sale or the field has none. */
  atAnalysis: AtAnalysisValue | null;
  /** SkyIsles now; null when there is no sale. */
  current: JsonScalar;
  status: FieldStatus;
  findings: readonly Finding[];
};

export type FigureComparison = {
  /** The report's positions; null when there is no order or they were purged. */
  lines: readonly OrderLine[] | null;
  status: FieldStatus;
  findings: readonly Finding[];
};

export type MatchComparison = {
  paired: boolean;
  /** The certainty is weak: differences are shown, never as settled. */
  uncertain: boolean;
  state: LedgerState | null;
  fields: ComparisonField[];
  figures: FigureComparison;
  /** Fields (figures counted once) shown as a settled deviation. */
  deviations: number;
  tone: Tone;
};

/** Categories with an order AND a sale that the analysis compared field by field. */
export const PAIRED: ReadonlySet<Category> = new Set(["exact", "deviating", "probable"]);

/** Each `atAnalysis` field with the finding field, the report value and the current value it pairs with. */
const LEDGER_ROWS: readonly { field: Exclude<FindingField, "figure" | "external_order_ref">; at: LedgerField; kind: ValueKind }[] = [
  { field: "sold_on", at: "soldOn", kind: "date" },
  { field: "items_net", at: "itemsNet", kind: "money" },
  { field: "shipping", at: "shipping", kind: "money" },
  { field: "total", at: "expectedTotal", kind: "money" },
  { field: "pieces", at: "pieces", kind: "count" },
];

function csvValue(m: Match, field: ComparisonField["field"]): JsonScalar {
  const o = m.order;
  if (!o) return null;
  switch (field) {
    case "sold_on": return o.soldOn;
    case "items_net": return o.itemsValue;
    case "shipping": return o.shipping;
    case "total": return o.total;
    case "pieces": return o.pieces;
    case "external_order_ref": return o.orderRef;
  }
}

function currentValue(m: Match, at: LedgerField | "externalOrderRef"): JsonScalar {
  return m.ledger ? m.ledger.current[at] : null;
}

function provenStatus(paired: boolean, uncertain: boolean, findings: readonly Finding[], at: AtAnalysisValue | null): FieldStatus {
  if (!paired) return "not_compared";
  const deviation = findings.some((f) => f.kind === "deviation");
  if (deviation) {
    // The database could not confirm the recorded value: say so, do not colour it.
    if (!at || at.basis === "unknown") return "unknown";
    return uncertain ? "unconfirmed_deviation" : "deviation";
  }
  return at?.basis === "derived" ? "match" : "unknown";
}

export function compareMatch(m: Match): MatchComparison {
  const paired = PAIRED.has(m.category) && m.order !== null && m.sale !== null;
  const uncertain = m.category === "probable";
  const of = (field: FindingField) => m.findings.filter((f) => f.field === field);

  const fields: ComparisonField[] = LEDGER_ROWS.map(({ field, at, kind }) => {
    const findings = of(field);
    const atAnalysis = m.ledger ? m.ledger.atAnalysis[at] : null;
    return {
      field, kind, csv: csvValue(m, field), atAnalysis, current: currentValue(m, at),
      status: provenStatus(paired, uncertain, findings, atAnalysis), findings,
    };
  });

  const refFindings = of("external_order_ref");
  fields.push({
    field: "external_order_ref", kind: "text",
    csv: csvValue(m, "external_order_ref"), atAnalysis: null, current: currentValue(m, "externalOrderRef"),
    status: !paired ? "not_compared" : refFindings.some((f) => f.kind === "addition") ? "addition" : "no_finding",
    findings: refFindings,
  });

  const figureFindings = of("figure");
  const figures: FigureComparison = {
    lines: m.order?.lines ?? null,
    status: !paired ? "not_compared" : figureFindings.length === 0 ? "no_finding" : uncertain ? "unconfirmed_deviation" : "deviation",
    findings: figureFindings,
  };

  const deviations = fields.filter((f) => f.status === "deviation").length + (figures.status === "deviation" ? 1 : 0);
  // A `probable` pair is never a green row: its values may agree, its identity is a guess.
  const allMatch = paired && !uncertain && LEDGER_ROWS.every((_, i) => fields[i].status === "match");
  return {
    paired, uncertain, state: m.ledger?.state ?? null, fields, figures, deviations,
    tone: deviations > 0 ? "deviation" : allMatch ? "match" : "neutral",
  };
}
