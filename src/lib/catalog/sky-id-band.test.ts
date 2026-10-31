import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

/* ==========================================================================
 * DAS VERGABEBAND AN ECHTEM POSTGRESQL
 *
 * Geprüft wird beides: die zwei Operationsdateien UND die korrigierte
 * Sequenzzeile von S5/S6 — denn die Korrektur existiert nur wegen dieser
 * Dateien. Nach `RESTART WITH n` ist `is_called` false, und der nächste Zug
 * ist `n` selbst; die frühere Fassung hätte `n + 1` gemeldet.
 * ========================================================================== */

const BAND = {
  staging: readFileSync("supabase/operations/staging-sky-id-band.sql", "utf8"),
  production: readFileSync("supabase/operations/production-sky-id-band.sql", "utf8"),
};
const S5 = readFileSync("resources/analysis/s5-vergabestand-staging.sql", "utf8");
const S5_RUMPF = S5.slice(S5.indexOf("with\n")).replace(/;\s*$/, "");

/**
 * Der Zustand einer Umgebung, so weit die Banddatei ihn anfasst.
 *
 * DER UMGEBUNGSSTEMPEL HAT SICH AM 2026-10-30 GEAENDERT, UND ZWAR AUS EINEM
 * ZWINGENDEN GRUND.
 *
 * Die Production-Datei erkannte ihre Umgebung bisher an ZEILEN: `SKY-0821`
 * steht, `SKY-0822` steht nicht. Der Katalogabgleich legt `SKY-0822` auf
 * Production aber demnächst an — es ist die erste der 33 Figuren. Der
 * Stempel hätte sich durch den eigenen Sync zerstört.
 *
 * Sie prüft jetzt POSITIV und am SCHEMA: `0133` mit BEIDEN Objekten (die
 * Triggerfunktion `purchases_paid_total_is_final` und der Trigger auf
 * `purchases`) — `0133` liegt nur auf Production — und dass die Sequenz
 * nicht das Staging-Band trägt. Beides überlebt jeden Zeilenimport.
 *
 * Der Aufbau bildet das ab: die Production-Welt bekommt `0133`, die
 * Staging-Welt nicht. Die Katalogzeilen `SKY-0821`/`SKY-0822` bleiben
 * drin — die Staging-Datei stützt sich weiter darauf, und der Testfall
 * „falsche Umgebung" braucht beide Welten unterscheidbar.
 */
const AUFBAU = (umg: "staging" | "production", lastValue: number) => `
create table public.skylanders (
  sky_id text primary key, name text not null, series_code text not null);
create table public.catalog_admin_changes (
  entity text not null, entity_id text not null, field text not null);
create table public.shop_inventory (sky_id text not null, quantity integer not null);
create table public.collection_items (user_id uuid not null, sky_id text not null);
create table public.purchases (id bigint primary key, paid_total numeric);
create sequence public.sky_id_seq as bigint start with 821 increment by 1;
insert into public.skylanders values ('SKY-0001','Bash','SA'), ('SKY-0821','X','SF')
  ${umg === "staging" ? ", ('SKY-0822','Y','SF')" : ""};
insert into public.catalog_admin_changes values ('skylander','SKY-0001','created');
insert into public.shop_inventory values ('SKY-0001', 3);
insert into public.collection_items values ('00000000-0000-0000-0000-000000000001','SKY-0001');
select setval('public.sky_id_seq', ${lastValue});
${umg === "production" ? `
-- 0133, und zwar BEIDE Objekte. Nur auf Production.
create function public.purchases_paid_total_is_final() returns trigger
  language plpgsql as $t$ begin return new; end $t$;
create trigger purchases_paid_total_immutable_trg
  before update on public.purchases
  for each row execute function public.purchases_paid_total_is_final();
` : ""}
`;

/**
 * Der Katalog muss fuer A1d mindestens 100 Zeilen tragen. Zwei Fixtures
 * genuegen dafuer nicht — die Production-Datei braucht also Fuellung, und
 * zwar unterhalb beider Baender, damit A3 und A4 davon unberuehrt bleiben.
 */
const FUELLUNG = `
insert into public.skylanders
  select 'SKY-' || lpad(g::text, 4, '0'), 'Fuellung ' || g, 'SA'
    from generate_series(100, 250) g
   where not exists (select 1 from public.skylanders s
                      where s.sky_id = 'SKY-' || lpad(g::text, 4, '0'));
`;

/*
 * EINE EIGENE FRIST FUER DEN HOOK, DER PGlite STARTET. Vitest gibt ihm zehn
 * Sekunden; eine WASM-PostgreSQL-Instanz neben 340 anderen Dateien braucht
 * gelegentlich mehr. Genau daran ist diese Datei am 2026-10-30 gescheitert —
 * nicht an einer Zusicherung, sondern an `Hook timed out in 10000ms`.
 */
const DB_FRIST = 60_000;

let db: PGlite;
const fehler = async (sql: string): Promise<string> => {
  try { await db.exec(sql); return "KEIN FEHLER"; }
  catch (e) {
    /*
     * NACH EINEM ABBRUCH MUSS ZURUECKGEROLLT WERDEN.
     *
     * Die Banddatei ist `begin; … raise exception …; commit;`. Die Ausnahme
     * bricht die Transaktion ab, sie bleibt aber OFFEN — jede weitere
     * Anweisung derselben Sitzung endet dann mit „current transaction is
     * aborted". Mit einer eigenen Datenbank je Testfall fiel das nicht auf;
     * mit einer gemeinsamen schon. Genau so verhaelt sich auch der
     * SQL-Editor: nach einem Abbruch gehoert ein `rollback`.
     */
    await db.exec("rollback").catch(() => {});
    return String((e as Error).message);
  }
};
const zeile = async (nr: number): Promise<string> => {
  const r = await db.query<{ nr: number; was: string; wert: string }>(S5_RUMPF);
  return String(r.rows.find((z) => z.nr === nr)?.wert ?? "(fehlt)");
};

describe.each([
  { umg: "staging" as const, hoechste: 927, min: 928, max: 4999, erste: 928 },
  { umg: "production" as const, hoechste: 821, min: 5001, max: 8999, erste: 5001 },
])("$umg — Band $min..$max", ({ umg, hoechste, min, max, erste }) => {
  /*
   * EINE Instanz je Umgebung, nicht eine je Testfall. Vierzehn Faelle mal
   * zwei Umgebungen waren 28 PGlite-Instanzen; einzeln lief die Datei
   * damit, im Gesamtlauf nicht. Zwischen den Faellen wird der Zustand
   * zurueckgesetzt statt neu aufgebaut — billiger und genauso sauber.
   */
  beforeEach(async () => {
    db ??= new PGlite();
    /*
     * `purchases` und die beiden 0133-Objekte muessen MIT abgeraeumt werden.
     * Eine erste Fassung hat sie vergessen, und ab dem zweiten Fall
     * scheiterte jeder Aufbau an „relation already exists" — sichtbar als
     * zwanzig fehlgeschlagene Faelle, von denen keiner etwas mit dem Band zu
     * tun hatte.
     */
    await db.exec(`drop table if exists public.skylanders, public.catalog_admin_changes,
                     public.shop_inventory, public.collection_items, public.purchases
                     cascade;
                   drop sequence if exists public.sky_id_seq;
                   drop function if exists public.zieht();
                   drop function if exists public.purchases_paid_total_is_final() cascade;`);
    await db.exec(AUFBAU(umg, hoechste));
    await db.exec(FUELLUNG);
  }, DB_FRIST);
  afterAll(async () => { await db?.close(); db = undefined as unknown as PGlite; });

  it("läuft durch und setzt genau das Band", async () => {
    expect(await fehler(BAND[umg])).toBe("KEIN FEHLER");
    const s = (await db.query<{ min_value: string; max_value: string; cycle: boolean }>(
      `select min_value::text, max_value::text, cycle from pg_sequences
        where sequencename = 'sky_id_seq'`)).rows[0];
    expect(s.min_value).toBe(String(min));
    expect(s.max_value).toBe(String(max));
    expect(s.cycle).toBe(false);
  });

  it("der erste Zug ist genau die erste Nummer des Bandes", async () => {
    await db.exec(BAND[umg]);
    const n = (await db.query<{ nextval: string }>(
      `select nextval('public.sky_id_seq')`)).rows[0].nextval;
    expect(Number(n)).toBe(erste);
  });

  it("die Obergrenze hält — auch gegen SECURITY DEFINER", async () => {
    await db.exec(BAND[umg]);
    await db.exec(`create function public.zieht() returns bigint
      language plpgsql security definer as $$ begin
        return nextval('public.sky_id_seq'); end $$;`);
    await db.query(`select setval('public.sky_id_seq', ${max})`);
    expect(await fehler(`select public.zieht()`)).toContain("reached maximum value");
  });

  it("setval kann das Band nicht verlassen", async () => {
    await db.exec(BAND[umg]);
    expect(await fehler(`select setval('public.sky_id_seq', ${min - 1})`))
      .toContain("out of bounds");
    expect(await fehler(`select setval('public.sky_id_seq', 9500)`))
      .toContain("out of bounds");
  });

  it("fasst keine Katalogzeile an", async () => {
    const vorher = (await db.query<{ n: string }>(
      `select count(*) as n from public.skylanders`)).rows[0].n;
    await db.exec(BAND[umg]);
    expect((await db.query<{ n: string }>(
      `select count(*) as n from public.skylanders`)).rows[0].n).toBe(vorher);
  });

  it("ein zweiter Lauf prallt an Wächter A2 ab", async () => {
    await db.exec(BAND[umg]);
    expect(await fehler(BAND[umg])).toContain("A2 ABBRUCH");
  });

  /*
   * DIE WAECHTER FANGEN DIE FALSCHE UMGEBUNG — aber seit dem 2026-10-30 auf
   * verschiedene Weise, und das gehoert hier festgehalten:
   *
   *   Staging-Datei in der Production-Welt   -> `A1 ABBRUCH` (das
   *       vollstaendige Markerpaar fehlt dort). Ein NEGATIVER Riegel, und er
   *       genuegt dort: die Staging-Datei ist einmalig und gelaufen.
   *
   *   Production-Datei in der Staging-Welt   -> `A1a ABBRUCH` (die
   *       Triggerfunktion aus `0133` fehlt). Ein POSITIVER Riegel am Schema,
   *       der auch nach dem Import von `SKY-0822` gilt.
   */
  it("Wächter A1 fängt die FALSCHE Umgebung", async () => {
    const andere = umg === "staging" ? "production" : "staging";
    const erwartet = andere === "production" ? "A1a ABBRUCH" : "A1 ABBRUCH";
    expect(await fehler(BAND[andere])).toContain(erwartet);
  });

  /*
   * UND DER POSITIVE RIEGEL HAENGT AN KEINER ZEILE. Nimmt man der
   * Production-Welt `SKY-0821` weg und gibt ihr `SKY-0822` dazu — genau der
   * Zustand nach dem Figurenimport —, laeuft die Datei weiter durch.
   */
  it("der Production-Wächter überlebt den Import von SKY-0822", async () => {
    if (umg !== "production") return;
    await db.exec(`delete from public.skylanders where sky_id = 'SKY-0821';
                   insert into public.skylanders values ('SKY-0822','Importiert','SF');`);
    expect(await fehler(BAND.production)).toBe("KEIN FEHLER");
  });

  /* --------------------------------------------------------------------
   * S5/S6 — die Korrektur, an genau dem Zustand gemessen, der sie nötig
   * gemacht hat.
   * ------------------------------------------------------------------ */
  it("S5 meldet VOR dem Band last_value + 1", async () => {
    expect(await zeile(4)).toBe(`SKY-${String(hoechste + 1).padStart(4, "0")}`);
    expect(await zeile(11)).toContain("1 .. 9223372036854775807");
    expect(await zeile(12)).toContain("KEINE Bereichssperre");
  });

  it("S5 meldet NACH dem Band die erste Bandnummer — nicht eine mehr", async () => {
    await db.exec(BAND[umg]);
    expect(await zeile(4)).toBe(`SKY-${String(erste).padStart(4, "0")}`);
    expect(await zeile(1)).toContain("is_called = false");
    expect(await zeile(11)).toBe(`${min} .. ${max}  (NO CYCLE)`);
    expect(await zeile(12)).toContain("ok: die Vergabe ist auf");
  });

  it("S5 meldet nach einem gewöhnlichen Zug wieder last_value + 1", async () => {
    await db.exec(BAND[umg]);
    await db.query(`select nextval('public.sky_id_seq')`);
    expect(await zeile(1)).toContain("is_called = true");
    expect(await zeile(4)).toBe(`SKY-${String(erste + 1).padStart(4, "0")}`);
  });
});

describe("S5/S6 — der Rumpf ist in beiden Dateien zeichengleich", () => {
  it("stimmt", () => {
    const s6 = readFileSync("resources/analysis/s6-vergabestand-production.sql", "utf8");
    expect(s6.slice(s6.indexOf("with\n"))).toBe(S5.slice(S5.indexOf("with\n")));
  });
});
