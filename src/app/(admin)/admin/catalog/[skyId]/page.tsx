import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AdminThumb } from "@/components/admin/admin-thumb";
import { CardTypeSelect } from "@/components/admin/card-type-select";
import { FigureEditor } from "@/components/admin/figure-editor";
import { StatusSelect } from "@/components/admin/status-select";
import { FamilySelect } from "@/components/admin/family-select";
import { BaseSelect } from "@/components/admin/base-select";
import { statusFromVisibility } from "@/lib/catalog/catalog-status";
import { fetchCatalogStatuses } from "@/lib/catalog/queries";
import {
  fetchAdminFigure, fetchAdminNote, fetchBaseFigures, fetchCatalogChanges,
  fetchFamilies,
} from "@/lib/admin/queries";
import { fetchFigureBySlug } from "@/lib/catalog/queries";
import { groupLabel } from "@/lib/catalog/group";
import { formatDate } from "@/lib/format";
import { ImageEditor } from "@/components/admin/image-editor";
import { hasImageOverride, imageSrc } from "@/lib/catalog/image";
import { TYPE_LABELS, asCatalogTypes } from "@/lib/catalog/catalog-type";
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

  const [derived, note, changes, statuses, familien, basisstand] = await Promise.all([
    fetchFigureBySlug(figure.slug),
    // From catalog_editorial, not from the figure row — the note is internal
    // and the figure row is world-readable (ADR-0039).
    fetchAdminNote(figure.skyId),
    fetchCatalogChanges(figure.skyId),
    /* Der echte Status, eine eigene winzige Abfrage (CAT-02B) — siehe die
       Begründung in `fetchCatalogStatuses`. */
    fetchCatalogStatuses(),
    /* CAT-06: die Familien, nur um den Namen der eigenen zu zeigen. Zwanzig
       Zeilen — eine eigene Abfrage dafür wäre ein zweiter Weg. */
    fetchFamilies(),
    /* CAT-07: die Basisfiguren derselben Serie — dieselbe Abfrage, aus der
       auch die Auswahl liest, damit Anzeige und Auswahl nicht auseinander
       laufen. Sie liefert zugleich, wie viele Varianten auf diese Figur
       zeigen. */
    fetchBaseFigures(skyId),
  ]);

  const familienname = figure.characterId === null
    ? null
    : (familien.find((f) => f.id === figure.characterId)?.name ?? null);

  /* Der Name der Basisfigur und die Zahl der eigenen Varianten — beides aus
     `basisstand`, ohne eine zweite Abfrage. Die Basisfigur steht NICHT unter
     den Kandidaten (sie ist eine, aber die Liste schliesst die eigene Zeile
     aus), deshalb wird sie dort gesucht und nicht gefiltert. */
  const basisname = figure.baseSkyId === null
    ? null
    : (basisstand.kandidaten.find((b) => b.skyId === figure.baseSkyId)?.name ?? null);
  const eigeneVarianten = basisstand.kandidaten
    .find((b) => b.skyId === figure.skyId)?.varianten ?? 0;

  /* SEIT CAT-05D sitzt die Zusammenführung in der Katalogübersicht, direkt
     an der Zeile — nicht mehr auf dieser Seite. Eine Oberfläche an zwei
     Orten wäre zwei Orte zum Nachsehen. */

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pt-8 pb-10 md:pt-12">
      <Link href="/admin/catalog" className="text-sm text-link underline">
        ← {de.admin.catalog}
      </Link>

      <div className="mt-5 flex items-start gap-4">
        <AdminThumb src={imageSrc(figure)} name={figure.publicName} />
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{figure.publicName}</h1>
          <p className="mt-1 font-mono text-xs text-muted">{figure.skyId}</p>
        </div>
      </div>

      {/* Which card the figure is printed on (V3.5). Its own block rather
          than a line in the name editor: it is a fact about the collectible,
          not about how it is written, and the hint says so. */}
      <div className="mt-6 flex items-center justify-between gap-4 rounded-sky-lg bg-surface/80 p-4 ring-1 ring-border/70">
        <div className="min-w-0">
          <h2 className="text-sm font-medium">{de.admin.cardType}</h2>
          <p className="mt-0.5 text-xs text-muted">{de.admin.cardTypeHint}</p>
        </div>
        <CardTypeSelect skyId={figure.skyId} cardType={figure.cardType} />
      </div>

      {/*
        * DIE TYPES — hier NUR ZU LESEN, und das ist Absicht (CAT-10).
        *
        * Geändert werden sie im Bearbeiten-Dialog, in dem sie zusammen mit
        * Name, Kartenkunst, Bild und Status als ENTWURF stehen und
        * gemeinsam gespeichert werden. Eine zweite Bearbeitungsfläche daneben
        * wäre ein zweiter Weg zur selben Spalte — dieselbe Begründung, mit
        * der die Produktgruppe darunter nur verlinkt ist.
        *
        * Das BANNER steht ebenfalls hier, weil es ohne die Menge nicht zu
        * verstehen ist: „LightCore" ist nur deshalb möglich, weil LightCore
        * zugeordnet ist.
        */}
      <div className="mt-6 rounded-sky-lg bg-surface/80 p-4 ring-1 ring-border/70">
        <h2 className="text-sm font-medium">{de.admin.typeHeading}</h2>
        <p className="mt-0.5 text-xs text-muted">{de.admin.typeHint}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {asCatalogTypes(figure.types).length === 0 ? (
            <span className="text-sm text-muted">{de.admin.typeNone}</span>
          ) : (
            asCatalogTypes(figure.types).map((typ) => (
              <span
                key={typ}
                className={
                  "rounded-full px-2 py-0.5 text-xs leading-none ring-1 "
                  + (figure.visibleType === typ
                    ? "bg-deep/60 text-foreground ring-border-strong font-medium"
                    : "text-muted ring-border/60")
                }
              >
                {TYPE_LABELS[typ]}
                {figure.visibleType === typ ? ` · ${de.admin.typeBanner}` : ""}
              </span>
            ))
          )}
        </div>
      </div>

      {/* The picture, and the two things you can do to it (ADR-0046). First
          on the page after the identity, because it is the one editorial
          change that used to need a deploy. */}
      <div className="mt-6 rounded-sky-lg bg-surface/80 p-4 ring-1 ring-border/70">
        <h2 className="mb-3 text-sm font-medium">{de.admin.image}</h2>
        <ImageEditor
          skyId={figure.skyId}
          name={figure.publicName}
          src={imageSrc(figure)}
          hasOverride={hasImageOverride(figure)}
        />
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
            {/* Dieselbe Auswahl wie in der Liste (CAT-02B): drei Werte, und
                sie zeigt immer, was gilt. Der echte Status kommt aus der
                eigenen Abfrage; fehlt die Spalte noch, ist die Ableitung aus
                der Sichtbarkeit exakt. */}
            <StatusSelect
              skyId={figure.skyId}
              status={statuses.get(figure.skyId) ?? statusFromVisibility(figure.catalogVisible)}
            />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{de.admin.baseAssign}</dt>
          {/* CAT-07: „Variante von" — eine konkrete Basisfigur DERSELBEN
              Serie, nicht die serienübergreifende Familie. Jederzeit
              setzbar, änderbar und entfernbar, auch nach der
              Veröffentlichung. */}
          <dd className="mt-0.5">
            <BaseSelect
              skyId={figure.skyId}
              baseSkyId={figure.baseSkyId}
              baseName={basisname}
              hatVarianten={eigeneVarianten}
            />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{de.admin.familyAssign}</dt>
          {/* CAT-06 §7: die Familienzuordnung ist eine redaktionelle
              Korrektur und muss auch nach der Veröffentlichung möglich
              sein. Sie schreibt EINE Spalte — Angebote, Sammlungen und
              Bestellungen hängen an der SKY-ID und bleiben unberührt. */}
          <dd className="mt-0.5">
            <FamilySelect
              skyId={figure.skyId}
              familie={figure.characterId ?? null}
              familienname={familienname}
            />
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
