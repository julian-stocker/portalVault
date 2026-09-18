import type { Metadata } from "next";
import Link from "next/link";

import { InventoryImport } from "@/components/admin/inventory-import";
import { fetchImportCatalog, fetchImportMappings, fetchImports } from "@/lib/admin/import-queries";
import { de } from "@/lib/i18n/de";

export const metadata: Metadata = { title: de.business.imports.title };
export const dynamic = "force-dynamic";

/**
 * Bestand abgleichen (ADR-0087).
 *
 * The catalog travels with the page rather than being fetched from the browser:
 * 600 rows in the payload that already has to be sent beats 600 rows fetched
 * over a phone connection while the owner waits.
 *
 * Everything else happens in the client component, because the spreadsheet is
 * on the device and there is no reason to move 450 MB of pictures to read
 * 614 numbers.
 */
export default async function InventoryImportPage() {
  const [catalog, mappings, history] = await Promise.all([
    fetchImportCatalog(),
    fetchImportMappings(),
    fetchImports(),
  ]);

  const copy = de.business.imports;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pt-8 pb-10 md:pt-12">
      <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{copy.title}</h1>
      <p className="mt-2 text-sm text-muted">
        <Link href="/business/inventory" className="underline underline-offset-4">
          {de.business.areas.inventory.title}
        </Link>
      </p>

      <div className="mt-8">
        <InventoryImport catalog={catalog} mappings={Object.fromEntries(mappings)} />
      </div>

      <section className="mt-12">
        <h2 className="text-sm font-semibold">{copy.history}</h2>
        {history.length === 0 ? (
          <p className="mt-2 text-sm text-muted">{copy.historyEmpty}</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {history.map((entry) => (
              <li
                key={entry.id}
                className="rounded-sky-md bg-surface/80 px-4 py-3 text-sm ring-1 ring-border/70"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="font-medium">{entry.file_name}</span>
                  <span className="text-xs text-muted tabular-nums">
                    {new Date(entry.created_at).toLocaleString(de.locale)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted tabular-nums">
                  {entry.state === "applied"
                    ? `${entry.increases} ↑ · ${entry.decreases} ↓ · ${entry.unchanged} = · ${entry.ignored_rows} ${copy.ignored}`
                    : copy.neverApplied}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
