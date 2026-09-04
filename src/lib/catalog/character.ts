/**
 * Characters — the third identity in the catalog.
 *
 * A character is not a collectible. "Drobot" is one character; SKY-0028,
 * SKY-0156 and SKY-0157 are three collectibles of that character, priced
 * between 1,49 € and 104,71 €. Three identities stay apart (ADR-0034):
 *
 *   sky_id        the collectible — collection and shop hang off this
 *   character_id  groups collectibles into one character
 *   display name  presentation only, derived at read time (ADR-0030)
 *
 * Assignments are curated by hand and never derived from names. This module
 * holds the shared rules — the same validation the import tool runs, so a
 * unit test can reach it without a database.
 */
import type { CatalogFigure } from "@/lib/catalog/types";

/** The ten canonical elements. Mirrors the CHECK in migration 0002. */
export const ELEMENTS = [
  "Magic",
  "Tech",
  "Water",
  "Fire",
  "Life",
  "Undead",
  "Earth",
  "Air",
  "Light",
  "Dark",
] as const;
export type Element = (typeof ELEMENTS)[number];

/** Product lines, not game mechanics. Mirrors the CHECK in migration 0002. */
export const ROLE_TYPES = [
  "core",
  "giant",
  "swapper",
  "trap-master",
  "supercharger",
  "sensei",
  "mini",
  "sidekick",
] as const;
export type RoleType = (typeof ROLE_TYPES)[number];

export const MAX_DESCRIPTION_LENGTH = 600;

const SKY_ID = /^SKY-[0-9]{4}$/;
const ISO_DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

/** A character as the UI receives it. */
export type Character = {
  id: number;
  canonicalName: string;
  element: Element | null;
  species: string | null;
  roleType: RoleType | null;
  shortDescription: string | null;
  sourceUrl: string | null;
  sourceLabel: string | null;
  verifiedAt: string | null;
};

/** One entry of data/characters/characters.json. */
export type CuratedCharacter = {
  canonical_name: string;
  element: string | null;
  species: string | null;
  role_type: string | null;
  short_description: string | null;
  source_url: string | null;
  source_label: string | null;
  verified_at: string | null;
  sky_ids: string[];
};

export const CURATED_FIELDS = [
  "canonical_name",
  "element",
  "species",
  "role_type",
  "short_description",
  "source_url",
  "source_label",
  "verified_at",
  "sky_ids",
] as const;

const FILE_FIELDS = ["note", "characters"] as const;

export function isElement(value: unknown): value is Element {
  return typeof value === "string" && (ELEMENTS as readonly string[]).includes(value);
}

export function isRoleType(value: unknown): value is RoleType {
  return typeof value === "string" && (ROLE_TYPES as readonly string[]).includes(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

/**
 * Checks the curated file completely and reports every problem at once.
 *
 * Returns a list rather than throwing on the first fault: fixing curated data
 * one error per run would be miserable, and the import must never write a
 * partially validated file (the catalog import works the same way).
 *
 * `knownSkyIds` is what the database actually holds. Pass an empty set to
 * check only the shape — the SKY-ID existence check is then skipped, which is
 * what `--validate-only` does when it never opens a connection.
 */
export function validateCuratedFile(
  input: unknown,
  knownSkyIds: ReadonlySet<string>,
): { problems: string[]; characters: CuratedCharacter[] } {
  const problems: string[] = [];
  const characters: CuratedCharacter[] = [];

  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { problems: ["the file must contain a JSON object"], characters };
  }

  const file = input as Record<string, unknown>;
  for (const key of Object.keys(file)) {
    // An unknown top-level key usually means a typo, and a typo in curated
    // data is silent data loss. Reject rather than ignore.
    if (!(FILE_FIELDS as readonly string[]).includes(key)) {
      problems.push(`unknown top level field '${key}'`);
    }
  }
  if (!Array.isArray(file.characters)) {
    problems.push("'characters' must be an array");
    return { problems, characters };
  }

  const nameSeen = new Map<string, number>();
  const skyIdOwner = new Map<string, string>();

  file.characters.forEach((raw, index) => {
    const at = `characters[${index}]`;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      problems.push(`${at}: must be an object`);
      return;
    }
    const entry = raw as Record<string, unknown>;

    for (const key of Object.keys(entry)) {
      if (!(CURATED_FIELDS as readonly string[]).includes(key)) {
        problems.push(`${at}: unknown field '${key}'`);
      }
    }

    const name = entry.canonical_name;
    if (typeof name !== "string" || name.trim() === "") {
      problems.push(`${at}: canonical_name must be a non-empty string`);
      return;
    }
    const label = `${at} (${name})`;

    // Case-insensitive, matching the unique index in the database.
    const folded = name.toLowerCase();
    const earlier = nameSeen.get(folded);
    if (earlier !== undefined) {
      problems.push(`${label}: canonical_name already used by characters[${earlier}]`);
    } else {
      nameSeen.set(folded, index);
    }

    if (entry.element !== null && !isElement(entry.element)) {
      problems.push(
        `${label}: element '${String(entry.element)}' is not one of ${ELEMENTS.join(", ")} (use null when it is not reliably known)`,
      );
    }
    if (entry.role_type !== null && !isRoleType(entry.role_type)) {
      problems.push(
        `${label}: role_type '${String(entry.role_type)}' is not one of ${ROLE_TYPES.join(", ")}`,
      );
    }
    if (!isNullableString(entry.species)) {
      problems.push(`${label}: species must be a string or null`);
    }
    if (!isNullableString(entry.short_description)) {
      problems.push(`${label}: short_description must be a string or null`);
    } else if (
      typeof entry.short_description === "string" &&
      entry.short_description.length > MAX_DESCRIPTION_LENGTH
    ) {
      problems.push(
        `${label}: short_description is ${entry.short_description.length} characters, the limit is ${MAX_DESCRIPTION_LENGTH}. SkyIsles writes its own short summary, it does not carry an article.`,
      );
    }
    if (!isNullableString(entry.source_label)) {
      problems.push(`${label}: source_label must be a string or null`);
    }
    if (!isNullableString(entry.source_url)) {
      problems.push(`${label}: source_url must be a string or null`);
    } else if (typeof entry.source_url === "string" && !entry.source_url.startsWith("https://")) {
      problems.push(`${label}: source_url must start with https://`);
    }
    if (!isNullableString(entry.verified_at)) {
      problems.push(`${label}: verified_at must be a date string or null`);
    } else if (typeof entry.verified_at === "string" && !ISO_DATE.test(entry.verified_at)) {
      problems.push(`${label}: verified_at must be YYYY-MM-DD`);
    }

    if (!Array.isArray(entry.sky_ids) || entry.sky_ids.length === 0) {
      problems.push(`${label}: sky_ids must be a non-empty array`);
      return;
    }
    for (const skyId of entry.sky_ids) {
      if (typeof skyId !== "string" || !SKY_ID.test(skyId)) {
        problems.push(`${label}: '${String(skyId)}' is not a SKY-ID`);
        continue;
      }
      const owner = skyIdOwner.get(skyId);
      if (owner !== undefined) {
        // One collectible belongs to at most one character. Two owners would
        // mean the last import run silently wins.
        problems.push(`${label}: ${skyId} is already assigned to '${owner}'`);
        continue;
      }
      skyIdOwner.set(skyId, name);
      if (knownSkyIds.size > 0 && !knownSkyIds.has(skyId)) {
        problems.push(`${label}: ${skyId} does not exist in the catalog`);
      }
    }

    characters.push(entry as unknown as CuratedCharacter);
  });

  return { problems, characters };
}

/**
 * The series a character's first figure appeared in.
 *
 * Series positions follow release order, so the lowest one wins.
 *
 * IMPORTANT — this answers "which series brought the first figure of this
 * character", NOT "when did this character first appear". For 18 of the 19
 * pilot characters the two coincide. Kaos is the counterexample: he has been
 * the villain since Spyro's Adventure in 2011, but his first collectible
 * figure is the Imaginators Sensei. The UI therefore labels this "Erste
 * Figur" and not "Debüt" — a label that is true for every character rather
 * than a stored value that would be wrong for one of them (ADR-0034).
 */
export function firstReleaseSeries(
  figures: readonly CatalogFigure[],
): { code: string; label: string } | null {
  let earliest: CatalogFigure | null = null;
  for (const figure of figures) {
    if (!earliest || figure.seriesPosition < earliest.seriesPosition) earliest = figure;
  }
  return earliest ? { code: earliest.seriesCode, label: earliest.seriesLabel } : null;
}
