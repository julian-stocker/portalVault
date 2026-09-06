import { NavSpacer, SiteNav } from "@/components/layout/site-nav";
import { WorldZone } from "@/components/layout/world-zone";
import { isAdmin } from "@/lib/auth/admin";
import { currentUser } from "@/lib/auth/user";

/**
 * Public shell. Everything here works without an account (ADR-0025); the
 * session is read only to decide what the navigation offers.
 */
export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  // Both answers come from the server, and both are memoised per request —
  // the catalog page asks the same two questions again (ADR-0042).
  const [user, admin] = await Promise.all([currentUser(), isAdmin()]);

  return (
    <div className="relative min-h-screen">
      {/* The world starts behind the header, not below it (ADR-0038, V3.3).
          Owned by the layout so it survives navigation between the two
          route groups. */}
      <WorldZone />
      <SiteNav signedIn={Boolean(user)} admin={admin} />
      {children}
      <NavSpacer />
    </div>
  );
}
