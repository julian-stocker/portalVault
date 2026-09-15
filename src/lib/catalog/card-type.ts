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
 * figure is NAMED and SORTED — and that is a different question with a
 * different answer. The two overlap in vocabulary and nowhere else: a figure
 * can be `card_type: "dark"` and keep exactly the name it has today, and
 * nothing here ever reads a name.
 *
 * WHEN SEVERAL APPLY, THE HIGHEST WINS (V3.6)
 *
 *     legendary  >  dark  >  special  >  standard
 *
 * Real figures carry more than one mark. "Legendary Chill Light Core" is a
 * LightCore — which is a `special` form — and a Legendary. One row, one
 * column, one value, so the order above decides: it is `legendary`, and the
 * LightCore stays part of what the figure is called rather than of what it is
 * printed on. `EDITION_RANK` below is that rule, written down once.
 *
 * `chase` is deliberately OUTSIDE that chain. It answers a different
 * question — the same figure in a different finish — and a genuine Chase run
 * must never be swallowed by the broader `special`.
 *
 * `elite` is outside it too, for a different reason. Eon's Elite is a product
 * LINE, not a stronger edition of a figure: its members come from a curated
 * list of 42 rows (0032), never from a name, and no figure in the catalogue
 * is both an Eon's Elite and a Dark or a Legendary. It cannot compete, so it
 * is not ranked against the others.
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
export const CARD_TYPES = [
  "standard",
  "special",
  "elite",
  "dark",
  "legendary",
  "chase",
  "prestige",
] as const;

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
  special: "Special",
  elite: "Elite",
  dark: "Dark",
  legendary: "Legendary",
  chase: "Chase",
  prestige: "Prestige",
};

/**
 * Whether a value from outside is one of the six.
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

/**
 * WHICH MARK WINS WHEN A FIGURE CARRIES SEVERAL (V3.6).
 *
 * The one place the priority from the header is machine-readable. Higher is
 * stronger; `chase` sits deliberately outside the chain and is given the rank
 * of the plain figure, because it is not a stronger edition of anything — it
 * is the same edition in a different finish, and ranking it against the others
 * would invent a comparison the domain does not make.
 *
 * This does NOT classify anything at runtime. `card_type` is persisted and the
 * column is the truth (see the header); this exists so that the ONE list of
 * figures that a migration reclassifies can be checked against the rule, and
 * so that the catalogue can order a family deterministically.
 */
export const EDITION_RANK: Readonly<Record<CardType, number>> = {
  standard: 0,
  chase: 0,
  /* A product line, not a stronger edition — see the header. Assigned from a
     curated list, so it never meets the chain in the first place. */
  elite: 0,
  special: 1,
  dark: 2,
  legendary: 3,
  prestige: 4,
};

/**
 * The order a base figure's family is shown in (V3.6, operator's rule).
 *
 * Not `EDITION_RANK`: that answers "which mark is stronger", this answers
 * "what does a collector want to see first", and the operator put `chase`
 * between `special` and `dark` rather than beside the plain figure.
 */
export const FAMILY_ORDER: readonly CardType[] = [
  "standard",
  "special",
  /* Eon's Elite sits with the figure it is a version OF: after the plain
     figure and the broader special forms, before the finishes and editions. */
  "elite",
  "chase",
  "dark",
  "legendary",
  "prestige",
];

/** Where a card type sits in its family. Lower comes first. */
export function familyRank(cardType: CardType): number {
  return FAMILY_ORDER.indexOf(cardType);
}
