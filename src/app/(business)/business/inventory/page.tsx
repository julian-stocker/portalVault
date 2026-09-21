import type { Metadata } from "next";

import { InventoryView } from "@/components/admin/inventory-view";
import {
  fetchInventory,
  fetchMovements,
  fetchShopSettings,
  type Movement,
} from "@/lib/admin/inventory";
import { fetchLegacyTotals } from "@/lib/admin/legacy-stock";
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
  const [catalog, series, settings, legacyTotals] = await Promise.all([
    fetchCatalog({ includeHidden: true }),
    fetchSeries(),
    // The shop-wide percentage, so every card can say what "automatic" means
    // instead of showing a number with no explanation (ADR-0045).
    fetchShopSettings(),
    // Every card's `Eingekauft` and `Verkauft` need the reconstructed 2026
    // totals, and one call answers the whole page (ADR-0102). The individual
    // events are fetched by the card that is opened, not by this page.
    fetchLegacyTotals(),
  ]);
  const { positions, outsideScope } = await fetchInventory(catalog);

  /*
   * One round of movement queries, in parallel, rather than one per card on
   * demand.
   *
   * The limit is the function's own maximum rather than a display cut-off,
   * because these rows now feed `Eingekauft` and `Verkauft` as well as the
   * history: a truncated list would silently undercount. 200 is far above
   * what any position holds — the busiest carries a few dozen — and the
   * database refuses more in any case.
   */
  const histories = await Promise.all(
    positions.map(async (position) =>
      [position.inventoryId, await fetchMovements(position.inventoryId, 200)] as const),
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
        legacyTotals={Object.fromEntries(legacyTotals)}
        catalog={catalog}
        series={series}
        outsideScope={outsideScope.length}
        percentage={settings.pricePercentage}
      />
    </main>
  );
}
