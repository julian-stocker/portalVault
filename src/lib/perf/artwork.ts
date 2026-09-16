/**
 * When the picture is actually ready to be seen — moment D (ADR-0073).
 *
 * The quick view loads no data, so A→C measures React and paint and little
 * else. What the tester waits for is the figure: `loading="lazy"`, and for a
 * figure with an administrator override fetched from Supabase Storage over
 * the network. D is that moment, and it is the reason the interaction table
 * has a fourth duration.
 *
 * HONESTY OVER COVERAGE
 *
 * Every branch that cannot produce a trustworthy timestamp settles on `null`,
 * and null reaches the database as null. The temptation is to fall back on
 * "the image was already complete, so use C" — that would quietly turn "we
 * could not measure the picture" into "the picture was instant", which is the
 * single most misleading thing this column could say.
 *
 * `decode()` rather than `load` wherever it exists: `load` says the bytes
 * arrived, `decode()` says the browser can paint it without blocking. On a
 * phone decoding a 640×640 PNG is not free, and the tester sees the second
 * moment, not the first.
 *
 * NO TIMER. Nothing here schedules anything — a telemetry client that sets
 * timers is one step from becoming the latency it measures. A watch that
 * never resolves is ended by `cancel()`, which the component calls when the
 * dialog closes and before the page goes away.
 */

/** The little of `HTMLImageElement` this needs, so a test can supply it. */
export type ImageLike = {
  complete: boolean;
  naturalWidth: number;
  decode?: () => Promise<unknown>;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
};

/** Why a watch ended. Not recorded — it exists so the tests can say it. */
export type ArtworkOutcome =
  | "decoded" /* decode() resolved: the strongest signal */
  | "loaded" /* load fired, decode() unavailable */
  | "no-image" /* nothing to wait for */
  | "already-complete" /* finished before we looked; no timestamp exists */
  | "failed" /* load error, or decode() rejected */
  | "cancelled"; /* the dialog went away first */

export type ArtworkResult = { at: number | null; outcome: ArtworkOutcome };

/**
 * Watches one image and settles exactly once.
 *
 * Returns a cancel function. Calling it after the watch has settled does
 * nothing; calling it before settles the watch as `cancelled` with no
 * timestamp, which is what a dialog dismissed mid-load should record.
 */
export function watchArtwork(
  image: ImageLike | null,
  now: () => number,
  settle: (result: ArtworkResult) => void,
): () => void {
  let done = false;

  function finish(at: number | null, outcome: ArtworkOutcome): void {
    if (done) return;
    done = true;
    image?.removeEventListener("load", onLoad);
    image?.removeEventListener("error", onError);
    settle({ at, outcome });
  }

  /*
   * A resolved decode is the moment; a rejection is not a smaller moment.
   * `decode()` rejects when the image is broken or was replaced while
   * decoding, and neither is "the artwork appeared".
   */
  function afterLoad(): void {
    if (typeof image?.decode !== "function") {
      finish(now(), "loaded");
      return;
    }
    image
      .decode()
      .then(() => finish(now(), "decoded"))
      .catch(() => finish(null, "failed"));
  }

  function onLoad(): void {
    afterLoad();
  }
  function onError(): void {
    finish(null, "failed");
  }

  // Nothing to wait for. A figure with no artwork is a real state, and its
  // interaction still has A, B and C.
  if (image === null) {
    finish(null, "no-image");
    return () => {};
  }

  if (image.complete) {
    /*
     * Already finished by the time the dialog painted.
     *
     * With `decode()` there is still a real moment to report: the browser
     * confirms it can paint the picture, and that confirmation has a
     * timestamp. Without it there is none — the load happened before anybody
     * was watching, so any number here would be invented. Note that a
     * decoded-from-cache timestamp can land BEFORE C; the column allows that
     * on purpose, because it means the picture was never the thing being
     * waited for.
     */
    if (image.naturalWidth === 0) {
      // `complete` is also true for an image that failed.
      finish(null, "failed");
      return () => {};
    }
    if (typeof image.decode !== "function") {
      finish(null, "already-complete");
      return () => {};
    }
    afterLoad();
    return () => finish(null, "cancelled");
  }

  image.addEventListener("load", onLoad);
  image.addEventListener("error", onError);
  return () => finish(null, "cancelled");
}
