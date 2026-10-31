import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/*
 * ===========================================================================
 * DIE PRODUCTION-HUELLE FUER 0165 UND IHRE BEIDEN PRUEFDATEIEN
 *
 * Gemessener Production-Stand vom 2026-10-30 (`prod_0159_0165_state.sql`,
 * ausgefuehrt im SQL-Editor): `0159`-`0164` ANGEWENDET, `0165` FEHLT,
 * `system_set_image_override` FEHLT, Sequenz `821|true` unbegrenzt.
 *
 * Diese Datei haelt fest, was daraus folgt — insbesondere den VERSTAERKTEN
 * Umgebungsnachweis. Der alte Riegel der Gruppen G3'-G5' erkannte Staging
 * daran, dass dort das Markerpaar `SKY-0821` + `SKY-0822` liegt. Seit der
 * Umnummerierung liegt es dort nicht mehr vollstaendig, und der Abgleich legt
 * `SKY-0822` demnaechst auf Production an. Ein Stempel, den der eigene Sync
 * umwirft, ist kein Stempel.
 * ===========================================================================
 */

const HUELLE = readFileSync("supabase/operations/prod-0165.sql", "utf8");
const MIGRATION = readFileSync("supabase/migrations/0165_system_sync_create_figure.sql", "utf8");
const PRE = readFileSync("supabase/checks/prod_0165_preflight.sql", "utf8");
const POST = readFileSync("supabase/checks/prod_0165_postflight.sql", "utf8");

/** Der Quelltext ohne Blockkommentare und Zeilenkommentare. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").filter((z) => !z.trimStart().startsWith("--")).join("\n");

describe("prod-0165.sql bettet die Migration zeichengleich ein", () => {
  it("zwischen den Marken steht die Migration, Byte fuer Byte", () => {
    const a = "-- >>> EINGEBETTET: supabase/migrations/0165_system_sync_create_figure.sql\n";
    const b = "-- <<< ENDE: supabase/migrations/0165_system_sync_create_figure.sql\n";
    expect(HUELLE).toContain(a);
    expect(HUELLE).toContain(b);
    expect(HUELLE.slice(HUELLE.indexOf(a) + a.length, HUELLE.indexOf(b))).toBe(MIGRATION);
  });

  it("eine Transaktion, und kein rollback im ausfuehrbaren Teil", () => {
    const c = code(HUELLE);
    expect(c.match(/^begin;$/gm)).toHaveLength(1);
    expect(c.match(/^commit;$/gm)).toHaveLength(1);
    expect(c).not.toMatch(/^\s*rollback/m);
  });

  /*
   * ABBRUCHVERHALTEN. `0165` legt eine Funktion an und zieht keine Sequenz —
   * anders als die Umnummerierung, bei der ein `nextval` einen Abbruch
   * ueberlebte. Ein gescheiterter Lauf laesst hier NICHTS zurueck, und das
   * haengt daran, dass im ausfuehrbaren Teil keine Sequenz vorkommt.
   */
  it("kein nextval und kein setval im ausfuehrbaren Teil", () => {
    // Der Funktionsrumpf zaehlt nicht als ausgefuehrt — er wird nur angelegt.
    const vorRumpf = code(HUELLE).split("create or replace function")[0];
    expect(vorRumpf).not.toContain("nextval");
    expect(vorRumpf).not.toContain("setval");
  });

  it("DDL und Rechte treffen genau EIN Objekt", () => {
    const zeilen = code(HUELLE).split("\n")
      .filter((z) => /^\s*(create|alter|drop|grant|revoke|comment)\s/i.test(z));
    expect(zeilen.length).toBeGreaterThan(0);
    for (const z of zeilen) {
      expect(z, `${z.trim()} fasst etwas anderes an als die neue Funktion`)
        .toContain("system_sync_create_figure");
    }
  });

  it("sie schreibt keine Tabellenzeile — die beiden insert stehen IM Rumpf", () => {
    const c = code(HUELLE).split("\n");
    const start = c.findIndex((z) => z.startsWith("create or replace function public.system_sync_create_figure"));
    const ende = c.findIndex((z, i) => i > start && z.trim() === "$$;");
    expect(start).toBeGreaterThan(-1);
    expect(ende).toBeGreaterThan(start);
    c.forEach((z, i) => {
      if (/^\s*(insert|update|delete|truncate)\s/i.test(z)) {
        expect(i, `Zeile ${i + 1} schreibt ausserhalb des Funktionsrumpfs`)
          .toBeGreaterThan(start);
        expect(i).toBeLessThan(ende);
      }
    });
  });
});

describe("der verstaerkte Umgebungsnachweis ist POSITIV und am Schema", () => {
  /*
   * ZWEI POSITIVE NACHWEISE. Ein Katalogabgleich schreibt Zeilen; er legt
   * keine Triggerfunktion an und veraendert keine Sequenzgrenze.
   */
  it("A1: 0133 mit BEIDEN Objekten — Funktion und Trigger", () => {
    expect(HUELLE).toContain("public.purchases_paid_total_is_final()");
    expect(HUELLE).toContain("purchases_paid_total_immutable_trg");
    expect(HUELLE).toContain("ABBRUCH A1a");
    expect(HUELLE).toContain("ABBRUCH A1b");
  });

  it("A2: das Staging-Band wird abgewiesen, das Production-Band zugelassen", () => {
    expect(HUELLE).toContain("min_value = 928 and max_value = 4999");
    expect(HUELLE).toContain("min_value = 5001 and max_value = 8999");
    expect(HUELLE).toContain("min_value = 1 and max_value = 9223372036854775807");
  });

  /*
   * KEIN PRODUCTION-WAECHTER HAENGT MEHR AN DIESEN ZWEI ZEILEN.
   *
   * Der alte negative Riegel ist ganz entfallen, nicht nur entwertet: der
   * Katalogabgleich legt `SKY-0822` auf PRODUCTION an, und `SKY-0821` traegt
   * dort `Winterfest Lob-Star`. Danach stuenden beide — der Riegel haette
   * auf seiner eigenen Zielumgebung angeschlagen.
   */
  it.each([
    ["prod-0165.sql", HUELLE],
    ["production-sky-id-band.sql",
      readFileSync("supabase/operations/production-sky-id-band.sql", "utf8")],
    ["R_production_sky_id_band.sql",
      readFileSync("supabase/rollback/R_production_sky_id_band.sql", "utf8")],
  ])("%s nennt SKY-0821/SKY-0822 in keiner ausführbaren Zeile", (_n, sql) => {
    const c = code(sql);
    expect(c).not.toContain("SKY-0821");
    expect(c).not.toContain("SKY-0822");
  });

  it("stattdessen tragen alle drei dieselben positiven Riegel", () => {
    const dateien = [
      HUELLE,
      readFileSync("supabase/operations/production-sky-id-band.sql", "utf8"),
      readFileSync("supabase/rollback/R_production_sky_id_band.sql", "utf8"),
    ];
    for (const sql of dateien) {
      const c = code(sql);
      // 0133, beide Objekte — Schema, kein Datum.
      expect(c).toContain("purchases_paid_total_is_final");
      expect(c).toContain("purchases_paid_total_immutable_trg");
      /*
       * Und das Staging-Band wird abgewiesen. Die drei Dateien schreiben es
       * verschieden (`min_value = 928 …` bzw. `v_min = 928 …`), deshalb wird
       * auf die Zahlen geprueft und nicht auf den Wortlaut.
       */
      expect(c).toMatch(/928[\s\S]{0,40}4999/);
    }
  });

  it("und der Preflight prueft dieselben vier Dinge", () => {
    for (const nr of ["(101,", "(102,", "(103,", "(104,", "(105,"]) {
      expect(PRE, `Preflightzeile ${nr} fehlt`).toContain(nr);
    }
  });
});

describe("Preflight und Postflight", () => {
  it.each([["Preflight", PRE], ["Postflight", POST]])(
    "%s ist eine einzige lesende Anweisung", (_n, sql) => {
      const c = code(sql);
      for (const m of ["begin;", "commit;", "rollback;", "do $", "set_config("]) {
        expect(c, `darf ${m} nicht enthalten`).not.toContain(m);
      }
      expect(c.split(";").filter((x) => x.trim() !== "")).toHaveLength(1);
    });

  it.each([["Preflight", PRE], ["Postflight", POST]])(
    "%s schreibt nichts", (_n, sql) => {
      const c = code(sql);
      for (const m of ["insert ", "update ", "delete ", "truncate ", "grant ", "revoke "]) {
        expect(c.toLowerCase()).not.toContain(m);
      }
    });

  /*
   * EINE NACHKONTROLLE, DIE DIE FUNKTION AUFRUFT, HAT DIE PRUEFUNG ZUR
   * HANDLUNG GEMACHT — und sie haette eine SKY-ID verbraucht.
   */
  it("der Postflight ruft 0165 NICHT auf", () => {
    const c = code(POST);
    expect(c).not.toMatch(/select\s+(public\.)?system_sync_create_figure\s*\(/);
    expect(c).toContain("'0'");  // Zeile 208: keine Figur im Importbereich
  });

  it("der Postflight prueft die Rechte einzeln, PUBLIC eingeschlossen", () => {
    for (const rolle of ["'service_role'", "'anon'", "'authenticated'", "'public'"]) {
      expect(POST, `${rolle} fehlt in den Rechtepruefungen`).toContain(rolle);
    }
  });

  /*
   * DER SUCH-PFAD WIRD AUSGEPACKT. Ein Vergleich gegen `{"search_path="}` als
   * Ganzes haengt an der Reihenfolge der Einstellungen in `proconfig`.
   */
  /*
   * DER FEHLER VOM 2026-10-30, FESTGENAGELT.
   *
   * Die erste Fassung packte den Wert aus und erwartete eine LEERE
   * Zeichenkette. Production meldete `""` und die Zeile schlug an, obwohl
   * die Funktion in Ordnung war: PostgreSQL legt einen leeren GUC-Wert
   * QUOTIERT ab. Jetzt steht hier der Ausdruck aus `0165` selbst — erst
   * auspacken, dann `btrim(..., '"')`, dann auf leer pruefen.
   */
  it("der Postflight entquotet den search_path, wie 0165 es vormacht", () => {
    expect(POST).toContain("btrim(substring(c from 'search_path=(.*)$'), '\"')");
    expect(POST).toContain("c like 'search\\_path=%'");
    // Und er fragt zuerst, DASS eine Festlegung da ist.
    expect(POST).toContain("eine search_path-Festlegung ist vorhanden");
    /*
     * KEINE NEGATIVPROBE AN DIESER STELLE. Eine erste Fassung suchte nach
     * „auspacken, dann `, '')`" — und traf damit die RICHTIGE Fassung, weil
     * `nullif(btrim(...), '')` genau so aussieht. Ein Muster, das das
     * Richtige anklagt, ist kein Waechter.
     *
     * Die bestandsweite Pruefung macht
     * `src/lib/admin/migration-integrity.test.ts`: sie durchsucht jede
     * Prüf-, Operations- und Migrationsdatei und kennt beide richtigen Wege
     * (entquoten ODER die quotierte Form erwarten).
     */
  });

  /*
   * DIE BASELINE GEHOERT IN DIE DATEI. `set_config(..., true)` ist
   * transaktionslokal; im SQL-Editor ist jede Ausfuehrung eine eigene
   * Transaktion, ein Wert aus dem Preflight kann einen spaeteren Lauf also
   * gar nicht erreichen. Zweimal hat mich das eine fehlgeschlagene
   * Nachkontrolle gekostet — bei SKY-0821 mit 19 Abweichungen, bei 0165 mit
   * zwei.
   */
  it("die Baseline steht als Literal in der Datei, mit Herkunft", () => {
    expect(POST).toContain(
      "'skyisles-p0165-1|624|217|340|622|95|0|2|'");
    expect(POST).toContain("95bbbb51bd6ca2fd9d0be184b22bfda4|42b1d29ab32e");
    expect(POST).toContain("TRANSAKTIONSLOKAL");
    expect(POST).toContain("IN DIE PRUEFDATEI");
  });

  /*
   * UND EINE FEHLENDE GRUNDLAGE MUSS DURCHFALLEN, NICHT SCHWEIGEN.
   *
   * Die `ok`-Spalte lautet `case when erwartet is null then null else … end`.
   * Ohne Baseline war jede Erwartung NULL, und sieben Vergleiche gaben GAR
   * KEIN Urteil ab — der Lauf meldete `9999 = 3`, obwohl nur zwei Zeilen
   * ueberhaupt gewertet wurden. Die Zahl war zu klein, nicht zu gross.
   */
  it("eine fehlende Baseline faellt durch, statt zu abstinieren", () => {
    /*
     * GEZAEHLT, NICHT ZEILENWEISE GEPRUEFT. SQL-Ausdrücke gehen über
     * mehrere Zeilen; eine erste Fassung dieses Tests sah eine
     * Fortsetzungszeile (`'(BASELINE FEHLT)') from soll),`) und vermisste
     * das `coalesce(`, das eine Zeile höher stand.
     *
     * Jede der sieben Erwartungen aus dem Baselineblock (303-309) trägt die
     * Ersatzzeichenkette. Sind es weniger, abstiniert mindestens eine Zeile
     * wieder bei fehlender Grundlage.
     */
    const gesichert = (code(POST).match(/\(BASELINE FEHLT\)/g) ?? []).length;
    expect(gesichert, "jede Erwartung des Baselineblocks muss gegen NULL "
      + "gesichert sein — 303 bis 309 sind sieben").toBeGreaterThanOrEqual(7);
  });

  it("der Rumpfabdruck ist eine Erwartung, keine Auskunft", () => {
    expect(POST).toContain("'6a0383c5c4da7fec3cdd6a39041c3069'");
    expect(POST).toContain("der Rumpfabdruck ist der aus der Migrationsdatei");
  });

  it("der Preflight liefert eine Baseline, der Postflight verlangt sie", () => {
    expect(PRE).toContain("skyisles-p0165-1|");
    expect(PRE).toContain("(900, 'BASIS'");
    expect(POST).toContain("current_setting('skyisles.p0165', true)");
    expect(POST).toContain("(303, 'Baseline', 'ihre Selbstprobe stimmt");
  });

  /*
   * ANDERS ALS BEI DER UMNUMMERIERUNG MUSS DER KATALOGABDRUCK HIER GLEICH
   * BLEIBEN. `0165` aendert keine Zeile.
   */
  it("der Postflight verlangt einen UNVERAENDERTEN Katalogabdruck", () => {
    expect(POST).toContain("hier MUSS er gleich sein");
    expect(POST).toContain("coalesce(katalogabdruck, '(BASELINE FEHLT)') from soll");
  });

  it("beide prueften Nutzerdaten: Sammlungen, Favoriten, Warenkoerbe, Bestellungen", () => {
    for (const t of ["collection_items", "favorites", "cart_items", "order_lines"]) {
      expect(PRE, `${t} fehlt im Preflight`).toContain(`public.${t}`);
      expect(POST, `${t} fehlt im Postflight`).toContain(`public.${t}`);
    }
  });
});

describe("G3', G4' und G5' sind aus der Planung gestrichen, die Dateien bleiben", () => {
  const akte = readFileSync("supabase/migrations/APPLIED.md", "utf8");

  it("die Akte sagt es ausdruecklich", () => {
    expect(akte).toContain("sind aus der Ausführungsplanung GESTRICHEN");
    expect(akte).toContain("Archiv, nicht Plan");
  });

  it("und die Dateien liegen weiter", () => {
    for (const f of ["prod-g3-0159.sql", "prod-g4-0160-0162.sql", "prod-g5-0163-0164.sql"]) {
      expect(() => readFileSync(`supabase/operations/${f}`, "utf8")).not.toThrow();
    }
  });

  it("der gemessene Stand steht mit beiden Nachweisarten getrennt in der Akte", () => {
    expect(akte).toContain("Funktions- und Schemanachweis");
    expect(akte).toContain("Ausführungsprotokoll");
    expect(akte).toContain("7e9e58e2d84a9f8a7c660262aa21926b");
  });
});

/*
 * ===========================================================================
 * DIE PRODUCTION-BANDUMSTELLUNG UND IHRE RUECKNAHME
 * ===========================================================================
 */
const BAND = readFileSync("supabase/operations/production-sky-id-band.sql", "utf8");
const BAND_PRE = readFileSync("supabase/checks/prod_sky_id_band_preflight.sql", "utf8");
const BAND_POST = readFileSync("supabase/checks/prod_sky_id_band_postflight.sql", "utf8");
const BAND_R = readFileSync("supabase/rollback/R_production_sky_id_band.sql", "utf8");

describe("die Bandumstellung schuetzt den Zustand auch gegen gleichzeitige Schreiber", () => {
  it("eine Transaktion, eine wirksame Anweisung", () => {
    const c = code(BAND);
    expect(c.match(/^begin;$/gm)).toHaveLength(1);
    expect(c.match(/^commit;$/gm)).toHaveLength(1);
    expect(c.match(/^alter sequence/gm)).toHaveLength(1);
    expect(c).not.toMatch(/^\s*(insert|update|delete|truncate)\s/m);
  });

  /*
   * `ALTER SEQUENCE` nimmt ACCESS EXCLUSIVE auf die Sequenz; ein
   * gleichzeitiges `nextval` wartet dann. `lock_timeout` sorgt dafuer, dass
   * dieser Lauf nicht unbegrenzt wartet und dabei die Figurenanlage
   * blockiert.
   */
  it("sie wartet nicht unbegrenzt — lock_timeout und statement_timeout", () => {
    expect(BAND).toContain("set local lock_timeout = '5s'");
    expect(BAND).toContain("set local statement_timeout = '300s'");
  });

  /*
   * DAS EINZIGE ZEITFENSTER: zwischen A4 (liest `last_value`) und der
   * `alter sequence`-Anweisung haelt niemand die Sequenz. Eine gleichzeitige
   * Figurenanlage koennte dort `SKY-0822` ziehen — an der Sequenz waere das
   * hinterher nicht mehr zu sehen, weil `restart` den Stand ueberschreibt.
   * An Katalog, Journal und hoechster SKY-ID schon.
   */
  it("und ein gleichzeitiger Zug faellt an B1-B4 auf", () => {
    expect(BAND).toContain("skyisles.pband_a5");
    for (const m of ["ABBRUCH B1", "ABBRUCH B2", "ABBRUCH B3", "ABBRUCH B4"]) {
      expect(BAND, `${m} fehlt`).toContain(m);
    }
    expect(BAND).toContain("die hoechste SKY-ID ist % statt %");
  });

  it("sie zieht keine Nummer — nextval steht nur im Kommentar", () => {
    expect(code(BAND)).not.toContain("nextval");
  });
});

describe("das Rücknahme-Runbook", () => {
  it("hält den Ursprungszustand fest", () => {
    for (const m of ["9223372036854775807", "821", "NO CYCLE",
                     "95bbbb51bd6ca2fd9d0be184b22bfda4"]) {
      expect(BAND_R, `${m} fehlt im Runbook`).toContain(m);
    }
  });

  /*
   * KEINE AUTOMATISCHE RUECKNAHME NACH EINER VERGABE. Zwei Wege fuehren
   * dahin, und beide sind gesperrt: eine Nummer im Band (A3, Tabelle UND
   * Journal) und eine Sequenz, die gezogen HAT (A4, `is_called`). Der
   * zweite ist der subtilere — eine gezogene und wieder verworfene Nummer
   * steht in keiner Tabelle und ist trotzdem verbraucht (ADR-0001).
   */
  it("verweigert nach einer bereits erfolgten Vergabe — auf beiden Wegen", () => {
    expect(BAND_R).toContain("A3 ABBRUCH");
    expect(BAND_R).toContain("SKY-5001' and 'SKY-8999");
    expect(BAND_R).toContain("catalog_admin_changes");
    expect(BAND_R).toContain("A4 ABBRUCH");
    expect(BAND_R).toContain("is_called");
    // Und es gibt keinen Schalter, der das uebergeht.
    expect(code(BAND_R)).not.toMatch(/force|erzwing|override|skip_/i);
  });

  it("verlangt die Zielzahl, statt sie zu raten", () => {
    expect(BAND_R).toContain("A5 ABBRUCH");
    expect(BAND_R).toContain("skyisles.zurueck");
    expect(BAND_R).toContain("A5c ABBRUCH");  // nicht unter die hoechste SKY-ID
  });

  it("prüft gleichzeitige Schreibzugriffe wie der Hinlauf", () => {
    expect(BAND_R).toContain("skyisles.pband_r");
    expect(BAND_R).toContain("ABBRUCH B1");
    expect(BAND_R).toContain("ABBRUCH B2");
    expect(BAND_R).toContain("set local lock_timeout");
  });

  it("stellt is_called wieder her — restart allein täte das nicht", () => {
    /*
     * `restart with n` setzt `is_called` auf FALSE; der Ursprung hatte TRUE
     * (Stand 821, naechster Zug waere 822 gewesen). Ohne das `setval` danach
     * waere der wiederhergestellte Zustand um eine Nummer verschoben.
     */
    expect(BAND_R).toContain("perform setval('public.sky_id_seq', v_zurueck, true)");
    expect(BAND_R).toContain("is_called true");
  });
});

describe("Preflight und Postflight der Bandumstellung", () => {
  it.each([["Preflight", BAND_PRE], ["Postflight", BAND_POST]])(
    "%s ist eine einzige lesende Anweisung", (_n, sql) => {
      const c = code(sql);
      for (const m of ["begin;", "commit;", "rollback;", "do $"]) {
        expect(c, `darf ${m} nicht enthalten`).not.toContain(m);
      }
      /*
       * Verboten ist der AUFRUF, nicht das Wort: Zeile 206 des Postflights
       * heisst „kein nextval seit der Umstellung" und ist eine Beschreibung.
       * Eine erste Fassung dieser Zusicherung hat genau daran angeschlagen.
       */
      expect(c, "darf nextval nicht AUFRUFEN").not.toContain("nextval(");
      expect(c, "darf setval nicht AUFRUFEN").not.toContain("setval(");
      expect(c.split(";").filter((x) => x.trim() !== "")).toHaveLength(1);
    });

  /*
   * PUNKT 4 DER FREIGABEBEDINGUNGEN: der Postflight verlangt eine ECHTE
   * Baseline als Literal, prueft sie gegen ihre Selbstprobe, und eine
   * fehlende blockiert — sie schweigt nicht.
   */
  it("der Postflight verlangt eine echte Baseline, nicht den Platzhalter", () => {
    expect(BAND_POST).toContain("BASELINE-PLATZHALTER");
    expect(BAND_POST).toContain("roh <> 'BASELINE-PLATZHALTER'");
    expect(BAND_POST).toContain("(301, 'Baseline'");
  });

  it("er prüft sie gegen ihre Selbstprobe", () => {
    expect(BAND_POST).toContain("(303, 'Baseline', 'ihre Selbstprobe stimmt");
    expect(BAND_POST).toContain("left(md5(");
    expect(BAND_POST).toContain("selbstprobe");
  });

  it("und eine fehlende Baseline fällt durch, statt zu abstinieren", () => {
    const gesichert = (code(BAND_POST).match(/\(BASELINE FEHLT\)/g) ?? []).length;
    expect(gesichert, "jede Erwartung des Baselineblocks muss gegen NULL "
      + "gesichert sein").toBeGreaterThanOrEqual(7);
  });

  it("der Preflight liefert die Baseline mit Marke und Selbstprobe", () => {
    expect(BAND_PRE).toContain("skyisles-pband-1|");
    expect(BAND_PRE).toContain("left(md5(kern), 12)");
    expect(BAND_PRE).toContain("(900, 'BASIS'");
  });

  /*
   * PUNKT 6: der Importbereich wird von der Umstellung nicht beruehrt, und
   * niemand zieht vorher eine Nummer.
   */
  it("beide prüfen den Importbereich SKY-0822..SKY-0928", () => {
    for (const sql of [BAND_PRE, BAND_POST]) {
      expect(sql).toContain("SKY-0822' and 'SKY-0928");
      expect(sql).toContain("catalog_admin_changes");
    }
    expect(BAND_POST).toContain("kein nextval seit der Umstellung");
  });
});
