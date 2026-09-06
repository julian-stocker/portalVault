import type { Metadata } from "next";

import { InventoryView } from "@/components/admin/inventory-view";
import { fetchInventory, fetchMovements, type Movement } from "@/lib/admin/inventory";
import { fetchCatalog, fetchSeries } from "@/lib/catalog/queries";
import { de } from "@/lib/i18n/de";

export const metadata: Metadata = { title: `${de.inventory.title} · ${de.admin.title}` };

/**
 * The operator's stock.
 *
 * Protected by `(admin)/layout.tsx` like every other page here — and by the
 * database underneath it, where all four shop functions ask
 * `is_shop_admin()` themselves (ADR-0037, migration 0005).
 *
 * The catalog is loaded with hidden figures included, the same call the admin
 * catalog uses: a figure taken out of the public catalog can still sit in a
 * box on a shelf. Its scope is what keeps software and the old verification
 * fixture out of the operational list without a single name being matched.
 */
export default async function InventoryPage() {
  const [catalog, series] = await Promise.all([
    fetchCatalog({ includeHidden: true }),
    fetchSeries(),
  ]);
  const { positions, outsideScope } = await fetchInventory(catalog);

  // One round of movement queries for the positions that have any, rather
  // than one per card on demand.
  const histories = await Promise.all(
    positions.map(async (position) => [position.inventoryId, await fetchMovements(position.inventoryId, 10)] as const),
  );
  const movements: Record<number, Movement[]> = {};
  for (const [id, list] of histories) movements[id] = list;

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pt-8 pb-10 md:pt-12">
      <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{de.inventory.title}</h1>
      <p className="mt-1 mb-6 text-sm text-muted">{de.inventory.subline}</p>

      <InventoryView
        positions={positions}
        movements={movements}
        catalog={catalog}
        series={series}
        outsideScope={outsideScope.length}
      />
    </main>
  );
}
