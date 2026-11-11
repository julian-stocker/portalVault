/**
 * Sample documents for "Identität & Dokumente" (ADR-0184, AP6).
 *
 * THE SELLER IS REAL, EVERYTHING ELSE IS AN EXAMPLE. The seller block is built
 * from the current seller row exactly the way `issue_invoice()` (`0047`) and
 * the order snapshot copy it, so the preview shows what the NEXT real invoice
 * and mail would carry. Customer, order, lines and amounts are fixed examples,
 * marked as such in every field a reader sees first:
 *
 *   invoice number   "MUSTER" — never the `SI-R-…` shape, so it cannot be
 *                    mistaken for one and no number of the sequence is used
 *   order number     "MUSTER-0001"
 *   customer         "Beispiel Kundin", an address in "Musterstadt" and an
 *                    e-mail under `.invalid`, the reserved never-delivered TLD
 *
 * PURE: nothing is read, written, numbered or sent here.
 *
 * NO TAX ASSUMPTION. `tax_regime` is `small_business_19` because that is the
 * only value `orders.tax_regime` accepts (`0011`) — the one every real order
 * carries — not a statement about the operator's status.
 */
import type { InvoiceDocument } from "@/lib/legal/invoice";
import type { Identity } from "@/lib/identity/model";
import type { MailOrder } from "../../../supabase/functions/send-order-mail/templates.ts";

export const SPECIMEN_LABEL = "MUSTER – KEINE GÜLTIGE RECHNUNG";
export const SPECIMEN_MAIL_LABEL = "MUSTER – BEISPIELDATEN, NICHT VERSENDET";

export const SPECIMEN_INVOICE_NUMBER = "MUSTER";
export const SPECIMEN_ORDER_NUMBER = "MUSTER-0001";

/** The example customer: obviously fictitious, and undeliverable by design. */
export const SPECIMEN_CUSTOMER = {
  firstName: "Beispiel",
  lastName: "Kundin",
  street: "Musterstraße",
  houseNumber: "1",
  postalCode: "12345",
  city: "Musterstadt",
  countryCode: "DE",
  email: "kundin@beispiel.invalid",
} as const;

const LINES = [
  { sky_id: "MUSTER-A", name: "Beispielartikel A", condition: "loose", quantity: 1, unit_price: "12.90", line_total: "12.90" },
  { sky_id: "MUSTER-B", name: "Beispielartikel B", condition: "loose", quantity: 2, unit_price: "4.50", line_total: "9.00" },
] as const;
const ITEMS = "21.90";
const SHIPPING = "4.95";
const TOTAL = "26.85";
const SHIPPING_METHOD = "Beispielversand";

/** `issue_invoice()`'s seller mapping (`0047:559–568`), field for field. */
export function specimenSeller(identity: Identity): InvoiceDocument["seller"] {
  const { shop, legal } = identity;
  return {
    legal_name: legal.legalName ?? "unbekannt",
    trade_name: shop.displayName,
    street: legal.street ?? "unbekannt",
    postal_code: legal.postalCode ?? "unbekannt",
    city: legal.city ?? "unbekannt",
    country: (legal.countryCode ?? "DE") === "DE" ? "Deutschland" : (legal.countryCode ?? "Deutschland"),
    email: shop.contactEmail ?? "unbekannt",
    vat_id: legal.vatId,
  };
}

/** A sample invoice with today's seller, issued "now". */
export function specimenInvoice(identity: Identity, now: Date): InvoiceDocument {
  const at = now.toISOString();
  const c = SPECIMEN_CUSTOMER;
  return {
    invoice_number: SPECIMEN_INVOICE_NUMBER,
    issued_at: at,
    order_number: SPECIMEN_ORDER_NUMBER,
    placed_at: at,
    paid_at: at,
    shipping_method: SHIPPING_METHOD,
    seller: specimenSeller(identity),
    customer: {
      name: `${c.firstName} ${c.lastName}`,
      company: null,
      street: `${c.street} ${c.houseNumber}`,
      postal_code: c.postalCode,
      city: c.city,
      country: "Deutschland",
      email: c.email,
    },
    items_subtotal: ITEMS,
    shipping_amount: SHIPPING,
    discount_amount: "0.00",
    total_amount: TOTAL,
    currency: "EUR",
    tax_regime: "small_business_19",
    lines: LINES.map((line) => ({ ...line })),
  };
}

/**
 * A sample of `order_mail_payload()` for the same order, with the seller as
 * the order snapshot would freeze it at checkout (`0047:160`: display_name,
 * legal_name, street, postal_code, city, contact_email, vat_id) and the
 * current legal text versions.
 */
export function specimenMailOrder(
  identity: Identity,
  now: Date,
  legal: { agb: string; widerruf: string },
): MailOrder {
  const c = SPECIMEN_CUSTOMER;
  return {
    order_number: SPECIMEN_ORDER_NUMBER,
    placed_at: now.toISOString(),
    customer_email: c.email,
    currency: "EUR",
    items_subtotal: ITEMS,
    shipping_amount: SHIPPING,
    discount_amount: "0.00",
    total_amount: TOTAL,
    shipping_method: SHIPPING_METHOD,
    tracking_number: null,
    shipped_at: null,
    payment_status: "paid",
    needs_resolution: false,
    seller: {
      name: identity.shop.displayName,
      legal_name: identity.legal.legalName,
      street: identity.legal.street,
      postal_code: identity.legal.postalCode,
      city: identity.legal.city,
      email: identity.shop.contactEmail,
      vat_id: identity.legal.vatId,
    },
    legal: { agb_version: legal.agb, widerruf_version: legal.widerruf },
    invoice_number: SPECIMEN_INVOICE_NUMBER,
    refunded_total: null,
    address: {
      first_name: c.firstName,
      last_name: c.lastName,
      company: null,
      street: c.street,
      house_number: c.houseNumber,
      address_line_2: null,
      postal_code: c.postalCode,
      city: c.city,
      country_code: c.countryCode,
    },
    lines: LINES.map(({ condition, name, quantity, unit_price, line_total }) =>
      ({ condition, name, quantity, unit_price, line_total })),
  };
}

/**
 * The mail HTML made inert for the preview (AP6).
 *
 * `sandbox=""` already stops scripts, forms, pop-ups and navigation of the
 * page around the frame — but a plain link may still navigate THE FRAME
 * ITSELF, which would load a real page of this site (Widerruf, Rechnung …)
 * inside the preview. So the preview, and only the preview, removes every
 * `href` and `target` from the anchors (the text stays, styled as before), and
 * puts a Content-Security-Policy in front that lets the document load nothing
 * but its own inline styles. The template's output for a real mail is not
 * touched: this runs on a copy, after `render()`.
 */
export const PREVIEW_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:";

export function inertMailHtml(html: string): string {
  const withoutLinks = html.replace(/<a\b[^>]*>/gi, (tag) =>
    tag
      .replace(/\s(?:href|target|ping)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      .replace(/^<a\b/i, '<a aria-disabled="true" title="In der Vorschau deaktiviert"'));
  const meta = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`;
  return /<head>/i.test(withoutLinks)
    ? withoutLinks.replace(/<head>/i, `<head>${meta}`)
    : `${meta}${withoutLinks}`;
}
