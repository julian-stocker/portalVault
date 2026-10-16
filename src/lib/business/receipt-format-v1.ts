/**
 * BELEGFORMAT 1 — EINGEFROREN. NICHT MEHR ÄNDERN.
 *
 * Diese Datei zeichnet jeden Eigenbeleg mit `format_version = 1`. Das sind
 * alle, die bis einschliesslich `SI-E-2026-000001` ausgestellt wurden.
 *
 * ---------------------------------------------------------------------------
 * WARUM ES SIE GIBT.
 *
 * Ein Eigenbeleg wird NICHT als Datei gespeichert; er wird bei jedem Download
 * aus dem eingefrorenen Snapshot neu gezeichnet. Das ist richtig — es gibt
 * keine Datei, die irgendwo liegen bleiben kann — hat aber eine Folge, die
 * leicht zu übersehen ist: wer den Renderer ändert, ändert JEDEN bereits
 * ausgestellten Beleg mit, obwohl dessen Daten unverändert sind. Der
 * Betreiber hätte ein PDF abgelegt und bekäme beim erneuten Herunterladen
 * ein anderes.
 *
 * Deshalb ist das Format versioniert. Jeder Beleg trägt in
 * `purchase_receipts.format_version`, mit welchem Zeichner er entstanden ist,
 * und dieser Zeichner wird danach nicht mehr angefasst.
 *
 * ---------------------------------------------------------------------------
 * DIESE DATEI IST ABSICHTLICH REDUNDANT.
 *
 * Sie trägt ihre eigenen Hilfsfunktionen und ihre Beschriftungen als
 * LITERALE — auch solche, die anderswo noch einmal stehen. Ein eingefrorenes
 * Dokumentformat darf von nichts abhängen, was sich ändern darf: würde
 * `modal.itemsCost` eines Tages umbenannt, stünde sonst auf einem Beleg von
 * 2026 ein anderes Wort als damals.
 *
 * WAS SIE NICHT SELBST BESITZT, ist `PdfPage` — Zeichensatz, Geometrie und
 * Seitenumbruch teilt sie mit der Kundenrechnung. Eine Änderung dort könnte
 * diesen Beleg sehr wohl verschieben. Lautlos kann sie es nicht:
 * `purchase-receipt.test.ts` hält den SHA-256 des echten Belegs
 * `SI-E-2026-000001` fest und schlägt an, sobald sich ein Byte bewegt.
 */
import { PdfPage } from "@/lib/legal/invoice-pdf";
import { isCorrection } from "@/lib/business/purchase-receipt";
import type { ReceiptDocument } from "@/lib/business/purchase-receipt";

/*
 * DIE BESCHRIFTUNGEN ALS LITERALE, nicht aus `de.ts`. Die Werte sind die von
 * `de.business.orderbook.detailsModal` an dem Tag, an dem `SI-E-2026-000001`
 * ausgestellt wurde.
 */
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
const ITEMS_COST = "Kaufpreis";
const SHIPPING_COST = "Versand";
const PROTECTION_COST = "Käuferschutz";

/** Der Satz, eingefroren wie alles andere in dieser Datei. */
const NOTE_V1 =
  "Dieser Beleg dokumentiert einen Ankauf von einer Privatperson. Der Verkäufer "
  + "hat keine Rechnung ausgestellt und weist keine Umsatzsteuer aus; ein "
  + "Vorsteuerabzug ist daraus nicht möglich. Der Beleg wurde vom Käufer selbst "
  + "erstellt (Eigenbeleg).";

/**
 * Der Satz, der eine Korrektur erklärt (0128).
 *
 * Er nennt nur Nachprüfbares: welcher Beleg ersetzt wird, dass der ersetzte
 * aufbewahrt bleibt (ein Trigger lehnt jedes UPDATE und DELETE ab) und welcher
 * von beiden für den Ankauf gilt. Keine Aussage über steuerliche Gültigkeit —
 * die trifft dieses Dokument nicht.
 */
const KORREKTUR_SATZ = (number: string, datum: string): string =>
  `Dieser Beleg ersetzt den Eigenbeleg ${number} vom ${datum}. Der ersetzte `
  + "Beleg bleibt unverändert aufbewahrt und wird nicht neu ausgestellt; er "
  + "beschreibt den Stand seines Ausstellungstags. Für diesen Ankauf gilt der "
  + "vorliegende Beleg.";

/** „13" → „13,00 EUR". Zum Eurozeichen siehe den Dateikopf. */
function money(value: string | number | null | undefined): string {
  const number = typeof value === "number" ? value : Number(value ?? 0);
  return `${(Number.isFinite(number) ? number : 0).toFixed(2).replace(".", ",")} EUR`;
}

/**
 * Nur Ziffern, feste Zeitzone, kein übersetztes Wort.
 *
 * `en-CA` liefert `YYYY-MM-DD`; daraus wird `TT.MM.JJJJ` von Hand gebaut.
 * Dieselbe Technik wie `berlinToday()` in `src/lib/format.ts`, und aus
 * demselben Grund: ein Datum, das in der Zeitzone der Laufzeit gelesen wird,
 * ist auf einem Dokument ein Fehler.
 */
const BERLIN = new Intl.DateTimeFormat("en-CA", {
  year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Europe/Berlin",
});

function germanDate(value: string): string {
  /* Ein reines Kalenderdatum hat keine Zeitzone und wird nicht verschoben. */
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-");
    return `${d}.${m}.${y}`;
  }
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return "–";
  const [y, m, d] = BERLIN.format(instant).split("-");
  return `${d}.${m}.${y}`;
}

/** Umbruch auf Wortgrenzen. Dieselbe schlichte Form wie bei der Rechnung. */
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

const label = (table: Record<string, string>, key: string | null, fallback: string): string =>
  key === null ? fallback : table[key] ?? key;

/** Wortgleich mit der Kundenrechnung (`src/lib/legal/invoice.ts`). */
const conditionLabel = (condition: string): string =>
  condition === "sealed" ? "originalverpackt" : "lose";

/**
 * Den Beleg zeichnen.
 *
 * Schlicht und einspaltig, wie die Rechnung: ein Beleg wird einmal gelesen
 * und abgelegt. `reserve()` hält zusammen, was zusammengehört — seit
 * Schritt 1 bricht die Engine um, statt unten aus dem Blatt zu laufen.
 */
export function renderReceiptV1(doc: ReceiptDocument): Uint8Array {
  const page = new PdfPage();
  const right = page.right;
  const missing = "nicht erfasst";

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
            { size: 16, font: "bold" });
  page.rule(10);

  page.text(`Belegnummer       ${doc.receipt_number}`, { size: 9.5, dy: 20 });
  page.text(`Belegdatum        ${germanDate(doc.issued_at)}`, { size: 9.5, dy: 13 });
  page.text(`Kaufdatum         ${germanDate(doc.purchased_at)}`, { size: 9.5, dy: 13 });

  /*
   * DER VERWEIS AUF DEN ERSETZTEN BELEG (0128).
   *
   * Nummer UND Ausstellungsdatum, beide aus dem eigenen Snapshot — nicht aus
   * einer zweiten Zeile nachgeschlagen. Wer dieses Dokument in zehn Jahren in
   * der Hand hält, soll ohne Datenbank sagen können, welchen Beleg es ersetzt.
   *
   * Der Satz darunter sagt, was mit dem ersetzten Beleg geschehen ist: er ist
   * nicht verschwunden und nicht geändert. Beides ist nachprüfbar — ein
   * Trigger lehnt jedes UPDATE und DELETE ab — und deshalb darf es dastehen.
   * Eine Aussage über steuerliche Gültigkeit steht NICHT da; die trifft dieses
   * Dokument nicht.
   */
  if (korrektur) {
    page.text(`Ersetzt Beleg     ${doc.supersedes_number} vom `
              + `${germanDate(doc.supersedes_issued_at ?? "")}`,
              { size: 9.5, dy: 13 });
    page.text(`Revision          ${doc.revision}`, { size: 9.5, dy: 13 });
  }

  /* ---- die zwei Parteien, nebeneinander ---------------------------------- */
  const column = page.left + 275;
  const buyer = [
    doc.buyer_legal_name,
    doc.buyer_trade_name ?? "",
    doc.buyer_street,
    `${doc.buyer_postal_code} ${doc.buyer_city}`,
    doc.buyer_country,
    doc.buyer_email ?? "",
    doc.buyer_vat_id ? `USt-IdNr. ${doc.buyer_vat_id}` : "",
  ].filter((line) => line.trim() !== "");

  /*
   * FEHLENDE ANGABEN WERDEN NICHT ERFUNDEN. Ein Absender, von dem nur der
   * Name bekannt ist, steht mit seinem Namen da und sonst nichts — und ist
   * gar nichts bekannt, sagt der Beleg genau das.
   */
  const vendor = [
    doc.sender_name ?? "",
    doc.sender_street ?? "",
    `${doc.sender_postal_code ?? ""} ${doc.sender_city ?? ""}`.trim(),
    doc.sender_country ?? "",
  ].filter((line) => line.trim() !== "");
  if (vendor.length === 0) vendor.push(missing);

  page.reserve(26 + 5 + 14 + 12 * Math.max(buyer.length, vendor.length));
  page.text("Käufer", { size: 9, font: "bold", dy: 26 });
  page.text("Verkäufer (Privatperson)", { x: column, size: 9, font: "bold" });
  page.rule(5);
  for (let i = 0; i < Math.max(buyer.length, vendor.length); i += 1) {
    page.text(buyer[i] ?? "", { size: 9.5, dy: i === 0 ? 14 : 12 });
    if (vendor[i]) page.text(vendor[i], { x: column, size: 9.5 });
  }

  /* ---- woher der Kauf kam ------------------------------------------------ */
  page.reserve(26 + 5 + 14 + 12 * 4);
  page.text("Herkunft", { size: 9, font: "bold", dy: 26 });
  page.rule(5);
  page.text(`Plattform         ${label(PLATFORMS, doc.seller_platform, missing)}`,
            { size: 9.5, dy: 14 });
  page.text(`Benutzername      ${doc.seller_handle ?? missing}`, { size: 9.5, dy: 12 });
  page.text(`Inserats-ID       ${doc.listing_ref ?? missing}`, { size: 9.5, dy: 12 });
  if (doc.listing_title) {
    page.text(`Inseratstitel     ${doc.listing_title}`, { size: 9.5, dy: 12 });
  }
  if (doc.listing_url) {
    page.text(`Inserat           ${doc.listing_url}`, { size: 9.5, dy: 12 });
  }
  if (doc.listing_details) {
    for (const line of wrap(doc.listing_details, 92)) {
      page.text(line, { size: 9, dy: 12 });
    }
  }

  /* ---- was tatsächlich gekauft wurde -------------------------------------- */
  page.reserve(26 + 5 + 13 + 14);
  page.text("Tatsächlich gekaufte Figuren", { size: 9, font: "bold", dy: 26 });
  page.rule(5);
  page.text("Pos", { size: 8.5, font: "bold", dy: 13 });
  page.text("SKY-ID", { x: page.left + 32, size: 8.5, font: "bold" });
  page.text("Bezeichnung", { x: page.left + 100, size: 8.5, font: "bold" });
  /*
   * KEINE SPALTE „ZUSTAND" MEHR. Sie trug den Buchungszustand, und der ist
   * operativ: er ändert sich beim Einbuchen, ohne dass sich am Ankauf etwas
   * ändert. Was bleibt, ist die Ausführung der Ware — dieselbe Angabe, die
   * die Kundenrechnung seit je als „(lose)" oder „(originalverpackt)" an den
   * Namen hängt.
   */
  page.textRight("Ausführung", right, { size: 8.5, font: "bold" });

  for (const line of doc.lines) {
    page.reserve(14);
    page.text(`${line.position}.`, { size: 9.5, dy: 14 });
    page.text(line.sky_id ?? "—", { x: page.left + 32, size: 9.5 });
    /*
     * Gekürzt, damit die Bezeichnung nicht in die Zustandsspalte läuft. Die
     * Engine schneidet nicht von sich aus; 44 Zeichen passen bei 9,5pt in die
     * Spalte zwischen SKY-ID und Zustand.
     */
    page.text((line.name ?? "—").slice(0, 44), { x: page.left + 100, size: 9.5 });
    page.textRight(conditionLabel(line.condition), right, { size: 9.5 });
  }

  /* ---- das Geld ----------------------------------------------------------- */
  page.reserve(26 + 5 + 14 + 12 + 12 + 10 + 16 + 18);
  page.text("Ausgabe", { size: 9, font: "bold", dy: 26 });
  page.rule(5);
  /*
   * Die Aufteilung nur, wenn sie erfasst ist. Für einen Einkauf von vor
   * `0115` ist sie unbekannt, und `total_cost` auf die Figurenzeile zu
   * schreiben hiesse behaupten, es habe keinen Versand gegeben.
   */
  if (doc.items_cost !== null) {
    page.text(ITEMS_COST, { size: 9.5, dy: 14 });
    page.textRight(money(doc.items_cost), right, { size: 9.5 });
    page.text(SHIPPING_COST, { size: 9.5, dy: 12 });
    page.textRight(money(doc.shipping_cost), right, { size: 9.5 });
    page.text(PROTECTION_COST, { size: 9.5, dy: 12 });
    page.textRight(money(doc.buyer_protection_cost), right, { size: 9.5 });
    page.rule(10);
  } else {
    page.text("Die Aufteilung der Kosten ist für diesen Einkauf nicht erfasst.",
              { size: 9, dy: 14 });
    page.rule(8);
  }
  page.text("Gesamtausgabe", { size: 11, font: "bold", dy: 16 });
  page.textRight(money(doc.total_cost), right, { size: 11, font: "bold" });
  page.text(`Zahlungsart       ${label(PAYMENTS, doc.payment_method, missing)}`,
            { size: 9.5, dy: 18 });

  /* ---- die Kaufvereinbarung, nur wenn es eine gibt ------------------------ */
  if (doc.agreement_note) {
    const lines = wrap(doc.agreement_note, 95);
    page.reserve(26 + 5 + 13 * lines.length);
    page.text("Anmerkungen zur Kaufvereinbarung", { size: 9, font: "bold", dy: 26 });
    page.rule(5);
    for (const line of lines) page.text(line, { size: 9.5, dy: 13 });
  }

  /* ---- der Hinweis -------------------------------------------------------- */
  const note = wrap(NOTE_V1, 95);
  /* Der Korrekturabsatz steht NUR auf einer Korrektur — ein Ursprungsbeleg
     bekommt keine Zeile mehr und keine weniger als vorher. */
  const korrekturNote = korrektur
    ? wrap(KORREKTUR_SATZ(doc.supersedes_number ?? "",
                          germanDate(doc.supersedes_issued_at ?? "")), 95)
    : [];
  page.reserve(26 + 5 + 13 * (note.length + korrekturNote.length));
  page.text("Hinweis", { size: 9, font: "bold", dy: 26 });
  page.rule(5);
  for (const line of note) page.text(line, { size: 9, dy: 13 });
  for (const line of korrekturNote) page.text(line, { size: 9, dy: 13 });

  /* ---- die Unterschriftszeile (M4) ---------------------------------------- */
  page.reserve(34 + 18 + 12);
  page.gap(34);
  page.text("_______________________________", { size: 9, dy: 0 });
  page.text("_______________________________", { x: column, size: 9 });
  page.text("Ort, Datum", { size: 8, dy: 12 });
  page.text("Unterschrift des Ausstellers", { x: column, size: 8 });

  return page.render(`Eigenbeleg ${doc.receipt_number}`);
}
