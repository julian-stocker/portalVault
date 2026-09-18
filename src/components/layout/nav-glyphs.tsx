/**
 * The navigation's own icons (V3.4.1).
 *
 * WHY THEY EXIST
 *
 * The phone's bottom bar carried labels and nothing else, which reads as a
 * list of links rather than as the two halves of a collector's product. And
 * the account, which is a platform action rather than a collector area, sat
 * among them as a third word.
 *
 * WHY THEY ARE DRAWN HERE RATHER THAN INSTALLED
 *
 * `cart-glyph.tsx` already set the house style, and these follow it exactly:
 * a 24×24 box, no fill, `currentColor` at 1.8, round caps and joins. An icon
 * set would bring its own grid, its own weight and its own idea of a shopping
 * basket, and the one icon this product already had would become the odd one
 * out. No dependency, five small paths.
 *
 * WHAT THEY MEAN, AND WHAT THEY MUST NOT
 *
 * Navigation, so `currentColor` and nothing else — the ink comes from the
 * link that holds them. In particular the collection's icon is NOT gold:
 * ownership gold marks a figure somebody owns, not the door to the page that
 * lists them, and a gold door would say the whole section is a possession.
 * Amber is likewise wrong here: nothing in this bar buys anything.
 *
 * `aria-hidden` throughout. Every one of them sits beside a label or inside a
 * link that carries an accessible name; announcing them again would say each
 * destination twice.
 */

/** Shared drawing attributes, so weight cannot drift between icons. */
const STROKE = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "1.8",
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function Glyph({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <svg aria-hidden="true" className={`shrink-0 ${className}`} {...STROKE}>
      {children}
    </svg>
  );
}

/**
 * The catalog: a grid of cards.
 *
 * Four panes rather than nine — the catalog is a grid of figure cards, and
 * nine small squares at 18 px read as a texture rather than as cards.
 */
export function CatalogGlyph({ className = "h-[18px] w-[18px]" }: { className?: string }) {
  return (
    <Glyph className={className}>
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.6" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6" />
    </Glyph>
  );
}

/**
 * The collection: things stacked, which is what a collection is.
 *
 * A stack rather than a second grid, so the two destinations are told apart
 * at a glance and at 18 px. One plate on top, two edges below it — kept as
 * edges rather than full outlines, because three complete rectangles at this
 * size close up into a block.
 */
export function CollectionGlyph({ className = "h-[18px] w-[18px]" }: { className?: string }) {
  return (
    <Glyph className={className}>
      <rect x="3" y="3.25" width="18" height="8" rx="1.8" />
      <path d="M5.25 14.75h13.5" />
      <path d="M6.75 19.25h10.5" />
    </Glyph>
  );
}

/**
 * The operator's stock: a box, seen from the front with its seam.
 *
 * The bar is one bar and cannot be half-illustrated: an administrator sees
 * the catalog beside their own two destinations, so giving icons only to the
 * collector's would leave that viewer with one drawn item and two bare ones.
 */
export function InventoryGlyph({ className = "h-[18px] w-[18px]" }: { className?: string }) {
  return (
    <Glyph className={className}>
      <path d="M3.25 7.5 12 3.25l8.75 4.25v9L12 20.75 3.25 16.5v-9Z" />
      <path d="M3.25 7.5 12 11.75l8.75-4.25" />
      <path d="M12 11.75v9" />
    </Glyph>
  );
}

/** The back office: the sliders of a workbench, not a cog. */
export function AdminGlyph({ className = "h-[18px] w-[18px]" }: { className?: string }) {
  return (
    <Glyph className={className}>
      <path d="M4 7h16M4 12h16M4 17h16" />
      <circle cx="9" cy="7" r="2" />
      <circle cx="15.5" cy="12" r="2" />
      <circle cx="8" cy="17" r="2" />
    </Glyph>
  );
}

/**
 * Settings: the cog.
 *
 * Eight spokes around a hub rather than a toothed wheel — teeth at 18 px with
 * a 1.8 stroke close into a blob, and the spoked form keeps its shape all the
 * way down. Deliberately not the sliders of `AdminGlyph`: that one means the
 * operator's back office, this one means your own account, and two controls a
 * few pixels apart must not look like the same idea.
 */
export function SettingsGlyph({ className = "h-[18px] w-[18px]" }: { className?: string }) {
  return (
    <Glyph className={className}>
      <circle cx="12" cy="12" r="3.25" />
      <path d="M12 2.9v2.3M12 18.8v2.3M21.1 12h-2.3M5.2 12h-2.3" />
      <path d="m18.44 5.56-1.63 1.63M7.19 16.81l-1.63 1.63M18.44 18.44l-1.63-1.63M7.19 7.19 5.56 5.56" />
    </Glyph>
  );
}

/**
 * The account hub: a card with its lines.
 *
 * NOT a cog, which is what stood here until the Business review. The label
 * said "Mein Konto" and the comment argued against the word "Einstellungen" —
 * and then drew a cog, which means Settings to everybody who has ever used a
 * computer. An affordance outvotes a label it contradicts (ADR-0080).
 *
 * A card with three lines reads as "the things on file about me", which is
 * what the page behind it is: profile, delivery data, orders, security.
 */
export function AccountHubGlyph({ className = "h-[18px] w-[18px]" }: { className?: string }) {
  return (
    <Glyph className={className}>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="M7 10h5M7 14h10" />
    </Glyph>
  );
}

/**
 * The account: head and shoulders.
 *
 * The one icon in the header that is neither brand nor commerce. Neutral ink
 * on purpose — a person is not a possession and not a purchase.
 */
export function AccountGlyph({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <Glyph className={className}>
      <circle cx="12" cy="8" r="3.75" />
      <path d="M4.75 20.25a7.25 7.25 0 0 1 14.5 0" />
    </Glyph>
  );
}
