import { PrincipalGate } from "@/components/layout/principal-gate";
import { SiteFooter } from "@/components/layout/site-footer";
import { NavSpacer, SiteNav } from "@/components/layout/site-nav";
import { WorldZone } from "@/components/layout/world-zone";
import { fetchOpenOrderCounts } from "@/lib/admin/order-queries";
import { isAdmin } from "@/lib/auth/admin";
import { currentUser } from "@/lib/auth/user";

/**
 * Public shell. Everything here works without an account (ADR-0025); the
 * session is read only to decide what the navigation offers.
 */
export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  // All three answers come from the server, and all three are memoised per
  // request — the catalog page asks the same two questions again (ADR-0042).
  const [user, admin] = await Promise.all([currentUser(), isAdmin()]);
  // Only ever a query for the operator: `fetchOpenOrderCounts()` asks
  // `isAdmin()` itself and returns zeroes for everybody else without touching
  // the database. A flagged order has to be visible from wherever they are,
  // not only from inside /admin.
  const openOrders = await fetchOpenOrderCounts();

  return (
    <div className="relative flex min-h-screen flex-col">
      {/* The world starts behind the header, not below it (ADR-0038, V3.3).
          Owned by the layout so it survives navigation between the two
          route groups. */}
      {/* Who this browser is acting as. Draws nothing (ADR-0061). */}
      <PrincipalGate userId={user?.id ?? null} />
      <WorldZone />
      <SiteNav signedIn={Boolean(user)} admin={admin} openOrders={openOrders} />
      {/* `flex-1` so a short page still pushes the footer to the bottom of the
          viewport instead of leaving it floating in the middle. */}
      <div className="flex-1">{children}</div>
      <SiteFooter />
      <NavSpacer />
    </div>
  );
}
