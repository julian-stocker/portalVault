/**
 * Sample invoice and mail (ADR-0184, AP6): the real seller, mapped exactly
 * as `issue_invoice()` and the order snapshot map it — and nothing else real.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { NO_SHOP_SETTINGS } from "@/lib/admin/shop-profile-model";
import { renderInvoicePdf } from "@/lib/legal/invoice";
import { buildIdentity } from "./model";
import {
  PREVIEW_CSP, SPECIMEN_INVOICE_NUMBER, SPECIMEN_LABEL, SPECIMEN_ORDER_NUMBER,
  inertMailHtml, specimenInvoice, specimenMailOrder, specimenSeller,
} from "./specimen";

const FULL = buildIdentity({
  ...NO_SHOP_SETTINGS,
  identity: {
    ...NO_SHOP_SETTINGS.identity, displayName: "skyisles.shop", legalName: "Julian Stocker",
    street: "Lechhalde 1 1/2", postalCode: "87629", city: "Füssen", countryCode: "DE", vatId: "DE321022065",
  },
  contacts: { ...NO_SHOP_SETTINGS.contacts, contactEmail: "info@skyisles.de" },
}, null);
const EMPTY = buildIdentity(NO_SHOP_SETTINGS, null);
const NOW = new Date("2026-11-11T10:00:00Z");
const latin1 = (bytes: Uint8Array) => Array.from(bytes, (b) => String.fromCharCode(b)).join("");

describe("the seller block is the real one, mapped like issue_invoice()", () => {
  it("copies today's seller row", () => {
    expect(specimenSeller(FULL)).toEqual({
      legal_name: "Julian Stocker", trade_name: "skyisles.shop", street: "Lechhalde 1 1/2",
      postal_code: "87629", city: "Füssen", country: "Deutschland", email: "info@skyisles.de",
      vat_id: "DE321022065",
    });
  });

  it("uses the same fallbacks as the migration — nothing invented beyond them", () => {
    expect(specimenSeller(EMPTY)).toEqual({
      legal_name: "unbekannt", trade_name: null, street: "unbekannt", postal_code: "unbekannt",
      city: "unbekannt", country: "Deutschland", email: "unbekannt", vat_id: null,
    });
    const sql = readFileSync("supabase/migrations/0047_legal_layer.sql", "utf8");
    for (const clause of [
      "coalesce(v_seller.legal_name, v_snap.seller_legal_name, 'unbekannt')",
      "coalesce(v_seller.display_name, v_snap.seller_name)",
      "coalesce(v_seller.postal_code, v_snap.seller_postal_code, 'unbekannt')",
      "coalesce(v_seller.city, v_snap.seller_city, 'unbekannt')",
      "when 'DE' then 'Deutschland' else coalesce(v_seller.country_code, 'Deutschland') end",
      "coalesce(v_seller.contact_email, v_snap.seller_email, 'unbekannt')",
      "coalesce(v_seller.vat_id, v_snap.seller_vat_id)",
    ]) expect(sql, clause).toContain(clause);
  });

  it("an other country code is shown as stored", () => {
    const at = buildIdentity({ ...NO_SHOP_SETTINGS, identity: { ...NO_SHOP_SETTINGS.identity, countryCode: "AT" } }, null);
    expect(specimenSeller(at).country).toBe("AT");
  });
});

describe("everything else is an obvious example", () => {
  const invoice = specimenInvoice(FULL, NOW);

  it("never looks like a real invoice or order number", () => {
    expect(invoice.invoice_number).toBe(SPECIMEN_INVOICE_NUMBER);
    expect(invoice.invoice_number).not.toMatch(/^SI-R-\d{4}-\d{6}$/);
    expect(invoice.order_number).toBe(SPECIMEN_ORDER_NUMBER);
  });

  it("the customer is fictitious and undeliverable", () => {
    expect(invoice.customer.name).toBe("Beispiel Kundin");
    expect(invoice.customer.city).toBe("Musterstadt");
    expect(invoice.customer.email.endsWith(".invalid")).toBe(true);
  });

  it("adds up the way the invoices table demands", () => {
    const lines = invoice.lines.reduce((sum, l) => sum + Math.round(Number(l.line_total) * 100), 0);
    expect(lines).toBe(Math.round(Number(invoice.items_subtotal) * 100));
    for (const l of invoice.lines) {
      expect(Math.round(Number(l.unit_price) * 100) * l.quantity).toBe(Math.round(Number(l.line_total) * 100));
    }
    expect(Number(invoice.items_subtotal) + Number(invoice.shipping_amount) - Number(invoice.discount_amount))
      .toBeCloseTo(Number(invoice.total_amount), 10);
  });

  it("carries the only tax regime an order can have — no new assumption", () => {
    expect(invoice.tax_regime).toBe("small_business_19");
    const sql = readFileSync("supabase/migrations/0011_checkout_shipping_and_tax.sql", "utf8");
    expect(sql).toContain("check (tax_regime in ('small_business_19'))");
  });

  it("the mail payload names the shop and the same example order", () => {
    const order = specimenMailOrder(FULL, NOW, { agb: "2026-09-17", widerruf: "2026-09-17" });
    expect(order.seller).toMatchObject({ name: "skyisles.shop", legal_name: "Julian Stocker", email: "info@skyisles.de" });
    expect(order.order_number).toBe(SPECIMEN_ORDER_NUMBER);
    expect(order.customer_email).toBe(invoice.customer.email);
    expect(order.lines.map((l) => l.line_total)).toEqual(invoice.lines.map((l) => l.line_total));
  });
});

describe("the PDF", () => {
  const invoice = specimenInvoice(FULL, NOW);

  it("without the option it is byte for byte the real renderer", () => {
    expect(renderInvoicePdf(invoice)).toEqual(renderInvoicePdf(invoice, {}));
    expect(latin1(renderInvoicePdf(invoice))).not.toContain("MUSTER \x96 KEINE");
  });

  it("with it, the label is on top, in every page's footer and in the title", () => {
    const pdf = latin1(renderInvoicePdf(invoice, { specimen: SPECIMEN_LABEL }));
    const label = "MUSTER \x96 KEINE G\xdcLTIGE RECHNUNG"; // WinAnsi: – = 0x96, Ü = 0xDC
    expect(pdf.split(label).length - 1).toBeGreaterThanOrEqual(3);
    expect(pdf).toContain(`/Title (${label} \xb7 Rechnung MUSTER)`);
    expect(pdf).toContain("Seite 1 von 1");
  });

  it("a long sample still stamps every page", () => {
    const many = { ...invoice, lines: Array.from({ length: 40 }, () => ({ ...invoice.lines[0] })) };
    const pdf = latin1(renderInvoicePdf(many, { specimen: SPECIMEN_LABEL }));
    const pages = Number(/\/Count (\d+)/.exec(pdf)![1]);
    expect(pages).toBeGreaterThan(1);
    expect((pdf.match(/MUSTER \x96 KEINE G\xdcLTIGE RECHNUNG · Seite/g) ?? []).length).toBe(pages);
  });
});

describe("inertMailHtml — links in the preview cannot navigate", () => {
  it("removes href, target and ping in every quoting, and keeps the text", () => {
    const html = '<html><head><title>x</title></head><body>'
      + '<a href="https://skyisles.app/widerrufen" style="color:#8a5a12">Widerrufen</a> '
      + "<a target=_top href='/rechnung/SI-1'>Rechnung</a> "
      + '<A HREF=/agb ping="https://x.example/p">AGB</A></body></html>';
    const out = inertMailHtml(html);
    expect(out).not.toMatch(/href|target|ping/i);
    expect(out).toContain('style="color:#8a5a12"');
    for (const word of ["Widerrufen", "Rechnung", "AGB"]) expect(out).toContain(word);
    expect((out.match(/aria-disabled="true"/g) ?? []).length).toBe(3);
  });

  it("puts a policy in front that loads nothing", () => {
    const out = inertMailHtml("<html><head><meta charset=\"utf-8\"></head><body></body></html>");
    expect(out).toContain(`<head><meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`);
    expect(PREVIEW_CSP).toContain("default-src 'none'");
    expect(PREVIEW_CSP).not.toMatch(/script-src|frame-src|form-action \*/);
    expect(inertMailHtml("<p>x</p>").startsWith("<meta http-equiv=\"Content-Security-Policy\"")).toBe(true);
  });

  it("leaves everything that is not a link alone", () => {
    const body = '<table style="width:100%"><tr><td>4,95 €</td></tr></table><p>abc</p>';
    expect(inertMailHtml(body).endsWith(body)).toBe(true);
  });
});
