/**
 * "Alle · Besitz · Fehlen" — what the catalog shows about ownership.
 *
 * Three named states, not a toggle. The toggle it replaces was called
 * "Besitz anzeigen" and was highlighted while owned figures were **hidden**:
 * the control lit up to say the thing it was doing was off. That was a
 * deliberate choice at the time — "off is the state that changes the list" —
 * and it reads as inverted, because a highlighted filter means "this is what
 * you are looking at" everywhere else in the product.
 *
 * With three states the question does not arise. Exactly one of them is
 * highlighted, and it is always the one that describes what is on screen.
 *
 * This is a **narrowing of the same pool**, nothing more. It knows about a
 * set of owned SKY-IDs and about nothing else: not series, not product
 * groups, not the search index. That is what lets it combine with all three
 * without any of them knowing it exists (ADR-0026, ADR-0041).
 */
import type { CatalogFigure } from "@/lib/catalog/types";

/** The three states, in display order. `all` is the resting state. */
export const OWNERSHIP_MODES = ["all", "owned", "missing"] as const;

export type OwnershipMode = (typeof OWNERSHIP_MODES)[number];

/** What the catalog opens on, every time. */
export const DEFAULT_OWNERSHIP: OwnershipMode = "all";

export function isOwnershipMode(value: unknown): value is OwnershipMode {
  return typeof value === "string" && (OWNERSHIP_MODES as readonly string[]).includes(value);
}

/**
 * Does this figure belong in the chosen state?
 *
 * `all` matches everything — including figures whose ownership nobody can
 * answer for, which is why an anonymous catalog behaves exactly like `all`
 * rather than needing a special case.
 */
export function matchesOwnership(
  figure: Pick<CatalogFigure, "skyId">,
  owned: ReadonlySet<string>,
  mode: OwnershipMode,
): boolean {
  if (mode === "all") return true;
  const has = owned.has(figure.skyId);
  return mode === "owned" ? has : !has;
}

/** Keeps the figures of one state, order untouched. */
export function filterByOwnership<T extends Pick<CatalogFigure, "skyId">>(
  figures: readonly T[],
  owned: ReadonlySet<string>,
  mode: OwnershipMode,
): T[] {
  if (mode === "all") return [...figures];
  return figures.filter((figure) => matchesOwnership(figure, owned, mode));
}

/**
 * Is the ownership filter narrowing anything?
 *
 * "Alle" is the resting state, not a filter — offering to reset it there
 * would be an action with nothing to undo (ADR-0038).
 */
export function isOwnershipActive(mode: OwnershipMode): boolean {
  return mode !== DEFAULT_OWNERSHIP;
}

/**
 * Who is offered the filter at all.
 *
 * Nobody signed out has an answer to it, and an administrator does not
 * collect from the catalog they administer (ADR-0042). A present-but-
 * meaningless control is worse than no control, so it is absent rather than
 * disabled.
 */
export function offersOwnershipFilter(viewer: { signedIn: boolean; admin: boolean }): boolean {
  return viewer.signedIn && !viewer.admin;
}
