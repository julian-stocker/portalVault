import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

/*
 * ===========================================================================
 * DIE ZWEI VERBLEIBENDEN SYNC-BLOCKER
 *
 *   1  `system_set_image_override` (0035) fehlt auf Production — 0 Fassungen,
 *      am 2026-10-30 gemessen. 7 Bildschritte haengen daran.
 *   2  17 Bildobjekte fehlen im jeweiligen Ziel-Bucket.
 *
 * Diese Datei nagelt fest, was dafuer vorbereitet ist — und die zwei
 * Zusagen, die dabei am leichtesten verlorengehen: nichts wird
 * ueberschrieben, nichts geloescht.
 * ===========================================================================
 */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").filter((z) => !z.trimStart().startsWith("--") && !z.trimStart().startsWith("//"))
  .join("\n");

const H0035 = readFileSync("supabase/operations/prod-0035.sql", "utf8");
const M0035 = readFileSync("supabase/migrations/0035_system_set_image_override.sql", "utf8");
const PRE = readFileSync("supabase/checks/prod_0035_preflight.sql", "utf8");
const POST = readFileSync("supabase/checks/prod_0035_postflight.sql", "utf8");
const R0035 = readFileSync("supabase/rollback/R0035_drop_system_set_image_override.sql", "utf8");
const TRANSFER = readFileSync("tools/storage-transfer.mts", "utf8");

describe("0035 ist die einzige Quelle der Funktion", () => {
  /*
   * DAS IST DER GRUND, WARUM EINE HISTORISCHE AUSFUEHRUNG NICHT BEWEISBAR
   * IST: `0035` legt genau EIN Objekt an. Es gibt kein zweites, an dem man
   * die Migration erkennen koennte. Kaeme je ein weiteres dazu, waere die
   * Aussage im Kopf der Huelle falsch — dieser Test merkt es.
   */
  it("sie legt genau ein Objekt an — die Funktion", () => {
    /*
     * RUMPFBEWUSST. Das `update public.skylanders` in `0035` ist der Rumpf
     * der Funktion — es wird ANGELEGT, nicht ausgefuehrt. Eine erste Fassung
     * dieses Tests hat es als Fremdzugriff angeklagt; derselbe Fehler wie
     * bei `prod-0165.sql`, wo zwei `insert` im Rumpf stehen.
     */
    const z = code(M0035).split("\n");
    const start = z.findIndex((x) => x.startsWith("create or replace function"));
    const ende = z.findIndex((x, i) => i > start && x.trim() === "$$;");
    expect(start).toBeGreaterThan(-1);
    expect(ende).toBeGreaterThan(start);
    const ausserhalb = z
      .map((x, i) => [x, i] as const)
      .filter(([x, i]) => (i < start || i > ende)
        && /^\s*(create|alter|drop|grant|revoke|comment|insert|update)\s/i.test(x));
    expect(ausserhalb.length).toBeGreaterThan(0);
    for (const [a] of ausserhalb) {
      expect(a, `${a.trim()} fasst etwas anderes an`)
        .toContain("system_set_image_override");
    }
  });

  it("keine spätere Migration löscht, ersetzt oder benennt sie um", () => {
    const treffer = readdirSync("supabase/migrations")
      .filter((f) => f.endsWith(".sql") && !f.startsWith("0035"))
      .map((f) => [f, code(readFileSync(`supabase/migrations/${f}`, "utf8"))] as const)
      .filter(([, s]) => /(?:drop|alter)\s+function[^;]*system_set_image_override/i.test(s));
    expect(treffer.map(([f]) => f)).toEqual([]);
  });

  it("sie ist idempotent — create or replace, revoke, grant", () => {
    expect(M0035).toContain("create or replace function");
    expect(M0035).toContain("revoke all on function");
    expect(M0035).toContain("grant  execute on function");
  });
});

describe("die Production-Hülle für 0035", () => {
  it("bettet die Migration zeichengleich ein", () => {
    const a = "-- >>> EINGEBETTET: supabase/migrations/0035_system_set_image_override.sql\n";
    const b = "-- <<< ENDE: supabase/migrations/0035_system_set_image_override.sql\n";
    expect(H0035.slice(H0035.indexOf(a) + a.length, H0035.indexOf(b))).toBe(M0035);
  });

  it("eine Transaktion, DDL nur auf dem einen Objekt", () => {
    const z = code(H0035).split("\n");
    expect(z.filter((x) => x === "begin;")).toHaveLength(1);
    expect(z.filter((x) => x === "commit;")).toHaveLength(1);
    for (const x of z.filter((y) =>
        /^\s*(create|alter|drop|grant|revoke|comment)\s/i.test(y))) {
      expect(x).toContain("system_set_image_override");
    }
    /*
     * Auch hier rumpfbewusst: das einzige `update` ist das der Funktion.
     * Ausserhalb des Rumpfs darf keines stehen.
     */
    const start = z.findIndex((x) => x.startsWith("create or replace function"));
    const ende = z.findIndex((x, i) => i > start && x.trim() === "$$;");
    z.forEach((x, i) => {
      if (/^\s*(insert|update|delete|truncate)\s/i.test(x)) {
        expect(i, `Zeile ${i + 1} schreibt ausserhalb des Funktionsrumpfs`)
          .toBeGreaterThan(start);
        expect(i).toBeLessThan(ende);
      }
    });
  });

  it("der Umgebungsnachweis ist positiv und hängt nicht an SKY-0821/0822", () => {
    expect(H0035).toContain("purchases_paid_total_is_final");
    expect(H0035).toContain("purchases_paid_total_immutable_trg");
    expect(code(H0035)).not.toContain("SKY-0821");
    expect(code(H0035)).not.toContain("SKY-0822");
  });

  it("und sie prüft, dass nichts sich bewegt hat", () => {
    for (const m of ["ABBRUCH B1", "ABBRUCH B2", "ABBRUCH B3", "ABBRUCH B4", "ABBRUCH B5"]) {
      expect(H0035, `${m} fehlt`).toContain(m);
    }
  });
});

describe("Prüfdateien und Rücknahme zu 0035", () => {
  it.each([["Preflight", PRE], ["Postflight", POST]])(
    "%s ist eine einzige lesende Anweisung", (_n, sql) => {
      const c = code(sql);
      for (const m of ["begin;", "commit;", "rollback;", "do $"]) expect(c).not.toContain(m);
      expect(c.split(";").filter((x) => x.trim() !== "")).toHaveLength(1);
    });

  /*
   * DER RUMPFABDRUCK IST EINE ERWARTUNG. 889 Zeichen aus der
   * Migrationsdatei; weicht er ab, laeuft dort eine andere Funktion.
   */
  it("der Postflight pinnt den Rumpfabdruck aus der Migrationsdatei", () => {
    expect(POST).toContain("'f269a6fe05349cad53c0cf44a8e01e11'");
    expect(PRE).toContain("f269a6fe05349cad53c0cf44a8e01e11");
  });

  it("der Postflight prüft die Rechte einzeln, PUBLIC eingeschlossen", () => {
    for (const r of ["'service_role'", "'anon'", "'authenticated'", "'public'"]) {
      expect(POST).toContain(r);
    }
  });

  it("er entquotet den search_path", () => {
    expect(POST).toContain("btrim(substring(c from 'search_path=(.*)$'), '\"')");
  });

  it("eine fehlende Baseline fällt durch", () => {
    expect(POST).toContain("BASELINE-PLATZHALTER");
    expect((code(POST).match(/\(BASELINE FEHLT\)/g) ?? []).length).toBeGreaterThanOrEqual(6);
  });

  it("die Rücknahme verwirft keine Daten und prüft Abhängigkeiten", () => {
    expect(R0035).toContain("drop function public.system_set_image_override(text, text)");
    expect(R0035).toContain("A3 ABBRUCH");
    expect(R0035).toContain("position('system_set_image_override' in p.prosrc)");
    expect(code(R0035)).not.toMatch(/^\s*(update|delete|truncate)\s/m);
  });
});

describe("das Transferwerkzeug für die 17 Bildobjekte", () => {
  /*
   * DIE ZWEI ZUSAGEN, DIE AM LEICHTESTEN VERLORENGEHEN. Ein `upsert: true`
   * oder ein `remove` waere hier ein Datenverlust, und beides ist eine
   * Zeichenaenderung weit.
   */
  it("es überschreibt nie", () => {
    expect(code(TRANSFER)).not.toContain("upsert: true");
    expect(TRANSFER).toContain("upsert: false");
  });

  it("und es löscht nie", () => {
    expect(code(TRANSFER)).not.toContain(".remove(");
  });

  it("ohne --apply schreibt es nichts", () => {
    expect(TRANSFER).toContain('const ANWENDEN = process.argv.includes("--apply")');
    expect(TRANSFER).toContain("if (!ANWENDEN) {");
  });

  it("die Liste kommt aus dem Dry-Run, nicht aus einer zweiten Quelle", () => {
    expect(TRANSFER).toContain('x.feld === "image_override_path"');
    expect(TRANSFER).toContain("resources/analysis/sync-dryrun.json");
  });

  /*
   * DREI UNABHAENGIGE PRUEFUNGEN: der Name IST die Pruefsumme (gemessen:
   * alle 17 Dateinamen sind die ersten 16 Hexstellen ihres SHA-256), der
   * Byte-Vergleich nach dem Upload, und die Pruefsumme des
   * Zurueckgelesenen.
   */
  it("es prüft den Namen gegen den Inhalt, die Bytes und die Prüfsumme", () => {
    expect(TRANSFER).toContain("e.sha_quelle.startsWith(nameAusPfad(s.pfad))");
    expect(TRANSFER).toContain("buf.equals(zbuf)");
    expect(TRANSFER).toContain("e.sha_ziel !== e.sha_quelle");
  });

  it("und jeder Pfad muss die SKY-ID seiner Figur tragen", () => {
    expect(TRANSFER).toContain('s.pfad.split("/")[0] !== s.sky_id');
    expect(TRANSFER).toContain("RIEGEL 3");
  });

  /*
   * ZWEI RICHTUNGEN SIND ZWEI FREIGABEN.
   *
   * Die erste Fassung kannte keine Richtungsauswahl und haette mit `--apply`
   * in BEIDE Umgebungen geschrieben — aus zwei Freigaben wäre eine geworden.
   * `--apply` verlangt jetzt `--ziel`; der Trockenlauf darf weiter beide
   * zeigen, er schreibt nichts.
   */
  it("ein Apply ohne Richtung ist nicht möglich", () => {
    expect(TRANSFER).toContain("RIEGEL 0");
    expect(TRANSFER).toContain("if (ANWENDEN && ZIEL_ARG === null)");
    expect(TRANSFER).toContain("process.exit(1)");
  });

  it("--ziel nimmt nur staging oder production", () => {
    expect(TRANSFER).toContain('w !== "staging" && w !== "production"');
  });

  it("und eine leere Auswahl bricht ab, statt still nichts zu tun", () => {
    /*
     * RIEGEL 2b WAR BIS ZUM 2026-10-31 UNERREICHBAR, und dieser Test hat es
     * nicht gemerkt: er prueefte nur, dass der Text im Quelltext steht.
     * Riegel 2 hatte dieselbe Bedingung (`schritte.length === 0`) und brach
     * vorher ab — mit der falschen Meldung, der Dry-Run nenne keinen
     * Bildschritt, obwohl er 17 nannte.
     *
     * Jetzt prueft Riegel 2 den PLAN (`alleSchritte`) und 2b die AUSWAHL.
     * Beide ruhen im Pruefmodus, wo eine leere Auswahl der Normalfall ist —
     * dort haelt die eigene Leerprobe des Pruefblocks dagegen.
     */
    expect(TRANSFER).toContain("RIEGEL 2b");
    expect(TRANSFER).toContain("if (schritte.length === 0 && !PRUEFEN)");
    expect(TRANSFER).toContain("if (alleSchritte.length === 0 && !PRUEFEN)");
    // die beiden Riegel pruefen VERSCHIEDENE Mengen — sonst ist einer blind
    expect(TRANSFER).not.toMatch(/if \(schritte\.length === 0\) \{/);
    // und der Pruefmodus hat seine eigene Leerprobe
    expect(TRANSFER).toContain("bedarf.length === 0");
    expect(TRANSFER).toContain("Das ist kein `");
  });

  /*
   * DIE SKRIPTE SPIEGELN DAS. Es gibt keinen richtungslosen Apply mehr —
   * weder als Skript noch als Aufruf.
   */
  it("package.json führt je Richtung ein Apply-Skript und keines ohne", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as
      { scripts: Record<string, string> };
    expect(pkg.scripts["storage:transfer:apply:staging"])
      .toBe("node tools/storage-transfer.mts --ziel staging --apply");
    expect(pkg.scripts["storage:transfer:apply:production"])
      .toBe("node tools/storage-transfer.mts --ziel production --apply");
    expect(pkg.scripts["storage:transfer:apply"]).toBeUndefined();
    // Der Trockenlauf bleibt richtungslos aufrufbar.
    expect(pkg.scripts["storage:transfer:plan"]).toBe("node tools/storage-transfer.mts");
  });
});
