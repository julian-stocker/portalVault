/**
 * The character behind a figure.
 *
 * A distinct surface, deliberately: a character is not a property of the
 * collectible above it (ADR-0034). Drobot is one character; SKY-0028 is one
 * of three collectibles of him, at its own price. The panel therefore names
 * the character itself and sits on `surface-raised`, so it reads as an
 * inset about something else rather than as more fields of the figure.
 *
 * Entirely optional. Today 104 of 561 collectibles carry a character, and
 * the detail page of the other 457 must look finished without this block —
 * not like something failed to load. Every field renders only if it holds a
 * value, so a half-curated character shows what is known and nothing else.
 *
 * Nothing here is derived from the figure's name. What is shown was curated
 * by hand.
 */
import type { ReactNode } from "react";

import type { Character } from "@/lib/catalog/character";
import { elementPanelClass, elementLabel } from "@/lib/catalog/element";
import { de } from "@/lib/i18n/de";

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-sm font-medium">{children}</dd>
    </div>
  );
}

export function ElementChip({ element, size = "sm" }: { element: string; size?: "sm" | "xs" }) {
  return (
    <span
      className={
        "inline-block rounded-full border border-current/40 leading-none font-medium " +
        (size === "xs" ? "px-1.5 py-0.5 text-[11px] " : "px-2 py-1 text-xs ") +
        elementPanelClass(element as Parameters<typeof elementPanelClass>[0])
      }
    >
      {elementLabel(element as Parameters<typeof elementLabel>[0])}
    </span>
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
  const facts = [
    character.element
      ? { label: de.character.element, value: <ElementChip element={character.element} /> }
      : null,
    character.species ? { label: de.character.species, value: character.species } : null,
    character.roleType
      ? { label: de.character.role, value: de.character.roles[character.roleType] }
      : null,
    // "Erste Figur", not "Debüt": this is the first collectible of the
    // character, which for Kaos is Imaginators even though he has been the
    // villain since 2011 (ADR-0034).
    firstReleaseLabel ? { label: de.character.firstRelease, value: firstReleaseLabel } : null,
  ].filter((fact) => fact !== null);

  // A panel with a heading and nothing under it is worse than no panel.
  if (facts.length === 0 && !character.shortDescription) return null;

  return (
    <section
      aria-labelledby="character-heading"
      className="rounded-sky-lg bg-surface/80 p-5 ring-1 ring-border/70 backdrop-blur-sm md:p-6"
    >
      <p className="text-xs tracking-wide text-muted uppercase">{de.character.heading}</p>
      <h2 id="character-heading" className="mt-1 text-lg font-semibold tracking-tight">
        {character.canonicalName}
      </h2>

      {facts.length > 0 ? (
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          {facts.map((fact) => (
            <Fact key={fact.label} label={fact.label}>
              {fact.value}
            </Fact>
          ))}
        </dl>
      ) : null}

      {character.shortDescription ? (
        <p className="mt-5 max-w-prose text-sm leading-relaxed">{character.shortDescription}</p>
      ) : null}

      {character.sourceUrl && character.sourceLabel ? (
        /* One quiet line. The facts above were checked against it, and a
           collector database that cannot say where a fact came from is worth
           less — but the provenance date stays out of the UI: it is for
           curation, not for reading. */
        <p className="mt-4 text-xs text-muted">
          <a
            href={character.sourceUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="underline underline-offset-2 hover:text-foreground"
          >
            {de.character.source(character.sourceLabel)}
          </a>
        </p>
      ) : null}
    </section>
  );
}
