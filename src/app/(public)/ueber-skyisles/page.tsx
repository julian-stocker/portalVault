import type { Metadata } from "next";
import Link from "next/link";

import { ACTION_NEUTRAL, ACTION_PRIMARY } from "@/components/ui/action";
import { countCollectibleFigures } from "@/lib/catalog/queries";
import { formatNumber } from "@/lib/format";
import { de } from "@/lib/i18n/de";

export const metadata: Metadata = {
  title: de.about.title,
  description: de.about.lead,
};

/**
 * What SkyIsles is.
 *
 * ADR-0025 decided that `/` is the catalog and not a landing page, and that
 * decision stands — the first acquisition channel is a QR code on a parcel,
 * and a marketing page between intent and action is a page nobody asked for.
 * But the same ADR said, in as many words, that explaining content "needs a
 * place of its own later". This is that place. It is a destination, not an
 * entrance: reached from the footer and from the catalog's secondary action,
 * never in front of anything.
 *
 * It also does the second job the product had nowhere to do: say who is
 * selling. A shop that takes money and never names its seller is the single
 * largest trust gap this page closes.
 *
 * EVERY CLAIM HERE IS CHECKABLE. No founding story, no team, no invented
 * turnover, no promised delivery time — and the one number on the page is
 * counted from the database on each request, so it cannot go stale.
 */
export default async function AboutPage() {
  const figures = await countCollectibleFigures();

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pt-8 pb-6 md:pt-12 md:pb-10">
      <h1
        className="text-3xl leading-tight font-semibold tracking-tight md:text-4xl"
        style={{ textShadow: "0 2px 20px rgb(10 9 24 / 0.85), 0 1px 3px rgb(10 9 24 / 0.95)" }}
      >
        {de.about.title}
      </h1>
      <p
        className="mt-3 max-w-2xl text-base text-on-deep-muted md:text-lg"
        style={{ textShadow: "0 1px 14px rgb(10 9 24 / 0.9)" }}
      >
        {de.about.lead}
      </p>

      {/* A ground of its own (ADR-0038, V3.3): the world runs behind the top
          of every public page, and running text on the portal artwork is the
          one thing the visual direction does not do. */}
      <div className="mt-8 flex flex-col gap-7 rounded-sky-lg bg-deep/85 p-5 ring-1 ring-gold-line backdrop-blur-sm md:mt-10 md:p-7">
        <Section heading={de.about.catalogHeading}>
          {de.about.catalogBody(figures, formatNumber(figures))}
        </Section>

        <Section heading={de.about.collectionHeading}>
          {de.about.collectionBody}
          {/* The one sentence that answers "what does it cost me?" — set apart
              because it is the answer, not a detail of the paragraph. */}
          <span className="mt-2 block font-medium text-accent">{de.about.collectionFree}</span>
        </Section>

        <Section heading={de.about.shopHeading}>{de.about.shopBody}</Section>

        <Section heading={de.about.togetherHeading}>{de.about.togetherBody}</Section>

        {/* Market value and shop price are two different things (ADR-0033),
            and until now that distinction lived only as a label on a card. */}
        <Section heading={de.about.pricesHeading}>{de.about.pricesBody}</Section>
      </div>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/" className={`${ACTION_PRIMARY} w-auto`}>
          {de.about.toCatalog}
        </Link>
        <Link href="/shop" className={`${ACTION_NEUTRAL} w-auto`}>
          {de.about.toShop}
        </Link>
      </div>
    </main>
  );
}

/** One explained thing. A real `h2`, so the page has an outline to jump through. */
function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="font-display text-xl leading-tight font-semibold tracking-tight md:text-2xl">
        {heading}
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-on-deep-muted md:text-base">{children}</p>
    </section>
  );
}
