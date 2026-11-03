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
import { sessionListView, ViewContractError, type SessionListItem } from "../view";

export type SessionCategory =
  | "exact" | "deviating" | "probable" | "ambiguous" | "external_only" | "ledger_only" | "not_comparable";

/**
 * Does this deployment have the reconciliation at all? Fail-closed: no URL,
 * not the Staging project — no feature. The route answers 404 and the Verkauf
 * page shows no way in (ADR-0174 no. 14).
 */
export function reconciliationEnvironment(): boolean {
  return isStagingProjectUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
}

async function allowed(): Promise<boolean> {
  return reconciliationEnvironment() && (await canOperateSeller());
}

/**
 * Three answers, because "nothing there" and "could not read" must not look
 * the same on the screen:
 *
 *   ok            the sessions, newest first (possibly none)
 *   unavailable   not Staging, or not the seller operator
 *   error         the function refused or answered in a shape we do not know
 */
export type SessionListResult =
  | { status: "ok"; sessions: SessionListItem[] }
  | { status: "unavailable" }
  | { status: "error" };

export async function fetchReconciliationSessions(): Promise<SessionListResult> {
  if (!(await allowed())) return { status: "unavailable" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("seller_recon_sessions");
  if (error) {
    console.error("reconciliation sessions:", error.code);
    return { status: "error" };
  }
  try {
    return { status: "ok", sessions: sessionListView(data) };
  } catch (e) {
    // The path only — `ViewContractError` never carries a value.
    if (e instanceof ViewContractError) {
      console.error("reconciliation sessions:", e.path);
      return { status: "error" };
    }
    throw e;
  }
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
