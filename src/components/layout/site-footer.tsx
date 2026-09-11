/**
 * The end of the page.
 *
 * Until now there was none — not on the catalog, not on the cart, not on the
 * checkout. Every public page simply stopped after its content, which is the
 * strongest single signal that a site is unfinished, and for a shop that takes
 * payments it also meant the legally required pages had nowhere to live.
 *
 * ONLY DESTINATIONS THAT EXIST
 *
 * Impressum, Datenschutzerklärung, Widerrufsbelehrung and AGB are a release
 * gate of their own (docs/ROADMAP.md, V1.7) and none of them is written. They
 * are therefore **not linked**: a dead link is worse than a missing one, and a
 * page titled "Impressum" that contains no Impressum is worse than both.
 *
 * The slots, in the order they will be rendered once the texts exist:
 *
 *     /impressum      Impressum
 *     /datenschutz    Datenschutzerklärung
 *     /widerruf       Widerrufsbelehrung
 *     /agb            AGB
 *     /kontakt        Kontakt
 *
 * `impressum` and `datenschutz` are already reserved usernames, so those two
 * addresses are free to take (src/lib/auth/username.ts).
 *
 * There is deliberately no contact point yet either: no address has been
 * decided, and one invented here would be a support channel that goes
 * nowhere — while `de.checkout.result.attentionHint` already promises a
 * customer that somebody will get in touch.
 *
 * NOT IN THE ADMIN AREA. `(admin)/layout.tsx` does not mount this: the
 * operator's workbench has no visitors to orient and no legal pages to offer.
 */
import Link from "next/link";

import { Wordmark } from "@/components/layout/wordmark";
import { de } from "@/lib/i18n/de";

/** The public destinations that exist today. Order is the order on screen. */
const LINKS: readonly { href: string; label: string }[] = [
  { href: "/", label: de.footer.catalog },
  { href: "/shop", label: de.footer.shop },
  { href: "/ueber-skyisles", label: de.footer.about },
];

export function SiteFooter() {
  return (
    <footer
      className={
        // A quiet plate at the foot of the world, closed by the same gold
        // hairline the header opens with — so the page has two ends rather
        // than a beginning and a fade.
        "relative mt-12 border-t border-accent/40 bg-deep/80 backdrop-blur-md md:mt-16"
      }
    >
      {/* The warm line just inside the edge, as on the header: the plate is
          struck rather than drawn. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-px h-px bg-accent/20"
      />

      <div
        className={
          "mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 " +
          "md:flex-row md:items-start md:justify-between md:gap-10 md:py-10"
        }
      >
        <div className="flex max-w-sm flex-col gap-2.5">
          <Link href="/" className="flex w-fit items-center" aria-label={de.app.name}>
            <Wordmark />
          </Link>
          {/* What this is, in one sachliche line. Not a slogan. */}
          <p className="text-sm leading-relaxed text-on-deep-muted">{de.footer.positioning}</p>
        </div>

        <nav aria-label={de.footer.nav} className="flex flex-col gap-1">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              // 44 px targets here too: a footer on a phone is thumbed like
              // anything else.
              className="inline-flex min-h-11 w-fit items-center text-sm text-on-deep-muted transition-colors hover:text-on-deep"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>

      <div className="mx-auto w-full max-w-6xl px-4 pb-8 md:pb-10">
        <p className="border-t border-border/60 pt-5 text-xs text-on-deep-muted tabular-nums">
          {/* Rendered on the server per request; no client clock and nothing
              that could disagree between the two. */}
          {de.footer.copyright(new Date().getFullYear())}
        </p>
      </div>
    </footer>
  );
}
