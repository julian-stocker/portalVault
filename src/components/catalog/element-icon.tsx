/**
 * An element, as its emblem (UX-01C, ADR-0148; real artwork since UX-Design).
 *
 * WHERE THE PICTURES COME FROM
 *
 * The operator's own emblems in `resources/designs/elements/`, shipped as
 * 64 px WebP by `tools/build-design-icons.mts`. This file used to draw a
 * coloured placeholder rune because no artwork existed and inventing the
 * game's emblems was ruled out; now the artwork exists, so the rune is gone.
 *
 * EIGHT FILES, TEN ELEMENTS. There are emblems for Magic, Tech, Water, Fire,
 * Life, Undead, Earth and Air. Light and Dark have none yet, so they map to
 * `null` — and `null` renders NOTHING. No placeholder, no stand-in colour: a
 * figure whose emblem is missing looks exactly like a figure without an
 * element, which is the operator's rule ("keine Platzhaltergrafik").
 *
 * The same goes for anything `asElement()` does not recognise, and for a
 * file that fails to load at runtime — the box stays empty instead of
 * showing a broken-image glyph.
 *
 * WHERE IT IS SHOWN: only on the figure's own page, before „Element: Feuer"
 * (UX-Design, after two rounds on the tile — the operator wants the tiles
 * without it). The tile does not render this component.
 *
 * THE BOX IS THE CALLER'S. This component draws into the size it is given and
 * never reserves space of its own — no emblem, no gap.
 *
 * ACCESSIBILITY: on its own it names the element (`title` for a pointer,
 * `sr-only` for a screen reader). Beside a visible text that already says it,
 * the caller passes `decorative`, and the picture stays silent instead of the
 * name being read twice.
 */
"use client";

import { useState } from "react";

import { asElement, elementLabel } from "@/lib/catalog/element";
import type { Element } from "@/lib/catalog/character";

/**
 * Where the emblem lives, per element — THE ONE SWAP POINT.
 *
 * Deliberately a full map rather than a lookup with a default: adding an
 * eleventh element to `ELEMENTS` has to fail the type check here, so nobody
 * can ship an element the icon does not know about. The designer's file for
 * Tech is called `technic`; the map is where that is reconciled.
 */
export const ELEMENT_ICON: Readonly<Record<Element, string | null>> = {
  Magic: "/images/elements/magic.webp",
  Tech: "/images/elements/technic.webp",
  Water: "/images/elements/water.webp",
  Fire: "/images/elements/fire.webp",
  Life: "/images/elements/life.webp",
  Undead: "/images/elements/undead.webp",
  Earth: "/images/elements/earth.webp",
  Air: "/images/elements/air.webp",
  Light: null,
  Dark: null,
};

export function ElementIcon({
  element,
  className = "",
  decorative = false,
}: {
  /**
   * The stored value, which may be anything.
   *
   * Narrowed with `asElement()` — the same guard every other reader uses —
   * so an unknown value renders NOTHING rather than a default. That is the
   * clean fallback: most collectibles have no element at all, and their rows
   * must look finished, not broken (ADR-0034).
   */
  element: string | null | undefined;
  /** The size, from the call site. */
  className?: string;
  /** The element is spelled out right beside it; add no second name. */
  decorative?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const known = asElement(element);
  if (known === null) return null;
  const file = ELEMENT_ICON[known];
  if (file === null || failed) return null;
  const label = elementLabel(known);
  return (
    <span title={decorative ? undefined : label}
          aria-hidden={decorative ? true : undefined}
          className={`inline-block shrink-0 ${className}`.trim()}>
      {/* Statische, vorab verkleinerte Datei (ADR-0026). */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={file} alt="" aria-hidden="true" decoding="async" draggable={false}
           onError={() => setFailed(true)}
           className="h-full w-full object-contain" />
      {decorative ? null : <span className="sr-only">{label}</span>}
    </span>
  );
}
