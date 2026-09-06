import type { Metadata } from "next";
import Link from "next/link";

import { GroupSelect } from "@/components/admin/group-select";
import { fetchAdminCategories } from "@/lib/admin/queries";
import { de } from "@/lib/i18n/de";

export const metadata: Metadata = { title: `${de.admin.categories} · ${de.admin.title}` };

/**
 * The twenty categories and their product group.
 *
 * This is where the product group is maintained, because that is where it
 * lives (ADR-0041): every category was checked to fall entirely into one
 * group, so twenty decisions classify all 561 collectibles. There is no
 * per-figure override, and none is offered.
 *
 * A category with no group is not a problem to be fixed silently — it is a
 * decision nobody has made yet, and it says so.
 */
export default async function AdminCategoriesPage() {
  const categories = await fetchAdminCategories();

  return (
    <main className="mx-auto w-full max-w-4xl px-4 pt-8 pb-10 md:pt-12">
      <Link href="/admin/catalog" className="text-sm text-accent underline">
        ← {de.admin.catalog}
      </Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight md:text-3xl">
        {de.admin.categories}
      </h1>
      <p className="mt-2 text-sm text-muted">{de.admin.groupHint}</p>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted">
              <th scope="col" className="py-2 pr-4 font-medium">{de.admin.series}</th>
              <th scope="col" className="py-2 pr-4 font-medium">{de.admin.category}</th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">
                {de.admin.figures(0).replace("0 ", "")}
              </th>
              <th scope="col" className="py-2 font-medium">{de.admin.group}</th>
            </tr>
          </thead>
          <tbody>
            {categories.map((category) => (
              <tr key={category.id} className="border-b border-border/60 last:border-0">
                <td className="py-2 pr-4 text-muted">{category.seriesLabel}</td>
                <td className="py-2 pr-4">{category.name}</td>
                <td className="py-2 pr-4 text-right tabular-nums text-muted">{category.figures}</td>
                <td className="py-2">
                  <GroupSelect categoryId={category.id} group={category.catalogGroup} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
