/**
 * What kind of card a figure is drawn on (V3.5).
 *
 * WHAT THIS IS
 *
 * A permanent, editorial classification of the collectible itself: this is a
 * Dark variant, that one is a Legendary, this one is a colour or material
 * chase. It decides one thing and nothing else — which base artwork the card
 * is printed on.
 *
 * WHAT IT IS NOT
 *
 * It is NOT ownership. "In my collection" is a per-viewer state that overrides
 * the artwork at render time and never touches this value; there is no
 * `collection` card type and there must not be one (see `COLLECTION_ARTWORK`).
 *
 * It is NOT the variant system either. `lib/catalog/variant.ts` decides how a
 * figure is NAMED and SORTED — "Dark Spyro" becomes "Spyro (Dark)" — and that
 * is a different question with a different answer. A figure can be
 * `card_type: "dark"` and keep exactly the name it has today. The two systems
 * are deliberately not coupled: `VARIANT_TOKENS` knows nothing about Chase,
 * and nothing here reads a name.
 *
 * And it is NOT a complete taxonomy of Skylanders editions. A seasonal, event
 * or marketing variant is a real thing that this list has no word for, and it
 * stays `standard` until somebody decides otherwise in the admin.
 *
 * THE SOURCE OF TRUTH IS THE COLUMN
 *
 * After the one-off backfill, `skylanders.card_type` is the only thing that
 * decides the artwork. No `name.includes(…)` at render time, no re-derivation
 * from `parseVariant()`, no client-side guess — an administrator's correction
 * must outlive every later import and every later rename.
 */

/**
 * Every card type, in the order the admin select offers them.
 *
 * The same shape `CATALOG_GROUPS` uses, for the same reason: one list, from
 * which the type, the labels, the validation and the artwork map are all
 * derived, so none of them can drift out of step with the others. The SQL
 * CHECK constraint is held against this list by a test.
 */
export const CARD_TYPES = ["standard", "dark", "legendary", "chase", "prestige"] as const;

export type CardType = (typeof CARD_TYPES)[number];

/** What a figure is when nobody has said otherwise. Also the column default. */
export const DEFAULT_CARD_TYPE: CardType = "standard";

/**
 * The German labels, which happen to be the English words.
 *
 * Deliberately not translated: "Legendary" and "Chase" are what collectors
 * call these, in German as much as in English, and "Jagdkarte" would be a
 * word this hobby does not use (ADR-0019 asks for German UI, not for German
 * invented where the domain speaks English).
 */
export const CARD_TYPE_LABELS: Readonly<Record<CardType, string>> = {
  standard: "Standard",
  dark: "Dark",
  legendary: "Legendary",
  chase: "Chase",
  prestige: "Prestige",
};

/**
 * Whether a value from outside is one of the five.
 *
 * The CHECK constraint is the real guarantee; this is what keeps a value the
 * application does not know yet — after a later migration, against an older
 * build — out of the type instead of into a broken artwork lookup. Same guard
 * `isCatalogGroup()` provides, for the same reason.
 */
export function isCardType(value: unknown): value is CardType {
  return typeof value === "string" && (CARD_TYPES as readonly string[]).includes(value);
}

/** A row's card type, or the default when it is missing or unknown. */
export function asCardType(value: unknown): CardType {
  return isCardType(value) ? value : DEFAULT_CARD_TYPE;
}
