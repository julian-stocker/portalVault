/**
 * The one navigation.
 *
 * A single header element carries both layouts. On phones the nav inside it
 * is fixed to the bottom — where the thumb is — which takes it out of flow
 * and leaves the header showing only the wordmark. From `md:` upwards the
 * nav goes static and sits in the same row as the wordmark. One markup, one
 * set of links, no second system to keep in step.
 *
 * Three destinations, and only three: catalog, collection, account. Signing
 * out is not a place you navigate to, so it lives in /settings (ADR-0036).
 *
 * The active state is a tonal pill on desktop rather than the hairline it
 * used to be. A 2 px underline is what a documentation site uses; on a
 * product header it read as unfinished. The bottom bar keeps the bar shape,
 * because there a pill under the thumb competes with the labels beside it.
 *
 * V3 seats it in the world: a dark glass bar with a gold hairline under it,
 * rather than a white strip laid on the sky. The blur keeps the sky present
 * behind it without letting anything through that would fight the labels.
 */
"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";

import { CartBadge } from "@/components/cart/cart-badge";
import { CartToast } from "@/components/cart/cart-toast";
import { Wordmark } from "@/components/layout/wordmark";
import { NO_OPEN_ORDERS, type OpenOrderCounts } from "@/lib/admin/orders";
import { activeSection, type NavSection } from "@/lib/nav/sections";
import { de } from "@/lib/i18n/de";

type Item = {
  href: string;
  label: string;
  section: NavSection;
  prefetch?: boolean;
  /** How many orders are flagged. Only "Admin" ever carries this (F5). */
  badge?: number;
};

/** Who is asking. Nothing else decides what the bar offers. */
type Viewer = { signedIn: boolean; admin: boolean };

/**
 * Every destination the product has, each with the condition under which it
 * belongs to somebody (ADR-0042).
 *
 * Written as a list rather than as branches on purpose: the bar is composed
 * by asking each destination whether it applies, never by putting one entry
 * in another's place. "Admin" does not replace "Sammlung"; the collection is
 * simply not one of an operator's destinations, and administration is one of
 * theirs. That distinction is what keeps the next step a one-line change:
 * `Lager` becomes an entry between collection and admin whose condition is
 * `viewer.admin`, and nothing else moves.
 *
 * Order here is the order on screen.
 */
const DESTINATIONS: readonly {
  href: string;
  label: string;
  section: NavSection;
  applies: (viewer: Viewer) => boolean;
  prefetch?: (viewer: Viewer) => boolean | undefined;
  /**
   * A count worth interrupting for, or 0.
   *
   * Only one destination has one and only one number qualifies: an order in
   * `needs_resolution` is paid, has booked no stock and cannot be shipped
   * (ADR-0050). Orders merely waiting to be sent are ordinary work and are
   * counted on /admin, not shouted about in the bar — three loud levels mean
   * none of them is.
   */
  badge?: (counts: OpenOrderCounts) => number;
}[] = [
  { href: "/", label: de.nav.catalog, section: "catalog", applies: () => true },

  {
    href: "/collection",
    label: de.nav.collection,
    section: "collection",
    // A collector's own collection. The business account is the operator,
    // not a collector (ADR-0032): offering it a personal collection as a
    // main destination would suggest the shop's stock lives there. The page
    // still exists and still works for them — it is simply not offered.
    applies: (viewer) => !viewer.admin,
    // Prefetched only for someone who has a collection. Signed out the route
    // answers with a redirect to /login, so fetching it ahead of time would
    // cost a request and a session check for a page they cannot see (V4.4).
    // `undefined` leaves Next's own default in place.
    prefetch: (viewer) => (viewer.signedIn ? undefined : false),
  },

  {
    href: "/admin/inventory",
    label: de.nav.inventory,
    section: "inventory",
    // The operator's stock. Where a collector has their collection, the
    // business account has the shop's shelf (ADR-0032) — a destination of
    // its own, not the collection under another name.
    applies: (viewer) => viewer.admin,
    prefetch: () => false,
  },

  {
    href: "/admin",
    label: de.nav.admin,
    section: "admin",
    // Convenience, never a permission (ADR-0039). /admin answers 404 to
    // everyone else whether or not they find the address.
    applies: (viewer) => viewer.admin,
    prefetch: () => false,
    badge: (counts) => counts.needsResolution,
  },

  {
    href: "/account",
    label: de.nav.settings,
    section: "account",
    applies: (viewer) => viewer.signedIn,
  },
  {
    href: "/login",
    label: de.nav.signIn,
    section: "account",
    applies: (viewer) => !viewer.signedIn,
  },
];

function itemsFor(signedIn: boolean, admin: boolean, counts: OpenOrderCounts): Item[] {
  const viewer: Viewer = { signedIn, admin };
  return DESTINATIONS.filter((destination) => destination.applies(viewer)).map(
    ({ href, label, section, prefetch, badge }) => ({
      href,
      label,
      section,
      prefetch: prefetch?.(viewer),
      badge: badge?.(counts) ?? 0,
    }),
  );
}

/**
 * The click has been heard.
 *
 * `useLinkStatus` is pending only while a navigation is actually waiting —
 * when the route was prefetched, this never lights up, which is exactly the
 * intended order of defence: `loading.tsx` first, this for the slow network
 * where the prefetch has not finished.
 *
 * Always rendered, never resized: it changes opacity, so nothing on the bar
 * moves when it appears.
 */
function PendingDot() {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden="true"
      className={
        "pointer-events-none absolute -right-0.5 top-1/2 h-1.5 w-1.5 -translate-y-1/2 " +
        "rounded-full bg-foreground transition-opacity duration-150 md:-right-2.5 " +
        (pending ? "animate-pulse opacity-100" : "opacity-0")
      }
    />
  );
}

/**
 * "Something here needs a person" — and nothing else in the product says it.
 *
 * A flagged order is paid, booked nothing and is locked against shipping
 * (ADR-0050). Until now the only way to learn of one was to open /admin/orders
 * on a hunch, so the one state that actively protects money had no route to
 * the human it needs.
 *
 * `--danger` rather than the accent: the accent is what SkyIsles offers, and
 * this is not an offer. The count is repeated in the accessible name, because
 * a bare number over a word is not a sentence.
 */
function AttentionBadge({ count }: { count: number }) {
  return (
    <span
      className={
        "ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full px-1.5 " +
        "bg-danger/20 text-[11px] leading-4 font-semibold text-danger tabular-nums " +
        "ring-1 ring-danger/60"
      }
    >
      <span aria-hidden="true">{count > 99 ? "99+" : count}</span>
      <span className="sr-only">{de.admin.orders.badgeLabel(count)}</span>
    </span>
  );
}

function NavItem({ item, active }: { item: Item; active: boolean }) {
  return (
    <Link
      href={item.href}
      prefetch={item.prefetch}
      // Announced as the current page, not merely coloured differently.
      aria-current={active ? "page" : undefined}
      className={
        "relative flex min-h-11 flex-1 items-center justify-center px-3 text-sm " +
        "transition-colors md:flex-none md:px-1 md:py-2 md:text-[15px] " +
        (active
          ? // A gold underline, not a filled pill. The pill was the last
            // thing on the page that still looked like a web app toolbar
            // (ADR-0038, V3.2); the reference underlines instead.
            "font-medium text-on-deep"
          : "text-on-deep-muted hover:text-on-deep")
      }
    >
      {item.label}
      {item.badge ? <AttentionBadge count={item.badge} /> : null}
      <PendingDot />
      {/* A shape as well as a colour. Above the label in the phone bar so
          the thumb never covers it, under it in the header. */}
      {active ? (
        <span
          aria-hidden="true"
          className={
            // Neutral since V3.1: where you are is not a state of the
            // collection and not an offer. Near-white rather than tonal,
            // because a 3 px line has to carry its own contrast — a fill
            // token would vanish at that width.
            "absolute inset-x-3 top-0 h-0.5 rounded-full bg-nav-active-ink " +
            "md:inset-x-0 md:top-auto md:-bottom-1 md:h-[3px] " +
            "md:shadow-[0_0_12px_rgb(240_239_248/0.45)]"
          }
        />
      ) : null}
    </Link>
  );
}

export function SiteNav({
  signedIn,
  admin = false,
  openOrders = NO_OPEN_ORDERS,
}: {
  signedIn: boolean;
  admin?: boolean;
  /**
   * How much work is waiting, counted on the server (F5).
   *
   * Zeroes for everybody who is not an administrator, and no query was made to
   * find that out — `fetchOpenOrderCounts()` asks `isAdmin()` first.
   */
  openOrders?: OpenOrderCounts;
}) {
  const pathname = usePathname();
  const active = activeSection(pathname ?? "/");
  const items = itemsFor(signedIn, admin, openOrders);

  /**
   * The cart confirmation belongs to the same question as the header cart —
   * "where is my cart" — so it is mounted here, once, rather than by every
   * page that might want it (V9, V10).
   *
   * Not for the operator, for the same reason the cart is not: SkyIsles does
   * not buy from itself (ADR-0042).
   *
   * V3.4 removed the floating cart that used to be mounted beside it. There
   * is one cart entry point now, in the header, and it is reachable from
   * anywhere because the header is sticky.
   */
  const shopping = !admin;

  return (
    /*
     * The header, and then the two floating pieces — deliberately **outside**
     * it (V10).
     *
     * The header carries `backdrop-blur`, and an ancestor with an active
     * `backdrop-filter` may become the containing block for its
     * `position: fixed` descendants. Engines disagree about that, so a
     * viewport-fixed element must not sit inside one: WebKit places it
     * against the viewport, others against the header — which would put a
     * "bottom right" button at the top of the page.
     */
    <>
      {/* Dark glass over the sky, closed by a gold hairline. `border-b`
          carries the gold rather than a separate element, so nothing can
          drift out of alignment with the bar. */}
      <header
      className={
        /*
         * THE TOP EDGE OF THE WORLD, NOT A PANE OVER IT (V3.4).
         *
         * It was `bg-deep/80 backdrop-blur-md` with a 28 px shadow at 40 %
         * black, and the sky was drawn behind it — glass floating above the
         * page (ADR-0038, V3.3). On a phone that read as one more overlay
         * among several, which is what this release is about.
         *
         * Three things make it sit down instead: an opaque ground, no blur,
         * and no drop shadow. A shadow says "I am above this"; the gold
         * hairline below and the two struck lines inside say "this is where
         * the world begins" — and `WorldZone` now starts underneath, so the
         * statement is true rather than merely drawn.
         *
         * `sticky top-0` is unchanged and is the point: flush at the top on
         * load, in the document flow, and still there after scrolling — which
         * is why the floating cart has nothing left to do.
         *
         * Removing the blur also removes a latent hazard. An ancestor with an
         * active `backdrop-filter` may become the containing block for its
         * `position: fixed` descendants, and the phone's bottom bar is one.
         * It is no longer at anybody's mercy. This is NOT a reason to move
         * `CartToast` in here; see below.
         *
         * A flex row at every width now, not only from `md:`. That is what
         * lets the cart sit at the right end of the row on a phone as well.
         */
        "relative sticky top-0 z-30 flex items-center gap-2 border-b border-world-edge " +
        "bg-deep px-4 py-3 md:gap-8 md:px-6 md:py-4"
      }
    >
      {/* A thin warm line inside the top edge: the bar catches the light of
          the sky above it rather than sitting flat on it. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/12"
      />
      {/* A second, warmer line just inside the gold edge: the bar reads as a
          struck plate rather than a rectangle with a border. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-px h-px bg-world-sheen"
      />
      {/* The brand lockup: wordmark, and the mode badge when there is one. */}
      <div className="relative flex shrink-0 items-center gap-2">
        <Link href="/" className="flex items-center" aria-label={de.app.name}>
          <Wordmark />
        </Link>
        {/* Quiet, and always there while it applies (ADR-0042): the mode has
            to be recognisable without turning the site into a back office.
            Tonal since V3.1: being an administrator is a UI state, and the
            gold it used to borrow belongs to the collection. */}
        {admin ? (
          <span className="rounded-full bg-status-ground px-2 py-0.5 text-[11px] leading-4 font-medium text-status-ink ring-1 ring-status-line">
            {de.admin.modeBadge}
          </span>
        ) : null}

      </div>

      <nav
        aria-label={de.nav.primary}
        className={
          // Out of flow on phones, so the header above collapses to just the
          // wordmark. The safe-area padding keeps the labels clear of the
          // home indicator.
          "fixed inset-x-0 bottom-0 z-20 flex border-t border-gold-line bg-deep/95 " +
          "backdrop-blur-md pb-[env(safe-area-inset-bottom)] " +
          "md:static md:gap-7 md:border-t-0 md:bg-transparent md:pb-0 md:backdrop-blur-none"
        }
      >
        {items.map((item) => (
          <NavItem key={item.href} item={item} active={active === item.section} />
        ))}
      </nav>

      {/*
       * THE ONLY CART ENTRY POINT (V3.4, ADR-0043).
       *
       * Its own group at the right end of the row, separated from the
       * navigation by `ml-auto` rather than sitting two pixels from the
       * wordmark, where it used to look like part of the brand lockup.
       * Destinations on the left, actions on the right.
       *
       * On a phone the navigation is out of flow at the bottom of the screen,
       * so this row is `[wordmark] ......... [cart]` — which is the whole of
       * the mobile header, and why the floating button is gone.
       *
       * Not offered to the operator: SkyIsles does not buy from itself, and a
       * basket in the administrator's header would suggest the shop is a
       * place they shop (ADR-0042). The route still answers; it is simply not
       * one of their destinations.
       */}
      {admin ? null : (
        <div className="ml-auto flex shrink-0 items-center">
          <CartBadge />
        </div>
      )}
      </header>

      {/*
       * Still OUTSIDE the header, and deliberately so.
       *
       * The header no longer carries a `backdrop-filter`, so the containing
       * block hazard that put this here is gone — but "the reason expired" is
       * not a reason to move a fixed overlay inside a sticky ancestor. It
       * costs nothing where it is and cannot be broken by a later header
       * change.
       */}
      {shopping ? <CartToast /> : null}
    </>
  );
}

/**
 * Spacer so the fixed bottom bar never covers the last row of cards.
 * Only needed below `md:`, where the bar is fixed — and it has to include the
 * safe-area inset the bar itself is padded by.
 */
export function NavSpacer() {
  return (
    <div
      aria-hidden
      className="h-[calc(2.75rem+env(safe-area-inset-bottom))] md:hidden"
    />
  );
}
