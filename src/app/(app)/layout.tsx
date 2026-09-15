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
import { isAdmin } from "@/lib/auth/admin";
import { currentProfile } from "@/lib/auth/profile";
import { SIGN_IN_PATH } from "@/lib/auth/redirect";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await currentProfile();
  if (!profile) redirect(SIGN_IN_PATH);
  const admin = await isAdmin();
  // Zeroes without a query for a collector; see `fetchOpenOrderCounts()`.
  const openOrders = await fetchOpenOrderCounts();

  return (
    <div className="relative flex min-h-screen flex-col">
      {/* Who this browser is acting as. Draws nothing (ADR-0061). */}
      <PrincipalGate userId={profile.id} />
      {/* The same navigation the public catalog uses — one component, two
          mounts, rather than two systems to keep in step. The active section
          comes from the path, so /collection and /settings light up too. */}
      {/* `profile` is already loaded above — the username costs nothing here. */}
      <SiteNav signedIn admin={admin} openOrders={openOrders} username={profile.username} />
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
