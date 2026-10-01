import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  allBackupFields, BACKUP_FORMAT, BACKUP_FORMAT_VERSION, BACKUP_METADATA_FIELDS,
  BACKUP_SECTIONS, BACKUP_VALUE_RULES, backupSourceTables, EXCLUDED_TABLES,
  FORBIDDEN_FIELDS, PERSONAL_DATA_FIELDS,
} from "./manifest";

/**
 * Das Backup-Manifest (V1, Schritt 1).
 *
 * Diese Tests sind der eigentliche Zweck der Manifestdatei. Die Auswahl, was
 * in eine Datensicherung gehört, wird einmal getroffen und danach jahrelang
 * fortgeschrieben — und genau dabei rutscht irgendwann ein Feld mit, das
 * niemand exportieren wollte. Hier steht, was nicht passieren darf.
 */

describe("der Formatvertrag", () => {
  it("nennt Namen und Version", () => {
    expect(BACKUP_FORMAT).toBe("skyisles-business-backup");
    expect(BACKUP_FORMAT_VERSION).toBe(1);
  });

  it("führt die Metadaten, ohne die eine Datei im Ernstfall wertlos ist", () => {
    for (const key of ["format", "format_version", "created_at", "source_project",
                       "commerce_mode", "snapshot_txid", "counts"]) {
      expect(BACKUP_METADATA_FIELDS).toContain(key);
    }
  });

  it("sagt ausdrücklich, dass V1 keinen Restore kann", () => {
    // Ein Backup ohne Restore wiegt in falscher Sicherheit; das gehört in die
    // Datei, nicht nur ins Konzept.
    expect(BACKUP_METADATA_FIELDS).toContain("restore_supported");
  });

  it("schreibt Geld als String vor", () => {
    // Dieselbe Regel wie im Webhook: ein numeric(10,2) darf nicht durch einen
    // Gleitkommawert.
    expect(BACKUP_VALUE_RULES.money).toContain("String");
    expect(BACKUP_VALUE_RULES.money).toContain("niemals Number");
  });
});

describe("kein Bereich führt ein gesperrtes Feld", () => {
  it("weder in den übernommenen noch in den gebildeten Feldern", () => {
    /*
     * Der Test, wegen dem es diese Datei gibt. Geheimnisse, Stripe-Interna,
     * Kartendaten, Kontoidentitäten und die Spuren des Excel-Imports dürfen
     * nirgends auftauchen — heute nicht und beim nächsten hinzugefügten Feld
     * auch nicht.
     */
    const verstoesse: string[] = [];
    for (const section of BACKUP_SECTIONS) {
      for (const field of [...section.fields, ...(section.denormalised ?? []).map((d) => d.field)]) {
        if (field in FORBIDDEN_FIELDS) verstoesse.push(`${section.key}.${field}`);
      }
    }
    expect(verstoesse).toEqual([]);
  });

  it("die Sperrliste deckt die vier Klassen ab, um die es geht", () => {
    for (const field of ["client_salt", "payment_token_hash", "client_hash", "request_id",
                         "provider_payment_id", "provider_intent_id", "provider_refund_id",
                         "card_brand", "card_last4", "wallet_type",
                         "user_id", "created_by", "updated_by",
                         "import_fingerprint", "source_row"]) {
      expect(FORBIDDEN_FIELDS, `${field} muss gesperrt sein`).toHaveProperty(field);
    }
  });

  it("jede Sperre nennt einen Grund", () => {
    for (const [field, grund] of Object.entries(FORBIDDEN_FIELDS)) {
      expect(grund.length, `${field} ohne Begründung`).toBeGreaterThan(10);
    }
  });
});

describe("personenbezogene Daten stehen nur dort, wo sie hingehören", () => {
  it("jedes PII-Feld erscheint ausschließlich in seinem erlaubten Bereich", () => {
    const verstoesse: string[] = [];
    for (const section of BACKUP_SECTIONS) {
      for (const field of section.fields) {
        const erlaubt = PERSONAL_DATA_FIELDS[field];
        if (erlaubt !== undefined && erlaubt !== section.source) {
          verstoesse.push(`${field} in ${section.source}, erlaubt nur in ${erlaubt}`);
        }
      }
    }
    expect(verstoesse).toEqual([]);
  });

  it("jeder Bereich mit PII ist als solcher gekennzeichnet", () => {
    for (const section of BACKUP_SECTIONS) {
      const hatPii = section.fields.some((f) => f in PERSONAL_DATA_FIELDS);
      if (hatPii) {
        expect(section.personalData, `${section.key} führt PII ohne Kennzeichnung`).toBe(true);
      }
    }
  });

  it("die Rechnungen sind der einzige Bereich mit Käuferanschrift", () => {
    // § 147 AO verlangt zehn Jahre Aufbewahrung; eine Rechnung ohne Empfänger
    // ist keine. Überall sonst wäre es eine zweite Kopie ohne Anlass.
    const mitKunde = BACKUP_SECTIONS.filter((s) => s.fields.includes("customer_name"));
    expect(mitKunde.map((s) => s.source)).toEqual(["invoices"]);
  });

  it("die Käufer-E-Mail der Bestellung bleibt draußen", () => {
    const orders = BACKUP_SECTIONS.find((s) => s.source === "orders")!;
    expect(orders.fields).not.toContain("customer_email");
    expect(orders.excluded).toHaveProperty("customer_email");
  });

  it("kennzeichnet die Datei als personenbezogen, solange Rechnungen enthalten sind", () => {
    expect(BACKUP_SECTIONS.some((s) => s.personalData)).toBe(true);
    expect(BACKUP_METADATA_FIELDS).toContain("contains_personal_data");
  });
});

describe("die Legacy-Maschinerie bleibt vollständig draußen", () => {
  it("keine der Excel-/Cutover-Tabellen ist eine Quelle", () => {
    /*
     * Der wichtigste Ausschluss. Ein Backup, das sie enthielte, lüde
     * irgendwann jemanden ein, sie zurückzuspielen — und ein Bestandsreset
     * aus der alten Arbeitsmappe ist dauerhaft verboten.
     */
    const quellen = backupSourceTables();
    for (const t of ["legacy_stock_events", "inventory_imports", "inventory_import_rows",
                     "inventory_import_mappings"]) {
      expect(quellen, `${t} darf keine Backup-Quelle sein`).not.toContain(t);
      expect(EXCLUDED_TABLES, `${t} muss begründet ausgeschlossen sein`).toHaveProperty(t);
    }
  });

  it("und ihre Spuren in den übernommenen Tabellen auch nicht", () => {
    const felder = allBackupFields();
    for (const f of ["import_fingerprint", "source_row", "legacy_condition_flag",
                     "legacy_booked_flag", "legacy_stock_flag", "legacy_shipped_flag"]) {
      expect(felder, `${f} darf nirgends exportiert werden`).not.toContain(f);
    }
  });

  it("das Manifest sagt selbst, dass dies ein Export und keine Synchronisation ist", () => {
    const quelle = readFileSync("src/lib/backup/manifest.ts", "utf8");
    expect(quelle).toContain("EXPORT, NIEMALS EINE SYNCHRONISATION");
    expect(quelle).toContain("append-only");
  });
});

describe("die ausgeschlossenen Tabellen", () => {
  it("sind keine Quellen", () => {
    const quellen = new Set(backupSourceTables());
    for (const t of Object.keys(EXCLUDED_TABLES)) {
      expect(quellen.has(t), `${t} ist ausgeschlossen und trotzdem Quelle`).toBe(false);
    }
  });

  it("nennen jeweils einen Grund", () => {
    for (const [t, grund] of Object.entries(EXCLUDED_TABLES)) {
      expect(grund.length, `${t} ohne Begründung`).toBeGreaterThan(20);
    }
  });

  it("umfassen die Zahlungstechnik und das Geheimnis", () => {
    for (const t of ["payment_attempts", "payment_events", "commerce_settings",
                     "customer_contacts", "order_messages", "profiles"]) {
      expect(EXCLUDED_TABLES).toHaveProperty(t);
    }
  });
});

describe("die Bereiche sind in sich stimmig", () => {
  it("haben eindeutige Schlüssel und Quellen", () => {
    const keys = BACKUP_SECTIONS.map((s) => s.key);
    const sources = BACKUP_SECTIONS.map((s) => s.source);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(sources).size).toBe(sources.length);
  });

  it("führen kein Feld gleichzeitig als übernommen und ausgeschlossen", () => {
    for (const s of BACKUP_SECTIONS) {
      for (const f of Object.keys(s.excluded ?? {})) {
        expect(s.fields, `${s.key}.${f} steht auf beiden Listen`).not.toContain(f);
      }
    }
  });

  it("begründen jeden Ausschluss und jede Bildung", () => {
    for (const s of BACKUP_SECTIONS) {
      for (const [f, grund] of Object.entries(s.excluded ?? {})) {
        expect(grund.length, `${s.key}.${f} ohne Begründung`).toBeGreaterThan(5);
      }
      for (const d of s.denormalised ?? []) {
        expect(d.from.length).toBeGreaterThan(5);
        expect(d.why.length).toBeGreaterThan(20);
      }
    }
  });

  it("erklären, wozu sie da sind", () => {
    for (const s of BACKUP_SECTIONS) {
      expect(s.purpose.length, `${s.key} ohne Zweck`).toBeGreaterThan(20);
      expect(s.fields.length, `${s.key} ohne Felder`).toBeGreaterThan(0);
    }
  });
});

describe("was ein Bestand braucht, um nachvollziehbar zu bleiben", () => {
  const bySource = (t: string) => BACKUP_SECTIONS.find((s) => s.source === t);

  it("Bestand und Ledger sind beide dabei und beide restore-relevant", () => {
    for (const t of ["shop_inventory", "inventory_movements"]) {
      expect(bySource(t), `${t} fehlt`).toBeDefined();
      expect(bySource(t)!.restoreRelevant).toBe(true);
    }
  });

  it("Bewegungen tragen SKY-ID und Zustand, nicht nur eine Zeilennummer", () => {
    /*
     * `inventory_movements.inventory_id` zeigt auf eine Zeile, die es später
     * vielleicht nicht mehr gibt. Ohne Denormalisierung wäre die Bewegung
     * außerhalb der Datenbank wertlos.
     */
    const mv = bySource("inventory_movements")!;
    const gebildet = (mv.denormalised ?? []).map((d) => d.field);
    expect(gebildet).toContain("sky_id");
    expect(gebildet).toContain("condition");
  });

  it("Reservierungen ebenso — sie sind die Brücke zur Bestellung", () => {
    const res = bySource("order_reservations")!;
    expect((res.denormalised ?? []).map((d) => d.field)).toEqual(["sky_id", "condition"]);
  });

  it("der Buy-in-Faktor ist aus dem Backup nachrechenbar", () => {
    // Kosten aus `purchases.total_cost`, Wert aus den eingefrorenen
    // Marktwerten der Positionen — beide Seiten sind enthalten, die Kennzahl
    // muss nicht geglaubt werden.
    expect(bySource("purchases")!.fields).toContain("total_cost");
    expect(bySource("purchase_items")!.fields).toContain("market_price_snapshot");
    expect(BACKUP_METADATA_FIELDS).toContain("buy_in_factor");
  });

  it("Testdaten bleiben als solche erkennbar", () => {
    expect(bySource("purchases")!.fields).toContain("is_test");
    expect(bySource("sales")!.fields).toContain("is_test");
  });

  it("die Verkaufsseite ist vollständig", () => {
    for (const t of ["sales", "sale_items", "sale_fees", "sale_refunds",
                     "settlement_adjustments", "orderbook_name_mappings"]) {
      expect(bySource(t), `${t} fehlt`).toBeDefined();
    }
  });

  it("die Shop-Bestellungen erklären ihre eigenen Bestandsbewegungen", () => {
    for (const t of ["orders", "order_lines", "order_line_events", "order_reservations",
                     "order_refunds", "order_refund_allocations"]) {
      expect(bySource(t), `${t} fehlt`).toBeDefined();
    }
  });

  it("ein Stammdatenschnappschuss hält die Datei lesbar", () => {
    const fig = bySource("skylanders")!;
    expect(fig.fields).toContain("sky_id");
    expect(fig.fields).toContain("name");
    expect(fig.fields).toContain("market_price");
    expect(fig.restoreRelevant).toBe(false);
  });
});

describe("das Manifest beschreibt nur — es tut nichts", () => {
  it("kennt weder Datenbank noch Netz noch Dateisystem", () => {
    const code = readFileSync("src/lib/backup/manifest.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    for (const verboten of ["supabase", "createClient", "fetch(", ".rpc(", "use server",
                            "node:fs", "process.env"]) {
      expect(code.includes(verboten), `manifest.ts darf ${verboten} nicht enthalten`).toBe(false);
    }
    // Und keine einzige Import-Anweisung.
    expect(code).not.toMatch(/^\s*import\s/m);
  });
});
