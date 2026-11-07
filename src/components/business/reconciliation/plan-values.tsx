/**
 * How one planned difference reads — on the card and in the dialog alike:
 * the field, SkyIsles' value, the report's value. Pure rendering, no state,
 * so both the server card and the client dialog use it.
 *
 * Null is "nicht vorhanden" for an addition and "—" otherwise; nothing is
 * turned into 0. Every value is text through React.
 */
import { formatDate, formatNumber, formatPrice } from "@/lib/format";
import { de } from "@/lib/i18n/de";
import { FIELD_KIND } from "@/lib/reconciliation/decide";
import type { PlanEntry, PlanReason } from "@/lib/reconciliation/plan";
import type { FindingField } from "@/lib/reconciliation/diff";

const copy = de.business.reconciliation;
const t = copy.reconcile;

export function formatValue(field: FindingField, value: unknown): string {
  if (value === null || value === undefined || value === "") return copy.detail.noValue;
  const n = typeof value === "number" ? value : Number(value);
  switch (FIELD_KIND[field]) {
    case "date": return typeof value === "string" ? formatDate(value) : String(value);
    case "money": return Number.isFinite(n) ? formatPrice(n) : String(value);
    case "count": return Number.isFinite(n) ? formatNumber(n) : String(value);
    case "text": return String(value);
  }
}

/** The short sentence for a difference that is not taken over. */
export function reasonText(reason: PlanReason | null): string | null {
  if (reason === null) return null;
  if (reason in t.reasons) return t.reasons[reason as keyof typeof t.reasons];
  return copy.selection.problems[reason as keyof typeof copy.selection.problems] ?? null;
}

/** "SkyIsles 4,99 € · CSV 5,49 €" — one line, wrapping only between the two sides. */
export function EntryValues({ entry }: { entry: PlanEntry }) {
  const f = entry.finding;
  const ledger = f.kind === "addition" && f.shown.ledger === null ? t.missing : formatValue(f.field, f.shown.ledger);
  return (
    <span className="tabular-nums text-sm">
      <span className="inline-block"><span className="text-muted">{t.ledger}</span> {ledger}</span>
      <span aria-hidden="true" className="px-1 text-muted">·</span>
      <span className="inline-block break-words"><span className="text-muted">{t.csv}</span> {formatValue(f.field, f.shown.external)}</span>
    </span>
  );
}
