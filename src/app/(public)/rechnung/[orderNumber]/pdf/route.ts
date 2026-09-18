/**
 * Die Rechnung als PDF (ADR-0086).
 *
 * Rendered on demand from the immutable `invoices` row — **nothing is stored**.
 * There is therefore no file that could be left in a bucket, and the only
 * bucket this project has is public (migration 0007), which is exactly the
 * mistake this avoids.
 *
 * Authorisation is the database's: `invoice_document()` asks
 * `authorize_order_payment()`, so the signed-in owner or the holder of the
 * order's capability gets a document and everybody else gets a 404. The guest
 * capability travels as `?t=` because a download is a plain navigation and
 * cannot read `sessionStorage`; no third-party resource is loaded by this
 * route or the page that links to it, so the value does not leave in a
 * referrer.
 */
import { type NextRequest } from "next/server";

import { fetchInvoice, renderInvoicePdf } from "@/lib/legal/invoice";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ orderNumber: string }> },
) {
  const { orderNumber } = await context.params;
  const token = request.nextUrl.searchParams.get("t");

  const invoice = await fetchInvoice(orderNumber, token);
  if (invoice === null) {
    return new Response("Not found", { status: 404 });
  }

  const pdf = renderInvoicePdf(invoice);

  return new Response(pdf as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${invoice.invoice_number}.pdf"`,
      // A customer's invoice must never be held by a shared cache.
      "Cache-Control": "private, no-store",
    },
  });
}
