/**
 * What may be done with one position (0095).
 *
 * TWO ACTS, AND ONLY ONE OF THEM IS EVER OFFERED. Before dispatch a position
 * can be cancelled; after it, a quantity can come back. The order's own state
 * decides which, so the operator never sees a control that would be refused.
 *
 * THE TWO QUESTIONS THE OPERATOR ANSWERS, AND THE ONE THEY DO NOT.
 *
 * Cancelling asks WHY (0097) and, separately, WHETHER THE PIECE IS THERE.
 * Neither has a default — a pre-selected answer to a question about a shelf
 * is a guess with a tick beside it, and the second one decides whether stock
 * comes back.
 *
 * THE FIRST NEVER ANSWERS THE SECOND. „Artikel beschädigt" and „Artikel
 * nicht auffindbar" both sound like they settle the shelf question, and
 * neither does: a damaged piece is usually still lying there, and a missing
 * one may have been booked out months ago. So the presence question is asked
 * every time, whatever the reason says.
 *
 * "Was never booked out" is deliberately NOT on the form. It is a technical
 * fact the server reads from the sale movement, and asking a human about it
 * would invite the wrong answer to a question they cannot check.
 *
 * NEVER OPTIMISTIC. The button waits for the database, because the thing on
 * the other side of it is a stock movement.
 */
"use client";

import { useState, useTransition } from "react";

import { ACTION_NEUTRAL, ACTION_PRIMARY } from "@/components/ui/action";
import { cancelOrderLine, receiveOrderReturn } from "@/lib/admin/order-line-actions";
import {
  CANCEL_REASONS, REASON_TAKES_TEXT, type CancelReason, type StockPresence,
} from "@/lib/commerce/order-lines";
import { de } from "@/lib/i18n/de";

const copy = de.admin.orders.lineActions;

const FIELD =
  "min-h-11 w-20 rounded-sky-md bg-surface px-2 text-sm ring-1 ring-border/70 focus-ring";

export function OrderLineActions({ orderNumber, orderLineId, mode, open }: {
  orderNumber: string;
  orderLineId: number;
  /** `cancel` before dispatch, `return` after it, `none` when neither applies. */
  mode: "cancel" | "return" | "none";
  /** How many of this position the server would still accept. */
  open: number;
}) {
  const [showing, setShowing] = useState(false);
  const [quantity, setQuantity] = useState(String(open));
  const [presence, setPresence] = useState<StockPresence | null>(null);
  const [reasonCode, setReasonCode] = useState<CancelReason | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (mode === "none" || open <= 0) return null;

  function submit() {
    setError(null);
    const amount = Number(quantity);
    if (!Number.isInteger(amount) || amount <= 0 || amount > open) {
      setError(copy.quantityInvalid);
      return;
    }
    /* Der Grund zuerst, weil er im Formular oben steht — aber ohne jede
       Wirkung auf die Bestandsfrage darunter. */
    if (mode === "cancel" && reasonCode === null) {
      setError(copy.reasonMissing);
      return;
    }
    if (mode === "cancel" && presence === null) {
      setError(copy.presenceMissing);
      return;
    }

    startTransition(async () => {
      const result = mode === "cancel"
        ? await cancelOrderLine({
            orderNumber, orderLineId, quantity: amount,
            presence: presence as StockPresence,
            reasonCode: reasonCode as CancelReason,
            /* Freitext gehört zu „Sonstiges". Bei den vier benannten Gründen
               wäre er eine zweite, widersprechbare Fassung desselben. */
            reason: reasonCode === REASON_TAKES_TEXT ? reason : undefined,
          })
        : await receiveOrderReturn({ orderNumber, orderLineId, quantity: amount, reason });

      if (!result.ok) {
        setError(result.message);
        return;
      }
      /* The page is revalidated by the action; closing is all that is left. */
      setShowing(false);
      setPresence(null);
      setReasonCode(null);
      setReason("");
    });
  }

  if (!showing) {
    return (
      <button
        type="button"
        onClick={() => { setShowing(true); setQuantity(String(open)); }}
        className={`${ACTION_NEUTRAL} w-auto px-3 text-xs`}
      >
        {mode === "cancel" ? copy.cancel : copy.receiveReturn}
      </button>
    );
  }

  return (
    <div className="mt-2 flex flex-col gap-3 rounded-sky-md bg-surface/80 p-3 text-left ring-1 ring-border/70 md:mt-0">
      <p className="text-sm font-medium">
        {mode === "cancel" ? copy.cancelHeading : copy.receiveHeading}
      </p>

      <label className="flex items-center gap-2 text-sm">
        <span className="text-muted">{copy.quantity}</span>
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={open}
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
          className={FIELD}
        />
        <span className="text-xs text-muted">/ {open}</span>
      </label>

      {/*
        FRAGE 1 VON 2: WARUM (0097).
        Bewusst ein Auswahlfeld und keine Radiogruppe — fünf Gründe wären fünf
        Zeilen über der Frage, auf die es fachlich ankommt. Ohne Vorauswahl,
        und ohne jede Wirkung auf die Bestandsfrage darunter: „Artikel
        beschädigt" sagt nicht, ob das Stück im Regal liegt.
      */}
      {mode === "cancel" ? (
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">{copy.reasonQuestion}</span>
          <select
            value={reasonCode ?? ""}
            onChange={(event) =>
              setReasonCode(event.target.value === "" ? null : event.target.value as CancelReason)}
            className="min-h-11 rounded-sky-md bg-surface px-2 text-sm ring-1 ring-border/70 focus-ring"
          >
            <option value="">—</option>
            {CANCEL_REASONS.map((value) => (
              <option key={value} value={value}>{copy.reasons[value]}</option>
            ))}
          </select>
        </label>
      ) : null}

      {mode === "cancel" && reasonCode === REASON_TAKES_TEXT ? (
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">{copy.reasonNote}</span>
          <input
            type="text"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="min-h-11 rounded-sky-md bg-surface px-3 text-sm ring-1 ring-border/70 focus-ring"
          />
          <span className="text-xs text-muted">{copy.reasonNoteHint}</span>
        </label>
      ) : null}

      {/*
        FRAGE 2 VON 2: LIEGT ES DA.
        Radiobuttons ohne Vorauswahl: es gibt keine Antwort, die „meistens
        stimmt", und die falsche erzeugt entweder ein Phantom im Lager oder
        eine Figur, die niemand mehr findet. Sie wird IMMER gestellt, auch
        wenn der Grund bereits nach einer Antwort klingt.
      */}
      {mode === "cancel" ? (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-sm">{copy.presenceQuestion}</legend>
          {(["present", "missing"] as const).map((value) => (
            <label key={value} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name={`presence-${orderLineId}`}
                checked={presence === value}
                onChange={() => setPresence(value)}
              />
              {value === "present" ? copy.presentLabel : copy.missingLabel}
            </label>
          ))}
          <p className="text-xs text-muted">{copy.presenceHint}</p>
        </fieldset>
      ) : null}

      {/* Die Retoure hat keinen strukturierten Grund: warum ein Kunde
          zurückschickt, ist eine andere Frage als warum wir stornieren. */}
      {mode === "return" ? (
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">{copy.reason}</span>
          <input
            type="text"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="min-h-11 rounded-sky-md bg-surface px-3 text-sm ring-1 ring-border/70 focus-ring"
          />
        </label>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className={`${ACTION_PRIMARY} w-auto px-4 disabled:opacity-60`}
        >
          {mode === "cancel" ? copy.confirm : copy.confirmReturn}
        </button>
        <button
          type="button"
          onClick={() => { setShowing(false); setError(null); }}
          disabled={pending}
          className={`${ACTION_NEUTRAL} w-auto px-4 disabled:opacity-60`}
        >
          {copy.cancelAction}
        </button>
      </div>
    </div>
  );
}
