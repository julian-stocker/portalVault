import type { Metadata } from "next";

import { InventoryView } from "@/components/admin/inventory-view";
import { fetchInventory, fetchShopSettings, fetchTradeTotals } from "@/lib/admin/inventory";
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
  /*
   * FOUR QUERIES FOR THE WHOLE PAGE, AND NONE PER POSITION.
   *
   * `Eingekauft` and `Verkauft` are lifetime figures, so both halves arrive
   * as complete aggregates — the reconstruction from
   * `seller_legacy_stock_summary()` (ADR-0102) and the operative ledger from
   * `seller_business_trade_totals()` (0086). One call each, for every card.
   *
   * This page used to ask for one movement list PER POSITION instead: 273
   * round trips on production, whose rows were then summed in the browser.
   * That was a fan-out AND a wrong number, because the list is capped and a
   * busy position would have undercounted itself. Individual timeline rows
   * are now fetched by the card that is opened — the shape the legacy
   * events have had all along.
   */
  const [catalog, series, settings, legacyTotals, tradeTotals] = await Promise.all([
    fetchCatalog({ includeHidden: true }),
    fetchSeries(),
    // The shop-wide percentage, so every card can say what "automatic" means
    // instead of showing a number with no explanation (ADR-0045).
    fetchShopSettings(),
    fetchLegacyTotals(),
    fetchTradeTotals(),
  ]);
  const { positions, outsideScope } = await fetchInventory(catalog);

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pt-8 pb-10 md:pt-12">
      <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{de.inventory.title}</h1>
      <p className="mt-1 mb-6 text-sm text-muted">{de.inventory.subline}</p>

      <InventoryView
        positions={positions}
        legacyTotals={Object.fromEntries(legacyTotals)}
        tradeTotals={Object.fromEntries(tradeTotals)}
        catalog={catalog}
        series={series}
        outsideScope={outsideScope.length}
        percentage={settings.pricePercentage}
      />
    </main>
  );
}
