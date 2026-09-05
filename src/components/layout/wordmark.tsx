/**
 * The SkyIsles wordmark.
 *
 * Type only — no image, no icon font, no additional typeface. The system
 * stack does the work; the character comes from a small monogram tile, weight
 * contrast inside the name and tight tracking.
 *
 * The monogram replaces the bare amber dot the header used to lead with. A
 * dot is not a mark: at 6 px it reads as a bullet point or a notification,
 * and it gave the header the look of an unbranded admin tool. A rounded tile
 * with the initial in it is the smallest thing that reads as a logo, and it
 * still costs no asset and no font.
 *
 * Deliberately not a fantasy script, a gradient or a glow: the figures are
 * the colourful part of SkyIsles, the frame around them is not.
 */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`flex items-center gap-2.5 ${className}`}>
      {/* aria-hidden: the name beside it already says SkyIsles, and a screen
          reader announcing a stray "S" would be noise. */}
      <span
        aria-hidden="true"
        className={
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-sky-sm " +
          "bg-accent text-[13px] leading-none font-bold text-on-accent"
        }
      >
        S
      </span>
      {/* Weight contrast inside one word, so the name has a shape of its own
          without a second typeface. */}
      <span className="text-[17px] leading-none tracking-tight">
        <span className="font-semibold">Sky</span>
        <span className="font-normal">Isles</span>
      </span>
    </span>
  );
}
