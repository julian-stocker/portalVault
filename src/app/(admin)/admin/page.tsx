import type { Metadata } from "next";
import Link from "next/link";

import { BusinessAccountsPanel } from "@/components/admin/business-accounts-panel";
import { PlatformSettings } from "@/components/admin/platform-settings";
import { TesterPanel } from "@/components/admin/tester-panel";
import { fetchPlatformSettings } from "@/lib/admin/platform";
import { fetchAdminCategories } from "@/lib/admin/queries";
import { fetchSellerOperators } from "@/lib/admin/seller-operators";
import { fetchTesterState } from "@/lib/admin/tester";
import { de } from "@/lib/i18n/de";

export const metadata: Metadata = { title: de.admin.title };

/**
 * Running SkyIsles.
 *
 * The catalog every collector and every Business reads, the accounts that may
 * run the shop, the testers, the platform's own contact. **No commerce.**
 * Orders, stock, prices and the seller's facts moved to `/business` in 0041,
 * because operating a shop and operating the platform are different
 * authorities even while one person holds both (ADR-0077).
 *
 * An administrator who has not been granted the shop cannot reach it from
 * here — there is no link, and there would be no page if they followed one.
 */
export default async function AdminPage() {
  const [categories, platform, testers, operators] = await Promise.all([
    fetchAdminCategories(),
    fetchPlatformSettings(),
    fetchTesterState(),
    fetchSellerOperators(),
  ]);
  const unclassified = categories.filter((c) => c.catalogGroup === null && c.figures > 0);

  return (
    <main className="mx-auto w-full max-w-4xl px-4 pt-8 pb-6 md:pt-12">
      <h1 className="text-3xl font-semibold tracking-tight">{de.admin.title}</h1>
      <p className="mt-2 text-sm text-muted">{de.admin.domains.adminHint}</p>

      {/*
       * The canonical catalog is the platform's (ADR-0076). Every collector
       * reads it, every Business attaches offers to it, and nobody but an
       * administrator corrects it.
       */}
      <div className="mt-8 grid gap-3 sm:grid-cols-2">
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

      <BusinessAccountsPanel state={operators} />

      <div className="mt-8">
        {/* Its own panel since 0036: testers are no longer a commerce
            setting, and each carries its own permissions (ADR-0071). */}
        <TesterPanel state={testers} />
        <PlatformSettings
          contactEmail={platform.contactEmail}
          supportEmail={platform.supportEmail}
        />
      </div>

      <p className="mt-8 text-sm text-muted">{de.admin.completionNote}</p>
    </main>
  );
}
