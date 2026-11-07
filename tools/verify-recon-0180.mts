/**
 * The acceptance of 0180 on Staging (ADR-0178) — the refusals through
 * PostgREST, and the verdict over all three parts.
 *
 *   npm run verify:recon-0180:staging                                   offline: what it would check
 *   npm run verify:recon-0180:staging -- --live                         the refusals, on Staging
 *   npm run verify:recon-0180:staging -- --live --evidence-b <file> --evidence-c <file>
 *
 * IT CREATES NOTHING ON STAGING. No sale, no session, no decision. Every
 * call it makes is one 0180 must REFUSE before it writes: the retired apply,
 * a malformed selection or token, an unknown session, the anonymous key. (A
 * sign-in itself is Supabase's bookkeeping in `auth`, as for every tool that
 * signs in as the operator.) What needs data — an applied correction, the
 * test-sale lock of the regular path, refunds, cancellations, stale sales,
 * the reference of a `unique` pair, a new analysis — is the rolled-back probe
 * `supabase/operations/staging-0180-probe.sql` (part B); real concurrency is
 * `npm run test:recon-pg` (part C).
 *
 * THE VERDICT IS COMPLETE ONLY WITH ALL THREE. Without both evidence files a
 * clean live run ends with exit 3, "incomplete" — never as passed.
 *
 *   --evidence-b  a text file with the probe's final message, as the SQL
 *                 editor showed it: `PRUEFLAUF 0180 ZURUECKGEROLLT — n/n
 *                 bestanden | …`, with n = PROBE_CHECKS and no `FEHLT`;
 *   --evidence-c  the JSON report of `npm run test:recon-pg -- --reporter=json
 *                 --outputFile=<file>`: the concurrency file ran, none of its
 *                 tests skipped or failed.
 *
 * STAGING ONLY (`requireStaging()` before any client), no service role, the
 * existing operator's credentials from `~/.skyisles/staging-operator.env`,
 * never printed. Logs carry codes and counts only.
 */
import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

import { ladeUmgebung } from "./lib/staging-db.mts";
import { requireStaging } from "./lib/staging-guard.mts";
import { OPERATOR_ENV_FILE } from "./verify-sales-reconciliation.mts";

/** The number of checks the probe reports (`staging-0180-probe.sql`). */
export const PROBE_CHECKS = 32;
/** The tests of `src/lib/reconciliation/pg/concurrency-0180.test.ts` that must have run and passed. */
export const CONCURRENCY_TESTS = 6;
const CONCURRENCY_FILE = "concurrency-0180.test.ts";

type Result = { name: string; passed: boolean; detail: string };

/** Part B: the probe's final message — every check passed, nothing missing. */
export function probeEvidence(text: string | null): { ok: boolean; why: string } {
  if (text === null) return { ok: false, why: "kein Nachweis" };
  const head = `PRUEFLAUF 0180 ZURUECKGEROLLT — ${PROBE_CHECKS}/${PROBE_CHECKS} bestanden`;
  if (!text.includes(head)) return { ok: false, why: `die Zeile „${head}“ fehlt` };
  if (text.includes("FEHLT")) return { ok: false, why: "eine Pruefung FEHLT" };
  const done = [...text.matchAll(/\| (\d+) ok /g)].map((m) => Number(m[1]));
  if (done.length !== PROBE_CHECKS || new Set(done).size !== PROBE_CHECKS) return { ok: false, why: `${done.length} einzelne Pruefungen` };
  return { ok: true, why: `${PROBE_CHECKS}/${PROBE_CHECKS}` };
}

/** Part C: the vitest JSON report of the real-server run. */
export function concurrencyEvidence(text: string | null): { ok: boolean; why: string } {
  if (text === null) return { ok: false, why: "kein Nachweis" };
  let report: { testResults?: { name: string; assertionResults?: { status: string; ancestorTitles?: string[] }[] }[] };
  try {
    report = JSON.parse(text);
  } catch {
    return { ok: false, why: "kein JSON-Bericht von vitest" };
  }
  const file = report.testResults?.find((t) => t.name.endsWith(CONCURRENCY_FILE));
  if (!file) return { ok: false, why: `${CONCURRENCY_FILE} lief nicht` };
  const real = (file.assertionResults ?? []).filter((a) => (a.ancestorTitles ?? []).some((t) => t.startsWith("0180 on a real PostgreSQL")));
  const passed = real.filter((a) => a.status === "passed").length;
  if (real.length !== CONCURRENCY_TESTS || passed !== CONCURRENCY_TESTS) {
    return { ok: false, why: `${passed} von ${real.length} Tests bestanden, ${CONCURRENCY_TESTS} verlangt (übersprungen zählt nicht)` };
  }
  return { ok: true, why: `${passed}/${CONCURRENCY_TESTS}` };
}

/** 0 complete · 1 a check failed · 3 incomplete (a part not proven). */
export function verdict(results: readonly Result[], live: boolean, b: { ok: boolean }, c: { ok: boolean }): 0 | 1 | 3 {
  if (results.some((r) => !r.passed)) return 1;
  return live && b.ok && c.ok ? 0 : 3;
}

const argValue = (flag: string): string | null => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
};
const readEvidence = (flag: string): string | null => {
  const path = argValue(flag);
  return path && existsSync(path) ? readFileSync(path, "utf8") : null;
};

async function main(): Promise<void> {
  requireStaging("verify:recon-0180");
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const live = process.argv.includes("--live");
  const results: Result[] = [];
  const check = (name: string, passed: boolean, detail = "") => {
    results.push({ name, passed, detail });
    console.log(`  ${passed ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  };

  console.log(`\nAbnahme 0180 auf Staging — ${live ? "LIVE (nur Ablehnungen, schreibfrei)" : "OFFLINE"}\n`);
  if (live) {
    const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!URL_ || !ANON) throw new Error("Run through npm, which loads .env.staging.");
    ladeUmgebung(OPERATOR_ENV_FILE);
    const EMAIL = process.env.SKYISLES_STAGING_OPERATOR_EMAIL;
    const PASSWORD = process.env.SKYISLES_STAGING_OPERATOR_PASSWORD;
    const missing = !EMAIL || !PASSWORD;
    if (missing) throw new Error(`Die Zugangsdaten des Staging-Betriebskontos fehlen (${OPERATOR_ENV_FILE}).`);
    const client = () => createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
    const op = client();
    const signIn = await op.auth.signInWithPassword({ email: EMAIL as string, password: PASSWORD as string });
    if (signIn.error) throw new Error("sign-in as the Staging operator failed");
    try {
      const code = (r: { error: { code?: string } | null }) => r.error?.code ?? "angenommen";
      const preview = await op.rpc("seller_recon_preview", { p_session_id: 0, p_decision_ids: [1] });
      if (preview.error?.code === "PGRST202") throw new Error("0180 is not on Staging (seller_recon_preview missing)");
      check("an unknown session is refused by the preview (P0002)", preview.error?.code === "P0002", code(preview));
      for (const [what, ids] of [["an empty selection", []], ["a doubled id", [1, 1]], ["501 ids", Array.from({ length: 501 }, (_, i) => i + 1)]] as const) {
        const r = await op.rpc("seller_recon_preview", { p_session_id: 0, p_decision_ids: ids });
        check(`${what} is refused before anything is read (23514)`, r.error?.code === "23514", code(r));
      }
      for (const [what, token] of [["no token", null], ["a malformed token", "x"], ["an upper-case token", "A".repeat(64)]] as const) {
        const r = await op.rpc("seller_recon_apply", { p_session_id: 0, p_decision_ids: [1], p_token: token });
        check(`apply with ${what} is refused before any lock (23514)`, r.error?.code === "23514", code(r));
      }
      const unknown = await op.rpc("seller_recon_apply", { p_session_id: 0, p_decision_ids: [1], p_token: "0".repeat(64) });
      check("apply on an unknown session is refused (P0002)", unknown.error?.code === "P0002", code(unknown));
      const retired = await op.rpc("seller_recon_apply", { p_session_id: 0, p_expected: 0 });
      check("the retired apply(session, expected) is not callable for the operator", retired.error !== null, code(retired));
      const anon = client();
      check("anon cannot preview", (await anon.rpc("seller_recon_preview", { p_session_id: 0, p_decision_ids: [1] })).error !== null);
      check("anon cannot apply", (await anon.rpc("seller_recon_apply", { p_session_id: 0, p_decision_ids: [1], p_token: "0".repeat(64) })).error !== null);
      check("anon cannot decide", (await anon.rpc("seller_recon_decide", { p_finding_id: 1, p_decision: "keep_ledger", p_manual_value: null,
        p_reason: null, p_shown_ledger: null, p_shown_external: null })).error !== null);
    } finally {
      // This session only: the default scope "global" would end every session of the operator.
      await op.auth.signOut({ scope: "local" });
    }
  } else {
    console.log("  Keine Verbindung. --live prüft die Ablehnungen über PostgREST, ohne etwas anzulegen.");
  }

  const b = probeEvidence(readEvidence("--evidence-b"));
  const c = concurrencyEvidence(readEvidence("--evidence-c"));
  console.log(`\n  Teil B (Prüflauf, zurückgerollt): ${b.ok ? "belegt" : "OFFEN"} — ${b.why}`);
  console.log(`  Teil C (echte Parallelität, lokal): ${c.ok ? "belegt" : "OFFEN"} — ${c.why}`);
  const v = verdict(results, live, b, c);
  console.log(`\n${results.filter((r) => r.passed).length}/${results.length} Ablehnungen bestanden · ${
    v === 0 ? "VOLLSTÄNDIG" : v === 1 ? "FEHLGESCHLAGEN" : "UNVOLLSTÄNDIG — keine Abnahme"}`);
  process.exit(v);
}

if (process.argv[1]?.endsWith("verify-recon-0180.mts")) {
  main().catch((error: Error) => {
    console.error(`  FAIL  ${error.message}`);
    process.exit(1);
  });
}
