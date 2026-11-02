/**
 * Die Familie im Figureneditor (CAT-18, seit CAT-19 nach `0168`) — was der
 * Dialog zulässt, bevor er schreibt.
 *
 * REIN. Keine Datenbank; der Dialog fragt hier, die Datenbank prüft trotzdem.
 *
 * DIE REGEL (ADR-0171): eine Variante trägt immer die Familie ihrer
 * Basisfigur, auch „keine". Gepflegt wird sie NUR an der Basisfigur; die
 * Datenbank nimmt jede Variante mit (`0168`). Daraus folgen zwei Sperren:
 *
 *   1. AN EINER VARIANTE IST DIE FAMILIE NICHT BEARBEITBAR. Der Dialog zeigt
 *      sie nur. `0168` würde einen abweichenden Wert ohnehin abweisen. EINE
 *      Ausnahme: eine Altabweichung von VOR `0168` (Gold Chop Chop ohne
 *      Familie) darf ausdrücklich an die Basisfigur ANGEGLICHEN werden —
 *      genau auf deren Wert, nie auf einen anderen.
 *
 *   2. BASISFIGUR UND FAMILIE NICHT IN EINEM SPEICHERN. Wer die Basisfigur
 *      ändert, ändert damit die Familie (die Figur erbt die der neuen
 *      Basisfigur). Ein zweiter, ausdrücklicher Familienwert im selben
 *      Speichern hieße zwei Wege für eine Spalte.
 *
 * Eine Familie darf Figuren aus mehreren Serien enthalten (ADR-0034); das
 * prüft hier nichts, weil es kein Fehler ist.
 */
import type { AdminFigureDraft } from "@/lib/admin/figure-draft";

export type FamilyRef = { id: number; name: string };

export type FamilyBlocker =
  | { kind: "base-and-family" }
  | { kind: "variant" };

type Draftteil = Pick<AdminFigureDraft, "baseSkyId" | "characterId" | "newFamilyName">;

/** Hat der Bediener die Familie geändert (oder eine neue gewählt)? */
export function familyChanged(initial: Draftteil, draft: Draftteil): boolean {
  return (initial.characterId ?? null) !== (draft.characterId ?? null)
      || (draft.newFamilyName ?? null) !== null;
}

/** Hat der Bediener die Basisfigur geändert? */
export function baseChanged(initial: Draftteil, draft: Draftteil): boolean {
  return initial.baseSkyId !== draft.baseSkyId;
}

/** Ist die Figur (gespeichert) eine Variante? Dann erbt sie ihre Familie. */
export function familyIsInherited(initial: Draftteil): boolean {
  return initial.baseSkyId !== null;
}

/**
 * Was ein Speichern jetzt verhindert — oder `null`.
 *
 * `baseFamily` ist die Familie der gespeicherten Basisfigur (`null` für
 * keine). Nur auf genau sie darf eine Variante angeglichen werden.
 */
export function familyBlocker(
  initial: Draftteil,
  draft: Draftteil,
  baseFamily: FamilyRef | null = null,
): FamilyBlocker | null {
  if (!familyChanged(initial, draft)) return null;
  if (baseChanged(initial, draft)) return { kind: "base-and-family" };
  if (familyIsInherited(initial) && !isAlignment(draft, baseFamily)) return { kind: "variant" };
  return null;
}

/** Steht der Entwurf GENAU auf der Familie der Basisfigur? */
function isAlignment(draft: Draftteil, baseFamily: FamilyRef | null): boolean {
  return (draft.newFamilyName ?? null) === null
      && (draft.characterId ?? null) === (baseFamily?.id ?? null);
}

/**
 * Trägt eine Variante (gespeichert) eine andere Familie als ihre Basisfigur?
 * Das gibt es nur aus der Zeit vor `0168`; der Dialog bietet dann das
 * Angleichen an.
 */
export function inheritedDiffers(initial: Draftteil, baseFamily: FamilyRef | null): boolean {
  return familyIsInherited(initial) && (initial.characterId ?? null) !== (baseFamily?.id ?? null);
}

/** Den Entwurf an die Familie der Basisfigur angleichen. */
export function alignToBase<T extends Draftteil>(draft: T, baseFamily: FamilyRef | null): T {
  return { ...draft, characterId: baseFamily?.id ?? null, newFamilyName: null };
}

/** Eine bestehende Familie wählen — oder `null` für „keine". */
export function chooseFamily<T extends Draftteil>(draft: T, family: FamilyRef | null): T {
  return { ...draft, characterId: family?.id ?? null, newFamilyName: null };
}

/**
 * Eine neue Familie vormerken. Angelegt wird sie erst beim Speichern, und nur,
 * wenn es keine gleichnamige gibt (`existing` sind die Suchtreffer) — sonst
 * wählt man die bestehende (ADR-0168: wiederverwenden nur ausdrücklich).
 */
export function planNewFamily<T extends Draftteil>(
  draft: T,
  name: string,
  existing: readonly FamilyRef[],
): T | null {
  const sauber = name.trim();
  if (sauber === "" || sauber.length > 120) return null;
  if (existing.some((f) => f.name.toLowerCase() === sauber.toLowerCase())) return null;
  return { ...draft, characterId: null, newFamilyName: sauber };
}
