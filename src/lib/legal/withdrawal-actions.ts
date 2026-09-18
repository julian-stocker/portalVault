/**
 * Receiving a withdrawal declared through the § 356a function (ADR-0086).
 *
 * THE ANSWER IS ALWAYS THE SAME. Whether the order number and e-mail matched,
 * whether a withdrawal already existed, whether the throttle refused — the
 * caller gets `{ ok: true }`. Anything else would turn a statutory consumer
 * function into an oracle for "has this address ordered anything", which is a
 * question an attacker would very much like answered.
 *
 * The consumer is not left guessing: they learn the outcome the way § 356a
 * Abs. 4 intends, by the receipt confirmation arriving at the address they
 * gave — carrying the content of their declaration and the date and time of
 * receipt. The page says exactly that.
 *
 * NO LOGIN. A guest bought without an account and must be able to withdraw
 * without one. Identification is the order number together with the e-mail
 * address on the order; both are things the buyer has and a stranger does not.
 *
 * THE TIMESTAMP IS THE DATABASE'S. `received_at` defaults to `now()` in
 * Postgres. A browser clock decides nothing about whether a statutory period
 * was met.
 */
"use server";

import { createClient } from "@/lib/supabase/server";

export type WithdrawalResult = { ok: true };

/** Mirrors the CHECK constraints so a malformed request never leaves the app. */
function looksValid(input: { orderNumber: string; name: string; email: string }): boolean {
  return (
    input.orderNumber.trim().length > 0 &&
    input.name.trim().length > 0 &&
    input.name.trim().length <= 200 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim()) &&
    input.email.trim().length <= 254
  );
}

export async function declareWithdrawal(input: {
  orderNumber: string;
  name: string;
  email: string;
  declaration: string;
}): Promise<WithdrawalResult> {
  // Even a malformed request answers `ok`. The field validation in the browser
  // is what tells an honest user they mistyped; this path must not become a
  // second, subtler oracle.
  if (!looksValid(input)) return { ok: true };

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("receive_withdrawal", {
      p_order_number: input.orderNumber.trim(),
      p_name: input.name.trim(),
      p_email: input.email.trim(),
      p_declaration: input.declaration.trim(),
    });

    if (error || data === null || typeof data !== "object") return { ok: true };

    const row = data as Record<string, unknown>;
    // `delivered` is false when nothing matched. There is nothing to confirm,
    // and no mail may be sent — sending one would tell whoever owns that
    // address that somebody is probing for their orders.
    if (row.delivered !== true || typeof row.withdrawal_id !== "number") return { ok: true };

    await sendReceipt(row.withdrawal_id);
    return { ok: true };
  } catch {
    return { ok: true };
  }
}

/**
 * The receipt confirmation required by § 356a Abs. 4 BGB.
 *
 * Sent through the same Edge Function as every other mail, because that is
 * where `RESEND_API_KEY` lives and it never reaches this deployment
 * (ADR-0051).
 *
 * One declaration produces one confirmation however often this is called —
 * since `0049`, and not before. The sentence used to stand here as a claim
 * about a refusal that existed nowhere: calling it twice sent twice. What
 * makes it true now is `claim_withdrawal_receipt()`, which moves the row to
 * `sending` and returns true to exactly one caller. Concurrent calls serialise
 * on the row, so the guarantee holds for a double-click as well as a retry.
 *
 * Never throws. The withdrawal is already recorded with its statutory
 * timestamp; a mail provider having a bad minute must not undo that, and the
 * operator sees an unsent receipt on the withdrawal.
 */
async function sendReceipt(withdrawalId: number): Promise<void> {
  try {
    const supabase = await createClient();
    await supabase.functions.invoke("send-order-mail", {
      body: { withdrawalId, kind: "withdrawal_receipt" },
    });
  } catch {
    // Recorded as `pending` in the row; nothing to tell the caller.
  }
}
