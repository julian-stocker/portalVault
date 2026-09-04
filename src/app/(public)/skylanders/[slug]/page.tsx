import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CollectButton } from "@/components/catalog/collect-button";
import { FigureImage } from "@/components/catalog/figure-image";
import { fetchFigureBySlug } from "@/lib/catalog/queries";
import { fetchOwnedSkyIds } from "@/lib/collection/queries";
import { formatPrice } from "@/lib/format";
import { de } from "@/lib/i18n/de";
import { createClient } from "@/lib/supabase/server";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const figure = await fetchFigureBySlug(slug);
  return { title: figure?.name ?? de.catalog.title };
}

/**
 * Detail page.
 *
 * Deliberately minimal: only canonical data that actually exists. No invented
 * descriptions, no speculative metadata. The slug addresses the page, the
 * SKY-ID remains the identity (ADR-0011).
 */
export default async function FigurePage({ params }: Params) {
  const { slug } = await params;
  const figure = await fetchFigureBySlug(slug);
  if (!figure) notFound();

  const supabase = await createClient();
  const [{ data: auth }, owned] = await Promise.all([supabase.auth.getUser(), fetchOwnedSkyIds()]);

  return (
    <main className="mx-auto w-full max-w-md px-4 py-6 md:py-10">
      <Link href="/" className="text-sm text-muted hover:text-foreground">
        {de.catalog.backToCatalog}
      </Link>

      <div className="mt-4 flex flex-col gap-4">
        <FigureImage file={figure.imageFile} name={figure.name} />

        <div className="flex flex-col gap-1">
          <span className="text-sm text-muted">{figure.seriesLabel}</span>
          <h1 className="text-2xl font-semibold tracking-tight">{figure.name}</h1>
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
      </div>
    </main>
  );
}
