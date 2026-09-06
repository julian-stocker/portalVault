import type { Metadata } from "next";
import Link from "next/link";

import { AdminThumb } from "@/components/admin/admin-thumb";
import { VisibilityToggle } from "@/components/admin/visibility-toggle";
import { ADMIN_PAGE_SIZE, fetchAdminCatalog } from "@/lib/admin/queries";
import { fetchSeries } from "@/lib/catalog/queries";
import { groupLabel } from "@/lib/catalog/group";
import { de } from "@/lib/i18n/de";

export const metadata: Metadata = { title: `${de.admin.catalog} · ${de.admin.title}` };

/**
 * The editing table.
 *
 * Shows every figure, hidden ones included — that is the whole difference
 * between this and the public catalog. Server-side paging and filtering: an
 * editor asks for a row by name or SKY-ID, they do not scroll 561 of them.
 */
export default async function AdminCatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; series?: string; q?: string; hidden?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? "1") || 1);
  const [series, result] = await Promise.all([
    fetchSeries(),
    fetchAdminCatalog({
      page,
      series: params.series,
      query: params.q,
      hiddenOnly: params.hidden === "1",
    }),
  ]);

  const lastPage = Math.max(1, Math.ceil(result.total / ADMIN_PAGE_SIZE));
  const query = (next: Record<string, string | undefined>) => {
    const search = new URLSearchParams();
    const merged = { series: params.series, q: params.q, hidden: params.hidden, ...next };
    for (const [key, value] of Object.entries(merged)) if (value) search.set(key, value);
    const text = search.toString();
    return text === "" ? "/admin/catalog" : `/admin/catalog?${text}`;
  };

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pt-8 pb-6 md:pt-12">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{de.admin.catalog}</h1>
        <Link href="/admin/catalog/categories" className="text-sm text-accent underline">
          {de.admin.categories}
        </Link>
      </div>

      {/* A plain GET form: the filter state lives in the URL, so a reload,
          a bookmark and the back button all behave. */}
      <form method="get" className="mt-5 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted">
          {de.admin.searchLabel}
          <input
            type="search"
            name="q"
            defaultValue={params.q ?? ""}
            className="min-h-10 w-64 rounded-sky-md bg-surface/80 px-3 text-sm ring-1 ring-border/70"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          {de.admin.series}
          <select
            name="series"
            defaultValue={params.series ?? ""}
            className="min-h-10 rounded-sky-md bg-surface/80 px-3 text-sm ring-1 ring-border/70"
          >
            <option value="">{de.admin.allSeries}</option>
            {series.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-h-10 items-center gap-2 text-sm text-muted">
          <input type="checkbox" name="hidden" value="1" defaultChecked={params.hidden === "1"} />
          {de.admin.hiddenFilter}
        </label>
        <button
          type="submit"
          className="min-h-10 rounded-sky-md bg-surface px-4 text-sm ring-1 ring-border-strong"
        >
          {de.admin.searchLabel}
        </button>
      </form>

      <p className="mt-4 text-sm text-muted">
        {de.admin.figures(result.total)} · {de.admin.page(page, lastPage)}
      </p>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted">
              <th scope="col" className="w-14 py-2 pr-3" />
              <th scope="col" className="py-2 pr-3 font-medium">{de.admin.skyId}</th>
              <th scope="col" className="py-2 pr-3 font-medium">{de.admin.publicName}</th>
              <th scope="col" className="py-2 pr-3 font-medium">{de.admin.series}</th>
              <th scope="col" className="py-2 pr-3 font-medium">{de.admin.category}</th>
              <th scope="col" className="py-2 pr-3 font-medium">{de.admin.group}</th>
              <th scope="col" className="py-2 pr-3 font-medium">{de.admin.visible}</th>
              <th scope="col" className="py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {result.figures.map((figure) => (
              <tr key={figure.skyId} className="border-b border-border/60 last:border-0">
                <td className="py-2 pr-3">
                  <AdminThumb file={figure.imageFile} name={figure.publicName} />
                </td>
                <td className="py-2 pr-3 font-mono text-xs text-muted">{figure.skyId}</td>
                <td className="py-2 pr-3">
                  <span className="font-medium">{figure.publicName}</span>
                  {/* The imported name stays visible wherever it differs, so
                      an override is never a silent rewrite. */}
                  {figure.displayNameOverride !== null ? (
                    <span className="block text-xs text-muted">
                      {de.admin.canonicalName}: {figure.canonicalName}
                    </span>
                  ) : null}
                </td>
                <td className="py-2 pr-3 text-muted">{figure.seriesLabel}</td>
                <td className="py-2 pr-3 text-muted">{figure.categoryName}</td>
                <td className="py-2 pr-3 text-muted">{groupLabel(figure.catalogGroup)}</td>
                <td className="py-2 pr-3">
                  <VisibilityToggle skyId={figure.skyId} visible={figure.catalogVisible} />
                </td>
                <td className="py-2 text-right">
                  <Link
                    href={`/admin/catalog/${figure.skyId}`}
                    className="text-xs text-accent underline underline-offset-2"
                  >
                    {de.admin.edit}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-5 flex items-center justify-between text-sm">
        {page > 1 ? (
          <Link href={query({ page: String(page - 1) })} className="text-accent underline">
            {de.admin.previous}
          </Link>
        ) : (
          <span />
        )}
        {page < lastPage ? (
          <Link href={query({ page: String(page + 1) })} className="text-accent underline">
            {de.admin.next}
          </Link>
        ) : (
          <span />
        )}
      </div>
    </main>
  );
}
