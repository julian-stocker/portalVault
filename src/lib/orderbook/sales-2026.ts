/**
 * Reading `Order 2026!K:AP` — the historical Verkauf side (ADR-0089).
 *
 * THE SHEET'S SHAPE, MEASURED
 *
 *     row 1 / row 4   headers, repeated above every one of the 293 orders
 *     K   Datum       Excel serial, FIRST ITEM ROW ONLY
 *     L   header "T"  inventory marker   x | - | r | (leer)
 *     M   header "S"  shipping marker    x | - | r | (leer)
 *     N   Num         running item counter
 *     O   Artikel     item name, free text; 7 rows carry a ZB!B… formula
 *     P   Markt Ez    LIVE reference into a stock sheet — the identity
 *     Q   Markt G     SUM(P…) of the order
 *     R   Buy In      Q × $I$2, the global Einkauf factor
 *     T   EU          destination country, ISO 3166-1 alpha-2
 *     U…AE            the money, order level
 *     AG  Buyer       marketplace handle
 *
 * THE COLUMN LETTERS AND THE HEADERS DISAGREE, DANGEROUSLY.
 *
 * The columns HEADED `T` and `S` are worksheet columns **L** and **M**.
 * Worksheet column **T** is `EU`, the country. Reading "column T" as the
 * inventory marker would silently file countries as shipping flags, so every
 * name here is the worksheet letter and every comment says which header it
 * carries.
 *
 * 1 256 item rows · 293 orders · 2026-01-01 … 2028-06-28 (one typo) · no
 * merged cells.
 */

/** One worksheet row of the sales area. */
export type SalesRow = {
  row: number;
  /** K — Excel serial, only on an order's first row. */
  k: string;
  /** L, header `T` — the inventory marker. Provenance only. */
  stockFlag: string;
  /** M, header `S` — the shipping marker. Provenance only. */
  shippedFlag: string;
  /** O — what the owner typed. */
  artikel: string;
  /** Formula behind O, when the name itself is a reference (7 rows). */
  artikelFormula: string;
  /** Formula behind P — the identity. Empty on 242 rows. */
  marketFormula: string;
  /** Cached P value. A price, which cannot name a figure. */
  marketValue: string;
  /** Order-level money, present only on the first row of an order. */
  money: Record<string, string>;
  /** AG. */
  buyer: string;
};

/** The order-level columns, by worksheet letter. */
export const MONEY_COLUMNS = ["Q","R","T","U","V","W","X","Y","Z","AA","AB","AC","AD","AE"] as const;

/** `Order 2026!K:AP` from worksheet XML. */
export function parseSalesSheet(xml: string, shared: readonly string[]): SalesRow[] {
  const unescape = (t: string): string =>
    t.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, c: string) => String.fromCodePoint(Number(c)))
      .replace(/&amp;/g, "&");

  const out: SalesRow[] = [];

  // Two alternatives, never `[^>]*(?:\/>|>…)` — see parseOrderSheet: a greedy
  // `[^>]*` eats the `/` of a self-closing tag and swallows the next cells.
  for (const rowXml of xml.match(/<row\b[^>]*\/>|<row\b[^>]*>[\s\S]*?<\/row>/g) ?? []) {
    const row = Number(/\br="(\d+)"/.exec(rowXml)?.[1] ?? 0);
    if (row < 5) continue;

    const value: Record<string, string> = {};
    const formula: Record<string, string> = {};

    for (const cell of rowXml.match(/<c\b[^>]*\/>|<c\b[^>]*>[\s\S]*?<\/c>/g) ?? []) {
      const column = /r="([A-Z]+)\d+"/.exec(cell)?.[1];
      if (!column) continue;
      const f = /<f[^>]*>([\s\S]*?)<\/f>/.exec(cell)?.[1];
      if (f) formula[column] = unescape(f);
      const type = /\bt="([^"]+)"/.exec(cell)?.[1];
      if (type === "inlineStr") {
        value[column] = unescape((cell.match(/<t[^>]*>([\s\S]*?)<\/t>/g) ?? [])
          .map((t) => t.replace(/<[^>]+>/g, "")).join(""));
        continue;
      }
      const raw = /<v>([\s\S]*?)<\/v>/.exec(cell)?.[1];
      if (raw === undefined) continue;
      value[column] = type === "s" ? (shared[Number(raw)] ?? "") : unescape(raw);
    }

    const artikel = value.O ?? "";
    // A repeated header block, not a sale.
    if (artikel === "" || artikel === "Artikel" || value.K === "Datum") continue;

    const money: Record<string, string> = {};
    for (const column of MONEY_COLUMNS) money[column] = value[column] ?? "";

    out.push({
      row, k: value.K ?? "",
      stockFlag: value.L ?? "", shippedFlag: value.M ?? "",
      artikel, artikelFormula: formula.O ?? "",
      marketFormula: formula.P ?? "", marketValue: value.P ?? "",
      money, buyer: value.AG ?? "",
      // `AE` carries a formula on all 293 order rows, which is how an order's
      // first row is recognised — see groupSales.
      ...({} as Record<string, never>),
    });
    // Remember whether this row opened an order. Stored out-of-band so the
    // public shape stays flat.
    ORDER_ROWS.set(row, formula.AE !== undefined);
  }

  return out;
}

/** Which rows carried the order-level `AE` formula. */
const ORDER_ROWS = new Map<number, boolean>();

export type SaleGroup = {
  /** The order's first item row — its identity in the workbook. */
  headerRow: number;
  firstRow: number;
  lastRow: number;
  /** ISO date, or null when the workbook's own value is not a date. */
  date: string | null;
  rawDate: string;
  country: string;
  buyer: string;
  money: Record<string, number>;
  items: SalesRow[];
};

/** Excel serial to ISO, 1900 epoch. Anything else is not a date. */
export function salesSerialToIso(serial: string): string | null {
  const n = Number(serial);
  if (!Number.isFinite(n) || n < 10000 || n > 100000) return null;
  return new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10);
}

const money = (raw: string): number => {
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Split the sales area into orders.
 *
 * An order opens where the order-level `AE` formula sits — on all 293 of them,
 * one shape, and the only marker that is present on every order and on no item
 * row. Not the date: four orders have a typo where their date should be, and
 * one of those is empty.
 */
export function groupSales(rows: readonly SalesRow[]): SaleGroup[] {
  const starts = rows.filter((r) => ORDER_ROWS.get(r.row) === true).map((r) => r.row);
  const byRow = new Map(rows.map((r) => [r.row, r]));
  const maxRow = rows.length ? Math.max(...rows.map((r) => r.row)) : 0;

  return starts.map((headerRow, index) => {
    const lastRow = (index + 1 < starts.length ? starts[index + 1] : maxRow + 1) - 1;
    const head = byRow.get(headerRow)!;
    const items = rows.filter((r) => r.row >= headerRow && r.row <= lastRow);
    const amounts: Record<string, number> = {};
    for (const column of MONEY_COLUMNS) amounts[column] = money(head.money[column] ?? "");
    return {
      headerRow, firstRow: headerRow, lastRow,
      date: salesSerialToIso(head.k), rawDate: head.k,
      country: head.money.T ?? "", buyer: head.buyer,
      money: amounts, items,
    };
  });
}

/**
 * Is this group a sale at all?
 *
 * One group is not: `Korrektur >` has `Summe` 0,00 and its −5,19 € is entirely
 * a shipping label with nothing sold behind it. Its buyer has three real
 * orders and the workbook links it to none of them, so it becomes a standalone
 * settlement adjustment rather than a sale with no sale in it.
 */
export function isStandaloneCorrection(group: SaleGroup): boolean {
  return group.money.U === 0 && group.money.V === 0 && group.money.AE < 0;
}

/** What the channel should settle, from the workbook's own components. */
export function workbookExpectedPayout(m: Record<string, number>): number {
  return m.U + m.V - m.W - m.AD - (m.X + m.AA + m.Y) + m.AB;
}
