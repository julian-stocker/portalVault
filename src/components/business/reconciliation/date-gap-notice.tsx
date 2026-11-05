/**
 * The notice for a large date gap in the preview of a selection (0180, step
 * 6A). PREPARED, NOT MOUNTED: no page renders it until the apply screen has
 * its own approval (`release.ts`). It shows the two days themselves — the
 * sale's and the report's — so the operator can judge the gap, and it has no
 * button: the confirmation belongs to the screen that will carry the apply.
 *
 * The days come from the action's answer and are rendered as text; they never
 * go into a URL or a log.
 */
import { formatDate } from "@/lib/format";
import { de } from "@/lib/i18n/de";
import type { SelectionChange } from "@/lib/reconciliation/selection";

const t = de.business.reconciliation.selection;

export function DateGapNotice({ change }: { change: SelectionChange }) {
  if (!change.largeDateGap || change.dateGap === null) return null;
  const { from, to, days } = change.dateGap;
  return (
    <div role="note" data-date-gap={change.decisionId}
         className="rounded-sky-md border-l-4 border-attention bg-attention/10 p-3 text-sm ring-1 ring-attention/40">
      <p className="font-medium">{t.dateGapTitle}</p>
      <p className="mt-1">{t.dateGapHint(Math.abs(days))}</p>
      <p className="mt-1 tabular-nums" data-date-gap-values="">
        {t.dateGapValues(formatDate(from), formatDate(to))}
      </p>
    </div>
  );
}
