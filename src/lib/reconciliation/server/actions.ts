/**
 * The sales reconciliation on the server (ADR-0174).
 *
 * The browser reads the report files and sends only the parsed, normalised
 * model (`UploadInput`). Here it is checked key by key, matched against the
 * sales book and stored as one session. Deciding and applying are thin
 * pass-throughs to the seller-gated functions of 0172/0173.
 *
 * TWO GATES, AND NEITHER IS THE BOUNDARY ON ITS OWN. `canOperateSeller()`
 * answers a denied click with a sentence; the database refuses anyway. And
 * `reconciliationAvailable()` keeps the feature on Staging while the
 * migrations exist only there — on Production the functions are simply
 * missing, which is the real lock (ADR-0174).
 */
"use server";

import { revalidatePath } from "next/cache";

import { isStagingProjectUrl } from "@/lib/admin/catalog-source";
import { canOperateSeller } from "@/lib/auth/capabilities";
import { de } from "@/lib/i18n/de";
import { createClient } from "@/lib/supabase/server";
import { coverageOf } from "../coverage";
import { distinctFiles, mergeReports } from "../dedupe";
import { reconcile, summarize } from "../diff";
import { matchOrders } from "../match";
import { RECONCILIATION_PATH } from "../routes";
import { aliasIndex, ledgerSales, PayloadError, sessionPayload, validateUpload } from "./payload";

const copy = de.business.reconciliation;

export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; message: string };

/** Staging only, until a separate release. Fail-closed: no URL, no feature. */
async function reconciliationAvailable(): Promise<boolean> {
  return isStagingProjectUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
}

function message(error: { code?: string; message?: string }): string {
  if (error.code === "42501") return de.admin.notAllowed;
  if (error.code === "PT409") {
    return (error.message ?? "").includes("confirmation counted") ? copy.errors.countChanged : copy.errors.stale;
  }
  if (error.code === "23505") return copy.errors.duplicateReference;
  if (error.code === "23514") return copy.errors.rejected;
  if (error.code === "23001") return copy.errors.notPossible;
  // The database's texts name fields and states, never report values.
  console.error("reconciliation:", error.code, error.message);
  return de.admin.writeFailed;
}

async function gate(): Promise<{ ok: false; message: string } | null> {
  if (!(await reconciliationAvailable())) return { ok: false, message: copy.errors.notAvailable };
  if (!(await canOperateSeller())) return { ok: false, message: de.admin.notAllowed };
  return null;
}

/**
 * Analyse the uploaded reports and store the result as one session.
 * Returns the session — an existing open one, if exactly these files were
 * analysed before.
 */
export async function analyseReconciliation(input: unknown): Promise<ActionResult<{ sessionId: number }>> {
  const denied = await gate();
  if (denied) return denied;

  let upload;
  try {
    upload = validateUpload(input);
  } catch (error) {
    if (error instanceof PayloadError) return { ok: false, message: copy.errors.invalidUpload };
    throw error;
  }
  const parsers = new Set(upload.files.map((f) => `${f.report.parser}@${f.report.parserVersion}`));
  if (parsers.size !== 1) return { ok: false, message: copy.errors.mixedFormats };

  const merged = mergeReports(upload.files.map((f) => ({ report: f.report, fingerprint: f.fingerprint })));
  if (merged.conflicts.length > 0) return { ok: false, message: copy.errors.conflictingOrders };
  if (merged.orders.length === 0) return { ok: false, message: copy.errors.noOrders };
  // A file read twice is one file — by content and position, never by name (`distinctFiles`).
  const files = distinctFiles(upload.files).kept;
  const reports = files.map((f) => f.report);
  const coverage = coverageOf(reports, merged.orders);

  const supabase = await createClient();
  const candidates = await supabase.rpc("seller_recon_candidates", {
    p_channel: upload.channel, p_from: coverage.firstSoldOn, p_to: coverage.lastSoldOn,
  });
  if (candidates.error) return { ok: false, message: message(candidates.error) };
  const aliases = await supabase.rpc("seller_recon_aliases", { p_channel: upload.channel });
  if (aliases.error) return { ok: false, message: message(aliases.error) };

  const rows = reconcile(matchOrders(merged.orders, ledgerSales(candidates.data), coverage, { aliases: aliasIndex(aliases.data) }));
  const payload = sessionPayload({
    parser: reports[0].parser, parserVersion: reports[0].parserVersion,
    files, orders: merged.orders, coverage, rows, summary: summarize(rows),
  });

  const created = await supabase.rpc("seller_recon_create", { p_payload: payload });
  if (created.error) return { ok: false, message: message(created.error) };
  revalidatePath(RECONCILIATION_PATH);
  return { ok: true, sessionId: Number(created.data) };
}

export type DecisionInput = {
  findingId: number;
  decision: "take_external" | "keep_ledger" | "manual" | "defer";
  manualValue?: Record<string, unknown> | null;
  reason?: string | null;
  /** The two values the screen showed — the database compares them (0156 pattern). */
  shownLedger: string | number | null;
  shownExternal: string | number | null;
};

export async function decideFinding(input: DecisionInput): Promise<ActionResult<{ decisionId: number }>> {
  const denied = await gate();
  if (denied) return denied;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("seller_recon_decide", {
    p_finding_id: input.findingId,
    p_decision: input.decision,
    p_manual_value: input.manualValue ?? null,
    p_reason: input.reason ?? null,
    p_shown_ledger: input.shownLedger,
    p_shown_external: input.shownExternal,
  });
  if (error) return { ok: false, message: message(error) };
  return { ok: true, decisionId: Number(data) };
}

/** The separate final confirmation: `expected` is the count the operator confirmed. */
export async function applyReconciliation(
  sessionId: number, expected: number,
): Promise<ActionResult<{ applied: number; documented: number; sales: number }>> {
  const denied = await gate();
  if (denied) return denied;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("seller_recon_apply", { p_session_id: sessionId, p_expected: expected });
  if (error) return { ok: false, message: message(error) };
  revalidatePath(RECONCILIATION_PATH);
  const result = (data ?? {}) as { applied?: number; documented?: number; sales?: number };
  return { ok: true, applied: result.applied ?? 0, documented: result.documented ?? 0, sales: result.sales ?? 0 };
}

async function sessionCall(fn: string, sessionId: number): Promise<ActionResult> {
  const denied = await gate();
  if (denied) return denied;
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, { p_id: sessionId });
  if (error) return { ok: false, message: message(error) };
  revalidatePath(RECONCILIATION_PATH);
  return { ok: true };
}

export async function closeReconciliation(sessionId: number): Promise<ActionResult> {
  return sessionCall("seller_recon_close", sessionId);
}

export async function discardReconciliation(sessionId: number): Promise<ActionResult> {
  return sessionCall("seller_recon_discard", sessionId);
}

export async function thinReconciliationSnapshots(sessionId: number): Promise<ActionResult> {
  return sessionCall("seller_recon_thin_snapshots", sessionId);
}
