/**
 * The reconciliation model — what a sales report says, what SkyIsles says, and
 * what comparing the two found.
 *
 * TWO SIDES, ONE VOCABULARY
 *
 *   external   a platform report, parsed. Platform-neutral: an eBay order and
 *              a later Kleinanzeigen sale both become an `ExternalOrder`.
 *   ledger     the SkyIsles sales book (`sales` + `sale_items`), read.
 *
 * NOTHING ABOUT THE BUYER. An eBay report carries names, addresses, phone
 * numbers and tracking numbers. None of it has a field here, so none of it can
 * travel: the parser drops it while reading (`ebay/columns.ts`), and a type
 * without the field is the second lock. The destination country stays — it is
 * what `sales.destination_country_code` already holds.
 *
 * Dates are ISO calendar days (`2026-03-12`), never `Date` objects: a sale day
 * is a day, and a timestamp would invite a time-zone shift at every boundary.
 * Money is a number in euros, rounded to cents at the boundary (`roundMoney`).
 */

/** `YYYY-MM-DD`. */
export type IsoDay = string;

// ---------------------------------------------------------------------------
// The external side
// ---------------------------------------------------------------------------

/** One position of an external order: one listing, one variant, a quantity. */
export type ExternalLine = {
  /** eBay `Transaktionsnummer`. Stable per position; null when the report lacks it. */
  lineRef: string | null;
  /** The listing (`Artikelnummer`). A multi-variation listing sells many figures. */
  listingId: string;
  title: string;
  /** The raw variation text, e.g. `[Charakter:Swarm]`; null when there is none. */
  variant: string | null;
  /** The figure as the platform names it: the variation value, else the title. */
  name: string;
  quantity: number;
  /** Price per piece, after the platform's own volume discount. */
  unitPrice: number;
  /** quantity × unitPrice. */
  value: number;
};

/** One external order, assembled from all its report rows. */
export type ExternalOrder = {
  channel: "ebay";
  /** eBay `Bestellnummer`. The key a SkyIsles sale can store as `external_order_ref`. */
  orderRef: string;
  /** eBay `Verkaufsprotokollnummer`; drives the completeness check. */
  recordNo: number | null;
  soldOn: IsoDay;
  paidOn: IsoDay | null;
  shippedOn: IsoDay | null;
  /** Sum of the line values — computed, not copied from the report's summary row. */
  itemsValue: number;
  shipping: number;
  /** The report's `Gesamtbetrag`. Already reduced by refunds; 0 for a cancelled order. */
  total: number;
  pieces: number;
  /** True when the report wrote a separate summary row (an order of several positions). */
  combined: boolean;
  destinationCountry: string | null;
  shippingService: string | null;
  lines: ExternalLine[];
  /** The file it came from — a file name, never a path. */
  sourceFile: string;
};

/**
 * Something the reader noticed. A code, not a sentence: the German text lives
 * in `de.ts` once there is a screen, and a test can compare a code.
 */
export type ReportIssue = {
  code:
    | "ragged_row"
    | "invalid_date"
    | "invalid_money"
    | "invalid_quantity"
    | "foreign_currency"
    | "line_without_reference"
    | "summary_without_lines"
    | "several_summaries"
    | "several_lines_without_summary"
    | "items_value_mismatch"
    | "quantity_mismatch"
    | "record_number_differs";
  /** 1-based row number in the file, when the issue belongs to one row. */
  row?: number;
  /** A shortened order reference (`…12345`), never a full one. */
  order?: string;
  detail?: string;
};

export type ExternalReport = {
  parser: string;
  parserVersion: number;
  fileName: string;
  orders: ExternalOrder[];
  /** The count the platform printed under the data; null when absent. */
  footerCount: number | null;
  issues: ReportIssue[];
};

export type ParseFailure = {
  code: "not_this_format" | "missing_columns" | "no_header";
  detail?: string;
};

export type ParseResult = { ok: true; report: ExternalReport } | { ok: false; error: ParseFailure };

// ---------------------------------------------------------------------------
// The ledger side
// ---------------------------------------------------------------------------

/** One physical piece of a SkyIsles sale (`sale_items` is one row per piece). */
export type LedgerPiece = {
  itemId: number;
  skyId: string | null;
  /** The catalog name of `skyId`. */
  name: string | null;
  /** What was typed or imported (`sale_items.raw_name`). */
  rawName: string | null;
  /** Catalog series code (`SA`, `G`, `SF`, `T`, `SC`, `I`) when known. */
  seriesCode?: string | null;
  baseSkyId?: string | null;
};

/** One SkyIsles sale. Amounts belong to the SALE, never to a piece. */
export type LedgerSale = {
  saleId: number;
  source: string;
  isTest: boolean;
  soldOn: IsoDay | null;
  /** `sales.items_subtotal` — BEFORE the discount. */
  itemsSubtotal: number;
  /** `sales.discount_amount`. */
  discount: number;
  shipping: number;
  /** Sum of `sale_refunds.amount`. */
  refundsTotal: number;
  cancelledOn: IsoDay | null;
  externalOrderRef: string | null;
  /** `sales.updated_at`, carried so a later decision can detect a stale view. */
  updatedAt?: string | null;
  pieces: LedgerPiece[];
};
