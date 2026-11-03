/**
 * The columns of an eBay Seller Hub "Orders Report" that the reconciliation
 * reads — and, by omission, every column it never touches.
 *
 * A WHITELIST, NOT A BLACKLIST
 *
 * The report has 80 columns (German export, measured 2026-10). Roughly twenty
 * of them describe the buyer: user name, name, e-mail, note, two addresses,
 * phone, tax id, recipient, tracking number, PayPal transaction. The parser
 * looks up exactly the headers below by NAME and never reads a cell of any
 * other column, so a buyer field cannot reach the model even by accident —
 * and a column eBay adds next year is ignored rather than passed along.
 *
 * Columns are found by their header text, not their position: eBay has
 * reordered report columns before, and a positional reader would silently
 * read the wrong one.
 */

export const EBAY_COLUMNS = {
  recordNo: "Verkaufsprotokollnummer",
  orderRef: "Bestellnummer",
  listingId: "Artikelnummer",
  title: "Angebotstitel",
  quantity: "Anzahl",
  price: "Verkauft für",
  shipping: "Verpackung und Versand",
  total: "Gesamtbetrag",
  soldOn: "Verkauft am",
  paidOn: "Zahlungsdatum",
  shippedOn: "Verschickt am - Datum",
  shippingService: "Versandservice",
  lineRef: "Transaktionsnummer",
  variant: "Variantendetails",
  destinationCountry: "Versand nach - Land",
} as const;

export type EbayColumn = keyof typeof EBAY_COLUMNS;

/** Without these the report cannot be understood at all. */
export const REQUIRED_COLUMNS: readonly EbayColumn[] = [
  "recordNo", "orderRef", "listingId", "title", "quantity", "price", "total", "soldOn",
];

/** The footer line eBay prints under the data: `38;Verkaufsprotokoll(e) heruntergeladen;`. */
export const FOOTER_LABEL = "Verkaufsprotokoll(e) heruntergeladen";

/**
 * Country names as the report prints them, mapped to the ISO code SkyIsles
 * stores (`sales.destination_country_code`). Unknown names stay null.
 */
export const COUNTRY_CODES: Readonly<Record<string, string>> = {
  Germany: "DE", Deutschland: "DE",
  Austria: "AT", "Österreich": "AT",
  Italy: "IT", Italien: "IT",
  Spain: "ES", Spanien: "ES",
  France: "FR", Frankreich: "FR",
  Netherlands: "NL", Niederlande: "NL",
  Belgium: "BE", Belgien: "BE",
  Switzerland: "CH", Schweiz: "CH",
  Luxembourg: "LU", Luxemburg: "LU",
  Poland: "PL", Polen: "PL",
};
