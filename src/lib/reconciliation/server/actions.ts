/**
 * The sales reconciliation on the server (ADR-0174).
 *
 * The browser reads the report files and sends only the parsed, normalised
 * model (`UploadInput`). Here it is checked key by key, matched against the
 * sales book and stored as one session.
 *
 * DECIDING, PREVIEWING, APPLYING follow the contract of 0180 (ADR-0178):
 * `take_external` is the only decision that writes, `keep_ledger` a note,
 * `defer` leaves it open; `manual` is refused here before any call. The
 * preview judges EXACTLY the selected decision ids and returns a token; the
 * apply passes the same ids and that token unchanged to
 * `seller_recon_apply(session, decision_ids, token)`. There is no path to
 * the retired `seller_recon_apply(session, expected)` — not as a fallback,
 * not on an error. And the apply is LOCKED (`APPLY_RELEASED`, `release.ts`)
 * until a separate approval: it then calls no database function at all.
 *
 * THE SIMPLE PATH (`confirmReconciliation`) is what the screen uses: one
 * confirmation per "Abgleichen" — the decisions, the preview and the apply in
 * one call, still through the same three 0180 functions and the same token.
 * It never takes a day over, and while `APPLY_RELEASED` is false it writes
 * nothing at all, not even a decision.
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
import { changeValues } from "../decide";
import { distinctFiles, mergeReports } from "../dedupe";
import { reconcile, summarize } from "../diff";
import { matchOrders } from "../match";
import { type ConfirmItem, isConfirmField } from "../plan";
import { APPLY_RELEASED } from "../release";
import { RECONCILIATION_PATH } from "../routes";
import {
  isId, isToken, largeDateGapDecisions, type SelectionPreview, SelectionContractError, selectionIds, selectionPreviewView,
} from "../selection";
import { aliasIndex, ledgerSales, PayloadError, sessionPayload, validateUpload } from "./payload";

const copy = de.business.reconciliation;

export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; message: string };

/** Staging only, until a separate release. Fail-closed: no URL, no feature. */
async function reconciliationAvailable(): Promise<boolean> {
  return isStagingProjectUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
}

/**
 * The database's refusal as one fixed German sentence. Never the database's
 * text, never a value — and the log carries the CODE only: 0180's texts name
 * reason codes, but older functions name ids, and a log is not the place to
 * find out which one spoke.
 */
function message(error: { code?: string; message?: string }): string {
  const text = error.message ?? "";
  if (error.code === "42501") return de.admin.notAllowed;
  // A function 0180 adds, asked on a database that does not have it yet (Staging 0179).
  if (error.code === "PGRST202" || error.code === "42883") return copy.errors.notMigrated;
  if (error.code === "0A000") return copy.errors.retired;
  if (error.code === "PT409") {
    if (text.includes("confirmation counted")) return copy.errors.countChanged;
    if (text.includes("preview again")) return copy.errors.selectionChanged;
    if (text.includes("values shown")) return copy.errors.shownValuesChanged;
    return copy.errors.stale;
  }
  if (error.code === "23505") return copy.errors.duplicateReference;
  if (error.code === "23514") return text.includes("cannot be applied") ? copy.errors.notApplicable : copy.errors.rejected;
  if (error.code === "23001") return copy.errors.notPossible;
  console.error("reconciliation: database refusal", error.code ?? "(no code)");
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
  /** 0180: these three only. A free value is a correction in the Orderbuch, not a decision here. */
  decision: "take_external" | "keep_ledger" | "defer";
  reason?: string | null;
  /** The two values the screen showed — the database compares them (0156 pattern). */
  shownLedger: string | number | null;
  shownExternal: string | number | null;
};

const DECISIONS = ["take_external", "keep_ledger", "defer"] as const;
const isShown = (v: unknown) => v === null || typeof v === "string" || (typeof v === "number" && Number.isFinite(v));

/** Record one decision. Changes no sale — the apply is a separate, locked step. */
export async function decideFinding(input: DecisionInput): Promise<ActionResult<{ decisionId: number }>> {
  const denied = await gate();
  if (denied) return denied;
  // The browser is not trusted: the shape is checked here, the rules in the database.
  const raw = (input ?? {}) as Record<string, unknown>;
  if (raw.decision === "manual" || "manualValue" in raw) return { ok: false, message: copy.errors.manualRetired };
  if (!isId(raw.findingId) || !(DECISIONS as readonly unknown[]).includes(raw.decision)
      || !isShown(raw.shownLedger) || !isShown(raw.shownExternal)
      || !(raw.reason === undefined || raw.reason === null || (typeof raw.reason === "string" && raw.reason.length <= 500))) {
    return { ok: false, message: copy.errors.rejected };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("seller_recon_decide", {
    p_finding_id: raw.findingId,
    p_decision: raw.decision,
    p_manual_value: null,
    p_reason: (raw.reason as string | null | undefined) ?? null,
    p_shown_ledger: input.shownLedger,
    p_shown_external: input.shownExternal,
  });
  if (error) return { ok: false, message: message(error) };
  return { ok: true, decisionId: Number(data) };
}

/**
 * The preview of exactly these decisions (0180). Reads only; the answer —
 * values, token, the large date gaps to confirm — stays in this response.
 */
export async function previewSelection(
  sessionId: number, decisionIds: readonly number[],
): Promise<ActionResult<{ preview: SelectionPreview; confirmDateGaps: number[] }>> {
  const denied = await gate();
  if (denied) return denied;
  const ids = selectionIds(decisionIds);
  if (!isId(sessionId) || ids === null) return { ok: false, message: copy.errors.selectionInvalid };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("seller_recon_preview", { p_session_id: sessionId, p_decision_ids: ids });
  if (error) return { ok: false, message: message(error) };
  try {
    const preview = selectionPreviewView(data);
    return { ok: true, preview, confirmDateGaps: largeDateGapDecisions(preview) };
  } catch (e) {
    if (e instanceof SelectionContractError) {
      console.error("reconciliation: preview contract", e.path);
      return { ok: false, message: copy.errors.loadFailed };
    }
    throw e;
  }
}

export type ApplySelectionInput = {
  sessionId: number;
  /** Exactly the ids of the preview — never "everything open". */
  decisionIds: readonly number[];
  /** The preview's token, passed on unchanged. */
  token: string;
  /** Every decision the preview marked `largeDateGap`, each confirmed by the operator. */
  confirmedDateGaps: readonly number[];
};

/**
 * Apply exactly the previewed selection (0180) — LOCKED until a separate
 * approval (`APPLY_RELEASED`). Before the apply it reads the preview once
 * more: the token must still be the operator's, and every large date gap
 * must be confirmed. The database judges everything again under lock.
 */
export async function applySelection(
  input: ApplySelectionInput,
): Promise<ActionResult<{ applied: number; sales: number }>> {
  const denied = await gate();
  if (denied) return denied;
  if (!APPLY_RELEASED) return { ok: false, message: copy.errors.applyNotReleased };
  const raw = (input ?? {}) as Record<string, unknown>;
  const ids = selectionIds(raw.decisionIds);
  const confirmed = Array.isArray(raw.confirmedDateGaps) && raw.confirmedDateGaps.every(isId)
    ? new Set(raw.confirmedDateGaps as number[]) : null;
  if (!isId(raw.sessionId) || ids === null || confirmed === null) return { ok: false, message: copy.errors.selectionInvalid };
  if (!isToken(raw.token)) return { ok: false, message: copy.errors.selectionChanged };
  const token = raw.token;
  const supabase = await createClient();

  const check = await supabase.rpc("seller_recon_preview", { p_session_id: raw.sessionId, p_decision_ids: ids });
  if (check.error) return { ok: false, message: message(check.error) };
  let preview: SelectionPreview;
  try {
    preview = selectionPreviewView(check.data);
  } catch (e) {
    if (e instanceof SelectionContractError) return { ok: false, message: copy.errors.loadFailed };
    throw e;
  }
  if (!preview.admissible) return { ok: false, message: copy.errors.notApplicable };
  // The reconciliation no longer corrects a day — not through this action either.
  if (preview.changes.some((c) => c.field === "sold_on")) return { ok: false, message: copy.errors.dateNotTakeable };
  if (preview.token !== token) return { ok: false, message: copy.errors.selectionChanged };
  if (largeDateGapDecisions(preview).some((id) => !confirmed.has(id))) {
    return { ok: false, message: copy.errors.dateGapUnconfirmed };
  }

  const { data, error } = await supabase.rpc("seller_recon_apply", {
    p_session_id: raw.sessionId, p_decision_ids: ids, p_token: token,
  });
  if (error) return { ok: false, message: message(error) };
  revalidatePath(RECONCILIATION_PATH);
  const result = (data ?? {}) as { applied?: number; sales?: number };
  return { ok: true, applied: result.applied ?? 0, sales: result.sales ?? 0 };
}

// ---------------------------------------------------------------------------
// "Abgleich bestätigen" — the one confirmation of the simple screen
// ---------------------------------------------------------------------------

export type ConfirmInput = { sessionId: number; items: readonly ConfirmItem[] };

/** The values shown and the preview's agree — money to the cent, text exactly. */
function sameValue(shown: unknown, previewed: unknown): boolean {
  if (shown === null || previewed === null || shown === undefined || previewed === undefined) {
    return (shown ?? null) === (previewed ?? null);
  }
  const a = typeof shown === "number" ? shown : Number(shown);
  const b = typeof previewed === "number" ? previewed : Number(previewed);
  if (typeof shown === "number" || typeof previewed === "number") return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 0.005;
  return String(shown) === String(previewed);
}

/** The browser's items, checked key by key. Null: not a confirmation. */
function confirmInput(raw: unknown): { sessionId: number; items: ConfirmItem[] } | "date" | null {
  const o = (raw ?? {}) as Record<string, unknown>;
  if (!isId(o.sessionId) || !Array.isArray(o.items) || o.items.length === 0 || o.items.length > 500) return null;
  const items: ConfirmItem[] = [];
  const seen = new Set<number>();
  for (const x of o.items as unknown[]) {
    const i = (x ?? {}) as Record<string, unknown>;
    if (i.field === "sold_on") return "date";
    if (!isId(i.findingId) || seen.has(i.findingId) || !isConfirmField(i.field)
        || (i.decision !== "take_external" && i.decision !== "keep_ledger")
        || !isShown(i.shownLedger) || !isShown(i.shownExternal) || Object.keys(i).length !== 5) return null;
    seen.add(i.findingId);
    items.push({ findingId: i.findingId, field: i.field, decision: i.decision,
      shownLedger: i.shownLedger as ConfirmItem["shownLedger"], shownExternal: i.shownExternal as ConfirmItem["shownExternal"] });
  }
  return { sessionId: o.sessionId, items };
}

/**
 * Confirm the reconciliation of the orders in the dialog: record each
 * decision with the values the operator saw, preview exactly the take-overs,
 * check the preview against those values, apply with its token.
 *
 * LOCKED FIRST. While `APPLY_RELEASED` is false nothing is called — no
 * decision is recorded either. Then: only goods value, shipping and order
 * number (`CONFIRM_FIELDS`); a day is refused before any call. A refusal on
 * the way leaves the sales unchanged — decisions already recorded stay as
 * notes and are re-decided by the next confirmation.
 */
export async function confirmReconciliation(input: ConfirmInput): Promise<ActionResult<{ applied: number; sales: number }>> {
  const denied = await gate();
  if (denied) return denied;
  if (!APPLY_RELEASED) return { ok: false, message: copy.errors.applyNotReleased };
  const parsed = confirmInput(input);
  if (parsed === "date") return { ok: false, message: copy.errors.dateNotTakeable };
  if (parsed === null) return { ok: false, message: copy.errors.rejected };
  const { sessionId, items } = parsed;
  const supabase = await createClient();

  const takes = new Map<number, ConfirmItem>();
  for (const item of items) {
    const { data, error } = await supabase.rpc("seller_recon_decide", {
      p_finding_id: item.findingId, p_decision: item.decision, p_manual_value: null, p_reason: null,
      p_shown_ledger: item.shownLedger, p_shown_external: item.shownExternal,
    });
    if (error) return { ok: false, message: message(error) };
    if (item.decision === "take_external") takes.set(Number(data), item);
  }
  if (takes.size === 0) {
    revalidatePath(RECONCILIATION_PATH);
    return { ok: true, applied: 0, sales: 0 };
  }

  const ids = [...takes.keys()].sort((a, b) => a - b);
  const check = await supabase.rpc("seller_recon_preview", { p_session_id: sessionId, p_decision_ids: ids });
  if (check.error) return { ok: false, message: message(check.error) };
  let preview: SelectionPreview;
  try {
    preview = selectionPreviewView(check.data);
  } catch (e) {
    if (e instanceof SelectionContractError) return { ok: false, message: copy.errors.loadFailed };
    throw e;
  }
  if (!preview.admissible || preview.token === null || preview.changes.length !== ids.length) {
    return { ok: false, message: copy.errors.notApplicable };
  }
  for (const c of preview.changes) {
    const item = takes.get(c.decisionId);
    if (c.field === "sold_on") return { ok: false, message: copy.errors.dateNotTakeable };
    if (!item || c.field !== item.field) return { ok: false, message: copy.errors.notApplicable };
    // What would be written is exactly what the operator saw.
    const { old, target } = changeValues(c);
    if (!sameValue(item.shownLedger, old) || !sameValue(item.shownExternal, target)) {
      return { ok: false, message: copy.errors.shownValuesChanged };
    }
  }

  const { data, error } = await supabase.rpc("seller_recon_apply", {
    p_session_id: sessionId, p_decision_ids: ids, p_token: preview.token,
  });
  if (error) return { ok: false, message: message(error) };
  revalidatePath(RECONCILIATION_PATH);
  const result = (data ?? {}) as { applied?: number; sales?: number };
  return { ok: true, applied: result.applied ?? 0, sales: result.sales ?? 0 };
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
