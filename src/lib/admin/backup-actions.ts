/**
 * Die Bestätigung einer Plattformsicherung.
 *
 * WAS `received` HIER HEISST, GENAU
 *
 *   Der Browser-Fetch ist vollständig abgeschlossen, der komplette Blob liegt
 *   clientseitig vor, UND genau ein `generated`-Lauf seit dem Beginn dieses
 *   Downloads war eindeutig bestimmbar.
 *
 * Es heißt AUSDRÜCKLICH NICHT, dass die Datei dauerhaft auf einer Platte
 * liegt. Das kann ein Browser nicht beweisen, und `received` behauptet es
 * nicht. Es ist die stärkste Aussage, die technisch erreichbar ist: der
 * vollständige Inhalt war beim Empfänger.
 *
 * DER CLIENT GIBT NICHTS VOR. Er nennt nur den Zeitpunkt, an dem er die
 * Anfrage abgeschickt hat. `id` und `sha256` kommen aus der Historie, die
 * diese Action selbst liest — wer den Hash mitschicken dürfte, könnte jede
 * Zeile bestätigen, ohne je eine Datei gesehen zu haben.
 *
 * ZWEI SCHLÖSSER. `isPlatformAdmin()` hier, `is_platform_admin()` in
 * `admin_platform_export_runs()` und `admin_settle_platform_export()`. Das
 * zweite entscheidet; das erste erspart die Runde und liefert einen deutschen
 * Satz statt eines Postgres-Fehlers.
 *
 * KEIN DIREKTER TABELLENZUGRIFF, KEINE SERVICE ROLE. `platform_export_runs`
 * ist von außen geschlossen (0105/0106); der Weg führt ausschließlich über die
 * beiden Funktionen.
 *
 * Nichts wird protokolliert, und keine Meldung aus der Datenbank verlässt
 * diese Datei.
 */
"use server";

import { revalidatePath } from "next/cache";

import { isPlatformAdmin } from "@/lib/auth/capabilities";
import { createClient } from "@/lib/supabase/server";
import { confirmableRun } from "@/lib/backup/platform-history";
import type { PlatformExportRun } from "@/lib/backup/platform-history";

/** Was die Oberfläche danach sagen darf. */
export type ConfirmResult =
  | { ok: true }
  /** Die Datei ist da, der Lauf ließ sich nicht eindeutig zuordnen. */
  | { ok: false; unconfirmed: true }
  /** Etwas anderes ging schief — dieselbe neutrale Meldung. */
  | { ok: false; unconfirmed: false };

const PAGE = "/admin/datensicherung";

/**
 * Den Lauf zu diesem Download bestätigen.
 *
 * `startedAtIso` ist der Zeitpunkt, den der Browser sich VOR der Anfrage
 * gemerkt hat. Er begrenzt die Kandidaten nach unten; er ist keine
 * Berechtigung und keine Kennung.
 */
export async function confirmPlatformBackup(startedAtIso: string): Promise<ConfirmResult> {
  if (!(await isPlatformAdmin())) return { ok: false, unconfirmed: false };

  const startedAt = new Date(startedAtIso);
  if (Number.isNaN(startedAt.getTime())) return { ok: false, unconfirmed: false };

  const supabase = await createClient();

  const history = await supabase.rpc("admin_platform_export_runs");
  if (history.error || !Array.isArray(history.data)) return { ok: false, unconfirmed: false };

  const match = confirmableRun(history.data as PlatformExportRun[], startedAt);
  /*
   * Null oder mehrere Kandidaten: NICHT bestätigen. Den neuesten zu nehmen
   * wäre der Fehler, den niemand bemerkt — bei zwei gleichzeitigen Downloads
   * stünde `received` an einer Datei, die keiner geprüft hat.
   */
  if (!match.ok) return { ok: false, unconfirmed: true };

  const settled = await supabase.rpc("admin_settle_platform_export", {
    p_id: match.run.id,
    p_sha256: match.run.sha256,
  });
  // Erfolg nur, wenn die Datenbank wirklich `received` sagt.
  if (settled.error || settled.data !== "received") return { ok: false, unconfirmed: true };

  // Die Historie auf der Seite und die Fälligkeit im Dashboard ändern sich beide.
  revalidatePath(PAGE);
  revalidatePath("/admin");
  return { ok: true };
}

