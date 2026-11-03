import { describe, expect, it } from "vitest";
import { parseEbayOrdersReport } from "../ebay/parse";
import { ebayReport, FAKE_BUYER, type FixtureOrder } from "../testing/ebay-fixture";
import { ledgerSale } from "../testing/ledger-fixture";
import { runReconciliation } from "../testing/run";
import type { ExternalReport } from "../types";
import { aliasIndex, ledgerSales, PayloadError, sessionPayload, validateUpload } from "./payload";

const FP = "a".repeat(64);
const order: FixtureOrder = { ref: "01-00000-00001", record: 10, sold: "2026-03-12", lines: [{ character: "Swarm", unit: 8.99 }] };

function report(): ExternalReport {
  const r = parseEbayOrdersReport(ebayReport([order]), "march.csv");
  if (!r.ok) throw new Error(r.error.code);
  return r.report;
}

const upload = () => ({ channel: "ebay", files: [{ fingerprint: FP, report: report() }] });
const fail = (input: unknown) => expect(() => validateUpload(input)).toThrow(PayloadError);

describe("validateUpload — the browser's upload in exactly the model's shape", () => {
  it("accepts a parsed report", () => {
    expect(validateUpload(upload()).files[0].report.orders).toHaveLength(1);
  });

  it("refuses an unknown field at every level — no buyer field gets through", () => {
    const at = [
      (u: ReturnType<typeof upload>) => Object.assign(u, { buyer: "x" }),
      (u: ReturnType<typeof upload>) => Object.assign(u.files[0], { path: "/Users/x" }),
      (u: ReturnType<typeof upload>) => Object.assign(u.files[0].report, { seller: "x" }),
      (u: ReturnType<typeof upload>) => Object.assign(u.files[0].report.orders[0], { buyerName: FAKE_BUYER["Name des Empfängers"] }),
      (u: ReturnType<typeof upload>) => Object.assign(u.files[0].report.orders[0].lines[0], { buyerPhone: "+49 000" }),
    ];
    for (const patch of at) {
      const u = upload();
      patch(u);
      fail(u);
    }
  });

  it("refuses what is not in the model's shape", () => {
    const u1 = upload(); u1.files[0].fingerprint = "not-a-hash"; fail(u1);
    const u2 = upload(); u2.files[0].report.fileName = "Downloads/march.csv"; fail(u2);
    const u3 = upload(); (u3.files[0].report.orders[0] as { soldOn: string }).soldOn = "12.03.2026"; fail(u3);
    const u4 = upload(); (u4.files[0].report.orders[0] as { itemsValue: unknown }).itemsValue = "8,99"; fail(u4);
    fail({ channel: "kleinanzeigen", files: [] });
    fail({ channel: "ebay", files: [] });
  });

  it("refuses contact data in free text, but not a portal's model number", () => {
    const mail = upload(); mail.files[0].report.orders[0].lines[0].title = "Swarm — Fragen an kaeuferin@example.invalid"; fail(mail);
    const phone = upload(); mail.files[0].report.orders[0].lines[0].title = "x";
    phone.files[0].report.orders[0].lines[0].variant = "[Charakter:Swarm] Tel +49 151 0000000"; fail(phone);
    const model = upload(); model.files[0].report.orders[0].lines[0].name = "Portal 84148790 (Wireless)";
    expect(validateUpload(model).files).toHaveLength(1);
  });

  it("names the problem without echoing a value", () => {
    const u = upload();
    Object.assign(u.files[0].report.orders[0], { buyerName: "Testa Käuferin" });
    expect(() => validateUpload(u)).toThrow(/unknown field\(s\) buyerName/);
    expect(() => validateUpload(u)).not.toThrow(/Testa/);
  });
});

describe("sessionPayload — listed fields only", () => {
  const sale = { ...ledgerSale({ id: 7, sold: "2026-03-11", net: 8.99, pieces: ["Swarm"] }), updatedAt: "2026-11-03T10:00:00+00:00" };
  const run = runReconciliation([{ name: "march.csv", text: ebayReport([order]), fingerprint: FP }], [sale]);
  const payload = sessionPayload({
    parser: "ebay-orders-report-de", parserVersion: 1,
    files: [{ fingerprint: FP, report: run.reports[0] }],
    orders: run.reports[0].orders, coverage: run.coverage, rows: run.rows, summary: run.summary,
  });

  it("carries exactly the keys the database accepts", () => {
    expect(Object.keys(payload).sort()).toEqual(["channel", "coverage", "files", "matches", "orders", "parser", "parserVersion", "summary"]);
    expect(Object.keys(payload.orders[0]).sort()).toEqual(["combined", "destinationCountry", "itemsValue", "lines", "orderRef",
      "paidOn", "pieces", "recordNo", "shippedOn", "shipping", "shippingService", "soldOn", "sourceFile", "total"]);
    expect(Object.keys(payload.orders[0].lines[0]).sort()).toEqual(["lineRef", "listingId", "name", "quantity", "title", "unitPrice", "value", "variant"]);
    expect(Object.keys(payload.matches[0]).sort()).toEqual(["category", "certainty", "competitors", "dateDelta", "findings", "orderRef", "reason", "saleId", "saleUpdatedAt", "score"]);
  });

  it("maps a finding to key, field, kind, values, delta and causes — not its decisions", () => {
    const f = payload.matches[0].findings.find((x) => x.field === "sold_on");
    expect(f).toEqual({ key: "sold_on", field: "sold_on", kind: "deviation", ledger: "2026-03-11", external: "2026-03-12", delta: -1, causes: [] });
  });

  it("carries no buyer value anywhere", () => {
    const text = JSON.stringify(payload);
    for (const fake of Object.values(FAKE_BUYER)) expect(text).not.toContain(fake);
  });

  it("refuses to build a match without the sale's updated_at snapshot", () => {
    const noSnapshot = runReconciliation([{ name: "march.csv", text: ebayReport([order]) }], [ledgerSale({ id: 7, sold: "2026-03-12", net: 8.99, pieces: ["Swarm"] })]);
    expect(() => sessionPayload({
      parser: "p", parserVersion: 1, files: [], orders: [], coverage: noSnapshot.coverage, rows: noSnapshot.rows, summary: noSnapshot.summary,
    })).toThrow(PayloadError);
  });
});

describe("reading the database's answers", () => {
  it("turns candidates into the matcher's model, numerics given as strings included", () => {
    expect(ledgerSales([{
      saleId: 3, source: "manual", isTest: false, soldOn: "2026-03-12", itemsSubtotal: "10.00", discount: "1.01",
      shipping: "5.49", refundsTotal: "0", cancelledOn: null, externalOrderRef: null, updatedAt: "t",
      pieces: [{ itemId: 9, skyId: "SKY-1", name: "Swarm", rawName: null, seriesCode: "SA", baseSkyId: null }],
    }])).toEqual([{
      saleId: 3, source: "manual", isTest: false, soldOn: "2026-03-12", itemsSubtotal: 10, discount: 1.01, shipping: 5.49,
      refundsTotal: 0, cancelledOn: null, externalOrderRef: null, updatedAt: "t",
      pieces: [{ itemId: 9, skyId: "SKY-1", name: "Swarm", rawName: null, seriesCode: "SA", baseSkyId: null }],
    }]);
    expect(ledgerSales(null)).toEqual([]);
  });

  it("turns the alias answer into an index and ignores what is not a name", () => {
    expect([...aliasIndex({ "SKY-0580": ["Ice Crave", "Empire of Ice", 3] })]).toEqual([["SKY-0580", ["Ice Crave", "Empire of Ice"]]]);
    expect(aliasIndex(null).size).toBe(0);
  });
});
