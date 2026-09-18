/**
 * Why an order is flagged, and whether it can be repaired (ADR-0079).
 *
 * `needs_resolution` has meant "a human must look at this" since 0010, and
 * until 0043 nothing could clear it — so the seller's screen said shipping was
 * blocked and offered nothing to do about it.
 *
 * There are two ways in and they are not the same problem: a late payment that
 * booked no stock (repairable, if the goods are on the shelf) and a payment
 * amount mismatch (a money question, settled with a refund). This reader tells
 * the screen which one it is.
 */
import { cache } from "react";

import { canOperateSeller } from "@/lib/auth/capabilities";
import { createClient } from "@/lib/supabase/server";

/** The causes the journal can record. `unknown` is a flag with no event. */
export type ReviewCause = "late_payment_unresolved" | "payment_amount_mismatch" | "unknown";

export type ReviewLine = {
  skyId: string;
  condition: string;
  name: string | null;
  required: number;
  /** Free on the shelf today: quantity minus anyone else's live reservation. */
  available: number;
};

export type OrderReview =
  | { flagged: false }
  | {
      flagged: true;
      cause: ReviewCause;
      /** Only a late payment with the goods in stock can be repaired here. */
      resolvable: boolean;
      shortPositions: number;
      lines: ReviewLine[];
    };

export const NOT_FLAGGED: OrderReview = { flagged: false };

export const fetchOrderReview = cache(async (orderNumber: string): Promise<OrderReview> => {
  if (!(await canOperateSeller())) return NOT_FLAGGED;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("seller_order_review", {
    p_order_number: orderNumber,
  });
  // A database without 0043 yields "not flagged", which renders the page
  // exactly as it did before — no recovery offered, nothing broken.
  if (error || data === null || typeof data !== "object") return NOT_FLAGGED;

  const row = data as Record<string, unknown>;
  if (row.flagged !== true) return NOT_FLAGGED;

  const cause =
    row.cause === "late_payment_unresolved" || row.cause === "payment_amount_mismatch"
      ? row.cause
      : "unknown";

  return {
    flagged: true,
    cause,
    resolvable: row.resolvable === true,
    shortPositions: typeof row.short_positions === "number" ? row.short_positions : 0,
    lines: Array.isArray(row.lines)
      ? row.lines.flatMap((entry) => {
          const line = entry as Record<string, unknown>;
          return typeof line.sky_id === "string"
            ? [{
                skyId: line.sky_id,
                condition: typeof line.condition === "string" ? line.condition : "",
                name: typeof line.name === "string" ? line.name : null,
                required: typeof line.required === "number" ? line.required : 0,
                available: typeof line.available === "number" ? line.available : 0,
              }]
            : [];
        })
      : [],
  };
});
