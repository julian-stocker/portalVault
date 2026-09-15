/**
 * The card artworks, from design source to shipped asset.
 *
 *   node tools/build-card-templates.mts
 *
 * WHY THIS EXISTS
 *
 * The sources in `designs/cards/` are 1.3–2.4 MB each and are not in the
 * repository (`.gitignore`). The catalog renders up to 561 cards, so what ships
 * has to be a WebP a fraction of that size — the same shape the brand imagery
 * already follows: source in `designs/`, derivative in `public/images/`.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * No keying, no cropping, no straightening, no colour correction. The sources
 * are finished artwork with a real alpha channel, and ornament that extends
 * past the card body does so on purpose — cropping to the opaque body would
 * cut it off. Every file keeps its full canvas, which is what keeps the six
 * geometrically interchangeable: one render box, one set of slot coordinates,
 * nothing moving when a figure changes type.
 *
 * WHAT IT VALIDATES, AND WHY IT HAD TO (V3.6)
 *
 * A `special.png` once arrived with no alpha channel at all — the design
 * tool's transparency checkerboard had been flattened into the pixels. The
 * canvas was right, so the only check there was passed, and the card would
 * have shipped with the figure completely hidden behind an opaque grey grid.
 * Dimensions, alpha, a transparent image window and transparent outer corners
 * are all asserted now. None of it is pixel-perfect; all of it fails loudly.
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
 * WINDOW_FILL from `lib/catalog/card-template.ts`, in source pixels.
 *
 * Restated rather than imported: this is a build script run by `node` against
 * `.mts`, and the module it would import pulls in the whole catalog type
 * graph. The one test that reads both files holds them against each other.
 *
 * It is the fill INCLUDING its overscan, not the bare hole. The top reaches
 * 36 px up behind the frame so that no transparent strip shows along the
 * window's ornamented head — so the band measured here contains some frame by
 * design, and the 60 % threshold below is set with that in mind. Measured
 * values across the six artworks: 74–82 %.
 */
const WINDOW = { left: 76, right: 930, top: 80, bottom: 916 };

/**
 * The six cards a figure can be printed on — one per `CardType`, in the same
 * order as `CARD_TYPES`.
 *
 * The `.collected` halves are gone. Each type used to have a second artwork
 * for owners; the pairs were never pixel-congruent, so collecting a figure
 * made the card appear to jump, and V3.6 abandoned the idea. Ownership is an
 * overlay now — see `OVERLAYS` below — and the sources for the pairs have
 * been removed from `designs/cards/`.
 *
 * `silver` and `gold` are gone too, with the `TEMPLATE` export that pointed at
 * them: nothing had rendered them since V3.5.
 */
const TEMPLATES = [
  "card",
  "special",
  "elite",
  "dark",
  "legendary",
  "chase",
  "prestige",
] as const;

/**
 * Not a card: the mark drawn ON one.
 *
 * Square, a different canvas, and the same file for every card type, so it
 * cannot go through the card checks — a 1007×1562 assertion on a 1254×1254
 * seal would fail for the wrong reason. It gets its own, weaker but real:
 * square, alpha present, and not a fully opaque block.
 */
const OVERLAYS = ["collected"] as const;

const kb = (bytes: number) => `${Math.round(bytes / 1024)} KB`;

await mkdir(TARGET, { recursive: true });

/**
 * How much of a rectangle is see-through.
 *
 * Reads the decoded alpha channel rather than trusting `hasAlpha`: a PNG can
 * carry an alpha channel in which every pixel is 255, which is exactly the
 * shape the broken `special.png` would have had if it had been exported one
 * step differently.
 */
async function transparency(
  file: string,
  box: { left: number; top: number; width: number; height: number },
): Promise<number> {
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .extract(box)
    .raw()
    .toBuffer({ resolveWithObject: true });

  let clear = 0;
  for (let i = 3; i < data.length; i += info.channels) if (data[i] < 24) clear++;
  return clear / (info.width * info.height);
}

const pct = (share: number) => `${(share * 100).toFixed(1)} %`;

/*
 * Every rejection, not just the first.
 *
 * A build that stops at the first bad artwork tells the operator about one
 * file and hides the other four they would also have to re-export. Everything
 * that passes is still built — a stale derivative is worse than a fresh one —
 * and the run fails at the end with the whole list.
 */
const rejected: string[] = [];
const reject = (message: string) => {
  rejected.push(message);
  console.error(`  REJECTED  ${message}`);
};

/* ------------------------------------------------------------------ cards */

for (const name of TEMPLATES) {
  const from = `${SOURCE}/${name}.png`;
  const meta = await sharp(from).metadata();

  if (meta.width !== CANVAS.width || meta.height !== CANVAS.height) {
    reject(
      `${from} is ${meta.width}×${meta.height}; every template must be ` +
        `${CANVAS.width}×${CANVAS.height} or the overlay coordinates stop lining up`,
    );
    continue;
  }
  if (!meta.hasAlpha) {
    reject(`${from} has no alpha channel — the image window would be opaque`);
    continue;
  }

  /*
   * The figure is drawn BEHIND the card and shows through the window. The
   * five good artworks clear 84–85 % of it; prestige's ornament reaches
   * furthest in at 77 %. 60 % is well under every real value and far above
   * the 0 % a flattened export produces — a threshold that catches the
   * failure without pinning the artwork's design.
   */
  const window = await transparency(from, {
    left: WINDOW.left,
    top: WINDOW.top,
    width: WINDOW.right - WINDOW.left,
    height: WINDOW.bottom - WINDOW.top,
  });
  if (window < 0.6) {
    reject(
      `${from}: the image window is only ${pct(window)} transparent — the figure ` +
        `would be hidden behind the card. Re-export with a real alpha channel.`,
    );
    continue;
  }

  /* The card has rounded corners; the sheet it sits on must not be part of
     the file. A flattened export fails here too, which is the point. */
  const corner = await transparency(from, { left: 0, top: 0, width: 12, height: 12 });
  if (corner < 0.5) {
    reject(
      `${from}: the top-left corner is only ${pct(corner)} transparent — the card ` +
        `body is not cut out of its background.`,
    );
    continue;
  }

  const source = await stat(from);
  console.log(
    `\n${from}  ${meta.width}×${meta.height}  window ${pct(window)} clear  ${kb(source.size)}`,
  );

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

/* --------------------------------------------------------------- overlay */

for (const name of OVERLAYS) {
  const from = `${SOURCE}/${name}.png`;
  const meta = await sharp(from).metadata();

  if (meta.width !== meta.height) {
    reject(
      `${from} is ${meta.width}×${meta.height}; the ownership overlay is drawn in a ` +
        `square box and a non-square source would be squashed into it`,
    );
    continue;
  }
  if (!meta.hasAlpha) {
    reject(`${from} has no alpha channel — it would cover the card as a block`);
    continue;
  }

  /* A round seal on a square canvas leaves the corners clear. Below 5 % the
     file is a filled rectangle, which is not a seal. */
  const clear = await transparency(from, {
    left: 0,
    top: 0,
    width: meta.width as number,
    height: meta.height as number,
  });
  if (clear < 0.05) {
    reject(`${from}: only ${pct(clear)} transparent — this is a block, not a mark.`);
    continue;
  }

  const source = await stat(from);
  console.log(`\n${from}  ${meta.width}×${meta.height}  ${pct(clear)} clear  ${kb(source.size)}`);

  for (const { suffix, width } of WIDTHS) {
    const to = `${TARGET}/${name}${suffix}.webp`;
    await sharp(from)
      .resize({ width, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 88, alphaQuality: 100, effort: 6 })
      .toFile(to);
    const out = await stat(to);
    console.log(`  → ${to}  ${width}px  ${kb(out.size)}`);
  }
}

console.log("\nThe sources stay out of the repository; these derivatives are committed.");

if (rejected.length > 0) {
  console.error(`\n${rejected.length} artwork(s) were not built:`);
  for (const message of rejected) console.error(`  · ${message}`);
  process.exitCode = 1;
  throw new Error(`${rejected.length} artwork(s) rejected — see above`);
}
