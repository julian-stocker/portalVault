/**
 * Der Knopf, der die Sicherung holt (V1).
 *
 * WARUM `fetch` UND NICHT EIN LINK. Ein `<a download>` startet den Download
 * und sagt danach nichts mehr: kein Ladezustand, keine Fehlermeldung, und
 * ein zweiter Klick startet eine zweite Anfrage. Das Dokument entsteht in
 * der Datenbank in einem Rutsch und dauert einen Moment — genau die
 * Situation, für die `PendingButton` gebaut wurde.
 *
 * Geholt, im Speicher gehalten, als Datei gereicht, Objekt-URL wieder
 * freigegeben. Nichts landet in `localStorage`, `sessionStorage` oder
 * IndexedDB — die Datei enthält Käuferadressen und hat im Browserspeicher
 * nichts verloren.
 *
 * Der Dateiname kommt aus dem `Content-Disposition` des Servers, damit es
 * nur eine Stelle gibt, die ihn bildet.
 */
"use client";

import { useState } from "react";

import { ACTION_PRIMARY } from "@/components/ui/action";
import { PendingButton } from "@/components/ui/pending";
import { de } from "@/lib/i18n/de";

const copy = de.business.backup;

/** Der Dateiname aus dem Header, oder ein Rückfall. */
function fileNameFrom(disposition: string | null): string {
  const match = disposition?.match(/filename="([^"]+)"/);
  return match?.[1] ?? "skyisles-business-backup.json";
}

function human(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function BackupDownload() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function download() {
    // Zweiter Riegel neben `PendingButton`: zwei Klicks in einem Frame
    // dürfen nicht zwei Anfragen auslösen.
    if (pending) return;
    setPending(true);
    setError(null);
    setDone(null);

    try {
      const response = await fetch("/business/datensicherung/download", {
        cache: "no-store",
      });
      if (!response.ok) {
        setError(response.status === 404 ? copy.denied : copy.failed);
        return;
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      try {
        const link = document.createElement("a");
        link.href = url;
        link.download = fileNameFrom(response.headers.get("Content-Disposition"));
        link.click();
      } finally {
        // Sonst hält der Browser die Datei im Speicher, solange die Seite steht.
        URL.revokeObjectURL(url);
      }
      setDone(copy.done(human(blob.size)));
    } catch {
      setError(copy.failed);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <PendingButton
        type="button"
        onClick={() => void download()}
        pending={pending}
        pendingLabel={copy.downloading}
        className={`${ACTION_PRIMARY} w-auto gap-2 self-start`}
      >
        {copy.download}
      </PendingButton>

      {error ? (
        <p role="alert" className="text-sm text-danger">{error}</p>
      ) : null}
      {done ? (
        <p role="status" className="text-sm text-muted">{done}</p>
      ) : null}
    </div>
  );
}
