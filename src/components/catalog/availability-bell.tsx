/**
 * The availability bell — visible, and visibly not working yet (UX-01E).
 *
 * WHAT THIS IS AND IS NOT. UX-02 will let a collector ask to be told when a
 * figure becomes buyable again; the chain for it is designed (ADR-0146,
 * ADR-0147) and migrations `0150`/`0151` are written, but they are applied
 * nowhere — `availability_alerts` does not exist on staging or on
 * production, which was checked rather than assumed. So there is nothing to
 * press.
 *
 * The operator asked for the mark to be there anyway, and for it to be
 * unmistakably disabled. That is the honest shape for this moment: the place
 * is taken, the size is final, and nobody is told a lie about what a tap
 * would do.
 *
 *   A DISABLED BUTTON, NOT A DECORATIVE GLYPH. `disabled` is what makes it
 *   non-interactive in every input mode at once — no pointer, no keyboard,
 *   no focus — and it is what a screen reader announces as "dimmed" or
 *   "unavailable" without any aria of its own. A `<span>` dressed to look
 *   grey would look disabled and not be it.
 *
 *   AND IT IS THE SAME 44 px BOX as the info mark and the heart, so UX-02 is
 *   one `disabled` away: no width changes, no layout work, no row geometry to
 *   recompute on the day the alarm starts working. `row-template.ts` already
 *   counts this slot at its full size for exactly that reason.
 *
 * NO QUERY, NO ACTION, NO STATE. This component imports a dictionary and
 * draws a bell. It has no `onClick`, touches no Supabase client, and asks
 * nothing of the server — which a test holds, because "prepare it visibly"
 * is one small step from "wire it up quietly".
 */
import { de } from "@/lib/i18n/de";

/**
 * The same box, the same ground, the same 22 px glyph as `FavoriteHeart` and
 * `InfoLink` — character for character, held against both by a test.
 *
 * Three marks stand side by side in the bar. Two of them drifting apart was
 * already a risk worth a test (UX-01D); three is more so.
 */
const BOX =
  "group/bell pointer-events-auto flex h-11 w-11 items-start justify-end "
  + "focus-visible:outline-none";

const GROUND = "grid place-items-center rounded-full p-1.5 transition-colors duration-150";

const SYMBOL = "block h-[22px] w-[22px]";

/**
 * The bell itself, stroked at 1.5 on a 22-unit grid like the other two.
 *
 * A bell and not a clock or an envelope: the question it will answer is
 * "tell me when", and a bell is the mark every shop uses for it. Drawn here
 * rather than imported, for the reason `element-icon.tsx` gives at length —
 * the project has no icon set, and inventing a family of them is a decision
 * nobody has made.
 */
function BellGlyph() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 22 22"
      className={SYMBOL}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* The hood: a dome on a flat rim. */}
      <path d="M5.5 15.5h11l-1.2-1.8V10a4.3 4.3 0 0 0-8.6 0v3.7L5.5 15.5Z" />
      {/* The clapper. */}
      <path d="M9.4 17.6a1.9 1.9 0 0 0 3.2 0" />
    </svg>
  );
}

export function AvailabilityBell() {
  return (
    <button
      type="button"
      /*
       * THE WHOLE POINT. Not focusable, not clickable, announced as
       * unavailable — and the sentence below says why, rather than leaving
       * someone to guess that a grey bell is broken.
       */
      disabled
      title={de.catalog.alarmPending}
      className={`${BOX} cursor-not-allowed`}
    >
      <span className={`${GROUND} text-muted/45`}>
        <BellGlyph />
      </span>
      {/* `disabled` already says "unavailable"; this says what is coming. */}
      <span className="sr-only">{de.catalog.alarmPending}</span>
    </button>
  );
}
