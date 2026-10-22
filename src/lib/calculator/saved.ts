/**
 * Eine gespeicherte Kalkulation, als Daten (Calculator V2, ADR-0131).
 *
 * ZWEI DINGE, DIE NICHT DASSELBE SIND. Der **Arbeitsstand** liegt im Browser
 * und entsteht von selbst (`draft.ts`). Eine **gespeicherte Kalkulation**
 * liegt in der Datenbank und entsteht nur, wenn jemand „Speichern" drückt.
 * Dieses Modul beschreibt die zweite Sorte: ihre Form, ihre Grenzen und die
 * Übersetzung in und aus dem `jsonb`, das in `purchase_calculations.lines`
 * steht.
 *
 * ALLES HIER IST REIN. Kein Browser, keine Datenbank, kein React — damit die
 * Grenzfälle prüfbar sind, ohne etwas zu rendern oder zu verbinden.
 *
 * DIE POSITIONEN SIND EIN SCHNAPPSCHUSS, KEIN VERWEIS
 *
 * Gespeichert wird, womit gerechnet wurde: der Katalogvorschlag von damals
 * (`suggestedCents`), der angesetzte Wert (`unitCents`), die Menge und ob
 * ein Mensch den Wert gesetzt hat. Dazu Name, Serie und Bild als
 * Anzeigeschnappschuss — dieselbe Entscheidung wie im Warenkorb
 * (`cart.ts`), und aus demselben Grund: eine Kalkulation vom Vormonat soll
 * lesbar bleiben, auch wenn der Anzeigename seitdem anders abgeleitet wird
 * (ADR-0030) oder der Marktpreis sich bewegt hat.
 *
 * **Beim Öffnen wird deshalb NICHT neu bepreist.** Eine Kalkulation, die
 * sich beim Aufschlagen ändert, wäre keine Grundlage für eine Verhandlung,
 * die man am Vortag geführt hat. Die SKY-ID bleibt die Identität (ADR-0034),
 * und wer heutige Preise will, nimmt die Figur neu auf.
 *
 * WARUM JEDES ELEMENT BEIM LESEN GEPRÜFT WIRD. Die Spalte ist `jsonb` mit
 * einem CHECK auf die äußere Form (Objekt, Array, höchstens 200 Elemente) —
 * tiefer kann ein CHECK nicht sehen. Eine Zeile, die eine ältere Fassung
 * dieser Datei geschrieben hat, muss heute noch lesbar sein, und eine
 * kaputte Zeile darf nicht die Liste mitnehmen. `decodeLines` wirft
 * deshalb nie: was es nicht erkennt, lässt es weg.
 */
import {
  clampFactor, clampQuantity, lineTotalCents, type CalculationLine,
} from "./calculation";

/* ------------------------------------------------------------------ Grenzen */

/** Dieselbe Decke wie `seller_create_purchase_with_items` (0064). */
export const MAX_SAVED_LINES = 200;

/** Wie lang ein Name sein darf — dieselbe Zahl wie der CHECK in `0142`. */
export const MAX_NAME_LENGTH = 120;

/**
 * Die Formfassung des `jsonb`.
 *
 * `1` ist die erste. Eine unbekannte Fassung wird gelesen wie eine leere
 * Kalkulation — nicht erraten: wer die Form ändert, zählt hoch und
 * entscheidet dann, was mit den alten Zeilen passiert (wie `cart.ts`).
 */
export const LINES_VERSION = 1;

/* ------------------------------------------------------------------- Status */

/**
 * Wo die Verhandlung steht.
 *
 * Vier Werte, und absichtlich nicht mehr: ein Status, der zur
 * Projektverwaltung wächst, überlädt ein Werkzeug, dessen Zweck „in zwei
 * Minuten ein Inserat bewerten" ist (ADR-0131).
 */
export const CALCULATION_STATUSES = ["review", "negotiating", "bought", "rejected"] as const;
export type CalculationStatus = (typeof CALCULATION_STATUSES)[number];

export const DEFAULT_STATUS: CalculationStatus = "review";

export function isCalculationStatus(value: unknown): value is CalculationStatus {
  return typeof value === "string"
    && (CALCULATION_STATUSES as readonly string[]).includes(value);
}

/* -------------------------------------------------------------- Die Form */

/** Eine gespeicherte Kalkulation, wie die Oberfläche sie braucht. */
export type SavedCalculation = {
  id: string;
  name: string;
  status: CalculationStatus;
  lines: CalculationLine[];
  factorPercent: number;
  /** Abgeleitet und mitgespeichert, damit die Liste nicht rechnen muss. */
  totalCents: number;
  positions: number;
  units: number;
  /**
   * Der Einkauf, zu dem diese Kalkulation geworden ist — oder `null`.
   *
   * `null` ist nicht nur „kein Einkauf", sondern die Sperre gegen eine
   * zweite Übernahme (ADR-0131, Punkt 6). Gesetzt wird sie später und
   * ausschließlich serverseitig.
   */
  purchaseId: number | null;
  createdAt: string;
  updatedAt: string;
};

/* --------------------------------------------------------------- Der Name */

/**
 * Ein Name, wie er in die Datenbank darf.
 *
 * Nur außen beschnitten und auf die Länge begrenzt (CLAUDE.md Regel 4):
 * keine Normalisierung, keine Korrektur, kein Ersetzen von Zeichen. Wer
 * „Willhaben – Sammlung 35 Figuren" tippt, bekommt genau das.
 */
export function normalizeName(raw: string): string {
  return raw.trim().slice(0, MAX_NAME_LENGTH);
}

export function isValidName(raw: string): boolean {
  return normalizeName(raw).length > 0;
}

/**
 * Ein Vorschlag für den Namen, wenn der Betreiber keinen tippt.
 *
 * Kein „Unbenannt": ein Name, der nichts sagt, macht die Liste unbrauchbar,
 * sobald drei davon darin stehen. Die erste Figur und die Zahl der
 * Positionen sind das, woran man ein Inserat wiedererkennt.
 */
export function suggestName(lines: readonly CalculationLine[], today: Date): string {
  const tag = today.toISOString().slice(0, 10);
  if (lines.length === 0) return `Kalkulation ${tag}`;
  const erste = lines[0].name;
  return normalizeName(
    lines.length === 1 ? `${erste} (${tag})` : `${erste} + ${lines.length - 1} weitere (${tag})`,
  );
}

/* ------------------------------------------------------- Ableitung für die Liste */

export type SavedSummary = { positions: number; units: number; totalCents: number };

/**
 * Die drei Zahlen, die mitgespeichert werden.
 *
 * Dieselbe Rechnung wie `totals()` — aber bewusst über `lineTotalCents`
 * aufgebaut und nicht noch einmal ausgeschrieben: die Rechnung des
 * Kalkulators bleibt an einer Stelle (ADR-0131: keine zweite Preislogik).
 */
export function summarize(lines: readonly CalculationLine[]): SavedSummary {
  let units = 0;
  let totalCents = 0;
  for (const line of lines) {
    units += line.quantity;
    totalCents += lineTotalCents(line);
  }
  return { positions: lines.length, units, totalCents };
}

/* --------------------------------------------------------- jsonb hin und zurück */

type StoredLine = {
  sky_id: string;
  name: string;
  series: string;
  image: string | null;
  suggested_cents: number | null;
  unit_cents: number;
  quantity: number;
  manual: boolean;
};

/**
 * Was in die Spalte geschrieben wird.
 *
 * Schlangenschrift in der Datenbank, Kamelschrift im TypeScript — dieselbe
 * Trennung wie überall im Projekt. Mehr als 200 Positionen werden
 * abgeschnitten, bevor der CHECK sie abweist: die Oberfläche lässt es nicht
 * entstehen, und eine Fehlermeldung aus der Datenbank wäre hier die
 * schlechtere Antwort.
 */
export function encodeLines(lines: readonly CalculationLine[]): {
  version: number; lines: StoredLine[];
} {
  return {
    version: LINES_VERSION,
    lines: lines.slice(0, MAX_SAVED_LINES).map((line) => ({
      sky_id: line.skyId,
      name: line.name,
      series: line.series,
      image: line.image,
      suggested_cents: line.suggestedCents,
      unit_cents: line.unitCents,
      quantity: line.quantity,
      manual: line.manual,
    })),
  };
}

/**
 * Was aus der Spalte zurückkommt. Wirft nie.
 *
 * Die REIHENFOLGE bleibt die gespeicherte (ADR-0131, Punkt 4): zuletzt
 * hinzugefügt steht oben, und das muss ein Öffnen überleben. Eine doppelte
 * SKY-ID wird verworfen statt zusammengeführt — zwei Zeilen für dieselbe
 * Figur könnten nie wieder auseinandergehalten werden, und React bekäme
 * zwei gleiche Schlüssel.
 */
export function decodeLines(raw: unknown): CalculationLine[] {
  if (typeof raw !== "object" || raw === null) return [];
  const payload = raw as { version?: unknown; lines?: unknown };
  if (payload.version !== LINES_VERSION) return [];
  if (!Array.isArray(payload.lines)) return [];

  const out: CalculationLine[] = [];
  const seen = new Set<string>();
  for (const candidate of payload.lines.slice(0, MAX_SAVED_LINES)) {
    const line = parseStoredLine(candidate);
    if (line === null || seen.has(line.skyId)) continue;
    seen.add(line.skyId);
    out.push(line);
  }
  return out;
}

function parseStoredLine(candidate: unknown): CalculationLine | null {
  if (typeof candidate !== "object" || candidate === null) return null;
  const row = candidate as Record<string, unknown>;

  /* Die Identität muss stimmen — ohne sie ist die Zeile nichts. */
  if (typeof row.sky_id !== "string" || !/^SKY-[0-9]{4}$/.test(row.sky_id)) return null;
  if (typeof row.name !== "string" || row.name === "") return null;

  const quantity = typeof row.quantity === "number" ? row.quantity : Number(row.quantity);
  const unit = typeof row.unit_cents === "number" ? row.unit_cents : Number(row.unit_cents);
  if (!Number.isFinite(quantity) || !Number.isFinite(unit) || unit < 0) return null;

  /*
   * `suggested_cents` darf `null` sein, und das ist nicht dasselbe wie 0:
   * „kein Marktwert bekannt" gegen „ist nichts wert" (ADR-0010).
   */
  const suggestedRaw = row.suggested_cents;
  const suggested = suggestedRaw === null || suggestedRaw === undefined
    ? null
    : Number(suggestedRaw);

  return {
    skyId: row.sky_id,
    name: row.name,
    series: typeof row.series === "string" ? row.series : "",
    image: typeof row.image === "string" ? row.image : null,
    suggestedCents: suggested !== null && Number.isFinite(suggested)
      ? Math.round(suggested) : null,
    unitCents: Math.round(unit),
    quantity: clampQuantity(quantity),
    manual: row.manual === true,
  };
}

/* ------------------------------------------------- Eine Zeile aus der Datenbank */

/** Wie eine Zeile von PostgREST ankommt. */
export type CalculationRow = {
  id: string;
  name: string;
  status: string;
  lines: unknown;
  factor_percent: number;
  total_cents: number;
  positions: number;
  units: number;
  purchase_id: number | null;
  created_at: string;
  updated_at: string;
};

/**
 * Eine Datenbankzeile zu einer gespeicherten Kalkulation.
 *
 * Die drei abgeleiteten Zahlen werden aus den Positionen NEU gerechnet und
 * nicht aus den Spalten übernommen: die Spalten sind eine Abkürzung für die
 * Liste, und wenn sie je auseinanderlaufen, gilt das, womit gerechnet wurde.
 * Für eine leere `lines`-Spalte bleiben sie bei null.
 */
export function toSavedCalculation(row: CalculationRow): SavedCalculation {
  const lines = decodeLines(row.lines);
  const sums = summarize(lines);
  return {
    id: row.id,
    name: row.name,
    status: isCalculationStatus(row.status) ? row.status : DEFAULT_STATUS,
    lines,
    factorPercent: clampFactor(Number(row.factor_percent)),
    totalCents: sums.totalCents,
    positions: sums.positions,
    units: sums.units,
    purchaseId: row.purchase_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/* ----------------------------------------------------- Die Übernahme, später */

/**
 * Ob diese Kalkulation noch ins Orderbuch übernommen werden kann.
 *
 * Eine Zeile, die schon einen Einkauf hat, wird nicht zweimal übernommen
 * (ADR-0131, Punkt 6). Die Funktion steht hier, obwohl der Weg noch nicht
 * gebaut ist: die Regel gehört zu den Daten, nicht zum Knopf, der sie
 * später auslöst.
 */
export function canHandOver(calculation: SavedCalculation): boolean {
  return calculation.purchaseId === null && calculation.lines.length > 0;
}

/**
 * Die Positionen als Einkaufspositionen — eine je STÜCK.
 *
 * `seller_create_purchase_with_items` (0064) erwartet ein Element je
 * physischer Einheit und fasst Dubletten ausdrücklich nicht zusammen. Eine
 * Position mit Menge 3 sind dort also drei Elemente. Diese Funktion macht
 * genau diese Übersetzung und sonst nichts — sie ruft nichts auf, schreibt
 * nichts und wird heute nur von Tests benutzt, damit die spätere Übernahme
 * keine neue Annahme über die Form braucht.
 */
export function handOverItems(
  calculation: SavedCalculation,
): { sky_id: string; condition: string }[] {
  const items: { sky_id: string; condition: string }[] = [];
  for (const line of calculation.lines) {
    for (let i = 0; i < line.quantity; i += 1) {
      /* `loose` ist der eine Zustand, den SkyIsles führt (ADR-0130). */
      items.push({ sky_id: line.skyId, condition: "loose" });
    }
  }
  return items;
}
