import { beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  AUFNAHME, MIG_DIR, SETUP, abdruck, erwartung, ladeAufnahme, rechtErheblich,
} from "@/../tools/lib/privileges.mts";

/**
 * DIE RECHTE DES PRUEFZUGANGS — GEMESSEN, NICHT BEHAUPTET.
 *
 * DER ANLASS. Dreimal hintereinander ist die Nachkontrolle von `0146` an
 * einem fehlenden Recht gescheitert:
 *
 *   1. `permission denied for view offer_state_live`
 *   2. `permission denied for function offer_state_window`
 *   3. `permission denied for function shop_offers`
 *
 * Die ersten beiden Male war die Umsetzung zu eng — Tabellen ja, Funktionen
 * nein. Das dritte Mal lag der Fehler tiefer: die Pruefungen leiteten die
 * Rechte aus `staging-agent-setup.sql` ab, also aus der ABSICHT. Am
 * 2026-10-20 hat `0139` `shop_offers()` mit `drop function` neu angelegt —
 * und `DROP`+`CREATE` verwirft die ACL, waehrend `CREATE OR REPLACE` sie
 * behaelt. Die Erteilung war fort, die Datei sagte weiter „erteilt", und
 * jeder Probelauf bildete eine Welt nach, die es nicht mehr gab.
 *
 * An Staging gemessen (2026-10-25, lesend):
 *
 *   shop_offers()                 acl ohne skyisles_agent   → execute NEIN
 *   is_shop_eligible(text)        acl mit skyisles_agent     → execute ja
 *   non_collectible_categories()  acl mit skyisles_agent     → execute ja
 *
 * Zwei von drei Erteilungen stehen; genau die der neu angelegten Funktion
 * fehlt. Das ist der Beweis, nicht die Vermutung.
 */

const TMP: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), "skyisles-rechte-"));
  TMP.push(d);
  return d;
};
const aufraeumen = () => { for (const d of TMP.splice(0)) rmSync(d, { recursive: true, force: true }); };


describe("was die Einrichtungsdatei behauptet", () => {
  it("zwoelf Tabellen und drei Funktionen, mit Signatur", () => {
    const e = erwartung();
    expect(e.tabellen).toHaveLength(12);
    expect(e.funktionen).toEqual([
      "public.is_shop_eligible(text)",
      "public.non_collectible_categories()",
      "public.shop_offers()",
    ]);
  });

  it("und `offer_state` steht NICHT darin", () => {
    const e = erwartung();
    expect(e.tabellen).not.toContain("offer_state");
    expect(e.funktionen.join(" ")).not.toContain("offer_state_window");
  });
});


describe("welche Migration die Rechte des Pruefzugangs beruehren kann", () => {
  const e = erwartung();

  it("eine, die ihn NENNT", () => {
    expect(rechtErheblich("grant select on table public.x to skyisles_agent;", e)).toBe(true);
    expect(rechtErheblich("revoke all on public.x from skyisles_agent;", e)).toBe(true);
  });

  it("eine, die ein ihm erteiltes Objekt VERWIRFT — der Fall 0139", () => {
    /*
     * Hier steht kein `revoke`, und doch ist die Erteilung danach fort.
     * Genau diese Migration hat den dritten Fehlschlag verursacht.
     */
    expect(rechtErheblich("drop function if exists public.shop_offers();", e)).toBe(true);
    expect(rechtErheblich("drop table public.skylanders cascade;", e)).toBe(true);
  });

  it("aber NICHT eine gewoehnliche Migration", () => {
    /*
     * Waere jede Migration rechtserheblich, muesste nach jeder eine
     * Staging-Messung erfolgen — ein Riegel, der so laut ist, dass er
     * abgeschaltet wird. Ein `grant` an die Clientrollen beruehrt den
     * Pruefzugang nicht, und ein `revoke ... from public` auch nicht: seine
     * Erteilung ist ausdruecklich.
     */
    expect(rechtErheblich("create table public.neu (a int);", e)).toBe(false);
    expect(rechtErheblich("grant select on public.neu to authenticated;", e)).toBe(false);
    expect(rechtErheblich("revoke all on public.neu from public, anon;", e)).toBe(false);
    expect(rechtErheblich("drop function public.gibt_es_nicht();", e)).toBe(false);
  });

  it("die echten Migrationen: genau zwei sind rechtserheblich", () => {
    const { erheblich } = abdruck();
    expect(erheblich).toEqual([
      "0007_shop_pricing_and_images.sql",
      "0139_accessory_sale_release.sql",
    ]);
  });
});


describe("der Abdruck, an dem eine Messung veraltet", () => {
  it("ist stabil, solange nichts Rechtserhebliches sich aendert", () => {
    expect(abdruck().abdruck).toBe(abdruck().abdruck);
  });

  it("aendert sich, wenn die Einrichtungsdatei sich aendert", () => {
    const d = tmp();
    const setup = join(d, "setup.sql");
    writeFileSync(setup, readFileSync(SETUP, "utf8"), "utf8");
    const vorher = abdruck(MIG_DIR, setup).abdruck;
    writeFileSync(setup, `${readFileSync(SETUP, "utf8")}\n-- eine Zeile mehr\n`, "utf8");
    expect(abdruck(MIG_DIR, setup).abdruck).not.toBe(vorher);
    aufraeumen();
  });

  it("aendert sich, wenn eine RECHTSERHEBLICHE Migration sich aendert", () => {
    const d = tmp();
    for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql"))) {
      writeFileSync(join(d, f), readFileSync(join(MIG_DIR, f), "utf8"), "utf8");
    }
    const vorher = abdruck(d).abdruck;
    const erheblich = "0139_accessory_sale_release.sql";
    writeFileSync(join(d, erheblich),
      `${readFileSync(join(d, erheblich), "utf8")}\n-- geaendert\n`, "utf8");
    expect(abdruck(d).abdruck).not.toBe(vorher);
    aufraeumen();
  });

  it("aber NICHT, wenn eine gewoehnliche Migration dazukommt", () => {
    /* Der Riegel muss leben koennen. */
    const d = tmp();
    for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql"))) {
      writeFileSync(join(d, f), readFileSync(join(MIG_DIR, f), "utf8"), "utf8");
    }
    const vorher = abdruck(d).abdruck;
    writeFileSync(join(d, "0147_etwas_harmloses.sql"),
      "create table public.harmlos (a int);\ngrant select on public.harmlos to authenticated;\n",
      "utf8");
    expect(abdruck(d).abdruck).toBe(vorher);
    aufraeumen();
  });
});


describe("die Momentaufnahme", () => {
  it("die echte liegt vor, ist aktuell und nennt das Projekt", () => {
    const u = ladeAufnahme();
    expect(u.ok, u.ok ? "" : u.grund).toBe(true);
    if (!u.ok) return;
    expect(u.aufnahme.projekt).toBe("qqxcpesbwfxzgytkdsac");
    expect(u.aufnahme.rolle).toBe("skyisles_agent");
    expect(u.aufnahme.abdruck).toBe(abdruck().abdruck);
  });

  it("sie ist widerspruchsfrei: jede Abweichung hat ihre Messung", () => {
    /*
     * KEIN ZUSTAND WIRD HIER FESTGESCHRIEBEN — und das ist Absicht.
     *
     * Am 2026-10-25 fehlte `execute` auf `shop_offers()`; die Erteilung wird
     * von Hand wiederhergestellt. Eine Pruefung, die „shop_offers fehlt"
     * behauptet, waere danach rot und muesste genau in dem Moment angefasst
     * werden, in dem etwas BESSER geworden ist. Das ist die falsche Sorte
     * Test.
     *
     * Gefragt wird stattdessen, dass Messung und Abweichungsliste
     * zusammenpassen: eine Erwartung aus der Einrichtungsdatei steht genau
     * dann in `abweichungen`, wenn die Messung sie nicht bestaetigt.
     */
    const u = ladeAufnahme();
    if (!u.ok) return;
    const text = u.aufnahme.abweichungen.join("\n");

    for (const f of erwartung().funktionen) {
      const gemessen = Object.entries(u.aufnahme.funktionen).find(
        ([sig]) => sig.replace(/\s+/g, "") === f.replace(/\s+/g, ""));
      expect(gemessen, `${f} ist nicht gemessen worden`).toBeDefined();
      if (gemessen === undefined) continue;
      const name = f.replace(/^public\./, "").replace(/\(.*$/, "");
      expect(text.includes(name), `${f}: execute=${gemessen[1].execute}, `
        + `in abweichungen=${text.includes(name)}`).toBe(!gemessen[1].execute);
    }
    for (const t of erwartung().tabellen) {
      expect(u.aufnahme.tabellen[t], t).toBe(true);
      expect(text).not.toContain(`public.${t}:`);
    }
  });

  it("und die Abweichung, wenn es eine gibt, nennt die Ursache", () => {
    /* `DROP`+`CREATE` verwirft die ACL — wer die Meldung liest, soll nicht
       suchen muessen. */
    const u = ladeAufnahme();
    if (!u.ok || u.aufnahme.abweichungen.length === 0) return;
    expect(u.aufnahme.abweichungen.join(" ")).toContain("drop function");
  });

  it("die zwoelf Tabellenrechte stehen alle", () => {
    const u = ladeAufnahme();
    if (!u.ok) return;
    for (const t of erwartung().tabellen) {
      expect(u.aufnahme.tabellen[t], t).toBe(true);
    }
    /* Und was NICHT erteilt ist, steht als `false` darin — die Negativfaelle
       sind die, die ein Probelauf nachbilden muss. */
    expect(u.aufnahme.tabellen["offer_state"]).toBe(false);
    expect(u.aufnahme.tabellen["offer_state_live"]).toBe(false);
    expect(u.aufnahme.tabellen["favorites"]).toBe(false);
    expect(u.aufnahme.funktionen["public.offer_state_window()"]?.execute).toBe(false);
  });

  it("sie haelt die Rollenmitgliedschaft fest, die die Doku bestritt", () => {
    /*
     * `postgres` IST Mitglied von `skyisles_agent` — gemessen. Der
     * Zugangsplan behauptete „keine, in keiner Richtung". Harmlos (postgres
     * ist Superuser und koennte die Rolle ohnehin annehmen, und die Richtung
     * ist nicht umkehrbar), aber eine falsche Aussage.
     */
    const u = ladeAufnahme();
    if (!u.ok) return;
    expect(u.aufnahme.mitgliedschaften.hatAlsMitglied).toContain("postgres");
    expect(u.aufnahme.mitgliedschaften.istMitgliedVon).toEqual([]);
  });

  it("eine FEHLENDE Aufnahme gilt nicht als gueltig", () => {
    const d = tmp();
    const u = ladeAufnahme(join(d, "gibt-es-nicht.json"));
    expect(u.ok).toBe(false);
    if (u.ok) return;
    expect(u.grund).toContain("db:privileges:staging");
    aufraeumen();
  });

  it("eine VERALTETE Aufnahme gilt nicht als gueltig", () => {
    /*
     * DIE ZENTRALE ZUSAGE DIESES ABSCHNITTS. Eine Messung von vor der
     * letzten rechtserheblichen Migration sagt nichts ueber heute — sie
     * darf nicht stillschweigend weitergelten.
     */
    const d = tmp();
    const pfad = join(d, "alt.json");
    const echt = JSON.parse(readFileSync(AUFNAHME, "utf8")) as { abdruck: string };
    writeFileSync(pfad, JSON.stringify({ ...echt, abdruck: "f".repeat(64) }), "utf8");
    const u = ladeAufnahme(pfad);
    expect(u.ok).toBe(false);
    if (u.ok) return;
    expect(u.veraltet).toBe(true);
    expect(u.grund).toContain("VERALTET");
    expect(u.grund).toContain("db:privileges:staging");
    aufraeumen();
  });

  it("und kaputtes JSON auch nicht", () => {
    const d = tmp();
    writeFileSync(join(d, "kaputt.json"), "{ nicht json", "utf8");
    const u = ladeAufnahme(join(d, "kaputt.json"));
    expect(u.ok).toBe(false);
    if (!u.ok) expect(u.veraltet).toBe(false);
    aufraeumen();
  });
});


/* ==========================================================================
 * DER WAECHTER GEGEN DROP + CREATE
 * ========================================================================== */

/**
 * Die zwei Stellen, an denen eine Migration ein erteiltes Objekt verwirft.
 *
 * Beide sind angewendet und nach Regel 1 eingefroren — sie werden nicht
 * nachtraeglich geaendert. Sie stehen hier mit Begruendung, damit eine DRITTE
 * Stelle auffaellt.
 */
const BEKANNT: Record<string, string> = {
  "0007_shop_pricing_and_images.sql":
    "liegt vor der Einrichtung des Pruefzugangs (2026-10-19) — es gab keine "
    + "Erteilung, die verloren gehen konnte",
  "0139_accessory_sale_release.sql":
    "DER VORFALL: am 2026-10-20 angewendet, legt `shop_offers()` mit "
    + "`drop function` neu an und erteilt sie dem Pruefzugang nicht wieder. "
    + "Die Erteilung wird von Hand wiederhergestellt; gemessen wird sie in "
    + "`supabase/privileges/staging-agent.json`",
};

describe("eine Migration darf keine Erteilung stillschweigend verlieren", () => {
  const e = erwartung();
  const namen = new Set([
    ...e.tabellen,
    ...e.funktionen.map((f) => f.replace(/^public\./, "").replace(/\(.*$/, "")),
  ]);

  /** Verwirft diese Migration ein erteiltes Objekt, ohne es neu zu erteilen? */
  const verliert = (text: string): string[] => {
    const funde: string[] = [];
    for (const m of text.matchAll(
      /drop\s+(function|table|view|materialized view)\s+(?:if exists\s+)?public\.(\w+)/gi)) {
      const name = m[2];
      if (!namen.has(name)) continue;
      const neu = new RegExp(
        `grant\\s+\\w+\\s+on\\s+(?:function\\s+|table\\s+)?public\\.${name}\\b[^;]*skyisles_agent`,
        "i");
      if (!neu.test(text)) funde.push(name);
    }
    return [...new Set(funde)];
  };

  it("keine Migration ausser den bekannten zwei", () => {
    /*
     * `DROP FUNCTION` + `CREATE FUNCTION` verwirft die ACL; `CREATE OR
     * REPLACE FUNCTION` behaelt sie. Dasselbe gilt fuer Tabellen und
     * Sichten. Wer also ein erteiltes Objekt neu anlegen MUSS (etwa weil
     * sich der Rueckgabetyp aendert, wie bei `0139`), muss die Erteilung in
     * derselben Migration wiederherstellen — sonst merkt es niemand, bis
     * ein Lauf mit `permission denied` abbricht.
     */
    const funde: string[] = [];
    for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql")).sort()) {
      const verloren = verliert(readFileSync(join(MIG_DIR, f), "utf8"));
      if (verloren.length === 0) continue;
      if (f in BEKANNT) continue;
      funde.push(`${f}: ${verloren.join(", ")}`);
    }
    expect(funde, "verwirft eine Erteilung ohne Neuerteilung").toEqual([]);
  });

  it("und die bekannten zwei sind noch genau die bekannten zwei", () => {
    /* Verschwindet eine, ist die Ausnahme zu streichen — eine Ausnahme ohne
       Fall ist eine Einladung. */
    const treffer = readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql"))
      .filter((f) => verliert(readFileSync(join(MIG_DIR, f), "utf8")).length > 0).sort();
    expect(treffer).toEqual(Object.keys(BEKANNT).sort());
  });

  it("jede Ausnahme nennt einen Grund", () => {
    for (const [f, grund] of Object.entries(BEKANNT)) {
      expect(grund.length, f).toBeGreaterThan(40);
    }
  });

  describe("Gegenproben — er findet den Fall und erfindet keinen", () => {
    it("drop + create ohne Neuerteilung → gefunden", () => {
      expect(verliert(
        "drop function if exists public.shop_offers();\n"
        + "create function public.shop_offers() returns table (a int) language sql as 'select 1';"
      )).toEqual(["shop_offers"]);
    });

    it("drop + create MIT Neuerteilung → nicht gefunden", () => {
      expect(verliert(
        "drop function if exists public.shop_offers();\n"
        + "create function public.shop_offers() returns table (a int) language sql as 'select 1';\n"
        + "grant execute on function public.shop_offers() to skyisles_agent;"
      )).toEqual([]);
    });

    it("`create or replace` ohne drop → nicht gefunden, die ACL bleibt", () => {
      expect(verliert(
        "create or replace function public.shop_offers() returns table (a int) "
        + "language sql as 'select 1';")).toEqual([]);
    });

    it("eine verworfene Tabelle, die erteilt ist → gefunden", () => {
      expect(verliert("drop table public.shop_inventory cascade;")).toEqual(["shop_inventory"]);
    });

    it("ein verworfenes Objekt, das NICHT erteilt ist → nicht gefunden", () => {
      expect(verliert("drop table public.offer_state;")).toEqual([]);
      expect(verliert("drop function public.offer_state_window();")).toEqual([]);
    });
  });
});


describe("die Dokumentation sagt die Wahrheit ueber die Mitgliedschaft", () => {
  it("der Zugangsplan behauptet nicht mehr `keine Mitgliedschaften`", () => {
    /*
     * Gemessen: `postgres` ist Mitglied von `skyisles_agent` (ein Artefakt
     * von PostgreSQL 16+, wo `CREATE ROLE` den Erzeuger als Mitglied mit
     * ADMIN OPTION eintraegt). Die alte Aussage war falsch.
     */
    const plan = readFileSync("supabase/checks/staging_agent_access_plan.md", "utf8");
    expect(plan).not.toContain("**keine**, in keiner Richtung");
    expect(plan).toContain("postgres");
  });

  it("und `docs/SECURITY.md` nennt die Richtung", () => {
    const sec = readFileSync("docs/SECURITY.md", "utf8");
    expect(sec).toMatch(/postgres[^\n]*Mitglied/);
  });
});


/* ==========================================================================
 * INFORMATION_SCHEMA IST RECHTEGEFILTERT — pg_catalog NICHT
 * ==========================================================================
 *
 * DER VIERTE FEHLSCHLAG bei `0146`: Pruefung 102 meldete „(keine Tabelle)"
 * statt der acht Spalten, obwohl die Tabelle mit allen acht dasteht.
 * `information_schema` zeigt nur Objekte, auf die die aufrufende Rolle
 * irgendein Recht hat.
 *
 * DAS LAUTE WAR NICHT DAS SCHLIMME. An Staging nachgemessen:
 *
 *   public.skylanders, Erteilungen an anon/authenticated
 *     information_schema.role_table_grants  →  0      (fuer den Pruefzugang)
 *     aclexplode(pg_class.relacl)           →  4
 *
 * Eine Zeile „keine Grants fuer anon — erwartet 0" war damit GRUEN, ohne
 * hingesehen zu haben. Ein falsches Gruen auf einer Sicherheitsfrage, und
 * zwar lautlos.
 */

describe("die Rechtefilterung von information_schema, an echtem PostgreSQL", () => {
  /**
   * EINE PGlite-Instanz fuer alle Pruefungen dieses Blocks.
   *
   * Je Pruefung eine eigene aufzubauen hat im vollen Lauf die Zeitgrenze
   * gerissen (ueber fuenf Sekunden pro Instanz, wenn alle Dateien parallel
   * laufen). Stattdessen: ein Aufbau, und jede Pruefung arbeitet in einer
   * Transaktion, die zurueckgerollt wird — DDL ist in PostgreSQL
   * transaktional, also bleibt auch ein `drop column` nicht zurueck.
   *
   * Die Lage ist die von Staging im Kleinen: eine Tabelle, auf die der
   * Pruefzugang kein Recht hat, auf der aber eine Clientrolle zwei Rechte
   * hat. `anon` gibt es in PGlite nicht von sich aus — die Rolle wird
   * angelegt und spielt sie.
   */
  let db: Awaited<ReturnType<typeof neuePglite>>;

  const neuePglite = async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    return new PGlite();
  };

  beforeAll(async () => {
    db = await neuePglite();
    await db.exec(`
      create table public.geschuetzt (sky_id text, buyable boolean, cents integer);
      create table public.offen (a int);
      create role pruefer nologin;
      create role anon nologin;
      grant usage on schema public to pruefer;
      grant select on table public.offen to pruefer;
      grant select, insert on table public.geschuetzt to anon;
    `);
  }, 30_000);

  /** Eine Abfrage als Pruefzugang, in einer Transaktion, die zurueckgerollt wird. */
  const alsPruefer = async (sql: string, vorher = ""): Promise<string> => {
    await db.exec("begin;");
    try {
      if (vorher) await db.exec(vorher);
      await db.exec("set local role pruefer;");
      const r = await db.query<{ x: string | null }>(sql);
      return String(r.rows[0]?.x);
    } finally { await db.exec("rollback;"); }
  };

  /** Dasselbe als Eigner. */
  const alsEigner = async (sql: string, vorher = ""): Promise<string> => {
    await db.exec("begin;");
    try {
      if (vorher) await db.exec(vorher);
      const r = await db.query<{ x: string | null }>(sql);
      return String(r.rows[0]?.x);
    } finally { await db.exec("rollback;"); }
  };

  const SPALTEN = (tabelle: string) =>
    `select coalesce((select string_agg(a.attname, ',' order by a.attnum)
                        from pg_attribute a
                       where a.attrelid = to_regclass('public.${tabelle}')
                         and a.attnum > 0 and not a.attisdropped),
                     '(keine Tabelle)') as x`;

  it("information_schema VERSTECKT die Spalten — der gemeldete Fehler", async () => {
    const sql = `select coalesce((select string_agg(column_name, ',' order by ordinal_position)
                                    from information_schema.columns
                                   where table_schema = 'public'
                                     and table_name = 'geschuetzt'),
                                 '(keine Tabelle)') as x`;
    expect(await alsEigner(sql)).toBe("sky_id,buyable,cents");
    expect(await alsPruefer(sql)).toBe("(keine Tabelle)");
  });

  it("pg_attribute zeigt sie — auch ohne jedes Recht", async () => {
    expect(await alsEigner(SPALTEN("geschuetzt"))).toBe("sky_id,buyable,cents");
    expect(await alsPruefer(SPALTEN("geschuetzt"))).toBe("sky_id,buyable,cents");
  });

  it("und eine ECHTE Strukturabweichung wird weiter erkannt", async () => {
    /*
     * DER PUNKT, AN DEM EINE BEHEBUNG KIPPEN KANN: eine Pruefung, die
     * fehlende Rechte ueberlebt, aber auch eine fehlende Tabelle oder eine
     * fehlende Spalte durchlaesst, waere wertlos.
     */
    expect(await alsPruefer(SPALTEN("gibt_es_nicht"))).toBe("(keine Tabelle)");
    expect(await alsPruefer(SPALTEN("geschuetzt"),
      "alter table public.geschuetzt drop column cents;")).toBe("sky_id,buyable");
    expect(await alsPruefer(SPALTEN("geschuetzt"),
      "alter table public.geschuetzt add column spaeter text;"))
      .toBe("sky_id,buyable,cents,spaeter");
    /* Und nach dem Zurueckrollen ist alles wie vorher. */
    expect(await alsPruefer(SPALTEN("geschuetzt"))).toBe("sky_id,buyable,cents");
  });

  const GRANTS = (tabelle: string, quelle: "is" | "acl") => quelle === "is"
    ? `select (select count(*)::text from information_schema.role_table_grants
                where table_schema = 'public' and table_name = '${tabelle}'
                  and grantee = 'anon') as x`
    : `select (select count(*)::text from pg_class c, aclexplode(c.relacl) a
                where c.oid = to_regclass('public.${tabelle}')
                  and a.grantee::regrole::text = 'anon') as x`;

  it("role_table_grants liefert 0, wo wirklich Rechte stehen — DAS STILLE GRUEN",
     async () => {
    /* `anon` hat zwei Rechte — der Eigner sieht sie, der Pruefzugang nicht. */
    expect(await alsEigner(GRANTS("geschuetzt", "is"))).toBe("2");
    expect(await alsPruefer(GRANTS("geschuetzt", "is"))).toBe("0");
  });

  it("aclexplode(relacl) sieht sie — fuer jede Rolle gleich", async () => {
    expect(await alsEigner(GRANTS("geschuetzt", "acl"))).toBe("2");
    expect(await alsPruefer(GRANTS("geschuetzt", "acl"))).toBe("2");
  });

  it("und ein neu erteiltes Recht faellt dem Pruefzugang auf", async () => {
    /* Die Sicherheitsfrage muss BEANTWORTBAR bleiben, nicht nur ungefaehrlich. */
    expect(await alsPruefer(GRANTS("offen", "acl"))).toBe("0");
    expect(await alsPruefer(GRANTS("offen", "acl"),
      "grant select on table public.offen to anon;")).toBe("1");
  });

  it("beide Filter sind tragend: attnum > 0 UND not attisdropped", async () => {
    /*
     * EINE MUTATIONSPROBE HAT GEZEIGT, DASS DIESE PRUEFUNG FEHLTE: `attnum >
     * 0` aus der Pruefdatei zu entfernen liess alle Tests gruen, weil keiner
     * die Form AUS DER DATEI fuhr. Hier steht jetzt, was ohne die Filter
     * passiert.
     */
    const ohne = (filter: string) =>
      `select string_agg(a.attname, ',' order by a.attnum) as x from pg_attribute a
        where a.attrelid = to_regclass('public.mitLuecke') ${filter}`;
    const vorher = "create table public.mitLuecke (a int, weg int, b int);"
      + " alter table public.mitLuecke drop column weg;";

    expect(await alsPruefer(ohne("and a.attnum > 0 and not a.attisdropped"), vorher))
      .toBe("a,b");
    /* Ohne `attisdropped`: die verworfene Spalte erscheint als Platzhalter. */
    expect(await alsPruefer(ohne("and a.attnum > 0"), vorher))
      .toContain("pg.dropped");
    /* Ohne `attnum > 0`: die Systemspalten erscheinen. */
    expect(await alsPruefer(ohne("and not a.attisdropped"), vorher))
      .toContain("tableoid");
  });

  it("und jede Spaltenabfrage der Familie traegt beide Filter", () => {
    /* Der statische Teil derselben Zusage — damit die Mutation auffaellt. */
    const funde: string[] = [];
    for (const nr of ["0142", "0143", "0144", "0145", "0146", "0147"]) {
      for (const art of ["preflight", "postflight"]) {
        const datei = `${nr}_${art}.sql`;
        const text = readFileSync(join("supabase/checks", datei), "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, " ")
          .replace(/^\s*--.*$/gm, " ");
        /*
         * Ein FENSTER nach jeder `from pg_attribute`-Stelle, keine Klammer:
         * `format_type(a.atttypid, a.atttypmod)` enthaelt selbst Klammern,
         * und die erste schnitt das Fragment vor den Filtern ab — die erste
         * Fassung dieses Tests meldete deshalb zwoelf Fehlalarme.
         */
        for (const m of text.matchAll(/from pg_attribute a/g)) {
          const fragment = text.slice(m.index, m.index + 400);
          if (!/attnum\s*>\s*0/.test(fragment)) funde.push(`${datei}: attnum-Filter fehlt`);
          if (!/not\s+a\.attisdropped/.test(fragment)) {
            funde.push(`${datei}: attisdropped-Filter fehlt`);
          }
        }
      }
    }
    expect(funde).toEqual([]);
  });

  it("ein leeres relacl heisst bei TABELLEN wirklich `kein Recht`", async () => {
    /*
     * Anders als bei Funktionen, wo NULL `EXECUTE TO PUBLIC` bedeutet (die
     * Falle in den Zeilen 136/141). Bei einer Tabelle ist der Standard: nur
     * der Eigner. `aclexplode(NULL)` liefert 0 Zeilen, und das ist hier die
     * richtige Antwort.
     */
    const acl = await alsEigner(
      "select coalesce(relacl::text, 'NULL') as x from pg_class "
      + "where oid = to_regclass('public.frisch')",
      "create table public.frisch (a int);");
    expect(acl).toBe("NULL");
    expect(await alsPruefer(
      `select (select count(*)::text from pg_class c, aclexplode(c.relacl) a
                where c.oid = to_regclass('public.frisch')) as x`,
      "create table public.frisch (a int);")).toBe("0");
  });
});


describe("keine Runner-Pruefdatei benutzt information_schema", () => {
  /** Code ohne Kommentare — der Hinweis darauf darf dastehen. */
  const ohneKommentare = (sql: string): string => sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*--.*$/gm, " ");

  it("die Dateien aus migration-plans.json sind frei davon", () => {
    /*
     * DER STRUKTURELLE RIEGEL. `information_schema` ist rechtegefiltert;
     * unter dem Pruefzugang liefert es entweder einen lauten Fehlalarm oder
     * — schlimmer — ein stilles Gruen. Wer eine neue Migration schreibt,
     * soll das hier erfahren und nicht im Lauf.
     *
     * `pg_policies` und `pg_views` sind davon NICHT betroffen (an Staging
     * nachgemessen: 3 Richtlinien bzw. die Sichtdefinition sichtbar) und
     * bleiben erlaubt.
     */
    const plaene = JSON.parse(readFileSync(
      "supabase/checks/migration-plans.json", "utf8")) as
      { migrationen: Record<string, { preflight: string; postflight: string }> };
    const funde: string[] = [];
    for (const [nummer, plan] of Object.entries(plaene.migrationen)) {
      for (const datei of [plan.preflight, plan.postflight]) {
        const code = ohneKommentare(
          readFileSync(join("supabase/checks", datei), "utf8"));
        for (const m of code.matchAll(/information_schema\.(\w+)/g)) {
          funde.push(`${nummer} ${datei}: information_schema.${m[1]}`);
        }
      }
    }
    expect(funde, "rechtegefilterte Sicht in einer Runner-Pruefdatei").toEqual([]);
  });

  it("und die ganze Basis-Vertrags-Familie 0142–0147 auch", () => {
    /* Sie sind die naechsten Kandidaten fuer den Runner und teilen einen
       Vertrag — also dieselbe Regel. */
    const funde: string[] = [];
    for (const nr of ["0142", "0143", "0144", "0145", "0146", "0147"]) {
      for (const art of ["preflight", "postflight"]) {
        const datei = `${nr}_${art}.sql`;
        const code = ohneKommentare(
          readFileSync(join("supabase/checks", datei), "utf8"));
        for (const m of code.matchAll(/information_schema\.(\w+)/g)) {
          funde.push(`${datei}: information_schema.${m[1]}`);
        }
      }
    }
    expect(funde).toEqual([]);
  });

  it("der Riegel erkennt einen Rueckfall wirklich", () => {
    /* Ein Waechter, der nie etwas findet, ist kein Waechter. */
    const finde = (sql: string) =>
      [...ohneKommentare(sql).matchAll(/information_schema\.(\w+)/g)].map((m) => m[1]);
    expect(finde("select * from information_schema.columns")).toEqual(["columns"]);
    expect(finde("select * from information_schema.role_table_grants"))
      .toEqual(["role_table_grants"]);
    /* Im Kommentar erklaert — das ist erlaubt und soll dastehen. */
    expect(finde("-- information_schema.columns ist rechtegefiltert\nselect 1")).toEqual([]);
    expect(finde("/* nicht information_schema.tables benutzen */ select 1")).toEqual([]);
    /* Und die erlaubten Katalogsichten sind kein Fund. */
    expect(finde("select * from pg_policies, pg_views, pg_attribute")).toEqual([]);
  });

  it("die aelteren Dateien sind bekannt und nicht im Runner", () => {
    /*
     * `0139`–`0141` und `production_baseline_drift.sql` benutzen
     * `role_table_grants` weiterhin. Sie laufen im SQL-Editor als
     * `postgres`, wo nicht gefiltert wird — dort ist die Aussage richtig.
     * Kommt eine davon je in `migration-plans.json`, schlaegt der Riegel
     * oben an, und dann ist sie umzustellen. Hier steht nur, dass sie es
     * heute NICHT sind.
     */
    const plaene = JSON.parse(readFileSync(
      "supabase/checks/migration-plans.json", "utf8")) as
      { migrationen: Record<string, unknown> };
    for (const nr of ["0139", "0140", "0141"]) {
      expect(Object.keys(plaene.migrationen)).not.toContain(nr);
    }
  });
});
