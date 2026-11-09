"use server";
/**
 * Candidates for an unmatched order (ADR-0182): the search beyond the first
 * three, and the explicit assignment (0185).
 *
 * The search reads only — `seller_recon_candidates` for the chosen period,
 * scored by the analysis' own rule (`candidates.ts`). The assignment
 * forwards the order, the sale and the version the operator saw to
 * `seller_recon_assign_sale`, which re-checks everything under lock and
 * writes only the order number. Both read the order from the STORED session,
 * never from the browser.
 */
import { revalidatePath } from "next/cache";

import { isStagingProjectUrl } from "@/lib/admin/catalog-source";
import { canOperateSeller } from "@/lib/auth/capabilities";
import { de } from "@/lib/i18n/de";
import { createClient } from "@/lib/supabase/server";
import { type CandidateExplanation, candidatesFor } from "../candidates";
import { buildAliasIndex } from "../names";
import { ORDERBOOK_SALES_PATH, RECONCILIATION_PATH } from "../routes";
import type { Match } from "../view";
import { aliasIndex, ledgerSales } from "./payload";
import { fetchReconciliationSessionAll } from "./queries";

const t = de.business.reconciliation.candidates;
const CODES = ["version_required", "session", "not_unmatched", "no_lines", "sale", "ref_present", "ref_taken", "paired",
  "rival_sale", "rival_order"] as const;
type Code = (typeof CODES)[number];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 92;
const MAX_RESULTS = 25;

async function allowed(): Promise<boolean> {
  return isStagingProjectUrl(process.env.NEXT_PUBLIC_SUPABASE_URL) && (await canOperateSeller());
}

/** The unmatched order of this card, and who is paired in its session — from the stored session. */
async function unmatchedOrder(sessionId: number, matchId: number):
  Promise<{ match: Match; channel: string; paired: Set<number>; matches: Match[] } | null> {
  if (!Number.isInteger(sessionId) || !Number.isInteger(matchId)) return null;
  const result = await fetchReconciliationSessionAll(sessionId);
  if (result.status !== "ok") return null;
  const match = result.matches.find((m) => m.id === matchId);
  if (!match || match.category !== "external_only" || match.sale !== null || match.order === null || match.order.lines === null) return null;
  const paired = new Set(result.matches.filter((m) => m.order !== null && m.sale !== null).map((m) => m.sale!.id));
  return { match, channel: result.page.session.channel, paired, matches: result.matches };
}

export type CandidateSearch = { ok: true; candidates: CandidateExplanation[]; capped: boolean } | { ok: false; message: string };

/** Every candidate of the card's order sold between `from` and `to` (at most 92 days), best first. */
export async function searchCandidates(sessionId: number, matchId: number, from: string, to: string): Promise<CandidateSearch> {
  if (!(await allowed())) return { ok: false, message: de.admin.notAllowed };
  if (!DAY.test(from) || !DAY.test(to) || from > to
      || (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 > MAX_DAYS) {
    return { ok: false, message: t.searchRange };
  }
  const ctx = await unmatchedOrder(sessionId, matchId);
  if (ctx === null) return { ok: false, message: t.assignErrors.not_unmatched };
  const supabase = await createClient();
  const [cand, aliases] = await Promise.all([
    supabase.rpc("seller_recon_candidates", { p_channel: ctx.channel, p_from: from, p_to: to }),
    supabase.rpc("seller_recon_aliases", { p_channel: ctx.channel }),
  ]);
  if (cand.error) return { ok: false, message: de.admin.writeFailed };
  // The function pads ±3 days; the operator asked for exactly this period.
  const sales = ledgerSales(cand.data).filter((s) => s.soldOn !== null && s.soldOn >= from && s.soldOn <= to);
  const index = new Map([...buildAliasIndex(sales), ...(aliases.error ? [] : aliasIndex(aliases.data))]);
  const order = { ...ctx.match.order!, lines: ctx.match.order!.lines ?? [] };
  const { shown } = candidatesFor(order, sales, ctx.paired, index, null, ctx.matches);
  return { ok: true, candidates: shown.slice(0, MAX_RESULTS), capped: shown.length > MAX_RESULTS };
}

export type AssignResult = { ok: true; status: "assigned" | "exists"; saleId: number } | { ok: false; message: string };

/** The code inside "this sale cannot be assigned (<code>)", or null. */
async function refusal(message: string | undefined): Promise<Code | null> {
  const code = /cannot be assigned \(([a-z_]+)\)/.exec(message ?? "")?.[1];
  return code !== undefined && (CODES as readonly string[]).includes(code) ? (code as Code) : null;
}

/** Assign the card's order to this sale — only after the operator confirmed it; 0185 checks everything again. */
export async function assignSaleToReport(sessionId: number, matchId: number, saleId: number, expectedUpdatedAt: string | null):
  Promise<AssignResult> {
  if (!(await allowed())) return { ok: false, message: de.admin.notAllowed };
  if (!Number.isInteger(saleId) || saleId <= 0 || typeof expectedUpdatedAt !== "string" || expectedUpdatedAt === "") {
    return { ok: false, message: t.assignErrors.rejected };
  }
  const ctx = await unmatchedOrder(sessionId, matchId);
  if (ctx === null) return { ok: false, message: t.assignErrors.not_unmatched };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("seller_recon_assign_sale", {
    p_order_id: ctx.match.order!.id, p_sale_id: saleId, p_expected_updated_at: expectedUpdatedAt,
  });
  if (error) {
    if (error.code === "42501") return { ok: false, message: de.admin.notAllowed };
    if (error.code === "PT409") return { ok: false, message: t.assignErrors.stale };
    if (error.code === "PGRST202") return { ok: false, message: t.assignErrors.notAvailable };
    if (error.code === "23505") return { ok: false, message: t.assignErrors.ref_taken };
    const code = await refusal(error.message);
    if (code !== null) return { ok: false, message: t.assignErrors[code] };
    console.error("reconciliation assign: database refusal", error.code ?? "(no code)");
    return { ok: false, message: de.admin.writeFailed };
  }
  const r = data as { status?: unknown; sale_id?: unknown } | null;
  if (!r || (r.status !== "assigned" && r.status !== "exists") || typeof r.sale_id !== "number") {
    return { ok: false, message: de.admin.writeFailed };
  }
  revalidatePath(RECONCILIATION_PATH, "layout");
  revalidatePath(ORDERBOOK_SALES_PATH);
  return { ok: true, status: r.status, saleId: r.sale_id };
}

/*
 * ZUORDNUNG TROTZ KONKURRENZ (0186, ADR-0183). Both ways — an unmatched order
 * and an existing sale, or a certain pair without its number — with every
 * rival excluded by the operator, each sale with the version seen, and a
 * reason. The database recomputes the rivals under lock and writes only if
 * they are exactly these; nothing else changes. Order and pair come from the
 * STORED session.
 */
const EXCLUSION_CODES = ["version_required", "note", "exclusions", "session", "not_assignable", "no_lines", "sale",
  "ref_present", "ref_taken", "paired", "no_rivals", "rivals_changed"] as const;
type ExclusionCode = (typeof EXCLUSION_CODES)[number];
export type Exclusions = { sales: { id: number; updatedAt: string }[]; orders: { id: number }[] };

const isExclusions = (v: unknown): v is Exclusions => {
  const o = v as Exclusions | null;
  return o !== null && typeof o === "object" && Object.keys(o).sort().join(",") === "orders,sales"
    && Array.isArray(o.sales) && Array.isArray(o.orders) && o.sales.length + o.orders.length > 0 && o.sales.length + o.orders.length <= 50
    && o.sales.every((x) => x && Object.keys(x).sort().join(",") === "id,updatedAt" && Number.isInteger(x.id) && typeof x.updatedAt === "string" && x.updatedAt !== "")
    && o.orders.every((x) => x && Object.keys(x).join(",") === "id" && Number.isInteger(x.id));
};

async function exclusionRefusal(message: string | undefined): Promise<ExclusionCode | null> {
  const code = /cannot be confirmed \(([a-z_]+)\)/.exec(message ?? "")?.[1];
  return code !== undefined && (EXCLUSION_CODES as readonly string[]).includes(code) ? (code as ExclusionCode) : null;
}

export async function confirmWithExclusions(sessionId: number, matchId: number, saleId: number,
  expectedUpdatedAt: string | null, excluded: unknown, note: string): Promise<AssignResult> {
  if (!(await allowed())) return { ok: false, message: de.admin.notAllowed };
  const text = typeof note === "string" ? note.trim() : "";
  if (!Number.isInteger(saleId) || saleId <= 0 || typeof expectedUpdatedAt !== "string" || expectedUpdatedAt === ""
      || !isExclusions(excluded) || text === "" || text.length > 500) {
    return { ok: false, message: t.exclude.errors.rejected };
  }
  if (!Number.isInteger(sessionId) || !Number.isInteger(matchId)) return { ok: false, message: t.exclude.errors.rejected };
  const result = await fetchReconciliationSessionAll(sessionId);
  if (result.status !== "ok") return { ok: false, message: t.exclude.errors.not_assignable };
  const match = result.matches.find((m) => m.id === matchId);
  // An unmatched order with any sale, or a pair with exactly its own sale — the database checks it again.
  const fits = match && match.order !== null
    && ((match.category === "external_only" && match.sale === null) || (match.sale !== null && match.sale.id === saleId));
  if (!fits) return { ok: false, message: t.exclude.errors.not_assignable };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("seller_recon_confirm_order_ref", {
    p_order_id: match!.order!.id, p_sale_id: saleId, p_expected_updated_at: expectedUpdatedAt, p_excluded: excluded, p_note: text,
  });
  if (error) {
    if (error.code === "42501") return { ok: false, message: de.admin.notAllowed };
    if (error.code === "PT409") return { ok: false, message: t.assignErrors.stale };
    if (error.code === "PGRST202") return { ok: false, message: t.exclude.errors.notAvailable };
    if (error.code === "23505") return { ok: false, message: t.assignErrors.ref_taken };
    const code = await exclusionRefusal(error.message);
    if (code !== null) return { ok: false, message: t.exclude.errors[code] };
    console.error("reconciliation confirm with exclusions: database refusal", error.code ?? "(no code)");
    return { ok: false, message: de.admin.writeFailed };
  }
  const r = data as { status?: unknown; sale_id?: unknown } | null;
  if (!r || (r.status !== "confirmed" && r.status !== "exists") || typeof r.sale_id !== "number") {
    return { ok: false, message: de.admin.writeFailed };
  }
  revalidatePath(RECONCILIATION_PATH, "layout");
  revalidatePath(ORDERBOOK_SALES_PATH);
  return { ok: true, status: r.status === "exists" ? "exists" : "assigned", saleId: r.sale_id };
}
