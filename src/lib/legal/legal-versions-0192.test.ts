/**
 * The document versions (ADR-0184, AP5): `LEGAL_VERSIONS` and the latest
 * versions migration agree, the version that stops being current is archived,
 * and 0192 changes four rows of `legal_document_versions` — no order, no
 * snapshot, no invoice — on real PostgreSQL. Plus its Staging run package.
 *
 * Prepared only — 0192 is not applied anywhere (see APPLIED.md).
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LEGAL_ARCHIVE } from "@/lib/legal/archive";
import { LEGAL_VERSIONS } from "@/lib/legal/documents";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const FILE = "supabase/migrations/0192_legal_versions_2026_11_11.sql";
const MIGRATION = readFileSync(FILE, "utf8");
const ROLLBACK = readFileSync("supabase/rollback/R0192_legal_versions_2026_11_11.sql", "utf8");
const RUN = readFileSync("supabase/operations/staging-0192.sql", "utf8");
const PRE = readFileSync("supabase/checks/0192_preflight.sql", "utf8");
const POST = readFileSync("supabase/checks/0192_postflight.sql", "utf8");
const PLAN = JSON.parse(readFileSync("supabase/checks/migration-plans.json", "utf8")).migrationen["0192"];
const SLUGS = ["agb", "datenschutz", "impressum", "widerruf"];

/*
 * 0192 needs 0191: the six-parameter create_order of 0139 and the coupled one
 * beside it. PL/pgSQL checks a body only when it runs, so both stand here as
 * their exact texts — their md5 is what 0191 and 0192 demand. What the
 * coupled one DOES is tested in `create-order-terms-0191.test.ts`.
 */
const LEGACY_0139 = (() => {
  const src = readFileSync("supabase/migrations/0139_accessory_sale_release.sql", "utf8");
  const start = src.indexOf("create or replace function public.create_order(");
  const end = src.indexOf("to anon, authenticated;", start) + "to anon, authenticated;".length;
  return src.slice(start, end);
})();
const M0191 = readFileSync("supabase/migrations/0191_create_order_terms_versions.sql", "utf8");
const SIX = "public.create_order(text, text, jsonb, jsonb, text, text)";

/** The latest migration that sets a version, and what it sets from → to. */
function latestVersionMigration() {
  const files = readdirSync("supabase/migrations").filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
  const setting = files.filter((f) =>
    /update public\.legal_document_versions/.test(readFileSync(`supabase/migrations/${f}`, "utf8")));
  const file = setting[setting.length - 1];
  const sql = readFileSync(`supabase/migrations/${file}`, "utf8");
  const update = sql.slice(sql.indexOf("update public.legal_document_versions"));
  return {
    file,
    to: /set version = '([^']+)'/.exec(update)![1],
    from: /and version = '([^']+)'/.exec(update)![1],
    slugs: /where slug in \(([^)]+)\)/.exec(update)![1].replace(/'/g, "").split(/,\s*/).sort(),
  };
}

describe("LEGAL_VERSIONS and the database agree", () => {
  const latest = latestVersionMigration();

  it("the latest versions migration is 0192 and sets exactly LEGAL_VERSIONS", () => {
    expect(latest.file).toBe("0192_legal_versions_2026_11_11.sql");
    expect(latest.slugs).toEqual(SLUGS);
    for (const slug of latest.slugs) {
      expect(LEGAL_VERSIONS[slug as keyof typeof LEGAL_VERSIONS], slug).toBe(latest.to);
    }
  });

  it("a version changes only for documents that changed — all four name the seller", () => {
    // Every document whose version moves names the seller and so changed with AP5.
    expect(Object.keys(LEGAL_VERSIONS).sort()).toEqual(latest.slugs);
  });

  it("the version that stops being current is archived, unchanged", () => {
    expect(Object.keys(LEGAL_ARCHIVE)).toContain(latest.from);
    for (const slug of SLUGS) {
      expect(LEGAL_ARCHIVE[latest.from][slug as "agb"].version, slug).toBe(latest.from);
    }
  });

  it("the current version is never in the archive", () => {
    for (const version of Object.values(LEGAL_VERSIONS)) expect(Object.keys(LEGAL_ARCHIVE)).not.toContain(version);
  });
});

/* ------------------------------------------------------------ PostgreSQL */

const WORLD = `
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create table public.orders (id bigint primary key, total numeric not null);
create table public.legal_document_versions (
  slug text primary key, version text not null, effective_from date not null,
  updated_at timestamptz not null default now(),
  constraint legal_document_versions_slug_known check (slug in ('agb', 'widerruf', 'datenschutz', 'impressum')),
  constraint legal_document_versions_version_shape check (version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}(\\.[0-9]+)?$'));
comment on table public.legal_document_versions is
  'Which version of each legal text is current. The TEXT lives in src/lib/legal/; this holds only the identifier, so a trigger can snapshot it onto an order without a second round trip (ADR-0086).';
insert into public.legal_document_versions (slug, version, effective_from) values
  ('agb', '2026-09-17', date '2026-09-17'), ('widerruf', '2026-09-17', date '2026-09-17'),
  ('datenschutz', '2026-09-17', date '2026-09-17'), ('impressum', '2026-09-17', date '2026-09-17');
alter table public.legal_document_versions enable row level security;
revoke all on table public.legal_document_versions from public, anon, authenticated;

create table public.order_legal_snapshots (order_id bigint primary key references public.orders (id),
  agb_version text not null, widerruf_version text not null, seller_name text);
create function public.orders_snapshot_legal() returns trigger language plpgsql set search_path = '' as $$
begin
  insert into public.order_legal_snapshots (order_id, agb_version, widerruf_version, seller_name)
  select new.id,
         coalesce((select v.version from public.legal_document_versions v where v.slug = 'agb'), 'unversioned'),
         coalesce((select v.version from public.legal_document_versions v where v.slug = 'widerruf'), 'unversioned'),
         'beispiel.shop';
  return new;
end $$;
create trigger orders_snapshot_legal_trg after insert on public.orders for each row execute function public.orders_snapshot_legal();
create function public.order_legal_snapshots_protect() returns trigger language plpgsql as $$
begin raise exception 'the legal terms recorded for an order cannot be changed or deleted' using errcode = 'restrict_violation'; end $$;
create trigger order_legal_snapshots_protect_trg before update or delete on public.order_legal_snapshots
  for each row execute function public.order_legal_snapshots_protect();
create table public.invoices (id bigint primary key, order_id bigint not null, seller_name text);
`;

let db: PGlite;
const rows = async <T>(sql: string) => (await db.query<T>(sql)).rows;
const versions = async () => (await rows<{ v: string }>(
  `select string_agg(slug || '=' || version, '|' order by slug) as v from public.legal_document_versions`))[0].v;
const snapshots = async () => (await rows<{ v: string }>(
  `select coalesce(string_agg(order_id || ':' || agb_version || '/' || widerruf_version, '|' order by order_id), '') as v from public.order_legal_snapshots`))[0].v;
const failure = async (sql: string) => {
  try { await db.exec(sql); return null; } catch (e) { return (e as Error).message; }
};

beforeEach(async () => {
  db = new PGlite();
  await db.exec(WORLD);
  await db.exec(LEGACY_0139);
  await db.exec(M0191);
  await db.exec(`insert into public.orders values (1, 10), (2, 20);
    insert into public.invoices values (1, 1, 'yulez.collectibles');`);
});
afterEach(async () => { await db.close(); });

describe("0192 on PostgreSQL", () => {
  it("moves the four versions to 2026-11-11 and sets the mark", async () => {
    await db.exec(MIGRATION);
    expect(await versions()).toBe("agb=2026-11-11|datenschutz=2026-11-11|impressum=2026-11-11|widerruf=2026-11-11");
    const [{ c }] = await rows<{ c: string }>(
      `select obj_description('public.legal_document_versions'::regclass, 'pg_class') as c`);
    expect(c).toContain("[aktuell: 2026-11-11]");
    const [{ applied }] = await rows<{ applied: boolean }>(PLAN.angewendet.sql.replace("as erfuellt", "as applied"));
    expect(applied).toBe(true);
  });

  it("leaves every existing order snapshot and invoice exactly as it was", async () => {
    const before = await snapshots();
    expect(before).toBe("1:2026-09-17/2026-09-17|2:2026-09-17/2026-09-17");
    await db.exec(MIGRATION);
    expect(await snapshots()).toBe(before);
    expect((await rows<{ v: string }>(`select string_agg(id || ':' || seller_name, '|') as v from public.invoices`))[0].v)
      .toBe("1:yulez.collectibles");
  });

  it("an order placed AFTER it carries the new version, the earlier ones keep theirs", async () => {
    await db.exec(MIGRATION);
    await db.exec(`insert into public.orders values (3, 30)`);
    expect(await snapshots()).toBe("1:2026-09-17/2026-09-17|2:2026-09-17/2026-09-17|3:2026-11-11/2026-11-11");
  });

  it("is idempotent: a second run changes nothing", async () => {
    await db.exec(MIGRATION);
    const [{ e }] = await rows<{ e: string }>(`select string_agg(effective_from::text || updated_at::text, '|' order by slug) as e from public.legal_document_versions`);
    await db.exec(MIGRATION);
    const [{ e: again }] = await rows<{ e: string }>(`select string_agg(effective_from::text || updated_at::text, '|' order by slug) as e from public.legal_document_versions`);
    expect(again).toBe(e);
  });

  it("refuses to overwrite a version it does not know", async () => {
    await db.exec(`update public.legal_document_versions set version = '2026-10-01' where slug = 'agb'`);
    expect(await failure(MIGRATION)).toContain("refusing to overwrite an unexpected version: agb=2026-10-01");
    expect(await versions()).toContain("agb=2026-10-01");
  });

  it("refuses when a document is missing", async () => {
    await db.exec(`delete from public.legal_document_versions where slug = 'impressum'`);
    expect(await failure(MIGRATION)).toContain("expected exactly agb, datenschutz, impressum, widerruf");
  });

  it("contains no statement on orders, snapshots or invoices", () => {
    const code = MIGRATION.replace(/^\s*--.*$/gm, "");
    expect(code).not.toMatch(/\b(insert|update|delete)\b[^;]*\b(orders|order_legal_snapshots|invoices)\b/i);
    expect(code).not.toMatch(/\b(grant|revoke|alter|create)\b/i);
    expect(code.match(/\bupdate\b/gi)).toHaveLength(1);
    // The one DDL statement: the six-parameter create_order goes, nothing else.
    expect(code.match(/\bdrop\b[^;]*;/gi)).toEqual([
      "drop function if exists public.create_order(text, text, jsonb, jsonb, text, text);",
    ]);
  });

  it("removes the six-parameter create_order and keeps the coupled one", async () => {
    await db.exec(MIGRATION);
    const [{ v }] = await rows<{ v: string }>(
      `select string_agg(oid::regprocedure::text, ',') as v from pg_proc where proname = 'create_order'`);
    expect(v).toBe("create_order(text,text,jsonb,jsonb,text,text,text,text)");
  });

  it("the rollback returns the four rows and the comment, and leaves snapshots alone", async () => {
    await db.exec(MIGRATION);
    await db.exec(`insert into public.orders values (3, 30)`);
    await db.exec(ROLLBACK);
    expect(await versions()).toBe("agb=2026-09-17|datenschutz=2026-09-17|impressum=2026-09-17|widerruf=2026-09-17");
    expect(await snapshots()).toContain("3:2026-11-11/2026-11-11");
    const [{ md5 }] = await rows<{ md5: string }>(
      `select md5(prosrc) as md5 from pg_proc where oid = to_regprocedure('${SIX}')`);
    expect(md5).toBe("c233337c0ca0555756f21e1abe173593");
    const [{ applied }] = await rows<{ applied: boolean }>(PLAN.angewendet.sql.replace("as erfuellt", "as applied"));
    expect(applied).toBe(false);
  });
});

describe("staging-0192.sql", () => {
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
    expect(RUN.indexOf("ABBRUCH A1")).toBeGreaterThan(RUN.indexOf("begin;"));
    expect(RUN).toContain("'skyisles-staging qqxcpesbwfxzgytkdsac'");
    for (const f of [RUN, PRE, POST, MIGRATION, ROLLBACK]) expect(f).not.toContain("zmiwxswrpkmizvqsgype");
  });

  it("measures orders, snapshots, invoices and every right and body before and after, and stops on movement", () => {
    for (const t of ["order_legal_snapshots", "orders", "invoices", "sellers", "shop_inventory", "collection_items"]) {
      expect(RUN.match(new RegExp(`from public\\.${t} t\\) as `, "g")), t).toHaveLength(2);
    }
    expect(RUN.match(/md5\(p\.prosrc\),/g)).toHaveLength(2);
    expect(RUN.indexOf("ABBRUCH Z1")).toBeGreaterThan(RUN.indexOf(`-- <<< ENDE: ${FILE}`));
  });

  it("the run actually succeeds on the small world and its measurements hold", async () => {
    const stamped = RUN.replace(
      /coalesce\(\(select shobj_description[\s\S]*?\), ''\)\n\s+<> 'skyisles-staging qqxcpesbwfxzgytkdsac'/,
      "'skyisles-staging qqxcpesbwfxzgytkdsac' <> 'skyisles-staging qqxcpesbwfxzgytkdsac'");
    await db.exec(`create table public.sellers (id bigint primary key); create table public.shop_inventory (id bigint primary key);
      create table public.collection_items (id bigint primary key, user_id uuid, sky_id text);`);
    await db.exec(stamped);
    expect(await versions()).toContain("agb=2026-11-11");
  });

  it("the preflight shows a second run (102, 103), the postflight the result (201–204)", () => {
    expect(PRE).toContain("'agb=2026-09-17|datenschutz=2026-09-17|impressum=2026-09-17|widerruf=2026-09-17'");
    expect(POST).toContain("'agb=2026-11-11|datenschutz=2026-11-11|impressum=2026-11-11|widerruf=2026-11-11'");
    expect(PRE).toMatch(/\(103, 'Grundlage', 'die Standmarke/);
    expect(POST).toMatch(/\(203, 'Kennung', 'die Standmarke/);
  });

  it("the plan names its files and reads the mark the check account can see", () => {
    expect(PLAN).toMatchObject({ preflight: "0192_preflight.sql", lauf: "staging-0192.sql", postflight: "0192_postflight.sql" });
    expect(PLAN.angewendet.sql).toContain("obj_description(to_regclass('public.legal_document_versions'), 'pg_class')");
    expect(PLAN.angewendet.sql).toMatch(/as erfuellt$/);
  });
});
