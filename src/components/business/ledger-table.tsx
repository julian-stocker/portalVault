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
 * The property is only read inside the desktop media query, so both ledgers
 * still collapse to the same two-line mobile layout.
 */
import type { CSSProperties, ReactNode } from "react";

/** A track list, e.g. `7rem 4rem minmax(6rem, 1fr)`. */
export type Columns = string;

/**
 * The scroll box that holds a whole ledger.
 *
 * Scrolls in both directions: down through a long year, and sideways when a
 * wide table does not fit. Only this element scrolls — the page never does.
 */
export function LedgerTable({ columns, itemColumns, minWidth, children }: {
  columns?: Columns;
  itemColumns?: Columns;
  /** Desktop-only floor, so wide tables scroll instead of being crushed. */
  minWidth?: string;
  children: ReactNode;
}) {
  const style = {
    maxHeight: "min(62dvh, 42rem)",
    ...(columns ? { "--ob-columns": columns } : {}),
    ...(itemColumns ? { "--ob-item-columns": itemColumns } : {}),
    ...(minWidth ? { "--ob-min-width": minWidth } : {}),
  } as CSSProperties;

  return (
    <div className="mt-3 overflow-auto rounded-sky-lg ring-1 ring-border/70" style={style}>
      {minWidth ? <div className="ob-min">{children}</div> : children}
    </div>
  );
}

/**
 * The column header. Desktop only — on a phone the values label themselves
 * and a header would only cost a line.
 */
export function LedgerHead({ children }: { children: ReactNode }) {
  return (
    <div className="ob-row sticky top-0 z-10 hidden bg-surface text-xs text-muted ring-1 ring-border/60 md:grid"
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
  return (
    <div className="ob-row relative bg-surface/60 text-sm hover:bg-surface has-[button:focus-visible]:ring-1 has-[button:focus-visible]:ring-fg/50">
      {children}
      <button type="button" onClick={onToggle}
              aria-expanded={expanded} aria-controls={controls}
              className="absolute inset-0 h-full w-full cursor-pointer outline-none">
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
  return (
    <div id={id} className="border-t border-border/50 bg-bg/40 pb-1">{children}</div>
  );
}

/** The header of an expanded item list. Desktop only, same as `LedgerHead`. */
export function LedgerItemHead({ children }: { children: ReactNode }) {
  return (
    <div className="ob-item hidden text-xs text-muted md:grid" style={{ minHeight: "1.75rem" }}>
      {children}
    </div>
  );
}

/** One line inside an expanded row. */
export function LedgerItemRow({ children }: { children: ReactNode }) {
  return <li className="ob-item text-sm">{children}</li>;
}
