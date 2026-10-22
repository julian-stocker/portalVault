/**
 * Gespeicherte Kalkulationen lesen und schreiben (Calculator V2, ADR-0131).
 *
 * WER DARF WAS. Die Richtlinien aus `0142` entscheiden es, nicht diese
 * Datei: `user_id = auth.uid()`, vier Policies, und ein fremdes Konto sieht
 * nichts. Was hier steht, ist die Umsetzung davon — die `user_id` kommt
 * **immer aus der geprüften Sitzung** und niemals vom Client (dasselbe
 * Muster wie `collection/actions.ts`).
 *
 * KEINE ZWEITE ROLLENPRÜFUNG. Eine gespeicherte Kalkulation ist eine private
 * Notiz, kein Geschäftsvorfall: `canOperateSeller()` steht ausdrücklich
 * nicht davor. Dass der Kalkulator nur dem Betrieb gezeigt wird, ist
 * Bequemlichkeit (ADR-0039); eine Kundschaft, die diese Aktionen von Hand
 * aufriefe, bekäme ihre eigene, leere Liste — und mehr nicht.
 *
 * WAS SIE NICHT TUT. Keine Bestellung, kein Einkauf, keine Bewegung, kein
 * Beleg. `purchase_id` wird hier **nirgends geschrieben**: die Übernahme ins
 * Orderbuch ist nicht gebaut, und eine Spalte, die der Client setzen darf,
 * wäre genau die Sperre, die sie werden soll (ADR-0131, Punkt 6).
 *
 * NUR ASYNCHRONE FUNKTIONEN. Eine `"use server"`-Datei macht aus jedem
 * Export einen Endpunkt und bricht beim Übersetzen ab, sobald etwas anderes
 * dabei ist. Typen und Konstanten stehen in `saved.ts`.
 */
"use server";

import { createClient } from "@/lib/supabase/server";
import {
  encodeLines, isCalculationStatus, normalizeName, summarize, toSavedCalculation,
  type CalculationRow, type CalculationStatus, type SavedCalculation,
} from "@/lib/calculator/saved";
import { clampFactor, type CalculationLine } from "@/lib/calculator/calculation";

/** Die Spalten, die die Oberfläche braucht — und keine mehr. */
const COLUMNS =
  "id, name, status, lines, factor_percent, total_cents, positions, units, "
  + "purchase_id, created_at, updated_at";

/**
 * Wie viele Kalkulationen die Liste holt.
 *
 * Eine Obergrenze, keine Verwaltung: wer mehr als fünfzig offene
 * Bewertungen hat, braucht eine Suche und nicht eine längere Liste — und bis
 * dahin ist jede Seitennummerierung Aufwand ohne Nutzen.
 */
const LIST_LIMIT = 50;

export type SaveResult =
  | { ok: true; calculation: SavedCalculation }
  | { ok: false; reason: "auth" | "invalid" | "failed" };

export type ListResult =
  | { ok: true; calculations: SavedCalculation[] }
  | { ok: false; reason: "auth" | "failed" };

export type PlainResult = { ok: true } | { ok: false; reason: "auth" | "invalid" | "failed" };

/** Was gespeichert wird — die Oberfläche schickt den Rechenstand, nichts weiter. */
export type SavePayload = {
  name: string;
  lines: CalculationLine[];
  factorPercent: number;
  status?: CalculationStatus;
};

/* ------------------------------------------------------------------- Lesen */

/**
 * Die eigenen Kalkulationen, zuletzt geänderte zuerst.
 *
 * Dieselbe Sortierung, die der Index aus `0142` bedient. Ein Fehler gibt
 * `failed` und keine leere Liste: „du hast keine" und „ich konnte nicht
 * nachsehen" sind zwei verschiedene Auskünfte, und die Oberfläche sagt
 * beides verschieden.
 */
export async function listCalculations(): Promise<ListResult> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, reason: "auth" };

  const { data, error } = await supabase
    .from("purchase_calculations")
    .select(COLUMNS)
    .order("updated_at", { ascending: false })
    .limit(LIST_LIMIT);

  if (error) return { ok: false, reason: "failed" };
  return {
    ok: true,
    calculations: ((data ?? []) as unknown as CalculationRow[]).map(toSavedCalculation),
  };
}

/* --------------------------------------------------------------- Anlegen */

/**
 * Eine neue Kalkulation anlegen.
 *
 * DAS IST DER EINZIGE WEG, auf dem eine Zeile entsteht — ausgelöst durch
 * einen Druck auf „Speichern" und durch nichts sonst. Der Arbeitsstand
 * kommt hier nie an (ADR-0131).
 */
export async function createCalculation(payload: SavePayload): Promise<SaveResult> {
  const name = normalizeName(payload.name);
  if (name === "") return { ok: false, reason: "invalid" };

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, reason: "auth" };

  const sums = summarize(payload.lines);
  const { data, error } = await supabase
    .from("purchase_calculations")
    .insert({
      // Aus der Sitzung, nicht aus dem Aufruf.
      user_id: auth.user.id,
      name,
      status: isCalculationStatus(payload.status) ? payload.status : "review",
      lines: encodeLines(payload.lines),
      factor_percent: clampFactor(payload.factorPercent),
      total_cents: sums.totalCents,
      positions: sums.positions,
      units: sums.units,
    })
    .select(COLUMNS)
    .single();

  if (error || !data) return { ok: false, reason: "failed" };
  return { ok: true, calculation: toSavedCalculation(data as unknown as CalculationRow) };
}

/* ------------------------------------------------------------ Aktualisieren */

/**
 * Eine bestehende Kalkulation überschreiben.
 *
 * NUR AUF ANSAGE. Die Oberfläche ruft das, wenn der Betreiber
 * „Bestehende aktualisieren" wählt — nicht beim Tippen, nicht beim
 * Wechseln, nicht beim Schließen.
 *
 * `purchase_id` wird NICHT mitgeschrieben: ein bereits übernommener Einkauf
 * bleibt verknüpft, auch wenn die Kalkulation danach noch bearbeitet wird.
 * `updated_at` setzt der Trigger aus `0142`.
 */
export async function updateCalculation(
  id: string,
  payload: SavePayload,
): Promise<SaveResult> {
  const name = normalizeName(payload.name);
  if (name === "" || !isUuid(id)) return { ok: false, reason: "invalid" };

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, reason: "auth" };

  const sums = summarize(payload.lines);
  const { data, error } = await supabase
    .from("purchase_calculations")
    .update({
      name,
      ...(isCalculationStatus(payload.status) ? { status: payload.status } : {}),
      lines: encodeLines(payload.lines),
      factor_percent: clampFactor(payload.factorPercent),
      total_cents: sums.totalCents,
      positions: sums.positions,
      units: sums.units,
    })
    .eq("id", id)
    /*
     * Der Besitz steht in der Richtlinie — hier steht er trotzdem noch
     * einmal. Nicht als Sicherheit, sondern als Klarheit: eine fremde ID
     * trifft dann keine Zeile, statt sich auf die Policy zu verlassen und
     * im Zweifel still nichts zu tun.
     */
    .eq("user_id", auth.user.id)
    .select(COLUMNS)
    .single();

  if (error || !data) return { ok: false, reason: "failed" };
  return { ok: true, calculation: toSavedCalculation(data as unknown as CalculationRow) };
}

/* ---------------------------------------------------- Umbenennen und Status */

/** Nur der Name. Die Positionen bleiben, wie sie sind. */
export async function renameCalculation(id: string, name: string): Promise<PlainResult> {
  const clean = normalizeName(name);
  if (clean === "" || !isUuid(id)) return { ok: false, reason: "invalid" };

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, reason: "auth" };

  const { error, count } = await supabase
    .from("purchase_calculations")
    .update({ name }, { count: "exact" })
    .eq("id", id)
    .eq("user_id", auth.user.id);

  if (error) return { ok: false, reason: "failed" };
  /* Keine Zeile getroffen heißt: gibt es nicht, oder gehört jemand anderem.
     Beides ist von hier aus dasselbe, und beides ist kein Erfolg. */
  if (count === 0) return { ok: false, reason: "invalid" };
  return { ok: true };
}

/** Nur der Status. */
export async function setCalculationStatus(
  id: string,
  status: CalculationStatus,
): Promise<PlainResult> {
  if (!isUuid(id) || !isCalculationStatus(status)) return { ok: false, reason: "invalid" };

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, reason: "auth" };

  const { error, count } = await supabase
    .from("purchase_calculations")
    .update({ status }, { count: "exact" })
    .eq("id", id)
    .eq("user_id", auth.user.id);

  if (error) return { ok: false, reason: "failed" };
  if (count === 0) return { ok: false, reason: "invalid" };
  return { ok: true };
}

/* ---------------------------------------------------------------- Löschen */

/**
 * Eine Kalkulation löschen.
 *
 * Endgültig, und deshalb fragt die Oberfläche vorher. Ein bereits
 * übernommener Einkauf bleibt davon unberührt — gelöscht wird die
 * Bewertung, nicht der Geschäftsvorfall.
 */
export async function deleteCalculation(id: string): Promise<PlainResult> {
  if (!isUuid(id)) return { ok: false, reason: "invalid" };

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, reason: "auth" };

  const { error } = await supabase
    .from("purchase_calculations")
    .delete()
    .eq("id", id)
    .eq("user_id", auth.user.id);

  if (error) return { ok: false, reason: "failed" };
  return { ok: true };
}

/* --------------------------------------------------------------- Werkzeug */

/**
 * Eine UUID, wie `gen_random_uuid()` sie erzeugt.
 *
 * Vorher geprüft, weil PostgREST eine ungültige UUID mit `22P02` abweist und
 * die Oberfläche dann „failed" zeigen müsste, wo „gibt es nicht" gemeint
 * ist. Die Fassung wird nicht geprüft — das ist Sache der Datenbank.
 */
function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
