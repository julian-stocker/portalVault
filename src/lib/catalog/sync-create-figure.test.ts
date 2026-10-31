import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

/* ==========================================================================
 * `0165` AN ECHTEM POSTGRESQL — und die Sequenzfrage, die daneben hängt
 *
 * WAS BEWIESEN WIRD
 *
 *   1. Die Anlage schreibt Zeile UND `created`-Journalzeile.
 *   2. SIE IST ATOMAR. Scheitert die Journalzeile, bleibt KEINE Figur
 *      zurück — das ist der ganze Grund, warum es diese Funktion gibt, und
 *      er lässt sich nur messen, indem man die Journalzeile scheitern lässt.
 *   3. Jeder der sieben Riegel weist ab, einzeln.
 *   4. Sie fasst `sky_id_seq` nicht an.
 *   5. `catalog_visible` wird aus `catalog_status` abgeleitet (0152).
 *   6. DIE `is_called`-FRAGE: nach `setval(seq, 5000)` liefert der nächste
 *      `nextval` wirklich 5001 — und die Zweiparameterform ist die richtige.
 *
 * WAS NICHT BEWIESEN WIRD: ein Lauf gegen Production. Das Schema hier ist
 * der Ausschnitt, den `0165` anfasst; die Zeilen sind erfunden.
 * ========================================================================== */

const MIGRATION = readFileSync("supabase/migrations/0165_system_sync_create_figure.sql", "utf8");
const RUECKNAHME = readFileSync(
  "supabase/rollback/R0165_drop_system_sync_create_figure.sql", "utf8");

/** Der Zustand nach `0163`, soweit `0165` ihn berührt. */
const AUFBAU = `
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;
grant usage on schema public to authenticated, anon, service_role;
create schema if not exists auth;
create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;

create table public.categories (
  id bigint generated always as identity primary key,
  series_code text not null, name text not null,
  constraint categories_series_name_uniq unique (series_code, name),
  constraint categories_id_series_uniq unique (id, series_code));
insert into public.categories (series_code, name) values ('SA','Figuren'), ('SA','Spiele');

create table public.skylanders (
  sky_id text primary key,
  name text not null, slug text not null unique,
  series_code text not null, category_id bigint not null,
  market_price numeric(10,2), price_updated_at timestamptz,
  card_type text not null default 'standard',
  item_type text not null default 'figure',
  source text not null default 'import',
  image_file text, image_override_path text, display_name_override text,
  usk_rating smallint,
  character_id bigint, base_sky_id text,
  is_active boolean not null default true,
  catalog_visible boolean not null default true,
  catalog_status text,
  types text[] not null default '{}',
  visible_type text, visible_type_decided boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint skylanders_sky_id_format check (sky_id ~ '^SKY-[0-9]{4}$'),
  constraint skylanders_source_known check (source in ('import','admin')),
  constraint skylanders_catalog_status_known check (catalog_status in ('public','hidden','draft')),
  constraint skylanders_catalog_status_matches_visibility
    check ((catalog_status = 'public') = catalog_visible),
  constraint skylanders_category_fk foreign key (category_id, series_code)
    references public.categories (id, series_code));

-- 0152: wer nur eine der beiden Spalten schreibt, bekommt die andere abgeleitet.
create function public.skylanders_sync_catalog_status() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.catalog_status is null then
      new.catalog_status := case when new.catalog_visible then 'public' else 'hidden' end;
    else
      new.catalog_visible := (new.catalog_status = 'public');
    end if;
  end if;
  return new;
end $$;
create trigger skylanders_sync_catalog_status before insert or update on public.skylanders
  for each row execute function public.skylanders_sync_catalog_status();

create table public.catalog_admin_changes (
  id bigint generated always as identity primary key,
  entity text not null, entity_id text not null, field text not null,
  old_value text, new_value text, changed_by uuid,
  changed_at timestamptz not null default now(),
  constraint catalog_admin_changes_entity_known check (entity in ('skylander','category')),
  constraint catalog_admin_changes_field_known check (field in (
    'admin_note','base_sky_id','card_type','catalog_group','catalog_status',
    'catalog_visible','character_id','created','deleted','discarded',
    'display_name_override','image_override_path','market_price','merged_from',
    'types','visible_type')));

create sequence public.sky_id_seq as bigint start with 821 increment by 1;

-- Dieselbe Funktion, die 0035 anlegt — die Nachbedingung von R0165 sieht nach ihr.
create function public.system_set_image_override(p_sky_id text, p_path text)
returns void language plpgsql as $$ begin end $$;
`;

/** Ein vollständiger Aufruf; einzelne Felder lassen sich überschreiben. */
function aufruf(x: Partial<Record<string, string | number | null>> = {}) {
  const a = {
    sky_id: "SKY-0893", name: "P74 Gold Bash", slug: "p74-gold-bash",
    series_code: "SA", category_id: 1, card_type: "chase", item_type: "figure",
    catalog_status: "public", source: "admin", image_file: null, usk_rating: null,
    ...x,
  };
  const q = (v: unknown) => v === null || v === undefined ? "null" : typeof v === "number"
    ? String(v) : `'${String(v).replace(/'/g, "''")}'`;
  return `select public.system_sync_create_figure(${q(a.sky_id)}, ${q(a.name)}, ${q(a.slug)},
    ${q(a.series_code)}, ${a.category_id}, ${q(a.card_type)}, ${q(a.item_type)},
    ${q(a.catalog_status)}, ${q(a.source)}, ${q(a.image_file)},
    ${a.usk_rating === null ? "null" : a.usk_rating}::smallint)`;
}

/*
 * EINE EIGENE FRIST FUER DIE HOOKS, DIE PGlite STARTEN.
 *
 * Vitest gibt einem Hook 10 Sekunden. Eine PGlite-Instanz ist ein
 * WASM-PostgreSQL; einzeln startet sie in unter einer Sekunde, im
 * Gesamtlauf neben den uebrigen 339 Dateien aber nicht immer. Genau daran
 * ist diese Datei am 2026-10-30 gescheitert — nicht an einer Zusicherung,
 * sondern an `Hook timed out in 10000ms`.
 *
 * Die Frist steht hier und nicht global in `vitest.config.mts`: sie betrifft
 * die zwei Dateien, die eine Datenbank starten, und eine global gelockerte
 * Frist liesse eine echte Haengepartie anderswo unbemerkt.
 */
const DB_FRIST = 60_000;

let db: PGlite;
const fehler = async (sql: string): Promise<string> => {
  try { await db.query(sql); return "KEIN FEHLER"; }
  catch (e) { return String((e as Error).message); }
};
/* Mehrfachanweisungen — eine Migration ist keine vorbereitete Anweisung. */
const fehlerMehr = async (d: PGlite, sql: string): Promise<string> => {
  try { await d.exec(sql); return "KEIN FEHLER"; }
  catch (e) { return String((e as Error).message); }
};
const zahl = async (sql: string): Promise<number> =>
  Number((await db.query<{ n: string }>(sql)).rows[0].n);

describe("0165 — system_sync_create_figure", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(AUFBAU);
    await db.exec(MIGRATION);
  }, DB_FRIST);
  // Kein close hier — `db` traegt alle drei describe-Bloecke dieser Datei.

  it("legt Zeile UND created-Journalzeile an", async () => {
    const r = await db.query<{ system_sync_create_figure: string }>(aufruf());
    expect(r.rows[0].system_sync_create_figure).toBe("SKY-0893");

    const zeile = (await db.query<Record<string, unknown>>(
      `select name, slug, card_type, source, catalog_status, catalog_visible,
              market_price, character_id, base_sky_id, types, visible_type
         from public.skylanders where sky_id = 'SKY-0893'`)).rows[0];
    expect(zeile.name).toBe("P74 Gold Bash");
    expect(zeile.catalog_status).toBe("public");
    expect(zeile.catalog_visible).toBe(true);     // vom Trigger abgeleitet (0152)
    expect(zeile.market_price).toBeNull();        // der Preis gehört Production
    expect(zeile.character_id).toBeNull();
    expect(zeile.base_sky_id).toBeNull();
    expect(zeile.visible_type).toBeNull();

    const j = (await db.query<Record<string, unknown>>(
      `select field, old_value, new_value, changed_by
         from public.catalog_admin_changes where entity_id = 'SKY-0893'`)).rows;
    expect(j).toHaveLength(1);
    expect(j[0].field).toBe("created");
    expect(j[0].old_value).toBeNull();
    expect(j[0].new_value).toBe("P74 Gold Bash");
    expect(j[0].changed_by).toBeNull();           // Service-Role, kein Mensch (0004)
  });

  it("leitet catalog_visible aus einem draft ab", async () => {
    await db.query(aufruf({ sky_id: "SKY-0894", slug: "p74-draft", catalog_status: "draft" }));
    const r = (await db.query<{ catalog_visible: boolean }>(
      `select catalog_visible from public.skylanders where sky_id = 'SKY-0894'`)).rows[0];
    expect(r.catalog_visible).toBe(false);
  });

  /* ---------------------------------------------------------------------
   * DER KERN: SIE IST ATOMAR.
   *
   * Gemessen, nicht behauptet — die Audit-Constraint wird so verengt, dass
   * die Journalzeile scheitert. Bliebe die Figur stehen, waere die ganze
   * Migration sinnlos.
   * ------------------------------------------------------------------- */
  it("laesst KEINE Figur zurueck, wenn die Journalzeile scheitert", async () => {
    /*
     * DER KERN DER MIGRATION — und er laesst sich nur messen, indem man die
     * Journalzeile scheitern laesst.
     *
     * NICHT ueber die Audit-Constraint: ein `add constraint` prueft die
     * VORHANDENEN Zeilen mit, und die tragen nach den Tests oben schon
     * `created`. Ein Trigger ist additiv, greift nur fuer diese eine SKY-ID
     * und braucht keine zweite Datenbank.
     */
    await db.exec(`create function public.p74_journal_scheitern() returns trigger
      language plpgsql as $$ begin
        raise exception 'P74: die Journalzeile scheitert absichtlich';
      end $$;
      create trigger p74_journal_scheitern before insert on public.catalog_admin_changes
        for each row when (new.entity_id = 'SKY-0895')
        execute function public.p74_journal_scheitern();`);

    const vorher = await zahl(`select count(*) as n from public.skylanders`);
    expect(await fehler(aufruf({ sky_id: "SKY-0895", slug: "p74-atomar" })))
      .toContain("die Journalzeile scheitert absichtlich");

    // DIE EIGENTLICHE AUSSAGE: die Figur ist NICHT entstanden.
    expect(await zahl(
      `select count(*) as n from public.skylanders where sky_id = 'SKY-0895'`)).toBe(0);
    expect(await zahl(`select count(*) as n from public.skylanders`)).toBe(vorher);

    await db.exec(`drop trigger p74_journal_scheitern on public.catalog_admin_changes;
                   drop function public.p74_journal_scheitern();`);
  });

  it("weist die sieben Faelle einzeln ab, mit eigener Meldung", async () => {
    expect(await fehler(aufruf({ sky_id: "SKY-893" }))).toContain("keine SKY-ID im Format");
    expect(await fehler(aufruf({ sky_id: "SKY-9101", slug: "p74-fixture" })))
      .toContain("reservierten System- und Testbereich");
    expect(await fehler(aufruf({ sky_id: "SKY-0893", slug: "p74-doppelt" })))
      .toContain("steht bereits im Katalog");
    expect(await fehler(aufruf({ sky_id: "SKY-0896", slug: "p74-s", source: "sync" })))
      .toContain("source muss import oder admin sein");
    expect(await fehler(aufruf({ sky_id: "SKY-0897", slug: "p74-st", catalog_status: "live" })))
      .toContain("catalog_status muss public, hidden oder draft sein");
    expect(await fehler(aufruf({ sky_id: "SKY-0898", slug: "p74-n", name: "   " })))
      .toContain("braucht einen Namen");
    expect(await fehler(aufruf({ sky_id: "SKY-0899", slug: "  ", name: "X" })))
      .toContain("braucht einen Slug");
  });

  it("fasst sky_id_seq nicht an", async () => {
    const vor = (await db.query<{ last_value: string | null }>(
      `select last_value from pg_sequences where sequencename = 'sky_id_seq'`)).rows[0];
    await db.query(aufruf({ sky_id: "SKY-0900", slug: "p74-seq" }));
    const nach = (await db.query<{ last_value: string | null }>(
      `select last_value from pg_sequences where sequencename = 'sky_id_seq'`)).rows[0];
    expect(nach.last_value).toBe(vor.last_value);
  });

  it("PUBLIC darf sie NICHT — und zwar ueber has_function_privilege geprueft", async () => {
    /*
     * `proacl` ist bei einer frisch angelegten Funktion NULL, und NULL heisst
     * nicht „niemand", sondern „Vorgabewert" — und der ist EXECUTE FUER
     * PUBLIC. Eine Pruefung ueber `aclexplode(proacl)` findet dann keine Zeile
     * und meldet faelschlich „PUBLIC darf nicht". Nachgemessen am 2026-10-30:
     * `aclexplode` sagte false, `has_function_privilege` sagte true, und
     * letzteres war richtig. Deshalb steht hier diese Form.
     */
    const r = (await db.query<{ public_darf: boolean }>(`
      select has_function_privilege('public', p.oid, 'execute') as public_darf
        from pg_proc p where p.proname = 'system_sync_create_figure'`)).rows[0];
    expect(r.public_darf).toBe(false);
  });

  it("ist SECURITY DEFINER mit LEEREM search_path", async () => {
    /*
     * Ein Definer ohne festen Suchpfad ist die klassische Rechteausweitung:
     * wer ein Schema vor `public` schiebt, laesst die Funktion seine Tabelle
     * schreiben. `search_path = ''` erzwingt volle Qualifizierung — und der
     * Rumpf ist durchgehend voll qualifiziert.
     */
    const r = (await db.query<{ secdef: boolean; leer: boolean; roh: string }>(`
      select p.prosecdef as secdef,
             (p.proconfig is not null and 'search_path=""' = any (p.proconfig)) as leer,
             coalesce(p.proconfig::text, '(keiner)') as roh
        from pg_proc p where p.proname = 'system_sync_create_figure'`)).rows[0];
    expect(r.secdef).toBe(true);
    expect(r.leer, `proconfig ist ${r.roh}`).toBe(true);
  });

  it("der Rumpf qualifiziert jeden Namen voll — sonst traegt der leere Suchpfad nicht",
     async () => {
    const quelle = MIGRATION.slice(MIGRATION.indexOf("as $$"), MIGRATION.indexOf("$$;"));
    for (const name of ["public.skylanders", "public.catalog_admin_changes"]) {
      expect(quelle).toContain(name);
    }
    // Keine unqualifizierte Nennung der zwei Tabellen.
    expect(quelle).not.toMatch(/(?<!public\.)\bskylanders\b/);
    expect(quelle).not.toMatch(/(?<!public\.)\bcatalog_admin_changes\b/);
  });

  it("ein wiederholter Aufruf UEBERSCHREIBT die vorhandene Zeile nicht", async () => {
    const vorher = (await db.query<Record<string, unknown>>(
      `select name, slug, card_type, catalog_status, source, updated_at
         from public.skylanders where sky_id = 'SKY-0893'`)).rows[0];
    const journalVorher = await zahl(
      `select count(*) as n from public.catalog_admin_changes where entity_id = 'SKY-0893'`);

    // Derselbe Aufruf noch einmal, und einer mit ANDEREN Werten.
    expect(await fehler(aufruf())).toContain("steht bereits im Katalog");
    expect(await fehler(aufruf({ name: "Etwas ganz anderes", card_type: "dark",
                                 catalog_status: "hidden" })))
      .toContain("steht bereits im Katalog");

    const nachher = (await db.query<Record<string, unknown>>(
      `select name, slug, card_type, catalog_status, source, updated_at
         from public.skylanders where sky_id = 'SKY-0893'`)).rows[0];
    expect(nachher).toEqual(vorher);          // kein Feld hat sich bewegt
    expect(await zahl(
      `select count(*) as n from public.catalog_admin_changes where entity_id = 'SKY-0893'`))
      .toBe(journalVorher);                    // und keine zweite Journalzeile
  });

  it("gehoert nur service_role", async () => {
    const r = (await db.query<Record<string, boolean>>(`
      select has_function_privilege('service_role', p.oid, 'execute') as dienst,
             has_function_privilege('authenticated', p.oid, 'execute') as angemeldet,
             has_function_privilege('anon', p.oid, 'execute') as anonym
        from pg_proc p where p.proname = 'system_sync_create_figure'`)).rows[0];
    expect(r.dienst).toBe(true);
    expect(r.angemeldet).toBe(false);
    expect(r.anonym).toBe(false);
  });

  it("prallt beim zweiten Lauf an der eigenen Vorbedingung ab", async () => {
    expect(await fehlerMehr(db, MIGRATION)).toContain("system_sync_create_figure steht schon");
  });
});

/* ==========================================================================
 * DIE SEQUENZFRAGE — `is_called`, und warum `setval(seq, 5000)` richtig ist
 *
 * `pg_sequences.last_value` sagt NICHT, ob die Sequenz schon gezogen wurde.
 * Die Spalte `is_called` steht nur in der Sequenzrelation selbst. Daraus
 * folgt die eine Stelle, an der S5/S6 eine Annahme macht: Zeile 4 rechnet
 * `last_value + 1`, und das ist nur bei `is_called = true` richtig.
 * ========================================================================== */
afterAll(async () => { await db?.close(); });

describe("sky_id_seq — is_called und die Bandverschiebung", () => {
  /* ZWEI SEQUENZEN IN DERSELBEN DATENBANK, nicht zwei Datenbanken: die Frage
   * ist eine ueber Sequenzen, nicht ueber Schemata. */
  const stand = async (n: string) => (await db.query<{ last_value: string; is_called: boolean }>(
    `select last_value::text, is_called from public.${n}`)).rows[0];
  const sicht = async (n: string) => (await db.query<{ last_value: string | null }>(
    `select last_value::text from pg_sequences where sequencename = '${n}'`)).rows[0];
  const zieh = async (n: string) => Number((await db.query<{ nextval: string }>(
    `select nextval('public.${n}')`)).rows[0].nextval);

  it("eine nie gezogene Sequenz: is_called false, pg_sequences zeigt NULL", async () => {
    await db.exec(`create sequence public.p74_seq_a as bigint start with 821 increment by 1;`);
    expect((await stand("p74_seq_a")).is_called).toBe(false);
    expect((await sicht("p74_seq_a")).last_value).toBeNull();
  });

  it("nach dem ersten nextval ist is_called true — der gemessene Zustand", async () => {
    expect(await zieh("p74_seq_a")).toBe(821);
    const st = await stand("p74_seq_a");
    expect(st.is_called).toBe(true);
    expect(st.last_value).toBe("821");
    /*
     * Genau das hat S6 am 2026-10-30 auf Production gemessen: last_value 821.
     * WEIL is_called true ist, stimmt dort Zeile 4 von S5/S6 (`last_value + 1`)
     * und nennt SKY-0822. Die Annahme jener Zeile ist damit belegt, nicht
     * geraten.
     */
    expect((await sicht("p74_seq_a")).last_value).toBe("821");
  });

  it("setval(seq, 5000) setzt is_called true — der naechste Zug ist 5001", async () => {
    await db.query(`select setval('public.p74_seq_a', 5000)`);
    const st = await stand("p74_seq_a");
    expect(st.last_value).toBe("5000");
    expect(st.is_called).toBe(true);
    expect(await zieh("p74_seq_a")).toBe(5001);
  });

  it("die Dreiparameterform traefe 5001 auch — meldet aber 5001 als last_value", async () => {
    await db.exec(`create sequence public.p74_seq_b as bigint start with 821 increment by 1;`);
    await db.query(`select setval('public.p74_seq_b', 5001, false)`);
    const st = await stand("p74_seq_b");
    expect(st.last_value).toBe("5001");
    expect(st.is_called).toBe(false);
    expect(await zieh("p74_seq_b")).toBe(5001);
    /*
     * BEIDE treffen 5001, und trotzdem ist die Zweiparameterform die richtige:
     * nach ihr steht die Sequenz im SELBEN Zustand wie nach einem gewoehnlichen
     * Zug, und S5/S6 Zeile 4 liest sie richtig. Nach der Dreiparameterform
     * stuende dort SKY-5002 — eine Zahl, die nie vergeben wird.
     */
  });
});

describe("R0165 — die Ruecknahme", () => {
  it("entfernt genau die eine Funktion und laesst Figuren und Journal stehen", async () => {
    /* Zuletzt, und in DERSELBEN Datenbank: die Zeilen der Tests oben sind
     * genau der Bestand, an dem sich „laesst stehen" messen laesst. */
    const figuren = await zahl(`select count(*) as n from public.skylanders`);
    const journal = await zahl(`select count(*) as n from public.catalog_admin_changes`);
    expect(figuren).toBeGreaterThan(0);
    expect(journal).toBeGreaterThan(0);

    await db.exec(RUECKNAHME);

    expect(await zahl(
      `select count(*) as n from pg_proc where proname = 'system_sync_create_figure'`)).toBe(0);
    expect(await zahl(`select count(*) as n from public.skylanders`)).toBe(figuren);
    expect(await zahl(`select count(*) as n from public.catalog_admin_changes`)).toBe(journal);
  });
});
