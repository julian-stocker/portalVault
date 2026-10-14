/**
 * Der Eigenbeleg über einen Privatankauf: die Form, und wer sie zeichnet.
 *
 * ---------------------------------------------------------------------------
 * DAS FORMAT IST VERSIONIERT, UND ZWAR AUS EINEM HARTEN GRUND.
 *
 * Ein Eigenbeleg wird nicht als Datei gespeichert. Er entsteht bei jedem
 * Download neu aus dem eingefrorenen Snapshot in `purchase_receipts`. Das ist
 * die richtige Entscheidung — es gibt keine Datei, die in einem Ablageeimer
 * liegen bleiben könnte, und der einzige Eimer dieses Projekts ist öffentlich.
 *
 * Es hat aber eine Folge, die man leicht übersieht: WER DEN RENDERER ÄNDERT,
 * ÄNDERT JEDEN BEREITS AUSGESTELLTEN BELEG MIT. Die Daten bleiben, das
 * Dokument nicht. Der Betreiber hätte ein PDF abgelegt und bekäme beim
 * erneuten Herunterladen ein anderes — bei einem Beleg, der zehn Jahre
 * aufbewahrt wird, ist das kein Schönheitsfehler.
 *
 * Also trägt jeder Beleg seine Formatnummer, und zu jeder Nummer gibt es
 * einen Zeichner, der danach nicht mehr angefasst wird:
 *
 *     format_version = 1   receipt-format-v1.ts   eingefroren
 *     format_version = 2   receipt-format-v2.ts   kompakt, für grosse Ankäufe
 *
 * ---------------------------------------------------------------------------
 * WAS PASSIERT, SOLANGE `0123` NICHT ANGEWENDET IST.
 *
 * Die Spalte `format_version` kommt mit `0123`. Fehlt sie im Snapshot, liest
 * `formatOf()` eine 1 — und das ist richtig so: solange die Datenbank keine
 * Formatnummer führt, entstehen und bleiben alle Belege im Format 1. Das neue
 * Format wird erst wirksam, wenn die Migration es auch aufschreiben kann.
 * Kein Beleg bekommt still ein Format, das niemand vermerkt hat.
 *
 * ---------------------------------------------------------------------------
 * DIE GRENZE DIESER ZUSICHERUNG, EHRLICH BENANNT.
 *
 * Die Formatdateien besitzen ihre Beschriftungen und Hilfsfunktionen selbst.
 * Was sie NICHT besitzen, ist `PdfPage` — Zeichensatz, Geometrie und
 * Seitenumbruch teilen sie mit der Kundenrechnung. Eine Änderung dort kann
 * ein altes Dokument sehr wohl verschieben.
 *
 * Verhindern lässt sich das nicht, ohne die Engine dreifach zu kopieren.
 * Aufdecken lässt es sich: `purchase-receipt.test.ts` hält den SHA-256 des
 * echten, auf Staging ausgestellten Belegs `SI-E-2026-000001` fest. Bewegt
 * sich ein einziges Byte, schlägt der Test an. Die Zusicherung lautet also
 * nicht „kann sich nicht ändern", sondern „kann sich nicht STILL ändern".
 */
import { renderReceiptV1 } from "@/lib/business/receipt-format-v1";
import { renderReceiptV2 } from "@/lib/business/receipt-format-v2";

/**
 * Eine eingefrorene Position. Genau die vier Felder, die `0122` kopiert.
 *
 * KEIN `state`. Der Buchungszustand einer Figur — bestellt, angekommen,
 * eingebucht, beschädigt, fehlt — ist ihr Lagerweg und nicht Teil des
 * Ankaufs. Ein Beleg, der ihn ausweist, behauptet mehr, als er einfrieren
 * kann: er stünde fest, während die Figur drei Tage später eingebucht wird.
 */
export type ReceiptLine = {
  position: number;
  sky_id: string | null;
  name: string | null;
  /**
   * Lose oder originalverpackt.
   *
   * `0122` kopiert es, und das bleibt so — ein Snapshot wird nicht kleiner,
   * nur weil ein Format es nicht mehr druckt. Format 1 zeigt es als Spalte
   * „Ausführung", Format 2 nicht mehr: bei hundert Figuren ist es eine
   * Spalte, die den Beleg verlängert, ohne den Ankauf zu dokumentieren.
   */
  condition: string;
};

/**
 * Der eingefrorene Beleg, so wie `seller_purchase_receipt_document()` ihn
 * zurückgibt. Was hier nicht steht, steht auch nicht in der Tabelle.
 */
export type ReceiptDocument = {
  id: number;
  purchase_id: number;
  receipt_number: string;
  issued_at: string;
  revision: number;
  supersedes_id: number | null;
  /** Fehlt, solange `0123` nicht angewendet ist — siehe `formatOf()`. */
  format_version?: number | null;

  buyer_legal_name: string;
  buyer_trade_name: string | null;
  buyer_street: string;
  buyer_postal_code: string;
  buyer_city: string;
  buyer_country: string;
  buyer_email: string | null;
  buyer_vat_id: string | null;

  seller_platform: string | null;
  seller_handle: string | null;
  sender_name: string | null;
  sender_street: string | null;
  sender_postal_code: string | null;
  sender_city: string | null;
  sender_country: string | null;
  listing_ref: string | null;
  listing_title: string | null;
  listing_url: string | null;
  listing_details: string | null;

  purchased_at: string;
  items_cost: string | number | null;
  shipping_cost: string | number | null;
  buyer_protection_cost: string | number | null;
  total_cost: string | number;
  currency: string;
  payment_method: string | null;
  agreement_note: string | null;

  lines: ReceiptLine[];
};

/**
 * Das Format, in dem NEUE Belege ausgestellt werden.
 *
 * Diese Zahl steht hier als Dokumentation und für die Tests; geschrieben wird
 * sie von `seller_issue_purchase_receipt` in `0123`. Die Datenbank ist die
 * Autorität darüber, welches Format ein Beleg trägt — nicht der
 * Anwendungscode, der im nächsten Deployment ein anderer sein kann.
 */
export const RECEIPT_FORMAT_CURRENT = 2;

/** Die Formate, zu denen es einen Zeichner gibt. */
export const RECEIPT_FORMATS = [1, 2] as const;

/**
 * Welches Format gilt für diesen Beleg?
 *
 * Fehlt die Angabe — weil `0123` noch nicht angewendet ist —, ist es 1. Eine
 * unbekannte Nummer fällt ebenfalls auf 1 zurück, statt zu scheitern: ein
 * Beleg, der sich nicht zeichnen lässt, wäre schlimmer als einer in der alten
 * Form, und ein Test hält fest, dass jede ausgestellte Nummer einen Zeichner
 * hat.
 */
export function formatOf(doc: ReceiptDocument): number {
  const version = Number(doc.format_version ?? 1);
  return RECEIPT_FORMATS.includes(version as 1 | 2) ? version : 1;
}

/** Den Beleg zeichnen — in dem Format, in dem er ausgestellt wurde. */
export function renderPurchaseReceiptPdf(doc: ReceiptDocument): Uint8Array {
  return formatOf(doc) === 2 ? renderReceiptV2(doc) : renderReceiptV1(doc);
}
