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
import { isAdmin } from "@/lib/auth/admin";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!(await isAdmin())) notFound();

  // Memoised per request, so the admin home page below counts the same rows
  // without a second round trip.
  const openOrders = await fetchOpenOrderCounts();

  return (
    /* No WorldZone: the admin area is a workbench, not a shop window. The
       quiet canvas from the root layout is the right ground for a table.

       No footer either: it orients visitors and offers the public and legal
       pages, and the operator needs neither. */
    <div className="relative min-h-screen">
      <SiteNav signedIn admin openOrders={openOrders} />
      {children}
      <NavSpacer />
    </div>
  );
}
