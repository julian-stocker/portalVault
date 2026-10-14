/**
 * The invoice: reading it, and laying it out (ADR-0086).
 *
 * WHAT § 34a UStDV REQUIRES of an invoice for a supply that is steuerfrei
 * under § 19 Abs. 1 UStG, and where each of them is met below:
 *
 *   1. full name and address of BOTH parties        `seller` / `customer`
 *   2. tax number, VAT ID or Kleinunternehmer-ID    `seller.vat_id`
 *   3. the date of issue                            `issued_at`
 *   4. quantity and usual commercial description    `lines`
 *   5. the consideration IN ONE SUM, with a note    `total_amount` + the
 *      that the small-business exemption applies    exemption sentence
 *   6. "Gutschrift" where the recipient invoices    not applicable
 *
 * Note what is NOT required and is provided anyway: a sequential number.
 * § 34a asks for none. One is issued because a document nobody can quote is a
 * document nobody can discuss.
 *
 * NO VAT LINE, EVER. § 19 supplies are steuerfrei. A line reading "USt 0,00 €"
 * would state that the transaction was taxed at zero, which is a different
 * thing and untrue. The figures break down into goods and shipping — which is
 * information, not taxation — and the total is the one sum § 34a asks for.
 */
import { cache } from "react";

import { PdfPage } from "@/lib/legal/invoice-pdf";
import { createClient } from "@/lib/supabase/server";

export type InvoiceLine = {
  sky_id: string;
  name: string;
  condition: string;
  quantity: number;
  unit_price: string;
  line_total: string;
};

export type InvoiceDocument = {
  invoice_number: string;
  issued_at: string;
  order_number: string;
  placed_at: string;
  paid_at: string | null;
  shipping_method: string | null;
  seller: {
    legal_name: string;
    trade_name: string | null;
    street: string;
    postal_code: string;
    city: string;
    country: string;
    email: string;
    vat_id: string | null;
  };
  customer: {
    name: string;
    company: string | null;
    street: string;
    postal_code: string;
    city: string;
    country: string;
    email: string;
  };
  items_subtotal: string;
  shipping_amount: string;
  discount_amount: string;
  total_amount: string;
  currency: string;
  tax_regime: string;
  lines: InvoiceLine[];
};

/**
 * The sentence § 34a UStDV Nr. 5 asks to accompany the sum.
 *
 * Wording follows the current § 19 UStG, under which the supplies are
 * **steuerfrei**. The older "Gemäß § 19 UStG wird keine Umsatzsteuer berechnet"
 * describes the pre-reform rule and is not used.
 */
export const SMALL_BUSINESS_NOTE =
  "Steuerfreie Leistung eines Kleinunternehmers gemäß § 19 UStG. " +
  "Umsatzsteuer wird nicht ausgewiesen.";

/**
 * One invoice, or null.
 *
 * `token` is the capability a guest's browser received when the order was
 * placed (migration 0013). Signed in, it is not needed. Unauthorised and
 * unknown answer identically — the database decides, not this file.
 */
export const fetchInvoice = cache(
  async (orderNumber: string, token: string | null): Promise<InvoiceDocument | null> => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("invoice_document", {
      p_order_number: orderNumber,
      p_token: token,
    });
    if (error || data === null || typeof data !== "object") return null;
    return data as InvoiceDocument;
  },
);

/* ------------------------------------------------------------------ layout */

const EUR = (value: string) => `${Number(value).toFixed(2).replace(".", ",")} EUR`;

/**
 * Draw the invoice.
 *
 * Deliberately plain: a sender block, the parties, a table, a total, and the
 * § 19 sentence. An invoice is read once and filed; it does not need a design.
 */
export function renderInvoicePdf(invoice: InvoiceDocument): Uint8Array {
  const page = new PdfPage();
  const { seller, customer } = invoice;

  // Sender line above the address block, as on a letter.
  page.text(
    `${seller.legal_name} · ${seller.street} · ${seller.postal_code} ${seller.city}`,
    { size: 7.5 },
  );

  page.text(customer.name, { size: 10, dy: 28 });
  if (customer.company) page.text(customer.company, { dy: 13 });
  page.text(customer.street, { dy: 13 });
  page.text(`${customer.postal_code} ${customer.city}`, { dy: 13 });
  page.text(customer.country, { dy: 13 });

  page.text("Rechnung", { size: 17, font: "bold", dy: 46 });

  page.text(`Rechnungsnummer   ${invoice.invoice_number}`, { size: 9.5, dy: 24 });
  page.text(`Rechnungsdatum    ${germanDate(invoice.issued_at)}`, { size: 9.5, dy: 13 });
  page.text(`Bestellnummer     ${invoice.order_number}`, { size: 9.5, dy: 13 });
  page.text(`Bestelldatum      ${germanDate(invoice.placed_at)}`, { size: 9.5, dy: 13 });

  // ---- the table -----------------------------------------------------------
  const qtyRight = page.left + 300;
  const unitRight = page.left + 390;
  const totalRight = page.right;

  page.gap(22);
  page.text("Bezeichnung", { size: 9, font: "bold" });
  page.textRight("Menge", qtyRight, { size: 9, font: "bold" });
  page.textRight("Einzelpreis", unitRight, { size: 9, font: "bold" });
  page.textRight("Betrag", totalRight, { size: 9, font: "bold" });
  page.rule(6);

  for (const line of invoice.lines) {
    /*
     * EINE POSITION IST EIN BLOCK. Die Bezeichnung, die drei Beträge und die
     * SKY-ID darunter gehören zusammen; getrennt stünde auf einer Seite ein
     * Preis ohne Artikel und auf der nächsten eine Nummer ohne alles.
     *
     * 15 + 10 sind genau die beiden `dy` der nächsten vier Zeilen — die
     * Reservierung ist aus demselben Material gerechnet wie das Layout und
     * nicht geschätzt. Passt sie, tut `reserve` nichts.
     */
    page.reserve(15 + 10);
    page.gap(15);
    // § 34a Nr. 4: quantity and the usual commercial description. The SKY-ID
    // is the shop's own reference and rides along on a second, quieter line.
    page.text(truncate(`${line.name} (${conditionLabel(line.condition)})`, 46), { size: 9.5 });
    page.textRight(String(line.quantity), qtyRight, { size: 9.5 });
    page.textRight(EUR(line.unit_price), unitRight, { size: 9.5 });
    page.textRight(EUR(line.line_total), totalRight, { size: 9.5 });
    page.text(line.sky_id, { size: 7.5, dy: 10 });
  }

  /*
   * DIE SUMMENSTAFFEL IST EIN BLOCK. Ein Gesamtbetrag allein am Kopf einer
   * Folgeseite, ohne die Zwischensumme darüber, wäre ein Beleg, den man
   * nachrechnen muss, um ihn zu lesen. 14 + 15 + 14 (+ 14) + 10 + 17 sind
   * die `dy` der Zeilen bis einschliesslich „Gesamtbetrag".
   */
  const hasDiscount = Number(invoice.discount_amount) > 0;
  page.reserve(14 + 15 + 14 + (hasDiscount ? 14 : 0) + 10 + 17);

  page.rule(14);
  page.gap(15);
  page.text("Zwischensumme Ware", { size: 9.5 });
  page.textRight(EUR(invoice.items_subtotal), totalRight, { size: 9.5 });

  page.gap(14);
  page.text(`Versand${invoice.shipping_method ? ` (${invoice.shipping_method})` : ""}`, {
    size: 9.5,
  });
  page.textRight(EUR(invoice.shipping_amount), totalRight, { size: 9.5 });

  if (hasDiscount) {
    page.gap(14);
    page.text("Rabatt", { size: 9.5 });
    page.textRight(`- ${EUR(invoice.discount_amount)}`, totalRight, { size: 9.5 });
  }

  page.rule(10);
  page.gap(17);
  // § 34a Nr. 5: the consideration in one sum.
  page.text("Gesamtbetrag", { size: 11, font: "bold" });
  page.textRight(EUR(invoice.total_amount), totalRight, { size: 11, font: "bold" });

  /*
   * DER § 19-SATZ UND DIE ZAHLUNGSZEILE BLEIBEN BEISAMMEN. § 34a UStDV Nr. 5
   * verlangt den Hinweis bei der Summe; eine Seite dazwischen ist kein
   * Fehler im PDF, aber einer im Beleg.
   */
  const notes = wrap(SMALL_BUSINESS_NOTE, 92);
  page.reserve(26 + 12 * notes.length + 6 + 12);

  page.gap(26);
  for (const sentence of notes) {
    page.text(sentence, { size: 9 });
    page.gap(12);
  }

  page.gap(6);
  page.text("Der Rechnungsbetrag ist bezahlt. Diese Rechnung dient als Beleg.", { size: 9 });

  // ---- footer: who issued it ----------------------------------------------
  /*
   * DER AUSSTELLERFUSS IST EIN BLOCK — und der Grund, warum es diese Technik
   * überhaupt gibt: ab zwölf Positionen stand er bisher unter dem unteren
   * Rand und ab fünfzehn gar nicht mehr auf dem Blatt. 34 + 14 für Abstand
   * und Linie, dann 11 je Folgezeile.
   */
  const footerLines = 1 + (seller.trade_name ? 1 : 0) + 1 + 1 + (seller.vat_id ? 1 : 0);
  page.reserve(34 + 14 + 11 * (footerLines - 1));

  page.gap(34);
  page.rule(0);
  page.gap(14);
  page.text(seller.legal_name, { size: 8.5, font: "bold" });
  if (seller.trade_name) page.text(seller.trade_name, { size: 8.5, dy: 11 });
  page.text(`${seller.street}, ${seller.postal_code} ${seller.city}, ${seller.country}`, {
    size: 8.5,
    dy: 11,
  });
  page.text(seller.email, { size: 8.5, dy: 11 });
  if (seller.vat_id) page.text(`USt-IdNr. ${seller.vat_id}`, { size: 8.5, dy: 11 });

  return page.render(`Rechnung ${invoice.invoice_number}`);
}

function germanDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "–";
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Europe/Berlin",
  }).format(date);
}

function conditionLabel(condition: string): string {
  return condition === "sealed" ? "originalverpackt" : "lose";
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** Naive wrap on spaces. The only long string on the page is one sentence. */
function wrap(text: string, max: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line.length + word.length + 1 > max) {
      out.push(line);
      line = word;
    } else {
      line = line === "" ? word : `${line} ${word}`;
    }
  }
  if (line !== "") out.push(line);
  return out;
}
