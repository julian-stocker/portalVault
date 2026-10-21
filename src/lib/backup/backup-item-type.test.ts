/**
 * `0136` — der Artikeltyp in der Betriebssicherung, und der Beweis, dass sonst
 * nichts passiert ist.
 *
 * WAS DIESE DATEI PRÜFT UND WARUM SIE NÖTIG IST. `0136` ersetzt einen
 * Funktionsrumpf von 21 494 Zeichen. Niemand liest das nach. Prüfbar ist
 * dagegen die BEHAUPTUNG der Migration: ihr Rumpf ist der aus `0131`, Zeichen
 * für Zeichen, mit GENAU EINER eingefügten Zeile. Diese Datei rechnet das
 * nach — die Einfügung, die Abdrücke, die Feldzahlen, die Rücknahme und die
 * Reihenfolge.
 *
 * WAS SIE NICHT KANN. Sie liest Dateien, keine Datenbank. Dass der Rumpf sich
 * in PostgreSQL ERZEUGEN lässt und die Migration in einer Transaktion
 * durchläuft, prüft `npm run verify:check-sql` (Stufen 3 und 4, PGlite); dass
 * er in der Datenbank STEHT, prüft `supabase/checks/0131_function_body_check.sql`.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

import { BACKUP_SECTIONS } from "./manifest";
import { fieldsFromBackupSql } from "./export-audit";

const md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");
const datei = (p: string) => readFileSync(p, "utf8");

const M0131 = datei("supabase/migrations/0131_business_backup_seller_fields.sql");
const M0136 = datei("supabase/migrations/0136_business_backup_item_type.sql");
const R0136 = datei("supabase/rollback/R0136_back_to_0131.sql");
const R0135 = datei("supabase/rollback/R0135_drop_item_type.sql");
const PRUEFUNG = datei("supabase/checks/0131_function_body_check.sql");

/** Genau der Text zwischen den Dollarzeichen — das ist, was `prosrc` enthält. */
function rumpf(sql: string): string {
  const i = sql.indexOf("create or replace function public.seller_business_backup()");
  const a = sql.indexOf("as $$", i) + "as $$".length;
  return sql.slice(a, sql.indexOf("$$;", a));
}

/**
 * Eine Datei ohne Prosa — für jede Abwesenheitsbehauptung.
 *
 * Dieselbe Falle wie dreimal zuvor in diesem Projekt: die Kopfkommentare
 * ERKLÄREN, welche Anweisung verboten ist, und ein `not.toContain` über die
 * ganze Datei findet die Erklärung.
 */
const ohneProsa = (sql: string): string =>
  sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");

/** Der Kommentartext, wie er in `pg_description` landet. */
function kommentar(sql: string): string {
  const j = sql.indexOf("comment on function public.seller_business_backup() is");
  const a = sql.indexOf("'", j);
  return sql.slice(a + 1, sql.indexOf("';", j)).replace(/''/g, "'");
}

const EINGEFUEGT = "          'item_type', t.item_type,\n";
const DAVOR = "          'card_type', t.card_type,\n";

/* ==========================================================================
 * 1. Eine Zeile. Nicht „ungefähr eine Zeile".
 * ======================================================================== */

describe("der Rumpf aus 0136 ist der aus 0131 plus genau eine Zeile", () => {
  const alt = rumpf(M0131);
  const neu = rumpf(M0136);

  it("die eingefügte Zeile steht unmittelbar nach card_type", () => {
    expect(alt).toContain(DAVOR);
    expect(neu).toContain(DAVOR + EINGEFUEGT);
  });

  it("und nimmt man sie heraus, ist der Rumpf ZEICHENGLEICH dem aus 0131", () => {
    expect(neu.replace(EINGEFUEGT, "")).toBe(alt);
  });

  it("es ist genau eine Zeile mehr, und genau 36 Zeichen", () => {
    expect(neu.split("\n").length - alt.split("\n").length).toBe(1);
    expect(neu.length - alt.length).toBe(EINGEFUEGT.length);
    expect(EINGEFUEGT.length).toBe(36);
  });

  it("die Zeile kommt genau einmal vor — kein zweiter Bereich bekommt sie", () => {
    expect(neu.split(EINGEFUEGT)).toHaveLength(2);
  });
});

/* ==========================================================================
 * 2. Die Abdrücke, die die Migration über sich selbst behauptet
 * ======================================================================== */

describe("die Abdrücke in 0136 stimmen mit der Datei überein", () => {
  const neu = rumpf(M0136);
  const k = kommentar(M0136);

  it("md5 und Länge des Rumpfs", () => {
    expect(md5(neu)).toBe("f6d08440707ba72a8040a8d1e666c092");
    expect(neu.length).toBe(21494);
    /* Beides steht in der Nachbedingung der Migration — sie prüft sich an
       demselben Wert, den dieser Test aus der Datei rechnet. */
    expect(M0136).toContain("f6d08440707ba72a8040a8d1e666c092");
    expect(M0136).toContain("21494");
  });

  it("md5 und Länge des Funktionskommentars", () => {
    expect(md5(k)).toBe("c12618f312b413571eeabe912ca03651");
    expect(k.length).toBe(890);
    expect(M0136).toContain("c12618f312b413571eeabe912ca03651");
  });

  it("der Vorzustand, den die Vorbedingung verlangt, ist der aus 0131", () => {
    expect(md5(rumpf(M0131))).toBe("24c3810288bb20929fe995554a267adf");
    expect(M0136).toContain("24c3810288bb20929fe995554a267adf");
    /* Und ein zweiter Lauf wird erkannt, statt abzustürzen. */
    expect(M0136).toContain("schon angewendet");
  });

  it("der Kommentar nennt 0136 und sagt, warum der Typ nicht abgeleitet wird", () => {
    expect(k).toContain("Artikeltyp in 0136");
    expect(k).toContain("nicht aus der Kategorie rekonstruiert");
    /* Der Formatvertrag bleibt unberührt. */
    expect(k).toContain("restore_supported ist false");
  });
});

/* ==========================================================================
 * 3. 28 Bereiche, 353 Feldzeilen, figures mit zehn Feldern
 * ======================================================================== */

describe("die Form des Exports ändert sich an genau einer Stelle", () => {
  const alt = fieldsFromBackupSql(M0131);
  const neu = fieldsFromBackupSql(M0136);

  it("es bleiben 28 Bereiche mit denselben Namen", () => {
    expect(Object.keys(neu)).toHaveLength(28);
    expect(Object.keys(neu).sort()).toEqual(Object.keys(alt).sort());
  });

  it("figures hat zehn Felder, alle anderen 27 Bereiche sind unverändert", () => {
    expect(neu.figures).toHaveLength(10);
    for (const [bereich, felder] of Object.entries(neu)) {
      if (bereich === "figures") continue;
      expect(felder, bereich).toEqual(alt[bereich]);
    }
  });

  it("und die Reihenfolge in figures ist die des Manifests — ohne das, was NACH 0136 kam", () => {
    /*
     * `0136` ist eine abgeschlossene Datei und bleibt es. Das Manifest
     * dagegen folgt dem JEWEILS LETZTEN Stand, und seit `0140` trägt es
     * zusätzlich `usk_rating` (ADR-0128 / `0139`). Verglichen wird deshalb
     * die Liste von `0136` mit dem Manifest OHNE die später gekommenen
     * Felder — die Reihenfolge der zehn aus `0136` muss unverändert sein.
     *
     * Dass das Manifest zum heutigen Rumpf passt, prüft `backup-sql.test.ts`
     * gegen die letzte Migration, die die Funktion definiert.
     */
    const manifest = BACKUP_SECTIONS.find((s) => s.key === "figures")!;
    const NACH_0136 = ["usk_rating"];
    expect(neu.figures).toEqual(manifest.fields.filter((f) => !NACH_0136.includes(f)));
  });

  it("353 Feldzeilen insgesamt, eine mehr als die 352 aus 0131", () => {
    const summe = (x: Record<string, string[]>) =>
      Object.values(x).reduce((n, l) => n + l.length, 0);
    expect(summe(alt)).toBe(352);
    expect(summe(neu)).toBe(353);
  });
});

/* ==========================================================================
 * 4. Sie fasst nichts an, was sie nicht anfassen darf
 * ======================================================================== */

describe("0136 ersetzt eine Funktion und sonst nichts", () => {
  /** Die Anweisungsanfänge auf Spalte 0 — so sind diese Dateien formatiert. */
  const anfaenge = M0136.split("\n").filter((l) => /^[a-z]/.test(l))
    .map((l) => l.trim().toLowerCase());

  it("ein create-or-replace, ein comment, zwei DO-Blöcke, eine Temporärtabelle", () => {
    expect(anfaenge.filter((l) => l.startsWith("do $$"))).toHaveLength(2);
    expect(anfaenge.filter((l) => l.startsWith("create or replace function")))
      .toHaveLength(1);
    expect(anfaenge.filter((l) => l.startsWith("comment on function"))).toHaveLength(1);
    expect(anfaenge.filter((l) => l.startsWith("create temporary table"))).toHaveLength(1);
  });

  it("sie ersetzt genau die Exportfunktion", () => {
    const treffer = M0136.match(/create or replace function public\.([a-z_]+)/g) ?? [];
    expect(treffer).toEqual(["create or replace function public.seller_business_backup"]);
  });

  it("kein Recht, keine Tabelle, kein Trigger, kein Index", () => {
    /*
     * `create or replace function` BEHÄLT den bestehenden ACL. Ein `grant` hier
     * wäre nicht nur unnötig, er würde den materialisierten ACL verändern — und
     * `0104` hat PUBLIC und `anon` ausdrücklich entfernt.
     */
    for (const verboten of ["alter table", "create table ", "drop table",
                            "create trigger", "drop trigger", "create index",
                            "drop index", "create policy", "drop policy",
                            "grant ", "revoke ", "alter function",
                            "drop function"]) {
      expect(ohneProsa(M0136).toLowerCase(), verboten).not.toContain(verboten);
    }
  });

  it("die Temporärtabelle trägt on commit drop und wird nicht gelöscht", () => {
    expect(M0136).toContain("on commit drop");
    expect(ohneProsa(M0136).toLowerCase()).not.toContain("drop table");
  });

  it("die drei Schreibwörter stehen NUR in der Verbotsliste der Nachbedingung", () => {
    /* Dieselbe Falle wie in 0130/0131: der Wächter findet sich selbst. */
    for (const wort of ["insert into", "delete from", "truncate"]) {
      const zeilen = M0136.split("\n")
        .map((l, i) => ({ nr: i + 1, text: l }))
        .filter(({ text }) => text.toLowerCase().includes(wort));
      /* `insert into abdruck_0136` ist die Ausnahme: der Abdruck selbst. */
      const echte = zeilen.filter((z) => !z.text.includes("abdruck_0136"));
      expect(echte, wort).toHaveLength(1);
      expect(echte[0].text, wort).toMatch(/^\s+(foreach v_key in array array\[)?'/);
    }
    expect(M0136).toContain("die Sicherung schreibt (%)");
  });

  it("der Abdruck liegt in einer Temporärtabelle, nicht in public", () => {
    expect(M0136).toContain("create temporary table abdruck_0136");
    expect(M0136).not.toContain("public.abdruck_0136");
  });

  it("und sie prüft, dass sie in einer Transaktion läuft", () => {
    expect(M0136).toContain("to_regclass('pg_temp.abdruck_0136') is null");
    expect(M0136).toContain("laeuft nicht in einer Transaktion");
  });
});

describe("0136 prüft weiter, was 0131 geprüft hat", () => {
  it("die neun personenbezogenen Felder bleiben bereichsgenau geprüft", () => {
    for (const feld of ["sender_name", "sender_street", "sender_postal_code",
                        "sender_city", "sender_country", "listing_title",
                        "listing_url", "listing_details", "agreement_note"]) {
      expect(M0136, feld).toContain(`'''${feld}'''`);
    }
    expect(M0136).toContain("anderen Bereich als purchase_receipts");
    /* Und nicht rumpfweit: der Bereich wird zeilenweise bestimmt. */
    expect(M0136).toContain("regexp_split_to_table(v_code, E'\\n') with ordinality");
  });

  it("Formatversion, restore_supported, stable, security definer, ACL", () => {
    expect(M0136).toContain("die Formatversion wurde veraendert");
    expect(M0136).toContain("restore_supported ist nicht mehr false");
    expect(M0136).toContain("muss stable bleiben");
    expect(M0136).toContain("security definer ist weg");
    expect(M0136).toContain("PUBLIC oder anon darf die Sicherung abrufen");
  });

  it("und der Bereichsparser bricht ab, bevor er etwas über Felder sagt", () => {
    expect(M0136).toContain("Abbruch vor jeder Feldaussage");
    expect(M0136).toContain("gehoeren zu keinem Bereich");
  });
});

/* ==========================================================================
 * 5. Die Rücknahme — und ihre Reihenfolge
 * ======================================================================== */

describe("R0136 stellt den Stand aus 0131 zeichengleich wieder her", () => {
  it("der Rumpf in R0136 ist der aus 0131", () => {
    expect(rumpf(R0136)).toBe(rumpf(M0131));
    expect(md5(rumpf(R0136))).toBe("24c3810288bb20929fe995554a267adf");
  });

  it("und der Kommentar ebenfalls", () => {
    expect(kommentar(R0136)).toBe(kommentar(M0131));
    expect(md5(kommentar(R0136))).toBe("6b980ac961d1d6ac704587ecc6e9524f");
  });

  it("sie verlangt den Stand 0136 und erkennt, wenn sie schon gelaufen ist", () => {
    expect(R0136).toContain("f6d08440707ba72a8040a8d1e666c092");
    expect(R0136).toContain("SCHON die Fassung aus 0131");
  });

  it("sie nimmt die SPALTE nicht zurück — das ist R0135", () => {
    expect(ohneProsa(R0136).toLowerCase()).not.toContain("drop column");
    expect(R0136).toContain("R0135_drop_item_type.sql");
  });
});

describe("R0135 verweigert, solange die Sicherung item_type liest", () => {
  it("die Vorbedingung liest den Rumpf der Sicherung", () => {
    expect(R0135).toContain("seller_business_backup()");
    expect(R0135).toContain("die Betriebssicherung liest item_type noch");
    expect(R0135).toContain("R0136_back_to_0131.sql");
  });

  it("und der Kopf erklärt, warum PostgreSQL das nicht selbst verhindert", () => {
    /* Für einen `language sql`-Rumpf gibt es keinen pg_depend-Eintrag auf die
       gelesenen Spalten: `drop column` gelingt, der AUFRUF scheitert später. */
    expect(R0135).toContain("KEINE Abhaengigkeit");
    expect(R0135).toContain("42703");
  });
});

/* ==========================================================================
 * 6. Die Prüfdatei kennt beide Stände
 * ======================================================================== */

describe("0131_function_body_check kennt 0131 UND 0136", () => {
  /** Die Zeilen der Standtabelle: md5, Länge, Kommentar-md5, Länge, Felder, Name. */
  const staende = [...PRUEFUNG.matchAll(
    /\('([0-9a-f]{32})',\s*(\d+),\s*'([0-9a-f]{32})',\s*(\d+),\s*(\d+),\s*'([A-Z_0-9]+)',\s*(true|false)\)/g,
  )].map((m) => ({
    md5: m[1], laenge: Number(m[2]), kommMd5: m[3], kommLaenge: Number(m[4]),
    felder: Number(m[5]), name: m[6], freigegeben: m[7] === "true",
  }));

  it("vier Stände: 0130 bekannt aber überholt, 0131, 0136 und 0140 freigegeben", () => {
    /* `0140` kam am 2026-10-20 dazu: die Sicherung trägt seitdem
       `sale_released`, `delivery_scope` und `usk_rating`. Ohne diesen
       Eintrag meldete die Prüfdatei auf Staging „UNBEKANNT" für einen
       Rumpf, der genau so freigegeben wurde. */
    expect(staende).toHaveLength(4);
    expect(staende.filter((s) => s.freigegeben).map((s) => s.name))
      .toEqual(["STAND_0131_ZEICHENGLEICH", "STAND_0136_ZEICHENGLEICH",
                "STAND_0140_ZEICHENGLEICH"]);
    expect(staende.find((s) => s.name === "STAND_0130")?.freigegeben).toBe(false);
  });

  it("und jede Zeile stimmt mit ihrer Migrationsdatei überein", () => {
    const quelle: Record<string, string> = {
      STAND_0130: "supabase/migrations/0130_business_backup_fields.sql",
      STAND_0131_ZEICHENGLEICH:
        "supabase/migrations/0131_business_backup_seller_fields.sql",
      STAND_0136_ZEICHENGLEICH:
        "supabase/migrations/0136_business_backup_item_type.sql",
      STAND_0140_ZEICHENGLEICH:
        "supabase/migrations/0140_business_backup_sale_release.sql",
    };
    for (const s of staende) {
      const sql = datei(quelle[s.name]);
      const r = rumpf(sql);
      const k = kommentar(sql);
      expect(md5(r), `${s.name} md5`).toBe(s.md5);
      expect(r.length, `${s.name} Länge`).toBe(s.laenge);
      expect(md5(k), `${s.name} Kommentar-md5`).toBe(s.kommMd5);
      expect(k.length, `${s.name} Kommentarlänge`).toBe(s.kommLaenge);
      const felder = r.split("\n")
        .filter((z) => /^ {10}'[a-z_0-9]+',/.test(z)).length;
      expect(felder, `${s.name} Feldzeilen`).toBe(s.felder);
    }
  });

  it("der Befund ist eine Messung, die Sperre sitzt in 101 und 105", () => {
    /* Ein Vergleich, dessen Erwartung aus demselben Ausdruck kommt,
       bestätigte auch `UNBEKANNT`. Genau das stand hier vorher. */
    expect(PRUEFUNG).toContain("zeichengleich EINEM bekannten Stand");
    expect(PRUEFUNG).toContain("dieser Stand ist freigegeben");
    expect(PRUEFUNG).toContain("Messung ohne Sollwert");
  });

  it("und sie bleibt rein lesend", () => {
    const ohneProsa = PRUEFUNG.replace(/--.*$/gm, "");
    expect(ohneProsa).not.toMatch(/\bdo\s+\$\$/i);
    expect(ohneProsa).not.toMatch(/\b(create|alter|drop|grant|revoke|truncate)\b/i);
    expect(ohneProsa).not.toMatch(/\binsert\s+into\b/i);
  });
});

/* ==========================================================================
 * 7. Die zwei Flüge zu 0136 messen gegenläufige Zustände
 * ======================================================================== */

describe("0136_preflight und 0136_postflight erwarten das Gegenteil", () => {
  const PRE = datei("supabase/checks/0136_preflight.sql");
  const POST = datei("supabase/checks/0136_postflight.sql");

  /**
   * Der Sollwert einer Prüfzeile, so wie er in der Datei steht.
   *
   * Der letzte SQL-Stringliteral des Blocks — und das Literal wird RICHTIG
   * gelesen: `''` ist ein Apostroph im Wert, kein Literalende. Die erste
   * Fassung dieser Hilfe schnitt an `[^']*` ab und las aus der Feldliste des
   * Bereichs `figures` nur das letzte Stück.
   */
  const soll = (sql: string, nr: number): string => {
    const i = sql.indexOf(`  (${nr}, '`);
    if (i < 0) throw new Error(`Zeile ${nr} fehlt`);
    const bis = sql.indexOf("\n  (", i + 4);
    const block = sql.slice(i, bis < 0 ? undefined : bis);
    const m = [...block.matchAll(/'((?:[^']|'')*)'/g)];
    if (m.length === 0) return "(kein Sollwert)";
    return m[m.length - 1][1].replace(/''/g, "'");
  };

  it("der Abdruck des Rumpfs: 0131 im Preflight, 0136 im Postflight", () => {
    expect(soll(PRE, 102)).toBe("24c3810288bb20929fe995554a267adf");
    expect(soll(POST, 102)).toBe("f6d08440707ba72a8040a8d1e666c092");
    expect(soll(PRE, 103)).toBe("21458");
    expect(soll(POST, 103)).toBe("21494");
  });

  it("der Kommentarabdruck wandert mit", () => {
    expect(soll(PRE, 104)).toBe("6b980ac961d1d6ac704587ecc6e9524f");
    expect(soll(POST, 104)).toBe("c12618f312b413571eeabe912ca03651");
    expect(md5(kommentar(M0131))).toBe(soll(PRE, 104));
    expect(md5(kommentar(M0136))).toBe(soll(POST, 104));
  });

  it("28 Bereiche in beiden, 352 gegen 353 Feldzeilen", () => {
    expect(soll(PRE, 105)).toBe("28");
    expect(soll(POST, 105)).toBe("28");
    expect(soll(PRE, 106)).toBe("352");
    expect(soll(POST, 106)).toBe("353");
  });

  it("der Bereich figures: neun Felder gegen zehn, und die Reihenfolge stimmt", () => {
    const aus = (sql: string) => soll(sql, 107).split("; ");
    expect(aus(PRE)).toHaveLength(9);
    expect(aus(POST)).toHaveLength(10);
    expect(aus(POST)[aus(POST).indexOf("'card_type', t.card_type") + 1])
      .toBe("'item_type', t.item_type");
    /* Und beides stimmt mit dem Rumpf der jeweiligen Migration überein. */
    const imRumpf = (sql: string) =>
      fieldsFromBackupSql(sql).figures.map((f) => `'${f}'`);
    expect(aus(PRE).map((z) => z.split(",")[0])).toEqual(imRumpf(M0131));
    expect(aus(POST).map((z) => z.split(",")[0])).toEqual(imRumpf(M0136));
  });

  it("Zeile 108 ist die Umkehrprobe: 0 vorher, 1 nachher", () => {
    expect(soll(PRE, 108)).toBe("0");
    expect(soll(POST, 108)).toBe("1");
  });

  it("beide verlangen die Spalte aus 0135 — 0136 setzt sie voraus", () => {
    for (const sql of [PRE, POST]) {
      expect(sql).toContain("skylanders.item_type steht (0135 ist angewendet)");
      expect(soll(sql, 111)).toBe("true");
    }
  });

  it("beide prüfen Rechte, Formatvertrag und die neun privaten Felder", () => {
    for (const [name, sql] of [["pre", PRE], ["post", POST]] as const) {
      expect(soll(sql, 126), `${name} 126`).toBe("true");   // format_version 1
      expect(soll(sql, 127), `${name} 127`).toBe("true");   // restore_supported false
      expect(soll(sql, 131), `${name} 131`).toBe("0");      // schreibt nichts
      expect(soll(sql, 141), `${name} 141`).toBe("true");   // ACL materialisiert
      expect(soll(sql, 142), `${name} 142`).toBe("0");      // kein PUBLIC/anon
      expect(soll(sql, 151), `${name} 151`).toBe("0");      // privat nur im Beleg
      expect(soll(sql, 152), `${name} 152`).toBe("9");
    }
  });

  it("und der Z0-Vertrag steht in beiden, mit den dokumentierten Werten", () => {
    for (const sql of [PRE, POST]) {
      expect(sql).toContain("'shopfaehig',   '534'");
      expect(sql).toContain("'angebote',     '256'");
      expect(sql).toContain("'angebote_md5', '4d1d6c30fe0ae886ca2689bcb1fe9634'");
      expect(sql).toContain("'sammelbar',    '534'");
      expect(sql).toContain("'overrides',    '39'");
      /* Der Modus ist Pflicht — ein vergessener Vertrag ist blockierend. */
      expect(sql).toContain("der Modus ist gewaehlt");
    }
  });

  it("sie rufen die Sicherung NICHT auf und schreiben nicht", () => {
    for (const sql of [PRE, POST]) {
      const code = ohneProsa(sql);
      expect(code).not.toMatch(/select\s+public\.seller_business_backup\(\)/);
      expect(code).not.toMatch(/\bdo\s+\$\$/i);
      /* Nur ANWEISUNGSANFÄNGE: `'\\minsert\\s+into\\m'` steht in Zeile 131 als
         Suchmuster im Stringliteral — wer die Abwesenheit von Code behauptet,
         darf nicht die Verbotsliste selbst finden. */
      expect(code).not.toMatch(/^\s*(insert|update|delete|truncate|grant|revoke)\b/im);
      /* Ein einziges SELECT, mit Zeile 9999. */
      expect(sql.trimEnd().endsWith("order by nr;")).toBe(true);
      expect(sql).toContain("blockierende Abweichungen (muss 0 sein)");
    }
  });
});
