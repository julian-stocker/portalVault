/**
 * Is the figure an external report names the piece SkyIsles booked?
 *
 * Four tiers, tried strictly in this order, and every tier reports itself so a
 * later screen can show HOW sure a match is:
 *
 *   exact        the same words after `normalise()` (case, accents, punctuation)
 *   normalized   the same identity after aliases and noise words:
 *                `Stealth Elf (Legendary)` = `Legendary Stealth Elf`,
 *                `Giants (PlayStation3)` = `Giants PS3`,
 *                `Turbo Charge D.K.` = `Turbo Charge Donkey Kong`
 *   alias        what another SkyIsles sale of the SAME SKY-ID was once called
 *                (`Empire of Ice` was booked as the catalog's `Ice Crave` seven
 *                times — the ledger itself is the alias table)
 *   fuzzy        a typo or a harmless missing word: `Splitfire` ≈ `Spitfire`,
 *                `Spry` ≈ `Mini Spry`
 *
 * TWO VETOES THAT NO TIER OVERRULES
 *
 *   model numbers   portals carry a model number (`84148790`, `83973080A`).
 *                   Equal numbers identify a portal; DIFFERENT numbers are
 *                   different products, however alike the rest reads.
 *   variant marks   `Dark`, `Legendary`, `LC`, `Elite`, … make a different
 *                   SKY-ID. `Spyro` is not `Dark Spyro`, and a fuzzy match
 *                   across a mark would book the wrong figure.
 *
 * And a fuzzy tier that was too eager is the expensive mistake here, so it is
 * deliberately narrow: a near-identical spelling, or a subset that differs only
 * by a listed harmless word — on the piece's own names only, never through the
 * alias table.
 */

import { normalise } from "@/lib/orderbook/order-2026";
import type { ExternalLine, ExternalOrder, LedgerPiece, LedgerSale } from "./types";

export type NameTier = "exact" | "normalized" | "alias" | "fuzzy";

/** Spellings that mean the same thing, applied to `normalise()`d text. */
const ALIASES: readonly [RegExp, string][] = [
  [/\blight ?core\b/g, "lc"],
  [/\bplaystation ?3\b/g, "ps3"],
  [/\bplaystation ?4\b/g, "ps4"],
  [/\bnintendo wii ?u\b/g, "wiiu"],
  [/\bwii u\b/g, "wiiu"],
  [/\bnintendo wii\b/g, "wii"],
  [/\bxbox ?360\b/g, "xbox"],
  [/\beons elite\b/g, "elite"],
  [/\bcandy coated\b/g, "candycoated"],
  [/\bc c\b/g, "candycoated"],
  [/\bjet vac\b/g, "jetvac"],
  [/\bdonkey kong\b/g, "dk"],
  [/\bd k\b/g, "dk"],
  [/\blight fx\b/g, "lfx"],
  [/\bsilber\b/g, "silver"],
];

/** Words that say nothing about WHICH object it is. */
const NOISE = new Set([
  "ohne", "ovp", "spiel", "game", "fur", "fuer", "sony", "skylanders", "battlecast", "item", "trap",
  "crystal", "series", "s1", "s2", "s3", "s4", "the", "of", "sa", "sf", "sc", "g", "t", "i",
]);

/** Words that make a different catalog entry — never bridged by a fuzzy match. */
const VARIANT_MARKS = new Set([
  "dark", "legendary", "lc", "elite", "nitro", "chrome", "jade", "molten", "granite", "polar",
  "punch", "power", "blue", "golden", "candycoated",
]);

/**
 * The only words a fuzzy match may add or drop. A token subset is NOT enough
 * on its own: `Eruptor` ⊂ `Lava Barf Eruptor` is a different catalog entry,
 * and `PS3` ⊂ `Giants PS3` would pair any two games for one console.
 */
const HARMLESS_EXTRAS = new Set(["mini", "location"]);

const MODEL = /\b\d{5,}[a-z]?\b/g;

type NameKey = { normal: string; tight: string; tokens: Set<string>; marks: Set<string>; models: Set<string> };

const keyCache = new Map<string, NameKey>();

export function nameKey(name: string): NameKey {
  const cached = keyCache.get(name);
  if (cached) return cached;
  const normal = normalise(name);
  let aliased = normal;
  for (const [pattern, replacement] of ALIASES) aliased = aliased.replace(pattern, replacement);
  const models = new Set(aliased.match(MODEL) ?? []);
  const words = aliased.split(" ").filter((w) => w !== "" && !NOISE.has(w));
  const tokens = new Set(words.filter((w) => !models.has(w)));
  const key: NameKey = {
    normal,
    tight: words.join(""),
    tokens,
    marks: new Set([...tokens].filter((w) => VARIANT_MARKS.has(w))),
    models,
  };
  keyCache.set(name, key);
  return key;
}

const sameSet = (a: Set<string>, b: Set<string>): boolean => a.size === b.size && [...a].every((x) => b.has(x));

/** `small` ⊂ `large`, and everything `large` adds is a harmless extra. */
const harmlessSubset = (small: Set<string>, large: Set<string>): boolean =>
  small.size > 0 && small.size < large.size && [...small].every((x) => large.has(x))
  && [...large].every((x) => small.has(x) || HARMLESS_EXTRAS.has(x));

/** Levenshtein distance — small strings only, which names are. */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length];
}

/**
 * Compare one external name with one SkyIsles name.
 * Returns the tier, or null when they are not the same object.
 */
export function compareNames(external: string, ledger: string, allowFuzzy = true): Exclude<NameTier, "alias"> | null {
  const a = nameKey(external);
  const b = nameKey(ledger);
  if (a.normal !== "" && a.normal === b.normal) return "exact";

  // Veto 1: model numbers decide portals, in both directions.
  if (a.models.size > 0 && b.models.size > 0) {
    return [...a.models].some((m) => b.models.has(m)) ? "normalized" : null;
  }
  // Veto 2: a variant mark on one side only is a different figure.
  if (!sameSet(a.marks, b.marks)) return null;

  if (a.tokens.size > 0 && (sameSet(a.tokens, b.tokens) || a.tight === b.tight)) return "normalized";
  if (!allowFuzzy) return null;

  if (harmlessSubset(a.tokens, b.tokens) || harmlessSubset(b.tokens, a.tokens)) return "fuzzy";
  const left = [...a.tokens].sort().join("");
  const right = [...b.tokens].sort().join("");
  const longest = Math.max(left.length, right.length);
  if (longest >= 6 && 1 - distance(left, right) / longest >= 0.85) return "fuzzy";
  return null;
}

/**
 * The ledger as an alias table: every name a SKY-ID was ever booked under.
 * Built once per comparison run from all sales in it.
 */
export type AliasIndex = ReadonlyMap<string, readonly string[]>;

export function buildAliasIndex(sales: readonly LedgerSale[]): AliasIndex {
  const names = new Map<string, Set<string>>();
  for (const sale of sales) {
    for (const piece of sale.pieces) {
      if (!piece.skyId) continue;
      const set = names.get(piece.skyId) ?? new Set<string>();
      if (piece.name) set.add(piece.name);
      if (piece.rawName) set.add(piece.rawName);
      names.set(piece.skyId, set);
    }
  }
  return new Map([...names].map(([sky, set]) => [sky, [...set]]));
}

/** The best tier at which an external name is this piece — or null. */
export function comparePiece(external: string, piece: LedgerPiece, aliases?: AliasIndex): NameTier | null {
  const own = [piece.name, piece.rawName].filter((n): n is string => !!n);
  let best: NameTier | null = null;
  for (const name of own) {
    const tier = compareNames(external, name);
    if (tier === "exact") return "exact";
    if (tier === "normalized") best = "normalized";
    else if (tier === "fuzzy" && best === null) best = "fuzzy";
  }
  if (best === "normalized") return best;
  if (aliases && piece.skyId) {
    for (const name of aliases.get(piece.skyId) ?? []) {
      if (own.includes(name)) continue;
      const tier = compareNames(external, name, false);
      if (tier !== null) return "alias";
    }
  }
  return best;
}

export type PiecePair = { line: number; piece: number; tier: NameTier };

export type PieceMatch = {
  pairs: PiecePair[];
  /** External pieces without a SkyIsles piece: one entry per PIECE (a quantity of 3 is three). */
  unmatchedExternal: { line: number; name: string }[];
  /** Indexes into `sale.pieces`. */
  unmatchedLedger: number[];
  /** Matched share of the larger side, 0 … 1. */
  ratio: number;
};

const TIER_ORDER: readonly NameTier[] = ["exact", "normalized", "alias", "fuzzy"];

/**
 * Pair the pieces of one external order with the pieces of one sale.
 *
 * Tier by tier, so that an exact pair is never taken away by an earlier fuzzy
 * one. Within a tier, first come first served in a fixed order — the result is
 * the same on every run.
 */
export function matchPieces(order: Pick<ExternalOrder, "lines">, sale: Pick<LedgerSale, "pieces">, aliases?: AliasIndex): PieceMatch {
  const external = order.lines.flatMap((line, index) =>
    Array.from({ length: line.quantity }, () => ({ line: index, name: line.name })));
  const takenExternal = new Set<number>();
  const takenLedger = new Set<number>();
  const pairs: PiecePair[] = [];

  for (const wanted of TIER_ORDER) {
    external.forEach((piece, e) => {
      if (takenExternal.has(e)) return;
      const match = sale.pieces.findIndex((p, l) => !takenLedger.has(l) && comparePiece(piece.name, p, aliases) === wanted);
      if (match < 0) return;
      takenExternal.add(e);
      takenLedger.add(match);
      pairs.push({ line: piece.line, piece: match, tier: wanted });
    });
  }

  const larger = Math.max(external.length, sale.pieces.length);
  return {
    pairs,
    unmatchedExternal: external.filter((_, e) => !takenExternal.has(e)),
    unmatchedLedger: sale.pieces.map((_, l) => l).filter((l) => !takenLedger.has(l)),
    ratio: larger === 0 ? 1 : pairs.length / larger,
  };
}

/** The catalog series a listing title names, when it names one. */
const TITLE_SERIES: readonly [RegExp, string][] = [
  [/spyro'?s adventure/i, "SA"],
  [/\bgiants\b/i, "G"],
  [/swap ?force/i, "SF"],
  [/trap ?team/i, "T"],
  [/super ?chargers/i, "SC"],
  [/imaginators/i, "I"],
];

export function listingSeries(title: string): string | null {
  return TITLE_SERIES.find(([pattern]) => pattern.test(title))?.[1] ?? null;
}

/**
 * A HINT, never a finding: the listing's title names one series, the booked
 * SKY-ID belongs to another. eBay's variation names only the character, so the
 * title is the only clue — and a seller can list a figure under a neighbouring
 * series' listing on purpose.
 */
export function seriesHint(line: Pick<ExternalLine, "title">, piece: LedgerPiece): { listing: string; ledger: string } | null {
  const listing = listingSeries(line.title);
  const ledger = piece.seriesCode ?? null;
  return listing && ledger && listing !== ledger ? { listing, ledger } : null;
}
