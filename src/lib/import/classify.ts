/**
 * What a spreadsheet row is, and what should happen to it (ADR-0087).
 *
 * Pure: no database, no browser, no file. Every decision the importer makes
 * about a row is made here, so all of it can be tested without a workbook.
 *
 * THE DOMAIN, MEASURED AGAINST THE REAL FILE
 *
 *     559  complete loose figures     250 hold stock, 992 units
 *      39  games and software         valid SKY-IDs, not figures
 *      13  Swap Force halves          13 units, local bookkeeping
 *       2  explicitly boxed rows
 *       1  damaged legacy row
 *     ---
 *     614  rows, 0 unmatched, 0 ambiguous
 *
 * IGNORING IS AN ACTION, NOT AN OMISSION. A game row must not be imported AND
 * must not be zeroed — doing nothing to it is the correct outcome, and it is
 * different from failing to find it. That is why `IGNORED_GAME` exists
 * alongside `UNMATCHED_RELEVANT`: one is a decision, the other is a problem.
 *
 * MATCHING IS EXACT AND SCOPED BY SHEET. Measured on the real workbook, sheet
 * plus name resolves 600 of 614 rows with **zero** ambiguity — no normalisation
 * needed for a single one. Scoping matters and is not decoration: 32 names
 * occur in more than one game (`Bash` in both SA and G, every console title in
 * all six), so an importer matching on name alone would mis-file figures. There
 * is deliberately no fuzzy matching: a near-match that silently writes stock is
 * the one failure this design will not risk.
 */

/** What a row turned out to be. Mirrors the CHECK in migration 0048. */
export type Classification =
  | "SUPPORTED_COMPLETE_LOOSE_FIGURE"
  | "IGNORED_GAME"
  | "IGNORED_SWAP_FORCE_HALF"
  | "IGNORED_DAMAGED"
  | "IGNORED_OVP"
  | "IGNORED_SHEET"
  | "UNMATCHED_RELEVANT"
  | "AMBIGUOUS_RELEVANT"
  | "INVALID_ROW";

/** The six game sheets. Anything else in the workbook is out of scope. */
export const SUPPORTED_SHEETS = ["SA", "G", "SF", "T", "SC", "I"] as const;

/** The only condition this importer writes. */
export const IMPORT_CONDITION = "loose" as const;

/** A catalog entry, as the matcher needs it. */
export type CatalogEntry = {
  skyId: string;
  name: string;
  series: string;
  /** The catalog's own grouping. `Spiele` is what makes a row a game. */
  category: string;
};

/**
 * Swap Force figures come apart, and the owner tracks halves separately.
 *
 * They are never paired automatically — a top and a bottom are not a figure
 * until he says they are, and guessing would invent stock.
 */
const HALF = /\b(OBERTEIL|UNTERTEIL)\b/i;

/** Legacy local bookkeeping: damage is recorded by renaming the line. */
const DAMAGED = /BESCH[ÄA]DIGT|DEFEKT|KAPUTT/i;

/**
 * An explicit boxed row.
 *
 * The negative lookbehind is load-bearing: **`ohne OVP` means *without* the
 * box, i.e. loose.** Fourteen `Elite … - ohne OVP` rows are exactly the
 * complete loose figures this importer is for, and a naive `/OVP/` would throw
 * every one of them out.
 */
const BOXED = /(?<!ohne )\bOVP\b|versiegelt|sealed|\bMISB\b/i;

/**
 * The key a saved resolution is stored under.
 *
 * Normalisation is used for the MAPPING key only, never to match a name
 * against the catalog — so a resolution survives a stray double space or a
 * changed apostrophe, while matching itself stays exact.
 */
export function normaliseName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/['’`´]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** A resolution the owner made on an earlier import. */
export type SavedMapping = { skyId: string | null; ignored: boolean };

export type ClassifyInput = {
  sheet: string;
  name: string;
  storage: number | null;
  /** Catalog entries of this sheet's series, keyed by exact name. */
  bySeriesName: Map<string, CatalogEntry[]>;
  /** Saved resolutions, keyed by `${sheet} ${normalisedName}`. */
  mappings: Map<string, SavedMapping>;
  /** Looks a SKY-ID up, for a resolution that names one. */
  byId: Map<string, CatalogEntry>;
};

export type ClassifiedRow = {
  classification: Classification;
  skyId: string | null;
  /** Populated only for a supported row. */
  desiredQuantity: number | null;
  note: string | null;
};

export function classifyRow(input: ClassifyInput): ClassifiedRow {
  const { sheet, name, storage } = input;

  if (!(SUPPORTED_SHEETS as readonly string[]).includes(sheet)) {
    return { classification: "IGNORED_SHEET", skyId: null, desiredQuantity: null, note: null };
  }

  const none = { skyId: null, desiredQuantity: null, note: null } as const;

  // A resolution the owner already made outranks every rule below it — it is
  // the one piece of knowledge the spreadsheet cannot express.
  const saved = input.mappings.get(`${sheet} ${normaliseName(name)}`);
  if (saved) {
    if (saved.ignored) {
      return { ...none, classification: "IGNORED_SHEET", note: "vom Betreiber ausgenommen" };
    }
    const entry = saved.skyId ? input.byId.get(saved.skyId) : undefined;
    if (entry) return supported(entry, storage);
  }

  if (HALF.test(name)) {
    return { ...none, classification: "IGNORED_SWAP_FORCE_HALF" };
  }
  if (DAMAGED.test(name)) {
    return { ...none, classification: "IGNORED_DAMAGED" };
  }
  if (BOXED.test(name)) {
    return { ...none, classification: "IGNORED_OVP" };
  }

  const candidates = input.bySeriesName.get(name) ?? [];
  if (candidates.length === 0) {
    return { ...none, classification: "UNMATCHED_RELEVANT" };
  }
  if (candidates.length > 1) {
    return { ...none, classification: "AMBIGUOUS_RELEVANT" };
  }

  const entry = candidates[0];
  // A game has a real SKY-ID and is genuinely in the catalog. It is simply not
  // a figure, and this importer leaves it completely alone.
  if (entry.category === "Spiele") {
    return { ...none, classification: "IGNORED_GAME", skyId: entry.skyId };
  }

  return supported(entry, storage);
}

function supported(entry: CatalogEntry, storage: number | null): ClassifiedRow {
  if (storage === null) {
    // No Storage cell at all. Not zero — unknown. Zero is a reconciliation
    // target; blank is a row the importer must not act on.
    return {
      classification: "INVALID_ROW",
      skyId: entry.skyId,
      desiredQuantity: null,
      note: "keine Bestandszahl in Spalte F",
    };
  }
  return {
    classification: "SUPPORTED_COMPLETE_LOOSE_FIGURE",
    skyId: entry.skyId,
    desiredQuantity: storage,
    note: null,
  };
}

/* -------------------------------------------------------- reconciliation */

/** What the shop knows about a position right now. */
export type Baseline = {
  quantity: number;
  reserved: number;
  lastMovementAt: string | null;
  /** The Storage value the last applied import saw for this position. */
  lastImportDesired: number | null;
};

export type RowStatus = "pending" | "conflict" | "unchanged" | "skipped";

export type Reconciled = {
  status: RowStatus;
  delta: number;
  note: string | null;
};

/**
 * Decide what to do with one supported row.
 *
 * THE SPREADSHEET IS THE TRUTH ABOUT PHYSICAL STOCK.
 *
 * When the owner uploads a workbook and confirms, he is telling SkyIsles what
 * is on the shelf. `Storage` is an absolute target, not a delta and not a
 * proposal:
 *
 *     desired = Excel Storage
 *     delta   = desired − current
 *
 * The delta exists only because stock moves through an append-only ledger
 * (0003); the business meaning is "make it equal", and the arithmetic is an
 * implementation detail of getting there.
 *
 * WHAT THIS DELIBERATELY NO LONGER DOES.
 *
 * An earlier version refused an increase when the workbook looked older than
 * the shop's last movement, or when the sheet's value was unchanged since the
 * previous import. Both were wrong, and wrong in the same way: they had
 * SkyIsles second-guessing an instruction the owner had just given on purpose.
 * He performs the import *because* the two disagree. If the sheet says 5 at
 * the moment he confirms, the desired quantity is 5 — whatever happened in
 * between, and whenever the file was saved.
 *
 * The workbook's save time survives as information on the screen, where it can
 * tell him he picked last month's file. It decides nothing.
 *
 * THE ONE REAL CONFLICT IS A RESERVATION, because it is the one case where the
 * requested state is impossible rather than merely surprising. Stock reserved
 * for a checkout in flight cannot be taken away by a stock-take:
 * `shop_inventory` requires `reserved <= quantity`, and 0003's
 * `apply_inventory_movement()` refuses to break it.
 *
 * Catching it here as well is not a second opinion — it is the only way the
 * PREVIEW can say so. Without it the row looks ready, and the whole import
 * then aborts at commit on a constraint the owner was never shown.
 */
export function reconcile(desired: number, baseline: Baseline): Reconciled {
  const delta = desired - baseline.quantity;

  if (delta === 0) {
    return { status: "unchanged", delta: 0, note: null };
  }

  // Reserved units are promised to an order that is already being paid for.
  // A stock-take may not un-promise them.
  if (desired < baseline.reserved) {
    return {
      status: "conflict",
      delta,
      note:
        `Davon sind derzeit ${baseline.reserved} für laufende Bestellungen reserviert. ` +
        "Eine Synchronisierung auf einen kleineren Bestand ist erst danach möglich.",
    };
  }

  return { status: "pending", delta, note: null };
}
