/**
 * Den Angebotsspiegel nachziehen (`0146`, `0147`).
 *
 * WARUM DIESE DATEI AM 2026-10-26 ENTSTANDEN IST — SIE SCHLIESST EINE LÜCKE.
 *
 * `0146` hat den Spiegel bewusst **ohne Trigger** gebaut: ein Fehler darin
 * soll strukturell keinen Kauf erreichen können. Die Gegenleistung dafür
 * steht im Kopf jener Migration: „die Meldungen gehen an angemeldete
 * Sammler, und **deren eigener Seitenaufbau frischt auf**". Genau diesen
 * Aufrufer hat niemand gebaut. S1 hat den Spiegel angelegt, S2 die Erkennung,
 * S3 die Verarbeitung, S4 die Oberfläche — und alle vier hingen an einer
 * Tabelle, die seit der Erstbefüllung niemand mehr nachgezogen hat.
 *
 * DIE FOLGE WAR VOLLSTÄNDIGE STILLE, und zwar nicht nur verzögert: wird eine
 * Figur eingebucht, zeigt `shop_offers()` das Angebot sofort — die Funktion
 * liest live. `offer_state` erfuhr davon nie, also fand
 * `offer_availability_due()` nichts, also beanspruchte
 * `claim_availability_notifications()` nichts. Keine Meldung, nicht nach
 * dreißig Minuten und nicht nach einer Woche.
 *
 * WAS DAS FÜR DEN ZEITPUNKT BEDEUTET, und es ist eine ehrliche Einschränkung:
 * `buyable_since` wird beim **ersten Nachziehen** gesetzt, nicht beim
 * Einbuchen. „Verfügbar seit" heißt also „seit wir es bemerkt haben". Ohne
 * Scheduler geht es nicht anders, und für die Karenzzeit ist es die
 * vorsichtigere Richtung: die dreißig Minuten laufen ab dem Bemerken.
 */
import { createClient } from "@/lib/supabase/server";

/**
 * Was der Lauf getan hat. `0146` gibt drei unterscheidbare Antworten, und
 * **`locked` darf ein Aufrufer niemals als eigenen Erfolg lesen** — das
 * steht so im Funktionskommentar der Migration.
 */
export type RefreshResult = "ran" | "throttled" | "locked" | "failed";

/**
 * Zieht den Spiegel nach, wenn er dran ist.
 *
 * GEDROSSELT IN DER DATENBANK, nicht hier. `offer_state_window()` (eine
 * Minute) und ein Transaktionsschloss entscheiden; ein zweiter Aufruf in
 * derselben Minute kostet einen `max(checked_at)` und kommt mit `throttled`
 * zurück. Deshalb braucht dieser Aufrufpunkt keine eigene Buchführung
 * darüber, wann er das letzte Mal gelaufen ist — eine zweite Drossel wäre
 * eine zweite Wahrheit.
 *
 * FEHLER BLOCKIEREN NICHTS. Ein nicht nachgezogener Spiegel heißt: eine
 * Meldung kommt später. Das ist kein Grund, die Wunschliste nicht zu zeigen —
 * dieselbe Regel wie bei `claimAvailabilityNotifications()` und
 * `fetchFavoriteDemand()`.
 */
export async function refreshOfferState(): Promise<RefreshResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("refresh_offer_state");

  if (error) return "failed";

  /*
   * `returns table (...)` kommt als Array von Zeilen zurück. Nur die erste
   * zählt — die Funktion gibt genau eine.
   */
  const zeile = Array.isArray(data) ? data[0] : data;
  const grund = (zeile as { reason?: unknown } | null | undefined)?.reason;
  if (grund === "ran" || grund === "throttled" || grund === "locked") return grund;
  return "failed";
}
