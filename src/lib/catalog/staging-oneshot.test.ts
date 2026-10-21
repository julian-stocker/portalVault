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
 *
 * SEIT ADR-0128 GIBT ES EIN ZWEITES: `staging-0137-0138.sql` bettet `0137`
 * und `0138` ein — den Weg für Zubehör und die 21 Portale der Arbeitsmappe.
 * Es steht am Ende dieser Datei und wird genauso geprüft; sein Lauf ist
 * Probelauf P30.
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

/* =====================================================================
 * `staging-0137-0138.sql` — derselbe Bau, zwei Migrationen (ADR-0128)
 *
 * Der manuelle Ablauf, den der Betreiber wirklich einfügt: eine Datei, eine
 * Transaktion, ein Einfügen. Dieselbe Gefahr wie oben — eingebetteter Code
 * ist Kopie —, also dieselbe Prüfung, Zeichen für Zeichen.
 * ================================================================== */
describe("staging-0137-0138.sql", () => {
  const ZWEI = readFileSync("supabase/operations/staging-0137-0138.sql", "utf8");

  function eingebettet2(datei: string): string {
    const anfang = `-- >>> EINGEBETTET: supabase/migrations/${datei}\n`;
    const ende = `-- <<< ENDE: supabase/migrations/${datei}`;
    const a = ZWEI.indexOf(anfang);
    const b = ZWEI.indexOf(ende);
    expect(a, `Marke fehlt: ${datei}`).toBeGreaterThan(-1);
    expect(b, `Endmarke fehlt: ${datei}`).toBeGreaterThan(a);
    return ZWEI.slice(a + anfang.length, b);
  }

  for (const datei of ["0137_catalog_accessories.sql", "0138_catalog_portals.sql"]) {
    it(`${datei} ist zeichengleich eingebettet`, () => {
      expect(eingebettet2(datei).trimEnd())
        .toBe(readFileSync(`supabase/migrations/${datei}`, "utf8").trimEnd());
    });
  }

  it("und sonst ist keine Migration eingebettet", () => {
    expect([...ZWEI.matchAll(/^-- >>> EINGEBETTET: (\S+)$/gm)].map((m) => m[1])).toEqual([
      "supabase/migrations/0137_catalog_accessories.sql",
      "supabase/migrations/0138_catalog_portals.sql",
    ]);
  });

  it("die Reihenfolge steht fest: 0137 vor 0138", () => {
    /* Ohne die erweiterte Kategorieliste wäre das erste Portal in dem
       Augenblick, in dem es entsteht, eine sammelbare, shopfähige Figur. */
    expect(ZWEI.indexOf("0137_catalog_accessories.sql\n-- ====")) 
      .toBeLessThan(ZWEI.indexOf("0138_catalog_portals.sql\n-- ===="));
  });

  it("eine Klammer, ein Ausgang, kein rollback im Lauf", () => {
    const code = ZWEI.split("\n").filter((l) => /^[a-z]/.test(l)).map((l) => l.trim());
    expect(code[0]).toBe("begin;");
    expect(code[code.length - 1]).toBe("commit;");
    expect(code.filter((l) => l === "begin;")).toHaveLength(1);
    expect(code.filter((l) => l === "commit;")).toHaveLength(1);
    expect(code.filter((l) => l.startsWith("rollback"))).toEqual([]);
  });

  it("prüft vorher, dass der ZB-Bereich frei ist", () => {
    /* Eine SKY-ID wird nie neu vergeben. Steht dort etwas, bricht der Lauf
       ab, bevor irgendetwas entsteht. */
    expect(ZWEI).toContain("ABBRUCH A9:");
    expect(ZWEI).toContain("SKY-0615' and 'SKY-0642");
  });

  it("und nennt die drei erwarteten Differenzen, statt sie auszunehmen", () => {
    /*
     * Eine Ausnahme ohne Zahl wäre ein Loch: „dieser Wert darf sich ändern"
     * hätte auch 22 Portale durchgelassen. Jede der drei ist beziffert.
     */
    expect(ZWEI).toContain("erwartet % + 21 (die Portale)");
    expect(ZWEI).toContain("erwartet % + 6 (eine Kategorie ");
    expect(ZWEI).toContain("die Artikeltypverteilung ist ohne die 21 Portale");
  });

  it("prüft die 21 Portale einzeln nach — und dass keines Ware ist", () => {
    expect(ZWEI).toContain("ABBRUCH C10:");
    expect(ZWEI).toContain("ABBRUCH C11: ein Portal ist shopfaehig");
    expect(ZWEI).toContain("ABBRUCH C11: ein Portal steht im oeffentlichen Angebot");
    /* Die eine fachliche Entscheidung, wörtlich. */
    expect(ZWEI).toContain("SKY-0637 traegt die Serie");
    expect(ZWEI).toContain("erwartet SF");
  });

  it("und dass keine SKY-ID gezogen wurde", () => {
    expect(ZWEI).toContain("ABBRUCH C12:");
    expect(ZWEI).toContain("die hoechste SKY-ID unter SKY-9000 hat sich bewegt");
  });

  it("fasst 0133, 0134 und die Belegsperre nicht an", () => {
    expect(ZWEI).toContain("ABBRUCH A4: 0133 ist hier angewendet");
    expect(ZWEI).toContain("ABBRUCH C8: 0133 oder 0134 ist angewendet worden");
    expect(ZWEI).toContain("ABBRUCH A5: die Belegsperre ist nicht dicht");
    expect(ZWEI).toContain("ABBRUCH C9: die Belegsperre ist nicht mehr dicht");
    const code = ZWEI.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");
    expect(code).not.toMatch(/revoke[^;]*seller_issue/i);
    expect(code).not.toMatch(/grant[^;]*seller_issue/i);
  });

  it("ist auf Staging festgelegt", () => {
    expect(ZWEI).toContain("'SKY-0821', 'SKY-0822'");
    expect(ZWEI).toContain("qqxcpesbwfxzgytkdsac");
    expect(ZWEI).not.toContain("zmiwxswrpkmizvqsgype");
  });

  it("und packt den search_path aus, statt ihn zu vergleichen", () => {
    /* `set search_path = ''` landet als `search_path=""` in `proconfig`. Ein
       `@> array['search_path=']` findet das nie — und hätte den Lauf in
       Abschnitt C abgebrochen, obwohl alles in Ordnung ist.

       Gegen den AUSFÜHRBAREN Teil: der Kommentar darüber nennt die falsche
       Form absichtlich, damit sie niemand wieder einbaut. */
    const code = ZWEI.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");
    expect(code).not.toContain("array['search_path=']");
    expect(code).toContain("search\\_path=%");
  });
});

/* ==========================================================================
 * `staging-0139.sql` und `staging-0140.sql` — je ein Lauf, je eine Migration
 *
 * ANDERS ALS DIE BEIDEN OBEN betten diese zwei nichts Eigenes ein: keine
 * Vor- und keine Nachpruefung, weil `0139` und `0140` beide selbst
 * mitbringen. Hinzu kommt genau EINE Zeile Pruefung — der Umgebungsstempel,
 * den eine Migration nicht kennen kann.
 *
 * Und sie sind GETRENNT, nicht zusammen: `0140` setzt `0139` voraus und
 * laeuft als eigene Transaktion danach, damit der Beweis von `0139`
 * („nichts hat sich geaendert") lesbar bleibt.
 * ======================================================================== */

const LAEUFE = [
  ["supabase/operations/staging-0139.sql", "0139_accessory_sale_release.sql"],
  ["supabase/operations/staging-0140.sql", "0140_business_backup_sale_release.sql"],
  ["supabase/operations/staging-0141.sql", "0141_seller_sale_state.sql"],
] as const;

describe("die Einzellaeufe fuer 0139, 0140 und 0141", () => {
  for (const [skript, migration] of LAEUFE) {
    const text = readFileSync(skript, "utf8");

    it(`${migration} ist Zeichen für Zeichen eingebettet`, () => {
      /* Dieselbe Zusicherung wie oben, und aus demselben Grund: eingebetteter
         Code ist eine Kopie, und eine Kopie läuft auseinander. */
      const anfang = `-- >>> EINGEBETTET: supabase/migrations/${migration}\n`;
      const ende = `-- <<< ENDE: supabase/migrations/${migration}\n`;
      const a = text.indexOf(anfang);
      const b = text.indexOf(ende);
      expect(a, "Marke fehlt").toBeGreaterThan(-1);
      expect(b, "Endmarke fehlt").toBeGreaterThan(a);
      expect(text.slice(a + anfang.length, b))
        .toBe(readFileSync(`supabase/migrations/${migration}`, "utf8"));
    });

    it(`${skript} ist auf Staging festgelegt`, () => {
      expect(text).toContain("'SKY-0821', 'SKY-0822'");
      expect(text).toContain("qqxcpesbwfxzgytkdsac");
      /* Die Production-Referenz darf hier nirgends stehen. */
      expect(text).not.toContain("zmiwxswrpkmizvqsgype");
      expect(text).toContain("ABBRUCH A1: Umgebungsstempel nicht gefunden");
    });

    it(`${skript} bringt genau eine Klammer mit`, () => {
      const zeilen = text.split("\n");
      expect(zeilen.filter((l) => l.trim() === "begin;")).toHaveLength(1);
      expect(zeilen.filter((l) => l.trim() === "commit;")).toHaveLength(1);
      expect(zeilen.indexOf("begin;")).toBeLessThan(zeilen.indexOf("commit;"));
      /* Und der Stempel steht INNERHALB der Klammer — sonst bräche er ab,
         ohne die Migration zu verhindern. */
      expect(text.indexOf("ABBRUCH A1")).toBeGreaterThan(text.indexOf("begin;"));
    });

    it(`${skript} fügt der Migration nichts Fachliches hinzu`, () => {
      /* Der einzige ausführbare Teil außerhalb der Einbettung ist der
         Stempel. Alles andere wäre eine zweite, ungeprüfte Logik. */
      const anfang = text.indexOf(`-- >>> EINGEBETTET`);
      const ende = text.indexOf(`-- <<< ENDE`);
      const rahmen = (text.slice(0, anfang) + text.slice(ende))
        .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");
      for (const verboten of ["insert into", "update public.", "delete from",
        "alter table", "create or replace function", "grant ", "revoke "]) {
        expect(rahmen.toLowerCase(), verboten).not.toContain(verboten);
      }
    });
  }

  it("und sonst ist keine Migration eingebettet", () => {
    for (const [skript] of LAEUFE) {
      const treffer = [...readFileSync(skript, "utf8")
        .matchAll(/-- >>> EINGEBETTET: supabase\/migrations\/(\S+)/g)].map((m) => m[1]);
      expect(treffer).toHaveLength(1);
    }
  });
});


/* ==========================================================================
 * Die zwei LESENDEN Laeufe — S1 und S1a
 *
 * Sie betten eine Pruefdatei ein, nicht eine Migration, und sie schreiben
 * nichts: `begin`, der Z0-Vertrag, das SELECT, `rollback`. Der Grund, warum
 * es sie gibt, ist eine Panne vom 2026-10-20: der Betreiber fuehrte die
 * Pruefdatei ohne `set_config` aus, und Zeile 902 meldete zu Recht „der
 * Modus fehlt". Wer nichts zusammensetzen muss, kann nichts vergessen.
 * ======================================================================== */

const LESELAEUFE = [
  ["supabase/operations/staging-s1-preflight-0139.sql", "0139_preflight.sql"],
  ["supabase/operations/staging-s1a-accessory-offer.sql", "accessory_offer_readonly.sql"],
  ["supabase/operations/staging-s3-postflight-0139.sql", "0139_postflight.sql"],
] as const;

describe("die zwei lesenden Staging-Laeufe", () => {
  for (const [skript, pruefdatei] of LESELAEUFE) {
    const text = readFileSync(skript, "utf8");

    it(`${pruefdatei} ist Zeichen für Zeichen eingebettet`, () => {
      const anfang = `-- >>> EINGEBETTET: supabase/checks/${pruefdatei}\n`;
      const ende = `-- <<< ENDE: supabase/checks/${pruefdatei}\n`;
      const a = text.indexOf(anfang);
      const b = text.indexOf(ende);
      expect(a, "Marke fehlt").toBeGreaterThan(-1);
      expect(b, "Endmarke fehlt").toBeGreaterThan(a);
      expect(text.slice(a + anfang.length, b))
        .toBe(readFileSync(`supabase/checks/${pruefdatei}`, "utf8"));
    });

    it(`${skript} bringt den Z0-Vertrag mit — und zwar VOR dem SELECT`, () => {
      const config = text.indexOf("select set_config('skyisles.z0', 'staging', true);");
      expect(config, "set_config fehlt").toBeGreaterThan(-1);
      expect(text.indexOf("begin;")).toBeLessThan(config);
      expect(config).toBeLessThan(text.indexOf("-- >>> EINGEBETTET"));
    });

    it(`${skript} endet mit rollback und schreibt nichts`, () => {
      const zeilen = text.split("\n").map((l) => l.trim());
      expect(zeilen.filter((l) => l === "begin;")).toHaveLength(1);
      expect(zeilen.filter((l) => l === "rollback;")).toHaveLength(1);
      expect(zeilen.filter((l) => l === "commit;")).toHaveLength(0);
      /* Und im ausführbaren Teil steht keine Schreiboperation — weder im
         Rahmen noch in der eingebetteten Prüfdatei. */
      const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");
      for (const verboten of ["insert into", "update public.", "delete from",
        "alter table", "create ", "grant ", "revoke "]) {
        expect(code.toLowerCase(), verboten).not.toContain(verboten);
      }
    });
  }

  it("und der Preflight setzt keine Spalte voraus, die 0139 erst anlegt", () => {
    /*
     * DER FEHLER VOM 2026-10-20: `column s.usk_rating does not exist`.
     * Ein Preflight misst den Zustand VOR seiner Migration und darf
     * deshalb keine ihrer Spalten lesen. Dass die Datei gegen genau
     * diesen Zustand auch LÄUFT, fährt Probelauf P40 nach.
     */
    const pre = readFileSync("supabase/checks/0139_preflight.sql", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*--.*$/gm, "")
      /* UND DIE STRINGLITERALE. Die Prüfzeile heißt
         `'skylanders.usk_rating fehlt noch'` — darin steckt
         `s.usk_rating` als Teilwort, und eine naive Suche fand genau das
         statt eines echten Lesezugriffs. */
      .replace(/'(?:[^']|'')*'/g, "''");
    for (const spalte of ["s.usk_rating", "i.sale_released", "i.delivery_scope",
      "z.usk_rating", "z.delivery_scope", "z.sale_released"]) {
      expect(pre, spalte).not.toContain(spalte);
    }
    /* Über `information_schema` darf er nach ihnen fragen — das ist die
       Frage „gibt es sie schon?", nicht ein Lesen. Gegen die ROHFASSUNG,
       weil der Name dort in einem Stringliteral steht. */
    expect(readFileSync("supabase/checks/0139_preflight.sql", "utf8"))
      .toContain("column_name = 'sale_released'");
  });
});


/* ==========================================================================
 * DER LESENDE PRODUCTION-LAUF — die Nachkontrolle zu 0136
 *
 * Anlass: der Supabase-SQL-Editor zeigt `NOTICE`-Meldungen nicht an. Die
 * Migration prüft ihre Nachbedingungen in ihrer eigenen Transaktion, aber
 * der Bediener SIEHT das Ergebnis nicht — „Success" ohne Meldungen ist
 * kein Befund. Diese Datei fragt denselben Zustand von außen nochmal, und
 * zwar sichtbar.
 *
 * Sie trägt denselben Umgebungsriegel wie die sieben schreibenden Dateien,
 * obwohl sie nichts schreibt. Der Grund ist nicht Schaden, sondern
 * WAHRHEIT: am 2026-10-20 liefen Prüfdateien auf Staging, während ihre
 * Ergebnisse als Production-Befunde gelesen wurden.
 * ======================================================================== */

const PROD_LESELAEUFE = [
  ["supabase/operations/prod-s-postflight-0136.sql", "0136_postflight.sql"],
  ["supabase/operations/prod-s-postflight-0137.sql", "0137_postflight.sql"],
] as const;

describe.each(PROD_LESELAEUFE)("der lesende Production-Lauf %s", (datei, pruefdatei) => {
  const text = readFileSync(datei, "utf8");

  it(`bettet ${pruefdatei} Zeichen für Zeichen ein`, () => {
    const anfang = `-- >>> EINGEBETTET: supabase/checks/${pruefdatei}\n`;
    const ende = `-- <<< ENDE: supabase/checks/${pruefdatei}\n`;
    const a = text.indexOf(anfang);
    const b = text.indexOf(ende);
    expect(a, "Marke fehlt").toBeGreaterThan(-1);
    expect(b, "Endmarke fehlt").toBeGreaterThan(a);
    expect(text.slice(a + anfang.length, b))
      .toBe(readFileSync(`supabase/checks/${pruefdatei}`, "utf8"));
  });

  it("trägt den Riegel der sieben — zeichengleich in allen drei Bedingungen", () => {
    /*
     * Nicht „einen ähnlichen Riegel": denselben. Die drei Bedingungen werden
     * aus `prod-0136.sql` ausgeschnitten und verglichen, damit eine Korrektur
     * dort nicht an diesen Dateien vorbeigeht.
     */
    const schreibend = readFileSync("supabase/operations/prod-0136.sql", "utf8");
    for (const bedingung of [
      "if (select count(*) from public.skylanders\n       where sky_id in ('SKY-0821', 'SKY-0822')) = 2 then",
      "if to_regprocedure('public.purchases_paid_total_is_final()') is null then",
      "if (select count(*) from public.skylanders) < 100 then",
    ]) {
      expect(schreibend, bedingung).toContain(bedingung);
      expect(text, bedingung).toContain(bedingung);
    }
    for (const kennung of ["ABBRUCH A1", "ABBRUCH A2", "ABBRUCH A3"]) {
      expect(text).toContain(kennung);
    }
  });

  it("wählt den Z0-Modus ausdrücklich — und zwar keine, nicht staging", () => {
    /*
     * Die fünf Bezugszahlen des Vertrags sind STAGING-Werte. Auf Production
     * wären sie fünf Fehlalarme; `keine` ist der ausdrückliche Verzicht, den
     * Zeile 902 verlangt. Ein vergessenes `set_config` meldet sie blockierend
     * — es gibt also keinen Lauf, der die fünf still übergeht.
     */
    const config = text.indexOf("select set_config('skyisles.z0', 'keine', true);");
    expect(config, "set_config fehlt").toBeGreaterThan(-1);
    /* Gegen den AUSFÜHRBAREN Teil, nicht gegen die Datei: die eingebettete
       Prüfdatei nennt die Staging-Fassung in ihrem Kopf als
       Gebrauchsanweisung. Ein Kommentar setzt nichts. */
    const ohneKommentar = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");
    expect(ohneKommentar).not.toContain("'skyisles.z0', 'staging'");
    expect(text.indexOf("begin;")).toBeLessThan(config);
    expect(config).toBeLessThan(text.indexOf("-- >>> EINGEBETTET"));
    /* Der Riegel steht VOR dem Modus — erst die Umgebung, dann alles andere. */
    expect(text.indexOf("do $lauf_a$")).toBeLessThan(config);
  });

  it("endet mit rollback und schreibt nichts", () => {
    const zeilen = text.split("\n").map((l) => l.trim());
    expect(zeilen.filter((l) => l === "begin;")).toHaveLength(1);
    expect(zeilen.filter((l) => l === "rollback;")).toHaveLength(1);
    expect(zeilen.filter((l) => l === "commit;")).toHaveLength(0);
    const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");
    for (const verboten of ["insert into", "update public.", "delete from",
      "alter table", "create ", "grant ", "revoke "]) {
      expect(code.toLowerCase(), verboten).not.toContain(verboten);
    }
  });

  it("sagt, warum Success ohne NOTICE kein Befund ist", () => {
    /* Die Frage des Bedieners vom 2026-10-21 gehört in die Datei, nicht nur
       in den Chatverlauf. */
    expect(text).toContain("zeigt `NOTICE`-Meldungen nicht");
  });

  it("nennt die Production-Erwartung der unbewerteten Zeilen", () => {
    /* „Messung ohne Sollwert" darf nicht heißen „niemand weiß, was
       rauskommen soll". */
    expect(text).toContain("287");
    expect(text).toContain("531");
    expect(text).toMatch(/NOTIEREN|nicht vorhersagbar/);
  });
});

describe("der lesende Production-Lauf zu 0136 — seine eigenen vier Zahlen", () => {
  const text = readFileSync("supabase/operations/prod-s-postflight-0136.sql", "utf8");

  it("ruft die Sicherung nicht auf, sondern liest ihre Definition", () => {
    /* Ein Aufruf würde Geschäftsdaten lesen — Einkäufe, Belege, Lager.
       Gelesen wird `pg_proc.prosrc`, und das ist Text über Struktur. */
    const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");
    expect(code).not.toMatch(/(?:select|from|join|call)\s+public\.seller_business_backup\s*\(/);
    expect(code).toContain("p.proname = 'seller_business_backup'");
  });

  it("nennt die vier Zeilen, auf die es ankommt", () => {
    for (const zeile of ["108", "107", "105", "106", "102"]) {
      expect(text).toContain(zeile);
    }
    expect(text).toContain("f6d08440707ba72a8040a8d1e666c092");
    expect(text).toContain("353");
  });
});

describe("der lesende Production-Lauf zu 0137 — was er beweist und was nicht", () => {
  const text = readFileSync("supabase/operations/prod-s-postflight-0137.sql", "utf8");

  it("nennt die Zeilen der fünf Fragen", () => {
    for (const zeile of ["201", "204", "205", "301", "604", "305"]) {
      expect(text).toContain(zeile);
    }
  });

  it("sagt, dass ein Abdruck von NACHHER keine Unverändertheit beweist", () => {
    /*
     * Der Bediener fragt „sind die Geschäftsdaten unverändert?". Eine
     * Messung danach kann das nicht beantworten — es gibt kein Vorher.
     * Was es beantwortet, ist die Anweisungsebene der Migration, und das
     * muss die Datei sagen, statt einen Abdruck als Beweis auszugeben.
     */
    expect(text).toContain("es gibt kein Vorher zum Vergleichen");
    expect(text).toContain("KEIN `insert`, `update`, `delete` oder `truncate`");
  });

  it("erklärt, dass anon weniger sieht als dieses SELECT", () => {
    /*
     * Die Richtlinie auf `skylanders` gibt `anon` nur sichtbare Zeilen. Eine
     * Vorhersage aus dem Repository ist für 703/704 deshalb eine
     * UNTERGRENZE, und das darf nicht als Abweichung gelesen werden.
     */
    expect(text).toContain("is_active AND catalog_visible");
    expect(text).toContain("PLUS die");
  });
});

it("0137 schreibt auf Anweisungsebene keine Geschäftstabelle", () => {
  /*
   * Die Behauptung aus dem Kopf der Nachkontrolle, hier nachgerechnet: die
   * drei `insert` der Datei stehen im RUMPF von `seller_create_catalog_item`
   * (zwischen `as $$` und `$$;`), nicht auf Anweisungsebene.
   */
  const migration = readFileSync("supabase/migrations/0137_catalog_accessories.sql", "utf8");
  const ohneRumpf = migration.replace(/as \$\$[\s\S]*?\$\$;/g, "as $$ … $$;");
  const anweisungen = ohneRumpf
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*--.*$/gm, "");
  for (const dml of [/^\s*insert\s+into\s+public\./im, /^\s*update\s+public\./im,
    /^\s*delete\s+from\s+public\./im, /^\s*truncate/im]) {
    expect(anweisungen, String(dml)).not.toMatch(dml);
  }
  /* Und die drei stehen wirklich in der Datei — sonst prüfte der Test nichts. */
  expect(migration).toMatch(/insert into public\.skylanders/);
});


/* ==========================================================================
 * DIE SIEBEN PRODUCTION-LAEUFE
 *
 * Eigene Dateien, nicht die Staging-Dateien ohne Riegel. Der Unterschied
 * ist der STEMPEL, und er ist umgekehrt: hier muss der Staging-Stempel
 * FEHLEN und `0133` DA sein — `0133` liegt seit dem 2026-10-18 auf
 * Production und fehlt auf Staging, ist also der positive Teil.
 *
 * Dass es sie gibt, hat einen Anlass: am 2026-10-18 sind `0132` und `0133`
 * unbeabsichtigt auf Production gelandet. Eine Datei ohne
 * Umgebungspruefung ist genau der Fehler, der schon passiert ist.
 * ======================================================================== */

const PRODUKTIONSLAEUFE = [
  ["supabase/operations/prod-0135.sql", "0135_catalog_item_type.sql"],
  ["supabase/operations/prod-0136.sql", "0136_business_backup_item_type.sql"],
  ["supabase/operations/prod-0137.sql", "0137_catalog_accessories.sql"],
  ["supabase/operations/prod-0138.sql", "0138_catalog_portals.sql"],
  ["supabase/operations/prod-0139.sql", "0139_accessory_sale_release.sql"],
  ["supabase/operations/prod-0140.sql", "0140_business_backup_sale_release.sql"],
  ["supabase/operations/prod-0141.sql", "0141_seller_sale_state.sql"],
] as const;

describe("die sieben Production-Laeufe", () => {
  for (const [skript, migration] of PRODUKTIONSLAEUFE) {
    const text = readFileSync(skript, "utf8");

    it(`${migration} ist Zeichen für Zeichen eingebettet`, () => {
      const anfang = `-- >>> EINGEBETTET: supabase/migrations/${migration}\n`;
      const ende = `-- <<< ENDE: supabase/migrations/${migration}\n`;
      const a = text.indexOf(anfang);
      const b = text.indexOf(ende);
      expect(a, "Marke fehlt").toBeGreaterThan(-1);
      expect(b, "Endmarke fehlt").toBeGreaterThan(a);
      expect(text.slice(a + anfang.length, b))
        .toBe(readFileSync(`supabase/migrations/${migration}`, "utf8"));
    });

    it(`${skript} trägt den UMGEKEHRTEN Riegel`, () => {
      /*
       * DAS PAAR, NICHT EINE EINZELNE ID. Production trägt `SKY-0821` als
       * ECHTEN Artikel („Winterfest Lob-Star", `source = admin`, angelegt
       * 2026-09-16) — die ID liegt im produktiven Allokationsbereich und
       * gehört dort hin. Eine Prüfung auf „irgendeine der beiden" hätte
       * jede dieser Dateien auf Production abgewiesen; gemessen am
       * 2026-10-21.
       */
      expect(text).toContain("'SKY-0821', 'SKY-0822')) = 2 then");
      expect(text).toContain("ABBRUCH A1: das vollstaendige STAGING-Markerpaar ist da");
      /* Und NICHT die zu scharfe Fassung. */
      expect(text).not.toContain("'SKY-0821', 'SKY-0822')) <> 0 then");
      /* `0133` muss DA sein — der positive, unabhängige Teil. */
      expect(text).toContain("to_regprocedure('public.purchases_paid_total_is_final()') is null");
      expect(text).toContain("ABBRUCH A2");
      /* Und es ist kein leeres Projekt. */
      expect(text).toContain("ABBRUCH A3");
      /* Die Production-Kennung steht drin, die Staging-Kennung nicht. */
      expect(text).toContain("zmiwxswrpkmizvqsgype");
      expect(text).not.toContain("ABBRUCH A1: Umgebungsstempel nicht gefunden");
    });

    it(`${skript} bringt genau eine Klammer mit, und der Stempel steht darin`, () => {
      const zeilen = text.split("\n").map((l) => l.trim());
      expect(zeilen.filter((l) => l === "begin;")).toHaveLength(1);
      expect(zeilen.filter((l) => l === "commit;")).toHaveLength(1);
      /* Der AUSFÜHRBARE Riegel, nicht seine Erwähnung im Kopfkommentar —
         den gibt es auch, und er steht vor `begin;`. */
      const riegel = text.indexOf("raise exception 'ABBRUCH A1");
      expect(riegel).toBeGreaterThan(text.indexOf("begin;"));
      expect(riegel).toBeLessThan(text.indexOf("-- >>> EINGEBETTET"));
    });

    it(`${skript} fügt der Migration nichts Fachliches hinzu`, () => {
      const anfang = text.indexOf("-- >>> EINGEBETTET");
      const ende = text.indexOf("-- <<< ENDE");
      const rahmen = (text.slice(0, anfang) + text.slice(ende))
        .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");
      for (const verboten of ["insert into", "update public.", "delete from",
        "alter table", "create or replace function", "grant ", "revoke "]) {
        expect(rahmen.toLowerCase(), verboten).not.toContain(verboten);
      }
    });
  }

  it("alle sieben tragen DENSELBEN Riegel, Zeichen für Zeichen", () => {
    /*
     * Sieben Dateien, ein Schutz. Sie unterscheiden sich nur darin, welche
     * Staging-Datei die Fehlermeldung als Alternative nennt — das wird
     * herausnormalisiert, alles andere muss gleich sein. Ein Riegel, der
     * in einer von sieben Dateien abweicht, ist in dieser einen Datei
     * kein Riegel.
     */
    const riegel = (skript: string): string => {
      const t = readFileSync(skript, "utf8");
      const a = t.indexOf("do $lauf_a$");
      const b = t.indexOf("$lauf_a$;", a) + "$lauf_a$;".length;
      expect(a, `${skript}: kein Riegel`).toBeGreaterThan(-1);
      return t.slice(a, b).replace(/staging-0\d{3}\.sql/g, "staging-NNNN.sql");
    };
    const alle = new Set(PRODUKTIONSLAEUFE.map(([s]) => riegel(s)));
    expect(alle.size, `${alle.size} verschiedene Riegel`).toBe(1);
    /* Und er enthält genau die drei Bedingungen, keine vierte. */
    const [einer] = [...alle];
    expect(einer.match(/raise exception/g)).toHaveLength(3);
  });

  it("und sie sind NICHT die Staging-Dateien ohne Riegel", () => {
    /*
     * Die Versuchung bei so einer Aufgabe ist, den Stempel zu entfernen.
     * Dann liefe eine Datei ohne jede Umgebungspruefung — und genau das
     * ist am 2026-10-18 schiefgegangen.
     */
    for (const [skript] of PRODUKTIONSLAEUFE) {
      const text = readFileSync(skript, "utf8");
      const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");
      /* Es GIBT eine Umgebungspruefung, und sie ist die umgekehrte: das
         PAAR erkennt Staging, nicht sein Fehlen. */
      expect(code).toContain("raise exception 'ABBRUCH A1");
      expect(code).toContain(")) = 2 then");
    }
  });

  it("0138 warnt im Kopf, dass sie nach dem Deployment gehört", () => {
    /*
     * Der eine Schritt, dessen Reihenfolge nicht beliebig ist: der heute
     * deployte Code (81386e6) kennt nur `Spiele` als nicht sammelbar und
     * zeigte 21 Portale als Figuren.
     */
    const text = readFileSync("supabase/operations/prod-0138.sql", "utf8");
    expect(text).toContain("ERST NACH DEM VERCEL-DEPLOYMENT");
    expect(text).toContain("81386e6");
  });
});
