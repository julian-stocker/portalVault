/**
 * Why an order is blocked, and the one thing the seller can do about it
 * (ADR-0079).
 *
 * The panel this replaces said "Prüfung erforderlich — Versand gesperrt" and
 * stopped. A seller could be handed a paid order with no workflow at all:
 * nothing in the product cleared `needs_resolution`, in any screen or any
 * migration.
 *
 * TWO CAUSES, TWO ANSWERS. A late payment that booked no stock is repairable —
 * if the goods are on the shelf, booking the sale now leaves exactly the state
 * a converted reservation would have left. A payment amount mismatch is not:
 * moving goods does not settle money. The panel says which one this is and
 * offers the action only where there is one.
 *
 * It is not an unlock. The button books stock through the ordinary journal and
 * the flag clears afterwards; if the shelf cannot cover the order the database
 * refuses and the order stays blocked.
 */
"use client";

import { useState, useTransition } from "react";

import { ACTION_PRIMARY } from "@/components/ui/action";
import { resolveStockShortfall } from "@/lib/admin/order-actions";
import type { OrderReview } from "@/lib/admin/order-review";
import { de } from "@/lib/i18n/de";

export function OrderReviewPanel({
  orderNumber,
  review,
}: {
  orderNumber: string;
  review: OrderReview;
}) {
  const copy = de.admin.orders;
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!review.flagged) return null;

  function resolve() {
    setError(null);
    startTransition(async () => {
      const result = await resolveStockShortfall(orderNumber);
      if (result.ok) setDone(true);
      else setError(result.message);
    });
  }

  /* One sentence naming the actual problem, not the internal event name. */
  const explanation =
    review.cause === "payment_amount_mismatch"
      ? { title: copy.reviewMismatchTitle, hint: copy.reviewMismatchHint }
      : review.cause === "late_payment_unresolved"
        ? review.resolvable
          ? { title: copy.reviewLateTitle, hint: copy.reviewLateHint }
          : { title: copy.reviewShortTitle, hint: copy.reviewShortHint }
        : { title: copy.needsResolutionTitle, hint: copy.reviewUnknownHint };

  return (
    // `--danger` and its tints, not raw `red-*`: the product has one colour
    // for "this is wrong" and this is it (F9).
    <div className="mt-5 rounded-sky-lg bg-danger/10 p-5 ring-2 ring-danger/70">
      <h2 className="font-semibold text-danger">{explanation.title}</h2>
      <p className="mt-1 text-sm text-foreground/90">{explanation.hint}</p>
      <p className="mt-1 text-sm text-foreground/90">{copy.needsResolutionHint}</p>

      {/*
       * The numbers behind the sentence, so "reicht nicht" is checkable rather
       * than something the screen merely asserts. Shown for the stock cause
       * only — a money mismatch has nothing to do with the shelf.
       */}
      {review.cause === "late_payment_unresolved" ? (
        <ul className="mt-3 flex flex-col gap-1 text-sm">
          {review.lines.map((line) => (
            <li key={`${line.skyId}-${line.condition}`} className="tabular-nums">
              <span className="font-medium">{line.name ?? line.skyId}</span>{" "}
              <span className={line.available < line.required ? "text-danger" : "text-muted"}>
                · {copy.reviewNeeded} {line.required} · {copy.reviewAvailable} {line.available}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      ) : null}

      {done ? (
        <p role="status" className="mt-3 text-sm text-success">
          {copy.reviewResolved}
        </p>
      ) : review.resolvable ? (
        <button
          type="button"
          onClick={resolve}
          disabled={pending}
          className={`${ACTION_PRIMARY} mt-4 w-auto disabled:opacity-60`}
        >
          {pending ? copy.reviewResolving : copy.reviewResolve}
        </button>
      ) : null}
    </div>
  );
}
