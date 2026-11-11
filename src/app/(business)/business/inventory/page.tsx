import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { InventoryView } from "@/components/admin/inventory-view";
import { fetchInventory, fetchShopSettings, fetchTradeTotals } from "@/lib/admin/inventory";
import { fetchLegacyTotals } from "@/lib/admin/legacy-stock";
import { canOperateSeller } from "@/lib/auth/capabilities";
import { fetchAccessoryCatalog, fetchCatalog, fetchSeries } from "@/lib/catalog/queries";
import { de } from "@/lib/i18n/de";
import { RECONCILIATION_PATH } from "@/lib/reconciliation/routes";
import { reconciliationEnvironment } from "@/lib/reconciliation/server/queries";

export const metadata: Metadata = { title: `${de.inventory.title} · ${de.admin.title}` };

/**
 * The operator's stock — the Lagerverwaltung.
 *
 * Protected by `(business)/layout.tsx` like every page of the seller's area
 * (`capabilities().sellerOperator`, ADR-0077) — and by the database
 * underneath it, where every shop write asks for the seller operator itself.
 *
 * The catalog is loaded with hidden figures included, the same call the admin
 * catalog uses: a figure taken out of the public catalog can still sit in a
 * box on a shelf.
 *
 * SEIT ADR-0128 KOMMT ZUBEHÖR DAZU. `fetchAccessoryCatalog()` liefert die
 * nicht sammelbaren Zeilen derselben Tabelle — Spiele, Portale, Bundles —,
 * damit die Lagerübersicht sie BENENNEN kann und nicht nur zählen. Was
 * weiterhin draußen bleibt, bleibt es aus einem Grund, den der Katalog
 * selbst nennt: nicht aktiv (die Prüffigur `SKY-9998`) oder im reservierten
 * Fixture-Bereich `SKY-9000`–`9999` (ADR-0070). Kein Name wird dafür
 * verglichen.
 */
export default async function InventoryPage() {
  /*
   * THE GATE, ALSO HERE (2026-11-11). Next renders layout and page in
   * parallel, so the layout's `notFound()` does not stop this page from
   * starting its reads. For an anonymous request that meant calling
   * `admin_shop_settings()` as `anon`, which has no EXECUTE on it (0007) —
   * the answer was still a 404, but the server logged "permission denied".
   * Asking the same, request-cached question first ends it before any read.
   */
  if (!(await canOperateSeller())) notFound();

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
  const [catalog, accessories, series, settings, legacyTotals, tradeTotals] = await Promise.all([
    fetchCatalog({ includeHidden: true }),
    /*
     * DIE ANDERE HÄLFTE DERSELBEN TABELLE (ADR-0128).
     *
     * Spiele und Portale sind keine Sammelobjekte und stehen deshalb in
     * keinem `fetchCatalog()`-Ergebnis. Lagerzeilen haben sie trotzdem — 13
     * auf Spiele, seit dem ersten Tag. Ohne ihre Namen konnte die Übersicht
     * sie nur zählen; mit ihnen zeigt sie sie. Eine zweite
     * Bestandsverwaltung entsteht dabei nicht: es ist dieselbe
     * `admin_shop_inventory()`, dieselbe Tabelle, dieselbe Karte.
     */
    /* `includeHidden`, und zwar aus einem anderen Grund als beim Katalog:
       hier geht es nicht um Veröffentlichung, sondern darum, eine VORHANDENE
       Lagerzeile benennen zu können. Ein Portal steht auf
       `catalog_visible = false` — es liegt trotzdem im Regal. */
    fetchAccessoryCatalog({ includeHidden: true }),
    fetchSeries(),
    // The shop-wide percentage, so every card can say what "automatic" means
    // instead of showing a number with no explanation (ADR-0045).
    fetchShopSettings(),
    fetchLegacyTotals(),
    fetchTradeTotals(),
  ]);
  /*
   * Figuren UND Zubehör in die Paarung, in dieser Reihenfolge — bei
   * gleicher SKY-ID gewinnt die erste, und eine SKY-ID kommt in genau einer
   * der beiden Mengen vor (`isCollectible()` entscheidet, und es entscheidet
   * eindeutig).
   */
  const { positions, outsideScope } = await fetchInventory([...catalog, ...accessories]);

  /*
   * DIE ZWEI ABGLEICHE, ALS EINSTIEGE (Lagerverwaltung V2, AP5).
   *
   * Excel: der Bestandsabgleich aus `skylanders.xlsx` (ADR-0087), unverändert
   * unter `/business/inventory/import` — er ist der einzige, der Bestand
   * bucht, und das erst nach seiner eigenen Vorschau.
   *
   * CSV: der Verkaufsabgleich des Orderbuchs (ADR-0174/0178). Er ändert
   * keinen Bestand. Gezeigt nur unter GENAU den Bedingungen, unter denen
   * seine Route antwortet — dieselbe Umgebungsprüfung und dieselbe
   * Betreiberprüfung, die `queries.ts` vor jedem Lesen stellt — die zweite
   * ist oben bereits beantwortet, sonst stünde hier nichts. Auf Production
   * fehlt der Einstieg also, wie auf der Verkaufsliste.
   */
  const csvReconciliation = reconciliationEnvironment();
  const links = de.inventory.reconcile;

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pt-8 pb-10 md:pt-12">
      <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{de.inventory.title}</h1>
      <p className="mt-1 text-sm text-muted">{de.inventory.subline}</p>

      <nav aria-label={links.heading} className="mt-3 mb-6 grid gap-2 sm:grid-cols-2">
        <Link
          href="/business/inventory/import"
          className="focus-ring flex min-h-11 flex-col justify-center rounded-sky-md bg-surface/80 px-3 py-2 text-sm ring-1 ring-border/70 hover:ring-border-strong"
        >
          <span className="font-medium">{links.excel}</span>
          <span className="block text-[11px] leading-tight text-muted">{links.excelHint}</span>
        </Link>
        {csvReconciliation ? (
          <Link
            href={RECONCILIATION_PATH}
            className="focus-ring flex min-h-11 flex-col justify-center rounded-sky-md bg-surface/80 px-3 py-2 text-sm ring-1 ring-border/70 hover:ring-border-strong"
          >
            <span className="font-medium">{links.csv}</span>
            <span className="block text-[11px] leading-tight text-muted">{links.csvHint}</span>
          </Link>
        ) : null}
      </nav>

      <InventoryView
        positions={positions}
        legacyTotals={Object.fromEntries(legacyTotals)}
        tradeTotals={Object.fromEntries(tradeTotals)}
        catalog={catalog}
        accessories={accessories}
        series={series}
        outsideScope={outsideScope.length}
        percentage={settings.pricePercentage}
      />
    </main>
  );
}
