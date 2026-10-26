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

/** Die vier Antworten: drei aus `0146`, plus „gar nicht angekommen". */
export type RefreshReason = "ran" | "throttled" | "locked" | "failed";

/**
 * Was der Lauf getan hat — und ZWEI Felder, nicht eines.
 *
 * WARUM NICHT NUR DER GRUND. Als reine Zeichenkette waere jeder der vier
 * Werte `truthy`, und `if (await refreshOfferState())` haette fuer
 * **„failed"** dasselbe gesagt wie fuer „ran". Genau das verbietet `0146` im
 * Funktionskommentar: „ein Aufrufer darf `locked` NIEMALS als eigenen Erfolg
 * lesen". Ein Wahrheitswert, der nur fuer `ran` wahr ist, macht diese
 * Verwechslung unmoeglich, statt sie zu untersagen.
 *
 * `refreshed` heisst: DIESER Aufruf hat den Spiegel nachgezogen.
 *
 *   ran        ja — nachgezogen
 *   throttled  nein — jemand war in der letzten Minute schon da. Der Spiegel
 *              ist vermutlich frisch, aber nicht durch diesen Aufruf.
 *   locked     nein — ein anderer Lauf ist gerade dabei. Der Spiegel kann in
 *              diesem Augenblick noch alt sein.
 *   failed     nein — und zwar gar nichts.
 *
 * FUER DIE REIHENFOLGE AENDERT DAS NICHTS: beansprucht und gelesen wird in
 * jedem Fall. Ein faelliges Ereignis verfaellt nicht, und ein zweiter Besuch
 * holt es ab. Die Unterscheidung ist dafuer da, dass niemand aus „throttled"
 * oder „failed" schliesst, der Spiegel sei jetzt aktuell.
 */
export type RefreshOutcome = { refreshed: boolean; reason: RefreshReason };

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
export async function refreshOfferState(): Promise<RefreshOutcome> {
  let grund: unknown;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("refresh_offer_state");
    if (error) {
      /*
       * LAUT GENUG, UM AUFFINDBAR ZU SEIN. Der behobene Fehler war eine
       * UNBEMERKTE Stille — ein Spiegel, den niemand nachzog, und niemandem
       * fiel es auf. Ein Fix, dessen Scheitern genauso still ist, wiederholt
       * denselben Fehler im Kleinen. Deshalb eine Zeile im Serverprotokoll,
       * und zwar nur fuer diesen einen Fall: `throttled` und `locked` sind
       * der Normalbetrieb und haben dort nichts zu suchen.
       *
       * Dieselbe Form wie bei den anderen nicht zugeordneten Fehlern dieses
       * Projekts (`order message: unmapped …`).
       */
      console.error(`offer state refresh: ${error.code ?? "?"} ${error.message}`);
      return { refreshed: false, reason: "failed" };
    }
    /*
     * `returns table (...)` kommt als Array von Zeilen zurück — dieselbe
     * Form wie bei `favorite_demand()`. Nur die erste Zeile zählt, die
     * Funktion gibt genau eine.
     */
    const zeile = Array.isArray(data) ? data[0] : data;
    grund = (zeile as { reason?: unknown } | null | undefined)?.reason;
  } catch (e) {
    /*
     * EIN WURF DARF DIE SEITE NICHT MITNEHMEN. `supabase.rpc()` gibt einen
     * Datenbankfehler als `error` zurueck, aber ein Transportfehler (kein
     * Netz, abgebrochene Verbindung) kann werfen — und dieser Aufruf steht
     * am Anfang des Ladens von `/favoriten`. Eine nicht nachgezogene
     * Angebotslage ist eine spaetere Meldung; sie ist kein Grund, die
     * Wunschliste nicht zu zeigen.
     */
    console.error(`offer state refresh: ${e instanceof Error ? e.message : String(e)}`);
    return { refreshed: false, reason: "failed" };
  }

  if (grund === "ran") return { refreshed: true, reason: "ran" };
  if (grund === "throttled") return { refreshed: false, reason: "throttled" };
  if (grund === "locked") return { refreshed: false, reason: "locked" };
  /* Eine unerwartete Antwort ist kein Erfolg. */
  console.error(`offer state refresh: unerwartete Antwort ${JSON.stringify(grund)}`);
  return { refreshed: false, reason: "failed" };
}
