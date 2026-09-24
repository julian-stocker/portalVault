/**
 * The administration area.
 *
 * Its own route group, with the check at the top of it: everything below
 * `/admin` is behind one server-side question, asked before any admin page
 * renders or any admin data is fetched.
 *
 * **404, not 403.** For anyone who is not an administrator the area does not
 * exist — a "forbidden" page confirms that there is something there. Same
 * answer for an anonymous visitor and for a signed-in one.
 *
 * This is not the security boundary. It is the first of two: the editorial
 * writes are `security definer` functions that ask `is_shop_admin()` in the
 * database, so a request that never touches this layout is still refused
 * (migration 0004, ADR-0039).
 */
import { notFound } from "next/navigation";

import { NavSpacer, SiteNav } from "@/components/layout/site-nav";
import { fetchOpenOrderCounts } from "@/lib/admin/order-queries";
import { fetchMyUnread, fetchSellerUnread } from "@/lib/messages/queries";
import { capabilities } from "@/lib/auth/capabilities";
import { currentProfile } from "@/lib/auth/profile";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // The authorisation gate, on its own and first. Nothing cosmetic shares
  // this line: whether somebody may be here is not a question to be resolved
  // in the same breath as what to print in the header.
  const { platformAdmin, sellerOperator } = await capabilities();
  if (!platformAdmin) notFound();

  // Two independent reads, once the gate has passed. Both memoised per
  // request, so the admin home page below counts the same rows without a
  // second round trip, and the operator's own handle costs one indexed read.
  const [openOrders, profile, mine, seller] = await Promise.all([
    fetchOpenOrderCounts(), currentProfile(),
    fetchMyUnread(), sellerOperator ? fetchSellerUnread() : Promise.resolve(0),
  ]);
  /* Auch hier: die Zahl gehört an den Menschen, nicht an den Bereich. */
  const unread = { mine, seller };

  return (
    /* No WorldZone: the admin area is a workbench, not a shop window. The
       quiet canvas from the root layout is the right ground for a table.

       No footer either: it orients visitors and offers the public and legal
       pages, and the operator needs neither. */
    <div className="relative min-h-screen">
      <SiteNav
        signedIn
        admin
        /* Both, so the badge states what is true rather than which area this
           happens to be (ADR-0077). */
        business={sellerOperator}
        openOrders={openOrders}
        unread={unread}
        username={profile?.username ?? null}
      />
      {children}
      <NavSpacer />
    </div>
  );
}
