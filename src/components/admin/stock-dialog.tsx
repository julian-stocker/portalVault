/**
 * Booking a movement.
 *
 * The one way stock changes, and deliberately not a number field over
 * `quantity`: assignment loses the reason, the note and the cost, and it
 * leaves the journal disagreeing with the total. The dialog collects what a
 * movement is — how much, why, and optionally at what cost — and the
 * database writes both sides in one transaction (ADR-0037).
 *
 * It shows where the position will land before anything is booked. The
 * database still decides: a movement that would take stock below what is
 * reserved is refused there, and this preview is a courtesy rather than the
 * guard.
 */
"use client";

import { useState, useTransition } from "react";

import { bookMovement } from "@/lib/admin/actions";
import { MOVEMENT_REASONS, type Condition } from "@/lib/admin/inventory-model";
import { ACTION_NEUTRAL, ACTION_PRIMARY } from "@/components/ui/action";
import { de } from "@/lib/i18n/de";

export function StockDialog({
  skyId,
  condition,
  quantity,
  reserved,
  onDone,
}: {
  skyId: string;
  condition: Condition;
  /** Where the position stands now, for the preview. */
  quantity: number;
  reserved: number;
  onDone: () => void;
}) {
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState<string>("purchase");
  const [note, setNote] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [failed, setFailed] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const parsed = Number.parseInt(delta, 10);
  const valid = Number.isInteger(parsed) && parsed !== 0;
  const after = valid ? quantity + parsed : quantity;
  // The same rule the database enforces, stated early so the button explains
  // itself instead of the request failing.
  const wouldGoNegative = valid && after < reserved;

  function submit() {
    if (!valid || wouldGoNegative) return;
    setFailed(null);
    startTransition(async () => {
      const cost = unitCost.trim() === "" ? null : Number(unitCost.replace(",", "."));
      const result = await bookMovement({
        skyId,
        condition,
        delta: parsed,
        reason,
        // Only a purchase carries a cost basis; everything else leaves it
        // NULL, which is what the legacy stock has too (ADR-0037).
        unitCost: reason === "purchase" ? cost : null,
        note,
      });
      if (!result.ok) {
        setFailed(result.message);
        return;
      }
      onDone();
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-sky-md bg-surface/80 p-3 ring-1 ring-border/70">
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted">
          {de.inventory.delta}
          <input
            autoFocus
            inputMode="numeric"
            value={delta}
            onChange={(event) => setDelta(event.target.value)}
            placeholder="+3"
            className="min-h-11 w-24 rounded-sky-md bg-surface px-3 text-base tabular-nums ring-1 ring-border/70 focus:ring-border-strong"
          />
        </label>

        <label className="flex flex-1 flex-col gap-1 text-xs text-muted">
          {de.inventory.reason}
          <select
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="min-h-11 rounded-sky-md bg-surface px-3 text-base ring-1 ring-border/70"
          >
            {MOVEMENT_REASONS.map((value) => (
              <option key={value} value={value}>
                {de.inventory.reasons[value]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {reason === "purchase" ? (
        <label className="flex flex-col gap-1 text-xs text-muted">
          {de.inventory.unitCost}
          <input
            inputMode="decimal"
            value={unitCost}
            onChange={(event) => setUnitCost(event.target.value)}
            placeholder="4,50"
            className="min-h-11 rounded-sky-md bg-surface px-3 text-base tabular-nums ring-1 ring-border/70"
          />
          <span className="text-[11px]">{de.inventory.unitCostHint}</span>
        </label>
      ) : null}

      <label className="flex flex-col gap-1 text-xs text-muted">
        {de.inventory.noteLabel}
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          className="min-h-11 rounded-sky-md bg-surface px-3 text-base ring-1 ring-border/70"
        />
      </label>

      {valid ? (
        <p className={`text-sm tabular-nums ${wouldGoNegative ? "text-danger" : "text-muted"}`}>
          {wouldGoNegative ? de.inventory.wouldGoNegative : de.inventory.preview(quantity, after)}
        </p>
      ) : null}
      {failed ? (
        <p role="alert" className="text-sm text-danger">
          {failed}
        </p>
      ) : null}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={!valid || wouldGoNegative || pending}
          className={`${ACTION_PRIMARY} disabled:opacity-60`}
        >
          {de.inventory.book}
        </button>
        <button type="button" onClick={onDone} className={ACTION_NEUTRAL}>
          {de.inventory.cancel}
        </button>
      </div>
    </div>
  );
}
