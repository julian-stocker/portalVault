/**
 * The basket outline, shared by the header badge and the card's buy action.
 *
 * Extracted so the two cannot drift into two different baskets. Decorative
 * everywhere it is used: the label beside it, or the button's accessible
 * name, carries the meaning.
 */
export function CartGlyph({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={`shrink-0 ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 6h18l-1.8 9.6a2 2 0 0 1-2 1.6H6.8a2 2 0 0 1-2-1.6L3 6Z" />
      <path d="M8.5 6 10 2.75M15.5 6 14 2.75" />
      <circle cx="9" cy="20.25" r="1.25" />
      <circle cx="16" cy="20.25" r="1.25" />
    </svg>
  );
}
