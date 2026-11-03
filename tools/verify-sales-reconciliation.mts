/**
 * Functional verification of the sales reconciliation on Staging (0169–0174, ADR-0174).
 *
 *   npm run verify:sales-reconciliation:staging              DRY RUN (default)
 *   npm run verify:sales-reconciliation:staging -- --apply   writes test data
 *
 * STAGING ONLY. `requireStaging()` runs before any client exists and refuses
 * every target that is not exactly the project in `.env.staging`.
 *
 * DRY RUN — THE DEFAULT, AND IT TOUCHES NOTHING. No network, no client, no
 * account: it confirms the target is Staging, builds the synthetic scenario,
 * runs the whole reconciliation locally against the scenario's own ledger and
 * prints what an `--apply` run would create and expect. Exit 1 if the local
 * expectation does not hold.
 *
 * WITH --apply IT WRITES, and only this:
 *
 *   * one temporary seller operator (service role, removed at the end);
 *   * eleven external sales MARKED AS TESTS (`is_test`) for the scenario and
 *     one for the conflict probe, all dated 2001,
 *     each with the note `verify:sales-reconciliation <run> <case>`, pieces as
 *     raw names only — so no hold is placed and no stock is touched;
 *   * two reconciliation sessions over them: the conflict probe (discarded)
 *     and the main one (closed). Sessions are evidence and are never deleted
 *     (ADR-0174); the test sales stay as `Testvorgang`, which counts in no
 *     business total (0063) and cannot be deleted while a session names it.
 *
 * NO REAL SALE CAN BE TOUCHED. The candidates are filtered to the sale ids
 * this run created (`ownCandidates`) before anything is matched; a session
 * therefore names no other sale, and `seller_recon_apply` changes only sales
 * a session names.
 *
 * WHAT IT PROVES: matching of the nine known deviations, every decision
 * type, the field rules (a total is never "taken"), PT409 for a stale screen,
 * a changed count and a changed sale (all or nothing), idempotent creation and
 * application, the audit lines written, the refusals for anon and for unknown
 * or contact-data payload fields — and that stock, movements, legacy events
 * and every non-test sale are byte-for-byte what they were.
 *
 * LOGS carry counts, ids, categories and field names. No report or buyer data
 * exists in this run, and none is printed.
 */
import { createHash } from "node:crypto";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

import { requireStaging } from "./lib/staging-guard.mts";
import { coverageOf } from "../src/lib/reconciliation/coverage.ts";
import { mergeReports } from "../src/lib/reconciliation/dedupe.ts";
import { reconcile, summarize, type Category } from "../src/lib/reconciliation/diff.ts";
import { matchOrders } from "../src/lib/reconciliation/match.ts";
import { parseSalesReport } from "../src/lib/reconciliation/registry.ts";
import { ebayReport } from "../src/lib/reconciliation/testing/ebay-fixture.ts";
import { aliasIndex, ledgerSales, sessionPayload } from "../src/lib/reconciliation/server/payload.ts";
import {
  EXPECTED_CATEGORIES, SCENARIO, SCENARIO_PERIOD, orderRef, ownCandidates, scenarioReport,
} from "../src/lib/reconciliation/testing/staging-scenario.ts";
import type { ExternalReport, LedgerSale } from "../src/lib/reconciliation/types.ts";

type Result = { name: string; passed: boolean; detail: string };
const results: Result[] = [];
const check = (name: string, passed: boolean, detail = ""): void => {
  results.push({ name, passed, detail });
  console.log(`  ${passed ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};
const heading = (text: string) => console.log(`\n${text}\n${"-".repeat(text.length)}`);
const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

// ---------------------------------------------------------------------------
// The local half — shared by the dry run and the tests
// ---------------------------------------------------------------------------

export type LocalPlan = {
  report: ExternalReport;
  fingerprint: string;
  categories: Record<Category, number>;
  decisions: number;
  expectedApplied: number;
  expectedDocumented: number;
};

/** The scenario, parsed and reconciled against its own synthetic ledger — no database. */
export function localPlan(run: string): LocalPlan {
  const text = scenarioReport(run);
  const parsed = parseSalesReport(text, `verify-recon-${run}.csv`);
  if (!parsed.ok) throw new Error(`scenario report: ${parsed.error.code}`);
  const ledger: LedgerSale[] = SCENARIO.map((c, i) => ({
    saleId: 900000 + i, source: "manual", isTest: false, soldOn: c.sale.sold,
    itemsSubtotal: c.sale.subtotal, discount: c.sale.discount, shipping: c.sale.shipping,
    refundsTotal: 0, cancelledOn: null, externalOrderRef: null, updatedAt: "2001-01-01T00:00:00+00:00",
    pieces: c.sale.pieces.map((raw, k) => ({ itemId: 9000000 + i * 100 + k, skyId: null, name: null, rawName: raw })),
  }));
  const merged = mergeReports([{ report: parsed.report, fingerprint: sha(text) }]);
  const coverage = coverageOf([parsed.report], merged.orders);
  const rows = reconcile(matchOrders(merged.orders, ledger, coverage));
  /*
   * One decision per FINDING of a decided field — case 5 has two figure
   * findings and gets two. A clarification is documented (V1 never changes
   * sale_items); a date, a refund and a cancellation are applied.
   */
  let decisions = 0;
  let documented = 0;
  for (const [i, c] of SCENARIO.entries()) {
    const row = rows.find((r) => r.entry.kind === "pair" && r.entry.order.orderRef === orderRef(run, i));
    for (const d of c.decide) {
      const n = (row?.diff?.findings ?? []).filter((f) => f.field === d.field).length;
      decisions += n;
      if (d.manual?.action === "clarify") documented += n;
    }
  }
  return {
    report: parsed.report, fingerprint: sha(text), categories: summarize(rows).categories,
    decisions, expectedApplied: decisions - documented, expectedDocumented: documented,
  };
}

const matchesExpectation = (c: Record<Category, number>) =>
  (Object.entries(EXPECTED_CATEGORIES) as [Category, number][]).every(([k, v]) => c[k] === v);

// ---------------------------------------------------------------------------
// Staging
// ---------------------------------------------------------------------------

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. Run through npm, which loads .env.staging.`);
    process.exit(1);
  }
  return value;
}

type Snapshot = { stock: string; movements: number; legacy: number; realSales: string; realSalesCount: number };

async function snapshot(admin: SupabaseClient): Promise<Snapshot> {
  const page = async <T,>(table: string, columns: string, onlyRealSales = false): Promise<T[]> => {
    const rows: T[] = [];
    for (let from = 0; ; from += 1000) {
      const base = admin.from(table).select(columns).order("id").range(from, from + 999);
      const r = await (onlyRealSales ? base.eq("is_test", false) : base);
      if (r.error) throw new Error(`${table}: ${r.error.message}`);
      rows.push(...(r.data as T[]));
      if ((r.data?.length ?? 0) < 1000) break;
    }
    return rows;
  };
  const stock = await page<{ id: number; quantity: number; reserved: number }>("shop_inventory", "id, quantity, reserved");
  const real = await page<{ id: number; updated_at: string }>("sales", "id, updated_at", true);
  const count = async (table: string) => {
    const r = await admin.from(table).select("id", { count: "exact", head: true });
    if (r.error) throw new Error(`${table}: ${r.error.message}`);
    return r.count ?? -1;
  };
  return {
    stock: sha(JSON.stringify(stock)), movements: await count("inventory_movements"),
    legacy: await count("legacy_stock_events"), realSales: sha(JSON.stringify(real)), realSalesCount: real.length,
  };
}

const isConflict = (e: { code?: string; message?: string } | null) =>
  e !== null && (e.code === "PT409" || /changed|reload|confirmation counted/.test(e.message ?? ""));

type SessionMatch = {
  id: number; category: string; order: { order_ref: string } | null;
  sale: { id: number } | null;
  findings: { id: number; field: string; key: string; ledger: unknown; external: unknown; applied: boolean }[];
};

async function readSession(op: SupabaseClient, id: number): Promise<SessionMatch[]> {
  const all: SessionMatch[] = [];
  for (let offset = 0; ; offset += 200) {
    const r = await op.rpc("seller_recon_session", { p_id: id, p_offset: offset, p_limit: 200 });
    if (r.error) throw new Error(`seller_recon_session: ${r.error.message}`);
    const matches = (r.data as { matches: SessionMatch[] }).matches;
    all.push(...matches);
    if (matches.length < 200) break;
  }
  return all;
}

async function main(): Promise<void> {
  // FIRST: the target is Staging, or nothing else happens.
  requireStaging("verify:sales-reconciliation");
  const apply = process.argv.includes("--apply");
  const RUN = Date.now().toString(36);

  heading(`Verkaufsabgleich auf Staging — ${apply ? "SCHREIBEND (--apply)" : "TROCKENLAUF"} · Lauf ${RUN}`);
  const plan = localPlan(RUN);
  check("the local scenario reconciles as expected (2 exact · 8 deviating · 1 probable)",
        matchesExpectation(plan.categories), JSON.stringify(plan.categories));
  check("every scenario day lies in 2001",
        SCENARIO.every((c) => c.sale.sold.startsWith("2001-") && c.order.sold.startsWith("2001-")));

  if (!apply) {
    heading("Was --apply tun würde");
    console.log(`  ${SCENARIO.length} Testverkäufe (is_test, 2001, nur Rohnamen — kein Hold, kein Lager)`);
    console.log(`  1 Konfliktprobe (verworfen) und 1 Hauptsitzung (geschlossen, bleibt als Nachweis)`);
    console.log(`  ${plan.decisions} Entscheidungen · erwartet übernommen ${plan.expectedApplied} · dokumentiert ${plan.expectedDocumented}`);
    console.log("  Keine Verbindung aufgebaut, nichts geschrieben.");
    finish();
    return;
  }

  const URL_ = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const ANON = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const anonClient = () => createClient(URL_, ANON, { auth: { persistSession: false } });
  // The service role is used for setup, read-only checks and removing the operator — nothing else.
  const admin = createClient(URL_, requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let operator: { client: SupabaseClient; user: User } | null = null;
  let sellerId: number | null = null;

  try {
    heading("Setup");
    const seller = await admin.from("sellers").select("id").eq("is_active", true).single();
    if (seller.error) throw new Error(`active seller: ${seller.error.message}`);
    sellerId = seller.data.id as number;
    const credentials = {
      email: `recon-verify-${RUN}@skyisles.invalid`,
      password: `recon-${RUN}-${Math.random().toString(36).slice(2)}`,
    };
    const created = await admin.auth.admin.createUser({ ...credentials, email_confirm: true });
    if (created.error) throw new Error(`createUser: ${created.error.message}`);
    const client = anonClient();
    const signIn = await client.auth.signInWithPassword(credentials);
    if (signIn.error) throw new Error(`signIn: ${signIn.error.message}`);
    operator = { client, user: created.data.user };
    const membership = await admin.from("seller_operators").insert({
      seller_id: sellerId, user_id: operator.user.id, note: "verify:sales-reconciliation",
    });
    if (membership.error) throw new Error(`seller_operators: ${membership.error.message}`);
    const op = operator.client;
    const before = await snapshot(admin);
    console.log(`  temporärer Betrieb angelegt · ${before.realSalesCount} echte Verkäufe gemessen (nicht angefasst)`);

    heading("1. Testverkäufe (is_test, 2001)");
    const own = new Map<string, number>();
    for (const c of SCENARIO) {
      const r = await op.rpc("seller_create_sale_with_details", {
        p_channel: "ebay", p_sold_at: c.sale.sold, p_country: "DE", p_external_ref: null, p_buyer_ref: null,
        p_note: `verify:sales-reconciliation ${RUN} ${c.key}`, p_is_test: true,
        p_items_subtotal: c.sale.subtotal, p_shipping_charged: c.sale.shipping, p_discount_amount: c.sale.discount,
        p_items: c.sale.pieces.map((raw) => ({ raw_name: raw })), p_fees: [], p_adjustments: [],
        p_payout_amount: null, p_payout_ref: null,
      });
      if (r.error) throw new Error(`create ${c.key}: ${r.error.message}`);
      own.set(c.key, Number(r.data));
    }
    check(`${SCENARIO.length} Testverkäufe angelegt`, own.size === SCENARIO.length, [...own.values()].join(","));
    const ownIds = new Set(own.values());

    heading("2. Analyse und Sitzung");
    const candidates = await op.rpc("seller_recon_candidates", { p_channel: "ebay", p_from: SCENARIO_PERIOD.from, p_to: SCENARIO_PERIOD.to });
    if (candidates.error) throw new Error(`candidates: ${candidates.error.message}`);
    const all = ledgerSales(candidates.data);
    const ledger = ownCandidates(all, ownIds);
    check("only this run's sales enter the comparison", ledger.length === ownIds.size,
          `${ledger.length} eigene von ${all.length} Kandidaten`);
    const aliases = await op.rpc("seller_recon_aliases", { p_channel: "ebay" });
    if (aliases.error) throw new Error(`aliases: ${aliases.error.message}`);

    const analyse = (report: ExternalReport, fingerprint: string, sales: LedgerSale[]) => {
      const merged = mergeReports([{ report, fingerprint }]);
      const coverage = coverageOf([report], merged.orders);
      const rows = reconcile(matchOrders(merged.orders, sales, coverage, { aliases: aliasIndex(aliases.data) }));
      const summary = summarize(rows);
      return { summary, payload: sessionPayload({ parser: report.parser, parserVersion: report.parserVersion,
        files: [{ fingerprint, report }], orders: merged.orders, coverage, rows, summary }) };
    };
    const main1 = analyse(plan.report, plan.fingerprint, ledger);
    check("Staging reconciles the nine cases as expected", matchesExpectation(main1.summary.categories),
          JSON.stringify(main1.summary.categories));
    const created1 = await op.rpc("seller_recon_create", { p_payload: main1.payload });
    if (created1.error) throw new Error(`create session: ${created1.error.message}`);
    const session = Number(created1.data);
    const again = await op.rpc("seller_recon_create", { p_payload: main1.payload });
    check("the same upload twice is the same session", Number(again.data) === session, `${session}`);

    heading("3. Ablehnungen");
    const withField = structuredClone(main1.payload) as unknown as { orders: Record<string, unknown>[] };
    withField.orders[0].buyerName = "x";
    check("an unknown payload field is refused",
          (await op.rpc("seller_recon_create", { p_payload: withField })).error !== null);
    const withMail = structuredClone(main1.payload);
    withMail.orders[0].lines[0].title = "Fragen an test@example.invalid";
    check("contact data in free text is refused",
          (await op.rpc("seller_recon_create", { p_payload: withMail })).error !== null);
    const stranger = anonClient();
    check("anon cannot read candidates",
          (await stranger.rpc("seller_recon_candidates", { p_channel: "ebay", p_from: "2001-01-01", p_to: "2001-12-31" })).error !== null);
    check("anon cannot create a session", (await stranger.rpc("seller_recon_create", { p_payload: main1.payload })).error !== null);

    heading("4. Entscheiden");
    const matches = await readSession(op, session);
    const byRef = new Map(matches.filter((m) => m.order).map((m) => [m.order!.order_ref, m]));
    const decide = (f: SessionMatch["findings"][number], decision: string, manual: unknown = null, reason: string | null = null,
      shown: [unknown, unknown] = [f.ledger, f.external]) =>
      op.rpc("seller_recon_decide", { p_finding_id: f.id, p_decision: decision, p_manual_value: manual,
        p_reason: reason, p_shown_ledger: shown[0], p_shown_external: shown[1] });
    const first = byRef.get(orderRef(RUN, SCENARIO.findIndex((c) => c.key === "case-1-date")))!;
    const firstDate = first.findings.find((f) => f.field === "sold_on")!;
    check("a stale screen is PT409", isConflict((await decide(firstDate, "take_external", null, null, ["1999-01-01", firstDate.external])).error));
    const cancelCase = byRef.get(orderRef(RUN, SCENARIO.findIndex((c) => c.key === "case-8-cancel")))!;
    check("a total is never taken over", (await decide(cancelCase.findings.find((f) => f.field === "total")!, "take_external")).error !== null);

    let decided = 0;
    for (const [i, c] of SCENARIO.entries()) {
      const m = byRef.get(orderRef(RUN, i));
      if (!m) continue;
      for (const d of c.decide) {
        for (const f of m.findings.filter((x) => x.field === d.field)) {
          const r = await decide(f, d.decision, d.manual ?? null, d.reason ?? null);
          if (r.error) throw new Error(`decide ${c.key} ${f.key}: ${r.error.message}`);
          decided += 1;
        }
      }
    }
    console.log(`  ${decided} Entscheidungen erfasst`);

    heading("5. Anwenden — alles oder nichts");
    check("a changed count is PT409", isConflict((await op.rpc("seller_recon_apply", { p_session_id: session, p_expected: decided + 1 })).error));
    const applied = await op.rpc("seller_recon_apply", { p_session_id: session, p_expected: decided });
    if (applied.error) throw new Error(`apply: ${applied.error.message}`);
    const result = applied.data as { applied: number; documented: number };
    check("decisions applied and documented as expected",
          result.applied === plan.expectedApplied && result.documented === plan.expectedDocumented, JSON.stringify(result));
    const twice = await op.rpc("seller_recon_apply", { p_session_id: session, p_expected: 0 });
    check("a second application changes nothing", !twice.error && (twice.data as { applied: number }).applied === 0);

    heading("6. Wirkung und Audit");
    const ids = [...ownIds];
    const sales = await admin.from("sales").select("id, sold_at, cancelled_at, external_order_ref, is_test").in("id", ids);
    if (sales.error) throw new Error(`sales: ${sales.error.message}`);
    const sale = (key: string) => (sales.data ?? []).find((s) => s.id === own.get(key))!;
    check("the four dates are the report's",
          [["case-1-date", "2001-02-18"], ["case-2-date", "2001-02-18"], ["case-3-date", "2001-06-05"], ["case-4-paid", "2001-06-26"]]
            .every(([k, d]) => sale(k).sold_at === d));
    check("the cancellation is recorded", sale("case-8-cancel").cancelled_at !== null);
    check("no order reference was stored without its own decision", (sales.data ?? []).every((s) => s.external_order_ref === null));
    check("every touched sale is still a test sale", (sales.data ?? []).every((s) => s.is_test === true));
    const refunds = await admin.from("sale_refunds").select("amount").eq("sale_id", own.get("case-9-refund")!);
    check("the refund is recorded with its amount", (refunds.data ?? []).length === 1 && Number(refunds.data![0].amount) === 6.99);
    const audit = await admin.from("orderbook_audit").select("sale_id, entity_type, field").in("sale_id", ids);
    const fields = (audit.data ?? []).map((a) => `${a.entity_type}:${a.field ?? "-"}`);
    check("the audit holds four date corrections, the cancellation with its reason and the refund",
          fields.filter((f) => f === "sale:sold_at").length === 4 && fields.includes("sale:cancelled_at")
            && fields.includes("sale:cancel_reason") && fields.includes("sale_refund:-"), `${fields.length} Zeilen`);

    heading("7. Konfliktprobe — ein geänderter Verkauf stoppt alles");
    const probeRef = `VR${RUN}C-0001`;
    const probeSale = await op.rpc("seller_create_sale_with_details", {
      p_channel: "ebay", p_sold_at: "2001-03-10", p_country: "DE", p_external_ref: null, p_buyer_ref: null,
      p_note: `verify:sales-reconciliation ${RUN} conflict-probe`, p_is_test: true,
      p_items_subtotal: 9.99, p_shipping_charged: 5.49, p_discount_amount: 0,
      p_items: [{ raw_name: "Eruptor" }], p_fees: [], p_adjustments: [], p_payout_amount: null, p_payout_ref: null,
    });
    if (probeSale.error) throw new Error(`probe sale: ${probeSale.error.message}`);
    const probeId = Number(probeSale.data);
    const probeText = ebayReport([{ ref: probeRef, record: 1, sold: "2001-03-11", lines: [{ character: "Eruptor", unit: 9.99 }] }]);
    const probeParsed = parseSalesReport(probeText, `verify-recon-${RUN}-conflict.csv`);
    if (!probeParsed.ok) throw new Error("probe report");
    const probeCandidates = ownCandidates(ledgerSales((await op.rpc("seller_recon_candidates",
      { p_channel: "ebay", p_from: "2001-03-01", p_to: "2001-03-31" })).data), new Set([probeId]));
    const probe = analyse(probeParsed.report, sha(probeText), probeCandidates);
    const probeSession = Number((await op.rpc("seller_recon_create", { p_payload: probe.payload })).data);
    const probeMatch = (await readSession(op, probeSession)).find((m) => m.sale?.id === probeId)!;
    const probeDate = probeMatch.findings.find((f) => f.field === "sold_on")!;
    await decide(probeDate, "take_external");
    await op.rpc("seller_update_sale", { p_id: probeId, p_note: `verify:sales-reconciliation ${RUN} changed elsewhere` });
    check("applying after the sale changed is PT409",
          isConflict((await op.rpc("seller_recon_apply", { p_session_id: probeSession, p_expected: 1 })).error));
    const probeAfter = await admin.from("sales").select("sold_at").eq("id", probeId).single();
    check("and nothing was applied", probeAfter.data?.sold_at === "2001-03-10");
    check("a session without applications can be discarded",
          !(await op.rpc("seller_recon_discard", { p_id: probeSession })).error);

    heading("8. Bestand und echte Verkäufe");
    const after = await snapshot(admin);
    check("stock positions, quantities and reservations are unchanged", after.stock === before.stock);
    check("no inventory movement and no legacy event was written",
          after.movements === before.movements && after.legacy === before.legacy,
          `Bewegungen ${before.movements}→${after.movements} · Legacy ${before.legacy}→${after.legacy}`);
    check("every non-test sale is exactly as it was", after.realSales === before.realSales && after.realSalesCount === before.realSalesCount);

    check("the main session is closed and stays as evidence", !(await op.rpc("seller_recon_close", { p_id: session })).error, `Sitzung ${session}`);
    console.log(`\n  Testverkäufe ${[...ownIds, probeId].join(", ")} bleiben als Testvorgang stehen (Notiz „verify:sales-reconciliation ${RUN} …“).`);
  } finally {
    heading("Aufräumen");
    if (operator && sellerId !== null) {
      /* Both results are CHECKED. The first version awaited them and threw
         the result away, so a refused deletion (0169's append-only trigger
         against `on delete set null`, fixed by 0175) left the temporary
         account behind without a word. Now a leftover is a failed run, with
         the account id named so it can be removed by hand. */
      const membership = await admin.from("seller_operators").delete()
        .eq("seller_id", sellerId).eq("user_id", operator.user.id);
      check("the temporary operator membership is removed", !membership.error,
            membership.error?.message ?? "");
      const removed = await admin.auth.admin.deleteUser(operator.user.id);
      check("the temporary account is deleted", !removed.error,
            removed.error ? `${removed.error.message} — Konto ${operator.user.id} bleibt stehen` : "");
    }
  }
  finish();
}

function finish(): void {
  const failed = results.filter((r) => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} bestanden`);
  process.exit(failed.length === 0 ? 0 : 1);
}

if (process.argv[1]?.endsWith("verify-sales-reconciliation.mts")) void main();
