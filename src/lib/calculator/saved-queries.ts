/**
 * Eine gespeicherte Kalkulation serverseitig lesen (Calculator V3, ADR-0132).
 *
 * WOFÜR EINE EIGENE DATEI. `saved-actions.ts` ist `"use server"` — jeder
 * Export dort ist ein Endpunkt, und ein Endpunkt ist das Falsche für etwas,
 * das eine Serverkomponente beim Rendern braucht. Diese Funktion wird von
 * der Seite `/business/orderbuch/neu` aufgerufen, also auf dem Server, in
 * derselben Anfrage.
 *
 * WARUM SERVERSEITIG UND NICHT ÜBER DIE URL (Auftrag Punkt 7). Über die URL
 * reist nur die **Kennung** der Kalkulation. Die Artikel kommen aus der
 * Datenbank, und zwar mit der Sitzung des Aufrufers: die Richtlinien aus
 * `0142` entscheiden, ob er sie sehen darf. Eine Artikelliste im
 * Adressfeld wäre eine Liste, die jeder bearbeiten kann — und das Formular
 * würde ihr glauben.
 *
 * SIE SCHREIBT NICHTS. Ein Besuch der Seite legt keinen Einkauf an und
 * verändert die Kalkulation nicht. Entstehen soll ein Einkauf erst, wenn
 * jemand im bestehenden Formular auf „Speichern" drückt.
 */
import { createClient } from "@/lib/supabase/server";
import { toSavedCalculation, type CalculationRow, type SavedCalculation } from "./saved";

/** Dieselben Spalten wie in der Liste — eine Form, ein Leser. */
const COLUMNS =
  "id, name, status, lines, factor_percent, total_cents, positions, units, "
  + "purchase_id, created_at, updated_at";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Die eigene Kalkulation, oder `null`.
 *
 * `null` heißt: gibt es nicht, gehört jemand anderem, oder die Kennung ist
 * keine. **Alle drei Fälle sehen von außen gleich aus** — wer nichts sehen
 * darf, soll nicht erfahren, dass es existiert. Die Seite behandelt `null`
 * wie einen Aufruf ohne Kalkulation: das Formular bleibt leer, genau wie
 * bei „+ Neu".
 */
export async function fetchOwnCalculation(id: string): Promise<SavedCalculation | null> {
  if (!UUID.test(id)) return null;

  const supabase = await createClient();
  /*
   * Die Richtlinie filtert; `user_id` steht hier NICHT noch einmal. Anders
   * als in den schreibenden Aktionen gibt es hier nichts zu verwechseln: ein
   * `select` ohne Treffer ist dieselbe Antwort wie ein verweigerter.
   */
  const { data, error } = await supabase
    .from("purchase_calculations")
    .select(COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error || data === null) return null;
  return toSavedCalculation(data as unknown as CalculationRow);
}
