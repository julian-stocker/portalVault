/**
 * The two card templates, from design source to shipped asset.
 *
 *   node tools/build-card-templates.mts
 *
 * WHY THIS EXISTS
 *
 * `designs/cards/silver.png` and `gold.png` are 1.8 MB each and are not in the
 * repository (`.gitignore`). The catalog renders up to 561 cards, so what ships
 * has to be a WebP a fraction of that size — the same shape the brand imagery
 * already follows: source in `designs/`, derivative in `public/images/`.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * No keying, no cropping, no straightening, no colour correction. The sources
 * are finished artwork with a real alpha channel, and the glow on the gold
 * template extends past the card body on purpose — cropping to the opaque body
 * would cut it off. Both files keep their full 1024 × 1536 canvas, which is
 * also what keeps the two geometrically interchangeable: one render box, one
 * set of overlay coordinates, nothing moving when a figure is collected.
 *
 * Two widths, because a phone showing two columns needs roughly 200 px and
 * should not fetch a 512 px asset for it.
 */
import sharp from "sharp";
import { mkdir, stat } from "node:fs/promises";

const SOURCE = "designs/cards";
const TARGET = "public/images/cards";

/** Canvas of both sources. Asserted rather than assumed. */
/**
 * The source canvas, as of V3.5.
 *
 * Was 1024×1536 while the two templates were `silver` and `gold`. The six
 * artworks that replaced them are 1007×1562 — a different ratio, not a
 * rescale — and `CARD_CANVAS` in `lib/catalog/card-template.ts` was moved to
 * match. The assertion below is what keeps the two from drifting apart: an
 * artwork delivered at the old size stops the build instead of quietly
 * shifting every slot on the card.
 */
const CANVAS = { width: 1007, height: 1562 };

/**
 * `sm` covers two columns on a phone (~200 CSS px at 2× ≈ 400), `lg` covers a
 * desktop column at 2×. Beyond that the card is never rendered.
 */
const WIDTHS = [
  { suffix: "-sm", width: 400 },
  { suffix: "", width: 640 },
] as const;

/**
 * The active artworks (V3.5, extended in fix round 1).
 *
 * Two per card type: the card a figure is printed on, and the card it is
 * printed on once somebody owns it. Ownership is still not a card type — it
 * picks the second file of the same pair, and `card_type` never changes.
 *
 * `collection` is gone from this list. It was the one ownership artwork for
 * all five types; each type has its own now, and its source PNG is no longer
 * in `designs/cards/`. The built `collection.webp` stays in `public/` for the
 * moment — the way back is not thrown away until the browser has confirmed
 * the new pairs.
 *
 * `prestige.collected.png` is present and is currently a byte-identical copy
 * of `prestige.png`. That is the operator's placeholder, not a decision made
 * here: no fallback in code, no aliased path, and nothing to unwind when the
 * real artwork arrives — dropping the file in and running this again is the
 * whole of it.
 *
 * `silver` and `gold` are deliberately absent. Their sources stay where they
 * are and their WebPs stay built; they are simply not rebuilt, and their
 * 1024×1536 sources would fail the size assertion below.
 */
const TEMPLATES = [
  "card",
  "card.collected",
  "dark",
  "dark.collected",
  "legendary",
  "legendary.collected",
  "chase",
  "chase.collected",
  "prestige",
  "prestige.collected",
] as const;

const kb = (bytes: number) => `${Math.round(bytes / 1024)} KB`;

await mkdir(TARGET, { recursive: true });

for (const name of TEMPLATES) {
  const from = `${SOURCE}/${name}.png`;
  const meta = await sharp(from).metadata();

  if (meta.width !== CANVAS.width || meta.height !== CANVAS.height) {
    throw new Error(
      `${from} is ${meta.width}×${meta.height}; every template must be ` +
        `${CANVAS.width}×${CANVAS.height} or the overlay coordinates stop lining up`,
    );
  }
  if (!meta.hasAlpha) {
    throw new Error(`${from} has no alpha channel — the image window would be opaque`);
  }

  const source = await stat(from);
  console.log(`\n${from}  ${meta.width}×${meta.height}  alpha  ${kb(source.size)}`);

  for (const { suffix, width } of WIDTHS) {
    const to = `${TARGET}/${name}${suffix}.webp`;
    await sharp(from)
      // `fit: inside` with the canvas ratio is a plain scale: no crop, no pad.
      .resize({ width, fit: "inside", withoutEnlargement: true })
      .webp({
        // High quality rather than lossless: at 640 px the difference is
        // invisible and the file is a quarter of the size. `alphaQuality: 100`
        // keeps the window's soft edge clean, which is the one place
        // compression artefacts would show.
        quality: 88,
        alphaQuality: 100,
        effort: 6,
      })
      .toFile(to);

    const out = await stat(to);
    console.log(`  → ${to}  ${width}px  ${kb(out.size)}`);
  }
}

console.log("\nThe sources stay out of the repository; these derivatives are committed.");
