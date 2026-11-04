/**
 * 0179 on real PostgreSQL (PGlite): a value at analysis only with proof.
 *
 * The finding it answers: discarded session 3 on Staging — a hand-built
 * payload, `exact` without findings, amounts 1 / 0 / 1 on a real test sale —
 * came back from 0178 as `derived` values the sale never had.
 *
 *   real analysis    every value exactly as 0178 said it (session 1)
 *   contradiction    the hand-built payload: unknown where it lies (session 3)
 *   changed          stored stays, derived becomes unknown (session 2)
 *   applied          several rounds; old values recorded by the apply; the
 *                    total through refunds before and after, discount,
 *                    cancellation and its undoing
 *   unreadable       a day not in ISO form, two applications of one field
 *   contract         every key, pages, view.ts, nothing written
 *   rights, migration, rollback, Staging package
 */

import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, sessionPageView } from "../view";
import { failsWith, migration, one, RECONCILIATION_MIGRATIONS, reconciliationWorld, scriptFailsWith, untouchable } from "./schema";
import {
  analyseSpecs, applySession, contradictingSession, decideOn, everything, findingOf, type Json, matchByRef,
  readSession, seedSales, type Spec,
} from "./session-fixture";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const M0178 = "0178_sales_recon_comparison_and_pending.sql";
const M0179 = "0179_sales_recon_ledger_proof.sql";
const R0178 = readFileSync("supabase/rollback/R0178_sales_recon_without_comparison.sql", "utf8");
const R0179 = readFileSync("supabase/rollback/R0179_sales_recon_ledger_without_proof.sql", "utf8");
const BEFORE_0179 = [...RECONCILIATION_MIGRATIONS, "0175_sales_recon_account_deletion.sql",
  "0176_sales_recon_validate_before_dedup.sql", M0178] as const;
const WITH_0179 = [...BEFORE_0179, M0179] as const;

const SESSION_0178 = "d70ee33c2b740aa811704ad5e561a34e";
const SESSION_0179 = "5ed52447581cc895efc6a56f268c0da3";
const LEDGER_0179 = "07875fe3ba889fefab1c55dbe67005d9";
const PROVEN_0179 = "b7b36ccd5efdd57e661808b62274df68";
const UNTOUCHED: Record<string, string> = {
  "seller_recon_apply(bigint,integer)": "f8b1132c27ba1b18123f6c2548f9997c",
  "seller_recon_decide(bigint,text,jsonb,text,jsonb,jsonb)": "2526d3a77ccf3153158182d0ecd391aa",
  "seller_recon_pending(bigint)": "51213fd88afb5441a487dc89bba2ac06",
  "sales_recon_pending_set(bigint)": "3228eb12e00d7982c5cad5c42ea6f773",
  "sales_recon_sale_values(bigint)": "4c4a01eb05adb6d439450063f04eada9",
  "sales_recon_at_analysis(boolean,jsonb,jsonb)": "192dedca6ea258b54c6108ccbcd2d149",
};
const NEW_FNS = ["sales_recon_ledger(bigint)", "sales_recon_proven(jsonb,text,jsonb,boolean)"];
const FIELDS = ["soldOn", "itemsNet", "shipping", "expectedTotal", "pieces"] as const;
const UNKNOWN = { value: null, basis: "unknown" };

const SPECS: Spec[] = [
  // exact
  { ref: "90-00000-00001", sold: "2026-02-01", lines: [{ character: "Zap", unit: 3.5 }], ledger: { sold: "2026-02-01", subtotal: 3.5, pieces: ["Zap"] } },
  // the day differs
  { ref: "01-00000-00001", sold: "2026-02-18", shipping: 15.99, lines: [{ character: "Hex", unit: 30.3 }, { character: "Cynder", unit: 24 }],
    ledger: { sold: "2026-02-17", subtotal: 54.3, shipping: 15.99, pieces: ["Hex", "Cynder"] } },
  // the day differs; a discount the net already accounts for
  { ref: "01-00000-00003", sold: "2026-06-05", lines: [{ character: "Sonic Boom", unit: 6.1 }, { character: "Voodood", unit: 4 }],
    ledger: { sold: "2026-06-02", subtotal: 10.2, discount: 0.1, pieces: ["Sonic Boom", "Voodood"] } },
  // shipping differs
  { ref: "01-00000-00010", sold: "2026-03-10", shipping: 4.99, lines: [{ character: "Eruptor", unit: 8 }],
    ledger: { sold: "2026-03-10", subtotal: 8, shipping: 5.49, pieces: ["Eruptor"] } },
  // the report's total is lower: a refund or a cancellation to decide by hand
  { ref: "01-00000-00009", sold: "2026-09-26", shipping: 5.99, total: 13.56, lines: [{ character: "Pop Fizz", unit: 7 }, { character: "Gusto", unit: 7.56 }],
    ledger: { sold: "2026-09-26", subtotal: 14.56, shipping: 5.99, pieces: ["Pop Fizz", "Gusto"] } },
  // a refund of 2.00 stood BEFORE the analysis; the report shows 3.00 more
  { ref: "01-00000-00012", sold: "2026-04-12", total: 10.49, lines: [{ character: "Wrecking Ball", unit: 10 }],
    ledger: { sold: "2026-04-12", subtotal: 10, pieces: ["Wrecking Ball"], refunds: [2] } },
  // the net differs, with a discount of 0.50
  { ref: "01-00000-00013", sold: "2026-04-20", lines: [{ character: "Bouncer", unit: 11 }],
    ledger: { sold: "2026-04-20", subtotal: 12, discount: 0.5, pieces: ["Bouncer"] } },
  // in SkyIsles only, in the report only
  { ref: null, sold: "2026-05-05", lines: [], ledger: { sold: "2026-05-05", subtotal: 9.99, pieces: ["Stealth Elf"] } },
  { ref: "01-00000-00011", sold: "2026-07-07", lines: [{ character: "Jet-Vac", unit: 12 }], ledger: null },
  { ref: "90-00000-00002", sold: "2026-09-30", lines: [{ character: "Zook", unit: 2.5 }], ledger: { sold: "2026-09-30", subtotal: 2.5, pieces: ["Zook"] } },
];

let db: PGlite;
let saleOf: Map<string, number>;

const analyse = (fingerprint = "b") => analyseSpecs(db, SPECS, fingerprint);
const finding = (session: number, ref: string, field: string) => findingOf(db, session, ref, field);
const decide = (f: Awaited<ReturnType<typeof finding>>, decision: string, manual: unknown = null, reason: string | null = null) =>
  decideOn(db, f, decision, manual, reason);
const apply = (session: number, expected: number) => applySession(db, session, expected);
const read = (session: number) => readSession(db, session);
const ledger = async (session: number, ref: string): Promise<Json> => matchByRef(await read(session), ref).ledger;
const bodyHash = (fn: string) => one<string | null>(db, `select md5(prosrc) from pg_proc where oid = to_regprocedure($1)`, [`public.${fn}`]);

afterEach(async () => {
  await db.close();
});

// ---------------------------------------------------------------------------
describe("a real analysis (session 1): nothing changes", () => {
  it("every match, every key: 0179 says exactly what 0178 said — before and after applying", async () => {
    db = await reconciliationWorld({ migrations: BEFORE_0179 });
    saleOf = await seedSales(db, SPECS);
    const session = await analyse();
    await decide(await finding(session, "01-00000-00001", "sold_on"), "take_external");
    await decide(await finding(session, "01-00000-00009", "total"), "manual", { action: "refund", amount: 6.99, reason: "versandkorrektur" }, "laut eBay");
    await decide(await finding(session, "01-00000-00003", "sold_on"), "keep_ledger");
    await apply(session, 2);
    const before = await read(session);
    expect(await scriptFailsWith(db, migration(M0179))).toBe("ok");
    const after = await read(session);
    expect(after).toEqual(before);
    const states = new Set(after.matches.filter((m: Json) => m.ledger).map((m: Json) => m.ledger.state));
    expect([...states].sort()).toEqual(["applied", "unchanged"]);
  });
});

// ---------------------------------------------------------------------------
describe("with 0179", () => {
  beforeEach(async () => {
    db = await reconciliationWorld({ migrations: WITH_0179 });
    saleOf = await seedSales(db, SPECS);
  });

  describe("the hand-built payload (session 3)", () => {
    it("unknown where it contradicts the sale, derived where it agrees — and it stays so once discarded", async () => {
      // The Zap sale: net 3.50, shipping 5.49, one piece, 2026-02-01. The payload says 1 / 0 / 1.
      const session = await contradictingSession(db, saleOf.get("90-00000-00001")!, "2026-02-01");
      const expected = {
        soldOn: { value: "2026-02-01", basis: "derived" }, itemsNet: UNKNOWN, shipping: UNKNOWN,
        expectedTotal: UNKNOWN, pieces: { value: 1, basis: "derived" },
      };
      const l = await ledger(session, "VRF-0001");
      expect(l.state).toBe("unchanged");
      expect(l.atAnalysis).toEqual(expected);
      await db.query(`select public.seller_recon_discard($1)`, [session]);
      expect((await ledger(session, "VRF-0001")).atAnalysis).toEqual(expected);
    });

    it("0178 said `derived` for the same row — the measured defect, kept as a record", async () => {
      const bare = await reconciliationWorld({ migrations: BEFORE_0179 });
      try {
        const ids = await seedSales(bare, SPECS);
        const session = await contradictingSession(bare, ids.get("90-00000-00001")!, "2026-02-01");
        const l = matchByRef(await readSession(bare, session), "VRF-0001").ledger;
        expect(l.atAnalysis.itemsNet).toEqual({ value: 1, basis: "derived" });
      } finally {
        await bare.close();
      }
    });
  });

  describe("changed elsewhere (session 2)", () => {
    it("stored stays the recorded value, every derived one becomes unknown", async () => {
      const session = await analyse();
      await db.query(`select public.orderbook_touch_sale($1)`, [saleOf.get("01-00000-00001")]);
      const l = await ledger(session, "01-00000-00001");
      expect(l.state).toBe("changed");
      expect(l.atAnalysis).toEqual({
        soldOn: { value: "2026-02-17", basis: "stored" }, itemsNet: UNKNOWN, shipping: UNKNOWN, expectedTotal: UNKNOWN, pieces: UNKNOWN,
      });
    });
  });

  describe("unchanged", () => {
    it("every pair of a fresh analysis: proven against today, mixed stored and derived", async () => {
      const session = await analyse();
      const page = await read(session);
      for (const m of page.matches.filter((x: Json) => x.order && x.sale)) {
        expect(m.ledger.state).toBe("unchanged");
        for (const f of FIELDS) expect(["stored", "derived"], `${m.order.order_ref} ${f}`).toContain(m.ledger.atAnalysis[f].basis);
      }
      const hex = matchByRef(page, "01-00000-00001").ledger.atAnalysis;
      expect(hex.soldOn).toEqual({ value: "2026-02-17", basis: "stored" });
      expect(hex.itemsNet.basis).toBe("derived");
    });

    it("rows without a pair: unknown everywhere; a report-only row has no SkyIsles side", async () => {
      const page = await read(await analyse());
      for (const m of page.matches) {
        if (!m.sale) expect(m.ledger).toBeNull();
        else if (!m.order) for (const f of FIELDS) expect(m.ledger.atAnalysis[f]).toEqual(UNKNOWN);
      }
    });

    it("a stored value that contradicts the unchanged sale is unknown", async () => {
      const session = await analyse();
      const f = await finding(session, "01-00000-00010", "shipping");
      expect((await ledger(session, "01-00000-00010")).atAnalysis.shipping).toEqual({ value: 5.49, basis: "stored" });
      await db.query(`update public.sales_recon_findings set ledger_value = '9.99' where id = $1`, [f.id]);
      expect((await ledger(session, "01-00000-00010")).atAnalysis.shipping).toEqual(UNKNOWN);
    });

    it("a change past updated_at is caught where it contradicts, and unseen where it does not", async () => {
      const session = await analyse();
      // By hand, without the Orderbuch functions: updated_at does not move.
      await db.query(`update public.sales set shipping_charged = 7.77 where id = $1`, [saleOf.get("90-00000-00001")]);
      const l = await ledger(session, "90-00000-00001");
      expect(l.state).toBe("unchanged");
      expect(l.atAnalysis.shipping).toEqual(UNKNOWN);
      expect(l.atAnalysis.expectedTotal).toEqual(UNKNOWN);
      expect(l.atAnalysis.itemsNet.basis).toBe("derived");
    });
  });

  describe("applied", () => {
    it("several rounds: each touched field proven by the old value its own application recorded", async () => {
      const session = await analyse();
      await decide(await finding(session, "01-00000-00001", "sold_on"), "take_external");
      await apply(session, 1);
      await decide(await finding(session, "01-00000-00010", "shipping"), "manual", { value: 5.2 });
      await decide(await finding(session, "01-00000-00013", "items_net"), "manual", { value: 10.25 });
      await apply(session, 2);

      const hex = await ledger(session, "01-00000-00001");
      expect(hex.state).toBe("applied");
      expect(hex.current.soldOn).toBe("2026-02-18");
      expect(hex.atAnalysis.soldOn).toEqual({ value: "2026-02-17", basis: "stored" });
      for (const f of ["itemsNet", "shipping", "expectedTotal", "pieces"]) expect(hex.atAnalysis[f].basis).toBe("derived");

      const er = await ledger(session, "01-00000-00010");
      expect(er.current.shipping).toBe(5.2);
      expect(er.atAnalysis.shipping).toEqual({ value: 5.49, basis: "stored" });
      expect(er.atAnalysis.expectedTotal).toEqual({ value: 13.49, basis: "stored" });

      // Discount: the old net (11.50) comes from "items_subtotal 12.00 (net 11.50)"; the discount stayed.
      const bo = await ledger(session, "01-00000-00013");
      expect(bo.current.itemsNet).toBe(10.25);
      expect(bo.current.discount).toBe(0.5);
      expect(bo.atAnalysis.itemsNet).toEqual({ value: 11.5, basis: "stored" });
      expect(bo.atAnalysis.expectedTotal).toEqual({ value: 16.99, basis: "stored" });

      // An untouched sale of the same session stays unchanged.
      expect((await ledger(session, "90-00000-00001")).state).toBe("unchanged");
    });

    it("refunds before the analysis and by this session: the total before it is proven", async () => {
      const session = await analyse();
      const total = await finding(session, "01-00000-00012", "total");
      expect(total.ledger_value).toBe(13.49);
      await decide(total, "manual", { action: "refund", amount: 3, reason: "kulanz" }, "laut eBay");
      await apply(session, 1);
      const l = await ledger(session, "01-00000-00012");
      expect(l.current.refundsTotal).toBe(5);
      expect(l.current.expectedTotal).toBe(10.49);
      expect(l.atAnalysis.expectedTotal).toEqual({ value: 13.49, basis: "stored" });
      expect(l.atAnalysis.itemsNet.basis).toBe("derived");

      // A refund AFTER, past this session: changed — stored stays, derived goes.
      await db.query(`select public.seller_add_sale_refund($1, 1.00, null, 'kulanz')`, [saleOf.get("01-00000-00012")]);
      const later = await ledger(session, "01-00000-00012");
      expect(later.state).toBe("changed");
      expect(later.atAnalysis.expectedTotal).toEqual({ value: 13.49, basis: "stored" });
      expect(later.atAnalysis.itemsNet).toEqual(UNKNOWN);
    });

    it("a cancellation by this session: not cancelled before — the total is proven; undoing it is a change", async () => {
      const session = await analyse();
      await decide(await finding(session, "01-00000-00009", "total"), "manual", { action: "cancel", cancelled_on: "2026-09-29" }, "storniert");
      await apply(session, 1);
      const l = await ledger(session, "01-00000-00009");
      expect(l.state).toBe("applied");
      expect(l.current.expectedTotal).toBe(0);
      expect(l.atAnalysis.expectedTotal).toEqual({ value: 20.55, basis: "stored" });

      await db.query(`select public.seller_uncancel_external_sale($1, 'doch nicht')`, [saleOf.get("01-00000-00009")]);
      const undone = await ledger(session, "01-00000-00009");
      expect(undone.state).toBe("changed");
      expect(undone.atAnalysis.expectedTotal).toEqual({ value: 20.55, basis: "stored" });
      expect(undone.atAnalysis.shipping).toEqual(UNKNOWN);
    });

    it("a sale cancelled BEFORE the analysis keeps 0 as its proven total", async () => {
      await db.query(`select public.seller_cancel_external_sale($1, 'vorher storniert', '2026-09-27')`, [saleOf.get("01-00000-00009")]);
      const session = await analyse();
      await decide(await finding(session, "01-00000-00009", "total"), "manual", { action: "refund", amount: 1, reason: "kulanz" }, "Test");
      await apply(session, 1);
      const l = await ledger(session, "01-00000-00009");
      expect(l.atAnalysis.expectedTotal).toEqual({ value: 0, basis: "stored" });
    });

    it("an old value in a form apply does not write today (a day in German style): unknown, not guessed", async () => {
      const session = await analyse();
      await decide(await finding(session, "01-00000-00001", "sold_on"), "take_external");
      await db.exec(`set datestyle = 'German, DMY'`);
      await apply(session, 1);
      await db.exec(`reset datestyle`);
      expect(await one(db, `select old_value from public.sales_recon_applications where field = 'sold_on'`)).toBe("17.02.2026");
      const l = await ledger(session, "01-00000-00001");
      expect(l.atAnalysis.soldOn).toEqual(UNKNOWN);
      expect(l.atAnalysis.itemsNet.basis).toBe("derived");
    });

    it("two applications of one field: ambiguous — unknown", async () => {
      const session = await analyse();
      const f = await finding(session, "01-00000-00001", "sold_on");
      await decide(f, "take_external");
      await apply(session, 1);
      // A second record for the same field — no function writes one; the rule must not pick either.
      const d = await one<number>(db, `insert into public.sales_recon_decisions (finding_id, decision, shown_ledger, shown_external)
        values ($1, 'take_external', '"2026-02-17"', '"2026-02-18"') returning id`, [f.id]);
      await db.query(`insert into public.sales_recon_applications (decision_id, session_id, sale_id, field, outcome, old_value, new_value)
        values ($1, $2, $3, 'sold_on', 'applied', '2026-02-17', '2026-02-18')`, [d, session, saleOf.get("01-00000-00001")]);
      expect((await ledger(session, "01-00000-00001")).atAnalysis.soldOn).toEqual(UNKNOWN);
    });

    it("the caller's time zone and date style change nothing", async () => {
      const session = await analyse();
      await decide(await finding(session, "01-00000-00009", "total"), "manual", { action: "cancel", cancelled_on: "2026-09-29" }, "storniert");
      await apply(session, 1);
      const a = await read(session);
      await db.exec(`set timezone = 'Pacific/Kiritimati'; set datestyle = 'German, DMY';`);
      const b = await read(session);
      await db.exec(`reset timezone; reset datestyle;`);
      const strip = (p: Json) => p.matches.map((m: Json) => m.ledger?.atAnalysis ?? null);
      expect(strip(b)).toEqual(strip(a));
    });
  });

  describe("the answer keeps its contract", () => {
    it("view.ts reads it; one row per page gives the same rows; categories add up; bad pages are refused", async () => {
      const session = await analyse();
      const page = await read(session);
      expect(sessionPageView(page, pageRequest({}, 200)).matches).toHaveLength(page.total);
      const ids: number[] = [];
      for (let off = 0; off < page.total; off++) ids.push(...(await readSession(db, session, null, off, 1)).matches.map((m: Json) => m.id));
      expect(ids).toEqual(page.matches.map((m: Json) => m.id));
      let sum = 0;
      for (const c of new Set(page.matches.map((m: Json) => m.category))) sum += (await readSession(db, session, c as string)).total;
      expect(sum).toBe(page.total);
      for (const [o, l] of [[0, 0], [0, 201], [-1, 1]]) {
        expect(await failsWith(db, `select public.seller_recon_session($1, null, $2, $3)`, [session, o, l])).toBe("23514");
      }
      const m = page.matches.find((x: Json) => x.ledger);
      expect(Object.keys(m.ledger).sort()).toEqual(["atAnalysis", "current", "state", "version"]);
      expect(Object.keys(m.ledger.atAnalysis).sort()).toEqual([...FIELDS].sort());
    });

    it("reading writes nothing — not the session, not a sale, not a decision", async () => {
      const session = await analyse();
      await decide(await finding(session, "01-00000-00001", "sold_on"), "take_external");
      await apply(session, 1);
      const before = await everything(db);
      const sale = await untouchable(db);
      await read(session);
      for (const m of (await read(session)).matches) if (m.sale) await one(db, `select public.sales_recon_ledger($1)`, [m.id]);
      expect(await everything(db)).toBe(before);
      expect(await untouchable(db)).toBe(sale);
    });
  });

  describe("rights", () => {
    it("the helpers: no client role; the session read: authenticated only, as before; gate holds", async () => {
      for (const fn of NEW_FNS) for (const role of ["anon", "authenticated"]) {
        expect(await one(db, `select has_function_privilege($1, $2, 'execute')`, [role, `public.${fn}`]), `${role} ${fn}`).toBe(false);
      }
      expect(await one<number>(db, `select count(*)::int from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where p.oid in ('public.sales_recon_ledger(bigint)'::regprocedure, 'public.sales_recon_proven(jsonb,text,jsonb,boolean)'::regprocedure)
          and a.grantee = 0`)).toBe(0);
      expect(await one(db, `select has_function_privilege('authenticated', 'public.seller_recon_session(bigint,text,integer,integer)', 'execute')`)).toBe(true);
      expect(await one(db, `select has_function_privilege('anon', 'public.seller_recon_session(bigint,text,integer,integer)', 'execute')`)).toBe(false);
      const session = await analyse();
      await db.query(`update public.test_identity set operator = false`);
      expect(await failsWith(db, `select public.seller_recon_session($1)`, [session])).toBe("42501");
    });

    it("session read and ledger are stable security definers with one empty search_path", async () => {
      const rows = await db.query<{ proname: string; prosecdef: boolean; provolatile: string; proconfig: string[] }>(`
        select proname, prosecdef, provolatile, proconfig from pg_proc
         where oid in ('public.sales_recon_ledger(bigint)'::regprocedure, 'public.seller_recon_session(bigint,text,integer,integer)'::regprocedure)`);
      expect(rows.rows).toHaveLength(2);
      for (const r of rows.rows) {
        expect(r.prosecdef, r.proname).toBe(true);
        expect(r.provolatile, r.proname).toBe("s");
        expect(r.proconfig, r.proname).toEqual(['search_path=""']);
      }
    });

    it("the bodies: the three new ones, and every function 0179 must not touch unchanged", async () => {
      expect(await bodyHash("seller_recon_session(bigint,text,integer,integer)")).toBe(SESSION_0179);
      expect(await bodyHash("sales_recon_ledger(bigint)")).toBe(LEDGER_0179);
      expect(await bodyHash("sales_recon_proven(jsonb,text,jsonb,boolean)")).toBe(PROVEN_0179);
      for (const [fn, hash] of Object.entries(UNTOUCHED)) expect(await bodyHash(fn), fn).toBe(hash);
    });
  });
});

// ---------------------------------------------------------------------------
describe("the migration and its rollback", () => {
  beforeEach(async () => {
    db = await reconciliationWorld({ migrations: BEFORE_0179 });
  });

  it("runs once, bounces off a second run, refuses a foreign session read", async () => {
    expect(await scriptFailsWith(db, migration(M0179))).toBe("ok");
    expect(await scriptFailsWith(db, migration(M0179))).toBe("P0001");
    const other = await reconciliationWorld({ migrations: BEFORE_0179 });
    try {
      await other.exec(`create or replace function public.seller_recon_session(
        p_id bigint, p_category text default null, p_offset integer default 0, p_limit integer default 50)
        returns jsonb language plpgsql stable security definer set search_path = '' as $$ begin return '{}'; end $$;`);
      expect(await scriptFailsWith(other, migration(M0179))).toBe("P0001");
      expect(await one(other, `select to_regprocedure('public.sales_recon_ledger(bigint)')`)).toBeNull();
    } finally {
      await other.close();
    }
  });

  it("needs 0178", async () => {
    const bare = await reconciliationWorld({ migrations: BEFORE_0179.slice(0, -1) });
    try {
      expect(await scriptFailsWith(bare, migration(M0179))).toBe("P0001");
    } finally {
      await bare.close();
    }
  });

  it("inside an aborted transaction it leaves the 0178 read and no helper", async () => {
    expect(await scriptFailsWith(db, `begin;\n${migration(M0179)}\nselect 1/0;\ncommit;`)).toBe("22012");
    expect(await bodyHash("seller_recon_session(bigint,text,integer,integer)")).toBe(SESSION_0178);
    for (const fn of NEW_FNS) expect(await one(db, `select to_regprocedure($1)`, [`public.${fn}`])).toBeNull();
  });

  it("contains no data statement", () => {
    const sql = migration(M0179).replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(sql).not.toMatch(/\b(insert\s+into|update\s+public\.|delete\s+from|truncate|alter\s+table|drop\s+table|grant\s)\b/i);
  });

  it("R0179 turns it back to the 0178 read, keeps rights and rows, is idempotent, refuses a third version", async () => {
    saleOf = await seedSales(db, SPECS);
    const session = await analyse();
    const before = await read(session);
    expect(await scriptFailsWith(db, migration(M0179))).toBe("ok");
    const stored = await everything(db);
    expect(await scriptFailsWith(db, R0179)).toBe("ok");
    expect(await bodyHash("seller_recon_session(bigint,text,integer,integer)")).toBe(SESSION_0178);
    for (const fn of NEW_FNS) expect(await one(db, `select to_regprocedure($1)`, [`public.${fn}`])).toBeNull();
    expect(await one(db, `select has_function_privilege('authenticated', 'public.seller_recon_session(bigint,text,integer,integer)', 'execute')`)).toBe(true);
    expect(await everything(db)).toBe(stored);
    expect(await read(session)).toEqual(before);
    expect(await scriptFailsWith(db, R0179)).toBe("ok");
    await db.exec(`create or replace function public.seller_recon_session(
      p_id bigint, p_category text default null, p_offset integer default 0, p_limit integer default 50)
      returns jsonb language plpgsql stable security definer set search_path = '' as $$ begin return '{}'; end $$;`);
    expect(await scriptFailsWith(db, R0179)).toBe("P0001");
  });

  it.each([
    ["sales_recon_ledger(bigint)", `create or replace function public.sales_recon_ledger(p_match_id bigint)
      returns jsonb language sql stable security definer set search_path = '' as $$ select '{}'::jsonb $$;`],
    ["sales_recon_proven(jsonb,text,jsonb,boolean)", `create or replace function public.sales_recon_proven(p_value jsonb, p_basis text, p_proof jsonb, p_provable boolean)
      returns jsonb language sql immutable set search_path = '' as $$ select '{}'::jsonb $$;`],
  ])("R0179 refuses a later version of %s and leaves everything standing", async (fn, later) => {
    expect(await scriptFailsWith(db, migration(M0179))).toBe("ok");
    await db.exec(later);
    expect(await scriptFailsWith(db, R0179)).toBe("P0001");
    expect(await bodyHash("seller_recon_session(bigint,text,integer,integer)")).toBe(SESSION_0179);
    expect(await one(db, `select to_regprocedure($1)`, [`public.${fn}`])).not.toBeNull();
  });

  it("R0178 refuses while 0179 stands — 0179 goes back first", async () => {
    expect(await scriptFailsWith(db, migration(M0179))).toBe("ok");
    expect(await scriptFailsWith(db, R0178)).toBe("P0001");
    expect(await bodyHash("seller_recon_session(bigint,text,integer,integer)")).toBe(SESSION_0179);
    expect(await scriptFailsWith(db, R0179)).toBe("ok");
    expect(await scriptFailsWith(db, R0178)).toBe("ok");
  });
});

// ---------------------------------------------------------------------------
// The Staging package
// ---------------------------------------------------------------------------
const PRE = readFileSync("supabase/checks/0179_preflight.sql", "utf8");
const POST = readFileSync("supabase/checks/0179_postflight.sql", "utf8");
const RUN = readFileSync("supabase/operations/staging-0179.sql", "utf8");

function ownRows(sql: string, from: string, to: string): string {
  const rows = sql.slice(sql.indexOf(from), sql.indexOf(to)).trimEnd().replace(/,$/, "");
  return `with pruef (nr, bereich, pruefung, befund, erwartet) as (values\n${rows}\n)
    select nr, befund, erwartet, case when befund = 'KEIN-RECHT' or erwartet is null then null
                                      else befund is not distinct from erwartet end as ok
      from pruef order by nr`;
}
const PRE_ROWS = ownRows(PRE, "  -- ---------------------------------------------------------- Die Grundlage",
  "   -- --------------------------- Die Zahlen des Betriebs");
const POST_ROWS = ownRows(POST, "  -- ------------------------------------------------------- Die neue Fassung", "  (801, 'Basis'");
type CheckRow = { nr: number; befund: string | null; erwartet: string | null; ok: boolean | null };
const rows = async (sql: string) => (await db.query<CheckRow>(sql)).rows;
const COLLECTION = `create table if not exists public.collection_items (
  id uuid primary key default gen_random_uuid(), user_id uuid not null, sky_id text not null, quantity integer not null default 1);`;

describe("preflight, postflight and run file of 0179", () => {
  beforeEach(async () => {
    db = await reconciliationWorld({ migrations: BEFORE_0179 });
    await db.exec(COLLECTION);
    saleOf = await seedSales(db, SPECS);
  });

  it("preflight holds before, postflight after; 131-153 = 231-253", async () => {
    const session = await analyse();
    await decide(await finding(session, "01-00000-00001", "sold_on"), "take_external");
    await apply(session, 1);
    const pre = await rows(PRE_ROWS);
    expect(pre.filter((r) => r.ok === false)).toEqual([]);
    expect(pre.filter((r) => r.erwartet !== null).length).toBeGreaterThanOrEqual(10);
    expect(await scriptFailsWith(db, migration(M0179))).toBe("ok");
    expect((await rows(PRE_ROWS)).filter((r) => r.ok === false).map((r) => r.nr)).toEqual([101, 111, 112]);
    const post = await rows(POST_ROWS);
    expect(post.filter((r) => r.ok === false)).toEqual([]);
    expect(post.filter((r) => r.erwartet !== null).length).toBe(13);
    const info = (list: CheckRow[], base: number) =>
      Object.fromEntries(list.filter((r) => r.nr >= base + 31 && r.nr <= base + 53).map((r) => [r.nr - base, r.befund]));
    expect(Object.keys(info(pre, 100))).toHaveLength(16);
    expect(info(post, 200)).toEqual(info(pre, 100));
  });

  it("the postflight sees a moved right", async () => {
    expect(await scriptFailsWith(db, migration(M0179))).toBe("ok");
    await db.exec(`grant execute on function public.sales_recon_ledger(bigint) to authenticated`);
    expect((await rows(POST_ROWS)).filter((r) => r.ok === false).map((r) => r.nr)).toEqual([206]);
  });

  it("neither check file calls a reconciliation function or writes", () => {
    for (const t of [PRE, POST]) {
      const code = t.replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/'(?:[^']|'')*'/g, "''");
      expect(code).not.toMatch(/public\.(seller_recon|sales_recon)_\w+\s*\(/);
      expect(code).not.toMatch(/\b(insert|update|delete|truncate|alter|drop|create|grant|revoke)\b/i);
    }
  });

  it("the run file embeds the migration character for character, for Staging only, in one transaction", () => {
    const start = `-- >>> EINGEBETTET: supabase/migrations/${M0179}\n`;
    const a = RUN.indexOf(start);
    expect(RUN.slice(a + start.length, RUN.indexOf(`-- <<< ENDE: supabase/migrations/${M0179}\n`))).toBe(migration(M0179));
    expect([...RUN.matchAll(/^-- >>> EINGEBETTET: /gm)]).toHaveLength(1);
    expect(RUN.split("\n").filter((l) => l.trim() === "begin;")).toHaveLength(1);
    expect(RUN.trimEnd().endsWith("commit;")).toBe(true);
    expect(RUN).toContain("'skyisles-staging qqxcpesbwfxzgytkdsac'");
    expect(RUN).not.toContain("zmiwxswrpkmizvqsgype");
  });

  it("the run file stops without the stamp, runs with it and moves no value; Z1 catches a moved right", async () => {
    expect(await scriptFailsWith(db, RUN)).toBe("P0001");
    expect(await bodyHash("seller_recon_session(bigint,text,integer,integer)")).toBe(SESSION_0178);
    await db.exec(`comment on database postgres is 'skyisles-staging qqxcpesbwfxzgytkdsac'`);
    const spoiled = RUN.replace("/* Z0 — dieselben Messungen nachher",
      "grant execute on function public.sales_recon_gate() to anon;\n/* Z0 — dieselben Messungen nachher");
    expect(await scriptFailsWith(db, spoiled)).toBe("P0001");
    expect(await bodyHash("seller_recon_session(bigint,text,integer,integer)")).toBe(SESSION_0178);
    const session = await analyse();
    await decide(await finding(session, "01-00000-00001", "sold_on"), "take_external");
    await apply(session, 1);
    const before = await everything(db);
    expect(await scriptFailsWith(db, RUN)).toBe("ok");
    expect(await bodyHash("seller_recon_session(bigint,text,integer,integer)")).toBe(SESSION_0179);
    expect(await everything(db)).toBe(before);
  });

  it("the registration names the three files, the baselines and an unambiguous `erfuellt`", () => {
    const plan = JSON.parse(readFileSync("supabase/checks/migration-plans.json", "utf8")).migrationen["0179"];
    expect(plan).toMatchObject({ preflight: "0179_preflight.sql", lauf: "staging-0179.sql", postflight: "0179_postflight.sql",
      liefert: { "skyisles.base": 900, "skyisles.coll": 901 }, braucht: ["skyisles.base", "skyisles.coll"] });
    expect(plan.angewendet.sql).toBe("select to_regprocedure('public.sales_recon_ledger(bigint)') is not null as erfuellt");
  });
});
