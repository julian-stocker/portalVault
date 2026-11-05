/**
 * 0180 on real PostgreSQL (PGlite): only proven report values, only the
 * selected decisions, only with the preview's token.
 *
 *   deciding          manual refused; take_external only with proof; notes free
 *   the proof (T1-T5) a hand-built payload claims what the database refutes:
 *                     category, certainty, competitors, the reference, the
 *                     report value, the SkyIsles value, the kind; duplicates
 *                     and rivals of a `unique` reference
 *   unique            the reference yes — day and amounts no
 *   refunds, cancel   no amount on a refunded sale, nothing on a cancelled one
 *   preview & apply   several fields of one sale in one write, several sales,
 *   (T6-T11, T15-T18) stale sales, a second call, a changed selection, every
 *                     malformed or foreign token and selection, a failure in
 *                     the last sale, nothing silently reduced
 *   history (T12-T14) old manual, old uncertain and old applied decisions
 *   untouched (T16)   positions, stock, refunds
 *   rights (T17), the migration and its rollback (T19), the Staging package
 *
 * PGlite is ONE connection: two applies cannot race here. What can be shown
 * is that the second of two identical calls finds everything applied and
 * writes nothing, and that the apply takes its locks before it judges — the
 * lock itself is PostgreSQL's (`for update`), measured on Staging.
 */

import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { failsWith, migration, one, RECONCILIATION_MIGRATIONS, reconciliationWorld, scriptFailsWith, untouchable } from "./schema";
import {
  analyseSpecs, applySelection, applySession, decideOn, everything, findingOf, type FindingRow, type Json, matchByRef,
  previewSelection, readSession, seedSales, type Spec,
} from "./session-fixture";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const M0180 = "0180_sales_recon_selected_apply.sql";
const R0178 = readFileSync("supabase/rollback/R0178_sales_recon_without_comparison.sql", "utf8");
const R0180 = readFileSync("supabase/rollback/R0180_sales_recon_apply_without_selection.sql", "utf8");
const BEFORE_0180 = [...RECONCILIATION_MIGRATIONS, "0175_sales_recon_account_deletion.sql",
  "0176_sales_recon_validate_before_dedup.sql", "0178_sales_recon_comparison_and_pending.sql",
  "0179_sales_recon_ledger_proof.sql"] as const;
const WITH_0180 = [...BEFORE_0180, M0180] as const;

const OLD: Record<string, string> = {
  "seller_recon_decide(bigint,text,jsonb,text,jsonb,jsonb)": "2526d3a77ccf3153158182d0ecd391aa",
  "seller_recon_apply(bigint,integer)": "f8b1132c27ba1b18123f6c2548f9997c",
  "seller_recon_pending(bigint)": "51213fd88afb5441a487dc89bba2ac06",
};
const UNTOUCHED: Record<string, string> = {
  "seller_recon_session(bigint,text,integer,integer)": "5ed52447581cc895efc6a56f268c0da3",
  "sales_recon_ledger(bigint)": "07875fe3ba889fefab1c55dbe67005d9",
  "sales_recon_proven(jsonb,text,jsonb,boolean)": "b7b36ccd5efdd57e661808b62274df68",
  "sales_recon_pending_set(bigint)": "3228eb12e00d7982c5cad5c42ea6f773",
  "sales_recon_sale_values(bigint)": "4c4a01eb05adb6d439450063f04eada9",
  "seller_recon_create(jsonb)": "21fab5ff4ea2c7cb2550f3db821fce0f",
};
const HELPERS = ["sales_recon_allowed_0180(text)", "sales_recon_take_check(bigint)", "sales_recon_decision_problem(bigint,bigint)",
  "sales_recon_check_selection(bigint[])", "sales_recon_selection(bigint,bigint[])"];
const ENTRY = ["seller_recon_preview(bigint,bigint[])", "seller_recon_apply(bigint,bigint[],text)"];
const NEW_FNS = [...HELPERS, ...ENTRY];

/** The bodies 0180 writes, read from its own postcondition. */
const NEW_BODIES: Record<string, string> = Object.fromEntries(
  [...migration(M0180).split("do $post$")[1].matchAll(/\('([a-z_0-9]+\([^)]*\))', '([0-9a-f]{32})'\)/g)].map((m) => [m[1], m[2]]));

const D_MULTI = "50-00000-00001";   // deterministic: day, net and shipping differ
const D_REFUND = "50-00000-00002";  // deterministic, a refund stands
const D_CANCEL = "50-00000-00003";  // deterministic, cancelled
const U_EXACT = "50-00000-00004";   // unique, equal: only the reference is missing
const U_DEV = "50-00000-00005";     // unique, day and shipping differ
const PROB = "50-00000-00006";      // probable
const AMB_1 = "50-00000-00007";     // ambiguous, with AMB_2
const AMB_2 = "50-00000-00008";

const SPECS: Spec[] = [
  { ref: D_MULTI, sold: "2026-03-10", shipping: 4.99, lines: [{ character: "Eruptor", unit: 9 }],
    ledger: { sold: "2026-03-09", subtotal: 8, shipping: 5.49, pieces: ["Eruptor"], carriesRef: true } },
  { ref: D_REFUND, sold: "2026-03-12", lines: [{ character: "Zap", unit: 10 }],
    ledger: { sold: "2026-03-12", subtotal: 12, pieces: ["Zap"], refunds: [1], carriesRef: true } },
  { ref: D_CANCEL, sold: "2026-03-14", lines: [{ character: "Hex", unit: 7 }],
    ledger: { sold: "2026-03-13", subtotal: 7, pieces: ["Hex"], carriesRef: true, cancelled: true } },
  { ref: U_EXACT, sold: "2026-03-16", lines: [{ character: "Camo", unit: 6 }],
    ledger: { sold: "2026-03-16", subtotal: 6, pieces: ["Camo"] } },
  { ref: U_DEV, sold: "2026-03-18", shipping: 3.99, lines: [{ character: "Bash", unit: 11 }],
    ledger: { sold: "2026-03-17", subtotal: 11, shipping: 5.49, pieces: ["Bash"] } },
  { ref: PROB, sold: "2026-03-20", lines: [{ character: "Drobot", unit: 15 }],
    ledger: { sold: "2026-03-22", subtotal: 14, pieces: ["Drobot"] } },
  { ref: AMB_1, sold: "2026-03-24", lines: [{ character: "Gill Grunt", unit: 5 }],
    ledger: { sold: "2026-03-24", subtotal: 5, pieces: ["Gill Grunt"] } },
  { ref: AMB_2, sold: "2026-03-24", lines: [{ character: "Gill Grunt", unit: 5 }],
    ledger: { sold: "2026-03-24", subtotal: 5, pieces: ["Gill Grunt"] } },
];

let db: PGlite;
let saleOf: Map<string, number>;
let session: number;

const finding = (ref: string, field: string, s = session) => findingOf(db, s, ref, field);
const decide = (f: FindingRow, decision: string, manual: unknown = null, reason: string | null = null) =>
  decideOn(db, f, decision, manual, reason);
const preview = (ids: number[], s = session) => previewSelection(db, s, ids);
const apply = (ids: number[], token: string | null, s = session) => applySelection(db, s, ids, token);
const takeCheck = (f: FindingRow) => one<string | null>(db, `select public.sales_recon_take_check($1)`, [f.id]);
const bodyHash = (fn: string) => one<string | null>(db, `select md5(prosrc) from pg_proc where oid = to_regprocedure($1)`, [`public.${fn}`]);
const sale = (ref: string): Promise<Json> => one(db, `select to_jsonb(s) from public.sales s where id = $1`, [saleOf.get(ref)]);
const count = (table: string) => one<number>(db, `select count(*)::integer from public.${table}`);

/** Code and message of a failing statement — the message must never carry a value. */
async function refusal(sql: string, params: unknown[] = []): Promise<{ code: string; message: string }> {
  try {
    await db.query(sql, params);
    return { code: "ok", message: "" };
  } catch (error) {
    const e = error as { code?: string; message?: string };
    return { code: e.code ?? "?", message: e.message ?? "" };
  }
}
const applyRefusal = (ids: number[], token: string | null, s = session) =>
  refusal(`select public.seller_recon_apply($1, $2::bigint[], $3)`, [s, ids, token]);
const decideRefusal = (f: FindingRow, decision: string, manual: unknown = null, reason: string | null = null) =>
  refusal(`select public.seller_recon_decide($1, $2, $3::jsonb, $4, $5::jsonb, $6::jsonb)`,
    [f.id, decision, manual === null ? null : JSON.stringify(manual), reason, JSON.stringify(f.ledger_value), JSON.stringify(f.external_value)]);

/** Values of the report and of SkyIsles that must never appear in an error. */
const VALUES = [...SPECS.map((s) => s.ref as string), "Eruptor", "Camo", "Bash", "4.99", "5.49", "2026-03-1", "2026-03-2"];
function noValues(message: string) {
  for (const v of VALUES) expect(message).not.toContain(v);
}

/** A preview, and the apply bound to it. */
async function previewAndApply(ids: number[], s = session): Promise<Json> {
  const p = await preview(ids, s);
  expect(p.problems).toBe(0);
  expect(p.admissible).toBe(true);
  return apply(ids, p.token, s);
}

// ---------------------------------------------------------------------------
// Hand-built payloads: what a direct call of seller_recon_create could claim
// ---------------------------------------------------------------------------
type HandFinding = { key: string; field: string; kind: "deviation" | "addition"; ledger: unknown; external: unknown };
type Hand = {
  saleId: number; ref: string; sold: string; items: number; shipping?: number; total?: number; name?: string;
  category: string; certainty: string | null; competitors?: Json[]; findings: HandFinding[]; fingerprint: string;
};

async function handSession(h: Hand): Promise<number> {
  const updatedAt = await one<string>(db, `select to_jsonb(updated_at) #>> '{}' from public.sales where id = $1`, [h.saleId]);
  const shipping = h.shipping ?? 5.49;
  const file = `hand-${h.fingerprint}.csv`;
  const payload = {
    channel: "ebay", parser: "ebay-orders-report-de", parserVersion: 1,
    coverage: { coveredFrom: h.sold, coveredTo: h.sold, recordFirst: 1, recordLast: 1, chainComplete: true },
    summary: { categories: { [h.category]: 1 } },
    files: [{ fileName: file, fingerprint: h.fingerprint.repeat(64), footerCount: 1, orders: 1,
      firstSoldOn: h.sold, lastSoldOn: h.sold, recordFirst: 1, recordLast: 1 }],
    orders: [{ orderRef: h.ref, recordNo: 1, soldOn: h.sold, paidOn: null, shippedOn: null, itemsValue: h.items, shipping,
      total: h.total ?? Math.round((h.items + shipping) * 100) / 100, pieces: 1, combined: false, destinationCountry: "DE",
      shippingService: null, sourceFile: file,
      lines: [{ lineRef: "1", listingId: "1", title: "Testposition", variant: null, name: h.name ?? "Testfigur", quantity: 1,
        unitPrice: h.items, value: h.items }] }],
    matches: [{ orderRef: h.ref, saleId: h.saleId, saleUpdatedAt: updatedAt, category: h.category, certainty: h.certainty,
      score: 100, dateDelta: 0, competitors: h.competitors ?? [], reason: null,
      findings: h.findings.map((f) => ({ ...f, delta: null, causes: [] })) }],
  };
  return one<number>(db, `select public.seller_recon_create($1::jsonb)`, [JSON.stringify(payload)]);
}

/** One sale of its own for a hand-built payload: Spyro, 9.00 + 5.49, on 2026-05-05. */
async function ownSale(options: { ref?: string | null; isTest?: boolean } = {}): Promise<number> {
  const id = await one<number>(db, `insert into public.sales (channel, sold_at, items_subtotal, discount_amount, shipping_charged,
      source, external_order_ref, is_test) values ('ebay', '2026-05-05', 9, 0, 5.49, 'excel_order_2026', $1, $2) returning id`,
    [options.ref ?? null, options.isTest ?? false]);
  await db.query(`insert into public.sale_items (sale_id, position, raw_name) values ($1, 1, 'Spyro')`, [id]);
  return id;
}

const handFinding = async (s: number, field: string): Promise<FindingRow> => {
  const r = await db.query<FindingRow>(`select f.id, f.field, f.ledger_value, f.external_value from public.sales_recon_findings f
    join public.sales_recon_matches m on m.id = f.match_id where m.session_id = $1 and f.field = $2`, [s, field]);
  return r.rows[0];
};

afterEach(async () => {
  await db.close();
});

// ---------------------------------------------------------------------------
describe("with 0180", () => {
  beforeEach(async () => {
    db = await reconciliationWorld({ migrations: WITH_0180 });
    saleOf = await seedSales(db, SPECS);
    session = await analyseSpecs(db, SPECS);
  });

  it("the analysis gives the cases their categories, unchanged by 0180", async () => {
    const page = await readSession(db, session);
    const of = (ref: string) => matchByRef(page, ref);
    expect([D_MULTI, D_REFUND, D_CANCEL].map((r) => [of(r).category, of(r).certainty]))
      .toEqual([["deviating", "deterministic"], ["deviating", "deterministic"], ["deviating", "deterministic"]]);
    expect([of(U_EXACT).category, of(U_EXACT).certainty]).toEqual(["exact", "unique"]);
    expect([of(U_DEV).category, of(U_DEV).certainty]).toEqual(["deviating", "unique"]);
    expect([of(PROB).category, of(AMB_1).category, of(AMB_2).category]).toEqual(["probable", "ambiguous", "ambiguous"]);
  });

  // -------------------------------------------------------------------------
  describe("deciding", () => {
    it("manual is refused on every field — no value, no refund, no cancellation, no clarification", async () => {
      const before = await everything(db);
      for (const [ref, field, manual] of [
        [D_MULTI, "sold_on", { value: "2026-03-11" }], [D_MULTI, "items_net", { value: 1 }], [D_MULTI, "shipping", { value: 0 }],
        [D_REFUND, "total", { action: "refund", amount: 1, reason: "kulanz" }], [D_CANCEL, "total", { action: "cancel" }],
        [D_MULTI, "total", { action: "none" }],
      ] as const) {
        const r = await decideRefusal(await finding(ref, field), "manual", manual, "laut Bericht");
        expect(r.code, `${ref} ${field}`).toBe("23514");
        noValues(r.message);
      }
      expect(await everything(db)).toBe(before);
    });

    it("keep_ledger is a note on every finding, reason optional — also on uncertain pairs; defer as well", async () => {
      await decide(await finding(D_MULTI, "total"), "keep_ledger");
      await decide(await finding(PROB, "items_net"), "keep_ledger", null, "eigene Prüfung");
      await decide(await finding(AMB_1, "external_order_ref"), "keep_ledger");
      await decide(await finding(D_REFUND, "items_net"), "defer");
      expect(await count("sales_recon_decisions")).toBe(4);
      expect(await count("sales_recon_applications")).toBe(0);
    });

    it("a decision carries no value of its own", async () => {
      expect((await decideRefusal(await finding(D_MULTI, "sold_on"), "keep_ledger", { value: "2026-03-10" })).code).toBe("23514");
    });

    it("take_external only where the database proves it", async () => {
      const cases: [string, string, string | null][] = [
        [D_MULTI, "sold_on", null], [D_MULTI, "items_net", null], [D_MULTI, "shipping", null],
        [U_EXACT, "external_order_ref", null], [U_DEV, "external_order_ref", null],
        [U_DEV, "sold_on", "unique_ref_only"], [U_DEV, "shipping", "unique_ref_only"],
        [D_REFUND, "items_net", "refunded"], [D_CANCEL, "sold_on", "cancelled"],
        [PROB, "items_net", "uncertain"], [PROB, "external_order_ref", "uncertain"],
        [AMB_1, "external_order_ref", "uncertain"], [D_MULTI, "total", "field_not_takeable"],
      ];
      for (const [ref, field, code] of cases) {
        const f = await finding(ref, field);
        expect(await takeCheck(f), `${ref} ${field}`).toBe(code);
        const r = await decideRefusal(f, "take_external");
        expect(r.code, `${ref} ${field}`).toBe(code === null ? "ok" : "23514");
        noValues(r.message);
      }
    });

    it("a sale changed since the analysis: PT409, as before", async () => {
      await db.query(`select public.seller_update_sale(p_id => $1, p_note => 'anders')`, [saleOf.get(D_MULTI)]);
      expect((await decideRefusal(await finding(D_MULTI, "sold_on"), "take_external")).code).toBe("PT409");
      expect((await decideRefusal(await finding(D_MULTI, "sold_on"), "keep_ledger")).code).toBe("PT409");
    });
  });

  // -------------------------------------------------------------------------
  describe("the proof: a hand-built payload claims what the database refutes", () => {
    const sold = (): HandFinding[] => [
      { key: "sold_on", field: "sold_on", kind: "deviation", ledger: "2026-05-05", external: "2026-05-06" }];

    it.each([
      ["exact + probable", "exact", "probable", [], "uncertain"],
      ["exact + ambiguous", "exact", "ambiguous", [], "uncertain"],
      ["probable + probable", "probable", "probable", [], "uncertain"],
      ["deterministic with a competitor", "deviating", "deterministic", [{ orderRef: "60-0", saleId: 1, score: 99 }], "competitors"],
    ])("T1 %s → %s", async (_, category, certainty, competitors, code) => {
      const sid = await ownSale({ ref: "60-00000-00001" });
      const s = await handSession({ saleId: sid, ref: "60-00000-00001", sold: "2026-05-06", items: 9, category, certainty,
        competitors, findings: sold(), fingerprint: "c" });
      const f = await handFinding(s, "sold_on");
      expect(await takeCheck(f)).toBe(code);
      expect((await decideRefusal(f, "take_external")).code).toBe("23514");
    });

    it("T2 deterministic, but the sale carries no or another number → ref_mismatch", async () => {
      for (const [ref, fp] of [[null, "d"], ["60-00000-09999", "e"]] as const) {
        const sid = await ownSale({ ref });
        const s = await handSession({ saleId: sid, ref: "60-00000-00002", sold: "2026-05-06", items: 9, category: "deviating",
          certainty: "deterministic", findings: sold(), fingerprint: fp });
        expect(await takeCheck(await handFinding(s, "sold_on"))).toBe("ref_mismatch");
      }
    });

    it("T3 a report value the stored order does not hold → report_mismatch", async () => {
      const sid = await ownSale({ ref: "60-00000-00003" });
      const s = await handSession({ saleId: sid, ref: "60-00000-00003", sold: "2026-05-06", items: 12, category: "deviating",
        certainty: "deterministic", fingerprint: "f", findings: [
          { key: "sold_on", field: "sold_on", kind: "deviation", ledger: "2026-05-05", external: "2026-05-01" },
          { key: "items_net", field: "items_net", kind: "deviation", ledger: 9, external: 99.99 },
          { key: "shipping", field: "shipping", kind: "deviation", ledger: 5.49, external: "0" },
        ] });
      for (const field of ["sold_on", "items_net", "shipping"]) {
        expect(await takeCheck(await handFinding(s, field)), field).toBe("report_mismatch");
      }
    });

    it("T4 a SkyIsles value the sale does not hold → ledger_mismatch; equal values → no_difference", async () => {
      const sid = await ownSale({ ref: "60-00000-00004" });
      const s = await handSession({ saleId: sid, ref: "60-00000-00004", sold: "2026-05-06", items: 12, shipping: 5.49,
        category: "deviating", certainty: "deterministic", fingerprint: "a", findings: [
          { key: "items_net", field: "items_net", kind: "deviation", ledger: 1, external: 12 },
          { key: "shipping", field: "shipping", kind: "deviation", ledger: 5.49, external: 5.49 },
          { key: "sold_on", field: "sold_on", kind: "addition", ledger: "2026-05-05", external: "2026-05-06" },
        ] });
      expect(await takeCheck(await handFinding(s, "items_net"))).toBe("ledger_mismatch");
      expect(await takeCheck(await handFinding(s, "shipping"))).toBe("no_difference");
      expect(await takeCheck(await handFinding(s, "sold_on"))).toBe("finding_kind");
    });

    it("a test sale is never taken over", async () => {
      const sid = await ownSale({ ref: "60-00000-00005", isTest: true });
      const s = await handSession({ saleId: sid, ref: "60-00000-00005", sold: "2026-05-06", items: 9, category: "deviating",
        certainty: "deterministic", findings: sold(), fingerprint: "1" });
      expect(await takeCheck(await handFinding(s, "sold_on"))).toBe("test_sale");
    });

    it("unique: outside ±3 days → window; a number already carried by the sale → ref_present", async () => {
      const far = await ownSale();
      const s1 = await handSession({ saleId: far, ref: "60-00000-00006", sold: "2026-05-09", items: 9, category: "exact",
        certainty: "unique", fingerprint: "2", findings: [
          { key: "external_order_ref", field: "external_order_ref", kind: "addition", ledger: null, external: "60-00000-00006" }] });
      expect(await takeCheck(await handFinding(s1, "external_order_ref"))).toBe("window");
      const own = await ownSale({ ref: "60-00000-00007" });
      const s2 = await handSession({ saleId: own, ref: "60-00000-00007", sold: "2026-05-06", items: 9, category: "exact",
        certainty: "unique", fingerprint: "3", findings: [
          { key: "external_order_ref", field: "external_order_ref", kind: "addition", ledger: null, external: "60-00000-00007" }] });
      expect(await takeCheck(await handFinding(s2, "external_order_ref"))).toBe("ref_present");
    });
  });

  // -------------------------------------------------------------------------
  describe("the reference (unique)", () => {
    it("T6 only the reference is written — not one other column of the sale", async () => {
      const before = await sale(U_EXACT);
      const auditBefore = await count("orderbook_audit");
      const id = await decide(await finding(U_EXACT, "external_order_ref"), "take_external");
      const result = await previewAndApply([id]);
      expect(result).toMatchObject({ applied: 1, sales: 1 });
      const after = await sale(U_EXACT);
      const strip = (s: Json) => Object.fromEntries(Object.entries(s)
        .filter(([k]) => !["external_order_ref", "updated_at", "updated_by"].includes(k)));
      expect(strip(after)).toEqual(strip(before));
      expect([before.external_order_ref, after.external_order_ref]).toEqual([null, U_EXACT]);
      const audit = await db.query<{ field: string; old_value: string | null; new_value: string }>(
        `select field, old_value, new_value from public.orderbook_audit where id > $1 order by id`, [auditBefore]);
      expect(audit.rows).toEqual([{ field: "external_order_ref", old_value: null, new_value: U_EXACT }]);
      const app = await db.query(`select field, outcome, old_value, new_value from public.sales_recon_applications`);
      expect(app.rows).toEqual([{ field: "external_order_ref", outcome: "applied", old_value: null, new_value: U_EXACT }]);
    });

    it("unique deviating: the reference yes, the day and the shipping not — and a new analysis makes them deterministic", async () => {
      const id = await decide(await finding(U_DEV, "external_order_ref"), "take_external");
      await previewAndApply([id]);
      expect((await sale(U_DEV)).external_order_ref).toBe(U_DEV);
      expect((await sale(U_DEV)).sold_at).toBe("2026-03-17");
      await db.query(`select public.seller_recon_close($1)`, [session]);
      const again = await analyseSpecs(db, SPECS, "7");
      expect(matchByRef(await readSession(db, again), U_DEV)).toMatchObject({ category: "deviating", certainty: "deterministic" });
      const day = await decide(await finding(U_DEV, "sold_on", again), "take_external");
      const ship = await decide(await finding(U_DEV, "shipping", again), "take_external");
      expect(await previewAndApply([day, ship], again)).toMatchObject({ applied: 2, sales: 1 });
      expect(await sale(U_DEV)).toMatchObject({ sold_at: "2026-03-18", shipping_charged: 3.99 });
    });

    it("duplicate order numbers: another non-test sale carrying it → ref_taken; a test sale does not count", async () => {
      const f = await finding(U_EXACT, "external_order_ref");
      const id = await decide(f, "take_external");
      const other = await ownSale({ ref: U_EXACT, isTest: true });
      expect(await takeCheck(f)).toBeNull();
      await db.query(`update public.sales set is_test = false where id = $1`, [other]);
      expect(await takeCheck(f)).toBe("ref_taken");
      const p = await preview([id]);
      expect(p.changes[0].problem).toBe("ref_taken");
      const r = await applyRefusal([id], p.token);
      expect(r.code).toBe("23514");
      noValues(r.message);
      expect((await sale(U_EXACT)).external_order_ref).toBeNull();
    });

    it("a rival the score margin let through — an unpaired sale with the same figure in the window — is caught", async () => {
      const specs: Spec[] = [
        { ref: "70-00000-00001", sold: "2026-08-10", lines: [{ character: "Spyro", unit: 6 }],
          ledger: { sold: "2026-08-10", subtotal: 6, pieces: ["Spyro"] } },
        { ref: "70-00000-00002", sold: "2026-08-20", lines: [{ character: "Zook", unit: 4 }],
          ledger: { sold: "2026-08-20", subtotal: 4, pieces: ["Zook"] } },
        // Spyro again, three days later, another price: no competitor in match.ts, a rival here.
        { ref: null, sold: "2026-08-13", lines: [], ledger: { sold: "2026-08-13", subtotal: 9, pieces: ["Spyro"] } },
      ];
      const ids = await seedSales(db, specs);
      const s = await analyseSpecs(db, specs, "8");
      const m = matchByRef(await readSession(db, s), "70-00000-00001");
      expect([m.category, m.certainty, m.competitors]).toEqual(["exact", "unique", []]);
      expect(await takeCheck(await finding("70-00000-00001", "external_order_ref", s))).toBe("rival_sale");
      expect(await takeCheck(await finding("70-00000-00002", "external_order_ref", s))).toBeNull();
      expect(ids.size).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  describe("preview and apply", () => {
    it("several fields of one sale: ONE write, every application, the version refreshed, 0179 still proves", async () => {
      const ids = [await decide(await finding(D_MULTI, "sold_on"), "take_external"),
        await decide(await finding(D_MULTI, "items_net"), "take_external"),
        await decide(await finding(D_MULTI, "shipping"), "take_external")];
      const p = await preview(ids);
      expect(p).toMatchObject({ count: 3, problems: 0, admissible: true, staleSales: 0 });
      expect(p.changes.map((c: Json) => c.target)).toEqual([
        { soldOn: "2026-03-10" }, { itemsNet: 9, itemsSubtotal: 9, discount: 0 }, { shipping: 4.99 }]);
      const auditBefore = await count("orderbook_audit");
      expect(await apply(ids, p.token)).toMatchObject({ applied: 3, sales: 1 });
      expect(await sale(D_MULTI)).toMatchObject({ sold_at: "2026-03-10", items_subtotal: 9, shipping_charged: 4.99, discount_amount: 0 });
      const audit = await db.query<{ field: string }>(`select field from public.orderbook_audit where id > $1 order by id`, [auditBefore]);
      expect(audit.rows.map((r) => r.field)).toEqual(["sold_at", "items_subtotal", "shipping_charged"]);
      const apps = await db.query<{ field: string; old_value: string; new_value: string }>(
        `select field, old_value, new_value from public.sales_recon_applications order by id`);
      expect(apps.rows).toEqual([
        { field: "sold_on", old_value: "2026-03-09", new_value: "2026-03-10" },
        { field: "items_net", old_value: "items_subtotal 8.00 (net 8.00)", new_value: "items_subtotal 9.00 (net 9.00)" },
        { field: "shipping", old_value: "5.49", new_value: "4.99" },
      ]);
      expect(await one(db, `select count(distinct applied_at)::integer from public.sales_recon_applications`)).toBe(1);
      const m = matchByRef(await readSession(db, session), D_MULTI);
      expect(m.sale.stale).toBe(false);
      expect(m.ledger.state).toBe("applied");
      expect(m.ledger.atAnalysis).toMatchObject({
        soldOn: { value: "2026-03-09", basis: "stored" }, itemsNet: { value: 8, basis: "stored" }, shipping: { value: 5.49, basis: "stored" } });
    });

    it("two sales in one apply; a second round on the same sale is not its own conflict, a foreign change between rounds is", async () => {
      const a = await decide(await finding(D_MULTI, "sold_on"), "take_external");
      const b = await decide(await finding(U_EXACT, "external_order_ref"), "take_external");
      expect(await previewAndApply([b, a])).toMatchObject({ applied: 2, sales: 2 });
      const c = await decide(await finding(D_MULTI, "shipping"), "take_external");
      expect(await previewAndApply([c])).toMatchObject({ applied: 1, sales: 1 });
      expect(await sale(D_MULTI)).toMatchObject({ sold_at: "2026-03-10", shipping_charged: 4.99, items_subtotal: 8 });
      // A REAL change from elsewhere between two rounds is still caught.
      const d = await decide(await finding(D_MULTI, "items_net"), "take_external");
      const p = await preview([d]);
      await db.query(`select public.seller_update_sale(p_id => $1, p_note => 'von Hand')`, [saleOf.get(D_MULTI)]);
      const before = await everything(db);
      expect((await applyRefusal([d], p.token)).code).toBe("PT409");
      expect(await everything(db)).toBe(before);
    });

    it("T7 a sale changed between preview and apply — PT409, nothing written", async () => {
      const ids = [await decide(await finding(D_MULTI, "sold_on"), "take_external"),
        await decide(await finding(U_EXACT, "external_order_ref"), "take_external")];
      const p = await preview(ids);
      await db.query(`select public.seller_update_sale(p_id => $1, p_note => 'zwischendurch')`, [saleOf.get(U_EXACT)]);
      const before = await everything(db);
      const r = await applyRefusal(ids, p.token);
      expect(r.code).toBe("PT409");
      expect(r.message).toContain("stale");
      noValues(r.message);
      expect(await everything(db)).toBe(before);
      // A fresh preview says so, and gives no admissible token.
      expect(await preview(ids)).toMatchObject({ admissible: false, problems: 1, staleSales: 1 });
    });

    it("T8/T9 the same apply twice: the second writes nothing — one application per decision", async () => {
      const ids = [await decide(await finding(D_MULTI, "sold_on"), "take_external")];
      const p = await preview(ids);
      await apply(ids, p.token);
      const after = await everything(db);
      const r = await applyRefusal(ids, p.token);
      expect(r.code).toBe("PT409");
      expect(r.message).toContain("already_applied");
      expect(await everything(db)).toBe(after);
      expect(await count("sales_recon_applications")).toBe(1);
      expect(await preview(ids)).toMatchObject({ admissible: false, changes: [{ problem: "already_applied" }] });
    });

    it("T10 another selection under the old token, a newer decision — refused; the order of the list does not matter", async () => {
      const a = await decide(await finding(D_MULTI, "sold_on"), "take_external");
      const b = await decide(await finding(D_MULTI, "shipping"), "take_external");
      const c = await decide(await finding(U_EXACT, "external_order_ref"), "take_external");
      const p = await preview([a, b]);
      const before = await everything(db);
      expect((await applyRefusal([a], p.token)).code).toBe("PT409");
      expect((await applyRefusal([a, b, c], p.token)).code).toBe("PT409");
      expect(await everything(db)).toBe(before);
      // A newer decision for the same finding makes the selected one stale.
      const newer = await decide(await finding(D_MULTI, "shipping"), "take_external");
      const r = await applyRefusal([a, b], p.token);
      expect([r.code, r.message.includes("not_latest")]).toEqual(["PT409", true]);
      const q = await preview([newer, a]);
      expect(await apply([a, newer], q.token)).toMatchObject({ applied: 2 });
    });

    it("T11 tokens and selections: malformed, foreign, empty, doubled, too long — refused, nothing written", async () => {
      const a = await decide(await finding(D_MULTI, "sold_on"), "take_external");
      const p = await preview([a]);
      for (const token of [null, "", "abc", p.token.toUpperCase(), `${p.token}0`]) {
        expect((await applyRefusal([a], token)).code, String(token)).toBe("23514");
      }
      expect((await applyRefusal([a], "0".repeat(64))).code).toBe("PT409");
      for (const ids of [[], [a, a], Array.from({ length: 501 }, (_, i) => i + 1)]) {
        expect((await applyRefusal(ids, p.token)).code).toBe("23514");
        expect(await failsWith(db, `select public.seller_recon_preview($1, $2::bigint[])`, [session, ids])).toBe("23514");
      }
      expect(await failsWith(db, `select public.seller_recon_apply($1, array[$2, null]::bigint[], $3)`, [session, a, p.token])).toBe("23514");
      expect(await failsWith(db, `select public.seller_recon_apply($1, null::bigint[], $2)`, [session, p.token])).toBe("23514");
      // The token of another session, and a decision of another session.
      const other = await analyseSpecs(db, SPECS.slice(0, 1), "9");
      const foreign = await decide(await finding(D_MULTI, "sold_on", other), "take_external");
      const q = await preview([foreign], other);
      expect((await applyRefusal([foreign], q.token)).code).toBe("23514");
      expect((await preview([foreign])).changes).toEqual([{ decisionId: foreign, problem: "unknown_decision", findingId: null,
        matchId: null, saleId: null, orderRef: null, field: null, decision: null, old: null, target: null,
        version: { analysed: null, current: null } }]);
      expect((await applyRefusal([a], q.token)).code).toBe("PT409");
      expect((await applyRefusal([987654], p.token)).code).toBe("23514");
      expect(await count("sales_recon_applications")).toBe(0);
      expect((await sale(D_MULTI)).sold_at).toBe("2026-03-09");
    });

    it("one inadmissible decision in the selection: nothing is applied — never silently reduced", async () => {
      const good = await decide(await finding(D_MULTI, "sold_on"), "take_external");
      const note = await decide(await finding(D_MULTI, "total"), "keep_ledger");
      const p = await preview([good, note]);
      expect(p).toMatchObject({ count: 2, problems: 1, admissible: false });
      expect(p.changes.map((c: Json) => c.problem)).toEqual([null, "no_change"]);
      const before = await everything(db);
      const r = await applyRefusal([good, note], p.token);
      expect(r.code).toBe("23514");
      expect(r.message).toContain("no_change");
      expect(await everything(db)).toBe(before);
    });

    it("T18 a failure in the LAST sale takes back the first one, too", async () => {
      const first = await decide(await finding(D_MULTI, "sold_on"), "take_external");
      const last = await decide(await finding(U_EXACT, "external_order_ref"), "take_external");
      expect(saleOf.get(U_EXACT)!).toBeGreaterThan(saleOf.get(D_MULTI)!);
      await db.exec(`create function public.test_refuse_last() returns trigger language plpgsql as $$
        begin if new.id = ${saleOf.get(U_EXACT)} then raise exception 'injected' using errcode = 'P0001'; end if; return new; end $$;
        create trigger test_refuse_last before update on public.sales for each row execute function public.test_refuse_last();`);
      const p = await preview([first, last]);
      const before = await everything(db);
      expect((await applyRefusal([first, last], p.token)).code).toBe("P0001");
      expect(await everything(db)).toBe(before);
      expect((await sale(D_MULTI)).sold_at).toBe("2026-03-09");
    });

    it("T15 keep_ledger and defer are never applied; T16 positions, stock and refunds never move", async () => {
      const keep = await decide(await finding(D_MULTI, "sold_on"), "keep_ledger");
      const later = await decide(await finding(D_MULTI, "shipping"), "defer");
      expect((await preview([keep, later])).changes.map((c: Json) => c.problem)).toEqual(["no_change", "no_change"]);
      const untouched = await untouchable(db);
      const refunds = await one<string>(db, `select md5(coalesce(string_agg(to_jsonb(r)::text, ';' order by r.id), '')) from public.sale_refunds r`);
      const take = [await decide(await finding(D_MULTI, "items_net"), "take_external"),
        await decide(await finding(U_EXACT, "external_order_ref"), "take_external"),
        await decide(await finding(U_DEV, "external_order_ref"), "take_external")];
      await previewAndApply(take);
      expect(await untouchable(db)).toBe(untouched);
      expect(await one<string>(db, `select md5(coalesce(string_agg(to_jsonb(r)::text, ';' order by r.id), '')) from public.sale_refunds r`)).toBe(refunds);
      expect(await count("sales_recon_applications")).toBe(3);
    });

    it("the account deletion contract of 0175 holds for what 0180 wrote", async () => {
      const a = await decide(await finding(D_MULTI, "sold_on"), "take_external");
      await previewAndApply([a]);
      const keep = await one<string>(db, `select md5(string_agg((to_jsonb(x) - 'applied_by')::text, ';' order by x.id)) from public.sales_recon_applications x`);
      expect(await failsWith(db, `delete from auth.users`)).toBe("ok");
      expect(await one(db, `select count(*)::integer from public.sales_recon_applications where applied_by is not null`)).toBe(0);
      expect(await one<string>(db, `select md5(string_agg((to_jsonb(x) - 'applied_by')::text, ';' order by x.id)) from public.sales_recon_applications x`)).toBe(keep);
    });

    it("a closed session: the preview says so, the apply refuses", async () => {
      const a = await decide(await finding(D_MULTI, "sold_on"), "take_external");
      const p = await preview([a]);
      await db.query(`select public.seller_recon_close($1)`, [session]);
      expect(await preview([a])).toMatchObject({ sessionOpen: false, admissible: false, token: null, count: 0 });
      expect((await applyRefusal([a], p.token)).code).toBe("23001");
    });

    it("pending: every open decision with the reason 0180 refuses it", async () => {
      const a = await decide(await finding(D_MULTI, "sold_on"), "take_external");
      const pend = await one<Json>(db, `select public.seller_recon_pending($1)`, [session]);
      expect(pend).toMatchObject({ sessionOpen: true, count: 1, admissible: 1, changes: [{ decisionId: a, problem: null }] });
      expect(Object.keys(pend).sort()).toEqual(["admissible", "changes", "count", "sessionId", "sessionOpen", "staleSales", "state", "token"]);
    });
  });

  // -------------------------------------------------------------------------
  describe("rights (T17)", () => {
    it("the old apply: no client right, and it refuses even its owner", async () => {
      for (const role of ["authenticated", "anon"]) {
        expect(await one(db, `select has_function_privilege($1, 'public.seller_recon_apply(bigint,integer)', 'execute')`, [role])).toBe(false);
      }
      await decide(await finding(D_MULTI, "sold_on"), "take_external");
      const before = await everything(db);
      expect(await failsWith(db, `select public.seller_recon_apply($1, 1)`, [session])).toBe("0A000");
      expect(await everything(db)).toBe(before);
    });

    it("preview and apply: authenticated only; the helpers: nobody; the gate holds", async () => {
      for (const fn of ENTRY) {
        expect(await one(db, `select has_function_privilege('authenticated', $1, 'execute')`, [`public.${fn}`])).toBe(true);
        expect(await one(db, `select has_function_privilege('anon', $1, 'execute')`, [`public.${fn}`])).toBe(false);
      }
      for (const fn of HELPERS) {
        for (const role of ["authenticated", "anon"]) {
          expect(await one(db, `select has_function_privilege($1, $2, 'execute')`, [role, `public.${fn}`]), `${role} ${fn}`).toBe(false);
        }
      }
      const a = await decide(await finding(D_MULTI, "sold_on"), "take_external");
      const p = await preview([a]);
      await db.query(`update public.test_identity set operator = false`);
      expect(await failsWith(db, `select public.seller_recon_preview($1, $2::bigint[])`, [session, [a]])).toBe("42501");
      expect((await applyRefusal([a], p.token)).code).toBe("42501");
      expect(await failsWith(db, `select public.seller_recon_apply($1, 1)`, [session])).toBe("42501");
    });

    it("every changed or new entry point: security definer with one empty search_path; every untouched body as it was", async () => {
      for (const fn of [...NEW_FNS.filter((f) => f !== "sales_recon_allowed_0180(text)" && f !== "sales_recon_check_selection(bigint[])"),
        ...Object.keys(OLD)]) {
        const r = await one<Json>(db, `select jsonb_build_object('definer', prosecdef, 'config', proconfig) from pg_proc where oid = to_regprocedure($1)`,
          [`public.${fn}`]);
        expect(r.definer, fn).toBe(true);
        expect(r.config.filter((c: string) => c.startsWith("search_path=")), fn).toEqual(['search_path=""']);
      }
      for (const [fn, hash] of Object.entries(UNTOUCHED)) expect(await bodyHash(fn), fn).toBe(hash);
      for (const fn of [...NEW_FNS, ...Object.keys(OLD)]) expect(await bodyHash(fn), fn).toBe(NEW_BODIES[fn]);
    });
  });
});

// ---------------------------------------------------------------------------
describe("history: decisions taken before 0180 (T12-T14)", () => {
  beforeEach(async () => {
    db = await reconciliationWorld({ migrations: BEFORE_0180 });
    saleOf = await seedSales(db, SPECS);
    session = await analyseSpecs(db, SPECS);
  });

  it("old manual, old uncertain and old applied decisions: readable, never executable — and the applied ones stay", async () => {
    // Applied before 0180, through the old apply.
    await decide(await finding(D_MULTI, "shipping"), "take_external");
    await applySession(db, session, 1);
    const appliedBefore = await one<string>(db, `select md5(string_agg(to_jsonb(a)::text, ';' order by a.id)) from public.sales_recon_applications a`);
    // Pending before 0180: every kind the old rules allowed.
    const manualDay = await decide(await finding(D_MULTI, "sold_on"), "manual", { value: "2026-03-11" });
    const manualRefund = await decide(await finding(D_REFUND, "total"), "manual", { action: "refund", amount: 1, reason: "kulanz" }, "laut eBay");
    const probable = await decide(await finding(PROB, "items_net"), "take_external");
    const uniqueDay = await decide(await finding(U_DEV, "sold_on"), "take_external");
    const ambiguous = await decide(await finding(AMB_1, "external_order_ref"), "take_external");
    const cancelled = await decide(await finding(D_CANCEL, "sold_on"), "take_external");
    const refunded = await decide(await finding(D_REFUND, "items_net"), "take_external");
    const good = await decide(await finding(D_MULTI, "items_net"), "take_external");
    const readBefore = await readSession(db, session);

    expect(await scriptFailsWith(db, migration(M0180))).toBe("ok");

    expect(await readSession(db, session)).toEqual(readBefore);
    const pend = await one<Json>(db, `select public.seller_recon_pending($1)`, [session]);
    const problems = Object.fromEntries(pend.changes.map((c: Json) => [c.decisionId, c.problem]));
    expect(problems).toEqual({ [manualDay]: "manual", [manualRefund]: "manual", [probable]: "uncertain",
      [uniqueDay]: "unique_ref_only", [ambiguous]: "uncertain", [cancelled]: "cancelled", [refunded]: "refunded", [good]: null });
    expect(pend.admissible).toBe(1);

    const refundsBefore = await count("sale_refunds");
    for (const bad of [manualDay, manualRefund, probable, uniqueDay, ambiguous, cancelled, refunded]) {
      const p = await preview([good, bad]);
      expect(p.admissible).toBe(false);
      expect((await applyRefusal([good, bad], p.token)).code).toBe("23514");
    }
    expect(await previewAndApply([good])).toMatchObject({ applied: 1 });
    expect(await count("sale_refunds")).toBe(refundsBefore);
    expect(await one<string>(db, `select md5(string_agg(to_jsonb(a)::text, ';' order by a.id)) from public.sales_recon_applications a where a.id <= 1`))
      .toBe(appliedBefore);
    // The decision applied before 0180 is not applied again.
    const firstDecision = await one<number>(db, `select decision_id from public.sales_recon_applications order by id limit 1`);
    expect((await preview([firstDecision])).changes[0].problem).toBe("already_applied");
  });
});

// ---------------------------------------------------------------------------
describe("the migration and its rollback (T19)", () => {
  beforeEach(async () => {
    db = await reconciliationWorld({ migrations: BEFORE_0180 });
  });

  it("runs once, bounces off a second run, refuses a foreign decide", async () => {
    expect(await scriptFailsWith(db, migration(M0180))).toBe("ok");
    expect(await scriptFailsWith(db, migration(M0180))).toBe("P0001");
    const other = await reconciliationWorld({ migrations: BEFORE_0180 });
    try {
      await other.exec(`create or replace function public.seller_recon_decide(
        p_finding_id bigint, p_decision text, p_manual_value jsonb, p_reason text, p_shown_ledger jsonb, p_shown_external jsonb)
        returns bigint language plpgsql volatile security definer set search_path = '' as $$ begin return 0; end $$;`);
      expect(await scriptFailsWith(other, migration(M0180))).toBe("P0001");
      expect(await one(other, `select to_regprocedure('public.seller_recon_preview(bigint,bigint[])')`)).toBeNull();
    } finally {
      await other.close();
    }
  });

  it("needs 0179", async () => {
    const bare = await reconciliationWorld({ migrations: BEFORE_0180.slice(0, -1) });
    try {
      expect(await scriptFailsWith(bare, migration(M0180))).toBe("P0001");
    } finally {
      await bare.close();
    }
  });

  it("inside an aborted transaction it leaves the old bodies and rights and no new function", async () => {
    expect(await scriptFailsWith(db, `begin;\n${migration(M0180)}\nselect 1/0;\ncommit;`)).toBe("22012");
    for (const [fn, hash] of Object.entries(OLD)) expect(await bodyHash(fn), fn).toBe(hash);
    for (const fn of NEW_FNS) expect(await one(db, `select to_regprocedure($1)`, [`public.${fn}`])).toBeNull();
    expect(await one(db, `select has_function_privilege('authenticated', 'public.seller_recon_apply(bigint,integer)', 'execute')`)).toBe(true);
  });

  it("contains no data statement outside its function bodies", () => {
    const sql = migration(M0180).replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\$\$[\s\S]*?\$\$/g, "$$ $$");
    expect(sql).not.toMatch(/\b(insert\s+into|update\s+public\.|delete\s+from|truncate|alter\s+table|drop\s+table|create\s+table)\b/i);
    expect(sql.match(/\bgrant\s+execute\s+on\s+function\s+public\.\S+/gi)).toEqual([
      "grant execute on function public.seller_recon_preview(bigint,",
      "grant execute on function public.seller_recon_apply(bigint,",
    ]);
  });

  it("R0180: the old bodies and rights again, every row kept, idempotent, refuses a third version", async () => {
    saleOf = await seedSales(db, SPECS);
    session = await analyseSpecs(db, SPECS);
    expect(await scriptFailsWith(db, migration(M0180))).toBe("ok");
    const a = await decide(await finding(D_MULTI, "sold_on"), "take_external");
    await previewAndApply([a]);
    const stored = await everything(db);
    expect(await scriptFailsWith(db, R0180)).toBe("ok");
    for (const [fn, hash] of Object.entries(OLD)) expect(await bodyHash(fn), fn).toBe(hash);
    for (const fn of NEW_FNS) expect(await one(db, `select to_regprocedure($1)`, [`public.${fn}`])).toBeNull();
    expect(await one(db, `select has_function_privilege('authenticated', 'public.seller_recon_apply(bigint,integer)', 'execute')`)).toBe(true);
    expect(await everything(db)).toBe(stored);
    expect(await scriptFailsWith(db, R0180)).toBe("ok");
    await db.exec(`create or replace function public.seller_recon_pending(p_session_id bigint)
      returns jsonb language plpgsql stable security definer set search_path = '' as $$ begin return '{}'; end $$;`);
    expect(await scriptFailsWith(db, R0180)).toBe("P0001");
  });

  it("R0180 refuses a later version of a 0180 function and leaves everything standing", async () => {
    expect(await scriptFailsWith(db, migration(M0180))).toBe("ok");
    await db.exec(`create or replace function public.sales_recon_take_check(p_finding_id bigint)
      returns text language plpgsql stable security definer set search_path = '' as $$ begin return null; end $$;`);
    expect(await scriptFailsWith(db, R0180)).toBe("P0001");
    expect(await bodyHash("seller_recon_decide(bigint,text,jsonb,text,jsonb,jsonb)")).toBe(NEW_BODIES["seller_recon_decide(bigint,text,jsonb,text,jsonb,jsonb)"]);
    expect(await one(db, `select to_regprocedure('public.seller_recon_preview(bigint,bigint[])')`)).not.toBeNull();
  });

  it("R0178 refuses while 0180 stands — 0180 goes back first", async () => {
    expect(await scriptFailsWith(db, migration(M0180))).toBe("ok");
    expect(await scriptFailsWith(db, R0178)).toBe("P0001");
    expect(await scriptFailsWith(db, R0180)).toBe("ok");
  });
});

// ---------------------------------------------------------------------------
// The Staging package
// ---------------------------------------------------------------------------
const PRE = readFileSync("supabase/checks/0180_preflight.sql", "utf8");
const POST = readFileSync("supabase/checks/0180_postflight.sql", "utf8");
const RUN = readFileSync("supabase/operations/staging-0180.sql", "utf8");

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

describe("preflight, postflight and run file of 0180", () => {
  beforeEach(async () => {
    db = await reconciliationWorld({ migrations: BEFORE_0180 });
    await db.exec(COLLECTION);
    saleOf = await seedSales(db, SPECS);
    session = await analyseSpecs(db, SPECS);
    await decide(await finding(D_MULTI, "shipping"), "take_external");
    await applySession(db, session, 1);
  });

  it("preflight holds before, postflight after; 131-153 = 231-253", async () => {
    const pre = await rows(PRE_ROWS);
    expect(pre.filter((r) => r.ok === false)).toEqual([]);
    expect(pre.filter((r) => r.erwartet !== null).map((r) => r.nr)).toEqual([101, 102, 103, 104, 105, 106, 107, 108, 109, 111]);
    expect(await scriptFailsWith(db, migration(M0180))).toBe("ok");
    expect((await rows(PRE_ROWS)).filter((r) => r.ok === false).map((r) => r.nr)).toEqual([101, 102, 103, 108, 111]);
    const post = await rows(POST_ROWS);
    expect(post.filter((r) => r.ok === false)).toEqual([]);
    expect(post.filter((r) => r.erwartet !== null).length).toBe(22);
    const info = (list: CheckRow[], base: number) =>
      Object.fromEntries(list.filter((r) => r.nr >= base + 31 && r.nr <= base + 53).map((r) => [r.nr - base, r.befund]));
    expect(Object.keys(info(pre, 100))).toHaveLength(16);
    expect(info(post, 200)).toEqual(info(pre, 100));
  });

  it("the postflight sees a moved right — on the old apply and on a helper", async () => {
    expect(await scriptFailsWith(db, migration(M0180))).toBe("ok");
    await db.exec(`grant execute on function public.seller_recon_apply(bigint, integer) to authenticated`);
    await db.exec(`grant execute on function public.sales_recon_take_check(bigint) to authenticated`);
    expect((await rows(POST_ROWS)).filter((r) => r.ok === false).map((r) => r.nr)).toEqual([214, 215]);
  });

  it("neither check file calls a reconciliation function or writes", () => {
    for (const t of [PRE, POST]) {
      const code = t.replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/'(?:[^']|'')*'/g, "''");
      expect(code).not.toMatch(/public\.(seller_recon|sales_recon)_\w+\s*\(/);
      expect(code).not.toMatch(/\b(insert|update|delete|truncate|alter|drop|create|grant|revoke)\b/i);
    }
  });

  it("the run file embeds the migration character for character, for Staging only, in one transaction", () => {
    const start = `-- >>> EINGEBETTET: supabase/migrations/${M0180}\n`;
    const a = RUN.indexOf(start);
    expect(RUN.slice(a + start.length, RUN.indexOf(`-- <<< ENDE: supabase/migrations/${M0180}\n`))).toBe(migration(M0180));
    expect([...RUN.matchAll(/^-- >>> EINGEBETTET: /gm)]).toHaveLength(1);
    expect(RUN.split("\n").filter((l) => l.trim() === "begin;")).toHaveLength(1);
    expect(RUN.trimEnd().endsWith("commit;")).toBe(true);
    expect(RUN).toContain("'skyisles-staging qqxcpesbwfxzgytkdsac'");
    expect(RUN).not.toContain("zmiwxswrpkmizvqsgype");
  });

  it("the run file stops without the stamp, runs with it and moves no value; Z1 catches a moved right", async () => {
    expect(await scriptFailsWith(db, RUN)).toBe("P0001");
    for (const [fn, hash] of Object.entries(OLD)) expect(await bodyHash(fn), fn).toBe(hash);
    await db.exec(`comment on database postgres is 'skyisles-staging qqxcpesbwfxzgytkdsac'`);
    const spoiled = RUN.replace("/* Z0 — dieselben Messungen nachher",
      "grant execute on function public.sales_recon_gate() to anon;\n/* Z0 — dieselben Messungen nachher");
    expect(await scriptFailsWith(db, spoiled)).toBe("P0001");
    for (const [fn, hash] of Object.entries(OLD)) expect(await bodyHash(fn), fn).toBe(hash);
    const before = await everything(db);
    expect(await scriptFailsWith(db, RUN)).toBe("ok");
    for (const fn of [...NEW_FNS, ...Object.keys(OLD)]) expect(await bodyHash(fn), fn).toBe(NEW_BODIES[fn]);
    expect(await everything(db)).toBe(before);
  });

  it("the registration names the three files, the baselines and an unambiguous `erfuellt`", () => {
    const plan = JSON.parse(readFileSync("supabase/checks/migration-plans.json", "utf8")).migrationen["0180"];
    expect(plan).toMatchObject({ preflight: "0180_preflight.sql", lauf: "staging-0180.sql", postflight: "0180_postflight.sql",
      liefert: { "skyisles.base": 900, "skyisles.coll": 901 }, braucht: ["skyisles.base", "skyisles.coll"] });
    expect(plan.angewendet.sql).toBe("select to_regprocedure('public.seller_recon_apply(bigint,bigint[],text)') is not null as erfuellt");
  });
});
