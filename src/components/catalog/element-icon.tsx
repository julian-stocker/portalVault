/**
 * An element, as a mark rather than a word (UX-01C, ADR-0148).
 *
 * WHAT THIS IS AND, MORE IMPORTANTLY, WHAT IT IS NOT
 *
 * The horizontal row shows the element in front of the figure's name instead
 * of spelling it out, which buys the line its width back. The project has no
 * element artwork — searched: `public/images` holds the brand mark, the card
 * templates and 475 photographs, and nothing else — so this draws a
 * PLACEHOLDER, and it is deliberately abstract:
 *
 *   > NO INVENTED ELEMENT GRAPHIC. The ten Skylanders element emblems are
 *   > the game's own; drawing lookalikes would be making up artwork and
 *   > passing it off as the real thing. A coloured rune says "this figure
 *   > has an element, and that element has an identity" without claiming to
 *   > be the emblem.
 *
 * WHAT IT DOES CARRY: the element's own colour, from the ten tokens that
 * already exist for exactly this (`elementPanelClass`, the scale tuned for
 * dark panels), and the element's German name as its accessible name and its
 * tooltip. So nothing about WHICH element is lost — it moves from a visible
 * word to a colour plus a name on demand.
 *
 * THE HONEST COST, and it is written down because `element.ts` states the
 * opposite rule: "Colour is never the only signal — the label always names
 * the element." On the row, for a sighted reader who does not hover, colour
 * IS now the only signal. That is what replacing the word with a mark means,
 * and it was the operator's decision. Real SVG shapes restore the
 * second signal the moment they arrive, which is what `ELEMENT_ICON` is for.
 * Every other surface — the card, the collection table, the quick view, the
 * figure page, the character panel — still spells the element out.
 *
 * HOW TO SWAP IN REAL FILES, in one place and without touching this
 * component: put the ten files somewhere public and fill in `ELEMENT_ICON`.
 * An entry with a path renders that file; an entry left `null` keeps the
 * rune. Partial is fine — three real icons and seven runes render side by
 * side without a branch anywhere else.
 */
import { asElement, elementLabel, elementPanelClass } from "@/lib/catalog/element";
import type { Element } from "@/lib/catalog/character";

/**
 * Where a real icon lives, per element — THE ONE SWAP POINT.
 *
 * All ten are `null` today, so all ten render the rune. A path here (for
 * example `/images/elements/magic.svg`) makes that element render the file
 * instead, at the same size and in the same place.
 *
 * Deliberately a full map rather than a lookup with a default: adding an
 * eleventh element to `ELEMENTS` has to fail the type check here, so nobody
 * can ship an element the icon does not know about.
 */
export const ELEMENT_ICON: Readonly<Record<Element, string | null>> = {
  Magic: null,
  Tech: null,
  Water: null,
  Fire: null,
  Life: null,
  Undead: null,
  Earth: null,
  Air: null,
  Light: null,
  Dark: null,
};

/**
 * The rune: a filled disc inside a thin ring.
 *
 * One shape for all ten, told apart by colour. A different shape per element
 * would be the invented graphic this file refuses to draw — and ten abstract
 * shapes nobody can learn are worse than one shape with ten colours.
 *
 * `currentColor` throughout, so the element's token on the wrapper paints it
 * and there is no second colour table here.
 */
function Rune() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="h-full w-full">
      <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.2"
              opacity="0.55" />
      <circle cx="8" cy="8" r="4" fill="currentColor" />
    </svg>
  );
}

export function ElementIcon({
  element,
  className = "",
}: {
  /**
   * The stored value, which may be anything.
   *
   * Narrowed with `asElement()` — the same guard every other reader uses —
   * so an unknown value renders NOTHING rather than a default colour. That
   * is the clean fallback: 457 of 561 collectibles have no element at all,
   * and their rows must look finished, not broken (ADR-0034).
   */
  element: string | null | undefined;
  /** The size, from the call site. The default is a 14 px mark. */
  className?: string;
}) {
  const known = asElement(element);
  if (known === null) return null;

  const label = elementLabel(known);
  const file = ELEMENT_ICON[known];

  return (
    <span
      /*
       * `title` for a pointer, `sr-only` for assistive technology. Both, not
       * one: a tooltip is invisible to a screen reader and a hidden span is
       * invisible to a mouse.
       */
      title={label}
      className={`inline-block shrink-0 ${elementPanelClass(known)} ${className}`.trim()}
    >
      {file ? (
        /* The real icon, once there is one. Same box, same place. */
        // eslint-disable-next-line @next/next/no-img-element
        <img src={file} alt="" aria-hidden="true" className="h-full w-full" />
      ) : (
        <Rune />
      )}
      <span className="sr-only">{label}</span>
    </span>
  );
}
