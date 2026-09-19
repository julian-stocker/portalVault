/**
 * The Orderbuch's header: two tabs, one small action, one row (0063).
 *
 * WHAT THIS REPLACED, AND WHY
 *
 * Both halves of the Orderbuch opened with a large heading and a full-width
 * primary button — `+ Neuer Einkauf` on one screen, `+ Neuer Verkauf` on the
 * other — and then a tab strip under it. Three lines of chrome before the
 * first number, and the loudest thing on a workbench screen was a button the
 * operator presses a few times a week.
 *
 * Now the tabs ARE the header. `+ Neu` sits at the end of the same row, small,
 * and it means whatever the tab beside it means. There is exactly one creation
 * control on the page; the old ones are gone rather than kept as a second way
 * in, because two buttons doing one thing is how a screen teaches somebody
 * that it has two things.
 *
 * WHY THE LABEL IS NOT THE ACCESSIBLE NAME
 *
 * `+ Neu` is short enough to sit in a tab row and far too short to be read out
 * on its own: a screen reader would announce "plus neu" with nothing to
 * attach it to. So the visible label stays compact and `aria-label`/`title`
 * carry the whole sentence — `Neuen Einkauf anlegen`, `Neuen externen Verkauf
 * anlegen` — which is also what a pointer user sees on hover.
 *
 * WHY IT SOMETIMES IS NOT THERE AT ALL
 *
 * Under `Verkauf → Intern` there is nothing to create. An internal sale exists
 * because an order was paid; `seller_create_sale` refuses the `skyisles`
 * channel outright. A disabled button would advertise a door that is not
 * there, so `newHref` is simply null and the row renders without it.
 */
import Link from "next/link";

import { de } from "@/lib/i18n/de";
import {
  ORDERBOOK_STATUSES, countFor,
  type ClassificationCounts, type OrderbookStatus,
} from "@/lib/orderbook/classification";

const copy = de.business.orderbook;

/**
 * 44 px on a phone, tighter from `sm:` up.
 *
 * The house rule is a 44 px touch target and it is not waived for being
 * compact — a thumb gets the full height, a pointer gets the density. The same
 * trick `ACTION_COMMERCE_COMPACT` uses on the quick-view offer line.
 */
const NEW_ACTION =
  "focus-ring ml-auto inline-flex min-h-11 shrink-0 items-center justify-center gap-1 "
  + "self-center rounded-sky-md px-3 text-sm font-medium ring-1 ring-border/70 "
  + "hover:bg-surface sm:min-h-8";

export function OrderbookNav({ active, newHref, newLabel }: {
  active: "purchase" | "sale";
  /** Null where nothing may be created here — `Verkauf → Intern`. */
  newHref: string | null;
  /** The whole sentence, for the accessible name. Never just `+ Neu`. */
  newLabel: string;
}) {
  const tab = (selected: boolean) =>
    selected
      ? "border-b-2 border-fg px-3 pb-2 text-sm font-medium"
      : "px-3 pb-2 text-sm text-muted hover:text-fg";

  return (
    <div className="mt-3 flex flex-wrap items-end gap-1 border-b border-border/70">
      <div className="flex gap-1" role="tablist">
        {active === "purchase" ? (
          <span role="tab" aria-selected="true" className={tab(true)}>{copy.tabs.purchase}</span>
        ) : (
          <Link href="/business/orderbuch" role="tab" aria-selected="false" className={tab(false)}>
            {copy.tabs.purchase}
          </Link>
        )}
        {active === "sale" ? (
          <span role="tab" aria-selected="true" className={tab(true)}>{copy.tabs.sale}</span>
        ) : (
          <Link href="/business/orderbuch/verkauf" role="tab" aria-selected="false" className={tab(false)}>
            {copy.tabs.sale}
          </Link>
        )}
      </div>

      {newHref ? (
        <Link href={newHref} className={NEW_ACTION} title={newLabel} aria-label={newLabel}>
          {copy.newCompact}
        </Link>
      ) : null}
    </div>
  );
}

/**
 * `Alle · Unvollständig · Test`, with the count each one leads to.
 *
 * THE COUNTS ARE THE POINT. `Alle` deliberately excludes test records, and a
 * list that quietly drops rows is worse than one that never had them. So the
 * Test chip always shows how many there are — including `0` — and the default
 * view says in a sentence underneath where they went when there are any.
 *
 * Both are the same chips the year filter already uses, so the row reads as
 * one more filter rather than a second navigation system.
 */
export function StatusFilter({ status, counts, href, hint }: {
  status: OrderbookStatus;
  counts: ClassificationCounts;
  /** The URL for one classification, with every other filter preserved. */
  href: (status: OrderbookStatus) => string;
  /** Rendered under the chips in the default view when test records exist. */
  hint?: boolean;
}) {
  const label: Record<OrderbookStatus, string> = {
    alle: copy.status.all,
    offen: copy.status.open,
    unvollstaendig: copy.status.incomplete,
    test: copy.status.test,
  };

  return (
    <>
      <nav className="flex flex-wrap gap-1" aria-label={copy.status.label}>
        {ORDERBOOK_STATUSES.map((s) => (
          <Link key={s} href={href(s)} aria-current={status === s ? "page" : undefined}
                className={`rounded-sky-md px-2 py-1 text-xs ring-1 ${
                  status === s ? "bg-surface ring-fg/40" : "ring-border/70 text-muted"}`}>
            {label[s]}
            {/* The number is part of the chip, not a badge floating beside it. */}
            <span className="ml-1 tabular-nums opacity-70">{countFor(counts, s)}</span>
          </Link>
        ))}
      </nav>
      {hint && status === "alle" && counts.test > 0 ? (
        <p className="basis-full text-xs text-muted">{copy.status.hiddenHint(counts.test)}</p>
      ) : null}
    </>
  );
}

/**
 * The marks a ledger row may carry.
 *
 * Inside the first cell rather than in columns of their own: the Einkauf
 * ledger has seven tracks and the Verkauf ledger ten, and adding more for
 * marks that are absent from almost every row would cost every row the
 * width. They are independent of each other — a row may carry all three, and
 * sale 312 on Staging carries two.
 *
 * `Offen` is a small ring, not a warning: nothing is wrong with the record,
 * there is simply a parcel on the desk. Deliberately quieter than `Test`,
 * which changes what a row MEANS, and distinguishable from the filled dot of
 * `Unvollständig` without relying on colour.
 */
export function RowMarks({ isTest, isIncomplete, isOpen = false }: {
  isTest: boolean; isIncomplete: boolean; isOpen?: boolean;
}) {
  if (!isTest && !isIncomplete && !isOpen) return null;
  return (
    <>
      {isTest ? (
        <span title={copy.status.testTitle}
              className="ml-1 rounded-sky-md bg-surface px-1 text-[10px] font-medium uppercase tracking-wide text-muted ring-1 ring-border/70">
          {copy.status.testBadge}
        </span>
      ) : null}
      {isIncomplete ? (
        <span title={copy.status.incompleteTitle} aria-label={copy.status.incompleteBadge}
              className="ml-1 text-xs text-muted">
          ●
        </span>
      ) : null}
      {isOpen ? (
        <span title={copy.status.openTitle} aria-label={copy.status.openBadge}
              className="ml-1 text-xs text-muted">
          ○
        </span>
      ) : null}
    </>
  );
}
