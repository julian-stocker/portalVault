/**
 * The variant seal.
 *
 * A struck plate at the top left of the photograph, carrying the finish a
 * figure has: "Legendary", "Dark", "Nitro", "Power Blue". The data is
 * `sortVariantLabel`, derived in `variant.ts` and already on every
 * `CatalogFigure` — until V3.2 it existed only inside `displayName`, as
 * "Astroblast (Legendary)", where it cost the name a second line and read as
 * a spelling rather than as a category.
 *
 * DELIBERATELY NOT GOLD. Gold means possession (V3.1). Rarity is a property
 * of the object and possession is a property of the viewer, and they appear
 * on the same tile — a gold seal would make an unowned Legendary look owned.
 *
 * Two inks, both dark plates with a light lower edge so they read as stamped
 * into the plate rather than laid on it:
 *
 *   Legendary   ivory on near-black — the one finish collectors chase
 *   everything else   a cool grey, quieter
 *
 * A PROPERTY OF THE FIGURE, so it appears on the administrator's card too,
 * where the ownership crown deliberately does not (ADR-0042).
 */
const BASE =
  "absolute top-1.5 left-1.5 rounded-[3px] px-1.5 py-0.5 " +
  "font-mono text-[9px] leading-[1.4] font-medium tracking-[0.08em] uppercase " +
  // The light lower edge: one pixel of highlight under a dark field is what
  // makes a stamp look pressed. No radius on it, no blur, no glow.
  "shadow-[inset_0_-1px_0_rgb(255_255_255/0.28),0_1px_2px_rgb(0_0_0/0.35)]";

/** The finishes that get the bright plate. Everything else is the quiet one. */
const HEADLINE = new Set(["Legendary"]);

export function VariantSeal({ label }: { label: string }) {
  const headline = HEADLINE.has(label);
  return (
    <span
      /*
       * Decorative to a screen reader, because the finish is already spoken:
       * the figure's `alt` carries the full `displayName` — "Astroblast
       * (Legendary)" — and the name line keeps it in `title`. Reading
       * "LEGENDARY" a second time between the picture and the name would be
       * noise, not information. Nothing semantic is lost: the search index is
       * built from `searchFormsFor(name, variant)` and covers every spelling.
       */
      aria-hidden="true"
      className={
        BASE +
        (headline
          ? " bg-[#241f19] text-[#f3e6c8]"
          : " bg-[#3a3442] text-[#ded7e8]")
      }
    >
      {label}
    </span>
  );
}
