/**
 * The series logos and element emblems, from design source to shipped asset.
 *
 *   node tools/build-design-icons.mts                 (npm run designs:build)
 *   node tools/build-design-icons.mts --with-series   (also the series logos)
 *
 * BY DEFAULT ONLY THE ELEMENT EMBLEMS. They are the only ones the app uses
 * (the figure page). The series logos are not referenced anywhere and are not
 * in the repository (ADR-0173); building them on every run would put six
 * untracked files back into `public/` each time. `--with-series` keeps the
 * capability for the day the series navigation is reworked.
 *
 * WHY THIS EXISTS
 *
 * The sources in `resources/designs/series/` (6 PNG) and
 * `resources/designs/elements/` (8 PNG) are 1254 × 1254 px and up to 2.8 MB
 * each, and they are not in the repository (`.gitignore`). The figure page
 * shows the element emblem at 24 px; the series logos are built and kept ready
 * but are not referenced anywhere yet (ADR-0173). What ships is a WebP a
 * fraction of the source size — the same shape as
 * `build-card-templates.mts`: source in `resources/designs/`, derivative in
 * `public/images/`.
 *
 * WHAT IT DOES, AND NOTHING ELSE
 *
 * - Trims the transparent margin. The logos sit in a square canvas with wide
 *   empty borders; untrimmed, a 36 px tab would show a 20 px logo.
 * - Scales down to fit a box sized for the largest render at 2–3×, keeping the
 *   aspect ratio. Never up.
 * - Writes ONE WebP per source, with its alpha channel. No second variant:
 *   both renders are small enough that one size serves every screen.
 *
 * No recolouring, no keying, no new artwork. The sources are read, never
 * written, moved or deleted.
 *
 * WHAT IT VALIDATES
 *
 * The canvas size and a real alpha channel — the same failure
 * `build-card-templates.mts` once caught (a flattened checkerboard). An
 * unexpected source fails the run instead of shipping.
 */
import sharp from "sharp";
import { mkdir, stat } from "node:fs/promises";

const CANVAS = 1254;

/**
 * Source file → shipped file, per group. The file names are the designer's
 * and are kept; the mapping to elements lives in exactly one place in the
 * app, `ELEMENT_ICON` in `element-icon.tsx`. The series logos have no mapping
 * yet — they are not used (ADR-0173).
 */
const GROUPS = [
  {
    name: "series",
    optional: true,
    source: "resources/designs/series",
    target: "public/images/series",
    /* Not used yet — sized for a ~180 × 36 CSS px tab at 2×. */
    box: { width: 360, height: 120 },
    files: ["spyros-adventure", "giants", "swap-force", "trap-team", "super-chargers",
      "imaginators"],
  },
  {
    name: "elements",
    optional: false,
    source: "resources/designs/elements",
    target: "public/images/elements",
    /* Rendered at 24 CSS px on the figure page; ~2.7× of that. */
    box: { width: 64, height: 64 },
    files: ["air", "earth", "fire", "life", "magic", "technic", "undead", "water"],
  },
] as const;

const withSeries = process.argv.includes("--with-series");

for (const group of GROUPS) {
  if (group.optional && !withSeries) {
    console.log(`${group.name}: skipped (pass --with-series to build it)`);
    continue;
  }
  await mkdir(group.target, { recursive: true });
  for (const name of group.files) {
    const source = `${group.source}/${name}.png`;
    const meta = await sharp(source).metadata();
    if (meta.width !== CANVAS || meta.height !== CANVAS) {
      throw new Error(`${source}: expected ${CANVAS}×${CANVAS}, got ${meta.width}×${meta.height}`);
    }
    if (!meta.hasAlpha) throw new Error(`${source}: no alpha channel`);
    const { isOpaque } = await sharp(source).stats();
    if (isOpaque) throw new Error(`${source}: fully opaque — transparency was flattened`);

    const target = `${group.target}/${name}.webp`;
    await sharp(source)
      .trim()
      .resize({ ...group.box, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 88, alphaQuality: 100, effort: 6 })
      .toFile(target);
    const out = await sharp(target).metadata();
    const size = (await stat(target)).size;
    console.log(`${target}  ${out.width}×${out.height}  ${(size / 1024).toFixed(1)} KB`);
  }
}
