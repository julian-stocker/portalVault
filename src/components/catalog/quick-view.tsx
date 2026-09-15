/**
 * The quick view: an offer, seen without leaving the catalog (IR-001).
 *
 * The trade row on a catalog card used to navigate to
 * `/skylanders/<slug>#angebote`, which meant leaving the grid, waiting for a
 * dynamic route and coming back to a lost scroll position — for the question
 * "what does it cost, and can I have it". Now it opens this.
 *
 * NOTHING IS LOADED WHEN IT OPENS. Every value below comes from the catalog
 * payload the grid was already drawn from: `fetchCatalog()` supplied the
 * figure and `fetchOffers()` the offers, in the render that produced the card
 * (ADR-0043). Opening costs one `setState` and no request — which is what
 * keeps commit a0353cb intact rather than quietly undoing it.
 *
 * THE SHAPE, AND WHY IT IS NOT A FORM
 *
 * Picture on the left at roughly two fifths, everything that identifies and
 * prices the figure on the right, one action row across the foot. The first
 * draft stacked title / rule / metadata / rule / price / box / rule / button
 * and read like an admin screen: every row weighed the same, so nothing led.
 * There is one hairline in the whole dialog now — above the actions, where it
 * separates reading from doing — and exactly one bordered block, the price
 * zone. Hierarchy is carried by size and colour instead of by boxes.
 *
 * A VITRINE WITH A SHOP IN IT, NOT A SHOP WITH VITRINES
 *
 * Deep navy and a hairline of gold, like the collector surfaces, so the
 * dialog belongs to the showcase. The commerce inside it is silver, because
 * silver is trade and gold is ownership (V3.1): the market value is neutral
 * ink, the asking price is silver, and the buy action is a silver pill. Gold
 * stays on the frame and the picture's edge, where it is brand rather than
 * state.
 *
 * WHAT IS NOT HERE, AND WHY
 *
 * No seller, no rating, no delivery estimate, no shipping cost, no second
 * picture and no gallery arrows — see `lib/ui/quick-view.ts`, which refuses
 * to carry any of them, and the mockup, which showed several merchants as an
 * illustration of a layout rather than of data that exists. And no quantity
 * picker and no direct checkout: adding to the cart is the one commerce
 * action, the same one the figure page has.
 */
"use client";

import Link from "next/link";

import { ElementChip } from "@/components/catalog/character-panel";
import { Modal } from "@/components/ui/modal";
import { OfferAddButton } from "@/components/shop/offer-panel";
import { formatPrice } from "@/lib/format";
import { de } from "@/lib/i18n/de";
import type { QuickViewModel } from "@/lib/ui/quick-view";
import type { PublicSeller } from "@/lib/shop/seller";

function CloseGlyph() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
    >
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

/** A small fact worn as a badge rather than announced by a label. */
function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-block rounded-full bg-white/8 px-2 py-0.5 text-[11px] leading-4 font-medium text-on-deep-muted ring-1 ring-white/12">
      {children}
    </span>
  );
}

export function QuickView({
  model,
  seller,
  guest,
  onClose,
}: {
  /** `null` closes the dialog — and is also what a figure with no offer gives. */
  model: QuickViewModel | null;
  /**
   * Who sells on SkyIsles, from the page payload (ADR-0064, migration 0027).
   *
   * `null` is a real state — before the migration, or for an administrator —
   * and it renders **nothing**. No placeholder name, no "SkyIsles Seller", no
   * constant: a made-up trade name is a false statement about who a customer
   * is contracting with, which is worse than saying nothing.
   *
   * One seller for every row, because there is exactly one seller
   * (`sellers_one_active`). That is an identity, not a relation — no offer is
   * joined to a seller, and none can be until a second one exists.
   */
  seller?: PublicSeller | null;
  /** Whether nobody is signed in. Passed down from the server (ADR-0061). */
  guest: boolean;
  onClose: () => void;
}) {
  const headingId = "quick-view-name";

  if (!model) {
    // The dialog still mounts so `Modal` can run its close-down effects — it
    // simply has nothing inside it.
    return <Modal open={false} onClose={onClose} labelledBy={headingId} size="lg" />;
  }

  return (
    <Modal open onClose={onClose} labelledBy={headingId} size="lg">
      {/*
       * Pinned to the panel, not to the scrolling content, so it stays
       * reachable while the body scrolls on a phone.
       */}
      <button
        type="button"
        onClick={onClose}
        aria-label={de.quickView.close}
        className={
          "focus-ring absolute top-3 right-3 z-10 inline-flex h-11 w-11 items-center " +
          "justify-center rounded-full text-on-deep-muted transition-colors " +
          "hover:bg-white/10 hover:text-on-deep"
        }
      >
        <CloseGlyph />
      </button>

      {/* The only scrolling region. */}
      <div className="min-h-0 overflow-y-auto overscroll-contain">
        <div
          className={
            /*
             * Two columns from `sm:` (640 px), not from `md:` (768 px).
             *
             * The dialog is capped at 896 px, so by the time the viewport is
             * 640 px wide there is already room for a picture beside its
             * facts — and waiting for 768 px left a laptop window that was
             * merely not maximised rendering the phone layout on a desktop.
             *
             * The first column is measured in pixels, with a floor and a
             * ceiling, rather than as a share of the dialog. A percentage
             * made the picture grow with every pixel the dialog gained,
             * which is how a 320 px plate became a wall.
             */
            "grid gap-4 p-4 " +
            "sm:grid-cols-[minmax(170px,210px)_minmax(0,1fr)] sm:gap-5 sm:p-5 " +
            "md:grid-cols-[minmax(190px,230px)_minmax(0,1fr)] md:gap-6"
          }
        >
          {/*
           * THE PICTURE. White plate with a gold hairline: the figures were
           * cut out against white and turn to grey mush on navy, and the gold
           * edge is the same one the collector cards carry.
           *
           * Square, so a tall figure and a wide vehicle occupy the same
           * footprint and the column beside them never shifts. On a phone it
           * is capped at three fifths of the width and centred — big enough
           * to recognise, small enough that the price below it stays on the
           * first screen.
           */}
          <div
            className={
              /*
               * Absolute caps at both ends, and not one relative unit between
               * them. `w-full` fills whatever it is given; `max-w` decides
               * what that may be. On a phone the plate stops at 220 px so the
               * price zone stays on the first screen; beside the facts it
               * stops at 320 px and is bounded again by its own grid column,
               * so it cannot outgrow the dialog however wide the dialog gets.
               *
               * No `vw`, no percentage, no `min()` of either: those are what
               * made the size depend on the window instead of on the layout.
               */
              /*
               * Smaller on a phone than on a desktop (V3.2). The plate used
               * to take 220 px of a 390 px screen, which pushed the offer —
               * the thing this dialog exists for — below the fold. 150 px
               * still identifies the figure and leaves the price on the
               * first screen.
               */
              "mx-auto flex aspect-square w-full max-w-[150px] items-center justify-center " +
              "rounded-sky-md bg-template-window p-2.5 ring-1 ring-gold-line " +
              "sm:mx-0 sm:max-w-[210px] sm:p-3.5 md:max-w-[230px]"
            }
          >
            {model.imageSrc ? (
              /* Already optimised, content-addressed and served from /public
                 (ADR-0026) — `next/image` would re-optimise it at runtime for
                 nothing. */
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={model.imageSrc}
                alt={model.name}
                width={640}
                height={640}
                loading="lazy"
                decoding="async"
                className="h-full w-full object-contain"
              />
            ) : (
              <span className="text-xs text-template-ink-muted">{de.catalog.noImage}</span>
            )}
          </div>

          {/* THE FACTS, THE PRICES, THE OFFER. */}
          <div className="flex min-w-0 flex-col gap-3 sm:gap-4">
            <div className="flex min-w-0 flex-col gap-1">
              <h2
                id={headingId}
                /* Clear of the close button on the narrow layout, where the
                   heading runs the full width of the panel. */
                className="min-w-0 pr-12 text-xl leading-tight font-semibold text-balance text-on-deep break-words sm:pr-0 sm:text-2xl"
              >
                {model.name}
              </h2>

              {/* One subline instead of two labelled rows. */}
              <p className="text-sm leading-snug text-on-deep-muted">
                {model.seriesLabel}
                {model.categoryName ? ` · ${model.categoryName}` : ""}
              </p>

              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                {model.element ? <ElementChip element={model.element} size="xs" /> : null}
                <Chip>
                  <span className="tabular-nums">{model.skyId}</span>
                </Chip>
              </div>
            </div>

            {/*
             * THE MARKET VALUE — collector information, stated quietly.
             *
             * It shares no surface with the offers any more (ADR-0033). What
             * a figure is worth and what somebody asks for one are different
             * facts, and the previous draft put them in one bordered block
             * where they read as a single price.
             */}
            <p className="flex items-baseline gap-2">
              <span className="text-[11px] leading-tight tracking-wide text-on-deep-muted uppercase">
                {de.catalog.marketValue}
              </span>
              <span
                className={
                  model.marketPrice === null
                    ? "text-sm text-on-deep-muted"
                    : "text-base leading-tight font-semibold text-on-deep tabular-nums"
                }
              >
                {model.marketPrice === null ? de.catalog.noPrice : formatPrice(model.marketPrice)}
              </span>
            </p>

            {/*
             * THE OFFERS — the part that dominates this column.
             *
             * A list although the schema allows exactly one entry:
             * `shop_inventory` is unique on (sky_id, condition) and this
             * dialog trades only loose copies, so there is one row today. It
             * is written as a list because that is the shape a second seller
             * arrives into, and because a layout built around "exactly one"
             * would have to be rebuilt then rather than extended.
             *
             * What a row carries is what `shop_offers()` actually returns:
             * condition, price, and an availability boolean that is already
             * spent by filtering — nothing here is a seller name, a rating,
             * a review count or a delivery estimate, because none of those
             * exists anywhere in this product.
             */}
            <section aria-label={de.shop.offerHeading} className="flex flex-col gap-2">
              <h3 className="text-xs font-medium tracking-wide text-trade-solid/80 uppercase">
                {de.quickView.offersCount(model.offers.length)}
              </h3>

              <ul className="flex flex-col gap-2">
                {model.offers.map((offer) => (
                  <li
                    key={offer.condition}
                    className={
                      /*
                       * One offer, one line-and-a-bit. Never `flex-wrap` with
                       * a `w-full` child: that is what forced the seller block
                       * onto a row of its own and made a single loose offer
                       * look like a form.
                       *
                       * Two columns instead — what is being sold on the left,
                       * the action on the right — so a second seller simply
                       * adds another <li> of the same height.
                       */
                      "flex items-center justify-between gap-3 " +
                      "rounded-sky-md bg-white/[0.045] px-3 py-2.5 ring-1 ring-trade-line/70"
                    }
                  >
                    <div className="flex min-w-0 flex-col gap-0.5">
                      {/*
                       * No condition label. V1 sells loose figures and only
                       * loose figures, so "Lose" is not a distinction the
                       * buyer can act on — it labels the only thing there is.
                       * The price leads instead. If a second condition is ever
                       * offered, the label comes back here, because then it
                       * would carry information. See `V1_CONDITION`.
                       */}
                      <span className="text-lg leading-tight font-semibold text-on-deep tabular-nums">
                        {formatPrice(offer.price)}
                      </span>

                      {/*
                       * WHO IS SELLING — under the price, not beside it.
                       *
                       * The name comes from `seller_public()` by way of the
                       * page payload; it is nowhere in this file, and a test
                       * proves it. The second line is a platform statement
                       * rather than a column: only commercial sellers trade
                       * on SkyIsles, so it is true of every seller and is not
                       * stored per row (ADR-0021, ADR-0064).
                       *
                       * Absent entirely when no seller is published — never a
                       * placeholder name. A real reputation line would join
                       * this block as a third line; there is no rating model,
                       * and a star here would be decoration pretending to be
                       * evidence.
                       */}
                      {seller ? (
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] leading-tight text-on-deep">
                            {seller.displayName}
                          </span>
                          <span className="block text-[11px] leading-tight text-on-deep-muted">
                            {de.quickView.sellerKind}
                          </span>
                        </span>
                      ) : null}
                    </div>

                    <OfferAddButton
                      offer={offer}
                      name={model.name}
                      imageSrc={model.imageSrc}
                      compact
                      className="shrink-0"
                    />
                  </li>
                ))}
              </ul>
            </section>

            {/*
             * THE WAY ON — a sentence, not a footer.
             *
             * It used to be a full-width button on a bordered bar across the
             * dialog, which gave the quietest thing here the heaviest shape
             * and added a band of empty floor under it. The detail page is
             * where the rest is — the character, the element, the boxed
             * offer — and offering it is worth one line.
             *
             * Still a real `<Link>` with `prefetch={false}`: the per-figure
             * prefetch stays withdrawn (a0353cb), and a middle click still
             * opens the page in a new tab.
             */}
            <Link
              href={`/skylanders/${model.slug}`}
              prefetch={false}
              aria-label={de.quickView.toDetailFor(model.name)}
              className={
                "focus-ring -mx-1 inline-flex min-h-11 items-center gap-1 self-start rounded-sky-sm px-1 " +
                "text-sm text-on-deep-muted transition-colors hover:text-on-deep sm:min-h-8"
              }
            >
              {de.quickView.toDetail}
              <span aria-hidden="true" className="text-base leading-none">
                →
              </span>
            </Link>

            {/* GUESTS ONLY (ADR-0061). A signed-in basket lives in `cart_items`
                and follows the account; telling that visitor where the basket
                is kept would answer a question they do not have. */}
            {guest ? (
              <p className="text-xs leading-snug text-on-deep-muted">{de.cart.guestOnly} {de.cart.guestOnlyHint}</p>
            ) : null}
          </div>
        </div>
      </div>

    </Modal>
  );
}
