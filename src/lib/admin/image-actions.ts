/**
 * Uploading and removing a figure's picture (ADR-0046).
 *
 * The whole operation runs on the server with the administrator's own
 * session. No service-role key is involved and none may be: the write is
 * allowed by a storage policy whose predicate is `public.is_shop_admin()`,
 * the same function that guards every other shop write. A signed-in
 * non-administrator gets a policy violation from Postgres, whatever this file
 * does or does not check first.
 *
 * ORDER OF OPERATIONS, AND WHY
 *
 *   1. upload the new object under a new, content-addressed path
 *   2. point the figure at it
 *   3. only then delete the object it replaced
 *
 * Every step can fail, and after any failure the figure still has a picture:
 * the old one until step 2 succeeds, the new one afterwards. The reverse
 * order — delete, then upload — has a window where the figure has none.
 *
 * A failure in step 3 leaves an orphaned object and is deliberately not
 * treated as an error: an unreferenced file in a bucket costs storage, a
 * failed operation costs the administrator their picture.
 */
"use server";

import { setImageOverride } from "@/lib/admin/actions";
import { imagePathFor, MAX_IMAGE_BYTES, sniffImage } from "@/lib/admin/image-file";
import { isAdmin } from "@/lib/auth/admin";
import { CATALOG_BUCKET, isOverridePath } from "@/lib/catalog/image";
import { createClient } from "@/lib/supabase/server";
import { de } from "@/lib/i18n/de";

export type ImageResult = { ok: true; path: string } | { ok: false; message: string };

const SKY_ID = /^SKY-[0-9]{4}$/;

/**
 * The path this figure currently points at, if any.
 *
 * Read back from the row rather than trusted from the form: what gets deleted
 * must be what the database says was in use, never a path the browser sent.
 */
async function currentOverride(skyId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("skylanders")
    .select("image_override_path")
    .eq("sky_id", skyId)
    .single();
  const path = data?.image_override_path;
  return typeof path === "string" && isOverridePath(path, skyId) ? path : null;
}

/** Best effort. An orphan is cheaper than a lost picture — see the header. */
async function removeObject(path: string): Promise<void> {
  const supabase = await createClient();
  await supabase.storage.from(CATALOG_BUCKET).remove([path]);
}

export async function uploadFigureImage(formData: FormData): Promise<ImageResult> {
  if (!(await isAdmin())) return { ok: false, message: de.admin.notAllowed };

  const skyId = String(formData.get("skyId") ?? "");
  if (!SKY_ID.test(skyId)) return { ok: false, message: de.admin.unknownFigure };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: de.admin.imageFailed };
  }
  // Checked before reading the whole thing into memory.
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, message: de.admin.imageTooLarge };

  const bytes = new Uint8Array(await file.arrayBuffer());
  // The bytes decide, not the browser's Content-Type.
  const kind = sniffImage(bytes);
  if (!kind) return { ok: false, message: de.admin.imageWrongType };

  const path = imagePathFor(skyId, bytes, kind);
  const previous = await currentOverride(skyId);

  const supabase = await createClient();
  const upload = await supabase.storage.from(CATALOG_BUCKET).upload(path, bytes, {
    contentType: kind.mime,
    // Content-addressed: the same bytes are the same object. Re-uploading a
    // picture somebody already uploaded should succeed, not collide.
    upsert: true,
  });
  if (upload.error) return { ok: false, message: de.admin.imageFailed };

  const pointed = await setImageOverride(skyId, path);
  if (!pointed.ok) {
    // The figure still shows whatever it showed before. Take the object we
    // just wrote back out rather than leaving it unreferenced.
    if (path !== previous) await removeObject(path);
    return { ok: false, message: pointed.message };
  }

  // Only now, and only if it is really no longer in use.
  if (previous && previous !== path) await removeObject(previous);

  return { ok: true, path };
}

/**
 * Back to the imported picture.
 *
 * `image_file` was never touched, so this is a reset rather than a deletion:
 * the figure shows what it showed before anybody uploaded anything, or the
 * empty plate if it never had a file.
 */
export async function removeFigureImage(skyId: string): Promise<ImageResult> {
  if (!(await isAdmin())) return { ok: false, message: de.admin.notAllowed };
  if (!SKY_ID.test(skyId)) return { ok: false, message: de.admin.unknownFigure };

  const previous = await currentOverride(skyId);
  const cleared = await setImageOverride(skyId, null);
  if (!cleared.ok) return { ok: false, message: cleared.message };

  if (previous) await removeObject(previous);
  return { ok: true, path: "" };
}
