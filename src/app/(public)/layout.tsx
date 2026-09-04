import { NavSpacer, SiteNav } from "@/components/layout/site-nav";
import { createClient } from "@/lib/supabase/server";

/**
 * Public shell. Everything here works without an account (ADR-0025); the
 * session is read only to decide what the navigation offers.
 */
export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();

  return (
    <div className="min-h-screen">
      <SiteNav signedIn={Boolean(data.user)} active="catalog" />
      {children}
      <NavSpacer />
    </div>
  );
}
