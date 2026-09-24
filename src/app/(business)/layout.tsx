/**
 * The seller's area — where yulez.collectibles is run.
 *
 * Its own route group with the check at the top: everything below `/business`
 * is behind one server-side question, asked before any page renders or any
 * order is fetched.
 *
 * **NOT `isAdmin()`.** That is the whole point of ADR-0077. Running SkyIsles
 * and running the shop are separate capabilities, so a platform administrator
 * who has not been granted the shop gets the same 404 here as a collector.
 * Both may be the same person today; they are not the same authority, and the
 * day they are two people nothing has to move.
 *
 * **404, not 403.** For anyone without the capability the area does not exist
 * — a "forbidden" page confirms there is something there. Same answer for an
 * anonymous visitor and for a signed-in one.
 *
 * This is the first of two gates, not the boundary. Every commercial write is
 * a `security definer` function asking `can_operate_active_seller()` inside the
 * database, so a request that never touches this layout is still refused.
 */
import { notFound } from "next/navigation";

import { NavSpacer, SiteNav } from "@/components/layout/site-nav";
import { fetchOpenOrderCounts } from "@/lib/admin/order-queries";
import { fetchMyUnread, fetchSellerUnread } from "@/lib/messages/queries";
import { capabilities } from "@/lib/auth/capabilities";
import { currentProfile } from "@/lib/auth/profile";

export default async function BusinessLayout({ children }: { children: React.ReactNode }) {
  // The authorisation gate, on its own and first. Nothing cosmetic shares
  // this line.
  const { sellerOperator, platformAdmin } = await capabilities();
  if (!sellerOperator) notFound();

  const [openOrders, profile, mine, seller] = await Promise.all([
    fetchOpenOrderCounts(), currentProfile(), fetchMyUnread(), fetchSellerUnread(),
  ]);
  /* Zwei Posteingänge, zwei Zahlen (0098): der des Betriebs und das eigene
     Konto. Ein Verkäufer hat beide, und sie stehen an verschiedenen Stellen. */
  const unread = { mine, seller };

  return (
    /* No WorldZone and no footer, for the same reasons the admin area has
       neither: this is a workbench, not a shop window. */
    <div className="relative min-h-screen">
      <SiteNav
        signedIn
        business
        /* Both capabilities are passed so the badge can say what is true
           rather than what this area happens to be (ADR-0077). */
        admin={platformAdmin}
        openOrders={openOrders}
        unread={unread}
        username={profile?.username ?? null}
      />
      {children}
      <NavSpacer />
    </div>
  );
}
