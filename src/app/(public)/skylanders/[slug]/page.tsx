import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CharacterPanel, ElementChip } from "@/components/catalog/character-panel";
import { CollectButton } from "@/components/catalog/collect-button";
import { FigureCard } from "@/components/catalog/figure-card";
import { FigureImage } from "@/components/catalog/figure-image";
import { firstReleaseSeries } from "@/lib/catalog/character";
import { isCollectible } from "@/lib/catalog/collectible";
import { fetchFigureBySlug, fetchFigureDetail } from "@/lib/catalog/queries";
import { fetchOwnedSkyIds } from "@/lib/collection/queries";
import { formatPrice } from "@/lib/format";
import { de } from "@/lib/i18n/de";
import { createClient } from "@/lib/supabase/server";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const figure = await fetchFigureBySlug(slug);
  return { title: figure && isCollectible(figure) ? figure.displayName : de.catalog.title };
}

/**
 * Detail page.
 *
 * Three things in a deliberate order, because they are three different
 * things (ADR-0034):
 *
 *   1. the collectible — this SKY-ID, its series, its market value, and the
 *      one action worth taking on it
 *   2. the character it belongs to, on its own surface so the two never read
 *      as one entity
 *   3. the other collectibles of that character, at their own prices
 *
 * Two columns from `md:` upwards, weighted 3:2 towards the image: the figure
 * is what someone came to look at. One column below that, in the order a
 * thumb reads.
 *
 * Non-collectible entries return 404 here. The rows are not deleted — they
 * stay canonical data, and console games are exactly the kind of stock a
 * first-party shop might sell later. They simply are not part of the public
 * collector catalog (ADR-0029).
 *
 * There is deliberately no `loading.tsx` for this route: a Suspense boundary
 * above a `notFound()` makes the response stream, and the 404 status is lost
 * to a 200 (docs/ARCHITECTURE.md, 3c).
 */
export default async function FigurePage({ params }: Params) {
  const { slug } = await params;
  const detail = await fetchFigureDetail(slug);
  const figure = detail?.figure;
  if (!detail || !figure || !isCollectible(figure)) notFound();

  const supabase = await createClient();
  const [{ data: auth }, owned] = await Promise.all([supabase.auth.getUser(), fetchOwnedSkyIds()]);

  // Derived, not stored: the earliest series among this character's figures,
  // this one included. Answers "which series brought the first figure",
  // which is why the label reads "Erste Figur" and not "Debüt".
  const firstRelease = detail.character
    ? firstReleaseSeries([figure, ...detail.related])
    : null;

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-4 md:py-8">
      <Link
        href="/"
        className="-ml-2 inline-flex min-h-11 items-center px-2 text-sm text-muted hover:text-foreground"
      >
        ← {de.catalog.backToCatalog}
      </Link>

      <div className="mt-1 grid gap-6 md:mt-2 md:grid-cols-5 md:gap-8">
        {/* The vitrine. Bigger here than anywhere else, because this is the
            one page where looking at the figure is the point — but capped,
            so a square image cannot tower over the column beside it. */}
        <div className="md:col-span-3">
          <div className="md:max-w-lg">
            <FigureImage file={figure.imageFile} name={figure.displayName} />
          </div>
        </div>

        {/* A ground of its own (ADR-0038, V3.3). The world runs behind the
            top of every collector page, and the brightest part of it — the
            portal — lands exactly here; a name and a price set straight on
            that were the one place V3.2 still put text on artwork. */}
        <div
          className={
            "flex flex-col gap-5 rounded-sky-lg bg-deep/85 p-5 ring-1 ring-gold-line " +
            "backdrop-blur-sm md:col-span-2 md:p-6"
          }
        >
          <div className="flex flex-col gap-2">
            {/* The derived spelling — "Bash (Legendary)" where the stored
                name is "Legendary Bash" (ADR-0030). The raw name stays in
                the database and out of the interface. */}
            <h1 className="text-2xl font-semibold tracking-tight text-balance">
              {figure.displayName}
            </h1>

            <p className="text-sm text-muted">
              {figure.seriesLabel}
              {figure.categoryName ? ` · ${figure.categoryName}` : ""}
            </p>

            {figure.element ? (
              /* Secondary and decorative here: the element belongs to the
                 character, and the panel below is where it is stated. Same
                 central table, no second mapping. */
              <p>
                <ElementChip element={figure.element} size="xs" />
              </p>
            ) : null}

            {figure.isActive ? null : (
              <p className="text-sm text-muted">{de.catalog.inactive}</p>
            )}
          </div>

          {/* A reference market value, never a shop price (ADR-0033): the
              label says so, and nothing here offers to sell anything. */}
          <div className="flex flex-col gap-0.5 border-y border-on-deep/15 py-4">
            <span className="text-xs text-muted">{de.catalog.marketValue}</span>
            <span
              className={
                figure.marketPrice === null
                  ? "text-lg text-muted"
                  : "text-2xl font-semibold tabular-nums"
              }
            >
              {figure.marketPrice === null ? de.catalog.noPrice : formatPrice(figure.marketPrice)}
            </span>
          </div>

          <CollectButton
            skyId={figure.skyId}
            initialCollected={owned.has(figure.skyId)}
            signInHref={
              auth.user ? null : `/login?next=${encodeURIComponent(`/skylanders/${figure.slug}`)}`
            }
            variant="page"
          />

          {/* The permanent identity of this object, for a collector who
              keeps their own records. Quiet on purpose — it is a reference,
              not a product number. */}
          <p className="text-xs text-muted tabular-nums">
            <span className="sr-only">{de.catalog.reference}: </span>
            {figure.skyId}
          </p>
        </div>
      </div>

      {detail.character ? (
        <div className="mt-8 md:mt-10">
          <CharacterPanel
            character={detail.character}
            firstReleaseLabel={firstRelease?.label ?? null}
          />
        </div>
      ) : null}

      {detail.related.length > 0 ? (
        <section className="mt-8 md:mt-10">
          <h2 className="text-sm font-medium">{de.character.related}</h2>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {detail.related.map((sibling) => (
              <FigureCard key={sibling.skyId} figure={sibling} />
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
