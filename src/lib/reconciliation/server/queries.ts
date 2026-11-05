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
import {
  sessionListView, sessionPageView, ViewContractError,
  type PageRequest, type SessionListItem, type SessionPage,
} from "../view";

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

/**
 * Four answers for one session page — "there is no such session" is a 404,
 * "could not read it" an alert, and neither looks like an empty session.
 */
export type SessionPageResult =
  | { status: "ok"; page: SessionPage }
  | { status: "unavailable" }
  | { status: "not_found" }
  | { status: "error" };

/**
 * One page of one session (`seller_recon_session`, 0172; `ledger` 0178/0179).
 * Only codes and contract paths are logged — never a value: an order number
 * or a title does not belong in a server log.
 */
export async function fetchReconciliationSession(id: number, request: PageRequest): Promise<SessionPageResult> {
  if (!(await allowed())) return { status: "unavailable" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("seller_recon_session", {
    p_id: id, p_category: request.category, p_offset: request.offset, p_limit: request.limit,
  });
  if (error) {
    // `no_data_found`: no such session — or, behind the gate, none of ours.
    if (error.code === "P0002") return { status: "not_found" };
    console.error("reconciliation session:", error.code);
    return { status: "error" };
  }
  try {
    return { status: "ok", page: sessionPageView(data, request) };
  } catch (e) {
    if (e instanceof ViewContractError) {
      console.error("reconciliation session:", e.path);
      return { status: "error" };
    }
    throw e;
  }
}
