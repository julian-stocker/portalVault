/**
 * Where one stock position stands with the shop — one answer, stated once
 * (Lagerverwaltung V2, AP1).
 *
 * WHY A FUNCTION. The card used to infer the same facts in four places: the
 * switch read `isListed`, a hint line looked at `available` and
 * `effectivePrice`, the accessory block read `saleState`, and the OVP banner
 * read the condition. The desktop table needs the same answer in one cell,
 * and a filter needs it for every row. Three copies of that inference would
 * drift; one pure function cannot.
 *
 * NO NEW RULE. Every branch below is an existing rule, called rather than
 * restated:
 *
 *   isOperativeCondition()  0108 — only loose stock is traded
 *   isShopGoods()           ADR-0128 — accessories only once released for sale
 *   isOffered()             mirrors `shop_offers()` clause for clause (0029)
 *
 * The function only READS a position. It changes no release, sets no price
 * and suggests nothing automatically: "Freigabe offen" names a decision that
 * is the operator's, it does not make it.
 */
import { isOperativeCondition, isShopGoods, type InventoryPosition } from "@/lib/admin/inventory-model";
import { isOffered } from "@/lib/admin/inventory-overview";
import { de } from "@/lib/i18n/de";

/**
 * The status kinds, in the order the filter offers them.
 *
 *   offered          released, priced, in stock, visible — a customer can buy it
 *   listed_no_price  released, but no shop price — not in the shop        (fix)
 *   listed_hidden    released, but the catalog row is inactive, hidden or
 *                    missing — not in the shop                            (fix)
 *   listed_sold_out  released and priced, nothing free — a sold-out listing
 *   release_open     pieces free, not released — the operator decides  (decision)
 *   unlisted         not released, nothing free
 *   accessory        an accessory not released for sale (ADR-0129)
 *   historical       an OVP row from before 0108 — read-only
 */
export const POSITION_STATUSES = [
  "offered",
  "listed_no_price",
  "listed_hidden",
  "listed_sold_out",
  "release_open",
  "unlisted",
  "accessory",
  "historical",
] as const;
export type PositionStatusKind = (typeof POSITION_STATUSES)[number];

export function isPositionStatusKind(value: unknown): value is PositionStatusKind {
  return typeof value === "string" && (POSITION_STATUSES as readonly string[]).includes(value);
}

/**
 * Does somebody have to act?
 *
 *   none      nothing to do
 *   decision  a choice that is the operator's: release it or leave it
 *   fix       released, yet not in the shop — the release promises
 *             something the shop does not show
 */
export type Attention = "none" | "decision" | "fix";

export type PositionStatus = { kind: PositionStatusKind; attention: Attention };

const ATTENTION: Record<PositionStatusKind, Attention> = {
  offered: "none",
  listed_no_price: "fix",
  listed_hidden: "fix",
  listed_sold_out: "none",
  release_open: "decision",
  unlisted: "none",
  accessory: "none",
  historical: "none",
};

function kindOf(position: InventoryPosition): PositionStatusKind {
  /* 0108 first: an OVP row is history whatever its flags say. */
  if (!isOperativeCondition(position.condition)) return "historical";
  /* ADR-0128: an accessory without a sale release is not shop goods. */
  if (!isShopGoods(position)) return "accessory";

  if (position.isListed) {
    if (isOffered(position)) return "offered";
    /* Why a released position is NOT offered, most actionable first. */
    if (position.effectivePrice === null) return "listed_no_price";
    const figure = position.figure;
    if (figure === null || !figure.isActive || !figure.catalogVisible) return "listed_hidden";
    /* `isOffered` failed with price and visibility in place: nothing free. */
    return "listed_sold_out";
  }

  return position.available > 0 ? "release_open" : "unlisted";
}

/** The status of one position. Pure: same row in, same answer out. */
export function positionStatus(position: InventoryPosition): PositionStatus {
  const kind = kindOf(position);
  return { kind, attention: ATTENTION[kind] };
}

/**
 * The words for a status: a short label for the badge and one sentence that
 * says why — and, where something has to happen, what.
 *
 * For an accessory the sentence is the database's own reason from
 * `admin_shop_listing_audit()` where it gave one, translated through the same
 * table the card has always used — never recomputed here.
 */
export function positionStatusCopy(position: InventoryPosition): { label: string; hint: string } {
  const copy = de.inventory.status;
  const { kind } = positionStatus(position);

  if (kind === "release_open" && position.effectivePrice === null) {
    return { label: copy.release_open.label, hint: copy.releaseOpenNoPrice };
  }
  if (kind === "accessory") {
    const reason = position.saleState?.reason ?? null;
    const translated = reason === null ? null : de.inventory.saleReasons[reason] ?? null;
    return { label: copy.accessory.label, hint: translated ?? copy.accessory.hint };
  }
  return copy[kind];
}
