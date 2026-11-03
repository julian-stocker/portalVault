import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fileFingerprint, mergeReports } from "./dedupe";
import { parseEbayOrdersReport } from "./ebay/parse";
import { ebayReport, type FixtureOrder } from "./testing/ebay-fixture";
import type { ExternalReport } from "./types";

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const order = (ref: string, record: number, unit = 3): FixtureOrder =>
  ({ ref, record, sold: "2026-06-01", lines: [{ character: "Zap", unit, tx: `tx-${ref}` }] });

function report(text: string, fileName: string): ExternalReport {
  const result = parseEbayOrdersReport(text, fileName);
  if (!result.ok) throw new Error(result.error.code);
  return result.report;
}

describe("fileFingerprint", () => {
  it("ignores the byte order mark and the line-ending style", async () => {
    const text = ebayReport([order("00-0-1", 1)]);
    const crlf = text.replace(/\n/g, "\r\n").replace(/^﻿/, "");
    expect(await fileFingerprint(text, sha256)).toBe(await fileFingerprint(crlf, sha256));
  });

  it("accepts an asynchronous hash, as the browser's crypto.subtle is", async () => {
    const text = ebayReport([order("00-0-1", 1)]);
    expect(await fileFingerprint(text, async (t) => sha256(t))).toBe(await fileFingerprint(text, sha256));
  });
});

describe("mergeReports", () => {
  it("reads the same file only once", async () => {
    const text = ebayReport([order("00-0-1", 1)]);
    const fp = await fileFingerprint(text, sha256);
    const merged = mergeReports([
      { report: report(text, "first.csv"), fingerprint: fp },
      { report: report(text, "copy.csv"), fingerprint: fp },
    ]);
    expect(merged.orders).toHaveLength(1);
    expect(merged.duplicateFiles).toEqual([{ fileName: "copy.csv", sameAs: "first.csv" }]);
  });

  it("keeps an order found identically in two files once, and says so", () => {
    const a = report(ebayReport([order("00-0-1", 1), order("00-0-2", 2)]), "a.csv");
    const b = report(ebayReport([order("00-0-2", 2), order("00-0-3", 3)]), "b.csv");
    const merged = mergeReports([{ report: a, fingerprint: "a" }, { report: b, fingerprint: "b" }]);
    expect(merged.orders.map((o) => o.orderRef).sort()).toEqual(["00-0-1", "00-0-2", "00-0-3"]);
    expect(merged.repeatedOrders).toEqual([{ orderRef: "00-0-2", files: ["a.csv", "b.csv"] }]);
    expect(merged.conflicts).toEqual([]);
  });

  it("leaves a conflicting order out and names the fields that differ", () => {
    const a = report(ebayReport([order("00-0-1", 1, 3)]), "a.csv");
    const b = report(ebayReport([order("00-0-1", 1, 4)]), "b.csv");
    const merged = mergeReports([{ report: a, fingerprint: "a" }, { report: b, fingerprint: "b" }]);
    expect(merged.orders).toEqual([]);
    expect(merged.conflicts).toEqual([
      { orderRef: "00-0-1", files: ["a.csv", "b.csv"], fields: ["itemsValue", "lines", "total"] },
    ]);
  });
});
