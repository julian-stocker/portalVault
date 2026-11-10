/**
 * 0187 (M-05B, 2026-11-10) — `admin_set_shop_policies` without EXECUTE for
 * PUBLIC and anon, on real PostgreSQL (PGlite enforces grants and `SET ROLE`).
 *
 * The world reproduces the gap first: the roles Supabase has, Supabase's
 * default privileges on new functions in `public` (EXECUTE for anon,
 * authenticated, service_role), and the function body WORD FOR WORD from 0041
 * — created without rights, exactly as 0041 did. Then 0187 runs as the file.
 *
 * Measured, not assumed: a refused EXECUTE is SQLSTATE 42501 with
 * "permission denied for function …"; the function's own role check uses the
 * same SQLSTATE (`insufficient_privilege`) with "seller operator role
 * required" — the tests tell them apart by the message.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { body } from "../reconciliation/sql/schema";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const SIG = "public.admin_set_shop_policies(text,text,text,boolean,boolean,text,text,text,numeric)";
const MIGRATION = readFileSync("supabase/migrations/0187_revoke_shop_policies_public.sql", "utf8");
const ROLLBACK = readFileSync("supabase/rollback/R0187_restore_shop_policies_grants.sql", "utf8");

const WORLD = `
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create role somebody nologin;   -- a role with no grant of its own: what PUBLIC means
grant usage on schema public to anon, authenticated, service_role, somebody;
-- Supabase's default privileges on new functions in public (the cause of the gap)
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
grant usage on schema auth to anon, authenticated, service_role, somebody;
create table public.operator_switch (on_ boolean not null);
insert into public.operator_switch values (false);
create function public.can_operate_active_seller() returns boolean language sql stable security definer set search_path = ''
  as $$ select on_ from public.operator_switch $$;

create table public.sellers (
  id bigint primary key, is_active boolean not null default true,
  contact_email text, withdrawal_contact_email text, complaints_contact_email text,
  small_business_19 boolean not null default true, dispute_participation boolean not null default false,
  dispute_body text, return_postage_borne_by text not null default 'customer', dispatch_statement text,
  updated_at timestamptz, updated_by uuid);
insert into public.sellers (id) values (1);

-- a sibling admin function that 0187 must not touch, with rights of its own
create function public.admin_set_tester_probe() returns int language sql security definer set search_path = '' as $$ select 1 $$;
revoke all on function public.admin_set_tester_probe() from public, anon;
`;

let db: PGlite;
const one = async <T>(sql: string, params: unknown[] = []) => Object.values((await db.query(sql, params)).rows[0] as object)[0] as T;
const can = (role: string) => one<boolean>(`select has_function_privilege($1, $2, 'execute')`, [role, SIG]);
const publicHasExecute = () => one<boolean>(`select exists (select 1 from pg_proc p,
  aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  where p.oid = to_regprocedure($1) and a.privilege_type = 'EXECUTE' and a.grantee = 0)`, [SIG]);
/* Every OTHER function's rights, as text — 0187 must leave them byte-identical. */
const otherAcls = () => one<string>(`select string_agg(p.oid::regprocedure::text || '=' || coalesce(p.proacl::text, '(default)'), ';' order by p.oid::regprocedure::text)
  from pg_proc p where p.pronamespace in ('public'::regnamespace, 'auth'::regnamespace) and p.oid <> to_regprocedure($1)`, [SIG]);
const bodyMd5 = () => one<string>(`select md5(prosrc) from pg_proc where oid = to_regprocedure($1)`, [SIG]);
async function asRole<T>(role: string, f: () => Promise<T>): Promise<T> {
  await db.exec(`set role ${role}`);
  try { return await f(); } finally { await db.exec("reset role"); }
}
const failure = async (f: () => Promise<unknown>) => {
  try { await f(); return null; } catch (e) { return { code: (e as { code?: string }).code, message: (e as Error).message }; }
};
const callPolicies = () => db.query(`select public.admin_set_shop_policies(p_dispatch_statement => 'Versand in 2 Tagen')`);

beforeEach(async () => {
  db = new PGlite();
  await db.exec(WORLD);
  await db.exec(body("0040_shop_platform_responsibilities.sql", "shop_setting_value"));
  // the function exactly as 0041 creates it — and, like 0041, without stating any rights
  await db.exec(body("0041_three_account_authorization.sql", "admin_set_shop_policies"));
});
afterEach(async () => { await db.close(); });

describe("before 0187: the gap, reproduced", () => {
  it("anon and PUBLIC can execute (0041 recreated the signature without rights)", async () => {
    expect(await can("anon")).toBe(true);
    expect(await publicHasExecute()).toBe(true);
    expect(await can("somebody")).toBe(true);
  });
  it("…but the body's own role check still refuses anon — no effect", async () => {
    const f = await asRole("anon", () => failure(callPolicies));
    expect(f?.code).toBe("42501");
    expect(f?.message).toContain("seller operator role required");
    expect(await one(`select dispatch_statement from public.sellers where id = 1`)).toBeNull();
  });
});

describe("after 0187", () => {
  beforeEach(async () => { await db.exec(MIGRATION); });

  it("PUBLIC: no EXECUTE (no ACL entry for grantee 0, and a role without own grants cannot)", async () => {
    expect(await publicHasExecute()).toBe(false);
    expect(await can("somebody")).toBe(false);
  });
  it("anon: no EXECUTE", async () => {
    expect(await can("anon")).toBe(false);
  });
  it("authenticated and service_role: EXECUTE", async () => {
    expect(await can("authenticated")).toBe(true);
    expect(await can("service_role")).toBe(true);
  });
  it("anon calling is refused by the GRANT now — SQLSTATE 42501, 'permission denied for function'", async () => {
    const f = await asRole("anon", () => failure(callPolicies));
    expect(f?.code).toBe("42501");
    expect(f?.message).toMatch(/permission denied for function admin_set_shop_policies/);
  });
  it("a role without own grants (PUBLIC) is refused the same way", async () => {
    const f = await asRole("somebody", () => failure(callPolicies));
    expect(f?.code).toBe("42501");
    expect(f?.message).toMatch(/permission denied for function/);
  });
  it("authenticated WITHOUT the operator role: still refused by the body's own check, nothing written", async () => {
    const f = await asRole("authenticated", () => failure(callPolicies));
    expect(f?.code).toBe("42501");
    expect(f?.message).toContain("seller operator role required");
    expect(await one(`select dispatch_statement from public.sellers where id = 1`)).toBeNull();
  });
  it("authenticated AS operator: the policies are written as before", async () => {
    await db.exec(`update public.operator_switch set on_ = true`);
    expect(await asRole("authenticated", () => failure(callPolicies))).toBeNull();
    expect(await one(`select dispatch_statement from public.sellers where id = 1`)).toBe("Versand in 2 Tagen");
  });
  it("still a security definer with an empty search_path, and the body is unchanged", async () => {
    const fresh = new PGlite();
    await fresh.exec(WORLD);
    await fresh.exec(body("0040_shop_platform_responsibilities.sql", "shop_setting_value"));
    await fresh.exec(body("0041_three_account_authorization.sql", "admin_set_shop_policies"));
    const before = Object.values((await fresh.query(`select md5(prosrc) from pg_proc where oid = to_regprocedure($1)`, [SIG])).rows[0] as object)[0];
    await fresh.close();
    expect(await bodyMd5()).toBe(before);
    expect(await one(`select prosecdef from pg_proc where oid = to_regprocedure($1)`, [SIG])).toBe(true);
    expect(await one(`select proconfig::text from pg_proc where oid = to_regprocedure($1)`, [SIG])).toBe('{"search_path=\\"\\""}');
  });
});

describe("0187 changes nothing else, and is idempotent", () => {
  it("every other function's rights are byte-identical before and after", async () => {
    const before = await otherAcls();
    await db.exec(MIGRATION);
    expect(await otherAcls()).toBe(before);
  });
  it("a second run changes nothing and its postconditions still hold", async () => {
    await db.exec(MIGRATION);
    const acl = await one<string>(`select proacl::text from pg_proc where oid = to_regprocedure($1)`, [SIG]);
    await db.exec(MIGRATION);
    expect(await one<string>(`select proacl::text from pg_proc where oid = to_regprocedure($1)`, [SIG])).toBe(acl);
  });
});

describe("0187 refuses to guess", () => {
  it("aborts when the function is missing", async () => {
    await db.exec(`drop function ${SIG}`);
    const f = await failure(() => db.exec(MIGRATION));
    expect(f?.message).toContain("0187 precondition");
  });
  it("aborts when a second overload exists (it would touch only one)", async () => {
    await db.exec(`create function public.admin_set_shop_policies(p_x text) returns void language sql as $$ select $$`);
    const f = await failure(() => db.exec(MIGRATION));
    expect(f?.message).toContain("more than one overload");
    // and nothing was changed: the one-transaction DO block rolled back
    expect(await can("anon")).toBe(true);
  });
});

describe("the files", () => {
  const code = MIGRATION.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
  it("0187 names only this function and only rights — no body, no table, no other RPC", () => {
    expect(code).not.toMatch(/create (or replace )?function|alter function|drop function|create table|alter table|insert |update |delete /i);
    const touched = [...code.matchAll(/(?:revoke|grant)[^;]*on function public\.([a-z_]+)\(/g)].map((m) => m[1]);
    expect(new Set(touched)).toEqual(new Set(["admin_set_shop_policies"]));
    expect(code).toContain("revoke all on function public.admin_set_shop_policies(text, text, text, boolean, boolean, text, text, text, numeric)\n    from public, anon;");
    expect(code).toContain("grant execute on function public.admin_set_shop_policies(text, text, text, boolean, boolean, text, text, text, numeric)\n    to authenticated, service_role;");
  });
  it("0187 depends on nothing from 0168–0186 (the function comes from 0041; works on Production's 0167 too)", () => {
    for (const later of ["sales_recon", "sale_item_corrections", "seller_recon", "variant_family", "offer_state", "favorites"]) {
      expect(code, later).not.toContain(later);
    }
  });
  it("the rollback restores exactly the measured state before 0187", async () => {
    await db.exec(MIGRATION);
    await db.exec(ROLLBACK);
    expect(await can("anon")).toBe(true);
    expect(await publicHasExecute()).toBe(true);
    expect(await can("authenticated")).toBe(true);
  });
});
