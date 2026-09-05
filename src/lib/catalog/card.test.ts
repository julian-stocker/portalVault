import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { cardSurfaceClass, duplicateBadge, marksOwnership } from "./card.ts";

describe("the ownership frame is a catalog answer", () => {
  it("frames an owned figure in the catalog", () => {
    // The catalog grid mixes owned and missing, so the frame answers
    // "do I already have this one?" (ADR-0038).
    expect(marksOwnership("catalog", true)).toBe(true);
    expect(cardSurfaceClass("catalog", true)).toContain("shadow-gold");
  });

  it("draws the owned frame strongly enough to read at a glance", () => {
    // V2.1's single hairline could not be told from a neutral card while
    // scrolling, which is the one thing it exists for (ADR-0038).
    const owned = cardSurfaceClass("catalog", true);
    const missing = cardSurfaceClass("catalog", false);
    expect(owned).toContain("ring-[3px]"); // a frame, not a hairline
    expect(owned).toContain("before:ring-1"); // the inner frame
    expect(owned).toContain("after:bg-[image:var(--gold-sparkle)]"); // still highlights
    expect(owned).toContain("shadow-gold"); // the struck frame around it
    expect(missing).toContain("ring-1");
    expect(missing).not.toContain("ring-[3px]");
    expect(missing).not.toContain("shadow-gold");
  });

  it("leaves the card itself as bright as any other", () => {
    // V4 tinted the whole card warm and the figures came out washed out — a
    // yellow filter over the photograph rather than a frame around it. The
    // gold goes around the card, never over it (V4.1).
    const owned = cardSurfaceClass("catalog", true);
    expect(owned).toContain("bg-card");
    expect(owned).not.toContain("bg-gradient");
    expect(cardSurfaceClass("catalog", false)).toContain("bg-card");
  });

  it("leaves a missing figure in the catalog neutral", () => {
    expect(marksOwnership("catalog", false)).toBe(false);
    // Every card is framed; the missing one just quietly.
    expect(cardSurfaceClass("catalog", false)).not.toContain("ring-2");
    expect(cardSurfaceClass("catalog", false)).toContain("bg-card");
  });

  it("never frames a card in the showcase, owned or not", () => {
    // Everything in /collection is owned, so a frame would mark every card
    // identically and water down what it means in the catalog.
    for (const collected of [true, false]) {
      expect(marksOwnership("showcase", collected)).toBe(false);
      expect(cardSurfaceClass("showcase", collected)).not.toContain("ring-[3px]");
      expect(cardSurfaceClass("showcase", collected)).not.toContain("shadow-gold");
      expect(cardSurfaceClass("showcase", collected)).toContain("bg-card");
    }
  });

  it("gives the collection and the catalog the same neutral ground", () => {
    expect(cardSurfaceClass("showcase", true)).toBe(cardSurfaceClass("catalog", false));
  });
});

describe("the duplicate badge", () => {
  it("stays out of the way for a single copy", () => {
    // In the showcase every card is owned; a "1×" on all of them says nothing.
    expect(duplicateBadge(1)).toBeNull();
    expect(duplicateBadge(0)).toBeNull();
    expect(duplicateBadge(undefined)).toBeNull();
  });

  it("shows the count above one — including in the showcase", () => {
    expect(duplicateBadge(2)).toBe(2);
    expect(duplicateBadge(11)).toBe(11);
  });
});

/**
 * The frame is struck metal, not a light (ADR-0038, V4.2).
 *
 * V3.4 put a 34 px bloom and a 74 px halo around every owned card. It read
 * from across the room and, up close, read as a glowing card: the light
 * spilled onto the neighbours and softened the very edge it was meant to
 * draw. Every gold layer is now hard-edged.
 *
 * Read from the stylesheet, because that is where the shadow actually lives —
 * the class name alone cannot say whether it blurs.
 */
describe("the owned frame carries no glow", () => {
  const css = readFileSync("src/app/globals.css", "utf8");

  /** The declaration's value, whitespace collapsed. */
  function token(name: string): string {
    const match = css.match(new RegExp(`${name}:([^;]+);`));
    expect(match, `${name} is declared`).not.toBeNull();
    return match![1].replace(/\s+/g, " ").trim();
  }

  /** Splits a box-shadow into its layers, ignoring commas inside `rgb(...)`. */
  function layers(value: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let current = "";
    for (const char of value) {
      if (char === "(") depth += 1;
      if (char === ")") depth -= 1;
      if (char === "," && depth === 0) {
        parts.push(current.trim());
        current = "";
      } else current = current + char;
    }
    if (current.trim() !== "") parts.push(current.trim());
    return parts;
  }

  it("has no blurred gold layer left", () => {
    for (const layer of layers(token("--gold-frame"))) {
      // The lengths are what stands before the colour. A bare `0` carries no
      // unit, so matching on "px" alone would silently skip it and read the
      // blur out of the wrong position.
      const colour = layer.search(/rgb|#/);
      const lengths = (colour === -1 ? layer : layer.slice(0, colour))
        .trim()
        .split(/\s+/)
        .filter((part) => part !== "")
        .map((part) => Number(part.replace("px", "")));
      // offset-x, offset-y, blur, spread — the third is the blur.
      const blur = lengths[2] ?? 0;
      // A near-black layer is depth: every card has that drop shadow, owned
      // or not. Only the warm layers are the frame, and those must be hard.
      const black = /rgb\(\s*0 0 0/.test(layer);
      if (!black) expect(blur, layer).toBe(0);
    }
  });

  it("keeps the four sparkles: they are points, not a wash", () => {
    const sparkle = token("--gold-sparkle");
    expect(sparkle.match(/radial-gradient/g)?.length).toBe(4);
    // Each one is a couple of pixels across. A large radius here would be
    // the bloom coming back through a different token.
    for (const size of [...sparkle.matchAll(/at [\d.]+% [\d.]+%/g)]) expect(size).toBeTruthy();
    for (const radius of [...sparkle.matchAll(/(\d+(?:\.\d+)?)px \1?/g)]) {
      expect(Number(radius[1])).toBeLessThanOrEqual(4);
    }
  });

  it("leaves nothing pointing at the old glow token", () => {
    expect(css).not.toContain("--gold-glow");
  });
});
