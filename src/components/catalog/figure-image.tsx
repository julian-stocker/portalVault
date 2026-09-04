/**
 * Figure image, or a stable placeholder.
 *
 * Plain <img> rather than next/image: the 475 files are already optimised to
 * 640 px, content-addressed and served from /public, so runtime optimisation
 * would cost image units for no gain (ADR-0026).
 *
 * The wrapper keeps a square box whether or not an image exists, so the 66
 * figures without one cause no layout shift.
 */
import { de } from "@/lib/i18n/de";

export function FigureImage({ file, name }: { file: string | null; name: string }) {
  return (
    <div className="relative aspect-square w-full overflow-hidden rounded-md bg-border/40">
      {file ? (
        /* ADR-0026: the files are already optimised to 640 px,
           content-addressed and served from /public, so next/image would
           re-optimise them at runtime and bill image units for no gain. */
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/images/skylanders/${file}`}
          alt={name}
          loading="lazy"
          decoding="async"
          width={640}
          height={640}
          className="h-full w-full object-contain"
        />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center text-xs text-muted">
          {de.catalog.noImage}
        </span>
      )}
    </div>
  );
}
