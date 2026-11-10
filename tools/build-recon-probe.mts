/**
 * Builds `supabase/operations/staging-0180-probe.sql` — the rolled-back
 * Staging probe of 0180 (ADR-0178, variant B).
 *
 *   node tools/build-recon-probe.mts           print what it would write
 *   node tools/build-recon-probe.mts --write   write the file
 *   node tools/build-recon-probe.mts --check   exit 1 if the file is not what it would write
 *   npm run probe:recon-0180:staging           (--run-file) the two files for the SQL editor
 *
 * THE FIRST THREE READ ONLY THE REPOSITORY. No database, no network, no
 * environment file.
 *
 * --run-file NAMES THE OPERATOR (riegel R7). Staging has several enabled
 * operator accounts; the probe takes none of them on its own. This mode, after
 * `requireStaging()` and without the service role, signs in once as the
 * existing Staging operator (`~/.skyisles/staging-operator.env`), keeps
 * nothing but the user id of that sign-in, signs out (this session only) and
 * writes, into the ignored `supabase/log/staging/`:
 *
 *   0180-probe-lauf.sql          the committed probe, character for character
 *                                (checked against the generator and
 *                                `SHA256SUMS.txt`), with ONE line after
 *                                `begin;` naming that account;
 *   0180-probe-riegel-vorab.sql  R1–R7 as a table, for the same account.
 *
 * It calls no function and reads no table on Staging; besides Supabase's own
 * sign-in bookkeeping in `auth` it writes nothing there. No credential, token
 * or full id is printed; the id is in the two ignored files only.
 *
 * THE COPIES. The probe needs the 0180 judgement and apply WITHOUT the
 * test-sale refusal — and nowhere else different. So the six functions are
 * cut out of `0180_sales_recon_selected_apply.sql` character for character
 * and changed by exactly the replacements in `REPLACEMENTS`, each with the
 * number of hits it must have. A replacement that hits more or less often,
 * a body whose md5 differs from the one 0180's own postcondition demands, a
 * function a later migration redefines — and the build stops.
 *
 * THE ONE CHANGE OF SUBSTANCE: where 0180 refuses a test sale (`test_sale`),
 * the copy refuses every sale that is NOT a test sale this run created
 * (`not_probe`, checked against `pg_temp.probe_sales`). The copy can never
 * reach a real sale; the regular functions keep refusing test sales.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

import { ladeUmgebung } from "./lib/staging-db.mts";
import { requireStaging } from "./lib/staging-guard.mts";

const MIG = "supabase/migrations";
const M0180 = "0180_sales_recon_selected_apply.sql";
export const PROBE_FILE = "supabase/operations/staging-0180-probe.sql";
const TEMPLATE = "tools/recon-probe/probe-template.sql.tpl";

const read = (file: string): string => readFileSync(`${MIG}/${file}`, "utf8");

/** A function as a migration defines it: the whole statement and its `prosrc`. */
export type Definition = { statement: string; prosrc: string };

/** The definition starting with `header` in `file` — exactly one. */
export function definition(file: string, header: string): Definition {
  const sql = read(file);
  const start = sql.indexOf(header);
  if (start < 0 || sql.indexOf(header, start + 1) >= 0) throw new Error(`${file}: "${header}" is not there exactly once`);
  const open = sql.indexOf("as $$", start);
  const close = sql.indexOf("\n$$;", open);
  if (open < 0 || close < 0) throw new Error(`${file}: no body after "${header}"`);
  return { statement: sql.slice(start, close + 4), prosrc: sql.slice(open + "as $$".length, close + 1) };
}

export const md5 = (text: string): string => createHash("md5").update(text, "utf8").digest("hex");

/**
 * Every function the probe uses, as the migration that defines it TODAY.
 * `signature` is what `to_regprocedure` reads; the probe compares the md5
 * of each body on Staging before anything else (riegel R4).
 */
export const USED: readonly { signature: string; file: string; header: string }[] = [
  // 0180 — the copied six, and what they call
  { signature: "sales_recon_take_check(bigint)", file: M0180, header: "create or replace function public.sales_recon_take_check(" },
  { signature: "sales_recon_decision_problem(bigint,bigint)", file: M0180, header: "create or replace function public.sales_recon_decision_problem(" },
  { signature: "sales_recon_selection(bigint,bigint[])", file: M0180, header: "create or replace function public.sales_recon_selection(" },
  { signature: "seller_recon_preview(bigint,bigint[])", file: M0180, header: "create or replace function public.seller_recon_preview(" },
  { signature: "seller_recon_apply(bigint,bigint[],text)", file: M0180,
    header: "create or replace function public.seller_recon_apply(p_session_id bigint, p_decision_ids bigint[], p_token text)" },
  { signature: "seller_recon_decide(bigint,text,jsonb,text,jsonb,jsonb)", file: M0180, header: "create or replace function public.seller_recon_decide(" },
  { signature: "sales_recon_allowed_0180(text)", file: M0180, header: "create or replace function public.sales_recon_allowed_0180(" },
  { signature: "sales_recon_check_selection(bigint[])", file: M0180, header: "create or replace function public.sales_recon_check_selection(" },
  { signature: "seller_recon_pending(bigint)", file: M0180, header: "create or replace function public.seller_recon_pending(" },
  { signature: "seller_recon_apply(bigint,integer)", file: M0180,
    header: "create or replace function public.seller_recon_apply(p_session_id bigint, p_expected integer)" },
  // what the probe reads and writes through, untouched by 0180
  { signature: "seller_recon_create(jsonb)", file: "0176_sales_recon_validate_before_dedup.sql", header: "create or replace function public.seller_recon_create(" },
  { signature: "seller_recon_session(bigint,text,integer,integer)", file: "0179_sales_recon_ledger_proof.sql", header: "create or replace function public.seller_recon_session(" },
  { signature: "sales_recon_ledger(bigint)", file: "0179_sales_recon_ledger_proof.sql", header: "create or replace function public.sales_recon_ledger(" },
  { signature: "sales_recon_proven(jsonb,text,jsonb,boolean)", file: "0179_sales_recon_ledger_proof.sql", header: "create or replace function public.sales_recon_proven(" },
  { signature: "sales_recon_pending_set(bigint)", file: "0178_sales_recon_comparison_and_pending.sql", header: "create or replace function public.sales_recon_pending_set(" },
  { signature: "sales_recon_sale_values(bigint)", file: "0178_sales_recon_comparison_and_pending.sql", header: "create or replace function public.sales_recon_sale_values(" },
  { signature: "sales_recon_gate()", file: "0172_sales_reconciliation_rpcs.sql", header: "create or replace function public.sales_recon_gate(" },
  { signature: "seller_update_sale(bigint,date,boolean,text,numeric,numeric,numeric,text,text,text,timestamptz)", file: "0091_update_sale_date_range.sql", header: "create or replace function public.seller_update_sale(" },
  { signature: "orderbook_guard_stale(bigint,timestamptz)", file: "0062_orderbook_sale_maintenance.sql", header: "create or replace function public.orderbook_guard_stale(" },
  { signature: "orderbook_log(bigint,text,bigint,text,text,text,text)", file: "0062_orderbook_sale_maintenance.sql", header: "create or replace function public.orderbook_log(" },
  { signature: "orderbook_touch_sale(bigint)", file: "0062_orderbook_sale_maintenance.sql", header: "create or replace function public.orderbook_touch_sale(" },
  { signature: "seller_add_sale_refund(bigint,numeric,timestamptz,text,text,text)", file: "0062_orderbook_sale_maintenance.sql", header: "create or replace function public.seller_add_sale_refund(" },
  // 0170's body plus the lock block of 0189 (M-05C) — see SUCCESSORS
  { signature: "seller_cancel_external_sale(bigint,text,date,timestamptz)", file: "0189_external_cancel_lock_order.sql", header: "create or replace function public.seller_cancel_external_sale(" },
];

/**
 * KNOWN SUCCESSORS. A later migration that redefines a used function stops
 * the build (`usedHashes`), because the probe would then pin a body Staging
 * does not hold, or a body nobody checked. A redefinition passes ONLY when it
 * is listed here: USED points at the successor, and both bodies are pinned —
 * the predecessor the probe was accepted with, and the successor it pins
 * now. Any other redefinition, or any further change to either file, still
 * stops the build.
 *
 * `0189` (M-05C) puts a lock block before 0170's body of
 * `seller_cancel_external_sale` and keeps the rest word for word (checked in
 * `src/lib/orderbook/staging-0188-0189.test.ts`). The probe calls it once on
 * a test sale of its own; the locks change nothing for a single session.
 * Consequence: the probe pins 0189's body, so on a Staging without 0189 it
 * stops at R4 before anything else — it never runs against an unchecked body.
 * `0188` redefines `seller_delete_sale`, which the probe does not use.
 */
export const SUCCESSORS: readonly { signature: string; from: string; fromMd5: string; by: string; byMd5: string }[] = [
  { signature: "seller_cancel_external_sale(bigint,text,date,timestamptz)",
    from: "0170_external_sale_cancel.sql", fromMd5: "8b6496f3c20f8b706db7eb1df2d8c32b",
    by: "0189_external_cancel_lock_order.sql", byMd5: "1a67b44de9da7fa96349aa197a05c027" },
];

/** The six functions copied into pg_temp, by their header in 0180. */
export const COPIED = [
  "sales_recon_take_check", "sales_recon_decision_problem", "sales_recon_selection",
  "seller_recon_preview", "seller_recon_apply", "seller_recon_decide",
] as const;
export type Copied = (typeof COPIED)[number];

const headerOf = (name: Copied): string => USED.find((u) => u.file === M0180 && u.header.startsWith(`create or replace function public.${name}(`)
  && (name !== "seller_recon_apply" || u.header.includes("p_token")))!.header;

/** A replacement and the number of times it must hit in one function. */
export type Replacement = { from: string; to: string; count: number; why: string };

const PROBE_REF = "(not s2.is_test or s2.id in (select p.sale_id from pg_temp.probe_sales p))";

/** EVERY difference between a copy and its 0180 original — nothing else may differ. */
export const REPLACEMENTS: Record<Copied, readonly Replacement[]> = {
  sales_recon_take_check: [
    { from: "create or replace function public.sales_recon_take_check(", to: "create function pg_temp.probe_sales_recon_take_check(", count: 1,
      why: "der Name: in pg_temp, nicht dauerhaft" },
    { from: "  if s.is_test then return 'test_sale'; end if;",
      to: "  if not s.is_test or not exists (select 1 from pg_temp.probe_sales p where p.sale_id = s.id) then return 'not_probe'; end if;",
      count: 1, why: "DIE Ausnahme, umgekehrt: nur ein Testverkauf dieses Laufs, nie ein echter" },
    { from: "not s2.is_test", to: PROBE_REF, count: 2,
      why: "vergebene Nummer und Rivale: die Testverkaeufe dieses Laufs zaehlen mit (sonst wuerden sie uebersehen)" },
  ],
  sales_recon_decision_problem: [
    { from: "create or replace function public.sales_recon_decision_problem(", to: "create function pg_temp.probe_sales_recon_decision_problem(", count: 1, why: "der Name" },
    { from: "public.sales_recon_take_check(", to: "pg_temp.probe_sales_recon_take_check(", count: 1, why: "ruft die Kopie" },
  ],
  sales_recon_selection: [
    { from: "create or replace function public.sales_recon_selection(", to: "create function pg_temp.probe_sales_recon_selection(", count: 1, why: "der Name" },
    { from: "public.sales_recon_decision_problem(", to: "pg_temp.probe_sales_recon_decision_problem(", count: 1, why: "ruft die Kopie" },
  ],
  seller_recon_preview: [
    { from: "create or replace function public.seller_recon_preview(", to: "create function pg_temp.probe_seller_recon_preview(", count: 1, why: "der Name" },
    { from: "public.sales_recon_selection(", to: "pg_temp.probe_sales_recon_selection(", count: 1, why: "ruft die Kopie" },
  ],
  seller_recon_apply: [
    { from: "create or replace function public.seller_recon_apply(", to: "create function pg_temp.probe_seller_recon_apply(", count: 1, why: "der Name" },
    { from: "public.sales_recon_selection(", to: "pg_temp.probe_sales_recon_selection(", count: 1, why: "ruft die Kopie" },
    { from: "not s2.is_test", to: PROBE_REF, count: 1, why: "die Nummernpruefung beim Schreiben, wie in der Kopie des Nachweises" },
  ],
  seller_recon_decide: [
    { from: "create or replace function public.seller_recon_decide(", to: "create function pg_temp.probe_seller_recon_decide(", count: 1, why: "der Name" },
    { from: "public.sales_recon_take_check(", to: "pg_temp.probe_sales_recon_take_check(", count: 1, why: "ruft die Kopie" },
  ],
};

const hits = (text: string, needle: string): number => text.split(needle).length - 1;

/** One copy: the 0180 statement, the replacements applied with their exact counts. */
export function probeCopy(name: Copied): { regular: string; probe: string } {
  const regular = definition(M0180, headerOf(name)).statement;
  let probe = regular;
  for (const r of REPLACEMENTS[name]) {
    const n = hits(probe, r.from);
    if (n !== r.count) throw new Error(`${name}: "${r.from}" hits ${n} times, expected ${r.count}`);
    probe = probe.split(r.from).join(r.to);
  }
  // Nothing of the regular chain may be left in a copy.
  for (const leftover of ["public.sales_recon_take_check(", "public.sales_recon_decision_problem(", "public.sales_recon_selection(",
    "'test_sale'", "create or replace function public."]) {
    if (probe.includes(leftover)) throw new Error(`${name}: "${leftover}" is left in the copy`);
  }
  return { regular, probe };
}

/** The bodies 0180 demands of itself (its postcondition). */
export function postconditionHashes(): Map<string, string> {
  const post = read(M0180).split("do $post$")[1];
  return new Map([...post.matchAll(/\('([a-z_0-9]+\([^)]*\))', '([0-9a-f]{32})'\)/g)].map((m) => [m[1], m[2]]));
}

/** Signature → md5 of its body, checked against 0180's postcondition and against later redefinitions. */
export function usedHashes(): [string, string][] {
  const post = postconditionHashes();
  const files = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
  for (const k of SUCCESSORS) {
    const u = USED.find((x) => x.signature === k.signature);
    if (!u || u.file !== k.by) throw new Error(`${k.signature}: successor ${k.by} is listed, but USED does not point at it`);
    const before = md5(definition(k.from, u.header).prosrc);
    if (before !== k.fromMd5) throw new Error(`${k.signature}: body in ${k.from} is ${before}, not the known ${k.fromMd5}`);
    const after = md5(definition(k.by, u.header).prosrc);
    if (after !== k.byMd5) throw new Error(`${k.signature}: body in ${k.by} is ${after}, not the known ${k.byMd5}`);
  }
  return USED.map((u) => {
    const hash = md5(definition(u.file, u.header).prosrc);
    if (post.has(u.signature) && post.get(u.signature) !== hash) {
      throw new Error(`${u.signature}: body md5 ${hash} is not 0180's ${post.get(u.signature)}`);
    }
    const name = u.signature.slice(0, u.signature.indexOf("("));
    for (const later of files.filter((f) => f > u.file)) {
      if (read(later).includes(`function public.${name}(`) && !(later === M0180 && u.file === M0180)) {
        throw new Error(`${u.signature}: ${later} redefines it after ${u.file}`);
      }
    }
    return [u.signature, hash];
  });
}

/** The triggers the migrations put on the tables the probe touches — any other one stops it (R5). */
export const KNOWN_TRIGGERS = [
  "sales.sales_set_day_and_index_trg=sales_set_day_and_index",
  "sale_items.sale_items_no_historical_movement_trg=sale_items_no_historical_movement",
  "sales_recon_decisions.sales_recon_decisions_append_only=sales_recon_evidence_is_append_only",
  "sales_recon_applications.sales_recon_applications_append_only=sales_recon_evidence_is_append_only",
] as const;

/** The functions the probe creates in pg_temp — the copies and its own tools. */
export const TEMP_FUNCTIONS = [
  ...COPIED.map((n) => `probe_${n}`),
  "probe_record", "probe_expect", "probe_sale", "probe_session", "probe_finding", "probe_decide_on", "probe_fingerprints",
] as const;

export function buildProbe(): string {
  const template = readFileSync(TEMPLATE, "utf8");
  const md5Rows = usedHashes().map(([sig, hash], i, all) => `      ('${sig}', '${hash}')${i < all.length - 1 ? "," : ""}`).join("\n");
  const triggers = KNOWN_TRIGGERS.map((t, i) => `       '${t}'${i < KNOWN_TRIGGERS.length - 1 ? "," : ""}`).join("\n");
  const copies = COPIED.map((n) => `-- >>> KOPIE von public.${n} (0180), Ersetzungen: ${REPLACEMENTS[n].length}\n${probeCopy(n).probe}\n-- <<< ENDE KOPIE ${n}`).join("\n\n");
  // Replacer FUNCTIONS: a string replacement would read the `$$` of the bodies as patterns.
  const filled = template
    .replace("@@MD5_ROWS@@", () => md5Rows)
    .replace("@@KNOWN_TRIGGERS@@", () => triggers)
    .replace("@@PROBE_FUNCTIONS@@", () => copies)
    .replace("@@TEMP_NAMES@@", () => TEMP_FUNCTIONS.map((n) => `'${n}'`).join(", "))
    .replace("@@TEMP_COUNT@@", () => String(TEMP_FUNCTIONS.length));
  if (filled.includes("@@")) throw new Error("a placeholder is left in the template");
  return filled;
}

// ---------------------------------------------------------------------------
// The run files: the probe and the riegel check, for ONE named operator (R7)
// ---------------------------------------------------------------------------

/** Ignored by git (`supabase/log/`): the only place an operator id is written. */
export const RUN_DIR = "supabase/log/staging";
export const RUN_FILE = `${RUN_DIR}/0180-probe-lauf.sql`;
export const PRECHECK_FILE = `${RUN_DIR}/0180-probe-riegel-vorab.sql`;
const SUMS_FILE = "supabase/SHA256SUMS.txt";
const EMBED_MARK = `-- >>> EINGEBETTET: ${PROBE_FILE}`;
/** The same pattern the probe's R7 applies: canonical, lower case, not the nil id. */
const ID_PATTERN = "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";

export const sha256 = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

export function isOperatorId(id: unknown): id is string {
  return typeof id === "string" && new RegExp(ID_PATTERN).test(id) && id !== "00000000-0000-0000-0000-000000000000";
}

/** For the terminal: never the whole id. */
export const shortId = (id: string): string => `${id.slice(0, 4)}…`;

/** The one line a run file adds. */
export const namingLine = (id: string): string =>
  `select set_config('skyisles.probe_operator', '${id}', true) is not null as betriebskonto_benannt;`;

const runHeader = (what: string): string => `-- =====================================================================
-- ${what}
--
-- ERZEUGT von \`npm run probe:recon-0180:staging\` (build-recon-probe.mts
-- --run-file). NICHT VON HAND AENDERN, NICHT VERSIONIEREN (supabase/log/).
-- Nur fuer Staging qqxcpesbwfxzgytkdsac, als postgres im SQL-Editor.
-- Die eine Zeile mit \`skyisles.probe_operator\` benennt das Staging-
-- Betriebskonto der Pruefwerkzeuge (Riegel R7); sonst nichts Eigenes.
-- =====================================================================
`;

/** The probe with the naming line after its `begin;` — nothing else added, nothing changed. */
export function runFile(probe: string, id: string): string {
  if (!isOperatorId(id)) throw new Error("not a valid operator id");
  const at = probe.indexOf("\nbegin;\n");
  if (at < 0 || probe.indexOf("\nbegin;\n", at + 1) >= 0) throw new Error("the probe has not exactly one begin;");
  const cut = at + "\nbegin;\n".length;
  return `${runHeader("0180 — PRUEFLAUF B, LAUFDATEI (die Pruefdatei + das benannte Betriebskonto)")}\n${EMBED_MARK}\n`
    + probe.slice(0, cut) + namingLine(id) + "\n" + probe.slice(cut);
}

/** The reverse: the embedded probe must come back character for character, and the one id with it. */
export function readRunFile(text: string): { probe: string; id: string } {
  const at = text.indexOf(`${EMBED_MARK}\n`);
  if (at < 0) throw new Error("no embedded probe");
  const body = text.slice(at + EMBED_MARK.length + 1);
  const lines = [...body.matchAll(/^select set_config\('skyisles\.probe_operator', '([^']*)', true\) is not null as betriebskonto_benannt;\n/gm)];
  if (lines.length !== 1) throw new Error(`${lines.length} naming lines, expected 1`);
  const id = lines[0][1];
  if (!isOperatorId(id)) throw new Error("the named id is not valid");
  const begin = body.indexOf("\nbegin;\n") + "\nbegin;\n".length;
  if (body.slice(begin, begin + lines[0][0].length) !== lines[0][0]) throw new Error("the naming line is not right after begin;");
  return { probe: body.slice(0, begin) + body.slice(begin + lines[0][0].length), id };
}

/** A part of the built probe between two markers, without its trailing `;`. */
function part(probe: string, from: string, to: string): string {
  const a = probe.indexOf(from);
  const b = probe.indexOf(to, a);
  if (a < 0 || b < 0 || probe.indexOf(from, a + 1) >= 0) throw new Error(`the probe has no unique "${from.slice(0, 40)}"`);
  const text = probe.slice(a, b).trimEnd();
  if (!text.endsWith(";")) throw new Error(`"${from.slice(0, 40)}" does not end with ;`);
  return text.slice(0, -1);
}

/**
 * R1–R7 as a table instead of an abort, for the same named account. R4's
 * list, R5's tables and allow-list and R6's columns are cut out of the built
 * probe, so the check cannot drift from what the probe will do. Each step of
 * R7 is its own statement (the identity changes between them) and leaves its
 * answer in a transaction-local setting the last statement reads.
 */
export function buildPrecheck(probe: string, id: string): string {
  if (!isOperatorId(id)) throw new Error("not a valid operator id");
  const r4From = probe.indexOf("  for v_fn, v_expected in values\n");
  if (r4From < 0 || probe.indexOf("  for v_fn, v_expected in values\n", r4From + 1) >= 0) throw new Error("the probe has no unique R4 list");
  const r4 = probe.slice(r4From + "  for v_fn, v_expected in values\n".length, probe.indexOf("\n  loop\n", r4From)).trimEnd();
  if (r4.split("\n").length !== usedHashes().length) throw new Error("the R4 list is not the probe's");
  // The two R5 queries share their first lines; each is cut out of its own statement.
  const r5aFrom = probe.indexOf("  select string_agg(c.relname || '.' || t.tgname, ', ' order by 1) into v_bad");
  const r5bFrom = probe.indexOf("  select string_agg(f.proname, ', ') into v_bad");
  if (r5aFrom < 0 || r5bFrom < r5aFrom) throw new Error("the probe has not the two R5 queries");
  const r5a = part(probe.slice(r5aFrom, r5bFrom), "   where not t.tgisinternal", "  if v_bad is not null then\n    raise exception 'ABBRUCH R5: unbekannte");
  const r5b = part(probe.slice(r5bFrom), "   where not t.tgisinternal", "  if v_bad is not null then\n    raise exception 'ABBRUCH R5: ein Trigger");
  const r6 = part(probe, "   where c.table_schema = 'public' and c.table_name in ('sales', 'sale_items')", "  if v_bad is not null then\n    raise exception 'ABBRUCH R6");
  const named = `case when coalesce(current_setting('skyisles.probe_operator', true), '') ~ '${ID_PATTERN}'
                 and current_setting('skyisles.probe_operator', true) <> '00000000-0000-0000-0000-000000000000'
            then current_setting('skyisles.probe_operator', true) else '' end`;
  const claims = (sub: string) => `set_config('request.jwt.claim.sub', ${sub}, true) is not null as sub_gesetzt,
       set_config('request.jwt.claims', case when ${sub} = '' then ''
                  else json_build_object('sub', ${sub}, 'role', 'authenticated')::text end, true) is not null as claims_gesetzt`;
  const gate = "public.can_operate_active_seller()";
  const uid = "(select auth.uid())";
  return `${runHeader("0180 — VORPRUEFUNG DER RIEGEL R1–R7 VOR PRUEFLAUF B, REIN LESEND")}
-- Dieselben Bedingungen wie die Riegel der Pruefdatei, als Tabelle statt
-- als Abbruch. Erwartet: jede Zeile ok = true, 9999 = 0. R7 setzt die
-- Identitaet transaktionslokal wie der Prueflauf: vorher keine, dann das
-- benannte Konto, dann ein fremdes (Gegenprobe), dann wieder das benannte.
-- \`begin … rollback\`: diese Datei schreibt nichts.

begin;

${namingLine(id)}

-- R7, vorher: keine Identitaet, das Tor zu.
select set_config('skyisles.r7_vorher_leer', (coalesce(current_setting('request.jwt.claim.sub', true), '') = ''
         and coalesce(current_setting('request.jwt.claims', true), '') = '' and ${uid} is null)::text, true) is not null as vorher,
       set_config('skyisles.r7_vorher_tor', ${gate}::text, true) is not null as vorher_tor;

-- R7, mit der Identitaet des benannten Kontos.
select ${claims(`(${named})`)};
select set_config('skyisles.r7_uid', (${uid} is not null and ${uid}::text = nullif((${named}), ''))::text, true) is not null as uid,
       set_config('skyisles.r7_tor', ${gate}::text, true) is not null as tor;

-- R7, Gegenprobe: ein Konto ohne jede Mitgliedschaft.
select set_config('skyisles.r7_fremd', gen_random_uuid()::text, true) is not null as fremd;
select ${claims("current_setting('skyisles.r7_fremd')")};
select set_config('skyisles.r7_gegen', (${uid}::text = current_setting('skyisles.r7_fremd')
         and not ${gate}
         and not exists (select 1 from public.seller_operators o
                          where o.user_id::text = current_setting('skyisles.r7_fremd')))::text, true) is not null as gegen;

-- R7, zurueck auf das benannte Konto.
select ${claims(`(${named})`)};
select set_config('skyisles.r7_zurueck', (${uid} is not null and ${uid}::text = nullif((${named}), '')
         and ${gate})::text, true) is not null as zurueck;

with r4 (fn, expected) as (values
${r4}
),
pruef (nr, riegel, pruefung, befund, erwartet) as (values
  (1, 'R1', 'Datenbankstempel',
      coalesce((select shobj_description(d.oid, 'pg_database') from pg_database d
                 where d.datname = current_database()), '(keiner)'),
      'skyisles-staging qqxcpesbwfxzgytkdsac'),
  (2, 'R2', 'Rolle skyisles_agent vorhanden',
      exists (select 1 from pg_roles where rolname = 'skyisles_agent')::text, 'true'),
  (3, 'R3', 'PostgreSQL 15 bis 18',
      (current_setting('server_version_num')::integer between 150000 and 189999)::text, 'true'),
  (4, 'R4', 'Ruempfe, die nicht dem Commit entsprechen (Anzahl von ${usedHashes().length})',
      (select count(*)::text from r4
        where (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.' || r4.fn))
              is distinct from r4.expected), '0'),
  (5, 'R4', 'Info: abweichende Ruempfe',
      (select coalesce(string_agg(r4.fn, ', '), '(keine)') from r4
        where (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.' || r4.fn))
              is distinct from r4.expected), null),
  (6, 'R5', 'unbekannte Trigger auf beruehrten Tabellen',
      coalesce((select string_agg(c.relname || '.' || t.tgname, ', ' order by 1)
         from pg_trigger t
         join pg_class c on c.oid = t.tgrelid
         join pg_proc f on f.oid = t.tgfoid
${r5a}), '(keine)'), '(keine)'),
  (7, 'R5', 'Triggerfunktionen, die nach aussen sprechen',
      coalesce((select string_agg(f.proname, ', ')
         from pg_trigger t join pg_proc f on f.oid = t.tgfoid
${r5b}), '(keine)'), '(keine)'),
  (8, 'R6', 'Pflichtspalten, die der Lauf nicht setzt',
      coalesce((select string_agg(c.table_name || '.' || c.column_name, ', ')
         from information_schema.columns c
${r6}), '(keine)'), '(keine)'),
  (9, 'R7', 'das benannte Konto ist eine gueltige Kennung',
      ((${named}) <> '')::text, 'true'),
  (10, 'R7', 'freigeschaltete Mitgliedschaften des benannten Kontos beim aktiven Verkaeufer',
      (select count(*)::text from public.seller_operators o join public.sellers s on s.id = o.seller_id
        where s.is_active and o.is_enabled and o.user_id::text = (${named})), '1'),
  (11, 'R7', 'vorher: keine Identitaet in der Sitzung',
      current_setting('skyisles.r7_vorher_leer'), 'true'),
  (12, 'R7', 'vorher: das Tor ist zu',
      current_setting('skyisles.r7_vorher_tor'), 'false'),
  (13, 'R7', 'Identitaet: auth.uid() liefert genau das benannte Konto',
      current_setting('skyisles.r7_uid'), 'true'),
  (14, 'R7', 'Tor: mit dieser Identitaet offen',
      current_setting('skyisles.r7_tor'), 'true'),
  (15, 'R7', 'Gegenprobe: fuer ein fremdes Konto bleibt das Tor zu',
      current_setting('skyisles.r7_gegen'), 'true'),
  (16, 'R7', 'danach wieder das benannte Konto, Tor offen',
      current_setting('skyisles.r7_zurueck'), 'true'),
  (17, 'Info', 'aktive Betriebskonten insgesamt (andere sind zulaessig)',
      (select count(*)::text from public.seller_operators o join public.sellers s on s.id = o.seller_id
        where s.is_active and o.is_enabled), null),
  (18, 'Info', 'Webhooks: Trigger in public, die supabase_functions/net/http aufrufen',
      coalesce((select string_agg(c.relname || '.' || t.tgname, ', ' order by 1)
         from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
         join pg_proc f on f.oid = t.tgfoid join pg_namespace fn on fn.oid = f.pronamespace
        where not t.tgisinternal and n.nspname = 'public'
          and (fn.nspname in ('supabase_functions', 'net') or f.prosrc ~* '(net\\.|http_request|dblink)')), '(keine)'), null)
),
ergebnis as (
  select nr, riegel, pruefung, befund, erwartet,
         case when erwartet is null then null else befund is not distinct from erwartet end as ok
    from pruef
)
select nr, riegel, pruefung, befund, erwartet, ok from ergebnis
union all
select 9999, 'GESAMT', 'Riegel, die nicht bestehen (muss 0 sein)',
       (select count(*) from ergebnis where ok is false)::text, '0',
       (select count(*) from ergebnis where ok is false) = 0
 order by nr;

rollback;
`;
}

/** The committed probe: what the generator builds, and what `SHA256SUMS.txt` records. */
export function verifiedProbe(): { probe: string; sha: string } {
  const probe = readFileSync(PROBE_FILE, "utf8");
  if (probe !== buildProbe()) throw new Error(`${PROBE_FILE} ist nicht, was der Erzeuger baut (--check)`);
  const sha = sha256(probe);
  if (!readFileSync(SUMS_FILE, "utf8").split("\n").includes(`${sha}  ${PROBE_FILE}`)) {
    throw new Error(`${PROBE_FILE}: SHA-256 ${sha} steht nicht in ${SUMS_FILE}`);
  }
  return { probe, sha };
}

/**
 * Sign in as the Staging operator, keep the user id, sign out — and nothing
 * else: no `.rpc`, no `.from`, no storage. The anon key only; the service
 * role is removed from the environment before any client exists.
 */
async function operatorId(): Promise<string> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error("Run through npm, which loads .env.staging.");
  // Loaded here, not at the top: the offline modes need none of the verifier's imports.
  const { OPERATOR_ENV_FILE } = await import("./verify-sales-reconciliation.mts");
  ladeUmgebung(OPERATOR_ENV_FILE);
  const email = process.env.SKYISLES_STAGING_OPERATOR_EMAIL;
  const password = process.env.SKYISLES_STAGING_OPERATOR_PASSWORD;
  if (!email || !password) throw new Error(`Die Zugangsdaten des Staging-Betriebskontos fehlen (${OPERATOR_ENV_FILE}).`);
  const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw new Error("Anmeldung als Staging-Betriebskonto fehlgeschlagen");
  let id: unknown;
  try {
    id = signIn.data.user?.id;
  } finally {
    const out = await client.auth.signOut({ scope: "local" });
    if (out.error) throw new Error("Abmeldung des Staging-Betriebskontos fehlgeschlagen");
  }
  if (!isOperatorId(id)) throw new Error("die Anmeldung lieferte keine gueltige Kennung");
  return id;
}

async function writeRunFiles(): Promise<void> {
  requireStaging("probe:recon-0180");
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const { probe, sha } = verifiedProbe();
  const id = await operatorId();
  const run = runFile(probe, id);
  const back = readRunFile(run);
  if (back.probe !== probe || back.id !== id || sha256(back.probe) !== sha) throw new Error("die Laufdatei gibt die Pruefdatei nicht zurueck");
  mkdirSync(RUN_DIR, { recursive: true });
  writeFileSync(RUN_FILE, run);
  const precheck = buildPrecheck(probe, id);
  writeFileSync(PRECHECK_FILE, precheck);
  console.log(`  Betriebskonto ${shortId(id)} benannt (Anmeldung beendet)`);
  console.log(`  Pruefdatei    ${PROBE_FILE}  SHA-256 ${sha}`);
  console.log(`  Laufdatei     ${RUN_FILE}  SHA-256 ${sha256(run)}`);
  console.log(`  Vorpruefung   ${PRECHECK_FILE}  SHA-256 ${sha256(precheck)}`);
  console.log("  Nichts ausgefuehrt. Erst die Vorpruefung, Prueflauf B nur mit eigener Freigabe.");
}

if (process.argv[1]?.endsWith("build-recon-probe.mts") && process.argv.includes("--run-file")) {
  writeRunFiles().catch((error: Error) => {
    console.error(`  FAIL  ${error.message}`);
    process.exit(1);
  });
} else if (process.argv[1]?.endsWith("build-recon-probe.mts")) {
  const text = buildProbe();
  if (process.argv.includes("--write")) {
    writeFileSync(PROBE_FILE, text);
    console.log(`${PROBE_FILE}: geschrieben (${text.length} Zeichen)`);
  } else if (process.argv.includes("--check")) {
    const ok = readFileSync(PROBE_FILE, "utf8") === text;
    console.log(ok ? `${PROBE_FILE}: aktuell` : `${PROBE_FILE}: VERALTET — node tools/build-recon-probe.mts --write`);
    process.exit(ok ? 0 : 1);
  } else {
    console.log(text);
  }
}
