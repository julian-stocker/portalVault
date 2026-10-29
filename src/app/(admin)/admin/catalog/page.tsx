import type { Metadata } from "next";
import Link from "next/link";

import { AdminThumb } from "@/components/admin/admin-thumb";
import { StatusSelect } from "@/components/admin/status-select";
import { RowActions } from "@/components/admin/row-actions";
import {
  CATALOG_STATUSES,
  isCatalogStatus,
  statusFromVisibility,
  type CatalogStatus,
} from "@/lib/catalog/catalog-status";
import { ADMIN_PAGE_SIZE, fetchAdminCatalog } from "@/lib/admin/queries";
import { fetchCatalogStatuses, fetchSeries } from "@/lib/catalog/queries";
import { groupLabel } from "@/lib/catalog/group";
import { imageSrc } from "@/lib/catalog/image";
import { de } from "@/lib/i18n/de";

/** Dieselben drei Wörter wie überall; der Filter nennt sie nur hier. */
const STATUS_FILTER_LABELS: Readonly<Record<CatalogStatus, string>> = {
  public: de.catalog.statusPublic,
  hidden: de.catalog.statusHidden,
  draft: de.catalog.statusDraft,
};

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
  searchParams: Promise<{ page?: string; series?: string; q?: string; status?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? "1") || 1);
  /*
   * DER STATUSFILTER ERSETZT DAS HÄKCHEN „nur versteckte" (CAT-02B). Er wirkt
   * serverseitig, weil die Liste seitenweise lädt: ein Filter nach dem
   * Blättern filtert einen Ausschnitt statt den Bestand.
   */
  const status = isCatalogStatus(params.status) ? params.status : undefined;
  const [series, result, statuses] = await Promise.all([
    fetchSeries(),
    fetchAdminCatalog({ page, series: params.series, query: params.q, status }),
    /*
     * Der echte Status je SKY-ID — eine eigene, winzige Abfrage, weil
     * `ADMIN_COLUMNS` ein Literal ist und die Spalte erst mit `0152` kommt.
     * Fehlt sie, kommt eine leere Zuordnung, und `statusFromVisibility` ist
     * dann exakt (siehe `catalog-status.ts`).
     */
    fetchCatalogStatuses(),
  ]);

  const lastPage = Math.max(1, Math.ceil(result.total / ADMIN_PAGE_SIZE));
  const query = (next: Record<string, string | undefined>) => {
    const search = new URLSearchParams();
    const merged = { series: params.series, q: params.q, status: params.status, ...next };
    for (const [key, value] of Object.entries(merged)) if (value) search.set(key, value);
    const text = search.toString();
    return text === "" ? "/admin/catalog" : `/admin/catalog?${text}`;
  };

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pt-8 pb-6 md:pt-12">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{de.admin.catalog}</h1>
        <Link href="/admin/catalog/categories" className="text-sm text-link underline">
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
        {/* Alle · Öffentlich · Versteckt · Entwurf — vier Werte, einer davon
            „keine Einschränkung". Ein leerer Wert ist eine echte Antwort und
            nicht das Fehlen einer. */}
        <label className="flex flex-col gap-1 text-xs text-muted">
          {de.catalog.statusNav}
          <select
            name="status"
            defaultValue={status ?? ""}
            className="min-h-10 rounded-sky-md bg-surface px-3 text-sm text-foreground ring-1 ring-border-strong"
          >
            <option value="">{de.catalog.statusAll}</option>
            {CATALOG_STATUSES.map((option) => (
              <option key={option} value={option}>
                {STATUS_FILTER_LABELS[option]}
              </option>
            ))}
          </select>
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
                  <AdminThumb src={imageSrc(figure)} name={figure.publicName} />
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
                  <StatusSelect
                    skyId={figure.skyId}
                    status={statuses.get(figure.skyId) ?? statusFromVisibility(figure.catalogVisible)}
                  />
                </td>
                <td className="py-2 pl-1 text-right">
                  {/* CAT-05D: drei Icons statt eines Textlinks. Die Spalte
                      bleibt schmal — die Tabelle ist schon breit, und am
                      Telefon zählt jede Spalte. */}
                  <RowActions
                    istEntwurf={(statuses.get(figure.skyId)
                      ?? statusFromVisibility(figure.catalogVisible)) === "draft"}
                    figur={{
                      skyId: figure.skyId,
                      name: figure.publicName,
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-5 flex items-center justify-between text-sm">
        {page > 1 ? (
          <Link href={query({ page: String(page - 1) })} className="text-link underline">
            {de.admin.previous}
          </Link>
        ) : (
          <span />
        )}
        {page < lastPage ? (
          <Link href={query({ page: String(page + 1) })} className="text-link underline">
            {de.admin.next}
          </Link>
        ) : (
          <span />
        )}
      </div>
    </main>
  );
}
