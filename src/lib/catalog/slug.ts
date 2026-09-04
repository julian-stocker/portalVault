/**
 * URL slugs for catalog figures.
 *
 * The rule is fixed in ADR-0011 and verified against the real 600 legacy
 * articles. Two properties matter more than anything else here:
 *
 *   1. The slug is navigation only. The SKY-ID is the identity, and no
 *      foreign key or calculation depends on the slug.
 *   2. Once assigned, a slug never changes on its own. Renaming a figure does
 *      not move its URL.
 */

/**
 * German umlauts are spelled out; ü becomes ue, not u.
 *
 * Matched case-insensitively: the current catalog only contains a lowercase
 * "ü", but an uppercase one would otherwise silently degrade to a bare vowel
 * during the NFKD pass below. The replacements are lowercase because the
 * result is lowercased anyway.
 */
const UMLAUTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/ä/gi, "ae"],
  [/ö/gi, "oe"],
  [/ü/gi, "ue"],
  [/ß/g, "ss"],
  [/ẞ/g, "ss"],
];

/**
 * Normalises a name into slug form.
 *
 * Order matters: umlauts are expanded before the accent-stripping pass, or
 * "ü" would collapse to a bare "u".
 *
 * Apostrophes are removed without replacement — "Spyro's" becomes "spyros",
 * not "spyro-s". Bracket characters disappear but their content is kept,
 * because it carries meaning throughout the catalog: (2), (Clear Crystal),
 * (Xbox 360), (Legendary).
 */
export function slugify(name: string): string {
  let value = name;
  for (const [pattern, replacement] of UMLAUTS) {
    value = value.replace(pattern, replacement);
  }
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // combining marks left by NFKD
    .toLowerCase()
    .replace(/['’]/g, "") // apostrophes vanish, never become separators
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Slug of a series, taken from its label — "giants", not "g" (ADR-0011). */
export function seriesSlug(label: string): string {
  return slugify(label);
}

export type SlugCandidate = {
  skyId: string;
  name: string;
  seriesLabel: string;
};

export type SlugAssignment = {
  skyId: string;
  slug: string;
  /** Which stage of the rule produced this slug. */
  stage: "name" | "series" | "sky-id" | "existing";
};

/**
 * Assigns slugs to a set of figures.
 *
 * `existing` maps SKY-ID to an already stored slug. Those are returned
 * unchanged — the stability guarantee from ADR-0011. Their values are also
 * treated as taken, so a newly imported figure whose name collides with an
 * existing one is the only side that gets qualified.
 *
 * On a first import `existing` is empty and every figure is new, so both
 * sides of a collision are qualified: "drobot-spyros-adventure" and
 * "drobot-giants".
 */
export function assignSlugs(
  candidates: readonly SlugCandidate[],
  existing: ReadonlyMap<string, string> = new Map(),
): SlugAssignment[] {
  const assignments: SlugAssignment[] = [];
  const taken = new Set<string>(existing.values());

  // Figures that already have a slug keep it, no questions asked.
  const fresh: SlugCandidate[] = [];
  for (const candidate of candidates) {
    const known = existing.get(candidate.skyId);
    if (known !== undefined) {
      assignments.push({ skyId: candidate.skyId, slug: known, stage: "existing" });
    } else {
      fresh.push(candidate);
    }
  }

  // Within one import run, a base slug used more than once is qualified on
  // every side. Without this the first figure would keep the bare slug purely
  // because of input order, which is not a defensible reason.
  const baseCount = new Map<string, number>();
  for (const candidate of fresh) {
    const base = slugify(candidate.name);
    baseCount.set(base, (baseCount.get(base) ?? 0) + 1);
  }

  for (const candidate of fresh) {
    const base = slugify(candidate.name);
    const contested = (baseCount.get(base) ?? 0) > 1 || taken.has(base);

    let slug = base;
    let stage: SlugAssignment["stage"] = "name";

    if (contested) {
      slug = `${base}-${seriesSlug(candidate.seriesLabel)}`;
      stage = "series";
    }
    if (taken.has(slug)) {
      slug = `${slug}-${slugify(candidate.skyId)}`;
      stage = "sky-id";
    }

    taken.add(slug);
    assignments.push({ skyId: candidate.skyId, slug, stage });
  }

  return assignments;
}
