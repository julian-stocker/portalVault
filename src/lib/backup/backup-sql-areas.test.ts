/**
 * Der Bereichsparser — mit exakten Zahlen für jeden Stand.
 *
 * DER FEHLER, DEN DIESE DATEI FESTHÄLT.
 *
 * `0130_export_keys_diagnosis.sql` schnitt die 28 Exportbereiche mit EINEM
 * mehrzeiligen Ausdruck aus:
 *
 *     regexp_matches(d, '\n {6}''([a-z_0-9]+)'', coalesce\(\((.*?)\n {6}\), …', 'g')
 *
 * In Python und JavaScript tut das, was es soll. In PostgreSQL nicht: dort ist
 * die Gierigkeit eine Eigenschaft des ganzen ZWEIGS und wird vom **ersten**
 * quantifizierten Atom mit Vorliebe bestimmt (Handbuch 9.7.3.5). Das war
 * `[a-z_0-9]+` — gierig. `(.*?)` verhielt sich damit wie `(.*)`, der erste
 * Bereich verschluckte den gesamten Rumpf, und auf Staging kam heraus: **ein**
 * Bereich `shop_inventory` mit **321** Schlüsseln statt 28 Bereichen.
 *
 * WARUM MEINE LOKALEN TESTS DAS NICHT SAHEN. Sie prüften mit
 * JavaScript-Regex, und JavaScript entscheidet die Gierigkeit je Quantor. Ein
 * Test, der eine andere Engine benutzt als die Produktion, prüft die falsche
 * Engine.
 *
 * WAS JETZT GILT.
 *
 * 1. Keine Bereichserkennung läuft mehr über mehr als eine Zeile — weder in
 *    TypeScript noch in SQL. Zeilen werden einzeln geprüft, verankert; ein
 *    Feld gehört zum Bereich, dessen Anfangszeile zuletzt vor ihm stand. Daran
 *    gibt es keine Gierigkeit zu interpretieren.
 * 2. Die SQL-Dateien **beweisen den Parser in der Engine, die sie ausführt**:
 *    jede trägt eine Probe mit zwei Bereichen und bekannter Antwort. Ein
 *    gieriger Parser liefert dort einen Bereich mit drei Feldern. Das ist der
 *    einzige Nachweis, der ohne lokales PostgreSQL zu haben ist — und er ist
 *    stärker als ein lokaler, weil er dort läuft, wo es zählt.
 * 3. Diese Datei nagelt die ZAHLEN fest: 28 Bereiche in jedem Stand, und je
 *    Bereich die genaue Feldzahl. „321 Schlüssel insgesamt" kann damit nicht
 *    mehr als Erfolg durchgehen.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

import { fieldsFromBackupSql } from "./export-audit";

const koerper = (datei: string): string =>
  readFileSync(`supabase/migrations/${datei}.sql`, "utf8");

/** Die drei Stände: wie Staging heute ist, und die zwei geplanten. */
const STAENDE = {
  "0129": "0129_business_backup_receipts",
  "0130": "0130_business_backup_fields",
  "0131": "0131_business_backup_seller_fields",
} as const;

/** Die erwarteten Feldzahlen je Bereich — erhoben, nicht geschätzt. */
const ERWARTET: Record<keyof typeof STAENDE, { gesamt: number; je: Record<string, number> }> = {
  "0129": {
    gesamt: 321,
    je: {
      shop_inventory: 11, inventory_movements: 10, purchases: 10, purchase_items: 14,
      purchase_receipts: 38, purchase_receipt_downloads: 4, purchase_receipt_counters: 2,
      sales: 23, sale_items: 17, sale_fees: 8, sale_refunds: 8,
      settlement_adjustments: 10, name_mappings: 7, orders: 21, order_lines: 12,
      order_line_events: 12, order_reservations: 13, order_refunds: 8,
      order_refund_allocations: 6, order_legal_snapshots: 12, invoices: 26,
      monthly_reports: 15, figures: 6, series: 3, categories: 4, seller: 13,
      shop_settings: 3, shipping_methods: 5,
    },
  },
  "0130": {
    gesamt: 339,
    je: {
      shop_inventory: 11, inventory_movements: 10, purchases: 16, purchase_items: 14,
      purchase_receipts: 38, purchase_receipt_downloads: 4, purchase_receipt_counters: 2,
      sales: 24, sale_items: 17, sale_fees: 8, sale_refunds: 8,
      settlement_adjustments: 10, name_mappings: 7, orders: 21, order_lines: 12,
      order_line_events: 12, order_reservations: 14, order_refunds: 12,
      order_refund_allocations: 6, order_legal_snapshots: 12, invoices: 26,
      monthly_reports: 15, figures: 9, series: 4, categories: 5, seller: 13,
      shop_settings: 4, shipping_methods: 5,
    },
  },
  "0131": {
    gesamt: 352,
    je: {
      shop_inventory: 11, inventory_movements: 10, purchases: 16, purchase_items: 14,
      purchase_receipts: 38, purchase_receipt_downloads: 4, purchase_receipt_counters: 2,
      sales: 24, sale_items: 17, sale_fees: 8, sale_refunds: 8,
      settlement_adjustments: 10, name_mappings: 7, orders: 21, order_lines: 12,
      order_line_events: 12, order_reservations: 14, order_refunds: 12,
      order_refund_allocations: 6, order_legal_snapshots: 12, invoices: 26,
      monthly_reports: 15, figures: 9, series: 4, categories: 5, seller: 26,
      shop_settings: 4, shipping_methods: 5,
    },
  },
};

/** Die neun Felder, die nur im Belegsnapshot stehen dürfen. */
const PRIVAT = ["sender_name", "sender_street", "sender_postal_code", "sender_city",
                "sender_country", "listing_title", "listing_url", "listing_details",
                "agreement_note"] as const;

/* ==========================================================================
 * 1. 28 Bereiche, exakt — in jedem Stand
 * ======================================================================== */

describe("der Parser erkennt 28 getrennte Bereiche, nicht einen", () => {
  for (const [stand, datei] of Object.entries(STAENDE)) {
    const bereiche = fieldsFromBackupSql(koerper(datei));
    const soll = ERWARTET[stand as keyof typeof STAENDE];

    it(`${stand}: genau 28 Bereiche`, () => {
      expect(Object.keys(bereiche)).toHaveLength(28);
    });

    it(`${stand}: die Bereichsnamen sind die erwarteten`, () => {
      expect(Object.keys(bereiche).sort()).toEqual(Object.keys(soll.je).sort());
    });

    it(`${stand}: je Bereich die genaue Feldzahl`, () => {
      const ist: Record<string, number> = {};
      for (const [k, v] of Object.entries(bereiche)) ist[k] = v.length;
      expect(ist).toEqual(soll.je);
    });

    it(`${stand}: die Gesamtzahl ist die Summe der Bereiche`, () => {
      const summe = Object.values(bereiche).reduce((n, l) => n + l.length, 0);
      expect(summe).toBe(soll.gesamt);
      expect(Object.values(soll.je).reduce((a, b) => a + b, 0)).toBe(soll.gesamt);
    });

    it(`${stand}: kein Bereich ist leer, kein Name doppelt`, () => {
      for (const [k, v] of Object.entries(bereiche)) {
        expect(v.length, k).toBeGreaterThan(0);
      }
      expect(new Set(Object.keys(bereiche)).size).toBe(28);
    });

    /* ---- Punkt 7: die neun Felder nur im Belegsnapshot --------------- */
    it(`${stand}: die neun privaten Felder stehen NUR in purchase_receipts`, () => {
      for (const feld of PRIVAT) {
        const drin = Object.entries(bereiche)
          .filter(([, felder]) => felder.includes(feld))
          .map(([key]) => key);
        expect(drin, feld).toEqual(["purchase_receipts"]);
      }
    });

    it(`${stand}: und der Bereich purchases trägt keines davon`, () => {
      for (const feld of PRIVAT) {
        expect(bereiche.purchases, feld).not.toContain(feld);
      }
    });
  }

  it("0129 → 0130 ergänzt genau 18 Felder, 0130 → 0131 genau 13", () => {
    expect(ERWARTET["0130"].gesamt - ERWARTET["0129"].gesamt).toBe(18);
    expect(ERWARTET["0131"].gesamt - ERWARTET["0130"].gesamt).toBe(13);
  });
});

/* ==========================================================================
 * 2. Der Fehlgriff, festgenagelt
 * ======================================================================== */

describe("die gierige Variante ist reproduzierbar — und verboten", () => {
  it("gierig gelesen ergibt EINEN Bereich mit 321 Schlüsseln", () => {
    /*
     * Genau das kam auf Staging heraus. Hier wird es mit einem absichtlich
     * gierigen Ausdruck nachgestellt — damit die Zahlen aus dem Fehllauf
     * dokumentiert sind und niemand den Fehlgriff für harmlos hält.
     */
    const code = koerper(STAENDE["0129"])
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");
    const gierig = /\n {6}'([a-z_0-9]+)', coalesce\(\(([\s\S]*)\n {6}\), '\[\]'::jsonb/
      .exec(code);
    expect(gierig).not.toBeNull();
    expect(gierig![1]).toBe("shop_inventory");
    const felder = gierig![2].match(/\n {10}'[a-z_0-9]+',/g) ?? [];
    expect(felder).toHaveLength(321);
  });

  it("zeilenweise gelesen sind es 28 Bereiche", () => {
    expect(Object.keys(fieldsFromBackupSql(koerper(STAENDE["0129"])))).toHaveLength(28);
  });

  it("kein SQL im Projekt schneidet Bereiche mit einem mehrzeiligen Muster aus", () => {
    /*
     * DER EIGENTLICHE RIEGEL. Verboten ist die Form, nicht das Ergebnis:
     * `coalesce\(\((.*?)` über Zeilengrenzen. Wer sie wieder einführt, bringt
     * diesen Test zu Fall — in jeder Prüfdatei und jeder Migration.
     */
    const dateien = [
      ...["0130_preflight", "0130_postflight", "0131_preflight", "0131_postflight",
          "0130_export_keys_diagnosis"].map((f) => `supabase/checks/${f}.sql`),
      ...["0130_business_backup_fields", "0131_business_backup_seller_fields"]
        .map((f) => `supabase/migrations/${f}.sql`),
    ];
    for (const datei of dateien) {
      /*
       * KOMMENTARFREI GEPRÜFT. Die Kopfzeilen dieser Dateien ZITIEREN das
       * verbotene Muster, um zu erklären, warum es verboten ist — der Wächter
       * fand seine eigene Dokumentation. Dieselbe Falle wie zweimal in `0124`.
       */
      const sql = readFileSync(datei, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*--.*$/gm, "");
      expect(sql, datei).not.toContain("coalesce\\(\\((.*?)");
      expect(sql, datei).not.toContain("(.*?)\\n {6}");
      expect(sql, datei).not.toMatch(/substring\([^)]*coalesce/);
    }
  });
});

/* ==========================================================================
 * 3. Jede SQL-Datei beweist den Parser in ihrer Engine
 * ======================================================================== */

describe("die SQL-Dateien tragen den Selbsttest und brechen bei Abweichung ab", () => {
  const PRUEFDATEIEN = ["0130_preflight", "0130_postflight", "0131_preflight",
                        "0131_postflight", "0130_export_keys_diagnosis"] as const;

  for (const datei of PRUEFDATEIEN) {
    const sql = readFileSync(`supabase/checks/${datei}.sql`, "utf8");

    it(`${datei}: zeilenweiser Parser statt mehrzeiligem Muster`, () => {
      expect(sql).toContain("regexp_split_to_table");
      expect(sql).toContain("with ordinality");
      expect(sql).toContain("order by a.nr desc limit 1");
      expect(sql).toContain("^ {6}''([a-z_0-9]+)'', coalesce");
    });

    it(`${datei}: die Probe mit zwei Bereichen ist eingebaut`, () => {
      expect(sql).toContain("probe as (");
      expect(sql).toContain("''alpha''");
      expect(sql).toContain("''beta''");
      expect(sql).toContain("probe_anfang");
      expect(sql).toContain("probe_feld");
    });

    it(`${datei}: der Selbsttest ist BLOCKIEREND, nicht informativ`, () => {
      /* Eine Info-Zeile hat `null` als Erwartung. Der Selbsttest nicht. */
      const zeilen = sql.split("\n");
      const selbst = zeilen.filter((l) => l.includes("'Selbsttest'"));
      expect(selbst.length).toBeGreaterThanOrEqual(3);
      /* Die Erwartungen '2' und '2/1' bzw. '0' stehen in den Folgezeilen. */
      expect(sql).toMatch(/probe_anfang\)\)::text, '2'\)/);
    });

    it(`${datei}: 28 Bereiche sind eine blockierende Bedingung`, () => {
      expect(sql).toMatch(/from bereich\)\)::text, '28'\)/);
    });

    it(`${datei}: und jede Feldzeile muss zugeordnet sein`, () => {
      expect(sql).toContain("jede Feldzeile ist genau einem Bereich zugeordnet");
    });
  }

  for (const datei of ["0130_business_backup_fields",
                       "0131_business_backup_seller_fields"]) {
    const sql = readFileSync(`supabase/migrations/${datei}.sql`, "utf8");

    it(`${datei}: die Nachbedingung parst zeilenweise`, () => {
      expect(sql).toContain("regexp_split_to_table(v_code, E'\\n') with ordinality");
      expect(sql).toContain("order by a.nr desc limit 1");
      expect(sql).not.toContain("v_block");
    });

    it(`${datei}: eine Parserabweichung bricht ab, bevor etwas behauptet wird`, () => {
      expect(sql).toContain("Bereiche statt 28 — Abbruch vor jeder Feldaussage");
      expect(sql).toContain("eine Zuordnung fehlt");
      expect(sql).toContain("gehoert zu keinem Bereich");
    });

    it(`${datei}: die neun Felder werden dreifach geprüft`, () => {
      expect(sql).toContain("der Bereich purchases nennt %");
      expect(sql).toContain("ausser purchase_receipts");
      expect(sql).toContain("fehlt im Belegsnapshot");
    });

    it(`${datei}: jede Pflichtfeldzeile wird als Bereich-Feld-Paar geprüft`, () => {
      expect(sql).toMatch(/'purchases\|''items_cost'', t\.items_cost::text'/);
      expect(sql).toContain("v_key = any (v_paare)");
    });
  }

  it("auch die Vorbedingung von 0131 prüft bereichsgenau", () => {
    const sql = readFileSync(
      "supabase/migrations/0131_business_backup_seller_fields.sql", "utf8");
    expect(sql).toContain("der Bereich purchases fuehrt items_cost nicht");
    /* Nicht mehr rumpfweit: der alte Satz ist weg. */
    expect(sql).not.toContain("die Kostenteile fehlen im Export");
  });
});

/* ==========================================================================
 * 4. Die Prüfeinträge der Migrationen: Bereich|Feldzeile, vollständig
 * ======================================================================== */

/**
 * DER FEHLER, DEN DIESER BLOCK REPRODUZIERT.
 *
 * `0131` brach auf Staging ab:
 *
 *     ERROR: P0001: 0131 Abbruch:  fehlt im Bereich seller
 *     CONTEXT: PL/pgSQL function inline_code_block line 114 at RAISE
 *
 * Der Feldname in der Meldung war LEER. Grund: beim Umbau auf
 * Bereich-Feld-Paare bekamen nur der **erste** und der **letzte** der 13
 * Einträge das Präfix `seller|`; die elf dazwischen blieben nackte
 * Feldzeilen. Sie passten damit auf kein Paar in `v_paare` — und
 * `split_part(v_key, '|', 2)` gibt für einen Wert ohne `|` die leere
 * Zeichenkette zurück.
 *
 * Die Prüfung war nicht zu streng, sondern falsch gestellt. Sie bleibt
 * blockierend; dieser Test stellt sicher, dass ihre Einträge zur Frage passen.
 */
describe("jeder Prüfeintrag einer Migration nennt Bereich UND Feldzeile", () => {
  const MIGRATIONEN = ["0130_business_backup_fields",
                       "0131_business_backup_seller_fields"] as const;

  /** Die Paare, die der Rumpf einer Migration wirklich hergibt. */
  function paareVon(sql: string): Set<string> {
    const i = sql.indexOf("create or replace function public.seller_business_backup()");
    const code = sql.slice(i, sql.indexOf("\n$$;", i))
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");
    const out = new Set<string>();
    let aktuell: string | null = null;
    for (const zeile of code.split("\n")) {
      const bereich = /^ {6}'([a-z_0-9]+)', coalesce\(\($/.exec(zeile);
      if (bereich !== null) { aktuell = bereich[1]; continue; }
      if (/^ {6}\), '\[\]'::jsonb\),?$/.test(zeile)) { aktuell = null; continue; }
      if (aktuell === null) continue;
      if (/^ {10}'[a-z_0-9]+',/.test(zeile)) {
        out.add(`${aktuell}|${zeile.trim().replace(/,$/, "")}`);
      }
    }
    return out;
  }

  /**
   * Die `foreach v_key`-Schleifen, die einen Eintrag als GANZES Paar gegen
   * `v_paare` halten (`v_key = any (v_paare)`) — nur dort muss ein Eintrag die
   * Form `Bereich|Feldzeile` haben.
   *
   * Ausdrücklich NICHT dazu zählen die anderen Schleifen derselben Dateien:
   * die neun privaten Felder werden als nackte Namen mit `like`-Mustern
   * gesucht (`p like 'purchases|' || v_key || '%'`), die Verbotsmarker mit
   * `position(v_key in v_code)`. Deren Einträge haben zu Recht kein `|`, und
   * ein Test, der dort eines verlangte, wäre falsch.
   */
  function paarschleifen(sql: string): string[][] {
    const out: string[][] = [];
    const muster = /foreach v_key in array array\[([\s\S]*?)\] loop([\s\S]*?)end loop;/g;
    for (const m of sql.matchAll(muster)) {
      if (!m[2].includes("v_key = any (v_paare)")) continue;
      const eintraege = [...m[1].matchAll(/'((?:[^']|'')*)'/g)]
        .map((e) => e[1].replace(/''/g, "'"));
      out.push(eintraege);
    }
    return out;
  }

  for (const datei of MIGRATIONEN) {
    const sql = readFileSync(`supabase/migrations/${datei}.sql`, "utf8");
    const paare = paareVon(sql);
    const schleifen = paarschleifen(sql);

    it(`${datei}: es gibt überhaupt Paarschleifen`, () => {
      expect(schleifen.length).toBeGreaterThanOrEqual(1);
      expect(schleifen.flat().length).toBeGreaterThanOrEqual(13);
      expect(paare.size).toBeGreaterThanOrEqual(339);
      /* Die Markerschleifen bleiben außen vor — sonst prüfte der Test das
         Falsche. Ihre Einträge sind nackte Namen und Codefragmente. */
      const markerschleifen = [...sql.matchAll(
        /foreach v_key in array array\[([\s\S]*?)\] loop([\s\S]*?)end loop;/g)]
        .filter((m) => !m[2].includes("v_key = any (v_paare)"));
      expect(markerschleifen.length).toBeGreaterThanOrEqual(3);
    });

    it(`${datei}: jeder Eintrag hat die Form Bereich|Feldzeile`, () => {
      const kaputt = schleifen.flat().filter((e) => {
        const teile = e.split("|");
        return teile.length < 2 || teile[0] === "" || teile[1] === "";
      });
      expect(kaputt, `${datei}: Einträge ohne Bereich`).toEqual([]);
    });

    it(`${datei}: der Bereich jedes Eintrags ist einer der 28`, () => {
      const bereiche = new Set([...paare].map((p) => p.split("|")[0]));
      expect(bereiche.size).toBe(28);
      for (const e of schleifen.flat()) {
        expect(bereiche, e).toContain(e.split("|")[0]);
      }
    });

    /*
     * DIE ENTSCHEIDENDE PRÜFUNG — sie hätte den Abbruch vorher gefunden.
     *
     * Jeder Eintrag muss auf ein Paar passen, das der Rumpf dieser Migration
     * wirklich hergibt. Die elf nackten Einträge taten das nicht, und genau
     * daran ist `0131` gescheitert.
     */
    it(`${datei}: jeder Eintrag passt auf ein Paar des eigenen Rumpfs`, () => {
      const ohne = schleifen.flat().filter((e) => !paare.has(e));
      expect(ohne, `${datei}: Einträge ohne passendes Paar`).toEqual([]);
    });

    it(`${datei}: die Schleife prüft die Form, bevor sie sucht`, () => {
      /* Ohne Bereich kann sie nichts Sinnvolles sagen — und soll es dann
         auch nicht behaupten, sondern abbrechen. */
      expect(sql).toContain("hat keine Form Bereich|Feldzeile");
      const formpruefungen = sql.match(/split_part\(v_key, '\|', 1\) = ''/g) ?? [];
      expect(formpruefungen.length).toBe(schleifen.length);
    });
  }

  it("0131 prüft genau die 13 seller-Felder, alle mit Bereich", () => {
    const sql = readFileSync(
      "supabase/migrations/0131_business_backup_seller_fields.sql", "utf8");
    const sellerEintraege = paarschleifen(sql).flat()
      .filter((e) => e.startsWith("seller|"));
    expect(sellerEintraege).toHaveLength(13);
    for (const feld of ["is_active", "register_court", "register_number", "w_id",
                        "phone", "direct_contact", "transactional_reply_to",
                        "withdrawal_contact_email", "complaints_contact_email",
                        "dispute_participation", "dispute_body", "dispatch_statement",
                        "return_postage_borne_by"]) {
      expect(sellerEintraege.some((e) => e.includes(`'${feld}', t.${feld}`)), feld)
        .toBe(true);
    }
  });

  it("POSITIVKONTROLLE: ein Eintrag ohne Bereich fällt auf", () => {
    /*
     * Der Fehlgriff, nachgestellt: `seller|` von einem Eintrag entfernt. Beide
     * Prüfungen müssen anschlagen — die Form UND das fehlende Paar.
     */
    const sql = readFileSync(
      "supabase/migrations/0131_business_backup_seller_fields.sql", "utf8")
      .replace("'seller|''register_court'', t.register_court'",
               "'''register_court'', t.register_court'");
    const eintraege = paarschleifen(sql).flat();
    const ohneBereich = eintraege.filter((e) => !e.includes("|"));
    expect(ohneBereich).toEqual(["'register_court', t.register_court"]);
    const paare = paareVon(sql);
    expect(eintraege.filter((e) => !paare.has(e)))
      .toEqual(["'register_court', t.register_court"]);
  });

  it("und `split_part` auf einem Wert ohne Trenner gibt leer — daher die Meldung", () => {
    /* Was PostgreSQL tat: `split_part('x', '|', 2)` ist ''. Deshalb stand in
       der Fehlermeldung kein Feldname. */
    const splitPart = (s: string, sep: string, n: number) => s.split(sep)[n - 1] ?? "";
    expect(splitPart("'register_court', t.register_court", "|", 2)).toBe("");
    expect(splitPart("seller|'register_court', t.register_court", "|", 2))
      .toBe("'register_court', t.register_court");
  });
});

/* ==========================================================================
 * 5. Die Staging-Diagnose fragt nach genau denselben 13 Feldern
 * ======================================================================== */
describe("0131_state_diagnosis.sql und die Migration meinen dasselbe", () => {
  it("die 13 erwarteten seller-Namen stimmen überein", () => {
    const mig = readFileSync(
      "supabase/migrations/0131_business_backup_seller_fields.sql", "utf8");
    /* Nur die Prüfeinträge der Paarschleife — die Datei nennt `seller|`
       auch in den Mustern für `created_at`/`updated_at`, die der Bereich
       bewusst NICHT führt. */
    const ausMigration = [...mig.matchAll(/'seller\|''([a-z_0-9]+)'', t\.\1'/g)]
      .map((m) => m[1]).sort();
    const dia = readFileSync("supabase/checks/0131_state_diagnosis.sql", "utf8");
    const ausDiagnose = [...new Set(
      [...dia.matchAll(/\('([a-z_0-9]+)'\)/g)].map((m) => m[1]))].sort();
    expect(ausMigration).toHaveLength(13);
    expect(ausDiagnose).toEqual(ausMigration);
  });
});

/* ==========================================================================
 * 6. Die ausgeführte Fassung von 0130 bleibt nachrechenbar
 * ======================================================================== */

/**
 * `0130` wurde auf Staging ausgeführt und DANACH geändert — vier Zeilen
 * Formprüfung in der Nachbedingung, nachdem `0131` an genau diesem Loch
 * abgebrochen war. Der Vorgang ist in `supabase/checks/0130_amendment.md`
 * aktenkundig.
 *
 * Damit die ausgeführte Fassung nachvollziehbar bleibt, liegt sie NICHT als
 * zweite, ausführbare `.sql`-Datei daneben (die führte irgendwann jemand aus),
 * sondern als Rezept: heutige Datei minus diesen Block = ausgeführte Fassung.
 * Dieser Test rechnet das Rezept nach. Er fällt, sobald jemand `0130` weiter
 * verändert — und genau das ist der Zweck.
 */
describe("0130: ausgeführte Fassung aus der heutigen rekonstruierbar", () => {
  const AUSGEFUEHRT =
    "37417c454704fb94dd448813caeb41eaad4a58e188713488c30f5b4967e76abe";
  const HEUTE =
    "bad193a334b5eb727dac49cccb5ae88340a0693acad2479364c6f867c6269e77";
  /* Die vier Zeilen aus 0130_amendment.md, Abschnitt 2. */
  const NACHTRAG =
    "    if split_part(v_key, '|', 1) = '' or split_part(v_key, '|', 2) = '' then\n" +
    "      raise exception '%: der Pruefeintrag \"%\" hat keine Form Bereich|Feldzeile',\n" +
    "        v_wer, v_key;\n" +
    "    end if;\n";

  const sql = readFileSync(
    "supabase/migrations/0130_business_backup_fields.sql", "utf8");
  const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

  it("die heutige Datei hat die dokumentierte Prüfsumme", () => {
    expect(sha(sql)).toBe(HEUTE);
  });

  it("der Nachtrag kommt genau einmal vor", () => {
    expect(sql.split(NACHTRAG).length - 1).toBe(1);
  });

  it("ohne den Nachtrag ergibt sich bitgenau die ausgeführte Fassung", () => {
    expect(sha(sql.replace(NACHTRAG, ""))).toBe(AUSGEFUEHRT);
  });

  it("und der Nachtrag steht in der NACHBEDINGUNG, nicht im Funktionsrumpf", () => {
    /*
     * Der Grund, warum die Datenbank unberührt ist: die vier Zeilen stehen
     * hinter dem Ende des Funktionsrumpfs (`$$;`) und hinter dem
     * `comment on function`.
     */
    const rumpfEnde = sql.indexOf("\n$$;");
    const kommentar = sql.indexOf("comment on function public.seller_business_backup()");
    const nachtrag = sql.indexOf(NACHTRAG);
    expect(rumpfEnde).toBeGreaterThan(0);
    expect(kommentar).toBeGreaterThan(rumpfEnde);
    expect(nachtrag).toBeGreaterThan(kommentar);
  });

  it("der Nachtrag ist dokumentiert, nicht bloß vorhanden", () => {
    const akte = readFileSync("supabase/checks/0130_amendment.md", "utf8");
    expect(akte).toContain(AUSGEFUEHRT);
    expect(akte).toContain(HEUTE);
    expect(akte).toContain("nicht erneut angewendet");
  });
});
