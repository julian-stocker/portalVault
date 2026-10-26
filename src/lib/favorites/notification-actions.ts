/**
 * Verfuegbarkeitsmeldungen als gelesen markieren (Phase 4 S4, `0149`).
 *
 * DER EINZIGE SCHREIBWEG, UND ER BRAUCHT EINE HANDLUNG. Diese Datei ist die
 * eine Stelle, an der `read_at` gesetzt wird — angestossen von einem Klick,
 * niemals vom Laden einer Seite. Das Lesen liegt in
 * `notification-queries.ts` und schreibt nichts; die Trennung ist der Punkt
 * (Auftrag S4, Punkt 5: „die Anzeige markiert keine Benachrichtigungen
 * versehentlich als gelesen").
 *
 * DIE GRENZE STEHT IN DER DATENBANK. `mark_availability_notifications_read()`
 * ist `security definer` und traegt die Eigentuemerbedingung in ihrem
 * `where` — dieselbe wie die `select`-Richtlinie aus `0148`. Hier steht
 * KEINE zweite Rechnung darueber, wessen Zeilen das sind: eine zweite
 * Rechnung koennte von der ersten abweichen. `authenticated` hat auf der
 * Tabelle kein `update`-Recht, dieser Weg ist also nicht einer von zwei.
 */
"use server";

import { revalidatePath } from "next/cache";

import { isCollector } from "@/lib/auth/capabilities";
import { createClient } from "@/lib/supabase/server";

const SKY_ID = /^SKY-[0-9]{4}$/;

export type MarkReadResult =
  | { ok: true; marked: number }
  | { ok: false; reason: "auth" | "invalid" | "failed" };

/**
 * Markiert eigene ungelesene Meldungen als gelesen.
 *
 * @param skyIds  Nur die Meldungen zu diesen Figuren. **Ohne Angabe alle** —
 *   das ist „alles gesehen" am Kopf des Abschnitts. Eine leere Liste ist
 *   NICHT dasselbe wie keine Liste und markiert nichts; sonst wuerde ein
 *   Programmierfehler („markiere diese null Karten") stillschweigend alles
 *   markieren.
 */
export async function markNoticesRead(skyIds?: readonly string[]): Promise<MarkReadResult> {
  if (skyIds !== undefined) {
    if (skyIds.length === 0) return { ok: true, marked: 0 };
    if (!skyIds.every((id) => SKY_ID.test(id))) return { ok: false, reason: "invalid" };
  }

  /*
   * Eine Meldung gehoert zu einer Wunschliste, und die hat ein Sammlerkonto
   * (ADR-0078). Die Datenbankfunktion weist die anderen zwei ueber
   * `is_collector_account()` ab; hier gefragt wird daraus eine Antwort, die
   * die Oberflaeche zeigen kann, statt einer Markierung von null Zeilen.
   */
  if (!(await isCollector())) return { ok: false, reason: "auth" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("mark_availability_notifications_read", {
    /* `null` heisst „alle eigenen ungelesenen" — so liest die Funktion es. */
    p_sky_ids: skyIds ? [...skyIds] : null,
  });

  if (error || typeof data !== "number" || !Number.isFinite(data)) {
    return { ok: false, reason: "failed" };
  }

  /*
   * ZWEI DINGE AENDERN SICH, UND BEIDE HAENGEN AN DIESEM PFAD: die Karten auf
   * `/favoriten` werden ruhiger, und die Marke in der Navigationsleiste wird
   * kleiner. Die Marke steht im Layout von `(app)`, und `revalidatePath`
   * erneuert die Route samt ihren Layouts — deshalb genuegt dieser eine
   * Aufruf, und es braucht keinen zweiten Weg fuer die Zahl.
   */
  revalidatePath("/favoriten");
  return { ok: true, marked: data };
}
