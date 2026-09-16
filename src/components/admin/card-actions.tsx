/**
 * What an administrator can do to a figure from the catalogue itself (V3.8).
 *
 * ONE ACTION, AND IT OPENS THE EDITOR.
 *
 * Until V3.8 this row carried three things stacked on top of each other: a
 * show/hide button, a "Details" link and, when a write failed, an error line.
 * They did not fit. The trade row is 9.05 % of the card's height — 29 px on a
 * two-column phone — and `ACTION_CARD` alone is 40 px, so the button was
 * clipped and the link below it was invisible. Three controls were being put
 * where the public card puts one.
 *
 * So there is one control now, in the same box the public offer line uses,
 * and it opens a dialog that holds all five editable fields — visibility
 * included. Hiding a figure is a decision, and a decision belongs in the
 * place where you can see what you are deciding about, not under a thumb
 * scrolling a grid (ADR-0042 said the same thing about tapping the card).
 *
 * NEUTRAL, ON PURPOSE. Gold means possession, silver means trade, amber means
 * a purchase. Editing is none of those: it is an action on the interface, so
 * it takes the neutral card action and says what it does.
 *
 * It is not a permission either. The dialog's writes call server actions that
 * call database functions that ask `is_shop_admin()` themselves; this decides
 * what a button looks like.
 */
"use client";

import { de } from "@/lib/i18n/de";

export function AdminEditAction({
  name,
  onEdit,
}: {
  /** Named for a screen reader: a grid of these is otherwise 561 "Bearbeiten". */
  name: string;
  onEdit: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onEdit}
      aria-label={de.admin.editFigure(name)}
      /*
       * The same box as `OfferLink`: `h-full w-full`, no minimum height, and
       * type that scales with the card. The row IS the target — full width
       * inside the trade inset — and giving this one a `min-h` would push it
       * out of a row whose height is fixed by the artwork.
       */
      className={
        "focus-ring flex h-full w-full items-center justify-center gap-1 rounded-sky-sm " +
        "whitespace-nowrap px-1.5 sm:px-2 " +
        "text-[clamp(9px,4.8cqw,11px)] leading-none font-semibold " +
        "transition-opacity hover:opacity-75 active:opacity-60"
      }
      style={{ color: INK_EDIT }}
    >
      <span>{de.admin.edit}</span>
      <span aria-hidden="true" className="shrink-0 text-[13px] leading-none">
        ›
      </span>
    </button>
  );
}

/**
 * The ink, inline for the reason `offer-link.tsx` records: a class only paints
 * if its rule arrives, and the card falls back to the page's near-white when
 * none does. An inline style carries the value itself.
 *
 * The same near-black the buyable offer uses, because both sit on the card's
 * own printed surface and the surface decides what is legible — not what the
 * action means. What the action MEANS is carried by the word.
 */
const INK_EDIT = "var(--trade-ink, #11161c)";

/** The chip that marks a figure the public catalog no longer shows. */
export function HiddenBadge() {
  return (
    <span
      className={
        "absolute top-2 left-2 rounded-full bg-[#3b2a17]/90 px-2 py-0.5 text-[11px] " +
        "leading-none font-medium text-[#f6d9a8] ring-1 ring-[#f0c073]/40"
      }
    >
      {de.admin.hiddenBadge}
    </span>
  );
}
