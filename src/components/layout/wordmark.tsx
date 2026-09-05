/**
 * The SkyIsles mark and wordmark.
 *
 * V4 replaced the "S" tile with the product's own emblem — a floating island
 * with three peaks over an arc of sky, drawn as an SVG in
 * `public/images/brand/skyisles-mark.svg`. It is ours: nothing in it comes
 * from any franchise, and at under a kilobyte it stays sharp at header size.
 *
 * The name is set in the display serif rather than the interface sans. A
 * collector's platform is allowed a little age in its wordmark, and the
 * weight contrast — "Sky" solid, "Isles" lighter — gives it a shape of its
 * own without a second file to download.
 */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`flex items-center gap-2.5 ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/images/brand/skyisles-mark.svg"
        alt=""
        aria-hidden="true"
        width={32}
        height={32}
        className="h-7 w-7 shrink-0 md:h-8 md:w-8"
      />
      <span className="font-display text-[19px] leading-none tracking-tight md:text-[22px]">
        <span className="font-semibold text-on-deep">Sky</span>
        <span className="font-normal text-accent">Isles</span>
      </span>
    </span>
  );
}
