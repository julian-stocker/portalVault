/**
 * Reading reconciliation sessions (ADR-0174).
 *
 * Seller-gated twice, like the other Orderbuch readers: here, so a route can
 * answer before querying, and inside every function, which is the boundary.
 * Staging only while the migrations exist only there.
 */
import { isStagingProjectUrl } from "@/lib/admin/catalog-source";
import { canOperateSeller } from "@/lib/auth/capabilities";
import { createClient } from "@/lib/supabase/server";

export type SessionCategory =
  | "exact" | "deviating" | "probable" | "ambiguous" | "external_only" | "ledger_only" | "not_comparable";

async function allowed(): Promise<boolean> {
  return isStagingProjectUrl(process.env.NEXT_PUBLIC_SUPABASE_URL) && (await canOperateSeller());
}

/** Every session, newest first. Empty when not allowed. */
export async function fetchReconciliationSessions(): Promise<Record<string, unknown>[]> {
  if (!(await allowed())) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("seller_recon_sessions");
  if (error || !Array.isArray(data)) return [];
  return data as Record<string, unknown>[];
}

/** One page of one session; null when not allowed or not found. */
export async function fetchReconciliationSession(
  id: number,
  page: { category?: SessionCategory | null; offset?: number; limit?: number } = {},
): Promise<Record<string, unknown> | null> {
  if (!(await allowed())) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("seller_recon_session", {
    p_id: id, p_category: page.category ?? null, p_offset: page.offset ?? 0, p_limit: page.limit ?? 50,
  });
  if (error || data === null || typeof data !== "object") return null;
  return data as Record<string, unknown>;
}
