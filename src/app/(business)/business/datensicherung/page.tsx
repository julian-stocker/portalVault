import type { Metadata } from "next";

import { BackupDownload } from "@/components/business/backup-download";
import { de } from "@/lib/i18n/de";

export const metadata: Metadata = { title: de.business.backup.title };

const copy = de.business.backup;

/**
 * Datensicherung (V1).
 *
 * WER HIERHER KOMMT, IST BEREITS GEPRÜFT. Das Layout über `(business)` fragt
 * `capabilities()` und antwortet einem Nicht-Betrieb mit 404; diese Seite
 * baut keine eigene Prüfung daneben. Die Datei selbst hängt ohnehin nicht an
 * dieser Seite, sondern an `can_operate_active_seller()` in der Datenbank.
 *
 * DER TEXT IST DER EIGENTLICHE INHALT DIESER SEITE. Drei Aussagen müssen
 * hängen bleiben, weil jede von ihnen teuer ist, wenn sie missverstanden
 * wird: die Datei enthält Käuferdaten, sie gehört in keinen geteilten Ort,
 * und sie lässt sich nicht zurückspielen. Ein Backup, das jemand für einen
 * Restore hält, ist gefährlicher als gar keins.
 */
export default function BusinessBackupPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pt-8 pb-10 md:pt-12">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{copy.title}</h1>
        <p className="mt-2 text-sm text-muted">{copy.lead}</p>
      </div>

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

      {/* Die Warnung bekommt die Farbe, die das Produkt für „hier aufpassen"
          hat — sie ist keine Fußnote. */}
      <section className="flex flex-col gap-1 rounded-sky-md bg-status-ground px-4 py-3 text-status-ink ring-1 ring-status-line">
        <h2 className="text-sm font-semibold">{copy.personal}</h2>
        <p className="text-sm leading-relaxed">{copy.personalText}</p>
      </section>

      <section className="flex flex-col gap-1">
        <h2 className="text-sm font-medium tracking-wide text-muted uppercase">
          {copy.purpose}
        </h2>
        <p className="text-sm leading-relaxed">{copy.purposeText}</p>
      </section>

      <section className="flex flex-col gap-1">
        <h2 className="text-sm font-medium tracking-wide text-muted uppercase">
          {copy.noRestore}
        </h2>
        <p className="text-sm leading-relaxed">{copy.noRestoreText}</p>
      </section>

      <BackupDownload />
    </main>
  );
}
