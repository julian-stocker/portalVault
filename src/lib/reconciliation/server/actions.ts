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
 * not on an error. The apply is RELEASED (`APPLY_RELEASED`, `release.ts`):
 * the operator's confirmation is the authorisation. The flag stays as an
 * emergency stop — committed `false`, it calls no database function at all.
 *
 * THE SIMPLE PATH (`confirmReconciliation`) is what the screen uses: one
 * confirmation per "Abgleichen" — the decisions, the preview and the apply in
 * one call, still through the same three 0180 functions and the same token.
 * It never takes a day over, and with the emergency stop set it writes
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
import { type ConfirmItem, isConfirmField, missingOrderNumber, ORDER_NUMBER_FIELD, orderNumberEntry, planMatch } from "../plan";
import { APPLY_RELEASED } from "../release";
import { RECONCILIATION_PATH } from "../routes";
import {
  isId, isToken, largeDateGapDecisions, SELECTION_PROBLEMS, type SelectionPreview, SelectionContractError, type SelectionProblem,
  selectionIds, selectionPreviewView,
} from "../selection";
import { aliasIndex, ledgerSales, PayloadError, sessionPayload, validateUpload } from "./payload";
import { fetchReconciliationSessionAll } from "./queries";

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
  if (error.code === "23514") {
    if (text.includes("cannot be applied")) return copy.errors.notApplicable;
    // 0180's decide: "this finding cannot be taken over (<code>)" — `takeRefusal` names the code.
    if (takeRefusal(error) !== null) return copy.errors.notTakeable;
    return copy.errors.rejected;
  }
  if (error.code === "23001") return copy.errors.notPossible;
  console.error("reconciliation: database refusal", error.code ?? "(no code)");
  return de.admin.writeFailed;
}

/**
 * WHY 0180 REFUSED ONE TAKE-OVER (2026-11-08). `seller_recon_decide` raises
 * `this finding cannot be taken over (<code>)` with the reason code of
 * `sales_recon_take_check`. Only a code from the fixed list counts — never
 * the text around it, never a value; anything else is not a take refusal.
 */
function takeRefusal(error: { code?: string; message?: string }): SelectionProblem | null {
  if (error.code !== "23514") return null;
  const code = /cannot be taken over \(([a-z_]+)\)/.exec(error.message ?? "")?.[1];
  return code !== undefined && (SELECTION_PROBLEMS as readonly string[]).includes(code) ? (code as SelectionProblem) : null;
}

/*
 * A refusal of `seller_recon_decide` that concerns ONLY this one case — for
 * "Eindeutige Bestellnummern übernehmen", where one case must not stop the
 * others. Besides the named refusals of the take check: PT409 (the sale
 * changed since the analysis, or the stored values differ from the ones sent
 * — both case-bound in 0180's decide) is `stale`; "already been applied" is
 * `already_applied`. Everything else (a closed session, rights …) is not
 * case-bound and ends the run.
 */
function caseRefusal(error: { code?: string; message?: string }): SelectionProblem | null {
  const named = takeRefusal(error);
  if (named !== null) return named;
  if (error.code === "PT409") return "stale";
  if (error.code === "23001" && /already been applied/.test(error.message ?? "")) return "already_applied";
  return null;
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
 * Apply exactly the previewed selection (0180) — refused before any call
 * while the emergency stop is set (`APPLY_RELEASED`). Before the apply it reads the preview once
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

/** One item of a confirmation the database will not take over, and why (a code of 0180). */
export type RefusedItem = { findingId: number; problem: SelectionProblem };
/** A confirmation refused because of named items: nothing was previewed, nothing applied. */
export type ConfirmRefusal = { ok: false; message: string; refused: RefusedItem[] };

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
 * THE CONFIRMATION IS THE AUTHORISATION (ADR-0178, 2026-11-08): no second
 * approval. The gates still come first — Staging only, the seller operator
 * only — and with the emergency stop (`APPLY_RELEASED = false`) nothing is
 * called, no decision is recorded either. Then: only goods value and shipping
 * (`CONFIRM_FIELDS`; the order number is `takeOrderNumber`'s); a day is refused before any call. A refusal on
 * the way leaves the sales unchanged — decisions already recorded stay as
 * notes and are re-decided by the next confirmation.
 */
export async function confirmReconciliation(
  input: ConfirmInput,
): Promise<ActionResult<{ applied: number; sales: number }> | ConfirmRefusal> {
  const denied = await gate();
  if (denied) return denied;
  if (!APPLY_RELEASED) return { ok: false, message: copy.errors.applyNotReleased };
  const parsed = confirmInput(input);
  if (parsed === "date") return { ok: false, message: copy.errors.dateNotTakeable };
  if (parsed === null) return { ok: false, message: copy.errors.rejected };
  return decidePreviewApply(parsed.sessionId, parsed.items);
}

/** One take-over the shared path records: a confirm item, or the order number of `takeOrderNumber`. */
type TakeItem = Omit<ConfirmItem, "field"> & { field: ConfirmItem["field"] | typeof ORDER_NUMBER_FIELD };

/*
 * THE ONE PATH TO A TAKE-OVER (0180), shared by "Angaben abgleichen" and
 * "Bestellnummer übernehmen" — unchanged from before the split: decide each
 * item with the values shown, refuse all on any named refusal, preview, check
 * the preview against the values shown, apply with its token.
 */
async function decidePreviewApply(
  sessionId: number, items: readonly TakeItem[],
): Promise<ActionResult<{ applied: number; sales: number }> | ConfirmRefusal> {
  const supabase = await createClient();

  /*
   * EVERY REFUSED TAKE-OVER, NOT ONLY THE FIRST (2026-11-08). The database
   * judges each finding at decide (`sales_recon_take_check`); a refusal there
   * names its reason code. The loop goes on so the operator learns about all
   * of them at once — and then NOTHING is previewed or applied: no silent
   * partial take-over. The decisions recorded on the way change no sale; they
   * are notes, re-decided by the next confirmation (as after any refusal).
   * Every other refusal still ends the confirmation at once.
   */
  const takes = new Map<number, TakeItem>();
  const refused: RefusedItem[] = [];
  for (const item of items) {
    const { data, error } = await supabase.rpc("seller_recon_decide", {
      p_finding_id: item.findingId, p_decision: item.decision, p_manual_value: null, p_reason: null,
      p_shown_ledger: item.shownLedger, p_shown_external: item.shownExternal,
    });
    if (error) {
      const problem = takeRefusal(error);
      if (problem === null) return { ok: false, message: message(error) };
      refused.push({ findingId: item.findingId, problem });
      continue;
    }
    if (item.decision === "take_external") takes.set(Number(data), item);
  }
  if (refused.length > 0) return { ok: false, message: copy.errors.notTakeable, refused };
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

/**
 * "Bestellnummer übernehmen" (2026-11-09): the order number of ONE pair,
 * taken over on its own — never mixed into the financial confirmation.
 *
 * The finding and the values come from the STORED session, not from the
 * browser: the card names only the session and the order. Then the shared
 * path of 0180 (decide → preview → apply) with exactly this one item, so
 * every check of `sales_recon_take_check` holds unchanged — a present number
 * is never overwritten, rivals refuse (`rival_sale`, `rival_order`), a sale
 * changed since is stale. Nothing but `external_order_ref` can be written:
 * the preview must name exactly this one field.
 */
export async function takeOrderNumber(sessionId: number, matchId: number):
  Promise<ActionResult<{ applied: number; sales: number }> | ConfirmRefusal> {
  const denied = await gate();
  if (denied) return denied;
  if (!APPLY_RELEASED) return { ok: false, message: copy.errors.applyNotReleased };
  if (!isId(sessionId) || !isId(matchId)) return { ok: false, message: copy.errors.rejected };
  const result = await fetchReconciliationSessionAll(sessionId);
  if (result.status !== "ok") return { ok: false, message: copy.errors.rejected };
  const match = result.matches.find((m) => m.id === matchId);
  // Both: takeable in this OPEN session (0180), and still missing NOW — a number typed in since is never replaced.
  const entry = match && missingOrderNumber(match) !== null ? orderNumberEntry(planMatch(match)) : null;
  if (!match || entry === null) return { ok: false, message: copy.errors.notTakeable };
  const f = entry.finding;
  return decidePreviewApply(sessionId, [{ findingId: f.id, field: ORDER_NUMBER_FIELD, decision: "take_external",
    shownLedger: f.shown.ledger, shownExternal: f.shown.external }]);
}

/** One case of "Eindeutige Bestellnummern übernehmen", as it ended. */
export type BulkOutcome = {
  matchId: number; orderRef: string | null; saleId: number | null;
  /** taken: written · refused: the database said no (problem) · skipped: no longer takeable here (nothing sent) · not_applied: accepted, but the apply failed as a whole */
  status: "taken" | "refused" | "skipped" | "not_applied";
  problem: SelectionProblem | null;
};
export type BulkResult =
  | { ok: true; applied: number; outcomes: BulkOutcome[] }
  | { ok: false; message: string; outcomes: BulkOutcome[] };

/**
 * "Eindeutige Bestellnummern übernehmen" (2026-11-09): the missing order
 * numbers of many certain pairs — ONLY those the operator saw in the preview
 * (`matchIds`), each rebuilt from the STORED session, each through 0180.
 *
 * ONE PROBLEM NEVER BLOCKS THE OTHERS — AND NOTHING HAPPENS SILENTLY.
 *   1. Not takeable any more in the stored session (number there, taken over,
 *      changed, rivals …): `skipped`, nothing sent for it.
 *   2. `seller_recon_decide` per case: a named refusal of `sales_recon_take_check`
 *      (rival_sale, ref_taken, stale …) makes that case `refused` — the rest go on.
 *   3. One preview of the accepted; a case the preview judges inadmissible is
 *      `refused` with its problem and the preview is taken ONCE more without
 *      it. Each written value must be exactly the order number shown.
 *   4. One apply with the preview's token, under lock — all of the accepted or
 *      none (0180). If it fails, nothing is written and every accepted case
 *      says `not_applied`.
 * Every case comes back with its outcome. Only `external_order_ref` can be
 * written: any other field in a preview ends the run before the apply.
 */
export async function takeOrderNumbers(sessionId: number, matchIds: readonly number[]): Promise<BulkResult> {
  const denied = await gate();
  if (denied) return { ...denied, outcomes: [] };
  if (!APPLY_RELEASED) return { ok: false, message: copy.errors.applyNotReleased, outcomes: [] };
  if (!isId(sessionId) || !Array.isArray(matchIds) || matchIds.length === 0 || matchIds.length > 500
      || !matchIds.every(isId) || new Set(matchIds).size !== matchIds.length) {
    return { ok: false, message: copy.errors.rejected, outcomes: [] };
  }
  const result = await fetchReconciliationSessionAll(sessionId);
  if (result.status !== "ok") return { ok: false, message: copy.errors.rejected, outcomes: [] };
  const byId = new Map(result.matches.map((m) => [m.id, m]));

  const outcomes = new Map<number, BulkOutcome>();
  const accepted = new Map<number, { matchId: number; item: TakeItem }>(); // by decision id
  const supabase = await createClient();
  for (const matchId of matchIds) {
    const m = byId.get(matchId);
    const base = { matchId, orderRef: m?.order?.orderRef ?? null, saleId: m?.sale?.id ?? null, problem: null };
    const entry = m && missingOrderNumber(m) !== null ? orderNumberEntry(planMatch(m)) : null;
    if (!entry) { outcomes.set(matchId, { ...base, status: "skipped" }); continue; }
    const f = entry.finding;
    const item: TakeItem = { findingId: f.id, field: ORDER_NUMBER_FIELD, decision: "take_external",
      shownLedger: f.shown.ledger, shownExternal: f.shown.external };
    const { data, error } = await supabase.rpc("seller_recon_decide", {
      p_finding_id: item.findingId, p_decision: item.decision, p_manual_value: null, p_reason: null,
      p_shown_ledger: item.shownLedger, p_shown_external: item.shownExternal,
    });
    if (error) {
      const problem = caseRefusal(error);
      // Anything not bound to this case (rights, session closed …) ends the run before any apply.
      if (problem === null) return { ok: false, message: message(error), outcomes: [...outcomes.values()] };
      outcomes.set(matchId, { ...base, status: "refused", problem });
      continue;
    }
    accepted.set(Number(data), { matchId, item });
    outcomes.set(matchId, { ...base, status: "not_applied" });
  }
  const done = (ok: true, applied: number): BulkResult => {
    revalidatePath(RECONCILIATION_PATH);
    return { ok, applied, outcomes: matchIds.map((id) => outcomes.get(id)!) };
  };
  const fail = (msg: string): BulkResult => ({ ok: false, message: msg, outcomes: matchIds.map((id) => outcomes.get(id)!) });
  if (accepted.size === 0) return done(true, 0);

  // The preview — at most twice: once more without what it judged inadmissible.
  let preview: SelectionPreview | null = null;
  for (let round = 0; round < 2 && accepted.size > 0; round += 1) {
    const ids = [...accepted.keys()].sort((a, b) => a - b);
    const check = await supabase.rpc("seller_recon_preview", { p_session_id: sessionId, p_decision_ids: ids });
    if (check.error) return fail(message(check.error));
    let p: SelectionPreview;
    try {
      p = selectionPreviewView(check.data);
    } catch (e) {
      if (e instanceof SelectionContractError) return fail(copy.errors.loadFailed);
      throw e;
    }
    if (p.changes.length !== ids.length) return fail(copy.errors.notApplicable);
    const bad = p.changes.filter((c) => c.problem !== null);
    if (bad.length === 0 && p.admissible && p.token !== null) { preview = p; break; }
    if (bad.length === 0) return fail(copy.errors.notApplicable);
    for (const c of bad) {
      const a = accepted.get(c.decisionId);
      if (!a) return fail(copy.errors.notApplicable);
      outcomes.set(a.matchId, { ...outcomes.get(a.matchId)!, status: "refused", problem: c.problem });
      accepted.delete(c.decisionId);
    }
  }
  if (accepted.size === 0) return done(true, 0);
  if (preview === null) return fail(copy.errors.notApplicable);
  for (const c of preview.changes) {
    const a = accepted.get(c.decisionId);
    // Only the order number, exactly as shown — or nothing at all.
    if (!a || c.field !== ORDER_NUMBER_FIELD) return fail(copy.errors.notApplicable);
    const { old, target } = changeValues(c);
    if (!sameValue(a.item.shownLedger, old) || !sameValue(a.item.shownExternal, target)) return fail(copy.errors.shownValuesChanged);
  }
  const ids = [...accepted.keys()].sort((a, b) => a - b);
  const { data, error } = await supabase.rpc("seller_recon_apply", { p_session_id: sessionId, p_decision_ids: ids, p_token: preview.token });
  if (error) return fail(message(error));
  for (const { matchId } of accepted.values()) outcomes.set(matchId, { ...outcomes.get(matchId)!, status: "taken" });
  return done(true, Number((data as { applied?: number } | null)?.applied ?? accepted.size));
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
