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
import {
  AccountGlyph,
  AdminGlyph,
  CatalogGlyph,
  CollectionGlyph,
  InventoryGlyph,
  MessagesGlyph,
} from "@/components/layout/nav-glyphs";
import { AttentionBadge } from "@/components/ui/attention-badge";
import { CartToast } from "@/components/cart/cart-toast";
import { Wordmark } from "@/components/layout/wordmark";
import { NO_OPEN_ORDERS, type OpenOrderCounts } from "@/lib/admin/orders";
import { activeSection, type NavSection } from "@/lib/nav/sections";
import { de } from "@/lib/i18n/de";

type Item = {
  href: string;
  label: string;
  section: NavSection;
  /** The destination's mark. Drawn beside the label on the phone (V3.4.1). */
  icon: ({ className }: { className?: string }) => React.ReactElement;
  prefetch?: boolean;
  /** How many orders are flagged. Only the shop ever carries this (F5). */
  badge?: number;
};

/** Who is asking. Nothing else decides what the bar offers. */
/**
 * The account's type, as the bar sees it (ADR-0077, ADR-0078).
 *
 * Exactly one of the three is true at a time — the database refuses an account
 * that would be two — so the bar never has to decide which of two identities
 * to draw. All of it comes from `capabilities()`, the same server-side answer
 * the route guards use. Never from an address, a display name or the current
 * path: a link that appears on different evidence from the guard behind it is
 * how an operator ends up staring at a 404.
 */
type Viewer = { signedIn: boolean; admin: boolean; business: boolean; collector: boolean };

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
  /**
   * The destination's mark, shown beside its label on the phone only (V3.4.1).
   *
   * Every destination has one, including the operator's two. The bar is one
   * bar: an administrator sees the catalog next to `Lager` and `Admin`, so
   * drawing only the collector's would leave that viewer with one illustrated
   * item and two bare ones.
   */
  icon: ({ className }: { className?: string }) => React.ReactElement;
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
  badge?: (counts: OpenOrderCounts, unread: Unread) => number;
}[] = [
  {
    href: "/",
    label: de.nav.catalog,
    section: "catalog",
    icon: CatalogGlyph,
    applies: () => true,
  },

  {
    href: "/collection",
    label: de.nav.collection,
    section: "collection",
    icon: CollectionGlyph,
    /*
     * A collector's own collection. The SELLER is the operator, not a
     * collector (ADR-0032): offering it a personal collection as a main
     * destination would suggest the shop's stock lives there. The page still
     * exists and still works for them — it is simply not offered.
     *
     * `collector`, not `!business`: since 0042 an account is exactly one of
     * user, business or admin (ADR-0078), and only the first has a collection.
     * An administrator is a platform operator account, not a collector with
     * extra buttons — the row policies refuse them the table outright.
     */
    applies: (viewer) => viewer.collector,
    // Prefetched only for someone who has a collection. Signed out the route
    // answers with a redirect to /login, so fetching it ahead of time would
    // cost a request and a session check for a page they cannot see (V4.4).
    // `undefined` leaves Next's own default in place.
    prefetch: (viewer) => (viewer.signedIn ? undefined : false),
  },

  {
    href: "/business",
    label: de.nav.business,
    section: "business",
    icon: InventoryGlyph,
    /*
     * The shop. Offered to whoever may actually run it — not to whoever
     * happens to administer SkyIsles (ADR-0077).
     *
     * It carries the flagged-order count, because a paid order that booked no
     * stock is the seller's problem to solve and nobody else can (ADR-0050).
     * Until 0041 that badge sat on "Admin", which is now the wrong desk.
     */
    applies: (viewer) => viewer.business,
    prefetch: () => false,
    badge: (counts) => counts.needsResolution,
  },

  {
    href: "/business/inventory",
    label: de.nav.inventory,
    section: "inventory",
    icon: InventoryGlyph,
    // The operator's stock. Where a collector has their collection, the
    // seller has the shop's shelf (ADR-0032) — a destination of its own, not
    // the collection under another name.
    //
    // `viewer.business`, not `viewer.admin`: an administrator who was never
    // granted the shop gets 404 here, so offering the link would be an
    // invitation to a wall.
    applies: (viewer) => viewer.business,
    prefetch: () => false,
  },

  {
    href: "/business/nachrichten",
    label: de.nav.messages,
    section: "messages",
    icon: MessagesGlyph,
    /*
     * Der Posteingang des Betriebs (0098). Eigener Punkt und nicht eine Zahl
     * an „Shop": eine Rückfrage zu einer Bestellung ist eine andere Aufgabe
     * als eine Bestellung, die auf Versand wartet, und sie wird an einem
     * anderen Ort erledigt.
     */
    applies: (viewer) => viewer.business,
    prefetch: () => false,
    badge: (_counts, unread) => unread.seller,
  },

  {
    href: "/admin",
    label: de.nav.admin,
    section: "admin",
    icon: AdminGlyph,
    // Convenience, never a permission (ADR-0039). /admin answers 404 to
    // everyone else whether or not they find the address.
    applies: (viewer) => viewer.admin,
    prefetch: () => false,
  },

  /*
   * The account is NOT here (V3.4.1).
   *
   * It used to be the third word in the bar — "Profil" when signed in,
   * "Anmelden" when not — beside Katalog and Sammlung. Those two are areas of
   * the product a collector moves between; an account is a platform action,
   * the same kind of thing the cart is, and it now sits beside the cart in
   * the header where that kind of thing belongs.
   *
   * There is exactly one way to it, on every width: `AccountAction` below. A
   * spelled-out entry here and an icon up there would be two doors to one
   * room, and the active state would light up in two places at once.
   */
];


/**
 * Ungelesenes, getrennt nach Seite (0098).
 *
 * Zwei Zahlen und nicht eine: der Betrieb und das eigene Konto sind zwei
 * Posteingänge, und ein Verkäufer hat beide. Welche gefüllt ist, entscheidet
 * das Layout — es weiß, wessen Seite gerade gezeigt wird.
 */
export type Unread = { mine: number; seller: number };
export const NO_UNREAD: Unread = { mine: 0, seller: 0 };

function itemsFor(
  signedIn: boolean,
  admin: boolean,
  business: boolean,
  counts: OpenOrderCounts,
  unread: Unread,
): Item[] {
  /*
   * Collector = neither privileged membership, which is what "USER" means
   * (ADR-0078). A signed-out visitor counts: Sammlung has always been offered
   * to them and leads to sign-in, and taking it away would hide the product's
   * second half from exactly the people being invited into it.
   */
  const viewer: Viewer = { signedIn, admin, business, collector: !admin && !business };
  return DESTINATIONS.filter((destination) => destination.applies(viewer)).map(
    ({ href, label, section, icon, prefetch, badge }) => ({
      href,
      label,
      section,
      icon,
      prefetch: prefetch?.(viewer),
      badge: badge?.(counts, unread) ?? 0,
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

/**
 * Who you are, and the way into the account (V3.4.2, wieder zusammengelegt).
 *
 * EINE AKTION, EIN ZIEL. Eine Zeit lang standen hier zwei: Name plus Person
 * führten auf `/account/profile`, die Karte daneben auf `/account`. Zwei
 * Symbole für denselben Bereich, und niemand konnte ihnen ansehen, welches
 * wohin führt — das Profil ist ja eine Kachel innerhalb des Kontos, keine
 * Nebentür. Jetzt gibt es wieder genau einen Knopf, und er führt dorthin, wo
 * alles steht.
 *
 *   name + person  ->  /account   alles zum Konto, das Profil eingeschlossen
 *
 * Die Zahl ungelesener Nachrichten sitzt seither an diesem einen Knopf. Sie
 * hing vorher an der Karte; mit ihr wäre sie verschwunden.
 *
 * THE NAME IS THE USERNAME, and nothing else. `profiles.username` is three to
 * twenty characters of `[a-zA-Z0-9_]`, so it is a handle rather than a name —
 * there is no given name on a profile, and the ones in `customer_contacts`
 * and `order_addresses` are delivery data, not identity.
 *
 * NEUTRAL, both of them. An account is neither a possession nor a purchase,
 * so neither the ownership gold nor the commerce amber applies. The cart
 * beside them keeps its amber and its silver count.
 */
function ProfileAction({
  signedIn,
  username,
  active,
  unread,
}: {
  signedIn: boolean;
  /** `null` before onboarding, and for everybody who is not signed in. */
  username: string | null;
  active: boolean;
  /** Ungelesene Nachrichten dieses Kontos. 0 für alle anderen. */
  unread: number;
}) {
  const name = signedIn ? username : null;
  /*
   * An `aria-label` replaces the element's content outright, so when a name
   * is on screen the label has to carry it too — otherwise the one thing a
   * sighted visitor reads is the one thing a screen reader never hears.
   */
  const base = !signedIn ? de.nav.signIn : name ? de.nav.profileOf(name) : de.nav.profile;
  /* Die Zahl gehört in den vorgelesenen Namen: eine Marke allein ist für
     jemanden, der sie nicht sieht, gar nichts. */
  const label = unread > 0 ? `${base} — ${de.messages.unreadBadgeLabel(unread)}` : base;

  return (
    <Link
      href={signedIn ? "/account" : "/login"}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      /*
       * `min-w-0` here as well as on the group around it: the chain has to be
       * unbroken, because a flex item's default `min-width: auto` refuses to
       * shrink below its content and `truncate` would never get its turn.
       */
      className={
        "focus-ring flex min-w-0 items-center gap-1.5 rounded-full transition-colors " +
        (active ? "text-on-deep" : "text-on-deep-muted hover:text-on-deep")
      }
    >
      {/*
       * THE NAME GROWS AND SHRINKS TO THE LEFT, AND NOTHING ELSE MOVES.
       *
       * The group is anchored right by `ml-auto`, every icon box is
       * `shrink-0`, and this is the only elastic thing in the row — so a
       * twenty-character username eats leftward into empty space and a narrow
       * phone truncates it, while the person, the cog and the cart stay where
       * they were. `text-right` keeps the visible end of a truncated name
       * against the glyph it belongs to.
       *
       * Absent entirely when there is no username — before onboarding there
       * is nothing to show, and an empty box or a dash would be furniture
       * standing in for a fact that does not exist yet.
       */}
      {name ? (
        <span className="min-w-0 truncate text-right text-[13px] leading-none font-medium">
          {name}
        </span>
      ) : null}
      {/* 44 px around an 18 px mark. Fixed, so the name cannot squeeze it. */}
      <span className="relative flex h-11 w-11 shrink-0 items-center justify-center">
        <AccountGlyph className="h-[18px] w-[18px]" />
        {unread > 0 ? <AttentionBadge count={unread} label={de.messages.unreadBadgeLabel(unread)} /> : null}
      </span>
    </Link>
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
        "relative flex min-h-11 flex-1 items-center justify-center gap-1.5 px-3 text-sm " +
        "transition-colors md:flex-none md:gap-0 md:px-1 md:py-2 md:text-[15px] " +
        (active
          ? // A gold underline, not a filled pill. The pill was the last
            // thing on the page that still looked like a web app toolbar
            // (ADR-0038, V3.2); the reference underlines instead.
            "font-medium text-on-deep"
          : "text-on-deep-muted hover:text-on-deep")
      }
    >
      {/*
       * Beside the label, not above it, and only below `md:` (V3.4.1).
       *
       * Above would be the usual shape for a phone bar and would make it
       * taller — and the bar's height is 2.75rem, a number `NavSpacer`
       * reserves in two layouts. Beside costs nothing: with two destinations
       * each half of a 360 px screen holds an 18 px mark and "Sammlung" with
       * room to spare, and the operator's three still fit.
       *
       * Hidden from `md:` up, where the navigation is a row of words in the
       * masthead and a mark beside each would turn it into a toolbar.
       */}
      <item.icon className="h-[18px] w-[18px] md:hidden" />
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
  business = false,
  openOrders = NO_OPEN_ORDERS,
  unread = NO_UNREAD,
  username = null,
}: {
  signedIn: boolean;
  /** Runs SkyIsles. Grants nothing commercial (ADR-0077). */
  admin?: boolean;
  /** May run the shop. Grants nothing on the catalog (ADR-0077). */
  business?: boolean;
  /**
   * The signed-in visitor's handle, from `profiles.username` (V3.4.2).
   *
   * `null` is a real state twice over: nobody is signed in, or somebody is
   * and has not been through onboarding yet. Both render the person glyph
   * alone. Supplied by the layout — every one of the three already knows who
   * is asking, and none of them fetches it from the browser.
   */
  username?: string | null;
  /**
   * How much work is waiting, counted on the server (F5).
   *
   * Zeroes for everybody who is not an administrator, and no query was made to
   * find that out — `fetchOpenOrderCounts()` asks `isAdmin()` first.
   */
  openOrders?: OpenOrderCounts;
  /** Ungelesene Nachrichten, je Seite (0098). Nullen ohne eine Abfrage. */
  unread?: Unread;
}) {
  const pathname = usePathname();
  const active = activeSection(pathname ?? "/");
  const items = itemsFor(signedIn, admin, business, openOrders, unread);

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
  /*
   * WHICH OF THE TWO ACCOUNT ACTIONS IS CURRENT (V3.4.2).
   *
   * `activeSection()` answers "account" for the whole area, which was exactly
   * right while one control stood for all of it. Two controls need one level
   * more, and only here — the section model still has the granularity the
   * rest of the product wants, and widening it would change what `/settings`
   * and `/onboarding` mean everywhere else for the sake of one header.
   *
   * Ein Knopf, ein Zustand: jede Konto-Route lässt ihn leuchten. Die frühere
   * Aufteilung zwischen Profil und Rest gibt es nicht mehr.
   */
  const accountActive = active === "account";

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
        {/*
         * Quiet, and always there while it applies (ADR-0042): the capability
         * has to be recognisable without turning the site into a back office.
         * Tonal since V3.1 — the gold it used to borrow belongs to the
         * collection, and a capability is not ownership.
         *
         * TWO BADGES, NOT A RANK (ADR-0077). Business and Admin are separate
         * capabilities, so an account holding both shows both rather than the
         * "higher" one: there is no higher one. A collector sees neither.
         */}
        {business ? (
          <span className="rounded-full bg-status-ground px-2 py-0.5 text-[11px] leading-4 font-medium text-status-ink ring-1 ring-status-line">
            {de.business.modeBadge}
          </span>
        ) : null}
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
       * THE GLOBAL ACTIONS (V3.4.1).
       *
       * The header carries what belongs to the platform — who you are, and
       * what you are buying. The bar below carries where you are: the
       * catalogue and the collection. That split is the whole of this change.
       *
       * One group, `ml-auto`, account first and cart at the outer edge, at
       * every width. On a phone the navigation is out of flow at the bottom
       * of the screen, so this row reads `[wordmark] ......... [account]
       * [cart]`.
       */}
      <div className="ml-auto flex min-w-0 items-center gap-0.5 sm:gap-1">
        <ProfileAction
          signedIn={signedIn}
          username={username}
          active={accountActive}
          unread={unread.mine}
        />
        {/*
         * THE ONLY CART ENTRY POINT (V3.4, ADR-0043), at the outer edge.
         *
         * Not offered to the operator: SkyIsles does not buy from itself, and
         * a basket in the administrator's header would suggest the shop is a
         * place they shop (ADR-0042). The route still answers; it is simply
         * not one of their destinations — and the account beside it stays,
         * because an operator has one.
         */}
        {admin ? null : <CartBadge />}
      </div>
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
