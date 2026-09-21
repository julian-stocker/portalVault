/**
 * Reading a worksheet as a grid of cells, values and formulas alike.
 *
 * `sheet-rows.ts` reads the two columns the inventory importer needs and is
 * right to. The order sheets need arbitrary columns, the formula behind a
 * cell — which is the figure's identity (ADR-0088) — and the difference
 * between "empty" and "absent". So this reads everything and decides nothing.
 *
 * THE REGEXES BELOW HAVE THE EMPTY-ELEMENT ALTERNATIVE FIRST, AND THAT IS NOT
 * A STYLE CHOICE.
 *
 * Written the tidier way, `<c\b[^>]*(?:\/>|>[\s\S]*?<\/c>)`, the greedy
 * `[^>]*` consumes the `/` of `<c r="D4" s="6"/>`; the `/>` branch then has
 * nothing left to match, the `>` branch matches instead, and the match runs
 * on until the NEXT cell's `</c>`. Every empty cell silently swallows its
 * neighbour.
 *
 * That is not theoretical. It cost the header cell `K4` of `Order 2026`,
 * which cost the first sale group its date, which cost fifty dated 2026 sales
 * their place in the history — they landed in the opening balance instead,
 * and the totals still looked plausible. Two alternatives, empty one first.
 */

export type Cell = {
  /** The cached value, shared strings already resolved. */
  value: string;
  /** The formula without its leading `=`, or "" when the cell holds none. */
  formula: string;
};

export type CellGrid = Map<number, Map<string, Cell>>;

const ROW_PATTERN = /<row\b[^>]*\/>|<row\b[^>]*>[\s\S]*?<\/row>/g;
const CELL_PATTERN = /<c\b[^>]*\/>|<c\b[^>]*>[\s\S]*?<\/c>/g;

export function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** One worksheet's XML as row number → column letter → cell. */
export function readCellGrid(xml: string, shared: readonly string[]): CellGrid {
  const grid: CellGrid = new Map();

  for (const rowXml of xml.match(ROW_PATTERN) ?? []) {
    const rowNumber = Number(/\br="(\d+)"/.exec(rowXml)?.[1] ?? 0);
    if (!rowNumber) continue;

    const cells = new Map<string, Cell>();
    for (const cellXml of rowXml.match(CELL_PATTERN) ?? []) {
      const reference = /\br="([A-Z]+\d+)"/.exec(cellXml)?.[1];
      if (!reference) continue;
      const type = /\bt="([^"]*)"/.exec(cellXml)?.[1] ?? "n";
      const raw = /<v>([\s\S]*?)<\/v>/.exec(cellXml)?.[1] ?? "";
      const inline = /<is><t[^>]*>([\s\S]*?)<\/t><\/is>/.exec(cellXml)?.[1] ?? "";
      const value = type === "s" ? (shared[Number(raw)] ?? "")
        : type === "inlineStr" ? inline
        : raw;
      cells.set(/^[A-Z]+/.exec(reference)![0], {
        value: unescapeXml(value),
        formula: unescapeXml(/<f[^>]*>([\s\S]*?)<\/f>/.exec(cellXml)?.[1] ?? ""),
      });
    }
    grid.set(rowNumber, cells);
  }

  return grid;
}

/** A cell that may not exist, without the caller checking twice. */
export function cellAt(grid: CellGrid, row: number, column: string): Cell {
  return grid.get(row)?.get(column) ?? { value: "", formula: "" };
}
