import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

/* ==========================================================================
 * `0168` AN ECHTEM POSTGRESQL — die Familie folgt der Basisfigur (ADR-0171)
 *
 * Die Schreibwege kommen WÖRTLICH aus den Migrationen (`0158`, `0159`), und
 * `0168` läuft als ganze Datei, wie im SQL-Editor. Nur `is_platform_admin()`
 * und `auth.uid()` sind Stümpfe.
 *
 * Die Fälle A–G sind die aus dem Auftrag; die SKY-IDs die echten von Staging
 * (2026-11-02): Sprocket SKY-0147 (Giants) mit Sparkle Sprocket SKY-0850,
 * Heavy Duty Sprocket SKY-0278 (Swap Force) als serienfremde Basisfigur
 * derselben Familie, Gold Chop Chop SKY-0832 als heutige Abweichung.
 * ========================================================================== */

const MIG = (n: string) => readFileSync(`supabase/migrations/${n}`, "utf8");
const M0168 = MIG("0168_variant_family_inheritance.sql");
const R0168 = readFileSync("supabase/rollback/R0168_drop_variant_family_inheritance.sql", "utf8");

function rumpf(datei: string, name: string): string {
  const sql = MIG(datei);
  const start = sql.lastIndexOf(`create or replace function public.${name}(`);
  if (start < 0) throw new Error(`${name} fehlt in ${datei}`);
  return sql.slice(start, sql.indexOf("\n$$;", start) + 4);
}

/* Die Journalwerte, wie sie nach 0163 auf beiden Umgebungen stehen. */
const FELDER = ["catalog_visible", "display_name_override", "admin_note", "catalog_group",
  "image_override_path", "card_type", "created", "catalog_status", "merged_from",
  "discarded", "character_id", "base_sky_id", "deleted", "types", "visible_type"];

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

create table public.characters (
  id bigint generated always as identity primary key, canonical_name text not null,
  element text, species text, role_type text, short_description text,
  source_url text, source_label text, verified_at date);
create unique index characters_canonical_name_key on public.characters (lower(canonical_name));

create table public.skylanders (
  sky_id text primary key, name text not null, series_code text not null,
  character_id bigint references public.characters (id) on delete restrict,
  base_sky_id text, catalog_status text not null default 'public',
  updated_at timestamptz not null default now(),
  constraint skylanders_id_series_uniq unique (sky_id, series_code),
  constraint skylanders_base_not_self check (base_sky_id is distinct from sky_id),
  constraint skylanders_base_same_series foreign key (base_sky_id, series_code)
    references public.skylanders (sky_id, series_code) on update restrict on delete restrict);

create table public.catalog_admin_changes (
  id bigint generated always as identity primary key,
  entity text not null, entity_id text not null, field text not null,
  old_value text, new_value text, changed_by uuid,
  constraint catalog_admin_changes_entity_known check (entity in ('skylander', 'category')),
  constraint catalog_admin_changes_field_known check (field in (${FELDER.map((f) => `'${f}'`).join(", ")})));

create table public.collection_items (
  user_id uuid not null, sky_id text not null references public.skylanders (sky_id), quantity int not null);
`;

const BESTAND = `
insert into public.characters (canonical_name) values ('Sprocket'), ('Heavy Duty Sprocket'), ('Chop Chop');
insert into public.characters (canonical_name, element) values ('Spyro', 'Magic');
insert into public.skylanders (sky_id, name, series_code, character_id) values
  ('SKY-0147', 'Sprocket', 'G', null),
  ('SKY-0278', 'Heavy Duty Sprocket', 'SF', 2),
  ('SKY-0015', 'Chop Chop', 'SA', 3),
  ('SKY-0001', 'Spyro', 'SA', 4),
  ('SKY-0500', 'Leere Basis', 'G', null);
insert into public.skylanders (sky_id, name, series_code, base_sky_id) values
  ('SKY-0850', 'Sparkle Sprocket', 'G', 'SKY-0147'),
  ('SKY-0871', 'Heavy Metal Sprocket', 'SF', 'SKY-0278');
-- Eine bestehende Abweichung VOR 0168: Gold Chop Chop ohne Familie.
insert into public.skylanders (sky_id, name, series_code, base_sky_id) values
  ('SKY-0832', 'Gold Chop Chop', 'SA', null);
update public.skylanders set base_sky_id = 'SKY-0015' where sky_id = 'SKY-0832';
insert into public.collection_items values ('11111111-1111-1111-1111-111111111111', 'SKY-0850', 2);
`;

let db: PGlite;
const FRIST = 60_000;

const n = async (sql: string, p: unknown[] = []) =>
  Number((await db.query<{ n: number }>(`select (${sql})::int as n`, p)).rows[0].n);
const familie = async (sky: string) =>
  (await db.query<{ c: number | null }>(
    "select character_id as c from public.skylanders where sky_id = $1", [sky])).rows[0].c;
const setze = (sky: string, fam: number | null) =>
  db.query("select public.admin_set_character($1, $2)", [sky, fam]);
const basis = (sky: string, base: string | null, neu = false) =>
  db.query("select public.admin_set_variant_base($1, $2, $3)", [sky, base, neu]);
async function fehler(p: Promise<unknown>): Promise<string> {
  try { await p; return "(kein Fehler)"; } catch (e) { return (e as Error).message; }
}
const journal = () => n("select count(*) from public.catalog_admin_changes");

async function aufbauen(ziel: PGlite) {
  await ziel.exec(AUFBAU);
  for (const [datei, name] of [
    ["0158_figure_families.sql", "admin_create_character"],
    ["0158_figure_families.sql", "admin_set_character"],
    ["0159_variant_base_figure.sql", "skylanders_variant_base_guard"],
    ["0159_variant_base_figure.sql", "admin_set_variant_base"],
  ] as const) await ziel.exec(rumpf(datei, name));
  await ziel.exec(`
    create trigger skylanders_variant_base_guard_trg
      before insert or update of base_sky_id on public.skylanders
      for each row execute function public.skylanders_variant_base_guard();`);
  await ziel.exec(BESTAND);
}

beforeAll(async () => {
  db = new PGlite();
  await aufbauen(db);
  await db.exec(M0168);
}, FRIST);
afterAll(async () => { await db?.close(); });

describe("0168 — die Migration selbst", () => {
  it("enthält außerhalb von Funktionsrümpfen keine Datenanweisung", () => {
    const ohneRuempfe = M0168.replace(/\$\$[\s\S]*?\$\$/g, "").replace(/\$[a-z_]+\$[\s\S]*?\$[a-z_]+\$/g, "");
    expect(ohneRuempfe).not.toMatch(/^\s*(insert into|update public|delete from)/im);
  });

  it("korrigiert keine bestehende Abweichung — Gold Chop Chop bleibt ohne Familie", async () => {
    expect(await familie("SKY-0832")).toBeNull();
    expect(await familie("SKY-0015")).toBe(3);
  }, FRIST);

  it("legt keine Familie an und löscht keine", async () => {
    expect(await n("select count(*) from public.characters")).toBe(4);
  }, FRIST);

  it("ein zweiter Lauf ist folgenlos — keine doppelten Trigger, gleiche Constraints", async () => {
    const vorher = (await db.query<{ d: string }>(
      `select string_agg(pg_get_constraintdef(oid), '|' order by conname) as d from pg_constraint
        where conrelid = 'public.catalog_admin_changes'::regclass and contype = 'c'`)).rows[0].d;
    await db.exec(M0168);
    const nachher = (await db.query<{ d: string }>(
      `select string_agg(pg_get_constraintdef(oid), '|' order by conname) as d from pg_constraint
        where conrelid = 'public.catalog_admin_changes'::regclass and contype = 'c'`)).rows[0].d;
    expect(nachher).toBe(vorher);
    expect(await n(`select count(*) from pg_trigger where tgname like 'skylanders_variant_family_%'`)).toBe(2);
    expect(nachher).toContain("'family_deleted'");
    expect(nachher).toContain("'character'");
    for (const f of FELDER) expect(nachher).toContain(`'${f}'`);
  }, FRIST);
});

describe("A — eine neue Variante erbt", () => {
  it("mit Basisfamilie: die Familie der Basisfigur, auch wenn eine andere mitgegeben wird", async () => {
    await db.query(`insert into public.skylanders (sky_id, name, series_code, base_sky_id, character_id)
                    values ('SKY-0901', 'Neue Heavy Duty', 'SF', 'SKY-0278', 3)`);
    expect(await familie("SKY-0901")).toBe(2);
  }, FRIST);

  it("ohne Basisfamilie: keine", async () => {
    await db.query(`insert into public.skylanders (sky_id, name, series_code, base_sky_id, character_id)
                    values ('SKY-0902', 'Neue Leere', 'G', 'SKY-0500', 1)`);
    expect(await familie("SKY-0902")).toBeNull();
  }, FRIST);

  it("auch über admin_set_variant_base (der Weg aus 0166) — ohne Journal-Doppel", async () => {
    await db.query(`insert into public.skylanders (sky_id, name, series_code) values ('SKY-0903', 'Entwurf', 'SF')`);
    const j = await journal();
    await basis("SKY-0903", "SKY-0278");
    expect(await familie("SKY-0903")).toBe(2);
    /* eine Zeile base_sky_id, eine character_id (geerbt) */
    expect(await journal()).toBe(j + 2);
  }, FRIST);
});

describe("B/F — rückwirkend: die Basisfigur bekommt ihre Familie später", () => {
  it("SKY-0147 → Sprocket nimmt SKY-0850 mit, in derselben Anweisung", async () => {
    expect(await familie("SKY-0850")).toBeNull();
    const j = await journal();
    await setze("SKY-0147", 1);
    expect(await familie("SKY-0147")).toBe(1);
    expect(await familie("SKY-0850")).toBe(1);
    expect(await journal()).toBe(j + 2);
  }, FRIST);

  it("zwölf Varianten folgen alle — und jede bekommt ihre Journalzeile", async () => {
    for (let i = 0; i < 12; i++) {
      await db.query(`insert into public.skylanders (sky_id, name, series_code, base_sky_id)
                      values ($1, $2, 'G', 'SKY-0500')`, [`SKY-06${String(i).padStart(2, "0")}`, `V${i}`]);
    }
    const j = await journal();
    await setze("SKY-0500", 3);
    expect(await n(`select count(*) from public.skylanders where base_sky_id = 'SKY-0500' and character_id = 3`))
      .toBe(13);   // 12 + SKY-0902
    expect(await journal()).toBe(j + 1 + 13);
  }, FRIST);
});

describe("C/D — wechseln und entfernen", () => {
  it("C: A → B nimmt alle direkten Varianten mit", async () => {
    await setze("SKY-0500", 1);
    expect(await n(`select count(*) from public.skylanders where base_sky_id = 'SKY-0500' and character_id = 1`))
      .toBe(13);
  }, FRIST);

  it("D: entfernen gibt allen Varianten NULL", async () => {
    await setze("SKY-0500", null);
    expect(await n(`select count(*) from public.skylanders where base_sky_id = 'SKY-0500' and character_id is null`))
      .toBe(13);
    expect(await familie("SKY-0500")).toBeNull();
  }, FRIST);
});

describe("E — eine Variante wechselt die Basisfigur", () => {
  it("bekommt die Familie der neuen — ohne Konfliktabbruch (0159 brach hier ab)", async () => {
    expect(await familie("SKY-0901")).toBe(2);
    await basis("SKY-0901", "SKY-0278");   // unverändert
    await db.query("update public.skylanders set series_code = 'SF' where sky_id = 'SKY-0901'");
    await db.query(`insert into public.skylanders (sky_id, name, series_code, character_id)
                    values ('SKY-0279', 'Zweite SF-Basis', 'SF', 3)`);
    await basis("SKY-0901", "SKY-0279");
    expect(await familie("SKY-0901")).toBe(3);
  }, FRIST);

  it("und eine Basisfigur ohne Familie nimmt der Variante ihre", async () => {
    await db.query(`insert into public.skylanders (sky_id, name, series_code) values ('SKY-0280', 'SF ohne', 'SF')`);
    await basis("SKY-0901", "SKY-0280");
    expect(await familie("SKY-0901")).toBeNull();
  }, FRIST);

  it("loesen behält die Familie, die sie gerade trägt", async () => {
    await basis("SKY-0901", "SKY-0278");
    await basis("SKY-0901", null);
    expect(await familie("SKY-0901")).toBe(2);
  }, FRIST);
});

describe("G — serienübergreifend", () => {
  it("zwei Basisfiguren in zwei Serien in einer Familie, ohne Variantenbeziehung", async () => {
    await setze("SKY-0278", 1);                       // Heavy Duty Sprocket → Sprocket
    expect(await familie("SKY-0147")).toBe(1);
    expect(await familie("SKY-0278")).toBe(1);
    expect(await familie("SKY-0871")).toBe(1);        // ihre eigene Variante folgt ihr
    expect(await n("select count(*) from public.skylanders where sky_id = 'SKY-0278' and base_sky_id is null")).toBe(1);
  }, FRIST);

  it("die eine Basisfigur bewegt die Varianten der anderen nicht", async () => {
    await setze("SKY-0278", 2);
    expect(await familie("SKY-0871")).toBe(2);
    expect(await familie("SKY-0850")).toBe(1);        // Varianten von SKY-0147 bleiben
  }, FRIST);
});

describe("die Regel ist hart", () => {
  it("eine Variante bekommt keine eigene, abweichende Familie", async () => {
    const msg = await fehler(setze("SKY-0850", 2));
    expect(msg).toContain("0168");
    expect(msg).toContain("Familie wird an der Basisfigur gepflegt");
    expect(await familie("SKY-0850")).toBe(1);
  }, FRIST);

  it("auch nicht NULL, wenn die Basisfigur eine hat — und nicht am RPC vorbei", async () => {
    expect(await fehler(setze("SKY-0850", null))).toContain("0168");
    expect(await fehler(db.query(
      "update public.skylanders set character_id = 3 where sky_id = 'SKY-0850'"))).toContain("0168");
  }, FRIST);

  it("derselbe Wert wie die Basisfigur ist erlaubt (die Korrektur einer Altabweichung)", async () => {
    expect(await familie("SKY-0832")).toBeNull();
    await setze("SKY-0832", 3);
    expect(await familie("SKY-0832")).toBe(3);
  }, FRIST);

  it("keine Kette und keine Selbstreferenz — die Riegel aus 0159 stehen", async () => {
    expect(await fehler(basis("SKY-0147", "SKY-0850"))).toMatch(/0159/);
    expect(await fehler(basis("SKY-0147", "SKY-0147"))).toMatch(/0159/);
    expect(await fehler(basis("SKY-0850", "SKY-0278"))).toMatch(/0159/);   // fremde Serie
  }, FRIST);
});

describe("kein Teilzustand", () => {
  it("scheitert die Kaskade, bleibt auch die Basisfigur, wie sie war", async () => {
    /* Eine Variante, deren Journalzeile die Constraint verletzt, gibt es
       nicht — also lässt sich die Kaskade nur über eine fremde Sperre zum
       Scheitern bringen: ein Trigger, der genau diese eine Variante abweist. */
    await db.exec(`
      create function public.t_weigere() returns trigger language plpgsql as $$
      begin if new.sky_id = 'SKY-0603' then raise exception 'test: abgewiesen'; end if; return new; end $$;
      create trigger t_weigere before update on public.skylanders
        for each row execute function public.t_weigere();`);
    const j = await journal();
    expect(await fehler(setze("SKY-0500", 3))).toContain("test: abgewiesen");
    expect(await familie("SKY-0500")).toBeNull();
    expect(await n(`select count(*) from public.skylanders where base_sky_id = 'SKY-0500' and character_id is not null`))
      .toBe(0);
    expect(await journal()).toBe(j);
    await db.exec("drop trigger t_weigere on public.skylanders; drop function public.t_weigere();");
  }, FRIST);

  it("eine abgebrochene Transaktion nimmt alles mit", async () => {
    await db.exec("begin");
    await setze("SKY-0500", 3);
    expect(await n(`select count(*) from public.skylanders where base_sky_id = 'SKY-0500' and character_id = 3`)).toBe(13);
    await db.exec("rollback");
    expect(await n(`select count(*) from public.skylanders where base_sky_id = 'SKY-0500' and character_id is not null`)).toBe(0);
  }, FRIST);

  it("die Sperren stehen: die Variante liest for share, die Kaskade sperrt geordnet", () => {
    const follow = rumpfAus(M0168, "skylanders_variant_family_follow");
    expect(follow).toMatch(/where s\.sky_id = new\.base_sky_id\s+for share;/);
    const cascade = rumpfAus(M0168, "skylanders_variant_family_cascade");
    expect(cascade).toMatch(/order by v\.sky_id\s+for update;/);
  });
});

function rumpfAus(sql: string, name: string): string {
  const s = sql.indexOf(`create or replace function public.${name}(`);
  return sql.slice(s, sql.indexOf("\n$$;", s));
}

describe("p_create_family — nur auf Wunsch, an der Basisfigur", () => {
  it("die Basisfigur hat keine: eine nach ihrem Namen, die Variante erbt", async () => {
    await db.query(`insert into public.skylanders (sky_id, name, series_code) values
      ('SKY-0700', 'Wham-Shell Neu', 'SA'), ('SKY-0701', 'Wham-Shell Variante', 'SA')`);
    const c = await n("select count(*) from public.characters");
    await basis("SKY-0701", "SKY-0700", true);
    expect(await n("select count(*) from public.characters")).toBe(c + 1);
    const neu = await familie("SKY-0700");
    expect(neu).not.toBeNull();
    expect(await familie("SKY-0701")).toBe(neu);
  }, FRIST);

  it("ohne Wunsch entsteht keine", async () => {
    await db.query(`insert into public.skylanders (sky_id, name, series_code) values
      ('SKY-0702', 'Ohne Wunsch', 'SA'), ('SKY-0703', 'Ohne Wunsch V', 'SA')`);
    const c = await n("select count(*) from public.characters");
    await basis("SKY-0703", "SKY-0702");
    expect(await n("select count(*) from public.characters")).toBe(c);
    expect(await familie("SKY-0703")).toBeNull();
  }, FRIST);
});

describe("leere Familien — admin_delete_empty_character", () => {
  const loesche = async (id: number) =>
    (await db.query<{ r: string }>("select public.admin_delete_empty_character($1) as r", [id])).rows[0].r;

  it("ohne Staging-Stempel löscht sie nichts (Production)", async () => {
    await db.query("insert into public.characters (canonical_name) values ('Twin Blade Chop Chop')");
    const id = await n("select id from public.characters where canonical_name = 'Twin Blade Chop Chop'");
    expect(await loesche(id)).toBe("not_editorial");
    expect(await n("select count(*) from public.characters where id = $1", [id])).toBe(1);
  }, FRIST);

  it("auf Staging: belegt → bleibt, kuratiert → bleibt, leer → weg, mit Namen im Journal", async () => {
    await db.exec(`do $$ begin execute format('comment on database %I is %L', current_database(),
                   'skyisles-staging qqxcpesbwfxzgytkdsac'); end $$;`);
    expect(await loesche(1)).toBe("in_use");                         // Sprocket hat Mitglieder
    await db.query("insert into public.characters (canonical_name, element) values ('Kuratiert leer', 'Fire')");
    expect(await loesche(await n("select id from public.characters where canonical_name = 'Kuratiert leer'")))
      .toBe("curated");
    const id = await n("select id from public.characters where canonical_name = 'Twin Blade Chop Chop'");
    expect(await loesche(id)).toBe("deleted");
    expect(await n("select count(*) from public.characters where id = $1", [id])).toBe(0);
    const j = await db.query<{ e: string; f: string; o: string }>(
      `select entity as e, field as f, old_value as o from public.catalog_admin_changes
        where entity = 'character' and entity_id = $1`, [String(id)]);
    expect(j.rows).toEqual([{ e: "character", f: "family_deleted", o: "Twin Blade Chop Chop" }]);
    expect(await loesche(id)).toBe("gone");
  }, FRIST);

  it("der Fremdschlüssel hält jede belegte Familie — kein CASCADE", async () => {
    expect(await fehler(db.query("delete from public.characters where id = 1"))).toMatch(/foreign key|violates/);
    expect(await familie("SKY-0147")).toBe(1);
  }, FRIST);

  it("ohne Adminrecht nichts", async () => {
    await db.exec("update public.admin_switch set on_ = false");
    expect(await fehler(loesche(1))).toContain("not authorised");
    expect(await fehler(setze("SKY-0147", 2))).toContain("not authorised");
    await db.exec("update public.admin_switch set on_ = true");
  }, FRIST);
});

describe("geschützte Daten", () => {
  it("die Sammlung bleibt, wie sie war", async () => {
    expect(await n("select count(*) from public.collection_items where sky_id = 'SKY-0850' and quantity = 2")).toBe(1);
    expect(await n("select count(*) from public.collection_items")).toBe(1);
  }, FRIST);
});

describe("Rücknahme R0168", () => {
  it("entfernt Trigger und Funktion, stellt 0159 wörtlich her — und verweigert einen zweiten Lauf", async () => {
    await db.exec(R0168);
    expect(await n(`select count(*) from pg_trigger where tgname like 'skylanders_variant_family_%'`)).toBe(0);
    const src = (await db.query<{ s: string }>(
      "select prosrc as s from pg_proc where oid = 'public.admin_set_variant_base(text,text,boolean)'::regprocedure")).rows[0].s;
    expect(src).toContain("nicht stillschweigend ueberschrieben");
    expect(await fehler(db.exec(R0168))).toContain("R0168");
    /* Die Hülle öffnete `begin`; nach dem Abbruch ist die Transaktion tot —
       wie im SQL-Editor. Sie wird geschlossen, nichts ist geschehen. */
    await db.exec("rollback");
    /* Die Daten bleiben: was vererbt war, bleibt vererbt. */
    expect(await familie("SKY-0850")).toBe(1);
  }, FRIST);
});
