/**
 * Der Eigenbeleg als PDF (0122).
 *
 * KEINE DATEI, KEIN BUCKET, KEIN ÖFFENTLICHER LINK.
 *
 * Gerendert wird bei jedem Abruf aus der eingefrorenen Zeile in
 * `purchase_receipts`. Es gibt deshalb nichts, was in einem Ablageeimer
 * liegen bleiben könnte — und der einzige Eimer dieses Projekts ist seit
 * `0007` öffentlich, was genau der Fehler ist, den das vermeidet. Dieselbe
 * Entscheidung wie bei der Kundenrechnung.
 *
 * WARUM DER RIEGEL HIER NOCH EINMAL STEHT. Ein Route Handler geht nicht
 * durch das Layout von `(business)`; dessen `notFound()` schützt die Seiten,
 * nicht diese Datei. Also prüft sie selbst — wie
 * `business/datensicherung/download/route.ts` es seit je tut.
 *
 * UND WARUM 404 UND NICHT 403. Wie überall in diesem Projekt: unbekannt und
 * unzugänglich bekommen dieselbe Antwort. Ein „verboten" bestätigt, dass es
 * etwas gibt.
 *
 * DIESE ROUTE SCHREIBT NICHTS. Dass ein Abruf vollständig war, kann sie
 * nicht wissen — HTTP sagt es ihr nicht. Festgehalten wird eine Auslieferung
 * erst, wenn der Browser den SHA-256 der empfangenen Bytes vorgelegt hat;
 * das macht `confirmPurchaseReceiptDownload` in
 * `src/lib/business/receipt-actions.ts`.
 */
import { canOperateSeller } from "@/lib/auth/capabilities";
import { loadReceiptDocument } from "@/lib/business/receipt-actions";
import { renderPurchaseReceiptPdf } from "@/lib/business/purchase-receipt";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; receiptId: string }> },
): Promise<Response> {
  if (!(await canOperateSeller())) return new Response("Not found", { status: 404 });

  const { id, receiptId } = await context.params;
  const receipt = Number(receiptId);
  const purchase = Number(id);
  if (!Number.isInteger(receipt) || receipt <= 0
      || !Number.isInteger(purchase) || purchase <= 0) {
    return new Response("Not found", { status: 404 });
  }

  const document = await loadReceiptDocument(receipt);
  if (document === null) return new Response("Not found", { status: 404 });

  /*
   * Der Beleg muss zu dem Einkauf gehören, über dessen Adresse er abgerufen
   * wird. Sonst wäre die Nummer im Pfad Zierde, und ein vertippter Pfad
   * lieferte einen fremden Beleg aus.
   */
  if (Number(document.purchase_id) !== purchase) {
    return new Response("Not found", { status: 404 });
  }

  const pdf = renderPurchaseReceiptPdf(document);

  return new Response(pdf as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${document.receipt_number}.pdf"`,
      // Ein Beleg mit der Anschrift einer Privatperson gehört in keinen
      // geteilten Zwischenspeicher.
      "Cache-Control": "private, no-store",
    },
  });
}
