/**
 * Protected area.
 *
 * The proxy already turns anonymous visitors away, but that is convenience.
 * This layout checks the session on the server itself, and row level security
 * remains the actual boundary (docs/SECURITY.md).
 */
import { redirect } from "next/navigation";

import { NavSpacer, SiteNav } from "@/components/layout/site-nav";
import { WorldZone } from "@/components/layout/world-zone";
import { isAdmin } from "@/lib/auth/admin";
import { currentProfile } from "@/lib/auth/profile";
import { SIGN_IN_PATH } from "@/lib/auth/redirect";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await currentProfile();
  if (!profile) redirect(SIGN_IN_PATH);
  const admin = await isAdmin();

  return (
    <div className="relative min-h-screen">
      {/* The world starts behind the header, not below it (ADR-0038, V3.3).
          Owned by the layout so it survives navigation between the two
          route groups. */}
      <WorldZone variant="world" />
      {/* The same navigation the public catalog uses — one component, two
          mounts, rather than two systems to keep in step. The active section
          comes from the path, so /collection and /settings light up too. */}
      <SiteNav signedIn admin={admin} />
      {children}
      <NavSpacer />
    </div>
  );
}
