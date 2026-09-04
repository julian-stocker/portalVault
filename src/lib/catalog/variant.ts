/**
 * Variant display names.
 *
 * The catalog spells variants inconsistently: "Legendary Astroblast" as a
 * prefix, but "Hex (Pearl)" as a suffix. Both come from the legacy
 * spreadsheet and are taken verbatim — the canonical name is never rewritten
 * (CLAUDE.md rule 4, docs/SKYLANDERS_DATA.md import rule 4). Renaming in the
 * database would also be pointless: the import writes `name` on every run and
 * would silently undo it.
 *
 * So the display name is DERIVED at read time and the database is untouched.
 *
 * THE RULE, deliberately conservative: a leading token counts as a variant
 * only when the remaining text exists as a collectible entry in the SAME
 * series. That second condition is what separates a variant from a name:
 *
 *   "Legendary Bash"   -> "Bash" exists in SA        -> Bash (Legendary)
 *   "Dark Sword"       -> "Sword" does not exist     -> unchanged
 *                         (traps are named <element> <shape>: Air Sword,
 *                          Earth Hammer, Dark Sword — "Dark" is the element)
 *   "Golden Queen"     -> "Queen" does not exist     -> unchanged
 *   "Elite Bash"       -> "Elite" is not a token     -> unchanged
 *                         (Eon's Elite is a product line, not a finish)
 *   "Fire Bone Hot Dog"-> not a token                -> unchanged
 *
 * Measured against the real catalog on 2026-09-04: 55 entries are recognised,
 * 11 candidates correctly rejected, 0 display-name collisions within a series.
 */

/**
 * Tokens that mark a finish or edition rather than a distinct character.
 *
 * "Elite" and "Enchanted" are deliberately absent: Eon's Elite is its own
 * product line, and the only "Enchanted" prefix is a location.
 */
export const VARIANT_TOKENS: readonly string[] = [
  "Legendary",
  "Dark",
  "Nitro",
  "Golden",
  "Power Blue",
  "Blue",
  "Mystical",
  "Metallic",
];

/** Longest first, so "Power Blue" is tried before "Blue". */
const TOKENS_BY_LENGTH = [...VARIANT_TOKENS].sort((a, b) => b.length - a.length);

export type VariantInfo = {
  /** The figure this one is a variant of, e.g. "Astroblast". */
  baseName: string;
  /** The finish, e.g. "Legendary". */
  variantLabel: string;
};

/**
 * Recognises a variant, or returns null when the name stands on its own.
 *
 * `namesInSeries` must hold the collectible names of the same series —
 * that lookup is the whole safety mechanism.
 */
export function parseVariant(
  name: string,
  namesInSeries: ReadonlySet<string>,
): VariantInfo | null {
  for (const token of TOKENS_BY_LENGTH) {
    const prefix = `${token} `;
    if (!name.startsWith(prefix)) continue;

    const baseName = name.slice(prefix.length);
    if (baseName === "") continue;
    // The decisive test: is there really a base figure to be a variant of?
    if (!namesInSeries.has(baseName)) continue;

    return { baseName, variantLabel: token };
  }
  return null;
}

/** "Legendary Astroblast" becomes "Astroblast (Legendary)". */
export function displayNameFor(name: string, variant: VariantInfo | null): string {
  return variant ? `${variant.baseName} (${variant.variantLabel})` : name;
}

/**
 * Everything a search should be able to find this figure by.
 *
 * Three forms, because people type all of them: the canonical name
 * ("Legendary Bash"), the displayed name ("Bash (Legendary)"), and the plain
 * word order in between ("Bash Legendary").
 */
export function searchFormsFor(name: string, variant: VariantInfo | null): string[] {
  if (!variant) return [name];
  return [
    name,
    displayNameFor(name, variant),
    `${variant.baseName} ${variant.variantLabel}`,
  ];
}

/**
 * Sort key parts.
 *
 * Returned as separate values rather than one concatenated string: a joined
 * key would need a separator character, and how a collator ranks punctuation
 * against letters is exactly the kind of detail that quietly reorders things.
 * Comparing base name first, then "base before variant", then the label,
 * keeps a family together even when another figure starts with the same word
 * — "Bash", "Bash (Legendary)", then "Bash Junior".
 */
export function sortPartsFor(
  name: string,
  variant: VariantInfo | null,
): { sortBaseName: string; sortVariantLabel: string | null } {
  return variant
    ? { sortBaseName: variant.baseName, sortVariantLabel: variant.variantLabel }
    : { sortBaseName: name, sortVariantLabel: null };
}
