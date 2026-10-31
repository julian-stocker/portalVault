import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

/* ==========================================================================
 * DER GANZE ABLAUF DER BEREICHSSPERRE, AN ECHTEM POSTGRESQL
 *
 * Preflight → Banddatei → Postflight, in der Reihenfolge, in der der
 * Bediener sie fährt — und mit der Baseline, die dazwischen wandert.
 *
 * WAS BEWIESEN WIRD: der Preflight erkennt den Ausgangszustand und liefert
 * die Baseline; die Banddatei setzt das Band; der Postflight bestätigt es
 * UND dass sich keine Zeile bewegt hat; und er schlägt an, wenn doch.
 * ========================================================================== */

const PRE = readFileSync("supabase/checks/sky_id_band_preflight.sql", "utf8");
const BAND = readFileSync("supabase/operations/staging-sky-id-band.sql", "utf8");
const POST = readFileSync("supabase/checks/sky_id_band_postflight.sql", "utf8");

/* Der Staging-Zustand, soweit die drei Dateien ihn anfassen. */
const AUFBAU = `
create table public.skylanders (
  sky_id text primary key, name text not null, slug text not null,
  series_code text not null, catalog_status text not null default 'public',
  source text not null default 'import', base_sky_id text,
  /* Die zwei CHECK-Constraints, die sky_id wirklich erwaehnen -- genau die,
     die Preflight 142 beim Namen nennt. skylanders_base_not_self kommt aus
     0159 und war der Grund, warum die erste Fassung von 141 anschlug. */
  constraint skylanders_sky_id_format check (sky_id ~ '^SKY-[0-9]{4}$'),
  constraint skylanders_base_not_self check (base_sky_id is distinct from sky_id));
create table public.catalog_admin_changes (
  entity text not null, entity_id text not null, field text not null);
create table public.shop_inventory (
  sky_id text not null, condition text not null, quantity integer not null,
  is_listed boolean not null default false);
create table public.collection_items (
  user_id uuid not null, sky_id text not null, quantity integer not null);
create table public.categories (id bigint, series_code text, name text);
create sequence public.sky_id_seq as bigint start with 821 increment by 1;

insert into public.skylanders (sky_id, name, slug, series_code) values
  ('SKY-0001','Bash','bash','SA'), ('SKY-0821','Gold Fire Kraken','gfk','SF'),
  ('SKY-0822','Snowderdash','snow','SF'), ('SKY-0922','Blue Chest','bc','I');
insert into public.catalog_admin_changes values ('skylander','SKY-0927','discarded');
insert into public.shop_inventory values ('SKY-0001','loose',3,true);
insert into public.collection_items values
  ('00000000-0000-0000-0000-000000000001','SKY-0001',1);
insert into public.categories values (1,'SA','Figuren');
select setval('public.sky_id_seq', 927);
`;

let db: PGlite;
const DB_FRIST = 60_000;

type Zeile = { nr: number; bereich: string; pruefung: string;
               befund: string | null; erwartet: string | null; ok: boolean | null };

const lauf = async (sql: string, vertrag?: string): Promise<Map<number, Zeile>> => {
  if (vertrag) await db.query(`select set_config('skyisles.band', $1, false)`, [vertrag]);
  const r = await db.query<Zeile>(sql.slice(sql.indexOf("with\n")).replace(/;\s*$/, ""));
  return new Map(r.rows.map((z) => [Number(z.nr), z]));
};
const fehler = async (sql: string): Promise<string> => {
  try { await db.exec(sql); return "KEIN FEHLER"; }
  catch (e) { await db.exec("rollback").catch(() => {}); return String((e as Error).message); }
};

describe("Bereichssperre Staging — Preflight, Lauf, Postflight", () => {
  beforeEach(async () => {
    db ??= new PGlite();
    await db.exec(`drop table if exists public.skylanders, public.catalog_admin_changes,
                     public.shop_inventory, public.collection_items, public.categories;
                   drop sequence if exists public.sky_id_seq;`);
    await db.exec(AUFBAU);
  }, DB_FRIST);
  afterAll(async () => { await db?.close(); db = undefined as unknown as PGlite; });

  it("Preflight: 9999 = 0, und er erkennt den Ausgangszustand", async () => {
    const z = await lauf(PRE);
    expect(z.get(9999)!.befund).toBe("0");
    expect(z.get(101)!.befund).toBe("1");          // Sequenz steht
    expect(z.get(102)!.befund).toBe("true");       // noch KEIN Band
    expect(z.get(104)!.befund).toBe("2");          // Umgebungsstempel
    expect(z.get(112)!.befund).toBe("SKY-0927");   // hoechste JE GEZOGENE
    expect(z.get(113)!.befund).toBe("927|true");
    expect(z.get(114)!.befund).toBe("0");          // das Band ist leer
    expect(z.get(141)!.ok, "141 Formatconstraint wörtlich").toBe(true);
    expect(z.get(142)!.befund)                     // beide, beim Namen
      .toBe("skylanders_base_not_self,skylanders_sky_id_format");
    expect(z.get(900)!.befund).toMatch(/^skyisles-band-1\|/);
  });

  it("der ganze Ablauf: Preflight → Band → Postflight, alles 9999 = 0", async () => {
    const vor = await lauf(PRE);
    const vertrag = vor.get(900)!.befund!;

    expect(await fehler(BAND)).toBe("KEIN FEHLER");

    const nach = await lauf(POST, vertrag);
    expect(nach.get(9999)!.befund, "9999").toBe("0");
    expect(nach.get(201)!.befund).toBe("928");
    expect(nach.get(202)!.befund).toBe("4999");
    expect(nach.get(203)!.befund).toBe("false");
    expect(nach.get(204)!.befund).toBe("928");
    expect(nach.get(205)!.befund).toBe("928|false");   // naechster Zug ist 928 SELBST
    expect(nach.get(211)!.befund).toBe("true");
    expect(nach.get(212)!.befund).toBe("true");
    expect(nach.get(221)!.ok, "221 Formatconstraint unverändert").toBe(true);
    expect(nach.get(222)!.ok, "222 keine CHECK dazugekommen").toBe(true);
    for (const nr of [303, 304, 305, 306, 307, 308]) {
      expect(nach.get(nr)!.ok, `Zeile ${nr}`).toBe(true);
    }
  });

  it("der erste Zug nach der Sperre ist 928 — und 4999 ist die Grenze", async () => {
    await db.exec(BAND);
    expect(Number((await db.query<{ nextval: string }>(
      `select nextval('public.sky_id_seq')`)).rows[0].nextval)).toBe(928);
    await db.query(`select setval('public.sky_id_seq', 4999)`);
    expect(await fehler(`select nextval('public.sky_id_seq')`))
      .toContain("reached maximum value");
    expect(await fehler(`select setval('public.sky_id_seq', 9500)`))
      .toContain("out of bounds");
  });

  it("FREMDE SKY-IDs bleiben speicherbar — darum gibt es keine CHECK", async () => {
    await db.exec(BAND);
    /* Genau der Fall, für den die Sperre gebaut ist: der Sync trägt eine auf
       Production vergebene Nummer unter IHRER Nummer ein. */
    await db.query(`insert into public.skylanders (sky_id, name, slug, series_code)
                    values ('SKY-5001','Von Production','vp','SA')`);
    expect(Number((await db.query<{ n: string }>(
      `select count(*) as n from public.skylanders where sky_id = 'SKY-5001'`)).rows[0].n))
      .toBe(1);
    /* Und eine Nummer aus dem eigenen Band ebenso — die Sperre bindet die
       VERGABE, nicht die SPEICHERUNG. */
    await db.query(`insert into public.skylanders (sky_id, name, slug, series_code)
                    values ('SKY-0950','Von irgendwo','vi','SA')`);
    expect(await fehler(BAND)).toContain("A2 ABBRUCH");   // zweiter Lauf prallt ab
  });

  it("der Postflight SCHLAEGT AN, wenn sich doch eine Zeile bewegt", async () => {
    const vor = await lauf(PRE);
    const vertrag = vor.get(900)!.befund!;
    await db.exec(BAND);
    /* Eine Katalogzeile ändern — das darf die Sperre nicht, und der
       Postflight muss es sehen. Sonst wäre er wertlos. */
    await db.query(`update public.skylanders set name = 'Umbenannt' where sky_id = 'SKY-0001'`);
    const nach = await lauf(POST, vertrag);
    expect(nach.get(9999)!.befund, "9999 muss anschlagen").not.toBe("0");
    expect(nach.get(305)!.ok, "Katalogabdruck").toBe(false);
  });

  it("ein gescheiterter Waechter laesst die Sequenz UNVERAENDERT — eine Transaktion",
     async () => {
    /*
     * PUNKT 7: die Datei ist `begin; … commit;`. Schlägt ein Wächter an,
     * bricht die Transaktion ab und NICHTS davon bleibt stehen — auch nicht
     * das `alter sequence`, das danach käme. Gemessen statt zugesagt.
     */
    await db.query(`insert into public.skylanders (sky_id, name, slug, series_code)
                    values ('SKY-0950','Im Band','ib','SA')`);   // verletzt A3
    const vor = (await db.query<{ min_value: string; max_value: string }>(
      `select min_value::text, max_value::text from pg_sequences
        where sequencename = 'sky_id_seq'`)).rows[0];

    expect(await fehler(BAND)).toContain("A3 ABBRUCH");

    const nach = (await db.query<{ min_value: string; max_value: string }>(
      `select min_value::text, max_value::text from pg_sequences
        where sequencename = 'sky_id_seq'`)).rows[0];
    expect(nach).toEqual(vor);                       // kein Band gesetzt
    expect(nach.min_value).toBe("1");
    /* Und die Zeile, die den Abbruch ausgelöst hat, steht noch — die
       Transaktion hat nichts von ihr mitgenommen. */
    expect(Number((await db.query<{ n: string }>(
      `select count(*) as n from public.skylanders where sky_id = 'SKY-0950'`)).rows[0].n))
      .toBe(1);
  });

  it("eine fremde SKY-ID im Band haelt die Sperre an — A3", async () => {
    await db.query(`insert into public.catalog_admin_changes
                    values ('skylander','SKY-1234','discarded')`);
    expect(await fehler(BAND)).toContain("A3 ABBRUCH");
  });

  it("ohne Baseline schlaegt der Postflight an, statt stillschweigend zu bestehen",
     async () => {
    await db.exec(BAND);
    await db.query(`select set_config('skyisles.band', '', false)`);
    const nach = await lauf(POST);
    expect(nach.get(301)!.ok, "301 eine Baseline ist uebergeben worden").toBe(false);
    expect(nach.get(9999)!.befund).not.toBe("0");
  });
});
