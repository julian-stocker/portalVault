/**
 * Functional verification of 0180 on Staging (ADR-0178, step 6A).
 *
 *   npm run verify:recon-0180:staging              DRY RUN (default)
 *   npm run verify:recon-0180:staging -- --apply   writes test data
 *
 * NOT YET TO BE RUN WITH --apply: 0180 is not on Staging, and the write needs
 * its own approval. Before 0180 stands, `--apply` stops after the sign-in:
 * the preview function must exist.
 *
 * STAGING ONLY. `requireStaging()` runs before any client exists and refuses
 * every target that is not exactly the project in `.env.staging`.
 *
 * DRY RUN — THE DEFAULT, AND IT TOUCHES NOTHING. No network, no client, no
 * account: it builds the synthetic scenario, reconciles it locally and prints
 * what `--apply` would create and check. Exit 1 if the local expectation fails.
 *
 * WITH --apply IT WRITES — AS THE EXISTING STAGING OPERATOR, and only this:
 * three external sales MARKED AS TESTS, dated 2001, with the note
 * `verify:recon-0180 <run> <case>`, raw names only (no hold, no stock); one
 * reconciliation session over them (closed at the end, kept as evidence);
 * the decisions the checks need (a note and a deferral). Nothing is applied:
 * 0180 refuses every take-over on a test sale, and the run proves exactly
 * that, plus every other refusal, and that the sales did not move.
 *
 * THE POSITIVE PATH IS NOT PROVEN HERE (`POSITIVE_PATH_BLOCKED`). An applied
 * correction needs a sale that is not a test sale. Whether this run may
 * create or reclassify one is the operator's decision; until then the run
 * lists those checks as OPEN and ends with exit 3 ("incomplete"), never as
 * passed.
 *
 * NO SERVICE ROLE, NO ACCOUNT MANAGEMENT — as `verify-sales-reconciliation`:
 * the existing operator, the public key, credentials from
 * `~/.skyisles/staging-operator.env`, never printed. Nothing is cleaned up
 * on an error; the run id, sale ids and session ids are printed. Stock,
 * movements, legacy events and every real sale are measured by
 * `supabase/checks/verify_sales_reconciliation_state.sql` as `postgres`
 * before and after (rows 101–108 identical).
 *
 * LOGS carry counts, ids, categories, field names and reason codes — no
 * report value, no buyer data.
 */
import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { ladeUmgebung } from "./lib/staging-db.mts";
import { requireStaging } from "./lib/staging-guard.mts";
import { OPERATOR_ENV_FILE } from "./verify-sales-reconciliation.mts";
import { coverageOf } from "../src/lib/reconciliation/coverage.ts";
import { mergeReports } from "../src/lib/reconciliation/dedupe.ts";
import { reconcile, summarize, type ReconciliationRow } from "../src/lib/reconciliation/diff.ts";
import { matchOrders } from "../src/lib/reconciliation/match.ts";
import { parseSalesReport } from "../src/lib/reconciliation/registry.ts";
import { selectionPreviewView } from "../src/lib/reconciliation/selection.ts";
import { aliasIndex, ledgerSales, sessionPayload } from "../src/lib/reconciliation/server/payload.ts";
import { ownCandidates } from "../src/lib/reconciliation/testing/staging-scenario.ts";
import {
  EXPECTED_0180, POSITIVE_PATH_BLOCKED, SCENARIO_0180, SCENARIO_0180_PERIOD, orderRef0180, scenarioReport0180,
} from "../src/lib/reconciliation/testing/staging-scenario-0180.ts";
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

/** The scenario reconciled against its own synthetic ledger — no database. */
export function localPlan0180(run: string): { report: ExternalReport; fingerprint: string; rows: ReconciliationRow[] } {
  const text = scenarioReport0180(run);
  const parsed = parseSalesReport(text, `verify-recon-0180-${run}.csv`);
  if (!parsed.ok) throw new Error(`scenario report: ${parsed.error.code}`);
  const ledger: LedgerSale[] = SCENARIO_0180.map((c, i) => ({
    saleId: 910000 + i, source: "manual", isTest: false, soldOn: c.sale.sold,
    itemsSubtotal: c.sale.subtotal, discount: 0, shipping: c.sale.shipping, refundsTotal: 0, cancelledOn: null,
    externalOrderRef: c.sale.carriesRef ? orderRef0180(run, i) : null, updatedAt: "2001-01-01T00:00:00+00:00",
    pieces: c.sale.pieces.map((raw, k) => ({ itemId: 9100000 + i * 100 + k, skyId: null, name: null, rawName: raw })),
  }));
  const merged = mergeReports([{ report: parsed.report, fingerprint: sha(text) }]);
  const rows = reconcile(matchOrders(merged.orders, ledger, coverageOf([parsed.report], merged.orders)));
  return { report: parsed.report, fingerprint: sha(text), rows };
}

/** Category and certainty per case, as the local reconciliation gives them. */
export function localCategories(run: string): Record<string, [string, string | null]> {
  const { rows } = localPlan0180(run);
  return Object.fromEntries(SCENARIO_0180.map((c, i) => {
    const row = rows.find((r) => r.entry.kind === "pair" && r.entry.order.orderRef === orderRef0180(run, i));
    return [c.key, [row?.category ?? "missing", row?.entry.kind === "pair" ? row.entry.certainty : null]];
  }));
}

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

type RpcError = { message: string; code?: string } | null;
function must<T>(r: { data: T; error: RpcError }, label: string): T {
  // The code only: a database text is not printed.
  if (r.error) throw new Error(`${label}: ${r.error.code ?? "error"}`);
  return r.data;
}
/** The reason codes a refusal named (0180's texts carry codes, never values). */
const codesOf = (e: RpcError): string => (e?.message.match(/\(([a-z_, ]+)\)/)?.[1] ?? "");

type Finding = { id: number; field: string; ledger: unknown; external: unknown };
type MatchRow = { category: string; certainty: string | null; order: { order_ref: string } | null; findings: Finding[] };

async function main(): Promise<void> {
  requireStaging("verify:recon-0180");
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apply = process.argv.includes("--apply");
  const RUN = Date.now().toString(36);

  heading(`0180 auf Staging — ${apply ? "SCHREIBEND (--apply)" : "TROCKENLAUF"} · Lauf ${RUN}`);
  const local = localCategories(RUN);
  check("the local scenario reconciles as expected",
        SCENARIO_0180.every((c) => local[c.key][0] === EXPECTED_0180[c.key][0] && local[c.key][1] === EXPECTED_0180[c.key][1]),
        JSON.stringify(local));
  check("every scenario day lies in 2001", SCENARIO_0180.every((c) => c.sale.sold.startsWith("2001-") && c.order.sold.startsWith("2001-")));

  if (!apply) {
    heading("Was --apply tun würde");
    console.log(`  ${SCENARIO_0180.length} Testverkäufe (is_test, 2001, nur Rohnamen — kein Hold, kein Lager), 1 Sitzung (geschlossen)`);
    console.log("  Ablehnungen: alte Übernahme, manual, take_external auf Testverkäufen, Auswahl, Token, anon");
    console.log("  Nachweis: die eigenen Verkäufe vorher und nachher gleich (seller_sale); Zustandsdatei als postgres.");
    console.log(`  OFFEN (Positivpfad, braucht eine Entscheidung): ${POSITIVE_PATH_BLOCKED.length} Prüfungen`);
    console.log("  Keine Verbindung aufgebaut, nichts geschrieben.");
    finish(false);
    return;
  }

  const URL_ = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const ANON = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  ladeUmgebung(OPERATOR_ENV_FILE);
  const EMAIL = process.env.SKYISLES_STAGING_OPERATOR_EMAIL;
  const PASSWORD = process.env.SKYISLES_STAGING_OPERATOR_PASSWORD;
  if (!EMAIL || !PASSWORD) {
    console.error(`Die Zugangsdaten des Staging-Betriebskontos fehlen (${OPERATOR_ENV_FILE}).`);
    process.exit(1);
  }
  const anonClient = () => createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const op: SupabaseClient = anonClient();
  const ownSales: number[] = [];
  let session: number | null = null;
  let closed = false;

  try {
    heading("Anmeldung und Stand");
    const signIn = await op.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
    if (signIn.error) throw new Error("sign-in as the Staging operator failed");
    check("signed in as the existing Staging operator (no account created)", true);
    // 0180 must stand BEFORE anything is written: the preview function exists.
    const probe = await op.rpc("seller_recon_preview", { p_session_id: 0, p_decision_ids: [1] });
    if (probe.error?.code === "PGRST202" || probe.error?.code === "42883") {
      throw new Error("0180 is not on Staging (seller_recon_preview missing) — nothing written");
    }
    check("0180 stands (the preview answers; an unknown session is refused)", probe.error !== null, probe.error?.code ?? "");

    heading("1. Testverkäufe (is_test, 2001)");
    const own = new Map<string, number>();
    for (const [i, c] of SCENARIO_0180.entries()) {
      const id = Number(must(await op.rpc("seller_create_sale_with_details", {
        p_channel: "ebay", p_sold_at: c.sale.sold, p_country: "DE",
        p_external_ref: c.sale.carriesRef ? orderRef0180(RUN, i) : null, p_buyer_ref: null,
        p_note: `verify:recon-0180 ${RUN} ${c.key}`, p_is_test: true,
        p_items_subtotal: c.sale.subtotal, p_shipping_charged: c.sale.shipping, p_discount_amount: 0,
        p_items: c.sale.pieces.map((raw) => ({ raw_name: raw })), p_fees: [], p_adjustments: [],
        p_payout_amount: null, p_payout_ref: null,
      }), `create ${c.key}`));
      own.set(c.key, id);
      ownSales.push(id);
    }
    check(`${SCENARIO_0180.length} Testverkäufe angelegt`, own.size === SCENARIO_0180.length, ownSales.join(","));
    const snapshot = async () => {
      const out: string[] = [];
      for (const id of ownSales) out.push(JSON.stringify(must(await op.rpc("seller_sale", { p_id: id }), `seller_sale ${id}`)));
      return sha(out.join("\n"));
    };
    const before = await snapshot();

    heading("2. Analyse und Sitzung");
    const ledger = ownCandidates(ledgerSales(must(await op.rpc("seller_recon_candidates",
      { p_channel: "ebay", p_from: SCENARIO_0180_PERIOD.from, p_to: SCENARIO_0180_PERIOD.to }), "candidates")), new Set(ownSales));
    check("only this run's sales enter the comparison", ledger.length === ownSales.length, `${ledger.length}`);
    const aliases = must(await op.rpc("seller_recon_aliases", { p_channel: "ebay" }), "aliases");
    const plan = localPlan0180(RUN);
    const merged = mergeReports([{ report: plan.report, fingerprint: plan.fingerprint }]);
    const coverage = coverageOf([plan.report], merged.orders);
    const rows = reconcile(matchOrders(merged.orders, ledger, coverage, { aliases: aliasIndex(aliases) }));
    const payload = sessionPayload({ parser: plan.report.parser, parserVersion: plan.report.parserVersion,
      files: [{ fingerprint: plan.fingerprint, report: plan.report }], orders: merged.orders, coverage, rows, summary: summarize(rows) });
    session = Number(must(await op.rpc("seller_recon_create", { p_payload: payload }), "create session"));
    const page = must(await op.rpc("seller_recon_session", { p_id: session, p_offset: 0, p_limit: 200 }), "read session") as { matches: MatchRow[] };
    const byKey = new Map(SCENARIO_0180.map((c, i) => [c.key, page.matches.find((m) => m.order?.order_ref === orderRef0180(RUN, i))!]));
    check("Staging gives every case its category and certainty",
          SCENARIO_0180.every((c) => byKey.get(c.key)?.category === EXPECTED_0180[c.key][0] && byKey.get(c.key)?.certainty === EXPECTED_0180[c.key][1]));
    const finding = (key: Case, field: string) => byKey.get(key)!.findings.find((f) => f.field === field)!;
    type Case = (typeof SCENARIO_0180)[number]["key"];
    const decide = (f: Finding, decision: string, manual: unknown = null, reason: string | null = null) =>
      op.rpc("seller_recon_decide", { p_finding_id: f.id, p_decision: decision, p_manual_value: manual, p_reason: reason,
        p_shown_ledger: f.ledger, p_shown_external: f.external });

    heading("3. Ablehnungen beim Entscheiden");
    const manualDay = await decide(finding("det-date", "sold_on"), "manual", { value: "2001-05-10" });
    check("manual on a day is refused", manualDay.error?.code === "23514", manualDay.error?.code ?? "angenommen");
    const manualCancel = await decide(finding("cancel-total", "total"), "manual", { action: "cancel" }, "Testlauf");
    check("manual cancellation is refused", manualCancel.error?.code === "23514", manualCancel.error?.code ?? "angenommen");
    const takeDay = await decide(finding("det-date", "sold_on"), "take_external");
    check("take_external on a test sale is refused (test_sale)", takeDay.error?.code === "23514" && codesOf(takeDay.error) === "test_sale",
          codesOf(takeDay.error));
    const takeRef = await decide(finding("unique-ref", "external_order_ref"), "take_external");
    check("adding a reference to a test sale is refused (test_sale)", codesOf(takeRef.error) === "test_sale", codesOf(takeRef.error));
    const keep = Number(must(await decide(finding("cancel-total", "total"), "keep_ledger"), "keep_ledger without a reason"));
    const later = Number(must(await decide(finding("det-date", "sold_on"), "defer"), "defer"));
    check("keep_ledger (no reason) and defer are recorded", keep > 0 && later > 0);

    heading("4. Vorschau und Übernahme — nur Ablehnungen");
    const p = selectionPreviewView(must(await op.rpc("seller_recon_preview", { p_session_id: session, p_decision_ids: [keep, later] }), "preview"));
    check("the preview reads, names no_change twice and is not admissible",
          !p.admissible && p.changes.map((c) => c.problem).join() === "no_change,no_change", JSON.stringify(p.changes.map((c) => c.problem)));
    for (const [what, ids] of [["an empty selection", []], ["a doubled id", [keep, keep]]] as const) {
      const r = await op.rpc("seller_recon_preview", { p_session_id: session, p_decision_ids: ids });
      check(`${what} is refused`, r.error?.code === "23514", r.error?.code ?? "angenommen");
    }
    const foreign = selectionPreviewView(must(await op.rpc("seller_recon_preview",
      { p_session_id: session, p_decision_ids: [2147483000] }), "foreign preview"));
    check("a decision of no session is unknown_decision", foreign.changes[0]?.problem === "unknown_decision");
    for (const [what, token] of [["the preview's own token", p.token], ["a malformed token", "x"], ["another token", "0".repeat(64)]] as const) {
      const r = await op.rpc("seller_recon_apply", { p_session_id: session, p_decision_ids: [keep], p_token: token });
      check(`apply with ${what} is refused`, r.error !== null, r.error?.code ?? "angenommen");
    }
    const old = await op.rpc("seller_recon_apply", { p_session_id: session, p_expected: 0 });
    check("the retired apply(session, expected) is refused", old.error !== null, old.error?.code ?? "angenommen");
    const stranger = anonClient();
    check("anon cannot preview", (await stranger.rpc("seller_recon_preview", { p_session_id: session, p_decision_ids: [keep] })).error !== null);
    check("anon cannot apply", (await stranger.rpc("seller_recon_apply", { p_session_id: session, p_decision_ids: [keep], p_token: p.token })).error !== null);

    heading("5. Nachweis: nichts bewegt");
    check("this run's sales are unchanged — values, positions, refunds, version", (await snapshot()) === before);
    const pending = must(await op.rpc("seller_recon_pending", { p_session_id: session }), "pending") as { count: number; admissible: number };
    check("nothing is pending, nothing applicable", pending.count === 0 && pending.admissible === 0, JSON.stringify(pending));
    const done = await op.rpc("seller_recon_close", { p_id: session });
    check("the session is closed and stays as evidence", !done.error, done.error?.code ?? `Sitzung ${session}`);
    closed = !done.error;
  } catch (error) {
    check("the run completed", false, (error as Error).message);
  } finally {
    heading("Offen — der Positivpfad (Entscheidung des Betriebs)");
    for (const item of POSITIVE_PATH_BLOCKED) console.log(`  OFFEN  ${item}`);
    if (session !== null && !closed) check(`session ${session} was left open`, false, "schließen oder verwerfen ist Entscheidung des Betriebs");
    const out = await op.auth.signOut();
    check("signed out", !out.error);
    console.log(`\n  Lauf ${RUN} · Testverkäufe ${ownSales.join(", ") || "keine"} · Sitzung ${session ?? "keine"}`);
    console.log("  Abnahme: supabase/checks/verify_sales_reconciliation_state.sql als postgres — 101–108 wie vorher.");
  }
  finish(true);
}

/** Exit 0 never claims more than was checked: with the positive path open, a clean run is 3, "incomplete". */
function finish(ranOnStaging: boolean): void {
  const failed = results.filter((r) => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} bestanden`);
  if (failed.length > 0) process.exit(1);
  if (ranOnStaging && POSITIVE_PATH_BLOCKED.length > 0) {
    console.log(`UNVOLLSTÄNDIG: ${POSITIVE_PATH_BLOCKED.length} Prüfungen des Positivpfads offen — keine Abnahme.`);
    process.exit(3);
  }
  process.exit(0);
}

if (process.argv[1]?.endsWith("verify-recon-0180.mts")) void main();
