/**
 * The end of the page.
 *
 * Until now there was none — not on the catalog, not on the cart, not on the
 * checkout. Every public page simply stopped after its content, which is the
 * strongest single signal that a site is unfinished, and for a shop that takes
 * payments it also meant the legally required pages had nowhere to live.
 *
 * THE LEGAL COLUMN
 *
 * These slots were reserved and empty for the whole of V1, with a comment
 * explaining that a page titled "Impressum" containing no Impressum is worse
 * than no link at all. The texts exist now (ADR-0086), so the links do.
 *
 * **„Vertrag widerrufen" is not decoration in this list.** § 356a BGB requires
 * the electronic withdrawal function to be continuously available during the
 * withdrawal period, prominently placed and easily accessible — a footer link
 * on every page is how that is met, and it is why the entry sits here rather
 * than only inside an account area a guest has no way into.
 *
 * NOT IN THE ADMIN AREA. `(admin)/layout.tsx` does not mount this: the
 * operator's workbench has no visitors to orient and no legal pages to offer.
 */
import Link from "next/link";

import { Wordmark } from "@/components/layout/wordmark";
import { de } from "@/lib/i18n/de";
import { SELLER_IDENTITY } from "@/lib/legal/seller-identity";
import { WITHDRAWAL_PATH } from "@/lib/legal/widerruf";

/** One class for every foot link: same target size, same behaviour. */
const FOOT_LINK =
  "inline-flex min-h-11 w-fit items-center text-sm text-on-deep-muted transition-colors " +
  "hover:text-on-deep focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-current";

/** What the shop is. */
const LINKS: readonly { href: string; label: string }[] = [
  { href: "/", label: de.footer.catalog },
  { href: "/shop", label: de.footer.shop },
  { href: "/ueber-skyisles", label: de.footer.about },
];

/** What the law requires to be findable from anywhere. */
const LEGAL_LINKS: readonly { href: string; label: string }[] = [
  { href: "/impressum", label: de.footer.impressum },
  { href: "/datenschutz", label: de.footer.privacy },
  { href: "/agb", label: de.footer.terms },
  { href: "/widerruf", label: de.footer.withdrawal },
  { href: WITHDRAWAL_PATH, label: de.footer.withdrawNow },
  { href: "/versand", label: de.footer.shipping },
  { href: "/zahlung", label: de.footer.payment },
  { href: "/kontakt", label: de.footer.contact },
];

export function SiteFooter() {
  return (
    <footer
      className={
        // A quiet plate at the foot of the world, closed by the same gold
        // hairline the header opens with — so the page has two ends rather
        // than a beginning and a fade.
        "relative mt-12 border-t border-world-edge bg-deep/80 backdrop-blur-md md:mt-16"
      }
    >
      {/* The warm line just inside the edge, as on the header: the plate is
          struck rather than drawn. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-px h-px bg-world-sheen"
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
          {/* And who sells, named from the seller data rather than written
              here (ADR-0086). */}
          <p className="text-sm text-on-deep-muted">
            {de.footer.seller(SELLER_IDENTITY.contractingParty)}
          </p>
        </div>

        <div className="flex flex-col gap-8 sm:flex-row sm:gap-12">
          <nav aria-label={de.footer.nav} className="flex flex-col gap-1">
            {LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                // 44 px targets here too: a footer on a phone is thumbed like
                // anything else.
                className={FOOT_LINK}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <nav aria-label={de.legal.nav} className="flex flex-col gap-1">
            {LEGAL_LINKS.map((link) => (
              <Link key={link.href} href={link.href} className={FOOT_LINK}>
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
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
