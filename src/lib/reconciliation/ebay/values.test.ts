import { describe, expect, it } from "vitest";
import { parseEbayDate, parseEbayMoney, parseQuantity } from "./values";

describe("parseEbayMoney", () => {
  it.each([
    ["0,95 €", 0.95],
    ["1,30 €", 1.3],
    ["120,56 €", 120.56],
    ["1.234,56 €", 1234.56],
    ["12.345.678,00 €", 12345678],
    ["0,00 €", 0],
    ["-6,99 €", -6.99],
    ["5,49", 5.49],
    ["5,49 EUR", 5.49],
  ])("reads %s", (raw, value) => {
    expect(parseEbayMoney(raw)).toEqual({ ok: true, value });
  });

  it("reads an empty cell as null, not zero", () => {
    expect(parseEbayMoney("")).toEqual({ ok: true, value: null });
    expect(parseEbayMoney("  ")).toEqual({ ok: true, value: null });
  });

  it.each(["1.30 €", "1,3 €", "abc", "1,234.56 €", "€ 1,30", "1.23,45 €"])("refuses %s", (raw) => {
    expect(parseEbayMoney(raw).ok).toBe(false);
  });

  it("names a foreign currency as such", () => {
    expect(parseEbayMoney("5,49 USD")).toEqual({ ok: false, reason: "foreign_currency" });
    expect(parseEbayMoney("5,49 £")).toEqual({ ok: false, reason: "foreign_currency" });
  });
});

describe("parseEbayDate", () => {
  it.each([
    ["01-Jan-26", "2026-01-01"], ["28-Feb-26", "2026-02-28"], ["31-Mar-26", "2026-03-31"],
    ["30-Apr-26", "2026-04-30"], ["15-May-26", "2026-05-15"], ["01-Jun-26", "2026-06-01"],
    ["31-Jul-26", "2026-07-31"], ["31-Aug-26", "2026-08-31"], ["29-Sep-26", "2026-09-29"],
    ["15-Oct-26", "2026-10-15"], ["30-Nov-26", "2026-11-30"], ["31-Dec-25", "2025-12-31"],
  ])("reads %s as %s", (raw, iso) => {
    expect(parseEbayDate(raw)).toEqual({ ok: true, value: iso });
  });

  it("reads an empty cell as null", () => {
    expect(parseEbayDate("")).toEqual({ ok: true, value: null });
  });

  it.each(["31-Feb-26", "00-Jan-26", "1-Jan-26", "01-jan-26", "01-Mai-26", "2026-01-01", "01.01.2026"])("refuses %s", (raw) => {
    expect(parseEbayDate(raw).ok).toBe(false);
  });
});

describe("parseQuantity", () => {
  it("accepts positive whole numbers only", () => {
    expect(parseQuantity("1")).toBe(1);
    expect(parseQuantity(" 16 ")).toBe(16);
    expect(parseQuantity("0")).toBeNull();
    expect(parseQuantity("-1")).toBeNull();
    expect(parseQuantity("1,5")).toBeNull();
    expect(parseQuantity("")).toBeNull();
  });
});
