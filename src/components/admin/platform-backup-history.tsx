/**
 * Die bisherigen Sicherungsläufe.
 *
 * WAS HIER STEHT UND WAS NICHT. Die Tabelle `platform_export_runs` enthält
 * absichtlich keine Inhalte, keine Käuferdaten und keine Fehlertexte — es gibt
 * also nichts Personenbezogenes anzuzeigen, und diese Komponente greift auch
 * nach nichts anderem. Die Prüfsumme steht nur gekürzt: vollständig wird sie
 * nicht gelesen, und verglichen wird sie ohnehin in der Datenbank.
 *
 * Eine Fehlerstufe wird ÜBERSETZT, nie roh ausgegeben. Ein unbekannter Wert
 * käme aus der Datenbank und hat auf dem Bildschirm nichts verloren; er wird
 * zu „aus einem nicht benannten Grund".
 *
 * Ein Serverkomponente ohne Zustand: die Liste kommt fertig von der Seite.
 */
import { formatDate } from "@/lib/format";
import {
  failureStageKey,
  humanBytes,
  shortHash,
  type PlatformExportRun,
} from "@/lib/backup/platform-history";
import { de } from "@/lib/i18n/de";

const copy = de.admin.platformBackup;

/** Die Farbe sagt dasselbe wie das Wort, für den schnellen Blick. */
function statusTone(status: string): string {
  if (status === "received") return "text-foreground";
  if (status === "failed") return "text-danger";
  return "text-muted";
}

export function PlatformBackupHistory({ runs }: { runs: readonly PlatformExportRun[] }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium tracking-wide text-muted uppercase">
        {copy.historyTitle}
      </h2>

      {runs.length === 0 ? (
        <p className="text-sm text-muted">{copy.historyEmpty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {runs.map((run) => {
            const stage = failureStageKey(run.failure_stage);
            const missing = run.storage_missing_count ?? 0;
            return (
              <li
                key={run.id}
                className="flex flex-col gap-1 rounded-sky-md bg-surface/80 px-4 py-3 text-sm ring-1 ring-border/70"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="font-medium">{formatDate(run.created_at)}</span>
                  <span className={statusTone(run.status)}>
                    {copy.status[run.status] ?? run.status}
                    {run.status === "failed"
                      ? ` — ${stage ? copy.failureStage[stage] : copy.failureUnknown}`
                      : null}
                  </span>
                </div>

                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted tabular-nums">
                  <span>
                    {copy.historySize}: {humanBytes(run.size_bytes)}
                  </span>
                  <span>
                    {copy.historySections}: {run.section_count ?? "–"}
                  </span>
                  <span>
                    {copy.historyFiles}: {run.storage_file_count ?? "–"}
                  </span>
                  {/* Die Prüfsumme nur gekürzt, und nur, wenn es eine gibt. */}
                  <span>
                    {copy.historyHash}: {shortHash(run.sha256)}
                  </span>
                </div>

                {/*
                  Eine Lücke wird genannt, nicht versteckt. Sie erscheint nur,
                  wenn es eine gibt — „0 fehlend" wäre eine Aussage über einen
                  Vorgang, den es nicht gab.
                */}
                {missing > 0 ? (
                  <p className="text-xs text-danger">{copy.missingHint(missing)}</p>
                ) : null}

                <p className="text-xs text-muted">
                  {copy.statusHint[run.status] ?? ""}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
