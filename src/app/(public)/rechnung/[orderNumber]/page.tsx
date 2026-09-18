import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { InvoiceView } from "@/components/legal/invoice-view";
import { fetchInvoice } from "@/lib/legal/invoice";

export const metadata: Metadata = { title: "Rechnung" };
export const dynamic = "force-dynamic";

/**
 * Die Rechnung, als Seite (ADR-0086).
 *
 * THE HTML IS THE PRIMARY DOCUMENT and the PDF is the download beside it. A
 * hand-written PDF cannot be a tagged PDF (see `invoice-pdf.ts`), so a reader
 * who depends on assistive technology would be worse served by a PDF-only
 * invoice. Here the same figures are a real `<table>` with real headers.
 *
 * WHO MAY SEE IT is decided by `invoice_document()` in the database: the
 * signed-in owner, or the holder of the capability issued when the order was
 * placed (migration 0013). A guest passes that capability as `?t=`; a signed-in
 * customer needs nothing. An unknown order and somebody else's order answer
 * identically — 404 — so the page cannot be used to find out which order
 * numbers exist.
 */
export default async function InvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ orderNumber: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const { orderNumber } = await params;
  const { t } = await searchParams;

  const invoice = await fetchInvoice(orderNumber, t ?? null);
  // 404 for "no such order", "not yours" and "not invoiced yet" alike. Three
  // different answers would be three ways to learn something about an order
  // that is not the caller's.
  if (invoice === null) notFound();

  return <InvoiceView invoice={invoice} token={t ?? null} />;
}
