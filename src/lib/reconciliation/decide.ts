/**
 * The 0180 rules a screen can already apply before the database is asked
 * (ADR-0178) — used by the plan of "Abgleichen" (`plan.ts`).
 *
 * THE DATABASE STAYS THE JUDGE. `seller_recon_decide` checks every decision
 * again, and `seller_recon_preview` / `seller_recon_apply` judge the
 * selection under lock — whatever this file lets through too eagerly is
 * refused there, never applied.
 *
 * AN EARLY HINT, NOT A VERDICT. `expectedBlock` names the reasons that are
 * already visible on the page — an unsure pairing, a pair only proven by
 * date and pieces (`unique`: only the order number), a cancelled or
 * refunded sale, a test sale. Every other reason the preview names on its own.
 */
import type { SelectionChange, SelectionProblem } from "./selection.ts";
import type { FindingField } from "./diff.ts";
import type { Finding, Match } from "./view.ts";

/** The three decisions 0180 accepts. `manual` is a correction in the Orderbuch. */
export const DECIDE_OPTIONS = ["take_external", "keep_ledger", "defer"] as const;
export type DecideOption = (typeof DECIDE_OPTIONS)[number];

/** The four fields an apply can ever write — `sales_recon_allowed_0180`. */
export const TAKEABLE_FIELDS = ["sold_on", "items_net", "shipping", "external_order_ref"] as const satisfies readonly FindingField[];

export function isTakeable(field: FindingField): boolean {
  return (TAKEABLE_FIELDS as readonly string[]).includes(field);
}

/** What 0180 allows for a field, in the order the screen shows them. */
export function allowed0180(field: FindingField): readonly DecideOption[] {
  return isTakeable(field) ? DECIDE_OPTIONS : ["keep_ledger", "defer"];
}

/** How a field's value reads: drives formatting only. */
export type FieldKind = "date" | "money" | "count" | "text";
export const FIELD_KIND: Readonly<Record<FindingField, FieldKind>> = {
  sold_on: "date",
  items_net: "money",
  shipping: "money",
  total: "money",
  pieces: "count",
  figure: "text",
  external_order_ref: "text",
};

const AMOUNT_FIELDS: readonly FindingField[] = ["items_net", "shipping"];

/**
 * Why "take over" will be refused, when the page already shows it. Null: the
 * preview decides. Only reasons with the same code as 0180's own refusal, so
 * the sentence on the button is the sentence of the preview.
 */
export function expectedBlock(match: Pick<Match, "category" | "certainty" | "ledger">, finding: Pick<Finding, "field">): SelectionProblem | null {
  if (!isTakeable(finding.field)) return "field_not_takeable";
  const current = match.ledger?.current ?? null;
  if (current === null) return "not_a_pair";
  if (current.isTest) return "test_sale";
  if (current.cancelledOn !== null) return "cancelled";
  if (AMOUNT_FIELDS.includes(finding.field) && current.refundsTotal > 0) return "refunded";
  if (match.category === "ambiguous") return "competitors";
  if (match.certainty !== "deterministic" && match.certainty !== "unique") return "uncertain";
  if (match.certainty === "unique" && finding.field !== "external_order_ref") return "unique_ref_only";
  return null;
}

/** The edit page of a sale in the Orderbuch. Only an id goes into the URL. */
export function orderbookSaleHref(saleId: number): string {
  return `/business/orderbuch/verkauf/${saleId}`;
}

/** The value of a change for its field — `old` and `target` carry camelCase keys (0180). */
const CHANGE_KEY: Readonly<Record<string, string>> = {
  sold_on: "soldOn", items_net: "itemsNet", shipping: "shipping", external_order_ref: "externalOrderRef",
};

export function changeValues(change: Pick<SelectionChange, "field" | "old" | "target">): { old: unknown; target: unknown } {
  const key = change.field === null ? undefined : CHANGE_KEY[change.field];
  if (key === undefined) return { old: null, target: null };
  return { old: change.old?.[key] ?? null, target: change.target?.[key] ?? null };
}
