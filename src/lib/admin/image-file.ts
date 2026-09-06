/**
 * What may be uploaded as a figure's picture, and where it lands.
 *
 * Pure and dependency-free on purpose. The type of an upload is decided by
 * reading the first bytes of the file, not by trusting `File.type` — that
 * value comes from the browser and is whatever the client says it is. A
 * `.png` renamed to `.webp`, or an HTML file announced as `image/webp`, is
 * caught here rather than becoming an object in a public bucket.
 *
 * There is deliberately no re-encoding, no resizing and no metadata
 * stripping: all three need an image library (sharp or equivalent), which is
 * a heavy dependency and a decision of its own. The bucket therefore also
 * carries a size limit and a MIME allowlist, so the same rules hold for any
 * path that reaches storage.
 */
import { createHash } from "node:crypto";

/** 2 MB. Matches `file_size_limit` on the bucket, so both ends agree. */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

export type ImageKind = { mime: string; extension: "webp" | "png" | "jpg" };

const JPEG: ImageKind = { mime: "image/jpeg", extension: "jpg" };
const PNG: ImageKind = { mime: "image/png", extension: "png" };
const WEBP: ImageKind = { mime: "image/webp", extension: "webp" };

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === byte);
}

/**
 * The real type of the bytes, or null when they are not an image we accept.
 *
 * Three signatures, read from the file itself:
 *
 *   JPEG  FF D8 FF
 *   PNG   89 50 4E 47 0D 0A 1A 0A
 *   WebP  "RIFF" ???? "WEBP"   — a RIFF container whose form type is WEBP
 */
export function sniffImage(bytes: Uint8Array): ImageKind | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return JPEG;
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return PNG;

  // RIFF....WEBP — the four size bytes in between are not part of the check.
  const riff = startsWith(bytes, [0x52, 0x49, 0x46, 0x46]);
  const webp =
    bytes.length >= 12 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50;
  if (riff && webp) return WEBP;

  return null;
}

/**
 * Where the object goes: `SKY-0007/<16 hex of sha256>.webp`.
 *
 * Content-addressed, like the imported files (ADR-0009), and for the same
 * reason plus one more: a replacement gets a **new** path, so no browser and
 * no CDN can serve the old picture from a cached URL. Overwriting one fixed
 * name per figure would have been simpler and would have shown people the
 * image they just replaced, for as long as their cache lasted.
 *
 * The SKY-ID directory is what `admin_set_image_override()` checks the path
 * against, so a figure cannot be pointed at another figure's object.
 */
export function imagePathFor(skyId: string, bytes: Uint8Array, kind: ImageKind): string {
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  return `${skyId}/${hash}.${kind.extension}`;
}
