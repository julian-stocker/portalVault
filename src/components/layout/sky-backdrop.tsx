/**
 * The collector surface.
 *
 * V3.1 hung the full world artwork behind every page, and the report for it
 * conceded the result: text over sunlit clouds, cards floating on a busy
 * landscape, the collection's own numbers competing with a portal. A picture
 * used as wallpaper does not become a design — the interface just sits on top
 * of it.
 *
 * So the world is now bounded. It belongs to the hero band at the top of a
 * page (`CatalogHero`) and to the pages that are nothing but atmosphere
 * (`WorldBackdrop`, used by the sign-in screens). Everything below that is
 * this: a quiet deep-navy vitrine for the figures to stand in.
 *
 * Fixed, `aria-hidden`, no pointer events, nothing animated.
 */
export function SkyBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* The ground. Slightly lighter at the top, where the hero band ends,
          so the page still reads as having a sky above it. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(to bottom, " +
            "color-mix(in srgb, var(--sky-mid) 45%, var(--canvas)) 0%, " +
            "var(--canvas) 34%, var(--canvas) 100%)",
        }}
      />
      {/* One very soft warm bloom, low and to one side. Enough that the
          surface is not a flat rectangle, far short of a landscape. */}
      <div
        className="absolute inset-0 opacity-60"
        style={{
          background:
            "radial-gradient(90% 40% at 78% 6%, rgb(224 164 74 / 0.10) 0%, transparent 62%)",
        }}
      />
    </div>
  );
}

/**
 * The full SkyIsles world.
 *
 * Kept for the pages that are pure atmosphere — sign in, register, password
 * reset — where there is one small panel and nothing to compete with the
 * view. The catalog and the collection deliberately do not use it any more.
 */
export function WorldBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(to bottom, var(--sky-high) 0%, var(--sky-mid) 26%, " +
            "var(--sky-horizon) 48%, var(--sky-deep) 72%)",
        }}
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/images/brand/skyisles-backdrop.webp"
        srcSet={
          "/images/brand/skyisles-backdrop-sm.webp 900w, " +
          "/images/brand/skyisles-backdrop.webp 1672w"
        }
        sizes="100vw"
        alt=""
        width={1672}
        height={941}
        decoding="async"
        className="absolute inset-0 h-full w-full object-cover object-top"
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(to bottom, " +
            "color-mix(in srgb, var(--sky-high) 55%, transparent) 0%, " +
            "color-mix(in srgb, var(--canvas) 35%, transparent) 55%, " +
            "color-mix(in srgb, var(--canvas) 80%, transparent) 100%)",
        }}
      />
    </div>
  );
}
