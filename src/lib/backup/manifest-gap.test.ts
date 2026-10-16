/**
 * Jede Spalte des Schemas ist im Export entschieden — drin oder begründet draußen.
 *
 * WAS HIER VORHER STAND. Diese Datei hat eine Lücke festgenagelt: **57 Spalten
 * in 10 Bereichen**, die weder exportiert noch begründet ausgelassen waren. Sie
 * fehlten nicht aus einer Entscheidung, sondern weil `manifest.ts` aus `0104`
 * dem Schema hinterherlief. Der Test hielt die Zahl sichtbar, bis jemand sie
 * entscheidet.
 *
 * `0130` und `0131` haben sie entschieden: 31 Spalten kommen in den Export, 26
 * stehen ab jetzt begründet draußen. Die Lücke ist **leer**, und dieser Test
 * sagt jetzt das Stärkere: sie darf nicht wieder entstehen. Wer eine Spalte
 * anlegt, ohne sie in `manifest.ts` zu entscheiden, bringt diese Datei zu Fall.
 *
 * UND EINE SACHE BLEIBT AUSDRÜCKLICH DRAUSSEN. Die neun personenbezogenen
 * Einkaufsfelder — Absender, Inserat, Kaufvereinbarung — sind `excluded` mit
 * Grund, nicht vergessen. Schritt c des Vorschlags ist **nicht freigegeben**,
 * und der zweite Block unten hält fest, dass niemand sie nebenbei mitnimmt.
 *
 * WAS DIESE DATEI NICHT KANN. Sie liest die Migrationshistorie, keine
 * Datenbank — der Spalten-Fold kennt kein `drop column`. Für die Frage „ist
 * jede Spalte entschieden" genügt das.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { BACKUP_SECTIONS } from "./manifest";
import { fieldsFromBackupSql } from "./export-audit";
import { columnsOf } from "@/test-support/migrations";

/** Spalten, die ein Bereich weder führt noch begründet auslässt. */
function luecke(source: string): string[] {
  const s = BACKUP_SECTIONS.find((x) => x.source === source);
  if (s === undefined) throw new Error(`kein Bereich für ${source}`);
  const drin = new Set(s.fields);
  const begruendet = new Set(Object.keys(s.excluded ?? {}));
  return [...columnsOf(source)]
    .filter((c) => !drin.has(c) && !begruendet.has(c))
    .sort();
}

/** Die neun Felder aus Schritt c. Sie bleiben draußen, bis jemand sie freigibt. */
const NICHT_FREIGEGEBEN = [
  "sender_name", "sender_street", "sender_postal_code", "sender_city",
  "sender_country", "listing_title", "listing_url", "listing_details",
  "agreement_note",
] as const;

describe("keine Spalte ist unentschieden", () => {
  it("über alle 28 Bereiche: keine einzige", () => {
    const offen: Record<string, string[]> = {};
    for (const s of BACKUP_SECTIONS) {
      const l = luecke(s.source);
      if (l.length > 0) offen[s.source] = l;
    }
    expect(offen).toEqual({});
  });

  for (const s of BACKUP_SECTIONS) {
    it(`${s.key} (${s.source})`, () => {
      expect(luecke(s.source)).toEqual([]);
      /* Und jede Spalte ist genau einmal entschieden, nicht zweimal. */
      const beides = s.fields.filter((f) => f in (s.excluded ?? {}));
      expect(beides, `${s.key} führt ein Feld als drin UND draußen`).toEqual([]);
    });
  }

  it("jeder Ausschluss nennt einen Grund, der etwas sagt", () => {
    for (const s of BACKUP_SECTIONS) {
      for (const [feld, grund] of Object.entries(s.excluded ?? {})) {
        expect(grund.length, `${s.key}.${feld} ohne Grund`).toBeGreaterThan(8);
      }
    }
  });

  it("die Rechnung geht auf: Felder + Ausschlüsse = Spalten des Schemas", () => {
    for (const s of BACKUP_SECTIONS) {
      const spalten = columnsOf(s.source).size;
      const entschieden = s.fields.length + Object.keys(s.excluded ?? {}).length;
      /*
       * `>=` und nicht `===`: ein Bereich darf gebildete Felder führen, die es
       * in der Quelltabelle nicht gibt (`sky_id` in `order_reservations` kommt
       * aus einem Join), und `figures` liest nur die gehandelten Zeilen.
       */
      expect(entschieden, `${s.key}`).toBeGreaterThanOrEqual(spalten);
    }
  });
});

describe("die neun personenbezogenen Einkaufsfelder bleiben draußen", () => {
  const purchases = BACKUP_SECTIONS.find((s) => s.source === "purchases")!;

  it("keines steht in den exportierten Feldern", () => {
    for (const feld of NICHT_FREIGEGEBEN) {
      expect(purchases.fields, feld).not.toContain(feld);
    }
  });

  it("jedes steht als Ausschluss, mit einem Grund, der auf Schritt c zeigt", () => {
    for (const feld of NICHT_FREIGEGEBEN) {
      const grund = (purchases.excluded ?? {})[feld];
      expect(grund, `${feld} ist nicht einmal ausgeschlossen`).toBeDefined();
      expect(grund).toContain("A2");
      expect(grund).toContain("nicht freigegeben");
    }
  });

  it("und in keinem ANDEREN Bereich tauchen sie auf — außer im Belegsnapshot", () => {
    /*
     * `purchase_receipts` trägt `sender_*` und `listing_*` mit Absicht: der
     * Snapshot IST das Dokument über den Ankauf, dieselbe Begründung wie bei
     * der Rechnung (§ 147 AO). Jeder andere Bereich wäre eine zweite Kopie
     * ohne Anlass.
     */
    for (const s of BACKUP_SECTIONS) {
      if (s.source === "purchase_receipts") continue;
      for (const feld of NICHT_FREIGEGEBEN) {
        expect(s.fields, `${s.key}.${feld}`).not.toContain(feld);
      }
    }
  });

  it("die Migrationen prüfen dasselbe ein zweites Mal", () => {
    for (const datei of ["0130_business_backup_fields.sql",
                         "0131_business_backup_seller_fields.sql"]) {
      const sql = readFileSync(`supabase/migrations/${datei}`, "utf8");
      expect(sql, datei).toContain("personenbezogen und nicht freigegeben");
      for (const feld of NICHT_FREIGEGEBEN) {
        expect(sql, `${datei}: ${feld}`).toContain(`'''${feld}'''`);
      }
    }
  });
});

describe("was 0130 und 0131 aufgenommen haben", () => {
  const feld = (key: string) => BACKUP_SECTIONS.find((s) => s.key === key)!.fields;

  it("0130a: die Kostenaufteilung des Einkaufs", () => {
    for (const f of ["items_cost", "shipping_cost", "buyer_protection_cost",
                     "payment_method", "platform", "seller_name"]) {
      expect(feld("purchases"), f).toContain(f);
    }
  });

  it("0130a: Geschäftstag, Verkaufsbrücke, Erstattungszeitpunkte, Katalogordnung", () => {
    expect(feld("sales")).toContain("sale_day");
    expect(feld("order_reservations")).toContain("sale_item_id");
    for (const f of ["requested_at", "settled_at", "provider_status", "failure_code"]) {
      expect(feld("order_refunds"), f).toContain(f);
    }
    for (const f of ["category_id", "is_active", "source"]) {
      expect(feld("figures"), f).toContain(f);
    }
    expect(feld("series")).toContain("position");
    expect(feld("categories")).toContain("position");
    expect(feld("shop_settings")).toContain("id");
  });

  it("0130b: die Rechtsangaben des Betriebs, samt is_active", () => {
    for (const f of ["is_active", "register_court", "register_number", "w_id", "phone",
                     "direct_contact", "transactional_reply_to",
                     "withdrawal_contact_email", "complaints_contact_email",
                     "dispute_participation", "dispute_body", "dispatch_statement",
                     "return_postage_borne_by"]) {
      expect(feld("seller"), f).toContain(f);
    }
  });

  it("und 0122 wählt die aktive Zeile — deshalb muss is_active mitkommen", () => {
    const sql = readFileSync("supabase/migrations/0122_purchase_receipts.sql", "utf8");
    expect(sql).toContain("from public.sellers where is_active limit 1");
  });

  it("die Belegbereiche sind weiterhin vollständig", () => {
    for (const source of ["purchase_receipts", "purchase_receipt_downloads",
                          "purchase_receipt_counters", "purchase_items"]) {
      expect(luecke(source), source).toEqual([]);
    }
  });

  it("der Formatvertrag ist unverändert — es kamen nur Felder dazu", () => {
    for (const datei of ["0130_business_backup_fields.sql",
                         "0131_business_backup_seller_fields.sql"]) {
      const sql = readFileSync(`supabase/migrations/${datei}`, "utf8");
      expect(sql, datei).toContain("die Formatversion wurde veraendert");
      expect(sql, datei).toContain("restore_supported ist nicht mehr false");
    }
  });
});

/* ==========================================================================
 * 0130 und 0131 fassen die Eigenbelege nicht an
 * ======================================================================== */

describe("0130 und 0131 lassen die Belege und ihre Unveränderlichkeit in Ruhe", () => {
  /*
   * DIE FRAGE IST BERECHTIGT UND DIE ANTWORT PRÜFBAR.
   *
   * Beide Migrationen ersetzen EINE Funktion und sonst nichts. Das lässt sich
   * an der Form zeigen: eine Migration, die eine Tabelle, einen Trigger, einen
   * Index oder ein Recht anfassen würde, müsste eine Anweisung dafür haben —
   * und top-level steht in diesen Dateien nur, was unten geprüft wird.
   *
   * Gegengeprüft mit einem echten PostgreSQL-Parser: `pglast` liest in beiden
   * Dateien genau vier Anweisungen — zwei DO-Blöcke (Vor- und Nachbedingung,
   * beide nur lesend), ein `create or replace function` und ein `comment on`.
   */
  const DATEIEN = ["0130_business_backup_fields.sql",
                   "0131_business_backup_seller_fields.sql"] as const;

  /** Die Anweisungsanfänge auf Spalte 0 — so sind diese Dateien formatiert. */
  const anfaenge = (sql: string): string[] =>
    sql.split("\n")
      .filter((l) => /^[a-z]/.test(l))
      .map((l) => l.trim().toLowerCase());

  for (const datei of DATEIEN) {
    const sql = readFileSync(`supabase/migrations/${datei}`, "utf8");

    it(`${datei}: ein create-or-replace, ein comment, zwei DO-Blöcke`, () => {
      const starts = anfaenge(sql);
      expect(starts.filter((l) => l.startsWith("do $$"))).toHaveLength(2);
      expect(starts.filter((l) => l.startsWith("create or replace function")))
        .toHaveLength(1);
      expect(starts.filter((l) => l.startsWith("comment on function"))).toHaveLength(1);
    });

    it(`${datei}: kein Wort, das eine Tabelle oder ein Recht ändern könnte`, () => {
      /*
       * GEPRÜFT WIRD DIE GANZE DATEI, nicht nur Spalte 0 — innerhalb eines
       * DO-Blocks stünde eine solche Anweisung eingerückt. Zwölf der Begriffe
       * kommen überhaupt nicht vor.
       */
      for (const verboten of ["alter table", "create table", "drop table",
                              "create trigger", "drop trigger", "create index",
                              "drop index", "create policy", "drop policy",
                              "grant ", "revoke ", "alter function",
                              "drop function"]) {
        expect(sql.toLowerCase(), verboten).not.toContain(verboten);
      }
    });

    it(`${datei}: die drei Schreibwörter stehen NUR in der Verbotsliste`, () => {
      /*
       * `insert into`, `delete from` und `truncate` kommen je einmal vor — als
       * LITERAL in der Nachbedingung, die prüft, dass der Funktionsrumpf sie
       * nicht enthält. Der Wächter findet sich selbst; dieselbe Falle wie
       * zweimal in `0124`. Also wird die Stelle festgenagelt.
       */
      for (const wort of ["insert into", "delete from", "truncate"]) {
        const zeilen = sql.split("\n")
          .map((l, i) => ({ nr: i + 1, text: l }))
          .filter(({ text }) => text.toLowerCase().includes(wort));
        expect(zeilen, wort).toHaveLength(1);
        expect(zeilen[0].text, wort).toMatch(/^\s+(foreach v_key in array array\[)?'/);
      }
      /* Und die Liste gehört zu der Prüfung, die sie behauptet. */
      expect(sql).toContain("die Sicherung schreibt (%)");
    });

    it(`${datei}: sie ersetzt genau die Exportfunktion`, () => {
      const treffer = sql.match(/create or replace function public\.([a-z_]+)/g) ?? [];
      expect(treffer).toEqual(["create or replace function public.seller_business_backup"]);
    });

    it(`${datei}: der Postflight prüft die Unveränderlichkeit der Belege`, () => {
      const pf = readFileSync(
        `supabase/checks/${datei.slice(0, 4)}_postflight.sql`, "utf8");
      expect(pf).toContain("purchase_receipts_immutable_trg");
      expect(pf).toContain("purchase_receipt_downloads_immutable_trg");
      expect(pf).toContain("purchase_receipts_origin_uniq");
      expect(pf).toContain("purchase_receipts_supersedes_uniq");
      expect(pf).toContain("receipts_supersedes_ref_complete");
      /* Und dass die Belegsnapshots sich nicht bewegt haben. */
      expect(pf).toContain("Pruefsumme der eingefrorenen Positionslisten");
      expect(pf).toContain("Pruefsumme der gespeicherten Fingerabdruecke");
      expect(pf).toContain("Pruefsumme der Kette");
    });
  }

  it("die Belegfelder im Export sind unverändert die aus 0129", () => {
    const sections = BACKUP_SECTIONS.find((s) => s.key === "purchase_receipts")!;
    expect(sections.fields).toHaveLength(38);
    expect(sections.fields).toContain("lines");
    expect(sections.fields).toContain("content_fingerprint");
    expect(sections.fields).toContain("supersedes_number");
    expect(sections.excluded).toEqual({
      issued_by: "Kontoidentität — das Belegdokument selbst nennt sie auch nicht",
    });
  });
});

/* ==========================================================================
 * Der Fehlalarm aus dem Staging-Preflight — und der Riegel dagegen
 * ======================================================================== */

describe("Feldprüfungen sind bereichsgenau, nicht rumpfweit", () => {
  /*
   * DER FEHLER, DEN DIESE BLÖCKE FESTHALTEN.
   *
   * `0130_preflight.sql` schlug auf Staging an: Prüfung 131 zählte **5**
   * Absenderfelder „im Export", 132 **4** Inseratsfelder, und 201 las
   * `NACH_0130`, obwohl die Migration nie gelaufen war. Alle drei Befunde
   * kamen aus dem Bereich `purchase_receipts`, den `0129` aufgenommen hat: ein
   * Eigenbeleg friert den Ankauf ein, und dazu gehören Absender, Inserat,
   * Kaufvereinbarung UND die Kostenaufteilung. **Dort stehen diese Felder
   * berechtigt.**
   *
   * Die Prüfungen suchten im GANZEN Funktionsrumpf statt im Bereich
   * `purchases`. Und die Nachbedingung von `0130` hätte denselben Fehler in
   * der schlimmeren Richtung gemacht: sie hätte die Migration abgebrochen.
   * Umgekehrt hätten die Postflight-Prüfungen 101, 102 und 108 BESTANDEN,
   * ohne dass `0130` etwas am Einkaufsbereich geändert hätte.
   *
   * Dieser Block hält beides fest: wo die neun Felder stehen dürfen, und dass
   * keine Prüfdatei und keine Migration sie rumpfweit sucht.
   */
  const PRIVAT = NICHT_FREIGEGEBEN;
  const PRUEFDATEIEN = ["0130_preflight", "0130_postflight",
                        "0131_preflight", "0131_postflight"] as const;
  const MIGRATIONEN = ["0130_business_backup_fields",
                       "0131_business_backup_seller_fields"] as const;

  /** Die Felder je Bereich aus einem Funktionsrumpf. */
  const bereicheVon = (datei: string) =>
    fieldsFromBackupSql(readFileSync(`supabase/migrations/${datei}.sql`, "utf8"));

  /**
   * SQL ohne Prosa — für jede Abwesenheitsbehauptung.
   *
   * ZUM DRITTEN MAL DIESELBE FALLE: diese Dateien ERKLÄREN in ihren
   * Kopfkommentaren, welches Muster verboten ist, und ein `not.toContain`
   * über die ganze Datei findet die Erklärung. Wer die Abwesenheit von Code
   * behauptet, muss die Kommentare vorher wegnehmen.
   */
  const ohneProsa = (datei: string): string =>
    readFileSync(datei, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*--.*$/gm, "");

  for (const datei of ["0129_business_backup_receipts",
                       "0130_business_backup_fields",
                       "0131_business_backup_seller_fields"]) {
    it(`${datei}: die neun Felder stehen NUR im Belegsnapshot`, () => {
      const bereiche = bereicheVon(datei);
      for (const feld of PRIVAT) {
        const drin = Object.entries(bereiche)
          .filter(([, felder]) => felder.includes(feld))
          .map(([key]) => key);
        expect(drin, feld).toEqual(["purchase_receipts"]);
      }
      /* Und der Einkaufsbereich trägt keines. */
      for (const feld of PRIVAT) {
        expect(bereiche.purchases, feld).not.toContain(feld);
      }
    });
  }

  it("POSITIVKONTROLLE: die rumpfweite Suche liefert genau die 5 und 4 vom Staging", () => {
    /*
     * Der Fehlalarm, nachgestellt. 131 suchte fünf Absenderfelder im ganzen
     * Rumpf und fand fünf; 132 suchte vier und fand vier. Die Zahlen aus dem
     * Staging-Lauf sind damit vollständig erklärt — und dieser Test fällt,
     * wenn jemand den Fehlgriff für harmlos hält.
     */
    const sql = readFileSync(
      "supabase/migrations/0129_business_backup_receipts.sql", "utf8");
    const absender = ["sender_name", "sender_street", "sender_postal_code",
                      "sender_city", "sender_country"];
    const inserat = ["listing_title", "listing_url", "listing_details",
                     "agreement_note"];
    expect(absender.filter((f) => sql.includes(`'${f}'`))).toHaveLength(5);
    expect(inserat.filter((f) => sql.includes(`'${f}'`))).toHaveLength(4);
    /* Und `items_cost` mit Textcast — daraus las 201 `NACH_0130`. */
    expect(sql).toContain("'items_cost', t.items_cost::text");
    /* Bereichsgenau gelesen ist beides sauber. */
    const bereiche = fieldsFromBackupSql(sql);
    expect(bereiche.purchases).toHaveLength(10);
    expect(bereiche.purchases).not.toContain("items_cost");
  });

  for (const datei of PRUEFDATEIEN) {
    const sql = readFileSync(`supabase/checks/${datei}.sql`, "utf8");

    it(`${datei}: ordnet Felder je Bereich zu, statt im Rumpf zu suchen`, () => {
      expect(sql).toContain("bereich as (");
      expect(sql).toContain("feld as (");
      /*
       * ZEILENWEISE, NICHT MEHRZEILIG. Hier stand `regexp_matches(c.d, …)` —
       * ein Ausdruck über den ganzen Rumpf. In PostgreSQL wurde er gierig
       * (Handbuch 9.7.3.5: die Gierigkeit gehört dem ganzen Zweig) und der
       * erste Bereich verschluckte alles. `backup-sql-areas.test.ts` hält die
       * Form jetzt fest; hier wird nur noch verlangt, dass sie zeilenweise ist.
       */
      expect(sql).toContain("regexp_split_to_table");
      expect(sql).toContain("with ordinality");
      expect(ohneProsa(`supabase/checks/${datei}.sql`))
        .not.toContain("regexp_matches(c.d,");
    });

    it(`${datei}: kein privates Feld wird rumpfweit gesucht`, () => {
      const stellen = sql.split("\n").filter((l) =>
        PRIVAT.some((f) => l.includes(`'''${f}'''`))
        && (l.includes("in (select d from code)") || l.includes("in d.d")));
      expect(stellen, `${datei} sucht rumpfweit`).toEqual([]);
    });

    it(`${datei}: und kein Einkaufsfeld, das es auch im Beleg gibt`, () => {
      /* `items_cost`, `payment_method`, `is_active`, `position`, `id` kommen in
         mehreren Bereichen vor — rumpfweit gesucht prüfen sie nichts. */
      for (const feld of ["items_cost", "payment_method", "is_active"]) {
        const stellen = sql.split("\n").filter((l) =>
          l.includes(`'''${feld}''', t.${feld}`)
          && (l.includes("in (select d from code)") || l.includes("in d.d")));
        expect(stellen, `${datei}: ${feld}`).toEqual([]);
      }
    });
  }

  for (const datei of MIGRATIONEN) {
    const sql = readFileSync(`supabase/migrations/${datei}.sql`, "utf8");

    it(`${datei}: die Nachbedingung parst zeilenweise und arbeitet mit Paaren`, () => {
      /* `substring(v_code from '…(.*?)…')` ist weg — siehe
         `backup-sql-areas.test.ts` für den Grund. Kommentarfrei geprüft: der
         Kopf der Datei zitiert das alte Muster, um es zu begründen. */
      expect(ohneProsa(`supabase/migrations/${datei}.sql`))
        .not.toContain("substring(v_code from");
      expect(sql).toContain("regexp_split_to_table(v_code, E'\\n') with ordinality");
      expect(sql).toContain("split_part(v_key, '|', 1)");
      expect(sql).toContain("v_key = any (v_paare)");
    });

    it(`${datei}: sie prüft die neun Felder im Bereich purchases, nicht im Rumpf`, () => {
      expect(sql).toContain("der Bereich purchases nennt %");
      expect(ohneProsa(`supabase/migrations/${datei}.sql`))
        .not.toContain("der Export nennt % — personenbezogen");
      /* Dazu zwei weitere Prüfungen: in keinem anderen Bereich als dem
         Belegsnapshot — und dort MUSS jedes stehen. */
      expect(sql).toContain("ausser purchase_receipts");
      expect(sql).toContain("fehlt im Belegsnapshot");
    });

    it(`${datei}: und jede neue Feldzeile wird ihrem Bereich zugeordnet`, () => {
      expect(sql).toMatch(/'purchases\|''items_cost''/);
      expect(sql).toContain("v_key = any (v_paare)");
      /* Und eine Parserabweichung bricht ab, statt als Erfolg zu gelten. */
      expect(sql).toContain("Abbruch vor jeder Feldaussage");
    });
  }

  it("die Diagnose zum Fehlalarm liegt in supabase/checks", () => {
    const diag = readFileSync("supabase/checks/0130_export_keys_diagnosis.sql", "utf8");
    /* Sie stellt den Fehlgriff nach … */
    expect(diag).toContain("Pruefung 131 zaehlte so");
    expect(diag).toContain("'5'");
    /* … und sagt bereichsgenau, wo die Felder stehen. */
    expect(diag).toContain("sender_name steht in welchen Bereichen?");
    expect(diag).toContain("'purchase_receipts'");
    /* Sie ruft die Exportfunktion NICHT auf und gibt keine Werte aus. */
    expect(diag).toContain("SIE RUFT `seller_business_backup()` NICHT AUF");
    expect(diag).not.toMatch(/select\s+public\.seller_business_backup\(\)/);
  });
});
