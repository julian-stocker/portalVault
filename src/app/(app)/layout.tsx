/**
 * Protected area.
 *
 * The proxy already turns anonymous visitors away, but that is convenience.
 * This layout checks the session on the server itself, and row level security
 * remains the actual boundary (docs/SECURITY.md).
 */
import { redirect } from "next/navigation";

import { PrincipalGate } from "@/components/layout/principal-gate";
import { SiteFooter } from "@/components/layout/site-footer";
import { NavSpacer, SiteNav } from "@/components/layout/site-nav";
import { WorldZone } from "@/components/layout/world-zone";
import { fetchOpenOrderCounts } from "@/lib/admin/order-queries";
import { fetchMyUnread, fetchSellerUnread } from "@/lib/messages/queries";
import { fetchUnreadNoticeCount } from "@/lib/favorites/notification-queries";
import { fetchMyAttentionTotal, fetchSellerAttentionTotal } from "@/lib/attention/queries";
import { capabilities } from "@/lib/auth/capabilities";
import { currentProfile } from "@/lib/auth/profile";
import { SIGN_IN_PATH } from "@/lib/auth/redirect";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await currentProfile();
  if (!profile) redirect(SIGN_IN_PATH);
  // Both capabilities, from the one memoised answer the route guards use
  // (ADR-0077). The bar offers a destination only to whoever may enter it.
  const { platformAdmin, sellerOperator } = await capabilities();
  // Zeroes without a query for a collector; see `fetchOpenOrderCounts()`.
  const openOrders = await fetchOpenOrderCounts();
  /*
   * Die zwei Posteingänge (0098). Beide Zahlen kommen aus Aggregaten und
   * antworten einem Unbeteiligten mit 0, ohne dass hier eine Rolle geprüft
   * werden müsste.
   */
  /* Zwei Kanäle je Rolle (0099): Nachrichten und Bestellereignisse. Beide
     `cache()`-gebunden, beide in derselben Anfrage — deshalb kann die Zahl am
     Symbol nicht von den Zahlen an den Karten abweichen. */
  /*
   * DIE DRITTE ZAHL: ungelesene Verfuegbarkeitsmeldungen (Phase 4 S4, `0149`).
   *
   * NUR FUER EIN SAMMLERKONTO, und das ist keine Sparsamkeit, sondern
   * dieselbe Grenze wie am Menuepunkt selbst: die Wunschliste wird nur einem
   * Sammler angeboten (ADR-0078), also traegt nur dort eine Marke eine
   * Aussage. Fuer ein Betriebs- oder Adminkonto gibt es nichts zu zaehlen,
   * und es wird auch nicht gefragt — `0` ohne Zugriff.
   *
   * EINE ABFRAGE, und sie holt nur die Zahl (`head: true`) ueber den
   * Teilindex aus `0149`. `cache()` bindet sie an die Anfrage: fragt eine
   * Seite dieselbe Zahl noch einmal, kostet sie dort nichts.
   *
   * WARUM DIE LEISTE NICHT SELBST VERARBEITET. Die Verarbeitung faelliger
   * Ereignisse haengt am Aufruf von `/favoriten` (S4, Punkt 4) und nicht an
   * jedem geschuetzten Seitenaufruf. Eine Meldung, die GENAU DURCH diesen
   * Aufruf von `/favoriten` entsteht, steht deshalb sofort auf der Seite,
   * waehrend die Marke sie erst bei der naechsten Navigation zaehlt — und
   * das ist unsichtbar: auf `/favoriten` ist dieser Menuepunkt der aktive,
   * und die Meldungen stehen dort gross in Sicht. Eine Marke an der Seite,
   * auf der man schon ist, erzaehlt niemandem etwas Neues.
   */
  const unread = {
    mine: await fetchMyUnread(),
    seller: sellerOperator ? await fetchSellerUnread() : 0,
    notices: !platformAdmin && !sellerOperator ? await fetchUnreadNoticeCount() : 0,
  };
  const attention = {
    mine: await fetchMyAttentionTotal(),
    seller: sellerOperator ? await fetchSellerAttentionTotal() : 0,
  };


  return (
    <div className="relative flex min-h-screen flex-col">
      {/* Who this browser is acting as. Draws nothing (ADR-0061). */}
      <PrincipalGate userId={profile.id} />
      {/* The same navigation the public catalog uses — one component, two
          mounts, rather than two systems to keep in step. The active section
          comes from the path, so /collection and /settings light up too. */}
      {/* `profile` is already loaded above — the username costs nothing here. */}
      <SiteNav
        signedIn
        admin={platformAdmin}
        business={sellerOperator}
        openOrders={openOrders}
        unread={unread}
        attention={attention}
        username={profile.username}
      />
      <div className="relative flex-1">
        {/*
         * The world begins UNDER the header (V3.4).
         *
         * It used to be drawn behind it — the header was glass and the sky was
         * the same sky above and below the hairline (ADR-0038, V3.3). That is
         * the decision this release reverses: the header is now an opaque top
         * edge, so artwork behind it would be artwork nobody can see, and the
         * `top-0` it is anchored to has to mean "below the masthead".
         *
         * Inside the content wrapper, which is `relative` for exactly this
         * reason. Still owned by the layout rather than by a page, so it
         * survives client navigation between the two route groups.
         */}
        <WorldZone variant="world" />
        {children}
      </div>
      {/* The same footer as the public pages: a signed-in collector needs the
          same destinations, and a second variant would be a second thing to
          keep in step. */}
      <SiteFooter />
      <NavSpacer />
    </div>
  );
}
