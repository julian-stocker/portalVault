import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CharacterPanel } from "@/components/catalog/character-panel";
import { CollectButton } from "@/components/catalog/collect-button";
import { firstReleaseSeries } from "@/lib/catalog/character";
import { isCollectible } from "@/lib/catalog/collectible";
import { FigureCard } from "@/components/catalog/figure-card";
import { FigureImage } from "@/components/catalog/figure-image";
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
 * Deliberately minimal: only canonical data that actually exists. No invented
 * descriptions, no speculative metadata. The slug addresses the page, the
 * SKY-ID remains the identity (ADR-0011).
 *
 * The character block and the list of sibling figures appear only when the
 * figure carries a curated character. 457 of the 561 collectibles carry none,
 * and their page has to look complete without it (ADR-0034).
 *
 * Non-collectible entries return 404 here. The rows are not deleted — they
 * stay canonical data, and console games are exactly the kind of stock a
 * first-party shop might sell later. They simply are not part of the public
 * collector catalog.
 */
export default async function FigurePage({ params }: Params) {
  const { slug } = await params;
  const detail = await fetchFigureDetail(slug);
  const figure = detail?.figure;
  // Software is canonical data but not part of the collector surface. A
  // reachable page would offer a collect button for something that counts
  // towards nothing — see the note above.
  if (!detail || !figure || !isCollectible(figure)) notFound();

  // Derived, not stored: the earliest series among this character's figures,
  // this one included. Answers "which series brought the first figure", which
  // is why the label says "Erste Figur" and not "Debüt".
  const firstRelease = detail.character
    ? firstReleaseSeries([figure, ...detail.related])
    : null;

  const supabase = await createClient();
  const [{ data: auth }, owned] = await Promise.all([supabase.auth.getUser(), fetchOwnedSkyIds()]);

  return (
    <main className="mx-auto w-full max-w-md px-4 py-6 md:py-10">
      <Link href="/" className="text-sm text-muted hover:text-foreground">
        {de.catalog.backToCatalog}
      </Link>

      <div className="mt-4 flex flex-col gap-4">
        <FigureImage file={figure.imageFile} name={figure.displayName} />

        <div className="flex flex-col gap-1">
          <span className="text-sm text-muted">{figure.seriesLabel}</span>
          <h1 className="text-2xl font-semibold tracking-tight">{figure.displayName}</h1>
          {figure.isActive ? null : (
            <span className="text-sm text-muted">{de.catalog.inactive}</span>
          )}
        </div>

        <dl className="flex items-baseline justify-between border-y border-border py-3">
          <dt className="text-sm text-muted">{de.catalog.marketValue}</dt>
          <dd className={figure.marketPrice === null ? "text-muted" : "text-lg font-medium"}>
            {figure.marketPrice === null ? de.catalog.noPrice : formatPrice(figure.marketPrice)}
          </dd>
        </dl>

        <CollectButton
          skyId={figure.skyId}
          initialCollected={owned.has(figure.skyId)}
          signInHref={
            auth.user ? null : `/login?next=${encodeURIComponent(`/skylanders/${figure.slug}`)}`
          }
        />

        {detail.character ? (
          <CharacterPanel
            character={detail.character}
            firstReleaseLabel={firstRelease?.label ?? null}
          />
        ) : null}
      </div>

      {detail.related.length > 0 ? (
        <section className="mt-8">
          <h2 className="text-sm font-medium">{de.character.related}</h2>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {detail.related.map((sibling) => (
              <FigureCard key={sibling.skyId} figure={sibling} />
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
