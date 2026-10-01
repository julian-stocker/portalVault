import type { Metadata } from "next";

import { PlatformBackupDownload } from "@/components/admin/platform-backup-download";
import { PlatformBackupHistory } from "@/components/admin/platform-backup-history";
import { fetchPlatformExportRuns } from "@/lib/admin/backup-history";
import { backupDue, daysSinceLastBackup } from "@/lib/backup/platform-history";
import { de } from "@/lib/i18n/de";

export const metadata: Metadata = { title: de.admin.platformBackup.title };

/* Die Historie ist nach jedem Download anders. Nichts hier darf aus einem
   Zwischenspeicher kommen. */
export const dynamic = "force-dynamic";

const copy = de.admin.platformBackup;

/**
 * Datensicherung der Plattform.
 *
 * WER HIERHER KOMMT, IST BEREITS GEPRÜFT. Das Layout über `(admin)` fragt
 * `capabilities()` und antwortet einem Nicht-Admin mit 404; diese Seite baut
 * keine zweite Prüfung daneben. Die Datei selbst hängt ohnehin nicht an dieser
 * Seite, sondern an `is_platform_admin()` in `system_platform_export()` (0105)
 * und `system_auth_inventory()` (0107).
 *
 * DER TEXT IST DER EIGENTLICHE INHALT. Vier Aussagen müssen hängen bleiben,
 * weil jede teuer ist, wenn sie missverstanden wird: die Datei enthält die
 * ganze Plattform · das Auth-Inventar ist KEIN Auth-Restore · sie gehört in
 * keinen geteilten Ort · zurückspielen lässt sie sich nicht.
 */
export default async function PlatformBackupPage() {
  const runs = await fetchPlatformExportRuns();
  const now = new Date();
  const due = backupDue(runs, now);
  const days = daysSinceLastBackup(runs, now);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pt-8 pb-10 md:pt-12">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{copy.title}</h1>
        <p className="mt-2 text-sm text-muted">{copy.lead}</p>
      </div>

      {/*
        Der Zustand zuerst, weil er die Frage beantwortet, mit der jemand diese
        Seite öffnet. Fällig ist ein Hinweis, nicht ein Fehler — deshalb die
        Status-Farbe des Produkts und keine Gefahrenfarbe.
      */}
      {due ? (
        <section className="flex flex-col gap-1 rounded-sky-md bg-status-ground px-4 py-3 text-status-ink ring-1 ring-status-line">
          <h2 className="text-sm font-semibold">{copy.dueTitle}</h2>
          <p className="text-sm leading-relaxed">
            {days === null ? copy.dueNever : copy.dueSince(days)}
          </p>
        </section>
      ) : (
        <p className="text-sm text-muted">{copy.upToDate(days ?? 0)}</p>
      )}

      <PlatformBackupDownload />

      <section className="flex flex-col gap-2 rounded-sky-md bg-surface/70 px-4 py-3 ring-1 ring-border/70">
        <h2 className="text-sm font-medium tracking-wide text-muted uppercase">
          {copy.contains}
        </h2>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
          {copy.containsItems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      {/* Die wichtigste Abgrenzung des ganzen Formats. */}
      <section className="flex flex-col gap-1">
        <h2 className="text-sm font-medium tracking-wide text-muted uppercase">
          {copy.authTitle}
        </h2>
        <p className="text-sm leading-relaxed">{copy.authText}</p>
      </section>

      {/* Die Warnung bekommt die Farbe, die das Produkt für „hier aufpassen"
          hat — sie ist keine Fußnote. */}
      <section className="flex flex-col gap-1 rounded-sky-md bg-status-ground px-4 py-3 text-status-ink ring-1 ring-status-line">
        <h2 className="text-sm font-semibold">{copy.personal}</h2>
        <p className="text-sm leading-relaxed">{copy.personalText}</p>
      </section>

      <section className="flex flex-col gap-1">
        <h2 className="text-sm font-medium tracking-wide text-muted uppercase">
          {copy.noRestore}
        </h2>
        <p className="text-sm leading-relaxed">{copy.noRestoreText}</p>
      </section>

      <PlatformBackupHistory runs={runs} />
    </main>
  );
}
