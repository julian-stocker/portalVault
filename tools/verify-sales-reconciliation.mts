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
 * WITH --apply IT WRITES — AS THE EXISTING STAGING OPERATOR, and only this:
 *
 *   * eleven external sales MARKED AS TESTS (`is_test`) for the scenario and
 *     one for the conflict probe, all dated 2001,
 *     each with the note `verify:sales-reconciliation <run> <case>`, pieces as
 *     raw names only — so no hold is placed and no stock is touched;
 *   * two reconciliation sessions over them: the conflict probe (discarded)
 *     and the main one (closed). Sessions are evidence and are never deleted
 *     (ADR-0174); the test sales stay as `Testvorgang`, which counts in no
 *     business total (0063) and cannot be deleted while a session names it.
 *
 * NO SERVICE ROLE, NO ACCOUNT MANAGEMENT. The run signs in as the operator
 * account that already exists on Staging, with the public (anon) key, and
 * does everything through the functions that operator may call. It creates
 * no account and deletes none. The credentials come from a local file
 * outside the repository (`~/.skyisles/staging-operator.env`, two lines:
 * SKYISLES_STAGING_OPERATOR_EMAIL, SKYISLES_STAGING_OPERATOR_PASSWORD) and
 * are never printed. `.env.staging` carries the service-role key for other
 * tools; this one removes it from its own environment before anything else.
 *
 * WHAT IT CANNOT SEE, A SEPARATE FILE MEASURES. Stock, movements, legacy
 * events and every real sale are not readable for an operator account.
 * `supabase/checks/verify_sales_reconciliation_state.sql` (read-only) is run
 * as `postgres` in the SQL editor before and after `--apply`; rows 101–108
 * must be identical. That comparison is part of the acceptance.
 *
 * AN ABORTED RUN. Every database call is checked; the first failure stops
 * the run. It cleans NOTHING up on its own — no session is discarded or
 * closed on the way out, no sale removed: what a run wrote is evidence, and
 * what happens to it is the operator's decision. Instead every session it
 * left unfinished is a FAILED check, and it names its run id, its sale ids
 * and its session ids. The run id is printed first, so even a run that dies
 * without reaching its last line can be traced through the notes of its
 * sales; the state file (rows 201, 203, 206) shows leftovers. A new run uses
 * a new run id, new order numbers and a new file fingerprint, and compares
 * only its own sales — leftovers of an earlier run cannot enter it.
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
 * or contact-data payload fields. That stock, movements, legacy events and
 * every non-test sale are byte-for-byte what they were is shown by the
 * state file before and after (see above), not by this tool.
 *
 * LOGS carry counts, ids, categories and field names. No report or buyer data
 * exists in this run, and none is printed.
 */
import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { homedir } from "node:os";
import { join } from "node:path";

import { ladeUmgebung } from "./lib/staging-db.mts";
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

/** The local file with the operator's credentials — outside the repository, never printed. */
export const OPERATOR_ENV_FILE = join(homedir(), ".skyisles", "staging-operator.env");

/** A database call's result, or the run stops — nothing is awaited and dropped. */
function must<T>(r: { data: T; error: { message: string; code?: string } | null }, label: string): T {
  if (r.error) throw new Error(`${label}: ${r.error.message}`);
  return r.data;
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
  // `.env.staging` carries the service-role key for other tools. This one never needs it.
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
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
    console.log("  Als vorhandenes Betriebskonto (Anon-Schlüssel), ohne Service-Role, ohne Kontoanlage.");
    console.log("  Vorher und nachher: supabase/checks/verify_sales_reconciliation_state.sql als postgres.");
    console.log("  Keine Verbindung aufgebaut, nichts geschrieben.");
    finish();
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
  const op = anonClient();
  const sessions = new Map<number, "open" | "applied" | "done">();
  const ownSales: number[] = [];

  try {
    heading("Anmeldung");
    const signIn = await op.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
    // The message only — never the address, never the password.
    if (signIn.error) throw new Error(`sign-in as the Staging operator failed: ${signIn.error.message}`);
    check("signed in as the existing Staging operator (no account created)", true);
    must(await op.rpc("seller_recon_candidates", { p_channel: "ebay", p_from: "2001-01-01", p_to: "2001-01-01" }),
         "the account is not a seller operator");

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
      own.set(c.key, Number(must(r, `create ${c.key}`)));
      ownSales.push(own.get(c.key)!);
    }
    check(`${SCENARIO.length} Testverkäufe angelegt`, own.size === SCENARIO.length, [...own.values()].join(","));
    const ownIds = new Set(own.values());

    heading("2. Analyse und Sitzung");
    const all = ledgerSales(must(await op.rpc("seller_recon_candidates",
      { p_channel: "ebay", p_from: SCENARIO_PERIOD.from, p_to: SCENARIO_PERIOD.to }), "candidates"));
    const ledger = ownCandidates(all, ownIds);
    check("only this run's sales enter the comparison", ledger.length === ownIds.size,
          `${ledger.length} eigene von ${all.length} Kandidaten`);
    const aliases = must(await op.rpc("seller_recon_aliases", { p_channel: "ebay" }), "aliases");

    const analyse = (report: ExternalReport, fingerprint: string, sales: LedgerSale[]) => {
      const merged = mergeReports([{ report, fingerprint }]);
      const coverage = coverageOf([report], merged.orders);
      const rows = reconcile(matchOrders(merged.orders, sales, coverage, { aliases: aliasIndex(aliases) }));
      const summary = summarize(rows);
      return { summary, payload: sessionPayload({ parser: report.parser, parserVersion: report.parserVersion,
        files: [{ fingerprint, report }], orders: merged.orders, coverage, rows, summary }) };
    };
    const main1 = analyse(plan.report, plan.fingerprint, ledger);
    check("Staging reconciles the nine cases as expected", matchesExpectation(main1.summary.categories),
          JSON.stringify(main1.summary.categories));
    const session = Number(must(await op.rpc("seller_recon_create", { p_payload: main1.payload }), "create session"));
    sessions.set(session, "open");
    const again = must(await op.rpc("seller_recon_create", { p_payload: main1.payload }), "create session again");
    check("the same upload twice is the same session", Number(again) === session, `${session}`);

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
          must(await decide(f, d.decision, d.manual ?? null, d.reason ?? null), `decide ${c.key} ${f.key}`);
          decided += 1;
        }
      }
    }
    console.log(`  ${decided} Entscheidungen erfasst`);

    heading("5. Anwenden — alles oder nichts");
    check("a changed count is PT409", isConflict((await op.rpc("seller_recon_apply", { p_session_id: session, p_expected: decided + 1 })).error));
    sessions.set(session, "applied");
    const result = must(await op.rpc("seller_recon_apply", { p_session_id: session, p_expected: decided }), "apply") as
      { applied: number; documented: number };
    check("decisions applied and documented as expected",
          result.applied === plan.expectedApplied && result.documented === plan.expectedDocumented, JSON.stringify(result));
    const twice = await op.rpc("seller_recon_apply", { p_session_id: session, p_expected: 0 });
    check("a second application changes nothing", !twice.error && (twice.data as { applied: number }).applied === 0);

    heading("6. Wirkung und Audit");
    // Read back through the operator's own functions — no table is read directly.
    const view = new Map<string, { sold_at: string; cancelled_at: string | null; external_order_ref: string | null;
      is_test: boolean; refunds: { amount: number }[] }>();
    for (const [key, id] of own) {
      const d = must(await op.rpc("seller_sale", { p_id: id }), `seller_sale ${key}`) as
        { sale: { sold_at: string; cancelled_at: string | null; external_order_ref: string | null }; is_test: boolean; refunds: { amount: number }[] };
      view.set(key, { ...d.sale, is_test: d.is_test, refunds: d.refunds });
    }
    const sale = (key: string) => view.get(key)!;
    check("the four dates are the report's",
          [["case-1-date", "2001-02-18"], ["case-2-date", "2001-02-18"], ["case-3-date", "2001-06-05"], ["case-4-paid", "2001-06-26"]]
            .every(([k, d]) => sale(k).sold_at === d));
    check("the cancellation is recorded", sale("case-8-cancel").cancelled_at !== null);
    check("no order reference was stored without its own decision", [...view.values()].every((s) => s.external_order_ref === null));
    check("every touched sale is still a test sale", [...view.values()].every((s) => s.is_test === true));
    const refunds = sale("case-9-refund").refunds;
    check("the refund is recorded with its amount", refunds.length === 1 && Number(refunds[0].amount) === 6.99);
    const fields: string[] = [];
    for (const [key, id] of own) {
      const rows = must(await op.rpc("seller_sale_audit", { p_sale_id: id }), `seller_sale_audit ${key}`) as
        { entity_type: string; field: string | null }[];
      fields.push(...rows.map((a) => `${a.entity_type}:${a.field ?? "-"}`));
    }
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
    const probeId = Number(must(probeSale, "probe sale"));
    ownSales.push(probeId);
    const probeText = ebayReport([{ ref: probeRef, record: 1, sold: "2001-03-11", lines: [{ character: "Eruptor", unit: 9.99 }] }]);
    const probeParsed = parseSalesReport(probeText, `verify-recon-${RUN}-conflict.csv`);
    if (!probeParsed.ok) throw new Error("probe report");
    const probeCandidates = ownCandidates(ledgerSales(must(await op.rpc("seller_recon_candidates",
      { p_channel: "ebay", p_from: "2001-03-01", p_to: "2001-03-31" }), "probe candidates")), new Set([probeId]));
    const probe = analyse(probeParsed.report, sha(probeText), probeCandidates);
    const probeSession = Number(must(await op.rpc("seller_recon_create", { p_payload: probe.payload }), "probe session"));
    sessions.set(probeSession, "open");
    const probeMatch = (await readSession(op, probeSession)).find((m) => m.sale?.id === probeId)!;
    const probeDate = probeMatch.findings.find((f) => f.field === "sold_on")!;
    must(await decide(probeDate, "take_external"), "probe decision");
    must(await op.rpc("seller_update_sale", { p_id: probeId, p_note: `verify:sales-reconciliation ${RUN} changed elsewhere` }),
         "probe change elsewhere");
    check("applying after the sale changed is PT409",
          isConflict((await op.rpc("seller_recon_apply", { p_session_id: probeSession, p_expected: 1 })).error));
    const probeAfter = must(await op.rpc("seller_sale", { p_id: probeId }), "probe read") as { sale: { sold_at: string } };
    check("and nothing was applied", probeAfter.sale.sold_at === "2001-03-10");
    const discarded = await op.rpc("seller_recon_discard", { p_id: probeSession });
    check("a session without applications can be discarded", !discarded.error, discarded.error?.message ?? "");
    if (!discarded.error) sessions.set(probeSession, "done");

    heading("8. Abschluss");
    const closed = await op.rpc("seller_recon_close", { p_id: session });
    check("the main session is closed and stays as evidence", !closed.error, closed.error?.message ?? `Sitzung ${session}`);
    if (!closed.error) sessions.set(session, "done");
  } catch (error) {
    check("the run completed", false, (error as Error).message);
  } finally {
    heading("Nachweis");
    /*
     * NOTHING IS CLEANED UP AUTOMATICALLY. A session this run opened and did
     * not finish stays as it is and fails the run — with what the operator
     * can do about it. Discarding or closing is a decision, not a reflex of
     * an error path.
     */
    for (const [id, state] of sessions) {
      if (state === "done") continue;
      check(`session ${id} was left unfinished`, false, state === "applied"
        ? "hat Anwendungen — nur noch schließbar (/business/orderbuch/abgleich)"
        : "offen, ohne Anwendung — verwerfen oder schließen ist Entscheidung des Betriebs");
    }
    const out = await op.auth.signOut();
    check("signed out", !out.error, out.error?.message ?? "");
    console.log(`\n  Lauf ${RUN} · Testverkäufe ${ownSales.join(", ") || "keine"} · Sitzungen ${[...sessions.keys()].join(", ") || "keine"}`);
    console.log("  Die Testverkäufe bleiben als Testvorgang stehen (Notiz „verify:sales-reconciliation " + RUN + " …“).");
    console.log("  Abnahme: supabase/checks/verify_sales_reconciliation_state.sql als postgres — 101–108 wie vorher.");
  }
  finish();
}

function finish(): void {
  const failed = results.filter((r) => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} bestanden`);
  process.exit(failed.length === 0 ? 0 : 1);
}

if (process.argv[1]?.endsWith("verify-sales-reconciliation.mts")) void main();
