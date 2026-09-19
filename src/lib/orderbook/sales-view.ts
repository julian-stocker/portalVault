/**
 * What the Verkauf screens display (ADR-0089).
 *
 * The arithmetic and the vocabulary, kept out of the components so they can be
 * tested without a browser — the same split that let the Einkauf ledger's
 * summary factor be proved rather than eyeballed.
 */

import type { OrderbookStatus } from "./classification";

export type SaleScope = "intern" | "extern";
export const SALE_SCOPES: readonly SaleScope[] = ["intern", "extern"];

/** `?bereich=` → what the RPC should be asked. */
export function parseScope(raw: string | undefined): SaleScope {
  // Extern is the default: it is the tab with work in it. Internal sales
  // register themselves and need looking at, not doing.
  return raw === "intern" ? "intern" : "extern";
}

/** The scope name the database uses. */
export const rpcScope = (scope: SaleScope): string => (scope === "intern" ? "internal" : "external");

/*
 * `payoutState` and `payoutDifference` were removed in ADR-0095 together with
 * the reported payout they compared against. There is one payout figure now
 * and it is computed, so "offen / stimmt / abweichend" has no question left.
 */


export const CHANNEL_LABELS: Record<string, string> = {
  skyisles: "SkyIsles",
  ebay: "eBay",
  manual: "Manuell",
};

/** Channels the owner may create by hand. `skyisles` is never one of them. */
export const MANUAL_CHANNELS: readonly string[] = ["ebay", "manual"];

export const FEE_LABELS: Record<string, string> = {
  payment: "Transaktionsgebühr",
  marketplace: "Marktplatzgebühr",
  shipping_label: "Versandlabel",
  other: "Sonstige",
};

export const SETTLEMENT_LABELS: Record<string, string> = {
  channel: "Über Verkaufskanal",
  external: "Extern bezahlt",
};

export const REFUND_REASONS: Record<string, string> = {
  artikel_fehlt: "Artikel fehlt",
  artikel_beschaedigt: "Artikel beschädigt",
  nicht_geliefert: "Nicht geliefert",
  versandkorrektur: "Versandkorrektur",
  retoure: "Retoure",
  kulanz: "Kulanz",
  sonstiges: "Sonstiges",
};

/** A country code as a person reads it, falling back to the code itself. */
export function countryLabel(code: string | null): string {
  if (!code) return "—";
  try {
    return new Intl.DisplayNames(["de"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export type SaleItemState = {
  bookedOut: boolean;
  returned: boolean;
  restocked: boolean;
};

export function itemState(item: {
  movement_id: number | null; returned_at: string | null; return_movement_id: number | null;
}): SaleItemState {
  return {
    bookedOut: item.movement_id !== null,
    returned: item.returned_at !== null,
    restocked: item.return_movement_id !== null,
  };
}

/**
 * Which buttons a sold object may show.
 *
 * Only actions the server would actually accept. An impossible button is worse
 * than a missing one: it invites a click that ends in an error message
 * explaining a rule the screen already knew.
 */
export function itemActions(
  item: { movement_id: number | null; returned_at: string | null; return_movement_id: number | null;
          sky_id: string | null },
  historical: boolean,
): { canBook: boolean; canReturn: boolean; canRestock: boolean } {
  // A historical row never moves stock, whatever its legacy markers said.
  if (historical) return { canBook: false, canReturn: false, canRestock: false };
  const state = itemState(item);
  return {
    canBook: !state.bookedOut && item.sky_id !== null,
    canReturn: state.bookedOut && !state.returned,
    canRestock: state.returned && !state.restocked,
  };
}

/**
 * Which of the two pre-Ausbuchen corrections this line still allows (0065).
 *
 * THE SCREEN AND THE DATABASE SAY THE SAME THING, and the database decides.
 * `seller_remove_sale_item` and `seller_set_sale_item_sky` refuse every case
 * below; this exists so a control that would always be denied is not offered.
 *
 * Four refusals, each for its own reason:
 *
 *   a stock movement   the ledger names this unit. Either movement counts —
 *                      an item that went out and came back has two entries
 *                      describing it, and neither survives a delete.
 *   internal           commerce owns an order's lines.
 *   imported parent    a workbook sale owns workbook lines.
 *   legacy markers     `source_row` and the two flags. Provenance no importer
 *                      regenerates, because this project does not re-import.
 *
 * `returned_at` blocks the remap but not the removal check, because an item
 * cannot be returned without having been booked out first — the movement
 * check has already refused it.
 */
export function saleItemEdits(
  item: {
    movement_id: number | null; return_movement_id: number | null; returned_at: string | null;
    source_row?: number | null;
    legacy_stock_flag?: string | null; legacy_shipped_flag?: string | null;
  },
  context: { historical: boolean; internal: boolean },
): { canRemove: boolean; canRemap: boolean } {
  const moved = item.movement_id !== null || item.return_movement_id !== null;
  const legacy = context.historical
    || (item.source_row ?? null) !== null
    || (item.legacy_stock_flag ?? null) !== null
    || (item.legacy_shipped_flag ?? null) !== null;
  const open = !moved && !context.internal && !legacy;
  return { canRemove: open, canRemap: open && item.returned_at === null };
}

/** Newest first, undated last — the same rule the Einkauf ledger follows. */
export function sortSales<T extends { soldAt: string | null; id: number }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.soldAt === null || b.soldAt === null) {
      if (a.soldAt === b.soldAt) return b.id - a.id;
      return a.soldAt === null ? 1 : -1;
    }
    return a.soldAt === b.soldAt ? b.id - a.id : (a.soldAt < b.soldAt ? 1 : -1);
  });
}

/**
 * The Verkauf URL for a given view.
 *
 * `bereich` is the channel axis and `status` the classification axis. They are
 * separate parameters because they are separate questions: `Intern` + `Test`
 * is a perfectly ordinary view, and so is `Extern` + `Unvollständig`.
 */
export function salesHref(
  scope: SaleScope, year?: number | "ohne", month?: number, q?: string | null,
  status: OrderbookStatus = "alle",
): string {
  const params = new URLSearchParams();
  if (scope !== "extern") params.set("bereich", scope);
  if (year !== undefined) params.set("jahr", String(year));
  if (month && year !== "ohne") params.set("monat", String(month));
  if (q) params.set("q", q);
  // The default stays out of the URL, so the plain address keeps its meaning.
  if (status !== "alle") params.set("status", status);
  const query = params.toString();
  return query ? `/business/orderbuch/verkauf?${query}` : "/business/orderbuch/verkauf";
}

/** Only a path inside the Verkauf ledger — `?zurueck=` comes from the URL bar. */
export function safeSalesBackHref(raw: string | undefined): string {
  if (!raw) return "/business/orderbuch/verkauf";
  const decoded = (() => { try { return decodeURIComponent(raw); } catch { return ""; } })();
  const [path] = decoded.split(/[?#]/, 1);
  if (path !== "/business/orderbuch/verkauf" && !path.startsWith("/business/orderbuch/verkauf/")) {
    return "/business/orderbuch/verkauf";
  }
  if (decoded.startsWith("//") || decoded.includes("..") || decoded.includes("\\")) {
    return "/business/orderbuch/verkauf";
  }
  return decoded;
}
