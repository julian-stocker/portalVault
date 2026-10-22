/**
 * Der Arbeitsstand des Kalkulators (Calculator V2, ADR-0131).
 *
 * WAS ER IST. Das, was gerade im Fenster steht — Positionen, Mengen, Werte,
 * Faktor. Er entsteht von selbst, überlebt ein Neuladen und ein Schließen,
 * und er ist **keine gespeicherte Kalkulation**. Wer nur schnell ein Inserat
 * prüft, soll nichts anlegen müssen und nichts hinterlassen.
 *
 * WARUM IM BROWSER UND NICHT IN DER DATENBANK
 *
 * Ein Arbeitsstand ändert sich bei jedem Tastendruck. Ihn serverseitig zu
 * halten hieße: eine Schreiboperation je Tastendruck (oder eine Debounce-
 * Mechanik, die bei einem Verbindungsabbruch genau das verliert, was sie
 * schützen soll), eine Zeile je Gerät oder ein Streit darüber, welches
 * Gerät gewinnt — und am Ende eine Tabelle, die aussieht wie die Liste der
 * gespeicherten Kalkulationen, aber anders gemeint ist. Genau diese
 * Verwechslung schließt ADR-0131 aus: **automatisch merken ist nicht
 * automatisch anlegen.**
 *
 * `localStorage` hat dafür die richtigen Eigenschaften: synchron, je Gerät,
 * ohne Konto, ohne Netz. Was es nicht kann — über Geräte hinweg gelten —
 * braucht ein Arbeitsstand auch nicht; dafür gibt es das Speichern.
 *
 * ES GAB VORHER NICHTS ZU ÜBERNEHMEN. Der Kalkulator V1 schrieb
 * ausdrücklich nichts in den Browser („Ein Neuladen verwirft die
 * Kalkulation"), und `skyisles.calculator.*` ist ein neuer Schlüssel.
 * Es gibt also keinen Altstand, der bei dieser Umstellung verloren gehen
 * könnte — die Prüfung dieser Behauptung steht in `draft.test.ts`.
 *
 * ALLES HIER IST REIN BIS AUF DREI FUNKTIONEN. `encodeDraft`, `decodeDraft`
 * und `draftFingerprint` kennen keinen Browser; `readDraft`, `writeDraft`
 * und `clearDraft` fassen `localStorage` an und fangen jeden Fehler —
 * privater Modus, gesperrter Speicher, voller Speicher sind keine Fehler des
 * Kalkulators (dasselbe Muster wie `view-mode.ts` und `cart.ts`).
 */
import {
  clampFactor, FALLBACK_FACTOR, type CalculationLine,
} from "./calculation";
import { decodeLines, encodeLines, MAX_SAVED_LINES } from "./saved";

/**
 * Der Schlüssel, mit Fassung IM NAMEN.
 *
 * Anders als beim Warenkorb, dessen Schlüssel seinen Namen behält und dessen
 * Inhalt migriert wird: ein Arbeitsstand ist flüchtig. Ändert sich die Form,
 * ist die billigste richtige Antwort ein neuer Schlüssel — der alte Stand
 * verfällt, und niemand verliert etwas, das ihm wichtig war. Was wichtig
 * war, wurde gespeichert.
 */
export const DRAFT_KEY = "skyisles.calculator.draft.v1";

export const DRAFT_VERSION = 1;

/**
 * Der Arbeitsstand.
 *
 * `loadedId` ist das Band zur gespeicherten Kalkulation: `null` heißt „diese
 * Rechnung gehört noch keiner gespeicherten Kalkulation". Steht eine ID
 * darin, weiß die Oberfläche, dass „Speichern" zwei Bedeutungen hat —
 * aktualisieren oder als neue speichern (ADR-0131).
 *
 * `loadedFingerprint` ist der Abdruck des Stands, wie er beim Öffnen war.
 * Daran und nur daran entscheidet sich, ob es ungespeicherte Änderungen
 * gibt. Ein `dirty`-Schalter, den jede Eingabe setzt, hätte dieselbe Frage
 * falsch beantwortet, sobald jemand eine Änderung wieder zurücknimmt.
 */
export type CalculatorDraft = {
  lines: CalculationLine[];
  factor: number;
  loadedId: string | null;
  loadedName: string | null;
  loadedFingerprint: string | null;
};

export const EMPTY_DRAFT: CalculatorDraft = {
  lines: [],
  factor: FALLBACK_FACTOR,
  loadedId: null,
  loadedName: null,
  loadedFingerprint: null,
};

/** Ein leerer Arbeitsstand ist einer ohne Positionen. */
export function isEmptyDraft(draft: CalculatorDraft): boolean {
  return draft.lines.length === 0;
}

/**
 * Der Abdruck eines Rechenstands.
 *
 * Nur das, was fachlich zählt: Positionen in ihrer REIHENFOLGE mit Menge und
 * angesetztem Wert, dazu der Faktor. Nicht das Bild und nicht der Name — ein
 * Katalog, der ein Bild nachliefert, ist keine Änderung des Händlers.
 *
 * Er dient zwei Fragen: „gibt es ungespeicherte Änderungen?" und „ist das
 * noch derselbe Stand wie beim Öffnen?". Beide sind dieselbe Frage.
 */
export function draftFingerprint(lines: readonly CalculationLine[], factor: number): string {
  const teile = lines.map((l) => `${l.skyId}:${l.quantity}:${l.unitCents}:${l.manual ? 1 : 0}`);
  return `${clampFactor(factor)}|${teile.join(";")}`;
}

/**
 * Hat der Arbeitsstand ungespeicherte Änderungen?
 *
 * Ohne `loadedFingerprint` gilt: alles, was Positionen hat, ist
 * ungespeichert. Das ist der häufige Fall — ein frisch getipptes Inserat.
 */
export function hasUnsavedChanges(draft: CalculatorDraft): boolean {
  const jetzt = draftFingerprint(draft.lines, draft.factor);
  if (draft.loadedFingerprint === null) return draft.lines.length > 0;
  return jetzt !== draft.loadedFingerprint;
}

/* -------------------------------------------------------- Form und Rückform */

export function encodeDraft(draft: CalculatorDraft): string {
  return JSON.stringify({
    version: DRAFT_VERSION,
    factor: clampFactor(draft.factor),
    loadedId: draft.loadedId,
    loadedName: draft.loadedName,
    loadedFingerprint: draft.loadedFingerprint,
    /* Dieselbe Form wie in der Datenbank — eine Form für beide Wege, sonst
       gäbe es zwei Stellen, an denen eine Position falsch gelesen werden
       kann. */
    lines: encodeLines(draft.lines).lines,
  });
}

/** Liest gespeicherten Text. Wirft nie: Unlesbares ist ein leerer Stand. */
export function decodeDraft(raw: string | null): CalculatorDraft {
  if (!raw) return EMPTY_DRAFT;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY_DRAFT;
  }
  if (typeof parsed !== "object" || parsed === null) return EMPTY_DRAFT;

  const payload = parsed as Record<string, unknown>;
  if (payload.version !== DRAFT_VERSION) return EMPTY_DRAFT;

  const lines = decodeLines({
    version: 1,
    lines: Array.isArray(payload.lines) ? payload.lines.slice(0, MAX_SAVED_LINES) : [],
  });

  const factor = typeof payload.factor === "number" ? payload.factor : Number(payload.factor);

  return {
    lines,
    factor: Number.isFinite(factor) ? clampFactor(factor) : FALLBACK_FACTOR,
    loadedId: typeof payload.loadedId === "string" ? payload.loadedId : null,
    loadedName: typeof payload.loadedName === "string" ? payload.loadedName : null,
    loadedFingerprint:
      typeof payload.loadedFingerprint === "string" ? payload.loadedFingerprint : null,
  };
}

/* ------------------------------------------------------------ Der Browser */

/**
 * Der gespeicherte Arbeitsstand, oder ein leerer.
 *
 * Nach dem Mounten lesen, nicht beim Rendern: der Server hat kein
 * `localStorage`, und ein anderer erster Baum wäre ein Hydrationsfehler
 * (dieselbe Begründung steht in `view-mode.ts`).
 */
export function readDraft(): CalculatorDraft {
  try {
    return decodeDraft(window.localStorage.getItem(DRAFT_KEY));
  } catch {
    return EMPTY_DRAFT;
  }
}

/** Nach bestem Vermögen. Ein Browser, der nicht speichern will, ist kein Fehler. */
export function writeDraft(draft: CalculatorDraft): void {
  try {
    window.localStorage.setItem(DRAFT_KEY, encodeDraft(draft));
  } catch {
    /*
     * Privater Modus, Speicherkontingent, gesperrte Website-Daten. Der
     * Kalkulator rechnet weiter — er erinnert sich beim nächsten Öffnen
     * nicht. Eine Fehlermeldung dafür wäre lauter als die Folge.
     */
  }
}

/**
 * Den Arbeitsstand fortwerfen — und NUR ihn.
 *
 * Gespeicherte Kalkulationen stehen in der Datenbank und sind davon nicht
 * berührt. Das ist die Zusicherung hinter dem Knopf „Zurücksetzen"
 * (ADR-0131).
 */
export function clearDraft(): void {
  try {
    window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Siehe `writeDraft`.
  }
}
