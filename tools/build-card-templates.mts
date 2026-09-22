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

/**
 * Not a card and not a mark: the glow drawn BEHIND one.
 *
 * `collected.layer.png` is a transparent golden aura on the card canvas. The
 * card renders it a few per cent larger than itself and centred, so the light
 * spills out around all four edges — which is why it shares the canvas: at
 * the same ratio, one scale factor is all the geometry there is.
 *
 * It cannot go through the card checks. Those assert a transparent image
 * WINDOW and a transparent CORNER, because a card is a frame with a hole in
 * it; this file is transparent nearly everywhere and has neither. Its own
 * checks are the ones that mean something here: the card canvas, a real alpha
 * channel, and mostly — but not entirely — see-through. A file that is 100 %
 * clear is an empty export, and one that is opaque would black out the card.
 */
const LAYERS = ["collected.layer"] as const;

/**
 * GEOMETRIE DES GLOW-LAYERS — GEMESSEN, NICHT GERATEN.
 *
 * Die Quelle ist als RAHMEN auf der Kartenfläche gezeichnet, nicht als Aura
 * um sie herum: der helle Ring liegt INNERHALB der Leinwand, mit einem
 * schmalen und ungleichen transparenten Rand (links 11 px, rechts 5, oben 35,
 * unten 48). Beides zusammen war der Grund, warum bei 1,05 nichts zu sehen
 * war — der helle Ring lag unter der Karte, und was überstand, war nur das
 * schwache Auslaufen. Unten stand gar nichts über, weil dort 48 px leer sind.
 *
 * WAS HIER PASSIERT, UND WAS AUSDRÜCKLICH NICHT
 *
 * Der Inhalt wird auf seine tatsächliche Bounding-Box beschnitten, gleichmäßig
 * skaliert und mittig auf eine transparente Kartenleinwand gesetzt. Damit ist
 * der Rand auf allen vier Seiten gleich, und die Leinwand bleibt exakt
 * 1007×1562 — dasselbe Seitenverhältnis wie die Karte, also genügt im Browser
 * eine einzige Skalierungszahl.
 *
 * NICHT auf jedes Alpha > 0 beschnitten: die Schwelle ignoriert nur den
 * unsichtbaren Saum. Und der Inhalt füllt die Leinwand NICHT ganz aus —
 * `CONTENT_SHARE` lässt ringsum einen transparenten Sicherheitsrand, damit das
 * Auslaufen nicht an der Leinwandkante hart abbricht und die WebP-Skalierung
 * keine Kante zu greifen bekommt.
 *
 * Nichts wird gestreckt: die Bounding-Box behält ihr Seitenverhältnis, sie
 * wird nur einbeschrieben und zentriert.
 */
const GLOW_ALPHA = 10;        // darunter ist der Saum unsichtbar
const CONTENT_SHARE = 0.94;   // 3 % transparenter Sicherheitsrand je Seite

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

/**
 * Die Bounding-Box aller Pixel, die heller als `threshold` sind.
 *
 * Gelesen wird der dekodierte Alphakanal, aus demselben Grund wie in
 * `transparency()`: `hasAlpha` sagt nur, dass ein Kanal da ist.
 */
async function alphaBounds(file: string, threshold: number) {
  const { data, info } = await sharp(file).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  let left = width, right = -1, top = height, bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * channels + 3] > threshold) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  return { left, top, width: right - left + 1, height: bottom - top + 1,
           marginLeft: left, marginRight: width - 1 - right,
           marginTop: top, marginBottom: height - 1 - bottom };
}

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

/* ----------------------------------------------------------------- layer */

for (const name of LAYERS) {
  const from = `${SOURCE}/${name}.png`;
  const meta = await sharp(from).metadata();

  if (meta.width !== CANVAS.width || meta.height !== CANVAS.height) {
    reject(
      `${from} is ${meta.width}×${meta.height}; the glow shares the card canvas ` +
        `${CANVAS.width}×${CANVAS.height}, so that one scale factor centres it`,
    );
    continue;
  }
  if (!meta.hasAlpha) {
    reject(`${from} has no alpha channel — it would cover the card as a block`);
    continue;
  }

  const clear = await transparency(from, {
    left: 0,
    top: 0,
    width: meta.width as number,
    height: meta.height as number,
  });
  /* Between the two failures that matter: an empty export and a solid slab. */
  if (clear < 0.05) {
    reject(`${from}: only ${pct(clear)} transparent — this is a block, not a glow.`);
    continue;
  }
  if (clear > 0.995) {
    reject(`${from}: ${pct(clear)} transparent — there is nothing drawn in it.`);
    continue;
  }

  const source = await stat(from);
  const box = await alphaBounds(from, GLOW_ALPHA);
  console.log(`\n${from}  ${meta.width}×${meta.height}  ${pct(clear)} clear  ${kb(source.size)}`);
  console.log(
    `  glow box  ${box.width}×${box.height} at ${box.left},${box.top}  ` +
      `margins L${box.marginLeft} R${box.marginRight} T${box.marginTop} B${box.marginBottom}`,
  );

  /*
   * Beschneiden, gleichmäßig einbeschreiben, zentrieren. `fit: inside` auf
   * einem Kasten mit BEIDEN Maßen ist eine reine Skalierung — kein Zuschnitt,
   * keine Streckung —, und `extend` füllt den Rest mit echtem Nichts.
   */
  const fitted = await sharp(from)
    .extract({ left: box.left, top: box.top, width: box.width, height: box.height })
    .resize({
      width: Math.round(CANVAS.width * CONTENT_SHARE),
      height: Math.round(CANVAS.height * CONTENT_SHARE),
      fit: "inside",
    })
    .toBuffer({ resolveWithObject: true });

  const padX = CANVAS.width - fitted.info.width;
  const padY = CANVAS.height - fitted.info.height;
  const normalised = await sharp(fitted.data)
    .extend({
      left: Math.floor(padX / 2), right: Math.ceil(padX / 2),
      top: Math.floor(padY / 2), bottom: Math.ceil(padY / 2),
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  const check = await sharp(normalised).metadata();
  if (check.width !== CANVAS.width || check.height !== CANVAS.height) {
    reject(
      `${from}: normalising produced ${check.width}×${check.height}; the layer must stay ` +
        `on the card canvas or one scale factor stops centring it`,
    );
    continue;
  }
  console.log(
    `  normalised  content ${fitted.info.width}×${fitted.info.height} ` +
      `centred on ${CANVAS.width}×${CANVAS.height}  ` +
      `margin ${Math.floor(padX / 2)} / ${Math.floor(padY / 2)}`,
  );

  for (const { suffix, width } of WIDTHS) {
    const to = `${TARGET}/${name}${suffix}.webp`;
    await sharp(normalised)
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
