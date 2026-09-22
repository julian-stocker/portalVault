/**
 * Warum der Fingerabdruck einer bestehenden Gruppe nicht mehr stimmt — und
 * ob wir ihn deshalb neu stempeln dürfen (0088/0089).
 *
 * DAS PROBLEM, DAS DIESES MODUL LÖST
 *
 * Nach dem Sync muss der gespeicherte Abdruck wieder den Inhalt der
 * Arbeitsmappe beschreiben, sonst importiert der nächste Lauf die Gruppe ein
 * zweites Mal. Der naheliegende Weg — "stempele jede Gruppe neu, die der
 * Planer nicht wiedererkennt" — ist genau der falsche: er macht aus jeder
 * unverstandenen Abweichung eine stillschweigend akzeptierte.
 *
 * Denn ein Abdruck, der nicht mehr passt, sagt nur DASS sich etwas geändert
 * hat, nicht WAS. Stempeln wir ihn, ohne die Ursache zu kennen, behauptet die
 * Datenbank anschließend, mit der Mappe übereinzustimmen — und niemand
 * bemerkt je wieder, dass ein Feld nie übernommen wurde. Genau das wäre bei
 * `sales.sold_at` passiert: zwei Bestellungen hätten dauerhaft kein Datum.
 *
 * DESHALB WIRD JEDE ABWEICHUNG ERST ERKLÄRT, DANN GESTEMPELT.
 *
 * Drei Erklärungen sind zulässig, und jede setzt voraus, dass der Sync die
 * Ursache tatsächlich behebt:
 *
 *   item        Positionszeilen haben sich geändert — 0088 schreibt sie
 *   sold_at     das Verkaufsdatum hat sich geändert — 0089 schreibt es
 *   unpersisted ALLE gespeicherten canonical Felder stimmen nachweislich
 *               überein; übrig bleibt nur eine Komponente, die in keiner
 *               Spalte steht (heute `money.AE`)
 *
 * Alles andere ist `unexplained`, und dann wird nicht gestempelt und nicht
 * importiert. Fail closed.
 *
 * WARUM `unpersisted` ÜBERHAUPT ERLAUBT IST
 *
 * `canonicalSaleIdentity` hasht `money.AE`, eine Kontrollzahl der Mappe, die
 * nirgends gespeichert wird. Ändert sie sich, weicht der Abdruck ab, ohne
 * dass ein einziges Geschäftsdatum betroffen ist — und kein Vergleich der
 * Welt könnte es sehen. Diese Kategorie ist deshalb an eine harte Bedingung
 * geknüpft: sie gilt NUR, wenn jede prüfbare Komponente verifiziert gleich
 * ist. Sie ist eine Schlussfolgerung durch Ausschluss, keine Ausnahme.
 */

/** Die canonical Kopffelder, die in einer Spalte stehen und prüfbar sind. */
export const VERIFIABLE_HEADER_FIELDS = ["headerRow", "date", "buyer", "moneyU"] as const;
export type VerifiableHeaderField = (typeof VERIFIABLE_HEADER_FIELDS)[number];

/** Die canonical Komponente, die in keiner Spalte steht. */
export const UNPERSISTED_FIELDS = ["moneyAE"] as const;

/** Nur dieses Kopffeld hat einen Schreibpfad (0089). */
export const SYNCABLE_HEADER_FIELDS: readonly VerifiableHeaderField[] = ["date"];

export type HeaderDiff = { field: VerifiableHeaderField; from: string; to: string };

export type GroupFacts = {
  saleId: number;
  headerRow: number;
  /** Stimmt der gespeicherte Abdruck noch mit dem der Mappe überein? */
  fingerprintMatches: boolean;
  /** Abweichungen in prüfbaren Kopffeldern. */
  headerDiffs: readonly HeaderDiff[];
  /** Hat mindestens eine Positionszeile sich geändert oder ist neu? */
  itemsChanged: boolean;
  /**
   * Wurde JEDE prüfbare canonical Komponente tatsächlich verglichen?
   *
   * Konnte der Aufrufer eine davon nicht ermitteln — etwa weil die Kopfzeile
   * nur im Freitext steht und dort fehlte —, darf `unpersisted` nicht
   * geschlossen werden: der Ausschluss wäre dann keiner.
   */
  allVerifiableCompared: boolean;
};

export type GroupVerdict =
  | { kind: "in_sync" }
  | { kind: "item"; }
  | { kind: "sold_at"; from: string; to: string }
  | { kind: "item_and_sold_at"; from: string; to: string }
  | { kind: "unpersisted" }
  | { kind: "unexplained"; reason: string };

/**
 * Warum weicht diese Gruppe ab, und dürfen wir sie stempeln?
 *
 * Die Reihenfolge der Prüfungen ist keine Kosmetik: `unexplained` wird
 * zuerst festgestellt, damit ein nicht synchronisierbares Kopffeld nicht von
 * einer gleichzeitig vorhandenen, harmlosen Positionsänderung verdeckt wird.
 */
export function classifyGroup(facts: GroupFacts): GroupVerdict {
  const unsyncable = facts.headerDiffs.filter(
    (d) => !SYNCABLE_HEADER_FIELDS.includes(d.field));
  if (unsyncable.length > 0) {
    return {
      kind: "unexplained",
      reason: `Kopffeld ohne Schreibpfad: ${unsyncable.map((d) => `${d.field} "${d.from}"→"${d.to}"`).join(", ")}`,
    };
  }

  const dateDiff = facts.headerDiffs.find((d) => d.field === "date");

  if (facts.fingerprintMatches) {
    // Der Abdruck passt, aber etwas weicht ab — dann beschreibt er nicht,
    // was er zu beschreiben vorgibt. Das ist ein Widerspruch, kein Zustand.
    if (dateDiff !== undefined || facts.itemsChanged) {
      return {
        kind: "unexplained",
        reason: "Abdruck stimmt, obwohl sich Daten unterscheiden",
      };
    }
    return { kind: "in_sync" };
  }

  if (facts.itemsChanged && dateDiff !== undefined) {
    return { kind: "item_and_sold_at", from: dateDiff.from, to: dateDiff.to };
  }
  if (facts.itemsChanged) return { kind: "item" };
  if (dateDiff !== undefined) return { kind: "sold_at", from: dateDiff.from, to: dateDiff.to };

  /*
   * Nichts Prüfbares weicht ab, der Abdruck aber schon. Übrig bleibt eine
   * Komponente ohne Spalte. Das ist nur dann eine Erklärung, wenn wirklich
   * ALLES Prüfbare verglichen wurde — sonst ist es Unwissen mit Etikett.
   */
  if (!facts.allVerifiableCompared) {
    return {
      kind: "unexplained",
      reason: "nicht jede prüfbare canonical Komponente konnte verglichen werden",
    };
  }
  return { kind: "unpersisted" };
}

/**
 * Darf diese Gruppe neu gestempelt werden?
 *
 * Nur wenn ihre Abweichung erklärt ist. `in_sync` braucht keinen Stempel;
 * `unexplained` darf keinen bekommen.
 */
export function mayRestamp(verdict: GroupVerdict): boolean {
  return verdict.kind === "item" || verdict.kind === "sold_at"
    || verdict.kind === "item_and_sold_at" || verdict.kind === "unpersisted";
}

/** Braucht diese Gruppe einen `sold_at`-Schreibvorgang über 0089? */
export function needsSoldAt(verdict: GroupVerdict): { to: string } | null {
  return verdict.kind === "sold_at" || verdict.kind === "item_and_sold_at"
    ? { to: verdict.to } : null;
}

export type GroupPlan = {
  verdicts: Map<number, GroupVerdict>;
  restamp: number[];
  soldAtWrites: { saleId: number; soldAt: string }[];
  unexplained: { saleId: number; headerRow: number; reason: string }[];
};

/** Der Gruppenteil des Phase-A-Plans. */
export function planGroups(groups: readonly GroupFacts[]): GroupPlan {
  const verdicts = new Map<number, GroupVerdict>();
  const restamp: number[] = [];
  const soldAtWrites: { saleId: number; soldAt: string }[] = [];
  const unexplained: { saleId: number; headerRow: number; reason: string }[] = [];

  for (const facts of groups) {
    const verdict = classifyGroup(facts);
    verdicts.set(facts.saleId, verdict);
    if (verdict.kind === "unexplained") {
      unexplained.push({ saleId: facts.saleId, headerRow: facts.headerRow, reason: verdict.reason });
      continue;
    }
    const date = needsSoldAt(verdict);
    if (date !== null) soldAtWrites.push({ saleId: facts.saleId, soldAt: date.to });
    if (mayRestamp(verdict)) restamp.push(facts.saleId);
  }

  return { verdicts, restamp, soldAtWrites, unexplained };
}

/**
 * Das Tor vor dem Neuimport.
 *
 * Nach dem Sync und dem Neustempeln muss der Planer JEDE bestehende Gruppe
 * wiedererkennen. Bleibt auch nur eine `eligible`, ist entweder eine Ursache
 * unerkannt geblieben oder ein Stempel nicht angekommen — und der folgende
 * Importlauf würde sie als neue Gruppe anlegen. Dann lieber anhalten.
 */
export function importGateOpen(after: {
  existingStillEligible: number;
  newGroupsEligible: number;
  expectedNewGroups: number;
}): boolean {
  return after.existingStillEligible === 0
    && after.newGroupsEligible === after.expectedNewGroups;
}
