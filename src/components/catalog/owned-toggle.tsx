/**
 * "In Besitz" — the catalog's one view filter (ADR-0038, V4.2).
 *
 * A pill in the section header, off by default: the catalog's job is the
 * whole catalog, and opening it on someone's own figures would answer the
 * collection's question on the collection's behalf. Off it is a way of
 * asking "what do I already have from Giants" without leaving the page.
 *
 * Display only. It never writes, and it does not touch the gold frame —
 * ownership is still marked on every card, whether or not the filter is on.
 *
 * Rendered only for a signed-in visitor. Nobody signed out has an answer to
 * it, and a control that is present but meaningless is worse than no control.
 */
"use client";

import { de } from "@/lib/i18n/de";

export function OwnedToggle({
  active,
  onChange,
}: {
  active: boolean;
  onChange: (active: boolean) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => onChange(!active)}
      className={
        "flex min-h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13px] " +
        "whitespace-nowrap ring-1 transition-colors " +
        (active
          ? "bg-accent-subtle font-medium text-accent ring-accent/60"
          : "bg-deep/70 text-muted ring-border/70 hover:text-foreground")
      }
    >
      {de.catalog.ownedFilter}
      {active ? <span aria-hidden="true">×</span> : null}
    </button>
  );
}
