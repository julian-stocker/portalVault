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

/**
 * ONE POSITION, ONE STATUS (0074/0075).
 *
 * Eight states, evaluated in one fixed order so a row can never show two.
 * The order is the physical story read backwards from the last thing that
 * happened to the object: put away, back, on its way back, gone, closed
 * without moving, never sent, sent, not sent yet.
 *
 * A tick belongs to exactly two of them, and each means a real movement
 * exists — `outbooked` a `sale_external`, `restocked` a `return`.
 */
export type SaleItemStatus =
  | "restocked" | "returned" | "return_announced" | "outbooked"
  | "settled" | "not_shipped" | "shipped" | "open";

export type SaleItemFacts = {
  movement_id: number | null;
  returned_at: string | null;
  return_movement_id: number | null;
  settled_at?: string | null;
  not_shipped_at?: string | null;
  return_announced_at?: string | null;
  sky_id: string | null;
  legacy_stock_flag?: string | null;
};

export function saleItemStatus(
  item: SaleItemFacts,
  /** The order went out. A sale-level fact, never a per-item one. */
  shipped: boolean,
): SaleItemStatus {
  if (item.return_movement_id !== null) return "restocked";
  if (item.returned_at !== null) return "returned";
  if ((item.return_announced_at ?? null) !== null) return "return_announced";
  if (item.movement_id !== null) return "outbooked";
  if ((item.settled_at ?? null) !== null) return "settled";
  if ((item.not_shipped_at ?? null) !== null) return "not_shipped";
  return shipped ? "shipped" : "open";
}

/** Is there anything left to do? Mirrors `sale_item_is_closed()` in 0075. */
export function saleItemClosed(item: SaleItemFacts): boolean {
  return item.return_movement_id !== null
    || (item.movement_id !== null
        && (item.return_announced_at ?? null) === null
        && item.returned_at === null)
    || (item.settled_at ?? null) !== null
    || (item.not_shipped_at ?? null) !== null;
}

/**
 * THE FOUR OUTCOMES THE WORKBOOK RECORDS, AND THE TWO IT DOES NOT.
 *
 * Column L is the owner's own record of what became of one copy, and since
 * 2026-09-21 its four letters are binding:
 *
 *   x  shipped and taken off the shelf                     ✓ Verschickt
 *   -  never shipped, never taken off                      ↩ Nicht verschickt
 *   r  shipped, taken off, came back as a return           ⇄ Retoure
 *   l  shipped, taken off, lost in transit                 ⊘ Verloren
 *
 * Column M agrees with L everywhere it matters and is NOT consulted for
 * those four: where the two disagree the owner has said L decides, because M
 * carries old typing mistakes. It is consulted in exactly one place — the
 * combination below that L alone cannot resolve.
 *
 * `-` WITH M = `x` IS TWO DIFFERENT THINGS, AND ONLY ONE IS SAFE TO ASSUME.
 *
 * Fifteen rows carry it, all Battlecast card packs, none with a SKY-ID: sold
 * and shipped, but nothing left the FIGURE inventory because they were never
 * in it. That is a real state and it gets its own answer — shipped, with no
 * claim about stock at all.
 *
 * The same pair on a row that DOES name a figure would mean something else
 * entirely, and nobody has said what. So it is not guessed: it comes back
 * `unresolved` and shows as open. Fail-closed, like every other unknown in
 * this importer. Today no such row exists, and a test keeps it that way.
 *
 * REFUNDS ARE NOT CONSULTED. Money says nothing reliable here: a full refund
 * covers a return, a loss in transit and an order cancelled before dispatch,
 * and those three have opposite stock effects (ADR-0102 addendum).
 */
export type LegacyOutcome =
  | "shipped" | "not_shipped" | "returned" | "lost"
  | "shipped_unreferenced" | "unresolved";

export function legacyOutcome(item: {
  legacy_stock_flag?: string | null;
  legacy_shipped_flag?: string | null;
  sky_id?: string | null;
}): LegacyOutcome | null {
  const stock = (item.legacy_stock_flag ?? "").trim().toLowerCase();
  const shipped = (item.legacy_shipped_flag ?? "").trim().toLowerCase();
  // No marker at all: the workbook recorded nothing, so this says nothing.
  if (stock === "") return null;
  if (stock === "x") return "shipped";
  if (stock === "r") return "returned";
  if (stock === "l") return "lost";
  if (stock === "-") {
    if (shipped === "-") return "not_shipped";
    if (shipped === "x") {
      return (item.sky_id ?? null) === null ? "shipped_unreferenced" : "unresolved";
    }
  }
  return "unresolved";
}

/** Does this outcome mean the piece really went out the door? */
export const legacyWasShipped = (outcome: LegacyOutcome | null): boolean =>
  outcome === "shipped" || outcome === "shipped_unreferenced"
  || outcome === "returned" || outcome === "lost";

/**
 * Did the workbook say this copy never came off the shelf? (0073)
 *
 * Column L of `Order 2026` — `-` on 48 rows, 25 of them shipped. It belongs
 * to the shipment, not to the figure: every figure carrying it has other
 * sales marked `x`. Booking such a line would take a piece off a shelf it
 * never stood on, so the database refuses it and this keeps the button away.
 */
export const notFromStock = (item: { legacy_stock_flag?: string | null }): boolean =>
  (item.legacy_stock_flag ?? null) === "-";

/**
 * The three outcomes column L of `Order 2026` can record, and nothing else.
 *
 *   x  taken from tracked stock
 *   -  shipped, but deliberately never taken from it
 *   r  returned
 *
 * A row carrying one of them is FINISHED HISTORY: the workbook already says
 * what became of that copy, and the reconciled inventory already reflects it.
 * A row carrying none — the marker is NULL — is the opposite: nothing was
 * recorded, so somebody still has to decide.
 */
const LEGACY_OUTCOMES = ["x", "-", "r"] as const;

/**
 * Did the workbook already settle this line?
 *
 * This is the whole distinction the Verkauf screens were missing. 1 061 of
 * Production's 1 253 imported lines carry a marker and are done; the other
 * 192 are the ones 0071 released precisely BECAUSE nothing was recorded for
 * them. Reading "no movement in our ledger" as "still open" called all 1 253
 * open, which is why finished history showed a grey circle.
 *
 * It is derived, not stored: the markers arrived with the import and no RPC
 * writes them.
 */
export const legacyRecorded = (item: { legacy_stock_flag?: string | null }): boolean =>
  (LEGACY_OUTCOMES as readonly string[]).includes(item.legacy_stock_flag ?? "");

/**
 * The indicator, and why it is derived rather than stored.
 *
 * It answers one question at a glance — "is anything still expected of me
 * here?" — and it answers it from the same facts the status text does. There
 * is no new column, no migration and no second truth that could disagree
 * with `sale_item_is_closed()`.
 *
 * Five tones, and the split between two of them is the only thing the status
 * alone cannot say: an OUTBOOKED position is finished if the parcel has gone
 * and still owes a shipment if it has not. That is why `shipped` is a
 * parameter here as it is everywhere else — it is a fact about the sale, not
 * about the line.
 *
 * `grey`   nothing has happened yet: open, or the parcel is out and the
 *          shelf has not been touched.
 * `amber`  the stock left, the parcel has not. Still owed.
 * `green`  done and nothing outstanding — booked and shipped, closed without
 *          a movement, or deliberately never sent.
 * `orange` somebody has to act: a return is on its way or has arrived and is
 *          not back on the shelf.
 * `returned` the return is finished and the piece is back in stock.
 *
 * COLOUR IS NEVER THE ONLY CARRIER. Each tone has its own glyph, and the
 * caller renders the status name as the accessible label — so the column
 * works in greyscale, under forced colours and for a screen reader.
 */
export type SaleItemTone = "grey" | "amber" | "green" | "orange" | "returned";

export type SaleItemIndicator = {
  tone: SaleItemTone;
  glyph: "\u25cb" | "\u2713" | "!" | "\u21c4" | "\u2298" | "\u21a9";
};

export function saleItemIndicator(
  status: SaleItemStatus,
  shipped: boolean,
  /**
   * Imported history, and what the workbook recorded for it.
   *
   * THE WORKBOOK'S OWN OUTCOME OUTRANKS EVERY DERIVED STATE ON AN IMPORTED
   * LINE, `settled_at` included. That timestamp says only "closed here
   * without a movement" — a technical fact about OUR ledger, written in bulk
   * by 0081 — and it must not overwrite what the owner recorded about the
   * physical object. A line the workbook calls lost is lost, whether or not
   * somebody ticked it off on this side.
   *
   * Until 2026-09-21 this parameter was a single boolean, `recorded`, and it
   * gave the same green tick to x, `-` and r. Three different endings, one
   * symbol, and a figure that never shipped looked delivered.
   */
  legacy?: { historical: boolean; outcome: LegacyOutcome | null },
): SaleItemIndicator {
  /*
   * WHICH STATES THE WORKBOOK OUTRANKS, AND WHICH IT DOES NOT.
   *
   * It outranks the four that are derived from an ABSENCE — `open` and
   * `shipped` (no movement here), `settled` and `not_shipped` (a timestamp
   * we wrote). None of those says anything about the physical object, and
   * `settled_at` in particular was written in bulk by 0081.
   *
   * It does NOT outrank a real movement or a return in flight. Those are
   * present-tense work on this side and they are newer than any import. No
   * imported line carries one today; the rule exists so that the day one
   * does, today wins over 2026's spreadsheet.
   */
  const derivedFromAbsence = status === "open" || status === "shipped"
    || status === "settled" || status === "not_shipped";
  if (legacy?.historical && derivedFromAbsence
      && legacy.outcome !== null && legacy.outcome !== undefined) {
    switch (legacy.outcome) {
      case "shipped":
      case "shipped_unreferenced":
        return { tone: "green", glyph: "\u2713" };
      case "returned":
        return { tone: "returned", glyph: "\u21c4" };
      case "lost":
        return { tone: "amber", glyph: "\u2298" };
      case "not_shipped":
        return { tone: "grey", glyph: "\u21a9" };
      case "unresolved":
        return { tone: "grey", glyph: "\u25cb" };
    }
  }
  switch (status) {
    case "restocked":
      return { tone: "returned", glyph: "\u2713" };
    case "returned":
    case "return_announced":
      return { tone: "orange", glyph: "!" };
    case "outbooked":
      /* The one split the status cannot make on its own. */
      return shipped ? { tone: "green", glyph: "\u2713" } : { tone: "amber", glyph: "\u2713" };
    case "settled":
    case "not_shipped":
      /*
       * Both are deliberate endings with nothing outstanding, so both are
       * green — and both keep their own label, because "closed without a
       * movement" and "never sent" are not the same thing to a reader.
       */
      return { tone: "green", glyph: "\u2713" };
    default:
      return { tone: "grey", glyph: "\u25cb" };
  }
}

/** What the one action button on a position should do. */
export type SaleItemAction =
  | "book" | "announce_return" | "mark_returned" | "restock"
  | "settle" | "unsettle" | "unmark_not_shipped" | null;

/**
 * Which buttons a sold object may show.
 *
 * Only actions the server would actually accept. An impossible button is
 * worse than a missing one: it invites a click that ends in an error
 * message explaining a rule the screen already knew.
 *
 * `primary` follows the status one-for-one, so a row shows one state and
 * the one thing to do about it. `canNotShip` is the single secondary: a
 * parcel can go out without a piece in it, and that decision is open while
 * the position is still unsent or sent.
 */
export function saleItemActions(
  item: SaleItemFacts,
  context: {
    /** A workbook sale nobody released (0071). */
    frozen: boolean;
    /** The order was called off. */
    cancelled: boolean;
    /** The order went out. */
    shipped: boolean;
    /**
     * An imported sale, released or not.
     *
     * HISTORY IS NOT BOOKED OUT FROM HERE, and that is a deliberate hold
     * rather than a rule of the database. The reconciled stock in the new
     * workbook ALREADY contains the effect of these sales, so writing a
     * `sale_external` movement for one now would take the same piece off the
     * shelf twice. `seller_book_sale_item` would happily accept it for the
     * 192 released lines — which is exactly why the refusal has to be here,
     * until the Excel-against-Production reconciliation says otherwise.
     *
     * Nothing else is withheld: `settle` and `not shipped` write a timestamp
     * and never a movement, so they stay available.
     */
    historical?: boolean;
  },
): {
  status: SaleItemStatus; primary: SaleItemAction; canNotShip: boolean;
  heldForReconciliation: boolean;
} {
  const status = saleItemStatus(item, context.shipped);
  if (context.frozen || context.cancelled) {
    return { status, primary: null, canNotShip: false, heldForReconciliation: false };
  }
  /*
   * TWO ENDINGS FOR A POSITION THAT NEVER LEAVES THE SHELF, AND THEY ARE
   * NOT THE SAME THING.
   *
   *   settle       there is no figure inventory to move, or the workbook
   *                says this copy never stood in it. Locked hard in 0073.
   *   not shipped  there IS a shelf and the piece is still on it, because
   *                the parcel went out without it. Safe by construction:
   *                nothing left, so nothing has to be recorded as leaving.
   */
  const shelfBound = item.sky_id !== null && !notFromStock(item);
  /* See `historical` above: no imported line moves stock from this screen. */
  const mayBook = shelfBound && !context.historical;
  const primary: SaleItemAction =
    status === "shipped" ? (mayBook ? "book" : shelfBound ? null : "settle")
    : status === "outbooked" ? "announce_return"
    : status === "return_announced" ? "mark_returned"
    : status === "returned" ? "restock"
    : status === "settled" ? "unsettle"
    : status === "not_shipped" ? "unmark_not_shipped"
    : status === "open" && !shelfBound ? "settle"
    : null;
  return {
    status,
    primary,
    canNotShip: (status === "open" || status === "shipped") && shelfBound,
    /** True where a booking is only being held back, not refused outright. */
    heldForReconciliation: Boolean(context.historical) && shelfBound
      && (status === "open" || status === "shipped"),
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

/** What the Verkauf ledger's stock column says about a whole sale (0072/0075). */
export type SaleStockStatus =
  | "cancelled" | "frozen" | "outbooked" | "returned" | "closed" | "partial" | "open";

/**
 * AUSGEBUCHT MEANS STOCK IS GONE, AND A RETURN TAKES THAT BACK.
 *
 * 0072 asked only whether a movement existed. Sale 15 on Staging is the
 * case that shows why that is not enough: its one position was booked out
 * and restocked three seconds later, and the ledger called the whole sale
 * `Ausgebucht ✓` while the figure stood on the shelf.
 *
 * So a sale is `Ausgebucht` only when every position left AND stayed gone,
 * `Retour` when every one came back and was put away, and `Abgeschlossen`
 * — no tick — when the endings are mixed. A tick still means a real
 * movement; there are simply two kinds, and they say opposite things about
 * the shelf.
 *
 * THE ORDER AND ITS POSITIONS STAY APART. `cancelled_at`, `shipped_at` and
 * the release belong to the sale; every ending belongs to a position. This
 * reads the four counts the database derived and adds nothing of its own —
 * `closedCount` is its answer, and the fallback sum exists only for a
 * caller that predates 0075.
 */
export function saleStockStatus(sale: {
  source: string; cancelledAt: string | null; stockReleasedAt: string | null;
  orderId: number | null; itemCount: number;
  outbookedCount: number; restockedCount?: number;
  settledCount: number; notShippedCount?: number; closedCount?: number;
}): SaleStockStatus {
  if (sale.cancelledAt !== null) return "cancelled";
  // A workbook sale nobody released, and an order, are both untouchable.
  if (sale.orderId !== null
      || (sale.source === "excel_order_2026" && sale.stockReleasedAt === null)) return "frozen";
  if (sale.itemCount === 0) return "open";

  const restocked = sale.restockedCount ?? 0;
  const closed = sale.closedCount
    ?? sale.outbookedCount + restocked + sale.settledCount + (sale.notShippedCount ?? 0);
  if (closed < sale.itemCount) return closed > 0 ? "partial" : "open";

  if (sale.outbookedCount === sale.itemCount) return "outbooked";
  if (restocked === sale.itemCount) return "returned";
  return "closed";
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
