/**
 * Die Exporthistorie lesen — über die Funktion, nicht über die Tabelle.
 *
 * `platform_export_runs` hat seit `0105` keine Policy und keine Grants; seit
 * `0106` ist auch `service_role` davon ausgeschlossen. Es gibt technisch
 * keinen anderen Weg als `admin_platform_export_runs()`, und diese Datei
 * nimmt auch keinen anderen: kein `.from()`, kein Select, kein Fallback.
 *
 * Mit der Sitzung des Angemeldeten. Der Wächter sitzt in der Datenbank —
 * `is_platform_admin()` als `where`-Bedingung —, also bekommt ein Konto ohne
 * Plattformrecht eine LEERE Menge und keinen Fehler. Das ist hier genau
 * richtig: die Seite dahinter ist ohnehin nur für Admins, und eine leere
 * Historie sieht aus wie eine leere Historie.
 *
 * Nichts wird protokolliert.
 */
import { createClient } from "@/lib/supabase/server";
import type { PlatformExportRun } from "@/lib/backup/platform-history";

/**
 * Die Läufe, neueste zuerst.
 *
 * Die Reihenfolge kommt aus der Datenbank (`order by r.id desc`) und wird
 * hier nicht noch einmal sortiert — zwei Sortierungen wären zwei Wahrheiten.
 *
 * Bei einem Fehler eine leere Liste statt eines Wurfs: die Historie ist eine
 * Anzeige neben dem Knopf, und ein Verbindungsproblem soll nicht die ganze
 * Seite verhindern. Für die Erinnerung ist „keine Läufe" ohnehin der
 * vorsichtige Wert — sie meldet dann fällig.
 */
export async function fetchPlatformExportRuns(): Promise<PlatformExportRun[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_platform_export_runs");
  if (error || !Array.isArray(data)) return [];
  return data as PlatformExportRun[];
}
