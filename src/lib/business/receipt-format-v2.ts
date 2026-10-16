/**
 * BELEGFORMAT 2 — schlank, und für grosse Ankäufe gebaut.
 *
 * Ein Ankauf über hundert Figuren ist der Normalfall, nicht die Ausnahme.
 * Format 1 brauchte dafür Seiten voller Spalten, die mit dem Ankauf nichts zu
 * tun haben. Format 2 zeigt vier: Position, SKY-ID, Name, Stückzahl.
 *
 * ---------------------------------------------------------------------------
 * WAS WEGFÄLLT, UND WARUM.
 *
 *   Ausführung (lose/originalverpackt)   eine Spalte, die den Beleg verlängert,
 *                                        ohne den Ankauf zu dokumentieren
 *   Buchungszustand                      operativ, nicht kaufrelevant; fiel
 *                                        schon aus dem Snapshot
 *   „nicht erfasst"-Zeilen               eine Zeile, die sagt, dass sie nichts
 *                                        sagt, ist Platzverschwendung
 *   Versand und Käuferschutz bei 0,00    „soweit angefallen" heisst: angefallen
 *
 * KEIN MARKTWERT, KEIN FAKTOR, KEIN EINZELPREIS JE FIGUR. Ein Einzelpreis
 * müsste geschätzt oder rechnerisch zugeteilt werden — gekauft wurde ein Los
 * zu einem Preis, und genau das steht darauf.
 *
 * ---------------------------------------------------------------------------
 * GLEICHE FIGUREN WERDEN FÜR DIE ANZEIGE ZUSAMMENGEFASST.
 *
 * Drei Zeilen `SKY-0008` werden eine Zeile mit Stückzahl 3. Das betrifft
 * AUSSCHLIESSLICH dieses PDF: die Positionen im Orderbuch, ihre Nummern und
 * ihre Zuordnung bleiben, wie sie sind, und auch der Snapshot in
 * `purchase_receipts.lines` behält jede einzelne. Zusammengefasst wird beim
 * Zeichnen, nicht beim Speichern.
 *
 * Die Gesamtstückzahl steht unter der Tabelle und ist die Summe über ALLE
 * Snapshot-Positionen — sie kann sich durch das Zusammenfassen nicht ändern,
 * und ein Test rechnet das nach.
 *
 * ---------------------------------------------------------------------------
 * DIESE DATEI IST ABSICHTLICH REDUNDANT — dieselbe Regel wie bei Format 1.
 * Eigene Beschriftungen, eigene Hilfsfunktionen. Was eingefroren werden soll,
 * darf von nichts abhängen, was sich ändern darf.
 */
import { PdfPage } from "@/lib/legal/invoice-pdf";
import { isCorrection } from "@/lib/business/purchase-receipt";
import type { ReceiptDocument, ReceiptLine } from "@/lib/business/purchase-receipt";

const PLATFORMS: Record<string, string> = {
  kleinanzeigen: "Kleinanzeigen",
  ebay: "eBay",
  willhaben: "Willhaben",
  manual: "Manuell / Sonstige",
};
const PAYMENTS: Record<string, string> = {
  card: "Kreditkarte",
  paypal: "PayPal",
  transfer: "Überweisung",
  cash: "Bargeld",
  platform: "Plattformzahlung",
};

/** Der Satz, der aus einem Zettel einen Eigenbeleg macht. */
const NOTE_V2 =
  "Ankauf von einer Privatperson. Der Verkäufer hat keine Rechnung ausgestellt "
  + "und weist keine Umsatzsteuer aus; ein Vorsteuerabzug ist daraus nicht "
  + "möglich. Dieser Beleg wurde vom Käufer selbst erstellt (Eigenbeleg).";

/**
 * Der Satz, der eine Korrektur erklärt (0128).
 *
 * Er nennt nur Nachprüfbares: welcher Beleg ersetzt wird, dass der ersetzte
 * aufbewahrt bleibt (ein Trigger lehnt jedes UPDATE und DELETE ab) und welcher
 * von beiden für den Ankauf gilt.
 */
const KORREKTUR_SATZ = (number: string, datum: string): string =>
  `Dieser Beleg ersetzt den Eigenbeleg ${number} vom ${datum}. Der ersetzte `
  + "Beleg bleibt unverändert aufbewahrt und wird nicht neu ausgestellt; er "
  + "beschreibt den Stand seines Ausstellungstags. Für diesen Ankauf gilt der "
  + "vorliegende Beleg.";

/** „13" → „13,00 EUR". `U+20AC` ist in WinAnsi nicht darstellbar. */
function money(value: string | number | null | undefined): string {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  return `${(Number.isFinite(n) ? n : 0).toFixed(2).replace(".", ",")} EUR`;
}

const amount = (value: string | number | null | undefined): number => {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** Ziffern, feste Zeitzone, kein übersetztes Wort — unabhängig von CLDR. */
const BERLIN = new Intl.DateTimeFormat("en-CA", {
  year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Europe/Berlin",
});

function germanDate(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-");
    return `${d}.${m}.${y}`;
  }
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return "–";
  const [y, m, d] = BERLIN.format(instant).split("-");
  return `${d}.${m}.${y}`;
}

function wrap(text: string, max: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if (word === "") continue;
    if (line.length + word.length + 1 > max) { out.push(line); line = word; }
    else line = line === "" ? word : `${line} ${word}`;
  }
  if (line !== "") out.push(line);
  return out;
}

/** Eine Zeile der gedruckten Tabelle. */
export type ReceiptRow = { sky_id: string | null; name: string; quantity: number };

/**
 * Gleiche Figuren zu einer Zeile zusammenfassen — NUR FÜR DIE ANZEIGE.
 *
 * DREI FÄLLE, UND DER DRITTE IST DER GEFÄHRLICHE.
 *
 * 1. MIT SKY-ID wird darüber gruppiert. Die SKY-ID ist eine dauerhafte
 *    Identität (Regel 2); zwei Zeilen mit derselben sind dieselbe Figur.
 *
 * 2. OHNE SKY-ID, ABER MIT NAMEN wird über den Namen gruppiert — roh, ohne
 *    Trimmen und ohne Kleinschreibung. Der Name ist die einzige Identität,
 *    die der Betreiber vergeben hat, und ihn zu normalisieren hiesse, zwei
 *    verschieden getippte Dinge zu einem zu erklären (Regel 4). „Portal "
 *    und „Portal" bleiben deshalb zwei Zeilen.
 *
 * 3. OHNE SKY-ID UND OHNE NAMEN wird NICHT gruppiert. Jede solche Position
 *    bekommt ihre eigene Zeile.
 *
 *    Das war die erste Fassung falsch: sie setzte den Platzhalter „—" als
 *    Namen ein und gruppierte darüber. Zwei verschiedene unbenannte
 *    Positionen — etwa zwei Arbeitsmappenzeilen ohne Zuordnung — wären zu
 *    einer Zeile „— ×2" verschmolzen. Über einen Platzhalter zu gruppieren
 *    heisst, eine Identität zu erfinden, die es nicht gibt.
 *
 * Die Reihenfolge ist die des ersten Auftretens, nicht alphabetisch: so
 * entspricht die gedruckte Folge der des Orderbuchs.
 */
export function groupLines(lines: readonly ReceiptLine[]): ReceiptRow[] {
  const rows: ReceiptRow[] = [];
  const seen = new Map<string, ReceiptRow>();
  lines.forEach((line, index) => {
    const sky = line.sky_id === null ? "" : line.sky_id.trim();
    const name = line.name === null ? "" : line.name;

    /*
     * `index` als Schlüssel heisst: diese Zeile trifft auf keine andere.
     * Genau das ist für Fall 3 gewollt.
     */
    const key = sky !== "" ? `sky:${sky}`
      : name.trim() !== "" ? `name:${name}`
        : `row:${index}`;

    const found = seen.get(key);
    if (found) { found.quantity += 1; return; }
    const row = { sky_id: line.sky_id, name: name === "" ? "—" : name, quantity: 1 };
    seen.set(key, row);
    rows.push(row);
  });
  return rows;
}

const label = (table: Record<string, string>, key: string | null): string | null =>
  key === null || key === "" ? null : table[key] ?? key;

/* Kompakte Geometrie: eine Tabellenzeile kostet 11,5 Punkte statt 14. */
const ROW = 11.5;
const HEAD = 13;

/**
 * Den Beleg zeichnen.
 *
 * Der Seitenumbruch kommt aus `PdfPage` (seit Schritt 1). Was diese Datei
 * dazu beiträgt, sind drei Dinge: `reserve()` vor jeder Zeile, damit keine
 * zerschnitten wird; die WIEDERHOLTE Tabellenüberschrift, sobald ein Umbruch
 * stattgefunden hat; und `reserve()` über die Summen- und Hinweisblöcke, die
 * zusammen gelesen werden müssen.
 */
export function renderReceiptV2(doc: ReceiptDocument): Uint8Array {
  const page = new PdfPage();
  const right = page.right;
  const rows = groupLines(doc.lines);
  const pieces = doc.lines.length;

  /* ---- Kopf --------------------------------------------------------------- */
  /*
   * DER TITEL SAGT, WELCHE ART DOKUMENT DAS IST (0128).
   *
   * Ein Korrekturbeleg, der wie ein Original aussieht, wäre das
   * dokumentarisch gefährlichste Ergebnis dieser Funktion — er träte neben
   * den ersetzten Beleg und niemand sähe, dass er ihn ersetzt. Deshalb
   * steht der Vermerk im TITEL und nicht in einer Fußnote.
   *
   * Ein Ursprungsbeleg nimmt diesen Zweig nicht: `isCorrection()` ist für
   * ihn falsch, und er wird gezeichnet wie vorher. Das ist die Zusicherung,
   * an der die festgehaltenen Hashes hängen.
   */
  const korrektur = isCorrection(doc);
  page.text(korrektur ? "Eigenbeleg – Korrektur" : "Eigenbeleg über einen Privatankauf",
            { size: 15, font: "bold" });
  page.rule(8);

  page.text(`Belegnummer   ${doc.receipt_number}`, { size: 9, dy: 16 });
  page.text(`Belegdatum    ${germanDate(doc.issued_at)}`, { size: 9, dy: 11 });
  page.text(`Kaufdatum     ${germanDate(doc.purchased_at)}`, { size: 9, dy: 11 });

  /*
   * DER VERWEIS AUF DEN ERSETZTEN BELEG (0128).
   *
   * Nummer UND Ausstellungsdatum, beide aus dem eigenen Snapshot — nicht aus
   * einer zweiten Zeile nachgeschlagen. Wer dieses Dokument in zehn Jahren in
   * der Hand hält, soll ohne Datenbank sagen können, welchen Beleg es ersetzt.
   *
   * Ein Ursprungsbeleg nimmt diesen Zweig nicht und wird gezeichnet wie
   * vorher — daran hängen die festgehaltenen Hashes der ausgestellten Belege.
   */
  if (korrektur) {
    page.text(`Ersetzt Beleg ${doc.supersedes_number} vom `
              + `${germanDate(doc.supersedes_issued_at ?? "")}`,
              { size: 9, dy: 11 });
    page.text(`Revision      ${doc.revision}`, { size: 9, dy: 11 });
  }

  /* ---- die zwei Parteien -------------------------------------------------- */
  const column = page.left + 265;
  const buyer = [
    doc.buyer_legal_name,
    doc.buyer_trade_name ?? "",
    doc.buyer_street,
    `${doc.buyer_postal_code} ${doc.buyer_city}`,
    doc.buyer_country,
    doc.buyer_email ?? "",
    doc.buyer_vat_id ? `USt-IdNr. ${doc.buyer_vat_id}` : "",
  ].filter((line) => line.trim() !== "");

  /* Fehlende Angaben werden weggelassen, nicht erfunden und nicht beklagt. */
  const vendor = [
    doc.sender_name ?? "",
    doc.sender_street ?? "",
    `${doc.sender_postal_code ?? ""} ${doc.sender_city ?? ""}`.trim(),
    doc.sender_country ?? "",
  ].filter((line) => line.trim() !== "");

  const partyRows = Math.max(buyer.length, vendor.length);
  page.reserve(20 + 4 + 12 + 11 * partyRows);
  page.text("Käufer", { size: 8.5, font: "bold", dy: 20 });
  if (vendor.length > 0) {
    page.text("Verkäufer (Privatperson)", { x: column, size: 8.5, font: "bold" });
  }
  page.rule(4);
  for (let i = 0; i < partyRows; i += 1) {
    page.text(buyer[i] ?? "", { size: 9, dy: i === 0 ? 12 : 11 });
    if (vendor[i]) page.text(vendor[i], { x: column, size: 9 });
  }

  /* ---- Herkunft: nur, was erfasst ist ------------------------------------- */
  const origin: [string, string][] = [];
  const platform = label(PLATFORMS, doc.seller_platform);
  if (platform) origin.push(["Plattform", platform]);
  if (doc.seller_handle) origin.push(["Benutzername", doc.seller_handle]);
  if (doc.listing_ref) origin.push(["Inserats-ID", doc.listing_ref]);
  if (doc.listing_title) origin.push(["Inseratstitel", doc.listing_title]);
  if (doc.listing_url) origin.push(["Inserat", doc.listing_url]);

  if (origin.length > 0) {
    page.reserve(20 + 4 + 12 + 11 * origin.length);
    page.text("Herkunft", { size: 8.5, font: "bold", dy: 20 });
    page.rule(4);
    origin.forEach(([key, value], index) => {
      page.text(`${key.padEnd(14)}${value}`, { size: 9, dy: index === 0 ? 12 : 11 });
    });
  }

  /* ---- die Figuren -------------------------------------------------------- */
  const head = () => {
    page.text("Pos", { size: 8, font: "bold", dy: HEAD });
    page.text("SKY-ID", { x: page.left + 30, size: 8, font: "bold" });
    page.text("Figurenname", { x: page.left + 98, size: 8, font: "bold" });
    page.textRight("Stück", right, { size: 8, font: "bold" });
  };

  page.reserve(20 + 4 + HEAD + ROW);
  page.text("Tatsächlich gekaufte Figuren", { size: 8.5, font: "bold", dy: 20 });
  page.rule(4);
  head();

  let sheet = page.pages;
  rows.forEach((row, index) => {
    /*
     * Erst Platz für die Zeile verlangen — das löst den Umbruch aus, falls
     * nötig. Hat er stattgefunden, bekommt die neue Seite ihre Überschrift,
     * BEVOR die Zeile fällt. Die Überschrift in die Reservierung
     * einzurechnen wäre falsch herum: sie würde am Fuss jeder Seite eine
     * Zeile Platz verschenken, die nicht gebraucht wird.
     */
    page.reserve(ROW);
    if (page.pages !== sheet) { sheet = page.pages; head(); }
    page.text(`${index + 1}.`, { size: 9, dy: ROW });
    page.text(row.sky_id ?? "—", { x: page.left + 30, size: 9 });
    page.text(row.name.slice(0, 52), { x: page.left + 98, size: 9 });
    page.textRight(String(row.quantity), right, { size: 9 });
  });

  page.reserve(6 + 12);
  page.rule(6);
  page.text(`Gesamtstückzahl: ${pieces}`, { size: 9, font: "bold", dy: 12 });

  /* ---- das Geld: ein Block, nie getrennt ---------------------------------- */
  const costs: [string, string][] = [];
  if (doc.items_cost !== null && doc.items_cost !== undefined) {
    costs.push(["Vereinbarter Kaufpreis", money(doc.items_cost)]);
    /* „soweit angefallen": eine Null ist keine Kostenzeile. */
    if (amount(doc.shipping_cost) > 0) costs.push(["Versand", money(doc.shipping_cost)]);
    if (amount(doc.buyer_protection_cost) > 0) {
      costs.push(["Käuferschutz", money(doc.buyer_protection_cost)]);
    }
  }
  const payment = label(PAYMENTS, doc.payment_method);

  page.reserve(20 + 4 + 12 + 11 * costs.length + 8 + 14 + (payment ? 12 : 0));
  page.text("Ausgabe", { size: 8.5, font: "bold", dy: 20 });
  page.rule(4);
  costs.forEach(([key, value], index) => {
    page.text(key, { size: 9, dy: index === 0 ? 12 : 11 });
    page.textRight(value, right, { size: 9 });
  });
  page.rule(8);
  page.text("Gesamtausgabe", { size: 10.5, font: "bold", dy: 14 });
  page.textRight(money(doc.total_cost), right, { size: 10.5, font: "bold" });
  if (payment) page.text(`Zahlungsart   ${payment}`, { size: 9, dy: 12 });

  /* ---- die Kaufvereinbarung, wenn es eine gibt ---------------------------- */
  if (doc.agreement_note) {
    const lines = wrap(doc.agreement_note, 100);
    page.reserve(20 + 4 + 12 * lines.length);
    page.text("Anmerkungen zur Kaufvereinbarung", { size: 8.5, font: "bold", dy: 20 });
    page.rule(4);
    lines.forEach((line, index) => page.text(line, { size: 9, dy: index === 0 ? 12 : 11 }));
  }

  /* ---- Hinweis und Unterschrift: zusammen, oder zusammen auf der nächsten -- */
  const note = wrap(NOTE_V2, 100);
  /* Nur auf einer Korrektur. Ein Ursprungsbeleg wird Zeile für Zeile wie
     vorher gezeichnet — daran hängen die festgehaltenen Hashes. */
  const korrekturNote = korrektur
    ? wrap(KORREKTUR_SATZ(doc.supersedes_number ?? "",
                          germanDate(doc.supersedes_issued_at ?? "")), 100)
    : [];
  page.reserve(18 + 4 + 11 * (note.length + korrekturNote.length) + 30 + 11);
  page.text("Hinweis", { size: 8.5, font: "bold", dy: 18 });
  page.rule(4);
  note.forEach((line, index) => page.text(line, { size: 8.5, dy: index === 0 ? 12 : 11 }));
  korrekturNote.forEach((line) => page.text(line, { size: 8.5, dy: 11 }));

  page.gap(30);
  page.text("_______________________________", { size: 8.5 });
  page.text("_______________________________", { x: column, size: 8.5 });
  page.text("Ort, Datum", { size: 7.5, dy: 11 });
  page.text("Unterschrift des Ausstellers", { x: column, size: 7.5 });

  /* Belegnummer und Seitenzahl auf JEDER Seite — auch auf einer einzelnen. */
  return page.render(`Eigenbeleg ${doc.receipt_number}`, doc.receipt_number);
}
