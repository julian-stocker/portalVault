/**
 * 0191 + 0192 (ADR-0184, AP5) on real PostgreSQL: an order is created only
 * with the AGB and Widerruf versions the checkout showed, and only while those
 * are the versions in force — enforced by the database, inside the order
 * transaction, under a row lock. And `legal_versions_public()`, from which the
 * pages and the checkout learn which version that is.
 *
 * THE WORLD RUNS THE REAL BODY. The six-parameter create_order is the exact
 * text of 0139 (its md5 is what 0191 demands); everything it calls is a small
 * but working stand-in — a price, a shipping method, a reservation that writes
 * a row — so "no order and no reservation" is something these tests can count.
 * PGlite has one session; the lock is proven inside the transaction
 * (`pg_locks`, the row's locker) rather than by a second connection.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const SIX = "public.create_order(text, text, jsonb, jsonb, text, text)";
const EIGHT = "public.create_order(text, text, jsonb, jsonb, text, text, text, text)";
const M0191 = readFileSync("supabase/migrations/0191_create_order_terms_versions.sql", "utf8");
const M0192 = readFileSync("supabase/migrations/0192_legal_versions_2026_11_11.sql", "utf8");
const R0191 = readFileSync("supabase/rollback/R0191_create_order_terms_versions.sql", "utf8");
const R0192 = readFileSync("supabase/rollback/R0192_legal_versions_2026_11_11.sql", "utf8");

/** create_order exactly as 0139 left it, with 0139's grants. */
const LEGACY = (() => {
  const src = readFileSync("supabase/migrations/0139_accessory_sale_release.sql", "utf8");
  const start = src.indexOf("create or replace function public.create_order(");
  const grantEnd = src.indexOf("to anon, authenticated;", start) + "to anon, authenticated;".length;
  return src.slice(start, grantEnd);
})();
const legacyBody = (() => {
  const a = LEGACY.indexOf("as $$") + 5;
  return LEGACY.slice(a, LEGACY.indexOf("$$;", a));
})();

const WORLD = `
create role anon nologin; create role authenticated nologin; create role service_role nologin;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
create schema auth;
create function auth.uid() returns uuid language sql as $$ select null::uuid $$;

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
  payment_token_hash text);
create table public.order_lines (order_id bigint references public.orders(id), sky_id text, condition text,
  quantity integer, name_snapshot text, image_snapshot text, unit_price numeric(10,2), line_total numeric(10,2),
  inventory_id bigint);
create table public.order_addresses (order_id bigint, kind text, first_name text, last_name text, company text,
  street text, house_number text, address_line_2 text, postal_code text, city text, country_code text, phone text);
create table public.order_events (order_id bigint, event_type text, actor_kind text, actor_user_id uuid);
create table public.reservations (order_id bigint, inventory_id bigint, quantity integer);
create table public.skylanders (sky_id text primary key, market_price numeric, name text,
  display_name_override text, image_file text, image_override_path text);
create table public.shop_inventory (id bigint primary key, sky_id text, condition text, is_listed boolean, sale_price numeric);
create table public.shop_settings (price_percentage numeric);
insert into public.skylanders values ('SKY-0001', 10, 'Spyro', null, 'a.png', null);
insert into public.shop_inventory values (1, 'SKY-0001', 'loose', true, 12);
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
create function public.order_legal_snapshots_protect() returns trigger language plpgsql as $$
begin raise exception 'the legal terms recorded for an order cannot be changed or deleted' using errcode = 'restrict_violation'; end $$;
create trigger order_legal_snapshots_protect_trg before update or delete on public.order_legal_snapshots
  for each row execute function public.order_legal_snapshots_protect();
`;

let db: PGlite;
let seq = 0;
const one = async <T>(sql: string, params: unknown[] = []) =>
  Object.values((await db.query(sql, params)).rows[0] as object)[0] as T;
const counts = async () => one<string>(`select
  (select count(*) from public.orders) || '/' || (select count(*) from public.order_lines) || '/' ||
  (select count(*) from public.order_addresses) || '/' || (select count(*) from public.order_events) || '/' ||
  (select count(*) from public.reservations) || '/' || (select count(*) from public.order_legal_snapshots)`);
const snapshots = () => one<string>(`select coalesce(string_agg(order_id || ':' || agb_version || '/' || widerruf_version, '|' order by order_id), '') from public.order_legal_snapshots`);
const failure = async (f: () => Promise<unknown>) => {
  try { await f(); return null; } catch (e) { return (e as { code?: string }).code ?? (e as Error).message; }
};
const message = async (f: () => Promise<unknown>) => {
  try { await f(); return null; } catch (e) { return (e as Error).message; }
};

const ARGS = `p_request_id => $1, p_email => 'k@example.org',
  p_items => '[{"sky_id":"SKY-0001","condition":"loose","quantity":1}]'::jsonb,
  p_address => '{"first_name":"A","last_name":"B","street":"S","house_number":"1","postal_code":"10115","city":"Berlin","country_code":"DE"}'::jsonb,
  p_shipping_method => 'hermes', p_payment_token => $2`;
const TOKEN = "t".repeat(40);
/** The call PostgREST makes: named notation, as the checkout's keys. */
const coupled = (agb: string | null, widerruf: string | null, requestId = `req-${++seq}-xxxxxxxx`) =>
  db.query(`select * from public.create_order(${ARGS}, p_agb_version => $3, p_widerruf_version => $4)`,
    [requestId, TOKEN, agb, widerruf]);
const legacy = (requestId = `req-${++seq}-xxxxxxxx`) =>
  db.query(`select * from public.create_order(${ARGS})`, [requestId, TOKEN]);
/** What the checkout page reads when it renders (`fetchLegalVersions()`), as anon. */
const inForce = async () => {
  await db.exec("set role anon");
  try {
    return (await db.query<{ agb: string; widerruf: string; datenschutz: string; impressum: string }>(
      `select * from public.legal_versions_public()`)).rows;
  } finally { await db.exec("reset role"); }
};
const LVP = "public.legal_versions_public()";

beforeEach(async () => {
  db = new PGlite();
  try { await db.exec(WORLD); } catch (e) { throw new Error(`WORLD: ${(e as Error).message}`); }
  try { await db.exec(LEGACY); } catch (e) { throw new Error(`LEGACY: ${(e as Error).message}`); }
});
afterEach(async () => { await db.close(); });

describe("0191 — the coupled create_order, beside the old one", () => {
  beforeEach(async () => { await db.exec(M0191); });

  it("is the 0139 body plus exactly the two insertions, nothing else", async () => {
    const body = await one<string>(`select prosrc from pg_proc where oid = to_regprocedure($1)`, [EIGHT]);
    const declared = body.indexOf("  -- 0191 (ADR-0184): the current versions, read under a share lock.\n");
    const declEnd = body.indexOf("  v_widerruf_current text;\n") + "  v_widerruf_current text;\n".length;
    const block = body.indexOf("  -- -------------------------------------------------------------------------\n  -- 0191 (ADR-0184, AP5)");
    const blockEnd = body.indexOf("  if p_email is null or p_email not like");
    expect(declared).toBeGreaterThan(0);
    expect(body.slice(0, declared) + body.slice(declEnd, block) + body.slice(blockEnd)).toBe(legacyBody);
    // The reservation call stays where it was — the stock logic is not touched.
    expect(body.match(/perform public\.reserve_for_order\(v_order_id\);/g)).toHaveLength(1);
    expect(body.indexOf("for share")).toBeLessThan(body.indexOf("insert into public.orders"));
  });

  it("carries exactly the rights, owner and form of the old one, and no defaults", async () => {
    for (const role of ["anon", "authenticated", "service_role"]) {
      expect(await one<boolean>(`select has_function_privilege($1, $2, 'execute')`, [role, EIGHT]), role)
        .toBe(await one<boolean>(`select has_function_privilege($1, $2, 'execute')`, [role, SIX]));
    }
    expect(await one<boolean>(`select exists (select 1 from pg_proc p, aclexplode(p.proacl) a
      where p.oid = to_regprocedure($1) and a.grantee = 0)`, [EIGHT])).toBe(false);
    expect(await one<string>(`select prosecdef || '|' || pronargdefaults || '|' || array_to_string(proconfig, ',')
      from pg_proc where oid = to_regprocedure($1)`, [EIGHT])).toBe('true|0|search_path=""');
  });

  it("matching versions: an order, its reservation, and the snapshot of exactly those versions", async () => {
    const { rows } = await coupled("2026-09-17", "2026-09-17");
    expect(rows).toHaveLength(1);
    expect(await counts()).toBe("1/1/1/1/1/1");
    expect(await snapshots()).toMatch(/^1:2026-09-17\/2026-09-17$/);
  });

  it("a stale version: LV002, and no order, line, address, event, reservation or snapshot", async () => {
    expect(await failure(() => coupled("2026-08-01", "2026-09-17"))).toBe("LV002");
    expect(await failure(() => coupled("2026-09-17", "2026-11-11"))).toBe("LV002");
    expect(await counts()).toBe("0/0/0/0/0/0");
  });

  it("a missing version: LV001, nothing written — null, empty or blank", async () => {
    for (const [agb, widerruf] of [[null, "2026-09-17"], ["2026-09-17", null], ["", "2026-09-17"], ["2026-09-17", "  "]]) {
      expect(await failure(() => coupled(agb, widerruf)), `${agb}/${widerruf}`).toBe("LV001");
    }
    expect(await counts()).toBe("0/0/0/0/0/0");
  });

  it("is enforced for a direct call as anon — not by the application", async () => {
    await db.exec("set role anon");
    try {
      expect(await failure(() => coupled("2026-01-01", "2026-01-01"))).toBe("LV002");
      expect(await failure(() => coupled(null, null))).toBe("LV001");
    } finally { await db.exec("reset role"); }
    expect(await counts()).toBe("0/0/0/0/0/0");
  });

  it("a replay of a placed order returns it, even after the versions changed", async () => {
    await coupled("2026-09-17", "2026-09-17", "req-replay-xxxx");
    await db.exec(`update public.legal_document_versions set version = '2026-11-11'`);
    const { rows } = await coupled("2026-09-17", "2026-09-17", "req-replay-xxxx");
    expect(rows).toHaveLength(1);
    expect(await snapshots()).toBe("1:2026-09-17/2026-09-17");
  });

  it("locks the two version rows FOR SHARE until the order commits", async () => {
    await db.exec("begin");
    await coupled("2026-09-17", "2026-09-17");
    const lock = await one<string>(`select string_agg(mode, ',' order by mode) from pg_locks
      where relation = 'public.legal_document_versions'::regclass and pid = pg_backend_pid()`);
    expect(lock).toContain("RowShareLock");
    // The two rows read FOR SHARE carry this transaction as their locker; the
    // two the order does not read do not.
    const lockers = await one<string>(`select string_agg(slug || '=' || (xmax::text::bigint = txid_current() % 4294967296)::text, ',' order by slug)
      from public.legal_document_versions`);
    expect(lockers).toBe("agb=true,datenschutz=false,impressum=false,widerruf=true");
    await db.exec("commit");
  });

  it("the old six-parameter path still works as before during the transition", async () => {
    const { rows } = await legacy();
    expect(rows).toHaveLength(1);
    expect(await snapshots()).toMatch(/2026-09-17\/2026-09-17$/);
  });

  it("named calls resolve unambiguously: six names → old, eight → coupled, seven → none", async () => {
    await legacy();
    await coupled("2026-09-17", "2026-09-17");
    expect(await counts()).toBe("2/2/2/2/2/2");
    expect(await failure(() => db.query(`select * from public.create_order(${ARGS}, p_agb_version => '2026-09-17')`,
      ["req-seven-xxxx", TOKEN]))).toBe("42883");
  });

  it("is idempotent", async () => {
    await db.exec(M0191);
    expect(await one<string>(`select count(*)::text from pg_proc where proname = 'create_order'`)).toBe("2");
    expect(await one<string>(`select md5(prosrc) from pg_proc where oid = to_regprocedure($1)`, [LVP]))
      .toBe("5e9daa01284d9b06b1b7d8fb053cff36");
  });
});

describe("0191 — legal_versions_public(): the versions in force, and nothing else", () => {
  beforeEach(async () => { await db.exec(M0191); });

  it("one row, exactly the four identifiers — no date, no timestamp, no other slug", async () => {
    await db.exec(`insert into public.legal_document_versions values ('internal', '2026-01-01', date '2026-01-01')`);
    const rows = await inForce();
    expect(rows).toEqual([{ agb: "2026-09-17", widerruf: "2026-09-17", datenschutz: "2026-09-17", impressum: "2026-09-17" }]);
    expect(await one<string>(`select pg_get_function_result(to_regprocedure($1))`, [LVP]))
      .toBe("TABLE(agb text, widerruf text, datenschutz text, impressum text)");
  });

  it("stable, SECURITY DEFINER with an empty search_path; anon and authenticated only, never PUBLIC", async () => {
    expect(await one<string>(`select provolatile::text || '|' || prosecdef || '|' || array_to_string(proconfig, ',')
      from pg_proc where oid = to_regprocedure($1)`, [LVP])).toBe('s|true|search_path=""');
    expect(await one<string>(`select string_agg(a.grantee::regrole::text, ',' order by a.grantee::regrole::text)
      from pg_proc p, aclexplode(p.proacl) a where p.oid = to_regprocedure($1) and a.grantee <> p.proowner`, [LVP]))
      .toBe("anon,authenticated");
    // Supabase's default grant to service_role is revoked: it is not needed.
    expect(await one<boolean>(`select has_function_privilege('service_role', $1, 'execute')`, [LVP])).toBe(false);
  });

  it("the table itself stays closed — the function is the only way in", async () => {
    await db.exec("set role anon");
    try {
      expect(await failure(() => db.query(`select * from public.legal_document_versions`))).toBe("42501");
    } finally { await db.exec("reset role"); }
    expect(await inForce()).toHaveLength(1);
  });

  it("a missing or empty version is an error (LV003), never a gap", async () => {
    await db.exec(`update public.legal_document_versions set version = '' where slug = 'widerruf'`);
    expect(await failure(() => inForce())).toBe("LV003");
    await db.exec(`update public.legal_document_versions set version = '2026-09-17' where slug = 'widerruf'`);
    await db.exec(`delete from public.legal_document_versions where slug = 'impressum'`);
    expect(await failure(() => inForce())).toBe("LV003");
  });

  it("refuses to replace a legal_versions_public() with another body", async () => {
    await db.exec(`create or replace function public.legal_versions_public()
      returns table (agb text, widerruf text, datenschutz text, impressum text)
      language sql stable security definer set search_path = '' as $$ select 'x', 'x', 'x', 'x' $$`);
    expect(await message(() => db.exec(M0191))).toMatch(/legal_versions_public\(\) exists with another body/);
  });

  it("what the page reads is what the order is compared against", async () => {
    const [shown] = await inForce();
    await coupled(shown.agb, shown.widerruf);
    expect(await snapshots()).toBe(`1:${shown.agb}/${shown.widerruf}`);
  });
});

describe("old and new tabs, and a switch while a checkout is open", () => {
  beforeEach(async () => { await db.exec(M0191); });

  it("an old tab (six parameters) before 0192 stores exactly what /agb then shows", async () => {
    // Before 0192 the new deployment renders what the database names — 2026-09-17,
    // the same text the old deployment showed — so the old tab, its
    // unversioned /agb link and its snapshot agree.
    const [shown] = await inForce();
    await legacy();
    expect(await snapshots()).toBe(`1:${shown.agb}/${shown.widerruf}`);
    expect(shown.agb).toBe("2026-09-17");
  });

  it("a checkout rendered before the switch is refused after it, and the reloaded one orders", async () => {
    const [rendered] = await inForce(); // the page is rendered: 2026-09-17
    await db.exec(M0192);               // the switch lands while the tab is open
    expect(await failure(() => coupled(rendered.agb, rendered.widerruf))).toBe("LV002");
    expect(await counts()).toBe("0/0/0/0/0/0");
    const [reloaded] = await inForce(); // the customer reloads
    expect(reloaded.agb).toBe("2026-11-11");
    await coupled(reloaded.agb, reloaded.widerruf);
    expect(await snapshots()).toBe("1:2026-11-11/2026-11-11");
    // No loop: the reloaded page sends what is in force, and that is accepted.
  });

  it("an old tab after 0192 cannot order at all — no snapshot under a version it did not show", async () => {
    await db.exec(M0192);
    expect(await failure(() => legacy())).toBe("42883");
    expect(await counts()).toBe("0/0/0/0/0/0");
  });

  it("a direct RPC call needs the versions in force — it cannot place an order under an old one", async () => {
    await db.exec(M0192);
    await db.exec("set role anon");
    try {
      expect(await failure(() => coupled("2026-09-17", "2026-09-17"))).toBe("LV002");
    } finally { await db.exec("reset role"); }
    expect(await counts()).toBe("0/0/0/0/0/0");
  });
});

describe("0192 — the switch: 2026-11-11, and only the coupled create_order", () => {
  beforeEach(async () => {
    await db.exec(M0191);
    await coupled("2026-09-17", "2026-09-17");
    await legacy();
  });

  it("refuses to run without 0191", async () => {
    await db.exec(`drop function public.create_order(text, text, jsonb, jsonb, text, text, text, text)`);
    expect(await message(() => db.exec(M0192))).toMatch(/0191 is missing/);
  });

  it("afterwards: no call without versions, the old version is stale, the new one orders", async () => {
    const before = await snapshots();
    await db.exec(M0192);
    expect(await one<string>(`select count(*)::text from pg_proc where proname = 'create_order'`)).toBe("1");
    expect(await failure(() => legacy())).toBe("42883");
    expect(await failure(() => coupled("2026-09-17", "2026-09-17"))).toBe("LV002");
    expect(await counts()).toBe("2/2/2/2/2/2");
    await coupled("2026-11-11", "2026-11-11");
    expect(await snapshots()).toBe(`${before}|3:2026-11-11/2026-11-11`);
  });

  it("leaves every historic order snapshot exactly as it was", async () => {
    const before = await snapshots();
    await db.exec(M0192);
    expect((await snapshots()).startsWith(before)).toBe(true);
    expect(before).toBe("1:2026-09-17/2026-09-17|2:2026-09-17/2026-09-17");
  });

  it("the coupled function keeps its rights and body through the switch", async () => {
    const acl = await one<string>(`select proacl::text from pg_proc where oid = to_regprocedure($1)`, [EIGHT]);
    await db.exec(M0192);
    expect(await one<string>(`select proacl::text from pg_proc where oid = to_regprocedure($1)`, [EIGHT])).toBe(acl);
    expect(await one<string>(`select md5(prosrc) from pg_proc where oid = to_regprocedure($1)`, [EIGHT]))
      .toBe("75fbeaea7b193035717eeb37c0995127");
  });

  it("legal_versions_public() names 2026-11-11 the moment 0192 commits — that is the switch", async () => {
    expect((await inForce())[0].agb).toBe("2026-09-17");
    await db.exec(M0192);
    expect(await inForce()).toEqual([{ agb: "2026-11-11", widerruf: "2026-11-11", datenschutz: "2026-11-11", impressum: "2026-11-11" }]);
  });

  it("refuses to run without legal_versions_public() from 0191", async () => {
    await db.exec(`drop function public.legal_versions_public()`);
    expect(await message(() => db.exec(M0192))).toMatch(/legal_versions_public\(\) of 0191 is missing/);
  });

  it("is idempotent", async () => {
    await db.exec(M0192);
    await db.exec(M0192);
    expect(await one<string>(`select count(*)::text from pg_proc where proname = 'create_order'`)).toBe("1");
  });
});

describe("rollback", () => {
  it("R0192 restores the 0139 body with the same rights, R0191 then removes the coupled one", async () => {
    const acl = await one<string>(`select proacl::text from pg_proc where oid = to_regprocedure($1)`, [SIX]);
    await db.exec(M0191);
    await db.exec(M0192);
    expect(await message(() => db.exec(R0191))).toMatch(/run R0192 first/);
    await db.exec("rollback"); // the refused file opened its own transaction
    await db.exec(R0192);
    expect(await one<string>(`select md5(prosrc) from pg_proc where oid = to_regprocedure($1)`, [SIX]))
      .toBe("c233337c0ca0555756f21e1abe173593");
    expect(await one<string>(`select proacl::text from pg_proc where oid = to_regprocedure($1)`, [SIX])).toBe(acl);
    expect(await one<string>(`select string_agg(version, ',') from (select distinct version from public.legal_document_versions) v`)).toBe("2026-09-17");
    // Between R0192 and R0191 the pages read 2026-09-17 again — the old text.
    expect((await inForce())[0].agb).toBe("2026-09-17");
    await db.exec(R0191);
    expect(await one<string>(`select count(*)::text from pg_proc where proname = 'create_order'`)).toBe("1");
    expect(await one<boolean>(`select to_regprocedure($1) is null`, [LVP])).toBe(true);
    expect((await legacy()).rows).toHaveLength(1);
  });
});

describe("the Staging run package for 0191", () => {
  const FILE = "supabase/migrations/0191_create_order_terms_versions.sql";
  const RUN = readFileSync("supabase/operations/staging-0191.sql", "utf8");
  const PRE = readFileSync("supabase/checks/0191_preflight.sql", "utf8");
  const POST = readFileSync("supabase/checks/0191_postflight.sql", "utf8");
  const PLAN = JSON.parse(readFileSync("supabase/checks/migration-plans.json", "utf8")).migrationen["0191"];

  it("embeds the migration character for character, in one transaction, Staging only", () => {
    const start = `-- >>> EINGEBETTET: ${FILE}\n`;
    const end = `-- <<< ENDE: ${FILE}\n`;
    expect(RUN.slice(RUN.indexOf(start) + start.length, RUN.indexOf(end))).toBe(M0191);
    const lines = RUN.split("\n");
    expect(lines.filter((l) => l.trim() === "begin;")).toHaveLength(1);
    expect(lines.filter((l) => l.trim() === "commit;")).toHaveLength(1);
    expect(RUN).toContain("'skyisles-staging qqxcpesbwfxzgytkdsac'");
    for (const f of [RUN, PRE, POST, M0191, R0191]) expect(f).not.toContain("zmiwxswrpkmizvqsgype");
  });

  it("measures everything but the new overload before and after, and pins both bodies", () => {
    expect(RUN.match(/p\.oid <> coalesce\(to_regprocedure\('public\.create_order\(text, text, jsonb, jsonb, text, text, text, text\)'\), 0\) and p\.oid <> coalesce\(to_regprocedure\('public\.legal_versions_public\(\)'\), 0\)\) as funktionen,/g)).toHaveLength(2);
    expect(RUN).toContain("ABBRUCH Z4: legal_versions_public()");
    expect(RUN.indexOf("ABBRUCH Z1")).toBeGreaterThan(RUN.indexOf(`-- <<< ENDE: ${FILE}`));
    for (const f of [RUN, POST]) {
      expect(f).toContain("75fbeaea7b193035717eeb37c0995127");
      expect(f).toContain("c233337c0ca0555756f21e1abe173593");
      expect(f).toContain("5e9daa01284d9b06b1b7d8fb053cff36");
    }
  });

  it("the plan knows when it is applied", () => {
    expect(PLAN).toMatchObject({ preflight: "0191_preflight.sql", lauf: "staging-0191.sql", postflight: "0191_postflight.sql" });
    expect(PLAN.angewendet.sql).toMatch(/as erfuellt$/);
  });

  it("the run succeeds on the small world, and the plan then says applied", async () => {
    await db.exec(`create table public.sellers (id bigint primary key); create table public.invoices (id bigint primary key);
      create table public.collection_items (id bigint primary key, user_id uuid, sky_id text);`);
    const stamped = RUN.replace(
      /coalesce\(\(select shobj_description[\s\S]*?\), ''\)\n\s+<> 'skyisles-staging qqxcpesbwfxzgytkdsac'/,
      "'skyisles-staging qqxcpesbwfxzgytkdsac' <> 'skyisles-staging qqxcpesbwfxzgytkdsac'");
    expect(await one<boolean>(PLAN.angewendet.sql)).toBe(false);
    await db.exec(stamped);
    expect(await one<boolean>(PLAN.angewendet.sql)).toBe(true);
  });
});
