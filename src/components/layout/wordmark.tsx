/**
 * The SkyIsles wordmark.
 *
 * Type only — no image, no icon font, no additional typeface. The system
 * stack does the work; the character comes from weight, tight tracking and a
 * single small amber mark. That mark is the only decorative use of the
 * accent anywhere in the product, which is what keeps it an accent.
 *
 * Deliberately not a fantasy script, a gradient or a glow: the figures are
 * the colourful part of SkyIsles, the frame around them is not.
 */
import { de } from "@/lib/i18n/de";

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`flex items-center gap-2 ${className}`}>
      <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
      <span className="text-base font-semibold tracking-tight">{de.app.name}</span>
    </span>
  );
}
