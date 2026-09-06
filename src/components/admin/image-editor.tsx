/**
 * Replacing a figure's picture, from the browser (ADR-0046).
 *
 * The point of this control is that it needs no deploy: the imported images
 * ship with the build, so improving one used to mean a commit, a push and a
 * Vercel build. An upload here lands in storage and every surface picks it up
 * on the next request — catalog, detail page, collection, stock list, cart.
 *
 * It never deletes the imported picture. "Eigenes Bild entfernen" clears the
 * override, and what comes back is exactly what was there before anyone
 * uploaded anything.
 *
 * The file is sent to a server action, which is where every check that
 * matters lives: administrator, real size, real bytes. Nothing here is a
 * boundary — the storage policy underneath asks `is_shop_admin()` too, so a
 * request that skips this component entirely is refused just the same.
 */
"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { removeFigureImage, uploadFigureImage } from "@/lib/admin/image-actions";
import { FigureImage } from "@/components/catalog/figure-image";
import { ACTION_NEUTRAL } from "@/components/ui/action";
import { MAX_IMAGE_BYTES } from "@/lib/admin/image-file";
import { de } from "@/lib/i18n/de";

export function ImageEditor({
  skyId,
  name,
  src,
  hasOverride,
}: {
  skyId: string;
  name: string;
  /** Already resolved: whatever the figure currently shows. */
  src: string | null;
  /** Whether that picture is an upload rather than the imported one. */
  hasOverride: boolean;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function upload(file: File) {
    setFailed(null);
    // Checked here as well so an obviously oversized file never leaves the
    // machine. The server checks again, and the bucket a third time.
    if (file.size > MAX_IMAGE_BYTES) {
      setFailed(de.admin.imageTooLarge);
      return;
    }

    const form = new FormData();
    form.set("skyId", skyId);
    form.set("file", file);

    startTransition(async () => {
      const result = await uploadFigureImage(form);
      if (!result.ok) {
        setFailed(result.message);
        return;
      }
      router.refresh();
    });
  }

  function reset() {
    setFailed(null);
    startTransition(async () => {
      const result = await removeFigureImage(skyId);
      if (!result.ok) {
        setFailed(result.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-start gap-4">
        <div className="w-28 shrink-0 sm:w-36">
          <FigureImage src={src} name={name} />
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <p className="text-[11px] text-muted">
            {hasOverride
              ? de.admin.imageOwn
              : src
                ? de.admin.imageImported
                : de.admin.imageNone}
          </p>

          {/* A real file input, kept out of sight rather than reimplemented:
              the native control is what makes the camera and the photo
              library available on a phone. */}
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Cleared so choosing the same file twice fires again.
              event.target.value = "";
              if (file) upload(file);
            }}
          />

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => input.current?.click()}
              disabled={pending}
              className={`${ACTION_NEUTRAL} w-auto px-4 disabled:opacity-60`}
            >
              {pending
                ? de.admin.imageUploading
                : hasOverride
                  ? de.admin.imageReplace
                  : de.admin.imageChange}
            </button>

            {hasOverride ? (
              <button
                type="button"
                onClick={reset}
                disabled={pending}
                className={`${ACTION_NEUTRAL} w-auto px-4 disabled:opacity-60`}
              >
                {de.admin.imageRemove}
              </button>
            ) : null}
          </div>

          <p className="text-[11px] text-muted">{de.admin.imageHint}</p>

          {failed ? (
            <p role="alert" className="text-sm text-danger">
              {failed}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
