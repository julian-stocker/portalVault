/**
 * Variant display names (V3.6).
 *
 * The catalogue spells the same idea two ways, both taken verbatim from the
 * legacy spreadsheet: "Legendary Astroblast" as a PREFIX, "Hex (Pearl)" as a
 * SUFFIX. `name` is never rewritten — CLAUDE.md rule 4, and the import writes
 * the column on every run anyway, so a rename in the database would be
 * silently undone. The public name is therefore DERIVED at read time.
 *
 * WHAT CHANGED IN V3.6. The derivation used to normalise everything to the
 * suffix form: "Legendary Bash" was shown as "Bash (Legendary)". Collectors
 * say "Legendary Bash", so it now normalises the other way — both spellings
 * land on the same three values, and the PREFIX form is what a visitor sees:
 *
 *   "Legendary Bash"    ->  base "Bash",    label "Legendary", shown "Legendary Bash"
 *   "Crusher (Granite)" ->  base "Crusher", label "Granite",   shown "Granite Crusher"
 *
 * Sorting did not change and must not: `sortBaseName` is still the BASE, so
 * "Bash", "Blue Bash" and "Legendary Bash" stay one block under B, and the
 * display name has never decided where a figure sits.
 *
 * THE RULE, deliberately conservative: a leading or bracketed token counts as
 * a variant only when the remaining text exists as a collectible entry in the
 * SAME series. That second condition is what separates a variant from a name:
 *
 *   "Legendary Bash"   -> "Bash" exists in SA        -> variant
 *   "Dark Sword"       -> "Sword" does not exist     -> unchanged
 *                         (traps are named <element> <shape>: Air Sword,
 *                          Earth Hammer, Dark Sword — "Dark" is the element)
 *   "Golden Queen"     -> "Queen" does not exist     -> unchanged
 *   "Fire Bone Hot Dog"-> not a token                -> unchanged
 *
 * It is NOT the card type. `lib/catalog/card-type.ts` decides which artwork a
 * figure is printed on, that value is persisted, and nothing here reads or
 * writes it. The two lists overlap in vocabulary and nowhere else.
 */

/**
 * Tokens that mark a form or edition rather than a distinct character.
 *
 * Recognised in both positions — as a leading word and inside brackets — so
 * "Legendary Bash" and "Free Ranger (Legendary)" produce the same structure.
 *
 * The V3.6 additions are the forms the operator released as `special`:
 * LightCore is absent on purpose (it is spelled three different ways and is
 * handled below), and so is "Elite", which is a product line rather than a
 * finish — "Elite Bash" is a differently made figure, not a Bash in another
 * colour, and Eon's Elite figures keep their own names.
 */
export const VARIANT_TOKENS: readonly string[] = [
  // Editions.
  "Legendary",
  "Dark",
  // Forms and finishes.
  "Nitro",
  "Golden",
  "Power Blue",
  "Blue",
  "Mystical",
  "Metallic",
  "Granite",
  // Colours and materials that only ever appear in brackets.
  "Clear Crystal",
  "Clear Crystal Red",
  "Clear Crystal Lila",
  "Clear Crystal Green",
  "Green Crystal",
  "Red Crystal",
  "Gold Metallic",
  "Pearl",
  "Jade",
  "Glow",
  "Scarlet",
  "Molten",
  "Bronze",
  // Seasonal and event forms, released as variants in V3.6.
  "Halloween",
  "Easter",
  "Royale",
  "Jolly",
  "Kickoff",
  "Quick Draw",
  "Spring Ahead",
  "Enchanted",
  "Gnarly",
];

/**
 * Bracketed text that is NOT a variant label, whatever else it looks like.
 *
 * Two real cases, and both would be actively wrong the other way round:
 *
 *   "Elite Boomer (2)"      — the (2) is the operator's second copy of the
 *                             same article (docs/SKYLANDERS_DATA.md 11b),
 *                             not a finish. "2 Elite Boomer" is nonsense.
 *   "Spiel für Xbox One (EN)" — the language of a game. Not a figure at all.
 *
 * Guarded by an explicit list rather than by "only known tokens count",
 * because the token list is meant to grow and these two must stay out of it
 * even by accident. A test mutates each of them back in.
 */
const NOT_VARIANT_LABELS: readonly string[] = ["2", "EN"];

/** Longest first, so "Power Blue" is tried before "Blue". */
const TOKENS_BY_LENGTH = [...VARIANT_TOKENS].sort((a, b) => b.length - a.length);

export type VariantInfo = {
  /** The figure this one is a variant of, e.g. "Astroblast". */
  baseName: string;
  /** The form, e.g. "Legendary". */
  variantLabel: string;
  /** Whether the database spells it as a prefix or in brackets. */
  source: "prefix" | "suffix";
};

/**
 * Recognises a variant, or returns null when the name stands on its own.
 *
 * `namesInSeries` must hold the collectible names of the same series — that
 * lookup is the whole safety mechanism, in both positions.
 */
export function parseVariant(
  name: string,
  namesInSeries: ReadonlySet<string>,
): VariantInfo | null {
  // 1. Prefix: "Legendary Bash".
  for (const token of TOKENS_BY_LENGTH) {
    const prefix = `${token} `;
    if (!name.startsWith(prefix)) continue;

    const baseName = name.slice(prefix.length);
    if (baseName === "") continue;
    // The decisive test: is there really a base figure to be a variant of?
    if (!namesInSeries.has(baseName)) continue;

    return { baseName, variantLabel: token, source: "prefix" };
  }

  // 2. Suffix: "Crusher (Granite)". Same two conditions — a known token, and
  //    a base figure in the same series — plus the explicit exclusions.
  const bracket = name.match(/^(.+?) \(([^)]+)\)$/);
  if (bracket) {
    const [, baseName, label] = bracket;
    if (
      !NOT_VARIANT_LABELS.includes(label) &&
      VARIANT_TOKENS.includes(label) &&
      namesInSeries.has(baseName)
    ) {
      return { baseName, variantLabel: label, source: "suffix" };
    }
  }

  return null;
}

/**
 * "Crusher (Granite)" and "Legendary Bash" both become "<label> <base>".
 *
 * One form for both spellings, which is the point: a visitor should not be
 * able to tell from the name which way round the spreadsheet happened to
 * write it.
 */
export function displayNameFor(name: string, variant: VariantInfo | null): string {
  return variant ? `${variant.variantLabel} ${variant.baseName}` : name;
}

/**
 * Everything a search should be able to find this figure by.
 *
 * Five forms, because people type all of them:
 *
 *   the canonical name as stored     "Crusher (Granite)"
 *   the displayed one                "Granite Crusher"
 *   the bare word order              "Crusher Granite"
 *   the bracket spelling             "Crusher (Granite)"
 *   the base on its own              "Crusher"
 *
 * The bracket form is listed even for a figure stored as a prefix. It was the
 * DISPLAYED name until V3.6 and somebody will type it from memory; keeping it
 * costs a few bytes in a string that is already built once per figure. The
 * base on its own is what makes searching for "Bash" return the whole family
 * rather than only the plain figure.
 *
 * Built once per figure on the server and stored as a string on
 * `CatalogFigure`; nothing here runs per keystroke and nothing fetches.
 */
export function searchFormsFor(name: string, variant: VariantInfo | null): string[] {
  if (!variant) return [name];
  return [
    name,
    displayNameFor(name, variant),
    `${variant.baseName} ${variant.variantLabel}`,
    `${variant.baseName} (${variant.variantLabel})`,
    variant.baseName,
  ];
}

/* ---------------------------------------------------------------- Elite */

/**
 * EON'S ELITE IS THREE ROWS OF ONE FIGURE (V3.6).
 *
 * The legacy source carries every Elite figure three times, and the
 * difference between them is the PACKAGING, not the figure:
 *
 *   "Elite Boomer"              the Series 1 box
 *   "Elite Boomer (2)"          the Series 2 box
 *   "Elite Boomer - ohne OVP"   the figure on its own
 *
 * Nothing in those names says so. Read literally, the first is the figure,
 * the second is a duplicate article and the third is a figure with a German
 * note welded onto it — which is how all three were shown until V3.6, and it
 * is wrong in both directions: a visitor saw "Elite Boomer - ohne OVP" as if
 * "ohne OVP" were part of the name, and saw two more entries that look like
 * the same figure twice.
 *
 * The operator's reading, and what this encodes (name updated in V3.7, when
 * Eon's Elite became a card type of its own):
 *
 *   "Elite Boomer - ohne OVP"   ->  "Eon's Elite Boomer"
 *   "Elite Boomer"              ->  "Eon's Elite Boomer (OVP Series 1)"
 *   "Elite Boomer (2)"          ->  "Eon's Elite Boomer (OVP Series 2)"
 *
 * AND THE FAMILY SORTS UNDER THE CHARACTER, NOT UNDER "E". All three rows
 * belong with SKY-0010 "Boomer", so `characterName` — not the display name
 * and not the raw name — is what `sortBaseName` is built from.
 *
 * THE SAFETY RULE IS THE SAME ONE AS EVERYWHERE ELSE. A row is an OVP
 * edition only when its LOOSE sibling exists in the same series. Without that
 * sibling "Elite Boomer" is just a figure called Elite Boomer, and this
 * declines. That is what stops the reading escaping Eon's Elite: the global
 * rule that "(2)" is never a variant label stands unchanged, and no other
 * figure in the catalogue has a `- ohne OVP` row to license the exception.
 *
 * IT IS NOT A VARIANT. `parseVariant()` answers "which finish of this figure
 * is this"; this answers "which box did it come in". They are kept apart
 * because a later, proper OVP model will replace this one and must not have
 * to be untangled from the finish system first.
 */
export type EliteEdition = {
  /** The figure, without the packaging note: "Elite Boomer". */
  baseName: string;
  /**
   * The character the line is a version of: "Boomer".
   *
   * The catalogue's own spelling wherever that figure exists, which is what
   * keeps the family together — see `characterOf()`.
   */
  characterName: string;
  /** "OVP Series 1", "OVP Series 2", or null for the loose figure. */
  editionLabel: string | null;
};

/** How the line is named in public. */
const LINE = "Eon's Elite";

/**
 * Folds a name for a spelling-tolerant lookup.
 *
 * ONE ROW NEEDS THIS. The Elite entries spell SKY-0021 "Dino-Rang" as "Dino
 * Rang", without the hyphen, and the name is raw source data that is not
 * corrected (CLAUDE.md rule 4). A strict lookup would leave that one family
 * sorting under its own misspelling — and the German collator does not place
 * the two next to each other: "Dino Roar" sorts between them.
 *
 * Measured against the real catalogue on 2026-09-15: folding this way
 * produces NO collisions in any of the six series, so it can only ever find
 * the figure it is looking for.
 */
const fold = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * The character an Elite row is a version of, in the catalogue's spelling.
 *
 * Falls back to the stripped name when no such figure exists — an Eon's Elite
 * of a figure the catalogue does not carry still sorts somewhere sensible,
 * and nothing is invented.
 */
function characterOf(baseName: string, namesInSeries: ReadonlySet<string>): string {
  const bare = baseName.startsWith("Elite ") ? baseName.slice("Elite ".length) : baseName;
  if (namesInSeries.has(bare)) return bare;
  const wanted = fold(bare);
  for (const name of namesInSeries) if (fold(name) === wanted) return name;
  return bare;
}

/**
 * The loose row's two spellings.
 *
 * "Elite Voodood- ohne OVP" (SKY-0075) is missing the space before the dash.
 * The name is raw source data and is not corrected (CLAUDE.md rule 4), so the
 * lookup accommodates it rather than the other way round.
 */
const LOOSE_SUFFIXES = [" - ohne OVP", "- ohne OVP"] as const;

/** Whether the loose row for this Elite figure exists in the same series. */
function hasLooseSibling(baseName: string, namesInSeries: ReadonlySet<string>): boolean {
  return LOOSE_SUFFIXES.some((suffix) => namesInSeries.has(`${baseName}${suffix}`));
}

/**
 * Recognises one of the three Elite rows, or returns null.
 *
 * `namesInSeries` must hold the collectible names of the same series — the
 * same set `parseVariant()` takes, and the same reason for taking it.
 */
export function parseEliteEdition(
  name: string,
  namesInSeries: ReadonlySet<string>,
): EliteEdition | null {
  if (!name.startsWith("Elite ")) return null;

  const edition = (baseName: string, editionLabel: string | null): EliteEdition => ({
    baseName,
    characterName: characterOf(baseName, namesInSeries),
    editionLabel,
  });

  // 1. The loose figure. It is its own licence: nothing else has to exist.
  for (const suffix of LOOSE_SUFFIXES) {
    if (name.endsWith(suffix)) {
      const baseName = name.slice(0, -suffix.length);
      return baseName === "Elite" ? null : edition(baseName, null);
    }
  }

  // 2. The Series 2 box — only where the loose row proves the reading.
  const second = name.match(/^(.+) \(2\)$/);
  if (second && hasLooseSibling(second[1], namesInSeries)) {
    return edition(second[1], "OVP Series 2");
  }

  // 3. The Series 1 box, same condition.
  if (hasLooseSibling(name, namesInSeries)) {
    return edition(name, "OVP Series 1");
  }

  return null;
}

/**
 * "Eon's Elite Boomer", or "Eon's Elite Boomer (OVP Series 2)".
 *
 * Built from the CHARACTER, not from the raw name: "Elite Boomer" already
 * carries the word, and `Eon's Elite Elite Boomer` is not a figure.
 */
export function eliteDisplayNameFor(edition: EliteEdition): string {
  const full = `${LINE} ${edition.characterName}`;
  return edition.editionLabel === null ? full : `${full} (${edition.editionLabel})`;
}

/**
 * What an Elite row should be findable by.
 *
 * The raw name first, because it is what the operator sees in the spreadsheet
 * and in the admin — "Elite Boomer - ohne OVP" has to keep working as a query
 * even though nobody is shown that spelling any more.
 */
export function eliteSearchFormsFor(name: string, edition: EliteEdition): string[] {
  const forms = [
    name,                              // "Elite Boomer - ohne OVP"
    eliteDisplayNameFor(edition),      // "Eon's Elite Boomer"
    edition.baseName,                  // "Elite Boomer"
    edition.characterName,             // "Boomer"
  ];
  if (edition.editionLabel !== null) forms.push(edition.editionLabel);
  return forms;
}

/**
 * Sort key parts.
 *
 * Returned as separate values rather than one concatenated string: a joined
 * key would need a separator character, and how a collator ranks punctuation
 * against letters is exactly the kind of detail that quietly reorders things.
 *
 * Unchanged by V3.6, deliberately. The display name moved; where a figure
 * sits did not, because it never depended on the display name.
 */
export function sortPartsFor(
  name: string,
  variant: VariantInfo | null,
): { sortBaseName: string; sortVariantLabel: string | null } {
  return variant
    ? { sortBaseName: variant.baseName, sortVariantLabel: variant.variantLabel }
    : { sortBaseName: name, sortVariantLabel: null };
}
