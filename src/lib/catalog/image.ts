/**
 * Where a figure's picture comes from — one answer, for every surface.
 *
 * Until now three components built the same URL by hand: the catalog's
 * `FigureImage`, the collection table's `Thumb` and the admin's `AdminThumb`.
 * Three copies of `/images/skylanders/${file}` meant that adding a second
 * source would have to be remembered three times, and forgotten once.
 *
 * There are three sources, in this order (ADR-0046):
 *
 *   1. the administrator's upload   Supabase Storage, bucket `catalog`
 *   2. the imported file            /public/images/skylanders, from the
 *                                   legacy export, replaced by a deploy
 *   3. nothing                      27 collectibles genuinely have no picture
 *
 * The order is what makes "remove my image" a real operation rather than a
 * deletion: clearing the override brings the imported picture back, because
 * it was never overwritten. The catalog import owns `image_file` and the
 * administrator owns `image_override_path`, and neither writes the other.
 */

/** The public storage bucket for catalog images. Public read, admin write. */
export const CATALOG_BUCKET = "catalog";

/** The imported images, served straight from the deployment. */
const STATIC_PREFIX = "/images/skylanders/";

/**
 * What a figure needs to have a picture resolved.
 *
 * A structural type rather than `CatalogFigure`, because the admin list, the
 * cart line and the catalog card all carry different shapes of the same two
 * facts.
 */
export type ImageSource = {
  /** From the legacy import. `<16 hex>.webp`, or null. */
  imageFile: string | null;
  /** From an administrator's upload. `SKY-0007/<16 hex>.webp`, or null. */
  imageOverridePath?: string | null;
};

/**
 * The public URL of an uploaded image.
 *
 * Built rather than stored: the row keeps the path, so moving the project or
 * renaming the bucket does not require rewriting 561 rows. A missing
 * environment variable yields null rather than a broken `undefined/...` URL.
 */
export function storageUrl(path: string): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  return `${base.replace(/\/+$/, "")}/storage/v1/object/public/${CATALOG_BUCKET}/${path}`;
}

/**
 * The picture to show, or null when there is none.
 *
 * Null is a real answer and every caller handles it — the empty plate is a
 * design state, not an error (ADR-0009).
 */
export function imageSrc(source: ImageSource): string | null {
  if (source.imageOverridePath) {
    const uploaded = storageUrl(source.imageOverridePath);
    // Only fall through when the URL could not be built at all. An override
    // that exists must not be silently replaced by the imported picture —
    // that would show the old image after somebody replaced it.
    if (uploaded) return uploaded;
  }
  if (source.imageFile) return `${STATIC_PREFIX}${source.imageFile}`;
  return null;
}

/** True when an administrator has replaced this figure's picture. */
export function hasImageOverride(source: ImageSource): boolean {
  return Boolean(source.imageOverridePath);
}

/**
 * Is this a path we wrote?
 *
 * Mirrors the CHECK on `skylanders.image_override_path`: the figure's own
 * SKY-ID as the directory, a content hash, a known extension. Used before a
 * delete, so a bug cannot turn "remove my image" into "remove some object".
 */
const OVERRIDE_PATH = /^SKY-[0-9]{4}\/[0-9a-f]{16}\.(webp|png|jpg)$/;

export function isOverridePath(value: string, skyId: string): boolean {
  return OVERRIDE_PATH.test(value) && value.startsWith(`${skyId}/`);
}
