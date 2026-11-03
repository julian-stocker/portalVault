/**
 * Targeted Staging probe for 0176 (ADR-0177): `seller_recon_create` refuses
 * forbidden content on a NEW and on a KNOWN upload.
 *
 *   npm run verify:recon-refusals:staging              DRY RUN (default)
 *   npm run verify:recon-refusals:staging -- --apply   writes one mini session
 *
 * WHY IT EXISTS. The first functional run (mw12dxva, 25/27) showed that a
 * known upload was recognised before its content was read. 0176 fixed that;
 * this probe proves it on Staging with the smallest footprint possible —
 * instead of a second full run with twelve more test sales.
 *
 * STAGING ONLY, AS THE EXISTING OPERATOR. `requireStaging()` runs first. It
 * signs in with the public (anon) key as the operator account that already
 * exists on Staging (credentials in `~/.skyisles/staging-operator.env`, never
 * printed), drops the service-role key from its own environment, creates no
 * account and reads only through the operator's functions.
 *
 * DRY RUN — READS ONLY. It signs in (the usual sign-in trace in Supabase
 * Auth) and checks the preconditions: 0176 stands (the check function exists
 * and is closed to the operator — `42501`, not "function not found"), the
 * operator functions answer, a suitable test sale exists (`is_test`, 2001,
 * not cancelled). It writes nothing and prints the plan.
 *
 * WITH --apply IT WRITES EXACTLY THIS: one mini session over ONE existing
 * test sale — one file, one order with one line, one match, no finding, no
 * decision — and discards it again as the last, explicit test step. No sale
 * is created or changed. The discarded session stays as evidence (ADR-0174).
 *
 * THE ORDER. (1) the two forbidden contents as NEW uploads — refused, nothing
 * created; (2) the mini session; (3) the same two contents as the KNOWN
 * upload — refused, the session byte for byte unchanged, nothing forbidden
 * stored; (4) the valid upload again returns the same session; (5) no
 * decision, no application, the test sale untouched; (6) discard.
 *
 * AN ABORTED RUN cleans nothing up. The first failure stops it; a mini
 * session left open is a FAILED check, named with its id. Its file name
 * starts with `verify-recon-`, so row 206 of
 * `supabase/checks/verify_sales_reconciliation_state.sql` shows it.
 *
 * WHAT IT CANNOT SEE (stock, movements, legacy events, real sales, refunds,
 * audit): the state file, run as `postgres` before and after `--apply`.
 */
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

import { ladeUmgebung } from "./lib/staging-db.mts";
import { requireStaging } from "./lib/staging-guard.mts";
import { OPERATOR_ENV_FILE } from "./verify-sales-reconciliation.mts";
import { ledgerSales } from "../src/lib/reconciliation/server/payload.ts";
import type { LedgerSale } from "../src/lib/reconciliation/types.ts";

type Result = { name: string; passed: boolean; detail: string };
const results: Result[] = [];
const check = (name: string, passed: boolean, detail = ""): void => {
  results.push({ name, passed, detail });
  console.log(`  ${passed ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};
const heading = (text: string) => console.log(`\n${text}\n${"-".repeat(text.length)}`);
const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

// ---------------------------------------------------------------------------
// The local half — shared by the tool and its tests
// ---------------------------------------------------------------------------

/** The window the test sales of the functional test live in. */
export const TEST_PERIOD = { from: "2001-01-01", to: "2001-12-31" } as const;

/** A sale the probe may lean on: a test sale of 2001, not cancelled. Never a real one. */
export function pickTestSale(candidates: readonly LedgerSale[]): LedgerSale | null {
  return candidates
    .filter((s) => s.isTest && s.soldOn !== null && s.soldOn.startsWith("2001-") && s.cancelledOn === null)
    .sort((a, b) => a.saleId - b.saleId)[0] ?? null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Payload = any;

/** The smallest valid upload: one file, one order, one line, one exact match — no finding. */
export function miniPayload(run: string, sale: Pick<LedgerSale, "saleId" | "soldOn" | "updatedAt">): Payload {
  const ref = `VRF${run}-0001`;
  return {
    channel: "ebay", parser: "ebay-orders-report-de", parserVersion: 1,
    coverage: { coveredFrom: sale.soldOn, coveredTo: sale.soldOn, recordFirst: 1, recordLast: 1, chainComplete: true },
    summary: { categories: { exact: 1 } },
    files: [{ fileName: `verify-recon-refusals-${run}.csv`, fingerprint: sha(`verify-recon-refusals:${run}`), footerCount: 1,
      orders: 1, firstSoldOn: sale.soldOn, lastSoldOn: sale.soldOn, recordFirst: 1, recordLast: 1 }],
    orders: [{ orderRef: ref, recordNo: 1, soldOn: sale.soldOn, paidOn: null, shippedOn: null,
      itemsValue: 1, shipping: 0, total: 1, pieces: 1, combined: false, destinationCountry: "DE",
      shippingService: null, sourceFile: `verify-recon-refusals-${run}.csv`,
      lines: [{ lineRef: "1", listingId: "1", title: "Testposition", variant: null, name: "Testfigur",
        quantity: 1, unitPrice: 1, value: 1 }] }],
    matches: [{ orderRef: ref, saleId: sale.saleId, saleUpdatedAt: sale.updatedAt, category: "exact",
      certainty: "deterministic", score: 100, dateDelta: 0, competitors: [], reason: null, findings: [] }],
  };
}

/** The two contents the first run found unrefused on a known upload. */
export const FORBIDDEN: readonly [string, (p: Payload) => void][] = [
  ["an unknown buyerName field", (p) => { p.orders[0].buyerName = "x"; }],
  ["an e-mail address in free text", (p) => { p.orders[0].lines[0].title = "Fragen an test@example.invalid"; }],
];

/** What must never appear in anything the database returns for the session. */
export const FORBIDDEN_MARKERS = ["buyerName", "example.invalid"] as const;

/** The same content as a NEW upload: its own file fingerprint, so nothing is recognised. */
export function asNewUpload(p: Payload, run: string): Payload {
  const copy = structuredClone(p);
  copy.files[0].fingerprint = sha(`verify-recon-refusals:${run}:new`);
  return copy;
}

/** `0176` stands when the check function exists but the operator may not call it. */
export function validatorState(error: { code?: string; message?: string } | null): "present" | "missing" | "open" {
  if (error === null) return "open";
  if (error.code === "42501") return "present";
  return "missing";
}

// ---------------------------------------------------------------------------
// Staging
// ---------------------------------------------------------------------------

/** A database call's result, or the run stops — nothing is awaited and dropped. */
function must<T>(r: { data: T; error: { message: string; code?: string } | null }, label: string): T {
  if (r.error) throw new Error(`${label}: ${r.error.message}`);
  return r.data;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. Run through npm, which loads .env.staging.`);
    process.exit(1);
  }
  return value;
}

type SessionRow = { id: number; state: string; decided: number; applied: number };

async function main(): Promise<void> {
  // FIRST: the target is Staging, or nothing else happens.
  requireStaging("verify:recon-refusals");
  // `.env.staging` carries the service-role key for other tools. This one never needs it.
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apply = process.argv.includes("--apply");
  const RUN = Date.now().toString(36);
  heading(`Ablehnungsprobe 0176 auf Staging — ${apply ? "SCHREIBEND (--apply)" : "TROCKENLAUF"} · Lauf ${RUN}`);

  const URL_ = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const ANON = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  ladeUmgebung(OPERATOR_ENV_FILE);
  const EMAIL = process.env.SKYISLES_STAGING_OPERATOR_EMAIL;
  const PASSWORD = process.env.SKYISLES_STAGING_OPERATOR_PASSWORD;
  if (!EMAIL || !PASSWORD) {
    console.error(`Die Zugangsdaten des Staging-Betriebskontos fehlen (${OPERATOR_ENV_FILE}).`);
    process.exit(1);
  }
  const op = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  let mini: number | null = null;
  let miniDone = false;

  try {
    heading("Voraussetzungen (lesend)");
    const signIn = await op.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
    // The message only — never the address, never the password.
    if (signIn.error) throw new Error(`sign-in as the Staging operator failed: ${signIn.error.message}`);
    check("signed in as the existing Staging operator (no account created)", true);

    const probe = await op.rpc("sales_recon_validate_payload", { p_payload: {} });
    const state = validatorState(probe.error);
    check("0176 stands: the check function exists and is closed to the operator", state === "present",
          state === "missing" ? `nicht gefunden (${probe.error?.code ?? "?"})` : state === "open" ? "für das Betriebskonto AUSFÜHRBAR" : "42501");

    const sessions = () => op.rpc("seller_recon_sessions", {});
    const before = must(await sessions(), "sessions") as SessionRow[];
    check("the operator functions answer", true, `${before.length} Sitzungen, offen ${before.filter((s) => s.state === "open").length}`);

    const candidates = ledgerSales(must(await op.rpc("seller_recon_candidates",
      { p_channel: "ebay", p_from: TEST_PERIOD.from, p_to: TEST_PERIOD.to }), "candidates"));
    const sale = pickTestSale(candidates);
    check("a test sale of 2001 is there to lean on (is_test, not cancelled)", sale !== null,
          sale ? `Verkauf ${sale.saleId} · ${candidates.filter((c) => c.isTest).length} Testverkäufe in 2001` : "keiner");
    if (sale === null || state !== "present") throw new Error("preconditions not met — nothing written");

    const valid = miniPayload(RUN, sale);
    if (!apply) {
      heading("Was --apply tun würde");
      console.log(`  2 neue Uploads mit verbotenem Inhalt — müssen abgewiesen werden, nichts entsteht`);
      console.log(`  1 Mini-Sitzung über Testverkauf ${sale.saleId}: 1 Datei, 1 Bestellung, 1 Position, 1 Zuordnung, kein Befund`);
      console.log(`  2 bekannte Uploads mit verbotenem Inhalt — müssen abgewiesen werden, Sitzung unverändert`);
      console.log(`  derselbe gültige Upload erneut — dieselbe Sitzung`);
      console.log(`  keine Entscheidung, keine Anwendung, kein Verkauf verändert; danach Verwerfen als Testschritt`);
      console.log("  Vorher und nachher: supabase/checks/verify_sales_reconciliation_state.sql als postgres.");
      console.log("  Nichts geschrieben.");
      return; // `finally` signs out and ends the run.
    }

    heading("1. Neue Uploads mit verbotenem Inhalt");
    for (const [what, spoil] of FORBIDDEN) {
      const p = asNewUpload(valid, RUN);
      spoil(p);
      const r = await op.rpc("seller_recon_create", { p_payload: p });
      check(`${what} is refused (new upload)`, r.error !== null, r.error ? "" : `angenommen — Sitzung ${String(r.data)}`);
    }
    check("no refused new upload created a session",
          (must(await sessions(), "sessions") as SessionRow[]).length === before.length);

    heading("2. Die Mini-Sitzung");
    mini = Number(must(await op.rpc("seller_recon_create", { p_payload: valid }), "create mini session"));
    check("one valid mini session is created", !before.some((s) => s.id === mini), `Sitzung ${mini}`);
    const view = async () => JSON.stringify(must(await op.rpc("seller_recon_session", { p_id: mini, p_offset: 0, p_limit: 50 }), "session"));
    const view0 = await view();

    heading("3. Bekannte Uploads mit verbotenem Inhalt");
    for (const [what, spoil] of FORBIDDEN) {
      const p = structuredClone(valid);
      spoil(p);
      const r = await op.rpc("seller_recon_create", { p_payload: p });
      check(`${what} is refused (known upload)`, r.error !== null, r.error ? "" : `angenommen — Sitzung ${String(r.data)}`);
    }
    const view1 = await view();
    check("the refused calls left the session byte for byte unchanged", view1 === view0);
    check("nothing forbidden is stored", FORBIDDEN_MARKERS.every((m) => !view1.includes(m)));

    heading("4. Derselbe gültige Upload");
    const again = Number(must(await op.rpc("seller_recon_create", { p_payload: valid }), "create again"));
    check("the valid upload again returns the same session", again === mini, `${again}`);
    check("and changes nothing", (await view()) === view0);

    heading("5. Keine Entscheidung, keine Anwendung, kein Verkauf");
    const after = must(await sessions(), "sessions") as SessionRow[];
    const row = after.find((s) => s.id === mini);
    check("no decision and no application in the mini session", row !== undefined && row.decided === 0 && row.applied === 0,
          row ? `entschieden ${row.decided}, angewendet ${row.applied}` : "nicht gefunden");
    check("exactly one session more than before", after.length === before.length + 1);
    const saleAfter = pickTestSale(ledgerSales(must(await op.rpc("seller_recon_candidates",
      { p_channel: "ebay", p_from: TEST_PERIOD.from, p_to: TEST_PERIOD.to }), "candidates")));
    check("the test sale is untouched", saleAfter !== null && saleAfter.saleId === sale.saleId && saleAfter.updatedAt === sale.updatedAt);

    heading("6. Verwerfen — ausdrücklicher Testschritt");
    const discarded = await op.rpc("seller_recon_discard", { p_id: mini });
    check("the mini session is discarded", !discarded.error, discarded.error?.message ?? `Sitzung ${mini}`);
    miniDone = !discarded.error;
  } catch (error) {
    check("the run completed", false, (error as Error).message);
  } finally {
    heading("Nachweis");
    // NOTHING IS CLEANED UP AUTOMATICALLY: an open mini session fails the run and is named.
    if (mini !== null && !miniDone) {
      check(`mini session ${mini} was left open`, false, "verwerfen ist Entscheidung des Betriebs (Zeile 206 der Zustandsdatei)");
    }
    const out = await op.auth.signOut();
    check("signed out", !out.error, out.error?.message ?? "");
    console.log(`\n  Lauf ${RUN} · Mini-Sitzung ${mini ?? "keine"}`);
    if (apply) console.log("  Abnahme: supabase/checks/verify_sales_reconciliation_state.sql als postgres — 101–108 wie vorher.");
    finish();
  }
}

function finish(): void {
  const failed = results.filter((r) => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} bestanden`);
  process.exit(failed.length === 0 ? 0 : 1);
}

if (process.argv[1]?.endsWith("verify-recon-refusals.mts")) void main();
