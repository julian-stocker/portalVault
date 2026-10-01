/**
 * Die Wochenerinnerung — auf der Adminübersicht, nicht überall.
 *
 * WARUM HIER. Production läuft auf Supabase Free: keine nativen Backups, kein
 * PITR. Die manuelle Sicherung ist die einzige, und eine Sicherung, an die
 * niemand denkt, gibt es nicht. Die Übersicht ist die Seite, die ein Admin
 * ohnehin öffnet — ein globales Band auf jeder Seite wäre nach zwei Tagen
 * unsichtbar, und in einem Arbeitsbereich stört es bei allem, was gerade
 * nichts damit zu tun hat.
 *
 * NUR `received` ZÄHLT. Ein `generated` heißt, dass der Server ein Archiv
 * geschrieben hat — nicht, dass es jemand hat. Die Regel steht in
 * `backupDue()` und ist dort ohne Datenbank geprüft.
 *
 * Kein Zeitplan, keine E-Mail, keine Push-Nachricht, keine neue Tabelle. Die
 * Information kommt aus `admin_platform_export_runs()`, und zwar in derselben
 * Anfrage, die die Seite ohnehin rendert.
 */
import Link from "next/link";

import { backupDue, daysSinceLastBackup, type PlatformExportRun } from "@/lib/backup/platform-history";
import { de } from "@/lib/i18n/de";

const copy = de.admin.platformBackup;
const PAGE = "/admin/datensicherung";

export function BackupDueNotice({
  runs,
  now = new Date(),
}: {
  runs: readonly PlatformExportRun[];
  now?: Date;
}) {
  // Nicht fällig heißt: nichts sagen. Ein „alles in Ordnung"-Band auf der
  // Übersicht wäre Lärm, und der nächste echte Hinweis verschwindet darin.
  if (!backupDue(runs, now)) return null;

  const days = daysSinceLastBackup(runs, now);

  return (
    <section className="mt-8 flex flex-col gap-2 rounded-sky-lg bg-status-ground px-5 py-4 text-status-ink ring-1 ring-status-line">
      <h2 className="font-semibold">{copy.dueTitle}</h2>
      <p className="text-sm leading-relaxed">
        {days === null ? copy.dueNever : copy.dueSince(days)}
      </p>
      <Link
        href={PAGE}
        className="self-start text-sm font-medium underline underline-offset-4 hover:no-underline"
      >
        {copy.dueAction}
      </Link>
    </section>
  );
}
