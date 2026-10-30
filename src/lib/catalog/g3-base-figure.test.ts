import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";

/* ==========================================================================
 * `0159` AN ECHTEM POSTGRESQL — DER PRODUCTION-LAUF, NICHT NUR DIE DATEI
 *
 * `staging-oneshot.test.ts` prüft, was in `prod-g3-0159.sql` STEHT. Hier
 * läuft sie: in PGlite, gegen ein Schema, das den Zustand nach `0158`
 * nachbaut. Beides ist nötig — ein Riegel, der im Text steht und in der
 * Datenbank nicht greift, ist kein Riegel.
 *
 * WAS BEWIESEN WIRD: der Lauf kommt durch, ein Fehler nimmt ALLES mit, ein
 * zweiter Lauf prallt ab, ein fremder Vorzustand prallt ab, und die drei
 * Riegel von CAT-07 greifen an der Tabelle selbst — auch an jeder Funktion
 * vorbei.
 *
 * WAS NICHT BEWIESEN WIRD: ein Lauf gegen Production. Die Zeilen hier sind
 * erfunden (120 Katalogzeilen), und die Funktionen, die `0159` nur
 * VORFINDEN muss, sind Stümpfe mit der richtigen Signatur. Die
 * ausführlichen Läufe gegen den echten G2'-Zustand samt der Datei
 * `prod-g2-0152-0158.sql` stehen in ADR-0162; dieser Test ist die Fassung,
 * die bei JEDEM `npm test` mitläuft.
 * ========================================================================== */

const HUELLE = readFileSync("supabase/operations/prod-g3-0159.sql", "utf8");

/** Der Zustand nach `0158`, soweit `0159` und ihre Hülle ihn anfassen. */
const AUFBAU = `
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
end $$;
grant usage on schema public to authenticated, anon;
create schema if not exists auth;
create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;

create table public.categories (
  id bigint generated always as identity primary key,
  series_code text not null, name text not null,
  constraint categories_series_name_uniq unique (series_code, name),
  constraint categories_id_series_uniq unique (id, series_code));
insert into public.categories (series_code, name) values ('SA','Figuren'), ('SA','Spiele'), ('SF','Figuren');

create table public.characters (
  id bigint generated always as identity primary key,
  canonical_name text not null);
create unique index characters_canonical_name_key on public.characters (lower(canonical_name));
insert into public.characters (canonical_name) values ('Spyro'), ('Gill Grunt');

create table public.skylanders (
  sky_id text primary key, name text not null, slug text not null unique,
  series_code text not null, category_id bigint not null,
  card_type text not null default 'standard', display_name_override text,
  image_override_path text, is_active boolean not null default true,
  catalog_visible boolean not null default true,
  catalog_status text not null default 'public',
  item_type text not null default 'figure',
  character_id bigint references public.characters (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint skylanders_category_series_fk
    foreign key (category_id, series_code) references public.categories (id, series_code));
insert into public.skylanders (sky_id, name, slug, series_code, category_id, catalog_visible, catalog_status)
select 'SKY-' || lpad(g::text, 4, '0'), 'Figur ' || g, 'figur-' || g, 'SA', 1,
       (g % 5 <> 0), case when g % 5 <> 0 then 'public' else 'hidden' end
  from generate_series(1, 120) g;
alter table public.skylanders enable row level security;
create policy skylanders_select_anon on public.skylanders for select to anon
  using (is_active and catalog_visible);
create index skylanders_public_catalog_idx on public.skylanders (sky_id)
  where is_active and catalog_visible;

create table public.catalog_admin_changes (
  id bigint generated always as identity primary key,
  entity text not null, entity_id text not null, field text not null,
  old_value text, new_value text, changed_by uuid,
  changed_at timestamptz not null default now(),
  constraint catalog_admin_changes_field_known check (field in
    ('catalog_visible','display_name_override','admin_note','catalog_group',
     'image_override_path','card_type','created','catalog_status','merged_from',
     'discarded','character_id')));
create table public.catalog_editorial (
  sky_id text primary key references public.skylanders (sky_id) on delete cascade,
  admin_note text);
create table public.shop_inventory (
  id bigint generated always as identity primary key,
  sky_id text not null references public.skylanders (sky_id),
  is_listed boolean not null default true, sale_price numeric(10,2),
  sale_released boolean not null default false);
insert into public.shop_inventory (sky_id, sale_price) values ('SKY-0001', 9.90);
create table public.collection_items (
  user_id uuid not null, sky_id text not null references public.skylanders (sky_id),
  quantity int not null default 1, primary key (user_id, sky_id));
insert into public.collection_items values ('11111111-1111-1111-1111-111111111111','SKY-0003',2);

create function public.is_platform_admin() returns boolean language sql stable as $$ select true $$;
create function public.purchases_paid_total_is_final() returns trigger language plpgsql as $$ begin return new; end $$;
create function public.non_collectible_categories() returns text[] language sql immutable as $$ select array['Spiele']::text[] $$;
create function public.is_shop_eligible(p_sky_id text) returns boolean language sql stable as $$
  select exists (select 1 from public.skylanders s where s.sky_id = p_sky_id and s.is_active and s.catalog_visible) $$;
create function public.shop_offers() returns table (sky_id text, condition text, price numeric)
  language sql stable as $$ select i.sky_id, 'neu'::text, i.sale_price from public.shop_inventory i where i.is_listed $$;

/* DIE FUNKTIONEN, DIE 0159 NUR VORFINDEN MUSS — richtige Signatur, Stumpf
   als Rumpf. Was sie tun, prüft 0152/0158, nicht diese Datei. */
create function public.admin_set_catalog_status(p_sky_id text, p_status text) returns void
  language sql volatile security definer set search_path = '' as $$ select null::void $$;
create function public.admin_set_catalog_visible(p_sky_id text, p_visible boolean) returns void
  language sql volatile security definer set search_path = '' as $$
  update public.skylanders set catalog_visible = p_visible where sky_id = p_sky_id $$;
create function public.admin_set_character(p_sky_id text, p_character_id bigint) returns jsonb
  language sql volatile security definer set search_path = '' as $$ select '{}'::jsonb $$;
create function public.admin_create_character(p_name text) returns bigint
  language sql volatile security definer set search_path = '' as $$ select 1::bigint $$;
create function public.admin_publish_as_variant(p_sky_id text, p_character_id bigint) returns jsonb
  language sql volatile security definer set search_path = '' as $$ select '{}'::jsonb $$;
create function public.admin_merge_draft(p_draft text, p_target text, p_image text, p_fields jsonb)
  returns void language sql volatile security definer set search_path = '' as $$ select null::void $$;
create function public.admin_discard_draft(p_draft text) returns void
  language sql volatile security definer set search_path = '' as $$ select null::void $$;

/* admin_merge_references IN DER FASSUNG AUS 0154 — und der eine Satz, an dem
   die Hülle sie erkennt: sie weist einen mehrspaltigen Fremdschlüssel ab.
   Genau diesen Rumpf ersetzt 0159, weil sie einen anlegt. */
create function public.admin_merge_references(p_sky_id text)
returns table (tabelle text, spalte text, zeilen bigint)
language plpgsql stable security definer set search_path = '' as $$
declare r record;
begin
  for r in select c.conname::text as name, array_length(c.conkey, 1) as spalten
             from pg_constraint c where c.contype = 'f'
              and c.confrelid = 'public.skylanders'::regclass loop
    if r.spalten <> 1 then
      raise exception '0154: % hat einen mehrspaltigen Fremdschluessel', r.name;
    end if;
  end loop;
end $$;
`;

type DB = { exec: (s: string) => Promise<unknown>; query: (s: string) => Promise<{ rows: Record<string, unknown>[] }>; close: () => Promise<void> };

async function frisch(vorher = ""): Promise<DB> {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite() as unknown as DB;
  await db.exec(AUFBAU);
  if (vorher) await db.exec(vorher);
  return db;
}
const eins = async (db: DB, sql: string) => (await db.query(sql)).rows[0];
/** Führt die Hülle und gibt die Fehlermeldung zurück, oder null. */
async function lauf(db: DB, text: string): Promise<string | null> {
  try { await db.exec(text); return null; }
  catch (e) {
    const m = String((e as Error).message ?? e).split("\n")[0];
    try { await db.exec("rollback;"); } catch { /* egal */ }
    return m;
  }
}
const stand = async (db: DB) => await eins(db, `select
    (select count(*)::int from pg_attribute where attrelid = to_regclass('public.skylanders')
       and attname = 'base_sky_id' and not attisdropped) as spalte,
    (select count(*)::int from pg_constraint where conrelid = to_regclass('public.skylanders')
       and conname in ('skylanders_id_series_uniq','skylanders_base_not_self','skylanders_base_same_series')) as riegel,
    (select count(*)::int from pg_class where relname = 'skylanders_base_sky_id_idx' and relkind = 'i') as idx,
    (select count(*)::int from pg_trigger where tgrelid = to_regclass('public.skylanders')
       and tgname = 'skylanders_variant_base_guard_trg') as trg,
    (select count(*)::int from pg_proc where pronamespace = to_regnamespace('public')
       and proname in ('admin_set_variant_base','admin_publish_with_base')) as fn,
    (select (prosrc like '%confkey%') from pg_proc where oid = to_regprocedure('public.admin_merge_references(text)')) as mref_neu,
    (select pg_get_constraintdef(oid) like '%base_sky_id%' from pg_constraint
      where conrelid = to_regclass('public.catalog_admin_changes')
        and conname = 'catalog_admin_changes_field_known') as journal,
    (select coalesce(md5(string_agg(sky_id || '|' || series_code || '|' || catalog_visible::text
       || '|' || catalog_status || '|' || coalesce(character_id::text,'-'), chr(10) order by sky_id)), '-')
       from public.skylanders) as ident,
    (select count(*)::int from public.skylanders) as zeilen,
    (select count(*)::int from public.catalog_admin_changes) as journalzeilen`);

describe("prod-g3-0159 läuft in echtem PostgreSQL", () => {
  let db: DB;
  let vor: Record<string, unknown>;
  let nach: Record<string, unknown>;

  beforeAll(async () => {
    db = await frisch();
    vor = await stand(db);
    const fehler = await lauf(db, HUELLE);
    expect(fehler, "die Hülle ist nicht durchgelaufen").toBeNull();
    nach = await stand(db);
  }, 120_000);
  afterAll(async () => { await db?.close(); });

  it("legt die Spalte, drei Riegel, den Teilindex, den Trigger und zwei Funktionen an", () => {
    expect(nach.spalte).toBe(1);
    expect(nach.riegel).toBe(3);
    expect(nach.idx).toBe(1);
    expect(nach.trg).toBe(1);
    expect(nach.fn).toBe(2);
  });

  it("ersetzt admin_merge_references und nimmt base_sky_id ins Journal auf", () => {
    /* Ohne beides bräche jede Zusammenführung, sobald der zweispaltige
       Fremdschlüssel steht — siehe ADR-0162. */
    expect(vor.mref_neu).toBe(false);
    expect(nach.mref_neu).toBe(true);
    expect(vor.journal).toBe(false);
    expect(nach.journal).toBe(true);
  });

  it("ordnet NICHTS zu und lässt Identität und Journal unberührt", async () => {
    const r = await eins(db, `select count(*)::int as n from public.skylanders where base_sky_id is not null`);
    expect(r.n).toBe(0);
    expect(nach.ident).toBe(vor.ident);
    expect(nach.zeilen).toBe(vor.zeilen);
    expect(nach.journalzeilen).toBe(vor.journalzeilen);
  });

  it("der Serienriegel nennt beide Spalten und RESTRICT", async () => {
    const r = await eins(db, `select pg_get_constraintdef(oid) as d from pg_constraint
      where conrelid = to_regclass('public.skylanders') and conname = 'skylanders_base_same_series'`);
    expect(r.d).toMatch(/FOREIGN KEY \(base_sky_id, series_code\)/);
    expect(r.d).toMatch(/REFERENCES skylanders\(sky_id, series_code\)/);
    expect(r.d).toMatch(/ON UPDATE RESTRICT/);
    expect(r.d).toMatch(/ON DELETE RESTRICT/);
  });

  it("die Rechte der zwei neuen Funktionen: authenticated ja, anon und PUBLIC nein", async () => {
    const r = await eins(db, `select
      has_function_privilege('authenticated','public.admin_set_variant_base(text,text,boolean)','execute') as a1,
      has_function_privilege('authenticated','public.admin_publish_with_base(text,text,boolean)','execute') as a2,
      has_function_privilege('anon','public.admin_set_variant_base(text,text,boolean)','execute') as n1,
      has_function_privilege('anon','public.admin_publish_with_base(text,text,boolean)','execute') as n2,
      (select count(*)::int from pg_proc p, aclexplode(p.proacl) a
        where p.oid in (to_regprocedure('public.admin_set_variant_base(text,text,boolean)'),
                        to_regprocedure('public.admin_publish_with_base(text,text,boolean)'))
          and a.grantee = 0 and a.privilege_type = 'EXECUTE') as fuer_public`);
    expect([r.a1, r.a2]).toEqual([true, true]);
    expect([r.n1, r.n2]).toEqual([false, false]);
    expect(r.fuer_public).toBe(0);
  });

  /* ------------------------------------------------------------------------
   * DIE DREI RIEGEL AN DER TABELLE SELBST — jeder Fall in einem savepoint,
   * jeder danach zurückgerollt. Das ist der Unterschied zwischen „die
   * Funktion prüft es" und „die Datenbank lässt es nicht zu".
   * --------------------------------------------------------------------- */
  const riegelfall = async (sql: string[]) => {
    await db.exec("begin;");
    let code: string | undefined, meldung = "";
    try { for (const s of sql) await db.query(s); }
    catch (e) { code = (e as { code?: string }).code; meldung = String((e as Error).message).split("\n")[0]; }
    try { await db.exec("rollback;"); } catch { /* egal */ }
    return { code, meldung };
  };

  it("keine Figur ist ihre eigene Variante (CHECK, 23514)", async () => {
    const r = await riegelfall([`update public.skylanders set base_sky_id = 'SKY-0003' where sky_id = 'SKY-0003'`]);
    expect(r.code).toBe("23514");
    expect(r.meldung).toMatch(/skylanders_base_not_self/);
  });

  it("keine Variante über Seriengrenzen (zusammengesetzter Fremdschlüssel, 23503)", async () => {
    const r = await riegelfall([
      `insert into public.skylanders (sky_id, name, slug, series_code, category_id, catalog_visible, catalog_status)
         values ('SKY-9101','Fremde Serie','fremd-9101','SF',(select id from public.categories where series_code='SF'), false, 'hidden')`,
      `update public.skylanders set base_sky_id = 'SKY-9101' where sky_id = 'SKY-0003'`]);
    expect(r.code).toBe("23503");
    expect(r.meldung).toMatch(/skylanders_base_same_series/);
  });

  it("keine Variante einer Variante — beide Richtungen (Trigger, 23514)", async () => {
    const hin = await riegelfall([
      `update public.skylanders set base_sky_id = 'SKY-0002' where sky_id = 'SKY-0003'`,
      `update public.skylanders set base_sky_id = 'SKY-0003' where sky_id = 'SKY-0004'`]);
    expect(hin.code).toBe("23514");
    expect(hin.meldung).toMatch(/ist selbst eine Variante/);
    const her = await riegelfall([
      `update public.skylanders set base_sky_id = 'SKY-0002' where sky_id = 'SKY-0003'`,
      `update public.skylanders set base_sky_id = 'SKY-0005' where sky_id = 'SKY-0002'`]);
    expect(her.code).toBe("23514");
    expect(her.meldung).toMatch(/Variante\(n\)/);
  });

  it("auch beim INSERT, nicht nur beim UPDATE", async () => {
    const gut = await riegelfall([
      `insert into public.skylanders (sky_id, name, slug, series_code, category_id, catalog_visible, catalog_status, base_sky_id)
         values ('SKY-9102','Variante','var-9102','SA',1,false,'hidden','SKY-0002')`]);
    expect(gut.code).toBeUndefined();
    const schlecht = await riegelfall([
      `update public.skylanders set base_sky_id = 'SKY-0002' where sky_id = 'SKY-0003'`,
      `insert into public.skylanders (sky_id, name, slug, series_code, category_id, catalog_visible, catalog_status, base_sky_id)
         values ('SKY-9103','Kette','kette-9103','SA',1,false,'hidden','SKY-0003')`]);
    expect(schlecht.code).toBe("23514");
  });

  it("eine Basisfigur mit Varianten wird nicht gelöscht — RESTRICT meldet 23001", async () => {
    /* 23001 und NICHT 23503: `RESTRICT` weist sofort ab, `NO ACTION` wartet
       bis zum Ende der Anweisung. Wer die Fehlerbehandlung darauf stützt,
       muss den Code kennen (ADR-0162). */
    const r = await riegelfall([
      `update public.skylanders set base_sky_id = 'SKY-0020' where sky_id = 'SKY-0021'`,
      `delete from public.skylanders where sky_id = 'SKY-0020'`]);
    expect(r.code).toBe("23001");
    expect(r.meldung).toMatch(/skylanders_base_same_series/);
  });

  it("ein UPDATE einer anderen Spalte läuft weiter durch", async () => {
    /* Der Trigger hängt an `update of base_sky_id`. Ein bestehender
       Schreibpfad, der die Spalte nicht nennt, zahlt nichts dafür. */
    const r = await riegelfall([
      `update public.skylanders set base_sky_id = 'SKY-0002' where sky_id = 'SKY-0003'`,
      `select public.admin_set_catalog_visible('SKY-0003', false)`]);
    expect(r.code).toBeUndefined();
  });

  it("admin_merge_references zählt den zweispaltigen Schlüssel statt abzubrechen", async () => {
    await db.exec("begin;");
    await db.query(`update public.skylanders set base_sky_id = 'SKY-0002' where sky_id = 'SKY-0003'`);
    const r = await db.query(`select tabelle, spalte, zeilen from public.admin_merge_references('SKY-0002')`);
    await db.exec("rollback;");
    expect(r.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ tabelle: "public.skylanders", spalte: "base_sky_id" })]));
  });
});

describe("prod-g3-0159 nimmt bei einem Fehler ALLES mit", () => {
  it("ein erzwungener Fehler vor dem commit lässt nichts zurück", async () => {
    const db = await frisch();
    const vor = await stand(db);
    const fehler = await lauf(db, HUELLE.replace("\ncommit;\n",
      "\ndo $x$ begin raise exception 'TESTFEHLER 0159'; end $x$;\ncommit;\n"));
    const nach = await stand(db);
    await db.close();
    expect(fehler).toMatch(/TESTFEHLER 0159/);
    expect(nach.spalte).toBe(0);
    expect(nach.riegel).toBe(0);
    expect(nach.idx).toBe(0);
    expect(nach.trg).toBe(0);
    expect(nach.fn).toBe(0);
    expect(nach.mref_neu).toBe(false);
    expect(nach.journal).toBe(false);
    expect(nach.ident).toBe(vor.ident);
  }, 120_000);

  it("ein zweiter Lauf prallt an A6a ab und lässt den Zustand stehen", async () => {
    const db = await frisch();
    expect(await lauf(db, HUELLE)).toBeNull();
    const vor = await stand(db);
    const fehler = await lauf(db, HUELLE);
    const nach = await stand(db);
    await db.close();
    expect(fehler).toMatch(/ABBRUCH A6a/);
    expect(nach).toEqual(vor);
  }, 180_000);

  it("ein fremder Rumpf von admin_merge_references prallt an A6j ab", async () => {
    const db = await frisch(`create or replace function public.admin_merge_references(p_sky_id text)
      returns table (tabelle text, spalte text, zeilen bigint)
      language plpgsql stable security definer set search_path = '' as $f$ begin return; end $f$;`);
    const fehler = await lauf(db, HUELLE);
    const nach = await stand(db);
    await db.close();
    expect(fehler).toMatch(/ABBRUCH A6j/);
    expect(nach.spalte).toBe(0);
  }, 120_000);

  it("und auf Staging bricht sie ab, bevor sie etwas anfasst", async () => {
    const db = await frisch(`insert into public.skylanders
      (sky_id, name, slug, series_code, category_id, catalog_visible, catalog_status) values
      ('SKY-0821','Marker 1','marker-1','SA',1,false,'hidden'),
      ('SKY-0822','Marker 2','marker-2','SA',1,false,'hidden');`);
    const fehler = await lauf(db, HUELLE);
    const nach = await stand(db);
    await db.close();
    expect(fehler).toMatch(/ABBRUCH A1/);
    expect(nach.spalte).toBe(0);
  }, 120_000);
});

/* ==========================================================================
 * `0159` UNTER NEBENLÄUFIGKEIT — WAS GEMESSEN WERDEN KANN UND WAS NICHT
 *
 * Der Kettenriegel prüft eine Bedingung über ZWEI Zeilen, und zwar mit zwei
 * gewöhnlichen `select`. Unter `READ COMMITTED` sieht ein solches `select`
 * den letzten committeten Stand — nicht die offene Arbeit einer anderen
 * Sitzung. Zwei gleichzeitige Zuordnungen könnten also beide durchgehen und
 * zusammen eine verbotene Kette ergeben.
 *
 * DER TEST MIT ZWEI SITZUNGEN IST HIER NICHT FAHRBAR, und das ist gemessen:
 * PGlite hat je Instanz einen Backend, und zwei Instanzen auf demselben
 * Verzeichnis sind ZWEI unabhängige Datenbanken — die zweite durfte dieselbe
 * Zeile schreiben, ohne zu warten, und danach sahen beide verschiedene
 * Werte. Ein „Nebenläufigkeitstest" darauf sagte nichts über PostgreSQL.
 *
 * MESSBAR IST DIE EIGENSCHAFT, AN DER ALLES HÄNGT: wer nimmt welche
 * Zeilensperre? Eine gesperrte Zeile trägt die sperrende
 * Transaktionsnummer in `xmax`, und das ist in EINER Sitzung ablesbar. Was
 * nicht ablesbar ist, ist der MODUS der Sperre — `pgrowlocks` und
 * `pageinspect` gibt es in PGlite nicht. Dafür gilt die dokumentierte
 * Konfliktmatrix (PostgreSQL 13.3.2), und sie steht in ADR-0162.
 * ========================================================================== */

describe("0159 und die Zeilensperren der Schreibwege", () => {
  let db: DB;
  beforeAll(async () => {
    db = await frisch();
    expect(await lauf(db, HUELLE)).toBeNull();
  }, 120_000);
  afterAll(async () => { await db?.close(); });

  /** Trägt die Zeile die Sperre der laufenden Transaktion? */
  const gesperrt = async (sky: string) =>
    (await eins(db, `select (xmax <> 0 and xmax::text = pg_current_xact_id()::text) as g
                       from public.skylanders where sky_id = '${sky}'`)).g;

  it("ein direktes UPDATE sperrt die Variante — und die Basisfigur nur über den Fremdschlüssel", async () => {
    await db.exec("begin;");
    await db.query(`update public.skylanders set base_sky_id = 'SKY-0002' where sky_id = 'SKY-0003'`);
    const variante = await gesperrt("SKY-0003");
    const basis = await gesperrt("SKY-0002");
    await db.exec("rollback;");
    expect(variante, "die geschriebene Zeile ist gesperrt").toBe(true);
    /*
     * DIE BASISFIGUR IST AUCH GESPERRT — aber vom FREMDSCHLÜSSEL, nicht vom
     * Riegel: PostgreSQL nimmt beim Schreiben eines verweisenden Wertes eine
     * Sperre auf die verwiesene Zeile. Das ist `FOR KEY SHARE`, und die
     * kollidiert nach der Konfliktmatrix NUR mit `FOR UPDATE` — ein UPDATE,
     * das keine Schlüsselspalte ändert, nimmt `FOR NO KEY UPDATE`. Sie hält
     * einen gleichzeitigen Schreiber von `base_sky_id` also NICHT auf.
     */
    expect(basis, "der Fremdschlüssel sperrt die verwiesene Zeile").toBe(true);
  });

  it("der Kettenriegel selbst nimmt KEINE Sperre — er liest einen Schnappschuss", async () => {
    const rumpf = (await eins(db, `select prosrc from pg_proc
      where oid = to_regprocedure('public.skylanders_variant_base_guard()')`)).prosrc as string;
    expect(rumpf).not.toMatch(/for\s+update/i);
    expect(rumpf).not.toMatch(/advisory/i);
    /* Zwei gewöhnliche Lesezugriffe, einer je Richtung. */
    expect((rumpf.match(/select/gi) || []).length).toBe(2);
  });

  it("aber JEDER Schreibweg, den es gibt, sperrt BEIDE Zeilen mit for update", async () => {
    /*
     * DAS IST DER GRUND, WARUM DIE LÜCKE HEUTE UNERREICHBAR IST.
     * `admin_set_variant_base` sperrt die Variante und die Basisfigur, und
     * `admin_publish_with_base` ruft sie. Einen Tabellen-Schreibweg gibt es
     * für keine Clientrolle (`0033`). Übrig bleibt eine von Hand getippte
     * Anweisung als `postgres` — und zwei davon gleichzeitig.
     */
    await db.exec("begin;");
    await db.query(`select public.admin_set_variant_base('SKY-0003', 'SKY-0002')`);
    const variante = await gesperrt("SKY-0003");
    const basis = await gesperrt("SKY-0002");
    await db.exec("rollback;");
    expect([variante, basis]).toEqual([true, true]);

    const rumpf = (await eins(db, `select prosrc from pg_proc
      where oid = to_regprocedure('public.admin_set_variant_base(text,text,boolean)')`)).prosrc as string;
    expect((rumpf.match(/for update/gi) || []).length,
      "zwei for update: die Variante und die Basisfigur").toBe(2);
    const weiter = (await eins(db, `select prosrc from pg_proc
      where oid = to_regprocedure('public.admin_publish_with_base(text,text,boolean)')`)).prosrc as string;
    expect(weiter).toContain("public.admin_set_variant_base(");
  });

  it("DIE SPERRORDNUNG IST AUFRUFABHÄNGIG — und das kann einen Deadlock bauen", async () => {
    /*
     * `admin_set_variant_base` sperrt ZUERST `p_sky_id` und DANN
     * `p_base_sky_id` — also in der Reihenfolge der Argumente. Zwei
     * gleichzeitige Aufrufe mit VERTAUSCHTEN Argumenten, etwa ('A','B') und
     * ('B','A'), sperren damit gegenläufig: PostgreSQL erkennt den Deadlock
     * und bricht EINE der beiden mit `40P01` ab. Kein Datenschaden, nichts
     * committet — aber ein Abbruch, den eine feste Ordnung nicht hätte.
     *
     * `0161` (Gruppe G4') macht es vor und sagt es in ihrem Kommentar: beide
     * Zeilen in EINER Anweisung, `order by s.sky_id`, `for update`. Genau
     * das ist die Härtung für `admin_set_variant_base` — sie gehört in
     * dieselbe künftige Migration wie das `for update` im Kettenriegel
     * (ADR-0162), weil `0159` auf Staging angewendet ist.
     *
     * Dieser Fall FRIERT den heutigen Zustand ein: kippt die Erwartung
     * eines Tages, ist das die Berichtigung und kein Fehler.
     */
    const rumpf = (await eins(db, `select prosrc from pg_proc
      where oid = to_regprocedure('public.admin_set_variant_base(text,text,boolean)')`)).prosrc as string;
    const ersteSperre = rumpf.indexOf("p_sky_id for update");
    const zweiteSperre = rumpf.indexOf("p_base_sky_id for update");
    expect(ersteSperre, "die Variante wird zuerst gesperrt").toBeGreaterThan(-1);
    expect(zweiteSperre, "die Basisfigur danach").toBeGreaterThan(ersteSperre);
    /* Und es gibt KEINE feste Ordnung und keine Beratungssperre. */
    expect(rumpf).not.toMatch(/order by\s+s?\.?sky_id/);
    expect(rumpf).not.toMatch(/advisory/i);
  });

  it("und die Härtung WÜRDE greifen: mit for update in Richtung 1 ist die Basisfigur gesperrt", async () => {
    /*
     * Die vorgeschlagene Berichtigung (ADR-0162) in einer Transaktion, die
     * zurückgerollt wird — `0159` bleibt unberührt. Gemessen wird nur, dass
     * die Sperre dann WIRKLICH entsteht; dass `FOR UPDATE` mit dem UPDATE
     * der anderen Sitzung kollidiert, ist die Konfliktmatrix.
     */
    await db.exec("begin;");
    await db.exec(`create or replace function public.skylanders_variant_base_guard()
      returns trigger language plpgsql security definer set search_path = '' as $f$
      declare v_b text; v_n integer;
      begin
        if new.base_sky_id is null then return new; end if;
        select s.base_sky_id into v_b from public.skylanders s
          where s.sky_id = new.base_sky_id for update;
        if v_b is not null then
          raise exception 'PROBE' using errcode = 'check_violation';
        end if;
        select count(*) into v_n from public.skylanders s where s.base_sky_id = new.sky_id;
        if v_n > 0 then raise exception 'PROBE' using errcode = 'check_violation'; end if;
        return new;
      end $f$;`);
    await db.query(`update public.skylanders set base_sky_id = 'SKY-0004' where sky_id = 'SKY-0005'`);
    const basis = await gesperrt("SKY-0004");
    await db.exec("rollback;");
    expect(basis, "mit for update sperrt der Riegel die Basisfigur selbst").toBe(true);

    const danach = (await eins(db, `select prosrc from pg_proc
      where oid = to_regprocedure('public.skylanders_variant_base_guard()')`)).prosrc as string;
    expect(danach, "die Probe ist zurückgerollt").not.toMatch(/PROBE/);
  });
});

/* ==========================================================================
 * admin_merge_references UND DER ZWEISPALTIGE SCHLÜSSEL
 *
 * Die Funktion zählt je Fremdschlüssel auf GENAU EINER Spalte — der, die auf
 * `sky_id` zeigt. Bei einem zweispaltigen Schlüssel ist das nur dann exakt,
 * wenn die zweite Spalte nicht abweichen KANN. Beim Serienriegel kann sie es
 * nicht: `series_code` steht auf beiden Seiten, und weil `sky_id` eindeutig
 * ist, erzwingt der Schlüssel Gleichheit.
 *
 * Hier steht beides: dass es für diesen Schlüssel exakt ist, und wo die
 * Grenze liegt.
 * ========================================================================== */

describe("admin_merge_references zählt den zweispaltigen Schlüssel exakt", () => {
  let db: DB;
  beforeAll(async () => {
    db = await frisch();
    expect(await lauf(db, HUELLE)).toBeNull();
  }, 120_000);
  afterAll(async () => { await db?.close(); });

  const refs = async (sky: string) => (await db.query(
    `select tabelle, spalte, zeilen::int as zeilen from public.admin_merge_references('${sky}')
      order by 1, 2`)).rows;

  it("eine Figur ohne Varianten erscheint NICHT als Referenz", async () => {
    /*
     * DER FEHLALARM, DEN ES NICHT GIBT: 120 Zeilen tragen `base_sky_id IS
     * NULL`. Zählte die Funktion sie mit, wäre ab diesem Commit JEDE
     * Zusammenführung und jedes Verwerfen blockiert.
     */
    const r = await refs("SKY-0100");
    expect(r.some((x) => x.tabelle === "public.skylanders")).toBe(false);
    const n = (await eins(db, `select count(*)::int as n from public.skylanders
      where base_sky_id is null`)).n;
    expect(n).toBeGreaterThan(100);
  });

  it("eine Figur mit zwei Varianten wird mit GENAU 2 gezählt, auf base_sky_id", async () => {
    await db.exec("begin;");
    await db.query(`update public.skylanders set base_sky_id = 'SKY-0100' where sky_id = 'SKY-0101'`);
    await db.query(`update public.skylanders set base_sky_id = 'SKY-0100' where sky_id = 'SKY-0102'`);
    const r = await refs("SKY-0100");
    await db.exec("rollback;");
    expect(r).toEqual(expect.arrayContaining([
      expect.objectContaining({ tabelle: "public.skylanders", spalte: "base_sky_id", zeilen: 2 })]));
  });

  it("eine Zuordnung über Seriengrenzen kann gar nicht entstehen — deshalb ist EINE Spalte genug", async () => {
    /*
     * Das ist der Beweis für die Exaktheit: gäbe es eine Zeile mit
     * `base_sky_id = X` und einer anderen Serie als X, zählte die Funktion
     * sie mit, obwohl sie den Schlüssel nicht erfüllt. Eine solche Zeile
     * weist die Datenbank ab.
     */
    await db.exec("begin;");
    await db.query(`insert into public.skylanders
      (sky_id, name, slug, series_code, category_id, catalog_visible, catalog_status)
      values ('SKY-9301','Andere Serie','andere-9301','SF',
              (select id from public.categories where series_code='SF'), false, 'hidden')`);
    let code: string | undefined;
    try { await db.query(`update public.skylanders set base_sky_id = 'SKY-0100'
                           where sky_id = 'SKY-9301'`); }
    catch (e) { code = (e as { code?: string }).code; }
    await db.exec("rollback;");
    expect(code).toBe("23503");
  });

  it("DIE GRENZE: ein Schlüssel mit abweichbarer zweiter Spalte würde überzählen", async () => {
    /*
     * HEUTE GIBT ES SO EINEN SCHLÜSSEL NICHT, und dieser Fall legt einen
     * künstlichen an, um die Grenze zu zeigen: `b` darf NULL sein, der
     * Schlüssel ist dann (MATCH SIMPLE) ungeprüft — die Funktion zählt die
     * Zeile trotzdem mit, weil sie nur auf `a` schaut. Ergebnis 2 statt 1.
     *
     * SOLLTE DIESE ERWARTUNG EINES TAGES KIPPEN, ist das kein Fehler,
     * sondern die Berichtigung: dann zählt die Funktion über ALLE Spalten
     * des Schlüssels. Der Fall steht hier, damit die Grenze nicht in
     * Vergessenheit gerät (ADR-0162).
     */
    await db.exec("begin;");
    await db.query(`alter table public.skylanders
      add constraint probe_id_name_uniq unique (sky_id, name)`);
    await db.query(`create table public.probe_ref (a text, b text,
      constraint probe_ref_fk foreign key (a, b)
        references public.skylanders (sky_id, name) on delete restrict)`);
    await db.query(`insert into public.probe_ref (a, b)
      select sky_id, name from public.skylanders where sky_id = 'SKY-0100'`);
    await db.query(`insert into public.probe_ref (a, b) values ('SKY-0100', null)`);
    const r = await refs("SKY-0100");
    await db.exec("rollback;");
    expect(r).toEqual(expect.arrayContaining([
      expect.objectContaining({ tabelle: "public.probe_ref", spalte: "a", zeilen: 2 })]));
    /* Und die Probe ist fort. */
    const weg = (await eins(db, `select (to_regclass('public.probe_ref') is null) as weg`)).weg;
    expect(weg).toBe(true);
  });

  it("einspaltige Schlüssel zählt sie unverändert richtig", async () => {
    const lager = await refs("SKY-0001");
    expect(lager).toEqual(expect.arrayContaining([
      expect.objectContaining({ tabelle: "public.shop_inventory", spalte: "sky_id", zeilen: 1 })]));
    const sammlung = await refs("SKY-0003");
    expect(sammlung).toEqual(expect.arrayContaining([
      expect.objectContaining({ tabelle: "public.collection_items", spalte: "sky_id" })]));
    expect(await refs("SKY-0050")).toEqual([]);
  });
});
