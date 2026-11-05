/**
 * 0169–0173 on real PostgreSQL (PGlite), with the real bodies of every
 * function they call. See `schema.ts` for the world they run in.
 *
 * What is proven, in the order of the operator's requirements:
 *
 *   rights        only seller operators; no table is readable by a client
 *   privacy       an unknown payload field — a buyer field — aborts everything
 *   idempotency   one session per set of files; a decision applied once
 *   conflicts     a changed sale or a stale screen is PT409, at every step
 *   audit         every change stands in orderbook_audit AND the session
 *   cancellation  refusals, holds released and re-taken, never a movement
 *   atomicity     one stale sale stops the whole application
 *   stock         sale_items, inventory_movements and legacy_stock_events
 *                 do not move — not by applying, not by cancelling
 */

import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { failsWith, migration, one, RECONCILIATION_MIGRATIONS, reconciliationWorld, scriptFailsWith, untouchable } from "./schema";

// Every test builds its own PostgreSQL world (~2 s); one builds two.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let db: PGlite;

const FP = (n: number) => n.toString(16).padStart(64, "0");

/** A sale with pieces; returns its id. */
async function sale(spec: {
  sold: string; subtotal: number; discount?: number; shipping?: number; source?: string;
  ref?: string | null; pieces?: { sky?: string | null; raw?: string }[]; channel?: string; isTest?: boolean;
}): Promise<number> {
  const id = await one<number>(db,
    `insert into public.sales (channel, sold_at, items_subtotal, discount_amount, shipping_charged, source, external_order_ref, is_test)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [spec.channel ?? "ebay", spec.sold, spec.subtotal, spec.discount ?? 0, spec.shipping ?? 5.49,
     spec.source ?? "manual", spec.ref ?? null, spec.isTest ?? false]);
  for (const [i, p] of (spec.pieces ?? [{ sky: "SKY-0001", raw: "Swarm" }]).entries()) {
    await db.query(`insert into public.sale_items (sale_id, position, sky_id, raw_name) values ($1, $2, $3, $4)`,
      [id, i + 1, p.sky ?? null, p.raw ?? null]);
  }
  return id;
}

const updatedAt = (id: number) => one<string>(db, `select to_jsonb(updated_at) #>> '{}' from public.sales where id = $1`, [id]);

type Finding = { key: string; field: string; kind: string; ledger: unknown; external: unknown; delta: number | null; causes: unknown[] };

/** A minimal, valid session payload around one pair; `patch` changes what a test is about. */
async function payload(saleId: number, findings: Finding[], patch: (p: Record<string, unknown>) => void = () => {}) {
  const p: Record<string, unknown> = {
    channel: "ebay", parser: "ebay-orders-report-de", parserVersion: 1,
    coverage: { coveredFrom: "2026-02-01", coveredTo: "2026-02-28", recordFirst: 1, recordLast: 9, chainComplete: true },
    summary: { categories: { exact: 0, deviating: 1 }, byMonth: { "2026-02": { deviating: 1 } } },
    files: [{ fileName: "feb.csv", fingerprint: FP(1), footerCount: 1, orders: 1, firstSoldOn: "2026-02-18",
      lastSoldOn: "2026-02-18", recordFirst: 5, recordLast: 5 }],
    orders: [{ orderRef: "01-00000-00001", recordNo: 5, soldOn: "2026-02-18", paidOn: "2026-02-18", shippedOn: null,
      itemsValue: 8.99, shipping: 5.49, total: 14.48, pieces: 1, combined: false, destinationCountry: "DE",
      shippingService: "Hermes Päckchen", sourceFile: "feb.csv",
      lines: [{ lineRef: "9000001", listingId: "100000000001", title: "Skylanders Figuren", variant: "[Charakter:Swarm]",
        name: "Swarm", quantity: 1, unitPrice: 8.99, value: 8.99 }] }],
    matches: [{ orderRef: "01-00000-00001", saleId, saleUpdatedAt: await updatedAt(saleId), category: "deviating",
      certainty: "unique", score: 99, dateDelta: -1, competitors: [], reason: null, findings: structuredClone(findings) }],
  };
  patch(p);
  return p;
}

const create = (p: unknown) => one<number>(db, `select public.seller_recon_create($1::jsonb)`, [JSON.stringify(p)]);
const findingId = (session: number, key: string) => one<number>(db,
  `select f.id from public.sales_recon_findings f join public.sales_recon_matches m on m.id = f.match_id
    where m.session_id = $1 and f.finding_key = $2`, [session, key]);
const decide = (finding: number, decision: string, shown: [unknown, unknown], manual: unknown = null, reason: string | null = null) =>
  db.query(`select public.seller_recon_decide($1, $2, $3::jsonb, $4, $5::jsonb, $6::jsonb)`,
    [finding, decision, manual === null ? null : JSON.stringify(manual), reason, JSON.stringify(shown[0]), JSON.stringify(shown[1])]);
const apply = (session: number, expected: number) =>
  one<Record<string, number>>(db, `select public.seller_recon_apply($1, $2)`, [session, expected]);
const asOperator = (on: boolean) => db.query(`update public.test_identity set operator = $1`, [on]);

const DATE: Finding = { key: "sold_on", field: "sold_on", kind: "deviation", ledger: "2026-02-17", external: "2026-02-18", delta: -1, causes: [] };
const NET: Finding = { key: "items_net", field: "items_net", kind: "deviation", ledger: 7.99, external: 8.99, delta: -1, causes: [] };
const REF: Finding = { key: "external_order_ref", field: "external_order_ref", kind: "addition", ledger: null, external: "01-00000-00001", delta: null, causes: [] };
const TOTAL: Finding = { key: "total", field: "total", kind: "deviation", ledger: 14.48, external: 0, delta: 14.48, causes: [{ code: "report_total_zero_not_shipped" }] };
const FIGURE: Finding = { key: "figure:0", field: "figure", kind: "deviation", ledger: "Scorpion Striker Catapult", external: "Scorp", delta: null, causes: [] };

beforeEach(async () => {
  db = await reconciliationWorld();
});
afterEach(async () => {
  await db.close();
});

describe("rights", () => {
  const seller = [
    "seller_recon_candidates(text,date,date)", "seller_recon_aliases(text)", "seller_recon_create(jsonb)",
    "seller_recon_sessions()", "seller_recon_session(bigint,text,integer,integer)",
    "seller_recon_decide(bigint,text,jsonb,text,jsonb,jsonb)", "seller_recon_close(bigint)",
    "seller_recon_discard(bigint)", "seller_recon_thin_snapshots(bigint)", "seller_recon_apply(bigint,integer)",
    "seller_cancel_external_sale(bigint,text,date,timestamptz)", "seller_uncancel_external_sale(bigint,text,timestamptz)",
  ];
  const internal = [
    "sales_recon_gate()", "sales_recon_no_contact(text,text)", "sales_recon_only_keys(jsonb,text[],text)", "sales_recon_allowed(text)",
    "sales_recon_numbers_only(jsonb)", "sales_recon_evidence_is_append_only()",
  ];
  const tables = ["sessions", "files", "orders", "matches", "findings", "decisions", "applications"].map((t) => `public.sales_recon_${t}`);

  it("lets authenticated execute the seller functions, and anon none of them", async () => {
    for (const fn of seller) {
      expect(await one(db, `select has_function_privilege('authenticated', 'public.${fn}', 'execute')`), fn).toBe(true);
      expect(await one(db, `select has_function_privilege('anon', 'public.${fn}', 'execute')`), fn).toBe(false);
    }
  });

  it("gives no client role the internal helpers", async () => {
    for (const fn of internal) {
      for (const role of ["anon", "authenticated"]) {
        expect(await one(db, `select has_function_privilege('${role}', 'public.${fn}', 'execute')`), `${role} ${fn}`).toBe(false);
      }
    }
  });

  it("gives no client role any right on the seven tables, and RLS is on", async () => {
    for (const t of tables) {
      for (const role of ["anon", "authenticated"]) {
        for (const right of ["select", "insert", "update", "delete"]) {
          expect(await one(db, `select has_table_privilege('${role}', '${t}', '${right}')`), `${role} ${right} ${t}`).toBe(false);
        }
      }
      expect(await one(db, `select relrowsecurity from pg_class where oid = '${t}'::regclass`), t).toBe(true);
    }
  });

  it("refuses every seller function to an account that does not operate the seller (42501)", async () => {
    const id = await sale({ sold: "2026-02-17", subtotal: 7.99 });
    const session = await create(await payload(id, [DATE]));
    await asOperator(false);
    for (const call of [
      `select public.seller_recon_candidates('ebay', '2026-02-01', '2026-02-28')`,
      `select public.seller_recon_aliases('ebay')`,
      `select public.seller_recon_create('{}'::jsonb)`,
      `select public.seller_recon_sessions()`,
      `select public.seller_recon_session(${session})`,
      `select public.seller_recon_decide(1, 'keep_ledger', null, null, 'null', 'null')`,
      `select public.seller_recon_apply(${session}, 0)`,
      `select public.seller_recon_close(${session})`,
      `select public.seller_recon_discard(${session})`,
      `select public.seller_recon_thin_snapshots(${session})`,
      `select public.seller_cancel_external_sale(${id}, 'x')`,
      `select public.seller_uncancel_external_sale(${id}, 'x')`,
    ]) {
      expect(await failsWith(db, call), call).toBe("42501");
    }
  });

  it("does not let a direct read as authenticated through", async () => {
    await db.exec("set role authenticated");
    expect(await failsWith(db, "select * from public.sales_recon_sessions")).toBe("42501");
    await db.exec("reset role");
  });
});

describe("the candidates' window (phase 4 step 5B)", () => {
  it("loads sales from 3 days before to 3 days after the period — and not one day more", async () => {
    // period 5 to 28 February: the window is 2 February to 3 March
    const ids: Record<string, number> = {};
    for (const day of ["2026-02-01", "2026-02-02", "2026-02-05", "2026-02-28", "2026-03-01", "2026-03-03", "2026-03-04"]) {
      ids[day] = await sale({ sold: day, subtotal: 7.99 });
    }
    const loaded = (await one<{ saleId: number }[]>(db,
      `select public.seller_recon_candidates('ebay', '2026-02-05', '2026-02-28')`)).map((s) => s.saleId);
    expect(loaded.sort((a, b) => a - b)).toEqual(
      ["2026-02-02", "2026-02-05", "2026-02-28", "2026-03-01", "2026-03-03"].map((d) => ids[d]).sort((a, b) => a - b));
  });
});

describe("recording a session", () => {
  it("stores session, files, orders, matches and findings — and computes the decisions itself", async () => {
    const id = await sale({ sold: "2026-02-17", subtotal: 7.99 });
    const session = await create(await payload(id, [DATE, NET, REF, TOTAL]));
    expect(await one(db, `select count(*)::int from public.sales_recon_orders where session_id = $1`, [session])).toBe(1);
    const allowed = await db.query<{ finding_key: string; allowed_decisions: string[] }>(
      `select finding_key, allowed_decisions from public.sales_recon_findings order by finding_key`);
    expect(Object.fromEntries(allowed.rows.map((r) => [r.finding_key, r.allowed_decisions]))).toEqual({
      external_order_ref: ["take_external", "keep_ledger", "defer"],
      items_net: ["take_external", "keep_ledger", "manual", "defer"],
      sold_on: ["take_external", "keep_ledger", "manual", "defer"],
      total: ["manual", "keep_ledger", "defer"],
    });
    // The payment day lives in the session, not in `sales`.
    expect(await one(db, `select paid_on::text from public.sales_recon_orders`)).toBe("2026-02-18");
  });

  it("returns the existing open session for the same files instead of a second one", async () => {
    const id = await sale({ sold: "2026-02-17", subtotal: 7.99 });
    const first = await create(await payload(id, [DATE]));
    const again = await create(await payload(id, [DATE]));
    expect(again).toBe(first);
    expect(await one(db, `select count(*)::int from public.sales_recon_sessions`)).toBe(1);
    expect(await one(db, `select count(*)::int from public.sales_recon_findings`)).toBe(1);
  });

  it.each([
    ["the payload", (p: Record<string, unknown>) => { p.buyerName = "Testa Käuferin"; }],
    ["an order", (p: Record<string, unknown>) => { (p.orders as Record<string, unknown>[])[0].buyerAddress = "Musterweg 99"; }],
    ["a position", (p: Record<string, unknown>) => {
      ((p.orders as Record<string, unknown>[])[0].lines as Record<string, unknown>[])[0].buyerPhone = "+49 000"; }],
    ["a file", (p: Record<string, unknown>) => { (p.files as Record<string, unknown>[])[0].path = "/Users/x"; }],
    ["a match", (p: Record<string, unknown>) => { (p.matches as Record<string, unknown>[])[0].note = "x"; }],
    ["a finding", (p: Record<string, unknown>) => {
      ((p.matches as Record<string, unknown>[])[0].findings as Record<string, unknown>[])[0].decisions = ["take_external"]; }],
    ["the coverage", (p: Record<string, unknown>) => { (p.coverage as Record<string, unknown>).seller = "x"; }],
  ])("refuses an unknown field on %s and stores nothing", async (_what, patch) => {
    const id = await sale({ sold: "2026-02-17", subtotal: 7.99 });
    expect(await failsWith(db, `select public.seller_recon_create($1::jsonb)`,
      [JSON.stringify(await payload(id, [DATE], patch))])).toBe("23514");
    expect(await one(db, `select count(*)::int from public.sales_recon_sessions`)).toBe(0);
    expect(await one(db, `select count(*)::int from public.sales_recon_orders`)).toBe(0);
  });

  it("refuses contact data in free text — an e-mail address, an international phone number — but keeps model numbers", async () => {
    const id = await sale({ sold: "2026-02-17", subtotal: 7.99 });
    const mail = await payload(id, [DATE], (p) => {
      ((p.orders as Record<string, unknown>[])[0].lines as Record<string, unknown>[])[0].title = "Swarm, Rueckfragen an kaeuferin@example.invalid"; });
    expect(await failsWith(db, `select public.seller_recon_create($1::jsonb)`, [JSON.stringify(mail)])).toBe("23514");
    const phone = await payload(id, [DATE], (p) => {
      ((p.orders as Record<string, unknown>[])[0].lines as Record<string, unknown>[])[0].variant = "[Charakter:Swarm] +49 151 0000000"; });
    expect(await failsWith(db, `select public.seller_recon_create($1::jsonb)`, [JSON.stringify(phone)])).toBe("23514");
    const model = await payload(id, [DATE], (p) => {
      ((p.orders as Record<string, unknown>[])[0].lines as Record<string, unknown>[])[0].name = "Portal 84148790 (Wireless)"; });
    expect(await failsWith(db, `select public.seller_recon_create($1::jsonb)`, [JSON.stringify(model)])).toBe("ok");
  });

  it("refuses a summary that carries text", async () => {
    const id = await sale({ sold: "2026-02-17", subtotal: 7.99 });
    const p = await payload(id, [DATE], (x) => { x.summary = { categories: { exact: "Testa Käuferin" } }; });
    expect(await failsWith(db, `select public.seller_recon_create($1::jsonb)`, [JSON.stringify(p)])).toBe("23514");
  });

  it("refuses a file name that is a path", async () => {
    const id = await sale({ sold: "2026-02-17", subtotal: 7.99 });
    const p = await payload(id, [DATE], (x) => { (x.files as Record<string, unknown>[])[0].fileName = "Downloads/feb.csv"; });
    expect(await failsWith(db, `select public.seller_recon_create($1::jsonb)`, [JSON.stringify(p)])).toBe("23514");
  });

  it("refuses a sale that changed during the analysis (PT409)", async () => {
    const id = await sale({ sold: "2026-02-17", subtotal: 7.99 });
    const p = await payload(id, [DATE]);
    await db.query(`update public.sales set updated_at = updated_at + interval '1 second' where id = $1`, [id]);
    expect(await failsWith(db, `select public.seller_recon_create($1::jsonb)`, [JSON.stringify(p)])).toBe("PT409");
  });

  it("refuses an internal sale and a sale of another channel", async () => {
    const other = await sale({ sold: "2026-02-17", subtotal: 7.99, channel: "manual" });
    expect(await failsWith(db, `select public.seller_recon_create($1::jsonb)`,
      [JSON.stringify(await payload(other, [DATE]))])).toBe("23514");
  });

  it("refuses the same sale twice in one session (one-to-one, by index)", async () => {
    const id = await sale({ sold: "2026-02-17", subtotal: 7.99 });
    const p = await payload(id, [], (x) => {
      const m = (x.matches as Record<string, unknown>[])[0];
      x.matches = [{ ...m, category: "exact" }, { ...m, orderRef: null, category: "ledger_only", certainty: null, findings: [] }];
    });
    expect(await failsWith(db, `select public.seller_recon_create($1::jsonb)`, [JSON.stringify(p)])).toBe("23505");
  });
});

describe("deciding", () => {
  let id: number;
  let session: number;
  beforeEach(async () => {
    id = await sale({ sold: "2026-02-17", subtotal: 7.99 });
    session = await create(await payload(id, [DATE, NET, REF, TOTAL, FIGURE]));
  });

  it("records a decision against the values shown", async () => {
    await decide(await findingId(session, "sold_on"), "take_external", ["2026-02-17", "2026-02-18"]);
    expect(await one(db, `select count(*)::int from public.sales_recon_decisions`)).toBe(1);
  });

  it("refuses a screen that showed other values (PT409)", async () => {
    expect(await failsWith(db, `select public.seller_recon_decide($1, 'take_external', null, null, '"2026-02-16"', '"2026-02-18"')`,
      [await findingId(session, "sold_on")])).toBe("PT409");
  });

  it("refuses a decision once the sale changed after the analysis (PT409)", async () => {
    await db.query(`update public.sales set note = 'edited elsewhere', updated_at = now() + interval '1 minute' where id = $1`, [id]);
    expect(await failsWith(db, `select public.seller_recon_decide($1, 'keep_ledger', null, null, '"2026-02-17"', '"2026-02-18"')`,
      [await findingId(session, "sold_on")])).toBe("PT409");
  });

  it("refuses decisions a field does not allow", async () => {
    // A total is an event, not a value to copy.
    expect(await failsWith(db, `select public.seller_recon_decide($1, 'take_external', null, null, '14.48', '0')`,
      [await findingId(session, "total")])).toBe("23514");
    // A reference is taken or not, never "corrected".
    expect(await failsWith(db, `select public.seller_recon_decide($1, 'manual', '{"value":"x"}', null, 'null', '"01-00000-00001"')`,
      [await findingId(session, "external_order_ref")])).toBe("23514");
    // A figure is never changed automatically.
    expect(await failsWith(db, `select public.seller_recon_decide($1, 'take_external', null, null, '"Scorpion Striker Catapult"', '"Scorp"')`,
      [await findingId(session, "figure:0")])).toBe("23514");
  });

  it("accepts a figure only as a documented clarification with a note", async () => {
    const f = await findingId(session, "figure:0");
    expect(await failsWith(db, `select public.seller_recon_decide($1, 'manual', '{"action":"clarify"}', null, '"Scorpion Striker Catapult"', '"Scorp"')`, [f])).toBe("23514");
    expect(await failsWith(db, `select public.seller_recon_decide($1, 'manual', '{"action":"replace","sky":"SKY-1"}', 'x', '"Scorpion Striker Catapult"', '"Scorp"')`, [f])).toBe("23514");
    await decide(f, "manual", ["Scorpion Striker Catapult", "Scorp"], { action: "clarify" }, "Lager prüfen");
  });

  it("requires amount, a known reason and an explanation for a refund", async () => {
    const f = await findingId(session, "total");
    const call = (manual: unknown, reason: string | null) => failsWith(db,
      `select public.seller_recon_decide($1, 'manual', $2::jsonb, $3, '14.48', '0')`, [f, JSON.stringify(manual), reason]);
    expect(await call({ action: "refund", amount: 14.48, reason: "versandkorrektur" }, null)).toBe("23514");
    expect(await call({ action: "refund", amount: 14.48, reason: "irgendwas" }, "Grund")).toBe("23514");
    expect(await call({ action: "refund", reason: "kulanz" }, "Grund")).toBe("23514");
    expect(await call({ action: "refund", amount: 14.48, reason: "kulanz", buyer: "x" }, "Grund")).toBe("23514");
    expect(await call({ action: "refund", amount: 14.48, reason: "kulanz" }, "Teilerstattung laut eBay")).toBe("ok");
  });

  it("refuses contact data in a reason", async () => {
    expect(await failsWith(db, `select public.seller_recon_decide($1, 'keep_ledger', null, 'Kaeufer unter +49 151 0000000 erreicht', '"2026-02-17"', '"2026-02-18"')`,
      [await findingId(session, "sold_on")])).toBe("23514");
  });

  it("keeps every decision: changing one's mind is a new row, never an update", async () => {
    const f = await findingId(session, "sold_on");
    await decide(f, "defer", ["2026-02-17", "2026-02-18"]);
    await decide(f, "take_external", ["2026-02-17", "2026-02-18"]);
    expect(await one(db, `select count(*)::int from public.sales_recon_decisions where finding_id = $1`, [f])).toBe(2);
    expect(await failsWith(db, `update public.sales_recon_decisions set decision = 'keep_ledger'`)).toBe("23001");
    expect(await failsWith(db, `delete from public.sales_recon_decisions`)).toBe("23001");
  });

  it("refuses a decision in a closed session", async () => {
    await db.query(`select public.seller_recon_close($1)`, [session]);
    expect(await failsWith(db, `select public.seller_recon_decide($1, 'keep_ledger', null, null, '"2026-02-17"', '"2026-02-18"')`,
      [await findingId(session, "sold_on")])).toBe("23001");
  });
});

describe("applying", () => {
  it("applies date, goods value (keeping the discount), shipping and reference — through the audited writer", async () => {
    const id = await sale({ sold: "2026-02-17", subtotal: 9.99, discount: 2, shipping: 4.99 });
    const SHIP: Finding = { key: "shipping", field: "shipping", kind: "deviation", ledger: 4.99, external: 5.49, delta: -0.5, causes: [] };
    const session = await create(await payload(id, [DATE, NET, SHIP, REF]));
    const before = await untouchable(db);
    await decide(await findingId(session, "sold_on"), "take_external", ["2026-02-17", "2026-02-18"]);
    await decide(await findingId(session, "items_net"), "take_external", [7.99, 8.99]);
    await decide(await findingId(session, "shipping"), "manual", [4.99, 5.49], { value: 5.49 });
    await decide(await findingId(session, "external_order_ref"), "take_external", [null, "01-00000-00001"]);

    expect(await apply(session, 4)).toEqual({ applied: 4, documented: 0, sales: 1 });

    const s = (await db.query<Record<string, string>>(
      `select sold_at::text, items_subtotal::text, discount_amount::text, shipping_charged::text, external_order_ref from public.sales where id = $1`, [id])).rows[0];
    expect(s).toEqual({ sold_at: "2026-02-18", items_subtotal: "10.99", discount_amount: "2.00", shipping_charged: "5.49", external_order_ref: "01-00000-00001" });
    const audit = await db.query<{ field: string }>(`select field from public.orderbook_audit where sale_id = $1 order by field`, [id]);
    expect(audit.rows.map((r) => r.field)).toEqual(["external_order_ref", "items_subtotal", "shipping_charged", "sold_at"]);
    expect(await one(db, `select count(*)::int from public.sales_recon_applications where outcome = 'applied'`)).toBe(4);
    expect(await untouchable(db)).toBe(before);
  });

  it("applies a refund with amount and reason, and documents a clarification without changing anything", async () => {
    const id = await sale({ sold: "2026-02-17", subtotal: 7.99 });
    const session = await create(await payload(id, [TOTAL, FIGURE]));
    const before = await untouchable(db);
    await decide(await findingId(session, "total"), "manual", [14.48, 0],
      { action: "refund", amount: 6.99, reason: "versandkorrektur", occurred_on: "2026-02-20" }, "Teilerstattung laut eBay");
    await decide(await findingId(session, "figure:0"), "manual", ["Scorpion Striker Catapult", "Scorp"], { action: "clarify" }, "Regal prüfen");

    expect(await apply(session, 2)).toEqual({ applied: 1, documented: 1, sales: 1 });
    const refund = (await db.query<Record<string, string>>(`select amount::text, reason, external_ref from public.sale_refunds`)).rows[0];
    expect(refund).toEqual({ amount: "6.99", reason: "versandkorrektur", external_ref: "01-00000-00001" });
    expect(await one(db, `select count(*)::int from public.orderbook_audit where entity_type = 'sale_refund'`)).toBe(1);
    expect(await one(db, `select outcome from public.sales_recon_applications where field = 'figure'`)).toBe("documented");
    expect(await untouchable(db)).toBe(before);
  });

  it("refuses when the confirmed count is not the database's count (PT409)", async () => {
    const id = await sale({ sold: "2026-02-17", subtotal: 7.99 });
    const session = await create(await payload(id, [DATE]));
    await decide(await findingId(session, "sold_on"), "take_external", ["2026-02-17", "2026-02-18"]);
    expect(await failsWith(db, `select public.seller_recon_apply($1, 2)`, [session])).toBe("PT409");
    expect(await one(db, `select sold_at::text from public.sales where id = $1`, [id])).toBe("2026-02-17");
  });

  it("aborts EVERYTHING when one affected sale changed — no partial application", async () => {
    const a = await sale({ sold: "2026-02-17", subtotal: 7.99 });
    const b = await sale({ sold: "2026-02-17", subtotal: 7.99, pieces: [{ sky: "SKY-0002", raw: "Zap" }] });
    const p = await payload(a, [DATE], async () => {});
    const matchB = { ...(p.matches as Record<string, unknown>[])[0], orderRef: "01-00000-00002", saleId: b, saleUpdatedAt: await updatedAt(b) };
    p.orders = [...(p.orders as unknown[]), { ...(p.orders as Record<string, unknown>[])[0], orderRef: "01-00000-00002" }];
    p.matches = [...(p.matches as unknown[]), matchB];
    const session = await create(p);
    const [fa, fb] = (await db.query<{ id: number }>(`select id from public.sales_recon_findings order by id`)).rows.map((r) => r.id);
    await decide(fa, "take_external", ["2026-02-17", "2026-02-18"]);
    await decide(fb, "take_external", ["2026-02-17", "2026-02-18"]);
    // Sale b is edited elsewhere after the decisions.
    await db.query(`update public.sales set note = 'elsewhere', updated_at = now() + interval '1 minute' where id = $1`, [b]);

    expect(await failsWith(db, `select public.seller_recon_apply($1, 2)`, [session])).toBe("PT409");
    expect(await one(db, `select count(*)::int from public.sales where sold_at = '2026-02-18'`)).toBe(0);
    expect(await one(db, `select count(*)::int from public.sales_recon_applications`)).toBe(0);
    expect(await one(db, `select count(*)::int from public.orderbook_audit`)).toBe(0);
  });

  it("applies a decision once: the second round finds nothing, and the applied finding takes no new decision", async () => {
    const id = await sale({ sold: "2026-02-17", subtotal: 7.99 });
    const session = await create(await payload(id, [DATE, NET]));
    const f = await findingId(session, "sold_on");
    await decide(f, "take_external", ["2026-02-17", "2026-02-18"]);
    await decide(await findingId(session, "items_net"), "defer", [7.99, 8.99]);
    expect(await apply(session, 1)).toEqual({ applied: 1, documented: 0, sales: 1 });
    expect(await apply(session, 0)).toEqual({ applied: 0, documented: 0, sales: 0 });
    expect(await failsWith(db, `select public.seller_recon_decide($1, 'keep_ledger', null, null, '"2026-02-17"', '"2026-02-18"')`, [f])).toBe("23001");
    // The deferred finding stays open — and still decidable, because the session's view was refreshed.
    await decide(await findingId(session, "items_net"), "take_external", [7.99, 8.99]);
    expect(await apply(session, 1)).toEqual({ applied: 1, documented: 0, sales: 1 });
    expect(await failsWith(db, `update public.sales_recon_applications set outcome = 'documented'`)).toBe("23001");
  });

  it("refuses a reference another sale of the channel already carries", async () => {
    await sale({ sold: "2026-02-10", subtotal: 1, ref: "01-00000-00001" });
    const id = await sale({ sold: "2026-02-17", subtotal: 7.99 });
    const session = await create(await payload(id, [REF]));
    await decide(await findingId(session, "external_order_ref"), "take_external", [null, "01-00000-00001"]);
    expect(await failsWith(db, `select public.seller_recon_apply($1, 1)`, [session])).toBe("23505");
    expect(await one(db, `select count(*)::int from public.sales_recon_applications`)).toBe(0);
  });

  it("refuses to discard a session from which something was applied, and purges only finished ones", async () => {
    const id = await sale({ sold: "2026-02-17", subtotal: 7.99 });
    const session = await create(await payload(id, [DATE]));
    expect(await failsWith(db, `select public.seller_recon_thin_snapshots($1)`, [session])).toBe("23001");
    await decide(await findingId(session, "sold_on"), "take_external", ["2026-02-17", "2026-02-18"]);
    await apply(session, 1);
    expect(await failsWith(db, `select public.seller_recon_discard($1)`, [session])).toBe("23001");
    await db.query(`select public.seller_recon_close($1)`, [session]);
    expect(await one(db, `select public.seller_recon_thin_snapshots($1)`, [session])).toBe(1);
    expect(await one(db, `select count(*)::int from public.sales_recon_orders where lines is null and order_ref = '01-00000-00001'`)).toBe(1);
    // What an audit needs survives the purge.
    expect(await one(db, `select count(*)::int from public.sales_recon_findings`)).toBe(1);
    expect(await one(db, `select count(*)::int from public.sales_recon_applications`)).toBe(1);
  });
});

describe("cancelling and taking it back", () => {
  async function heldSale(source = "manual") {
    await db.query(`insert into public.skylanders values ('SKY-0001', 'Swarm', 'SA', null)`);
    await db.query(`insert into public.shop_inventory (sky_id, quantity) values ('SKY-0001', 3)`);
    const id = await sale({ sold: "2026-02-17", subtotal: 7.99, source });
    const item = await one<number>(db, `select id from public.sale_items where sale_id = $1`, [id]);
    expect(await one(db, `select public.hold_sale_item($1)`, [item])).toBe(source === "manual" ? "held" : "historical");
    return { id, item };
  }
  const reserved = () => one<number>(db, `select reserved from public.shop_inventory`);

  it("releases the hold, sets the date, audits the reason — and writes no movement", async () => {
    const { id } = await heldSale();
    const before = await untouchable(db);
    expect(await reserved()).toBe(1);
    expect(await one(db, `select public.seller_cancel_external_sale($1, 'Käufer hat storniert', '2026-02-18', $2::timestamptz)`,
      [id, await updatedAt(id)])).toBe(1);
    expect(await reserved()).toBe(0);
    expect(await one(db, `select state from public.order_reservations`)).toBe("released");
    expect(await one(db, `select cancelled_at::date::text from public.sales where id = $1`, [id])).toBe("2026-02-18");
    const audit = await db.query<{ field: string; new_value: string }>(`select field, new_value from public.orderbook_audit order by id`);
    expect(audit.rows).toEqual([{ field: "cancelled_at", new_value: "2026-02-18" }, { field: "cancel_reason", new_value: "Käufer hat storniert" }]);
    expect(await untouchable(db)).toBe(before);
  });

  it("takes it back: the hold returns, the reason is audited, still no movement", async () => {
    const { id } = await heldSale();
    await db.query(`select public.seller_cancel_external_sale($1, 'Storno')`, [id]);
    const before = await untouchable(db);
    const outcomes = await one<{ hold: string }[]>(db, `select public.seller_uncancel_external_sale($1, 'Doch bezahlt', $2::timestamptz)`,
      [id, await updatedAt(id)]);
    expect(outcomes.map((o) => o.hold)).toEqual(["held"]);
    expect(await reserved()).toBe(1);
    expect(await one(db, `select cancelled_at from public.sales where id = $1`, [id])).toBeNull();
    expect(await one(db, `select count(*)::int from public.orderbook_audit where field = 'cancel_reason'`)).toBe(2);
    expect(await untouchable(db)).toBe(before);
  });

  it("takes it back safely after the stock moved on: no hold is forced, reserved never exceeds the shelf", async () => {
    await db.query(`insert into public.skylanders values ('SKY-0001', 'Swarm', 'SA', null)`);
    await db.query(`insert into public.shop_inventory (sky_id, quantity) values ('SKY-0001', 1)`);
    const a = await sale({ sold: "2026-02-17", subtotal: 7.99 });
    expect(await one(db, `select public.hold_sale_item(id) from public.sale_items where sale_id = $1`, [a])).toBe("held");
    await db.query(`select public.seller_cancel_external_sale($1, 'Storno')`, [a]);
    // In between, another sale takes the one piece on the shelf.
    const b = await sale({ sold: "2026-02-18", subtotal: 7.99 });
    expect(await one(db, `select public.hold_sale_item(id) from public.sale_items where sale_id = $1`, [b])).toBe("held");
    const before = await untouchable(db);
    const outcomes = await one<{ hold: string }[]>(db, `select public.seller_uncancel_external_sale($1, 'doch bezahlt')`, [a]);
    expect(outcomes.map((o) => o.hold)).toEqual(["no_stock"]);
    expect(await reserved()).toBe(1);
    expect(await one(db, `select count(*)::int from public.order_reservations where state = 'active'`)).toBe(1);
    expect(await untouchable(db)).toBe(before);
    // And a change of the cancelled sale in between is caught by the token.
    await db.query(`select public.seller_cancel_external_sale($1, 'wieder Storno')`, [a]);
    const seen = await updatedAt(a);
    await db.query(`update public.sales set note = 'anderswo', updated_at = updated_at + interval '1 minute' where id = $1`, [a]);
    expect(await failsWith(db, `select public.seller_uncancel_external_sale($1, 'x', $2::timestamptz)`, [a, seen])).toBe("PT409");
  });

  it("refuses what is not to be cancelled", async () => {
    const { id, item } = await heldSale();
    expect(await failsWith(db, `select public.seller_cancel_external_sale($1, '')`, [id])).toBe("23514");
    expect(await failsWith(db, `select public.seller_cancel_external_sale($1, 'x', null, '2000-01-01'::timestamptz)`, [id])).toBe("PT409");
    expect(await failsWith(db, `select public.seller_uncancel_external_sale($1, 'x')`, [id])).toBe("23001");
    await db.query(`update public.sale_items set movement_id = 1 where id = $1`, [item]);
    expect(await failsWith(db, `select public.seller_cancel_external_sale($1, 'x')`, [id])).toBe("23001");
    await db.query(`update public.sale_items set movement_id = null where id = $1`, [item]);
    await db.query(`select public.seller_cancel_external_sale($1, 'x')`, [id]);
    expect(await failsWith(db, `select public.seller_cancel_external_sale($1, 'x')`, [id])).toBe("23001");

    const internal = await one<number>(db, `insert into public.sales (channel, order_id, sold_at) values ('skyisles', 1, '2026-02-01') returning id`);
    expect(await failsWith(db, `select public.seller_cancel_external_sale($1, 'x')`, [internal])).toBe("23001");
    const released = await sale({ sold: "2026-02-01", subtotal: 1, source: "excel_order_2026" });
    await db.query(`update public.sales set stock_released_at = now() where id = $1`, [released]);
    expect(await failsWith(db, `select public.seller_cancel_external_sale($1, 'x')`, [released])).toBe("23001");
  });

  it("cancels a historical sale through a decision without touching anything else", async () => {
    const { id } = await heldSale("excel_order_2026");
    const session = await create(await payload(id, [TOTAL]));
    const before = await untouchable(db);
    await decide(await findingId(session, "total"), "manual", [14.48, 0], { action: "cancel", cancelled_on: "2026-02-18" }, "laut eBay storniert");
    expect(await apply(session, 1)).toEqual({ applied: 1, documented: 0, sales: 1 });
    expect(await one(db, `select cancelled_at::date::text from public.sales where id = $1`, [id])).toBe("2026-02-18");
    expect(await reserved()).toBe(0);
    expect(await untouchable(db)).toBe(before);
  });
});

describe("one order number per channel (0171)", () => {
  it("refuses a second sale with the same number in one channel, allows other channels and test sales", async () => {
    await sale({ sold: "2026-02-01", subtotal: 1, ref: "11-1" });
    expect(await failsWith(db, `insert into public.sales (channel, sold_at, items_subtotal, external_order_ref) values ('ebay', '2026-02-02', 1, '11-1')`)).toBe("23505");
    expect(await failsWith(db, `insert into public.sales (channel, sold_at, items_subtotal, external_order_ref) values ('manual', '2026-02-02', 1, '11-1')`)).toBe("ok");
    expect(await failsWith(db, `insert into public.sales (channel, sold_at, items_subtotal, external_order_ref, is_test) values ('ebay', '2026-02-02', 1, '11-1', true)`)).toBe("ok");
  });

  it("stops before creating the index when two sales already share a number", async () => {
    const fresh = await reconciliationWorld({ migrations: ["0169_sales_reconciliation_schema.sql", "0170_external_sale_cancel.sql"] });
    await fresh.exec(`insert into public.sales (channel, sold_at, items_subtotal, external_order_ref) values
      ('ebay', '2026-02-01', 1, 'dup'), ('ebay', '2026-02-02', 1, 'dup')`);
    expect(await scriptFailsWith(fresh, migration("0171_external_order_ref_per_channel.sql"))).toBe("P0001");
    expect(await one(fresh, `select to_regclass('public.sales_external_order_ref_per_channel') is null`)).toBe(true);
    await fresh.close();
  });
});

describe("every migration bounces off a second run", () => {
  it.each([
    "0169_sales_reconciliation_schema.sql", "0170_external_sale_cancel.sql", "0171_external_order_ref_per_channel.sql",
    "0172_sales_reconciliation_rpcs.sql", "0173_sales_reconciliation_apply.sql",
  ])("%s", async (file) => {
    expect(await scriptFailsWith(db, migration(file))).toBe("P0001");
  });
});

describe("the rollback R0169_0173", () => {
  const ROLLBACK = readFileSync("supabase/rollback/R0169_0173_drop_sales_reconciliation.sql", "utf8");
  const stamp = () => db.exec(`comment on database ${"postgres"} is 'skyisles-staging qqxcpesbwfxzgytkdsac'`);

  it("runs only on the stamped Staging database", async () => {
    expect(await scriptFailsWith(db, ROLLBACK)).toBe("P0001");
  });

  it("refuses once a session exists — evidence is not dropped by a rollback", async () => {
    await stamp();
    const id = await sale({ sold: "2026-02-17", subtotal: 7.99 });
    await create(await payload(id, [DATE]));
    expect(await scriptFailsWith(db, ROLLBACK)).toBe("P0001");
    expect(await one(db, `select to_regclass('public.sales_recon_sessions') is not null`)).toBe(true);
  });

  it("removes everything of 0169–0173 and nothing of the sales book — and the group can be applied again", async () => {
    await stamp();
    const id = await sale({ sold: "2026-02-17", subtotal: 7.99 });
    await db.query(`select public.seller_cancel_external_sale($1, 'vor dem Rueckbau')`, [id]);
    const books = () => one<string>(db, `select md5(
      (select string_agg(to_jsonb(s)::text, ';' order by s.id) from public.sales s) ||
      (select string_agg(to_jsonb(a)::text, ';' order by a.id) from public.orderbook_audit a))`);
    const before = await books();
    const stock = await untouchable(db);

    expect(await scriptFailsWith(db, ROLLBACK)).toBe("ok");
    expect(await one(db, `select count(*)::int from pg_class where relname like 'sales\\_recon\\_%'`)).toBe(0);
    expect(await one(db, `select to_regprocedure('public.seller_cancel_external_sale(bigint,text,date,timestamptz)')`)).toBeNull();
    expect(await one(db, `select to_regclass('public.sales_external_order_ref_per_channel')`)).toBeNull();
    expect(await books()).toBe(before);
    expect(await untouchable(db)).toBe(stock);

    for (const file of RECONCILIATION_MIGRATIONS) expect(await scriptFailsWith(db, migration(file)), file).toBe("ok");
  });
});
