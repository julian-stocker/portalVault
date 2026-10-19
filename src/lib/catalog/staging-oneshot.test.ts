/**
 * Das Staging-Skript in einem Durchgang — und der Beweis, dass es nichts
 * Eigenes tut.
 *
 * WARUM DIESE DATEI DIE WICHTIGSTE AM SKRIPT IST. `staging-0135-0136.sql`
 * BETTET zwei Migrationen ein. Eingebetteter Code ist Kopie, und eine Kopie
 * läuft auseinander — still, und in der gefährlichsten Richtung: der Betreiber
 * führt dann etwas aus, das nicht mehr die geprüfte Migration ist. Diese
 * Datei vergleicht die eingebetteten Abschnitte bei jedem Testlauf **Zeichen
 * für Zeichen** mit den Migrationsdateien.
 *
 * Dass das Skript auch LÄUFT, prüft `npm run verify:check-sql` (Probelauf
 * P21, PostgreSQL 18.6): einmal durch, und einmal mit dem unveränderten
 * Z0-Vertrag, der dann anschlagen muss.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const SKRIPT = readFileSync("supabase/operations/staging-0135-0136.sql", "utf8");

/** Der eingebettete Abschnitt zwischen den beiden Marken. */
function eingebettet(datei: string): string {
  const anfang = `-- >>> EINGEBETTET: supabase/migrations/${datei}\n`;
  const ende = `-- <<< ENDE: supabase/migrations/${datei}\n`;
  const a = SKRIPT.indexOf(anfang);
  const b = SKRIPT.indexOf(ende);
  expect(a, `Marke fehlt: ${datei}`).toBeGreaterThan(-1);
  expect(b, `Endmarke fehlt: ${datei}`).toBeGreaterThan(a);
  return SKRIPT.slice(a + anfang.length, b);
}

describe("die eingebetteten Migrationen sind zeichengleich", () => {
  for (const datei of ["0135_catalog_item_type.sql",
                       "0136_business_backup_item_type.sql"]) {
    it(`${datei} — Zeichen für Zeichen`, () => {
      expect(eingebettet(datei)).toBe(readFileSync(`supabase/migrations/${datei}`, "utf8"));
    });
  }

  it("und sonst ist keine Migration eingebettet", () => {
    const marken = [...SKRIPT.matchAll(/^-- >>> EINGEBETTET: (\S+)$/gm)].map((m) => m[1]);
    expect(marken).toEqual([
      "supabase/migrations/0135_catalog_item_type.sql",
      "supabase/migrations/0136_business_backup_item_type.sql",
    ]);
  });
});

describe("der Rahmen: eine Transaktion, ein Ausgang", () => {
  it("begin steht am Anfang, commit als letzte Anweisung", () => {
    const code = SKRIPT.split("\n").filter((l) => /^[a-z]/.test(l)).map((l) => l.trim());
    expect(code[0]).toBe("begin;");
    expect(code[code.length - 1]).toBe("commit;");
    /* Genau eine Klammer, keine zweite, kein `rollback` im Lauf. */
    expect(code.filter((l) => l === "begin;")).toHaveLength(1);
    expect(code.filter((l) => l === "commit;")).toHaveLength(1);
    expect(code.filter((l) => l.startsWith("rollback"))).toEqual([]);
  });

  it("die Sperrgrenze und das Zeitlimit sind gesetzt", () => {
    expect(SKRIPT).toContain("set local statement_timeout");
    expect(SKRIPT).toContain("set local lock_timeout = '5s'");
  });

  it("jede eigene Prüfung bricht ab, statt zu melden", () => {
    /* Ein Prüfraster mitten in einer Transaktion hält nichts an. Alle
       Vorprüfungen und Nachprüfungen sind deshalb DO-Blöcke mit `raise`. */
    const abbrueche = [...SKRIPT.matchAll(/raise exception 'ABBRUCH ([A-D]\d)/g)]
      .map((m) => m[1]);
    expect(new Set(abbrueche).size).toBeGreaterThanOrEqual(10);
    for (const marke of ["A1", "A3", "A5", "A7", "A9", "D2", "D3", "D4", "D5", "D7"]) {
      expect(abbrueche, marke).toContain(marke);
    }
  });

  it("am Ende steht genau ein Ergebnisraster", () => {
    const selects = [...SKRIPT.matchAll(/^select$/gm)];
    expect(selects).toHaveLength(1);
    expect(SKRIPT).toContain("case when a.wert is not distinct from n.wert then 'gleich'");
  });
});

describe("was das Skript nicht anfasst", () => {
  it("es prüft, dass 0133 und 0134 fehlen — vorher und nachher", () => {
    expect(SKRIPT).toContain("ABBRUCH A3: 0133 ist hier angewendet");
    expect(SKRIPT).toContain("ABBRUCH A3: 0134 ist hier angewendet");
    expect(SKRIPT).toContain("ABBRUCH D6: 0133 oder 0134 ist angewendet worden");
  });

  it("es wendet 0133 und 0134 NICHT an", () => {
    expect(SKRIPT).not.toContain("purchases_paid_total_immutable_trg on");
    expect(SKRIPT).not.toContain("create or replace function public.purchases_paid_total_is_final");
    expect(SKRIPT).not.toContain("create or replace function public.seller_purchase(");
  });

  it("es prüft die Belegsperre vorher und nachher und ändert sie nicht", () => {
    expect(SKRIPT).toContain("ABBRUCH A5: die Belegsperre ist nicht dicht");
    expect(SKRIPT).toContain("ABBRUCH D7: die Belegsperre ist nicht mehr dicht");
    const code = SKRIPT.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");
    expect(code).not.toMatch(/revoke[^;]*seller_issue/i);
    expect(code).not.toMatch(/grant[^;]*seller_issue/i);
  });

  it("es ist auf Staging festgelegt — Umgebungsstempel und Z0-Werte", () => {
    expect(SKRIPT).toContain("'SKY-0821', 'SKY-0822'");
    expect(SKRIPT).toContain("qqxcpesbwfxzgytkdsac");
    expect(SKRIPT).not.toContain("zmiwxswrpkmizvqsgype");
    for (const wert of ["shopfaehig=534", "angebote=256",
                        "angebote_md5=4d1d6c30fe0ae886ca2689bcb1fe9634",
                        "sammelbar=534", "overrides=39"]) {
      expect(SKRIPT, wert).toContain(wert);
    }
    /* Und der Kopf sagt, dass es deshalb nicht für Production taugt. */
    expect(SKRIPT).toContain("nicht** fuer Production geeignet");
  });
});

describe("die Bezugswerte werden vorher und nachher gleich gemessen", () => {
  /** Die Schlüssel, die der Vergleich in D2 verlangt. */
  const VERGLICHEN = [
    "shopfaehig", "angebote", "angebote_md5", "sammelbar", "sammelbar_je_serie",
    "override_md5", "overrides", "katalogzeilen", "spiele_zeilen",
    "einkaeufe", "positionen", "lagerzeilen", "einheiten", "bewegungen",
    "importsumme", "belege", "zaehler", "abrufe",
  ] as const;

  it("18 Werte, und jeder wird vorher UND nachher erfasst", () => {
    expect(VERGLICHEN).toHaveLength(18);
    for (const k of VERGLICHEN) {
      expect(SKRIPT, `'${k}' vorher`).toContain(`('${k}',`);
      expect(SKRIPT, `'n_${k}' nachher`).toContain(`('n_${k}',`);
    }
  });

  it("die Vergleichsliste in D2 nennt genau diese 18", () => {
    const block = SKRIPT.slice(SKRIPT.indexOf("foreach v_schluessel in array array["));
    const liste = block.slice(0, block.indexOf("] loop"));
    for (const k of VERGLICHEN) expect(liste, k).toContain(`'${k}'`);
    /* Und nicht den einen Wert, der sich bewegen MUSS. */
    expect(liste).not.toContain("'sicherung_md5'");
  });

  it("die Sicherung ist der eine Wert, der sich ändern darf — und muss", () => {
    expect(SKRIPT).toContain("ABBRUCH A8: die Betriebssicherung ist nicht der Stand 0131");
    expect(SKRIPT).toContain("24c3810288bb20929fe995554a267adf");
    expect(SKRIPT).toContain("ABBRUCH D3: die Betriebssicherung ist nicht der Stand 0136");
    expect(SKRIPT).toContain("f6d08440707ba72a8040a8d1e666c092");
  });

  it("und die Ableitungsregel wird nachher geprüft, einschließlich der Positivliste", () => {
    expect(SKRIPT).toContain("public.catalog_item_type_for_category('Portale') <> 'figure'");
    expect(SKRIPT).toContain("ABBRUCH D5");
  });
});

/* ==========================================================================
 * Der Abbruch vom 2026-10-19: „overrides ist 53, erwartet 39"
 * ======================================================================== */

describe("der Z0-Vertrag prüft die Aussage, die Z0 wirklich belegt hat", () => {
  /** Der Vertragsabschnitt des Skripts. */
  const vertrag = SKRIPT.slice(SKRIPT.indexOf("array['shopfaehig=534'"),
                               SKRIPT.indexOf("] loop", SKRIPT.indexOf("array['shopfaehig=534'")));

  it("die Overrides sind SPIELE-bezogen, nicht katalogweit", () => {
    /*
     * DER FEHLER, DEN DIESE DATEI FESTNAGELT.
     *
     * Z0 zählte „39, alle mit display_name_override" **innerhalb der
     * Kategorie Spiele** (`Z0_catalog_accessories_readonly.sql`, Zeile 102,
     * CTE `spiel`). Der erste Vertrag las das als katalogweite Gesamtzahl und
     * brach ab: katalogweit tragen auch Figuren einen redaktionellen
     * Anzeigenamen — und das war nie anders.
     */
    expect(vertrag).toContain("spiele_overrides=39");
    expect(vertrag).not.toMatch(/'overrides=\d/);
  });

  it("und die Erfassung filtert wirklich auf die Kategorie Spiele", () => {
    const block = SKRIPT.slice(SKRIPT.indexOf("('spiele_overrides',"));
    const ende = block.indexOf("),\n");
    expect(block.slice(0, ende)).toContain("c.name = 'Spiele'");
    expect(block.slice(0, ende)).toContain("display_name_override is not null");
  });

  it("die katalogweite Zahl bleibt erfasst — als Wert, der sich nicht bewegen darf", () => {
    /* Der Verzicht auf einen Z0-Sollwert schwächt nichts ab: vorher/nachher
       wird exakt verglichen, dazu der `md5` über alle Overrides. */
    expect(SKRIPT).toContain("('overrides',");
    expect(SKRIPT).toContain("('n_overrides',");
    expect(SKRIPT).toContain("('override_md5',");
    const liste = SKRIPT.slice(SKRIPT.indexOf("foreach v_schluessel in array array["));
    const bis = liste.slice(0, liste.indexOf("] loop"));
    expect(bis).toContain("'overrides'");
    expect(bis).toContain("'override_md5'");
    expect(bis).toContain("'spiele_overrides'");
  });

  it("eine redaktionelle Änderung von heute steht im Raster, blockiert aber nicht", () => {
    expect(SKRIPT).toContain("('aenderungen_heute',");
    expect(SKRIPT).toContain("('n_aenderungen_heute',");
    expect(SKRIPT).toContain("field = 'display_name_override'");
    /* Kein Sollwert und nicht in der Vergleichsliste: eine Namensänderung ist
       erlaubt, sie soll nur sichtbar sein. */
    const liste = SKRIPT.slice(SKRIPT.indexOf("foreach v_schluessel in array array["));
    expect(liste.slice(0, liste.indexOf("] loop"))).not.toContain("aenderungen_heute");
  });

  it("der Kopf nennt die Berichtigung, damit sie nicht wieder passiert", () => {
    expect(SKRIPT).toContain("BERICHTIGT AM 2026-10-19");
    expect(SKRIPT).toContain("z0_overrides_diagnosis.sql");
  });
});

describe("die Diagnose zum Override-Abbruch", () => {
  const DIAG = readFileSync("supabase/checks/z0_overrides_diagnosis.sql", "utf8");

  it("sie unterscheidet die zwei Erklärungen mit Daten, nicht mit Meinung", () => {
    /* Der Trigger aus `0004` protokolliert jede Änderung an
       `display_name_override` mit Zeitstempel. Null Änderungen heute heißt:
       falscher Sollwert, keine Datenänderung. */
    expect(DIAG).toContain("catalog_admin_changes");
    expect(DIAG).toContain("changed_at >= current_date");
    expect(DIAG).toContain("DATENAENDERUNG HEUTE");
    expect(DIAG).toContain("FALSCHER SOLLWERT");
  });

  it("blockierend ist nur, was eine Datenänderung bedeuten würde", () => {
    /* 111, 112 und 201 tragen einen Sollwert; alles andere ist Messung. */
    for (const nr of ["111", "112", "201"]) {
      expect(DIAG, nr).toMatch(new RegExp(`\\(${nr}, '[^']*', 'blockierend|\\(${nr}, 'Z0-Aussage'`));
    }
    expect(DIAG).toContain("jede Spiele-Zeile traegt einen Override");
  });

  it("sie gibt keine Kontoidentität aus", () => {
    /* `changed_by` ist eine uuid — gezählt wird, nicht angezeigt. */
    expect(DIAG).not.toMatch(/select[^;]*a\.changed_by/);
    expect(DIAG).toContain("changed_by` wird nicht ausgegeben");
  });

  it("und sie ist rein lesend", () => {
    const code = DIAG.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");
    expect(code).not.toMatch(/\bdo\s+\$\$/i);
    expect(code).not.toMatch(/^\s*(insert|update|delete|truncate|grant|revoke|alter|create|drop)\b/im);
  });
});
