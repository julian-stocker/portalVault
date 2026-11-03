import { describe, expect, it } from "vitest";
import { parseSalesReport } from "../registry";
import { ebayReport, FAKE_BUYER, type FixtureOrder } from "../testing/ebay-fixture";
import type { ExternalReport } from "../types";
import { parseEbayOrdersReport, variantName } from "./parse";

const single: FixtureOrder = {
  ref: "00-00000-00001", record: 1001, sold: "2026-03-12", shipping: 5.49,
  lines: [{ character: "Swarm", unit: 8.99, tx: "9000001" }],
};
const combined: FixtureOrder = {
  ref: "00-00000-00002", record: 1004, sold: "2026-03-13", paid: "2026-03-13", shipping: 5.99,
  lines: [
    { character: "Water Armor", unit: 5.41, title: "Skylanders Imaginators Kristalle - Große Auswahl" },
    { character: "Fire Reactor", unit: 1.8, qty: 3, title: "Skylanders Imaginators Kristalle - Große Auswahl" },
  ],
};

function read(text: string, fileName = "test.csv"): ExternalReport {
  const result = parseEbayOrdersReport(text, fileName);
  if (!result.ok) throw new Error(`parse failed: ${result.error.code}`);
  return result.report;
}

/** Every string anywhere inside a value. */
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => [k, ...strings(v)]);
  return [];
}

describe("parseEbayOrdersReport", () => {
  it("reads a one-position order from its single row", () => {
    const [order] = read(ebayReport([single])).orders;
    expect(order).toMatchObject({
      channel: "ebay", orderRef: "00-00000-00001", recordNo: 1001, soldOn: "2026-03-12", paidOn: "2026-03-12",
      itemsValue: 8.99, shipping: 5.49, total: 14.48, pieces: 1, combined: false, destinationCountry: "DE",
    });
    expect(order.lines).toEqual([{
      lineRef: "9000001", listingId: "100000000001", title: "Skylanders Spyros Adventure Figuren - Große Auswahl",
      variant: "[Charakter:Swarm]", name: "Swarm", quantity: 1, unitPrice: 8.99, value: 8.99,
    }]);
  });

  it("assembles an order of several positions from its summary and position rows", () => {
    const [order] = read(ebayReport([combined])).orders;
    expect(order.combined).toBe(true);
    expect(order.lines.map((l) => [l.name, l.quantity, l.unitPrice, l.value])).toEqual([
      ["Water Armor", 1, 5.41, 5.41], ["Fire Reactor", 3, 1.8, 5.4],
    ]);
    expect(order.itemsValue).toBe(10.81);
    expect(order.pieces).toBe(4);
    expect(order.shipping).toBe(5.99);
  });

  it("treats `Verkauft für` on a one-position order as the unit price", () => {
    const [order] = read(ebayReport([{ ...single, lines: [{ character: "Eruptor", unit: 12.09, qty: 7 }] }])).orders;
    expect(order.lines[0].unitPrice).toBe(12.09);
    expect(order.itemsValue).toBe(84.63);
    expect(order.total).toBe(90.12);
  });

  it("reads a report total of 0,00 € as it stands", () => {
    const [order] = read(ebayReport([{ ...single, total: 0, shipped: null }])).orders;
    expect(order.total).toBe(0);
    expect(order.shippedOn).toBeNull();
  });

  it("reads the footer count", () => {
    expect(read(ebayReport([single, combined])).footerCount).toBe(2);
    expect(read(ebayReport([single], { footer: null })).footerCount).toBeNull();
    expect(read(ebayReport([single], { footer: 7 })).footerCount).toBe(7);
  });

  it("finds columns by name, not by position", () => {
    const normal = read(ebayReport([single, combined])).orders;
    const reversed = read(ebayReport([single, combined], { reversed: true })).orders;
    expect(reversed).toEqual(normal);
  });

  it("refuses a report without a required column, naming it", () => {
    const result = parseEbayOrdersReport(ebayReport([single], { omit: ["Gesamtbetrag"] }), "x.csv");
    expect(result).toEqual({ ok: false, error: { code: "missing_columns", detail: "Gesamtbetrag" } });
  });

  it("refuses a file that is not an Orders Report", () => {
    expect(parseEbayOrdersReport("a;b;c\n1;2;3\n", "x.csv")).toEqual({ ok: false, error: { code: "not_this_format" } });
    expect(parseSalesReport("a;b;c\n1;2;3\n", "x.csv").ok).toBe(false);
  });

  it("warns about a position without a transaction number, and keeps the order", () => {
    const report = read(ebayReport([{ ...single, lines: [{ character: "Swarm", unit: 8.99, tx: null }] }]));
    expect(report.orders[0].lines[0].lineRef).toBeNull();
    expect(report.issues.map((i) => i.code)).toEqual(["line_without_reference"]);
  });

  it("reports an issue with a SHORTENED order reference only", () => {
    const report = read(ebayReport([{ ...single, lines: [{ character: "Swarm", unit: 8.99, tx: null }] }]));
    expect(report.issues[0].order).toBe("…00001");
  });

  it("drops every buyer field while reading", () => {
    const report = read(ebayReport([single, combined]));
    const everything = strings(report);
    for (const fake of Object.values(FAKE_BUYER)) {
      expect(everything.some((s) => s.includes(fake))).toBe(false);
    }
  });

  it("is found by the registry", () => {
    const result = parseSalesReport(ebayReport([single]), "x.csv");
    expect(result.ok && result.report.parser).toBe("ebay-orders-report-de");
  });
});

describe("variantName", () => {
  it("takes the first variation value", () => {
    expect(variantName("[Charakter:Swarm]")).toBe("Swarm");
    expect(variantName("[Charakter: Stealth Elf (Legendary) ][Zustand:gut]")).toBe("Stealth Elf (Legendary)");
    expect(variantName("")).toBeNull();
    expect(variantName("[Charakter:]")).toBeNull();
  });
});
