import { NavSpacer, SiteNav } from "@/components/layout/site-nav";
import { WorldZone } from "@/components/layout/world-zone";
import { createClient } from "@/lib/supabase/server";

/**
 * Public shell. Everything here works without an account (ADR-0025); the
 * session is read only to decide what the navigation offers.
 */
export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();

  return (
    <div className="relative min-h-screen">
      {/* The world starts behind the header, not below it (ADR-0038, V3.3).
          Owned by the layout so it survives navigation between the two
          route groups. */}
      <WorldZone />
      <SiteNav signedIn={Boolean(data.user)} />
      {children}
      <NavSpacer />
    </div>
  );
}
