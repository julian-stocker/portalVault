/**
 * The Orderbuch ledger table (ADR-0088, ADR-0089).
 *
 * ONE TABLE, TWO LEDGERS. Einkauf and Verkauf render through these primitives
 * and through the same two CSS rules — `.ob-row` for a ledger line, `.ob-item`
 * for a line inside an expanded one. There is exactly one answer to "how does
 * an Orderbuch row get its columns", and it is this file.
 *
 * WHY THE COLUMN LIST TRAVELS IN THE HTML
 *
 * The two ledgers need different numbers of columns — seven for a purchase,
 * ten for a sale. The obvious way to say that is a second CSS rule, and it is
 * what the previous Verkauf implementation did: its own `.ob-sale` class, its
 * own `--sale-columns`, its own breakpoint. That is a second layout system by
 * definition, and it failed in the owner's browser while `.ob-row` — the same
 * mechanism, the same stylesheet, the same layer — kept working. A rule that
 * only one of two ledgers depends on is a rule that can go missing for only
 * one of them.
 *
 * So the difference is not a rule. `.ob-row` reads `var(--ob-columns)` with
 * the purchase track list as its FALLBACK, and a ledger that wants different
 * columns sets the property inline, on the container. Einkauf sets nothing and
 * gets exactly the rule it always had. Verkauf's ten tracks arrive as an
 * attribute on the element, in the same response as the markup — there is no
 * second stylesheet rule that has to survive a scan, a cache or a rebuild for
 * the sale table to have columns.
 *
 * THE COLUMNS ARE THE SAME AT EVERY WIDTH
 *
 * They used to collapse to two lines below 48rem. A phone then showed a
 * column of unlabelled fragments instead of a ledger. Now both ledgers keep
 * their real columns and the box scrolls sideways under them, with the first
 * cell stuck to the left edge so a scrolled row still says which row it is.
 * See the `.ob-row` block in `globals.css`.
 */
import type { CSSProperties, ReactNode } from "react";

/** A track list, e.g. `7rem 4rem minmax(6rem, 1fr)`. */
export type Columns = string;

/**
 * The scroll box that holds a whole ledger.
 *
 * Sideways at every width, when the table is wider than the window. Downwards
 * on desktop only: a phone gives the vertical axis back to the page, because
 * a table that swallows the downward swipe is worse than a long page. The
 * axes are in `.ob-scroll`.
 */
export function LedgerTable({ columns, itemColumns, minWidth, children }: {
  columns?: Columns;
  itemColumns?: Columns;
  /** The width the columns actually need, at every viewport. Required. */
  minWidth: string;
  children: ReactNode;
}) {
  const style = {
    ...(columns ? { "--ob-columns": columns } : {}),
    ...(itemColumns ? { "--ob-item-columns": itemColumns } : {}),
    "--ob-min-width": minWidth,
  } as CSSProperties;

  /*
   * `.ob-min` is unconditional now. It used to be rendered only when a ledger
   * passed a width, which meant Einkauf had no floor at all and its seven
   * columns were free to be squeezed to nothing. A ledger without a floor is
   * a ledger that can be crushed, so the floor is not optional.
   */
  return (
    <div className="ob-scroll mt-3 rounded-sky-lg ring-1 ring-border/70" style={style}>
      <div className="ob-min">{children}</div>
    </div>
  );
}

/**
 * The column header, at every width.
 *
 * It used to be desktop-only, on the reasoning that a phone's two-line row
 * labelled itself. The row has real columns on a phone now, and a column you
 * have scrolled three places sideways does not label itself at all — so the
 * header is the thing that makes the scroll readable rather than a line the
 * small screen can spare.
 */
export function LedgerHead({ children }: { children: ReactNode }) {
  return (
    <div className="ob-row sticky top-0 z-10 grid bg-surface text-xs text-muted ring-1 ring-border/60"
         style={{ minHeight: "2rem" }} aria-hidden="true">
      {children}
    </div>
  );
}

/**
 * One ledger line.
 *
 * The grid is on this <div> and the click target is a transparent button
 * stretched across it. Never the other way round: WebKit wraps a button's
 * content in an anonymous box, so `display:grid` on a <button> has
 * historically not laid its children out as grid items at all. The button is
 * absolutely positioned, so it is out of flow and occupies no track.
 */
export function LedgerRow({ children, expanded, controls, label, onToggle }: {
  children: ReactNode;
  expanded: boolean;
  controls: string;
  /** What a screen reader hears on the toggle. */
  label: ReactNode;
  onToggle: () => void;
}) {
  /*
   * OPAQUE, AND A STACKING CONTEXT OF ITS OWN.
   *
   * Opaque because the sticky first cell inherits this background in order to
   * hide the columns sliding under it; `bg-surface/60` would have let them
   * show through. `isolate` because the overlay button has to outrank that
   * sticky cell — without a context of its own, a `z-10` button would also
   * outrank the sticky HEADER and paint over it on a vertical scroll.
   */
  return (
    <div className="ob-row relative isolate bg-surface text-sm hover:bg-surface-raised has-[button:focus-visible]:ring-1 has-[button:focus-visible]:ring-fg/50">
      {children}
      <button type="button" onClick={onToggle}
              aria-expanded={expanded} aria-controls={controls}
              className="absolute inset-0 z-10 h-full w-full cursor-pointer outline-none">
        <span className="sr-only">{label}</span>
      </button>
    </div>
  );
}

/**
 * What opens under a row.
 *
 * A SIBLING of the row, never a child — a grid child would land in one column
 * instead of spanning the table.
 */
export function LedgerExpansion({ id, children }: { id: string; children: ReactNode }) {
  /*
   * `bg-bg/40` stood here and did nothing: there is no `--color-bg` in the
   * theme, so the utility was never generated and the expansion had no
   * background at all. `canvas` is the token that was meant — one step
   * darker than the surface the rows sit on, which is what tells the eye the
   * items belong inside the row above them.
   */
  return (
    <div id={id} className="border-t border-border/50 bg-canvas pb-1">{children}</div>
  );
}

/** The header of an expanded item list, at every width — same as `LedgerHead`. */
export function LedgerItemHead({ children }: { children: ReactNode }) {
  return (
    <div className="ob-item grid bg-canvas text-xs text-muted" style={{ minHeight: "1.75rem" }}>
      {children}
    </div>
  );
}

/**
 * One line inside an expanded row.
 *
 * Carries the background rather than leaving it to the expansion: the sticky
 * `#` cell inherits it, and `inherit` from a transparent parent is still
 * transparent.
 */
export function LedgerItemRow({ children }: { children: ReactNode }) {
  return <li className="ob-item bg-canvas text-sm">{children}</li>;
}
