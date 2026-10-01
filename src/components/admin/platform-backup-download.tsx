/**
 * Der Knopf, der die Plattformsicherung holt — und den Lauf bestätigt.
 *
 * DIE REIHENFOLGE IST DIE AUSSAGE. `received` heißt: der vollständige Blob lag
 * beim Empfänger. Bewiesen ist das erst, wenn `await response.blob()`
 * aufgelöst hat — nicht bei `response.ok` (da sind erst die Kopfzeilen da)
 * und nicht beim Beginn des Stroms. Deshalb passiert die Bestätigung
 * ausschließlich NACH dem `await blob()`, und `platform-backup-ui.test.ts`
 * hält diese Reihenfolge fest.
 *
 * WAS `received` NICHT HEISST: dass die Datei dauerhaft auf einer Platte
 * liegt. Das kann ein Browser nicht beweisen, und wir behaupten es nicht. Es
 * ist die stärkste Aussage, die technisch erreichbar ist.
 *
 * DER ZEITPUNKT VOR DER ANFRAGE ist das Einzige, was dieser Client der Server
 * Action mitgibt. `id` und `sha256` ermittelt sie selbst aus der Historie —
 * wer den Hash mitschicken dürfte, könnte jede Zeile bestätigen, ohne je eine
 * Datei gesehen zu haben.
 *
 * DIE DATEI BLEIBT DEM ADMIN, AUCH WENN DIE BESTÄTIGUNG SCHEITERT. Eine
 * heruntergeladene Sicherung ist eine Sicherung; dass die Buchung nicht
 * durchkam, ist ein Buchungsproblem. Der Text sagt beides getrennt.
 *
 * Nichts landet in `localStorage`, `sessionStorage` oder IndexedDB — die Datei
 * enthält E-Mail-Adressen, Käuferadressen und Einkaufspreise und hat im
 * Browserspeicher nichts verloren.
 */
"use client";

import { useState } from "react";

import { ACTION_PRIMARY } from "@/components/ui/action";
import { PendingButton } from "@/components/ui/pending";
import { confirmPlatformBackup } from "@/lib/admin/backup-actions";
import { platformArchiveFileName } from "@/lib/backup/platform-archive";
import { humanBytes } from "@/lib/backup/platform-history";
import { de } from "@/lib/i18n/de";

const copy = de.admin.platformBackup;

/**
 * Der Dateiname aus dem Header, oder der kanonische Helfer.
 *
 * Kein zweiter Namensbau: der Rückfall ist dieselbe Funktion, aus der der
 * Server den Namen bildet. Ein selbstgebauter Name hier wäre eine zweite
 * Wahrheit über etwas, das nur eine haben darf.
 */
export function fileNameFrom(disposition: string | null, now: Date): string {
  const match = disposition?.match(/filename="([^"]+)"/);
  const name = match?.[1];
  // Ein Name aus einem Header ist Eingabe. Pfadtrenner und Steuerzeichen
  // haben in einem Dateinamen nichts verloren.
  if (typeof name === "string" && /^[A-Za-z0-9._-]{1,120}$/.test(name)) return name;
  return platformArchiveFileName(now);
}

type Outcome =
  | { kind: "confirmed"; size: number }
  | { kind: "unconfirmed"; size: number }
  | { kind: "failed" };

export function PlatformBackupDownload() {
  const [pending, setPending] = useState(false);
  const [label, setLabel] = useState<string>(copy.downloading);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  async function run() {
    // Zweiter Riegel neben `PendingButton`: zwei Klicks in einem Frame dürfen
    // nicht zwei Anfragen und damit nicht zwei Läufe auslösen.
    if (pending) return;
    setPending(true);
    setLabel(copy.downloading);
    setOutcome(null);

    // VOR der Anfrage. Die Server Action betrachtet nur Läufe ab hier.
    const startedAt = new Date();

    try {
      const response = await fetch("/admin/datensicherung/download", { cache: "no-store" });
      if (!response.ok) {
        setOutcome({ kind: "failed" });
        return;
      }

      /*
       * HIER, und keinen Schritt früher, ist der vollständige Körper beim
       * Browser angekommen.
       */
      const blob = await response.blob();

      const url = URL.createObjectURL(blob);
      try {
        const link = document.createElement("a");
        link.href = url;
        link.download = fileNameFrom(response.headers.get("Content-Disposition"), new Date());
        link.click();
      } finally {
        // Sonst hält der Browser die ganze Datei im Speicher, solange die
        // Seite steht.
        URL.revokeObjectURL(url);
      }

      setLabel(copy.confirming);
      const confirmed = await confirmPlatformBackup(startedAt.toISOString());
      setOutcome({ kind: confirmed.ok ? "confirmed" : "unconfirmed", size: blob.size });
    } catch {
      // Kein Grund und kein Detail: eine Meldung von `fetch` kann eine
      // Adresse tragen, und die Oberfläche sagt ohnehin nur den einen Satz.
      setOutcome({ kind: "failed" });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <PendingButton
        type="button"
        onClick={() => void run()}
        pending={pending}
        pendingLabel={label}
        className={`${ACTION_PRIMARY} w-auto gap-2 self-start`}
      >
        {copy.download}
      </PendingButton>

      {outcome?.kind === "confirmed" ? (
        <p role="status" className="text-sm text-muted">
          {copy.doneConfirmed} ({humanBytes(outcome.size)})
        </p>
      ) : null}

      {outcome?.kind === "unconfirmed" ? (
        /* Kein `alert`: die Datei ist da. Nur die Buchung fehlt. */
        <p role="status" className="text-sm text-status-ink">
          {copy.doneUnconfirmed} ({humanBytes(outcome.size)})
        </p>
      ) : null}

      {outcome?.kind === "failed" ? (
        <p role="alert" className="text-sm text-danger">{copy.failed}</p>
      ) : null}
    </div>
  );
}
