/**
 * 0190 (ADR-0184, AP4) — `seller_legal_public()` on real PostgreSQL (PGlite
 * enforces grants, RLS and `SET ROLE`).
 *
 * The world is Supabase's in small: the three roles, Supabase's default
 * EXECUTE on new functions in `public` (the cause of 0187's gap — this
 * migration must not repeat it), and `sellers` closed exactly as 0026 closes
 * it: RLS on, no policy, `revoke all` from anon and authenticated. The table
 * carries every column of the real one that matters here, including the
 * internal ones that must NOT come out.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const SIG = "public.seller_legal_public()";
const MIGRATION = readFileSync("supabase/migrations/0190_seller_legal_public.sql", "utf8");
const ROLLBACK = readFileSync("supabase/rollback/R0190_seller_legal_public.sql", "utf8");

const PUBLIC_COLUMNS = [
  "display_name", "legal_name", "legal_form", "street", "postal_code", "city", "country_code",
  "contact_email", "direct_contact", "vat_id", "w_id", "register_court", "register_number",
  "small_business_19", "dispute_participation", "dispute_body",
  "withdrawal_contact_email", "complaints_contact_email", "return_postage_borne_by",
];

const WORLD = `
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create role somebody nologin;   -- no grant of its own: what PUBLIC means
grant usage on schema public to anon, authenticated, service_role, somebody;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

create table public.sellers (
  id bigint primary key,
  display_name text, contact_email text, transactional_reply_to text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), updated_by uuid,
  legal_name text, trading_name text, legal_form text, street text, postal_code text, city text,
  country_code text, phone text, direct_contact text, register_court text, register_number text,
  vat_id text, w_id text, withdrawal_contact_email text, complaints_contact_email text,
  small_business_19 boolean not null default true, dispute_participation boolean not null default false,
  dispute_body text, return_postage_borne_by text not null default 'customer', dispatch_statement text,
  free_shipping_threshold numeric(10,2) not null default 75.00
);
create unique index sellers_one_active on public.sellers ((true)) where is_active;
alter table public.sellers enable row level security;
revoke all on public.sellers from anon, authenticated;

insert into public.sellers (id, display_name, contact_email, transactional_reply_to, legal_name, trading_name,
  legal_form, street, postal_code, city, country_code, phone, vat_id, dispatch_statement)
values (1, 'skyisles.shop', 'info@skyisles.de', 'intern@skyisles.de', 'Julian Stocker', 'yulez.collectibles',
  'Einzelunternehmen', 'Lechhalde 1 1/2', '87629', 'Füssen', 'DE', '+49 000 000', 'DE321022065', 'Versand in 2 Tagen');
`;

let db: PGlite;
const one = async <T>(sql: string, params: unknown[] = []) =>
  Object.values((await db.query(sql, params)).rows[0] as object)[0] as T;
const can = (role: string) => one<boolean>(`select has_function_privilege($1, $2, 'execute')`, [role, SIG]);
async function asRole<T>(role: string, f: () => Promise<T>): Promise<T> {
  await db.exec(`set role ${role}`);
  try { return await f(); } finally { await db.exec("reset role"); }
}
const failure = async (f: () => Promise<unknown>) => {
  try { await f(); return null; } catch (e) { return { code: (e as { code?: string }).code, message: (e as Error).message }; }
};
const call = () => db.query<Record<string, unknown>>(`select * from public.seller_legal_public()`);
/* Every function's and table's rights except the new one, as text. */
const otherAcls = () => one<string>(`select coalesce(string_agg(x, ';' order by x), '') from (
  select p.oid::regprocedure::text || '=' || coalesce(p.proacl::text, '(default)') x from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.oid <> coalesce(to_regprocedure($1), 0)
  union all
  select c.relname || '=' || coalesce(c.relacl::text, '(default)') from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'r') t`, [SIG]);

beforeEach(async () => {
  db = new PGlite();
  await db.exec(WORLD);
});
afterEach(async () => { await db.close(); });

describe("rights", () => {
  beforeEach(async () => { await db.exec(MIGRATION); });

  it("anon and authenticated may call it — the legal pages are public", async () => {
    expect(await can("anon")).toBe(true);
    expect(await can("authenticated")).toBe(true);
  });

  it("PUBLIC and service_role may not — Supabase's default EXECUTE is taken back", async () => {
    expect(await can("somebody")).toBe(false);
    expect(await can("service_role")).toBe(false);
    const f = await asRole("somebody", () => failure(call));
    expect(f?.code).toBe("42501");
    expect(f?.message).toMatch(/permission denied for function seller_legal_public/);
  });

  it("anon still cannot read sellers directly — the function stays the only way", async () => {
    const f = await asRole("anon", () => failure(() => db.query("select * from public.sellers")));
    expect(f?.code).toBe("42501");
  });

  it("stable, security definer, empty search_path", async () => {
    const row = (await db.query<{ prosecdef: boolean; provolatile: string; proconfig: string[] }>(
      `select prosecdef, provolatile, proconfig from pg_proc where oid = to_regprocedure($1)`, [SIG])).rows[0];
    expect(row.prosecdef).toBe(true);
    expect(row.provolatile).toBe("s");
    expect(row.proconfig.some((c) => c === "search_path=" || c === 'search_path=""')).toBe(true);
  });

  it("changes no other right", async () => {
    const fresh = new PGlite();
    await fresh.exec(WORLD);
    const before = Object.values((await fresh.query(`select coalesce(string_agg(x, ';' order by x), '') from (
      select p.oid::regprocedure::text || '=' || coalesce(p.proacl::text, '(default)') x from pg_proc p
       where p.pronamespace = 'public'::regnamespace
      union all
      select c.relname || '=' || coalesce(c.relacl::text, '(default)') from pg_class c
       where c.relnamespace = 'public'::regnamespace and c.relkind = 'r') t`)).rows[0] as object)[0];
    await fresh.close();
    expect(await otherAcls()).toBe(before);
  });
});

describe("what it returns", () => {
  beforeEach(async () => { await db.exec(MIGRATION); });

  it("as anon: exactly the public columns, in order", async () => {
    const result = await asRole("anon", call);
    expect(result.fields.map((f) => f.name)).toEqual(PUBLIC_COLUMNS);
    expect(result.rows).toHaveLength(1);
  });

  it("the provider identification of the active seller", async () => {
    const row = (await asRole("anon", call)).rows[0];
    expect(row).toMatchObject({
      display_name: "skyisles.shop", legal_name: "Julian Stocker", legal_form: "Einzelunternehmen",
      street: "Lechhalde 1 1/2", postal_code: "87629", city: "Füssen", country_code: "DE",
      contact_email: "info@skyisles.de", vat_id: "DE321022065", small_business_19: true,
      dispute_participation: false, return_postage_borne_by: "customer",
    });
  });

  it("never the internal fields — not as a column, not as a value", async () => {
    const result = await asRole("anon", call);
    const names = result.fields.map((f) => f.name);
    for (const hidden of ["transactional_reply_to", "phone", "trading_name", "dispatch_statement",
      "free_shipping_threshold", "id", "is_active", "created_at", "updated_at", "updated_by"]) {
      expect(names, hidden).not.toContain(hidden);
    }
    const values = JSON.stringify(result.rows);
    for (const secret of ["intern@skyisles.de", "+49 000 000", "yulez.collectibles", "Versand in 2 Tagen"]) {
      expect(values, secret).not.toContain(secret);
    }
  });

  it("withdrawal and complaints contacts fall back to the contact e-mail, as admin_shop_profile() does", async () => {
    let row = (await call()).rows[0];
    expect(row.withdrawal_contact_email).toBe("info@skyisles.de");
    expect(row.complaints_contact_email).toBe("info@skyisles.de");
    await db.exec(`update public.sellers set withdrawal_contact_email = 'widerruf@skyisles.de'`);
    row = (await call()).rows[0];
    expect(row.withdrawal_contact_email).toBe("widerruf@skyisles.de");
    expect(row.complaints_contact_email).toBe("info@skyisles.de");
  });

  it("an empty or blank value is NULL, never a placeholder", async () => {
    await db.exec(`update public.sellers set legal_form = '', street = '   ', vat_id = null, contact_email = ' '`);
    const row = (await call()).rows[0];
    expect(row.legal_form).toBeNull();
    expect(row.street).toBeNull();
    expect(row.vat_id).toBeNull();
    expect(row.contact_email).toBeNull();
    /* No contact at all: the fallbacks are NULL too, not an invented address. */
    expect(row.withdrawal_contact_email).toBeNull();
  });

  it("trims what it returns", async () => {
    await db.exec(`update public.sellers set display_name = '  skyisles.shop  '`);
    expect((await call()).rows[0].display_name).toBe("skyisles.shop");
  });

  it("no active seller: no row — the pages show an error, not invented details", async () => {
    await db.exec(`update public.sellers set is_active = false`);
    expect((await asRole("anon", call)).rows).toHaveLength(0);
    await db.exec(`delete from public.sellers`);
    expect((await asRole("anon", call)).rows).toHaveLength(0);
  });

  it("only the active one when an inactive seller exists beside it", async () => {
    await db.exec(`insert into public.sellers (id, display_name, legal_name, is_active) values (2, 'alt', 'Früher', false)`);
    const rows = (await call()).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].display_name).toBe("skyisles.shop");
  });
});

describe("the migration and its rollback", () => {
  it("writes nothing: the seller row is byte-identical before and after", async () => {
    const before = JSON.stringify((await db.query("select * from public.sellers order by id")).rows);
    await db.exec(MIGRATION);
    expect(JSON.stringify((await db.query("select * from public.sellers order by id")).rows)).toBe(before);
  });

  it("is idempotent", async () => {
    await db.exec(MIGRATION);
    await db.exec(MIGRATION);
    expect(await can("anon")).toBe(true);
    expect(await can("somebody")).toBe(false);
  });

  it("refuses to guess when a column is missing", async () => {
    await db.exec(`alter table public.sellers drop column w_id`);
    const f = await failure(() => db.exec(MIGRATION));
    expect(f?.message).toContain("0190 precondition: public.sellers lacks w_id");
    expect(await one(`select to_regprocedure($1) is null`, [SIG])).toBe(true);
  });

  it("refuses an existing function of the same name with another signature", async () => {
    await db.exec(`create function public.seller_legal_public(p int) returns int language sql as $$ select 1 $$`);
    const f = await failure(() => db.exec(MIGRATION));
    expect(f?.message).toContain("another signature");
  });

  it("the rollback removes the function and nothing else", async () => {
    await db.exec(MIGRATION);
    const others = await otherAcls();
    await db.exec(ROLLBACK);
    expect(await one(`select to_regprocedure($1) is null`, [SIG])).toBe(true);
    expect(await otherAcls()).toBe(others);
    await db.exec(ROLLBACK); // a second run is harmless
  });
});

describe("the file itself", () => {
  const code = MIGRATION.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");

  it("contains no write statement and touches no other object", () => {
    expect(code).not.toMatch(/\b(insert\s+into|update\s+public\.|delete\s+from|alter\s+table|drop\s+(table|function))\b/i);
    expect([...code.matchAll(/create (?:or replace )?function public\.([a-z_]+)\(/g)].map((m) => m[1]))
      .toEqual(["seller_legal_public"]);
    expect(code).not.toContain("legal_document_versions");
    expect(code).not.toMatch(/\binvoices\b|order_legal_snapshots|tax_regime/);
  });

  it("names its columns — never select s.*", () => {
    expect(code).not.toMatch(/select\s+s\.\*/);
  });

  it("is marked as not applied", () => {
    expect(MIGRATION).toContain("NOT APPLIED — neither on Staging nor on Production.");
  });
});
