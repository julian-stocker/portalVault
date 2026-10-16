/**
 * Wer darf den internen Fingerabdruck ausführen (`0125`) — und drei
 * Katalogannahmen, die auf Staging gescheitert sind.
 *
 * DER BEFUND, DER DIESE DATEI AUSGELÖST HAT
 *
 * `0122` entzieht `purchase_receipt_fingerprint(bigint)` nur `public` und
 * `anon`. Dahinter steckt die Annahme „kein `grant` = kein Recht". Auf
 * Supabase ist sie falsch: das Schema `public` hat Default-Privileges, die
 * jeder neu erzeugten Funktion EXECUTE für `anon`, `authenticated` und
 * `service_role` mitgeben. Der Staging-Preflight zu `0124` hat gezeigt, dass
 * `authenticated` das Recht tatsächlich hatte — bei einer `security
 * definer`-Funktion ohne Berechtigungstor, die an jeder RLS vorbei liest.
 *
 * `0125` entzieht dieses eine Recht. Diese Datei hält fest, dass die
 * Migration genau das tut und nichts darüber hinaus.
 *
 * UND DIE DREI ANNAHMEN
 *
 * Derselbe Preflight hat drei Prüfungen von mir widerlegt, die alle dieselbe
 * Form hatten: ein Vergleich gegen eine Zeichenkette, deren Gestalt ich nicht
 * gemessen hatte. Zwei davon standen auch in den Nachbedingungen von `0124`
 * und hätten die Migration abgebrochen. Der zweite Teil dieser Datei macht
 * jede der drei künftig lokal sichtbar.
 */
import { describe, expect, it } from "vitest";

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  allMigrations, code, latestFunction, migrationFiles, migrationSource,
} from "@/test-support/migrations";

const FILE_0125 = "0125_revoke_internal_fingerprint_execute.sql";
const sql0125 = migrationSource(FILE_0125);
const exec0125 = code(sql0125);

/* ==========================================================================
 * 1. `0125` entzieht ein Recht — und tut sonst nichts
 * ======================================================================== */

describe("0125 ist eine Rechtemigration und nur das", () => {
  it("sie enthält genau eine rechteverändernde Anweisung", () => {
    const zeilen = exec0125.split("\n")
      .filter((l) => /^\s*(grant|revoke)\b/i.test(l));
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]).toMatch(/^revoke execute on function/);
  });

  it("und die entzieht `authenticated` den Fingerabdruck", () => {
    expect(exec0125).toContain(
      "revoke execute on function public.purchase_receipt_fingerprint(bigint)");
    expect(exec0125).toContain("from authenticated;");
  });

  it("sie ändert die Funktion NICHT", () => {
    /*
     * Eine Rechtemigration, die eine Funktion neu schreibt, ist keine
     * Rechtemigration mehr — und der gespeicherte Fingerabdruck jedes
     * bestehenden Belegs hinge an ihr.
     */
    expect(exec0125).not.toContain("create or replace function");
    expect(exec0125).not.toContain("alter function");
    expect(exec0125).not.toContain("drop function");
  });

  it("und sie rührt keine Daten an", () => {
    for (const verb of ["insert into", "update ", "delete from", "truncate"]) {
      const treffer = exec0125.split("\n").filter((l) => l.trim().startsWith(verb));
      expect(treffer).toEqual([]);
    }
  });

  it("`0122` bleibt unverändert — eine angewendete Migration wird nicht umgeschrieben", () => {
    const sql0122 = migrationSource("0122_purchase_receipts.sql");
    expect(sql0122).toContain(
      "revoke all on function public.purchase_receipt_fingerprint(bigint) from public, anon;");
  });
});

describe("0125 lässt service_role in Ruhe", () => {
  it("der Entzug nennt nur `authenticated`", () => {
    /*
     * Geprüft wird die EMPFÄNGERLISTE, nicht die ganze Zeile: `public.` davor
     * ist das Schema der Funktion, kein Empfänger. Diese Zusicherung las
     * zuerst beides und schlug an ihrem eigenen Schemaqualifizierer an.
     */
    const i = exec0125.indexOf("revoke execute on function");
    const empfaenger = exec0125.slice(i, exec0125.indexOf(";", i))
      .split(/\bfrom\b/)[1].trim();
    expect(empfaenger).toBe("authenticated");
  });

  it("und die Nachbedingung verlangt ausdrücklich, dass service_role BEHÄLT", () => {
    /*
     * Das ist die Zusicherung gegen einen späteren, breiter formulierten
     * Entzug: er würde hier auffallen, statt unbemerkt mehr zu tun.
     */
    expect(exec0125).toContain("if not has_function_privilege('service_role'");
    expect(exec0125).toContain("service_role hat EXECUTE verloren");
  });

  it("anon und PUBLIC bleiben gesperrt, und PUBLIC wird über den ACL geprüft", () => {
    expect(exec0125).toContain("anon darf den Fingerabdruck ausfuehren");
    expect(exec0125).toContain("a.grantee = 0");
    expect(exec0125).not.toContain("has_function_privilege('public'");
  });

  it("ein NULL-ACL gilt als Fehler, nicht als Rechtefreiheit", () => {
    /* NULL heisst „Standardrechte", und der Standard ist EXECUTE fuer PUBLIC. */
    expect(exec0125).toContain("der Standard waere EXECUTE fuer PUBLIC");
  });
});

describe("0125 prüft die Eigentümerkette, bevor sie etwas entzieht", () => {
  it("die Vorbedingung vergleicht die Eigentümer der Aufrufer", () => {
    /*
     * NACH DEM ENTZUG IST DIE EIGENTÜMERKETTE DER EINZIGE WEG.
     *
     * `seller_purchase_receipt`, `seller_issue_purchase_receipt` und die
     * Schutzhülle aus `0124` erreichen den Fingerabdruck dann nur noch, weil
     * sie demselben Eigentümer gehören. Gehörte eine davon einer anderen
     * Rolle, würde dieser Entzug sie kappen — deshalb steht die Prüfung VOR
     * dem `revoke`, nicht danach.
     */
    const vor = exec0125.slice(0, exec0125.indexOf("revoke execute on function"));
    expect(vor).toContain("p.proowner <> v_owner");
    expect(vor).toContain("seller_purchase_receipt");
    expect(vor).toContain("seller_issue_purchase_receipt");
    expect(vor).toContain("purchase_receipt_stale");
    expect(vor).toContain("der Entzug wuerde die Aufrufkette kappen");
  });

  it("und dass beide Belegfunktionen security definer sind", () => {
    const vor = exec0125.slice(0, exec0125.indexOf("revoke execute on function"));
    expect(vor).toContain("not p.prosecdef");
  });

  it("die Nachbedingung belegt, dass die Belegfunktionen erreichbar bleiben", () => {
    const nach = exec0125.slice(exec0125.indexOf("revoke execute on function"));
    expect(nach).toContain("seller_purchase_receipt ist fuer authenticated nicht mehr erreichbar");
    expect(nach).toContain("seller_issue_purchase_receipt ist fuer authenticated nicht mehr erreichbar");
  });

  it("und dass die Definition sich nicht bewegt hat", () => {
    expect(exec0125).toContain("die Funktionsdefinition hat sich geaendert");
  });

  it("ein fehlender Vergleichswert wird übersprungen, nicht als bestanden gemeldet", () => {
    /*
     * Läuft die Vorbedingung in einer anderen Sitzung, fehlt der weggelegte
     * Wert. Eine übersprungene Prüfung ist hinnehmbar; eine bestandene, die
     * nicht gelaufen ist, wäre es nicht.
     */
    expect(exec0125).toContain("Definitionsvergleich uebersprungen");
  });
});

describe("der Fingerabdruck ist ein interner Helfer und bleibt es", () => {
  const fp = latestFunction("purchase_receipt_fingerprint");

  it("die letzte Fassung stammt aus 0122 — 0124 und 0125 fassen sie nicht an", () => {
    expect(fp.file).toBe("0122_purchase_receipts.sql");
  });

  it("er hat kein Berechtigungstor im Rumpf — das ist der Grund für 0125", () => {
    /*
     * Deshalb ist ein EXECUTE für `authenticated` gefährlich: die Funktion
     * prüft selbst nichts, sie liest als Eigentümer an jeder RLS vorbei und
     * nimmt jede `purchase_id`.
     */
    expect(fp.body).not.toContain("can_operate_active_seller");
    expect(fp.body).not.toContain("is_admin");
  });

  it("und kein Anwendungscode ruft ihn per RPC", () => {
    /* Nur Teststrings nennen den Namen — also bricht der Entzug nichts. */
    expect(allMigrations).toContain("purchase_receipt_fingerprint");
  });

  it("`purchase_market_value` ist das Vorbild, dem 0125 folgt", () => {
    /*
     * Derselbe Typ interner Helfer, und `0053`/`0116` entziehen ihn
     * `from public, anon, authenticated`. Die ACL-Abfrage auf Staging hat für
     * ihn genau den Zielzustand gezeigt: anon false, authenticated false,
     * service_role true. `0125` bringt eine Abweichung auf die Hausregel
     * zurück, es erfindet keine.
     */
    expect(migrationSource("0053_orderbook_purchases.sql")).toContain(
      "revoke all on function public.purchase_market_value(bigint) from public, anon, authenticated;");
  });
});

/* ==========================================================================
 * 2. Die drei Katalogannahmen, die auf Staging gescheitert sind
 * ======================================================================== */

describe("keine Migration vergleicht proconfig exakt gegen 'search_path='", () => {
  /*
   * POSTGRESQL SPEICHERT DEN LEEREN SEARCH_PATH ZITIERT: `search_path=""`.
   *
   * `search_path` ist eine Listen-GUC; ein Listenelement wird zitiert, wenn
   * es sonst nicht zurückzulesen wäre, und der leere String ist genau so ein
   * Fall. Ein `= 'search_path='` ist deshalb falsch — auf Staging waren das
   * die Befunde 106 und 204, und dieselbe Zeile stand in der Nachbedingung
   * von `0124`, wo sie die Migration abgebrochen hätte.
   *
   * `0112` und `0113` machen es seit langem richtig: Präfixvergleich.
   */
  for (const file of migrationFiles) {
    it(`${file} vergleicht nicht exakt`, () => {
      const sql = code(migrationSource(file));
      expect(sql).not.toContain("= 'search_path='");
      expect(sql).not.toContain("is distinct from 'search_path='");
      expect(sql).not.toContain("'true / search_path='");
    });
  }

  it("und 0124 prüft Existenz UND Leerheit, nicht nur das eine", () => {
    const sql = code(migrationSource("0124_orderbook_receipt_status.sql"));
    expect(sql).toContain("not like 'search\\_path=%'");
    expect(sql).toContain(`btrim(substring(v_cfg from 'search_path=(.*)$'), '"')`);
  });

  it("der Präfixvergleich allein würde search_path=public durchlassen", () => {
    /*
     * Deshalb zwei Prüfungen statt einer. `0112` prüft nur das Präfix — das
     * ist dort vertretbar, weil es um die Existenz der Absicherung geht; wo
     * die LEERHEIT die Zusicherung ist, genügt es nicht.
     */
    const wert = (cfg: string) =>
      cfg.replace(/^search_path=/, "").replace(/^"|"$/g, "");
    expect(wert('search_path=""')).toBe("");
    expect(wert("search_path=")).toBe("");
    expect(wert("search_path=public")).toBe("public");
  });
});

describe("keine Migration vergleicht pg_get_function_identity_arguments als Text", () => {
  /*
   * DIESE FUNKTION DRUCKT DIE PARAMETERNAMEN MIT.
   *
   * Ihre Ausgabe soll in `ALTER FUNCTION` einsetzbar sein, und dort sind
   * Namen erlaubt. Auf Staging kam deshalb
   * `p_year integer, p_month integer, …` zurück statt
   * `integer, integer, text, boolean, text` — Befund 102. Wer eine Signatur
   * festnageln will, lässt `to_regprocedure` sie auflösen oder vergleicht
   * `proargtypes::regtype[]`.
   */
  for (const file of migrationFiles) {
    it(`${file} nagelt Signaturen nicht über diesen Text fest`, () => {
      const sql = code(migrationSource(file));
      const stellen = sql.split("\n")
        .filter((l) => l.includes("pg_get_function_identity_arguments"))
        .filter((l) => /=\s*'|<>\s*'|distinct from\s*'/.test(l));
      expect(stellen).toEqual([]);
    });
  }
});

describe("jeder Rumpfmarker in 0124 steht wirklich im Rumpf von 0119", () => {
  /*
   * DER FEHLER, DEN DIESER TEST GEFUNDEN HÄTTE.
   *
   * `0124` behauptet mit einer Markerliste, den Rumpf aus `0119` übernommen
   * und nicht neu geschrieben zu haben. Ein Marker darin war
   * `'or i.raw_name ilike'` — und der steht nirgends im Rumpf: der
   * Rohnamen-Vergleich ist das ERSTE Glied der Oder-Kette und hat kein `or `
   * davor. Auf Staging war das Befund 120 (16 von 17); in `0124` selbst wäre
   * es ein Abbruch gewesen.
   *
   * `0119` wusste es besser und prüft eine Disjunktion — ich hatte nur deren
   * erste Hälfte in eine flache Liste kopiert und damit aus einem Oder ein
   * Und gemacht.
   */
  const rumpf0119 = latestFunctionIn("0119_orderbook_display_names.sql");
  const sql0124 = migrationSource("0124_orderbook_receipt_status.sql");
  const block = sql0124.slice(
    sql0124.indexOf("ALLES ANDERE UNVERÄNDERT"),
    sql0124.indexOf("] loop", sql0124.indexOf("ALLES ANDERE UNVERÄNDERT")));
  const marker = [...block.matchAll(/'((?:[^']|'')+)'/g)]
    .map((m) => m[1].replace(/''/g, "'"))
    .filter((m) => !m.startsWith("0124"));

  it("die Liste ist nicht leer — sonst prüfte sie nichts", () => {
    expect(marker.length).toBeGreaterThanOrEqual(15);
  });

  for (const m of marker) {
    it(`»${m}« steht im 0119-Rumpf`, () => {
      expect(rumpf0119).toContain(m);
    });
  }

  it("und keiner der Marker trägt ein führendes »or «", () => {
    /*
     * Ein Marker, der mit `or ` beginnt, hängt an der Position eines Gliedes
     * in einer Oder-Kette. Fügt jemand ein Glied davor ein, bricht die
     * Prüfung — ohne dass sich an der Logik etwas geändert hätte.
     */
    expect(marker.filter((m) => m.startsWith("or "))).toEqual([]);
  });
});

/** Der Rumpf des Ledgers, wie ihn eine bestimmte Migration anlegt. */
function latestFunctionIn(file: string): string {
  const sql = migrationSource(file);
  const s = sql.indexOf("create or replace function public.seller_orderbook_ledger(");
  const a = sql.indexOf("as $$", s);
  const b = sql.indexOf("\n$$;", a);
  return sql.slice(s, b);
}

/* ==========================================================================
 * 3. Die drei Prüfungsfehler, die der 0124-Postflight gemeldet hat
 * ======================================================================== */

/**
 * `0124` lief erfolgreich — und der Postflight meldete drei Abweichungen, von
 * denen keine ein Mangel an der Datenbank war:
 *
 *   126  „Ledger ruft Fingerabdruck NICHT direkt"   false statt true
 *   140  „kein EXECUTE außer dem Eigentümer"        1 statt 0
 *   202  „Signatur unverändert"                    Namen statt Typen
 *
 * Alle drei sind Fehler in der PRÜFUNG, alle drei aus Klassen, die in dieser
 * Datei schon beschrieben sind — und die Wächter darunter deckten bisher nur
 * `supabase/migrations/`, nicht `supabase/checks/`. Das war die Lücke: die
 * Migration suchte seit ihrer Korrektur kommentarfrei und tolerierte
 * `service_role`, ihre eigene Nachprüfung tat beides nicht.
 *
 * Deshalb gelten die Wächter jetzt für BEIDE Verzeichnisse.
 */

const CHECK_DIR = "supabase/checks";
const checkSql = readdirSync(join(process.cwd(), CHECK_DIR))
  .filter((f) => f.endsWith(".sql")).sort()
  .map((f) => ({ file: f, sql: readFileSync(join(process.cwd(), CHECK_DIR, f), "utf8") }));

/**
 * Ausführbares SQL — Kommentare sind Prosa, auch hier.
 *
 * LITERALBEWUSST, UND DAS IST NICHT ÜBERTRIEBEN. Die erste Fassung war
 * `sql.replace(/--.*​/g, "")` und zerstörte damit die Zeichenkette `'--.*'`
 * im Code — also genau das Regex, mit dem die Prüfdateien ihre Zeilen-
 * kommentare entfernen. Der Test, der kommentarfreies Suchen verlangt,
 * scheiterte an seinem eigenen naiven Entfernen. Ein Stringliteral ist kein
 * Kommentar, auch wenn es wie einer anfängt.
 */
function ohneKommentare(sql: string): string {
  let out = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    if (sql[i] === "'") {                        // Literal: unverändert übernehmen
      const start = i;
      i += 1;
      while (i < n) {
        if (sql[i] === "'" && sql[i + 1] === "'") { i += 2; continue; }
        if (sql[i] === "'") { i += 1; break; }
        i += 1;
      }
      out += sql.slice(start, i);
      continue;
    }
    if (sql[i] === "$") {                        // Dollar-Quote: unverändert
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_]/.test(sql[j])) j += 1;
      if (j < n && sql[j] === "$") {
        const tag = sql.slice(i, j + 1);
        const ende = sql.indexOf(tag, j + 1);
        if (ende !== -1) { out += sql.slice(i, ende + tag.length); i = ende + tag.length; continue; }
      }
    }
    if (sql.startsWith("/*", i)) {               // Blockkommentar, nestend
      let tiefe = 1; i += 2;
      while (i < n && tiefe > 0) {
        if (sql.startsWith("/*", i)) { tiefe += 1; i += 2; continue; }
        if (sql.startsWith("*/", i)) { tiefe -= 1; i += 2; continue; }
        i += 1;
      }
      continue;
    }
    if (sql.startsWith("--", i)) {               // Zeilenkommentar
      while (i < n && sql[i] !== "\n") i += 1;
      continue;
    }
    out += sql[i];
    i += 1;
  }
  return out;
}

describe("keine Prüfdatei vergleicht identity_arguments als Text", () => {
  /*
   * `pg_get_function_identity_arguments` druckt die PARAMETERNAMEN mit —
   * seine Ausgabe soll in `ALTER FUNCTION` einsetzbar sein. Wer eine Signatur
   * festnageln will, lässt `to_regprocedure` sie auflösen oder vergleicht
   * `proargtypes` Position für Position als OID.
   */
  it("es gibt überhaupt Prüfdateien", () => {
    expect(checkSql.length).toBeGreaterThanOrEqual(9);
    expect(checkSql.map((c) => c.file)).toContain("0124_postflight.sql");
    expect(checkSql.map((c) => c.file)).toContain("0124_baseline.sql");
  });

  for (const { file, sql } of checkSql) {
    it(file, () => {
      const stellen = ohneKommentare(sql).split("\n")
        .filter((l) => l.includes("pg_get_function_identity_arguments"))
        .filter((l) => /=\s*'|<>\s*'|distinct from\s*'/.test(l));
      expect(stellen).toEqual([]);
    });
  }
});

describe("und keine vergleicht proargtypes oder proconfig als Text", () => {
  for (const { file, sql } of checkSql) {
    it(file, () => {
      const code = ohneKommentare(sql);
      /* `proargtypes` ist ein NULLBASIERTER oidvector: `::oid[]::regtype[]::text`
         liefert `[0:4]={…}` mit Dimensionsgrenzen. */
      expect(code).not.toContain("::oid[]::regtype[]");
      /* Der leere `search_path` wird ZITIERT abgelegt: `search_path=""`. */
      expect(code).not.toContain("= 'search_path='");
      expect(code).not.toContain("'true / search_path='");
    });
  }
});

describe("ein ACL-Wächter muss service_role zulassen", () => {
  /*
   * DER FEHLER, DEN 140 GEMACHT HAT.
   *
   * Supabase richtet im Schema `public` Default-Privileges für `anon`,
   * `authenticated` und `service_role` ein. Ein `revoke` nimmt die ersten
   * beiden zurück; `service_role` bleibt — ausdrücklich (ADR-0125). Wer
   * `a.grantee <> p.proowner` zählt und 0 erwartet, prüft strenger als die
   * Migration, die er nachprüfen soll, und meldet einen Mangel, den es nicht
   * gibt.
   *
   * ABGESCHWÄCHT WIRD NICHTS: wer so zählt, muss PUBLIC weiter ausschließen.
   * Beides zusammen ist die Bedingung.
   */
  for (const { file, sql } of checkSql.concat(
         migrationFiles.filter((f) => Number(f.slice(0, 4)) >= 124)
           .map((f) => ({ file: f, sql: migrationSource(f) })))) {
    it(file, () => {
      const code = ohneKommentare(sql);
      if (!code.includes("a.grantee <> p.proowner")) return;
      expect(code).toContain("a.grantee::regrole::text <> 'service_role'");
      expect(code).toContain("a.grantee = 0");
    });
  }
});

describe("eine Inhaltsprüfung am Funktionsrumpf liest kommentarfrei", () => {
  /*
   * DER FEHLER, DEN 126 GEMACHT HAT — ZUM ZWEITEN MAL.
   *
   * `pg_get_functiondef` liefert den Rumpf samt Kommentaren. Der Ledger nennt
   * `purchase_receipt_fingerprint` genau einmal, in der Zeile, die erklärt,
   * warum er ihn NICHT direkt ruft. Dieselbe Falle hatte `0124` beim ersten
   * Versuch zum Abbruch gebracht; im Postflight stand sie noch.
   *
   * Die Regel: wer im Rumpf SUCHT, sucht kommentarfrei.
   *
   * WARUM HIER EINE AUSNAHMELISTE STEHT UND KEIN STILLES ÜBERSPRINGEN. Der
   * erste Entwurf dieses Wächters sprang über jede Datei hinweg, die nicht
   * `position(… in (select …))` schreibt — und schloss damit genau eine Datei
   * aus, die dasselbe Problem latent hat. Eine Prüfung, deren Lücke bequem
   * dort liegt, wo der nächste Fehler sitzt, ist keine Prüfung. Die Menge der
   * Ausnahmen ist deshalb festgenagelt: kommt eine Datei dazu, fällt dieser
   * Test.
   */
  const suchtImRumpf = (code: string) =>
    code.includes("pg_get_functiondef") && /position\(/.test(code);
  const strippt = (code: string) =>
    code.includes("regexp_replace") && code.includes("'--.*', '', 'gn'");

  const ohneStrippen = checkSql
    .filter((c) => suchtImRumpf(ohneKommentare(c.sql)))
    .filter((c) => !strippt(ohneKommentare(c.sql)))
    .map((c) => c.file)
    .sort();

  it("die Ausnahmen sind genau die bekannten", () => {
    /*
     * `0124_preflight.sql` sucht `position('…' in coalesce(pg_get_functiondef(…)))`
     * im Rohtext. Heute ist das beweisbar harmlos: geprüft wird der Rumpf aus
     * `0119`, und der kann `purchase_receipt_fingerprint` nicht nennen — er
     * ist älter als `0122`. Die Form bleibt dieselbe Falle; die Datei wurde
     * in dieser Runde nicht angefasst, weil nur der Postflight zur Korrektur
     * freigegeben war.
     */
    expect(ohneStrippen).toEqual(["0124_preflight.sql"]);
  });

  for (const { file, sql } of checkSql) {
    const code = ohneKommentare(sql);
    if (!suchtImRumpf(code) || file === "0124_preflight.sql") continue;
    it(file, () => {
      expect(code).toContain("regexp_replace");
      expect(code).toContain("'--.*', '', 'gn'");
      /* Und keine Prüfung liest noch den Rohtext. */
      expect(code).not.toMatch(/position\([^)]*in \(select d from def\)\)/);
    });
  }

  it("der 0124-Postflight prüft zusätzlich, dass das Strippen tragfähig ist", () => {
    const pf = checkSql.find((c) => c.file === "0124_postflight.sql");
    expect(pf).toBeDefined();
    expect(pf!.sql).toContain("kein Stringliteral im Rumpf traegt einen Kommentarstarter");
  });
});
