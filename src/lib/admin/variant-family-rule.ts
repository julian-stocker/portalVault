/**
 * Which family a variant ends up in when its base figure is set (CAT-15).
 *
 * WHY THIS EXISTS
 *
 * `admin_set_variant_base` (`0159`) knows two family moves: carry the base's
 * family over, or — with `p_create_family` — create a NEW family named after
 * the base figure. It does not look for one that already exists. Families
 * are cross-series (ADR-0034): "Hex" was created for Spyro's Adventure
 * (SKY-0043), and setting Giants' Hex Light Core (SKY-0166) onto Giants' Hex
 * (SKY-0164) then asked `admin_create_character("Hex")` for a second one —
 * which `0158` correctly refused:
 *
 *   0158: die Familie "Hex" gibt es schon (id 139). Sie auswaehlen, statt
 *   eine zweite anzulegen.
 *
 * WHY NOT `0161`'S AUTOMATIC REUSE. `admin_publish_variant_auto` reuses an
 * equally named family after a word-boundary veto over its members. Measured
 * against Staging on 2026-11-01 that veto rejects 60 of today's members —
 * raw names like "Hex (Pearl)" or "Elite Slam Bam - ohne OVP" never end on
 * the family name — so it would refuse exactly the cases it should solve.
 * And equal names alone prove nothing (ADR-0034: "Kaos" is three things).
 *
 * SO AN EXISTING FAMILY IS REUSED ONLY WHEN THE OPERATOR CONFIRMS IT. The
 * editor shows the family and its members; one tick assigns it. Without it
 * nothing is created — a duplicate can no longer arise from this path.
 *
 * PURE. No database; the caller reads, this decides, the RPCs still check.
 */

/**
 * How `setVariantBase` treats the family:
 *
 *   * `false`             — leave it to `0159` (carry over, or nothing).
 *   * `true`              — when neither side has one: create one named after
 *                           the base, but ONLY if no family of that name exists.
 *   * `{ reuseFamilyId }` — when neither side has one: assign this existing,
 *                           same-named family to base and variant (confirmed).
 *   * `"adopt-base"`      — correct a wrong family: the variant takes the
 *                           base's family (or none), then the base is set.
 */
export type VariantFamilyMode = boolean | "adopt-base" | { reuseFamilyId: number };

export type FamilyRef = { id: number; name: string };
export type FamilyMember = { skyId: string; name: string };

export type VariantFamilyOutcome =
  /** The base has a family, the variant none: `0159` carries it over. */
  | { kind: "carry"; family: FamilyRef }
  /** Both already in the same family. */
  | { kind: "same"; family: FamilyRef }
  /** Both have a family, and they differ: `0159` refuses. */
  | { kind: "conflict"; variant: FamilyRef; base: FamilyRef }
  /** Only the variant has one; `0159` keeps it and leaves the base alone. */
  | { kind: "variant-only"; variant: FamilyRef }
  /** Neither has one; a family with the base's exact name exists — reuse needs a confirmation. */
  | { kind: "existing"; family: FamilyRef; members: FamilyMember[] }
  /** Neither has one and none exists by that name: one would be created. */
  | { kind: "create"; name: string }
  /** Neither has one, and no family is wanted (not a character figure). */
  | { kind: "none" };

export function resolveVariantFamily(input: {
  variantFamily: FamilyRef | null;
  baseFamily: FamilyRef | null;
  /** The base figure's stored name (`skylanders.name`, as `0159` names a new family). */
  baseName: string;
  /** The family whose name EQUALS the base's name (case-insensitively), if any. */
  sameNameFamily: FamilyRef | null;
  /** That family's members, shown so the operator can confirm it. */
  sameNameMembers: readonly FamilyMember[];
  /** Whether a family may be created or reused at all (character figures only). */
  familyWanted: boolean;
}): VariantFamilyOutcome {
  const { variantFamily: v, baseFamily: b } = input;
  if (b !== null) {
    if (v === null) return { kind: "carry", family: b };
    if (v.id === b.id) return { kind: "same", family: b };
    return { kind: "conflict", variant: v, base: b };
  }
  if (v !== null) return { kind: "variant-only", variant: v };
  if (!input.familyWanted) return { kind: "none" };
  const found = input.sameNameFamily;
  /* EQUALITY, never similarity: "Slam Bam Light Core" is not "Slam Bam". */
  if (found !== null && found.name.toLowerCase() === input.baseName.trim().toLowerCase()) {
    return { kind: "existing", family: found, members: [...input.sameNameMembers] };
  }
  return { kind: "create", name: input.baseName.trim() };
}
