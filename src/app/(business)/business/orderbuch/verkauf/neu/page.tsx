import type { Metadata } from "next";
import Link from "next/link";

import { NewSale } from "@/components/business/new-sale";
import { de } from "@/lib/i18n/de";
import { fetchOrderbookCatalog } from "@/lib/orderbook/queries";

export const metadata: Metadata = { title: de.business.sales.create.title };

/** `?test=1` when the form was opened from the Test view. A default, not a lock. */
export default async function NewSalePage({ searchParams }: {
  searchParams: Promise<{ test?: string }>;
}) {
  /* The catalog ships with the page, as it does on every other figure
     screen: one query here rather than one per keystroke on a phone. */
  const [{ test }, catalog] = await Promise.all([searchParams, fetchOrderbookCatalog()]);
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pt-8 pb-10 md:pt-12">
      <Link href="/business/orderbuch/verkauf?bereich=extern"
            className="inline-flex min-h-11 items-center text-sm text-muted hover:text-fg">
        ← {de.business.sales.backToLedger}
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">
        {de.business.sales.create.title}
      </h1>
      <NewSale defaultTest={test === "1"} catalog={catalog} />
    </main>
  );
}
