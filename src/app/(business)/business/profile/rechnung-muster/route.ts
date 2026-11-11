/**
 * The sample invoice as a PDF (ADR-0184, AP6) — `/business/profile/rechnung-muster`.
 *
 * ITS OWN GATE. A route handler is not wrapped by `(business)/layout.tsx`, so
 * the layout's seller check does not apply here. The handler asks the same
 * request-cached question itself, before it reads anything, and answers
 * everyone else with the 404 the seller area gives.
 *
 * Rendered by the real `renderInvoicePdf()` with the `specimen` label and
 * sample data from `specimenInvoice()`: no invoice is issued, numbered or
 * stored, and nothing is cached.
 */
import { canOperateSeller } from "@/lib/auth/capabilities";
import { fetchIdentity } from "@/lib/identity/server";
import { SPECIMEN_LABEL, specimenInvoice } from "@/lib/identity/specimen";
import { renderInvoicePdf } from "@/lib/legal/invoice";

export const dynamic = "force-dynamic";

const NOT_FOUND = () => new Response("Not found", { status: 404 });

export async function GET(): Promise<Response> {
  if (!(await canOperateSeller())) return NOT_FOUND();

  const load = await fetchIdentity();
  if (!load.ok) return NOT_FOUND();

  const pdf = renderInvoicePdf(specimenInvoice(load.identity, new Date()), { specimen: SPECIMEN_LABEL });
  return new Response(pdf as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      /* Opened in the browser's viewer; saving it keeps the label in the name. */
      "Content-Disposition": 'inline; filename="MUSTER-Rechnung.pdf"',
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
