/**
 * The shape of the two Orderbuch creation forms.
 *
 * WHY THIS EXISTS
 *
 * Einkauf and Verkauf both grew their own `Row` and their own `Heading`, and
 * then drifted: one put the label above the field and the other beside it,
 * one spaced its groups with `gap-3` and the other with `gap-4`, and neither
 * grouped anything on a phone. Two forms that do the same job should not be
 * two layout systems — the same reasoning that put both ledgers behind
 * `ledger-table.tsx`.
 *
 * WHAT A GROUP IS FOR
 *
 * A heading and the fields under it, with a rule above. It replaces the
 * explanatory sentences the forms used to carry: `Beträge` over three money
 * inputs says what four lines of prose said, and says it in a place the eye
 * reaches first.
 *
 * NO CARD INSIDE A CARD. A group is a heading and a gap, never a panel with
 * its own ring and padding — on a 360px screen nested panels cost most of the
 * width in borders. The only boxed thing in either form is the payout, which
 * is boxed because it is the answer rather than a question.
 *
 * ONE COLUMN ON A PHONE, ALWAYS. Every grid here starts single-column and
 * only splits at `sm:`. Money inputs are the exception that proves it: they
 * are narrow by nature, so they may sit two or three abreast once there is
 * room, and never before.
 */
import type { ReactNode } from "react";

/**
 * A field control: full width, 44px tall, thumb-sized on a phone.
 *
 * `sm:min-h-9` is the desktop half of that sentence. A mouse does not need a
 * 44px target, and eight pixels per field is most of what makes these two
 * forms long enough to scroll. The phone keeps the big one — which is why the
 * shrink is behind the breakpoint and never the other way round.
 */
export const INPUT =
  "min-h-11 w-full rounded-sky-md bg-surface px-3 text-sm ring-1 ring-border/70 sm:min-h-9";

/** The same, for an amount. Right-aligned, lining figures, never wrapped. */
export const MONEY = `ob-money ${INPUT} text-right tabular-nums`;

/**
 * One group: a heading, a hairline, and its fields.
 *
 * `title` is a real `<h2>`, so the form is navigable by heading rather than
 * being one long undifferentiated run of labels.
 */
export function FormSection({ title, children }: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2 sm:gap-1.5">
      <h2 className="border-b border-border/60 pb-1 text-xs font-medium uppercase tracking-wide text-muted">
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * One labelled field.
 *
 * The label is above the control at every width. Beside it would be shorter
 * on a desktop and unusable on a phone, and a form that changes its own
 * anatomy at a breakpoint is a form with two sets of bugs.
 */
export function Field({ label, hint, children }: {
  label: string;
  /** Only where the control cannot speak for itself. Usually omitted. */
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1 sm:gap-0.5">
      <span className="text-xs text-muted">{label}</span>
      {children}
      {hint ? <span className="text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

/**
 * Fields that belong side by side once there is room.
 *
 * `min-w-0` on the children is what stops a long value from pushing the grid
 * wider than the screen: a grid item's default `min-width: auto` refuses to
 * shrink below its content, which is the usual cause of a form that scrolls
 * sideways on a phone.
 */
export function FieldRow({ columns = 2, children }: {
  /** How many columns at `sm:` and up. One below it, always. */
  columns?: 2 | 3;
  children: ReactNode;
}) {
  return (
    <div className={`grid grid-cols-1 gap-3 sm:gap-2 ${columns === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
      {children}
    </div>
  );
}

/**
 * The quiet half of a form: things that are usually left alone.
 *
 * Not hidden behind a disclosure — an optional field nobody can see is a
 * field nobody fills in. Just set back: smaller, muted, below the fields that
 * matter.
 */
export function QuietRow({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-2">{children}</div>;
}
