"use client";
/**
 * "Abgleichen" — one button, one compact dialog, one confirmation (ADR-0178,
 * simplified CSV reconciliation).
 *
 * The dialog shows three groups, taken from `planMatch` (`plan.ts`):
 *
 *   A  missing in SkyIsles — preselected, "Wird ergänzt" (can be unticked)
 *   B  both sides differ — the operator picks CSV or SkyIsles
 *   C  not corrected here — date, figures, pieces, total, an unsure pairing;
 *      a short reason and the way to the Orderbuch
 *
 * and names what a confirmation would change. "Abgleich bestätigen" sends
 * exactly `confirmItems` — never a date, a figure or an uncertain field — to
 * `confirmReconciliation`, which records the decisions, previews and applies
 * through 0180. Nothing is written by opening the dialog, by ticking, or by
 * choosing a side.
 *
 * LOCKED WHILE `APPLY_RELEASED` IS FALSE: the confirm button stays disabled
 * and says why; and the action itself refuses before any database call.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useMemo, useRef, useState } from "react";

import { ACTION_NEUTRAL, ACTION_PRIMARY } from "@/components/ui/action";
import { Modal } from "@/components/ui/modal";
import { PendingButton } from "@/components/ui/pending";
import { de } from "@/lib/i18n/de";
import { orderbookSaleHref } from "@/lib/reconciliation/decide";
import { shownActionRefusal } from "@/lib/reconciliation/messages";
import {
  type Choices, type ConflictChoice, confirmItems, confirmSummary, initialChoices, type MatchPlan, openConflicts,
  type PlanEntry, planMatch,
} from "@/lib/reconciliation/plan";
import { confirmReconciliation } from "@/lib/reconciliation/server/actions";
import type { Match } from "@/lib/reconciliation/view";

import { EntryValues, reasonText } from "./plan-values";
import { useReconcile } from "./reconcile-context";

const copy = de.business.reconciliation;
const t = copy.reconcile;

type Row = { plan: MatchPlan; entry: PlanEntry };

function Group({ title, tone, rows, many, children }: {
  title: string; tone: string; rows: readonly Row[]; many: boolean;
  children: (row: Row) => React.ReactNode;
}) {
  if (rows.length === 0) return null;
  return (
    <section className="mt-4 first:mt-0">
      <h3 className={`text-sm font-medium ${tone}`}>{title}</h3>
      <ul className="mt-1">
        {rows.map((row) => (
          <li key={row.entry.finding.id} data-finding={row.entry.finding.id} data-state={row.entry.state}
              className="border-t border-border/50 py-2 first:border-t-0">
            {many ? <p className="text-xs text-muted break-words">{t.orderOf(row.plan.orderRef, row.plan.saleId)}</p> : null}
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <span className="text-sm font-medium">{copy.fields[row.entry.finding.field]}</span>
              <EntryValues entry={row.entry} />
            </div>
            {children(row)}
          </li>
        ))}
      </ul>
    </section>
  );
}

const CHOICE = "inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-sky-md px-2 text-sm ring-1 ring-border/70 sm:min-h-8";

export function ReconcileButton({ matches, label }: { matches: readonly Match[]; label?: string }) {
  const router = useRouter();
  const ctx = useReconcile();
  const name = useId();
  const busy = useRef(false);
  const plans = useMemo(() => matches.map(planMatch), [matches]);
  const [open, setOpen] = useState(false);
  const [choices, setChoices] = useState<Choices>(() => initialChoices(plans));
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (!ctx || !ctx.sessionOpen || plans.length === 0) return null;
  const { sessionId, applyReleased } = ctx;

  const rows = (pick: (p: MatchPlan) => PlanEntry[]): Row[] => plans.flatMap((plan) => pick(plan).map((entry) => ({ plan, entry })));
  const supplements = rows((p) => p.supplements);
  const conflicts = rows((p) => p.conflicts);
  const checks = rows((p) => p.checks);
  const many = plans.length > 1;

  const items = confirmItems(plans, choices);
  const pending = openConflicts(plans, choices);
  const summary = confirmSummary(plans, items);
  const canConfirm = applyReleased && pending === 0 && items.length > 0 && !running;

  const setSkipped = (id: number, on: boolean) => setChoices((c) => {
    const skipped = new Set(c.skipped);
    if (on) skipped.delete(id); else skipped.add(id);
    return { ...c, skipped };
  });
  const choose = (id: number, choice: ConflictChoice) => setChoices((c) => {
    const next = new Map(c.conflicts);
    next.set(id, choice);
    return { ...c, conflicts: next };
  });

  function show() {
    setChoices(initialChoices(plans));
    setError(null);
    setDone(null);
    setOpen(true);
  }

  async function confirm() {
    if (busy.current || !canConfirm) return;
    busy.current = true;
    setRunning(true);
    setError(null);
    try {
      const result = await confirmReconciliation({ sessionId, items });
      if (!result.ok) { setError(shownActionRefusal(result.message, t.failed)); return; }
      setDone(t.done(result.applied, result.sales));
      setOpen(false);
      router.refresh();
    } catch (e) {
      console.error("confirm reconciliation:", e instanceof Error ? e.name : "unknown");
      setError(t.failed);
    } finally {
      busy.current = false;
      setRunning(false);
    }
  }

  return (
    <>
      <button type="button" onClick={show} data-reconcile="" className={`${ACTION_PRIMARY} sm:w-auto`}>
        {label ?? t.button}
      </button>
      {done ? <p role="status" className="text-sm text-success">{done}</p> : null}

      <Modal open={open} onClose={() => { if (!busy.current) setOpen(false); }} labelledBy={`${name}-title`} size="lg">
        <div className="flex min-h-0 flex-col">
          <div className="p-5 pb-2">
            <h2 id={`${name}-title`} className="text-lg font-semibold">{t.dialogTitle}</h2>
            <p className="mt-0.5 text-sm text-muted">
              {many ? t.orders(plans.length) : t.orderOf(plans[0].orderRef, plans[0].saleId)}
            </p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5">
            {supplements.length + conflicts.length + checks.length === 0 ? <p className="text-sm">{t.nothing}</p> : null}
            <Group title={t.supplements} tone="text-success" rows={supplements} many={many}>
              {({ entry }) => (
                <label className="mt-1 inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm sm:min-h-8">
                  <input type="checkbox" className="size-4" checked={!choices.skipped.has(entry.finding.id)}
                         onChange={(e) => setSkipped(entry.finding.id, e.currentTarget.checked)} />
                  {t.willAdd}
                </label>
              )}
            </Group>
            <Group title={t.conflicts} tone="text-danger" rows={conflicts} many={many}>
              {({ entry }) => (
                <fieldset className="mt-1 flex flex-wrap gap-2">
                  <legend className="sr-only">{copy.fields[entry.finding.field]}</legend>
                  {([["take_external", t.takeCsv], ["keep_ledger", t.keepLedger]] as const).map(([value, text]) => (
                    <label key={value} className={CHOICE}>
                      <input type="radio" className="size-4" name={`${name}-${entry.finding.id}`} value={value}
                             checked={choices.conflicts.get(entry.finding.id) === value}
                             onChange={() => choose(entry.finding.id, value)} />
                      {text}
                    </label>
                  ))}
                </fieldset>
              )}
            </Group>
            <Group title={t.checks} tone="text-fg" rows={checks} many={many}>
              {({ plan, entry }) => (
                <p className="mt-0.5 text-xs text-muted">
                  {reasonText(entry.reason)}
                  {plan.saleId !== null ? (
                    <> <Link href={orderbookSaleHref(plan.saleId)} className="focus-ring underline underline-offset-2">{t.check}</Link></>
                  ) : null}
                </p>
              )}
            </Group>
          </div>
          <div className="border-t border-border/50 p-5 pt-3">
            <p data-summary="" className="text-sm font-medium">{t.summary(summary.additions, summary.corrections, summary.sales)}</p>
            <p className="text-xs text-muted">{t.unchanged}</p>
            {pending > 0 ? <p className="mt-1 text-sm">{t.openConflicts(pending)}</p> : null}
            {!applyReleased ? <p data-not-released="" className="mt-1 text-sm text-muted">{t.notReleased}</p> : null}
            {error ? <p role="alert" className="mt-1 text-sm text-danger">{error}</p> : null}
            <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setOpen(false)} disabled={running} className={`${ACTION_NEUTRAL} sm:w-auto`}>
                {t.cancel}
              </button>
              <PendingButton type="button" pending={running} pendingLabel={t.confirming} disabled={!canConfirm}
                             onClick={() => void confirm()}
                             className={`${ACTION_PRIMARY} gap-2 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto`}>
                {t.confirm}
              </PendingButton>
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
}
