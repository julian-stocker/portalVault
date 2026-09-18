import { PrincipalGate } from "@/components/layout/principal-gate";
import { SiteFooter } from "@/components/layout/site-footer";
import { NavSpacer, SiteNav } from "@/components/layout/site-nav";
import { WorldZone } from "@/components/layout/world-zone";
import { fetchOpenOrderCounts } from "@/lib/admin/order-queries";
import { capabilities } from "@/lib/auth/capabilities";
import { currentProfile } from "@/lib/auth/profile";
import { currentUser } from "@/lib/auth/user";

/**
 * Public shell. Everything here works without an account (ADR-0025); the
 * session is read only to decide what the navigation offers.
 */
export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  // All three answers come from the server, and all three are memoised per
  // request — the catalog page asks the same two questions again (ADR-0042).
  // `currentProfile()` joins the pair that was already here rather than
  // waiting behind it: it needs `currentUser()`, which is memoised and
  // resolved by this very call, so its own marginal work is one indexed read
  // of `profiles` — measured at 102 ms, faster than the catalogue read the
  // page makes in the same breath. Nothing at all for an anonymous visitor:
  // it returns null the moment `currentUser()` does (V3.4.2).
  const [user, caps, profile] = await Promise.all([
    currentUser(),
    // Both capabilities in one answer (ADR-0077): the bar must offer exactly
    // what the route guards would let this account into.
    capabilities(),
    currentProfile(),
  ]);
  // Only ever a query for the seller: `fetchOpenOrderCounts()` asks
  // `canOperateSeller()` itself and returns zeroes for everybody else without
  // touching the database. A flagged order has to be visible from wherever
  // the operator is, not only from inside /business.
  const openOrders = await fetchOpenOrderCounts();

  return (
    <div className="relative flex min-h-screen flex-col">
      {/* Who this browser is acting as. Draws nothing (ADR-0061). */}
      <PrincipalGate userId={user?.id ?? null} />
      <SiteNav
        signedIn={Boolean(user)}
        admin={caps.platformAdmin}
        business={caps.sellerOperator}
        openOrders={openOrders}
        username={profile?.username ?? null}
      />
      {/* `flex-1` so a short page still pushes the footer to the bottom of the
          viewport instead of leaving it floating in the middle. */}
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
        <WorldZone />
        {children}
      </div>
      <SiteFooter />
      <NavSpacer />
    </div>
  );
}
