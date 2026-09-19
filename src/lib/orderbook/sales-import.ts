/**
 * Importing the historical sales (ADR-0089).
 *
 * The Einkauf importer's shape, with the Verkauf side's own identity rules and
 * one extra job: turning five fixed Excel money columns into fee rows, refund
 * rows and signed adjustments that reproduce the workbook's payout exactly.
 *
 * IT MOVES NO STOCK, and cannot: `seller_import_sale_group` writes no movement
 * and a trigger on `sale_items` refuses one on any row whose sale came from
 * the workbook. `L` and `M` land as text.
 */
import {
  classifyItem, normalise, resolveByFormula, referencedSheet, SWAP_FORCE_HALF,
  type CatalogEntry, type ClassifiedItem, type Evidence, type RawRow,
} from "./order-2026.ts";
import {
  groupSales, isStandaloneCorrection, workbookExpectedPayout,
  type SaleGroup, type SalesRow,
} from "./sales-2026.ts";
import {
  plannedPayout, type AdjustmentPlan, type FeePlan, type RefundPlan,
} from "./sales-money.ts";

export const SALES_FINGERPRINT_VERSION = "orderbuch-sales-1";

/**
 * Owner decisions that the workbook cannot express.
 *
 * `washbuckler` is the only one that assigns a figure. It is ambiguous on the
 * evidence — the catalog holds `Wash Buckler` and `Wash Buckler (Dark)`, and
 * none of the 17 rows carries a reference — so it is here, named, rather than
 * resolved by a fuzzy match that would look like deduction.
 */
export const OWNER_MAPPINGS: ReadonlyMap<string, string | null> = new Map([
  // Ambiguous on the evidence: the catalog holds `Wash Buckler` and
  // `Wash Buckler (Dark)`, and none of the 17 rows carries a reference.
  ["washbuckler", "SKY-0239"],
  // Two `Kaos` figures exist — Trap Team SKY-0419 and Imaginators SKY-0563 —
  // and the owner used both elsewhere in the workbook. He chose Imaginators.
  ["kaos", "SKY-0563"],
  // A typo AND a variant: `Tuff Luck` SKY-0336 or `Tuff Luck (Clear Crystal)`
  // SKY-0337. The normal Trap Master.
  ["tuff lu k", "SKY-0336"],
  // `Legendary Bouncer` SKY-0115 is the only candidate, but only after adding
  // a letter — which is not something a rule may do. The owner added it.
  ["legendary bouner", "SKY-0115"],
]);

/**
 * Owner decisions about ONE historical row, keyed by sheet and source row.
 *
 * WHY THIS IS NOT A NAME MAPPING. The workbook genuinely sold both variants of
 * these figures — `Chop Chop` resolves to Spyro's Adventure through `SA!I19`
 * on eighteen rows and to Giants through `G!I47` on another, and `Stealth Elf`
 * splits the same way across `SA!I63` and `G!I76`. A `raw_name → sky_id` entry
 * would flatten all of them to whichever variant was decided last and silently
 * rewrite history that the owner's own formulas had already settled correctly.
 *
 * So the key is the row itself. Each entry resolves exactly one position of
 * one sale and can reach nothing else, which is why it is safe to let it
 * outrank every automatic rule including a valid reference.
 *
 * Every entry is a decision the owner made about a sale he remembers; none is
 * derivable from the workbook, and none may be extended by analogy.
 */
export const SOURCE_ROW_OVERRIDES: ReadonlyMap<string, string | null> = new Map([
  /*
   * Sale header 1366 · 2026-09-06 · buyer wyfv7080.
   *
   * The owner sold TWO Ignitors in this parcel and both were the Giants
   * version. Row 1368 is the one correction here that overturns an automatic
   * answer: `ignitor` is referenced consistently as `SA!I49` everywhere else
   * in the workbook, so self-usage had resolved it to SKY-0045 — right as a
   * general inference, wrong about this specific sale. Row 1369 carries the
   * typo `Ignitior`, which nothing could resolve; the owner confirms it is the
   * second Giants Ignitor. The raw text stays as written, for provenance.
   */
  ["Order 2026|1368", "SKY-0167"],
  ["Order 2026|1369", "SKY-0167"],
  /*
   * Sale header 1489 · 2026-09-14 · buyer nickname22 — a 27-position lot.
   *
   * Neither row carries a reference or a cached value. The lot also contains
   * `Chop Chop S2` (row 1507) and `Ninja Stealth Elf` (row 1509), which resolve
   * on their own to Giants SKY-0149 and SKY-0287 and must stay that way.
   */
  ["Order 2026|1510", "SKY-0059"],
  ["Order 2026|1513", "SKY-0015"],
  /*
   * Sale header 1517 · 2026-09-14 · buyer maxim-5707 — a single-position sale.
   */
  ["Order 2026|1517", "SKY-0015"],
]);

/** The sheet the historical sales area lives on. Overrides are keyed by it. */
export const SALES_SHEET = "Order 2026";

/**
 * Skylanders Battlecast — a trading-card line SkyIsles has never modelled.
 *
 * Fifteen rows across five names. They stay legitimate purchases with no
 * figure: inventing SKY-IDs for a product the catalog does not carry would put
 * five fictions in the identity space that ADR-0034 keeps permanent.
 */
export const BATTLECAST = /^battlecast\b/;

/**
 * Whitespace- and punctuation-insensitive comparison.
 *
 * `Tri Tip` and `Tri-Tip`, `Tidal Wave GillGrunt` and `Tidal Wave Gill Grunt`
 * are the same object written two ways. This is the ONLY latitude taken: it
 * removes separators and nothing else, so `Ignitior` never becomes `Ignitor`
 * and `Bouner` never becomes `Bouncer`. A missing letter is a different name.
 */
export const tighten = (name: string): string => normalise(name).replace(/\s+/g, "");

/** `Legendary Stealth Elf S2` → `Legendary Stealth Elf`, and which game `S2` means. */
const SERIES_MARKER = /\s+\b(S1|S2|LC)\b\s*$/i;
const MARKER_SERIES: Record<string, string> = { S1: "SA", S2: "G" };

/** No catalog figure is named `Portal …`; the workbook's ZB sheet is full of them. */
const PORTAL_NAME = /^portal\b/;

/**
 * Disney Infinity names their own edition first: `1.0 -`, `2.0 -`, `3.0 -`.
 *
 * All 99 names on the `DI A` sheet carry it and no Skylanders catalog name
 * begins with a version number, so the prefix alone identifies the product
 * line. It catches the variants the sheet itself does not list — `3.0 Obi Wan
 * Kenobi (LFX)` is a Light-FX edition of a figure the sheet has without the
 * suffix.
 */
const DISNEY_EDITION = /^[123]\s*0\s/;

export type SaleItemPlan = {
  position: number;
  sourceRow: number;
  rawName: string;
  skyId: string | null;
  evidence: Evidence | "owner" | "battlecast" | "self" | "override";
  classification: ClassifiedItem["classification"];
  stockFlag: string;
  shippedFlag: string;
  note: string | null;
};


export type SalePlan = {
  headerRow: number; firstRow: number; lastRow: number;
  date: string | null; rawDate: string; country: string; buyer: string;
  fingerprint: string; note: string;
  status: "eligible" | "already_imported" | "blocked" | "standalone_correction";
  reason: string | null;
  subtotal: number; shipping: number; discount: number;
  fees: FeePlan[]; refunds: RefundPlan[]; adjustments: AdjustmentPlan[];
  expectedPayout: number; workbookPayout: number;
  items: SaleItemPlan[];
  sourceRows: number;
};

export type SalesPlanDeps = {
  stockName: (sheet: string, row: number) => string | null;
  bySheetName: Map<string, CatalogEntry[]>;
  savedMappings: Map<string, string | null>;
  /** normalised name → the one stock row the owner's own formulas point at. */
  selfUsage: Map<string, { sheet: string; name: string }>;
  /** tightened canonical name → the one catalog figure that bears it. */
  byTightName: Map<string, CatalogEntry>;
  /** Every name the `DI A` sheet carries, tightened. */
  disneyNames: ReadonlySet<string>;
  imported: ReadonlySet<string>;
  factor: number;
};

/**
 * Build the lookup that lets the workbook resolve its own shorthand.
 *
 * For every sales row that DOES carry a reference, remember where it points.
 * A name that the owner referenced consistently elsewhere is evidence; a name
 * he referenced two different ways is not, and is left out.
 */
export function buildSelfUsage(
  rows: readonly SalesRow[],
  stockName: (sheet: string, row: number) => string | null,
  /*
   * The PURCHASE rows of the same sheet, too.
   *
   * `Drobit` appears on the sales side with no reference and on the purchase
   * side with `T!I76` — the owner's own formula, naming `Mini Drobit`. It is
   * one workbook and one person's shorthand; reading only half of it would
   * throw away evidence he already wrote down.
   */
  purchases: readonly RawRow[] = [],
): Map<string, { sheet: string; name: string }> {
  const seen = new Map<string, Map<string, { sheet: string; name: string }>>();
  const note = (rawName: string, formula: string) => {
    const ref = resolveByFormula(formula);
    if (!ref) return;
    const name = stockName(ref.sheet, ref.row);
    if (!name) return;
    const key = normalise(rawName);
    const targets = seen.get(key) ?? new Map();
    targets.set(`${ref.sheet}|${name}`, { sheet: ref.sheet, name });
    seen.set(key, targets);
  };
  for (const p of purchases) note(p.f, p.gFormula);
  for (const row of rows) {
    const ref = resolveByFormula(row.marketFormula);
    if (!ref) continue;
    const name = stockName(ref.sheet, ref.row);
    if (!name) continue;
    const key = normalise(row.artikel);
    const targets = seen.get(key) ?? new Map();
    targets.set(`${ref.sheet}|${name}`, { sheet: ref.sheet, name });
    seen.set(key, targets);
  }
  const out = new Map<string, { sheet: string; name: string }>();
  for (const [key, targets] of seen) {
    if (targets.size === 1) out.set(key, [...targets.values()][0]);
  }
  return out;
}

/**
 * Decide what one sold object is.
 *
 * The Einkauf precedence, extended at the ends rather than rearranged:
 *
 *   0  an owner override on THIS source row   beats everything
 *   1  the P reference, when it RESOLVES      authoritative
 *   2  the O reference (7 rows name a ZB row) authoritative, non-figure
 *   3  an explicit owner decision             four named rows
 *   4  Battlecast                             intentional non-figure
 *   5  a saved mapping
 *   6  the workbook resolving itself          the owner's own formulas
 *   7  intentional non-figure / unresolved
 */
export function classifySaleItem(
  row: SalesRow, position: number, deps: SalesPlanDeps,
): SaleItemPlan {
  const base = {
    position, sourceRow: row.row, rawName: row.artikel,
    stockFlag: row.stockFlag, shippedFlag: row.shippedFlag,
  };
  const key = normalise(row.artikel);

  /*
   * 0 — the owner ruled on this exact row.
   *
   * It outranks a valid reference, which nothing else in this function does.
   * That is deliberate and it is why the key is a row and not a name: the
   * owner is correcting what one sale actually contained, and the workbook
   * formula on such a row is his own earlier shorthand, not an observation.
   * Row 1368 is the case that forces the ordering — self-usage resolved it to
   * SKY-0045 from eighteen consistent references, and the owner says that
   * parcel held two Giants Ignitors.
   */
  const override = SOURCE_ROW_OVERRIDES.get(`${SALES_SHEET}|${row.row}`);
  if (override !== undefined) {
    return { ...base, skyId: override, evidence: "override",
             classification: override ? "matched" : "uncategorized",
             note: `Zeilenentscheidung des Inhabers (${SALES_SHEET}!${row.row})` };
  }

  // 2 — the name itself is a reference into Zubehör.
  if (referencedSheet(row.artikelFormula) === "ZB") {
    return { ...base, skyId: null, evidence: "formula", classification: "uncategorized",
             note: "Zubehör/Portal — keine SkyIsles-Figur" };
  }

  /*
   * 1 — the market-price reference, through the shared classifier so the DI A,
   *     ZB and swap-half rules apply exactly as they do on the Einkauf side.
   *
   * A REFERENCE THAT POINTS AT NOTHING IS NOT A VERDICT.
   *
   * One row in 1 256 carries `SC!I119`, and the SuperChargers sheet ends at
   * row 82. It resolves to no stock row, its cached value is 0, and it is the
   * only `Free Ranger` row marked neither removed from stock nor shipped — a
   * dead link on an abandoned line. Returning `unmatched` for it treated "no
   * information" as an answer and discarded the evidence that still applies:
   * the owner wrote twenty-one other `Free Ranger` references and every one
   * of them names `SF!I21`, so step 6 resolves the row from his own usage.
   *
   * So a broken reference falls through. A reference that RESOLVES still wins
   * over everything below, unchanged.
   */
  if (row.marketFormula) {
    const ref = resolveByFormula(row.marketFormula);
    const pointsSomewhere = ref === null || deps.stockName(ref.sheet, ref.row) !== null;
    if (pointsSomewhere) {
      const classified = classifyItem(
        { row: row.row, a: "", b: "", c: "", d: "", e: "", f: row.artikel,
          g: row.marketValue, gFormula: row.marketFormula, h: "", i: "" },
        position, deps.stockName, deps.bySheetName, deps.savedMappings);
      return { ...base, skyId: classified.skyId, evidence: classified.evidence,
               classification: classified.classification, note: classified.note };
    }
  }

  // 3 — the owner said so.
  if (OWNER_MAPPINGS.has(key)) {
    const skyId = OWNER_MAPPINGS.get(key) ?? null;
    return { ...base, skyId, evidence: "owner",
             classification: skyId ? "matched" : "uncategorized",
             note: "Entscheidung des Inhabers" };
  }

  // 4 — a product line the catalog does not carry.
  if (BATTLECAST.test(key)) {
    return { ...base, skyId: null, evidence: "battlecast", classification: "uncategorized",
             note: "Battlecast — nicht im Katalog" };
  }

  // 5 — remembered earlier.
  if (deps.savedMappings.has(key)) {
    const skyId = deps.savedMappings.get(key) ?? null;
    return { ...base, skyId, evidence: "mapping",
             classification: skyId ? "matched" : "uncategorized",
             note: "gespeicherte Zuordnung" };
  }

  // 6 — the same name, referenced by the owner somewhere else.
  const self = deps.selfUsage.get(key);
  if (self) {
    if (self.sheet === "DI A") {
      return { ...base, skyId: null, evidence: "self", classification: "uncategorized",
               note: "Disney Infinity — keine SkyIsles-Figur" };
    }
    if (self.sheet === "ZB" || SWAP_FORCE_HALF.test(self.name)) {
      return { ...base, skyId: null, evidence: "self", classification: "uncategorized",
               note: "keine SkyIsles-Figur" };
    }
    const hits = deps.bySheetName.get(`${self.sheet}|${self.name}`)
      ?? deps.bySheetName.get(`${self.sheet}|${normalise(self.name)}`) ?? [];
    if (hits.length === 1) {
      return { ...base, skyId: hits[0].skyId, evidence: "self", classification: "matched",
               note: `Eigenreferenz ${self.sheet}: ${self.name}` };
    }
  }

  // 7 — the `DI A` sheet names it, or its own edition prefix does. Disney
  //     Infinity, a real object with no SkyIsles identity to invent.
  if (deps.disneyNames.has(tighten(row.artikel)) || DISNEY_EDITION.test(key)) {
    return { ...base, skyId: null, evidence: "self", classification: "uncategorized",
             note: "Disney Infinity — keine SkyIsles-Figur" };
  }

  // 8 — a portal. No catalog figure is named `Portal …`, and the workbook's
  //     Zubehör sheet is where they live.
  if (PORTAL_NAME.test(key)) {
    return { ...base, skyId: null, evidence: "name", classification: "uncategorized",
             note: "Portal — keine SkyIsles-Figur" };
  }

  /*
   * 9 — the catalog carries exactly this name, once.
   *
   * Separators only: `Tri Tip` is `Tri-Tip`. UNIQUE is the whole safety of it
   * — `Ignitor` exists three times across two games, so an `Ignitor` row would
   * fall straight through this branch rather than pick one.
   */
  const exact = deps.byTightName.get(tighten(row.artikel));
  if (exact) {
    return { ...base, skyId: exact.skyId, evidence: "name", classification: "matched",
             note: "eindeutiger Katalogname" };
  }

  /*
   * 10 — a series marker plus a unique stem.
   *
   * `S2` means Giants in 155 of 155 formula-bearing rows the owner wrote, and
   * `S1` means Spyro's Adventure in 4 of 4. So `Legendary Stealth Elf S2`
   * resolves only if the stem is unique AND the one candidate is in the game
   * the marker names — both, or nothing.
   */
  const marker = SERIES_MARKER.exec(row.artikel);
  if (marker) {
    const stem = deps.byTightName.get(tighten(row.artikel.replace(SERIES_MARKER, "")));
    const wanted = MARKER_SERIES[marker[1].toUpperCase()];
    if (stem && (wanted === undefined || stem.series === wanted)) {
      return { ...base, skyId: stem.skyId, evidence: "name", classification: "matched",
               note: `eindeutiger Katalogname, Serienkürzel ${marker[1].toUpperCase()}` };
    }
  }

  return { ...base, skyId: null, evidence: "none", classification: "unmatched",
           note: "keine Referenz, keine Zuordnung" };
}

/** Catalog names that exactly one figure bears. Ambiguous ones are left out. */
export function buildTightNameIndex(catalog: readonly CatalogEntry[]): Map<string, CatalogEntry> {
  const counts = new Map<string, CatalogEntry[]>();
  for (const entry of catalog) {
    const key = tighten(entry.name);
    counts.set(key, [...(counts.get(key) ?? []), entry]);
  }
  const out = new Map<string, CatalogEntry>();
  for (const [key, list] of counts) {
    // Two figures sharing a name is exactly the case this must not decide.
    if (new Set(list.map((e) => e.skyId)).size === 1) out.set(key, list[0]);
  }
  return out;
}

/** The exact text the fingerprint hashes. */
export function canonicalSaleIdentity(group: SaleGroup, items: readonly SaleItemPlan[]): string {
  return JSON.stringify([
    SALES_FINGERPRINT_VERSION, "Order 2026", group.headerRow, group.date, group.buyer,
    group.money.U, group.money.AE,
    items.map((i) => [i.sourceRow, i.rawName, i.stockFlag, i.shippedFlag, i.skyId]),
  ]);
}

export async function saleFingerprint(group: SaleGroup, items: readonly SaleItemPlan[]): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalSaleIdentity(group, items));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Five Excel columns become fee rows, and the sixth becomes something else.
 *
 * `settled_by` is what made `lbl eBay` and `lbl ext` two columns, and it
 * collapses them into one kind. `Fee S.` is NOT a fee: the workbook ADDS it,
 * and on the one order that was refunded in full it equals the transaction fee
 * exactly — a credit handed back, which a positive-only fee table cannot say.
 */
export function moneyToRows(m: Record<string, number>): {
  fees: FeePlan[]; refunds: RefundPlan[]; adjustments: AdjustmentPlan[];
} {
  const fees: FeePlan[] = [];
  if (m.X)  fees.push({ kind: "payment",        amount: m.X,  settled_by: "channel" });
  if (m.AA) fees.push({ kind: "marketplace",    amount: m.AA, settled_by: "channel" });
  if (m.Y)  fees.push({ kind: "shipping_label", amount: m.Y,  settled_by: "channel" });
  if (m.Z)  fees.push({ kind: "shipping_label", amount: m.Z,  settled_by: "external" });
  const refunds: RefundPlan[] = m.AD ? [{ amount: m.AD, note: "Order 2026" }] : [];
  const adjustments: AdjustmentPlan[] = m.AB
    ? [{ amount: m.AB, reason: "gebuehrengutschrift", note: "Order 2026, Spalte `Fee S.`" }]
    : [];
  return { fees, refunds, adjustments };
}


export async function planSale(group: SaleGroup, deps: SalesPlanDeps): Promise<SalePlan> {
  const items = group.items.map((row, index) => classifySaleItem(row, index + 1, deps));
  const fingerprint = await saleFingerprint(group, items);
  const { fees, refunds, adjustments } = moneyToRows(group.money);
  const subtotal = group.money.U, shipping = group.money.V, discount = group.money.W;

  let status: SalePlan["status"] = "eligible";
  let reason: string | null = null;

  if (isStandaloneCorrection(group)) {
    status = "standalone_correction";
    reason = "kein Verkauf — eigenständige Abrechnungskorrektur";
  } else if (deps.imported.has(fingerprint)) {
    status = "already_imported";
    reason = "Fingerabdruck bereits vergeben";
  } else if (items.length === 0) {
    status = "blocked";
    reason = "keine Positionen";
  }

  const where = `Order 2026, Kopfzeile ${group.headerRow}, Zeilen ${group.firstRow}–${group.lastRow}`;
  return {
    headerRow: group.headerRow, firstRow: group.firstRow, lastRow: group.lastRow,
    date: group.date, rawDate: group.rawDate, country: group.country, buyer: group.buyer,
    fingerprint,
    note: group.date === null ? `${where} · Verkaufsdatum im Workbook: ${group.rawDate || "leer"}` : where,
    status, reason, subtotal, shipping, discount, fees, refunds, adjustments,
    expectedPayout: plannedPayout(subtotal, shipping, discount, fees, refunds, adjustments),
    workbookPayout: workbookExpectedPayout(group.money),
    items, sourceRows: group.items.length,
  };
}

export async function planSales(groups: readonly SaleGroup[], deps: SalesPlanDeps): Promise<SalePlan[]> {
  const out: SalePlan[] = [];
  for (const group of groups) out.push(await planSale(group, deps));
  return out;
}

export { groupSales };

/*
 * The payout formula and its row shapes live in `sales-money.ts` since 0065.
 *
 * They were here because the importer was the first thing that needed them.
 * The external-sale form needs the SAME arithmetic — a payout computed one
 * way at import and another way on screen is two answers to one question —
 * and it cannot import this module, which carries the whole xlsx reader.
 *
 * Re-exported rather than moved silently, so every existing caller and test
 * keeps working and there is still one definition.
 */
export { plannedPayout };
export type { AdjustmentPlan, FeePlan, RefundPlan };
