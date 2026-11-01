import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

import { TYPE_GROUPS } from "./catalog-type";

/* ==========================================================================
 * `0166` AN ECHTEM POSTGRESQL — mit den ECHTEN Schreibwegen, nicht mit Stümpfen
 *
 * `admin_create_variant_figure` schreibt selbst nichts; sie ruft vier
 * vorhandene Funktionen. Ein Test mit Stümpfen für diese vier bewiese nur,
 * dass sie aufgerufen werden. Deshalb kommen ihre Rümpfe hier WÖRTLICH aus
 * den angewendeten Migrationen (`0033`, `0152`, `0158`, `0159`, `0163`), und
 * nur `is_platform_admin()` ist ein Schalter.
 *
 * WAS BEWIESEN WIRD: Silver Boomer → Boomer → Chase entsteht vollständig
 * und in einem Zug; jede Ablehnung nimmt ALLES mit (keine Zeile, kein
 * Journal, kein Editorial); die Serienregel, die Kettenregel und die
 * Entwurfsregel greifen; Bestandsfiguren bleiben unberührt; die SKY-ID kommt
 * aus der Sequenz und wird nicht wiederverwendet.
 * ========================================================================== */

const MIG = (n: string) => readFileSync(`supabase/migrations/${n}`, "utf8");

/** Der LETZTE Rumpf einer Funktion in einer Migrationsdatei, wörtlich. */
function rumpf(datei: string, name: string): string {
  const sql = MIG(datei);
  const start = sql.lastIndexOf(`create or replace function public.${name}(`);
  if (start < 0) throw new Error(`${name} fehlt in ${datei}`);
  const ende = sql.indexOf("\n$$;", start);
  return sql.slice(start, ende + 4);
}

const AUFBAU = `
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
end $$;
create schema if not exists auth;
create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create table public.admin_switch (on_ boolean not null);
insert into public.admin_switch values (true);
create function public.is_platform_admin() returns boolean language sql stable as $$
  select on_ from public.admin_switch $$;

create table public.series (code text primary key, label text not null);
insert into public.series values ('SA', 'Spyro''s Adventure'), ('G', 'Giants');
create table public.categories (
  id bigint primary key, series_code text not null references public.series (code), name text not null,
  constraint categories_id_series_uniq unique (id, series_code));
insert into public.categories values (10, 'SA', 'Figuren'), (11, 'SA', 'Spiele'), (20, 'G', 'Figuren');

create table public.characters (
  id bigint generated always as identity primary key, canonical_name text not null);
create unique index characters_canonical_name_key on public.characters (lower(canonical_name));
insert into public.characters (canonical_name) values ('Tree Rex');

create sequence public.sky_id_seq as bigint start with 928 minvalue 928 maxvalue 4999 no cycle;

create table public.skylanders (
  sky_id text primary key, name text not null, slug text not null unique,
  series_code text not null, category_id bigint not null,
  card_type text not null default 'standard', display_name_override text,
  catalog_visible boolean not null default false,
  catalog_status text not null default 'draft',
  character_id bigint references public.characters (id),
  source text not null default 'import', is_active boolean not null default true,
  market_price numeric,
  base_sky_id text,
  types text[] not null default '{}', visible_type text,
  visible_type_decided boolean not null default false,
  constraint skylanders_category_series_fk
    foreign key (category_id, series_code) references public.categories (id, series_code),
  constraint skylanders_id_series_uniq unique (sky_id, series_code),
  constraint skylanders_base_not_self check (base_sky_id is distinct from sky_id),
  constraint skylanders_base_same_series foreign key (base_sky_id, series_code)
    references public.skylanders (sky_id, series_code) on update restrict on delete restrict,
  constraint skylanders_visible_type_in_types
    check (visible_type is null or visible_type = any (types)));

create table public.catalog_editorial (
  sky_id text primary key references public.skylanders (sky_id) on delete cascade,
  admin_note text);
create table public.catalog_admin_changes (
  id bigint generated always as identity primary key,
  entity text not null, entity_id text not null, field text not null,
  old_value text, new_value text, changed_by uuid);
create table public.collection_items (
  user_id uuid not null, sky_id text not null references public.skylanders (sky_id),
  quantity int not null default 1);

insert into public.skylanders (sky_id, name, slug, series_code, category_id, card_type,
  catalog_visible, catalog_status, character_id, types, visible_type, visible_type_decided) values
  ('SKY-0010', 'Boomer', 'boomer', 'SA', 10, 'standard', true, 'public', null, '{}', null, false),
  ('SKY-0011', 'Elite Boomer', 'elite-boomer', 'SA', 10, 'elite', true, 'public', null, '{elite}', 'elite', true),
  ('SKY-0836', 'Silver Boomer', 'silver-boomer', 'SA', 10, 'standard', false, 'draft', null, '{}', null, false),
  ('SKY-0200', 'Tree Rex', 'tree-rex', 'G', 20, 'standard', true, 'public', 1, '{giant}', 'giant', true),
  ('SKY-0201', 'Gnarly Tree Rex', 'gnarly-tree-rex', 'G', 20, 'special', true, 'public', 1, '{giant,special}', 'special', true),
  ('SKY-0300', 'Entwurfsbasis', 'entwurfsbasis', 'SA', 10, 'standard', false, 'draft', null, '{}', null, false);
update public.skylanders set base_sky_id = 'SKY-0200' where sky_id = 'SKY-0201';
insert into public.collection_items values ('11111111-1111-1111-1111-111111111111', 'SKY-0010', 1);

/* slugify wie in 0033, ohne unaccent — die Testnamen tragen keine Akzente. */
create function public.slugify(p text) returns text language sql immutable as $$
  select trim(both '-' from regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]+', '-', 'g')) $$;
`;

let db: PGlite;
const DB_FRIST = 60_000;

async function zaehle(sql: string): Promise<number> {
  const r = await db.query<{ n: number }>(`select (${sql})::int as n`);
  return r.rows[0].n;
}

async function bestand() {
  const r = await db.query<{ z: string }>(
    `select string_agg(sky_id || '|' || name || '|' || coalesce(base_sky_id, '~') || '|'
       || array_to_string(types, '+') || '|' || coalesce(visible_type, '~'), E'\\n' order by sky_id) as z
       from public.skylanders`);
  return r.rows[0].z;
}

async function anlegen(args: {
  base: string; name: string; typ: string | null;
  kategorie?: number | null; karte?: string;
}): Promise<string> {
  const r = await db.query<{ s: string }>(
    `select public.admin_create_variant_figure($1, $2, $3, $4, $5, false, null, null) as s`,
    [args.base, args.name, args.typ, args.kategorie ?? null, args.karte ?? "standard"]);
  return r.rows[0].s;
}

/** Schema, Bestandsfunktionen und Trigger — alles ausser 0166 selbst. */
async function aufbauen(ziel: PGlite): Promise<void> {
  await ziel.exec(AUFBAU);
  for (const [datei, name] of [
    ["0033_admin_created_figures.sql", "next_figure_slug"],
    ["0152_catalog_status.sql", "admin_create_figure"],
    ["0158_figure_families.sql", "admin_create_character"],
    ["0158_figure_families.sql", "admin_set_character"],
    ["0159_variant_base_figure.sql", "skylanders_variant_base_guard"],
    ["0159_variant_base_figure.sql", "admin_set_variant_base"],
    ["0163_catalog_types.sql", "skylanders_canonical_types"],
    ["0163_catalog_types.sql", "admin_set_figure_types"],
    ["0163_catalog_types.sql", "admin_set_visible_type"],
  ] as const) {
    await ziel.exec(rumpf(datei, name));
  }
  await ziel.exec(`
    create trigger skylanders_variant_base_guard_trg
      before insert or update of base_sky_id on public.skylanders
      for each row execute function public.skylanders_variant_base_guard();
    create trigger skylanders_canonical_types
      before insert or update of types on public.skylanders
      for each row execute function public.skylanders_canonical_types();`);
}

beforeAll(async () => {
  db = new PGlite();
  await aufbauen(db);
  await db.exec(MIG("0166_admin_create_variant_figure.sql"));
}, DB_FRIST);

afterAll(async () => { await db?.close(); });

describe("0166 — Silver Boomer als Chase-Variante von Boomer", () => {
  it("legt die Figur vollständig in EINEM Aufruf an", async () => {
    const vorher = await zaehle("select count(*) from public.skylanders");
    const sky = await anlegen({ base: "SKY-0010", name: "Silver Boomer", typ: "chase", karte: "chase" });

    expect(sky).toBe("SKY-0928");
    const r = await db.query<Record<string, unknown>>(
      `select name, slug, series_code, category_id, card_type, catalog_status, base_sky_id,
              types, visible_type, visible_type_decided, character_id, source
         from public.skylanders where sky_id = $1`, [sky]);
    expect(r.rows[0]).toMatchObject({
      name: "Silver Boomer",
      /* `silver-boomer` hält schon SKY-0836 — der Slug weicht aus, die
         bestehende Zeile bleibt, wie sie ist. */
      slug: "silver-boomer-spyro-s-adventure",
      series_code: "SA", category_id: 10, card_type: "chase", catalog_status: "draft",
      base_sky_id: "SKY-0010", types: ["chase"], visible_type: "chase",
      visible_type_decided: true, character_id: null, source: "admin",
    });
    expect(await zaehle("select count(*) from public.skylanders")).toBe(vorher + 1);
  }, DB_FRIST);

  it("journalisiert jeden der vier Schritte", async () => {
    const r = await db.query<{ field: string }>(
      `select field from public.catalog_admin_changes where entity_id = 'SKY-0928' order by id`);
    expect(r.rows.map((z) => z.field)).toEqual(["created", "base_sky_id", "types", "visible_type"]);
  }, DB_FRIST);

  it("erfindet keine Charakterzuordnung, wo die Basisfigur keine hat", async () => {
    expect(await zaehle("select count(*) from public.characters")).toBe(1);
    expect(await zaehle(
      "select count(*) from public.skylanders where sky_id = 'SKY-0010' and character_id is null")).toBe(1);
  }, DB_FRIST);

  it("übernimmt die Figurenart der Basisfigur, nicht deren Variantentypes", async () => {
    const sky = await anlegen({ base: "SKY-0200", name: "Dark Tree Rex", typ: "dark" });
    const r = await db.query<{ types: string[]; character_id: number }>(
      "select types, character_id from public.skylanders where sky_id = $1", [sky]);
    expect(r.rows[0].types).toEqual(["dark", "giant"]);
    /* Der Charakter kommt über die Vorlage — aus der Basisfigur, nie geraten. */
    expect(Number(r.rows[0].character_id)).toBe(1);
  }, DB_FRIST);
});

describe("0166 — jede Ablehnung nimmt alles mit", () => {
  const faelle: [string, Parameters<typeof anlegen>[0], RegExp][] = [
    ["unbekannter Variantentype", { base: "SKY-0010", name: "X", typ: "giant" }, /kein Variantentype/],
    ["kein Variantentype", { base: "SKY-0010", name: "X", typ: null }, /kein Variantentype/],
    ["unbekannte Basisfigur", { base: "SKY-0999", name: "X", typ: "chase" }, /gibt es nicht/],
    ["Basisfigur ist selbst Variante", { base: "SKY-0201", name: "X", typ: "chase" }, /selbst eine Variante/],
    ["Basisfigur ist ein Entwurf", { base: "SKY-0300", name: "X", typ: "chase" }, /Entwurf/],
    ["Kategorie einer anderen Serie", { base: "SKY-0010", name: "X", typ: "chase", kategorie: 20 }, /skylanders_category_series_fk|foreign key/],
    ["leerer Name", { base: "SKY-0010", name: "   ", typ: "chase" }, /needs a name/],
  ];

  for (const [titel, args, fehler] of faelle) {
    it(titel, async () => {
      const vorher = await bestand();
      const journal = await zaehle("select count(*) from public.catalog_admin_changes");
      const editorial = await zaehle("select count(*) from public.catalog_editorial");
      await expect(anlegen(args)).rejects.toThrow(fehler);
      expect(await bestand()).toBe(vorher);
      expect(await zaehle("select count(*) from public.catalog_admin_changes")).toBe(journal);
      expect(await zaehle("select count(*) from public.catalog_editorial")).toBe(editorial);
    }, DB_FRIST);
  }

  it("ohne Plattformadmin geschieht nichts", async () => {
    const vorher = await bestand();
    await db.exec("update public.admin_switch set on_ = false");
    try {
      await expect(anlegen({ base: "SKY-0010", name: "Y", typ: "chase" })).rejects.toThrow(/not authorised/);
    } finally {
      await db.exec("update public.admin_switch set on_ = true");
    }
    expect(await bestand()).toBe(vorher);
  }, DB_FRIST);

  it("eine verbrauchte SKY-ID kommt nie wieder — die nächste Anlage zieht weiter", async () => {
    /* Der Kategoriefehler oben ist NACH der Nummernvergabe gescheitert. */
    const sky = await anlegen({ base: "SKY-0010", name: "Gold Boomer", typ: "chase" });
    expect(sky > "SKY-0930").toBe(true);
    expect(await zaehle(`select count(*) from public.skylanders where sky_id = '${sky}'`)).toBe(1);
  }, DB_FRIST);
});

describe("0166 — Bestand und Riegel", () => {
  it("Basisfigur, Sammlung und die bestehende Silver-Boomer-Zeile bleiben unberührt", async () => {
    const r = await db.query<Record<string, unknown>>(
      `select sky_id, name, slug, base_sky_id, types, visible_type from public.skylanders
        where sky_id in ('SKY-0010', 'SKY-0836') order by sky_id`);
    expect(r.rows).toEqual([
      { sky_id: "SKY-0010", name: "Boomer", slug: "boomer", base_sky_id: null, types: [], visible_type: null },
      { sky_id: "SKY-0836", name: "Silver Boomer", slug: "silver-boomer", base_sky_id: null, types: [], visible_type: null },
    ]);
    expect(await zaehle("select count(*) from public.collection_items where sky_id = 'SKY-0010'")).toBe(1);
  }, DB_FRIST);

  it("eine Basisfigur mit Varianten kann nicht selbst Variante werden", async () => {
    await expect(db.query(
      "select public.admin_set_variant_base('SKY-0010', 'SKY-0011', false)")).rejects.toThrow(/zeigen schon Varianten/);
  }, DB_FRIST);

  it("dieselben sieben Variantentypes wie catalog-type.ts", () => {
    const sql = MIG("0166_admin_create_variant_figure.sql");
    const liste = /v_varianten constant text\[\] := array\[([^\]]+)\]/.exec(sql)?.[1] ?? "";
    const werte = [...liste.matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
    expect(werte).toEqual([...TYPE_GROUPS.variants]);
  });

  it("anon darf die Funktion nicht ausführen, authenticated schon", async () => {
    const r = await db.query<{ a: boolean; u: boolean }>(
      `select has_function_privilege('anon', 'public.admin_create_variant_figure(text,text,text,bigint,text,boolean,text,text)', 'execute') as a,
              has_function_privilege('authenticated', 'public.admin_create_variant_figure(text,text,text,bigint,text,boolean,text,text)', 'execute') as u`);
    expect(r.rows[0]).toEqual({ a: false, u: true });
  }, DB_FRIST);
});

describe("0166 — Lauf-Hülle und Rücknahme, wie der Bediener sie fährt", () => {
  const HUELLE = readFileSync("supabase/operations/staging-0166.sql", "utf8");
  const RUECKNAHME = readFileSync("supabase/rollback/R0166_drop_admin_create_variant_figure.sql", "utf8");
  const SIG = "public.admin_create_variant_figure(text,text,text,bigint,text,boolean,text,text)";
  let frisch: PGlite;
  const steht = async () =>
    (await frisch.query<{ s: boolean }>(`select to_regprocedure('${SIG}') is not null as s`)).rows[0].s;
  const abdruck = async () =>
    (await frisch.query<{ z: string }>(
      "select md5(string_agg(s::text, '|' order by sky_id)) as z from public.skylanders s")).rows[0].z;

  beforeAll(async () => {
    frisch = new PGlite();
    await aufbauen(frisch);
  }, DB_FRIST);
  afterAll(async () => { await frisch?.close(); });

  it("die Hülle enthält die Migration zeichengleich", () => {
    expect(HUELLE).toContain(MIG("0166_admin_create_variant_figure.sql").trimEnd());
  });

  it("ohne Staging-Stempel bricht sie ab (A1) — und hinterlässt nichts", async () => {
    await expect(frisch.exec(HUELLE)).rejects.toThrow(/ABBRUCH A1/);
    await frisch.exec("rollback").catch(() => {});
    expect(await steht()).toBe(false);
  }, DB_FRIST);

  it("mit Stempel läuft sie durch, legt genau die Funktion an und ändert keine Zeile", async () => {
    const vorher = await abdruck();
    const db = (await frisch.query<{ d: string }>("select current_database() as d")).rows[0].d;
    await frisch.exec(`comment on database "${db}" is 'skyisles-staging qqxcpesbwfxzgytkdsac'`);
    await frisch.exec(HUELLE);
    expect(await steht()).toBe(true);
    expect(await abdruck()).toBe(vorher);
    const r = await frisch.query<{ n: number }>(
      "select count(*)::int as n from public.catalog_admin_changes");
    expect(r.rows[0].n).toBe(0);
  }, DB_FRIST);

  it("ein zweiter Lauf prallt an der eigenen Vorbedingung ab", async () => {
    await expect(frisch.exec(HUELLE)).rejects.toThrow(/steht schon/);
    await frisch.exec("rollback").catch(() => {});
    expect(await steht()).toBe(true);
  }, DB_FRIST);

  it("die Rücknahme entfernt genau die Funktion, lässt jede Zeile stehen, und ist wiederholbar", async () => {
    await frisch.query(`select public.admin_create_variant_figure('SKY-0010', 'Silver Boomer', 'chase')`);
    const vorher = await abdruck();
    await frisch.exec(RUECKNAHME);
    expect(await steht()).toBe(false);
    expect(await abdruck()).toBe(vorher);
    await frisch.exec(RUECKNAHME);
    expect(await steht()).toBe(false);
    /* Die vier Schreibwege, auf denen 0166 aufsetzt, bleiben. */
    const r = await frisch.query<{ n: number }>(
      `select count(*)::int as n from pg_proc where proname in
         ('admin_create_figure','admin_set_variant_base','admin_set_figure_types','admin_set_visible_type')`);
    expect(r.rows[0].n).toBe(4);
  }, DB_FRIST);
});

/* ==========================================================================
 * PRODUCTION — prod_0166_preflight, prod-0166, prod-s-postflight-0166
 *
 * Derselbe Aufbau mit den echten Schreibwegen, dazu das, woran die Huellen
 * Production erkennen (0133: Funktion UND Trigger, eine Sequenz ohne
 * Staging-Band, mindestens 100 Katalogzeilen) und die Tabellen, die Pre- und
 * Postflight lesen.
 * ========================================================================== */
describe("0166 auf Production — Preflight, Huelle, Nachkontrolle", () => {
  const PRE = readFileSync("supabase/checks/prod_0166_preflight.sql", "utf8");
  const HUELLE = readFileSync("supabase/operations/prod-0166.sql", "utf8");
  const NACH = readFileSync("supabase/operations/prod-s-postflight-0166.sql", "utf8");
  const NACH_PRUEFUNG = readFileSync("supabase/checks/prod_0166_postflight.sql", "utf8");
  const SIG = "public.admin_create_variant_figure(text,text,text,bigint,text,boolean,text,text)";
  let p: PGlite;
  const fehler = async (sql: string) => {
    try { await p.exec(sql); return null; }
    catch (e) { await p.exec("rollback").catch(() => {}); return (e as Error).message; }
  };
  const steht = async () =>
    (await p.query<{ s: boolean }>(`select to_regprocedure('${SIG}') is not null as s`)).rows[0].s;
  const tabelle = async (sql: string) => {
    const r = await p.exec(sql);
    const t = r.find((x) => x.rows.length > 0 && "nr" in (x.rows[0] as object));
    return new Map((t!.rows as { nr: number; befund: string | null; ok: boolean | null }[])
      .map((z) => [Number(z.nr), z]));
  };

  async function production(): Promise<void> {
    p = new PGlite();
    await aufbauen(p);
    await p.exec(`
      do $$ begin
        if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
      end $$;
      alter table public.catalog_admin_changes add constraint catalog_admin_changes_field_known
        check (field in ('created','card_type','catalog_status','character_id','base_sky_id','types','visible_type','deleted'));
      grant execute on function public.admin_create_figure(text,text,bigint,text,boolean,text,text,text) to authenticated;
      revoke all on function public.admin_set_variant_base(text,text,boolean) from public, anon;
      alter sequence public.sky_id_seq minvalue 1 maxvalue 9223372036854775807 restart with 5001;
      create table public.purchases (id bigint);
      create function public.purchases_paid_total_is_final() returns trigger language plpgsql as $$ begin return new; end $$;
      create trigger purchases_paid_total_immutable_trg before update on public.purchases
        for each row execute function public.purchases_paid_total_is_final();
      create table public.shop_inventory (id bigint primary key, sky_id text);
      create table public.order_lines (id bigint primary key, sky_id text);
      create table public.favorites (user_id uuid, sky_id text);
      create table public.shop_admins (user_id uuid);
      insert into public.skylanders (sky_id, name, slug, series_code, category_id, catalog_visible, catalog_status)
        select 'SKY-' || lpad((400 + g)::text, 4, '0'), 'Fuellfigur ' || g, 'fuell-' || g, 'SA', 10, true, 'public'
          from generate_series(1, 100) g;`);
  }
  afterAll(async () => { await p?.close(); });

  it("die Huelle bettet die Migration zeichengleich ein, die Nachkontrolle die Pruefdatei", () => {
    expect(HUELLE).toContain("-- >>> EINGEBETTET: supabase/migrations/0166_admin_create_variant_figure.sql\n"
      + MIG("0166_admin_create_variant_figure.sql").trimEnd()
      + "\n-- <<< ENDE: supabase/migrations/0166_admin_create_variant_figure.sql");
    expect(NACH).toContain(NACH_PRUEFUNG.trimEnd());
    expect(NACH.trimEnd().endsWith("rollback;")).toBe(true);
    expect(NACH).toMatch(/^begin;\nset transaction read only;$/m);
  });

  it("Preflight, Lauf und Nachkontrolle in der Reihenfolge des Bedieners — 9999 = 0, und nichts bewegt", async () => {
    await production();
    const vor = await tabelle(PRE);
    expect(vor.get(9999)!.befund).toBe("0");
    expect(vor.get(110)!.befund).toBe("true");
    const basis = vor.get(900)!.befund!;
    expect(basis).toMatch(/^skyisles-p0166-1\|/);
    const journal = await zahl_p("select count(*) from public.catalog_admin_changes");

    expect(await fehler(HUELLE)).toBeNull();
    expect(await steht()).toBe(true);
    expect(await zahl_p("select count(*) from public.catalog_admin_changes")).toBe(journal);

    const nach = await tabelle(NACH.replaceAll("BASIS-HIER-EINSETZEN", basis));
    expect(nach.get(9999)!.befund).toBe("0");
    expect(nach.get(9998)!.befund).toBe("0");
    expect(nach.get(804)!.ok).toBe(true);
    expect(nach.get(206)!.befund).toBe("bfb4a56fbe3467131d3b1b0ff48c912a");
    /* Die Baseline lebte nur in der Transaktion. */
    const r = await p.query<{ v: string | null }>("select nullif(current_setting('skyisles.p0166', true), '') as v");
    expect(r.rows[0].v).toBeNull();

    /* Ein zweiter Lauf prallt ab — keine automatische Wiederholung. */
    expect(await fehler(HUELLE)).toMatch(/ABBRUCH A5a/);
  }, DB_FRIST);

  it("Sammlungen und Favoriten im Betrieb lassen die Nachkontrolle NICHT anschlagen", async () => {
    await production();
    const basis = (await tabelle(PRE)).get(900)!.befund!;
    expect(await fehler(HUELLE)).toBeNull();
    await p.exec(`insert into public.collection_items values ('22222222-2222-2222-2222-222222222222', 'SKY-0010');
                  insert into public.favorites values ('22222222-2222-2222-2222-222222222222', 'SKY-0010');`);
    const nach = await tabelle(NACH.replaceAll("BASIS-HIER-EINSETZEN", basis));
    expect(nach.get(9999)!.befund).toBe("0");
  }, DB_FRIST);

  it("der Platzhalter laesst die Nachkontrolle abbrechen, statt still zu bestehen", async () => {
    await production();
    expect(await fehler(HUELLE)).toBeNull();
    expect(await fehler(NACH)).toMatch(/ABBRUCH B0/);
  }, DB_FRIST);

  it("fehlt ein Schreibweg, bricht die Huelle ab und legt nichts an", async () => {
    await production();
    await p.exec("drop function public.admin_set_visible_type(text,text)");
    expect(await fehler(HUELLE)).toMatch(/ABBRUCH A5/);
    expect(await steht()).toBe(false);
  }, DB_FRIST);

  it("auf Staging bricht die Huelle ab, bevor sie etwas anfasst — die Nachkontrolle ebenso", async () => {
    await production();
    const name = (await p.query<{ d: string }>("select current_database() as d")).rows[0].d;
    await p.exec(`comment on database "${name}" is 'skyisles-staging qqxcpesbwfxzgytkdsac'`);
    expect(await fehler(HUELLE)).toMatch(/ABBRUCH A1/);
    expect(await steht()).toBe(false);
    expect(await fehler(NACH.replaceAll("BASIS-HIER-EINSETZEN", "x"))).toMatch(/ABBRUCH A1/);
  }, DB_FRIST);

  async function zahl_p(sql: string): Promise<number> {
    return Number((await p.query<{ n: number }>(`select (${sql})::int as n`)).rows[0].n);
  }
});

