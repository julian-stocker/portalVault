/**
 * The Staging run for 0190 (ADR-0184, AP4): the migration embedded character
 * for character, one transaction, the Staging stamp, measured before and after
 * (nothing may move but the one new function), its body, form, rights and
 * columns pinned — and the pinned values checked against what the migration
 * really creates, on PostgreSQL. The migration's behaviour itself is in
 * `src/lib/legal/seller-legal-public-0190.test.ts`.
 *
 * Prepared only — not applied anywhere (see APPLIED.md).
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 60_000 });

const FILE = "supabase/migrations/0190_seller_legal_public.sql";
const MIGRATION = readFileSync(FILE, "utf8");
const RUN = readFileSync("supabase/operations/staging-0190.sql", "utf8");
const PRE = readFileSync("supabase/checks/0190_preflight.sql", "utf8");
const POST = readFileSync("supabase/checks/0190_postflight.sql", "utf8");
const PLAN = JSON.parse(readFileSync("supabase/checks/migration-plans.json", "utf8")).migrationen["0190"];
const BODY = "147b403e834f4e525bad11d3494ea083";
const SIG = "public.seller_legal_public()";

describe("staging-0190.sql", () => {
  it("embeds the migration character for character, and nothing else", () => {
    const start = `-- >>> EINGEBETTET: ${FILE}\n`;
    const end = `-- <<< ENDE: ${FILE}\n`;
    expect(RUN.slice(RUN.indexOf(start) + start.length, RUN.indexOf(end))).toBe(MIGRATION);
    expect([...RUN.matchAll(/^-- >>> EINGEBETTET: (\S+)$/gm)].map((m) => m[1])).toEqual([FILE]);
  });

  it("one transaction, the stamp inside it, no Production project anywhere", () => {
    const lines = RUN.split("\n");
    expect(lines.filter((l) => l.trim() === "begin;")).toHaveLength(1);
    expect(lines.filter((l) => l.trim() === "commit;")).toHaveLength(1);
    expect(RUN.trimEnd().endsWith("commit;")).toBe(true);
    expect(RUN.indexOf("ABBRUCH A1")).toBeGreaterThan(RUN.indexOf("begin;"));
    expect(RUN).toContain("'skyisles-staging qqxcpesbwfxzgytkdsac'");
    for (const f of [RUN, PRE, POST, MIGRATION]) expect(f).not.toContain("zmiwxswrpkmizvqsgype");
  });

  it("measures sellers, stock, collection and every OTHER right before and after, and stops on movement", () => {
    for (const t of ["sellers", "shop_inventory", "collection_items"]) {
      expect(RUN.match(new RegExp(`from public\\.${t} t\\) as ${t},`, "g")), t).toHaveLength(2);
    }
    expect(RUN.match(/and p\.proname not in \('seller_legal_public'\)\) as funktionsrechte,/g)).toHaveLength(2);
    expect(RUN.indexOf("ABBRUCH Z1")).toBeGreaterThan(RUN.indexOf(`-- <<< ENDE: ${FILE}`));
  });

  it("pins the body (Z2, postflight 201) and the rights, form and columns (Z3, 202–205)", () => {
    expect(RUN).toContain(`is distinct from '${BODY}'`);
    expect(POST).toContain(`'${BODY}'`);
    for (const f of [RUN, POST]) {
      expect(f).toContain(`has_function_privilege('anon', to_regprocedure('${SIG}'), 'execute')`);
      expect(f).toContain(`has_function_privilege('authenticated', to_regprocedure('${SIG}'), 'execute')`);
      expect(f).toContain(`not has_function_privilege('service_role', to_regprocedure('${SIG}'), 'execute')`);
      expect(f).toContain("a.grantee = 0");
      expect(f).toContain("p.provolatile = 's'");
      expect(f).toContain("pg_get_function_result(to_regprocedure('public.seller_legal_public()'))");
    }
  });

  it("the preflight shows a second run (102) and that sellers stays closed (103)", () => {
    expect(PRE).toMatch(/\(102, 'Grundlage', 'seller_legal_public steht NOCH NICHT/);
    expect(PRE).toMatch(/\(103, 'Grundlage', 'public\.sellers: RLS an, anon darf nicht lesen/);
    expect(POST).toMatch(/\(221, 'Unberuehrt', 'public\.sellers: RLS an, anon darf weiter nicht lesen/);
    for (const f of [PRE, POST, RUN]) expect(f).not.toContain("admin_set_shop_policies");
  });

  it("the plan names its files and knows when it is applied", () => {
    expect(PLAN).toMatchObject({ preflight: "0190_preflight.sql", lauf: "staging-0190.sql", postflight: "0190_postflight.sql" });
    expect(PLAN.angewendet.sql).toContain("to_regprocedure('public.seller_legal_public()') is not null");
    expect(PLAN.angewendet.sql).toMatch(/as erfuellt$/);
  });
});

describe("the pinned values are what the migration really creates", () => {
  it("md5(prosrc) and the result columns, on PostgreSQL", async () => {
    const db = new PGlite();
    try {
      await db.exec(`
        create role anon nologin; create role authenticated nologin; create role service_role nologin;
        create table public.sellers (id bigint primary key, is_active boolean not null default true,
          display_name text, legal_name text, legal_form text, street text, postal_code text, city text,
          country_code text, contact_email text, direct_contact text, vat_id text, w_id text,
          register_court text, register_number text, small_business_19 boolean not null default true,
          dispute_participation boolean not null default false, dispute_body text,
          withdrawal_contact_email text, complaints_contact_email text,
          return_postage_borne_by text not null default 'customer');
        alter table public.sellers enable row level security;
        revoke all on public.sellers from anon, authenticated;`);
      await db.exec(MIGRATION);
      const row = (await db.query<{ md5: string; result: string }>(
        `select md5(prosrc) as md5, pg_get_function_result(oid) as result from pg_proc where oid = to_regprocedure($1)`, [SIG])).rows[0];
      expect(row.md5).toBe(BODY);
      expect(POST).toContain(`'${row.result}'`);
      expect(RUN).toContain(`is distinct from '${row.result}'`);
      /* The plan's own test answers true once the migration stands. */
      const applied = (await db.query<{ erfuellt: boolean }>(PLAN.angewendet.sql)).rows[0];
      expect(applied.erfuellt).toBe(true);
    } finally {
      await db.close();
    }
  });
});
