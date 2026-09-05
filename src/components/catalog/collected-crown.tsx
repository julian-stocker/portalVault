/**
 * The collector's seal.
 *
 * A small gold crown on a dark disc, top right of the picture, on catalog
 * cards for figures that are already in the collection (ADR-0038, V4). It
 * replaces nothing: `aria-pressed` on the card and the `sr-only` state text
 * still carry the meaning, and this badge is `aria-hidden` because saying
 * "in your collection" twice to a screen reader helps nobody.
 *
 * Deliberately not an emoji — an emoji crown renders as a different picture
 * on every platform and would be the only such glyph in the product. Six
 * paths, no file, sharp at any size.
 *
 * Never appears in `/collection`: everything there is owned, so a seal on
 * every card would seal nothing.
 */
export function CollectedCrown() {
  return (
    <span
      aria-hidden="true"
      className={
        "absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-full " +
        "bg-[#2a1d0d] ring-1 ring-[#f0c073] " +
        "shadow-[0_0_0_2px_rgb(42_29_13/0.55),0_0_14px_2px_rgb(233_183_104/0.55)]"
      }
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none">
        <defs>
          <linearGradient id="crown-gold" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffe9ba" />
            <stop offset="55%" stopColor="#e0a44a" />
            <stop offset="100%" stopColor="#b07f26" />
          </linearGradient>
        </defs>
        {/* Three points, a band, and two stones on the band. */}
        <path
          d="M4 16.5 3 7.5l5 3.5L12 5l4 6 5-3.5-1 9z"
          fill="url(#crown-gold)"
          stroke="#8a5f1c"
          strokeWidth="0.9"
          strokeLinejoin="round"
        />
        <path
          d="M4.2 17.6h15.6"
          stroke="url(#crown-gold)"
          strokeWidth="2.1"
          strokeLinecap="round"
        />
        <circle cx="8.4" cy="14.2" r="0.85" fill="#fff3dc" opacity="0.9" />
        <circle cx="15.6" cy="14.2" r="0.85" fill="#fff3dc" opacity="0.9" />
      </svg>
    </span>
  );
}
