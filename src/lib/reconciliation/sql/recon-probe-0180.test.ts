/**
 * The rolled-back Staging probe of 0180 (variant B), run on PostgreSQL (PGlite)
 * exactly as it would be pasted into the SQL editor.
 *
 *   the run         every check passes, the script ends in the abort that
 *                   carries the result, and NOTHING stays — not a row, not a
 *                   function, not a right
 *   the riegel      R1–R7: each missing or different precondition stops it
 *                   before anything is written
 *   the contract    begin first, never a commit, rollback last; the riegel
 *                   before the first write; the copies only in pg_temp
 *   the generator   the copies are 0180 plus exactly the documented
 *                   replacements, and the committed file is current
 */
import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildProbe, COPIED, KNOWN_TRIGGERS, PROBE_FILE, probeCopy, REPLACEMENTS, TEMP_FUNCTIONS, usedHashes,
} from "@/../tools/build-recon-probe.mts";
import { OPERATOR, one, RECONCILIATION_MIGRATIONS, reconciliationWorld } from "./schema";
import { analyseSpecs, applySession, decideOn, everything, findingOf, seedSales, type Spec } from "./session-fixture";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const WITH_0180 = [...RECONCILIATION_MIGRATIONS, "0175_sales_recon_account_deletion.sql",
  "0176_sales_recon_validate_before_dedup.sql", "0178_sales_recon_comparison_and_pending.sql",
  "0179_sales_recon_ledger_proof.sql", "0180_sales_recon_selected_apply.sql"] as const;
const PROBE = readFileSync(PROBE_FILE, "utf8");
const CHECKS = 32;

/** What Staging has and the reconciliation world does not: the seller tables, the agent role, the stamp. */
const STAGING = `
create table public.sellers (id bigint primary key, is_active boolean not null);
create table public.seller_operators (seller_id bigint not null, user_id uuid not null, is_enabled boolean not null);
insert into public.sellers values (1, true);
insert into public.seller_operators values (1, '${OPERATOR}', true);
do $$ begin if not exists (select 1 from pg_roles where rolname = 'skyisles_agent') then create role skyisles_agent nologin; end if; end $$;
comment on database postgres is 'skyisles-staging qqxcpesbwfxzgytkdsac';`;

/** Business data that must not move: a real (non-test) analysed and applied session. */
const REAL: Spec[] = [
  { ref: "88-00000-00001", sold: "2026-03-10", shipping: 4.99, lines: [{ character: "Eruptor", unit: 9 }],
    ledger: { sold: "2026-03-09", subtotal: 8, shipping: 5.49, pieces: ["Eruptor"], carriesRef: true } },
  { ref: "88-00000-00002", sold: "2026-03-12", lines: [{ character: "Zap", unit: 10 }],
    ledger: { sold: "2026-03-12", subtotal: 12, pieces: ["Zap"], refunds: [1], carriesRef: true } },
];

let db: PGlite;

async function run(sql = PROBE): Promise<{ code: string; message: string }> {
  try {
    await db.exec(sql);
    return { code: "ok", message: "" };
  } catch (error) {
    await db.exec("rollback").catch(() => {});
    const e = error as { code?: string; message?: string };
    return { code: e.code ?? "?", message: e.message ?? "" };
  }
}
const tempFunctions = () => one<number>(db, `select count(*)::integer from pg_proc where pronamespace = pg_my_temp_schema()`);

beforeEach(async () => {
  db = await reconciliationWorld({ migrations: WITH_0180 });
  await db.exec(STAGING);
  await seedSales(db, REAL);
  const session = await analyseSpecs(db, REAL);
  await decideOn(db, await findingOf(db, session, "88-00000-00001", "shipping"), "keep_ledger");
  await applySession(db, session, 0).catch(() => undefined);
});
afterEach(async () => { await db.close(); });

describe("the probe run", () => {
  it("passes every check, ends in its result, and leaves nothing behind", async () => {
    const before = await everything(db);
    const rights = await one<string>(db, `select md5(string_agg(p.oid::regprocedure::text || coalesce(p.proacl::text, '-'), ';' order by 1))
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`);
    const r = await run();
    expect(r.code).toBe("P0001");
    const lines = r.message.split(" | ");
    expect(lines[0]).toBe(`PRUEFLAUF 0180 ZURUECKGEROLLT — ${CHECKS}/${CHECKS} bestanden`);
    expect(lines.slice(1).filter((l) => !/^\d+ ok /.test(l))).toEqual([]);
    expect(lines).toHaveLength(CHECKS + 1);
    // Every row, every right as before; no temporary function, table or setting left.
    expect(await everything(db)).toBe(before);
    expect(await one<string>(db, `select md5(string_agg(p.oid::regprocedure::text || coalesce(p.proacl::text, '-'), ';' order by 1))
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`)).toBe(rights);
    expect(await tempFunctions()).toBe(0);
    expect(await one(db, `select to_regclass('pg_temp.probe_sales')`)).toBeNull();
    expect(await one(db, `select coalesce(current_setting('request.jwt.claims', true), '')`)).toBe("");
  });

  it("names no report value in its result — codes, counts and its own synthetic numbers only", async () => {
    const r = await run();
    for (const real of ["88-00000", "Eruptor", "Zap", "2026-03"]) expect(r.message).not.toContain(real);
  });

  it("a failing check is reported as FEHLT, and the run is rolled back all the same", async () => {
    const before = await everything(db);
    const spoiled = PROBE.replace("'2001-05-10' and s.items_subtotal = 9", "'2001-05-11' and s.items_subtotal = 9");
    const r = await run(spoiled);
    expect(r.message).toMatch(new RegExp(`^PRUEFLAUF 0180 ZURUECKGEROLLT — ${CHECKS - 1}/${CHECKS} bestanden`));
    expect(r.message).toContain("12 FEHLT");
    expect(await everything(db)).toBe(before);
  });
});

describe("the riegel stop it before anything is written", () => {
  const stopped = async (code: string) => {
    const before = await everything(db);
    const r = await run();
    expect(r.message).toContain(`ABBRUCH ${code}`);
    expect(await everything(db)).toBe(before);
    expect(await tempFunctions()).toBe(0);
  };

  it("R1 without the Staging stamp (Production carries none)", async () => {
    await db.exec(`comment on database postgres is null`);
    await stopped("R1");
  });

  it("R2 without the second marker", async () => {
    await db.exec(`drop role skyisles_agent`);
    await stopped("R2");
  });

  it("R4 when a body is not the committed one", async () => {
    await db.exec(`create or replace function public.orderbook_touch_sale(p_sale_id bigint) returns void
      language plpgsql volatile security definer set search_path = '' as $$ begin null; end; $$;`);
    await stopped("R4");
  });

  it("R5 when an unknown trigger sits on a touched table — a webhook, say", async () => {
    await db.exec(`create function public.test_webhook() returns trigger language plpgsql as $$ begin return new; end $$;
      create trigger supabase_webhook after insert on public.sales for each row execute function public.test_webhook();`);
    await stopped("R5");
  });

  it("R6 when sales has a required column the run does not set", async () => {
    await db.exec(`alter table public.sales add column region text not null default 'x'; alter table public.sales alter column region drop default;`);
    await stopped("R6");
  });

  it("R7 with more than one operator account", async () => {
    await db.exec(`insert into public.seller_operators values (1, gen_random_uuid(), true)`);
    await stopped("R7");
  });
});

describe("the file's contract", () => {
  /** The script without comments and without the dollar-quoted bodies: its top-level statements. */
  const top = PROBE.replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, () => "$$ $$");

  it("begins its transaction first, never commits, and ends with rollback", () => {
    const statements = top.split(";").map((s) => s.trim()).filter(Boolean);
    expect(statements[0]).toBe("begin");
    expect(statements.at(-1)).toBe("rollback");
    for (const s of statements) expect(s, s.slice(0, 60)).not.toMatch(/^(commit|end|release|prepare\s+transaction)\b/i);
    expect(PROBE).not.toMatch(/\bcommit\s*;|\bcommit\s+and\b|prepare\s+transaction/i);
  });

  it("checks every riegel before the first write and before the first function", () => {
    const riegel = PROBE.indexOf("do $probe_r$");
    expect(riegel).toBeGreaterThan(PROBE.indexOf("begin;"));
    expect(riegel).toBeLessThan(PROBE.indexOf("create temporary table"));
    expect(PROBE.indexOf("create temporary table")).toBeLessThan(PROBE.indexOf("create function"));
    const head = PROBE.slice(0, PROBE.indexOf("create temporary table"));
    for (const r of ["ABBRUCH R1", "ABBRUCH R2", "ABBRUCH R3", "ABBRUCH R4", "ABBRUCH R5", "ABBRUCH R6", "ABBRUCH R7"]) {
      expect(head, r).toContain(r);
    }
    expect(PROBE).toContain("'skyisles-staging qqxcpesbwfxzgytkdsac'");
    expect(PROBE).not.toContain("zmiwxswrpkmizvqsgype");
  });

  it("creates functions only in pg_temp, never grants, and touches no right of a real object", () => {
    const creates = [...PROBE.matchAll(/\bcreate\s+(or\s+replace\s+)?function\s+(\S+)\(/gi)].map((m) => [m[1] ?? "", m[2]]);
    expect(creates.length).toBe(TEMP_FUNCTIONS.length);
    for (const [orReplace, name] of creates) {
      expect(orReplace, name).toBe("");
      expect(name.startsWith("pg_temp.probe_"), name).toBe(true);
    }
    expect(new Set(creates.map(([, n]) => n.replace("pg_temp.", "")))).toEqual(new Set(TEMP_FUNCTIONS));
    const statements = top.split(";").map((x) => x.trim()).filter(Boolean);
    for (const st of statements) {
      expect(st, st.slice(0, 60)).toMatch(/^(begin|rollback|set local|do \$\$ \$\$|create temporary table|create function pg_temp\.)/i);
    }
    expect(PROBE).not.toMatch(/\bgrant\s/i);
    expect(PROBE).toContain("revoke all on function %s from public");
  });

  it("its own tools write only rows of its own: test sales it registers, sessions over them", () => {
    // Outside the copies of 0180 (whose writes are the regular ones).
    const tools = PROBE.replace(/-- >>> KOPIE[\s\S]*?-- <<< ENDE KOPIE \w+/g, "");
    expect([...new Set(tools.match(/insert into public\.\w+/g))].sort()).toEqual(["insert into public.sale_items", "insert into public.sales"]);
    expect(tools).toMatch(/values \('ebay', p_sold, p_subtotal, 0, p_shipping, 'manual', p_ref, true,/);
    expect(tools.match(/update public\.\w+/g)).toEqual(["update public.sales"]);
    expect(tools).toContain("update public.sales set updated_at = clock_timestamp() where id = s7;");
    expect(tools).not.toMatch(/delete from|truncate/i);
    expect(PROBE).toContain("eine Sitzung des Laufs nennt einen Verkauf, den er nicht angelegt hat");
    expect(PROBE).not.toMatch(/seller_set_sale_test|is_test\s*=\s*false/);
  });

  it("is exactly what the generator writes", () => {
    expect(PROBE).toBe(buildProbe());
  });
});

describe("the generator: the copies are 0180, plus exactly the documented replacements", () => {
  it.each(COPIED)("%s", (name) => {
    const { regular, probe } = probeCopy(name);
    let back = probe;
    for (const r of [...REPLACEMENTS[name]].reverse()) back = back.split(r.to).join(r.from);
    expect(back).toBe(regular);
    // Line by line: every changed line carries a documented replacement.
    const a = regular.split("\n");
    const b = probe.split("\n");
    expect(b).toHaveLength(a.length);
    for (const [i, line] of b.entries()) {
      if (line !== a[i]) expect(REPLACEMENTS[name].some((r) => line.includes(r.to)), line).toBe(true);
    }
  });

  it("the one change of substance is the test-sale line, turned round", () => {
    const changed = Object.values(REPLACEMENTS).flat().filter((r) => !r.why.startsWith("der Name") && r.why !== "ruft die Kopie");
    expect(changed.map((r) => r.from)).toEqual(["  if s.is_test then return 'test_sale'; end if;", "not s2.is_test", "not s2.is_test"]);
    expect(probeCopy("sales_recon_take_check").probe).toContain("then return 'not_probe'");
  });

  it("every body the probe checks is the one PostgreSQL holds after the migrations", async () => {
    for (const [sig, hash] of usedHashes()) {
      expect(await one(db, `select md5(prosrc) from pg_proc where oid = to_regprocedure($1)`, [`public.${sig}`]), sig).toBe(hash);
    }
  });

  it("knows every trigger the migrations put on the touched tables", async () => {
    const present = await db.query<{ t: string }>(`select c.relname || '.' || t.tgname || '=' || f.proname as t
      from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_proc f on f.oid = t.tgfoid
     where not t.tgisinternal and c.relnamespace = 'public'::regnamespace`);
    for (const t of present.rows.map((r) => r.t)) expect(KNOWN_TRIGGERS as readonly string[], t).toContain(t);
  });
});
