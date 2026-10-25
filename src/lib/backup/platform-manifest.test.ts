import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { tablesOf } from "@/test-support/migrations";

import { BACKUP_SECTIONS, FORBIDDEN_FIELDS } from "./manifest";
import {
  allPlatformFields, AUTH_FORBIDDEN_FIELDS, AUTH_INVENTORY_DISCLAIMER,
  AUTH_INVENTORY_FIELDS, PLATFORM_ARCHIVE_LAYOUT, PLATFORM_EXCLUDED_TABLES,
  PLATFORM_FORBIDDEN_FIELDS, PLATFORM_FORMAT, PLATFORM_FORMAT_VERSION,
  PLATFORM_METADATA_FIELDS, PLATFORM_METADATA_SOURCE, PLATFORM_SECTIONS,
  platformSourceTables, SHARED_FORBIDDEN_CORE, STORAGE_BUCKETS_INCLUDED,
  STORAGE_MANIFEST_FIELDS,
} from "./platform-manifest";

/**
 * Das Platform-Manifest (V1, Schritt 1).
 *
 * Der Platform-Export ist unter Supabase Free unsere einzige Absicherung auf
 * Anwendungsebene. Was hier fehlt, fehlt im Ernstfall — und was hier zu viel
 * steht, liegt als Geheimnis auf einem Schreibtisch. Beides prüfen diese
 * Tests.
 */

/**
 * Die heutigen `public`-Tabellen — jetzt AUS DEN MIGRATIONEN, nicht aus einer
 * Liste.
 *
 * HIER STAND EINE HANDGEPFLEGTE LISTE, und sie hat zweimal versagt. Vor
 * `0122` fehlten die drei Belegtabellen darin; der Test „keine vergessen"
 * konnte sie deshalb nicht vermissen. `0142` legte dann
 * `purchase_calculations` an — und derselbe Test sagte wieder nichts. Gefunden
 * wurde es beim Production-Release-Check am 2026-10-25, von Hand.
 *
 * Der Kommentar, der damals hier stand, war schon richtig: „Ein Wächter, der
 * seine eigene Grundgesamtheit veraltet führt, prüft nichts." Zweimal
 * derselbe Satz ist kein Zufall mehr, sondern ein Entwurfsfehler — eine
 * Liste, die ein Mensch nachziehen muss, zieht ein Mensch irgendwann nicht
 * nach.
 *
 * `tablesOf()` faltet `create table`, `drop table` und `alter table … rename
 * to` über die ganze Historie und kann deshalb nicht veralten. Was es
 * ausdrücklich NICHT kann, steht an ihm selbst — und es scheitert laut statt
 * leer zu bestehen.
 */
const ALL_PUBLIC_TABLES: readonly string[] = [...tablesOf()].sort();

describe("der Formatvertrag", () => {
  it("hat einen eigenen Namen und eine eigene Version", () => {
    // Zwei Formate, zwei Verantwortungen — kein gemeinsamer Namensraum.
    expect(PLATFORM_FORMAT).toBe("skyisles-platform-backup");
    expect(PLATFORM_FORMAT_VERSION).toBe(1);
    expect(PLATFORM_FORMAT).not.toBe("skyisles-business-backup");
  });

  it("sagt, dass kein Restore möglich ist", () => {
    expect(PLATFORM_METADATA_FIELDS).toContain("restore_supported");
  });

  it("kennzeichnet sich als personenbezogen und als reines Auth-Inventar", () => {
    expect(PLATFORM_METADATA_FIELDS).toContain("contains_personal_data");
    expect(PLATFORM_METADATA_FIELDS).toContain("auth_inventory_only");
  });

  it("führt je Archivdatei eine Prüfsumme", () => {
    expect(PLATFORM_METADATA_FIELDS).toContain("files");
  });

  it("weist jedem Metadatum eine Quelle zu", () => {
    for (const f of PLATFORM_METADATA_FIELDS) {
      expect(PLATFORM_METADATA_SOURCE[f], `${f} ohne Quelle`).toBeDefined();
    }
  });
});

/**
 * Welche Tabellen im Plattformmanifest keine Entscheidung tragen.
 *
 * Als Funktion und nicht inline, damit derselbe Satz Regeln zweimal gefragt
 * werden kann: einmal mit dem echten Schema (muss leer sein) und einmal mit
 * einer erfundenen Tabelle (muss SIE nennen). Ein Wächter, dessen Anschlagen
 * nie geprüft wurde, ist eine Behauptung.
 */
function unentschiedenImPlattformexport(tabellen: Iterable<string>): string[] {
  const drin = new Set(platformSourceTables());
  const raus = new Set(Object.keys(PLATFORM_EXCLUDED_TABLES));
  return [...tabellen].filter((t) => !drin.has(t) && !raus.has(t)).sort();
}

describe("jede Tabelle der Plattform ist entschieden", () => {
  it("ist entweder ein Bereich oder ausdrücklich ausgeschlossen — keine vergessen", () => {
    /*
     * Der wichtigste Test dieser Datei. Eine Tabelle, die weder gesichert
     * noch begründet ausgeschlossen ist, fällt im Ernstfall lautlos weg.
     */
    expect(unentschiedenImPlattformexport(ALL_PUBLIC_TABLES),
           "unentschiedene Tabellen").toEqual([]);
  });

  it("und eine NEUE, nicht klassifizierte Tabelle bringt ihn zu Fall", () => {
    /*
     * DER BEWEIS, DASS DER WÄCHTER ANSCHLÄGT.
     *
     * Zweimal hat er geschwiegen, als eine Tabelle fehlte — beide Male, weil
     * sie in seiner Grundgesamtheit nicht vorkam. Die Grundgesamtheit kommt
     * jetzt aus den Migrationen; was noch fehlte, war der Nachweis, dass die
     * REGEL darüber greift. Hier ist er: eine erfundene Tabelle, und der
     * Wächter nennt genau sie.
     */
    const erfunden = "frisch_erfundene_tabelle_0999";
    expect(platformSourceTables()).not.toContain(erfunden);
    expect(Object.keys(PLATFORM_EXCLUDED_TABLES)).not.toContain(erfunden);
    expect(unentschiedenImPlattformexport([...ALL_PUBLIC_TABLES, erfunden]))
      .toEqual([erfunden]);
  });

  it("und `tablesOf()` sieht jede Tabelle, die eine Migration anlegt", () => {
    /*
     * Die andere Hälfte desselben Beweises: der Wächter kann nur anschlagen,
     * wenn die Tabelle in seiner Grundgesamtheit AUFTAUCHT. Genau das war
     * zweimal nicht der Fall. Drei Stichproben aus drei Epochen — die
     * älteste Tabelle, eine aus der Belegfamilie (die beim ersten Mal fehlte)
     * und die aus `0142` (die beim zweiten Mal fehlte).
     */
    for (const t of ["skylanders", "purchase_receipts", "purchase_calculations"]) {
      expect(ALL_PUBLIC_TABLES, `${t} fehlt in der Grundgesamtheit`).toContain(t);
    }
    /* Und sie ist nicht aus Versehen klein: 66 Tabellen am 2026-10-25. */
    expect(ALL_PUBLIC_TABLES.length).toBeGreaterThanOrEqual(66);
  });

  it("und keine Tabelle ist beides", () => {
    const raus = new Set(Object.keys(PLATFORM_EXCLUDED_TABLES));
    for (const t of platformSourceTables()) {
      expect(raus.has(t), `${t} ist Bereich und ausgeschlossen`).toBe(false);
    }
  });

  /*
   * EIN OFFENER PUNKT, NAMENTLICH UND MIT GRUND — KEINE ABSCHWÄCHUNG.
   *
   * Die Zusicherung lautet: der Platform-Export ist das größere Netz. Seit
   * `0129` führt der Business-Export die drei Belegtabellen, der
   * Platform-Export aber nicht — und dessen Erweiterung ist eine eigene
   * Entscheidung über ein Admin-Werkzeug, die nicht nebenbei mitläuft.
   *
   * Die Ausnahme steht deshalb mit Namen und Begründung da und wird selbst
   * geprüft: taucht eine VIERTE Tabelle in dieser Lücke auf, schlägt der Test
   * an. Weggelassen wird nichts, verschwiegen auch nicht.
   */
  const NUR_IM_BUSINESS_EXPORT: Readonly<Record<string, string>> = {
    purchase_receipts:
      "0129 nimmt die Eigenbelege in die Betriebssicherung; der Platform-Export " +
      "folgt erst mit einer eigenen Freigabe (Vorschlag 0130).",
    purchase_receipt_downloads: "wie purchase_receipts — Abrufnachweis derselben Kette.",
    purchase_receipt_counters: "wie purchase_receipts — der Nummernkreis.",
  };

  it("deckt deutlich mehr ab als der Business-Export", () => {
    const business = new Set(BACKUP_SECTIONS.map((s) => s.source));
    const platform = new Set(platformSourceTables());
    const luecke: string[] = [];
    for (const t of business) {
      if (platform.has(t)) continue;
      luecke.push(t);
      expect(NUR_IM_BUSINESS_EXPORT[t], `${t} fehlt im Platform-Export, ohne Grund`)
        .toBeDefined();
    }
    /* Genau die drei bekannten — nicht mehr, und auch nicht weniger: wäre
       die Lücke geschlossen, gehört die Ausnahmeliste gelöscht. */
    expect(luecke.sort()).toEqual(Object.keys(NUR_IM_BUSINESS_EXPORT).sort());
    expect(platform.size).toBeGreaterThan(business.size * 1.8);
  });

  it("und jede Ausnahme nennt einen Grund, der auf die Entscheidung zeigt", () => {
    for (const [tabelle, grund] of Object.entries(NUR_IM_BUSINESS_EXPORT)) {
      expect(grund.length, tabelle).toBeGreaterThan(30);
    }
    expect(NUR_IM_BUSINESS_EXPORT.purchase_receipts).toContain("0130");
  });

  it("enthält die Daten, die dem Business-Export fehlen und im Ernstfall zählen", () => {
    const drin = new Set(platformSourceTables());
    for (const t of ["collection_items", "profiles", "characters", "catalog_editorial",
                     "catalog_admin_changes", "legal_document_versions", "order_addresses",
                     "order_events", "order_messages", "customer_contacts",
                     "withdrawal_requests", "platform_settings", "commerce_settings",
                     "shipping_countries", "platform_admins", "shop_admins",
                     "seller_operators"]) {
      expect(drin.has(t), `${t} fehlt`).toBe(true);
    }
  });

  it("führt den VOLLSTÄNDIGEN Katalog, nicht die gehandelte Teilmenge", () => {
    const sky = PLATFORM_SECTIONS.find((s) => s.source === "skylanders")!;
    expect(sky.purpose).toContain("VOLLSTÄNDIGE");
    // Die redaktionellen Spalten, die der Business-Export auslässt.
    for (const f of ["catalog_visible", "display_name_override", "image_override_path",
                     "character_id", "is_active"]) {
      expect(sky.fields, `${f} fehlt im Katalog`).toContain(f);
    }
  });

  it("lässt die Legacy-Maschinerie und die Telemetrie begründet draußen", () => {
    for (const t of ["legacy_stock_events", "inventory_imports", "inventory_import_rows",
                     "inventory_import_mappings", "perf_navigations", "perf_interactions",
                     "cart_items", "withdrawal_attempts"]) {
      expect(PLATFORM_EXCLUDED_TABLES, `${t} muss begründet ausgeschlossen sein`)
        .toHaveProperty(t);
      expect(PLATFORM_EXCLUDED_TABLES[t].length).toBeGreaterThan(30);
    }
  });
});

describe("die Sperrliste hält", () => {
  it("kein gesperrtes Feld steht in einem Bereich", () => {
    const verstoesse: string[] = [];
    for (const s of PLATFORM_SECTIONS) {
      for (const f of [...s.fields, ...(s.denormalised ?? []).map((d) => d.field)]) {
        if (f in PLATFORM_FORBIDDEN_FIELDS) verstoesse.push(`${s.key}.${f}`);
      }
    }
    expect(verstoesse).toEqual([]);
  });

  it("der harte Kern ist in BEIDEN Formaten gesperrt", () => {
    /*
     * Die beiden Listen dürfen sich unterscheiden — der Business-Export
     * sperrt `user_id`, der Platform-Export braucht es. Geheimnisse,
     * Stripe-Interna, Kartendaten und die Excel-Spuren aber nicht.
     */
    for (const f of SHARED_FORBIDDEN_CORE) {
      expect(FORBIDDEN_FIELDS, `${f} nicht im Business-Export gesperrt`).toHaveProperty(f);
      expect(PLATFORM_FORBIDDEN_FIELDS, `${f} nicht im Platform-Export gesperrt`)
        .toHaveProperty(f);
    }
  });

  it("begründet jede Sperre", () => {
    for (const [f, grund] of Object.entries(PLATFORM_FORBIDDEN_FIELDS)) {
      expect(grund.length, `${f} ohne Begründung`).toBeGreaterThan(8);
    }
  });

  it("erlaubt bewusst, was eine Katastrophensicherung braucht", () => {
    // `user_id` und `customer_email` sind im Business-Export gesperrt und
    // hier notwendig: ohne sie weiß niemand, wem eine Sammlung gehörte.
    expect(FORBIDDEN_FIELDS).toHaveProperty("user_id");
    expect(PLATFORM_FORBIDDEN_FIELDS).not.toHaveProperty("user_id");
    expect(allPlatformFields()).toContain("user_id");
    expect(PLATFORM_SECTIONS.find((s) => s.source === "orders")!.fields)
      .toContain("customer_email");
  });

  it("sperrt trotzdem jede Kontoidentität, die nur Buchhaltung ist", () => {
    // `created_by`/`updated_by` tragen für eine Wiederherstellung nichts bei.
    for (const s of PLATFORM_SECTIONS) {
      for (const f of ["created_by", "updated_by", "granted_by", "changed_by",
                       "finalized_by", "handled_by"]) {
        expect(s.fields, `${s.key}.${f}`).not.toContain(f);
      }
    }
  });
});

describe("Auth ist ein Inventar, kein Backup", () => {
  it("führt genau die Felder, die eine Zuordnung erlauben", () => {
    expect([...AUTH_INVENTORY_FIELDS]).toEqual([
      "id", "email", "created_at", "last_sign_in_at", "email_confirmed_at",
      "provider", "banned_until",
    ]);
  });

  it("führt kein Passwort, keinen Token, kein Geheimnis", () => {
    for (const f of ["encrypted_password", "confirmation_token", "recovery_token",
                     "email_change_token_new", "reauthentication_token",
                     "raw_user_meta_data", "identities", "factors", "encrypted_secret"]) {
      expect(AUTH_FORBIDDEN_FIELDS, `${f} muss gesperrt sein`).toHaveProperty(f);
      expect([...AUTH_INVENTORY_FIELDS], `${f} darf nicht enthalten sein`).not.toContain(f);
    }
  });

  it("die Auth-Sperren gelten auch für die Bereiche der Datenbank", () => {
    for (const f of Object.keys(AUTH_FORBIDDEN_FIELDS)) {
      expect(PLATFORM_FORBIDDEN_FIELDS, `${f} fehlt in der Gesamtsperre`).toHaveProperty(f);
    }
  });

  it("sagt ausdrücklich, dass Konten daraus nicht wiederherstellbar sind", () => {
    /*
     * Die wichtigste einzelne Aussage dieses Formats. Ein Inventar, das für
     * ein Auth-Backup gehalten wird, ist gefährlicher als gar keins.
     */
    expect(AUTH_INVENTORY_DISCLAIMER).toContain("kein Auth-Backup");
    expect(AUTH_INVENTORY_DISCLAIMER).toContain("nicht wiederhergestellt");
    expect(AUTH_INVENTORY_DISCLAIMER).toContain("E-Mail-Adresse");
  });
});

describe("Storage: Metadaten und Dateien", () => {
  it("führt je Objekt die Angaben, die eine Prüfung erlauben", () => {
    for (const f of ["bucket_id", "name", "size", "mimetype", "etag"]) {
      expect([...STORAGE_MANIFEST_FIELDS]).toContain(f);
    }
  });

  it("nimmt die Dateien selbst mit — eine Liste ist kein Backup", () => {
    expect([...STORAGE_BUCKETS_INCLUDED]).toEqual(["catalog"]);
    expect(PLATFORM_ARCHIVE_LAYOUT.storagePrefix).toBe("storage/");
  });

  it("zählt fehlende Objekte, statt den Export scheitern zu lassen", () => {
    expect(PLATFORM_METADATA_FIELDS).toContain("storage_missing_count");
    expect(PLATFORM_METADATA_FIELDS).toContain("storage_object_count");
  });

  it("legt den Aufbau des Archivs fest", () => {
    expect(PLATFORM_ARCHIVE_LAYOUT).toEqual({
      manifest: "manifest.json",
      database: "database.json",
      authUsers: "auth-users.json",
      storageManifest: "storage-manifest.json",
      storagePrefix: "storage/",
    });
  });
});

describe("die Bereiche sind in sich stimmig", () => {
  it("haben eindeutige Schlüssel und Quellen", () => {
    const keys = PLATFORM_SECTIONS.map((s) => s.key);
    const sources = PLATFORM_SECTIONS.map((s) => s.source);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(sources).size).toBe(sources.length);
  });

  it("führen kein Feld gleichzeitig als übernommen und ausgeschlossen", () => {
    for (const s of PLATFORM_SECTIONS) {
      for (const f of Object.keys(s.excluded ?? {})) {
        expect(s.fields, `${s.key}.${f} steht auf beiden Listen`).not.toContain(f);
      }
    }
  });

  it("erklären sich und begründen jeden Ausschluss", () => {
    for (const s of PLATFORM_SECTIONS) {
      expect(s.purpose.length, `${s.key} ohne Zweck`).toBeGreaterThan(20);
      expect(s.fields.length, `${s.key} ohne Felder`).toBeGreaterThan(0);
      for (const [f, grund] of Object.entries(s.excluded ?? {})) {
        expect(grund.length, `${s.key}.${f} ohne Begründung`).toBeGreaterThan(5);
      }
    }
  });

  it("kennzeichnet jeden Bereich mit Personenbezug", () => {
    for (const key of ["profiles", "collection_items", "orders", "order_addresses",
                       "order_messages", "invoices", "customer_contacts",
                       "withdrawal_requests", "sales"]) {
      const s = PLATFORM_SECTIONS.find((x) => x.key === key)!;
      expect(s.personalData, `${key} führt PII ohne Kennzeichnung`).toBe(true);
    }
  });

  it("denormalisiert dort, wo eine Zeilennummer allein nichts trägt", () => {
    const mit = PLATFORM_SECTIONS.filter((s) => s.denormalised?.length).map((s) => s.key);
    expect(mit).toEqual(["inventory_movements", "order_reservations"]);
  });

  it("behandelt das Ledger als append-only", () => {
    const mv = PLATFORM_SECTIONS.find((s) => s.source === "inventory_movements")!;
    expect(mv.purpose).toContain("append-only");
    expect(mv.purpose).toContain("leeren Mandanten");
  });
});

describe("der Business-Export bleibt unberührt", () => {
  it("führt die Bereiche, die seine SQL-Fassung auch führt", () => {
    /*
     * HIER STAND `toHaveLength(25)` MIT DER BEGRÜNDUNG, `0104` sei
     * eingefroren. Das stimmte, bis `0129` die Funktion um die drei
     * Belegbereiche ergänzte. `0104` ist weiter unverändert — der Hash
     * darunter beweist es —, aber die ausgeführte Fassung ist eine andere,
     * und `backup-sql.test.ts` hält jetzt diese Feld für Feld dagegen.
     */
    expect(BACKUP_SECTIONS).toHaveLength(28);
    for (const key of ["purchase_receipts", "purchase_receipt_downloads",
                       "purchase_receipt_counters"]) {
      expect(BACKUP_SECTIONS.map((s) => s.key)).toContain(key);
    }
  });

  it("und 0104 trägt weiterhin ihren Fingerabdruck", () => {
    /*
     * Der Hash der BYTES, nicht die Länge der dekodierten Zeichenkette:
     * `readFileSync(..., "utf8").length` zählt UTF-16-Einheiten, und die
     * Datei enthält Umlaute — 21 896 Zeichen bei 21 964 Bytes. Eine
     * Zeichenzahl als Fingerabdruck hätte hier eine Drift vorgetäuscht,
     * die es nicht gab.
     */
    const bytes = readFileSync("supabase/migrations/0104_business_backup_export.sql");
    expect(createHash("sha256").update(bytes).digest("hex"))
      .toBe("2f9184f34bcab010d514b47b67c5884073539437064c67fb016c50f898714edf");
  });

  it("das Platform-Manifest beschreibt nur — es tut nichts", () => {
    const code = readFileSync("src/lib/backup/platform-manifest.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    for (const verboten of ["supabase", "createClient", "fetch(", ".rpc(", "use server",
                            "node:fs", "process.env"]) {
      expect(code.includes(verboten), `${verboten} im Manifest`).toBe(false);
    }
  });
});
