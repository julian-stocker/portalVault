/**
 * The seller's side of a withdrawal, and the repayment (ADR-0086).
 *
 * TWO EVENTS, NEVER ONE. A withdrawal is the consumer's declaration; a refund
 * is money moving back. They are days apart in practice, they can fail
 * independently, and conflating them would make "how much was repaid" a
 * question about a status flag instead of a sum (ADR-0083). So the reader
 * returns both, separately, and recording a refund is its own act.
 */
import { cache } from "react";

import { canOperateSeller } from "@/lib/auth/capabilities";
import { createClient } from "@/lib/supabase/server";

export type SellerWithdrawal = {
  id: number;
  order_number: string;
  consumer_name: string;
  contact_email: string;
  declaration: string;
  received_at: string;
  /** Whether the § 356a Abs. 4 receipt actually reached the consumer. */
  receipt_state: "pending" | "sent" | "failed";
  handled_at: string | null;
  refunded_total: string | number;
};

export const fetchWithdrawals = cache(async (openOnly = false): Promise<SellerWithdrawal[]> => {
  if (!(await canOperateSeller())) return [];

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("seller_withdrawals", { p_open_only: openOnly });
  // A database without 0047 has no withdrawals, which renders as an empty
  // list rather than a broken page.
  if (error || !Array.isArray(data)) return [];
  return data as SellerWithdrawal[];
});
