/**
 * The character behind a figure.
 *
 * Entirely optional. Today 104 of 561 collectibles carry a character, and the
 * detail page of the other 457 must look finished without this block — not
 * like something failed to load. Every field is rendered only if it holds a
 * value, so a half-curated character shows what is known and nothing else.
 *
 * Nothing here is derived from the figure's name. What is shown was curated
 * by hand (ADR-0034).
 */
import type { Character } from "@/lib/catalog/character";
import { de } from "@/lib/i18n/de";
import { formatDate } from "@/lib/format";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-sm font-medium">{value}</dd>
    </div>
  );
}

export function CharacterPanel({
  character,
  firstReleaseLabel,
}: {
  character: Character;
  /** Derived from the linked figures, not stored. Null when undeterminable. */
  firstReleaseLabel: string | null;
}) {
  const role = character.roleType ? de.character.roles[character.roleType] : null;
  const rows = [
    character.element ? { label: de.character.element, value: character.element } : null,
    character.species ? { label: de.character.species, value: character.species } : null,
    role ? { label: de.character.role, value: role } : null,
    firstReleaseLabel ? { label: de.character.firstRelease, value: firstReleaseLabel } : null,
  ].filter((row) => row !== null);

  // A panel with a heading and nothing under it is worse than no panel.
  if (rows.length === 0 && !character.shortDescription) return null;

  return (
    <section className="rounded-lg border border-border p-4">
      <h2 className="text-xs tracking-wide text-muted uppercase">{de.character.heading}</h2>
      <p className="mt-1 font-medium">{character.canonicalName}</p>

      {rows.length > 0 ? (
        <dl className="mt-3 flex flex-col gap-1.5">
          {rows.map((row) => (
            <Row key={row.label} label={row.label} value={row.value} />
          ))}
        </dl>
      ) : null}

      {character.shortDescription ? (
        <p className="mt-3 text-sm leading-relaxed">{character.shortDescription}</p>
      ) : null}

      {character.sourceUrl && character.sourceLabel ? (
        <p className="mt-3 text-xs text-muted">
          <a
            href={character.sourceUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="underline"
          >
            {de.character.source(character.sourceLabel)}
          </a>
          {character.verifiedAt ? ` · ${de.character.verified(formatDate(character.verifiedAt))}` : null}
        </p>
      ) : null}
    </section>
  );
}
