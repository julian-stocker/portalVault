/**
 * The catalogue's three sections — Figuren · Zubehör · Karten (UX-01F).
 *
 * WHAT THIS MODULE IS FOR. The operator asked for one visible switch over
 * three sections, replacing two controls that answered different kinds of
 * question:
 *
 *   Figuren · Zubehör   a ROUTE — `/` and `/zubehoer`, two pages (ADR-0128)
 *   Karten · Kacheln     a VIEW — one page, a remembered presentation
 *                        (ADR-0148, UX-01C/E)
 *
 * Merging the CONTROLS without merging the MECHANISMS is the whole of the
 * design, and both mechanisms were kept for the reasons they were chosen:
 *
 *   A route for accessories. It is shareable, bookmarkable and the browser's
 *   back button does what it should — `area-tabs.tsx` said exactly that, and
 *   turning it into in-page state would take all three away.
 *
 *   A remembered view for the two figure presentations. Switching them is
 *   instant, fetches nothing and reloads nothing (UX-01C) — a URL would make
 *   each switch a server round trip through the auth proxy.
 *
 * So a section is not a fourth concept layered over those two: it is a NAME
 * for one of three states the pair can be in, and `sectionTarget()` says
 * which mechanism each name uses. One switch on screen, nothing invented
 * underneath.
 *
 * "KARTEN" IS A TRANSITIONAL MEANING, AND THE SEAM IS HERE. Today it shows
 * the classic vertical figure cards. Later it is meant to show real
 * collectible Skylanders cards, which are a different kind of object and do
 * not exist in any table yet. When they do, `sectionTarget("cards")` changes
 * from a view of `/` to a route of its own and NOTHING ELSE MOVES — not the
 * switch, not its labels, not the pages that render it. That is the whole
 * extent of the preparation: no card table, no card type, no empty page, no
 * speculative column. A seam, not a feature.
 *
 * NO STORED PREFERENCE IS LOST. The remembered view keeps its key
 * (`skyisles.catalog.view`) and its two values, so a visitor who chose the
 * tiles lands in Figuren and one who chose the cards lands in Karten —
 * the same two states they had, under names that now describe them.
 */
import type { CatalogView } from "@/components/catalog/catalog-view-mode";

/** The three sections, in display order. */
export const CATALOG_SECTIONS = ["figures", "accessories", "cards"] as const;

export type CatalogSection = (typeof CATALOG_SECTIONS)[number];

/** Which page the visitor is on. The accessory page is its own route. */
export type CatalogArea = "figures" | "accessories";

/**
 * What a section does when chosen.
 *
 * `view` sections live on the figures route and differ only in presentation;
 * `route` sections are a page of their own. The switch reads this instead of
 * branching on section names, so the day "cards" becomes a route of its own
 * the switch does not change at all.
 */
export type SectionTarget =
  | { kind: "view"; href: "/"; view: CatalogView }
  | { kind: "route"; href: string };

export function sectionTarget(section: CatalogSection): SectionTarget {
  switch (section) {
    case "accessories":
      return { kind: "route", href: "/zubehoer" };
    case "cards":
      /* The transitional meaning: the classic vertical cards, on the figures
         route. Real collectible cards will make this a `route`. */
      return { kind: "view", href: "/", view: "cards" };
    case "figures":
    default:
      return { kind: "view", href: "/", view: "rows" };
  }
}

/**
 * Which section the visitor is in, from the page and the remembered view.
 *
 * On the accessory route the view is irrelevant and must not be consulted:
 * a visitor whose remembered view is "cards" is in Zubehör, not in Karten,
 * and highlighting both would be the navigation lying about where they are.
 */
export function activeSection(area: CatalogArea, view: CatalogView): CatalogSection {
  if (area === "accessories") return "accessories";
  return view === "cards" ? "cards" : "figures";
}

/**
 * Does the series selection mean the same thing in this section?
 *
 * NO, AND IT MATTERS. Measured in the two views rather than assumed:
 *
 *   figures, cards   a series is ALWAYS chosen and there is no "Alle"
 *                    (ADR-0038) — 561 figures across six games is a wall
 *                    nobody scrolls
 *   accessories      "Alle" is the DEFAULT, series is optional, and the area
 *                    narrows by type and platform instead
 *                    (`accessory-filter.ts`)
 *
 * So the fixed 3 × 2 grid belongs to the figure sections only. Imposing it on
 * accessories would either force a game on a visitor who wants all of them,
 * or make a grid cell mean "Alle" in one section and "only this game" in
 * another. The accessory area keeps the controls it has.
 */
export function offersSeriesGrid(section: CatalogSection): boolean {
  return section !== "accessories";
}
