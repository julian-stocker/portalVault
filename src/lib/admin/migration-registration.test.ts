import { describe, expect, it } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";

/* ==========================================================================
 * JEDE MIGRATION IST IM RUNNER REGISTRIERT — und zwar VOLLSTÄNDIG
 *
 * ANLASS, und er gehört hierher: `0165` lag fertig im Verzeichnis, mit
 * Rücknahme, 16 Tests und bestandenem `npm run check` — und der Runner
 * kannte sie nicht. Der Betreiber hat die Migration freigegeben, der Befehl
 * brach mit „fuer 0165 gibt es keinen Plan" ab. Vier grüne Prüfungen hatten
 * das nicht gefunden, weil keine die Registrierung ansah.
 *
 * Diese Datei schließt genau diese Lücke: sie prüft die VERBINDUNG zwischen
 * Migrationsdatei, Plan und den drei SQL-Dateien, die der Plan nennt — nicht
 * die Migrationen und nicht den Plan für sich.
 * ========================================================================== */

const MIG_DIR = "supabase/migrations";
const CHECK_DIR = "supabase/checks";
const OPS_DIR = "supabase/operations";
const PLAENE = `${CHECK_DIR}/migration-plans.json`;

type Plan = {
  zweck: string; preflight: string; lauf: string; postflight: string;
  angewendet: { beschreibung: string; sql: string };
  liefert?: Record<string, number>;
  braucht?: string[];
};

const plaene = (JSON.parse(readFileSync(PLAENE, "utf8")) as
  { migrationen: Record<string, Plan> }).migrationen;

/** Die Nummern, für die der Runner zuständig ist: ab der ersten im Plan. */
const dateien = readdirSync(MIG_DIR).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
const ERSTE = Math.min(...Object.keys(plaene).map(Number));
const ZUSTAENDIG = dateien
  .map((f) => f.slice(0, 4))
  .filter((n) => Number(n) >= ERSTE);

describe("migration-plans.json — die Registrierung ist lückenlos", () => {
  it("jede Migration ab der ersten registrierten hat einen Plan", () => {
    const fehlen = ZUSTAENDIG.filter((n) => plaene[n] === undefined);
    expect(fehlen, `ohne Plan in ${PLAENE}: ${fehlen.join(", ")}`).toEqual([]);
  });

  it("und kein Plan zeigt auf eine Migration, die es nicht gibt", () => {
    const verwaist = Object.keys(plaene).filter((n) => !ZUSTAENDIG.includes(n));
    expect(verwaist, `Plan ohne Migrationsdatei: ${verwaist.join(", ")}`).toEqual([]);
  });

  it("die höchste Migration ist registriert — daran ist 0165 gescheitert", () => {
    const hoechste = dateien[dateien.length - 1].slice(0, 4);
    expect(plaene[hoechste], `${hoechste} fehlt in ${PLAENE}`).toBeTruthy();
  });
});

describe.each(Object.entries(plaene))("Plan %s", (nummer, plan) => {
  it("nennt alle Pflichtfelder", () => {
    for (const f of ["zweck", "preflight", "lauf", "postflight", "angewendet"] as const) {
      expect(plan[f], `${nummer}.${f}`).toBeTruthy();
    }
    expect(plan.angewendet.beschreibung).toBeTruthy();
    expect(plan.angewendet.sql).toBeTruthy();
  });

  it("die drei genannten SQL-Dateien liegen wirklich", () => {
    expect(existsSync(`${CHECK_DIR}/${plan.preflight}`), plan.preflight).toBe(true);
    expect(existsSync(`${OPS_DIR}/${plan.lauf}`), plan.lauf).toBe(true);
    expect(existsSync(`${CHECK_DIR}/${plan.postflight}`), plan.postflight).toBe(true);
  });

  it("die Dateinamen tragen die Nummer der Migration", () => {
    expect(plan.preflight).toContain(nummer);
    expect(plan.lauf).toContain(nummer);
    expect(plan.postflight).toContain(nummer);
  });

  it("`angewendet.sql` liefert eine Spalte `erfuellt`", () => {
    /*
     * Der Runner liest genau diese Spalte, um „liegt schon" von „liegt noch
     * nicht" zu unterscheiden. Heißt sie anders, bricht er mit einer
     * Meldung ab, die wie ein Datenbankproblem aussieht.
     */
    expect(plan.angewendet.sql).toMatch(/\bas erfuellt\b/);
    expect(plan.angewendet.sql.trimStart().toLowerCase().startsWith("select")).toBe(true);
  });

  it("Preflight und Postflight tragen die Schlusszeile 9999", () => {
    for (const d of [plan.preflight, plan.postflight]) {
      const t = readFileSync(`${CHECK_DIR}/${d}`, "utf8");
      expect(t, `${d}: Zeile 9999 fehlt`).toContain("9999");
      expect(t, `${d}: blockierende Abweichungen`).toContain("blockierende Abweichungen");
    }
  });

  it("der Preflight liefert jede Baseline, die der Postflight braucht", () => {
    const liefert = Object.keys(plan.liefert ?? {});
    for (const b of plan.braucht ?? []) {
      expect(liefert, `${nummer}: ${b} wird gebraucht, aber nicht geliefert`).toContain(b);
    }
  });

  it("die Baselinezeilen stehen im Preflight und werden im Postflight gelesen", () => {
    const pre = readFileSync(`${CHECK_DIR}/${plan.preflight}`, "utf8");
    const post = readFileSync(`${CHECK_DIR}/${plan.postflight}`, "utf8");
    for (const [vertrag, zeile] of Object.entries(plan.liefert ?? {})) {
      expect(pre, `${plan.preflight}: Zeile ${zeile} fehlt`).toContain(`(${zeile}, 'BASIS'`);
      expect(post, `${plan.postflight}: liest ${vertrag} nicht`)
        .toContain(`current_setting('${vertrag}'`);
    }
  });

  it("die Operationshülle ist EINE Transaktion und trägt den Umgebungsstempel", () => {
    const t = readFileSync(`${OPS_DIR}/${plan.lauf}`, "utf8");
    expect(t.trimStart().split("\n").some((z) => z.trim() === "begin;"),
      `${plan.lauf}: kein begin;`).toBe(true);
    expect(t.trimEnd().endsWith("commit;"), `${plan.lauf}: endet nicht auf commit;`).toBe(true);
    expect(t, `${plan.lauf}: kein Umgebungsstempel`).toMatch(/ABBRUCH A1/);
    expect(t, `${plan.lauf}: nennt das Staging-Projekt nicht`)
      .toContain("qqxcpesbwfxzgytkdsac");
    expect(t, `${plan.lauf}: nennt das Production-Projekt`)
      .not.toContain("zmiwxswrpkmizvqsgype");
  });
});

describe("0165 im Besonderen", () => {
  const plan = plaene["0165"];

  it("ist registriert", () => { expect(plan).toBeTruthy(); });

  it("die Hülle enthält die Migration selbst, nicht nur einen Verweis", () => {
    const h = readFileSync(`${OPS_DIR}/${plan.lauf}`, "utf8");
    const m = readFileSync(`${MIG_DIR}/0165_system_sync_create_figure.sql`, "utf8");
    const rumpf = m.slice(m.indexOf("create or replace function"), m.indexOf("comment on function"));
    expect(h).toContain(rumpf);
  });

  it("der Postflight prüft Rechte, Suchpfad und die unveränderten Zahlen", () => {
    const t = readFileSync(`${CHECK_DIR}/${plan.postflight}`, "utf8");
    for (const muster of [
      "has_function_privilege('service_role'", "has_function_privilege('anon'",
      "has_function_privilege('authenticated'", "has_function_privilege('public'",
      "prosecdef", "search_path=", "sky_id_seq", "market_price",
      "Katalogzeilen", "Journalzeilen",
    ]) {
      expect(t, `Postflight prueft ${muster} nicht`).toContain(muster);
    }
  });

  it("der Preflight prüft die Ausgangswerte, die der Postflight wieder nennt", () => {
    const t = readFileSync(`${CHECK_DIR}/${plan.preflight}`, "utf8");
    /*
     * 132 und 136 standen hier und sind fort: sie haetten
     * `public.catalog_admin_changes` direkt gelesen, und dem Pruefzugang ist
     * die Tabelle nicht geteilt. `migration-runner.test.ts` faengt genau das,
     * und ein Recht mehr fuer den Pruefzugang steht nicht zur Wahl. Die
     * Journalinvariante steht stattdessen in der NOTICE der Huelle (A3,
     * laeuft als `postgres`).
     */
    for (const nr of ["(131,", "(133,", "(134,", "(135,"]) {
      expect(t, `Preflight fehlt ${nr}`).toContain(nr);
    }
    expect(t, "der Preflight liest das Journal direkt").not.toMatch(
      /from\s+public\.catalog_admin_changes/);
    expect(t).toContain("system_sync_create_figure steht NOCH NICHT");
  });

  it("keine Prüfzeile behauptet eine absolute Rechtezahl für service_role", () => {
    /*
     * DER FEHLER VOM 2026-10-30, als Riegel.
     *
     * Meine erste Fassung von Postflight 242 zählte, wie viele der Rechte
     * TRUNCATE/REFERENCES/TRIGGER `service_role` auf zwei Tabellen hat, und
     * erwartete **0**. Der Lauf meldete **6** — richtig: 68 von 69 Tabellen
     * des Schemas tragen dasselbe Muster als Supabase-Projektvorgabe. Die
     * Zeile hätte auch ohne die Migration 6 gemeldet; sie behauptete einen
     * Ausgangszustand, den es nie gab.
     *
     * DIE LEHRE, und sie gilt für jede Migration: über `service_role` lässt
     * sich nicht ABSOLUT prüfen, was ein Lauf verändert hat — nur im
     * VERGLEICH zum Preflight. Eine Zeile, die eine service_role-Rechtezahl
     * gegen eine Konstante prüft, ist deshalb hier verboten. Über die
     * CLIENTROLLEN gilt das Gegenteil: `anon` und `authenticated` haben auf
     * dem Journal nichts, und das ist absolut zusicherbar.
     */
    for (const [nummer, plan] of Object.entries(plaene)) {
      for (const datei of [plan.preflight, plan.postflight]) {
        const sql = readFileSync(`${CHECK_DIR}/${datei}`, "utf8");
        /*
         * DIE ZERLEGUNG IN PRUEFZEILEN, und sie war beim ersten Versuch
         * falsch: ein `(…)` innerhalb der Zeile endet ebenfalls auf `),` und
         * ein nicht-gieriger Ausdruck hoerte dort auf. Die Gegenprobe —
         * den Fehlgriff absichtlich wieder einbauen — lief deshalb durch.
         * Jetzt wird an den ZEILENANFAENGEN `  (NNN,` getrennt; das ist die
         * Form, in der diese Dateien geschrieben sind.
         */
        const anfaenge = [...sql.matchAll(/^ {2}\(\d+, /gm)].map((m) => m.index!);
        for (let i = 0; i < anfaenge.length; i += 1) {
          const zeile = sql.slice(anfaenge[i], anfaenge[i + 1] ?? sql.length);
          if (!zeile.includes("'service_role'")) continue;
          if (!/aclexplode|has_table_privilege/.test(zeile)) continue;
          const erwartetZahl = /,\s*'\d+'\),\s*$/.test(zeile.trimEnd() + "\n");
          expect(erwartetZahl,
            `${nummer} ${datei}: eine service_role-Rechtezahl wird gegen eine `
            + `Konstante geprüft statt gegen den Preflight`).toBe(false);
        }
      }
    }
  });

  it("keine Prüfdatei entscheidet per Mustersuche, ob eine CHECK-Constraint harmlos ist",
     () => {
    /*
     * DER FEHLER VOM 2026-10-30, zum zweiten Mal und in anderer Gestalt.
     *
     * `sky_id_band_preflight.sql` zählte CHECK-Constraints, deren Definition
     * `sky_id` nennt und NICHT das Literal `SKY-[0-9]` enthält, und erwartete
     * 0. Gemeldet wurde 1: `skylanders_base_not_self`
     * (`CHECK (base_sky_id IS DISTINCT FROM sky_id)`) aus `0159` — eine
     * Constraint, die über Nummernbereiche gar nichts sagt.
     *
     * Und die Heuristik war auf beiden Seiten brüchig: `[0-9]` ist in
     * SQL-LIKE KEINE Zeichenklasse, sondern die wörtliche Zeichenfolge. Dass
     * sie die Formatconstraint traf, war ein Zufall ihrer Schreibweise.
     *
     * DIE LEHRE: wer wissen will, ob eine Constraint etwas verbietet, fragt
     * sie beim NAMEN oder vergleicht ihre Definition WÖRTLICH — nicht mit
     * einem Muster, das zufällig passt.
     */
    /*
     * DIE REGEL MUSS SCHARF SEIN, SONST VERURTEILT SIE RICHTIGES. Drei
     * Prüfdateien benutzen `pg_get_constraintdef(...) not like` völlig zu
     * Recht — `0157`, `0158`, `0159` fragen damit EINE namentlich genannte
     * Constraint, ob sie ein bestimmtes Wort noch nicht kennt. Das ist eine
     * präzise Frage über ein bekanntes Objekt.
     *
     * Verboten ist der andere Gebrauch: über ALLE Constraints einer Tabelle
     * filtern, um per Muster zu entscheiden, welche harmlos sind. Erkennbar
     * daran, dass die Prüfzeile `conname` NICHT festnagelt.
     */
    const schuldige: string[] = [];
    for (const n of readdirSync(CHECK_DIR).filter((x) => x.endsWith(".sql"))) {
      const sql = readFileSync(`${CHECK_DIR}/${n}`, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "");          // Begründungen dürfen alles nennen
      const anfaenge = [...sql.matchAll(/^ {2}\(\d+, /gm)].map((m) => m.index!);
      for (let i = 0; i < anfaenge.length; i += 1) {
        const zeile = sql.slice(anfaenge[i], anfaenge[i + 1] ?? sql.length);
        if (!/pg_get_constraintdef\([^)]*\)\s+not\s+like/i.test(zeile)) continue;
        if (/conname\s*=/i.test(zeile)) continue;      // eine benannte Constraint: erlaubt
        schuldige.push(`${n} ${/^ {2}\((\d+),/.exec(zeile)?.[1] ?? "?"}`);
      }
    }
    expect(schuldige,
      "Ausschlussmuster über ALLE Constraints statt einer benannten").toEqual([]);
  });

  it("die Bandprüfungen fragen die Constraints beim Namen", () => {
    for (const [datei, nr] of [["sky_id_band_preflight.sql", "(142,"],
                               ["sky_id_band_postflight.sql", "(222,"]] as const) {
      const sql = readFileSync(`${CHECK_DIR}/${datei}`, "utf8");
      expect(sql, `${datei} ${nr}`).toContain(nr);
      expect(sql, `${datei}: nennt die erwartete Constraintmenge nicht`)
        .toContain("'skylanders_base_not_self,skylanders_sky_id_format'");
      expect(sql, `${datei}: vergleicht die Formatconstraint nicht wörtlich`)
        .toContain("CHECK ((sky_id ~ ''^SKY-[0-9]{4}$''::text))");
    }
  });

  it("0165 prüft die Clientrollen absolut und service_role nur als Auskunft", () => {
    const pre = readFileSync(`${CHECK_DIR}/${plaene["0165"].preflight}`, "utf8");
    const post = readFileSync(`${CHECK_DIR}/${plaene["0165"].postflight}`, "utf8");
    /* Die absolute Zusage: Clientrollen haben auf dem Journal nichts. */
    for (const t2 of [pre, post]) {
      expect(t2).toContain("in ('anon', 'authenticated')");
      expect(t2).toContain("KEIN Recht");
    }
    /* Und das Gegenstück, damit der Vergleich überhaupt möglich ist. */
    expect(pre, "Preflight 141 fehlt").toContain("(141,");
    expect(post, "Postflight 243 fehlt").toContain("(243,");
  });

  it("weder Preflight noch Postflight rufen die neue Funktion auf", () => {
    for (const d of [plan.preflight, plan.postflight]) {
      const t = readFileSync(`${CHECK_DIR}/${d}`, "utf8");
      expect(t, `${d} ruft die Funktion auf`).not.toMatch(/select\s+public\.system_sync_create_figure\s*\(/);
    }
  });
});
