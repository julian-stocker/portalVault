/**
 * Fällige Verfügbarkeitsereignisse verarbeiten (Phase 4 S3, Migration 0148).
 *
 * DER AUFRUFPUNKT, BEDARFSGESTEUERT. Es gibt keinen Scheduler in diesem
 * Projekt, und S3 bringt keinen mit. Stattdessen stößt ein angemeldeter
 * Besuch die Verarbeitung an — das ist die Bauform, für die sich das Konzept
 * entschieden hat (Variante 2, `docs/FAVORITE_NOTIFICATIONS.md` 3.2).
 *
 * WAS DIE DATENBANK DABEI TUT, steht in `0148`: ein einziges Statement
 * beansprucht das Ereignis in `offer_state.announced_*` und legt im
 * SELBEN Statement die Meldungen an. Diese Datei ruft es auf und tut sonst
 * nichts — keine zweite Erkennung, keine Logik, die mit der Datenbank
 * auseinanderlaufen könnte.
 *
 * WARUM SIE SO WENIG ZURÜCKGIBT. Die Datenbankfunktion liefert nur die
 * Anzahl der Meldungen **für den Aufrufer**. Eine Zahl je Figur wäre die
 * Nachfrage, und die ist nach ADR-0136 dem Verkäuferbetrieb vorbehalten
 * (`favorite_demand()`). Diese Grenze darf eine Komfortfunktion nicht
 * aufweichen.
 *
 * NOCH KEIN AUFRUFER, und das ist Absicht: Anzeige, Ungelesen-Zähler und
 * „als gelesen markieren" sind S4. Dort gehört der Aufruf an den Anfang des
 * Ladens von `/favoriten` — einmal je Seitenaufruf, mehr braucht es nicht.
 * Ein zweiter Aufruf kostet nichts: ohne fälliges Ereignis liest die
 * Funktion nur und schreibt nicht.
 */
import { createClient } from "@/lib/supabase/server";

/**
 * Verarbeitet fällige Ereignisse und sagt, wie viele Meldungen dabei **für
 * den angemeldeten Nutzer** entstanden sind.
 *
 * FEHLER BLOCKIEREN NICHTS. Die Benachrichtigung ist eine Beigabe; scheitert
 * sie, soll die Seite trotzdem laden. Dieselbe Regel wie bei der
 * Nachfrageanzeige des Betriebs (`fetchFavoriteDemand()`): ein Fehler gibt
 * den neutralen Wert und keine Ausnahme.
 */
export async function claimAvailabilityNotifications(): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("claim_availability_notifications");
  if (error || typeof data !== "number" || !Number.isFinite(data)) return 0;
  return data;
}
