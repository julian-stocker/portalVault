/**
 * Was die aktualisierte Arbeitsmappe an der bestehenden Orderbuchhistorie
 * ändert — als Plan, bevor irgendetwas geschrieben wird (0088).
 *
 * WARUM DIESES MODUL EXISTIERT
 *
 * Die beiden Importer sind insert-only. Sie erkennen eine bekannte Gruppe an
 * ihrem Fingerabdruck, und der hasht die Positionszeilen samt Namen, Flags
 * und SKY-ID mit. Korrigiert der Betreiber eine Flag, ändert sich der
 * Abdruck, die Gruppe gilt als unbekannt — und wird ein zweites Mal
 * angelegt. Das ist kein hypothetisches Risiko: gemessen wären es 29
 * Verkäufe mit 223 Positionen und 4 Einkäufe mit 15 Positionen gewesen.
 *
 * DIE IDENTITÄT IST DIE QUELLZEILE
 *
 * `source_row` ist das einzige Feld, das eine Pflege der Mappe überlebt.
 * Name, Flags und SKY-ID sind genau das, was korrigiert wird; sie als
 * Identität zu benutzen hieße, die Zeile nach ihrer Korrektur nicht mehr
 * wiederzufinden — derselbe Fehler wie der Fingerabdruck, nur eine Ebene
 * tiefer.
 *
 * FAIL CLOSED, UND ZWAR VOR DEM SCHREIBEN
 *
 * Der Plan wird verworfen, sobald etwas nicht eindeutig ist: eine doppelte
 * Quellzeile, eine Gruppe, deren Zeilen auf zwei Datenbankgruppen zeigen,
 * eine Zeile, die die Mappe nicht mehr kennt. Nichts davon wird geraten und
 * nichts davon wird gelöscht — eine verschwundene Zeile ist eine Frage an
 * den Betreiber, keine Anweisung an das Werkzeug.
 *
 * DIESES MODUL RECHNET NUR. Es kennt keine Datenbank, keine Excel-Datei und
 * keinen Schreibpfad; es bekommt zwei Listen und gibt einen Plan zurück.
 * Deshalb ist es ohne Netz und ohne Arbeitsmappe testbar.
 */

/** Eine Positionszeile, wie die Arbeitsmappe sie hergibt. */
export type WorkbookLine = {
  /** Die Identität. Die Zeilennummer im Blatt `Order 2026`. */
  sourceRow: number;
  /** Kopfzeile der Gruppe, zu der sie gehört. */
  headerRow: number;
  /**
   * Die laufende Nummer aus der Mappe (Spalte E bzw. N).
   *
   * Dieselbe Quelle, die `buildPayload` beim Erstimport verwendet hat — eine
   * neu eingefügte Zeile bekommt damit die Nummer, die der Betreiber ihr
   * gegeben hat, statt einer angehängten.
   */
  position: number;
  rawName: string;
  skyId: string | null;
  /** Spalte L beim Verkauf, Spalte D beim Einkauf. */
  stockFlag: string;
  /** Spalte M beim Verkauf, Spalte C beim Einkauf. */
  secondFlag: string;
};

/** Eine Positionszeile, wie sie in der Datenbank steht. */
export type StoredLine = {
  id: number;
  groupId: number;
  sourceRow: number | null;
  rawName: string;
  skyId: string | null;
  stockFlag: string | null;
  secondFlag: string | null;
};

export type LineUpdate = {
  id: number;
  groupId: number;
  sourceRow: number;
  /** Nur die Felder, die sich wirklich unterscheiden — für den Bericht. */
  changes: { field: string; from: string; to: string }[];
  line: WorkbookLine;
};

export type LineInsert = {
  /** Die bestehende Gruppe, in die sie gehört, oder null für eine neue. */
  groupId: number | null;
  line: WorkbookLine;
};

export type SyncProblem = {
  kind:
    | "duplicate_source_row"     // zwei Zeilen beanspruchen dieselbe Nummer
    | "group_split"              // eine Mappen-Gruppe zeigt auf mehrere DB-Gruppen
    | "missing_in_workbook"      // die Datenbank kennt eine Zeile, die Mappe nicht
    | "stored_without_source";   // eine Legacy-Zeile ohne Quellzeile
  detail: string;
};

export type SyncPlan = {
  unchanged: number;
  updates: LineUpdate[];
  /** Zeilen für Gruppen, die es schon gibt. */
  insertsIntoExistingGroup: LineInsert[];
  /** Zeilen, deren ganze Gruppe neu ist, nach Kopfzeile gebündelt. */
  newGroups: Map<number, WorkbookLine[]>;
  problems: SyncProblem[];
  /** Gruppen, deren Inhalt sich geändert hat — ihr Abdruck muss neu. */
  groupsNeedingFingerprint: Set<number>;
};

const text = (value: string | null | undefined): string => (value ?? "").trim();

/**
 * Den Plan bilden.
 *
 * `stored` enthält ausschließlich Legacy-Zeilen. Operative Bestellungen und
 * von Hand angelegte Einkäufe gehören nicht hinein und werden vom Aufrufer
 * gefiltert — dieses Modul könnte den Unterschied nicht sehen, und eine
 * Funktion, die ihn raten müsste, wäre die falsche Stelle dafür.
 */
export function planLegacySync(
  workbook: readonly WorkbookLine[],
  stored: readonly StoredLine[],
): SyncPlan {
  const problems: SyncProblem[] = [];

  // 1. Beide Seiten müssen für sich eindeutig sein.
  const storedByRow = new Map<number, StoredLine>();
  for (const row of stored) {
    if (row.sourceRow === null) {
      problems.push({
        kind: "stored_without_source",
        detail: `Zeile ${row.id} in Gruppe ${row.groupId} hat keine Quellzeile`,
      });
      continue;
    }
    const seen = storedByRow.get(row.sourceRow);
    if (seen !== undefined) {
      problems.push({
        kind: "duplicate_source_row",
        detail: `Quellzeile ${row.sourceRow} gehört ${seen.id} und ${row.id}`,
      });
      continue;
    }
    storedByRow.set(row.sourceRow, row);
  }

  const workbookByRow = new Map<number, WorkbookLine>();
  for (const line of workbook) {
    if (workbookByRow.has(line.sourceRow)) {
      problems.push({
        kind: "duplicate_source_row",
        detail: `Arbeitsmappe nennt Zeile ${line.sourceRow} zweimal`,
      });
      continue;
    }
    workbookByRow.set(line.sourceRow, line);
  }

  // 2. Welche Datenbankgruppe gehört zu welcher Kopfzeile der Mappe?
  //    Abgeleitet aus den Zeilen, nicht geraten — und widersprüchliche
  //    Zuordnungen brechen den Plan, statt eine davon zu bevorzugen.
  const groupOfHeader = new Map<number, Set<number>>();
  for (const line of workbookByRow.values()) {
    const match = storedByRow.get(line.sourceRow);
    if (match === undefined) continue;
    const set = groupOfHeader.get(line.headerRow) ?? new Set<number>();
    set.add(match.groupId);
    groupOfHeader.set(line.headerRow, set);
  }
  const resolvedGroup = new Map<number, number>();
  for (const [header, groups] of groupOfHeader) {
    if (groups.size === 1) resolvedGroup.set(header, [...groups][0]);
    else {
      problems.push({
        kind: "group_split",
        detail: `Kopfzeile ${header} verteilt sich auf Gruppen ${[...groups].sort().join(", ")}`,
      });
    }
  }

  // 3. Zeile für Zeile vergleichen.
  let unchanged = 0;
  const updates: LineUpdate[] = [];
  const insertsIntoExistingGroup: LineInsert[] = [];
  const newGroups = new Map<number, WorkbookLine[]>();
  const groupsNeedingFingerprint = new Set<number>();

  for (const line of workbookByRow.values()) {
    const match = storedByRow.get(line.sourceRow);
    if (match === undefined) {
      const groupId = resolvedGroup.get(line.headerRow);
      if (groupId === undefined) {
        const list = newGroups.get(line.headerRow) ?? [];
        list.push(line);
        newGroups.set(line.headerRow, list);
      } else {
        insertsIntoExistingGroup.push({ groupId, line });
        groupsNeedingFingerprint.add(groupId);
      }
      continue;
    }

    const changes: { field: string; from: string; to: string }[] = [];
    const compare = (field: string, from: string | null, to: string) => {
      if (text(from) !== text(to)) changes.push({ field, from: text(from), to: text(to) });
    };
    compare("raw_name", match.rawName, line.rawName);
    /*
     * A SKY-ID IS ONLY EVER SET, NEVER CLEARED.
     *
     * The workbook resolves a figure through the formula in column P, and 23
     * imported sale rows carry a mapping the workbook itself cannot produce:
     * the importer found them from the owner's own references to the same
     * name elsewhere (0071). Comparing against "what column P says today"
     * would read those as "the workbook wants NULL" and throw the mapping
     * away — the preview showed exactly that before this guard existed.
     *
     * So a resolved id may correct a different resolved id, and may fill an
     * empty one. An unresolved workbook row leaves whatever is stored alone.
     * Removing a mapping stays a deliberate act, not a side effect of a
     * missing formula.
     */
    if (line.skyId !== null && line.skyId !== "") {
      compare("sky_id", match.skyId, line.skyId);
    }
    compare("stock_flag", match.stockFlag, line.stockFlag);
    compare("second_flag", match.secondFlag, line.secondFlag);

    if (changes.length === 0) unchanged += 1;
    else {
      updates.push({ id: match.id, groupId: match.groupId, sourceRow: line.sourceRow, changes, line });
      groupsNeedingFingerprint.add(match.groupId);
    }
  }

  // 4. Was die Datenbank kennt und die Mappe nicht mehr.
  //    NICHT gelöscht. Eine verschwundene Zeile kann eine gelöschte Bestellung
  //    sein oder eine verschobene — das entscheidet der Betreiber.
  for (const [row, stored_] of storedByRow) {
    if (!workbookByRow.has(row)) {
      problems.push({
        kind: "missing_in_workbook",
        detail: `Zeile ${stored_.id} (Quellzeile ${row}, "${stored_.rawName}") fehlt in der Mappe`,
      });
    }
  }

  return { unchanged, updates, insertsIntoExistingGroup, newGroups, problems, groupsNeedingFingerprint };
}

/** Darf dieser Plan geschrieben werden? */
export const planIsClean = (plan: SyncPlan): boolean => plan.problems.length === 0;

/** Nichts zu tun — das Ergebnis, das ein zweiter Lauf liefern muss. */
export const planIsEmpty = (plan: SyncPlan): boolean =>
  plan.updates.length === 0
  && plan.insertsIntoExistingGroup.length === 0
  && plan.newGroups.size === 0;
