"use client";

/**
 * What one sale actually cost (ADR-0089).
 *
 * The ledger row answers "what did this sale pay out"; this answers "why".
 * It is a breakdown first and an edit form second — the only thing writable
 * here is the payout the channel reported, which is the one financial fact
 * the owner types in rather than derives.
 *
 * NOTHING IS RECOMPUTED. The expected payout is the database's, straight from
 * `sale_expected_payout()`. The groupings come from `lib/orderbook/sales-money`,
 * which the ledger row uses too, so a total here and a total there cannot
 * disagree.
 *
 * NO ENUMS ON SCREEN. `settled_by` is the reason the workbook kept two label
 * columns, and the owner reads it as "who paid the label" — so it renders as
 * `Über Kanal` or `Extern bezahlt`, never as `channel` or `external`.
 */
import { useEffect, useId, useState } from "react";

import { Modal } from "@/components/ui/modal";
import { formatPrice } from "@/lib/format";
import { de } from "@/lib/i18n/de";
import {
  addSaleFee, addSaleRefund, loadSaleAudit, removeSaleFee, removeSaleRefund,
  setSaleDate, updateSaleFee, updateSaleMeta,
} from "@/lib/orderbook/sales-actions";
import {
  adjustmentsTotal, groupFees, refundsTotal,
  type AdjustmentRow, type FeeRow, type RefundRow,
} from "@/lib/orderbook/sales-money";
import { CHANNEL_LABELS, countryLabel } from "@/lib/orderbook/sales-view";
import type { SaleRow } from "@/lib/orderbook/sales-queries";

const copy = de.business.sales;
const modal = copy.detailsModal;

const formatDate = (iso: string | null): string =>
  iso === null ? copy.undated
    : new Date(iso).toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit", year: "numeric" });

/** A label the owner wrote beats the name of its kind. */
function feeName(fee: FeeRow): string {
  const custom = fee.label?.trim();
  if (custom) return custom;
  return modal.feeKinds[fee.kind as keyof typeof modal.feeKinds] ?? fee.kind;
}

/** Who paid the shipping label — the distinction, in words. */
function settlement(settledBy: string): string {
  return settledBy === "external" ? modal.settledExternal : modal.settledChannel;
}

function refundReason(reason: string | null): string | null {
  if (!reason) return null;
  return modal.refundReasons[reason as keyof typeof modal.refundReasons] ?? reason;
}

/** One `Label  Betrag` line. */
function Line({ label, value, hint, strong }: {
  label: string; value: string; hint?: string | null; strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-0.5">
      <span className={strong ? "text-sm font-medium" : "text-sm text-muted"}>
        {label}
        {hint ? <span className="ml-2 text-xs text-muted">{hint}</span> : null}
      </span>
      <span className={`ob-money tabular-nums ${strong ? "text-sm font-medium" : "text-sm"}`}>
        {value}
      </span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border/50 px-4 py-3 first:border-t-0">
      <h3 className="mb-1 text-xs uppercase tracking-wide text-muted">{title}</h3>
      {children}
    </section>
  );
}

/** A labelled control on the same line as the value it replaces. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-baseline justify-between gap-4 py-0.5 text-sm">
      <span className="text-muted">{label}</span>
      {children}
    </label>
  );
}

const INPUT = "min-h-9 rounded-sky-md bg-surface px-2 text-sm ring-1 ring-border/70";
const BUTTON = "min-h-9 rounded-sky-md px-3 text-xs ring-1 ring-border/70 disabled:opacity-50";

/**
 * Adding a fee or a shipping label.
 *
 * One component for both, because they are the same row in the same table —
 * `kind = 'shipping_label'` is the only difference, and the label form does
 * not ask for a kind it already knows.
 */
function FeeForm({ kind, saving, value, onChange, onAdd }: {
  kind: "charge" | "label";
  saving: boolean;
  value: { kind: string; amount: string; settledBy: string; label: string };
  onChange: (next: { kind: string; amount: string; settledBy: string; label: string }) => void;
  onAdd: () => void;
}) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border/40 pt-2">
      {kind === "charge" ? (
        <select value={value.kind} disabled={saving}
                onChange={(e) => onChange({ ...value, kind: e.target.value })}
                aria-label={modal.kind} className={`${INPUT} w-40`}>
          {(["payment", "marketplace", "other"] as const).map((k) => (
            <option key={k} value={k}>{modal.feeKinds[k]}</option>
          ))}
        </select>
      ) : null}
      <input value={value.amount} disabled={saving} inputMode="decimal"
             placeholder={modal.amount} aria-label={modal.amount}
             onChange={(e) => onChange({ ...value, amount: e.target.value })}
             className={`ob-money ${INPUT} w-24 text-right tabular-nums`} />
      {/* Never the raw enum: the owner reads who paid, not `channel`. */}
      <select value={value.settledBy} disabled={saving}
              onChange={(e) => onChange({ ...value, settledBy: e.target.value })}
              aria-label={modal.settlement} className={`${INPUT} w-36`}>
        <option value="channel">{modal.settledChannel}</option>
        <option value="external">{modal.settledExternal}</option>
      </select>
      {kind === "charge" && value.kind === "other" ? (
        <input value={value.label} disabled={saving} placeholder={modal.label}
               aria-label={modal.label}
               onChange={(e) => onChange({ ...value, label: e.target.value })}
               className={`${INPUT} w-32`} />
      ) : null}
      <button type="button" disabled={saving} onClick={onAdd} className={BUTTON}>
        {modal.addFee}
      </button>
    </div>
  );
}

export function SaleDetails({ sale, detail, open, onClose, onSaved }: {
  sale: SaleRow;
  /** `seller_sale()`'s payload, or undefined while it is still loading. */
  detail: Record<string, unknown> | "failed" | undefined;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const headingId = useId();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /*
   * Edit mode is opt-in. The normal view stays a breakdown you can read; the
   * inputs appear only when the owner says they are correcting something.
   */
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => ({
    soldAt: sale.soldAt ?? "", country: sale.country ?? "",
    buyer: sale.buyerRef ?? "", reference: sale.externalOrderRef ?? "",
    note: sale.note ?? "",
    /* null = untouched, so the stored reference shows through until it is. */
  }));
  const [newFee, setNewFee] = useState({ kind: "payment", amount: "", settledBy: "channel", label: "" });
  const [newRefund, setNewRefund] = useState({ amount: "", reason: "", occurredAt: "" });
  const [audit, setAudit] = useState<Record<string, unknown>[]>([]);

  /* The trail is only worth fetching once the dialog is actually open. */
  useEffect(() => {
    if (!open) return;
    let live = true;
    void loadSaleAudit(sale.id).then((rows) => { if (live) setAudit(rows); });
    return () => { live = false; };
  }, [open, sale.id, sale.updatedAt]);

  const loaded = detail !== undefined && detail !== "failed" ? detail : null;
  const saleRow = (loaded?.sale ?? {}) as Record<string, unknown>;
  /* The stored reference shows through until the field is actually touched. */
  const historical = String(saleRow.source ?? sale.source) === "excel_order_2026";
  const fees = (loaded?.fees ?? []) as FeeRow[];
  const refunds = (loaded?.refunds ?? []) as RefundRow[];
  const adjustments = (loaded?.adjustments ?? []) as AdjustmentRow[];
  const { charges, labels } = groupFees(fees);

  // The database's number, never one computed here.
  const expected = loaded?.expected_payout === undefined || loaded?.expected_payout === null
    ? sale.expectedPayout : Number(loaded.expected_payout);
  const internal = sale.orderId !== null;

  /*
   * Every write goes through here so they all carry the same concurrency
   * token and report a refusal the same way. `sale.updatedAt` is what the
   * dialog was opened with; the database compares it and refuses a stale edit.
   */
  async function run(action: () => Promise<{ ok: boolean; message?: string }>) {
    setSaving(true);
    setError(null);
    const result = await action();
    setSaving(false);
    if (!result.ok) { setError(result.message ?? null); return false; }
    onSaved();
    return true;
  }

  const money = (raw: string): number | null => {
    const value = raw.trim().replace(",", ".");
    return value === "" ? null : Number(value);
  };

  async function saveMeta() {
    /*
     * The date is its own function because clearing it is a deliberate act —
     * `seller_update_sale` cannot express "set this back to unknown", and a
     * null there means "leave it alone".
     */
    const wanted = draft.soldAt.trim() === "" ? null : draft.soldAt.trim();
    if (wanted !== (sale.soldAt ?? null)) {
      if (!(await run(() => setSaleDate(sale.id, wanted, sale.updatedAt)))) return;
    }
    await run(() => updateSaleMeta(sale.id, {
      country: draft.country.trim() || null,
      buyerRef: draft.buyer.trim() || null,
      externalRef: draft.reference.trim() || null,
      note: draft.note,
    }, sale.updatedAt));
  }

  return (
    <Modal open={open} onClose={onClose} labelledBy={headingId} size="lg">
      <div className="flex items-baseline justify-between gap-4 px-4 pt-4 pb-1">
        <h2 id={headingId} className="text-base font-semibold">{modal.title}</h2>
        <div className="flex items-center gap-2">
          {/* Commerce owns an internal sale; there is nothing to edit here. */}
          {internal ? null : (
            <button type="button" onClick={() => setEditing((on) => !on)}
                    aria-pressed={editing}
                    className={`min-h-9 rounded-sky-md px-2 text-xs ring-1 ${
                      editing ? "bg-surface font-medium ring-fg/40" : "text-muted ring-border/70 hover:text-fg"}`}>
              {editing ? modal.done : modal.edit}
            </button>
          )}
          <button type="button" onClick={onClose}
                  className="min-h-9 rounded-sky-md px-2 text-xs text-muted ring-1 ring-border/70 hover:text-fg">
            {modal.close}
          </button>
        </div>
      </div>

      {error ? (
        <p role="alert" className="mx-4 mb-1 rounded-sky-md bg-surface px-3 py-2 text-xs text-danger ring-1 ring-border/70">
          {error}
        </p>
      ) : null}

      {/* The panel caps its own height; this is the part that scrolls. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section title={modal.sale}>
          <Line label={copy.columns.date} value={formatDate(sale.soldAt)} />
          <Line label={modal.channel}
                value={internal ? (sale.orderNumber ?? CHANNEL_LABELS.skyisles ?? "SkyIsles")
                                : CHANNEL_LABELS[sale.channel] ?? sale.channel} />
          <Line label={copy.columns.country}
                value={sale.country ? `${sale.country} · ${countryLabel(sale.country)}` : "—"} />
          {sale.buyerRef ? <Line label={modal.buyer} value={sale.buyerRef} /> : null}
          {sale.externalOrderRef
            ? <Line label={modal.reference} value={sale.externalOrderRef} /> : null}
          <Line label={modal.shippingState}
                value={sale.shippedAt !== null || sale.fulfillmentStatus === "shipped"
                       || sale.fulfillmentStatus === "completed" ? copy.shipped : copy.notShipped} />
          {/*
            Provenance survives a correction. An imported sale that has since
            been fixed is still an imported sale, and says so.
          */}
          {historical ? (
            <p className="mt-1 text-xs text-muted">
              {modal.imported}
              {audit.length > 0 ? ` · ${modal.editedSince}` : ""}
            </p>
          ) : null}
          {internal ? <p className="mt-1 text-xs text-muted">{modal.commerceLocked}</p> : null}

          {editing ? (
            <div className="mt-2 flex flex-col gap-1 border-t border-border/40 pt-2">
              <Field label={copy.columns.date}>
                {/* Empty means the date is not known — `Datum fehlt`, not a guess. */}
                <input type="date" value={draft.soldAt} disabled={saving}
                       onChange={(e) => setDraft({ ...draft, soldAt: e.target.value })}
                       className={`${INPUT} w-40`} />
              </Field>
              <Field label={copy.columns.country}>
                <input value={draft.country} disabled={saving} maxLength={2}
                       onChange={(e) => setDraft({ ...draft, country: e.target.value.toUpperCase() })}
                       className={`${INPUT} w-20 uppercase`} />
              </Field>
              <Field label={modal.buyer}>
                <input value={draft.buyer} disabled={saving}
                       onChange={(e) => setDraft({ ...draft, buyer: e.target.value })}
                       className={`${INPUT} w-52`} />
              </Field>
              <Field label={modal.reference}>
                <input value={draft.reference} disabled={saving}
                       onChange={(e) => setDraft({ ...draft, reference: e.target.value })}
                       className={`${INPUT} w-52`} />
              </Field>
              <Field label={copy.note}>
                <input value={draft.note} disabled={saving}
                       onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                       className={`${INPUT} w-52`} />
              </Field>
              <div className="mt-1 flex justify-end">
                <button type="button" disabled={saving} onClick={() => void saveMeta()} className={BUTTON}>
                  {modal.save}
                </button>
              </div>
            </div>
          ) : null}
        </Section>

        <Section title={modal.amounts}>
          <Line label={copy.columns.sum} value={formatPrice(sale.itemsSubtotal ?? 0)} />
          <Line label={copy.columns.shipping} value={formatPrice(sale.shippingCharged ?? 0)} />
          <Line label={copy.columns.discount} value={formatPrice(sale.discountAmount ?? 0)} />
          <Line label={copy.columns.refund} value={formatPrice(sale.refunded)} />
        </Section>

        {/*
          Fees and labels are two sections, not one list with a type column:
          the owner asked for the label cost to stand on its own, and the
          settlement mode only means something next to a label.
        */}
        <Section title={modal.charges}>
          {charges.length === 0 ? (
            <p className="text-sm text-muted">{modal.none}</p>
          ) : charges.map((fee) => (
            <div key={String(fee.id)} className="flex items-baseline gap-2">
              <div className="flex-1"><Line label={feeName(fee)} value={formatPrice(Number(fee.amount))} /></div>
              {editing ? (
                <button type="button" disabled={saving}
                        onClick={() => void run(() => removeSaleFee(Number(fee.id), sale.id))}
                        className="min-h-9 text-xs text-muted underline underline-offset-2 disabled:opacity-50">
                  {modal.remove}
                </button>
              ) : null}
            </div>
          ))}
          {editing ? (
            <FeeForm kind="charge" saving={saving} value={newFee} onChange={setNewFee}
                     onAdd={async () => {
                       const amount = money(newFee.amount);
                       if (amount === null) return;
                       if (await run(() => addSaleFee(sale.id, newFee.kind, amount,
                                                      newFee.settledBy, newFee.label || null))) {
                         setNewFee({ ...newFee, amount: "", label: "" });
                       }
                     }} />
          ) : null}
        </Section>

        <Section title={modal.labels}>
          {labels.length === 0 ? (
            <p className="text-sm text-muted">{modal.none}</p>
          ) : labels.map((fee) => (
            <div key={String(fee.id)} className="flex items-baseline gap-2">
              <div className="flex-1">
                <Line label={settlement(fee.settled_by)} value={formatPrice(Number(fee.amount))} />
              </div>
              {editing ? (
                <>
                  {/*
                    Settlement is the one label field worth a one-click
                    correction: it decides whether the channel withheld the
                    cost, and it is the field most easily entered wrong.
                  */}
                  <button type="button" disabled={saving}
                          onClick={() => void run(() => updateSaleFee(Number(fee.id), sale.id,
                            { settledBy: fee.settled_by === "external" ? "channel" : "external" },
                            sale.updatedAt))}
                          className="min-h-9 text-xs text-muted underline underline-offset-2 disabled:opacity-50">
                    {fee.settled_by === "external" ? modal.settledChannel : modal.settledExternal}
                  </button>
                  <button type="button" disabled={saving}
                          onClick={() => void run(() => removeSaleFee(Number(fee.id), sale.id))}
                          className="min-h-9 text-xs text-muted underline underline-offset-2 disabled:opacity-50">
                    {modal.remove}
                  </button>
                </>
              ) : null}
            </div>
          ))}
          {editing ? (
            <FeeForm kind="label" saving={saving} value={newFee} onChange={setNewFee}
                     onAdd={async () => {
                       const amount = money(newFee.amount);
                       if (amount === null) return;
                       if (await run(() => addSaleFee(sale.id, "shipping_label", amount,
                                                      newFee.settledBy, null))) {
                         setNewFee({ ...newFee, amount: "" });
                       }
                     }} />
          ) : null}
        </Section>

        {/* Every refund event, because "3,00 €" twice is not "6,00 €" once. */}
        {refunds.length > 0 || editing ? (
          <Section title={modal.refunds}>
            {refunds.length === 0 ? <p className="text-sm text-muted">{modal.none}</p> : null}
            {refunds.map((refund) => (
              <div key={String(refund.id)} className="flex items-baseline gap-2">
                <div className="flex-1">
                  <Line label={refund.occurred_at ? formatDate(String(refund.occurred_at).slice(0, 10)) : "—"}
                        hint={refundReason(refund.reason)}
                        value={formatPrice(Number(refund.amount))} />
                </div>
                {editing ? (
                  <button type="button" disabled={saving}
                          onClick={() => void run(() => removeSaleRefund(Number(refund.id), sale.id))}
                          className="min-h-9 text-xs text-muted underline underline-offset-2 disabled:opacity-50">
                    {modal.remove}
                  </button>
                ) : null}
              </div>
            ))}
            {refunds.length > 1
              ? <Line label={modal.refunds} value={formatPrice(refundsTotal(refunds))} strong /> : null}
            {editing ? (
              <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border/40 pt-2">
                <input value={newRefund.amount} disabled={saving} inputMode="decimal"
                       placeholder={modal.amount} aria-label={modal.amount}
                       onChange={(e) => setNewRefund({ ...newRefund, amount: e.target.value })}
                       className={`ob-money ${INPUT} w-24 text-right tabular-nums`} />
                <input type="date" value={newRefund.occurredAt} disabled={saving}
                       aria-label={modal.occurredAt}
                       onChange={(e) => setNewRefund({ ...newRefund, occurredAt: e.target.value })}
                       className={`${INPUT} w-40`} />
                {/* Exactly the reasons the database allows — none invented. */}
                <select value={newRefund.reason} disabled={saving} aria-label={modal.reason}
                        onChange={(e) => setNewRefund({ ...newRefund, reason: e.target.value })}
                        className={`${INPUT} w-44`}>
                  <option value="">—</option>
                  {(Object.keys(modal.refundReasons) as (keyof typeof modal.refundReasons)[]).map((r) => (
                    <option key={r} value={r}>{modal.refundReasons[r]}</option>
                  ))}
                </select>
                <button type="button" disabled={saving} className={BUTTON}
                        onClick={() => void (async () => {
                          const amount = money(newRefund.amount);
                          if (amount === null) return;
                          if (await run(() => addSaleRefund(sale.id, amount,
                                newRefund.occurredAt || null, newRefund.reason || null, null))) {
                            setNewRefund({ amount: "", reason: "", occurredAt: "" });
                          }
                        })()}>
                  {modal.addRefund}
                </button>
              </div>
            ) : null}
            {/* Money only. Whether anything came back is the item's business. */}
            <p className="mt-1 text-xs text-muted">{copy.refundNotReturn}</p>
          </Section>
        ) : null}

        {adjustments.length > 0 ? (
          <Section title={modal.adjustments}>
            {adjustments.map((adjustment) => (
              <Line key={String(adjustment.id)}
                    label={adjustment.reason ?? modal.adjustments}
                    /* Signed: a credit reads `+1,38 €`. */
                    value={`${Number(adjustment.amount) > 0 ? "+" : ""}${formatPrice(Number(adjustment.amount))}`} />
            ))}
            {adjustments.length > 1
              ? <Line label={modal.adjustments}
                      value={formatPrice(adjustmentsTotal(adjustments))} strong /> : null}
          </Section>
        ) : null}

        {/*
          One number, and nothing to confirm (ADR-0095).
          `sale_expected_payout()` derives it from this sale's own figures —
          the same expression the create form computes for a sale that does
          not exist yet. There used to be a second line here for what the
          channel had reported, a difference, and a field to type it into;
          that reconciliation is gone.
        */}
        <Section title={modal.payout}>
          <Line label={copy.summary.expected}
                value={expected === null ? "—" : formatPrice(expected)} strong />
          {internal ? <p className="mt-1 text-xs text-muted">{copy.commerceOwned}</p> : null}
        </Section>

        {/*
          What has been corrected since the sale was created or imported. The
          reason an imported figure may legitimately differ from the workbook.
        */}
        <Section title={modal.history}>
          {audit.length === 0 ? (
            <p className="text-sm text-muted">{modal.historyEmpty}</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {audit.slice(0, 20).map((row) => (
                <li key={String(row.id)} className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="text-muted">
                    {new Date(String(row.changed_at)).toLocaleDateString("de-AT")}
                    {" · "}{String(row.entity_type)}
                    {row.field ? ` · ${String(row.field)}` : ""}
                  </span>
                  <span className="tabular-nums">
                    {row.old_value === null ? "—" : String(row.old_value)}
                    {" → "}
                    {row.new_value === null ? "—" : String(row.new_value)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {detail === undefined ? (
          <p className="px-4 pb-3 text-xs text-muted">{copy.loadingItems}</p>
        ) : detail === "failed" ? (
          <p className="px-4 pb-3 text-xs text-muted">{copy.itemsFailed}</p>
        ) : null}
      </div>
    </Modal>
  );
}
