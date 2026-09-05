/**
 * The upper world of a collector page.
 *
 * V3.2 put the portal artwork in a bounded band inside the page content, and
 * the result read as exactly that: a header, then a picture, then a search
 * bar, then a grid — five web components stacked, not one place. The
 * reference has no banner edge anywhere. The world simply *is* the top of the
 * page, the header floats in it, and it darkens into the vitrine.
 *
 * So the artwork now sits behind the whole upper page: behind the header,
 * behind the title, behind the search and the series tabs, ending in a fade
 * that reaches the deep navy the figure grid stands on. Nothing draws a box
 * around it, and no element between the header and the grid has a ground of
 * its own.
 *
 * Mounted by the two collector layouts rather than by a page, which is also
 * what makes it survive client navigation: `/` and `/collection` live in
 * different route groups, so anything owned by a page would unmount on the
 * way between them.
 *
 * `aria-hidden`, no pointer events, nothing animated. Absolute rather than
 * fixed: it belongs to the top of the document and scrolls away with it.
 */
/**
 * Which world a page stands in.
 *
 * `portal` is the catalog's: one landmark, composed for a title on its left.
 * `world` is the collection's: the wide SkyIsles view, with no single focus
 * competing with the showcase plate that sits on it. A deliberate, permanent
 * split (ADR-0038, V4) — the two pages do different work and look it.
 */
export type WorldVariant = "portal" | "world";

const ARTWORK: Record<WorldVariant, { src: string; small: string; width: number; height: number }> = {
  portal: {
    src: "/images/brand/skyisles-portal-hero.webp",
    small: "/images/brand/skyisles-portal-hero-sm.webp",
    width: 1920,
    height: 642,
  },
  world: {
    src: "/images/brand/skyisles-backdrop.webp",
    small: "/images/brand/skyisles-backdrop-sm.webp",
    width: 1672,
    height: 941,
  },
};

export function WorldZone({ variant = "portal" }: { variant?: WorldVariant }) {
  const art = ARTWORK[variant];
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[26rem] overflow-hidden md:h-[34rem]"
    >
      {/* The artwork. Anchored right so the portal survives every width; on a
          phone that means the calm left sky is cropped away, which is the
          trade the text needs (V3.2). */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={art.src}
        srcSet={`${art.small} 960w, ${art.src} 1920w`}
        sizes="100vw"
        alt=""
        width={art.width}
        height={art.height}
        decoding="async"
        fetchPriority="high"
        className={
          "absolute inset-0 h-full w-full object-cover " +
          // The portal lives on the right of its artwork and has to survive
          // every width; the wide world has no single subject to protect.
          (variant === "portal" ? "object-right" : "object-center")
        }
      />

      {/* Readability. A wash from the left so the title has calm ground under
          it on desktop; a flat one below `md:`, where the left of the picture
          is off-screen and there is no calm ground to lean on. */}
      <span
        className="absolute inset-0 md:hidden"
        style={{ background: "color-mix(in srgb, var(--canvas) 62%, transparent)" }}
      />
      {/* Local, not global (V3.4). The wash reaches full strength only under
          the text column and is gone by 55 % — the sunset, the islands and
          the portal are the point, and a blanket over all of them was how the
          world came out as flat navy. */}
      <span
        className="absolute inset-0 hidden md:block"
        style={{
          background:
            "linear-gradient(to right, color-mix(in srgb, var(--canvas) 82%, transparent) 0%, " +
            "color-mix(in srgb, var(--canvas) 60%, transparent) 26%, " +
            "color-mix(in srgb, var(--canvas) 22%, transparent) 44%, transparent 58%)",
        }}
      />

      {/* The descent into the vitrine. Three stops rather than two, so the
          picture gets bluer and quieter before it gets darker — and no edge
          is ever visible, because the last stop is the page's own ground. */}
      <span
        className="absolute inset-x-0 bottom-0 h-[58%]"
        style={{
          background:
            "linear-gradient(to bottom, transparent 0%, " +
            "color-mix(in srgb, var(--sky-high) 32%, transparent) 30%, " +
            "color-mix(in srgb, var(--canvas) 66%, transparent) 62%, var(--canvas) 100%)",
        }}
      />
    </div>
  );
}
