/**
 * Eigenbelege (0122): das Dokument, die Nummer, der Lieferstatus.
 *
 * VIER ZUSICHERUNGEN TRAGEN DIESE DATEI.
 *
 * 1. DERSELBE SNAPSHOT ERGIBT DASSELBE PDF — Byte für Byte. Daran hängt die
 *    Lieferbestätigung: der Browser schickt den SHA-256 der empfangenen
 *    Bytes, der Server rendert neu und vergleicht. Wäre das Dokument nicht
 *    deterministisch, schlüge jede Bestätigung fehl.
 *
 * 2. WAS NICHT AUF DEN BELEG GEHÖRT, KANN NICHT DARAUFKOMMEN. Marktwert,
 *    Faktor, Verkaufspreis und die interne Notiz sind nicht Teil des
 *    Snapshots — `0122` kopiert sie nicht. Das ist der Unterschied zwischen
 *    einer Regel und einer Eigenschaft, und hier wird beides geprüft.
 *
 * 3. AUSGESTELLT UND ABGERUFEN SIND ZWEI DINGE. Eine Belegnummer entsteht
 *    beim Ausstellen und bleibt, auch wenn der Download danach scheitert.
 *    Der Haken hängt allein an einer bestätigten Auslieferung.
 *
 * 4. FEHLENDE ANGABEN WERDEN NICHT ERFUNDEN. Weder ein Absender, von dem
 *    nichts bekannt ist, noch eine Kostenaufteilung, die nie erfasst wurde.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

import { code, latestFunction } from "@/test-support/migrations";
import { renderPurchaseReceiptPdf, type ReceiptDocument } from "./purchase-receipt";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const FILE = "0122_purchase_receipts.sql";
const SQL = read(`supabase/migrations/${FILE}`);
/*
 * Seit der Versionierung sind es drei Dateien: der Verteiler mit den Typen
 * und die beiden eingefrorenen Zeichner. Diese Datei prüft FORMAT 1 — die
 * Vorlagen unten tragen kein `format_version`, und `formatOf()` liest daraus
 * eine 1. Format 2 und die Versionierung selbst haben ihre eigene Datei.
 */
const ENTRY = read("src/lib/business/purchase-receipt.ts");
const MODULE = read("src/lib/business/receipt-format-v1.ts");
const ACTIONS = read("src/lib/business/receipt-actions.ts");
const ROUTE = read("src/app/(business)/business/orderbuch/[id]/beleg/[receiptId]/route.ts");
const DETAILS = read("src/components/business/purchase-details.tsx");

/* ==========================================================================
 * Ein Beleg zum Rechnen
 * ======================================================================== */

function doc(over: Partial<ReceiptDocument> = {}): ReceiptDocument {
  return {
    id: 1, purchase_id: 105,
    receipt_number: "SI-E-2026-000001",
    issued_at: "2026-10-14T09:00:00+00:00",
    revision: 1, supersedes_id: null,
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
    /*
     * Position 2 ist im Orderbuch als `damaged` erfasst. Auf dem Beleg steht
     * sie trotzdem — bezahlt wurde das Los — nur ihr Buchungszustand steht
     * nicht mehr dabei. `condition` unterscheidet die beiden: lose und
     * originalverpackt sind Eigenschaften der Ware, kein Lagervorgang.
     */
    lines: [
      { position: 1, sky_id: "SKY-0008", name: "Legendary Bash", condition: "loose" },
      { position: 2, sky_id: "SKY-0344", name: "Legendary Blades", condition: "sealed" },
    ],
    ...over,
  };
}

const latin1 = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => String.fromCharCode(b)).join("");

/** Die gezeichneten Textläufe, mit entschlüsselten PDF-Escapes. */
function runs(bytes: Uint8Array): { x: number; y: number; size: number; text: string }[] {
  const out: { x: number; y: number; size: number; text: string }[] = [];
  for (const line of latin1(bytes).split("\n")) {
    const m = /^BT \/F[12] ([\d.]+) Tf 1 0 0 1 ([\d.-]+) ([\d.-]+) Tm \((.*)\) Tj ET$/.exec(line);
    if (m) {
      out.push({
        size: Number(m[1]), x: Number(m[2]), y: Number(m[3]),
        text: m[4].replace(/\\([()\\])/g, "$1"),
      });
    }
  }
  return out;
}

const textOf = (bytes: Uint8Array) => runs(bytes).map((r) => r.text).join("\n");

/* ==========================================================================
 * 1. Determinismus
 * ======================================================================== */

describe("derselbe Snapshot ergibt dasselbe PDF", () => {
  it("zweimal gerendert, Byte für Byte gleich", () => {
    const a = renderPurchaseReceiptPdf(doc());
    const b = renderPurchaseReceiptPdf(doc());
    expect(a.byteLength).toBe(b.byteLength);
    expect(createHash("sha256").update(a).digest("hex"))
      .toBe(createHash("sha256").update(b).digest("hex"));
  });

  it("auch mit allen optionalen Feldern gefüllt", () => {
    const full = doc({
      seller_handle: "sammler87", listing_title: "40 Skylanders Figuren",
      listing_url: "https://example.org/s-anzeige/3883929383",
      listing_details: "Abholung oder Versand, Zustand gebraucht.",
      agreement_note: "Das ursprüngliche Inserat umfasste 40 Figuren. Gekauft wurden "
        + "ausschließlich die 2 im Orderbuch aufgeführten Figuren.",
    });
    expect(latin1(renderPurchaseReceiptPdf(full)))
      .toBe(latin1(renderPurchaseReceiptPdf(full)));
  });

  it("das Modul kennt weder Uhrzeit noch Zufall", () => {
    /*
     * DIE URSACHE, die im Prototyp noch drin war: er nahm `new Date()` für
     * das Belegdatum. Ein Beleg, dessen Inhalt sich mit der Uhr ändert, lässt
     * sich nicht bestätigen und ist auch kein Dokument.
     */
    const body = MODULE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(body).not.toContain("new Date()");
    expect(body).not.toContain("Date.now()");
    expect(body).not.toContain("Math.random");
    /* `new Date(value)` für das ÜBERGEBENE Datum ist erlaubt und nötig. */
    expect(body).toContain("new Date(value)");
  });

  it("das Belegdatum kommt aus dem Snapshot", () => {
    const early = textOf(renderPurchaseReceiptPdf(doc({ issued_at: "2026-01-02T10:00:00+00:00" })));
    expect(early).toContain("02.01.2026");
    const late = textOf(renderPurchaseReceiptPdf(doc({ issued_at: "2026-12-31T10:00:00+00:00" })));
    expect(late).toContain("31.12.2026");
  });
});

/* ==========================================================================
 * 2. Was daraufsteht, und was nicht
 * ======================================================================== */

describe("der Inhalt", () => {
  const text = textOf(renderPurchaseReceiptPdf(doc()));

  it("Belegnummer, Belegdatum und Kaufdatum", () => {
    expect(text).toContain("SI-E-2026-000001");
    expect(text).toContain("14.10.2026");
    expect(text).toContain("12.10.2026");
  });

  it("die Geschäftsdaten des Shops als Käufer", () => {
    for (const line of ["Julian Stocker", "yulez.collectibles", "Lechhalde 1 1/2",
                        "87629 Füssen", "Deutschland", "USt-IdNr. DE321022065"]) {
      expect(text, line).toContain(line);
    }
  });

  it("der private Absender als Verkäufer", () => {
    expect(text).toContain("Verkäufer (Privatperson)");
    for (const line of ["Henry Tester", "Teststraße 3", "87688 Teststadt"]) {
      expect(text, line).toContain(line);
    }
  });

  it("Plattform, Benutzername und Inseratsreferenz", () => {
    expect(text).toContain("Kleinanzeigen");
    expect(text).toContain("3883929383");
    /* Kein Benutzername erfasst — der Beleg sagt das, statt zu schweigen. */
    expect(text).toContain("Benutzername      nicht erfasst");
  });

  it("die Positionen, beschädigte eingeschlossen — aber ohne Buchungszustand", () => {
    /*
     * HIER STAND „mit ihrem Zustand". Das war fachlich falsch: der
     * Buchungszustand ist der Lagerweg einer Figur, nicht Teil des Ankaufs.
     * Ein eingefrorener Beleg, der ihn ausweist, behauptet mehr, als er
     * einfrieren kann — und jedes Einbuchen nach der Ausstellung hätte eine
     * Änderungswarnung ausgelöst.
     *
     * Was bleibt: BEIDE Positionen stehen auf dem Beleg, die beschädigte
     * eingeschlossen, denn bezahlt wurde das Los.
     */
    expect(text).toContain("SKY-0008");
    expect(text).toContain("Legendary Bash");
    expect(text).toContain("SKY-0344");
    expect(text).toContain("Legendary Blades");

    /* Kein operativer Zustand, in keiner Schreibweise. */
    for (const operational of ["Beschädigt", "Angekommen", "Eingebucht", "Bestellt",
                               "Fehlt", "Vitrine", "Zustand"]) {
      expect(text, operational).not.toContain(operational);
    }

    /* Stattdessen die Ausführung der Ware — wie auf der Kundenrechnung. */
    expect(text).toContain("Ausführung");
    expect(text).toContain("lose");
    expect(text).toContain("originalverpackt");
  });

  it("die Kosten, die Summe und die Zahlungsart", () => {
    expect(text).toContain("13,00 EUR");
    expect(text).toContain("0,00 EUR");
    expect(text).toContain("Gesamtausgabe");
    expect(text).toContain("Kreditkarte");
  });

  it("der Eigenbeleg-Hinweis und die Unterschriftszeile", () => {
    expect(text).toContain("Eigenbeleg über einen Privatankauf");
    expect(text).toContain("Dieser Beleg dokumentiert einen Ankauf von");
    expect(text).toContain("Ort, Datum");
    expect(text).toContain("Unterschrift des Ausstellers");
  });

  it("die Kaufvereinbarung nur, wenn es eine gibt", () => {
    expect(text).not.toContain("Anmerkungen zur Kaufvereinbarung");
    const withNote = textOf(renderPurchaseReceiptPdf(
      doc({ agreement_note: "Preis im Chat vereinbart." })));
    expect(withNote).toContain("Anmerkungen zur Kaufvereinbarung");
    expect(withNote).toContain("Preis im Chat vereinbart.");
  });

  it("KEIN Marktwert, Faktor, Verkaufspreis, Gewinn oder Steuerausweis", () => {
    const whole = latin1(renderPurchaseReceiptPdf(doc()));
    /*
     * „Umsatzsteuer aus" stand hier in der Verbotsliste — und zwei Zeilen
     * weiter unten als Zusicherung, dass es DRAUFSTEHT. Ein Selbstwiderspruch
     * in derselben Prüfung: der Hinweis NENNT die Umsatzsteuer, um ihr Fehlen
     * zu erklären. Verboten ist ein AUSWEIS, nicht das Wort.
     */
    for (const forbidden of ["Marktwert", "Faktor", "known_value", "Verkaufspreis",
                             "Gewinn", "USt 0", "19 %", "MwSt", "zzgl."]) {
      expect(whole, forbidden).not.toContain(forbidden);
    }
    /* Der Hinweis NENNT die Umsatzsteuer, um ihr Fehlen zu erklären — aber er
       weist keine aus. Genau diese Unterscheidung wird hier festgehalten. */
    expect(text).toContain("weist keine Umsatzsteuer aus");
  });

  it("und die interne Notiz ist gar nicht erst im Typ", () => {
    /*
     * `0122` kopiert sie nicht; es gibt also kein Feld, aus dem sie käme.
     * Gesucht wird ein Feld, das GENAU `note` heisst — die erste Fassung
     * suchte die Teilzeichenkette und schlug an `agreement_note:` an.
     */
    expect(ENTRY).not.toMatch(/^\s+note[?]?:/m);
    expect(ENTRY).toMatch(/^\s+agreement_note:/m);
    expect(SQL.slice(SQL.indexOf("create table if not exists public.purchase_receipts"),
                     SQL.indexOf("create unique index")))
      .not.toMatch(/^\s+note\s+text/m);
  });
});

/* ==========================================================================
 * 3. Fehlende Angaben werden nicht erfunden
 * ======================================================================== */

describe("Lücken bleiben Lücken", () => {
  it("ein Absender ohne jede Angabe steht als „nicht erfasst“ da", () => {
    const text = textOf(renderPurchaseReceiptPdf(doc({
      sender_name: null, sender_street: null, sender_postal_code: null,
      sender_city: null, sender_country: null,
    })));
    expect(text).toContain("Verkäufer (Privatperson)");
    expect(text).toContain("nicht erfasst");
    expect(text).not.toContain("Henry Tester");
  });

  it("ein Absender mit nur einem Namen zeigt nur den Namen", () => {
    const text = textOf(renderPurchaseReceiptPdf(doc({
      sender_street: null, sender_postal_code: null, sender_city: null,
      sender_country: null,
    })));
    expect(text).toContain("Henry Tester");
    expect(text).not.toContain("Teststraße");
  });

  it("eine nicht erfasste Kostenaufteilung wird nicht erfunden", () => {
    const text = textOf(renderPurchaseReceiptPdf(doc({
      items_cost: null, shipping_cost: null, buyer_protection_cost: null,
      total_cost: 13,
    })));
    expect(text).toContain("Die Aufteilung der Kosten ist für diesen Einkauf nicht erfasst.");
    expect(text).toContain("13,00 EUR");
    /* Keine erfundene Null bei Versand oder Käuferschutz. */
    expect(text).not.toContain("Versand");
    expect(text).not.toContain("Käuferschutz");
  });
});

/* ==========================================================================
 * 4. Zeichensatz und mehrere Seiten
 * ======================================================================== */

describe("Zeichen und Seiten", () => {
  it("kein Fragezeichen — Umlaute und das Eurozeichen", () => {
    /*
     * Anforderung 10. `U+20AC` liegt in CP1252 bei `0x80` und damit
     * ausserhalb der Latin-1-Regel aus Schritt 1 — es käme als `?` heraus.
     * Also steht EUR als Wort da, und das wird hier nachgesehen statt
     * behauptet.
     */
    const bytes = renderPurchaseReceiptPdf(doc({
      sender_name: "Jörg Müller-Weiß", agreement_note: "Größe: 40 Stück, Preis gemäß Chat.",
    }));
    for (const run of runs(bytes)) expect(run.text, run.text).not.toContain("?");
    const whole = latin1(bytes);
    expect(whole).not.toContain("€");
    expect(textOf(bytes)).toContain("EUR");
    expect(textOf(bytes)).toContain("Jörg Müller-Weiß");
  });

  it("sechzig Positionen ergeben mehrere Seiten", () => {
    const many = doc({
      lines: Array.from({ length: 60 }, (_, i) => ({
        position: i + 1, sky_id: `SKY-${String(i + 1).padStart(4, "0")}`,
        name: `Figur ${i + 1}`, condition: "loose",
      })),
    });
    const bytes = renderPurchaseReceiptPdf(many);
    const pages = Number(/\/Count (\d+)/.exec(latin1(bytes))?.[1]);
    expect(pages).toBeGreaterThan(1);

    /* Nichts unter der Grundlinie, ausser der Seitenzahl im Rand. */
    for (const run of runs(bytes)) {
      if (run.text.startsWith("Seite ")) continue;
      expect(run.y, run.text).toBeGreaterThanOrEqual(56);
    }
    /* Keine Position geht verloren, und der Fuss steht am Ende. */
    const text = textOf(bytes);
    for (let i = 1; i <= 60; i += 1) {
      expect(text, `Figur ${i}`).toContain(`SKY-${String(i).padStart(4, "0")}`);
    }
    expect(text).toContain("Unterschrift des Ausstellers");
  });

  it("eine Position wird nicht zwischen ihren Spalten getrennt", () => {
    const many = doc({
      lines: Array.from({ length: 60 }, (_, i) => ({
        position: i + 1, sky_id: `SKY-${String(i + 1).padStart(4, "0")}`,
        name: `Figur ${i + 1}`, condition: "loose",
      })),
    });
    /* SKY-ID und Bezeichnung einer Zeile teilen dieselbe Grundlinie. */
    const drawn = runs(renderPurchaseReceiptPdf(many));
    for (let i = 1; i <= 60; i += 1) {
      const sky = drawn.find((r) => r.text === `SKY-${String(i).padStart(4, "0")}`);
      const name = drawn.find((r) => r.text === `Figur ${i}`);
      expect(sky, `SKY ${i}`).toBeDefined();
      expect(name?.y, `Figur ${i}`).toBe(sky?.y);
    }
  });
});

/* ==========================================================================
 * 5. Die Migration
 * ======================================================================== */

describe("0122 legt an, was der Beleg braucht", () => {
  const sql = code(SQL);

  it("sie liegt in der lückenlosen Folge, und 0123 folgt ihr", () => {
    /*
     * „die höchste Migration" stand hier, bis `0123` die Formatversion
     * nachtrug — danach, bis `0124` den Belegzustand in die Übersicht
     * brachte, bis `0125` dem internen Fingerabdruck das EXECUTE für
     * `authenticated` entzog, bis `0126` — Figuren hinzufügen und entfernen in
     * einem Speichern —, bis `0127`, dem direkten Figurenwechsel im selben
     * Speichern, und jetzt bis `0129`: Korrekturbelege (`0128`) und die
     * Eigenbelege in der Betriebssicherung (`0129`) — und jetzt bis `0131`:
     * die Sicherung führt seit `0130`/`0131` jede Spalte, die eine
     * Wiederherstellung braucht — und jetzt bis `0132`: das Entfernen einer
     * Einkaufsposition entscheidet die ZEILE und nicht mehr ihr Eltern-Einkauf,
     * damit ein historischer Einkauf nachgetragen und ein Fehlgriff
     * zurückgenommen werden kann (ADR-0126) — und bis `0133`, die die
     * bezahlte Summe eines importierten Einkaufs auch gegen ein direktes
     * `update` festhaelt — und jetzt bis `0134`, die `source_row` in die
     * Positionsliste gibt, damit der Dialog dieselben vier Ablehnungsgründe
     * prüft wie die Datenbank (ADR-0127). Die Zusicherung, die bleibt, ist die über die
     * FOLGE: die drei Tests in `src/lib/commerce/` verlangen sie
     * lückenlos.
     *
     * Dass hier eine Dateiname steht, der sich mit jeder Migration ändert,
     * ist Absicht und kein Mangel: er stellt sicher, dass jemand, der eine
     * Migration anlegt, genau diesen Test liest.
     */
    const files = readdirSync(join(process.cwd(), "supabase/migrations"))
      .filter((f) => f.endsWith(".sql")).sort();
    expect(files).toContain(FILE);
    expect(files[files.length - 1])
      .toBe("0134_purchase_item_source_row_visible.sql");
    expect(files[files.length - 2]).toBe("0133_paid_total_immutable.sql");
    const numbers = files.map((f) => Number(f.slice(0, 4)));
    expect(numbers).toEqual(numbers.map((_, i) => i + 1));
  });

  it("und 0122 selbst wurde dabei nicht angefasst", () => {
    /*
     * `0122` ist auf Staging angewendet. Die Formatversion kommt deshalb in
     * einer EIGENEN Migration und nicht durch eine Änderung an der bereits
     * gelaufenen — eine angewendete Migration wird nicht umgeschrieben.
     */
    expect(SQL).not.toContain("format_version");
    const next = read("supabase/migrations/0123_purchase_receipt_format_version.sql");
    expect(next).toContain("add column if not exists format_version integer not null default 1");
    expect(next).toContain("check (format_version between 1 and 99)");
    /* Sie legt nichts an und löscht nichts. */
    for (const forbidden of ["create table", "drop table", "drop column", "truncate",
                             "delete from", "drop function"]) {
      expect(code(next).toLowerCase(), forbidden).not.toContain(forbidden);
    }
    /*
     * Bestehende Belege bleiben in Format 1 — geprüft am DEFAULT der Spalte,
     * nicht an einer Zeilenzählung. Eine Zählung „keine Zeile ausser 1" wäre
     * beim ersten Lauf richtig und bei jedem späteren falsch, sobald ein
     * Beleg in Format 2 existiert.
     */
    expect(next).toContain("the format_version default should be 1");
    expect(next).toContain("receipts carry an impossible format version");
    expect(next).toContain("does not write a format version");
    /* Und sie sagt es, wenn 0122 fehlt, statt an einer Folgemeldung zu scheitern. */
    for (const guard of ["0123 needs 0122: the table public.purchase_receipts does not exist",
                         "0123 needs 0122: seller_issue_purchase_receipt does not exist",
                         "0123 needs 0122: the immutability trigger is missing"]) {
      expect(next, guard).toContain(guard);
    }
  });

  it("drei Tabellen, zwei Trigger, sechs Funktionen, zwei Teilindizes", () => {
    for (const table of ["purchase_receipts", "purchase_receipt_downloads",
                         "purchase_receipt_counters"]) {
      expect(sql, table).toContain(`create table if not exists public.${table}`);
      expect(sql, table).toContain(`revoke all on table public.${table} from public, anon, authenticated;`);
      expect(sql, table).toContain(`alter table public.${table} enable row level security;`);
    }
    expect(sql).toContain("purchase_receipts_origin_uniq");
    expect(sql).toContain("purchase_receipts_supersedes_uniq");
    expect(SQL).toContain("expected 3 new tables");
    expect(SQL).toContain("expected 2 immutability triggers");
    expect(SQL).toContain("expected 6 functions");
    expect(SQL).toContain("expected 2 partial unique indexes");
  });

  it("die Nummer ist transaktional und beginnt bei 1", () => {
    const issue = code(latestFunction("seller_issue_purchase_receipt").body)
      .replace(/\s+/g, " ");
    /* Kein `nextval`: eine Sequenz würde bei einem Rollback eine Lücke lassen. */
    expect(issue).not.toContain("nextval");
    expect(issue).toContain("insert into public.purchase_receipt_counters as c (year, next_number) values (v_year, 1)");
    expect(issue).toContain("on conflict (year) do update set next_number = c.next_number + 1");
    expect(issue).toContain("returning c.next_number into v_number");
    expect(issue).toContain("lpad(v_number::text, 6, '0')");
    expect(sql).toContain("check (receipt_number ~ '^SI-E-[0-9]{4}-[0-9]{6}$')");
  });

  it("gleichzeitige Ausstellungen können sich nicht überholen", () => {
    /*
     * Die Einkaufszeile wird gesperrt, BEVOR nachgesehen wird, ob es schon
     * einen Beleg gibt. Ohne die Sperre fänden zwei gleichzeitige Klicks
     * beide keinen und legten beide einen an.
     */
    const issue = code(latestFunction("seller_issue_purchase_receipt").body);
    expect(issue).toContain("from public.purchases where id = p_purchase_id for update");
    expect(issue.indexOf("for update"))
      .toBeLessThan(issue.indexOf("from public.purchase_receipts r"));
  });

  it("zweimal ausstellen gibt denselben Beleg zurück", () => {
    const issue = code(latestFunction("seller_issue_purchase_receipt").body);
    /* Gesucht wird das Ende der Kette — der, den niemand ersetzt hat. */
    expect(issue.replace(/\s+/g, " "))
      .toContain("and not exists (select 1 from public.purchase_receipts s where s.supersedes_id = r.id)");
    expect(issue).toContain("return public.seller_purchase_receipt(p_purchase_id);");
  });

  it("und verweigert, wo kein Beleg entstehen darf", () => {
    const issue = code(latestFunction("seller_issue_purchase_receipt").body);
    for (const refusal of ["a test purchase gets no receipt",
                           "a receipt needs the purchase date",
                           "has no item to put on a receipt",
                           "no complete business address"]) {
      expect(issue, refusal).toContain(refusal);
    }
    expect(issue).toContain("if not public.can_operate_active_seller() then");
  });

  it("die Geschäftsdaten kommen aus public.sellers, nicht aus dem Code", () => {
    const issue = code(latestFunction("seller_issue_purchase_receipt").body);
    expect(issue).toContain("from public.sellers where is_active limit 1");
    expect(issue).toContain("v_seller.legal_name");
    expect(issue).toContain("v_seller.contact_email");
    /* Und kein Zeichner erfindet etwas dazu. */
    for (const file of [ENTRY, MODULE, read("src/lib/business/receipt-format-v2.ts")]) {
      expect(file).not.toContain("SELLER_IDENTITY");
      expect(file).not.toContain("skyisles.de");
    }
  });

  it("die Korrekturkette ist deklarativ abgesichert", () => {
    expect(sql).toContain("constraint receipts_id_purchase_uniq unique (id, purchase_id)");
    expect(sql.replace(/\s+/g, " ")).toContain(
      "constraint receipts_supersedes_fk foreign key (supersedes_id, purchase_id) "
      + "references public.purchase_receipts (id, purchase_id)");
    expect(sql.replace(/\s+/g, " ")).toContain(
      "check ((supersedes_id is null) = (revision = 1))");
    expect(sql).toContain("check (supersedes_id is distinct from id)");
    /* Aber KEINE Funktion, die eine Korrektur ausstellt. */
    expect(sql).not.toContain("seller_correct_purchase_receipt");
    expect(sql).not.toContain("supersedes_id)\n       values");
  });

  it("ausgestellte Belege sind durch einen Riegel geschützt, nicht durch Absprache", () => {
    expect(sql).toContain("create or replace function public.purchase_receipt_is_immutable()");
    expect(code(latestFunction("purchase_receipt_is_immutable").body))
      .toContain("an issued receipt cannot be changed or removed");
    for (const table of ["purchase_receipts", "purchase_receipt_downloads"]) {
      expect(sql, table).toContain(`before update or delete on public.${table}`);
    }
  });

  it("der Fingerabdruck nimmt die belegrelevanten Felder und sonst nichts", () => {
    const fp = code(latestFunction("purchase_receipt_fingerprint").body);
    for (const field of ["purchased_at", "total_cost", "payment_method", "platform",
                         "sender_name", "listing_title", "agreement_note", "lines",
                         "position", "sky_id", "name", "condition"]) {
      expect(fp, field).toContain(`'${field}'`);
    }
    /*
     * M5: ausdrücklich NICHT `updated_at` — das bewegt sich auch bei einer
     * internen Notiz oder einem Tagesplatz-Tausch.
     */
    for (const noise of ["updated_at", "'note'", "is_test", "daily_index",
                         "client_token", "import_fingerprint"]) {
      expect(fp, noise).not.toContain(noise);
    }
    /*
     * UND AUSDRÜCKLICH NICHT DER BUCHUNGSZUSTAND.
     *
     * Einbuchen und Umbuchen sind operative Vorgänge. Stünde `state` im
     * Fingerabdruck, löste das erste Einbuchen nach der Ausstellung die
     * Warnung „belegrelevante Daten geändert" aus — bei jedem Einkauf, denn
     * Einbuchen ist der Normalfall.
     */
    expect(fp).not.toContain("'state'");
    expect(fp).not.toContain("i.state");
    expect(fp).toContain("encode(sha256(convert_to(");
  });

  it("der Snapshot kopiert den Buchungszustand gar nicht erst", () => {
    /*
     * ZWEI STELLEN, EINE REGEL. `state` fehlt sowohl im Fingerabdruck als
     * auch in der eingefrorenen Positionsliste — sonst stünde im Snapshot
     * eine Angabe, die der Beleg nicht zeigt und der Vergleich nicht prüft.
     */
    const issue = code(latestFunction("seller_issue_purchase_receipt").body);
    expect(issue).not.toContain("'state'");
    expect(issue).not.toContain("i.state");
    const lines = issue.slice(issue.indexOf("select jsonb_agg(jsonb_build_object("),
                              issue.indexOf("into v_lines"));
    expect([...lines.matchAll(/'(\w+)',/g)].map((m) => m[1]))
      .toEqual(["position", "sky_id", "name", "condition"]);
  });

  it("und der Typ im Renderer hat genau dieselben vier Felder", () => {
    const type = ENTRY.slice(ENTRY.indexOf("export type ReceiptLine = {"));
    const fields = [...type.slice(0, type.indexOf("\n};")).matchAll(/^\s{2}(\w+):/gm)]
      .map((m) => m[1]);
    expect(fields).toEqual(["position", "sky_id", "name", "condition"]);
    /* Und kein Zeichner kennt die Zustandstabelle. */
    expect(MODULE).not.toContain("orderbook.states");
    expect(read("src/lib/business/receipt-format-v2.ts")).not.toContain("orderbook.states");
  });

  it("die Rechte gehen nur an authenticated", () => {
    for (const fn of ["seller_issue_purchase_receipt(bigint)",
                      "seller_purchase_receipt(bigint)",
                      "seller_purchase_receipt_document(bigint)",
                      "seller_record_purchase_receipt_download(bigint, integer)"]) {
      expect(SQL, fn).toContain(`revoke all on function public.${fn} from public, anon;`);
      expect(SQL, fn).toContain(`grant execute on function public.${fn} to authenticated;`);
    }
  });

  it("und sie zerstört nichts", () => {
    for (const forbidden of ["drop table", "drop column", "truncate", "delete from",
                             "alter column", "drop constraint"]) {
      expect(sql.toLowerCase(), forbidden).not.toContain(forbidden);
    }
  });
});

/* ==========================================================================
 * 6. Lieferstatus und Zugriffsschutz
 * ======================================================================== */

describe("ausgestellt und abgerufen sind zwei Dinge", () => {
  it("der Haken hängt an einer bestätigten Auslieferung", () => {
    expect(DETAILS).toContain("receipt.firstDeliveredAt === null ? (");
    expect(DETAILS).toContain("{receiptCopy.notDelivered}");
    expect(DETAILS).toContain("text-success");
    /* Und nicht am Vorhandensein des Belegs. */
    const section = DETAILS.slice(DETAILS.indexOf("<Section title={receiptCopy.section}>"));
    expect(section.indexOf("firstDeliveredAt")).toBeGreaterThan(-1);
  });

  it("der Status liegt in der Datenbank, nicht im Browser", () => {
    expect(DETAILS).not.toContain("localStorage");
    expect(DETAILS).not.toContain("sessionStorage");
    expect(SQL).toContain("create table if not exists public.purchase_receipt_downloads");
  });

  it("bestätigt wird erst nach einem Hash-Vergleich", () => {
    expect(ACTIONS).toContain('createHash("sha256").update(rendered).digest("hex")');
    expect(ACTIONS).toContain("if (expected !== sha256.toLowerCase() || rendered.byteLength !== bytes)");
    expect(ACTIONS).toContain("return { ok: false, message: copy.errors.mismatch };");
    /* Der Aufruf, der schreibt, steht HINTER dem Vergleich. */
    expect(ACTIONS.indexOf("copy.errors.mismatch"))
      .toBeLessThan(ACTIONS.indexOf("seller_record_purchase_receipt_download"));
  });

  it("und der Browser rechnet den Hash über die EMPFANGENEN Bytes", () => {
    expect(DETAILS).toContain('await crypto.subtle.digest("SHA-256", bytes)');
    expect(DETAILS).toContain("await response.arrayBuffer()");
    expect(DETAILS).toContain("confirmPurchaseReceiptDownload(");
  });

  it("die Datei wird vor der Bestätigung gespeichert", () => {
    /*
     * Dem Betreiber geht es um das PDF. Scheitert die Bestätigung, hat er es
     * trotzdem — nur der Haken bleibt aus, und das ist die ehrliche Anzeige.
     */
    expect(DETAILS.indexOf("link.click();"))
      .toBeLessThan(DETAILS.indexOf("confirmPurchaseReceiptDownload("));
  });

  it("eine Belegnummer geht bei einem gescheiterten Download nicht verloren", () => {
    /*
     * Ausstellen und Abrufen sind getrennte Aufrufe. Scheitert der zweite,
     * bleibt der Beleg samt Nummer bestehen; der Knopf heisst danach
     * „PDF herunterladen" und nicht wieder „erstellen".
     */
    expect(DETAILS).toContain("receipt === null ? receiptCopy.create : receiptCopy.download");
    /*
     * DER ZUSTAND WIRD GESETZT, BEVOR DER ABRUF BEGINNT. Vorher hieß die
     * Variable `current`; seit `0128` kann auch eine ERSETZTE Fassung
     * abgerufen werden, und dann darf der Zustand der Kettenspitze nicht
     * überschrieben werden — daher die Trennung in `ziel` und `receipt`.
     * Die Zusicherung ist dieselbe.
     */
    const fn = DETAILS.slice(DETAILS.indexOf("async function fetchReceipt("));
    const rumpf = fn.slice(0, fn.indexOf("\n  }"));
    expect(rumpf).toContain("setReceipt(issued.receipt);");
    expect(rumpf.indexOf("setReceipt(issued.receipt);"))
      .toBeLessThan(rumpf.indexOf("await fetch("));
  });

  it("während der Bearbeitung wird nichts ausgestellt", () => {
    expect(DETAILS).toContain("if (editing || receiptBusy) return;");
    expect(DETAILS).toContain("disabled={receiptBusy || editing}");
    expect(DETAILS).toContain("{receiptCopy.editingBlocked}");
  });

  it("und die Warnung bei geänderten Daten kommt aus dem Fingerabdruck", () => {
    expect(DETAILS).toContain("{receipt.stale ? (");
    expect(DETAILS).toContain("{receiptCopy.stale}");
    expect(code(latestFunction("seller_purchase_receipt").body).replace(/\s+/g, " "))
      .toContain("'stale', v_receipt.content_fingerprint is distinct from "
                 + "public.purchase_receipt_fingerprint(p_purchase_id)");
    /*
     * UND DIE WARNUNG VERGLEICHT NICHT SELBST.
     *
     * Hier stand `not.toContain("updatedAt")` — ein Verbot des Wortes. Seit
     * `0126` benutzt der Dialog `purchase.updatedAt` als
     * NEBENLÄUFIGKEITS-TOKEN: er schickt ihn mit, und die Datenbank lehnt eine
     * veraltete Bearbeitung mit `PT409` ab. Das ist ein anderer Zweck als
     * „ist der Beleg veraltet", und ein Wortverbot kann die zwei nicht
     * unterscheiden.
     *
     * Verboten bleibt, was M5 verboten hat: `updated_at` als MASSSTAB für die
     * Veraltung. Kein Vergleich, kein `issuedAt <` und kein `>` daneben — die
     * Antwort kommt aus dem Fingerabdruck und nirgends sonst.
     */
    const vergleiche = DETAILS.split("\n")
      .filter((line) => line.includes("updatedAt"))
      .filter((line) => /[<>]|!==|===|is distinct/.test(line));
    expect(vergleiche).toEqual([]);
    /*
     * Und der einzige Gebrauch im CODE ist das Token im Speichern-Aufruf.
     * Kommentarzeilen zählen nicht mit — der Kommentar, der erklärt, warum
     * `purchase.updatedAt` das Token ist, darf dastehen.
     */
    const stellen = DETAILS.split("\n")
      .filter((l) => !/^\s*(\*|\/\*|\/\/)/.test(l))
      .filter((l) => l.includes("purchase.updatedAt"));
    expect(stellen).toHaveLength(1);
    expect(stellen[0].trim()).toBe("purchase.updatedAt,");
  });
});

describe("der Zugriffsschutz", () => {
  it("die Route prüft selbst und antwortet 404", () => {
    /*
     * Ein Route Handler geht nicht durch das Layout von `(business)`; dessen
     * `notFound()` schützt die Seiten, nicht diese Datei.
     */
    expect(ROUTE).toContain("if (!(await canOperateSeller())) return new Response(\"Not found\", { status: 404 });");
    /*
     * Ohne Kommentare geprüft: der Kopf der Datei ERKLÄRT, warum 404 und
     * nicht 403 — die erste Fassung schlug an ihrer eigenen Begründung an.
     */
    const body = ROUTE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(body).not.toContain("403");
    expect(body.split("status: 404").length).toBeGreaterThan(3);
  });

  it("der Beleg muss zum Einkauf im Pfad gehören", () => {
    expect(ROUTE).toContain("if (Number(document.purchase_id) !== purchase)");
  });

  it("kein öffentlicher Zwischenspeicher, kein Bucket, keine Datei", () => {
    expect(ROUTE).toContain('"Cache-Control": "private, no-store"');
    expect(ROUTE).toContain('"Content-Disposition": `attachment;');
    for (const forbidden of ["storage.from", "createSignedUrl", "getPublicUrl", "bucket"]) {
      expect(ROUTE, forbidden).not.toContain(forbidden);
      expect(ACTIONS, forbidden).not.toContain(forbidden);
    }
  });

  it("jede Server Action prüft die Betreiberrolle", () => {
    const exported = [...ACTIONS.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
    expect(exported.sort()).toEqual([
      "confirmPurchaseReceiptDownload", "issuePurchaseReceipt",
      /* Seit `0128`: Korrektur ausstellen und die Kette lesen. */
      "issuePurchaseReceiptCorrection",
      "loadPurchaseReceipt", "loadPurchaseReceiptHistory", "loadReceiptDocument",
    ]);
    expect(ACTIONS.split("await canOperateSeller()")).toHaveLength(exported.length + 1);
  });
});
