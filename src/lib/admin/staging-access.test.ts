/**
 * Phase A: der lesende Staging-Zugang — jede Verweigerung und der ganze Lauf.
 *
 * WARUM DIESE DATEI DEN LAUF WIRKLICH FÄHRT. Eine Automatisierung, deren
 * Ablauf erst beim ersten echten Lauf gegen Staging geprüft wird, ist keine.
 * Der Block „der ganze Lauf" hängt denselben Code, der später gegen Staging
 * arbeitet, an **PGlite** — PostgreSQL als WebAssembly, ohne Zugangsdaten,
 * ohne Netz. Geprüft wird damit das Verhalten: der Vertrag kommt in derselben
 * Transaktion an, Zeile 9999 wird gelesen, eine Abweichung wird erkannt, eine
 * nicht erfüllte Vorbedingung führt zum Überspringen statt zum Fehler.
 *
 * WAS DIESE DATEI NICHT PRÜFT: ob die Rechte auf Staging stimmen. Das zeigt
 * erst der erste Lauf; `supabase/operations/staging-agent-setup.sql` prüft es
 * in seinem Abschnitt 3 selbst nach.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import {
  ERWARTETER_STEMPEL, LESE_ROLLE, PRODUCTION_REF, STAGING_REF,
  pruefeSitzung, pruefeVerbindung, redigiere, type DbZugang, type Zeile,
} from "../../../tools/lib/staging-db.mts";
import {
  bericht, fahreEintrag, fahreSuite, ladeSuite, protokoll, type SuiteEintrag,
} from "../../../tools/db-check-staging.mts";
import { bewerte } from "../../../tools/env-audit.mts";

/* ==========================================================================
 * 1. Riegel 1 — die Verbindungszeichenkette
 * ======================================================================== */

describe("pruefeVerbindung lässt nur den lesenden Staging-Zugang durch", () => {
  /*
   * `sslmode=verify-full` AUSGESCHRIEBEN — seit dem 2026-10-25 die einzige
   * zugelassene Form (ADR-0138). `require` war bis dahin erlaubt; in `pg`
   * 8.23 ist es noch ein Alias fuer Vollpruefung, ab `pg` v9 bekommt es
   * libpq-Semantik und pruefte das Zertifikat nicht mehr.
   */
  const POOLER = `postgresql://${LESE_ROLLE}.${STAGING_REF}:gEhEim123@`
    + "aws-0-eu-central-1.pooler.supabase.com:5432/postgres?sslmode=verify-full";
  const DIREKT = `postgresql://${LESE_ROLLE}:gEhEim123@db.${STAGING_REF}.supabase.co`
    + ":5432/postgres?sslmode=verify-full";

  it("die Session-Pooler-Form, wie Supabase sie ausgibt", () => {
    const u = pruefeVerbindung(POOLER);
    expect(u.ok).toBe(true);
    if (u.ok) {
      expect(u.benutzer).toBe(`${LESE_ROLLE}.${STAGING_REF}`);
      expect(u.port).toBe("5432");
      expect(u.sslmode).toBe("verify-full");
    }
  });

  it("und die direkte Form", () => {
    const u = pruefeVerbindung(DIREKT);
    expect(u.ok).toBe(true);
    if (u.ok) expect(u.benutzer).toBe(LESE_ROLLE);
  });

  it("am Pooler MUSS der Benutzer rolle.projektkennung lauten", () => {
    /*
     * Supavisor liest den Benutzernamen als `rolle.tenant`. Ohne die Kennung
     * wählt die Verbindung kein Projekt — und mit einer anderen Rolle ist es
     * nicht Phase A. Beide Fälle sind Verweigerungen, keine Warnungen.
     */
    for (const benutzer of [LESE_ROLLE, `${LESE_ROLLE}.`, "postgres",
                            `postgres.${STAGING_REF}`, `${LESE_ROLLE}_x.${STAGING_REF}`]) {
      const u = pruefeVerbindung(POOLER.replace(`${LESE_ROLLE}.${STAGING_REF}`, benutzer));
      expect(u.ok, benutzer).toBe(false);
    }
  });

  it("die Production-Kennung IRGENDWO ist eine Verweigerung", () => {
    for (const url of [
      POOLER.replace(STAGING_REF, PRODUCTION_REF),
      DIREKT.replace(STAGING_REF, PRODUCTION_REF),
      `${POOLER}&options=-c%20${PRODUCTION_REF}`,
    ]) {
      const u = pruefeVerbindung(url);
      expect(u.ok, url).toBe(false);
      if (!u.ok) expect(u.grund).toContain(PRODUCTION_REF);
    }
  });

  it("ein fremder Host ist eine Verweigerung, auch mit richtiger Kennung", () => {
    const u = pruefeVerbindung(POOLER.replace(
      "aws-0-eu-central-1.pooler.supabase.com", "boeser-host.example.com"));
    expect(u.ok).toBe(false);
    if (!u.ok) expect(u.grund).toContain("zugelassenen");
  });

  it("der Transaktions-Pooler auf 6543 ist eine Verweigerung", () => {
    const u = pruefeVerbindung(POOLER.replace(":5432/", ":6543/"));
    expect(u.ok).toBe(false);
    if (!u.ok) expect(u.grund).toContain("6543");
  });

  it("eine andere Datenbank als postgres ist eine Verweigerung", () => {
    const u = pruefeVerbindung(POOLER.replace("/postgres?", "/irgendwas?"));
    expect(u.ok).toBe(false);
    if (!u.ok) expect(u.grund).toContain("postgres");
  });

  it("OHNE sslmode wird abgelehnt — sonst verbindet pg unverschlüsselt", () => {
    const u = pruefeVerbindung(POOLER.replace("?sslmode=verify-full", ""));
    expect(u.ok).toBe(false);
    if (!u.ok) expect(u.grund).toContain("sslmode");
  });

  it("und jede Form AUSSER verify-full wird abgelehnt", () => {
    /*
     * Auch `require`, `prefer` und `verify-ca`: heute sind sie Aliasse fuer
     * Vollpruefung, ab `pg` v9 nicht mehr. Die ganze Begruendung steht in
     * `staging-tls.test.ts`.
     */
    for (const modus of ["disable", "prefer", "allow", "require", "verify-ca",
                         "no-verify"]) {
      expect(pruefeVerbindung(POOLER.replace("sslmode=verify-full", `sslmode=${modus}`)).ok,
             modus).toBe(false);
    }
  });

  it("ein `#` im Passwort wird abgelehnt, mit Anleitung", () => {
    /*
     * DER FALL, DER DEN RIEGEL SONST UNBEMERKT PASSIERT.
     *
     * `new URL` schneidet am `#` und liest ein Passwort `ge` mit leerem Host;
     * `pg` scheitert mit `Invalid URL`. Zwei Leser, zwei Ergebnisse — deshalb
     * prüft der Riegel den Rohtext, bevor ein Parser ihn anfasst.
     */
    const u = pruefeVerbindung(POOLER.replace("gEhEim123", "ge#heim"));
    expect(u.ok).toBe(false);
    if (!u.ok) expect(u.grund).toContain("%23");
    /* Prozentkodiert ist in Ordnung. */
    expect(pruefeVerbindung(POOLER.replace("gEhEim123", "ge%23heim")).ok).toBe(true);
  });

  it("`:` und `@` im Passwort sind KEIN Fehler — beide Leser stimmen überein", () => {
    /*
     * Nachgemessen: `new URL` kodiert sie zu `%3A`/`%40`, und
     * `pg-connection-string` liest in beiden Formen dasselbe Passwort. Eine
     * Verweigerung hier wäre ein Fehlalarm — und ein Riegel, der Richtiges
     * ablehnt, wird umgangen.
     */
    expect(pruefeVerbindung(POOLER.replace("gEhEim123", "ge:he@im")).ok).toBe(true);
  });

  it("Leerraum in der Zeichenkette wird abgelehnt", () => {
    expect(pruefeVerbindung(POOLER.replace("gEhEim123", "ge heim")).ok).toBe(false);
  });

  it("ohne Passwort wird abgelehnt", () => {
    const u = pruefeVerbindung(POOLER.replace(":gEhEim123@", "@"));
    expect(u.ok).toBe(false);
  });

  it("kein Projekt, keine URL, nichts gesetzt — jeweils Verweigerung", () => {
    for (const roh of [
      undefined, "", "   ",
      "postgresql://x:y@localhost:5432/postgres?sslmode=require",
      "mysql://a:b@c:5432/d",
      "kein-url",
    ]) {
      expect(pruefeVerbindung(roh).ok, String(roh)).toBe(false);
    }
  });

  it("die Allowlist ist das Prinzip: ein unbekanntes Projekt wird abgelehnt", () => {
    const u = pruefeVerbindung(POOLER.replace(STAGING_REF, "abcdefghijklmnop"));
    expect(u.ok).toBe(false);
  });
});

/* ==========================================================================
 * 2. Riegel 2 und 4 — Stempel und Sitzung
 * ======================================================================== */

describe("pruefeSitzung schließt die Verbindung, wenn der Stempel nicht stimmt", () => {
  const gut = { stempel: ERWARTETER_STEMPEL, rolle: LESE_ROLLE, nur_lesend: "on" };

  it("der erwartete Fall", () => {
    expect(pruefeSitzung(gut).ok).toBe(true);
  });

  it("KEIN Stempel ist der Production-Fall und wird benannt", () => {
    const u = pruefeSitzung({ ...gut, stempel: null });
    expect(u.ok).toBe(false);
    if (!u.ok) expect(u.grund).toContain("Production");
  });

  it("ein fremder Stempel wird abgelehnt", () => {
    expect(pruefeSitzung({ ...gut, stempel: "skyisles-production" }).ok).toBe(false);
  });

  it("eine andere Rolle wird abgelehnt", () => {
    const u = pruefeSitzung({ ...gut, rolle: "postgres" });
    expect(u.ok).toBe(false);
    if (!u.ok) expect(u.grund).toContain("postgres");
  });

  it("eine nicht schreibgeschützte Sitzung wird abgelehnt", () => {
    const u = pruefeSitzung({ ...gut, nur_lesend: "off" });
    expect(u.ok).toBe(false);
    if (!u.ok) expect(u.grund).toContain("default_transaction_read_only");
  });

  it("keine Zeile wird abgelehnt", () => {
    expect(pruefeSitzung(undefined).ok).toBe(false);
  });
});

/* ==========================================================================
 * 3. Riegel 5 — nichts Geheimes in der Ausgabe
 * ======================================================================== */

describe("redigiere entfernt, was ein Geheimnis sein könnte", () => {
  it("das Passwort einer Verbindungszeichenkette", () => {
    const t = redigiere(
      `error: connect failed postgresql://skyisles_agent:S3hr-Geheim@host:5432/postgres`);
    expect(t).not.toContain("S3hr-Geheim");
    expect(t).toContain("***");
  });

  it("ein JSON Web Token", () => {
    /* Erfunden, und erkennbar so: der Rumpf sagt „BEISPIEL-KEIN-ECHTER-KEY".
       Ein Testwert, der wie ein echter Service-Role-Key aussieht, löst
       irgendwann einen Geheimnis-Scanner aus — und kostet jemandem einen
       Nachmittag für nichts. */
    const jwt = "eyJhbGciOiJub25lIn0.eyJCRUlTUElFTC1LRUlOLUVDSFRFUi1LRVkiOnRydWV9.Xxxx";
    expect(redigiere(`key=${jwt}`)).not.toContain(jwt);
    /* Auch ABGESCHNITTEN: eine Fehlermeldung kürzt gern, und ein halber
       Token ist genauso ein Geheimnis — Kopf und Rumpf nennen Rolle und
       Projekt. Zwei Zeichen Signatur, und ganz ohne. */
    expect(redigiere(`key=${jwt.slice(0, jwt.length - 2)}`)).toContain("***JWT***");
    expect(redigiere(`key=${jwt.slice(0, jwt.lastIndexOf("."))}`)).toContain("***JWT***");
    /* Und gewöhnlicher Text bleibt unberührt. */
    expect(redigiere("eyJ ist kein Token, und a.b.c auch nicht"))
      .toBe("eyJ ist kein Token, und a.b.c auch nicht");
  });

  it("einen Supabase-Schlüssel neuer Form", () => {
    expect(redigiere("sb_secret_abcdefgh12345678")).toContain("***KEY***");
  });

  it("eine Passwortzuweisung in jeder Schreibweise", () => {
    for (const t of ["password=hunter2", "PASSWORD: 'hunter2'", 'password = "hunter2"']) {
      expect(redigiere(t), t).not.toContain("hunter2");
    }
  });

  it("und lässt alles andere unberührt", () => {
    const text = "9999 = 0, 534 shopfaehig, md5 4d1d6c30fe0ae886ca2689bcb1fe9634";
    expect(redigiere(text)).toBe(text);
  });
});

/* ==========================================================================
 * 4. Die Suite ist mit den Dateien und der Rechteliste deckungsgleich
 * ======================================================================== */

describe("staging-suite.json", () => {
  const suite = ladeSuite();

  it("jede genannte Datei existiert und ist rein lesend", () => {
    for (const e of suite) {
      const sql = readFileSync(`supabase/checks/${e.datei}`, "utf8");
      const ohneProsa = sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");
      expect(ohneProsa, e.datei).not.toMatch(/^\s*(insert|update|delete|truncate|grant|revoke|alter|create|drop)\b/im);
      expect(ohneProsa, e.datei).not.toMatch(/\bdo\s+\$\$/i);
    }
  });

  it("jede Datei im Modus 9999 hat eine Zeile 9999, die Messung nicht", () => {
    for (const e of suite) {
      const sql = readFileSync(`supabase/checks/${e.datei}`, "utf8");
      if (e.modus === "9999") {
        expect(sql, e.datei).toMatch(/select\s+9999,/);
      } else {
        expect(sql, e.datei).not.toMatch(/select\s+9999,/);
      }
    }
  });

  it("jede Datei mit Vertrag kennt den Modusschalter", () => {
    for (const e of suite) {
      const sql = readFileSync(`supabase/checks/${e.datei}`, "utf8");
      if (e.vertrag === "staging") expect(sql, e.datei).toContain("skyisles.z0");
      else expect(sql, e.datei).not.toContain("skyisles.z0");
    }
  });

  it("die Rechteliste im Einrichtungsschritt ist die ausgezählte", () => {
    /*
     * DAS IST DER EIGENTLICHE WÄCHTER DIESER DATEI. Wächst die Suite um eine
     * Prüfdatei, die eine weitere Tabelle liest, fällt dieser Test — und
     * zwar LOKAL, nicht erst mit `42501` im Lauf gegen Staging.
     */
    const plan = execFileSync("python3", ["tools/lib/grant-plan.py", "--sql"],
                              { encoding: "utf8" });
    const erwartet = plan.split("\n").map((z) => z.trim()).filter((z) => z !== "");
    const setup = readFileSync("supabase/operations/staging-agent-setup.sql", "utf8");
    const imSetup = [...setup.matchAll(/^grant select on table (public\.[a-z_]+)\s+to\s+([a-z_]+);$/gm)]
      .map((m) => `grant select on table ${m[1]} to ${m[2]};`);
    const ohneLuecken = (l: string[]) =>
      [...l].map((z) => z.replace(/\s+/g, " ")).sort();
    expect(ohneLuecken(imSetup)).toEqual(ohneLuecken(erwartet));
    expect(imSetup.length).toBe(12);
  });

  it("und er erteilt genau drei EXECUTE-Rechte, keines auf einer Belegfunktion", () => {
    const setup = readFileSync("supabase/operations/staging-agent-setup.sql", "utf8");
    const exec = [...setup.matchAll(/^grant execute on function (public\.[a-z_]+)\(/gm)]
      .map((m) => m[1]);
    expect(exec.sort()).toEqual([
      "public.is_shop_eligible",
      "public.non_collectible_categories",
      "public.shop_offers",
    ]);
    expect(setup).not.toMatch(/grant execute on function public\.seller_issue/);
    const ohneProsa = setup.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");
    expect(ohneProsa).not.toMatch(/grant execute on all functions/);
    /* Prosafrei geprüft: der Kopf ERKLÄRT, dass kein pg_read_all_data erteilt
       wird — ein `not.toContain` über die ganze Datei fände die Erklärung. */
    expect(ohneProsa).not.toContain("pg_read_all_data");
  });

  it("der Einrichtungsschritt ändert die Belegsperre nicht — er liest sie", () => {
    const setup = readFileSync("supabase/operations/staging-agent-setup.sql", "utf8");
    const ohneProsa = setup.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");
    /* Kein `revoke` auf einer Belegfunktion, überhaupt kein `revoke execute`. */
    expect(ohneProsa).not.toMatch(/revoke\s+execute/i);
    expect(ohneProsa).not.toMatch(/revoke[^;]*seller_issue/i);
    /* Das eine erlaubte `revoke`: CREATE auf dem Schema, der neuen Rolle. */
    const revokes = [...ohneProsa.matchAll(/^revoke .*$/gm)].map((m) => m[0]);
    expect(revokes).toHaveLength(1);
    expect(revokes[0]).toContain("create on schema public from skyisles_agent");
    /* Und sie wird geprüft, für jede Rolle und für PUBLIC. */
    expect(setup).toContain("die bestehende Belegsperre ist nicht dicht");
    expect(setup).toContain("aclexplode");
  });
});

/* ==========================================================================
 * 5. Der ganze Lauf, gegen echtes PostgreSQL (PGlite, ohne Zugangsdaten)
 * ======================================================================== */

describe("der ganze Lauf — derselbe Code, nur gegen PGlite", () => {
  /**
   * EINE Instanz für den ganzen Block, nicht eine je Test.
   *
   * PGlite ist PostgreSQL als WebAssembly, und ein Start kostet eine knappe
   * Sekunde — unter der Last der übrigen 266 Testdateien auch mehr als die
   * fünf Sekunden, die eine Testvorgabe hat. Dreizehn Starts in einer Datei
   * waren deshalb nicht langsam, sondern zeitweise rot. Isolation braucht
   * hier keiner: alle Dateien unten sind lesend, und der eine Schreibfall
   * prüft selbst, dass nichts zurückbleibt.
   */
  let db: DbZugang;

  beforeAll(async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const pg = new PGlite();
    db = {
      async fuehre(sql: string): Promise<Zeile[][]> {
        const r = await pg.exec(sql);
        return r.map((x) => (x.rows ?? []) as Zeile[]);
      },
      async schliesse() { /* Wegwerf-Instanz */ },
      /* PGlite statt Pooler — keine TLS-Strecke, und das soll dastehen. */
      tls: "(PGlite, keine Netzverbindung)",
    };
    /* Aufwaermen: PGlite richtet seine Instanz erst bei der ersten Abfrage
       vollstaendig ein. Ohne diese Zeile fiel die Wartezeit auf den ERSTEN
       Test — und der hat fuenf Sekunden, dieser Haken sechzig. */
    await db.fuehre("select 1 as warm");
  }, 60_000);

  /** Eine winzige Prüfdatei in der Form, die dieses Projekt benutzt. */
  const pruefdatei = (zeilen: string[]) =>
    `-- Kopfkommentar, wie in jeder Prüfdatei\n\n` +
    `with pruef (nr, bereich, pruefung, befund, erwartet) as (values\n` +
    `  ${zeilen.join(",\n  ")}\n),\n` +
    `ergebnis as (\n` +
    `  select nr, bereich, pruefung, befund, erwartet,\n` +
    `         case when erwartet is null then null\n` +
    `              else befund is not distinct from erwartet end as ok\n` +
    `    from pruef\n)\n` +
    `select nr, bereich, pruefung, befund, erwartet, ok from ergebnis\n` +
    `union all\n` +
    `select 9999, 'GESAMT', 'blockierende Abweichungen (muss 0 sein)',\n` +
    `       (select count(*) from ergebnis where ok is false)::text, '0',\n` +
    `       (select count(*) from ergebnis where ok is false) = 0\n` +
    ` order by nr;\n`;

  const dir = mkdtempSync(join(tmpdir(), "skyisles-suite-"));
  writeFileSync(join(dir, "gut.sql"), pruefdatei([
    "(101, 'A', 'etwas stimmt', 'ja', 'ja')",
  ]));
  writeFileSync(join(dir, "schlecht.sql"), pruefdatei([
    "(101, 'A', 'etwas stimmt', 'ja', 'ja')",
    "(102, 'A', 'etwas stimmt NICHT', 'nein', 'ja')",
  ]));
  writeFileSync(join(dir, "vertrag.sql"), pruefdatei([
    "(101, 'Vertrag', 'der Modus ist angekommen', " +
      "coalesce(nullif(current_setting('skyisles.z0', true), ''), 'FEHLT'), 'staging')",
  ]));
  writeFileSync(join(dir, "messung.sql"),
    "-- Kopf\n\nselect 1 as nr, 'M' as bereich, 'nur gemessen' as pruefung,\n" +
    "       '42' as befund, null::text as erwartet, null::boolean as ok;\n");

  const eintrag = (datei: string, extra: Partial<SuiteEintrag> = {}): SuiteEintrag => ({
    datei, zweck: `Test ${datei}`, modus: "9999", ...extra,
  });

  it("eine grüne Datei wird als ok gelesen", async () => {
    const b = await fahreEintrag(db, eintrag("gut.sql"), dir);
    expect(b.status).toBe("ok");
    expect(b.abweichungen).toBe("0");
    expect(b.zeilen).toHaveLength(2);
  });

  it("eine Abweichung wird erkannt UND die auffällige Zeile benannt", async () => {
    const b = await fahreEintrag(db, eintrag("schlecht.sql"), dir);
    expect(b.status).toBe("abweichung");
    expect(b.abweichungen).toBe("1");
    expect(b.auffaellig).toHaveLength(1);
    expect(String(b.auffaellig[0].pruefung)).toContain("NICHT");
  });

  it("der Z0-Vertrag kommt in DERSELBEN Transaktion an", async () => {
    /* Genau der Punkt, an dem S1 von Hand gescheitert ist. */
    const mit = await fahreEintrag(db, eintrag("vertrag.sql", { vertrag: "staging" }), dir);
    expect(mit.status).toBe("ok");

    const ohne = await fahreEintrag(db, eintrag("vertrag.sql"), dir);
    expect(ohne.status).toBe("abweichung");
    expect(String(ohne.auffaellig[0].befund)).toBe("FEHLT");
  });

  it("und er gilt nur für die eine Transaktion — danach ist er fort", async () => {
    await fahreEintrag(db, eintrag("vertrag.sql", { vertrag: "staging" }), dir);
    const danach = await fahreEintrag(db, eintrag("vertrag.sql"), dir);
    expect(String(danach.auffaellig[0].befund)).toBe("FEHLT");
  });

  it("eine nicht erfüllte Vorbedingung überspringt, statt zu scheitern", async () => {
    const b = await fahreEintrag(db, eintrag("gut.sql", {
      wenn: { beschreibung: "nur wenn der Mond blau ist", sql: "select false as erfuellt" },
    }), dir);
    expect(b.status).toBe("uebersprungen");
    expect(b.grund).toContain("Mond");
    expect(b.zeilen).toHaveLength(0);
  });

  it("eine erfüllte Vorbedingung lässt die Datei laufen", async () => {
    const b = await fahreEintrag(db, eintrag("gut.sql", {
      wenn: { beschreibung: "immer", sql: "select true as erfuellt" },
    }), dir);
    expect(b.status).toBe("ok");
  });

  it("der Modus messung verlangt keine Zeile 9999", async () => {
    const b = await fahreEintrag(db, eintrag("messung.sql", { modus: "messung" }), dir);
    expect(b.status).toBe("ok");
    expect(b.abweichungen).toBeNull();
    expect(b.zeilen).toHaveLength(1);
  });

  it("fehlt im Modus 9999 die Zeile 9999, ist das ein Fehler", async () => {
    const b = await fahreEintrag(db, eintrag("messung.sql"), dir);
    expect(b.status).toBe("fehler");
    expect(b.grund).toContain("9999");
  });

  it("ein SQL-Fehler wird gefangen, redigiert und bricht den Lauf nicht ab", async () => {
    writeFileSync(join(dir, "kaputt.sql"), "select * from gibt_es_nicht;\n");
    const befunde = await fahreSuite(db, [
      eintrag("kaputt.sql"), eintrag("gut.sql"),
    ], dir);
    expect(befunde[0].status).toBe("fehler");
    expect(befunde[1].status).toBe("ok");
  });

  it("der Lauf ist lesend: die Datei läuft in begin … rollback", async () => {
    await db.fuehre("create table probe (k int)");
    writeFileSync(join(dir, "schreibt.sql"), "insert into probe values (1);\n");
    const b = await fahreEintrag(db, eintrag("schreibt.sql"), dir);
    expect(b.status).toBe("fehler");
    /* `set transaction read only` lehnt den Schreibversuch ab — und die Zeile
       ist auch nach dem Lauf nicht da. */
    const n = (await db.fuehre("select count(*)::int as n from probe"))[0][0];
    expect(n.n).toBe(0);
  });

  it("Bericht und Protokoll nennen jede Datei und verraten kein Geheimnis", async () => {
    const befunde = await fahreSuite(db, [
      eintrag("gut.sql"), eintrag("schlecht.sql"),
      eintrag("messung.sql", { modus: "messung" }),
    ], dir);
    const text = bericht(befunde);
    for (const n of ["gut.sql", "schlecht.sql", "messung.sql"]) expect(text).toContain(n);
    expect(text).toContain("ABWEICHUNG");

    const p = protokoll(befunde, new Date("2026-10-19T12:00:00Z"));
    expect(p).toContain("Staging-Pruefprotokoll");
    expect(p).toContain(STAGING_REF);
    expect(p).toContain("etwas stimmt NICHT");
    /* Keine Verbindungszeichenkette, kein Token, kein Passwort. */
    expect(p).not.toMatch(/postgres(ql)?:\/\/[^*]/);
    expect(p).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\./);
    expect(p).not.toMatch(/password\s*[=:]\s*[^*\s]/i);
  });
});

/* ==========================================================================
 * 6. Die Umgebungsprüfung bewertet, was ein Prozess hier erreichen könnte
 * ======================================================================== */

describe("env:audit — Phase A ist das Tor, Production ist Information", () => {
  const leer = {
    envLocalDa: false,
    skripteMitEnvLocal: [] as string[],
    prodAussen: { da: false, modus: null },
    stagingAussen: { da: true, modus: "600" },
    envTrefferProduction: [] as string[],
    envTrefferStaging: [] as string[],
  };

  it("der gewünschte Endzustand von Phase A ist erreicht", () => {
    expect(bewerte(leer).filter((x) => x.tor && !x.erreicht)).toEqual([]);
  });

  it("GENAU ZWEI Punkte entscheiden über den Exitcode", () => {
    const tore = bewerte(leer).filter((x) => x.tor);
    expect(tore).toHaveLength(2);
    expect(tore.map((x) => x.nr)).toEqual([1, 2]);
  });

  it("eine vorhandene .env.local ist INFORMATION, kein Fehler", () => {
    /*
     * DIE ENTSCHEIDUNG, DIE DIESER TEST FESTHÄLT.
     *
     * Die Absicherung von Production ist ein eigenes Vorhaben. Würde dieses
     * Werkzeug den heutigen Zustand als „offen" melden, zeigte es dauerhaft
     * einen Fehler für etwas, das so entschieden wurde — und ein Tor, das
     * immer rot ist, wird abgeschaltet.
     */
    const p = bewerte({ ...leer, envLocalDa: true });
    const elf = p.find((x) => x.nr === 11)!;
    expect(elf.tor).toBe(false);
    expect(elf.erreicht).toBe(true);
    expect(elf.befund).toContain("wie entschieden");
    expect(p.filter((x) => x.tor && !x.erreicht)).toEqual([]);
  });

  it("die 18 Production-Skripte bleiben unverändert und sind kein Fehler", () => {
    const p = bewerte({ ...leer, skripteMitEnvLocal: ["catalog:import:prod", "admin:grant"] });
    const zwoelf = p.find((x) => x.nr === 12)!;
    expect(zwoelf.tor).toBe(false);
    expect(zwoelf.erreicht).toBe(true);
    expect(zwoelf.befund).toContain("unveraendert");
  });

  it("fehlt die Staging-Datei, ist Phase A erkennbar nicht eingerichtet", () => {
    const p = bewerte({ ...leer, stagingAussen: { da: false, modus: null } });
    const eins = p.find((x) => x.nr === 1)!;
    expect(eins.tor).toBe(true);
    expect(eins.erreicht).toBe(false);
    expect(eins.befund).toContain("nicht eingerichtet");
  });

  it("eine zu offene Staging-Datei ist ein Fehler", () => {
    const p = bewerte({ ...leer, stagingAussen: { da: true, modus: "644" } });
    expect(p.find((x) => x.nr === 1)!.erreicht).toBe(false);
  });

  it("eine Production-Kennung in der Prozessumgebung ist ein Fehler — nur der NAME", () => {
    const p = bewerte({ ...leer, envTrefferProduction: ["NEXT_PUBLIC_SUPABASE_URL"] });
    const zwei = p.find((x) => x.nr === 2)!;
    expect(zwei.tor).toBe(true);
    expect(zwei.erreicht).toBe(false);
    expect(zwei.befund).toContain("NEXT_PUBLIC_SUPABASE_URL");
    /* Und nirgends ein Wert: die Kennung selbst steht nicht im Befund. */
    expect(zwei.befund).not.toContain(PRODUCTION_REF);
  });
});

describe("Phase A kommt ohne Production-Zugangsdaten aus", () => {
  /*
   * Die stärkste Form dieser Aussage ist, dass der Code sie nicht kennt:
   * kein Pfad, keine Variable, kein Schlüsselbundaufruf.
   */
  const DATEIEN = [
    "tools/lib/staging-db.mts",
    "tools/db-check-staging.mts",
    "tools/env-audit.mts",
  ] as const;

  for (const datei of DATEIEN) {
    it(`${datei} liest keine Production-Zugangsdaten`, () => {
      const q = readFileSync(datei, "utf8");
      const code = q.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      /* `env-audit` darf den Pfad NENNEN — es prüft, ob die Datei existiert.
         Lesen darf ihn keines: `readFileSync` auf `.env.local` oder auf die
         Production-Datei kommt in keiner dieser Dateien vor. */
      expect(code, datei).not.toMatch(/readFileSync\([^)]*env\.local/);
      expect(code, datei).not.toMatch(/readFileSync\([^)]*production\.env/);
      expect(code, datei).not.toMatch(/security find-generic-password/);
      expect(code, datei).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    });
  }

  it("der Prüfzugang braucht genau eine Umgebungsvariable", () => {
    const q = readFileSync("tools/db-check-staging.mts", "utf8");
    expect(q).toContain("ladeUmgebung(`${process.env.HOME ?? \"\"}/.skyisles/staging-db.env`)");
    const quelle = readFileSync("tools/lib/staging-db.mts", "utf8");
    expect(quelle).toContain('export const URL_VARIABLE = "SKYISLES_STAGING_DB_URL"');
  });
});

/* ==========================================================================
 * 7. Der Einrichtungsschritt setzt den dritten Riegel
 * ======================================================================== */

describe("staging-agent-setup.sql macht die Sitzung schreibgeschützt", () => {
  const setup = readFileSync("supabase/operations/staging-agent-setup.sql", "utf8");

  it("die Rolle trägt default_transaction_read_only = on", () => {
    expect(setup).toContain(
      "alter role skyisles_agent set default_transaction_read_only = on;");
  });

  it("und Abschnitt 3 liest nach, dass sie es trägt", () => {
    expect(setup).toContain("default_transaction_read_only=on");
    expect(setup).toContain("rolconfig");
  });

  it("die Rolle ist in jeder Hinsicht beschnitten — auch ohne bypassrls", () => {
    for (const eigenschaft of ["noinherit", "nosuperuser", "nocreatedb",
                               "nocreaterole", "noreplication", "nobypassrls"]) {
      expect(setup, eigenschaft).toContain(eigenschaft);
    }
    /*
     * KEIN `bypassrls` — UND DER GRUND STEHT IN DER DATEI.
     *
     * Ein erster Entwurf gab es ihr, weil jede vorhandene Policy
     * `to anon, authenticated` gebunden ist und eine neue Rolle deshalb null
     * Zeilen sähe. Nachgemessen ist: eine eigene SELECT-Policy je Tabelle
     * genügt, ohne das Attribut. `verify:check-sql` fährt beides nach (P15
     * und P16).
     */
    expect(setup).toContain("KEIN `bypassrls` — NACHGEMESSEN");
    expect(setup).toContain("mit Policy `to <rolle>`");
  });

  it("je Tabelle eine SELECT-Policy, auf die Rolle begrenzt", () => {
    expect(setup).toContain(
      "'create policy %I on public.%I for select to skyisles_agent using (true)'");
    /* Die Liste steht im CODE genau zweimal: einmal als Schleife, einmal in
       der Nachbedingung. (Im Kopfkommentar steht sie noch im Rückbaurezept.) */
    const code = setup.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");
    expect([...code.matchAll(/'purchase_receipt_counters',/g)]).toHaveLength(2);
    /* Und die Nachbedingung verlangt die Policy für jede der zwölf. */
    expect(setup).toContain("Policy agent_read_% fehlt");
    expect(setup).toContain("roles <> '{skyisles_agent}'::name[]");
  });

  it("die Nachbedingung prüft die EFFEKTIVEN Rechte, nicht die erteilten", () => {
    /* `has_table_privilege` rechnet eigene Grants, PUBLIC und jede
       Mitgliedschaft zusammen — `information_schema.role_table_grants` nicht. */
    const code = setup.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");
    expect(code).toContain("has_table_privilege");
    expect(code).toContain("has_function_privilege");
    /* Prosafrei: der Kommentar ERKLÄRT, warum nicht in role_table_grants
       nachgesehen wird — die Erklärung darf der Test nicht finden. */
    expect(code).not.toContain("role_table_grants");
    /* Über ALLE Relationen in public, nicht nur über die zwölf. */
    expect(setup).toContain("where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')");
    expect(setup).toContain("Schreibrecht(e)");
    /* Und keine Rollenmitgliedschaft, in keiner Richtung. */
    expect(setup).toContain("pg_auth_members");
    expect(setup).toContain("ist Mitglied von");
    expect(setup).toContain("Mitglied von skyisles_agent");
  });

  it("die sensiblen Funktionen sind namentlich ausgeschlossen", () => {
    for (const sig of ["public.seller_issue_purchase_receipt(bigint)",
                       "public.seller_issue_purchase_receipt_correction(bigint)",
                       "public.seller_business_backup()",
                       "public.system_platform_export()",
                       "public.purchase_receipt_fingerprint(bigint)"]) {
      expect(setup, sig).toContain(sig);
    }
    expect(setup).toContain("darf % ausfuehren");
  });

  it("sie ändert keine bestehende Rolle und kein bestehendes Recht", () => {
    const ohneProsa = setup.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");
    /* Kein `alter role` für eine andere Rolle als die neue. */
    const alterRole = [...ohneProsa.matchAll(/alter role (\w+)/g)].map((m) => m[1]);
    expect([...new Set(alterRole)]).toEqual(["skyisles_agent"]);
    /* Kein Grant an eine bestehende Rolle. */
    for (const rolle of ["anon", "authenticated", "service_role", "postgres"]) {
      expect(ohneProsa, rolle).not.toMatch(new RegExp(`grant[^;]*to ${rolle}\\b`, "i"));
    }
    /* Keine bestehende Policy wird angefasst, und keine statisch angelegt. */
    expect(ohneProsa).not.toMatch(/drop policy/i);
    const policies = [...ohneProsa.matchAll(/create policy[^\n]*/gi)].map((m) => m[0]);
    expect(policies).toHaveLength(1);
    expect(policies[0]).toContain("%I on public.%I for select to skyisles_agent");
    /* Die zwölf entstehen dynamisch, mit `agent_read_`-Präfix. */
    expect(ohneProsa).toContain("'agent_read_' || v_tab");
  });

  it("das Werkzeug verlangt genau diesen Zustand, bevor es arbeitet", () => {
    const quelle = readFileSync("tools/lib/staging-db.mts", "utf8");
    expect(quelle).toContain("transaction_read_only");
    expect(quelle).toContain("default_transaction_read_only");
  });
});

/* ==========================================================================
 * 8. TLS entscheidet die Zeichenkette — nachgemessen in der installierten `pg`
 * ======================================================================== */

describe("die Verbindung ist verschlüsselt, und zwar nachprüfbar", () => {
  const url = (q: string) =>
    `postgresql://${LESE_ROLLE}.${STAGING_REF}:gEhEim123@`
    + `aws-0-eu-central-1.pooler.supabase.com:5432/postgres${q}`;

  it("ohne sslmode verbindet pg unverschlüsselt — deshalb lehnt der Riegel ab", async () => {
    const { Client } = await import("pg");
    const ohne = new Client({ connectionString: url("") });
    /* `false` oder `undefined`: kein TLS. Das ist der Zustand, den Riegel 1
       niemals passieren lässt. */
    expect(Boolean((ohne as unknown as { connectionParameters: { ssl: unknown } })
      .connectionParameters.ssl)).toBe(false);
    expect(pruefeVerbindung(url("")).ok).toBe(false);
  });

  it("mit sslmode ist TLS an", async () => {
    const { Client } = await import("pg");
    const mit = new Client({ connectionString: url("?sslmode=verify-full") });
    expect(Boolean((mit as unknown as { connectionParameters: { ssl: unknown } })
      .connectionParameters.ssl)).toBe(true);
    expect(pruefeVerbindung(url("?sslmode=verify-full")).ok).toBe(true);
  });

  it("eine connectionString VERWIRFT ein ssl-Argument — darum verbindet das Werkzeug mit Feldern", async () => {
    /*
     * DER GRUND, WARUM DAS WERKZEUG KEINE `connectionString` MEHR UEBERGIBT.
     *
     * Enthält die Zeichenkette ein `sslmode=`, überschreibt `pg` ein
     * übergebenes `ssl` nicht — es verwirft es. Ein Parameter, der nichts
     * tut, behauptet eine Einstellung, die nicht gilt. Also umgekehrt: keine
     * Zeichenkette an den Treiber, dafür diskrete Felder plus ein
     * ausdrückliches `ssl: { ca }` (ADR-0138).
     *
     * Nachgemessen, beide Richtungen:
     */
    const { Client } = await import("pg");
    const mitKette = new Client({
      connectionString: url("?sslmode=verify-full"),
      ssl: { rejectUnauthorized: false },
    } as never);
    expect((mitKette as unknown as { connectionParameters: { ssl: unknown } })
      .connectionParameters.ssl, "die Zeichenkette gewinnt").toEqual({});

    const mitFeldern = new Client({
      user: `${LESE_ROLLE}.${STAGING_REF}`, password: "gEhEim123",
      host: "aws-0-eu-central-1.pooler.supabase.com", port: 5432,
      database: "postgres", ssl: { ca: "PEM-HIER" },
    } as never);
    expect((mitFeldern as unknown as { connectionParameters: { ssl: unknown } })
      .connectionParameters.ssl, "ohne Zeichenkette gilt das ssl-Objekt")
      .toEqual({ ca: "PEM-HIER" });

    const quelle = readFileSync("tools/lib/staging-db.mts", "utf8");
    const code = quelle.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/ssl:\s*\{\s*rejectUnauthorized/);
    expect(code).not.toContain("connectionString:");
    expect(quelle).toContain("DISKRETE FELDER UND EIN AUSDRUECKLICHES `ssl`");
  });

  it("ein Passwort mit # bricht schon das Parsen — der Riegel fängt es vorher", async () => {
    const { parse } = await import("pg-connection-string");
    const kaputt = url("?sslmode=verify-full").replace("gEhEim123", "a#b");
    expect(() => parse(kaputt)).toThrow();
    expect(pruefeVerbindung(kaputt).ok).toBe(false);
  });
});

/* ==========================================================================
 * 9. Was die Rolle über PUBLIC ausführen könnte — der Bericht und sein Riegel
 * ======================================================================== */

describe("function-acl-audit: keine ungeschützte Schreibfunktion über PUBLIC", () => {
  const bericht = execFileSync("python3",
    ["tools/lib/function-acl-audit.py", "--nur-befunde"], { encoding: "utf8" });

  it("kein Befund: SCHREIBT_OHNE_TOR ist leer", () => {
    expect(bericht).toContain("== SCHREIBT_OHNE_TOR: 0 ==");
    expect(bericht).toContain("Kein Befund");
  });

  it("die 19 schreibenden Funktionen über PUBLIC sind alle benannt", () => {
    const m = /== SCHREIBT_MIT_TOR: (\d+) ==/.exec(bericht);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(19);
    /* Drei davon hatte eine frühere Fassung dieses Audits VERLOREN, weil sie
       `drop function` und `create` je Datei in zwei Durchgängen verarbeitete.
       Ein Audit, das seinen Gegenstand verliert, meldet „kein Befund". */
    for (const f of ["seller_create_sale", "seller_set_sale_date",
                     "seller_set_sale_payout"]) {
      expect(bericht, f).toContain(f);
    }
  });

  it("die vier lesenden sind harmlos — und zwei davon haben trotzdem ein Tor", () => {
    expect(bericht).toContain("== LESEND: 4 ==");
    /* `orderbook_normalise` und `sale_item_is_closed` sind `immutable` und
       fassen keine Tabelle an; die zwei `security definer`-Leser beginnen mit
       `can_operate_active_seller()`. */
    for (const f of ["orderbook_normalise", "sale_item_is_closed",
                     "seller_sale_audit", "seller_sale_fingerprints"]) {
      expect(bericht, f).toContain(f);
    }
  });

  it("das Tor wird VOR dem ersten Schreibvorgang verlangt, nicht irgendwo", () => {
    const quelle = readFileSync("tools/lib/function-acl-audit.py", "utf8");
    expect(quelle).toContain("tor_pos < schreib_pos");
    expect(quelle).toContain("Ein Tor hinter dem ersten");
  });

  it("und die dynamische Belegsperre aus operations/ wird mitgezählt", () => {
    const quelle = readFileSync("tools/lib/function-acl-audit.py", "utf8");
    expect(quelle).toContain("lock-receipt-issuance.sql");
    expect(quelle).toContain("'revoke execute on function %s from");
  });

  it("der Bericht steht als Befehl bereit", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as
      { scripts: Record<string, string> };
    expect(pkg.scripts["db:acl:audit"]).toBe("python3 tools/lib/function-acl-audit.py");
  });
});

/* ==========================================================================
 * 10. Der Abbruch vom 2026-10-19: die Mitgliedschaftsprüfung
 * ======================================================================== */

describe("die Rollenmitgliedschaft wird gerichtet geprüft, nicht pauschal", () => {
  const setup = readFileSync("supabase/operations/staging-agent-setup.sql", "utf8");
  const diag = readFileSync("supabase/checks/staging_agent_role_diagnosis.sql", "utf8");

  it("Richtung 1 bleibt blockierend: die Rolle ist Mitglied von nichts", () => {
    /* `m.member = skyisles_agent` → der Zugang gewinnt fremde Rechte. */
    expect(setup).toContain("skyisles_agent ist Mitglied von % Rolle(n)");
    expect(setup).toContain("join pg_roles k on k.oid = m.member\n   where k.rolname = 'skyisles_agent'");
  });

  it("Richtung 2 ist KEIN pauschaler Abbruch mehr", () => {
    /*
     * DER FEHLER, DEN DIESER TEST FESTHÄLT.
     *
     * Die alte Zeile verbot jede Mitgliedschaft AN der Rolle. PostgreSQL legt
     * sie aber selbst an, sobald ein CREATEROLE-Nutzer ohne Superuser-Recht
     * die Rolle erzeugt — nachgemessen in 18.6: `admin=true`,
     * `inherit=false`, `set=false`. Ohne sie könnte der Dashboard-Nutzer die
     * Rolle nicht einmal ändern.
     */
    expect(setup).not.toContain("eine andere Rolle ist Mitglied von skyisles_agent");
    /* Stattdessen: Hinweis, plus zwei gezielte Abbrüche. */
    expect(setup).toContain("Mitglied(er) von skyisles_agent");
    expect(setup).toContain("fremde Rolle(n) sind Mitglied von skyisles_agent");
    expect(setup).toContain("tragen inherit");
  });

  it("die Prüfung ist versionsverträglich: inherit/set gibt es erst ab 16", () => {
    /* `to_jsonb(m) ->> 'set_option'` ist NULL, wenn die Spalte fehlt — statt
       `42703 column does not exist` auf PostgreSQL 15. */
    expect(setup).toContain("to_jsonb(m) ->> 'inherit_option'");
    expect(setup).toContain("to_jsonb(m) ->> 'set_option'");
    expect(diag).toContain("to_jsonb(m) ->> 'set_option'");
    expect(setup).not.toMatch(/m\.set_option/);
    expect(diag).not.toMatch(/m\.set_option/);
  });

  it("der Einrichtungsschritt ist wiederholbar", () => {
    /* Ein Abbruch in der Nachbedingung darf den zweiten Versuch nicht
       unmöglich machen. Also: create ODER alter, ein Ergebnis. */
    expect(setup).toContain("besteht schon — Attribute und Passwort werden gesetzt");
    expect(setup).toContain("alter role skyisles_agent with %s password %L");
    expect(setup).toContain("create role skyisles_agent with %s password %L");
    expect(setup).not.toContain("die Rolle skyisles_agent gibt es schon");
  });

  it("und er prüft das Passwort — Präfix, Länge, Zeichenmenge", () => {
    /*
     * Der Vergleich ist ein PRÄFIX, nicht der ganze Platzhalter: „suchen und
     * ersetzen" über die Datei träfe sonst auch den Vergleich, und die
     * Prüfung schlüge trotz eingesetztem Passwort an. Genau das ist im
     * Probelauf passiert.
     */
    expect(setup).toContain("v_passwort like 'HIER-EIN-NEUES-%'");
    expect(setup).toContain("length(v_passwort) < 32");
    expect(setup).toContain("v_passwort !~ '^[A-Za-z0-9]+$'");
  });

  it("die Diagnose nennt beide Richtungen ausdrücklich und ist rein lesend", () => {
    expect(diag).toContain("GEFAEHRLICHE RICHTUNG");
    expect(diag).toContain("ANDERE RICHTUNG");
    expect(diag).toContain("m.member  = die Rolle, DIE Mitglied ist");
    expect(diag).toContain("m.roleid  = die Rolle, IN DER sie Mitglied ist");
    const code = diag.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");
    expect(code).not.toMatch(/\bdo\s+\$\$/i);
    expect(code).not.toMatch(/^\s*(insert|update|delete|truncate|grant|revoke|alter|create|drop)\b/im);
    expect(diag).toContain("blockierende Abweichungen (muss 0 sein)");
  });

  it("die Diagnose beantwortet, wie weit das Setup gekommen ist", () => {
    for (const zeile of ["Umgebungsstempel auf der Datenbank",
                         "SELECT-Rechte von skyisles_agent auf den 12 Tabellen",
                         "Policies agent_read_*", "Deutung"]) {
      expect(diag, zeile).toContain(zeile);
    }
    /* Und sie weiß, dass `postgres` von `initdb` her schon einen Kommentar
       trägt — die Deutung vergleicht deshalb mit dem ERWARTETEN Stempel und
       nicht mit der Leere. */
    expect(diag).toContain("default administrative connection\n   * database");
    expect(diag).toContain("<> 'skyisles-staging qqxcpesbwfxzgytkdsac'");
  });

  it("nur die Sicherheitsfragen sind blockierend — ein Rollback ist kein Fehler", () => {
    /* 201, 212, 401–404 tragen einen Sollwert; alles andere ist Messung. */
    const mitSoll = [...diag.matchAll(/^  \((\d+), '[^']*', '[^']*'[\s\S]*?\),\n(?=  \(|\),)/gm)];
    expect(mitSoll.length).toBeGreaterThan(0);
    for (const nr of ["201", "212", "401", "402", "403", "404"]) {
      expect(diag, nr).toMatch(new RegExp(`\\(${nr}, '`));
    }
  });
});
