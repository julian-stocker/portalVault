/**
 * Protected area.
 *
 * The proxy already turns anonymous visitors away, but that is convenience.
 * This layout checks the session on the server itself, and row level security
 * remains the actual boundary (docs/SECURITY.md).
 */
import { redirect } from "next/navigation";

import { NavSpacer, SiteNav } from "@/components/layout/site-nav";
import { currentProfile } from "@/lib/auth/actions";
import { SIGN_IN_PATH } from "@/lib/auth/redirect";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await currentProfile();
  if (!profile) redirect(SIGN_IN_PATH);

  return (
    <div className="min-h-screen">
      {/* The same navigation the public catalog uses — one component, two
          mounts, rather than two systems to keep in step. The active section
          comes from the path, so /collection and /settings light up too. */}
      <SiteNav signedIn />
      {children}
      <NavSpacer />
    </div>
  );
}
