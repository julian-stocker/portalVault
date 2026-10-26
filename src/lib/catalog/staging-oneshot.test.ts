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
  /* Und `0142` — dieselbe Form, eine andere Sache: die gespeicherten
     Einkaufskalkulationen (ADR-0131). */
  ["supabase/operations/staging-0142.sql", "0142_purchase_calculations.sql"],
  /* Und `0143` — die Uebernahme ins Orderbuch (ADR-0132). */
  ["supabase/operations/staging-0143.sql", "0143_purchase_from_calculation.sql"],
  ["supabase/operations/staging-0144.sql", "0144_platform_export_calculations.sql"],
  /* Und `0145` — die Favoriten (ADR-0136). Eine Tabelle, drei Richtlinien,
     eine Aggregatfunktion; rein additiv. */
  ["supabase/operations/staging-0145.sql", "0145_favorites.sql"],
  /* Und `0146` — der Angebotsspiegel (Phase 4 S1). Eine Tabelle, eine
     Sicht, zwei Funktionen, KEIN Trigger; rein additiv. */
  ["supabase/operations/staging-0146.sql", "0146_offer_state.sql"],
  /* Und `0147` — die Verfuegbarkeitskante (Phase 4 S2). Eine Spalte, ein
     CHECK, eine ersetzte und zwei neue Funktionen; KEIN Trigger, keine
     Tabelle. Sie setzt `0146` voraus und prueft das selbst. */
  ["supabase/operations/staging-0147.sql", "0147_offer_availability.sql"],
  /* Und `0148` — die persoenlichen Meldungen (Phase 4 S3). Eine Tabelle,
     eine Richtlinie, eine Funktion; KEIN Trigger, kein Scheduler. Sie setzt
     `0145`, `0146` und `0147` voraus und prueft jedes selbst. */
  ["supabase/operations/staging-0148.sql", "0148_availability_notifications.sql"],
  /* Und `0149` — der Lesezustand (Phase 4 S4). Sie stand bis jetzt NICHT in
     dieser Liste, obwohl ihre Huelle im Kopf zusagt, dass dieser Test sie
     vergleicht. Eine Zusage, die niemand prueft, ist keine. */
  ["supabase/operations/staging-0149.sql", "0149_notification_read_state.sql"],
  /* Und `0150` — die Verfuegbarkeitsalarme (ADR-0147). Eine Tabelle, eine
     Richtlinie, drei Teilindizes, vier Funktionen; KEIN Trigger, kein
     Scheduler, kein Aufrufer. Sie setzt von `0146` nur die SICHT voraus. */
  ["supabase/operations/staging-0150.sql", "0150_availability_alerts.sql"],
  /* Und `0151` — die Live-Sicht eigenstaendig (ADR-0147, E-1/B2). Sie
     gehoert fachlich VOR `0150`, steht hier aber nach ihr: diese Liste ist
     nach Dateinamen sortiert und sagt nichts ueber die Laufreihenfolge. */
  ["supabase/operations/staging-0151.sql", "0151_offer_state_live.sql"],
] as const;

describe("die Einzellaeufe fuer 0139 bis 0151", () => {
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

/*
 * Die Nachkontrolle zu `0142` ist dieselbe Bauform mit einem Unterschied:
 * sie braucht keinen Z0-Vertrag. Ihre Erwartungen sind strukturell —
 * Spalten, Richtlinien, Rechte, Indizes —, und die sind in beiden
 * Umgebungen gleich. Deshalb steht sie in einer eigenen Liste und wird nur
 * auf Einbettung und Schreibfreiheit geprüft.
 */
const LESELAEUFE_OHNE_Z0 = [
  ["supabase/operations/staging-s-postflight-0142.sql", "0142_postflight.sql"],
  ["supabase/operations/staging-s-postflight-0143.sql", "0143_postflight.sql"],
  /*
   * UND DIE BEIDEN ZU `0144` UND `0145`.
   *
   * Die zu `0144` lagen bis zum 2026-10-25 unregistriert im Ordner — die
   * Dateien gab es, die Zusicherung „Zeichen fuer Zeichen eingebettet" galt
   * fuer sie nicht. Aufgefallen beim Anlegen der Huellen zu `0145`; eine
   * Luecke in einem Waechter, nicht in einer Datei.
   */
  ["supabase/operations/staging-s-preflight-0144.sql", "0144_preflight.sql"],
  ["supabase/operations/staging-s-postflight-0144.sql", "0144_postflight.sql"],
  ["supabase/operations/staging-s-preflight-0145.sql", "0145_preflight.sql"],
  ["supabase/operations/staging-s-postflight-0145.sql", "0145_postflight.sql"],
  ["supabase/operations/staging-s-preflight-0146.sql", "0146_preflight.sql"],
  ["supabase/operations/staging-s-postflight-0146.sql", "0146_postflight.sql"],
] as const;

describe.each(LESELAEUFE_OHNE_Z0)("der lesende Staging-Lauf %s", (skript, pruefdatei) => {
  const text = readFileSync(skript, "utf8");

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

  it("trägt den Staging-Stempel und endet mit rollback", () => {
    expect(text).toContain("SKY-0821");
    expect(text).toContain("SKY-0822");
    expect(text).toContain("ABBRUCH A1");
    const zeilen = text.split("\n").map((l) => l.trim());
    expect(zeilen.filter((l) => l === "begin;")).toHaveLength(1);
    expect(zeilen.filter((l) => l === "rollback;")).toHaveLength(1);
    expect(zeilen.filter((l) => l === "commit;")).toHaveLength(0);
  });

  it("und schreibt nichts", () => {
    const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");
    for (const verboten of ["insert into", "update public.", "delete from",
      "alter table", "create table", "create policy", "grant ", "revoke "]) {
      expect(code.toLowerCase(), verboten).not.toContain(verboten);
    }
  });
});

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

/*
 * ZWEI FAMILIEN, EIN UNTERSCHIED: DER Z0-MODUS.
 *
 * `0136`-`0138` hatten keine Production-Bezugszahlen — dort ist `keine` der
 * ausdrückliche Verzicht. Für `0139` sind sie gemessen, also wird daraus
 * `production`, und sechs Messungen werden zu sechs blockierenden
 * Erwartungen. Beide Familien tragen denselben Riegel und schreiben nichts.
 */
const PROD_LESELAEUFE = [
  ["supabase/operations/prod-s-postflight-0136.sql", "0136_postflight.sql"],
  ["supabase/operations/prod-s-postflight-0137.sql", "0137_postflight.sql"],
  /* `0138` legt ZEILEN an — hier gehört auch das Vorher dazu, sonst gibt es
     nichts zu vergleichen. */
  ["supabase/operations/prod-s-preflight-0138.sql", "0138_preflight.sql"],
  ["supabase/operations/prod-s-postflight-0138.sql", "0138_postflight.sql"],
] as const;

const PROD_LESELAEUFE_PRODUKTIONSMODUS = [
  ["supabase/operations/prod-s-preflight-0139.sql", "0139_preflight.sql"],
  ["supabase/operations/prod-s-postflight-0139.sql", "0139_postflight.sql"],
  ["supabase/operations/prod-s-preflight-0140.sql", "0140_preflight.sql"],
  ["supabase/operations/prod-s-postflight-0140.sql", "0140_postflight.sql"],
  ["supabase/operations/prod-s-preflight-0141.sql", "0141_preflight.sql"],
  ["supabase/operations/prod-s-postflight-0141.sql", "0141_postflight.sql"],
] as const;

/*
 * DIE DRITTE FAMILIE: DER BASIS-VERTRAG (berichtigt am 2026-10-25).
 *
 * Hier stand eine Familie „ohne Z0-Vertrag", und das war richtig, solange
 * die Nachkontrollen zu `0142`/`0143` nur nach Schema fragten. Der
 * Production-Preflight am 2026-10-25 hat gezeigt, was fehlte: die sieben
 * Geschäftszahlen standen als BLOCKIERENDE Konstanten vom 21. Oktober im
 * Preflight und hielten das Release an, weil der Betrieb Ware eingebucht
 * hatte — 31 Lagerzeilen, 20 Angebote (`production_baseline_0142_finding.md`).
 *
 * Seitdem gilt: der Preflight MESST sie und gibt sie als eine Zeile aus
 * (Zeile 900), die Nachkontrolle nimmt sie über
 * `set_config('skyisles.base', …)` entgegen und vergleicht BLOCKIEREND.
 * Keine Konstante mehr, und die Frage ist die richtige — nicht „sieht
 * Production aus wie am 21. Oktober", sondern „hat die Migration den Shop
 * angefasst".
 *
 * Die vier Dateien teilen deshalb einen Vertrag, und er wird hier geprüft.
 * Was die ÜBERGABE aushält — fehlend, abgeschnitten, vertauscht,
 * manipuliert — prüft Probelauf **P50** an echtem PostgreSQL; hier steht,
 * dass der Vertrag in allen vier Dateien derselbe ist.
 */
const BASIS_FELDER = [
  "angebote", "angebote_md5", "shopfaehig", "sammelbar",
  "lagerzeilen", "katalogzeilen", "lager_md5",
] as const;

const PROD_LESELAEUFE_BASIS = [
  ["supabase/operations/prod-s-preflight-0142.sql", "0142_preflight.sql", "pre"],
  ["supabase/operations/prod-s-postflight-0142.sql", "0142_postflight.sql", "post"],
  ["supabase/operations/prod-s-preflight-0143.sql", "0143_preflight.sql", "pre"],
  ["supabase/operations/prod-s-postflight-0143.sql", "0143_postflight.sql", "post"],
  ["supabase/operations/prod-s-preflight-0144.sql", "0144_preflight.sql", "pre"],
  ["supabase/operations/prod-s-postflight-0144.sql", "0144_postflight.sql", "post"],
  ["supabase/operations/prod-s-preflight-0145.sql", "0145_preflight.sql", "pre"],
  ["supabase/operations/prod-s-postflight-0145.sql", "0145_postflight.sql", "post"],
  ["supabase/operations/prod-s-preflight-0146.sql", "0146_preflight.sql", "pre"],
  ["supabase/operations/prod-s-postflight-0146.sql", "0146_postflight.sql", "post"],
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

  /*
   * GEGEN DEN FLIESSTEXT, NICHT GEGEN DEN ZEILENUMBRUCH.
   *
   * Die Kopfkommentare sind auf 76 Zeichen gebrochen, und ein Satz kann
   * mitten im Begriff umbrechen. Eine Suche im Rohtext fand deshalb
   * „zeigt `NOTICE`-Meldungen nicht" in einer Datei und in der nächsten
   * nicht — ein Befund über die Formatierung, nicht über den Inhalt.
   */
  const fliesstext = text.replace(/^\s*--\s?/gm, "").replace(/\s+/g, " ");

  it("sagt, warum Success ohne NOTICE kein Befund ist", () => {
    /* Die Frage des Bedieners vom 2026-10-21 gehört in die Datei, nicht nur
       in den Chatverlauf. */
    expect(fliesstext).toContain("zeigt `NOTICE`-Meldungen nicht");
  });

  it("nennt die Production-Erwartung der unbewerteten Zeilen", () => {
    /* „Messung ohne Sollwert" darf nicht heißen „niemand weiß, was
       rauskommen soll": die vorhersagbaren Werte stehen im Kopf, und die
       Datei sagt, welche Zeilen ohne Sollwert bleiben. */
    expect(fliesstext).toContain("287");
    expect(fliesstext).toContain("531");
    expect(fliesstext).toMatch(/Messungen? ohne Sollwert|NOTIEREN|nicht vorhersagbar/);
  });
});

describe.each(PROD_LESELAEUFE_PRODUKTIONSMODUS)(
  "der lesende Production-Lauf %s (Modus production)", (datei, pruefdatei) => {
  const text = readFileSync(datei, "utf8");
  const fliesstext = text.replace(/^\s*--\s?/gm, "").replace(/\s+/g, " ");

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
    const schreibend = readFileSync("supabase/operations/prod-0136.sql", "utf8");
    for (const bedingung of [
      "if (select count(*) from public.skylanders\n       where sky_id in ('SKY-0821', 'SKY-0822')) = 2 then",
      "if to_regprocedure('public.purchases_paid_total_is_final()') is null then",
      "if (select count(*) from public.skylanders) < 100 then",
    ]) {
      expect(schreibend, bedingung).toContain(bedingung);
      expect(text, bedingung).toContain(bedingung);
    }
  });

  it("wählt den Modus production — und begründet, warum nicht keine", () => {
    const config = text.indexOf("select set_config('skyisles.z0', 'production', true);");
    expect(config, "set_config fehlt").toBeGreaterThan(-1);
    const ohneKommentar = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");
    expect(ohneKommentar).not.toContain("'skyisles.z0', 'staging'");
    expect(ohneKommentar).not.toContain("'skyisles.z0', 'keine'");
    expect(text.indexOf("do $lauf_a$")).toBeLessThan(config);
    expect(config).toBeLessThan(text.indexOf("-- >>> EINGEBETTET"));
    /*
     * Der Unterschied zu den drei Nachkontrollen davor gehört in die Datei:
     * dort war `keine` ein Verzicht, hier sind die Zahlen gemessen. Geprüft
     * wird die AUSSAGE, nicht eine Formulierung — „blockierend" in beliebiger
     * Beugung, zusammen mit dem Wort, das sie begründet.
     */
    expect(fliesstext).toMatch(/BLOCKIEREND/);
    expect(fliesstext).toMatch(/gemessen/);
  });

  it("nennt die sechs Bezugszahlen, die blockierend werden", () => {
    for (const wert of ["287", "9b8341058bbfa0f7809eddc300ab0e9e", "531", "306", "624"]) {
      expect(fliesstext, wert).toContain(wert);
    }
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
});

describe.each(PROD_LESELAEUFE_BASIS)(
  "der lesende Production-Lauf %s (Basis-Vertrag)", (datei, pruefdatei, rolle) => {
  const text = readFileSync(datei, "utf8");
  const pruef = readFileSync(`supabase/checks/${pruefdatei}`, "utf8");
  const fliesstext = text.replace(/^\s*--\s?/gm, "").replace(/\s+/g, " ");

  it(`bettet ${pruefdatei} Zeichen für Zeichen ein`, () => {
    const anfang = `-- >>> EINGEBETTET: supabase/checks/${pruefdatei}\n`;
    const ende = `-- <<< ENDE: supabase/checks/${pruefdatei}\n`;
    const a = text.indexOf(anfang);
    const b = text.indexOf(ende);
    expect(a, "Marke fehlt").toBeGreaterThan(-1);
    expect(b, "Endmarke fehlt").toBeGreaterThan(a);
    expect(text.slice(a + anfang.length, b)).toBe(pruef);
  });

  it("trägt den Riegel der zehn — zeichengleich in allen drei Bedingungen", () => {
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

  it("führt KEINE festen Geschäftszahlen mehr", () => {
    /*
     * DER FEHLER VOM 2026-10-25, festgehalten. Diese vier Werte standen als
     * blockierende Sollwerte in den Preflights und hielten das Release an,
     * weil der Betrieb Ware eingebucht hatte. Eine Konstante von vorgestern
     * kann „nach der Migration dasselbe wie vorher" nicht ausdrücken.
     */
    for (const veraltet of ["'287'", "'306'", "'9b8341058bbfa0f7809eddc300ab0e9e'",
      "'01e50b9d727a0486ff1ea0eb6ba2dd56'", "'531'", "'624'"]) {
      expect(pruef, `${veraltet} ist wieder ein Sollwert`).not.toContain(veraltet);
    }
    /* Und auch kein Z0-Vertrag, der sie zurückholen könnte. */
    expect(pruef).not.toContain("z0 (schluessel, staging, production)");
    expect(pruef).not.toContain("skyisles.z0");
  });

  it("nennt die sieben Felder in der festen, dokumentierten Reihenfolge", () => {
    /*
     * Positionen, nicht Namen: `t[2]` … `t[8]`. Eine vertauschte Zeile wäre
     * sonst eine stille Fehlinformation — deshalb steht die Reihenfolge
     * sowohl im Kopf als auch in der Schutzsumme.
     */
    const kopf = fliesstext.indexOf("skyisles-base-1|angebote|angebote_md5");
    expect(kopf, "die Reihenfolge steht nicht im Kopf").toBeGreaterThan(-1);
    for (const [i, feld] of BASIS_FELDER.entries()) {
      expect(pruef, `${feld} fehlt`).toContain(feld);
      /* Die Feldliste des Vertrags, in der Reihenfolge, als Prosa. */
      const vor = BASIS_FELDER.slice(0, i).join("");
      expect(vor.length >= 0).toBe(true);
    }
    expect(pruef).toContain("1  skyisles-base-1");
    expect(pruef).toContain("9  schutz");
  });

  if (rolle === "pre") {
    it("MESST die sieben Werte und gibt sie als eine Zeile aus", () => {
      /* Keine Erwartung an einer Geschäftszahl — nur Messungen. */
      expect(pruef).toContain("(900, 'BASIS'");
      expect(pruef).toContain("'skyisles-base-1|' || kern || '|' || left(md5(kern), 12)");
      /* Und die Hülle sagt, dass Zeile 900 weitergeht. */
      expect(fliesstext).toContain("ZEILE 900 IST DAS ERGEBNIS, DAS WEITERGEHT");
      /*
       * Sie nimmt selbst KEINE Baseline entgegen — sie erzeugt eine. Geprüft
       * am AUSFÜHRBAREN Teil: die eingebettete Prüfdatei nennt
       * `set_config` in ihrem Kommentar als Gebrauchsanweisung, und ein
       * Kommentar setzt nichts.
       */
      const ausfuehrbar = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");
      expect(ausfuehrbar).not.toContain("set_config('skyisles.base'");
    });
  } else {
    it("NIMMT die Baseline entgegen, mit einem Platzhalter, der nicht durchgeht", () => {
      expect(text).toContain("select set_config('skyisles.base', 'BASIS-HIER-EINSETZEN', true);");
      /*
       * DER PLATZHALTER DARF NICHT ALS BASIS ZAEHLEN. Die Hülle bringt die
       * Zeile mit, damit niemand sie vergisst — genau deshalb muss ein
       * stehengelassener Platzhalter so behandelt werden wie eine fehlende
       * Zeile, sonst wäre die Bequemlichkeit die Lücke.
       */
      expect(pruef).toContain("'BASIS-HIER-EINSETZEN') as roh");
      expect(fliesstext).toContain("BLEIBT DER PLATZHALTER STEHEN, LAEUFT DIESE DATEI NICHT DURCH");
    });

    it("vergleicht alle sieben BLOCKIEREND, und zwar gegen die Basis", () => {
      for (const nr of [811, 812, 813, 814, 815, 816, 817]) {
        expect(pruef, `Zeile ${nr} fehlt`).toContain(`(${nr}, 'Shop'`);
      }
      /* Jede Erwartung kommt aus der übergebenen Zeile, keine aus der Messung. */
      expect(pruef.match(/when gueltig then t\[[2-8]\]/g)).toHaveLength(7);
      /* Vier Fragen an die Zeile, bevor ein Wert verglichen wird. */
      for (const nr of [801, 802, 803, 804]) {
        expect(pruef, `Zeile ${nr} fehlt`).toContain(`(${nr}, 'Basis'`);
      }
    });

    it("setzt NIE die aktuellen Werte als Sollwert ein", () => {
      /*
       * Der Fehler, der hier nie passieren darf: eine fehlende Basis durch
       * das Gemessene ersetzen. Ohne gültige Zeile steht in der Spalte
       * `erwartet` ein Satz und keine Zahl — und die Zeile ist rot.
       */
      expect(pruef).toContain("else '(keine gueltige Basis)' end");
      expect(pruef).not.toMatch(/when gueltig then t\[\d\] else .*basis_mess/);
      /* Zeile 819 zeigt den heutigen Stand — als MESSUNG, nicht als Soll. */
      expect(pruef).toContain("(819, 'Basis', 'Info: der heutige Stand als Baseline-Zeile',");
    });

    it("sagt, wo die Grenze eines Vorher-Nachher-Vergleichs liegt", () => {
      /*
       * Er sagt „zwischen den Läufen hat sich X bewegt", nicht WER es bewegt
       * hat. Dass regulärer Betrieb dazwischenkommen kann, gehört in die
       * Datei — samt der drei Wege, es zu unterscheiden.
       */
      expect(fliesstext).toContain("DIE GRENZE EINES VORHER-NACHHER-VERGLEICHS");
      expect(fliesstext).toContain("ZEITFENSTER KLEIN HALTEN");
      expect(fliesstext).toContain("prod-s-baseline-drift.sql");
      /* Und was er grundsätzlich nicht kann. */
      expect(fliesstext).toMatch(/gegenseitig aufheben/);
    });
  }

  it("sagt, warum Success ohne NOTICE kein Befund ist", () => {
    expect(fliesstext).toContain("zeigt `NOTICE`-Meldungen nicht");
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
});

describe("die vier Dateien teilen EINEN Basis-Vertrag", () => {
  it("die Messung ist in allen vier Dateien zeichengleich", () => {
    /*
     * Der Vergleich funktioniert nur, wenn Preflight und Nachkontrolle
     * dieselbe Formel benutzen. Eine Abweichung um ein Zeichen — ein
     * anderes Trennzeichen, eine andere Sortierung — machte aus jedem Lauf
     * eine falsche Abweichung.
     */
    const bloecke = PROD_LESELAEUFE_BASIS.map(([, pruefdatei]) => {
      const t = readFileSync(`supabase/checks/${pruefdatei}`, "utf8");
      const a = t.indexOf("basis_mess as (");
      const b = t.indexOf("basis_feld as (");
      expect(a, `${pruefdatei}: keine Messung`).toBeGreaterThan(-1);
      expect(b, `${pruefdatei}: kein basis_feld`).toBeGreaterThan(a);
      return t.slice(a, b);
    });
    expect(new Set(bloecke).size, "die Messung weicht ab").toBe(1);
  });

  it("und die Schutzsumme wird überall gleich gebildet", () => {
    for (const [, pruefdatei] of PROD_LESELAEUFE_BASIS) {
      const t = readFileSync(`supabase/checks/${pruefdatei}`, "utf8");
      expect(t, pruefdatei).toContain("left(md5(");
    }
  });
});

describe("die Ursachenprüfung zum Ausgangszustand (2026-10-25)", () => {
  /*
   * ANLASS. Der Preflight zu `0142` meldete vier Abweichungen — Angebote,
   * Lagerzeilen und die beiden Abdrücke. Diese Datei fragt nicht „sind die
   * Zahlen anders" (das ist bekannt), sondern ob die Differenz VOLLSTÄNDIG
   * erklärt ist. Sie gehört damit zu keiner der drei Familien oben: sie ist
   * weder Vor- noch Nachkontrolle einer Migration, sondern eine Diagnose.
   */
  const PRUEF = "supabase/checks/production_baseline_drift.sql";
  const HUELLE = "supabase/operations/prod-s-baseline-drift.sql";
  const pruef = readFileSync(PRUEF, "utf8");
  const text = readFileSync(HUELLE, "utf8");

  it("die Hülle bettet die Prüfung Zeichen für Zeichen ein", () => {
    const anfang = `-- >>> EINGEBETTET: ${PRUEF}\n`;
    const ende = `-- <<< ENDE: ${PRUEF}\n`;
    const a = text.indexOf(anfang);
    const b = text.indexOf(ende);
    expect(a, "Marke fehlt").toBeGreaterThan(-1);
    expect(b, "Endmarke fehlt").toBeGreaterThan(a);
    expect(text.slice(a + anfang.length, b)).toBe(pruef);
  });

  it("und trägt den Riegel der neun, zeichengleich", () => {
    const schreibend = readFileSync("supabase/operations/prod-0136.sql", "utf8");
    for (const bedingung of [
      "if (select count(*) from public.skylanders\n       where sky_id in ('SKY-0821', 'SKY-0822')) = 2 then",
      "if to_regprocedure('public.purchases_paid_total_is_final()') is null then",
      "if (select count(*) from public.skylanders) < 100 then",
    ]) {
      expect(schreibend, bedingung).toContain(bedingung);
      expect(text, bedingung).toContain(bedingung);
    }
  });

  it("die drei Zeilen, die wirklich blockieren, sind 101, 111 und 201", () => {
    /*
     * DAS IST DER GANZE PUNKT DIESER DATEI. Eine Zahl, die sich in einem
     * laufenden Betrieb bewegt, ist kein Fehler; eine Zeile, die
     * verschwindet, schon. Also blockiert nicht „307 statt 287", sondern:
     * stehen die 306 alten Lagerzeilen noch, sind die 287 alten Angebote
     * noch Angebote, und hat jede neue Zeile eine Buchung.
     */
    expect(pruef).toContain("(select count(*)::text from lager where not ist_neu), '306')");
    expect(pruef).toContain("(select count(*)::text from angebot where not ist_neu), '287')");
    expect(pruef).toContain("where m.inventory_id = l.id)), '0')");
  });

  it("die gewanderten Zahlen selbst sind MESSUNGEN, keine Erwartungen", () => {
    /*
     * Die vier Werte, die rot waren, dürfen hier keinen Sollwert haben —
     * sonst stünde dieselbe veraltete Konstante ein zweites Mal da, nur in
     * einer Datei, die sie aufklären soll.
     */
    for (const alt of ["287", "9b8341058bbfa0f7809eddc300ab0e9e",
      "01e50b9d727a0486ff1ea0eb6ba2dd56"]) {
      const stellen = [...pruef.matchAll(new RegExp(`'${alt}'`, "g"))];
      /* `287` darf genau einmal vorkommen: als Erwartung an Zeile 111
         („die alten Angebote sind noch Angebote"), nicht als Erwartung an
         die heutige Gesamtzahl. */
      expect(stellen.length, `${alt} als Sollwert`).toBeLessThanOrEqual(1);
    }
    /* Die heutigen Zahlen stehen ohne Sollwert da. */
    expect(pruef).toContain("(select count(*)::text from lager), null)");
    expect(pruef).toContain("(select count(*)::text from angebot), null)");
  });

  it("macht die Grenze sichtbar, statt sie zu behaupten", () => {
    /* Zwei Zeitachsen-Zeilen, damit am Grenztag nichts untergeht. */
    expect(pruef).toContain("Lagerzeilen je Anlagetag, letzte 21 Tage");
    expect(pruef).toContain("Bewegungen je Tag und Grund, letzte 21 Tage");
    expect(pruef).toContain("Europe/Berlin");
  });

  it("nennt die Grenze dieser Auskunft, statt sie zu verschweigen", () => {
    /*
     * Ein md5 lässt sich nicht aufschlüsseln, und für Preise führt dieses
     * Projekt kein Journal. Was die Datei NICHT beantworten kann, steht in
     * ihr drin — sonst liest sich eine Lücke wie ein Freispruch.
     */
    expect(pruef).toContain("laesst sich nicht aufschluesseln");
    expect(pruef).toMatch(/Journal fuer Preise fuehrt dieses\n\s*--\s*\* Projekt NICHT|Journal fuer Preise/);
  });

  it("gibt den neuen Ausgangszustand als eine Zeile aus — mit Vorbehalt", () => {
    expect(pruef).toContain("(900, 'NEUE BASIS'");
    expect(pruef).toContain("erst uebernehmen");
    /* Die sieben Werte in der Reihenfolge des Z0-Vertrags. */
    expect(pruef).toContain("angebote | angebote_md5 | shopfaehig | sammelbar");
  });

  it("schreibt nichts und wendet 0142 nicht an", () => {
    const zeilen = text.split("\n").map((l) => l.trim());
    expect(zeilen.filter((l) => l === "begin;")).toHaveLength(1);
    expect(zeilen.filter((l) => l === "rollback;")).toHaveLength(1);
    expect(zeilen.filter((l) => l === "commit;")).toHaveLength(0);
    const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");
    for (const verboten of ["insert into", "update public.", "delete from",
      "alter table", "create ", "grant ", "revoke "]) {
      expect(code.toLowerCase(), verboten).not.toContain(verboten);
    }
    expect(code).not.toContain("purchase_calculations");
  });
});

describe("die beiden Prüfdateien zu 0139 kennen zwei Umgebungen", () => {
  /*
   * Vorher stand dort EIN Sollwertsatz — der von Staging. Auf Production
   * hätte Zeile 1 (das Markerpaar) `true` verlangt und wäre rot gewesen,
   * obwohl nichts falsch ist; die sechs Bezugszahlen wären im Modus `keine`
   * stumm geblieben, gerade die, auf die es bei `0139` ankommt.
   */
  for (const datei of ["supabase/checks/0139_preflight.sql",
    "supabase/checks/0139_postflight.sql"]) {
    const text = readFileSync(datei, "utf8");

    it(`${datei} führt beide Spalten`, () => {
      expect(text).toContain("z0 (schluessel, staging, production)");
      expect(text).toContain("when 'production' then z.production");
      /* Staging bleibt unverändert — das ist die Probe, dass hier nichts
         umgeschrieben, sondern etwas ergänzt wurde. */
      expect(text).toContain("('angebote',      '256', '287')");
      expect(text).toContain("4d1d6c30fe0ae886ca2689bcb1fe9634");
      expect(text).toContain("9b8341058bbfa0f7809eddc300ab0e9e");
    });

    it(`${datei} lässt den Modus production als gewählt gelten`, () => {
      expect(text).toContain("v.modus in ('staging', 'production', 'keine')");
    });
  }

  it("und der Preflight erwartet das Markerpaar umgebungsabhängig", () => {
    const text = readFileSync("supabase/checks/0139_preflight.sql", "utf8");
    expect(text).toContain("when 'staging' then 'true'");
    expect(text).toContain("when 'production' then 'false'");
  });

  it("die Staging-Hüllen betten die berichtigten Fassungen ein", () => {
    /* Sonst liefe auf Staging eine andere Datei als die, die hier steht. */
    for (const [huelle, pruef] of [
      ["supabase/operations/staging-s1-preflight-0139.sql", "0139_preflight.sql"],
      ["supabase/operations/staging-s3-postflight-0139.sql", "0139_postflight.sql"],
    ]) {
      const h = readFileSync(huelle, "utf8");
      expect(h, huelle).toContain("z0 (schluessel, staging, production)");
      expect(h, huelle).toContain(readFileSync(`supabase/checks/${pruef}`, "utf8"));
    }
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

describe("die zwei lesenden Production-Läufe zu 0138 — Vorher und Nachher", () => {
  const vorher = readFileSync("supabase/operations/prod-s-preflight-0138.sql", "utf8");
  const nachher = readFileSync("supabase/operations/prod-s-postflight-0138.sql", "utf8");

  it("der Preflight sagt, warum er nicht optional ist", () => {
    /*
     * `0138` ist die erste Migration dieses Releases, die Zeilen anlegt.
     * „Nichts anderes hat sich bewegt" ist ein VERGLEICH — ohne Vorher ist
     * der Postflight nur eine Messung.
     */
    expect(vorher).toContain("ein VERGLEICH, und ein Vergleich braucht ein");
    expect(vorher).toContain("401-409");
  });

  it("beide nennen dieselben Bezugswerte, und der Postflight die eine Änderung", () => {
    for (const text of [vorher, nachher]) {
      expect(text).toContain("9b8341058bbfa0f7809eddc300ab0e9e");
      expect(text).toContain("G=81,I=77,SA=74,SC=69,SF=89,T=141");
      expect(text).toContain("531");
      expect(text).toContain("287");
    }
    /* Genau eine Veränderung ist erwartet, und sie steht da: + 21. */
    expect(nachher).toContain("**+ 21**");
    expect(nachher).toContain("**+ `portal=21`**");
  });

  it("der Postflight nennt beide Riegel getrennt", () => {
    /*
     * Ein Portal ist nicht sammelbar, weil seine KATEGORIE in der Liste
     * steht, UND weil sein ARTIKELTYP nicht `figure` ist. Keiner der beiden
     * hängt am anderen — also werden beide gefragt.
     */
    expect(nachher).toContain("RIEGEL 1");
    expect(nachher).toContain("RIEGEL 2");
  });

  it("und er sagt, was eine Abweichung in den GLEICH-Zeilen bedeutet", () => {
    /* Nicht „dann ist 0138 schuld": die Migration hätte abgebrochen. Dann
       hat sich zwischen den Läufen etwas anderes bewegt. */
    expect(nachher).toContain("S5");
    expect(nachher).toContain("zwischen den beiden Laeufen etwas anderes bewegt");
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
  /*
   * Das Release 0142/0143 (Calculator V2.1 und V3). Dieselbe Form, derselbe
   * Riegel — und derselbe Grund: eine Datei ohne Umgebungspruefung ist der
   * Fehler, der am 2026-10-18 schon passiert ist.
   */
  ["supabase/operations/prod-0142.sql", "0142_purchase_calculations.sql"],
  ["supabase/operations/prod-0143.sql", "0143_purchase_from_calculation.sql"],
  /* `0144`: die Sicherungsfunktion bekommt einen Bereich mehr. */
  ["supabase/operations/prod-0144.sql", "0144_platform_export_calculations.sql"],
  /* `0145`: die Favoriten. NICHT fahren, bevor die Folgemigration sie in die
     Plattformsicherung aufgenommen hat — die Huelle sagt es in ihrem Kopf. */
  ["supabase/operations/prod-0145.sql", "0145_favorites.sql"],
  /* `0146`: der Angebotsspiegel. NICHT fahren, bevor die Folgemigration
     favorites UND offer_state in die Plattformsicherung aufgenommen hat. */
  ["supabase/operations/prod-0146.sql", "0146_offer_state.sql"],
] as const;

describe("die zehn Production-Laeufe", () => {
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

  it("alle zehn tragen DENSELBEN Riegel, Zeichen für Zeichen", () => {
    /*
     * Zehn Dateien, ein Schutz. Sie unterscheiden sich nur darin, welche
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
