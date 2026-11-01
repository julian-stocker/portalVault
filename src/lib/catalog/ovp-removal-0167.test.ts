import { describe, expect, it, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

import { OVP_REMOVAL } from "./ovp-removal";

/* ==========================================================================
 * `0167` UND DIE ENTFERNUNG DER 30 OVP-DUPLIKATE, AN ECHTEM POSTGRESQL
 *
 * Gefahren werden die ECHTEN Dateien: die Migration, die Staging- und die
 * Production-Huelle, die Ruecknahme. Das Schema ist ein Stumpf mit den
 * Fremdschluesseln, an denen die Volkszaehlung haengt — die Funktion liest
 * sie aus `pg_constraint`, also muessen sie wirklich da sein.
 *
 * Jeder Fall bekommt eine frische Datenbank: ein abgebrochener Lauf darf den
 * naechsten nicht faerben.
 * ========================================================================== */

const MIG = readFileSync("supabase/migrations/0167_ovp_removal.sql", "utf8");
const STAGING = readFileSync("supabase/operations/staging-ovp-removal.sql", "utf8");
const PROD = readFileSync("supabase/operations/prod-ovp-removal.sql", "utf8");
const RUECK = readFileSync("supabase/rollback/R0167_drop_ovp_removal.sql", "utf8");
const PROD_MIG = readFileSync("supabase/operations/prod-0167.sql", "utf8");
const POST = readFileSync("supabase/checks/ovp_removal_postflight.sql", "utf8");
const PROD_NACH = readFileSync("supabase/operations/prod-s-postflight-0167.sql", "utf8");
const PROD_NACH_PRUEFUNG = readFileSync("supabase/checks/prod_0167_postflight.sql", "utf8");
const FRIST = 60_000;

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const OVP = OVP_REMOVAL.eintraege;
const REGULAER = [...new Set(OVP.map((e) => e.regulaere_figur))];

const AUFBAU = `
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;
create schema if not exists auth;
create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create sequence public.sky_id_seq as bigint start with 928 minvalue 928 maxvalue 4999 no cycle;
select nextval('public.sky_id_seq');

create table public.skylanders (
  sky_id text primary key, name text not null, series_code text not null,
  card_type text not null default 'standard', catalog_status text not null default 'hidden',
  catalog_visible boolean not null default false, source text not null default 'import',
  market_price numeric, base_sky_id text references public.skylanders (sky_id));
create table public.catalog_admin_changes (
  id bigint generated always as identity primary key, entity text not null, entity_id text not null,
  field text not null, old_value text, new_value text, changed_by uuid,
  constraint catalog_admin_changes_field_known check (field in ('created','deleted','catalog_status')));
create table public.catalog_editorial (
  sky_id text primary key references public.skylanders (sky_id) on delete cascade, admin_note text);
create table public.shop_inventory (
  id bigint generated always as identity primary key,
  sky_id text not null references public.skylanders (sky_id),
  condition text not null default 'loose', quantity int not null default 0, reserved int not null default 0);
create table public.inventory_movements (
  id bigint generated always as identity primary key,
  inventory_id bigint not null references public.shop_inventory (id) on delete restrict);
create table public.inventory_imports (id bigint primary key);
create table public.inventory_import_rows (
  id bigint generated always as identity primary key,
  import_id bigint not null references public.inventory_imports (id) on delete cascade,
  sky_id text references public.skylanders (sky_id) on delete restrict,
  movement_id bigint references public.inventory_movements (id) on delete restrict);
create table public.orders (id bigint primary key);
create table public.order_lines (
  id bigint generated always as identity primary key, order_id bigint references public.orders (id),
  sky_id text, inventory_id bigint references public.shop_inventory (id));
create table public.collection_items (user_id uuid not null, sky_id text not null references public.skylanders (sky_id));
create table public.favorites (user_id uuid not null, sky_id text not null references public.skylanders (sky_id));
create table public.cart_items (sky_id text not null references public.skylanders (sky_id) on delete cascade);
create table public.purchase_items (sky_id text references public.skylanders (sky_id));
create table public.sale_items (sky_id text references public.skylanders (sky_id));

insert into public.skylanders (sky_id, name, series_code, card_type, market_price) values
${OVP.map((e) => `  (${q(e.sky_id)}, ${q(e.name)}, ${q(e.series_code)}, ${q(e.card_type)}, 49.99)`).join(",\n")};
insert into public.skylanders (sky_id, name, series_code, card_type, catalog_status, catalog_visible) values
${REGULAER.map((id) => `  (${q(id)}, ${q(`regulaer ${id}`)}, 'SA', 'elite', 'public', true)`).join(",\n")},
  ('SKY-0010', 'Boomer', 'SA', 'standard', 'public', true);
insert into public.inventory_imports values (1), (5), (7);
-- Staging: drei Importprotokolle je Elite-Schachtel, und eine fuer eine regulaere Figur.
insert into public.inventory_import_rows (import_id, sky_id)
select i, e from unnest(array[1,5,7]) i,
  unnest(array[${OVP.filter((e) => e.card_type === "elite").map((e) => q(e.sky_id)).join(",")}]) e;
insert into public.inventory_import_rows (import_id, sky_id) values (1, 'SKY-0010');
-- Staging: die leere Fixture an SKY-0090, und echter Bestand an der regulaeren Figur.
insert into public.shop_inventory (sky_id, quantity) values ('SKY-0090', 0), ('SKY-0010', 3);
insert into public.inventory_movements (inventory_id) values (2);
insert into public.orders values (1);
insert into public.order_lines (order_id, sky_id, inventory_id) values (1, 'SKY-0010', 2);
insert into public.collection_items values ('11111111-1111-1111-1111-111111111111', 'SKY-0010');
insert into public.catalog_editorial values ('SKY-0012', 'CAT-01 Notiz');
`;

let db: PGlite | null = null;
afterEach(async () => { await db?.close(); db = null; });

async function frisch(opts: { stempel?: "staging" | "keiner"; migration?: boolean } = {}) {
  db = new PGlite();
  await db.exec(AUFBAU);
  if (opts.stempel !== "keiner") {
    const name = (await db.query<{ d: string }>("select current_database() as d")).rows[0].d;
    await db.exec(`comment on database "${name}" is 'skyisles-staging qqxcpesbwfxzgytkdsac'`);
  }
  if (opts.migration !== false) await db.exec(MIG);
  return db;
}
const zahl = async (sql: string) =>
  Number((await db!.query<{ n: number }>(`select (${sql})::int as n`)).rows[0].n);
const abdruck = async () =>
  (await db!.query<{ z: string }>(`select md5(string_agg(s::text, '|' order by s::text)) as z from (
     select 'k:' || sky_id as s from public.skylanders union all
     select 'i:' || id || sky_id from public.inventory_import_rows union all
     select 'l:' || id || sky_id from public.shop_inventory union all
     select 'j:' || id from public.catalog_admin_changes union all
     select 'g:' || sky_id from public.catalog_removed_sky_ids) x`)).rows[0].z;
async function versuch(sql: string): Promise<string | null> {
  try { await db!.exec(sql); return null; }
  catch (e) { await db!.exec("rollback").catch(() => {}); return (e as Error).message; }
}

describe("0167 — die Migration selbst", () => {
  it("legt Grabstein, Riegel und Funktion an und entfernt NICHTS", async () => {
    await frisch();
    expect(await zahl("select count(*) from public.skylanders")).toBe(30 + REGULAER.length + 1);
    expect(await zahl("select count(*) from public.catalog_removed_sky_ids")).toBe(0);
    expect(await zahl("select count(*) from public.catalog_admin_changes")).toBe(0);
  }, FRIST);

  it("nur der Eigentuemer darf die Funktion — kein anon, authenticated, service_role", async () => {
    await frisch();
    const r = await db!.query<Record<string, boolean>>(`select
      has_function_privilege('anon', 'public.system_remove_ovp_figure(text)', 'execute') as anon,
      has_function_privilege('authenticated', 'public.system_remove_ovp_figure(text)', 'execute') as auth,
      has_function_privilege('service_role', 'public.system_remove_ovp_figure(text)', 'execute') as svc`);
    expect(r.rows[0]).toEqual({ anon: false, auth: false, svc: false });
  }, FRIST);

  it("die Liste im Rumpf ist wortgleich die Liste in data/catalog/ovp-removal.json", () => {
    const rumpf = [...MIG.matchAll(/array\['(SKY-\d{4})', '([^']+)', '((?:[^']|'')+)', '([a-z]+)'\]/g)]
      .map((m) => [m[1], m[2], m[3].replace(/''/g, "'"), m[4]].join("|"));
    expect(rumpf).toEqual(OVP.map((e) => [e.sky_id, e.series_code, e.name, e.card_type].join("|")));
    expect(rumpf).toHaveLength(30);
  });
});

describe("die Funktion entfernt nur, was sie darf", () => {
  it("eine regulaere Figur steht nicht auf der Liste — abgewiesen, nichts geaendert", async () => {
    await frisch();
    const vorher = await abdruck();
    const f = await versuch("select public.system_remove_ovp_figure('SKY-0011')");
    expect(f).toMatch(/nicht auf der Liste/);
    expect(await abdruck()).toBe(vorher);
  }, FRIST);

  it("eine Zeile, die nicht EXAKT so aussieht, wird abgewiesen", async () => {
    await frisch();
    await db!.exec("update public.skylanders set name = 'Elite Boomer X' where sky_id = 'SKY-0012'");
    expect(await versuch("select public.system_remove_ovp_figure('SKY-0012')")).toMatch(/nicht die erwartete Zeile/);
  }, FRIST);

  it("eine oeffentliche Zeile wird nicht entfernt", async () => {
    await frisch();
    await db!.exec("update public.skylanders set catalog_status = 'public', catalog_visible = true where sky_id = 'SKY-0564'");
    expect(await versuch("select public.system_remove_ovp_figure('SKY-0564')")).toMatch(/oeffentlich/);
  }, FRIST);

  const geschuetzt: [string, string, RegExp][] = [
    ["eine Sammlung", "insert into public.collection_items values ('22222222-2222-2222-2222-222222222222', 'SKY-0591')", /collection_items/],
    ["ein Favorit", "insert into public.favorites values ('22222222-2222-2222-2222-222222222222', 'SKY-0591')", /favorites/],
    ["ein Warenkorb (CASCADE!)", "insert into public.cart_items values ('SKY-0591')", /cart_items/],
    ["ein Verkauf", "insert into public.sale_items values ('SKY-0591')", /sale_items/],
    ["ein Einkauf", "insert into public.purchase_items values ('SKY-0591')", /purchase_items/],
    ["eine Bestellzeile ohne Fremdschluessel", "insert into public.order_lines (order_id, sky_id) values (1, 'SKY-0591')", /order_lines/],
    ["eine Variante", "update public.skylanders set base_sky_id = 'SKY-0591' where sky_id = 'SKY-0010'", /Variantenbeziehung/],
  ];
  for (const [titel, sql, fehler] of geschuetzt) {
    it(`${titel} sperrt — nichts wird entfernt, nichts umgehaengt`, async () => {
      await frisch();
      await db!.exec(sql);
      const vorher = await abdruck();
      expect(await versuch("select public.system_remove_ovp_figure('SKY-0591')")).toMatch(fehler);
      expect(await abdruck()).toBe(vorher);
    }, FRIST);
  }

  it("Lager mit Bestand sperrt; Lager, auf das eine Bewegung zeigt, sperrt", async () => {
    await frisch();
    await db!.exec("update public.shop_inventory set quantity = 1 where sky_id = 'SKY-0090'");
    expect(await versuch("select public.system_remove_ovp_figure('SKY-0090')")).toMatch(/Bestand/);
    await db!.exec("update public.shop_inventory set quantity = 0 where sky_id = 'SKY-0090'");
    await db!.exec("insert into public.inventory_movements (inventory_id) select id from public.shop_inventory where sky_id = 'SKY-0090'");
    expect(await versuch("select public.system_remove_ovp_figure('SKY-0090')")).toMatch(/inventory_movements/);
  }, FRIST);

  it("ein Importprotokoll mit Lagerbewegung sperrt", async () => {
    await frisch();
    await db!.exec("update public.inventory_import_rows set movement_id = 1 where id = (select min(id) from public.inventory_import_rows where sky_id = 'SKY-0012')");
    expect(await versuch("select public.system_remove_ovp_figure('SKY-0012')")).toMatch(/Lagerbewegung|inventory_movements/);
  }, FRIST);

  it("entfernt Zeile, Importprotokolle, leere Fixture und Notiz — und journalisiert vorher", async () => {
    await frisch();
    const r = await db!.query<{ e: { status: string; importprotokolle: number; lagerpositionen: number } }>(
      "select public.system_remove_ovp_figure('SKY-0090') as e");
    expect(r.rows[0].e).toMatchObject({ status: "entfernt", importprotokolle: 3, lagerpositionen: 1 });
    expect(await zahl("select count(*) from public.skylanders where sky_id = 'SKY-0090'")).toBe(0);
    expect(await zahl("select count(*) from public.shop_inventory where sky_id = 'SKY-0090'")).toBe(0);
    expect(await zahl("select count(*) from public.catalog_admin_changes where entity_id = 'SKY-0090' and field = 'deleted'")).toBe(1);
    expect(await zahl("select count(*) from public.catalog_removed_sky_ids where sky_id = 'SKY-0090'")).toBe(1);
    /* Die regulaere Figur behaelt ihr Lager, ihr Protokoll, ihre Bestellung. */
    expect(await zahl("select count(*) from public.shop_inventory where sky_id = 'SKY-0010'")).toBe(1);
    expect(await zahl("select count(*) from public.inventory_import_rows where sky_id = 'SKY-0010'")).toBe(1);
    /* Ein zweiter Aufruf ist ein Nichtstun. */
    const zwei = await db!.query<{ e: { status: string } }>("select public.system_remove_ovp_figure('SKY-0090') as e");
    expect(zwei.rows[0].e.status).toBe("schon entfernt");
  }, FRIST);
});

describe("die Staging-Huelle — der ganze Lauf", () => {
  it("ohne Staging-Stempel bricht sie ab, bevor sie etwas anfasst", async () => {
    await frisch({ stempel: "keiner" });
    const vorher = await abdruck();
    expect(await versuch(STAGING)).toMatch(/ABBRUCH A1/);
    expect(await abdruck()).toBe(vorher);
  }, FRIST);

  it("ohne 0167 bricht sie ab", async () => {
    await frisch({ migration: false });
    expect(await versuch(STAGING)).toMatch(/ABBRUCH A2/);
  }, FRIST);

  it("entfernt alle 30, laesst alles andere stehen, und ein zweiter Lauf aendert nichts", async () => {
    await frisch();
    const seq = (await db!.query<{ s: string }>("select last_value || '|' || is_called as s from public.sky_id_seq")).rows[0].s;
    expect(await versuch(STAGING)).toBeNull();
    expect(await zahl(`select count(*) from public.skylanders where sky_id in (${OVP.map((e) => q(e.sky_id)).join(",")})`)).toBe(0);
    expect(await zahl("select count(*) from public.skylanders")).toBe(REGULAER.length + 1);
    expect(await zahl("select count(*) from public.catalog_removed_sky_ids")).toBe(30);
    expect(await zahl("select count(*) from public.catalog_admin_changes where field = 'deleted'")).toBe(30);
    expect(await zahl("select count(*) from public.inventory_import_rows")).toBe(1);      // die der regulaeren Figur
    expect(await zahl("select count(*) from public.order_lines")).toBe(1);
    expect(await zahl("select count(*) from public.collection_items")).toBe(1);
    expect((await db!.query<{ s: string }>("select last_value || '|' || is_called as s from public.sky_id_seq")).rows[0].s).toBe(seq);

    const nachher = await abdruck();
    expect(await versuch(STAGING)).toBeNull();
    expect(await abdruck()).toBe(nachher);
  }, FRIST);

  it("ein geschuetzter Verweis an EINER der 30 nimmt den ganzen Lauf zurueck — kein Teillauf", async () => {
    await frisch();
    await db!.exec("insert into public.collection_items values ('33333333-3333-3333-3333-333333333333', 'SKY-0591')");
    const vorher = await abdruck();
    expect(await versuch(STAGING)).toMatch(/collection_items/);
    expect(await abdruck()).toBe(vorher);
    expect(await zahl("select count(*) from public.catalog_removed_sky_ids")).toBe(0);
  }, FRIST);
});

describe("nie wieder anlegen", () => {
  it("nach der Entfernung weist die Tabelle jede Wiederanlage ab — Import, Publish, SQL", async () => {
    await frisch();
    await db!.exec("select public.system_remove_ovp_figure('SKY-0012')");
    /* So sieht der Upsert von catalog:import aus, wenn die Zeile fehlt. */
    expect(await versuch(`insert into public.skylanders (sky_id, name, series_code, card_type)
      values ('SKY-0012', 'Elite Boomer', 'SA', 'elite')
      on conflict (sky_id) do update set name = excluded.name`)).toMatch(/nie wieder angelegt/);
    /* Eine andere, nicht entfernte ID bleibt anlegbar. */
    expect(await versuch("insert into public.skylanders (sky_id, name, series_code) values ('SKY-0929', 'Silver Boomer', 'SA')")).toBeNull();
  }, FRIST);
});

describe("Staging und Production sind getrennt", () => {
  it("die Production-Huelle bricht auf Staging ab", async () => {
    await frisch();
    const vorher = await abdruck();
    expect(await versuch(PROD)).toMatch(/ABBRUCH A1/);
    expect(await abdruck()).toBe(vorher);
  }, FRIST);

  it("beide Huellen haben denselben Rumpf — nur der Umgebungsriegel unterscheidet sich", () => {
    const rumpf = (s: string) => s.slice(s.indexOf("create temporary table ovp_vorher"));
    expect(rumpf(PROD)).toBe(rumpf(STAGING));
  });
});

describe("Ruecknahme R0167", () => {
  it("vor einer Entfernung: nimmt alles zurueck, Katalog unberuehrt", async () => {
    await frisch();
    const vorher = await abdruck().catch(() => null);
    expect(await versuch(RUECK)).toBeNull();
    expect(await zahl("select (to_regprocedure('public.system_remove_ovp_figure(text)') is null)::int")).toBe(1);
    expect(vorher).not.toBeNull();
  }, FRIST);

  it("nach einer Entfernung: verweigert sie — der Grabstein bleibt", async () => {
    await frisch();
    await db!.exec("select public.system_remove_ovp_figure('SKY-0564')");
    expect(await versuch(RUECK)).toMatch(/Grabstein/);
    expect(await zahl("select count(*) from public.catalog_removed_sky_ids")).toBe(1);
  }, FRIST);
});

/* Production erkennen die Huellen am SCHEMA: 0133 (Funktion + Trigger), eine
   Sequenz ohne Staging-Band, mindestens 100 Katalogzeilen. */
async function productionStumpf() {
  db = new PGlite();
  await db.exec(AUFBAU);
  await db.exec(`
    alter table public.skylanders add column slug text;
    update public.skylanders set slug = lower(sky_id);
    alter sequence public.sky_id_seq minvalue 1 maxvalue 9223372036854775807 restart with 929;
    select nextval('public.sky_id_seq');
    create table public.purchases (id bigint);
    create function public.purchases_paid_total_is_final() returns trigger language plpgsql as $$ begin return new; end $$;
    create trigger purchases_paid_total_immutable_trg before update on public.purchases
      for each row execute function public.purchases_paid_total_is_final();
    insert into public.skylanders (sky_id, name, series_code)
      select 'SKY-' || lpad((600 + g)::text, 4, '0'), 'Fuellfigur ' || g, 'SA' from generate_series(1, 100) g;
    update public.skylanders set slug = lower(sky_id) where slug is null;
    delete from public.inventory_import_rows;
    delete from public.shop_inventory where sky_id = 'SKY-0090';`);
  return db;
}

describe("Production: prod-0167.sql", () => {
  it("bettet die Migration zeichengleich ein, zwischen den Marken", () => {
    const a = PROD_MIG.indexOf("-- >>> EINGEBETTET: supabase/migrations/0167_ovp_removal.sql\n");
    const b = PROD_MIG.indexOf("\n-- <<< ENDE: supabase/migrations/0167_ovp_removal.sql");
    expect(PROD_MIG.slice(a + "-- >>> EINGEBETTET: supabase/migrations/0167_ovp_removal.sql\n".length, b))
      .toBe(MIG.trimEnd());
  });

  it("bricht auf Staging ab, bevor sie etwas anfasst", async () => {
    await frisch();
    expect(await versuch("drop function public.system_remove_ovp_figure(text); drop trigger skylanders_refuse_removed_trg on public.skylanders; drop function public.skylanders_refuse_removed(); drop table public.catalog_removed_sky_ids;")).toBeNull();
    const vorher = await zahl("select count(*) from public.skylanders");
    expect(await versuch(PROD_MIG)).toMatch(/ABBRUCH A1/);
    expect(await zahl("select count(*) from public.skylanders")).toBe(vorher);
    expect(await zahl("select (to_regclass('public.catalog_removed_sky_ids') is null)::int")).toBe(1);
  }, FRIST);

  it("laeuft auf Production durch, legt alles an und entfernt NICHTS — ein zweiter Lauf prallt ab", async () => {
    await productionStumpf();
    const katalog = await zahl("select count(*) from public.skylanders");
    expect(await versuch(PROD_MIG)).toBeNull();
    expect(await zahl("select count(*) from public.skylanders")).toBe(katalog);
    expect(await zahl("select count(*) from public.catalog_removed_sky_ids")).toBe(0);
    expect(await zahl("select count(*) from public.catalog_admin_changes")).toBe(0);
    expect(await versuch(PROD_MIG)).toMatch(/ABBRUCH A5a/);
  }, FRIST);

  it("danach entfernt prod-ovp-removal.sql die 30 — und der Nachweis meldet 9999 = 0", async () => {
    await productionStumpf();
    expect(await versuch(PROD_MIG)).toBeNull();
    expect(await versuch(PROD)).toBeNull();
    expect(await zahl("select count(*) from public.catalog_removed_sky_ids")).toBe(30);
    const r = await db!.query<{ nr: number; befund: string }>(POST.replace(/;\s*$/, ""));
    const z = new Map(r.rows.map((x) => [Number(x.nr), x.befund]));
    expect(z.get(9999)).toBe("0");
    expect(z.get(9998)).toBe("0");
    expect(z.get(201)).toBe("929|true");
  }, FRIST);
});

describe("Production: die Nachkontrolle MIT Baseline (prod-s-postflight-0167.sql)", () => {
  type Zeile = { nr: number; befund: string | null; ok: boolean | null };
  async function tabelle(): Promise<Map<number, Zeile>> {
    const r = await db!.exec(PROD_NACH);
    const mit = r.find((x) => x.rows.length > 0 && "nr" in (x.rows[0] as object));
    return new Map((mit!.rows as Zeile[]).map((z) => [Number(z.nr), z]));
  }

  it("bettet die Pruefdatei zeichengleich ein und endet mit rollback", () => {
    const a = PROD_NACH.indexOf("-- >>> EINGEBETTET: supabase/checks/prod_0167_postflight.sql\n");
    const b = PROD_NACH.indexOf("\n-- <<< ENDE: supabase/checks/prod_0167_postflight.sql");
    expect(PROD_NACH.slice(a + "-- >>> EINGEBETTET: supabase/checks/prod_0167_postflight.sql\n".length, b))
      .toBe(PROD_NACH_PRUEFUNG.trimEnd());
    expect(PROD_NACH.trimEnd().endsWith("rollback;")).toBe(true);
    expect(PROD_NACH).toMatch(/^begin;\nset transaction read only;$/m);
  });

  it("setzt die Baseline IN der Transaktion: 801-803 bestehen, und nichts wird geschrieben", async () => {
    await productionStumpf();
    expect(await versuch(PROD_MIG)).toBeNull();
    const vorher = await abdruck();
    const t = await tabelle();
    expect(t.get(801)!.befund).toBe("ja");
    expect(t.get(802)!.ok).toBe(true);
    expect(t.get(803)!.ok).toBe(true);
    expect(t.get(202)!.befund).toBe("0");
    expect(await abdruck()).toBe(vorher);
    /* Danach ist die Baseline fort — sie lebte nur in der Transaktion. */
    const r = await db!.query<{ v: string | null }>("select nullif(current_setting('skyisles.p0167', true), '') as v");
    expect(r.rows[0].v).toBeNull();
  }, FRIST);

  it("auf Staging bricht sie ab", async () => {
    await frisch();
    expect(await versuch(PROD_NACH)).toMatch(/ABBRUCH A1/);
  }, FRIST);

  it("ohne 0167 bricht sie ab, statt eine leere Pruefung zu zeigen", async () => {
    await productionStumpf();            // der Stumpf hat 0167 nicht
    expect(await versuch(PROD_NACH)).toMatch(/ABBRUCH A5/);
  }, FRIST);
});

