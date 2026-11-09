"use client";
/**
 * "Eindeutige Bestellnummern übernehmen" (2026-11-09, ADR-0183): the missing
 * order numbers of every certain pair of the WHOLE session at once.
 *
 *   1. The preview: how many would be added, how many are skipped and why
 *      (collapsible lists), and that ONLY missing numbers are added.
 *   2. Only after the explicit confirmation: `takeOrderNumbers` with exactly
 *      the cases shown. The server and the database check each case again.
 *   3. The result: every case with its outcome — added, refused (with the
 *      database's reason), skipped, or not applied when the apply failed as a
 *      whole. Nothing is left unsaid.
 *
 * The cases come from the page (`bulkOrderNumbers`, plan.ts): plain data,
 * never a value that would be written — the server rebuilds each from the
 * stored session.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ACTION_NEUTRAL, ACTION_PRIMARY } from "@/components/ui/action";
import { PendingButton } from "@/components/ui/pending";
import { de } from "@/lib/i18n/de";
import type { BulkCase, BulkSkip } from "@/lib/reconciliation/plan";
import { type BulkOutcome, type BulkResult, takeOrderNumbers } from "@/lib/reconciliation/server/actions";

const t = de.business.reconciliation.bulkNumbers;
const problems = de.business.reconciliation.selection.problems;

const caseLine = (c: { orderRef: string | null; saleId: number | null; matchId: number }) =>
  c.orderRef !== null && c.saleId !== null ? t.caseLine(c.orderRef, c.saleId) : t.unknownCase(c.matchId);

function Outcomes({ result }: { result: BulkResult }) {
  const count = (s: BulkOutcome["status"]) => result.outcomes.filter((o) => o.status === s).length;
  const notTaken = result.outcomes.filter((o) => o.status !== "taken");
  return (
    <div data-bulk-result="" className="mt-2">
      <p className="text-sm font-medium">{t.resultTitle}</p>
      {!result.ok ? <p role="alert" className="text-danger">{t.failed} {result.message}</p> : null}
      <p role="status" data-bulk-counts="" className="tabular-nums">
        {t.result(count("taken"), count("refused"), count("skipped") + count("not_applied"))}
      </p>
      {notTaken.length > 0 ? (
        <ul data-bulk-not-taken="" className="mt-1 flex flex-col gap-0.5">
          {notTaken.map((o) => (
            <li key={o.matchId} data-outcome={o.status} data-match={o.matchId} className="break-words">
              {caseLine(o)}: {t.status[o.status]}{o.problem ? ` — ${problems[o.problem]}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
      {count("taken") > 0 ? (
        <details className="mt-1">
          <summary className="focus-ring cursor-pointer">{t.status.taken} ({count("taken")})</summary>
          <ul className="mt-1 flex flex-col gap-0.5">
            {result.outcomes.filter((o) => o.status === "taken").map((o) => (
              <li key={o.matchId} data-outcome="taken" data-match={o.matchId}>{caseLine(o)}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

export function BulkOrderNumbers({ sessionId, takeable, skipped }: {
  sessionId: number; takeable: readonly BulkCase[]; skipped: readonly (BulkCase & { reason: BulkSkip })[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BulkResult | null>(null);

  if (takeable.length === 0 && skipped.length === 0 && result === null) return null;

  async function go() {
    setRunning(true);
    const r = await takeOrderNumbers(sessionId, takeable.map((c) => c.matchId));
    setRunning(false);
    setResult(r);
    if (r.outcomes.some((o) => o.status === "taken")) router.refresh();
  }

  if (!open) {
    return (
      <button type="button" data-bulk-numbers-open=""
              onClick={() => { setOpen(true); setResult(null); }}
              className={`${ACTION_NEUTRAL} sm:w-auto`}>
        {t.button(takeable.length)}
      </button>
    );
  }
  return (
    <div data-bulk-numbers="" className="w-full rounded-sky-md bg-surface px-3 py-2 text-xs ring-1 ring-border">
      <p className="text-sm font-medium">{t.title}</p>
      <p className="mt-0.5">{t.only}</p>
      {result === null ? (
        <>
          <p data-bulk-takeable={takeable.length} className="mt-1 font-medium tabular-nums">{t.takeable(takeable.length)}</p>
          {takeable.length > 0 ? (
            <details className="mt-0.5">
              <summary className="focus-ring cursor-pointer">{t.showTakeable}</summary>
              <ul className="mt-1 flex flex-col gap-0.5">
                {takeable.map((c) => <li key={c.matchId} data-bulk-case={c.matchId}>{caseLine(c)}</li>)}
              </ul>
            </details>
          ) : null}
          {skipped.length > 0 ? (
            <>
              <p data-bulk-skipped={skipped.length} className="mt-1 tabular-nums">{t.skipped(skipped.length)}</p>
              <details className="mt-0.5">
                <summary className="focus-ring cursor-pointer">{t.showSkipped}</summary>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {skipped.map((c) => (
                    <li key={c.matchId} data-bulk-skip={c.reason} className="break-words">{caseLine(c)}: {t.reasons[c.reason]}</li>
                  ))}
                </ul>
              </details>
            </>
          ) : null}
          <p className="mt-1 text-muted">{t.recheck}</p>
        </>
      ) : <Outcomes result={result} />}
      <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row">
        <button type="button" onClick={() => setOpen(false)} disabled={running} className={`${ACTION_NEUTRAL} sm:w-auto`}>
          {result === null ? t.cancel : t.close}
        </button>
        {result === null ? (
          <PendingButton type="button" pending={running} pendingLabel={t.working} data-bulk-numbers-go=""
                         disabled={takeable.length === 0} onClick={() => void go()}
                         className={`${ACTION_PRIMARY} disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto`}>
            {t.confirm(takeable.length)}
          </PendingButton>
        ) : null}
      </div>
    </div>
  );
}
