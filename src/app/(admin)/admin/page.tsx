import type { Metadata } from "next";
import Link from "next/link";

import { ShopSettings } from "@/components/admin/shop-settings";
import { fetchShopSettings } from "@/lib/admin/inventory";
import { fetchAdminCategories } from "@/lib/admin/queries";
import { de } from "@/lib/i18n/de";

export const metadata: Metadata = { title: de.admin.title };

/**
 * The way in.
 *
 * Deliberately thin: two links, the one number that says whether the
 * classification is finished, and the one setting that prices the whole shop
 * (ADR-0045). Still not a dashboard — everything here is either a way in or
 * a thing to change.
 */
export default async function AdminPage() {
  const [categories, settings] = await Promise.all([fetchAdminCategories(), fetchShopSettings()]);
  const unclassified = categories.filter((c) => c.catalogGroup === null && c.figures > 0);

  return (
    <main className="mx-auto w-full max-w-4xl px-4 pt-8 pb-6 md:pt-12">
      <h1 className="text-3xl font-semibold tracking-tight">{de.admin.title}</h1>

      <div className="mt-8 flex flex-col gap-3">
        <Link
          href="/admin/catalog"
          className="rounded-sky-lg bg-surface/80 px-5 py-4 ring-1 ring-border/70 hover:ring-border-strong"
        >
          <span className="font-medium">{de.admin.catalog}</span>
          <span className="mt-1 block text-sm text-muted">
            Sichtbarkeit, Anzeigenamen und interne Notizen je Figur.
          </span>
        </Link>

        <Link
          href="/admin/catalog/categories"
          className="rounded-sky-lg bg-surface/80 px-5 py-4 ring-1 ring-border/70 hover:ring-border-strong"
        >
          <span className="font-medium">{de.admin.categories}</span>
          <span className="mt-1 block text-sm text-muted">
            {categories.length} Kategorien
            {unclassified.length > 0
              ? ` · ${unclassified.length} ohne Produktgruppe`
              : " · alle klassifiziert"}
          </span>
        </Link>
      </div>

      <div className="mt-8">
        <ShopSettings percentage={settings.pricePercentage} />
      </div>

      <p className="mt-8 text-sm text-muted">{de.admin.completionNote}</p>
    </main>
  );
}
