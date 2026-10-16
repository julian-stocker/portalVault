/**
 * Die Prüfung der heruntergeladenen Sicherung — und ihre Datenschutzzusage.
 *
 * ZWEI ZUSICHERUNGEN TRAGEN DIESE DATEI.
 *
 * 1. SIE RECHNET RICHTIG. Ein erfundenes Dokument mit bekannter Baseline muss
 *    glatt durchgehen; ein manipuliertes muss auffallen — und zwar an der
 *    Stelle, die manipuliert wurde.
 * 2. SIE GIBT NICHTS HERAUS. Das Prüfdokument hier trägt Namen, Anschriften,
 *    einen Inseratslink und eine Kaufvereinbarung. Keine dieser Zeichenketten
 *    darf im Bericht vorkommen. Das ist der eigentliche Test: eine Prüfung,
 *    die beim Prüfen ausplaudert, wäre schlimmer als keine.
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";

import { BACKUP_SECTIONS } from "./manifest";
import {
  auditBackup, baselineForDocument, BASELINE_JE_PROJEKT, buildFieldPlan,
  fieldsFromBackupSql, PRODUCTION_BASELINE, report, STAGING_BASELINE,
  type ExportBaseline, type FieldPlanEntry,
} from "./export-audit";

/**
 * Der Feldplan aus den zwei Quellen, die ohne die Datei auskommen.
 *
 * Genau so baut ihn das Werkzeug: `manifest.ts` ist die Entscheidung, der
 * Rumpf der letzten Migration ihre Ausführung.
 */
const LETZTE_FASSUNG = (() => {
  const dir = "supabase/migrations";
  const dateien = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (let i = dateien.length - 1; i >= 0; i -= 1) {
    const sql = readFileSync(`${dir}/${dateien[i]}`, "utf8");
    if (sql.includes("create or replace function public.seller_business_backup()")) {
      return { file: dateien[i], sql };
    }
  }
  throw new Error("keine Migration legt seller_business_backup() an");
})();

const PLAN = buildFieldPlan(BACKUP_SECTIONS, LETZTE_FASSUNG.sql);
const planFuer = (key: string): FieldPlanEntry =>
  PLAN.plan.find((p) => p.key === key)!;

/** Eine Zeile, die JEDES vorgesehene Feld trägt — leere Werte eingeschlossen. */
function zeileFuer(key: string, over: Record<string, unknown> = {}) {
  const row: Record<string, unknown> = {};
  for (const f of planFuer(key).expected) row[f] = null;
  return { ...row, ...over };
}

const md5 = (t: string) => createHash("md5").update(t, "utf8").digest("hex");
const TOOL = readFileSync("tools/verify-backup-export.mts", "utf8");

/* Erfundene personenbezogene Angaben — sie dürfen NIRGENDS im Bericht stehen. */
const GEHEIM = {
  sender: "Henry Tester",
  strasse: "Teststraße 3",
  kaeufer: "Erika Mustermann",
  mail: "erika@example.invalid",
  inserat: "https://example.invalid/anzeige/4711",
  vereinbarung: "Abholung vereinbart, Zahlung in bar",
  faktor: "0.4237",
};

function beleg(over: Record<string, unknown> = {}): Record<string, unknown> {
  /* Planbasiert: der Beleg trägt alle 38 vorgesehenen Felder, auch die, die
     dieser Prüffall nicht braucht. Sonst prüfte er den Feldabgleich gegen ein
     Dokument, das schon von sich aus unvollständig ist. */
  return zeileFuer("purchase_receipts", {
    id: 1, purchase_id: 105,
    receipt_number: "SI-E-2026-000001",
    issued_at: "2026-10-14T09:00:00+00:00",
    revision: 1, supersedes_id: null, supersedes_number: null,
    supersedes_issued_at: null,
    format_version: 2,
    content_fingerprint: "a".repeat(64),
    buyer_legal_name: GEHEIM.kaeufer, buyer_email: GEHEIM.mail,
    sender_name: GEHEIM.sender, sender_street: GEHEIM.strasse,
    listing_url: GEHEIM.inserat, agreement_note: GEHEIM.vereinbarung,
    total_cost: "13.00",
    lines: [
      { position: 1, sky_id: "SKY-0008", name: "Legendary Bash", condition: "loose" },
      { position: 2, sky_id: "SKY-0115", name: "Legendary Blades", condition: "sealed" },
    ],
    ...over,
  });
}

/** Ein vollständiges Dokument mit allen 28 Bereichen. */
function dokument(over: { receipts?: unknown[]; downloads?: unknown[] } = {}) {
  const belege = over.receipts ?? [
    beleg(),
    beleg({
      id: 2, receipt_number: "SI-E-2026-000002", revision: 2,
      supersedes_id: 1, supersedes_number: "SI-E-2026-000001",
      supersedes_issued_at: "2026-10-14T09:00:00+00:00",
      content_fingerprint: "b".repeat(64),
      lines: [
        { position: 1, sky_id: "SKY-0008", name: "Legendary Bash", condition: "loose" },
        { position: 2, sky_id: "SKY-0349", name: "Spyro", condition: "loose" },
        { position: 3, sky_id: "SKY-0115", name: "Blades", condition: "sealed" },
      ],
    }),
  ];
  const abrufe = over.downloads ?? [
    zeileFuer("purchase_receipt_downloads",
      { id: 1, receipt_id: 1, delivered_at: "2026-10-14T10:00:00+00:00",
        byte_count: 4096 }),
    zeileFuer("purchase_receipt_downloads",
      { id: 2, receipt_id: 2, delivered_at: "2026-10-16T12:00:00+00:00",
        byte_count: 4200 }),
  ];

  const data: Record<string, unknown[]> = {};
  for (const s of BACKUP_SECTIONS) data[s.key] = [];
  data.purchase_receipts = belege;
  data.purchase_receipt_downloads = abrufe;
  data.purchase_receipt_counters = [zeileFuer("purchase_receipt_counters",
    { year: 2026, next_number: 2 })];
  /*
   * EIN EINKAUF MIT ALLEN VORGESEHENEN FELDERN — und ohne die
   * ausgeschlossenen. `GEHEIM.sender` steht bewusst NICHT darin: `sender_name`
   * ist ausgeschlossen, und der Prüffall „ausgeschlossenes Feld ist trotzdem
   * da" setzt es unten gezielt.
   */
  data.purchases = [zeileFuer("purchases", { id: 105, total_cost: "13.00" })];

  const counts: Record<string, number> = {};
  for (const [k, v] of Object.entries(data)) counts[k] = v.length;

  return {
    format: "skyisles-business-backup",
    format_version: 1,
    created_at: "2026-10-16T13:00:00+00:00",
    source_project: "qqxcpesbwfxzgytkdsac",
    commerce_mode: "sandbox",
    seller_legal_name: "Julian Stocker",
    snapshot_txid: "100:100:",
    counts,
    inventory_units: 42,
    buy_in_factor: GEHEIM.faktor,
    contains_personal_data: true,
    restore_supported: false,
    data,
  };
}

/** Die Baseline, die zu diesem erfundenen Dokument passt. */
function baselineFuer(doc: ReturnType<typeof dokument>): ExportBaseline {
  const belege = doc.data.purchase_receipts as Record<string, unknown>[];
  const summe = Object.values(doc.data as Record<string, unknown[]>)
    .reduce((n, l) => n + l.length, 0);
  return {
    source: "Prüffall",
    areaKeys: BACKUP_SECTIONS.map((s) => s.key),
    areas: BACKUP_SECTIONS.length,
    totalRecords: summe,
    counts: {
      purchase_receipts: belege.length,
      purchase_receipt_downloads: (doc.data.purchase_receipt_downloads as unknown[]).length,
      purchase_receipt_counters: 1,
    },
    receipts: belege.map((r) => ({
      number: String(r.receipt_number),
      revision: Number(r.revision),
      lines: (r.lines as unknown[]).length,
      supersedes: r.supersedes_number === null ? null : String(r.supersedes_number),
    })),
    fieldPlan: PLAN.plan,
    fingerprintDigest: md5(belege.map((r) => `${r.id}:${r.content_fingerprint}`).join("|")),
    chainDigest: md5(belege
      .map((r) => `${r.id}:${r.revision}:${r.supersedes_id ?? "-"}`).join("|")),
    linesDigest: "(aus JSON nicht reproduzierbar)",
  };
}

/* ==========================================================================
 * 1. Sie rechnet richtig
 * ======================================================================== */

describe("ein stimmiges Dokument geht glatt durch", () => {
  const doc = dokument();
  const ergebnis = auditBackup(doc, baselineFuer(doc));

  it("keine Abweichung", () => {
    expect(ergebnis.findings.filter((f) => !f.ok)).toEqual([]);
    expect(ergebnis.failed).toBe(0);
  });

  it("alle 28 Bereiche gezählt", () => {
    expect(Object.keys(ergebnis.areaCounts)).toHaveLength(28);
    expect(ergebnis.areaCounts.purchase_receipts).toBe(2);
    expect(ergebnis.areaCounts.purchase_receipt_downloads).toBe(2);
  });

  it("die Kette ist auf das Nachprüfbare reduziert", () => {
    expect(ergebnis.chain).toHaveLength(2);
    expect(ergebnis.chain[0]).toMatchObject({
      number: "SI-E-2026-000001", revision: 1, lines: 2, supersedes: null,
      isCurrent: false, downloads: 1, formatVersion: 2,
    });
    expect(ergebnis.chain[1]).toMatchObject({
      number: "SI-E-2026-000002", revision: 2, lines: 3,
      supersedes: "SI-E-2026-000001", isCurrent: true, downloads: 1,
    });
    /* SKY-IDs ja, Namen nein — ein Figurenname ist Belegsnapshot. */
    expect(ergebnis.chain[1].skyIds).toBe("SKY-0008,SKY-0349,SKY-0115");
    expect(JSON.stringify(ergebnis.chain)).not.toContain("Legendary");
  });
});

describe("eine Abweichung fällt da auf, wo sie liegt", () => {
  const fehler = (doc: ReturnType<typeof dokument>, basis: ExportBaseline) =>
    auditBackup(doc, basis).findings.filter((f) => !f.ok).map((f) => f.label);

  it("eine fehlende Belegfassung", () => {
    const voll = dokument();
    const basis = baselineFuer(voll);
    const kurz = dokument({ receipts: [beleg()] });
    expect(fehler(kurz, basis)).toContain("Anzahl Belege");
    expect(fehler(kurz, basis)).toContain("Beleg SI-E-2026-000002");
  });

  it("eine veränderte Positionszahl", () => {
    const doc = dokument();
    const basis = baselineFuer(doc);
    const manipuliert = dokument();
    (manipuliert.data.purchase_receipts as Record<string, unknown>[])[1].lines =
      [{ position: 1, sky_id: "SKY-0008", condition: "loose" }];
    expect(fehler(manipuliert, basis)).toContain("SI-E-2026-000002: Positionen");
  });

  it("ein verbogener Fingerabdruck", () => {
    const doc = dokument();
    const basis = baselineFuer(doc);
    const manipuliert = dokument();
    (manipuliert.data.purchase_receipts as Record<string, unknown>[])[0]
      .content_fingerprint = "c".repeat(64);
    expect(fehler(manipuliert, basis)).toContain("Fingerabdruck-Prüfsumme");
  });

  it("eine gekappte Kette", () => {
    const doc = dokument();
    const basis = baselineFuer(doc);
    const manipuliert = dokument();
    (manipuliert.data.purchase_receipts as Record<string, unknown>[])[1]
      .supersedes_id = 99;
    const labels = fehler(manipuliert, basis);
    expect(labels).toContain("jeder Verweis zeigt auf einen Beleg in der Datei");
    expect(labels).toContain("Ketten-Prüfsumme");
  });

  it("zwei aktuelle Fassungen", () => {
    const doc = dokument();
    const basis = baselineFuer(doc);
    const manipuliert = dokument();
    (manipuliert.data.purchase_receipts as Record<string, unknown>[])[1]
      .supersedes_id = null;
    (manipuliert.data.purchase_receipts as Record<string, unknown>[])[1]
      .supersedes_number = null;
    expect(fehler(manipuliert, basis)).toContain("genau eine aktuelle Fassung");
  });

  it("ein fehlender Bereich", () => {
    const doc = dokument();
    const basis = baselineFuer(doc);
    const manipuliert = dokument();
    delete (manipuliert.data as Record<string, unknown>).sale_fees;
    const labels = fehler(manipuliert, basis);
    expect(labels).toContain("Anzahl Bereiche");
    expect(labels).toContain("kein Bereich des Manifests fehlt");
  });

  it("eine Kontoidentität in der Datei", () => {
    const doc = dokument();
    const basis = baselineFuer(doc);
    const manipuliert = dokument();
    (manipuliert.data.purchase_receipts as Record<string, unknown>[])[0].issued_by =
      "00000000-0000-0000-0000-000000000000";
    expect(fehler(manipuliert, basis)).toContain("keine Kontoidentität im Belegbereich");
  });

  it("und ein Widerspruch zwischen counts und den Listen", () => {
    const doc = dokument();
    const basis = baselineFuer(doc);
    const manipuliert = dokument();
    (manipuliert.counts as Record<string, number>).purchase_receipts = 99;
    expect(fehler(manipuliert, basis)).toContain("counts stimmt mit den Listen überein");
  });
});

/* ==========================================================================
 * 2. Sie gibt nichts heraus
 * ======================================================================== */

describe("der Bericht trägt keine personenbezogenen Daten", () => {
  const doc = dokument();
  const ausgabe = report(auditBackup(doc, baselineFuer(doc)), baselineFuer(doc)).join("\n");

  for (const [was, wert] of Object.entries(GEHEIM)) {
    it(`${was} erscheint nicht`, () => {
      expect(ausgabe).not.toContain(wert);
    });
  }

  it("auch kein Figurenname aus dem Snapshot", () => {
    expect(ausgabe).not.toContain("Legendary Bash");
    expect(ausgabe).not.toContain("Spyro");
  });

  it("aber die Zahlen, Nummern und SKY-IDs schon", () => {
    expect(ausgabe).toContain("SI-E-2026-000001");
    expect(ausgabe).toContain("SKY-0008");
    expect(ausgabe).toContain("purchase_receipts");
    expect(ausgabe).toContain("ERGEBNIS: 0 Abweichungen.");
  });

  it("und der Buy-in-Faktor nicht — auch nicht als Zahl", () => {
    expect(ausgabe).not.toContain(GEHEIM.faktor);
    expect(ausgabe).not.toContain("buy_in_factor");
  });
});

/* ==========================================================================
 * 3. Die eingetragene Staging-Baseline
 * ======================================================================== */

describe("die Staging-Baseline ist die gemeldete", () => {
  /*
   * DIE BEREICHSLISTE IST DATEN UND KEIN IMPORT — damit das Werkzeug mit dem
   * TypeScript-Lader von Node läuft. Hier wird sie gegen die Quelle gehalten:
   * driftet eines von beidem, fällt dieser Test.
   */
  it("ihre Bereichsliste ist genau die des Manifests", () => {
    expect([...STAGING_BASELINE.areaKeys].sort())
      .toEqual(BACKUP_SECTIONS.map((s) => s.key).sort());
    expect(STAGING_BASELINE.areaKeys).toHaveLength(STAGING_BASELINE.areas);
  });

  it("28 Bereiche, 5508 Datensätze", () => {
    expect(STAGING_BASELINE.areas).toBe(28);
    expect(STAGING_BASELINE.totalRecords).toBe(5508);
  });

  it("90 Einkäufe, 2128 Positionen, 2 Belege, 7 Abrufe, 1 Zählerzeile", () => {
    expect(STAGING_BASELINE.counts).toEqual({
      purchases: 90, purchase_items: 2128, purchase_receipts: 2,
      purchase_receipt_downloads: 7, purchase_receipt_counters: 1,
    });
  });

  it("die Kette: Revision 1 mit 2 Positionen, Revision 2 mit 3 und Verweis", () => {
    expect(STAGING_BASELINE.receipts).toEqual([
      { number: "SI-E-2026-000001", revision: 1, lines: 2, supersedes: null },
      { number: "SI-E-2026-000002", revision: 2, lines: 3,
        supersedes: "SI-E-2026-000001" },
    ]);
  });

  it("und die drei Prüfsummen, wie gemeldet", () => {
    expect(STAGING_BASELINE.fingerprintDigest).toBe("ad7d01f4ff1284cfb0a6ee1b6f38c67f");
    expect(STAGING_BASELINE.linesDigest).toBe("51038e7a609451f1278cdc1c08ff8324");
    expect(STAGING_BASELINE.chainDigest).toBe("15b5e634f3f5fa7b2c1f88acc67d4f91");
  });

  it("die Positionslisten-Prüfsumme wird NICHT aus der Datei nachgerechnet", () => {
    /*
     * `md5(id:lines::text)` hängt an der Textform von `jsonb` und ist aus JSON
     * nicht nachbildbar. Statt eines Vergleichs, der zufällig scheitern würde,
     * berichtet die Prüfung eine kanonische Summe — und sagt, dass sie keinen
     * Gegenwert hat.
     */
    const doc = dokument();
    const basis = { ...baselineFuer(doc), canonicalLinesDigest: undefined };
    const ergebnis = auditBackup(doc, basis);
    const zeile = ergebnis.findings.find((f) => f.label.includes("kanonische"));
    expect(zeile?.ok).toBe(true);
    expect(zeile?.label).toContain("ohne Gegenwert");
    expect(zeile?.detail).toMatch(/^[0-9a-f]{32}$/);
  });
});

/* ==========================================================================
 * 4. Das Werkzeug
 * ======================================================================== */

describe("das Werkzeug liest eine Datei und sonst nichts", () => {
  it("kein Datenbankzugriff, kein Netz, kein Schlüssel", () => {
    /*
     * GEPRÜFT WIRD DER ZUGRIFF, NICHT DAS WORT. Vorher stand „supabase" in
     * dieser Liste, und das Werkzeug liest seit dem Feldabgleich den Pfad
     * `supabase/migrations` — eine Datei zu lesen IST sein Zweck. Verboten
     * bleibt, was eine Verbindung aufbaut oder einen Schlüssel braucht.
     */
    for (const verboten of ["createClient", "@supabase/supabase-js", "SERVICE_ROLE",
                            ".rpc(", "fetch(", "process.env.NEXT_PUBLIC",
                            "--env-file", "SUPABASE_URL"]) {
      expect(TOOL, verboten).not.toContain(verboten);
    }
  });

  it("und es liest nur aus dem Projekt, was zur ERWARTUNG gehört", () => {
    /* Zwei Quellen für den Plan: das Manifest und die letzte Migration mit
       der Exportfunktion. Die zu prüfende Datei kommt von außen. */
    expect(TOOL).toContain('from "../src/lib/backup/manifest.ts"');
    expect(TOOL).toContain("supabase/migrations");
    expect(TOOL).toContain("create or replace function public.seller_business_backup()");
  });

  it("es schreibt nichts", () => {
    for (const verboten of ["writeFileSync", "appendFileSync", "mkdirSync",
                            "unlinkSync", "rmSync"]) {
      expect(TOOL, verboten).not.toContain(verboten);
    }
  });

  it("und es weigert sich, eine Sicherung im Projektordner zu lesen", () => {
    expect(TOOL).toContain("relative(process.cwd(), absolut)");
    expect(TOOL).toContain("die Datei liegt im Arbeitsverzeichnis des Projekts");
    expect(TOOL).toContain("process.exit(2)");
  });

  it("der Rückgabewert unterscheidet bestanden von nicht bestanden", () => {
    expect(TOOL).toContain("process.exit(ergebnis.failed === 0 ? 0 : 1)");
  });

  it("der kanonische Dateiname bleibt in .gitignore", () => {
    const ignore = readFileSync(".gitignore", "utf8");
    expect(ignore).toContain("skyisles-business-backup-*.json");
  });
});

/* ==========================================================================
 * 5. Der Feldabgleich — drei Quellen, drei Kategorien
 * ======================================================================== */

describe("der Feldplan kommt aus Manifest UND SQL-Rumpf", () => {
  it("der Parser findet alle 28 Bereiche und ihre Felder", () => {
    const imSql = fieldsFromBackupSql(LETZTE_FASSUNG.sql);
    expect(Object.keys(imSql)).toHaveLength(28);
    /* Die Bereichszeile selbst ist kein Feld — sie steht auf sechs
       Leerzeichen, Felder auf zehn. */
    expect(imSql.purchases).not.toContain("purchases");
    expect(imSql.purchases).toContain("id");
    expect(imSql.purchases).toContain("items_cost");
    expect(Object.values(imSql).reduce((n, l) => n + l.length, 0))
      .toBeGreaterThanOrEqual(350);
  });

  it("Manifest und SQL sind sich einig — kein einziger Konflikt", () => {
    expect(PLAN.conflicts).toEqual([]);
    expect(PLAN.plan).toHaveLength(28);
  });

  it("die vier abweichenden JSON-Namen stehen im Plan, nicht die Tabellennamen", () => {
    const schluessel = PLAN.plan.map((p) => p.key);
    for (const [key, source] of [["name_mappings", "orderbook_name_mappings"],
                                 ["monthly_reports", "seller_monthly_reports"],
                                 ["figures", "skylanders"],
                                 ["seller", "sellers"]]) {
      expect(schluessel, key).toContain(key);
      expect(schluessel, source).not.toContain(source);
      /* Die Quelltabelle bleibt im Plan — aber nur als Beschriftung. */
      expect(planFuer(key).source).toBe(source);
    }
  });

  it("ein SQL-Rumpf ohne ein Manifestfeld ist ein Konflikt", () => {
    const kaputt = LETZTE_FASSUNG.sql.replace(
      "          'items_cost', t.items_cost::text,\n", "");
    const { conflicts } = buildFieldPlan(BACKUP_SECTIONS, kaputt);
    expect(conflicts.join(" ")).toContain("purchases: SQL ohne items_cost");
  });

  it("ein SQL-Rumpf mit einem zusätzlichen Feld ebenso", () => {
    const kaputt = LETZTE_FASSUNG.sql.replace(
      "          'items_cost', t.items_cost::text,",
      "          'items_cost', t.items_cost::text,\n          'sender_name', t.sender_name,");
    const { conflicts } = buildFieldPlan(BACKUP_SECTIONS, kaputt);
    expect(conflicts.join(" ")).toContain("purchases: SQL zusätzlich sender_name");
  });

  it("ein fehlender Bereich im Rumpf auch", () => {
    const { conflicts } = buildFieldPlan(BACKUP_SECTIONS, "-- leer");
    expect(conflicts).toHaveLength(28);
    expect(conflicts[0]).toContain("im SQL-Rumpf nicht gefunden");
  });

  it("und ein Bereich, den das Manifest nicht kennt", () => {
    const { conflicts } = buildFieldPlan(
      BACKUP_SECTIONS.filter((s) => s.key !== "series"), LETZTE_FASSUNG.sql);
    expect(conflicts.join(" ")).toContain("series: im SQL-Rumpf, aber in keinem Bereich");
  });

  it("das Werkzeug bricht bei einem Konflikt ab, OHNE die Datei zu prüfen", () => {
    expect(TOOL).toContain("Manifest und SQL-Rumpf sind sich nicht einig");
    expect(TOOL).toContain("Die Datei wurde NICHT geprüft");
    const stelle = TOOL.indexOf("buildFieldPlan");
    expect(stelle).toBeLessThan(TOOL.indexOf("auditBackup("));
  });
});

describe("drei Kategorien, strikt getrennt", () => {
  const labels = (doc: ReturnType<typeof dokument>, basis: ExportBaseline) =>
    auditBackup(doc, basis).findings.filter((f) => !f.ok).map((f) => f.label);

  it("ein vollständiges Dokument hat in allen 28 Bereichen keinen Befund", () => {
    const doc = dokument();
    const ergebnis = auditBackup(doc, baselineFuer(doc));
    expect(ergebnis.fieldReports).toHaveLength(28);
    for (const r of ergebnis.fieldReports) {
      expect(r.missing, r.key).toEqual([]);
      expect(r.unexpected, r.key).toEqual([]);
      expect(r.excludedButPresent, r.key).toEqual([]);
    }
    expect(ergebnis.failed).toBe(0);
  });

  /* ---- FEHLEND: je ein neues Feld aus 0130/0131 gezielt entfernen ---- */
  for (const [bereich, feld] of [
    ["purchases", "items_cost"], ["purchases", "shipping_cost"],
    ["purchases", "buyer_protection_cost"], ["purchases", "payment_method"],
    ["purchases", "platform"], ["purchases", "seller_name"],
    ["sales", "sale_day"], ["order_reservations", "sale_item_id"],
    ["order_refunds", "requested_at"], ["order_refunds", "settled_at"],
    ["order_refunds", "provider_status"], ["order_refunds", "failure_code"],
    ["figures", "category_id"], ["figures", "is_active"], ["figures", "source"],
    ["series", "position"], ["categories", "position"], ["shop_settings", "id"],
    ["seller", "is_active"], ["seller", "register_court"], ["seller", "w_id"],
    ["seller", "dispatch_statement"], ["seller", "return_postage_borne_by"],
    ["purchase_receipts", "supersedes_number"],
    ["purchase_receipts", "content_fingerprint"],
    ["purchase_receipt_counters", "next_number"],
  ] as const) {
    it(`FEHLEND: ${bereich} ohne ${feld}`, () => {
      const doc = dokument();
      const basis = baselineFuer(doc);
      const manipuliert = dokument();
      const zeilen = manipuliert.data[bereich] as Record<string, unknown>[];
      /* Der Bereich braucht mindestens eine Zeile, sonst sagt die Datei über
         seine Felder nichts — genau das prüft der Block darunter. */
      if (zeilen.length === 0) zeilen.push(zeileFuer(bereich));
      for (const z of zeilen) delete z[feld];
      const ergebnis = auditBackup(manipuliert, basis);
      const bericht = ergebnis.fieldReports.find((r) => r.key === bereich)!;
      expect(bericht.missing).toContain(feld);
      expect(bericht.unexpected).toEqual([]);
      expect(ergebnis.findings.filter((f) => !f.ok).map((f) => f.label))
        .toContain("kein vorgesehenes Feld fehlt");
    });
  }

  it("UNERWARTET: ein Feld, das der Plan nicht kennt", () => {
    const doc = dokument();
    const basis = baselineFuer(doc);
    const manipuliert = dokument();
    (manipuliert.data.purchases as Record<string, unknown>[])[0].erfunden = 1;
    const bericht = auditBackup(manipuliert, basis).fieldReports
      .find((r) => r.key === "purchases")!;
    expect(bericht.unexpected).toEqual(["erfunden"]);
    expect(bericht.excludedButPresent).toEqual([]);
    expect(labels(manipuliert, basis)).toContain("kein unerwartetes Feld");
  });

  /*
   * AUSGESCHLOSSEN UND TROTZDEM DA — der schwerste der drei Befunde.
   *
   * Ein Ausschluss hat einen Grund, und bei `sender_name` ist der Grund
   * Datenschutz. Er bekommt deshalb eine eigene Kategorie und eine eigene
   * Zeile: wer das findet, hat ein anderes Problem als wer ein unbekanntes
   * Feld findet.
   */
  for (const feld of ["sender_name", "sender_street", "listing_url",
                      "agreement_note", "client_token", "daily_index"]) {
    it(`AUSGESCHLOSSEN: purchases trägt ${feld}`, () => {
      const doc = dokument();
      const basis = baselineFuer(doc);
      const manipuliert = dokument();
      (manipuliert.data.purchases as Record<string, unknown>[])[0][feld] = "x";
      const ergebnis = auditBackup(manipuliert, basis);
      const bericht = ergebnis.fieldReports.find((r) => r.key === "purchases")!;
      expect(bericht.excludedButPresent).toContain(feld);
      /* NICHT als „unerwartet" gezählt — die Kategorien überschneiden sich nicht. */
      expect(bericht.unexpected).toEqual([]);
      expect(ergebnis.findings.filter((f) => !f.ok).map((f) => f.label))
        .toContain("kein ausdrücklich ausgeschlossenes Feld");
    });
  }

  it("auch issued_by im Belegbereich fällt in diese Kategorie", () => {
    const doc = dokument();
    const basis = baselineFuer(doc);
    const manipuliert = dokument();
    (manipuliert.data.purchase_receipts as Record<string, unknown>[])[0].issued_by = "u";
    const ergebnis = auditBackup(manipuliert, basis);
    const bericht = ergebnis.fieldReports.find((r) => r.key === "purchase_receipts")!;
    expect(bericht.excludedButPresent).toEqual(["issued_by"]);
  });
});

describe("leere Bereiche beweisen keine Vollständigkeit", () => {
  it("ein Bereich ohne Zeile wird NICHT als fehlend gemeldet", () => {
    const doc = dokument();
    const basis = baselineFuer(doc);
    /* `sale_fees` ist im Prüffall leer — wie die meisten Bereiche eines
       jungen Betriebs. */
    const bericht = auditBackup(doc, basis).fieldReports
      .find((r) => r.key === "sale_fees")!;
    expect(bericht.observed).toBe(0);
    expect(bericht.missing).toEqual([]);
  });

  it("aber er wird als nicht beobachtbar AUSGEWIESEN", () => {
    const doc = dokument();
    const ergebnis = auditBackup(doc, baselineFuer(doc));
    const zeile = ergebnis.findings
      .find((f) => f.label.includes("Bereiche ohne Zeile"))!;
    expect(zeile).toBeDefined();
    const leer = ergebnis.fieldReports.filter((r) => r.observed === 0).length;
    expect(zeile.detail).toBe(`${leer} von 28`);
    expect(leer).toBeGreaterThan(20);
  });

  it("und der Bericht markiert ihn als `leer`, nicht als `ok`", () => {
    const doc = dokument();
    const basis = baselineFuer(doc);
    const ausgabe = report(auditBackup(doc, basis), basis).join("\n");
    expect(ausgabe).toContain("FELDER JE BEREICH");
    expect(ausgabe).toMatch(/leer {2}sale_fees/);
    expect(ausgabe).toMatch(/ok {4}purchases/);
  });

  /*
   * DIE EIGENTLICHE ANTWORT AUF „leere Bereiche".
   *
   * Für einen leeren Bereich sagt die Datei nichts — also muss die Erwartung
   * von woanders kommen. Sie kommt aus Manifest UND SQL, und die beiden
   * werden gegeneinander gehalten, bevor die Datei überhaupt geöffnet wird.
   * Fehlt ein Feld im SQL-Rumpf, fällt es auf, auch wenn der Bereich auf
   * Staging leer ist und es nie eine Zeile gäbe, die es zeigt.
   */
  it("ein im SQL fehlendes Feld fällt auf, auch wenn der Bereich leer ist", () => {
    const kaputt = LETZTE_FASSUNG.sql.replace(
      "          'kind', t.kind,\n", "");
    const { conflicts } = buildFieldPlan(BACKUP_SECTIONS, kaputt);
    expect(conflicts.join(" ")).toContain("sale_fees: SQL ohne kind");
  });
});

/* ==========================================================================
 * Jede Umgebung gegen ihre eigene Baseline
 * ======================================================================== */

/**
 * DER FEHLALARM, DEN DIESER BLOCK VERHINDERT.
 *
 * Die erste Prüfung der Production-Sicherung lief gegen die Staging-Baseline
 * und meldete **zwölf** Abweichungen: 6 152 Datensätze statt 5 508, 88
 * Einkäufe statt 90, 2 142 Positionen statt 2 128, und fünf belegbezogene
 * Zeilen, weil Production **keinen** Eigenbeleg hat und Staging zwei. Jede
 * Zahl war richtig gerechnet, und keine war ein Mangel der Datei.
 *
 * Eine Baseline ist die Messung EINER Umgebung zu EINEM Zeitpunkt. Sie auf
 * eine andere anzuwenden erzeugt Befunde, die man wegerklären muss — und das
 * ist die schlechteste Art von Prüfung: eine, die man zu ignorieren lernt.
 */
describe("zwei Umgebungen, zwei Baselines", () => {
  const LEER = md5("");

  it("die Production-Baseline nennt ihre Quelle und 0 Belege", () => {
    expect(PRODUCTION_BASELINE.source).toContain("zmiwxswrpkmizvqsgype");
    expect(PRODUCTION_BASELINE.source).toContain("0 Eigenbelege");
    expect(PRODUCTION_BASELINE.receipts).toEqual([]);
    expect(PRODUCTION_BASELINE.areas).toBe(28);
    expect(PRODUCTION_BASELINE.totalRecords).toBe(6152);
    expect(PRODUCTION_BASELINE.counts).toEqual({
      purchases: 88, purchase_items: 2142, purchase_receipts: 0,
      purchase_receipt_downloads: 0, purchase_receipt_counters: 0,
    });
  });

  it("und beide Umgebungen führen dieselben 28 Bereiche", () => {
    /* Der Umfang des Exports ist eine Eigenschaft der FUNKTION, nicht der
       Umgebung. Unterschiedlich sind nur die Zahlen. */
    expect(PRODUCTION_BASELINE.areaKeys).toEqual(STAGING_BASELINE.areaKeys);
    expect([...PRODUCTION_BASELINE.areaKeys].sort())
      .toEqual(BACKUP_SECTIONS.map((s) => s.key).sort());
  });

  it("die Belegabdrücke der leeren Menge sind md5 über nichts", () => {
    /* Kein Fingerabdruck von Daten, sondern die Abwesenheit von Daten. */
    expect(PRODUCTION_BASELINE.fingerprintDigest).toBe(LEER);
    expect(PRODUCTION_BASELINE.chainDigest).toBe(LEER);
    expect(PRODUCTION_BASELINE.linesDigest).toBe(LEER);
    expect(PRODUCTION_BASELINE.canonicalLinesDigest).toBe(LEER);
  });

  it("die Zahlen der beiden Umgebungen sind verschieden — darum zwei", () => {
    expect(PRODUCTION_BASELINE.totalRecords)
      .not.toBe(STAGING_BASELINE.totalRecords);
    expect(PRODUCTION_BASELINE.counts.purchases)
      .not.toBe(STAGING_BASELINE.counts.purchases);
    expect(STAGING_BASELINE.receipts.length).toBe(2);
  });

  /* ------------------------------------------------- Zuordnung aus der Datei */

  it("die Baseline kommt aus `source_project` der Datei", () => {
    const stag = { ...dokument(), source_project: "qqxcpesbwfxzgytkdsac" };
    const prod = { ...dokument(), source_project: "zmiwxswrpkmizvqsgype" };
    expect(baselineForDocument(stag)).toBe(STAGING_BASELINE);
    expect(baselineForDocument(prod)).toBe(PRODUCTION_BASELINE);
    expect(Object.keys(BASELINE_JE_PROJEKT).sort())
      .toEqual(["qqxcpesbwfxzgytkdsac", "zmiwxswrpkmizvqsgype"]);
  });

  it("und wird NICHT geraten, wenn das Projekt unbekannt ist", () => {
    /* Eine geratene Baseline sagt nichts über die Datei und alles über die
       Erwartung. Lieber keine Prüfung als eine falsche. */
    expect(baselineForDocument({ ...dokument(), source_project: "fremd" })).toBeNull();
    /* `dokument()` trägt die Staging-Referenz — ohne sie gibt es keine
       Zuordnung und damit keine Prüfung. */
    const ohneProjekt: Record<string, unknown> = { ...dokument() };
    delete ohneProjekt.source_project;
    expect(baselineForDocument(ohneProjekt)).toBeNull();
    expect(baselineForDocument(null)).toBeNull();
    expect(baselineForDocument({ source_project: 42 })).toBeNull();
  });

  it("das Werkzeug ordnet selbst zu und bricht sonst ab", () => {
    expect(TOOL).toContain("baselineForDocument(doc)");
    expect(TOOL).toContain('arg("baseline")');
    expect(TOOL).toContain("Die Datei wurde NICHT geprüft");
    expect(TOOL).toContain("BASELINE:");
  });
});

/* ==========================================================================
 * „Genau eine aktuelle Fassung" — oder gar keine
 * ======================================================================== */

/**
 * Die Prüfung verlangt die Spitze der Korrekturkette. In einer Umgebung ohne
 * Eigenbeleg gibt es keine Kette und keine Spitze; `=== 1` wäre dort
 * unerfüllbar. Ein unerfüllbares Soll ist kein Befund, sondern ein
 * Konstruktionsfehler der Prüfung — Production lief am 2026-10-17 genau in
 * diesen Fall.
 *
 * Abgeschwächt wird dabei nichts: die Ausnahme greift nur, wenn die Baseline
 * **keinen** Beleg erwartet UND die Datei keinen führt.
 */
describe("die Kettenspitze bei null Belegen", () => {
  const fassung = (findings: { label: string; ok: boolean; detail: string }[]) =>
    findings.find((f) => f.label === "genau eine aktuelle Fassung")!;

  const leeresDokument = {
    ...dokument({ receipts: [], downloads: [] }),
    source_project: "zmiwxswrpkmizvqsgype",
  };

  it("ohne Beleg und ohne Erwartung: bestanden, als nicht anwendbar", () => {
    const basis = { ...PRODUCTION_BASELINE, fieldPlan: PLAN.plan,
                    totalRecords: Object.values(
                      leeresDokument.data as Record<string, unknown[]>)
                      .reduce((n, l) => n + l.length, 0),
                    counts: {} };
    const f = fassung(auditBackup(leeresDokument, basis).findings);
    expect(f.ok).toBe(true);
    expect(f.detail).toBe("nicht anwendbar (keine Belege)");
  });

  it("ohne Beleg, aber MIT Erwartung: weiter ein Fehler", () => {
    /* Die Ausnahme darf nicht zur Hintertür werden. Erwartet die Baseline
       Belege und die Datei hat keine, ist das ein Befund. */
    const basis = { ...STAGING_BASELINE, fieldPlan: PLAN.plan,
                    totalRecords: Object.values(
                      leeresDokument.data as Record<string, unknown[]>)
                      .reduce((n, l) => n + l.length, 0),
                    counts: {} };
    const f = fassung(auditBackup(leeresDokument, basis).findings);
    expect(f.ok).toBe(false);
    expect(f.detail).toBe("0");
  });

  it("mit Kette: genau eine Spitze besteht", () => {
    const doc = dokument();
    const f = fassung(auditBackup(doc, baselineFuer(doc)).findings);
    expect(f.ok).toBe(true);
    expect(f.detail).toBe("1");
  });

  it("mit ZWEI Spitzen: fällt — die Prüfung ist nicht aufgeweicht", () => {
    /* Zwei Ursprungsbelege zum selben Einkauf, keiner ersetzt: zwei gültige
       Fassungen. Genau das soll die Prüfung finden. */
    const doc = dokument({
      receipts: [
        beleg(),
        beleg({ id: 2, receipt_number: "SI-E-2026-000002",
                content_fingerprint: "b".repeat(64) }),
      ],
      downloads: [],
    });
    const f = fassung(auditBackup(doc, baselineFuer(doc)).findings);
    expect(f.ok).toBe(false);
    expect(f.detail).toBe("2");
  });

  it("die echte Production-Datei würde damit durchlaufen", () => {
    /* Keine Datei im Test — nur die Rechnung: 0 Belege, 0 Abrufe, 0 Zähler,
       6 152 Datensätze, und die Baseline erwartet genau das. */
    expect(PRODUCTION_BASELINE.counts.purchase_receipts).toBe(0);
    expect(PRODUCTION_BASELINE.receipts).toHaveLength(0);
  });
});
