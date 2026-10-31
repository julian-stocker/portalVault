/**
 * TOR 1b DES KATALOG-PUBLISH — sind alle Charakterreferenzen auflösbar?
 *
 * Rein, ohne Datenbank, ohne Netz. Der Apply-Pfad ruft das hier VOR dem
 * ersten Schreibzugriff auf; getestet wird es in
 * `sync-character-gate.test.ts` ohne jeden Zugang.
 *
 * ===========================================================================
 * WARUM ES DIESES TOR GIBT
 * ===========================================================================
 *
 * Am 2026-10-31 brach Etappe D des Abschlusslaufs ab:
 *
 *     feld-neu familie SKY-0854: der Charakter "Prism Break Light Core"
 *     steht im Ziel nicht. Die Charaktere muessen VOR den Figuren angelegt
 *     werden.
 *
 * Die Meldung war falsch. Die Charaktere WURDEN zuerst angelegt — alle fünf
 * standen auf Production, "Prism Break Light Core" als id 218, erzeugt
 * 4,6 Sekunden vor dem Schritt, der ihn nicht fand. Was fehlte, war nicht
 * die Reihenfolge, sondern der Eintrag in der Zuordnung Name → id: die wird
 * einmal vor dem Lauf gelesen und kennt deshalb keinen Charakter, der IM
 * Lauf entsteht.
 *
 * Die Ursache ist dort behoben, wo sie entsteht (die Anlage trägt ihre id
 * selbst ein). Dieses Tor ist das Zweite daneben, und es beantwortet eine
 * andere Frage: WIRD am Ende jede Referenz auflösbar sein? Es sagt das,
 * bevor der erste Schritt schreibt — nicht nach 142.
 */

/** Nur das, was der Riegel liest. Der echte Schritt trägt mehr. */
export type Schritt = {
  art: string;
  sky_id: string;
  feld?: string | null;
  nach?: unknown;
};

export type Befund =
  | {
      zustand: "ok";
      /** Familienzuordnungen, die einen Charakter NENNEN (`~` zählt nicht). */
      familien: number;
      /** davon aus dem vorhandenen Bestand des Ziels */
      ausBestand: number;
      /** davon aus den Charakteren, die dieser Lauf selbst anlegt */
      ausAnlagen: number;
      /** geplante Charakteranlagen */
      anlagen: number;
    }
  | {
      /** Der Plan will anlegen, was schon steht — ein veralteter Plan. */
      zustand: "veraltet";
      schonDa: string[];
    }
  | {
      /** Eine Referenz, die weder steht noch angelegt wird. */
      zustand: "unaufloesbar";
      offen: { sky_id: string; name: string }[];
    };

/**
 * `bestand` sind die Charakternamen, die das ZIEL schon führt — genau die
 * Schlüssel, mit denen der Apply-Pfad später nachschlägt. Deshalb ist der
 * Riegel eine echte Vorhersage und keine ähnliche Prüfung: er benutzt
 * dieselbe Gleichheit (exakter Name) wie der Nachschlag selbst.
 */
export function charakterRiegel(
  schritte: readonly Schritt[],
  bestand: ReadonlySet<string>,
): Befund {
  const werdenAngelegt = new Set(
    schritte.filter((s) => s.art === "charakter-anlegen").map((s) => String(s.nach)),
  );

  /*
   * ZUERST DER VERALTETE PLAN. `admin_create_character` (0158) weist einen
   * vorhandenen Namen zurück, statt ihn zu verdoppeln — das ist richtig,
   * kommt aber mitten im Schreiben. Ein teilweise ausgeführter Lauf, dessen
   * Plan nicht neu gerechnet wurde, fällt hier auf, solange noch nichts
   * geschrieben ist.
   */
  const schonDa = [...werdenAngelegt].filter((n) => bestand.has(n)).sort();
  if (schonDa.length > 0) return { zustand: "veraltet", schonDa };

  const familien = schritte.filter((s) => s.feld === "familie" && s.nach !== "~");
  const offen = familien
    .filter((s) => !bestand.has(String(s.nach)) && !werdenAngelegt.has(String(s.nach)))
    .map((s) => ({ sky_id: s.sky_id, name: String(s.nach) }));
  if (offen.length > 0) return { zustand: "unaufloesbar", offen };

  const ausBestand = familien.filter((s) => bestand.has(String(s.nach))).length;
  return {
    zustand: "ok",
    familien: familien.length,
    ausBestand,
    ausAnlagen: familien.length - ausBestand,
    anlagen: werdenAngelegt.size,
  };
}

/**
 * Die Reihenfolge, in der der Apply-Pfad die Schrittarten abarbeitet.
 *
 * Sie steht hier, damit sie prüfbar ist: `charakter-anlegen` VOR
 * `figur-anlegen` VOR allem, was auf beide verweist. Der Apply-Pfad benutzt
 * genau diese Tabelle.
 */
export const RANG: Record<string, number> = {
  "charakter-anlegen": 0,
  "figur-anlegen": 1,
  "feld-neu": 2,
  feld: 3,
};
