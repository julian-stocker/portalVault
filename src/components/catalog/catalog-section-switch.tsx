/**
 * Figuren · Zubehör · Karten — the catalogue's one top-level switch (UX-01F).
 *
 * It replaces two controls that used to sit in different places and look like
 * different kinds of thing: `CatalogAreaTabs` (Figuren · Zubehör, above the
 * series) and `CatalogViewToggle` (Karten · Kacheln, in the browse row). Two
 * switches for "what am I looking at" was one too many, and the view toggle
 * in particular was easy to miss where it was.
 *
 * ONE LOOK, TWO MECHANISMS, AND THAT IS DELIBERATE (see `catalog-section.ts`):
 *
 *   Figuren, Karten   `<button>` — the same route, a remembered presentation.
 *                     Instant, fetches nothing, reloads nothing (UX-01C).
 *   Zubehör           `<Link>` — a page of its own, so it is shareable,
 *                     bookmarkable and the back button works (ADR-0128).
 *
 * A visitor cannot tell the difference and should not have to. What they get
 * is one row of three, with exactly one current.
 *
 * FROM THE ACCESSORY PAGE the two figure sections are links as well — there
 * is a page to go back to — and each writes the remembered view BEFORE
 * navigating, so "Karten" from Zubehör really lands on the cards rather than
 * on whatever was remembered last. The element stays a real `<Link>`, so a
 * middle click still opens a tab.
 *
 * NOT FOR AN ADMINISTRATOR'S FIGURE VIEW. Their card carries editorial
 * actions and has no tile form (ADR-0042, ADR-0148), so Figuren and Karten
 * would be one reachable state wearing two labels. They get the accessory
 * link alone — `offersSections` decides, and the caller passes it rather than
 * this file re-deriving who is who.
 */
"use client";

import Link from "next/link";

import { catalogViewStore, type CatalogView } from "@/components/catalog/catalog-view-mode";
import {
  CATALOG_SECTIONS,
  activeSection,
  sectionTarget,
  type CatalogArea,
  type CatalogSection,
} from "@/lib/catalog/catalog-section";
import { de } from "@/lib/i18n/de";

const LABELS: Readonly<Record<CatalogSection, string>> = {
  figures: de.catalog.sectionFigures,
  accessories: de.catalog.sectionAccessories,
  cards: de.catalog.sectionCards,
};

/**
 * The pill, at the top level's size.
 *
 * `text-sm` rather than `text-[13px]`, which is what `CatalogAreaTabs` used
 * to mark this as the first of the navigation levels — kept, so the switch
 * reads as the same rank it replaces.
 */
const PILL =
  "flex min-h-11 flex-1 shrink-0 items-center justify-center rounded-full px-4 text-sm "
  + "whitespace-nowrap shadow-card backdrop-blur-sm transition-colors";

const PILL_ACTIVE = "bg-status-ground font-semibold text-status-ink ring-1 ring-status-line";
const PILL_IDLE =
  "bg-deep/65 font-normal text-muted ring-1 ring-border/70 "
  + "hover:text-foreground hover:ring-border-strong";

export function CatalogSectionSwitch({
  area,
  view,
  onSelectView,
  sections = CATALOG_SECTIONS,
}: {
  area: CatalogArea;
  /** The remembered figure presentation — which of the two is current. */
  view: CatalogView;
  /**
   * Switches the presentation without leaving the page. Present on the
   * figures route; absent on the accessory page, where the figure sections
   * are links instead.
   */
  onSelectView?: (view: CatalogView) => void;
  /** Which sections this viewer is offered. */
  sections?: readonly CatalogSection[];
}) {
  const current = activeSection(area, view);

  return (
    <nav
      aria-label={de.catalog.sectionNav}
      /* One row at every width. Three short labels fit a 360 px phone with
         room to spare, so nothing scrolls and nothing wraps. `flex-1` on the
         pills gives the three equal widths, which is what makes it read as
         one switch rather than three buttons. */
      className="flex w-full max-w-[34rem] gap-1.5"
    >
      {sections.map((section) => {
        const target = sectionTarget(section);
        const isCurrent = section === current;
        const className = `${PILL} ${isCurrent ? PILL_ACTIVE : PILL_IDLE}`;

        /*
         * A view of the page we are already on: a button, so nothing
         * navigates. Only where the caller can actually switch it.
         */
        if (target.kind === "view" && onSelectView) {
          return (
            <button
              key={section}
              type="button"
              aria-current={isCurrent ? "page" : undefined}
              onClick={() => onSelectView(target.view)}
              className={className}
            >
              {LABELS[section]}
            </button>
          );
        }

        return (
          <Link
            key={section}
            href={target.href}
            aria-current={isCurrent ? "page" : undefined}
            /*
             * Coming from another page, a figure section has to carry its
             * presentation with it — otherwise "Karten" would land on
             * whatever was remembered last. The write happens before the
             * navigation and the destination reads it on mount, which is the
             * same path a switch on the page itself takes.
             */
            onClick={target.kind === "view"
              ? () => catalogViewStore.write(target.view)
              : undefined}
            className={className}
          >
            {LABELS[section]}
          </Link>
        );
      })}
    </nav>
  );
}
