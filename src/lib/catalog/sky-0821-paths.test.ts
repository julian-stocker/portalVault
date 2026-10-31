import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

/*
 * ===========================================================================
 * DIE REFERENZPFADE VON SKY-0821 — UND DER FEHLER VOM 2026-10-30
 *
 * Der SKY-0821-Preflight ist auf Staging abgebrochen:
 *
 *     ERROR 42P01: relation "public.availability_alerts" does not exist
 *
 * Die Liste der Referenzpfade darin war aus `references public.skylanders`
 * IM QUELLTEXT DER MIGRATIONEN gegrept. `0150`, die `availability_alerts`
 * anlegt, ist aber weder auf Staging noch auf Production angewendet. Eine
 * Migration im Repository ist keine Tabelle in der Datenbank.
 *
 * Diese Datei haelt beide Haelften der Korrektur fest: dass die Pfade jetzt
 * aus dem KATALOG kommen, und dass kein Werkzeug einen fehlenden Pfad mehr
 * als leer behandelt.
 * ===========================================================================
 */

const lies = (p: string) => readFileSync(p, "utf8");

const PREFLIGHT = "supabase/checks/sky_0821_renumber_preflight.sql";
const LAUF = "supabase/operations/staging-sky-0821-renumber.sql";
const POSTFLIGHT = "supabase/checks/sky_0821_renumber_postflight.sql";
const WERKZEUG = "tools/sync-collision-report.mts";

/**
 * Die Migrationen, die laut `APPLIED.md` auf BEIDEN Umgebungen offen sind.
 * Was sie anlegen, existiert nirgends — und darf in keiner Datei vorkommen,
 * die gegen eine der beiden Umgebungen laeuft.
 */
const OFFEN_UEBERALL = ["0150", "0151"];

/** Welche Tabellen legt eine Migration an? */
function tabellenAus(nummer: string): string[] {
  const datei = readdirSync("supabase/migrations").find((f) => f.startsWith(nummer));
  if (!datei) return [];
  const sql = lies(`supabase/migrations/${datei}`);
  return [...sql.matchAll(/create table (?:if not exists )?public\.([a-z_0-9]+)/g)]
    .map((m) => m[1]);
}

describe("der Fehler vom 2026-10-30 kann nicht wiederkommen", () => {
  /*
   * DIE AKTE SAGT ES, UND SIE MUSS ES WEITER SAGEN. Sollte `0150` eines Tages
   * angewendet werden, bricht dieser Test — und dann gehoert
   * `availability_alerts` tatsaechlich in die Pruefungen. Ein Test, der die
   * Lage einfriert, waere hier falsch; dieser friert die QUELLE ein.
   */
  it("APPLIED.md fuehrt 0150 und 0151 auf beiden Umgebungen als offen", () => {
    const akte = lies("supabase/migrations/APPLIED.md");
    const zeilen = akte.split("\n").filter((z) => z.includes("| Staging `qqxcpesbwfxzgytkdsac`")
      || z.includes("| Production `zmiwxswrpkmizvqsgype`"));
    expect(zeilen).toHaveLength(2);
    for (const z of zeilen) {
      const offen = z.split("|").at(-2) ?? "";
      for (const m of OFFEN_UEBERALL) expect(offen).toContain(m);
    }
  });

  it("0150 legt availability_alerts an — das ist die Tabelle, die fehlte", () => {
    expect(tabellenAus("0150")).toContain("availability_alerts");
  });

  it.each([PREFLIGHT, LAUF, POSTFLIGHT])(
    "%s nennt keine Tabelle einer nirgends angewendeten Migration", (datei) => {
      const code = lies(datei)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n").filter((z) => !z.trimStart().startsWith("--")).join("\n");
      const verboten = OFFEN_UEBERALL.flatMap(tabellenAus);
      expect(verboten.length).toBeGreaterThan(0);
      for (const t of verboten) {
        expect(code, `${datei} nennt ${t}, aber die Tabelle existiert nirgends`)
          .not.toMatch(new RegExp(`public\\.${t}\\b`));
      }
    });
});

describe("der Preflight liest die Pfade aus dem Katalog, nicht aus einer Liste", () => {
  const sql = lies(PREFLIGHT);

  it("er fragt pg_constraint", () => {
    expect(sql).toContain("from pg_constraint c");
    expect(sql).toContain("c.confrelid = to_regclass('public.skylanders')");
  });

  it("und zaehlt ueber query_to_xml, weil eine lesende Anweisung kein execute kann", () => {
    expect(sql).toContain("query_to_xml(");
    expect(sql).toContain("format('select count(*) as c from public.%I where %I = %L'");
  });

  /*
   * `confdeltype` ist `"char"`. Ohne Cast scheitert jede Verkettung an
   * `42725 operator is not unique: text || "char"` — dieselbe Fehlerklasse,
   * die `0133` am 2026-10-18 gekostet hat, und sie ist mir bei
   * `sky_id_reference_paths.sql` am 2026-10-30 noch einmal passiert.
   */
  it("confdeltype ist ausdruecklich nach text gecastet", () => {
    expect(sql).toContain("c.confdeltype::text");
    expect(sql).not.toMatch(/\|\|\s*c\.confdeltype\b(?!::)/);
  });

  it("die Struktur ist festgenagelt: Anzahl, Namen, Cascade-Schluessel, Abdruck", () => {
    expect(sql).toContain("'14'");                               // 145
    expect(sql).toContain("skylanders.base_sky_id");             // 146
    expect(sql).toContain("'a221fee44b98985c7903fd09fbdf8516'"); // 150
    for (const t of ["cart_items", "catalog_editorial", "inventory_import_mappings",
                     "orderbook_name_mappings"]) {
      expect(sql, `${t} ist ein ON DELETE CASCADE-Pfad und muss in 147 stehen`).toContain(t);
    }
  });

  it("der stille Weg ohne Fremdschluessel steht namentlich drin", () => {
    expect(sql).toContain("ohne_fk (tabelle, spalte) as (values ('order_lines', 'sky_id'))");
  });

  it("und ein unbestimmter Zaehlstand gilt NICHT als null", () => {
    expect(sql).toContain("kein Pfad ohne bestimmten Zaehlstand");
    expect(sql).toContain("where zeilen is null");
  });

  it("er bleibt eine einzige lesende Anweisung", () => {
    const code = sql.replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n").filter((z) => !z.trimStart().startsWith("--")).join("\n");
    for (const m of ["begin;", "commit;", "rollback;", "set_config(", "do $"]) {
      expect(code, `der Preflight darf ${m} nicht enthalten`).not.toContain(m);
    }
    expect(code.split(";").filter((x) => x.trim() !== "")).toHaveLength(1);
  });
});

describe("die Messung gab es schon, und sie bleibt die Quelle", () => {
  /*
   * `cat09_delete_references.sql` leitet die Pfade seit CAT-09 aus
   * `pg_constraint` her und laeuft in der Staging-Suite. Die
   * handgeschriebene Liste im Preflight war also nicht nur falsch, sie war
   * ueberfluessig. Dieser Test haelt fest, dass die vorhandene Messung
   * bestehen bleibt — und dass keine zweite daneben entsteht.
   */
  it("cat09_delete_references liest aus pg_constraint und steht in der Suite", () => {
    const sql = lies("supabase/checks/cat09_delete_references.sql");
    expect(sql).toContain("from pg_constraint c");
    /*
     * Es nennt `order_lines` NICHT — es FINDET den stillen Weg, indem es
     * jede Spalte mit `sky_id` im Namen sucht, die keinen Fremdschluessel
     * traegt. Das ist strenger als meine namentliche Liste im Preflight:
     * ein zweites `order_lines` fiele dort von allein auf.
     */
    expect(sql).toContain("a.attname like '%sky_id%'");
    expect(sql).toContain("and not exists (");
    const suite = JSON.parse(lies("supabase/checks/staging-suite.json")) as
      { dateien: { datei: string }[] };
    expect(suite.dateien.map((d) => d.datei)).toContain("cat09_delete_references.sql");
  });

  it("und es gibt keine zweite Datei, die dasselbe misst", () => {
    expect(readdirSync("supabase/checks"))
      .not.toContain("sky_id_reference_paths.sql");
  });
});

describe("Lauf und Postflight bleiben, wie sie waren — sie trugen den Fehler nicht", () => {
  it("der Lauf zaehlt ueber admin_merge_references, also dynamisch", () => {
    const sql = lies(LAUF);
    expect(sql).toContain("public.admin_merge_references('SKY-0821')");
    // Plus die zwei Wege, die diese Funktion nicht abdeckt.
    expect(sql).toContain("from public.order_lines where sky_id = 'SKY-0821'");
    expect(sql).toContain("where base_sky_id = 'SKY-0821'");
  });

  /*
   * `admin_merge_references` NIMMT `catalog_editorial` AUS (0159), weil die
   * redaktionelle Zeile der Figur selbst gehoert und `admin_delete_figure`
   * sie ausdruecklich loescht. Wer die Funktion zum Zaehlen benutzt, muss das
   * wissen — sonst haelt er 13 Pfade fuer 14.
   */
  it("admin_merge_references nimmt catalog_editorial aus, und zwar bewusst", () => {
    const m0159 = lies("supabase/migrations/0159_variant_base_figure.sql");
    expect(m0159).toContain("c.conrelid <> 'public.catalog_editorial'::regclass");
    expect(lies("supabase/migrations/0162_admin_price_and_delete.sql"))
      .toContain("delete from public.catalog_editorial where sky_id = p_sky_id;");
  });
});

describe("das Messwerkzeug behandelt UNBESTIMMT nicht als null", () => {
  const voll = lies(WERKZEUG);
  /* Ohne Kommentare — dort DARF `count ?? 0` stehen, es erklaert den Fehler. */
  const code = voll.replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").filter((z) => !z.trimStart().startsWith("//")).join("\n");

  /*
   * DIE EIGENTLICHE URSACHE. PostgREST antwortet auf HEAD gegen eine
   * fehlende Tabelle mit 204 OHNE Fehler, `count` ist dann `null`. Ein
   * `count ?? 0` macht daraus eine Null — und der Bericht meldet „0
   * Verweise" fuer eine Tabelle, die es nicht gibt.
   */
  it("nirgends wird ein Zaehlstand mit `?? 0` zu einer Null", () => {
    expect(code).not.toMatch(/count\s*\?\?\s*0/);
    expect(code).not.toMatch(/anzahl\s*\?\?\s*0\s*\)\s*>/);
  });

  it("stattdessen zwei benannte Helfer, die unbekannt von leer trennen", () => {
    expect(code).toContain("const belegt = (x: { anzahl: number | null }) =>"
      + " x.anzahl !== null && x.anzahl > 0;");
    expect(code).toContain("const summeOderNull =");
  });

  it("es tastet erst OHNE head, weil nur das eine fehlende Tabelle meldet", () => {
    expect(code).toContain('.select(spalte).limit(0)');
    expect(code).toContain("tast.error");
  });

  it("ein fehlender Zaehlstand wird ausdruecklich als unbestimmt gemeldet", () => {
    expect(code).toContain("if (count === null)");
    expect(code).toContain("UNBESTIMMT");
  });

  it("und eine Summe wird verweigert, wenn ein Pfad unbestimmt ist", () => {
    expect(code).toContain("xs.some((x) => x.anzahl === null) ? null");
    expect(code).toContain('x.zustand === "unbestimmt"');
  });

  /*
   * DREI ZUSTAENDE, NICHT ZWEI. Eine Tabelle, die es NICHT GIBT, ist
   * tatsaechlich null Verweise — zu ihr kann keine Zeile gehoeren. Nur „keine
   * Antwort" ist es nicht. Der Fehler vom 2026-10-30 war, beides
   * gleichzusetzen; die Korrektur ist, sie zu TRENNEN, nicht beides als
   * unbestimmt zu behandeln.
   */
  it("fehlende Tabelle und unbestimmte Messung sind zwei verschiedene Zustaende", () => {
    expect(code).toContain('tast.error.code === "PGRST205"');
    expect(code).toContain('zustand: fehlt ? "fehlt" : "unbestimmt"');
    expect(code).toContain('zustand: "gezaehlt"');
  });

  it("die Entscheidungstabelle urteilt nicht ueber eine unvollstaendige Messung", () => {
    expect(code).toContain("if (offenP > 0 || offenS > 0)");
    expect(code).toContain("nichts entscheiden");
  });
});

/*
 * ===========================================================================
 * DIE NACHKONTROLLE BRAUCHT KEINE ANGABE MEHR
 *
 * Am 2026-10-30 ist die Umnummerierung geglueckt und die Nachkontrolle
 * trotzdem mit 19 blockierenden Abweichungen gescheitert: sie verlangte die
 * neue SKY-ID und die Baseline als `set_config`, und der Lauf hatte die
 * Nummer nur transaktionslokal abgelegt — mit dem `commit` war sie fort.
 *
 * Eine Nachkontrolle, die eine Angabe braucht, die der Vorgang selbst nicht
 * hinterlaesst, ist falsch gebaut. Diese Tests halten die Korrektur fest.
 * ===========================================================================
 */
describe("der Postflight leitet die neue SKY-ID ab, statt sie zu verlangen", () => {
  const sql = lies(POSTFLIGHT);

  it("drei unabhaengige Wege, und keiner ist ein eingetragener Wert", () => {
    expect(sql).toContain("w_band as (");
    expect(sql).toContain("w_name as (");
    expect(sql).toContain("w_notiz as (");
    expect(sql).toContain("where sky_id between 'SKY-0928' and 'SKY-4999'");
    expect(sql).toContain("where name = 'Gold Fire Kraken'");
    expect(sql).toContain("where admin_note like '%SKY-0821%'");
  });

  it("jeder Weg muss EINDEUTIG sein und alle drei muessen uebereinstimmen", () => {
    for (const nr of ["(101,", "(102,", "(103,", "(104,", "(105,"]) {
      expect(sql, `Pruefzeile ${nr} fehlt`).toContain(nr);
    }
    expect(sql).toContain("und alle drei Wege nennen dieselbe");
  });

  /*
   * EINE AUSDRUECKLICHE ANGABE DARF WEITER GEWINNEN. Die Ableitung ist der
   * Vorgabewert, nicht ein Zwang — wer eine bestimmte Nummer pruefen will,
   * setzt sie, und Zeile 2 sagt, welche Herkunft gegolten hat.
   */
  it("eine uebergebene Nummer hat Vorrang, und die Herkunft wird genannt", () => {
    expect(sql).toContain("current_setting('skyisles.neu', true)");
    expect(sql).toContain("Nummer abgeleitet");
    expect(sql).toContain("Baseline aus der Datei");
  });

  it("die Baseline steht mit Herkunft in der Datei und prueft sich selbst", () => {
    expect(sql).toContain(
      "'skyisles-0821-1|694|1066|287|21|d1e68c3afd1c5d2a005da61c5fa9c39b|d464d3436a04'");
    expect(sql).toContain("(303, 'Baseline', 'ihre Selbstprobe stimmt");
  });

  it("und der Lauf behauptet nicht mehr, die Nummer muesse uebernommen werden", () => {
    const lauf = lies(LAUF);
    expect(lauf).toContain("TRANSAKTIONSLOKAL");
    expect(lauf).toContain("findet diese Nummer von selbst");
  });
});
