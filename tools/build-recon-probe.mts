/**
 * Builds `supabase/operations/staging-0180-probe.sql` — the rolled-back
 * Staging probe of 0180 (ADR-0178, variant B).
 *
 *   node tools/build-recon-probe.mts           print what it would write
 *   node tools/build-recon-probe.mts --write   write the file
 *   node tools/build-recon-probe.mts --check   exit 1 if the file is not what it would write
 *
 * READS ONLY THE REPOSITORY. No database, no network, no environment file.
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
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

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
  { signature: "seller_cancel_external_sale(bigint,text,date,timestamptz)", file: "0170_external_sale_cancel.sql", header: "create or replace function public.seller_cancel_external_sale(" },
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

if (process.argv[1]?.endsWith("build-recon-probe.mts")) {
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
