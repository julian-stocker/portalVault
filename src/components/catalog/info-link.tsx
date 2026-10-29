/**
 * The info action on a row — a way to the figure's own page (UX-01D).
 *
 * WHY THIS IS A LINK AND NOT A DIALOG, which was the first question asked
 * before anything was built.
 *
 * The project already has two surfaces that could answer "tell me more about
 * this figure", and only one of them exists for every figure:
 *
 *   `QuickView`    a BUYING dialog. `quickViewModel()` returns `null` when
 *                  there is no buyable offer, on purpose — "a card with no
 *                  buyable offer shows no trade link at all, so the panel
 *                  should never be reachable for one". It is already wired to
 *                  the offer chip through `onOpenOffers`. It is therefore
 *                  exactly the wrong thing for an info button, because the
 *                  state that needs one most — nothing for sale — is the
 *                  state in which it opens nothing.
 *
 *   `/skylanders/<slug>`   the real detail page, and it exists for every
 *                  collectible: the collectible with its series and market
 *                  value, the CHARACTER on a surface of its own (ADR-0034),
 *                  the offers, the collect action, and the character's other
 *                  collectibles at their own prices.
 *
 * So there was nothing to invent. `FigureCard`'s body has led to that page
 * since it was built (`href ?? /skylanders/${figure.slug}`); a row's body is
 * the collect toggle instead, which is precisely why the row needs a second,
 * explicit way there. No new route, no new dialog, no new query.
 *
 * THE LABEL WAS ALSO ALREADY WRITTEN. `de.catalog.info` and
 * `de.catalog.infoFor()` sit in the dictionary with the comment
 * "Beschriftung der separaten Navigationsaktion auf der Karte" — unused
 * until now. This is that action.
 *
 * NOT PREFETCHED, for the reason `OfferLink` gives in its own header: one of
 * these stands on every row, so a screen of catalogue is a screen of links to
 * dynamic routes, and Next prefetches each as it scrolls into view. Every one
 * of those requests passes through `src/proxy.ts`, which validates the
 * session against the auth server before it knows nobody asked for the page.
 */
import Link from "next/link";

import { de } from "@/lib/i18n/de";

/**
 * The box, the ground and the glyph — the heart's three, character for
 * character.
 *
 * COPIED RATHER THAN IMPORTED, and held against `favorite-heart.tsx` by a
 * test so the two cannot drift. The reason is the same one `EditionBanner`
 * gives for the variant seal's two inks: the heart belongs to the card's
 * corner, where the 44 px box extends down and left from a glyph that sits in
 * the corner itself, and this belongs to a row's action bar. Neither should
 * have to import the other to stay in step, but they must stay in step —
 * because in the bar they stand side by side, and a glyph 6 px off its
 * neighbour is the kind of thing nobody can name but everybody sees.
 *
 * `items-start justify-end` is what puts the glyph at the top right of the
 * 44 px box. In the bar that reads as "aligned with the name's first line",
 * which is the one place a reader compares them.
 */
const BOX =
  "group/info pointer-events-auto flex h-11 w-11 items-start justify-end "
  + "focus-visible:outline-none";

const GROUND =
  "grid place-items-center rounded-full p-1.5 transition-colors duration-150 "
  + "group-hover/info:bg-white/16 group-focus-visible/info:bg-white/16 "
  + "group-focus-visible/info:outline group-focus-visible/info:outline-2 "
  + "group-focus-visible/info:outline-offset-1 group-focus-visible/info:outline-white/90";

const SYMBOL = "block h-[22px] w-[22px]";

/**
 * The mark: a ring with an i in it.
 *
 * NEUTRAL INK, and that is a decision rather than a default. The project's
 * colour roles are specific — gold is possession, silver is trade, coral is
 * wanting, amber is commerce — and "read more about this" is none of those.
 * It is a navigation affordance, so it takes the muted neutral and brightens
 * to the foreground on hover, exactly like every other quiet control on these
 * pages.
 *
 * Stroked at 1.5 on a 16-unit grid like the toolbar's own icons, so it sits
 * in the same family as the filter and view marks rather than looking
 * imported from somewhere else.
 */
function InfoGlyph() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 22 22"
      className={SYMBOL}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <circle cx="11" cy="11" r="8" />
      <path d="M11 10v5" />
      {/* The dot of the i. Filled, because a 1.5 px ring at this size reads
          as a smudge rather than a dot. */}
      <circle cx="11" cy="6.9" r="0.95" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function InfoLink({ slug, name }: { slug: string; name: string }) {
  return (
    <Link
      href={`/skylanders/${slug}`}
      prefetch={false}
      /* The name says what is on the other side, as a link's name must:
         "Info zu Slobber Tooth", not "Info". */
      aria-label={de.catalog.infoFor(name)}
      className={BOX}
    >
      <span className={`${GROUND} text-muted group-hover/info:text-foreground`}>
        <InfoGlyph />
      </span>
    </Link>
  );
}
