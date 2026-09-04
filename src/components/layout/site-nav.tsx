/**
 * The one navigation.
 *
 * A single markup that sits at the bottom on phones — where the thumb is —
 * and moves to the top from `md:` upwards. Two separate navigation systems
 * would be two things to keep in step.
 */
import Link from "next/link";

import { de } from "@/lib/i18n/de";

type Props = {
  /** Signed-in visitors get collection and profile; everyone gets the catalog. */
  signedIn: boolean;
  active: "catalog" | "collection" | "settings" | null;
};

const linkBase =
  "flex flex-1 items-center justify-center gap-2 py-3 text-sm md:flex-none md:px-3 md:py-2";

function itemClass(isActive: boolean): string {
  return `${linkBase} ${isActive ? "text-foreground font-medium" : "text-muted hover:text-foreground"}`;
}

export function SiteNav({ signedIn, active }: Props) {
  return (
    <nav
      className={
        // Fixed to the bottom on phones, static at the top on wider screens.
        "fixed inset-x-0 bottom-0 z-10 border-t border-border bg-background " +
        "md:static md:flex md:items-center md:justify-between md:border-t-0 md:border-b md:px-6"
      }
    >
      <Link href="/" className="hidden text-sm font-semibold md:block">
        {de.app.name}
      </Link>

      <div className="flex items-stretch md:items-center md:gap-1">
        <Link href="/" className={itemClass(active === "catalog")}>
          {de.nav.catalog}
        </Link>

        {signedIn ? (
          <>
            <Link href="/collection" className={itemClass(active === "collection")}>
              {de.nav.collection}
            </Link>
            <Link href="/settings" className={itemClass(active === "settings")}>
              {de.nav.settings}
            </Link>
            <form action="/auth/signout" method="post" className="flex flex-1 md:flex-none">
              <button type="submit" className={`${itemClass(false)} w-full`}>
                {de.nav.signOut}
              </button>
            </form>
          </>
        ) : (
          <Link href="/login" className={itemClass(false)}>
            {de.nav.signIn}
          </Link>
        )}
      </div>
    </nav>
  );
}

/**
 * Spacer so the fixed bottom bar never covers the last row of cards.
 * Only needed below `md:`, where the bar is fixed.
 */
export function NavSpacer() {
  return <div aria-hidden className="h-16 md:hidden" />;
}
