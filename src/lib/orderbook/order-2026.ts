/**
 * Reading `Order 2026!A:I` — the historical purchase side (ADR-0088).
 *
 * Pure parsing and classification over cells already extracted from the
 * workbook. The selective ZIP reader in `src/lib/import/xlsx-reader.ts` does
 * the getting; this does the understanding.
 *
 * THE SHEET'S SHAPE, MEASURED
 *
 *     row 1     German headers        row 2   grand totals
 *     row 4     English headers, repeated at the top of every group
 *     A         purchase date, Excel serial, FIRST ITEM ROW ONLY
 *     B         Ausgaben, first item row only
 *     C         x | b | -             b = beschädigt
 *     D         x | -                 the old sheet's own "entered into stock"
 *     E         running item number
 *     F         item name, free text and often shorthand
 *     G         market value — a LIVE formula into a stock sheet
 *     H, I      group market sum and factor, first item row only
 *
 * 85 groups, 2193 item rows, 2025-12-06 to 2026-08-17. Column J is empty in
 * all 2754 rows — a visual gutter. K:AE is the future Verkauf area and is not
 * read here.
 *
 * THE FORMULA IS THE IDENTITY, NOT THE NAME.
 *
 * `F` is what the owner typed: `Bob`, `Mini Elf`, `Trigger Snappy`. `G` is
 * `=T!I74`, a reference to a row of the Trap Team stock sheet — whose column B
 * holds `Mini Bop`, `Mini Whisper Elf`, `Mini Trigger Snappy`. The shorthand
 * matches nothing; the reference matches exactly. So the formula is read first
 * and the free text is kept only as provenance.
 *
 * That one decision moves the pilot group from fourteen unmatched names to
 * fourteen exact matches, and it is why `resolveByFormula` exists at all.
 */

/** The stock sheets a purchase row may point at. */
export const STOCK_SHEETS = ["SA", "G", "SF", "T", "SC", "I", "ZB"] as const;

export type RawRow = {
  row: number;
  a: string; b: string; c: string; d: string;
  e: string; f: string;
  /** Cached value of G. */
  g: string;
  /** Formula behind G, without the leading `=`. */
  gFormula: string;
  h: string; i: string;
};

export type PurchaseGroup = {
  /** Worksheet row of the `Date` header that opens the group. */
  headerRow: number;
  firstRow: number;
  lastRow: number;
  /** ISO date, or null when the workbook's own formula is broken. */
  date: string | null;
  rawDate: string;
  totalCost: number | null;
  items: RawRow[];
};

/** Excel serial to ISO, with Excel's 1900 epoch. */
export function serialToIso(serial: string): string | null {
  const n = Number(serial);
  if (!Number.isFinite(n) || n < 10000 || n > 100000) return null;
  return new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10);
}

/**
 * Split the sheet into purchase groups.
 *
 * A group opens at a row whose column A reads `Date` — the English header the
 * owner repeats above every purchase — and runs to the row before the next one.
 * The group boundary IS the purchase boundary: two parcels bought on the same
 * day are two groups and stay two purchases.
 */
export function groupRows(rows: readonly RawRow[]): PurchaseGroup[] {
  const headers = rows.filter((r) => r.a === "Date").map((r) => r.row);
  const byRow = new Map(rows.map((r) => [r.row, r]));
  const maxRow = rows.length ? Math.max(...rows.map((r) => r.row)) : 0;

  return headers.map((headerRow, index) => {
    const firstRow = headerRow + 1;
    const lastRow = (index + 1 < headers.length ? headers[index + 1] : maxRow + 1) - 1;
    const items: RawRow[] = [];
    for (let r = firstRow; r <= lastRow; r += 1) {
      const row = byRow.get(r);
      if (row && row.f !== "") items.push(row);
    }
    const head = byRow.get(firstRow);
    return {
      headerRow, firstRow, lastRow,
      date: head ? serialToIso(head.a) : null,
      rawDate: head?.a ?? "",
      totalCost: head && head.b !== "" ? Number(head.b) : null,
      items,
    };
  });
}

/** `T!I74` → `{ sheet: "T", row: 74 }`. Anything else is not a reference. */
export function resolveByFormula(formula: string): { sheet: string; row: number } | null {
  const match = formula.replace(/^=/, "").match(/^'?([A-Za-z ]+)'?!\$?I\$?(\d+)$/);
  if (!match) return null;
  const sheet = match[1].trim();
  if (!(STOCK_SHEETS as readonly string[]).includes(sheet)) return null;
  return { sheet, row: Number(match[2]) };
}

export type Classification =
  | "matched"
  | "ambiguous"
  | "unmatched"
  | "uncategorized"
  | "invalid"
  /**
   * A damaged row. Deliberately excluded from the migration — it never becomes
   * a `purchase_item` at all. Kept as a classification so the preview can
   * account for every source row instead of quietly losing some.
   */
  | "ignored_damaged";

/*
 * `conflict` USED TO LIVE HERE and no longer can.
 *
 * It fired when a saved mapping named a different figure than the formula, and
 * it stopped the row for review. The owner has since settled the question: a
 * valid `G` reference IS the identity, and the free text in `F` — or anything
 * remembered from it — never overrides it. So the disagreement is not a
 * conflict; the formula simply wins and the mapping is not consulted. With
 * nothing left to surface the state became unreachable, and an unreachable
 * state is worse than no state: it reads as a guard that is still watching.
 */

/** Where a resolution came from, strongest first. */
export type Evidence = "formula" | "mapping" | "name" | "none";

export type ClassifiedItem = {
  sourceRow: number;
  position: number;
  rawName: string;
  legacyConditionFlag: string;
  legacyBookedFlag: string;
  /** The stock-sheet name the G formula points at, when it does. */
  resolvedName: string | null;
  sheet: string | null;
  classification: Classification;
  skyId: string | null;
  /** Which kind of evidence decided it. */
  evidence: Evidence;
  note: string | null;
};

export type CatalogEntry = { skyId: string; name: string; series: string };

/**
 * The workbook's damage markers.
 *
 * Three signals, and ANY ONE of them is enough. The sheet was kept by hand over
 * years and they are not used together: measured across all 2 194 item rows,
 * 8 rows carry `C = b` with no suffix in the name and 7 carry a suffix with
 * `C` unset or `x`. Requiring agreement would miss fifteen damaged rows.
 *
 * `(D)` is a damage marker, NOT "Dark" and not a series or variant. The owner
 * confirmed this; the workbook corroborates it only indirectly — all four `(D)`
 * rows carry `G = '-'` and no formula, the exact signature of the `(B)` rows,
 * while their `C`/`D` columns say `x`/`x` and record nothing about damage.
 *
 * The pattern matches a parenthesised single letter, so `Blast Zone (Dark)` and
 * `0000502 (G)` are untouched. It looks anywhere in the name because that is
 * how the rule was given; in this workbook all 71 occurrences sit at the end,
 * so the two readings cannot differ on real data.
 */
export const LEGACY_DAMAGE_MARKER = /\(\s*[BbDd]\s*\)/;

/**
 * Where a reference points, when the question is WHERE and not WHAT.
 *
 * `resolveByFormula` answers "which stock row is this figure?" and therefore
 * only accepts the six game sheets plus `ZB`. These three rules need the
 * opposite question — "is this destination a figure at all?" — which is
 * answered by the sheet name alone, before any row is read.
 */
export function referencedSheet(formula: string): string | null {
  const match = formula.replace(/^=/, "").match(/^'?([A-Za-z0-9 ]+)'?!\$?[A-Z]+\$?\d+$/);
  return match ? match[1].trim() : null;
}

/** `Doom Stone - UNTERTEIL`, `Blast Zone - OBERTEIL`. */
export const SWAP_FORCE_HALF = /\s-\s*(OBERTEIL|UNTERTEIL)\s*$/i;

/** Why a row is deliberately not a figure. Null means "this could be one". */
export type NonFigureReason = "disney_infinity" | "accessory" | "swap_force_half";

/**
 * The three destinations that are never a SkyIsles figure.
 *
 * ALL THREE ARE THE FORMULA DECIDING, NOT A NEW KIND OF EVIDENCE. The owner's
 * reference already names the destination exactly; these rules only read what
 * it says. Nothing here looks at the free text in `F`, and nothing here can
 * overturn a reference that lands on a real catalog figure.
 *
 *   `DI A`        the workbook's own Disney Infinity sheet. 153 rows and 99
 *                 identities in 2026 alone — a rule, not 99 decisions.
 *   `ZB`          `Zubehör`: portals, cables, bags, article numbers. Organised
 *                 by console inside the sheet, which is why `0000502 (G)` is a
 *                 Giants-era PORTAL and not a Giants figure.
 *   `- OBERTEIL`  a Swap Force half. The catalog deliberately has no row for
 *   `- UNTERTEIL` one (`IGNORED_SWAP_FORCE_HALF`), and mapping the half to the
 *                 whole character would claim a figure the parcel did not
 *                 contain. New in 2026: the owner writes these `(U)` and `(O)`,
 *                 which are NOT damage markers — only `(B)` and `(D)` are.
 *
 * What each becomes: an item with no `sky_id`, its raw name kept, its cost kept
 * in the purchase, no series, and no path into figure inventory.
 */
export function nonFigureByReference(
  formula: string,
  resolvedName: string | null,
): NonFigureReason | null {
  const sheet = referencedSheet(formula);
  if (sheet === "DI A") return "disney_infinity";
  if (sheet === "ZB") return "accessory";
  if (resolvedName !== null && SWAP_FORCE_HALF.test(resolvedName)) return "swap_force_half";
  return null;
}

const NON_FIGURE_NOTE: Record<NonFigureReason, string> = {
  disney_infinity: "Disney Infinity — keine SkyIsles-Figur",
  accessory: "Zubehör/Portal — keine SkyIsles-Figur",
  swap_force_half: "Swap-Force-Hälfte — keine SkyIsles-Figur",
};

/** Is this row one of the damaged copies the owner discarded? */
export function isLegacyDamaged(raw: Pick<RawRow, "c" | "f">): boolean {
  return raw.c.trim().toLowerCase() === "b" || LEGACY_DAMAGE_MARKER.test(raw.f);
}

/** Loose comparison for the stock-sheet name, mirroring the inventory importer. */
export function normalise(name: string): string {
  return name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/&/g, "and").replace(/['’`´]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Decide what one purchase row is.
 *
 * DAMAGED IS ASKED FIRST AND ANSWERS EVERYTHING. A damaged copy is not part of
 * the SkyIsles dataset: it was thrown away years ago, it will never be sold,
 * and carrying it would mean a figure identity, a market value and an operator
 * decision for an object that does not exist. It is dropped before any
 * resolution is attempted — including when its `G` formula would have resolved
 * perfectly well.
 *
 * (The order matters only in principle here: no row in the workbook is both an
 * Excel error value and damaged, so `invalid` and `ignored_damaged` never
 * compete. The damage question is asked first because that is the rule.)
 *
 * UNMATCHED IS NOT A FAILURE AND UNCATEGORIZED IS NOT A GUESS. A row with no
 * usable reference is almost always something the figure catalog does not
 * model — a portal, a game, a lot of accessories — and its cost belongs to the
 * purchase regardless. It becomes an item with no `sky_id` that keeps its name
 * and can never be booked into figure inventory. Throwing it away would lose
 * money from the ledger; inventing a catalog row for it would be worse.
 */
export function classifyItem(
  raw: RawRow,
  position: number,
  stockName: (sheet: string, row: number) => string | null,
  bySheetName: Map<string, CatalogEntry[]>,
  mappings: Map<string, string | null>,
): ClassifiedItem {
  const base = {
    sourceRow: raw.row,
    position,
    rawName: raw.f,
    legacyConditionFlag: raw.c,
    legacyBookedFlag: raw.d,
  };

  if (isLegacyDamaged(raw)) {
    return { ...base, resolvedName: null, sheet: null, classification: "ignored_damaged",
             skyId: null, evidence: "none", note: "beschädigt — nicht übernommen" };
  }

  if (raw.f.startsWith("#")) {
    return { ...base, resolvedName: null, sheet: null, classification: "invalid",
             skyId: null, evidence: "none", note: "Excel-Fehlerwert" };
  }

  /*
   * THE FORMULA FIRST, AND THAT ORDER IS THE WHOLE POINT.
   *
   * An earlier version asked the saved mappings first. That is backwards: a
   * mapping is keyed by the workbook text alone, because A:I carries no sheet,
   * while `=T!I74` names a specific row of a specific stock sheet. The text is
   * the weaker evidence, and letting it win would let one stale resolution
   * quietly override the workbook's own answer for every future row that
   * happens to be written the same way.
   */
  /*
   * THE DESTINATION IS CHECKED BEFORE THE ROW IS READ.
   *
   * `DI A` never reaches `resolveByFormula` — it is not a stock sheet — so
   * without this it would fall all the way through to "no catalog reference in
   * column G", which is true and useless: the reference is right there and says
   * exactly what the object is.
   */
  const diReason = nonFigureByReference(raw.gFormula, null);
  if (diReason === "disney_infinity") {
    return { ...base, resolvedName: null, sheet: referencedSheet(raw.gFormula),
             classification: "uncategorized", skyId: null, evidence: "formula",
             note: NON_FIGURE_NOTE.disney_infinity };
  }

  const ref = resolveByFormula(raw.gFormula);
  const hasMapping = mappings.has(normalise(raw.f));
  const mapped = hasMapping ? mappings.get(normalise(raw.f)) ?? null : undefined;

  if (ref) {
    const resolvedName = stockName(ref.sheet, ref.row);

    /*
     * A deliberate non-figure destination, decided by the reference and not by
     * the name. This sits ABOVE the catalog lookup on purpose: a saved mapping
     * must never be able to turn a portal or a swap half into a figure, and
     * the free text cannot either.
     */
    const reason = nonFigureByReference(raw.gFormula, resolvedName);
    if (reason) {
      return { ...base, resolvedName, sheet: ref.sheet, classification: "uncategorized",
               skyId: null, evidence: "formula", note: NON_FIGURE_NOTE[reason] };
    }

    if (resolvedName) {
      const exact = bySheetName.get(`${ref.sheet}|${resolvedName}`) ?? [];
      const hits = exact.length
        ? exact
        : bySheetName.get(`${ref.sheet}|${normalise(resolvedName)}`) ?? [];

      if (hits.length === 1) {
        /*
         * THE REFERENCE IS THE ANSWER. Nothing is consulted against it — not a
         * saved mapping, and above all not the text in `F`.
         *
         * Row 69 is why that last clause is written down. It reads
         * `Drobot S2`, which by the owner's own convention (155 of 155 rows)
         * means the Giants copy at `G!I54`; its formula says `G!I55`, which is
         * `Drobot Light Core`. The formula is right, because the formula is
         * what the price was always taken from. `F` is what someone typed once.
         */
        return { ...base, resolvedName, sheet: ref.sheet, classification: "matched",
                 skyId: hits[0].skyId, evidence: "formula", note: null };
      }
      if (hits.length > 1) {
        // A saved mapping is exactly what an ambiguous reference is for.
        if (mapped !== undefined && mapped !== null) {
          return { ...base, resolvedName, sheet: ref.sheet, classification: "matched",
                   skyId: mapped, evidence: "mapping", note: "gespeicherte Zuordnung" };
        }
        return { ...base, resolvedName, sheet: ref.sheet, classification: "ambiguous",
                 skyId: null, evidence: "formula", note: `${hits.length} Katalogtreffer` };
      }
      if (mapped !== undefined) {
        return mapped === null
          ? { ...base, resolvedName, sheet: ref.sheet, classification: "uncategorized",
              skyId: null, evidence: "mapping", note: "als Nicht-Figur gespeichert" }
          : { ...base, resolvedName, sheet: ref.sheet, classification: "matched",
              skyId: mapped, evidence: "mapping", note: "gespeicherte Zuordnung" };
      }
      return { ...base, resolvedName, sheet: ref.sheet, classification: "unmatched",
               skyId: null, evidence: "formula", note: `"${resolvedName}" nicht im Katalog` };
    }
    // The reference points at nothing — a broken or edited formula.
    if (mapped !== undefined && mapped !== null) {
      return { ...base, resolvedName: null, sheet: ref.sheet, classification: "matched",
               skyId: mapped, evidence: "mapping", note: "gespeicherte Zuordnung" };
    }
    return { ...base, resolvedName: null, sheet: ref.sheet, classification: "unmatched",
             skyId: null, evidence: "formula",
             note: `Referenz ${ref.sheet}!I${ref.row} zeigt auf keine Zeile` };
  }

  // No reference at all: the saved mapping is now the best evidence there is.
  if (mapped !== undefined) {
    return mapped === null
      ? { ...base, resolvedName: null, sheet: null, classification: "uncategorized",
          skyId: null, evidence: "mapping", note: "als Nicht-Figur gespeichert" }
      : { ...base, resolvedName: null, sheet: null, classification: "matched",
          skyId: mapped, evidence: "mapping", note: "gespeicherte Zuordnung" };
  }

  return { ...base, resolvedName: null, sheet: null, classification: "uncategorized",
           skyId: null, evidence: "none", note: "keine Katalogreferenz in Spalte G" };
}

/** Index a catalog for `classifyItem`, by exact and by normalised name. */
export function indexCatalog(catalog: readonly CatalogEntry[]): Map<string, CatalogEntry[]> {
  const index = new Map<string, CatalogEntry[]>();
  const add = (key: string, entry: CatalogEntry) => {
    const list = index.get(key);
    if (list) list.push(entry); else index.set(key, [entry]);
  };
  for (const entry of catalog) {
    add(`${entry.series}|${entry.name}`, entry);
    add(`${entry.series}|${normalise(entry.name)}`, entry);
  }
  return index;
}

/**
 * What one purchase group would actually become.
 *
 * WHY POSITIONS ARE ASSIGNED HERE AND NOT BY THE CALLER
 *
 * `position` numbers the items of the *migrated* purchase, so it has to be
 * counted after the damaged rows are dropped — otherwise the first purchase
 * with a damaged row in the middle gets a gap, and every later reader has to
 * guess whether the gap means "discarded" or "lost". Leaving that to the caller
 * means getting it right in every caller.
 *
 * SOURCE ROWS ARE NEVER LOST, ONLY SORTED
 *
 *     sourceRows === migrated.length + ignored.length
 *
 * The ignored rows are returned, not counted and thrown away, because an audit
 * that cannot show you what it discarded is not an audit.
 */
export type GroupPreview = {
  /** Item rows read from the workbook. */
  sourceRows: number;
  /** Every row, classified, in workbook order — including the ignored ones. */
  all: ClassifiedItem[];
  /** The rows that would become `purchase_items`, in workbook order. */
  migrated: ClassifiedItem[];
  /** Damaged rows, deliberately excluded. */
  ignoredDamaged: ClassifiedItem[];
  /** Excel error values — excluded too, and they are a source defect. */
  invalid: ClassifiedItem[];
  byClassification: Record<Classification, number>;
  byEvidence: Record<Evidence, number>;
};

export function classifyGroup(
  items: readonly RawRow[],
  stockName: (sheet: string, row: number) => string | null,
  bySheetName: Map<string, CatalogEntry[]>,
  mappings: Map<string, string | null>,
): GroupPreview {
  const all: ClassifiedItem[] = [];
  const migrated: ClassifiedItem[] = [];
  const ignoredDamaged: ClassifiedItem[] = [];
  const invalid: ClassifiedItem[] = [];
  const byClassification = {
    matched: 0, ambiguous: 0, unmatched: 0, uncategorized: 0,
    invalid: 0, ignored_damaged: 0,
  } as Record<Classification, number>;
  const byEvidence = { formula: 0, mapping: 0, name: 0, none: 0 } as Record<Evidence, number>;

  for (const raw of items) {
    // Position counts the migrated items only, so it is taken after the answer.
    const item = classifyItem(raw, migrated.length + 1, stockName, bySheetName, mappings);
    byClassification[item.classification] += 1;
    byEvidence[item.evidence] += 1;
    all.push(item);

    if (item.classification === "ignored_damaged") ignoredDamaged.push({ ...item, position: 0 });
    else if (item.classification === "invalid") invalid.push({ ...item, position: 0 });
    else migrated.push(item);
  }

  return { sourceRows: items.length, all, migrated, ignoredDamaged, invalid, byClassification, byEvidence };
}

/**
 * `Order 2026!A:I` from worksheet XML.
 *
 * WHY THIS IS NOT `parseSheet()`
 *
 * The inventory importer's parser reads two columns and drops everything else,
 * including formulas — correct there, fatal here. `G` is the identity of a
 * purchase row, and only its FORMULA carries that: the cached `<v>` is a price,
 * and a price does not say which figure it belongs to.
 *
 * Error cells are kept, not skipped. `#REF!` in column A is the whole reason
 * thirteen groups have no date, and a parser that silently dropped it would
 * turn a broken date into a missing one.
 */
export function parseOrderSheet(xml: string, shared: readonly string[]): RawRow[] {
  const unescape = (text: string): string =>
    text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, c: string) => String.fromCodePoint(Number(c)))
      .replace(/&amp;/g, "&");

  const rows: RawRow[] = [];

  /*
   * TWO ALTERNATIVES, NOT ONE WITH A `(?:\/>|…)` TAIL.
   *
   * `[^>]*` cannot cross a `>`, but it happily eats the `/` of a self-closing
   * tag and then matches the second branch — so `<c r="A6" s="6"/>` consumed
   * everything up to the next `</c>`, swallowing B6 and C6 with it. Measured
   * cost of that on this sheet: column C read as empty on every row but the
   * first of each group, which silently changed the import fingerprint of the
   * one purchase already in the database.
   */
  for (const rowXml of xml.match(/<row\b[^>]*\/>|<row\b[^>]*>[\s\S]*?<\/row>/g) ?? []) {
    const row = Number(/\br="(\d+)"/.exec(rowXml)?.[1] ?? 0);
    if (row === 0) continue;

    const value: Record<string, string> = {};
    let gFormula = "";

    for (const cell of rowXml.match(/<c\b[^>]*\/>|<c\b[^>]*>[\s\S]*?<\/c>/g) ?? []) {
      const column = /r="([A-Z]+)\d+"/.exec(cell)?.[1];
      if (!column || !"ABCDEFGHI".includes(column) || column.length !== 1) continue;

      if (column === "G") gFormula = unescape(/<f[^>]*>([\s\S]*?)<\/f>/.exec(cell)?.[1] ?? "");

      const type = /\bt="([^"]+)"/.exec(cell)?.[1];
      if (type === "inlineStr") {
        value[column] = unescape((cell.match(/<t[^>]*>([\s\S]*?)<\/t>/g) ?? [])
          .map((t) => t.replace(/<[^>]+>/g, "")).join(""));
        continue;
      }
      const raw = /<v>([\s\S]*?)<\/v>/.exec(cell)?.[1];
      if (raw === undefined) continue;
      // `t="e"` keeps its text (`#REF!`); `t="s"` indexes the shared table.
      value[column] = type === "s" ? (shared[Number(raw)] ?? "") : unescape(raw);
    }

    if (Object.keys(value).length === 0 && gFormula === "") continue;

    rows.push({
      row,
      a: value.A ?? "", b: value.B ?? "", c: value.C ?? "", d: value.D ?? "",
      e: value.E ?? "", f: value.F ?? "", g: value.G ?? "", gFormula,
      h: value.H ?? "", i: value.I ?? "",
    });
  }

  return rows;
}
