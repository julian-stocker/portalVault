/**
 * The Production run packages for 0190 and 0191 (Production release F3,
 * 2026-11-13): `prod-0190.sql`, `prod-0191.sql` and their read-only
 * preflights and postflights.
 *
 * Two halves:
 *
 *   1. The text: each migration embedded character for character, one
 *      transaction, the environment guards before anything else, the measured
 *      areas (and the two deliberately NOT measured: collections, favourites),
 *      no Production number written into any file.
 *   2. The run, on PostgreSQL (PGlite) against a Production-SHAPED test
 *      database — invented rows, the 0133 objects and an unbounded sky_id_seq
 *      as Production has them, create_order exactly as 0139 left it:
 *      preflight → package → postflight for 0190, then for 0191, each with
 *      9999 = 0; the aborts (Staging stamp, Staging band, second run, wrong
 *      order, other legal versions, foreign create_order body) leave nothing
 *      behind; the postflight tolerates a new order and refuses a changed old
 *      one; the rollbacks in documented order restore the state before.
 *
 * WHAT THIS DOES NOT SHOW: that the files run on Production. The rows here
 * are invented, and PGlite is not the Production server. The preflight on
 * Production (9999 = 0) is the gate; this test only makes sure the gate and
 * the packages say what they claim.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const M0190 = "supabase/migrations/0190_seller_legal_public.sql";
const M0191 = "supabase/migrations/0191_create_order_terms_versions.sql";
const read = (p: string) => readFileSync(p, "utf8");

const RUN = { "0190": read("supabase/operations/prod-0190.sql"), "0191": read("supabase/operations/prod-0191.sql") };
const PRE = { "0190": read("supabase/checks/prod_0190_preflight.sql"), "0191": read("supabase/checks/prod_0191_preflight.sql") };
const POST = { "0190": read("supabase/checks/prod_0190_postflight.sql"), "0191": read("supabase/checks/prod_0191_postflight.sql") };
const MIG = { "0190": M0190, "0191": M0191 };
const STAGING_RUN = { "0190": read("supabase/operations/staging-0190.sql"), "0191": read("supabase/operations/staging-0191.sql") };
const R0190 = read("supabase/rollback/R0190_seller_legal_public.sql");
const R0191 = read("supabase/rollback/R0191_create_order_terms_versions.sql");
const PROD_0167 = read("supabase/operations/prod-0167.sql");

const SIX = "public.create_order(text, text, jsonb, jsonb, text, text)";
const EIGHT = "public.create_order(text, text, jsonb, jsonb, text, text, text, text)";
const VERSIONS = "agb=2026-09-17,datenschutz=2026-09-17,impressum=2026-09-17,widerruf=2026-09-17";

/** Executable SQL without `--` and block comments (string literals are kept). */
const code = (sql: string) => sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");

describe.each(["0190", "0191"] as const)("prod-%s.sql — the text", (mig) => {
  const run = RUN[mig];
  const file = MIG[mig];

  it("embeds the migration character for character, and nothing else", () => {
    const start = `-- >>> EINGEBETTET: ${file}\n`;
    const end = `-- <<< ENDE: ${file}\n`;
    expect(run.slice(run.indexOf(start) + start.length, run.indexOf(end))).toBe(read(file));
    expect([...run.matchAll(/^-- >>> EINGEBETTET: (\S+)$/gm)].map((m) => m[1])).toEqual([file]);
  });

  it("one transaction, REPEATABLE READ, ending in commit", () => {
    const lines = run.split("\n").map((l) => l.trim());
    expect(lines.filter((l) => /^begin\b.*;$/.test(l))).toEqual(["begin isolation level repeatable read;"]);
    expect(lines.filter((l) => l === "commit;")).toHaveLength(1);
    expect(run.trimEnd().endsWith("commit;")).toBe(true);
  });

  it("the environment guards come first: not Staging, then positively Production at the schema", () => {
    const embed = run.indexOf("-- >>> EINGEBETTET");
    const guards = ["ABBRUCH A0", "ABBRUCH A1a", "ABBRUCH A1b", "ABBRUCH A2:", "ABBRUCH A2b", "ABBRUCH A3", "ABBRUCH A4", "ABBRUCH A5"];
    let last = run.indexOf("begin isolation level repeatable read;");
    for (const g of guards) {
      const at = run.indexOf(g);
      expect(at, g).toBeGreaterThan(last);
      last = at;
    }
    expect(last).toBeLessThan(embed);
    // A1-A3 carry the conditions of prod-0167.sql word for word.
    for (const c of [
      "if to_regprocedure('public.purchases_paid_total_is_final()') is null then",
      "and t.tgname = 'purchases_paid_total_immutable_trg'",
      "and min_value = 928 and max_value = 4999;",
      "((min_value = 1 and max_value = 9223372036854775807)\n          or (min_value = 5001 and max_value = 8999));",
      "if (select count(*) from public.skylanders) < 100 then",
    ]) {
      expect(PROD_0167, c).toContain(c);
      expect(run, c).toContain(c);
    }
  });

  it("measures orders, invoices, snapshots, stock, movements, sellers, legal versions, rights and policies before and after", () => {
    for (const t of ["orders", "invoices", "order_legal_snapshots", "shop_inventory", "inventory_movements",
      "sellers", "legal_document_versions"]) {
      expect(run.match(new RegExp(`from public\\.${t} t\\) as ${t}`, "g")), t).toHaveLength(2);
    }
    for (const c of ["funktionen", "tabellenrechte", "policies"]) {
      expect(run.match(new RegExp(`\\) as ${c}`, "g")), c).toHaveLength(2);
    }
    expect(run.indexOf("ABBRUCH Z1")).toBeGreaterThan(run.indexOf(`-- <<< ENDE: ${file}`));
  });

  it("the checks of the new objects (Z2 onwards) are those of the Staging run, word for word", () => {
    const st = STAGING_RUN[mig];
    const from = st.indexOf("  /* Z2 —");
    const to = st.indexOf(`  raise notice '${mig} ok`);
    expect(run).toContain(st.slice(from, to));
  });
});

describe("collections, favourites and stale numbers stay out", () => {
  const all = [...Object.values(RUN), ...Object.values(PRE), ...Object.values(POST)];

  it("no package and no check reads collection_items or favorites", () => {
    for (const f of all) {
      expect(code(f)).not.toMatch(/public\.(collection_items|favorites)\b/);
    }
  });

  it("no check carries a baseline value — every one is measured or handed over at run time", () => {
    for (const f of all) {
      expect(code(f)).not.toMatch(/skyisles-p019[01]-1\|[0-9]/);
    }
    for (const mig of ["0190", "0191"] as const) {
      expect(POST[mig]).toContain(`current_setting('skyisles.p${mig}', true)`);
      expect(PRE[mig]).toContain(`'skyisles-p${mig}-1|' || kern`);
    }
  });

  it("no file names the Staging project as its target; the only mention is the refused stamp", () => {
    for (const f of all) {
      for (const m of code(f).matchAll(/qqxcpesbwfxzgytkdsac/g)) {
        expect(code(f).slice(m.index! - 40, m.index!)).toContain("skyisles-staging ");
      }
    }
  });
});

/* =========================================================================
 * THE RUN, ON POSTGRESQL
 * ====================================================================== */

/** create_order exactly as 0139 left it, with 0139's grants. */
const LEGACY = (() => {
  const src = read("supabase/migrations/0139_accessory_sale_release.sql");
  const start = src.indexOf("create or replace function public.create_order(");
  const grantEnd = src.indexOf("to anon, authenticated;", start) + "to anon, authenticated;".length;
  return src.slice(start, grantEnd);
})();

/** A Production-SHAPED world: the objects the packages and checks touch, with invented rows. */
const WORLD = `
create role anon nologin; create role authenticated nologin; create role service_role nologin;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
create schema auth;
create function auth.uid() returns uuid language sql as $$ select null::uuid $$;

-- What makes it look like Production: 0133 and an unbounded sky_id_seq.
create sequence public.sky_id_seq;
create table public.purchases (id bigint primary key, paid_total numeric);
create function public.purchases_paid_total_is_final() returns trigger language plpgsql as $$ begin return new; end $$;
create trigger purchases_paid_total_immutable_trg before update on public.purchases
  for each row execute function public.purchases_paid_total_is_final();

create table public.skylanders (sky_id text primary key, market_price numeric, name text,
  display_name_override text, image_file text, image_override_path text);
insert into public.skylanders select 'SKY-' || lpad(g::text, 4, '0'), 10, 'Figur ' || g, null, 'a.png', null
  from generate_series(1, 120) g;
create table public.collection_items (id bigint generated always as identity primary key, user_id uuid, sky_id text);
create table public.favorites (id bigint generated always as identity primary key, user_id uuid, sky_id text);
alter table public.collection_items enable row level security;
create policy collection_own on public.collection_items for select to authenticated using (true);

create table public.sellers (id bigint primary key, is_active boolean not null default true,
  display_name text, legal_name text, legal_form text, street text, postal_code text, city text,
  country_code text, contact_email text, direct_contact text, phone text, vat_id text, w_id text,
  register_court text, register_number text, small_business_19 boolean not null default true,
  dispute_participation boolean not null default false, dispute_body text,
  withdrawal_contact_email text, complaints_contact_email text,
  return_postage_borne_by text not null default 'customer');
insert into public.sellers (id, display_name, legal_name, legal_form, street, postal_code, city, country_code,
  contact_email, vat_id) values
  (1, 'skyisles.shop', 'Testperson', 'Einzelunternehmen', 'Teststrasse 1', '00000', 'Testort', 'DE',
   'test@example.invalid', 'DE000000000');
alter table public.sellers enable row level security;
revoke all on public.sellers from public, anon, authenticated;
create function public.seller_public() returns table (id bigint, display_name text) language sql
  security definer set search_path = '' as $$ select s.id, s.display_name from public.sellers s where s.is_active $$;

create table public.legal_document_versions (slug text primary key, version text not null,
  effective_from date not null, updated_at timestamptz not null default now());
insert into public.legal_document_versions (slug, version, effective_from) values
  ('agb', '2026-09-17', date '2026-09-17'), ('widerruf', '2026-09-17', date '2026-09-17'),
  ('datenschutz', '2026-09-17', date '2026-09-17'), ('impressum', '2026-09-17', date '2026-09-17');
alter table public.legal_document_versions enable row level security;
revoke all on table public.legal_document_versions from public, anon, authenticated;

create sequence public.order_no;
create table public.orders (
  id bigint generated always as identity primary key,
  order_number text not null default ('SI-' || lpad(nextval('public.order_no')::text, 6, '0')),
  request_id text unique not null, user_id uuid, customer_email text not null, client_hash text,
  commerce_mode text, items_subtotal numeric(10,2) not null, shipping_amount numeric(10,2) not null,
  total_amount numeric(10,2) not null, shipping_method_code text, shipping_method_name text,
  payment_token_hash text, status text not null default 'paid');
create table public.order_lines (order_id bigint references public.orders(id), sky_id text, condition text,
  quantity integer, name_snapshot text, image_snapshot text, unit_price numeric(10,2), line_total numeric(10,2),
  inventory_id bigint);
create table public.order_addresses (order_id bigint, kind text, first_name text, last_name text, company text,
  street text, house_number text, address_line_2 text, postal_code text, city text, country_code text, phone text);
create table public.order_events (order_id bigint, event_type text, actor_kind text, actor_user_id uuid);
create table public.reservations (order_id bigint, inventory_id bigint, quantity integer);
create table public.shop_inventory (id bigint primary key, sky_id text, condition text, is_listed boolean, sale_price numeric);
create table public.inventory_movements (id bigint generated always as identity primary key, inventory_id bigint, delta integer);
create table public.invoices (id bigint generated always as identity primary key, order_id bigint, number text);
create table public.shop_settings (price_percentage numeric);
insert into public.shop_inventory values (1, 'SKY-0001', 'loose', true, 12), (2, 'SKY-0002', 'loose', true, 9);
insert into public.inventory_movements (inventory_id, delta) values (1, 1), (2, 1);
insert into public.shop_settings values (100);

create function public.commerce_checkout_allowed() returns boolean language sql as $$ select true $$;
create function public.shipping_country_allowed(text) returns boolean language sql as $$ select $1 = 'DE' $$;
create function public.shipping_catalog() returns table (code text, name text) language sql as $$ select 'hermes', 'Hermes' $$;
create function public.request_client_hash() returns text language sql as $$ select 'client' $$;
create function public.enforce_checkout_limits(text, uuid, text) returns void language sql as $$ select $$;
create function public.max_cart_quantity() returns integer language sql as $$ select 5 $$;
create function public.v1_sale_condition() returns text language sql as $$ select 'loose' $$;
create function public.shop_price(numeric, numeric, numeric) returns numeric language sql as $$ select coalesce($1, $2) $$;
create function public.is_position_sellable(bigint) returns boolean language sql as $$ select true $$;
create function public.shipping_amount_for(text, numeric) returns numeric language sql as $$ select 4.99 $$;
create function public.commerce_mode() returns text language sql as $$ select 'live' $$;
create function public.reserve_for_order(p_order_id bigint) returns integer language plpgsql as $$
begin
  insert into public.reservations select l.order_id, l.inventory_id, l.quantity from public.order_lines l where l.order_id = p_order_id;
  return 1;
end $$;

create table public.order_legal_snapshots (order_id bigint primary key references public.orders (id),
  agb_version text not null, widerruf_version text not null);
create function public.orders_snapshot_legal() returns trigger language plpgsql set search_path = '' as $$
begin
  insert into public.order_legal_snapshots (order_id, agb_version, widerruf_version)
  select new.id,
         coalesce((select v.version from public.legal_document_versions v where v.slug = 'agb'), 'unversioned'),
         coalesce((select v.version from public.legal_document_versions v where v.slug = 'widerruf'), 'unversioned');
  return new;
end $$;
create trigger orders_snapshot_legal_trg after insert on public.orders for each row execute function public.orders_snapshot_legal();

-- One existing order with its invoice, as on Production.
insert into public.orders (request_id, customer_email, items_subtotal, shipping_amount, total_amount)
  values ('req-1', 'kunde@example.invalid', 12, 4.99, 16.99);
insert into public.invoices (order_id, number) values (1, 'R-1');
`;

type Row = { nr: number; befund: string | null; erwartet: string | null; ok: boolean | null };

let db: PGlite;

async function check(sql: string, baseline?: { key: string; line: string }): Promise<Row[]> {
  await db.exec("begin");
  try {
    if (baseline) await db.query("select set_config($1, $2, true)", [baseline.key, baseline.line]);
    return (await db.query<Row>(sql)).rows;
  } finally {
    await db.exec("rollback");
  }
}
const blocking = (rows: Row[]) => rows.find((r) => r.nr === 9999)!.befund;
const failed = (rows: Row[]) => rows.filter((r) => r.ok === false).map((r) => `${r.nr}: ${r.befund} ≠ ${r.erwartet}`);
const row = (rows: Row[], nr: number) => rows.find((r) => r.nr === nr)!;
const baselineOf = async (mig: "0190" | "0191") => {
  const rows = await check(PRE[mig]);
  expect(failed(rows), `prod_${mig}_preflight`).toEqual([]);
  return { key: `skyisles.p${mig}`, line: row(rows, 900).befund! };
};
const exists = async (sig: string) =>
  (await db.query<{ e: boolean }>("select to_regprocedure($1) is not null as e", [sig])).rows[0].e;
async function runFails(sql: string, pattern: RegExp) {
  await expect(db.exec(sql)).rejects.toThrow(pattern);
  await db.exec("rollback").catch(() => {});
}

/** A fresh Production-shaped database — only for the tests that run SQL. */
async function freshDb() {
  db = new PGlite();
  await db.exec(WORLD);
  await db.exec(LEGACY);
}

describe("the release on a Production-shaped database", () => {
  beforeEach(freshDb);
  it("0190 then 0191: each preflight, package and postflight passes with 9999 = 0", async () => {
    const b0190 = await baselineOf("0190");
    await db.exec(RUN["0190"]);
    const post0190 = await check(POST["0190"], b0190);
    expect(failed(post0190)).toEqual([]);
    expect(blocking(post0190)).toBe("0");

    const b0191 = await baselineOf("0191");
    expect(b0191.line).not.toBe(b0190.line);         // its own baseline, taken anew
    await db.exec(RUN["0191"]);
    const post0191 = await check(POST["0191"], b0191);
    expect(failed(post0191)).toEqual([]);
    expect(blocking(post0191)).toBe("0");
    expect(row(post0191, 221).befund).toBe(VERSIONS);
    expect(await exists(SIX)).toBe(true);
    expect(await exists(EIGHT)).toBe(true);
  });

  it("the preflight's baseline has the documented shape: marker, 15 fields, checksum", async () => {
    const { line } = await baselineOf("0190");
    const parts = line.split("|");
    expect(parts).toHaveLength(17);
    expect(parts[0]).toBe("skyisles-p0190-1");
    expect(parts.slice(0, 2)).toEqual(["skyisles-p0190-1", "1"]);   // one order, largest id 1
  });

  it("the preflight blocks on seller identity and legal versions — and only names, never values", async () => {
    await db.exec("update public.sellers set legal_form = 'GmbH', street = ''");
    await db.exec("update public.legal_document_versions set version = '2026-11-11' where slug = 'agb'");
    const rows = await check(PRE["0190"]);
    expect(failed(rows).map((f) => f.split(":")[0])).toEqual(["123", "127", "131", "9999"]);
    expect(rows.map((r) => r.befund).join("\n")).not.toContain("Testperson");
  });
});

describe("the postflight compares what existed — not what came later", () => {
  beforeEach(freshDb);
  it("a new order after the preflight does not break it", async () => {
    const b = await baselineOf("0190");
    await db.exec(RUN["0190"]);
    await db.exec(`insert into public.orders (request_id, customer_email, items_subtotal, shipping_amount, total_amount)
                   values ('req-2', 'neu@example.invalid', 9, 4.99, 13.99)`);
    await db.exec("insert into public.collection_items (user_id, sky_id) values (null, 'SKY-0003')");
    const rows = await check(POST["0190"], b);
    expect(failed(rows)).toEqual([]);
    expect(row(rows, 891).befund).toBe("1");           // the new order is reported, not compared
  });

  it("a changed existing order, invoice or snapshot is caught", async () => {
    const b = await baselineOf("0190");
    await db.exec(RUN["0190"]);
    await db.exec("update public.orders set status = 'refunded' where id = 1");
    await db.exec("update public.invoices set number = 'R-1X' where id = 1");
    const rows = await check(POST["0190"], b);
    expect(failed(rows).map((f) => f.split(":")[0])).toEqual(["811", "812", "9999"]);
  });

  it("without a baseline, or with a tampered one, it fails instead of abstaining", async () => {
    await db.exec(RUN["0190"]);
    const none = await check(POST["0190"]);
    expect(row(none, 801).befund).toBe("FEHLT");
    expect(Number(blocking(none))).toBeGreaterThan(10);

    const pre = await check(PRE["0190"]);
    const parts = row(pre, 900).befund!.split("|");
    parts[2] = "0".repeat(32);
    const tampered = await check(POST["0190"], { key: "skyisles.p0190", line: parts.join("|") });
    expect(row(tampered, 803).ok).toBe(false);
  });

  it("a right that moved is caught (821-823)", async () => {
    const b = await baselineOf("0190");
    await db.exec(RUN["0190"]);
    await db.exec("grant select on public.sellers to anon");
    const rows = await check(POST["0190"], b);
    expect(failed(rows).map((f) => f.split(":")[0])).toEqual(["221", "822", "9999"]);
  });
});

describe("the aborts leave nothing behind", () => {
  beforeEach(freshDb);
  it("on Staging: the stamp (A0) and the Staging band of sky_id_seq (A2)", async () => {
    await db.exec(`do $$ begin execute format('comment on database %I is %L', current_database(),
                   'skyisles-staging qqxcpesbwfxzgytkdsac'); end $$`);
    await runFails(RUN["0190"], /ABBRUCH A0/);
    await db.exec(`do $$ begin execute format('comment on database %I is null', current_database()); end $$`);
    await db.exec("alter sequence public.sky_id_seq minvalue 928 maxvalue 4999 start 928 restart 928");
    await runFails(RUN["0190"], /ABBRUCH A2:/);
    expect(await exists("public.seller_legal_public()")).toBe(false);
  });

  it("without the 0133 objects (A1a)", async () => {
    await db.exec("drop trigger purchases_paid_total_immutable_trg on public.purchases; drop function public.purchases_paid_total_is_final()");
    await runFails(RUN["0190"], /ABBRUCH A1a/);
  });

  it("a second run of 0190 (A5) and 0191 before 0190 (A5)", async () => {
    await runFails(RUN["0191"], /ABBRUCH A5: seller_legal_public aus 0190 fehlt/);
    expect(await exists(EIGHT)).toBe(false);
    await db.exec(RUN["0190"]);
    await runFails(RUN["0190"], /ABBRUCH A5: seller_legal_public liegt schon/);
  });

  it("0191 with other legal versions (A7), twice (A6), or on a foreign create_order body", async () => {
    await db.exec(RUN["0190"]);
    await db.exec("update public.legal_document_versions set version = '2026-11-11'");
    await runFails(RUN["0191"], /ABBRUCH A7/);
    await db.exec("update public.legal_document_versions set version = '2026-09-17'");
    await db.exec(LEGACY.replace("as $$", () => "as $$\n-- foreign\n"));
    await runFails(RUN["0191"], /0191 precondition: create_order\(six\) is not the body of 0139/);
    expect(await exists(EIGHT)).toBe(false);
    expect(await exists("public.legal_versions_public()")).toBe(false);
    await db.exec(LEGACY);
    await db.exec(RUN["0191"]);
    await runFails(RUN["0191"], /ABBRUCH A6/);
  });
});

describe("the rollbacks, in the documented order", () => {
  beforeEach(freshDb);
  it("R0191 then R0190 return to the state before 0190 — the six untouched throughout", async () => {
    const before = await baselineOf("0190");
    const sixBefore = (await db.query<{ s: string }>(
      "select md5(prosrc) || '|' || coalesce(proacl::text, '') as s from pg_proc where oid = to_regprocedure($1)", [SIX])).rows[0].s;
    await db.exec(RUN["0190"]);
    await db.exec(RUN["0191"]);
    await db.exec(R0191);
    await db.exec(R0190);
    expect(await exists(EIGHT)).toBe(false);
    expect(await exists("public.legal_versions_public()")).toBe(false);
    expect(await exists("public.seller_legal_public()")).toBe(false);
    const sixAfter = (await db.query<{ s: string }>(
      "select md5(prosrc) || '|' || coalesce(proacl::text, '') as s from pg_proc where oid = to_regprocedure($1)", [SIX])).rows[0].s;
    expect(sixAfter).toBe(sixBefore);
    // The preflight passes again, and its baseline is the one from before — nothing moved.
    expect((await baselineOf("0190")).line).toBe(before.line);
  });
});
