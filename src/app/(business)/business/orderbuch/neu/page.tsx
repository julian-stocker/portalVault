import type { Metadata } from "next";
import Link from "next/link";

import { NewPurchase } from "@/components/business/new-purchase";
import { de } from "@/lib/i18n/de";
import { fetchOrderbookCatalog } from "@/lib/orderbook/queries";

export const metadata: Metadata = { title: de.business.orderbook.newPurchase };

/**
 * `?test=1` arrives when the form was opened from the Test view, so the box is
 * already ticked and the operator is not asked to reclassify a record they
 * created two seconds ago. It is a default, not a lock — the checkbox is still
 * there and still theirs.
 */
export default async function NewPurchasePage({ searchParams }: {
  searchParams: Promise<{ test?: string }>;
}) {
  /*
   * The catalog ships with the page, exactly as it does on the detail screen:
   * one query here rather than one per keystroke over a phone connection,
   * which is what makes the search instant while holding a figure.
   */
  const [{ test }, catalog] = await Promise.all([searchParams, fetchOrderbookCatalog()]);
  return (
    <main className="mx-auto w-full max-w-lg px-4 pt-8 pb-10 md:pt-12">
      <Link href="/business/orderbuch"
            className="inline-flex min-h-11 items-center text-sm text-muted hover:text-fg">
        ← {de.business.orderbook.back}
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">
        {de.business.orderbook.newPurchase}
      </h1>
      <NewPurchase defaultTest={test === "1"} catalog={catalog} />
    </main>
  );
}
