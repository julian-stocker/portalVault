/**
 * The one navigation.
 *
 * A single header element carries both layouts. On phones the nav inside it
 * is fixed to the bottom — where the thumb is — which takes it out of flow
 * and leaves the header showing only the wordmark. From `md:` upwards the
 * nav goes static and sits in the same row as the wordmark. One markup, one
 * set of links, no second system to keep in step.
 *
 * Three destinations, and only three: catalog, collection, account. Signing
 * out is not a place you navigate to, so it lives in /settings (ADR-0036).
 *
 * The active state is a tonal pill on desktop rather than the hairline it
 * used to be. A 2 px underline is what a documentation site uses; on a
 * product header it read as unfinished. The bottom bar keeps the bar shape,
 * because there a pill under the thumb competes with the labels beside it.
 */
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Wordmark } from "@/components/layout/wordmark";
import { activeSection, type NavSection } from "@/lib/nav/sections";
import { de } from "@/lib/i18n/de";

type Item = { href: string; label: string; section: NavSection };

function itemsFor(signedIn: boolean): Item[] {
  return [
    { href: "/", label: de.nav.catalog, section: "catalog" },
    { href: "/collection", label: de.nav.collection, section: "collection" },
    signedIn
      ? { href: "/settings", label: de.nav.settings, section: "account" }
      : { href: "/login", label: de.nav.signIn, section: "account" },
  ];
}

function NavItem({ item, active }: { item: Item; active: boolean }) {
  return (
    <Link
      href={item.href}
      // Announced as the current page, not merely coloured differently.
      aria-current={active ? "page" : undefined}
      className={
        "relative flex min-h-11 flex-1 items-center justify-center px-3 text-sm " +
        "transition-colors md:flex-none md:rounded-sky-md md:px-3.5 " +
        (active
          ? "font-medium text-foreground md:bg-accent-subtle"
          : "text-muted hover:text-foreground md:hover:bg-border/50")
      }
    >
      {item.label}
      {/* A shape as well as a colour, and only where the pill is not: on the
          phone bar, above the label so the thumb never covers it. */}
      {active ? (
        <span
          aria-hidden="true"
          className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-accent md:hidden"
        />
      ) : null}
    </Link>
  );
}

export function SiteNav({ signedIn }: { signedIn: boolean }) {
  const pathname = usePathname();
  const active = activeSection(pathname ?? "/");
  const items = itemsFor(signedIn);

  return (
    // Surface plus a hairline rather than a full border on the canvas: the
    // header should sit on the page, not be drawn onto it.
    <header
      className={
        "border-b border-border/70 bg-surface/80 backdrop-blur-sm " +
        "md:flex md:items-center md:justify-between md:px-6"
      }
    >
      <Link
        href="/"
        className="flex items-center px-4 py-3 md:px-0 md:py-3.5"
        aria-label={de.app.name}
      >
        <Wordmark />
      </Link>

      <nav
        aria-label={de.nav.primary}
        className={
          // Out of flow on phones, so the header above collapses to just the
          // wordmark. The safe-area padding keeps the labels clear of the
          // home indicator.
          "fixed inset-x-0 bottom-0 z-20 flex border-t border-border bg-surface " +
          "pb-[env(safe-area-inset-bottom)] " +
          "md:static md:gap-1 md:border-t-0 md:bg-transparent md:pb-0"
        }
      >
        {items.map((item) => (
          <NavItem key={item.href} item={item} active={active === item.section} />
        ))}
      </nav>
    </header>
  );
}

/**
 * Spacer so the fixed bottom bar never covers the last row of cards.
 * Only needed below `md:`, where the bar is fixed — and it has to include the
 * safe-area inset the bar itself is padded by.
 */
export function NavSpacer() {
  return (
    <div
      aria-hidden
      className="h-[calc(2.75rem+env(safe-area-inset-bottom))] md:hidden"
    />
  );
}
