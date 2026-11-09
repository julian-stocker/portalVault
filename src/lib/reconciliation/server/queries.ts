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
import { needsReassessment } from "../live";
import { CANDIDATE_WINDOW_DAYS, candidatesFor, explainCandidate } from "../candidates";
import { type AliasIndex, buildAliasIndex } from "../names";
import { rivalOrders, rivalSales, wantsOrderNumber } from "../rivals";
import {
  PAGE_LIMIT_MAX, sessionListView, sessionPageView, ViewContractError,
  type Match, type PageRequest, type SessionListItem, type SessionPage,
} from "../view";
import { aliasIndex, ledgerSales } from "./payload";

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

/** At most this many pages of `PAGE_LIMIT_MAX` are read for one result view. */
export const ALL_PAGES_MAX = 25;

export type SessionAllResult =
  | { status: "ok"; page: SessionPage; matches: Match[]; complete: boolean }
  | { status: "unavailable" }
  | { status: "not_found" }
  | { status: "error" };

/**
 * EVERY match of one session, for the result view (2026-11-08).
 *
 * The three outcomes (Identisch, Ergänzen, Abweichung) are derived per order
 * on the server from what the database answered (`orderOutcome`) — they are
 * not a database category, so the database cannot page by them. A monthly
 * report is a few dozen orders: the session is read in pages of
 * `PAGE_LIMIT_MAX`, unfiltered, and joined here. More than `ALL_PAGES_MAX`
 * pages and `complete` is false — the screen says so instead of counting a
 * part as the whole. Read only, same gates as `fetchReconciliationSession`.
 */
export async function fetchReconciliationSessionAll(id: number): Promise<SessionAllResult> {
  const matches: Match[] = [];
  let first: SessionPage | null = null;
  for (let n = 0; n < ALL_PAGES_MAX; n += 1) {
    const r = await fetchReconciliationSession(id, { category: null, offset: n * PAGE_LIMIT_MAX, limit: PAGE_LIMIT_MAX });
    if (r.status !== "ok") return r;
    first ??= r.page;
    matches.push(...r.page.matches);
    if (r.page.page.nextOffset === null || r.page.matches.length === 0) {
      return { status: "ok", page: first, matches, complete: true };
    }
  }
  return { status: "ok", page: first!, matches, complete: false };
}

/*
 * THE CURRENT POSITIONS, FOR THE PAIRS THAT CHANGED (2026-11-08, 0181).
 *
 * A session stores its figure findings at analysis. After a correction in the
 * Orderbuch the page must judge the figures and the count again on what the
 * sale holds NOW — by the analysis' own rules (`live.ts`). The names of the
 * positions are not in the session read, so they come from the same two
 * functions the analysis reads: `seller_recon_candidates` (the sales of the
 * days in question, in the analysis' shape) and `seller_recon_aliases`.
 * Only for the pairs that need it (`needsReassessment`); a refusal or an
 * unknown shape leaves the matches as they were — the stored findings then
 * stand, nothing is guessed.
 */
export async function attachLivePieces(channel: string, matches: readonly Match[]): Promise<Match[]> {
  const need = matches.filter((m) => m.sale !== null && needsReassessment(m) && m.ledger?.current.soldOn);
  if (need.length === 0 || !(await allowed())) return [...matches];
  const days = need.map((m) => m.ledger!.current.soldOn as string).sort();
  const supabase = await createClient();
  const [candidates, aliases] = await Promise.all([
    supabase.rpc("seller_recon_candidates", { p_channel: channel, p_from: days[0], p_to: days[days.length - 1] }),
    supabase.rpc("seller_recon_aliases", { p_channel: channel }),
  ]);
  if (candidates.error || aliases.error) {
    console.error("reconciliation live pieces:", candidates.error?.code ?? aliases.error?.code);
    return [...matches];
  }
  const sales = new Map(ledgerSales(candidates.data).map((s) => [s.saleId, s]));
  const index = aliasIndex(aliases.data);
  const wanted = new Set(need.map((m) => m.id));
  return matches.map((m) => {
    const sale = wanted.has(m.id) && m.sale ? sales.get(m.sale.id) : undefined;
    if (!sale) return m;
    const skyIds = new Set(sale.pieces.map((p) => p.skyId).filter((x): x is string => x !== null));
    return { ...m, livePieces: {
      pieces: sale.pieces,
      aliases: [...skyIds].map((sky) => [sky, index.get(sky) ?? []] as const),
    } };
  });
}

/**
 * What the cards need about OTHER sales, from ONE read of
 * `seller_recon_candidates`:
 *
 *   rivals          for each pair that asks for an order number, the unpaired
 *                   sales that block it (`rival_sale`, 0180) by the database's
 *                   own rule (`rivals.ts`). Display only.
 *   createdSaleId   for an unmatched order (`external_only`), the sale that
 *                   carries its number NOW — created from the report (0183)
 *                   or typed by hand. The card then links it instead of
 *                   offering "Als offene Bestellung anlegen" again.
 *
 * `matches` must be the WHOLE session: a sale paired anywhere in it is no
 * rival. On any read error the matches come back unchanged: the card then
 * says nothing rather than something unproven (and the database refuses a
 * second creation anyway).
 */
export async function attachOrderContext(channel: string, matches: readonly Match[]): Promise<Match[]> {
  const rivalNeed = matches.filter((m) => m.sale !== null && m.order !== null && m.order.lines !== null && wantsOrderNumber(m));
  const unmatched = matches.filter((m) => m.sale === null && m.order !== null && m.category === "external_only");
  const need = [...rivalNeed, ...unmatched];
  if (need.length === 0 || !(await allowed())) return [...matches];
  const days = need.map((m) => m.order!.soldOn).sort();
  const supabase = await createClient();
  /*
   * ONE READ for the whole page. The function pads ±3 days itself; for an
   * unmatched order the window is ±CANDIDATE_WINDOW_DAYS — a date alone
   * excludes nobody from the candidates (it only scores less).
   */
  const pad = unmatched.length > 0 ? CANDIDATE_WINDOW_DAYS - 3 : 0;
  const [cand, aliasRead] = await Promise.all([
    supabase.rpc("seller_recon_candidates", { p_channel: channel,
      p_from: shift(days[0], -pad), p_to: shift(days[days.length - 1], pad) }),
    unmatched.length > 0 ? supabase.rpc("seller_recon_aliases", { p_channel: channel }) : Promise.resolve({ data: null, error: null }),
  ]);
  const { data, error } = cand;
  if (error) {
    console.error("reconciliation order context:", error.code);
    return [...matches];
  }
  const candidates = ledgerSales(data);
  // The analysis' own alias rule: the names SkyIsles' sales carry, plus the curated ones (match.ts).
  const aliases = mergeAliases(buildAliasIndex(candidates), aliasRead.error ? undefined : aliasIndex(aliasRead.data));
  const paired = new Set(matches.filter((m) => m.order !== null && m.sale !== null).map((m) => m.sale!.id));
  const wanted = new Set(rivalNeed.map((m) => m.id));
  const orphans = new Set(unmatched.map((m) => m.id));
  const byRef = new Map(candidates.filter((s) => s.externalOrderRef !== null).map((s) => [s.externalOrderRef as string, s.saleId]));
  /*
   * THE ORDER NUMBER DECIDES, NOT THE DATE (2026-11-09). The candidates cover
   * ±3 days around the report's dates; a sale that carries the number under
   * another date (typed by hand, or its date corrected since) is found by
   * the number itself — `seller_sales` searches `external_order_ref`, and
   * only an EXACT match on channel and number counts. One lookup per
   * unmatched order the window did not settle. A failed lookup leaves the
   * card without the creation (fail closed); the database would answer
   * `exists` anyway.
   */
  const unresolved = unmatched.filter((m) => !byRef.has(m.order!.orderRef));
  const looked = new Map<number, number | null | undefined>(await Promise.all(unresolved.map(async (m) => {
    const ref = m.order!.orderRef;
    const r = await supabase.rpc("seller_sales", { p_year: null, p_month: null, p_search: ref, p_undated: false,
      p_scope: "external", p_open_payout: false, p_status: "any" });
    if (r.error || r.data === null || typeof r.data !== "object") return [m.id, undefined] as const;
    const rows = (r.data as { sales?: unknown }).sales;
    const hit = (Array.isArray(rows) ? rows : []).find((x) => {
      const row = x as { external_order_ref?: unknown; channel?: unknown };
      return row.external_order_ref === ref && row.channel === channel;
    }) as { id?: unknown } | undefined;
    return [m.id, hit ? Number(hit.id) : null] as const;
  })));
  return matches.map((m) => {
    if (wanted.has(m.id)) {
      const own = candidates.find((s) => s.saleId === m.sale!.id);
      return { ...m, rivals: rivalSales(m, candidates, paired), ...(own ? { rivalOrders: rivalOrders(own, m.order!.id, matches) } : {}) };
    }
    if (!orphans.has(m.id)) return m;
    const createdSaleId = byRef.get(m.order!.orderRef) ?? (looked.has(m.id) ? looked.get(m.id) : null);
    const order = { ...m.order!, lines: m.order!.lines ?? [] };
    if (typeof createdSaleId === "number") {
      // The sale that carries the number now: compared again, as a candidate would be — the card shows what still differs.
      const linked = candidates.find((s) => s.saleId === createdSaleId);
      return { ...m, createdSaleId,
        ...(linked && m.order!.lines !== null ? { linkedComparison: explainCandidate(order, linked, aliases, { candidates, paired, matches }) } : {}) };
    }
    // No sale has the number (or the lookup failed): the candidates — read-only, best three, a recommendation.
    return { ...m, createdSaleId, ...(m.order!.lines !== null ? { candidates: candidatesFor(order, candidates, paired, aliases, undefined, matches) } : {}) };
  });
}

function shift(day: string, by: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + by);
  return d.toISOString().slice(0, 10);
}

function mergeAliases(own: AliasIndex, extra?: AliasIndex): AliasIndex {
  if (!extra) return own;
  const merged = new Map<string, string[]>();
  for (const [sky, names] of [...own, ...extra]) merged.set(sky, [...new Set([...(merged.get(sky) ?? []), ...names])]);
  return merged;
}
