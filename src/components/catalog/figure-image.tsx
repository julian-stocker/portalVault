/**
 * Figure image, or a stable placeholder.
 *
 * Plain <img> rather than next/image: the 475 files are already optimised to
 * 640 px, content-addressed and served from /public, so runtime optimisation
 * would cost image units for no gain (ADR-0026).
 *
 * The plate (ADR-0035). The catalog holds two kinds of asset — 435 opaque
 * photographs on white and 40 with an alpha channel — and a light plate is
 * what makes them look like the same thing: the opaque ones match it, the
 * transparent ones composite onto it. It stays light in both themes, so in
 * the dark theme a white figure reads as a lit display case instead of a
 * stray white square.
 *
 * The box keeps its square whether or not an image exists, so the 27 figures
 * without one cause no layout shift.
 *
 * It takes a resolved `src`, never a file name: which of the three sources a
 * picture comes from is decided once, in `imageSrc()` (ADR-0046). This
 * component knows only that there is a URL or there is not.
 */
import { de } from "@/lib/i18n/de";

export function FigureImage({ src, name }: { src: string | null; name: string }) {
  return (
    <div className="relative aspect-square w-full overflow-hidden rounded-sky-md bg-plate ring-1 ring-border/70">
      {src ? (
        /* ADR-0026: the files are already optimised to 640 px,
           content-addressed and served from /public, so next/image would
           re-optimise them at runtime and bill image units for no gain. */
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={name}
          loading="lazy"
          decoding="async"
          width={640}
          height={640}
          className="h-full w-full object-contain"
        />
      ) : (
        /* An empty case, not an error. Same plate, same frame — only the
           label is quiet. `--on-plate-muted` is a fixed tone because the
           plate is light in both themes, where `text-muted` would invert
           and disappear. */
        <span className="absolute inset-0 flex items-center justify-center text-[11px] text-on-plate-muted">
          {de.catalog.noImage}
        </span>
      )}
    </div>
  );
}
