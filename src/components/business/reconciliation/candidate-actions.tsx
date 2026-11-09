"use client";
/**
 * The two actions on a candidate list (ADR-0182): "Diesem Verkauf zuordnen"
 * — only after an explicit confirmation, writing only the order number
 * (0185) — and "Weitere Verkäufe suchen" over a chosen period.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ACTION_NEUTRAL, ACTION_PRIMARY } from "@/components/ui/action";
import { PendingButton } from "@/components/ui/pending";
import { de } from "@/lib/i18n/de";
import type { CandidateExplanation } from "@/lib/reconciliation/candidates";
import type { ReturnTarget } from "@/lib/reconciliation/routes";
import { takeOrderNumber } from "@/lib/reconciliation/server/actions";
import { assignSaleToReport, confirmWithExclusions, type Exclusions, searchCandidates } from "@/lib/reconciliation/server/candidate-actions";
import type { RivalOrder, RivalSale } from "@/lib/reconciliation/view";
import { formatDate } from "@/lib/format";

import { useReconcile } from "./reconcile-context";
import { CandidateComparison } from "./report-candidates";

const t = de.business.reconciliation.candidates;

export function AssignSale({ c, orderRef, back }: { c: CandidateExplanation; orderRef: string; back: ReturnTarget }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState(false);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  if (c.orderRef !== null) return <p className="text-muted">{t.assignBlockedRef}</p>;
  // With rivals 0185 refuses (0180's rule, unchanged) — the explicit exclusion of each one (0186) is the only way.
  if (c.rivals.length + c.rivalOrders.length > 0) {
    return <ExcludeRivals back={back} saleId={c.saleId} version={c.updatedAt} orderRef={orderRef}
                          rivals={c.rivals} rivalOrders={c.rivalOrders} />;
  }

  async function assign() {
    setRunning(true);
    setMessage(null);
    const r = await assignSaleToReport(back.sessionId, back.matchId, c.saleId, c.updatedAt);
    setRunning(false);
    if (!r.ok) { setMessage({ ok: false, text: r.message }); return; }
    setMessage({ ok: true, text: t.assigned(r.saleId) });
    router.refresh();
  }

  if (!open) {
    return (
      <button type="button" data-assign={c.saleId} onClick={() => { setOpen(true); setChecked(false); }}
              className={`${ACTION_NEUTRAL} sm:w-auto`}>{t.assign}</button>
    );
  }
  return (
    <div data-assign-confirm={c.saleId} className="mt-1 w-full rounded-sky-md bg-surface px-3 py-2 ring-1 ring-attention/60">
      <p className="text-sm font-medium">{t.assignTitle(c.saleId, orderRef)}</p>
      <p className="mt-0.5 text-muted">{t.assignWhat}</p>
      <label className="mt-1 flex min-h-11 items-center gap-2 sm:min-h-8">
        <input type="checkbox" data-assign-check="" checked={checked} disabled={running}
               onChange={(e) => setChecked(e.target.checked)} />
        {t.assignCheck(c.saleId, orderRef)}
      </label>
      {message ? <p role={message.ok ? "status" : "alert"} className={message.ok ? "text-success" : "text-danger"}>{message.text}</p> : null}
      <div className="mt-1 flex flex-col-reverse gap-2 sm:flex-row">
        <button type="button" onClick={() => setOpen(false)} disabled={running} className={`${ACTION_NEUTRAL} sm:w-auto`}>{t.assignCancel}</button>
        <PendingButton type="button" pending={running} pendingLabel={t.assigning} disabled={!checked || message?.ok === true}
                       onClick={() => void assign()} data-assign-go=""
                       className={`${ACTION_PRIMARY} disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto`}>
          {t.assignConfirm}
        </PendingButton>
      </div>
    </div>
  );
}

const shiftDay = (day: string, by: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + by);
  return d.toISOString().slice(0, 10);
};

export function CandidateSearch({ orderRef, soldOn, back, exclude }: {
  orderRef: string; soldOn: string; back: ReturnTarget; exclude: readonly number[];
}) {
  const [from, setFrom] = useState(shiftDay(soldOn, -30));
  const [to, setTo] = useState(shiftDay(soldOn, 30));
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ list: CandidateExplanation[]; capped: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    setRunning(true);
    setError(null);
    const r = await searchCandidates(back.sessionId, back.matchId, from, to);
    setRunning(false);
    if (!r.ok) { setError(r.message); setResult(null); return; }
    setResult({ list: r.candidates.filter((c) => !exclude.includes(c.saleId)), capped: r.capped });
  }

  return (
    <details data-candidate-search="" className="mt-2">
      <summary className="focus-ring -mx-1 inline-flex min-h-11 cursor-pointer items-center rounded-sky-md px-1 text-sm underline underline-offset-2 sm:min-h-8">
        {t.searchTitle}
      </summary>
      <div className="mt-1 flex flex-wrap items-end gap-2 text-xs">
        <label className="flex flex-col gap-0.5">{t.searchFrom}
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} data-search-from=""
                 className="focus-ring min-h-11 rounded-sky-md bg-surface px-2 ring-1 ring-border sm:min-h-8" /></label>
        <label className="flex flex-col gap-0.5">{t.searchTo}
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} data-search-to=""
                 className="focus-ring min-h-11 rounded-sky-md bg-surface px-2 ring-1 ring-border sm:min-h-8" /></label>
        <PendingButton type="button" pending={running} pendingLabel={t.searching} onClick={() => void search()} data-search-go=""
                       className={`${ACTION_NEUTRAL} sm:w-auto`}>{t.searchButton}</PendingButton>
      </div>
      {error ? <p role="alert" className="mt-1 text-xs text-danger">{error}</p> : null}
      {result ? (
        result.list.length === 0 ? <p className="mt-1 text-xs text-muted">{t.searchEmpty}</p> : (
          <ul className="mt-2 flex flex-col gap-2">
            {result.list.map((c) => (
              <li key={c.saleId}>
                <CandidateComparison c={c} back={back}><AssignSale c={c} orderRef={orderRef} back={back} /></CandidateComparison>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </details>
  );
}

/**
 * EVERY RIVAL EXCLUDED ONE BY ONE (0186). A checkbox per rival — sale or
 * order — and a required reason; the button only when all are checked. The
 * database recomputes the rivals under lock and refuses if they are not
 * exactly these, each sale with the version shown here.
 */
export function ExcludeRivals({ back, saleId, version, orderRef, rivals, rivalOrders, label = t.assign }: {
  back: ReturnTarget; saleId: number; version: string | null; orderRef: string;
  rivals: readonly RivalSale[]; rivalOrders: readonly RivalOrder[]; label?: string;
}) {
  const router = useRouter();
  const x = t.exclude;
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [note, setNote] = useState("");
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const keys = [...rivals.map((r) => `s${r.saleId}`), ...rivalOrders.map((o) => `o${o.orderId}`)];
  // Every rival sale must carry the version seen — without it the database could not tell a changed one.
  const all = keys.every((k) => checked.has(k)) && rivals.every((r) => r.updatedAt !== null && r.updatedAt !== "");
  const toggle = (k: string, on: boolean) => setChecked((c) => { const n = new Set(c); if (on) n.add(k); else n.delete(k); return n; });

  async function go() {
    setRunning(true);
    setMessage(null);
    const excluded: Exclusions = {
      sales: rivals.map((r) => ({ id: r.saleId, updatedAt: r.updatedAt ?? "" })),
      orders: rivalOrders.map((o) => ({ id: o.orderId })),
    };
    const r = await confirmWithExclusions(back.sessionId, back.matchId, saleId, version, excluded, note);
    setRunning(false);
    if (!r.ok) { setMessage({ ok: false, text: r.message }); return; }
    setMessage({ ok: true, text: t.assigned(r.saleId) });
    router.refresh();
  }

  if (!open) {
    return (
      <button type="button" data-exclude-open={saleId} onClick={() => setOpen(true)} className={`${ACTION_NEUTRAL} sm:w-auto`}>
        {label}
      </button>
    );
  }
  return (
    <div data-exclude={saleId} className="mt-1 w-full rounded-sky-md bg-surface px-3 py-2 text-xs ring-1 ring-attention/60">
      <p className="text-sm font-medium">{x.title}</p>
      <p data-exclude-what="" className="mt-0.5">{x.what(orderRef, saleId)}</p>
      <p className="mt-0.5 text-muted">{x.intro}</p>
      <ul className="mt-1 flex flex-col gap-1">
        {rivals.map((r) => (
          <li key={`s${r.saleId}`}><label className="flex min-h-11 items-start gap-2 sm:min-h-8">
            <input type="checkbox" className="mt-0.5" data-exclude-sale={r.saleId} checked={checked.has(`s${r.saleId}`)} disabled={running}
                   onChange={(e) => toggle(`s${r.saleId}`, e.target.checked)} />
            <span className="break-words">{x.sale(r.saleId, formatDate(r.soldOn), r.pieces.join(", "))}</span>
          </label></li>
        ))}
        {rivalOrders.map((o) => (
          <li key={`o${o.orderId}`}><label className="flex min-h-11 items-start gap-2 sm:min-h-8">
            <input type="checkbox" className="mt-0.5" data-exclude-order={o.orderId} checked={checked.has(`o${o.orderId}`)} disabled={running}
                   onChange={(e) => toggle(`o${o.orderId}`, e.target.checked)} />
            <span className="break-words">{x.order(o.orderRef, formatDate(o.soldOn), o.shared.join(", "))}</span>
          </label></li>
        ))}
      </ul>
      <label className="mt-1 flex flex-col gap-0.5">{x.note}
        <textarea data-exclude-note="" value={note} maxLength={500} rows={2} disabled={running} placeholder={x.notePlaceholder}
                  onChange={(e) => setNote(e.target.value)}
                  className="focus-ring rounded-sky-md bg-surface px-2 py-1 ring-1 ring-border" />
      </label>
      {message ? <p role={message.ok ? "status" : "alert"} className={`mt-1 ${message.ok ? "text-success" : "text-danger"}`}>{message.text}</p> : null}
      <div className="mt-1 flex flex-col-reverse gap-2 sm:flex-row">
        <button type="button" onClick={() => setOpen(false)} disabled={running} className={`${ACTION_NEUTRAL} sm:w-auto`}>{t.assignCancel}</button>
        <PendingButton type="button" pending={running} pendingLabel={t.assigning} data-exclude-go=""
                       disabled={!all || note.trim() === "" || message?.ok === true} onClick={() => void go()}
                       className={`${ACTION_PRIMARY} disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto`}>
          {x.confirm}
        </PendingButton>
      </div>
    </div>
  );
}

/**
 * "Bestellnummer übernehmen" for a certain pair without number — its own act,
 * never part of "Angaben abgleichen". Without rivals in an open session: the
 * one finding through 0180's checked path; with rivals: the exclusion of each
 * one (0186). Nothing but `external_order_ref` is written either way.
 */
export function TakeOrderNumber({ back, saleId, version, orderRef, rivals, rivalOrders }: {
  back: ReturnTarget; saleId: number; version: string | null; orderRef: string;
  rivals: readonly RivalSale[]; rivalOrders: readonly RivalOrder[];
}) {
  const router = useRouter();
  // 0180 takes over only in an open session; the page says which (`ReconcileProvider`).
  const sessionOpen = useReconcile()?.sessionOpen ?? false;
  const n = t.takeNumber;
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState(false);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  if (rivals.length + rivalOrders.length > 0) {
    return <ExcludeRivals back={back} saleId={saleId} version={version} orderRef={orderRef} rivals={rivals}
                          rivalOrders={rivalOrders} label={n.button} />;
  }
  if (!sessionOpen) return <p data-take-closed="" className="text-xs text-muted">{n.closedNoRivals}</p>;

  async function go() {
    setRunning(true);
    setMessage(null);
    const r = await takeOrderNumber(back.sessionId, back.matchId);
    setRunning(false);
    if (!r.ok) {
      const why = "refused" in r && r.refused?.[0] ? de.business.reconciliation.selection.problems[r.refused[0].problem] : null;
      setMessage({ ok: false, text: why ?? r.message });
      return;
    }
    setMessage({ ok: true, text: n.done });
    router.refresh();
  }

  if (!open) {
    return <button type="button" data-take-number={saleId} onClick={() => { setOpen(true); setChecked(false); }}
                   className={`${ACTION_NEUTRAL} sm:w-auto`}>{n.button}</button>;
  }
  return (
    <div data-take-confirm={saleId} className="mt-1 w-full rounded-sky-md bg-surface px-3 py-2 text-xs ring-1 ring-attention/60">
      <p className="text-sm font-medium">{n.title(orderRef, saleId)}</p>
      <p className="mt-0.5 text-muted">{n.what}</p>
      <label className="mt-1 flex min-h-11 items-center gap-2 sm:min-h-8">
        <input type="checkbox" data-take-check="" checked={checked} disabled={running} onChange={(e) => setChecked(e.target.checked)} />
        {n.check(saleId, orderRef)}
      </label>
      {message ? <p role={message.ok ? "status" : "alert"} className={message.ok ? "text-success" : "text-danger"}>{message.text}</p> : null}
      <div className="mt-1 flex flex-col-reverse gap-2 sm:flex-row">
        <button type="button" onClick={() => setOpen(false)} disabled={running} className={`${ACTION_NEUTRAL} sm:w-auto`}>{t.assignCancel}</button>
        <PendingButton type="button" pending={running} pendingLabel={n.working} data-take-go=""
                       disabled={!checked || message?.ok === true} onClick={() => void go()}
                       className={`${ACTION_PRIMARY} disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto`}>
          {n.confirm}
        </PendingButton>
      </div>
    </div>
  );
}
