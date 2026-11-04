/**
 * 0178 on real PostgreSQL (PGlite): the SkyIsles comparison values in
 * `seller_recon_session` and the read-only `seller_recon_pending`.
 *
 * The sessions are built the real way — synthetic report → parser → the
 * database's own candidates → matching → payload → `seller_recon_create` —
 * so the values the SQL reports can be held against the TypeScript rules
 * that produced the analysis (`ledgerItemsNet`, `ledgerExpectedTotal`).
 *
 *   values        SQL = TypeScript for net, shipping, day, expected total, pieces
 *   three states  at analysis / now / unchanged · applied · changed
 *   pending       exactly apply's set, its count, old and target values, the
 *                 discount rule, stale sales, closed and empty sessions
 *   token         deterministic, and different for every change of the set
 *   unchanged     every key of 0172 still there; decide and apply untouched
 *   rights        gate, no client right on the helpers, no buyer data out
 *   migration     latches, aborted transaction, R0178
 */

import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { coverageOf } from "../coverage";
import { mergeReports } from "../dedupe";
import { ledgerExpectedTotal, reconcile, summarize } from "../diff";
import { ledgerItemsNet, matchOrders } from "../match";
import { parseSalesReport } from "../registry";
import { aliasIndex, ledgerSales, sessionPayload } from "../server/payload";
import { ebayReport, type FixtureOrder } from "../testing/ebay-fixture";
import { pageRequest, sessionPageView } from "../view";
import { failsWith, migration, one, RECONCILIATION_MIGRATIONS, reconciliationWorld, scriptFailsWith, untouchable } from "./schema";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const M0178 = "0178_sales_recon_comparison_and_pending.sql";
const R0178 = readFileSync("supabase/rollback/R0178_sales_recon_without_comparison.sql", "utf8");
const BEFORE_0178 = [...RECONCILIATION_MIGRATIONS, "0175_sales_recon_account_deletion.sql", "0176_sales_recon_validate_before_dedup.sql"] as const;
const WITH_0178 = [...BEFORE_0178, M0178] as const;

const SESSION_0172 = "42c2f33b00fa40040a36e2a71637e724";
const SESSION_0178 = "d70ee33c2b740aa811704ad5e561a34e";
const APPLY_0173 = "f8b1132c27ba1b18123f6c2548f9997c";
const DECIDE_0172 = "2526d3a77ccf3153158182d0ecd391aa";

/** A buyer reference and a note no read may ever return. */
const SECRET = "kaeuferin-geheim";

type Spec = { ref: string | null; sold: string; shipping?: number; total?: number; lines: FixtureOrder["lines"];
  ledger: { sold: string; subtotal: number; discount?: number; shipping?: number; pieces: string[] } | null };

const SPECS: Spec[] = [
  // exact
  { ref: "90-00000-00001", sold: "2026-02-01", lines: [{ character: "Zap", unit: 3.5 }], ledger: { sold: "2026-02-01", subtotal: 3.5, pieces: ["Zap"] } },
  // the day differs
  { ref: "01-00000-00001", sold: "2026-02-18", shipping: 15.99, lines: [{ character: "Hex", unit: 30.3 }, { character: "Cynder", unit: 24 }],
    ledger: { sold: "2026-02-17", subtotal: 54.3, shipping: 15.99, pieces: ["Hex", "Cynder"] } },
  // the day differs; a discount that the net already accounts for
  { ref: "01-00000-00003", sold: "2026-06-05", lines: [{ character: "Sonic Boom", unit: 6.1 }, { character: "Voodood", unit: 4 }],
    ledger: { sold: "2026-06-02", subtotal: 10.2, discount: 0.1, pieces: ["Sonic Boom", "Voodood"] } },
  // shipping differs
  { ref: "01-00000-00010", sold: "2026-03-10", shipping: 4.99, lines: [{ character: "Eruptor", unit: 8 }],
    ledger: { sold: "2026-03-10", subtotal: 8, shipping: 5.49, pieces: ["Eruptor"] } },
  // the report's total is lower: a refund to decide by hand
  { ref: "01-00000-00009", sold: "2026-09-26", shipping: 5.99, total: 13.56, lines: [{ character: "Pop Fizz", unit: 7 }, { character: "Gusto", unit: 7.56 }],
    ledger: { sold: "2026-09-26", subtotal: 14.56, shipping: 5.99, pieces: ["Pop Fizz", "Gusto"] } },
  // in SkyIsles only
  { ref: null, sold: "2026-05-05", lines: [], ledger: { sold: "2026-05-05", subtotal: 9.99, pieces: ["Stealth Elf"] } },
  // in the report only
  { ref: "01-00000-00011", sold: "2026-07-07", lines: [{ character: "Jet-Vac", unit: 12 }], ledger: null },
  { ref: "90-00000-00002", sold: "2026-09-30", lines: [{ character: "Zook", unit: 2.5 }], ledger: { sold: "2026-09-30", subtotal: 2.5, pieces: ["Zook"] } },
];

let db: PGlite;
const saleOf = new Map<string, number>();

async function seed(specs: Spec[] = SPECS): Promise<void> {
  saleOf.clear();
  for (const [i, s] of specs.entries()) {
    if (!s.ledger) continue;
    const id = await one<number>(db,
      `insert into public.sales (channel, sold_at, items_subtotal, discount_amount, shipping_charged, source, buyer_ref, note)
       values ('ebay', $1, $2, $3, $4, 'excel_order_2026', $5, $5) returning id`,
      [s.ledger.sold, s.ledger.subtotal, s.ledger.discount ?? 0, s.ledger.shipping ?? 5.49, SECRET]);
    for (const [k, name] of s.ledger.pieces.entries()) {
      await db.query(`insert into public.sale_items (sale_id, position, raw_name) values ($1, $2, $3)`, [id, k + 1, name]);
    }
    saleOf.set(s.ref ?? `ledger-${i}`, id);
  }
}

/** The whole analysis, as the server action runs it. */
async function analyse(fingerprint = "b", specs: Spec[] = SPECS): Promise<number> {
  let record = 1000;
  const orders: FixtureOrder[] = specs.filter((s) => s.ref !== null && s.lines.length > 0)
    .sort((a, b) => a.sold.localeCompare(b.sold)).map((s) => {
      record += s.lines.length > 1 ? s.lines.length + 1 : 1;
      return { ref: s.ref!, record, sold: s.sold, shipping: s.shipping, total: s.total, lines: s.lines };
    });
  const parsed = parseSalesReport(ebayReport(orders), "synthetic-2026.csv");
  if (!parsed.ok) throw new Error(parsed.error.code);
  const files = [{ fingerprint: fingerprint.repeat(64), report: parsed.report }];
  const merged = mergeReports(files);
  const coverage = coverageOf([parsed.report], merged.orders);
  const candidates = await one(db, `select public.seller_recon_candidates('ebay', $1, $2)`, [coverage.firstSoldOn, coverage.lastSoldOn]);
  const aliases = await one(db, `select public.seller_recon_aliases('ebay')`);
  const rows = reconcile(matchOrders(merged.orders, ledgerSales(candidates), coverage, { aliases: aliasIndex(aliases) }));
  const payload = sessionPayload({ parser: parsed.report.parser, parserVersion: parsed.report.parserVersion, files,
    orders: merged.orders, coverage, rows, summary: summarize(rows) });
  return one<number>(db, `select public.seller_recon_create($1::jsonb)`, [JSON.stringify(payload)]);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
const read = (session: number): Promise<Json> => one(db, `select public.seller_recon_session($1, null, 0, 200)`, [session]);
const pending = (session: number): Promise<Json> => one(db, `select public.seller_recon_pending($1)`, [session]);

type FindingRow = { id: number; field: string; ledger_value: unknown; external_value: unknown };
async function finding(session: number, ref: string, field: string): Promise<FindingRow> {
  const r = await db.query<FindingRow>(`
    select f.id, f.field, f.ledger_value, f.external_value from public.sales_recon_findings f
      join public.sales_recon_matches m on m.id = f.match_id
      join public.sales_recon_orders o on o.id = m.order_id
     where m.session_id = $1 and o.order_ref = $2 and f.field = $3`, [session, ref, field]);
  if (r.rows.length !== 1) throw new Error(`no ${field} finding for ${ref}`);
  return r.rows[0];
}
const decide = (f: FindingRow, decision: string, manual: unknown = null, reason: string | null = null) =>
  one<number>(db, `select public.seller_recon_decide($1, $2, $3::jsonb, $4, $5::jsonb, $6::jsonb)`,
    [f.id, decision, manual === null ? null : JSON.stringify(manual), reason, JSON.stringify(f.ledger_value), JSON.stringify(f.external_value)]);
const apply = (session: number, expected: number) => one<Json>(db, `select public.seller_recon_apply($1, $2)`, [session, expected]);
const tryApply = (session: number, expected: number) => failsWith(db, `select public.seller_recon_apply($1, $2)`, [session, expected]);

const matchOf = (page: Json, ref: string): Json => page.matches.find((m: Json) => m.order?.order_ref === ref);
const n = (v: unknown): number => Number(v);
/** One field of `ledger.atAnalysis`. */
const at = (m: Json, field: string): { value: unknown; basis: string } => m.ledger.atAnalysis[field];

/** Everything the reconciliation stores, and the sales, as one fingerprint. */
const everything = () => one<string>(db, `select md5(
  coalesce((select string_agg(to_jsonb(s)::text, ';' order by s.id) from public.sales s), '') || '|' ||
  coalesce((select string_agg(to_jsonb(r)::text, ';' order by r.id) from public.sale_refunds r), '') || '|' ||
  coalesce((select string_agg(to_jsonb(x)::text, ';' order by x.id) from public.sales_recon_sessions x), '') || '|' ||
  coalesce((select string_agg(to_jsonb(x)::text, ';' order by x.id) from public.sales_recon_matches x), '') || '|' ||
  coalesce((select string_agg(to_jsonb(x)::text, ';' order by x.id) from public.sales_recon_decisions x), '') || '|' ||
  coalesce((select string_agg(to_jsonb(x)::text, ';' order by x.id) from public.sales_recon_applications x), '') || '|' ||
  coalesce((select string_agg(to_jsonb(x)::text, ';' order by x.id) from public.orderbook_audit x), ''))`);

const bodyHash = (fn: string) => one<string | null>(db,
  `select md5(prosrc) from pg_proc where oid = to_regprocedure($1)`, [`public.${fn}`]);

afterEach(async () => {
  await db.close();
});

// ---------------------------------------------------------------------------
describe("the comparison values: SQL = TypeScript", () => {
  beforeEach(async () => {
    db = await reconciliationWorld({ migrations: WITH_0178 });
  });

  it("for many sales — net, shipping, day, expected total, pieces, as the analysis computes them", async () => {
    // Discounts, refunds, cancellations, NULL amounts, no positions — the rules' corners.
    const cases = [
      { subtotal: 10.2, discount: 0.1, shipping: 5.49, refunds: [], cancelled: null, pieces: 2 },
      { subtotal: 35.1, discount: 1.76, shipping: 0, refunds: [6.99], cancelled: null, pieces: 3 },
      { subtotal: 43.19, discount: 0, shipping: 5.99, refunds: [], cancelled: "2026-09-29 23:30:00+00", pieces: 1 },
      { subtotal: 14.56, discount: 0, shipping: 5.99, refunds: [1, 0.01], cancelled: null, pieces: 0 },
      { subtotal: null, discount: null, shipping: null, refunds: [], cancelled: null, pieces: 1 },
      { subtotal: 0.3, discount: 0.1, shipping: 0.2, refunds: [0.1], cancelled: null, pieces: 4 },
      { subtotal: 99999.99, discount: 0.01, shipping: 12.34, refunds: [50, 0.5], cancelled: null, pieces: 2 },
    ];
    const ids: number[] = [];
    for (const c of cases) {
      const id = await one<number>(db, `insert into public.sales (channel, sold_at, items_subtotal, discount_amount, shipping_charged, cancelled_at)
        values ('ebay', '2026-04-10', $1, $2, $3, $4) returning id`, [c.subtotal, c.discount, c.shipping, c.cancelled]);
      for (const amount of c.refunds) await db.query(`insert into public.sale_refunds (sale_id, amount) values ($1, $2)`, [id, amount]);
      for (let k = 0; k < c.pieces; k++) await db.query(`insert into public.sale_items (sale_id, position, raw_name) values ($1, $2, 'X')`, [id, k + 1]);
      ids.push(id);
    }
    const sales = ledgerSales(await one(db, `select public.seller_recon_candidates('ebay', '2026-04-01', '2026-04-30')`));
    expect(sales).toHaveLength(cases.length);
    for (const sale of sales) {
      const v = await one<Json>(db, `select public.sales_recon_sale_values($1)`, [sale.saleId]);
      expect(n(v.itemsNet), `net ${sale.saleId}`).toBeCloseTo(ledgerItemsNet(sale), 10);
      expect(n(v.expectedTotal), `total ${sale.saleId}`).toBeCloseTo(ledgerExpectedTotal(sale), 10);
      expect(n(v.shipping)).toBe(sale.shipping);
      expect(n(v.itemsSubtotal)).toBe(sale.itemsSubtotal);
      expect(n(v.discount)).toBe(sale.discount);
      expect(n(v.refundsTotal)).toBeCloseTo(sale.refundsTotal, 10);
      expect(v.pieces).toBe(sale.pieces.length);
      expect(v.soldOn).toBe(sale.soldOn);
      expect(v.cancelledOn).toBe(sale.cancelledOn);
    }
  });

  it("a fresh session: every pair is `unchanged`, and at analysis = now for every field", async () => {
    await seed();
    const page = await read(await analyse());
    const pairs = page.matches.filter((m: Json) => m.order && m.sale);
    expect(pairs.length).toBeGreaterThan(4);
    for (const m of pairs) {
      expect(m.ledger.state, m.order.order_ref).toBe("unchanged");
      expect(m.ledger.version.analysed).toBe(m.ledger.version.current);
      for (const key of ["itemsNet", "shipping", "expectedTotal", "pieces"]) {
        expect(n(at(m, key).value), `${m.order.order_ref} ${key}`).toBeCloseTo(n(m.ledger.current[key]), 10);
        expect(["stored", "derived"]).toContain(at(m, key).basis);
      }
      expect(at(m, "soldOn").value).toBe(m.ledger.current.soldOn);
    }
  });

  it("at analysis: `stored` where a finding holds the value, `derived` (the report's) where they agreed", async () => {
    await seed();
    const page = await read(await analyse());
    const hex = matchOf(page, "01-00000-00001");
    expect(hex.findings.map((f: Json) => f.field)).toContain("sold_on");
    expect(at(hex, "soldOn")).toEqual({ value: "2026-02-17", basis: "stored" });
    expect(hex.order.sold_on).toBe("2026-02-18");
    expect(at(hex, "itemsNet")).toEqual({ value: hex.order.items_value, basis: "derived" });
    const eruptor = matchOf(page, "01-00000-00010");
    expect(at(eruptor, "shipping")).toEqual({ value: 5.49, basis: "stored" });
    expect(n(eruptor.order.shipping)).toBe(4.99);
    const refund = matchOf(page, "01-00000-00009");
    expect(at(refund, "expectedTotal")).toEqual({ value: 20.55, basis: "stored" });
    expect(n(refund.order.total)).toBe(13.56);
  });

  it("every `stored` value is the finding's, every `derived` one the report's — for every pair and field", async () => {
    await seed();
    const page = await read(await analyse());
    const key: Record<string, [string, string]> = {
      soldOn: ["sold_on", "sold_on"], itemsNet: ["items_net", "items_value"], shipping: ["shipping", "shipping"],
      expectedTotal: ["total", "total"], pieces: ["pieces", "pieces"],
    };
    let stored = 0;
    for (const m of page.matches.filter((x: Json) => x.order && x.sale)) {
      for (const [field, [findingKey, orderColumn]] of Object.entries(key)) {
        const f = m.findings.find((x: Json) => x.key === findingKey);
        if (f) {
          stored++;
          expect(at(m, field), `${m.order.order_ref} ${field}`).toEqual({ value: f.ledger, basis: "stored" });
        } else {
          expect(at(m, field), `${m.order.order_ref} ${field}`).toEqual({ value: m.order[orderColumn], basis: "derived" });
        }
      }
    }
    expect(stored).toBeGreaterThanOrEqual(4);
  });

  it("rows without a pair: no `atAnalysis`; a report-only row has no SkyIsles side at all", async () => {
    await seed();
    const page = await read(await analyse());
    const categories = new Set(page.matches.map((m: Json) => m.category));
    expect(categories).toContain("ledger_only");
    expect(categories).toContain("external_only");
    for (const m of page.matches) {
      if (m.category === "external_only") expect(m.ledger).toBeNull();
      if (m.category === "ledger_only" || m.category === "not_comparable") {
        // Nothing was compared: every field says so, and none carries a stand-in.
        for (const field of ["soldOn", "itemsNet", "shipping", "expectedTotal", "pieces"]) {
          expect(at(m, field), `${m.category} ${field}`).toEqual({ value: null, basis: "unknown" });
        }
        expect(m.ledger.current).not.toBeNull();
      }
    }
  });
});

// ---------------------------------------------------------------------------
describe("pieces: one sale_items row is one physical piece; the report counts quantities", () => {
  /*
   * `sale_items` has no quantity — one row per physical object (0059, 0109).
   * The report has a quantity per line; the parser sums it (`order.pieces`),
   * and `diff.ts` compares it with `sale.pieces.length`. So the SkyIsles
   * count is the number of rows, and three of one figure are three rows.
   */
  const QTY: Spec[] = [
    { ref: "01-00000-00020", sold: "2026-05-10", lines: [{ character: "Chop Chop", unit: 4, qty: 3 }],
      ledger: { sold: "2026-05-10", subtotal: 12, pieces: ["Chop Chop", "Chop Chop", "Chop Chop"] } },
    { ref: "01-00000-00021", sold: "2026-05-11", lines: [{ character: "Drill Sergeant", unit: 5, qty: 2 }, { character: "Boomer", unit: 3 }],
      ledger: { sold: "2026-05-11", subtotal: 13, pieces: ["Drill Sergeant", "Boomer"] } },
  ];

  beforeEach(async () => {
    db = await reconciliationWorld({ migrations: WITH_0178 });
    await seed(QTY);
  });

  it("three of one figure in ONE report line against three rows: 3 = 3, no finding", async () => {
    const page = await read(await analyse("f", QTY));
    const m = matchOf(page, "01-00000-00020");
    expect(m.order.pieces).toBe(3);
    expect(m.findings.find((f: Json) => f.field === "pieces")).toBeUndefined();
    expect(m.ledger.current.pieces).toBe(3);
    expect(at(m, "pieces")).toEqual({ value: 3, basis: "derived" });
    const sale = ledgerSales(await one(db, `select public.seller_recon_candidates('ebay', '2026-05-01', '2026-05-31')`))
      .find((x) => x.saleId === saleOf.get("01-00000-00020"))!;
    expect(m.ledger.current.pieces).toBe(sale.pieces.length);
  });

  it("two of one figure in the report, one row in SkyIsles: the finding and both sides say 2 against 3", async () => {
    const page = await read(await analyse("f", QTY));
    const m = matchOf(page, "01-00000-00021");
    expect(m.order.pieces).toBe(3);
    const f = m.findings.find((x: Json) => x.field === "pieces");
    expect(f).toMatchObject({ ledger: 2, external: 3 });
    expect(m.ledger.current.pieces).toBe(2);
    expect(at(m, "pieces")).toEqual({ value: 2, basis: "stored" });
  });
});

// ---------------------------------------------------------------------------
describe("historical sessions: at analysis, now, and how they relate", () => {
  beforeEach(async () => {
    db = await reconciliationWorld({ migrations: WITH_0178 });
    await seed();
  });

  it("a sale changed elsewhere: `changed`, now moves, at analysis stays", async () => {
    const session = await analyse();
    const sale = saleOf.get("01-00000-00009")!;
    await db.query(`select public.seller_add_sale_refund($1, 6.99, null, 'versandkorrektur')`, [sale]);
    const m = matchOf(await read(session), "01-00000-00009");
    expect(m.ledger.state).toBe("changed");
    expect(m.sale.stale).toBe(true);
    expect(at(m, "expectedTotal")).toEqual({ value: 20.55, basis: "stored" });
    expect(n(m.ledger.current.expectedTotal)).toBe(13.56);
    expect(m.ledger.version.analysed).not.toBe(m.ledger.version.current);
  });

  it("applied by this session: `applied` — now shows the applied value, at analysis the old one", async () => {
    const session = await analyse();
    await decide(await finding(session, "01-00000-00001", "sold_on"), "take_external");
    await apply(session, 1);
    const m = matchOf(await read(session), "01-00000-00001");
    expect(m.ledger.state).toBe("applied");
    expect(m.ledger.current.soldOn).toBe("2026-02-18");
    expect(at(m, "soldOn")).toEqual({ value: "2026-02-17", basis: "stored" });
    expect(m.sale.stale).toBe(false);
    // The others are untouched.
    expect(matchOf(await read(session), "90-00000-00001").ledger.state).toBe("unchanged");
  });

  it("applied, then changed elsewhere: `changed` wins", async () => {
    const session = await analyse();
    await decide(await finding(session, "01-00000-00001", "sold_on"), "take_external");
    await apply(session, 1);
    await db.query(`select public.orderbook_touch_sale($1)`, [saleOf.get("01-00000-00001")]);
    expect(matchOf(await read(session), "01-00000-00001").ledger.state).toBe("changed");
  });

  it("a documented clarification is not an application of a value: the sale stays `unchanged`", async () => {
    const session = await analyse();
    await decide(await finding(session, "01-00000-00009", "total"), "manual", { action: "none" });
    await apply(session, 1);
    expect(matchOf(await read(session), "01-00000-00009").ledger.state).toBe("unchanged");
  });

  it("a closed session keeps its values at analysis, whatever happened since", async () => {
    const session = await analyse();
    await db.query(`select public.seller_recon_close($1)`, [session]);
    await db.query(`select public.seller_add_sale_refund($1, 1.00, null, 'kulanz')`, [saleOf.get("01-00000-00009")]);
    const m = matchOf(await read(session), "01-00000-00009");
    expect(m.ledger.state).toBe("changed");
    expect(at(m, "expectedTotal").value).toBe(20.55);
    expect(n(m.ledger.current.expectedTotal)).toBe(19.55);
  });
});

// ---------------------------------------------------------------------------
describe("seller_recon_session keeps its contract", () => {
  it("every key and value of 0172 is still there — 0178 only adds `ledger`", async () => {
    db = await reconciliationWorld({ migrations: BEFORE_0178 });
    await seed();
    const session = await analyse();
    await decide(await finding(session, "01-00000-00001", "sold_on"), "take_external");
    const before = await read(session);
    expect(await bodyHash("seller_recon_session(bigint,text,integer,integer)")).toBe(SESSION_0172);
    expect(await scriptFailsWith(db, migration(M0178))).toBe("ok");
    const after = await read(session);
    expect(after.matches.every((m: Json) => "ledger" in m)).toBe(true);
    const strip = (page: Json) => ({ ...page, matches: page.matches.map((m: Json) => {
      const rest = { ...m };
      delete rest.ledger;
      return rest;
    }) });
    expect(strip(after)).toEqual(before);
    // Pages and categories as before.
    for (const [category, offset, limit] of [[null, 0, 2], ["deviating", 0, 50], ["exact", 1, 1]] as const) {
      const a = await one<Json>(db, `select public.seller_recon_session($1, $2, $3, $4)`, [session, category, offset, limit]);
      expect(a.matches.length).toBe(Math.min(limit, Math.max(0, a.total - offset)));
    }
  });

  it("the screen's view layer reads the new answer without a contract error", async () => {
    db = await reconciliationWorld({ migrations: WITH_0178 });
    await seed();
    const page = sessionPageView(await read(await analyse()), pageRequest({}));
    expect(page.matches.length).toBeGreaterThan(5);
  });
});

// ---------------------------------------------------------------------------
describe("seller_recon_pending", () => {
  let session: number;
  beforeEach(async () => {
    db = await reconciliationWorld({ migrations: WITH_0178 });
    await seed();
    session = await analyse();
  });

  it("an open session without decisions: nothing pending, a token all the same", async () => {
    const p = await pending(session);
    expect(p).toMatchObject({ sessionId: session, state: "open", sessionOpen: true, count: 0, staleSales: 0, changes: [] });
    expect(p.token).toMatch(/^[0-9a-f]{64}$/);
    expect((await pending(session)).token).toBe(p.token);
  });

  it("closed and discarded sessions: nothing pending, no token — even with decisions taken before", async () => {
    await decide(await finding(session, "01-00000-00001", "sold_on"), "take_external");
    await db.query(`select public.seller_recon_close($1)`, [session]);
    expect(await pending(session)).toEqual({ sessionId: session, state: "closed", sessionOpen: false,
      count: 0, staleSales: 0, token: null, changes: [] });
    const other = await analyse("c");
    await db.query(`select public.seller_recon_discard($1)`, [other]);
    expect(await pending(other)).toMatchObject({ state: "discarded", sessionOpen: false, count: 0, token: null });
  });

  it("an unknown session is no_data_found, named without a value", async () => {
    expect(await failsWith(db, `select public.seller_recon_pending(999999)`)).toBe("P0002");
    await expect(db.query(`select public.seller_recon_pending(999999)`)).rejects.toThrow(/^no such session$/);
  });

  it("counts exactly what seller_recon_apply counts — and keep, defer are not pending", async () => {
    await decide(await finding(session, "01-00000-00001", "sold_on"), "take_external");
    await decide(await finding(session, "01-00000-00010", "shipping"), "manual", { value: 5.2 });
    await decide(await finding(session, "01-00000-00003", "sold_on"), "keep_ledger");
    await decide(await finding(session, "01-00000-00009", "total"), "defer");
    const p = await pending(session);
    expect(p.count).toBe(2);
    expect(p.changes.map((c: Json) => c.field)).toEqual(["sold_on", "shipping"]);
    expect(await tryApply(session, p.count + 1)).toBe("PT409");
    expect(await tryApply(session, p.count - 1)).toBe("PT409");
    expect(await apply(session, p.count)).toEqual({ applied: 2, documented: 0, sales: 2 });
    expect((await pending(session)).count).toBe(0);
  });

  it("several decisions on one field: only the latest counts", async () => {
    const f = await finding(session, "01-00000-00010", "shipping");
    await decide(f, "take_external");
    await decide(f, "manual", { value: 5.2 });
    let p = await pending(session);
    expect(p.count).toBe(1);
    expect(p.changes[0]).toMatchObject({ decision: "manual", target: { shipping: 5.2 } });
    await decide(f, "keep_ledger");
    expect((await pending(session)).count).toBe(0);
    await decide(f, "defer");
    expect((await pending(session)).count).toBe(0);
    await decide(f, "take_external");
    p = await pending(session);
    expect(p.count).toBe(1);
    expect(p.changes[0]).toMatchObject({ decision: "take_external", old: { shipping: 5.49 }, target: { shipping: 4.99 } });
  });

  it("an applied decision is never pending again; a later one on another field is", async () => {
    await decide(await finding(session, "01-00000-00001", "sold_on"), "take_external");
    await apply(session, 1);
    expect((await pending(session)).count).toBe(0);
    await decide(await finding(session, "01-00000-00010", "shipping"), "take_external");
    const p = await pending(session);
    expect(p.changes.map((c: Json) => c.field)).toEqual(["shipping"]);
  });

  it("old values are the sale NOW; targets are what the apply writes — checked by applying", async () => {
    await decide(await finding(session, "01-00000-00001", "sold_on"), "take_external");
    await decide(await finding(session, "01-00000-00010", "shipping"), "manual", { value: 5.2 });
    const p = await pending(session);
    const day = p.changes.find((c: Json) => c.field === "sold_on");
    expect(day).toMatchObject({ saleId: saleOf.get("01-00000-00001"), orderRef: "01-00000-00001", effect: "change",
      old: { soldOn: "2026-02-17" }, target: { soldOn: "2026-02-18" }, stale: false });
    await apply(session, p.count);
    for (const c of p.changes) {
      const now = await one<Json>(db, `select public.sales_recon_sale_values($1)`, [c.saleId]);
      for (const [key, value] of Object.entries(c.target)) {
        if (typeof value === "number") expect(n(now[key]), `${c.field}.${key}`).toBe(value);
        else expect(now[key], `${c.field}.${key}`).toBe(value);
      }
    }
  });

  it("items_net: the target keeps the existing discount — items_subtotal = target + discount (0173)", async () => {
    // The sale gets a discount, and a new analysis finds its net (11.50) against the report's 8.00.
    const sale = saleOf.get("01-00000-00010")!;
    await db.query(`update public.sales set items_subtotal = 12, discount_amount = 0.5 where id = $1`, [sale]);
    const fresh = await analyse("d");
    const net = await finding(fresh, "01-00000-00010", "items_net");
    expect(n(net.ledger_value)).toBe(11.5);
    await decide(net, "manual", { value: 10.25 });
    const p = await pending(fresh);
    const c = p.changes.find((x: Json) => x.field === "items_net");
    expect(c.old).toEqual({ itemsNet: 11.5, itemsSubtotal: 12, discount: 0.5 });
    expect(c.target).toEqual({ itemsNet: 10.25, itemsSubtotal: 10.75, discount: 0.5 });
    await apply(fresh, p.count);
    expect(await one(db, `select items_subtotal::text || '|' || discount_amount::text from public.sales where id = $1`, [sale])).toBe("10.75|0.50");
  });

  it("events and documentation: a refund is an event, a clarification is documented", async () => {
    await decide(await finding(session, "01-00000-00009", "total"), "manual",
      { action: "refund", amount: 6.99, reason: "versandkorrektur", occurred_on: "2026-09-27" }, "Teilerstattung laut eBay");
    const p = await pending(session);
    expect(p.changes[0]).toMatchObject({ field: "total", effect: "event",
      old: { expectedTotal: 20.55, refundsTotal: 0, cancelledOn: null },
      target: { action: "refund", amount: 6.99, reason: "versandkorrektur", occurredOn: "2026-09-27" } });
  });

  it("a sale changed since the analysis: the change is stale, counted, and the apply refuses", async () => {
    await decide(await finding(session, "01-00000-00001", "sold_on"), "take_external");
    await decide(await finding(session, "01-00000-00010", "shipping"), "take_external");
    await db.query(`select public.orderbook_touch_sale($1)`, [saleOf.get("01-00000-00010")]);
    const p = await pending(session);
    expect(p.staleSales).toBe(1);
    expect(p.changes.map((c: Json) => [c.field, c.stale])).toEqual([["sold_on", false], ["shipping", true]]);
    expect(await tryApply(session, p.count)).toBe("PT409");
  });

  it("reading writes nothing — session read and pending alike", async () => {
    await decide(await finding(session, "01-00000-00001", "sold_on"), "take_external");
    const before = await everything();
    const sale = await untouchable(db);
    await read(session);
    await pending(session);
    expect(await everything()).toBe(before);
    expect(await untouchable(db)).toBe(sale);
  });
});

// ---------------------------------------------------------------------------
describe("the token", () => {
  let session: number;
  beforeEach(async () => {
    db = await reconciliationWorld({ migrations: WITH_0178 });
    await seed();
    session = await analyse();
  });
  const token = async () => (await pending(session)).token as string;

  it("is the same for the same set, whatever the caller's time zone or date style", async () => {
    await decide(await finding(session, "01-00000-00001", "sold_on"), "take_external");
    const a = await token();
    await db.exec(`set timezone = 'Pacific/Kiritimati'; set datestyle = 'German, DMY';`);
    expect(await token()).toBe(a);
    await db.exec(`reset timezone; reset datestyle;`);
    expect(await token()).toBe(a);
  });

  it("changes when a decision changes at the same count", async () => {
    const f = await finding(session, "01-00000-00010", "shipping");
    await decide(f, "take_external");
    const a = await token();
    await decide(f, "manual", { value: 4.99 });       // the same target value, another decision
    const b = await token();
    expect((await pending(session)).count).toBe(1);
    expect(b).not.toBe(a);
    await decide(f, "manual", { value: 5.2 });        // the same decision kind, another value
    expect(await token()).not.toBe(b);
    await decide(f, "manual", { value: 5.2 });        // the same value again, but a new decision row
    expect(await token()).not.toBe(b);
  });

  it("changes when the pending set swaps one field for another at the same count", async () => {
    await decide(await finding(session, "01-00000-00001", "sold_on"), "take_external");
    const a = await token();
    await decide(await finding(session, "01-00000-00001", "sold_on"), "keep_ledger");
    await decide(await finding(session, "01-00000-00003", "sold_on"), "take_external");
    expect((await pending(session)).count).toBe(1);
    expect(await token()).not.toBe(a);
  });

  it("changes when a sale's version moves, even with the same decisions", async () => {
    await decide(await finding(session, "01-00000-00009", "total"), "manual", { action: "none" });
    const a = await token();
    await db.query(`select public.seller_add_sale_refund($1, 1.00, null, 'kulanz')`, [saleOf.get("01-00000-00009")]);
    expect(await token()).not.toBe(a);
  });

  it("lists and hashes the changes in decision order, whatever order the findings have", async () => {
    // Decided in reverse finding order: the list follows the decisions, not the findings.
    await decide(await finding(session, "01-00000-00010", "shipping"), "take_external");
    await decide(await finding(session, "01-00000-00001", "sold_on"), "take_external");
    await decide(await finding(session, "01-00000-00003", "sold_on"), "take_external");
    const p = await pending(session);
    const ids = p.changes.map((c: Json) => c.decisionId);
    expect(ids).toEqual([...ids].sort((a: number, b: number) => a - b));
    expect(p.changes.map((c: Json) => c.orderRef)).toEqual(["01-00000-00010", "01-00000-00001", "01-00000-00003"]);
    expect((await pending(session)).token).toBe(p.token);
  });

  it("covers every target the apply writes: a refund decided again on another day is another token", async () => {
    const total = await finding(session, "01-00000-00009", "total");
    await decide(total, "manual", { action: "refund", amount: 6.99, reason: "versandkorrektur", occurred_on: "2026-09-27" }, "laut eBay");
    const a = await pending(session);
    await decide(total, "manual", { action: "refund", amount: 6.99, reason: "versandkorrektur", occurred_on: "2026-09-28" }, "laut eBay");
    const b = await pending(session);
    expect(b.count).toBe(a.count);
    expect(b.changes[0].target.occurredOn).toBe("2026-09-28");
    expect(b.token).not.toBe(a.token);
  });

  it("differs between sessions with the same decisions", async () => {
    const empty = await token();
    const other = await analyse("e");
    expect((await pending(other)).token).not.toBe(empty);
  });
});

// ---------------------------------------------------------------------------
describe("rights and boundaries", () => {
  beforeEach(async () => {
    db = await reconciliationWorld({ migrations: WITH_0178 });
    await seed();
  });

  it("without the seller operator role both reads are refused (42501)", async () => {
    const session = await analyse();
    await db.query(`update public.test_identity set operator = false`);
    expect(await failsWith(db, `select public.seller_recon_pending($1)`, [session])).toBe("42501");
    expect(await failsWith(db, `select public.seller_recon_session($1)`, [session])).toBe("42501");
  });

  it("authenticated may read; anon, PUBLIC and every client role may not touch the helpers", async () => {
    expect(await one(db, `select has_function_privilege('authenticated', 'public.seller_recon_pending(bigint)', 'execute')`)).toBe(true);
    expect(await one(db, `select has_function_privilege('anon', 'public.seller_recon_pending(bigint)', 'execute')`)).toBe(false);
    for (const fn of ["sales_recon_sale_values(bigint)", "sales_recon_pending_set(bigint)", "sales_recon_at_analysis(boolean,jsonb,jsonb)"]) {
      for (const role of ["anon", "authenticated"]) {
        expect(await one(db, `select has_function_privilege($1, $2, 'execute')`, [role, `public.${fn}`]), `${role} ${fn}`).toBe(false);
      }
    }
    const publicGrant = await one<number>(db, `select count(*)::int from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where p.oid in ('public.seller_recon_pending(bigint)'::regprocedure, 'public.sales_recon_sale_values(bigint)'::regprocedure,
                      'public.sales_recon_pending_set(bigint)'::regprocedure, 'public.seller_recon_session(bigint,text,integer,integer)'::regprocedure,
                      'public.sales_recon_at_analysis(boolean,jsonb,jsonb)'::regprocedure)
        and a.grantee = 0`);
    expect(publicGrant).toBe(0);
    expect(await one(db, `select has_function_privilege('authenticated', 'public.seller_recon_session(bigint,text,integer,integer)', 'execute')`)).toBe(true);
    expect(await one(db, `select has_function_privilege('anon', 'public.seller_recon_session(bigint,text,integer,integer)', 'execute')`)).toBe(false);
  });

  it("all four are stable security definers with an empty search_path", async () => {
    const rows = await db.query<{ proname: string; prosecdef: boolean; provolatile: string; proconfig: string[] }>(`
      select proname, prosecdef, provolatile, proconfig from pg_proc
       where oid in ('public.seller_recon_pending(bigint)'::regprocedure, 'public.sales_recon_sale_values(bigint)'::regprocedure,
                     'public.sales_recon_pending_set(bigint)'::regprocedure, 'public.seller_recon_session(bigint,text,integer,integer)'::regprocedure)`);
    expect(rows.rows).toHaveLength(4);
    for (const r of rows.rows) {
      expect(r.prosecdef, r.proname).toBe(true);
      expect(r.provolatile, r.proname).toBe("s");
      expect(r.proconfig, r.proname).toContain('search_path=""');
    }
  });

  it("no buyer reference, note or account identity leaves either read", async () => {
    const session = await analyse();
    for (const f of ["sold_on", "shipping"]) {
      const ref = f === "sold_on" ? "01-00000-00001" : "01-00000-00010";
      await decide(await finding(session, ref, f), "take_external");
    }
    const out = JSON.stringify(await read(session)) + JSON.stringify(await pending(session));
    expect(out).not.toContain(SECRET);
    expect(out).not.toContain("buyer");
    expect(out).not.toMatch(/"note"/);
    expect(out).not.toContain("00000000-0000-4000-8000-000000000001");
  });

  it("pending reads only the session's own sales — a sale outside it never appears", async () => {
    const session = await analyse();
    const outside = await one<number>(db, `insert into public.sales (channel, sold_at, items_subtotal, shipping_charged)
      values ('ebay', '2026-03-10', 1, 1) returning id`);
    await decide(await finding(session, "01-00000-00010", "shipping"), "take_external");
    const p = await pending(session);
    const inSession = await db.query<{ sale_id: number }>(`select sale_id from public.sales_recon_matches where session_id = $1 and sale_id is not null`, [session]);
    for (const c of p.changes) expect(inSession.rows.map((r) => r.sale_id)).toContain(c.saleId);
    expect(p.changes.map((c: Json) => c.saleId)).not.toContain(outside);
  });

  it("decide and apply are exactly the bodies of 0172 and 0173", async () => {
    expect(await bodyHash("seller_recon_decide(bigint,text,jsonb,text,jsonb,jsonb)")).toBe(DECIDE_0172);
    expect(await bodyHash("seller_recon_apply(bigint,integer)")).toBe(APPLY_0173);
    expect(await bodyHash("seller_recon_session(bigint,text,integer,integer)")).toBe(SESSION_0178);
  });
});

// ---------------------------------------------------------------------------
describe("the migration itself", () => {
  beforeEach(async () => {
    db = await reconciliationWorld({ migrations: BEFORE_0178 });
  });

  it("runs once and bounces off a second run", async () => {
    expect(await scriptFailsWith(db, migration(M0178))).toBe("ok");
    expect(await scriptFailsWith(db, migration(M0178))).toBe("P0001");
    expect(await bodyHash("seller_recon_session(bigint,text,integer,integer)")).toBe(SESSION_0178);
  });

  it("refuses a foreign session read and creates nothing", async () => {
    await db.exec(`create or replace function public.seller_recon_session(
      p_id bigint, p_category text default null, p_offset integer default 0, p_limit integer default 50)
      returns jsonb language plpgsql stable security definer set search_path = '' as $$ begin return '{}'; end $$;`);
    expect(await scriptFailsWith(db, migration(M0178))).toBe("P0001");
    expect(await one(db, `select to_regprocedure('public.seller_recon_pending(bigint)')`)).toBeNull();
  });

  it("needs 0176", async () => {
    const bare = await reconciliationWorld();
    try {
      expect(await scriptFailsWith(bare, migration(M0178))).toBe("P0001");
      expect(await one(bare, `select to_regprocedure('public.seller_recon_pending(bigint)')`)).toBeNull();
    } finally {
      await bare.close();
    }
  });

  it("inside an aborted transaction it leaves the read of 0172 and no new function", async () => {
    expect(await scriptFailsWith(db, `begin;\n${migration(M0178)}\nselect 1/0;\ncommit;`)).toBe("22012");
    expect(await bodyHash("seller_recon_session(bigint,text,integer,integer)")).toBe(SESSION_0172);
    for (const fn of ["seller_recon_pending(bigint)", "sales_recon_pending_set(bigint)", "sales_recon_sale_values(bigint)", "sales_recon_at_analysis(boolean,jsonb,jsonb)"]) {
      expect(await one(db, `select to_regprocedure($1)`, [`public.${fn}`])).toBeNull();
    }
  });

  it("contains no data statement", () => {
    const sql = migration(M0178).replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(sql).not.toMatch(/\b(insert\s+into|update\s+public\.|delete\s+from|truncate|alter\s+table|drop\s+table)\b/i);
  });

  it("R0178 turns it back, keeps the rights and the sessions, is idempotent and refuses a third version", async () => {
    await seed();
    const session = await analyse();
    const before = await read(session);
    expect(await scriptFailsWith(db, migration(M0178))).toBe("ok");
    await decide(await finding(session, "01-00000-00001", "sold_on"), "take_external");
    const stored = await everything();
    expect(await scriptFailsWith(db, R0178)).toBe("ok");
    expect(await bodyHash("seller_recon_session(bigint,text,integer,integer)")).toBe(SESSION_0172);
    for (const fn of ["seller_recon_pending(bigint)", "sales_recon_pending_set(bigint)", "sales_recon_sale_values(bigint)", "sales_recon_at_analysis(boolean,jsonb,jsonb)"]) {
      expect(await one(db, `select to_regprocedure($1)`, [`public.${fn}`])).toBeNull();
    }
    expect(await one(db, `select has_function_privilege('authenticated', 'public.seller_recon_session(bigint,text,integer,integer)', 'execute')`)).toBe(true);
    expect(await everything()).toBe(stored);
    const after = await read(session);
    expect(after.matches.map((m: Json) => Object.keys(m).sort())).toEqual(before.matches.map((m: Json) => Object.keys(m).sort()));
    expect(await scriptFailsWith(db, R0178)).toBe("ok");

    await db.exec(`create or replace function public.seller_recon_session(
      p_id bigint, p_category text default null, p_offset integer default 0, p_limit integer default 50)
      returns jsonb language plpgsql stable security definer set search_path = '' as $$ begin return '{}'; end $$;`);
    expect(await scriptFailsWith(db, R0178)).toBe("P0001");
  });

  it.each([
    ["seller_recon_pending(bigint)", `create or replace function public.seller_recon_pending(p_session_id bigint)
      returns jsonb language plpgsql stable security definer set search_path = '' as $$ begin return '{}'; end $$;`],
    ["sales_recon_pending_set(bigint)", `create or replace function public.sales_recon_pending_set(p_session_id bigint)
      returns jsonb language sql stable security definer set search_path = '' as $$ select '{}'::jsonb $$;`],
    ["sales_recon_sale_values(bigint)", `create or replace function public.sales_recon_sale_values(p_sale_id bigint)
      returns jsonb language sql stable security definer set search_path = '' as $$ select '{}'::jsonb $$;`],
    ["sales_recon_at_analysis(boolean,jsonb,jsonb)", `create or replace function public.sales_recon_at_analysis(p_pair boolean, p_finding jsonb, p_report jsonb)
      returns jsonb language sql immutable set search_path = '' as $$ select '{}'::jsonb $$;`],
  ])("R0178 refuses a later version of %s and leaves everything standing", async (fn, later) => {
    expect(await scriptFailsWith(db, migration(M0178))).toBe("ok");
    await db.exec(later);
    expect(await scriptFailsWith(db, R0178)).toBe("P0001");
    expect(await bodyHash("seller_recon_session(bigint,text,integer,integer)")).toBe(SESSION_0178);
    expect(await one(db, `select to_regprocedure($1)`, [`public.${fn}`])).not.toBeNull();
  });

  it("R0178 refuses while seller_recon_apply is not the body of 0173 (a later apply may use the helper)", async () => {
    expect(await scriptFailsWith(db, migration(M0178))).toBe("ok");
    await db.exec(`create or replace function public.seller_recon_apply(p_session_id bigint, p_expected integer)
      returns jsonb language plpgsql volatile security definer set search_path = '' as $$ begin return '{}'; end $$;`);
    expect(await scriptFailsWith(db, R0178)).toBe("P0001");
    expect(await one(db, `select to_regprocedure('public.sales_recon_pending_set(bigint)')`)).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The Staging package: preflight, postflight, run file, registration
// ---------------------------------------------------------------------------
const PRE = readFileSync("supabase/checks/0178_preflight.sql", "utf8");
const POST = readFileSync("supabase/checks/0178_postflight.sql", "utf8");
const RUN = readFileSync("supabase/operations/staging-0178.sql", "utf8");

/**
 * The rows of a check file that are 0178's own — everything between two
 * markers — as one query. The shared base contract (shop, collection) needs
 * the catalogue, which this world does not have; the SQL plan check covers it.
 */
function ownRows(sql: string, from: string, to: string): string {
  const rows = sql.slice(sql.indexOf(from), sql.indexOf(to)).trimEnd().replace(/,$/, "");
  return `with pruef (nr, bereich, pruefung, befund, erwartet) as (values\n${rows}\n)
    select nr, befund, erwartet, case when befund = 'KEIN-RECHT' or erwartet is null then null
                                      else befund is not distinct from erwartet end as ok
      from pruef order by nr`;
}
const PRE_ROWS = ownRows(PRE, "  -- ---------------------------------------------------------- Die Grundlage",
  "   -- --------------------------- Die Zahlen des Betriebs");
const POST_ROWS = ownRows(POST, "  -- ------------------------------------------------------- Die neue Fassung",
  "  (801, 'Basis'");
type CheckRow = { nr: number; befund: string | null; erwartet: string | null; ok: boolean | null };
const rows = async (sql: string) => (await db.query<CheckRow>(sql)).rows;

const COLLECTION = `create table if not exists public.collection_items (
  id uuid primary key default gen_random_uuid(), user_id uuid not null, sky_id text not null, quantity integer not null default 1);`;

describe("preflight and postflight of 0178", () => {
  beforeEach(async () => {
    db = await reconciliationWorld({ migrations: BEFORE_0178 });
    await db.exec(COLLECTION);
    await seed();
  });

  it("before 0178 every preflight row holds; after it every postflight row holds — and 131-153 = 231-253", async () => {
    const session = await analyse();
    await decide(await finding(session, "01-00000-00001", "sold_on"), "take_external");
    await apply(session, 1);
    await decide(await finding(session, "01-00000-00010", "shipping"), "manual", { value: 5.2 });

    const pre = await rows(PRE_ROWS);
    expect(pre.filter((r) => r.ok === false), JSON.stringify(pre.filter((r) => r.ok === false))).toEqual([]);
    expect(pre.filter((r) => r.erwartet !== null).length).toBeGreaterThanOrEqual(8);
    // Before the migration the postflight says so: the new bodies and rights are missing.
    expect((await rows(POST_ROWS)).filter((r) => r.ok === false).map((r) => r.nr))
      .toEqual(expect.arrayContaining([201, 202, 203, 204, 205, 206, 207]));

    expect(await scriptFailsWith(db, migration(M0178))).toBe("ok");
    expect((await rows(PRE_ROWS)).filter((r) => r.ok === false).map((r) => r.nr)).toEqual([101, 111, 112]);
    const post = await rows(POST_ROWS);
    expect(post.filter((r) => r.ok === false), JSON.stringify(post.filter((r) => r.ok === false))).toEqual([]);
    expect(post.filter((r) => r.erwartet !== null).length).toBeGreaterThanOrEqual(13);

    const info = (list: CheckRow[], base: number) =>
      Object.fromEntries(list.filter((r) => r.nr >= base + 31 && r.nr <= base + 53).map((r) => [r.nr - base, r.befund]));
    expect(Object.keys(info(pre, 100))).toHaveLength(16);
    expect(info(post, 200)).toEqual(info(pre, 100));
    for (const v of Object.values(info(pre, 100))) expect(v).not.toBe("KEIN-RECHT");
  });

  it("the postflight sees a moved right or a moved body — it is not a rubber stamp", async () => {
    expect(await scriptFailsWith(db, migration(M0178))).toBe("ok");
    await db.exec(`grant execute on function public.sales_recon_sale_values(bigint) to authenticated`);
    await db.exec(`grant execute on function public.seller_recon_pending(bigint) to anon`);
    const failed = (await rows(POST_ROWS)).filter((r) => r.ok === false).map((r) => r.nr);
    expect(failed).toEqual([207, 209]);
  });

  it("a protected table reads KEIN-RECHT for a role without select — counted, never passed", async () => {
    const one131 = PRE.slice(PRE.indexOf("  (131,"), PRE.indexOf("  (132,"));
    expect(one131).toContain("has_table_privilege('public.sales_recon_sessions', 'select')");
    expect(one131).toContain("else 'KEIN-RECHT' end");
    for (const t of ["sales", "sale_items", "sale_refunds", "inventory_movements", "legacy_stock_events", "orderbook_audit",
      "sales_recon_decisions", "sales_recon_applications"]) {
      expect(PRE).toContain(`has_table_privilege('public.${t}', 'select')`);
      expect(POST).toContain(`has_table_privilege('public.${t}', 'select')`);
    }
  });

  it("neither file calls a reconciliation function or writes", () => {
    for (const t of [PRE, POST]) {
      const code = t.replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/'(?:[^']|'')*'/g, "''");
      expect(code).not.toMatch(/public\.(seller_recon|sales_recon)_\w+\s*\(/);
      expect(code).not.toMatch(/\b(insert|update|delete|truncate|alter|drop|create|grant|revoke)\b/i);
    }
  });

  it("the registration names the three files, the baselines and an unambiguous `erfuellt`", () => {
    const plan = JSON.parse(readFileSync("supabase/checks/migration-plans.json", "utf8")).migrationen["0178"];
    expect(plan).toMatchObject({ preflight: "0178_preflight.sql", lauf: "staging-0178.sql", postflight: "0178_postflight.sql",
      liefert: { "skyisles.base": 900, "skyisles.coll": 901 }, braucht: ["skyisles.base", "skyisles.coll"] });
    expect(plan.angewendet.sql).toBe("select to_regprocedure('public.seller_recon_pending(bigint)') is not null as erfuellt");
  });
});

describe("the Staging run file of 0178", () => {
  const START = `-- >>> EINGEBETTET: supabase/migrations/${M0178}\n`;
  const END = `-- <<< ENDE: supabase/migrations/${M0178}\n`;

  beforeEach(async () => {
    db = await reconciliationWorld({ migrations: BEFORE_0178 });
    await db.exec(COLLECTION);
  });

  it("embeds the migration character for character, and nothing else", () => {
    const a = RUN.indexOf(START);
    expect(a).toBeGreaterThan(-1);
    expect(RUN.slice(a + START.length, RUN.indexOf(END))).toBe(migration(M0178));
    expect([...RUN.matchAll(/^-- >>> EINGEBETTET: /gm)]).toHaveLength(1);
  });

  it("is one transaction for Staging only", () => {
    const lines = RUN.split("\n");
    expect(lines.filter((l) => l.trim() === "begin;")).toHaveLength(1);
    expect(lines.filter((l) => l.trim() === "commit;")).toHaveLength(1);
    expect(RUN.trimEnd().endsWith("commit;")).toBe(true);
    expect(RUN).toContain("'skyisles-staging qqxcpesbwfxzgytkdsac'");
    expect(RUN).not.toContain("zmiwxswrpkmizvqsgype");
  });

  it("stops without the Staging stamp and changes nothing", async () => {
    expect(await scriptFailsWith(db, RUN)).toBe("P0001");
    expect(await bodyHash("seller_recon_session(bigint,text,integer,integer)")).toBe(SESSION_0172);
    expect(await one(db, `select to_regprocedure('public.seller_recon_pending(bigint)')`)).toBeNull();
  });

  it("runs on the stamped database with sessions, decisions and applications present, and moves no value", async () => {
    await db.exec(`comment on database postgres is 'skyisles-staging qqxcpesbwfxzgytkdsac'`);
    await seed();
    const session = await analyse();
    await decide(await finding(session, "01-00000-00001", "sold_on"), "take_external");
    await apply(session, 1);
    const before = await everything();
    const sale = await untouchable(db);
    expect(await scriptFailsWith(db, RUN)).toBe("ok");
    expect(await bodyHash("seller_recon_session(bigint,text,integer,integer)")).toBe(SESSION_0178);
    expect(await everything()).toBe(before);
    expect(await untouchable(db)).toBe(sale);
  });

  it("Z1 measures data, rights and policies — and the comparison names every one of them", () => {
    const z1 = RUN.slice(RUN.indexOf("/* Z1"), RUN.indexOf("/* Z2"));
    for (const c of ["sales_recon_sessions", "sales_recon_files", "sales_recon_orders", "sales_recon_matches", "sales_recon_findings",
      "sales_recon_decisions", "sales_recon_applications", "sales", "sale_items", "sale_refunds", "inventory_movements",
      "legacy_stock_events", "orderbook_audit", "shop_inventory", "collection_items", "funktionsrechte", "tabellenrechte", "policies"]) {
      expect(z1, c).toMatch(new RegExp(`\\bv\\.${c}[,)]`));
      expect(z1, c).toMatch(new RegExp(`\\bn\\.${c}[,)]`));
    }
  });

  it("Z1 aborts when the run moved a right — the guard is real", async () => {
    await db.exec(`comment on database postgres is 'skyisles-staging qqxcpesbwfxzgytkdsac'`);
    const spoiled = RUN.replace("/* Z0 — dieselben Messungen nachher",
      "grant execute on function public.sales_recon_gate() to anon;\n/* Z0 — dieselben Messungen nachher");
    expect(spoiled).not.toBe(RUN);
    expect(await scriptFailsWith(db, spoiled)).toBe("P0001");
    expect(await bodyHash("seller_recon_session(bigint,text,integer,integer)")).toBe(SESSION_0172);
  });
});
