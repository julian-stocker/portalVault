/**
 * A sale changed since the analysis — judged again by the SAME rule
 * (2026-11-08).
 *
 * WHY. A session stores its findings at analysis (`sales_recon_findings`).
 * When the operator corrects a sale in the Orderbuch — a date, say — that
 * finding stays as it was, and the match only says "changed since the
 * analysis" (`ledger.state = changed`). Claiming "Identisch" from the old
 * findings would be wrong; refusing it forever would be wrong too.
 *
 * WHAT. The database already delivers, on every read, what SkyIsles holds NOW
 * (`ledger.current`, `sales_recon_sale_values`, 0178) next to the report's
 * stored order. This file runs the analysis' own rule — `diffPair` from
 * `diff.ts`, unchanged — on exactly those two, and returns the fields that
 * still differ. No second comparison rule, no tolerance of its own.
 *
 * THE FIGURES (2026-11-08, 0181). The current positions' names are not part
 * of `ledger.current`. The session page therefore attaches them
 * (`livePieces`, from `seller_recon_candidates` — the very rows the analysis
 * reads — and the aliases of those figures from `seller_recon_aliases`)
 * whenever a sale changed since the analysis or its count of positions did.
 * Then the pieces are paired with the stored order's lines by the analysis'
 * own `matchPieces` and judged by `diffPair`: figures AND count, by the same
 * rules. Without `livePieces` — or once the session's snapshots were purged
 * (`order.lines` null) — a stored figure finding stays exactly as the
 * analysis left it.
 *
 * READ ONLY. Nothing is written, no finding and no decision changes; the
 * database judges every take-over again (`seller_recon_decide`, 0180), and a
 * changed sale cannot be taken over in this session at all (`stale`).
 */
import { diffPair, type FindingField } from "./diff.ts";
import { buildAliasIndex, matchPieces } from "./names.ts";
import type { ExternalOrder, IsoDay, LedgerPiece, LedgerSale } from "./types.ts";
import type { Match } from "./view.ts";

/** The fields judged again — the figures only with `livePieces`. */
export const LIVE_FIELDS = ["sold_on", "items_net", "shipping", "pieces", "total", "external_order_ref", "figure"] as const satisfies readonly FindingField[];
export type LiveField = (typeof LIVE_FIELDS)[number];

/** The sale's positions as they are NOW, attached by the session page (`attachLivePieces`). */
export type LivePieces = NonNullable<Match["livePieces"]>;
type LiveMatch = Pick<Match, "order" | "ledger" | "findings" | "livePieces">;

/** How many positions the analysis saw: the stored count finding, else the order's (they were equal). */
export function analysedPieces(m: Pick<Match, "order" | "findings">): number | null {
  const f = m.findings.find((x) => x.field === "pieces");
  if (f && typeof f.shown.ledger === "number") return f.shown.ledger;
  return m.order?.pieces ?? null;
}

/** Should this pair be judged again — the sale changed, or its count of positions did? */
export function needsReassessment(m: Pick<Match, "order" | "ledger" | "findings">): boolean {
  if (m.order === null || m.ledger === null) return false;
  return m.ledger.state === "changed" || m.ledger.current.pieces !== analysedPieces(m);
}

/** Are the figures judged again here (the current positions and the order's lines are both known)? */
export const judgesFigures = (m: LiveMatch): boolean =>
  m.livePieces !== undefined && m.order !== null && m.order.lines !== null && needsReassessment(m);

/**
 * The fields that differ NOW between the stored report order and the sale as it
 * is now — or null when there is nothing to judge again: no pair with both
 * sides, or a sale that did not change since the analysis (then the stored
 * findings are the current ones).
 */
export function liveDifferences(m: LiveMatch): ReadonlySet<LiveField> | null {
  const order = m.order;
  const ledger = m.ledger;
  if (order === null || ledger === null) return null;
  const figures = judgesFigures(m);
  // Unchanged and the same count: the stored findings are the current ones.
  if (ledger.state !== "changed" && !figures) return null;
  const now = ledger.current;
  const external = {
    channel: "ebay", orderRef: order.orderRef, recordNo: order.recordNo,
    soldOn: order.soldOn as IsoDay, paidOn: order.paidOn as IsoDay | null, shippedOn: order.shippedOn as IsoDay | null,
    itemsValue: order.itemsValue, shipping: order.shipping, total: order.total, pieces: order.pieces,
    combined: order.combined, destinationCountry: order.destinationCountry, shippingService: order.shippingService,
    lines: figures ? order.lines!.map((l) => ({ ...l })) : [], sourceFile: order.sourceFile,
  } satisfies ExternalOrder;
  // With `livePieces` the positions themselves; otherwise only their COUNT is known.
  const pieces: LedgerPiece[] = figures ? m.livePieces!.pieces.map((p) => ({ ...p }))
    : Array.from({ length: now.pieces }, (_, i) => ({ itemId: -1 - i, skyId: null, name: null, rawName: null }));
  const sale = {
    saleId: -1, source: "live", isTest: now.isTest, soldOn: now.soldOn as IsoDay | null,
    itemsSubtotal: now.itemsSubtotal, discount: now.discount, shipping: now.shipping, refundsTotal: now.refundsTotal,
    cancelledOn: now.cancelledOn as IsoDay | null, externalOrderRef: now.externalOrderRef, pieces,
  } satisfies LedgerSale;
  // The analysis' own pairing (`matchOrders` → `matchPieces`), with the aliases it would use.
  const aliases = figures ? merge(buildAliasIndex([sale]), new Map(m.livePieces!.aliases)) : undefined;
  const { findings } = diffPair({
    order: external, sale,
    pieces: figures ? matchPieces(external, sale, aliases)
      // No piece pairing: figures are not judged again.
      : { pairs: [], unmatchedExternal: [], unmatchedLedger: [], ratio: 1 },
  });
  const out = new Set<LiveField>();
  for (const f of findings) {
    if (f.field === "figure" && !figures) continue;
    if ((LIVE_FIELDS as readonly string[]).includes(f.field)) out.add(f.field as LiveField);
  }
  return out;
}

function merge(a: ReadonlyMap<string, readonly string[]>, b: ReadonlyMap<string, readonly string[]>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [sky, names] of [...a, ...b]) out.set(sky, [...new Set([...(out.get(sky) ?? []), ...names])]);
  return out;
}
