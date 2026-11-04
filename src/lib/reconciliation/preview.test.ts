/**
 * The local preview — synthetic reports only (`testing/ebay-fixture.ts`).
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { buildPreview, daysBetween, MAX_FILE_BYTES, MAX_PAYLOAD_BYTES, payloadBytes, type SelectedFile } from "./preview";
import { validateUpload } from "./server/payload";
import { sha256Text } from "./sha256";
import { ebayReport, FAKE_BUYER, type FixtureOrder } from "./testing/ebay-fixture";

const hash = (text: string) => sha256Text(text);
const file = (name: string, text: string): SelectedFile => ({ name, size: text.length, text });

const order = (n: number, over: Partial<FixtureOrder> = {}): FixtureOrder => ({
  ref: `01-0000${n}-0000${n}`, record: 1000 + n, sold: `2026-03-${String(n).padStart(2, "0")}`,
  lines: [{ unit: 10, character: `Testfigur ${n}` }], ...over,
});

// Order 2 has two positions and so holds three protocol numbers, 1002–1004, and carries
// the last of them (`recordsConsumed`, `chainGaps`).
const MARCH = ebayReport([
  order(1),
  order(2, { record: 1004, lines: [{ unit: 4, qty: 2, character: "Testfigur B" }, { unit: 6, character: "Testfigur C" }] }),
  order(3, { record: 1005 }),
]);

describe("a clean selection", () => {
  it("counts files, orders, positions, pieces, period and protocol", async () => {
    const p = await buildPreview([file("maerz.csv", MARCH)], hash);
    expect(p).toMatchObject({
      parser: "ebay-orders-report-de", orders: 3, positions: 4, pieces: 5,
      firstSoldOn: "2026-03-01", lastSoldOn: "2026-03-03", periodDays: 2,
      chainComplete: true, chainGaps: 0, blockers: [], warnings: [],
    });
    expect(p.files).toHaveLength(1);
    expect(p.files[0]).toMatchObject({ kind: "report", name: "maerz.csv", orders: 3, footerMatches: true, duplicateOf: null });
  });

  it("builds exactly the upload the action accepts — and measures it", async () => {
    const p = await buildPreview([file("maerz.csv", MARCH)], hash);
    expect(p.upload).not.toBeNull();
    expect(() => validateUpload(p.upload)).not.toThrow();
    expect(p.upload?.files[0].fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(p.payloadBytes).toBe(payloadBytes(p.upload!));
    expect(p.payloadBytes).toBe(Buffer.byteLength(JSON.stringify([p.upload]), "utf8"));
  });

  it("an empty selection is blocked, not an error", async () => {
    const p = await buildPreview([], hash);
    expect(p.blockers).toEqual(["no_files"]);
    expect(p.upload).toBeNull();
  });
});

describe("privacy: counts, not content", () => {
  it("nothing of the buyer, in the preview or in the upload", async () => {
    const p = await buildPreview([file("maerz.csv", MARCH)], hash);
    const all = JSON.stringify(p);
    for (const value of Object.values(FAKE_BUYER)) expect(all, value).not.toContain(value);
  });

  it("the shown part carries no title, figure name or order number", async () => {
    const preview = await buildPreview([file("maerz.csv", MARCH)], hash);
    const text = JSON.stringify({ ...preview, upload: null });
    expect(text).not.toContain("Testfigur");
    expect(text).not.toContain("Skylanders");
    expect(text).not.toMatch(/01-0000\d/);
  });

  it("a title with an e-mail address blocks the selection, by the action's own check", async () => {
    const report = ebayReport([order(1, { lines: [{ unit: 10, title: "Figur – Fragen an kontakt@example.invalid" }] })]);
    const p = await buildPreview([file("a.csv", report)], hash);
    expect(p.blockers).toContain("contact_data");
    expect(p.upload).toBeNull();
  });
});

describe("files that are not what they should be", () => {
  it("another format: listed as failed, the selection blocked", async () => {
    const p = await buildPreview([file("maerz.csv", MARCH), file("notizen.csv", "a;b;c\n1;2;3\n")], hash);
    expect(p.files[1]).toEqual({ kind: "failed", name: "notizen.csv", failure: "not_this_format" });
    expect(p.blockers).toEqual(["failed_files"]);
    expect(p.orders).toBe(3);
  });

  it("missing columns are named as such", async () => {
    const p = await buildPreview([file("x.csv", ebayReport([order(1)], { omit: ["Gesamtbetrag"] }))], hash);
    expect(p.files[0]).toMatchObject({ kind: "failed", failure: "missing_columns" });
  });

  it("a file over the size limit is not parsed at all", async () => {
    const p = await buildPreview([{ name: "riesig.csv", size: MAX_FILE_BYTES + 1, text: MARCH }], hash);
    expect(p.files[0]).toEqual({ kind: "failed", name: "riesig.csv", failure: "too_large" });
    expect(p.orders).toBe(0);
  });

  it("an unreadable file is listed, not fatal", async () => {
    const p = await buildPreview([{ name: "kaputt.csv", size: 10, text: null }], hash);
    expect(p.files[0]).toMatchObject({ failure: "unreadable" });
    expect(p.blockers).toContain("failed_files");
  });

  it("a report without orders", async () => {
    const p = await buildPreview([file("leer.csv", ebayReport([]))], hash);
    expect(p.blockers).toContain("no_orders");
  });
});

describe("several files", () => {
  const APRIL = ebayReport([order(4, { sold: "2026-04-01", record: 1006 }), order(5, { sold: "2026-04-02", record: 1007 })]);

  it("two months: merged, one period, one protocol", async () => {
    const p = await buildPreview([file("maerz.csv", MARCH), file("april.csv", APRIL)], hash);
    expect(p).toMatchObject({ orders: 5, firstSoldOn: "2026-03-01", lastSoldOn: "2026-04-02", chainComplete: true, blockers: [] });
    expect(p.upload?.files).toHaveLength(2);
  });

  it("the same file twice: counted once, the second named as a copy, sent once", async () => {
    const p = await buildPreview([file("maerz.csv", MARCH), file("maerz (1).csv", MARCH)], hash);
    expect(p.orders).toBe(3);
    expect(p.files[1]).toMatchObject({ duplicateOf: "maerz.csv" });
    expect(p.warnings).toContain("duplicate_files");
    expect(p.upload?.files).toHaveLength(1);
  });

  it("two DIFFERENT files with the same name are both kept — repeats are found by content, not name", async () => {
    const p = await buildPreview([file("eBay-OrdersReport.csv", MARCH), file("eBay-OrdersReport.csv", APRIL)], hash);
    expect(p.orders).toBe(5);
    expect(p.files.map((f) => f.kind === "report" && f.duplicateOf)).toEqual([null, null]);
    expect(p.upload?.files).toHaveLength(2);
  });

  it("the same identical file twice under the same name: still sent once", async () => {
    const p = await buildPreview([file("eBay-OrdersReport.csv", MARCH), file("eBay-OrdersReport.csv", MARCH)], hash);
    expect(p.upload?.files).toHaveLength(1);
    expect(p.files[1]).toMatchObject({ duplicateOf: "eBay-OrdersReport.csv" });
  });

  it("overlapping exports: repeated orders count once", async () => {
    const overlap = ebayReport([order(3, { record: 1005 }), order(4, { sold: "2026-03-04", record: 1006 })]);
    const p = await buildPreview([file("a.csv", MARCH), file("b.csv", overlap)], hash);
    expect(p.orders).toBe(4);
    expect(p.warnings).toEqual(expect.arrayContaining(["overlapping_files", "repeated_orders"]));
    expect(p.blockers).toEqual([]);
  });

  it("the same order with different content blocks", async () => {
    const changed = ebayReport([order(3, { record: 1005, total: 1 })]);
    const p = await buildPreview([file("a.csv", MARCH), file("b.csv", changed)], hash);
    expect(p.blockers).toContain("conflicting_orders");
    expect(p.upload).toBeNull();
  });
});

describe("limits and warnings", () => {
  it("more than 400 days blocks — the database reads at most that", async () => {
    const report = ebayReport([order(1, { sold: "2025-01-01" }), order(2, { sold: "2026-03-01" })]);
    const p = await buildPreview([file("lang.csv", report)], hash);
    expect(p.periodDays).toBe(daysBetween("2025-01-01", "2026-03-01"));
    expect(p.blockers).toContain("period_too_long");
  });

  it("over 900 KiB of upload blocks, under it does not", async () => {
    const long = "Skylanders Figur mit sehr langem Angebotstitel ".repeat(6);
    const many = (count: number) => ebayReport(Array.from({ length: count }, (_, i) => ({
      ref: `02-${String(i).padStart(5, "0")}-00001`, record: 5000 + i * 2, sold: "2026-05-10",
      lines: [{ unit: 3, title: long, character: `Figur ${i}` }, { unit: 4, title: long, character: `Figur ${i}b` }],
    })));
    const small = await buildPreview([file("klein.csv", many(50))], hash);
    expect(small.payloadBytes).toBeLessThan(MAX_PAYLOAD_BYTES);
    expect(small.blockers).not.toContain("too_large");
    const big = await buildPreview([file("gross.csv", many(1200))], hash);
    expect(big.payloadBytes).toBeGreaterThan(MAX_PAYLOAD_BYTES);
    expect(big.blockers).toContain("too_large");
    expect(big.upload).toBeNull();
  });

  it("gaps in the protocol and a wrong footer are warnings, not blockers", async () => {
    const report = ebayReport([order(1), order(2, { record: 1010 })], { footer: 7 });
    const p = await buildPreview([file("luecke.csv", report)], hash);
    expect(p.chainComplete).toBe(false);
    expect(p.chainGaps).toBe(1);
    expect(p.warnings).toEqual(expect.arrayContaining(["chain_gaps", "footer_mismatch"]));
    expect(p.blockers).toEqual([]);
  });

  it("row issues are counted by code — no row content", async () => {
    const report = ebayReport([order(1, { lines: [{ unit: 2, tx: null }, { unit: 3, tx: null }] })]);
    const p = await buildPreview([file("x.csv", report)], hash);
    expect(p.warnings).toContain("file_issues");
    expect(p.files[0]).toMatchObject({ issues: { line_without_reference: 2 } });
  });
});

describe("what the preview does not do", () => {
  const SOURCE = readFileSync("src/lib/reconciliation/preview.ts", "utf8");

  it("no matching, no diff, no database, no server action", () => {
    expect(SOURCE).not.toMatch(/from "\.\/(match|diff)(\.ts)?"/);
    expect(SOURCE).not.toMatch(/server\/actions|server\/queries|supabase|\.rpc\(/);
  });
});
