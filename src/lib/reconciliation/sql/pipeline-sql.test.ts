/**
 * The whole way, end to end, on real PostgreSQL: synthetic report → parser →
 * the database's own candidates → matching → payload → `seller_recon_create`
 * → decisions for the nine known cases → `seller_recon_apply`.
 *
 * It proves that the TypeScript side and the database speak the same
 * contract — the payload the server action builds is the payload 0172
 * accepts — and that the nine known deviations end where the operator's
 * decisions say: four dates corrected, one refund and one cancellation
 * recorded, three clarifications documented, nothing else touched.
 */

import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { coverageOf } from "../coverage";
import { mergeReports } from "../dedupe";
import { reconcile, summarize } from "../diff";
import { matchOrders } from "../match";
import { parseSalesReport } from "../registry";
import { aliasIndex, ledgerSales, sessionPayload } from "../server/payload";
import { ebayReport, type FixtureOrder } from "../testing/ebay-fixture";
import { one, reconciliationWorld, untouchable } from "./schema";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

type Spec = { ref: string; sold: string; paid?: string; shipped?: string | null; shipping?: number; total?: number;
  lines: FixtureOrder["lines"]; ledger: { sold: string; subtotal: number; discount?: number; shipping?: number; pieces: string[] } };

// The nine cases, as in known-cases.test.ts, plus one exact order on each edge.
const SPECS: Spec[] = [
  { ref: "90-00000-00001", sold: "2026-02-01", lines: [{ character: "Zap", unit: 3.5 }], ledger: { sold: "2026-02-01", subtotal: 3.5, pieces: ["Zap"] } },
  { ref: "01-00000-00001", sold: "2026-02-18", shipping: 15.99, lines: [{ character: "Hex", unit: 30.3 }, { character: "Cynder", unit: 24 }],
    ledger: { sold: "2026-02-17", subtotal: 54.3, shipping: 15.99, pieces: ["Hex", "Cynder"] } },
  { ref: "01-00000-00002", sold: "2026-02-18", shipping: 10.74, lines: [{ character: "Bash", unit: 3.35 }, { character: "Trigger Happy", unit: 3 }],
    ledger: { sold: "2026-02-17", subtotal: 6.35, shipping: 10.74, pieces: ["Bash", "Trigger Happy"] } },
  { ref: "01-00000-00003", sold: "2026-06-05", lines: [{ character: "Sonic Boom", unit: 6.1 }, { character: "Voodood", unit: 4 }],
    ledger: { sold: "2026-06-02", subtotal: 10.2, discount: 0.1, pieces: ["Sonic Boom", "Voodood"] } },
  { ref: "01-00000-00004", sold: "2026-06-26", paid: "2026-06-28", shipped: "2026-06-28", lines: [{ character: "Camo", unit: 37.83 }],
    ledger: { sold: "2026-06-28", subtotal: 37.83, pieces: ["Camo"] } },
  { ref: "01-00000-00005", sold: "2026-04-27", lines: [{ character: "Water Armor (Crystal)", unit: 5.41 }, { character: "Dark Pyramid (Crystal)", unit: 22.53 },
    { character: "Fire Reactor (Crystal)", unit: 1.8, qty: 3 }], ledger: { sold: "2026-04-27", subtotal: 35.1, discount: 1.76, pieces: ["Water Armor", "Dark Pyramid", "Fire Reactor"] } },
  { ref: "01-00000-00006", sold: "2026-04-24", lines: [{ character: "Chopper", unit: 2.1 }, { character: "Scorp", unit: 1.71 }],
    ledger: { sold: "2026-04-24", subtotal: 3.81, pieces: ["Chopper", "Scorpion Striker Catapult"] } },
  { ref: "01-00000-00007", sold: "2026-04-21", lines: [{ character: "Portal 84148790 (Wireless)", unit: 14.69, title: "Skylanders Portale" }],
    ledger: { sold: "2026-04-21", subtotal: 14.69, pieces: ["83973080A Wireless (SA)"] } },
  { ref: "01-00000-00008", sold: "2026-09-29", shipping: 5.99, total: 0, shipped: null, lines: [{ character: "Wildfire", unit: 43.19 }],
    ledger: { sold: "2026-09-29", subtotal: 43.19, shipping: 5.99, pieces: ["Wildfire"] } },
  { ref: "01-00000-00009", sold: "2026-09-26", shipping: 5.99, total: 13.56, lines: [{ character: "Pop Fizz", unit: 7 }, { character: "Gusto", unit: 7.56 }],
    ledger: { sold: "2026-09-26", subtotal: 14.56, shipping: 5.99, pieces: ["Pop Fizz", "Gusto"] } },
  { ref: "90-00000-00002", sold: "2026-09-30", lines: [{ character: "Zook", unit: 2.5 }], ledger: { sold: "2026-09-30", subtotal: 2.5, pieces: ["Zook"] } },
];

let db: PGlite;
let session: number;
const saleOf = new Map<string, number>();

beforeAll(async () => {
  db = await reconciliationWorld();
  for (const s of SPECS) {
    const id = await one<number>(db,
      `insert into public.sales (channel, sold_at, items_subtotal, discount_amount, shipping_charged, source)
       values ('ebay', $1, $2, $3, $4, 'excel_order_2026') returning id`,
      [s.ledger.sold, s.ledger.subtotal, s.ledger.discount ?? 0, s.ledger.shipping ?? 5.49]);
    // Raw names only, as most historical rows carry them; no SKY-ID needed for matching.
    for (const [i, name] of s.ledger.pieces.entries()) {
      await db.query(`insert into public.sale_items (sale_id, position, raw_name) values ($1, $2, $3)`, [id, i + 1, name]);
    }
    saleOf.set(s.ref, id);
  }

  let record = 1000;
  const orders: FixtureOrder[] = [...SPECS].sort((a, b) => a.sold.localeCompare(b.sold)).map((s) => {
    record += s.lines.length > 1 ? s.lines.length + 1 : 1;
    return { ref: s.ref, record, sold: s.sold, paid: s.paid, shipped: s.shipped, shipping: s.shipping, total: s.total, lines: s.lines };
  });
  const parsed = parseSalesReport(ebayReport(orders), "synthetic-2026.csv");
  if (!parsed.ok) throw new Error(parsed.error.code);
  const files = [{ fingerprint: "b".repeat(64), report: parsed.report }];
  const merged = mergeReports(files);
  const coverage = coverageOf([parsed.report], merged.orders);
  const candidates = await one(db, `select public.seller_recon_candidates('ebay', $1, $2)`, [coverage.firstSoldOn, coverage.lastSoldOn]);
  const aliases = await one(db, `select public.seller_recon_aliases('ebay')`);
  const rows = reconcile(matchOrders(merged.orders, ledgerSales(candidates), coverage, { aliases: aliasIndex(aliases) }));
  const payload = sessionPayload({ parser: parsed.report.parser, parserVersion: parsed.report.parserVersion, files,
    orders: merged.orders, coverage, rows, summary: summarize(rows) });
  session = await one<number>(db, `select public.seller_recon_create($1::jsonb)`, [JSON.stringify(payload)]);
});

afterAll(async () => {
  await db.close();
});

type FindingRow = { id: number; field: string; finding_key: string; ledger_value: unknown; external_value: unknown };
async function findingsOf(ref: string): Promise<FindingRow[]> {
  return (await db.query<FindingRow>(`
    select f.id, f.field, f.finding_key, f.ledger_value, f.external_value
      from public.sales_recon_findings f
      join public.sales_recon_matches m on m.id = f.match_id
      join public.sales_recon_orders o on o.id = m.order_id
     where m.session_id = $1 and o.order_ref = $2 and f.kind = 'deviation' order by f.id`, [session, ref])).rows;
}
const decide = (f: FindingRow, decision: string, manual: unknown = null, reason: string | null = null) =>
  db.query(`select public.seller_recon_decide($1, $2, $3::jsonb, $4, $5::jsonb, $6::jsonb)`,
    [f.id, decision, manual === null ? null : JSON.stringify(manual), reason, JSON.stringify(f.ledger_value), JSON.stringify(f.external_value)]);

describe("from report to database", () => {
  it("stores the categories the analysis found — the database accepted the payload as built", async () => {
    const cats = await db.query<{ category: string; n: number }>(
      `select category, count(*)::int as n from public.sales_recon_matches where session_id = $1 group by 1 order by 1`, [session]);
    expect(Object.fromEntries(cats.rows.map((r) => [r.category, r.n]))).toEqual({ deviating: 8, exact: 2, probable: 1 });
  });

  it("keeps the payment day of the combined order in the session", async () => {
    expect(await one(db, `select paid_on::text from public.sales_recon_orders where order_ref = '01-00000-00004'`)).toBe("2026-06-28");
  });
});

describe("deciding and applying the nine cases", () => {
  it("ends exactly where the decisions say", async () => {
    const before = await untouchable(db);
    // ① – ④ dates: take the report's day (④: the payment day was booked; the sale day is the report's).
    for (const ref of ["01-00000-00001", "01-00000-00002", "01-00000-00003", "01-00000-00004"]) {
      const [date] = await findingsOf(ref);
      expect(date.field).toBe("sold_on");
      await decide(date, "take_external");
    }
    // ⑤ ⑥ ⑦ pieces and figures: documented clarification only.
    for (const ref of ["01-00000-00005", "01-00000-00006", "01-00000-00007"]) {
      for (const f of await findingsOf(ref)) await decide(f, "manual", { action: "clarify" }, "Bestand prüfen");
    }
    // ⑧ cancellation, ⑨ partial refund — by hand, with reasons.
    const [cancel] = await findingsOf("01-00000-00008");
    await decide(cancel, "manual", { action: "cancel", cancelled_on: "2026-09-29" }, "laut eBay storniert, nicht versendet");
    const [refund] = await findingsOf("01-00000-00009");
    await decide(refund, "manual", { action: "refund", amount: 6.99, reason: "versandkorrektur", occurred_on: "2026-09-27" }, "Teilerstattung laut eBay");

    const pending = await one<number>(db, `
      select count(*)::int from public.sales_recon_decisions d
        join public.sales_recon_findings f on f.id = d.finding_id
        join public.sales_recon_matches m on m.id = f.match_id where m.session_id = $1`, [session]);
    const result = await one<Record<string, number>>(db, `select public.seller_recon_apply($1, $2)`, [session, pending]);

    // ⑤: pieces + two figures; ⑥: one figure; ⑦: one figure → five clarifications.
    expect(result).toEqual({ applied: 6, documented: 5, sales: 9 });
    const days = await db.query<{ id: number; sold_at: string }>(`select id, sold_at::text from public.sales order by id`);
    const day = (ref: string) => days.rows.find((r) => r.id === saleOf.get(ref))?.sold_at;
    expect([day("01-00000-00001"), day("01-00000-00002"), day("01-00000-00003"), day("01-00000-00004")])
      .toEqual(["2026-02-18", "2026-02-18", "2026-06-05", "2026-06-26"]);
    expect(await one(db, `select cancelled_at::date::text from public.sales where id = $1`, [saleOf.get("01-00000-00008")])).toBe("2026-09-29");
    expect(await one(db, `select amount::text from public.sale_refunds where sale_id = $1`, [saleOf.get("01-00000-00009")])).toBe("6.99");
    // No order reference was stored: that needs its own explicit decision per sale.
    expect(await one(db, `select count(*)::int from public.sales where external_order_ref is not null`)).toBe(0);
    // And nothing the reconciliation may never touch has moved.
    expect(await untouchable(db)).toBe(before);
  });
});
