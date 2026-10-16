/**
 * Eine heruntergeladene Betriebssicherung gegen die Baseline halten.
 *
 * WOFÜR. `0129_postflight.sql` prüft die DEFINITION der Exportfunktion,
 * `0129_export_baseline.sql` liest die Gegenzahlen aus der Datenbank. Was
 * dazwischen fehlt, ist die Datei selbst: ob in ihr steht, was die Datenbank
 * sagt. Diese Datei rechnet das nach.
 *
 * SIE LIEST NUR, UND SIE GIBT WENIG HERAUS.
 *
 * Eine Sicherung trägt Käufernamen, Anschriften, Absenderdaten und
 * Einkaufskosten — genau die drei Klassen, die `docs/SECURITY.md` aus diesem
 * Repository verbannt. Der Bericht dieser Datei besteht deshalb aus **Zahlen,
 * Belegnummern, SKY-IDs und Prüfsummen**, und aus nichts sonst: `report()`
 * baut seine Zeilen aus einer festen Menge von Feldern, nie aus dem Dokument.
 * `export-audit.test.ts` füttert ein Dokument mit Namen und Anschriften und
 * hält fest, dass keine davon im Bericht auftaucht.
 *
 * KEIN DATEIZUGRIFF, KEIN NETZ. Das hier ist reine Logik; das Lesen der Datei
 * macht `tools/verify-backup-export.mts`, damit diese Regeln prüfbar bleiben.
 */
import { createHash } from "node:crypto";

/* -------------------------------------------------------------------------
 * Was aus der Datenbank bekannt ist
 * ---------------------------------------------------------------------- */

/** Eine Fassung der Belegkette, wie die Baseline sie nennt. */
export type BaselineReceipt = {
  number: string;
  revision: number;
  lines: number;
  /** Nummer des ersetzten Belegs, oder `null` beim Ursprung. */
  supersedes: string | null;
};

export type ExportBaseline = {
  /** Woher die Zahlen stammen — steht im Bericht, damit niemand rät. */
  source: string;
  /**
   * Die erwarteten Bereichsschlüssel.
   *
   * ALS DATEN UND NICHT ALS IMPORT. Diese Datei kennt `manifest.ts`
   * absichtlich nicht: `tools/verify-backup-export.mts` läuft mit dem
   * TypeScript-Lader von Node, und der verlangt Dateiendungen in jedem
   * transitiven Import. Eine reine Datenschicht ohne Abhängigkeiten ist dort
   * lauffähig und hier prüfbar — `export-audit.test.ts` hält fest, dass diese
   * Liste genau `BACKUP_SECTIONS` ist. Driftet eines von beidem, fällt der
   * Test, und nicht erst das Werkzeug.
   */
  areaKeys: readonly string[];
  areas: number;
  totalRecords: number;
  /** Nur die Bereiche, deren Zahl die Baseline ausdrücklich genannt hat. */
  counts: Readonly<Record<string, number>>;
  receipts: readonly BaselineReceipt[];
  /** md5 über `id:content_fingerprint`, `|`-verbunden, nach id sortiert. */
  fingerprintDigest: string;
  /** md5 über `id:revision:supersedes_id`, `-` für keinen Vorgänger. */
  chainDigest: string;
  /**
   * md5 über `id:lines::text` aus der Datenbank.
   *
   * AUS DER JSON-DATEI NICHT REPRODUZIERBAR, und das ist keine Schwäche der
   * Prüfung, sondern eine Eigenschaft von JSON: `jsonb::text` setzt Schlüssel
   * in der Speicherreihenfolge und ohne Leerzeichen, `JSON.stringify` in der
   * Einfügereihenfolge des Parsers. Dieselben Daten, andere Bytes. Verglichen
   * wird deshalb die STRUKTUR der Positionsliste, und zusätzlich eine
   * kanonische Prüfsumme, die beide Seiten gleich bilden können (Prüfung 211
   * der Baseline).
   */
  linesDigest: string;
  /** md5 über `id:position:sky_id:condition` je Position — beidseitig bildbar. */
  canonicalLinesDigest?: string;
  /**
   * Der Feldplan je Bereich.
   *
   * Fehlt er, prüft `auditBackup` die Felder NICHT und sagt das in einer
   * Zeile — eine ausgelassene Prüfung soll sichtbar sein, nicht
   * stillschweigend fehlen.
   */
  fieldPlan?: readonly FieldPlanEntry[];
};

/**
 * Die Baseline vom Staging-Lauf.
 *
 * Die Zahlen stammen aus `supabase/checks/0129_export_baseline.sql`, Lauf mit
 * `9999 = 0`. Belegnummern sind STAGING-TESTREFERENZEN; personenbezogene
 * Angaben stehen hier keine, und es gehören auch keine hierher.
 */
export const STAGING_BASELINE: ExportBaseline = {
  source: "0129_export_baseline.sql auf Staging, 9999 = 0",
  /*
   * DIE SCHLÜSSEL DER DATEI — NICHT DIE TABELLENNAMEN.
   *
   * Vier Bereiche heissen in der Datei anders als ihre Quelltabelle:
   * `name_mappings` (orderbook_name_mappings), `monthly_reports`
   * (seller_monthly_reports), `figures` (skylanders) und `seller` (sellers).
   * Der erste Entwurf dieser Liste trug die Tabellennamen, und der Vergleich
   * gegen `Object.keys(data)` meldete vier fehlende und vier unbekannte
   * Bereiche — an einer Datei, die vollkommen in Ordnung war.
   */
  areaKeys: [
    "shop_inventory", "inventory_movements", "purchases", "purchase_items",
    "purchase_receipts", "purchase_receipt_downloads", "purchase_receipt_counters",
    "sales", "sale_items", "sale_fees", "sale_refunds", "settlement_adjustments",
    "name_mappings", "orders", "order_lines", "order_line_events",
    "order_reservations", "order_refunds", "order_refund_allocations",
    "order_legal_snapshots", "invoices", "monthly_reports", "figures",
    "series", "categories", "seller", "shop_settings", "shipping_methods",
  ],
  areas: 28,
  totalRecords: 5508,
  counts: {
    purchases: 90,
    purchase_items: 2128,
    purchase_receipts: 2,
    purchase_receipt_downloads: 7,
    purchase_receipt_counters: 1,
  },
  receipts: [
    { number: "SI-E-2026-000001", revision: 1, lines: 2, supersedes: null },
    { number: "SI-E-2026-000002", revision: 2, lines: 3,
      supersedes: "SI-E-2026-000001" },
  ],
  fingerprintDigest: "ad7d01f4ff1284cfb0a6ee1b6f38c67f",
  chainDigest: "15b5e634f3f5fa7b2c1f88acc67d4f91",
  linesDigest: "51038e7a609451f1278cdc1c08ff8324",
};

/**
 * `md5` über die leere Zeichenkette.
 *
 * Eine Umgebung ohne Eigenbeleg bildet jeden der drei Belegabdrücke über
 * nichts — `string_agg` über keine Zeile ergibt die leere Menge. Der Wert ist
 * deshalb kein Fingerabdruck von Daten, sondern die Abwesenheit von Daten,
 * und der Bericht sagt das auch so.
 */
const DIGEST_DER_LEEREN_MENGE = "d41d8cd98f00b204e9800998ecf8427e";

/**
 * Production, gemessen am 2026-10-17 nach dem Rollout von `0126`–`0131`.
 *
 * WARUM ES EINE ZWEITE BASELINE BRAUCHT, UND ZWAR GENAU SO
 *
 * Die erste Prüfung der Production-Sicherung lief gegen die Staging-Baseline
 * und meldete zwölf Abweichungen — jede davon richtig gerechnet und keine
 * davon ein Mangel der Datei: Production hat 88 Einkäufe statt 90, 2 142
 * Positionen statt 2 128 und **keinen** Eigenbeleg statt zwei. Eine Baseline
 * ist die Messung EINER Umgebung zu EINEM Zeitpunkt; sie auf eine andere
 * anzuwenden erzeugt Fehlalarme, die man dann wegerklären muss. Das ist die
 * schlechteste Art von Prüfung: eine, die man zu ignorieren lernt.
 *
 * Die Zahlen stammen aus zwei voneinander unabhängigen Quellen: der lesenden
 * Zielbestätigung vor dem Rollout (88 / 2 142 / 296 / 284 / 333 / 1 / 1 / 0)
 * und dem Vergleich der beiden Exporte von 23:12Z und 23:35Z, deren 25
 * gemeinsame Bereiche zeilengleich sind — Gesamtsumme 6 152 vor und nach den
 * Migrationen.
 *
 * `receipts: []` ist keine Lücke, sondern der Zustand: die Ausstellung ist auf
 * Datenbankebene gesperrt, Freigabe B ist nicht erteilt, und es gibt auf
 * Production keinen Eigenbeleg.
 */
export const PRODUCTION_BASELINE: ExportBaseline = {
  source: "Production zmiwxswrpkmizvqsgype, 2026-10-17 nach 0126-0131: "
    + "lesende Zielbestaetigung und der Vergleich der Exporte 23:12Z/23:35Z, "
    + "0 Eigenbelege",
  areaKeys: STAGING_BASELINE.areaKeys,
  areas: 28,
  totalRecords: 6152,
  counts: {
    purchases: 88,
    purchase_items: 2142,
    purchase_receipts: 0,
    purchase_receipt_downloads: 0,
    purchase_receipt_counters: 0,
  },
  receipts: [],
  fingerprintDigest: DIGEST_DER_LEEREN_MENGE,
  chainDigest: DIGEST_DER_LEEREN_MENGE,
  linesDigest: DIGEST_DER_LEEREN_MENGE,
  canonicalLinesDigest: DIGEST_DER_LEEREN_MENGE,
};

/** Die Projektreferenzen, wie sie in `source_project` der Datei stehen. */
export const BASELINE_JE_PROJEKT: Readonly<Record<string, ExportBaseline>> = {
  qqxcpesbwfxzgytkdsac: STAGING_BASELINE,
  zmiwxswrpkmizvqsgype: PRODUCTION_BASELINE,
};

/**
 * Welche Baseline zu dieser Datei gehört — entschieden aus der Datei selbst.
 *
 * Die Sicherung trägt `source_project`. Danach zu greifen ist besser als ein
 * Schalter, den man vergessen kann: der Fehlalarm, der diese Funktion
 * veranlasst hat, war genau ein vergessener Schalter. Kennt die Datei kein
 * bekanntes Projekt, gibt es **keine** Vermutung — `null`, und der Aufrufer
 * bricht ab. Eine geratene Baseline ist schlimmer als keine.
 */
export function baselineForDocument(doc: unknown): ExportBaseline | null {
  const projekt = (doc as { source_project?: unknown } | null)?.source_project;
  if (typeof projekt !== "string") return null;
  return BASELINE_JE_PROJEKT[projekt] ?? null;
}

/* -------------------------------------------------------------------------
 * Der Feldplan: was JEDER Bereich führen soll
 * ---------------------------------------------------------------------- */

/**
 * Ein Bereich und die Felder, die er führen muss — und die, die er nicht
 * führen darf.
 *
 * WARUM DAS NICHT AUS DER DATEI ABLEITBAR IST. Ein leerer Bereich hat keine
 * Zeile, und eine Zeile ist die einzige Stelle, an der Feldnamen vorkommen.
 * Wer Vollständigkeit aus den Daten ableitet, hält jeden leeren Bereich für
 * vollständig — und das sind bei einem jungen Betrieb die meisten. Der Plan
 * kommt deshalb aus zwei Quellen, die beide ohne die Datei auskommen:
 * `manifest.ts` (die Entscheidung) und der Rumpf der SQL-Funktion (die
 * Ausführung).
 */
export type FieldPlanEntry = {
  /** Der Schlüssel in der Datei — NICHT der Tabellenname. */
  key: string;
  /** Die Quelltabelle, nur für die Meldung. */
  source: string;
  /** Jedes Feld, das eine Zeile dieses Bereichs tragen muss. */
  expected: readonly string[];
  /** Felder, die das Manifest ausdrücklich auslässt — mit Grund. */
  excluded: readonly string[];
};

/** Die Form, in der das Manifest hier ankommt. Keine Abhängigkeit, nur Daten. */
export type SectionLike = {
  key: string;
  source: string;
  fields: readonly string[];
  excluded?: Readonly<Record<string, string>>;
  denormalised?: readonly { field: string }[];
};

/**
 * Die Felder je Bereich aus dem Rumpf von `seller_business_backup()`.
 *
 * Gelesen wird der Quelltext der Migration, nicht die Datenbank: der Rumpf ist
 * die AUSFÜHRUNG der Entscheidung, und ein Unterschied zwischen ihm und dem
 * Manifest ist selbst ein Befund. `backup-sql.test.ts` prüft dieselbe
 * Übereinstimmung von der anderen Seite.
 *
 * Erkannt wird an der Einrückung: ein Bereich beginnt mit sechs Leerzeichen,
 * seine Felder stehen auf zehn. Das ist keine Spitzfindigkeit, sondern die
 * einzige Form, in der sich der Bereichsschlüssel (`'purchases', coalesce((`)
 * von einem Feld (`'id', t.id`) unterscheiden lässt, ohne SQL zu parsen.
 */
export function fieldsFromBackupSql(sql: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  let aktuell: string | null = null;
  for (const zeile of sql.split("\n")) {
    const bereich = /^ {6}'([a-z_0-9]+)', coalesce\(\($/.exec(zeile);
    if (bereich !== null) {
      aktuell = bereich[1];
      out[aktuell] = [];
      continue;
    }
    if (aktuell === null) continue;
    if (/^ {6}\), '\[\]'::jsonb\),?$/.test(zeile)) { aktuell = null; continue; }
    const feld = /^ {10}'([a-z_0-9]+)',/.exec(zeile);
    if (feld !== null) out[aktuell].push(feld[1]);
  }
  return out;
}

/**
 * Den Plan bauen — und dabei prüfen, dass die zwei Quellen sich einig sind.
 *
 * Weichen Manifest und SQL voneinander ab, ist das der erste Befund, und zwar
 * bevor die Datei überhaupt gelesen wird: dann beschreibt die Entscheidung
 * etwas anderes als die Ausführung, und welche von beiden in der Datei steht,
 * ist Glückssache.
 */
export function buildFieldPlan(
  sections: readonly SectionLike[], sql: string,
): { plan: FieldPlanEntry[]; conflicts: string[] } {
  const imSql = fieldsFromBackupSql(sql);
  const plan: FieldPlanEntry[] = [];
  const conflicts: string[] = [];

  for (const s of sections) {
    const erwartet = [
      ...s.fields,
      ...(s.denormalised ?? []).map((d) => d.field),
    ];
    const sqlFelder = imSql[s.key];
    if (sqlFelder === undefined) {
      conflicts.push(`${s.key}: im SQL-Rumpf nicht gefunden`);
    } else {
      const fehlt = erwartet.filter((f) => !sqlFelder.includes(f));
      const zuviel = sqlFelder.filter((f) => !erwartet.includes(f));
      if (fehlt.length > 0) conflicts.push(`${s.key}: SQL ohne ${fehlt.join(", ")}`);
      if (zuviel.length > 0) conflicts.push(`${s.key}: SQL zusätzlich ${zuviel.join(", ")}`);
    }
    plan.push({
      key: s.key, source: s.source,
      expected: erwartet,
      excluded: Object.keys(s.excluded ?? {}),
    });
  }

  for (const key of Object.keys(imSql)) {
    if (!sections.some((s) => s.key === key)) {
      conflicts.push(`${key}: im SQL-Rumpf, aber in keinem Bereich des Manifests`);
    }
  }
  return { plan, conflicts };
}

/* -------------------------------------------------------------------------
 * Was in der Datei steht
 * ---------------------------------------------------------------------- */

/** Nur die Felder, die diese Prüfung anfasst. Alles andere bleibt ungelesen. */
type ReceiptRow = {
  id?: unknown;
  receipt_number?: unknown;
  revision?: unknown;
  supersedes_id?: unknown;
  supersedes_number?: unknown;
  supersedes_issued_at?: unknown;
  content_fingerprint?: unknown;
  format_version?: unknown;
  lines?: unknown;
};

export type Finding = {
  /** `true` heißt bestanden. */
  ok: boolean;
  label: string;
  /** Kurz und zahlenhaft. Niemals ein Feld aus dem Dokument. */
  detail: string;
};

/**
 * Der Feldbefund je Bereich — drei Kategorien, strikt getrennt.
 *
 * `missing`      der Plan verlangt das Feld, keine Zeile trägt es.
 * `unexpected`   eine Zeile trägt ein Feld, das der Plan nicht kennt.
 * `excludedButPresent`  das Manifest lässt es ausdrücklich aus, und es ist
 *                trotzdem da. Das ist der schwerste der drei: ein Ausschluss
 *                hat einen Grund, und oft ist der Grund Datenschutz.
 * `observed`     wie viele Zeilen überhaupt angesehen wurden. `0` heißt: der
 *                Bereich ist leer, und über seine Felder sagt die DATEI
 *                nichts — nur Manifest und SQL.
 */
export type FieldReport = {
  key: string;
  source: string;
  observed: number;
  missing: string[];
  unexpected: string[];
  excludedButPresent: string[];
};

export type AuditResult = {
  findings: Finding[];
  /** Bereichsname → Zeilenzahl, aus der Datei gezählt. */
  areaCounts: Record<string, number>;
  /** Je Bereich der Feldbefund. Leer, wenn die Baseline keinen Plan trägt. */
  fieldReports: FieldReport[];
  /** Die Kette, auf das Nachprüfbare reduziert. */
  chain: {
    number: string;
    revision: number;
    lines: number;
    supersedes: string | null;
    isCurrent: boolean;
    downloads: number;
    skyIds: string;
    formatVersion: number;
  }[];
  failed: number;
};

const md5 = (text: string): string =>
  createHash("md5").update(text, "utf8").digest("hex");

const zahl = (v: unknown): number => Number(v ?? 0);
const text = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

/** Die Positionsliste eines Belegs, auf Nummer, SKY-ID und Ausführung reduziert. */
function lineKeys(lines: unknown): string[] {
  if (!Array.isArray(lines)) return [];
  return lines.map((l) => {
    const row = l as Record<string, unknown>;
    return `${zahl(row.position)}:${text(row.sky_id) || "-"}:${text(row.condition) || "-"}`;
  });
}

/**
 * Die Datei gegen die Baseline halten.
 *
 * Reihenfolge der Prüfungen: erst die Form des Dokuments, dann die Bereiche,
 * dann die Belegkette, dann die Prüfsummen. Ein fehlender Bereich soll vor der
 * Kette auffallen, nicht danach.
 */
export function auditBackup(
  doc: unknown, baseline: ExportBaseline = STAGING_BASELINE,
): AuditResult {
  const findings: Finding[] = [];
  const add = (ok: boolean, label: string, detail: string) =>
    findings.push({ ok, label, detail });

  const root = (doc ?? {}) as Record<string, unknown>;
  const data = (root.data ?? {}) as Record<string, unknown>;

  /* ---- 1. die Form ------------------------------------------------- */
  add(root.format === "skyisles-business-backup", "Formatname",
      text(root.format) || "(fehlt)");
  add(zahl(root.format_version) === 1, "Formatversion",
      text(root.format_version) || "(fehlt)");
  add(root.restore_supported === false, "restore_supported ist false",
      text(root.restore_supported));
  add(root.contains_personal_data === true, "als personenbezogen gekennzeichnet",
      text(root.contains_personal_data));
  add(typeof root.snapshot_txid === "string" && text(root.snapshot_txid) !== "",
      "snapshot_txid vorhanden", text(root.snapshot_txid) === "" ? "(fehlt)" : "gesetzt");
  add(typeof root.created_at === "string", "created_at vorhanden",
      typeof root.created_at === "string" ? "gesetzt" : "(fehlt)");

  /* ---- 2. die Bereiche --------------------------------------------- */
  const areaCounts: Record<string, number> = {};
  for (const [key, value] of Object.entries(data)) {
    areaCounts[key] = Array.isArray(value) ? value.length : -1;
  }
  const schluessel = Object.keys(areaCounts).sort();
  const erwartet = [...baseline.areaKeys].sort();

  add(schluessel.length === baseline.areas, "Anzahl Bereiche",
      `${schluessel.length} von ${baseline.areas}`);
  const fehlend = erwartet.filter((k) => !schluessel.includes(k));
  const zusatz = schluessel.filter((k) => !erwartet.includes(k));
  add(fehlend.length === 0, "kein Bereich des Manifests fehlt",
      fehlend.length === 0 ? "keiner" : fehlend.join(", "));
  add(zusatz.length === 0, "kein unbekannter Bereich",
      zusatz.length === 0 ? "keiner" : zusatz.join(", "));
  const keinArray = Object.entries(areaCounts)
    .filter(([, n]) => n < 0).map(([k]) => k);
  add(keinArray.length === 0, "jeder Bereich ist eine Liste",
      keinArray.length === 0 ? "alle" : keinArray.join(", "));

  const summe = Object.values(areaCounts).reduce((n, v) => n + Math.max(v, 0), 0);
  add(summe === baseline.totalRecords, "Summe aller Datensätze",
      `${summe} erwartet ${baseline.totalRecords}`);

  for (const [bereich, n] of Object.entries(baseline.counts)) {
    add(areaCounts[bereich] === n, `Bereich ${bereich}`,
        `${areaCounts[bereich] ?? "(fehlt)"} erwartet ${n}`);
  }

  /*
   * UND `counts` IM DOKUMENT MUSS ZU DEN LISTEN PASSEN.
   *
   * Die Route bildet `counts` aus denselben Listen — eine Abweichung hiesse,
   * dass die Datei sich selbst widerspricht.
   */
  const counts = (root.counts ?? {}) as Record<string, unknown>;
  const widerspruch = Object.entries(areaCounts)
    .filter(([k, n]) => zahl(counts[k]) !== n).map(([k]) => k);
  add(widerspruch.length === 0, "counts stimmt mit den Listen überein",
      widerspruch.length === 0 ? "alle" : widerspruch.join(", "));

  /* ---- 2b. die Felder, Bereich für Bereich ------------------------- */
  /*
   * DREI QUELLEN, UND DIE DATEI IST DIE SCHWÄCHSTE.
   *
   * Der Plan kommt aus Manifest und SQL-Rumpf; die Datei kann ihn nur
   * BESTÄTIGEN, und bei einem leeren Bereich nicht einmal das. Deshalb steht
   * die Zeilenzahl in jedem Befund daneben: „keine Abweichung bei 0 Zeilen"
   * ist keine Aussage über Vollständigkeit, und sie soll auch nicht wie eine
   * aussehen.
   */
  const fieldReports: FieldReport[] = [];
  if (baseline.fieldPlan === undefined) {
    add(true, "Feldabgleich übersprungen (kein Plan in der Baseline)", "—");
  } else {
    let leer = 0;
    for (const eintrag of baseline.fieldPlan) {
      const zeilen = Array.isArray(data[eintrag.key])
        ? (data[eintrag.key] as unknown[]) : [];
      /* Die Vereinigung aller Schlüssel: ein Feld darf in einer Zeile fehlen,
         wenn es dort `null` wäre — aber nicht in allen. */
      const gesehen = new Set<string>();
      for (const zeile of zeilen) {
        if (zeile === null || typeof zeile !== "object") continue;
        for (const k of Object.keys(zeile as object)) gesehen.add(k);
      }
      const bericht: FieldReport = {
        key: eintrag.key, source: eintrag.source, observed: zeilen.length,
        missing: zeilen.length === 0
          ? [] : eintrag.expected.filter((f) => !gesehen.has(f)),
        unexpected: [...gesehen].filter((f) => !eintrag.expected.includes(f)
                                               && !eintrag.excluded.includes(f)),
        excludedButPresent: [...gesehen].filter((f) => eintrag.excluded.includes(f)),
      };
      fieldReports.push(bericht);
      if (zeilen.length === 0) leer += 1;
    }

    const mitFehlend = fieldReports.filter((r) => r.missing.length > 0);
    add(mitFehlend.length === 0, "kein vorgesehenes Feld fehlt",
        mitFehlend.length === 0 ? "alle Bereiche vollständig"
          : mitFehlend.map((r) => `${r.key}: ${r.missing.join(", ")}`).join(" · "));

    const mitUnerwartet = fieldReports.filter((r) => r.unexpected.length > 0);
    add(mitUnerwartet.length === 0, "kein unerwartetes Feld",
        mitUnerwartet.length === 0 ? "keines"
          : mitUnerwartet.map((r) => `${r.key}: ${r.unexpected.join(", ")}`).join(" · "));

    /*
     * DER SCHWERSTE DER DREI BEFUNDE.
     *
     * Ein Ausschluss hat einen Grund, und bei `sender_name` oder `issued_by`
     * ist der Grund Datenschutz. Er steht deshalb als eigene Zeile und nicht
     * zusammen mit „unerwartet": wer ein ausgeschlossenes Feld in der Datei
     * findet, hat ein anderes Problem als wer ein unbekanntes findet.
     */
    const mitAusgeschlossen = fieldReports.filter((r) => r.excludedButPresent.length > 0);
    add(mitAusgeschlossen.length === 0, "kein ausdrücklich ausgeschlossenes Feld",
        mitAusgeschlossen.length === 0 ? "keines"
          : mitAusgeschlossen.map((r) =>
              `${r.key}: ${r.excludedButPresent.join(", ")}`).join(" · "));

    add(true, "Info: Bereiche ohne Zeile (Felder nur aus Manifest und SQL)",
        `${leer} von ${baseline.fieldPlan.length}`);
  }

  /* ---- 3. die Belegkette ------------------------------------------- */
  const belege = (Array.isArray(data.purchase_receipts)
    ? data.purchase_receipts : []) as ReceiptRow[];
  const abrufe = (Array.isArray(data.purchase_receipt_downloads)
    ? data.purchase_receipt_downloads : []) as Record<string, unknown>[];
  const sortiert = [...belege].sort((a, b) => zahl(a.id) - zahl(b.id));

  const nachId = new Map(sortiert.map((r) => [zahl(r.id), r]));
  const ersetztVon = new Map<number, number>();
  for (const r of sortiert) {
    if (r.supersedes_id !== null && r.supersedes_id !== undefined) {
      ersetztVon.set(zahl(r.supersedes_id), zahl(r.id));
    }
  }

  const chain = sortiert.map((r) => ({
    number: text(r.receipt_number),
    revision: zahl(r.revision),
    lines: Array.isArray(r.lines) ? r.lines.length : 0,
    supersedes: r.supersedes_number === null || r.supersedes_number === undefined
      ? null : text(r.supersedes_number),
    isCurrent: !ersetztVon.has(zahl(r.id)),
    downloads: abrufe.filter((d) => zahl(d.receipt_id) === zahl(r.id)).length,
    skyIds: lineKeys(r.lines).map((k) => k.split(":")[1]).join(","),
    formatVersion: zahl(r.format_version),
  }));

  add(chain.length === baseline.receipts.length, "Anzahl Belege",
      `${chain.length} erwartet ${baseline.receipts.length}`);

  for (const soll of baseline.receipts) {
    const ist = chain.find((c) => c.number === soll.number);
    if (ist === undefined) {
      add(false, `Beleg ${soll.number}`, "fehlt in der Datei");
      continue;
    }
    add(ist.revision === soll.revision, `${soll.number}: Revision`,
        `${ist.revision} erwartet ${soll.revision}`);
    add(ist.lines === soll.lines, `${soll.number}: Positionen`,
        `${ist.lines} erwartet ${soll.lines}`);
    add(ist.supersedes === soll.supersedes, `${soll.number}: Verweis`,
        `${ist.supersedes ?? "(keiner)"} erwartet ${soll.supersedes ?? "(keiner)"}`);
  }

  /* Die Kette selbst: geschlossen, nicht gegabelt, genau eine Spitze. */
  const offeneVerweise = sortiert.filter(
    (r) => r.supersedes_id !== null && r.supersedes_id !== undefined
           && !nachId.has(zahl(r.supersedes_id)));
  add(offeneVerweise.length === 0, "jeder Verweis zeigt auf einen Beleg in der Datei",
      offeneVerweise.length === 0 ? "alle" : `${offeneVerweise.length} offen`);

  const falscheNummer = sortiert.filter((r) => {
    const v = nachId.get(zahl(r.supersedes_id));
    return v !== undefined && text(v.receipt_number) !== text(r.supersedes_number);
  });
  add(falscheNummer.length === 0, "jeder Verweis nennt die Nummer seines Vorgängers",
      falscheNummer.length === 0 ? "alle" : `${falscheNummer.length} falsch`);

  const gabel = new Set<number>();
  const gesehen = new Set<number>();
  for (const r of sortiert) {
    const v = zahl(r.supersedes_id);
    if (r.supersedes_id === null || r.supersedes_id === undefined) continue;
    if (gesehen.has(v)) gabel.add(v);
    gesehen.add(v);
  }
  add(gabel.size === 0, "kein Beleg wird zweimal ersetzt",
      gabel.size === 0 ? "keiner" : `${gabel.size}`);
  /*
   * GENAU EINE AKTUELLE FASSUNG — ODER GAR KEINE.
   *
   * Die Prüfung verlangt die Spitze der Korrekturkette: von mehreren
   * Fassungen eines Belegs ist genau eine die gültige. In einer Umgebung
   * OHNE Eigenbeleg gibt es keine Kette und damit keine Spitze; `=== 1`
   * wäre dort unerfüllbar, und ein unerfüllbares Soll ist kein Befund,
   * sondern ein Konstruktionsfehler der Prüfung. Production lief am
   * 2026-10-17 genau in diesen Fall.
   *
   * Nicht anwendbar heißt: die Baseline erwartet keinen Beleg UND die Datei
   * führt keinen. Erwartet die Baseline Belege und die Datei hat keine,
   * bleibt es ein Fehler — das fängt die Prüfung „Anzahl Belege" weiter
   * oben, und diese hier zählt dann 0 gegen 1.
   */
  const aktuelle = chain.filter((c) => c.isCurrent).length;
  const keineBelege = baseline.receipts.length === 0 && chain.length === 0;
  add(keineBelege || aktuelle === 1, "genau eine aktuelle Fassung",
      keineBelege ? "nicht anwendbar (keine Belege)" : `${aktuelle}`);

  const ohneFingerprint = sortiert.filter(
    (r) => !/^[0-9a-f]{64}$/.test(text(r.content_fingerprint)));
  add(ohneFingerprint.length === 0, "jeder Beleg trägt einen SHA-256-Fingerabdruck",
      ohneFingerprint.length === 0 ? "alle" : `${ohneFingerprint.length} ohne`);

  const leereListe = sortiert.filter((r) => !Array.isArray(r.lines) || r.lines.length === 0);
  add(leereListe.length === 0, "kein Beleg ohne Positionsliste",
      leereListe.length === 0 ? "keiner" : `${leereListe.length}`);

  /*
   * KEINE KONTOIDENTITÄT IN DER DATEI.
   *
   * `issued_by` und `delivered_by` bleiben draußen (Manifest). Geprüft wird
   * das Vorhandensein des SCHLÜSSELS, nicht sein Wert — ein Wert gehörte auch
   * nicht in diesen Bericht.
   */
  const mitKonto = sortiert.filter((r) => "issued_by" in (r as object)).length
    + abrufe.filter((d) => "delivered_by" in d).length;
  add(mitKonto === 0, "keine Kontoidentität im Belegbereich",
      mitKonto === 0 ? "keine" : `${mitKonto} Zeilen`);

  /* ---- 4. die Prüfsummen ------------------------------------------- */
  const fp = md5(sortiert.map((r) => `${zahl(r.id)}:${text(r.content_fingerprint)}`)
    .join("|"));
  add(fp === baseline.fingerprintDigest, "Fingerabdruck-Prüfsumme",
      `${fp} erwartet ${baseline.fingerprintDigest}`);

  const kette = md5(sortiert.map((r) => `${zahl(r.id)}:${zahl(r.revision)}:${
    r.supersedes_id === null || r.supersedes_id === undefined
      ? "-" : zahl(r.supersedes_id)}`).join("|"));
  add(kette === baseline.chainDigest, "Ketten-Prüfsumme",
      `${kette} erwartet ${baseline.chainDigest}`);

  /*
   * DIE POSITIONSLISTEN: STRUKTUR, UND EINE KANONISCHE PRÜFSUMME.
   *
   * Die Prüfsumme der Datenbank ist `md5(id:lines::text)` und aus JSON nicht
   * nachbildbar — siehe `linesDigest`. Was beide Seiten gleich bilden können,
   * ist eine Summe über `position:sky_id:condition`; sie steht als Prüfung 211
   * in der Baseline. Solange die Baseline sie nicht mitbringt, wird sie hier
   * nur BERICHTET und nicht beurteilt.
   */
  const kanonisch = md5(sortiert
    .map((r) => `${zahl(r.id)}:${lineKeys(r.lines).join(",")}`).join("|"));
  if (baseline.canonicalLinesDigest === undefined) {
    add(true, "kanonische Positions-Prüfsumme (ohne Gegenwert, nur Bericht)", kanonisch);
  } else {
    add(kanonisch === baseline.canonicalLinesDigest, "kanonische Positions-Prüfsumme",
        `${kanonisch} erwartet ${baseline.canonicalLinesDigest}`);
  }

  const ohneSky = sortiert.flatMap((r) => lineKeys(r.lines))
    .filter((k) => !/^\d+:SKY-\d{4}:/.test(k)).length;
  add(ohneSky === 0, "jede Belegposition trägt Nummer, SKY-ID und Ausführung",
      ohneSky === 0 ? "alle" : `${ohneSky} ohne`);

  /* ---- 5. der Nummernkreis ----------------------------------------- */
  const zaehler = (Array.isArray(data.purchase_receipt_counters)
    ? data.purchase_receipt_counters : []) as Record<string, unknown>[];
  const hoechste = Math.max(0, ...sortiert
    .map((r) => Number(text(r.receipt_number).slice(10)) || 0));
  const naechste = Math.max(0, ...zaehler.map((c) => zahl(c.next_number)));
  add(naechste >= hoechste, "der Zähler liegt nicht hinter der höchsten Nummer",
      `${naechste} >= ${hoechste}`);

  return {
    findings, areaCounts, fieldReports, chain,
    failed: findings.filter((f) => !f.ok).length,
  };
}

/**
 * Den Bericht bauen — aus Zahlen, Nummern und Prüfsummen.
 *
 * Jede Zeile entsteht aus `Finding` und aus der reduzierten Kette, nie aus
 * dem Dokument. Das ist die Stelle, an der die Datenschutzzusage technisch
 * wird: was `auditBackup` nicht in diese Felder geschrieben hat, kann hier
 * nicht herauskommen.
 */
export function report(result: AuditResult, baseline: ExportBaseline = STAGING_BASELINE):
  string[] {
  const lines: string[] = [];
  lines.push(`Baseline: ${baseline.source}`);
  lines.push("");
  lines.push("BEREICHE");
  for (const [bereich, n] of Object.entries(result.areaCounts).sort()) {
    lines.push(`  ${bereich.padEnd(28)} ${String(n).padStart(6)}`);
  }
  lines.push(`  ${"SUMME".padEnd(28)} ${
    String(Object.values(result.areaCounts).reduce((a, b) => a + Math.max(b, 0), 0))
      .padStart(6)}`);
  lines.push("");
  if (result.fieldReports.length > 0) {
    lines.push("FELDER JE BEREICH   (Zeilen · fehlend · unerwartet · ausgeschlossen)");
    for (const r of result.fieldReports) {
      const auffaellig = r.missing.length + r.unexpected.length
        + r.excludedButPresent.length;
      const marke = auffaellig === 0 ? (r.observed === 0 ? "leer" : "ok  ") : "FEHL";
      lines.push(`  ${marke}  ${r.key.padEnd(28)} ${String(r.observed).padStart(6)}`
        + `  ${String(r.missing.length).padStart(2)}`
        + `  ${String(r.unexpected.length).padStart(2)}`
        + `  ${String(r.excludedButPresent.length).padStart(2)}`
        + (auffaellig === 0 ? "" : `   ${[...r.missing, ...r.unexpected,
                                          ...r.excludedButPresent].join(", ")}`));
    }
    lines.push("");
  }
  lines.push("BELEGKETTE");
  for (const c of result.chain) {
    lines.push(`  ${c.number}  r${c.revision}  f${c.formatVersion}  `
      + `${String(c.lines).padStart(2)} Pos  `
      + `${c.isCurrent ? "aktuell " : "ersetzt "}  `
      + `${c.downloads} Abrufe  `
      + `ersetzt: ${c.supersedes ?? "—"}  [${c.skyIds}]`);
  }
  lines.push("");
  lines.push("PRÜFUNGEN");
  for (const f of result.findings) {
    lines.push(`  ${f.ok ? "ok  " : "FEHL"}  ${f.label.padEnd(52)} ${f.detail}`);
  }
  lines.push("");
  lines.push(result.failed === 0
    ? "ERGEBNIS: 0 Abweichungen."
    : `ERGEBNIS: ${result.failed} Abweichung(en).`);
  return lines;
}
