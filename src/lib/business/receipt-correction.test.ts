/**
 * Korrekturbelege (`0128`) und die Eigenbelege in der Sicherung (`0129`).
 *
 * VIER SCHICHTEN, GETRENNT GEPRÜFT.
 *
 *   1. Der Zeichner wird AUSGEFÜHRT: ein Korrekturdokument trägt Titel,
 *      Vorgängernummer und Vorgängerdatum, in JEDEM Format. Und — die
 *      Zusicherung, an der alles hängt — ein Ursprungsbeleg wird Byte für Byte
 *      gezeichnet wie vorher.
 *   2. `0128` wird als Quelltext geprüft: Tor, Sperre, Fingerabdruckvergleich
 *      vor der Nummernvergabe, Revision, Verweis, Rechte, kein Schreiben an
 *      bestehenden Belegen.
 *   3. `0129` ebenso: drei Bereiche dazu, 25 unverändert, keine
 *      Kontoidentität, kein Schreiben.
 *   4. Die Oberfläche: Historie, „Ersetzt“, zwei Schritte bis zur Ausstellung.
 *
 * Ohne PostgreSQL ist die Quelltextprüfung die einzige ehrliche Form für
 * Schicht 2 und 3. Was nur ein Schreibvorgang zeigt — Nebenläufigkeit, die
 * tatsächliche Ablehnung —, steht in `supabase/checks/0128_test_plan.md`.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { de } from "@/lib/i18n/de";
import { code, latestFunction, migrationSource } from "@/test-support/migrations";
import {
  isCorrection, renderPurchaseReceiptPdf, RECEIPT_FORMATS, type ReceiptDocument,
} from "./purchase-receipt";
import { renderReceiptV1 } from "./receipt-format-v1";
import { renderReceiptV2 } from "./receipt-format-v2";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const latin1 = (b: Uint8Array) => Array.from(b, (x) => String.fromCharCode(x)).join("");
/**
 * Der sichtbare Text eines PDF — mit WinAnsi zurückgerechnet.
 *
 * `latin1()` liest Bytes; der Zeichensatz des Dokuments ist aber WinAnsi, und
 * dort liegt der Halbgeviertstrich auf `0x96`, nicht auf `U+2013`. Ohne diese
 * Rückrechnung sucht ein Test nach „–" und findet `\u0096` — ein Fehlalarm
 * über ein korrekt gezeichnetes Dokument.
 */
const WINANSI: Readonly<Record<string, string>> = {
  "\u0096": "–", "\u0097": "—", "\u0084": "„", "\u0093": "\u201c", "\u0094": "\u201d",
  "\u0092": "’", "\u0085": "…",
};
const textOf = (b: Uint8Array): string =>
  latin1(b).split("\n")
    .map((l) => /^BT \/F[12] [\d.]+ Tf 1 0 0 1 [\d.-]+ [\d.-]+ Tm \((.*)\) Tj ET$/.exec(l))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => m[1].replace(/\\([()\\])/g, "$1"))
    .join("\n")
    .replace(/[\u0084\u0085\u0092\u0093\u0094\u0096\u0097]/g, (c) => WINANSI[c] ?? c);

const M128 = "0128_purchase_receipt_corrections.sql";
const M129 = "0129_business_backup_receipts.sql";
const SQL128 = migrationSource(M128);
const EXEC128 = code(SQL128);
const SQL129 = migrationSource(M129);
const EXEC129 = code(SQL129);
const KORR = code(latestFunction("seller_issue_purchase_receipt_correction").body);
const HIST = code(latestFunction("seller_purchase_receipt_history").body);
const DIALOG = read("src/components/business/purchase-details.tsx");
const ACTIONS = read("src/lib/business/receipt-actions.ts");
const copy = de.business.orderbook.receipt;

/** Ein Ursprungsbeleg — ohne jeden Verweis. */
function original(over: Partial<ReceiptDocument> = {}): ReceiptDocument {
  return {
    id: 1, purchase_id: 105,
    receipt_number: "SI-E-2026-000001",
    issued_at: "2026-10-14T09:00:00+00:00",
    revision: 1, supersedes_id: null,
    format_version: 2,
    buyer_legal_name: "Julian Stocker",
    buyer_trade_name: "yulez.collectibles",
    buyer_street: "Lechhalde 1 1/2",
    buyer_postal_code: "87629",
    buyer_city: "Füssen",
    buyer_country: "Deutschland",
    buyer_email: "yulez.collectibles@example.org",
    buyer_vat_id: "DE321022065",
    seller_platform: "kleinanzeigen",
    seller_handle: null,
    sender_name: "Henry Tester",
    sender_street: "Teststraße 3",
    sender_postal_code: "87688",
    sender_city: "Teststadt",
    sender_country: "Deutschland",
    listing_ref: "3883929383",
    listing_title: null, listing_url: null, listing_details: null,
    purchased_at: "2026-10-12",
    items_cost: 13, shipping_cost: 0, buyer_protection_cost: 0,
    total_cost: 13, currency: "EUR", payment_method: "card",
    agreement_note: null,
    lines: [
      { position: 1, sky_id: "SKY-0008", name: "Legendary Bash", condition: "loose" },
      { position: 2, sky_id: "SKY-0349", name: "Legendary Blades", condition: "sealed" },
    ],
    ...over,
  };
}

/** Dieselbe Sache als Korrektur: Revision 2, Verweis auf den Ursprung. */
const korrektur = (over: Partial<ReceiptDocument> = {}): ReceiptDocument => original({
  id: 2, receipt_number: "SI-E-2026-000002",
  issued_at: "2026-10-16T11:00:00+00:00",
  revision: 2, supersedes_id: 1,
  supersedes_number: "SI-E-2026-000001",
  supersedes_issued_at: "2026-10-14T09:00:00+00:00",
  ...over,
});

/* ==========================================================================
 * 1. Das Dokument sagt, was es ist
 * ======================================================================== */

describe("ein Korrekturbeleg ist als solcher erkennbar", () => {
  it("der Verweis entscheidet, nicht die Revision", () => {
    expect(isCorrection(original())).toBe(false);
    expect(isCorrection(korrektur())).toBe(true);
    /* Halbe Verweise zählen nicht: ohne Datum wird nichts gedruckt, was auf
       ein Datum zeigt. */
    expect(isCorrection(korrektur({ supersedes_issued_at: null }))).toBe(false);
    expect(isCorrection(korrektur({ supersedes_number: null }))).toBe(false);
    expect(isCorrection(korrektur({ supersedes_number: "   " }))).toBe(false);
    /* Und eine Revision ohne Verweis ebenfalls nicht. */
    expect(isCorrection(original({ revision: 2 }))).toBe(false);
  });

  for (const version of RECEIPT_FORMATS) {
    it(`Format ${version}: Titel, Vorgängernummer und -datum stehen drauf`, () => {
      const text = textOf(renderPurchaseReceiptPdf(
        korrektur({ format_version: version })));
      /* Sätze werden umgebrochen — ein Satz über zwei Zeilen ist derselbe
         Satz. Deshalb für die Prosa die geglättete Fassung. */
      const fliess = text.replace(/\s+/g, " ");
      expect(text).toContain("Eigenbeleg – Korrektur");
      expect(text).not.toContain("Eigenbeleg über einen Privatankauf");
      expect(text).toContain("SI-E-2026-000001");
      expect(text).toContain("14.10.2026");
      expect(text).toContain("Revision");
      /* Der Satz, der sagt, was mit dem ersetzten Beleg geschehen ist. */
      expect(fliess).toContain("ersetzt den Eigenbeleg SI-E-2026-000001 vom 14.10.2026");
      expect(fliess).toContain("bleibt unverändert aufbewahrt und wird nicht neu ausgestellt");
      expect(fliess).toContain("Für diesen Ankauf gilt der vorliegende Beleg");
      /* Und keine Behauptung über Gültigkeit. */
      expect(text).not.toContain("gültig");
    });

    it(`Format ${version}: ein Ursprungsbeleg trägt nichts davon`, () => {
      const text = textOf(renderPurchaseReceiptPdf(
        original({ format_version: version })));
      expect(text).toContain("Eigenbeleg über einen Privatankauf");
      expect(text).not.toContain("Korrektur");
      expect(text).not.toContain("Ersetzt Beleg");
      expect(text).not.toContain("Revision");
    });
  }

  /*
   * DIE WICHTIGSTE ZUSICHERUNG DIESER DATEI.
   *
   * Ein ausgestellter Beleg wird bei jedem Abruf neu gezeichnet, und
   * `confirmPurchaseReceiptDownload` vergleicht den SHA-256 der ausgelieferten
   * Bytes gegen dieses neue Rendern. Verschöbe sich ein Ursprungsbeleg um ein
   * Byte, schlüge jeder erneute Abruf als „stimmt nicht mit dem archivierten
   * Beleg überein“ fehl. `receipt-format.test.ts` nagelt zusätzlich Länge und
   * Hash des echten Belegs `SI-E-2026-000001` fest.
   */
  it("die neuen Felder verändern einen Ursprungsbeleg nicht um ein Byte", () => {
    const ohneFelder = original();
    const mitNullFeldern = original({
      supersedes_number: null, supersedes_issued_at: null,
    });
    for (const zeichner of [renderReceiptV1, renderReceiptV2]) {
      expect(latin1(zeichner(mitNullFeldern))).toBe(latin1(zeichner(ohneFelder)));
    }
  });

  it("und ein Korrekturdokument ist länger, nicht anders aufgebaut", () => {
    const a = renderReceiptV2(original());
    const b = renderReceiptV2(korrektur());
    expect(b.byteLength).toBeGreaterThan(a.byteLength);
    expect(latin1(b).startsWith("%PDF-1.4")).toBe(true);
  });
});

/* ==========================================================================
 * 2. 0128 — die Kette
 * ======================================================================== */

describe("0128 stellt eine Korrektur aus, ohne etwas anzufassen", () => {
  it("die zwei Verweisspalten kommen dazu, ohne Default", () => {
    expect(EXEC128).toContain("add column if not exists supersedes_number    text");
    expect(EXEC128).toContain("add column if not exists supersedes_issued_at timestamptz");
    /* Ein Default würde die Tabelle neu schreiben — und das ist der Grund,
       aus dem `0123` genauso vorgegangen ist. */
    expect(EXEC128).not.toMatch(/add column if not exists supersedes_\w+[^;]*default/);
  });

  it("und beide Zusicherungen, geprüft und nicht `not valid`", () => {
    expect(EXEC128).toContain("receipts_supersedes_ref_complete");
    expect(EXEC128).toContain("receipts_supersedes_number_shape");
    expect(EXEC128).toContain("^SI-E-[0-9]{4}-[0-9]{6}$");
    expect(EXEC128).not.toContain("not valid");
    expect(EXEC128).toContain("eine Verweis-Zusicherung ist nicht validiert");
  });

  it("Betreibertor, Sperre und Fingerabdruckvergleich in dieser Reihenfolge", () => {
    const tor = KORR.indexOf("can_operate_active_seller()");
    const sperre = KORR.indexOf("for update");
    const spitze = KORR.indexOf("not exists (select 1 from public.purchase_receipts s");
    const tornummer = KORR.indexOf("nothing changed since the last receipt");
    const zaehler = KORR.indexOf("purchase_receipt_counters");
    expect(tor).toBeGreaterThan(-1);
    expect(tor).toBeLessThan(sperre);
    expect(sperre).toBeLessThan(spitze);
    expect(spitze).toBeLessThan(tornummer);
    /* KEINE NUMMER FÜR EINE ABGELEHNTE KORREKTUR. */
    expect(tornummer).toBeLessThan(zaehler);
  });

  it("sie verlangt eine Abweichung — das ist das Tor, nicht die Oberfläche", () => {
    expect(KORR).toContain("public.purchase_receipt_fingerprint(p_purchase_id)");
    expect(KORR).toContain("v_tip.content_fingerprint = v_now");
    expect(KORR).toContain("nothing changed since the last receipt");
    expect(KORR).toContain("invalid_parameter_value");
  });

  it("und einen Ursprungsbeleg, auf den sie zeigen kann", () => {
    expect(KORR).toContain("there is no receipt to correct");
  });

  it("die Revision zählt hoch, der Verweis wird KOPIERT", () => {
    expect(KORR).toContain("v_tip.revision + 1");
    expect(KORR).toContain("v_tip.id");
    expect(KORR).toContain("v_tip.receipt_number");
    expect(KORR).toContain("v_tip.issued_at");
  });

  it("derselbe Nummernkreis wie die Erstausstellung", () => {
    expect(KORR).toContain("'SI-E-' || v_year::text || '-' || lpad(v_number::text, 6, '0')");
    expect(KORR).toContain("insert into public.purchase_receipt_counters as c");
    expect(KORR).toContain("on conflict (year) do update");
  });

  it("die Positionsliste wird mit derselben Anweisung gebildet wie in 0122/0123", () => {
    /* Wörtlich dieselbe: sonst wäre der Unterschied zweier Fassungen zum Teil
       ein Unterschied der Abfrage. */
    const stelle = KORR.indexOf("jsonb_agg(jsonb_build_object(");
    expect(stelle).toBeGreaterThan(-1);
    const block = KORR.slice(stelle, stelle + 420);
    for (const feld of ["'position', i.position", "'sky_id', i.sky_id",
                        "coalesce(s.display_name_override, s.name, i.raw_name)",
                        "'condition', i.condition",
                        "order by i.position, i.id"]) {
      expect(block, feld).toContain(feld);
    }
    const alt = code(latestFunction("seller_issue_purchase_receipt").body);
    const altBlock = alt.slice(alt.indexOf("jsonb_agg(jsonb_build_object("),
                               alt.indexOf("jsonb_agg(jsonb_build_object(") + 420);
    expect(block.replace(/\s+/g, " ")).toBe(altBlock.replace(/\s+/g, " "));
  });

  it("sie ändert und löscht nichts", () => {
    for (const verboten of ["update public.purchase_receipts",
                            "delete from public.purchase_receipts",
                            "delete from public.purchase_receipt_downloads",
                            "update public.purchase_items",
                            "update public.purchases",
                            "inventory_movements", "shop_inventory"]) {
      expect(KORR, verboten).not.toContain(verboten);
    }
  });

  it("security definer, leerer search_path, volatile", () => {
    expect(EXEC128).toContain("security definer");
    expect(EXEC128).toContain("set search_path = ''");
    expect(EXEC128).toContain("die Korrekturfunktion muss volatile sein");
  });

  it("die Rechte werden gesetzt und geprüft", () => {
    expect(EXEC128).toContain(
      "revoke all on function public.seller_issue_purchase_receipt_correction(bigint)");
    expect(EXEC128).toContain("from public, anon;");
    expect(EXEC128).toContain("to authenticated;");
    expect(EXEC128).toContain("PUBLIC hat EXECUTE auf %");
    expect(EXEC128).toContain("anon darf % ausfuehren");
  });

  it("die Erstausstellung bleibt unberührt und idempotent", () => {
    expect(EXEC128).not.toContain(
      "create or replace function public.seller_issue_purchase_receipt(");
    expect(EXEC128).toContain("seller_issue_purchase_receipt ist nicht mehr idempotent");
    expect(EXEC128).toContain("seller_issue_purchase_receipt wurde veraendert");
    /* 0122 und 0123 selbst werden nicht angefasst. */
    expect(migrationSource("0122_purchase_receipts.sql")).not.toContain("supersedes_number");
    expect(migrationSource("0123_purchase_receipt_format_version.sql"))
      .not.toContain("supersedes_number");
  });

  it("und 0125 bleibt in Kraft — der Fingerabdruck ist nicht wieder erreichbar", () => {
    expect(EXEC128).toContain("0125 ist aufgehoben");
  });

  it("mehrere Korrekturen hintereinander sind möglich", () => {
    /* `revision + 1` statt einer festen 2, und die Spitze wird jedes Mal neu
       gesucht. Die Obergrenze ist der CHECK aus 0122 (1..999). */
    expect(KORR).toContain("v_tip.revision + 1");
    expect(KORR).not.toContain("revision = 2");
    expect(migrationSource("0122_purchase_receipts.sql"))
      .toContain("receipts_revision_sane check (revision between 1 and 999)");
  });

  it("die Historie liest nur und ordnet die Kette aufsteigend", () => {
    expect(HIST).toContain("order by r.revision, r.id");
    expect(HIST).toContain("'is_current'");
    expect(HIST).toContain("'correctable'");
    for (const schreibend of ["insert into", "update public.", "delete from"]) {
      expect(HIST, schreibend).not.toContain(schreibend);
    }
    expect(EXEC128).toContain("die Historienfunktion muss stable sein");
  });
});

/* ==========================================================================
 * 3. 0129 — die Sicherung
 * ======================================================================== */

describe("0129 nimmt die Eigenbelege in die Betriebssicherung", () => {
  it("drei Bereiche kommen dazu", () => {
    for (const key of ["purchase_receipts", "purchase_receipt_downloads",
                       "purchase_receipt_counters"]) {
      expect(EXEC129, key).toContain(`'${key}', coalesce((`);
      expect(EXEC129, key).toContain(`from public.${key} t`);
    }
  });

  it("der eingefrorene Snapshot kommt als Ganzes mit", () => {
    expect(EXEC129).toContain("'lines', t.lines");
    expect(EXEC129).toContain("'content_fingerprint', t.content_fingerprint");
    /* Die Kette auch — ohne sie wäre eine Korrektur nach einem Restore ein
       zweiter Ursprungsbeleg. */
    expect(EXEC129).toContain("'supersedes_id', t.supersedes_id");
    expect(EXEC129).toContain("'supersedes_number', t.supersedes_number");
    expect(EXEC129).toContain("'supersedes_issued_at', t.supersedes_issued_at");
    expect(EXEC129).toContain("'revision', t.revision");
  });

  it("und der Nummernzähler, ohne den ein Restore Nummern doppelt vergäbe", () => {
    expect(EXEC129).toContain("'next_number', t.next_number");
    expect(EXEC129).toContain("order by t.year)");
  });

  it("keine Kontoidentität, kein Geheimnis", () => {
    /*
     * GEPRÜFT WIRD DER RUMPF, NICHT DIE DATEI. Die Nachbedingung derselben
     * Migration führt genau diese Feldnamen als VERBOTSLISTE — wer die ganze
     * Datei durchsucht, findet seinen eigenen Wächter. Dieselbe Lehre wie
     * zweimal in `0124`.
     */
    const rumpf = code(latestFunction("seller_business_backup").body);
    for (const feld of ["'issued_by'", "'delivered_by'", "'created_by'",
                        "'client_salt'"]) {
      expect(rumpf, feld).not.toContain(feld);
    }
    /* Und die Nachbedingung prüft dasselbe am laufenden Server. */
    expect(EXEC129).toContain("Kontoidentitaet oder Geheimnis");
  });

  it("die 25 bestehenden Bereiche sind unverändert dabei", () => {
    const alt = code(migrationSource("0104_business_backup_export.sql"));
    const bereiche = (s: string) =>
      [...s.matchAll(/^\s{6}'([a-z_]+)', coalesce\(\(/gm)].map((m) => m[1]);
    const vorher = bereiche(alt);
    const nachher = bereiche(EXEC129);
    expect(vorher).toHaveLength(25);
    expect(nachher).toHaveLength(28);
    /* Jeder alte Bereich steht noch da, in derselben Reihenfolge. */
    expect(nachher.filter((k) => vorher.includes(k))).toEqual(vorher);
  });

  it("sie bleibt eine Anweisung — eine Momentaufnahme", () => {
    const rumpf = latestFunction("seller_business_backup").body;
    const innen = rumpf.slice(rumpf.indexOf("as $$") + 5);
    /*
     * GENAU EIN Anweisungstrenner, und zwar am Ende. Ein Statement sieht
     * genau eine MVCC-Momentaufnahme — daran hängt, dass kein Beleg in der
     * Datei steht, dessen Einkauf fehlt.
     */
    expect((innen.match(/;/g) ?? [])).toHaveLength(1);
    expect(innen.trimEnd().endsWith(";")).toBe(true);
    expect(rumpf).toContain("language sql");
    expect(rumpf).toContain("stable");
    expect(rumpf).toContain("pg_current_snapshot()::text");
  });

  it("und schreibt nichts", () => {
    const rumpf = code(latestFunction("seller_business_backup").body);
    for (const w of ["insert into", "update public.", "delete from", "truncate",
                     "nextval", "setval", "txid_current()"]) {
      expect(rumpf.toLowerCase(), w).not.toContain(w);
    }
  });

  it("die Wiederherstellungsreihenfolge steht in der Datei", () => {
    expect(SQL129).toContain("REIHENFOLGE BEI EINER WIEDERHERSTELLUNG");
    expect(SQL129).toContain("purchase_receipt_counters");
    expect(SQL129).toContain("receipts_supersedes_fk");
    expect(SQL129).toContain("restore_supported` bleibt `false");
  });

  it("0104 selbst wird nicht verändert", () => {
    /* Der Byte-Fingerabdruck von 0104 steht in `platform-manifest.test.ts`;
       hier zählt, dass 0129 die Belege nicht dort hineingeschrieben hat. */
    expect(migrationSource("0104_business_backup_export.sql"))
      .not.toContain("purchase_receipts");
  });
});

/* ==========================================================================
 * 4. Die Oberfläche
 * ======================================================================== */

describe("die Belegkarte zeigt die Kette", () => {
  it("jede Fassung mit Nummer, Revision, Datum und Positionszahl", () => {
    expect(DIALOG).toContain("{receiptCopy.historyHeading}");
    expect(DIALOG).toContain("{receiptCopy.revisionLabel(fassung.revision)}");
    expect(DIALOG).toContain("{receiptCopy.lineCount(fassung.lineCount)}");
    expect(DIALOG).toContain("fassung.receiptNumber");
  });

  it("aktuell und ersetzt sind eindeutig unterschieden", () => {
    expect(DIALOG).toContain("fassung.isCurrent ? receiptCopy.current : receiptCopy.superseded");
    expect(copy.current).toBe("Aktuelle Fassung");
    expect(copy.superseded).toBe("Ersetzt");
    expect(copy.supersededByHint).toContain("bleibt unverändert");
  });

  it("jede Fassung bleibt herunterladbar — auch eine ersetzte", () => {
    expect(DIALOG).toContain("onClick={() => void fetchReceipt({");
    expect(DIALOG).toContain("id: fassung.id, receiptNumber: fassung.receiptNumber,");
  });

  it("und der Abruf einer alten Fassung überschreibt den Zustand der Spitze nicht", () => {
    const fn = DIALOG.slice(DIALOG.indexOf("async function fetchReceipt("));
    const rumpf = fn.slice(0, fn.indexOf("\n  }"));
    expect(rumpf).toContain("let ziel:");
    expect(rumpf).toContain("await readHistory();");
  });

  it("der Satz zum eingefrorenen Stand steht da", () => {
    expect(DIALOG).toContain("{receiptCopy.frozenHint}");
    expect(copy.frozenHint).toContain("eingefrorenen Stand");
    expect(copy.frozenHint).toContain("Ausstellungstags");
  });
});

describe("„Korrekturbeleg erstellen“ verlangt zwei Schritte", () => {
  it("die Aktion erscheint nur, wenn der Server sie annähme", () => {
    expect(DIALOG).toContain("receipt !== null && correctable && !correctPrompt");
    /* `correctable` kommt aus der Server-Funktion, nicht aus einer eigenen
       Rechnung im Browser. */
    expect(DIALOG).toContain("setCorrectable(result.correctable)");
    expect(ACTIONS).toContain("correctable: root.correctable === true");
  });

  it("der erste Klick setzt NUR die Rückfrage", () => {
    expect(DIALOG).toContain("onClick={() => { setReceiptError(null); setCorrectPrompt(true); }}");
    const treffer = DIALOG.match(/void correctNow\(\)/g) ?? [];
    expect(treffer).toHaveLength(1);
  });

  it("erst der bestätigte Klick ruft den Server", () => {
    const fn = DIALOG.slice(DIALOG.indexOf("async function correctNow()"));
    const rumpf = fn.slice(0, fn.indexOf("\n  }"));
    expect(rumpf).toContain("issuePurchaseReceiptCorrection(purchase.id)");
    expect(rumpf).toContain("await readHistory();");
    expect(rumpf).toContain("onSaved();");
    /* Bei einer Ablehnung bleibt die Rückfrage stehen und der Satz erscheint. */
    expect(rumpf).toContain("if (!issued.ok) { setReceiptError(issued.message); return; }");
    expect(rumpf.indexOf("setCorrectPrompt(false)"))
      .toBeGreaterThan(rumpf.indexOf("setReceipt(issued.receipt)"));
  });

  it("der Knopf ist während der Ausstellung gesperrt und sagt es", () => {
    expect(DIALOG).toContain("{receiptBusy ? receiptCopy.correcting : receiptCopy.correctConfirmYes}");
    expect(DIALOG).toContain("aria-busy={receiptBusy}");
  });

  it("die Rückfrage sagt, was entsteht und was bleibt", () => {
    expect(copy.correctConfirmBody).toContain("NEUER Eigenbeleg");
    expect(copy.correctConfirmBody).toContain("eigener Nummer");
    expect(copy.correctConfirmBody).toContain("unverändert gespeichert");
    expect(copy.correctConfirmBody).toContain("Abrufnachweis");
    expect(copy.correctConfirmBody).not.toContain("gültig");
  });

  it("und die zwei Ablehnungen des Servers haben einen Satz", () => {
    expect(ACTIONS).toContain("nothing changed since the last receipt");
    expect(ACTIONS).toContain("there is no receipt to correct");
    expect(copy.errors.noChange).toContain("nichts „geändert“".slice(0, 6));
    expect(copy.errors.noChange).toContain("Korrekturbeleg");
    expect(copy.errors.noOriginal).toContain("Ursprungsbeleg");
  });

  it("der Hinweis bei Abweichung verspricht jetzt die Korrektur", () => {
    expect(copy.stale).toContain("Korrekturbeleg");
    expect(copy.stale).toContain("bleibt unverändert");
    expect(copy.stale).not.toContain("noch nicht möglich");
  });
});
