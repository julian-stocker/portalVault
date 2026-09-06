import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AdminThumb } from "@/components/admin/admin-thumb";
import { FigureEditor } from "@/components/admin/figure-editor";
import { VisibilityToggle } from "@/components/admin/visibility-toggle";
import { fetchAdminFigure, fetchAdminNote, fetchCatalogChanges } from "@/lib/admin/queries";
import { fetchFigureBySlug } from "@/lib/catalog/queries";
import { groupLabel } from "@/lib/catalog/group";
import { formatDate } from "@/lib/format";
import { de } from "@/lib/i18n/de";

export const metadata: Metadata = { title: `${de.admin.catalog} · ${de.admin.title}` };

/**
 * One figure, everything editable about it in one place.
 *
 * The derived name comes from the public query on purpose: the preview in the
 * editor has to show what a visitor would actually read when the override is
 * cleared, and that is the ADR-0030 derivation, not the raw name.
 */
export default async function AdminFigurePage({
  params,
}: {
  params: Promise<{ skyId: string }>;
}) {
  const { skyId } = await params;
  const figure = await fetchAdminFigure(skyId);
  if (!figure) notFound();

  const [derived, note, changes] = await Promise.all([
    fetchFigureBySlug(figure.slug),
    // From catalog_editorial, not from the figure row — the note is internal
    // and the figure row is world-readable (ADR-0039).
    fetchAdminNote(figure.skyId),
    fetchCatalogChanges(figure.skyId),
  ]);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pt-8 pb-10 md:pt-12">
      <Link href="/admin/catalog" className="text-sm text-accent underline">
        ← {de.admin.catalog}
      </Link>

      <div className="mt-5 flex items-start gap-4">
        <AdminThumb file={figure.imageFile} name={figure.publicName} />
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{figure.publicName}</h1>
          <p className="mt-1 font-mono text-xs text-muted">{figure.skyId}</p>
        </div>
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted">{de.admin.series}</dt>
          <dd>{figure.seriesLabel}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{de.admin.category}</dt>
          <dd>{figure.categoryName}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{de.admin.group}</dt>
          {/* Read-only here: the group belongs to the category, and editing
              it from one figure would hide that it moves all of them. */}
          <dd>
            <Link href="/admin/catalog/categories" className="underline decoration-dotted">
              {groupLabel(figure.catalogGroup)}
            </Link>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{de.admin.visible}</dt>
          <dd className="mt-0.5">
            <VisibilityToggle skyId={figure.skyId} visible={figure.catalogVisible} />
          </dd>
        </div>
      </dl>

      <p className="mt-2 text-xs text-muted">{de.admin.groupHint}</p>

      <hr className="my-8 border-border/60" />

      <FigureEditor
        skyId={figure.skyId}
        canonicalName={figure.canonicalName}
        derivedName={derived?.displayName ?? figure.canonicalName}
        override={figure.displayNameOverride}
        note={note}
      />

      <hr className="my-8 border-border/60" />

      <section>
        <h2 className="text-sm font-medium">{de.admin.history}</h2>
        {changes.length === 0 ? (
          <p className="mt-2 text-sm text-muted">{de.admin.noHistory}</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1 text-sm text-muted">
            {changes.map((change) => (
              <li key={`${change.field}-${change.changedAt}`}>
                <span className="text-foreground">{change.field}</span>{" "}
                {change.oldValue ?? "—"} → {change.newValue ?? "—"}{" "}
                <span className="text-xs">{formatDate(change.changedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
