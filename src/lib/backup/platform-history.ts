/**
 * Die Exporthistorie, als reine Rechnung.
 *
 * Drei Fragen, und alle drei sollen ohne Datenbank und ohne Browser prüfbar
 * sein:
 *
 *   1. Welcher Lauf gehört zu diesem Download?   `confirmableRun()`
 *   2. Ist eine Sicherung fällig?                `backupDue()`
 *   3. Wie liest ein Mensch eine Zeile?          `failureStageKey()`, `humanBytes()`
 *
 * WARUM DAS HIER LIEGT UND NICHT IN DER SERVER ACTION. Die Zuordnungsregel
 * ist die heikelste Stelle des ganzen Ablaufs: sie entscheidet, ob ein Lauf
 * als `received` gilt, und `received` ist die einzige Aussage, die „liegt
 * außerhalb" bedeutet. Eine Regel, die man nur durch Ausprobieren gegen eine
 * echte Datenbank prüfen kann, ist eine Regel, die irgendwann falsch wird.
 *
 * Kein Datenbankzugriff, kein `fetch`, keine Umgebungsvariable, kein `Date`
 * ohne Argument.
 */

/** Eine Zeile aus `admin_platform_export_runs()` (0106). */
export type PlatformExportRun = {
  id: number;
  status: string;
  created_at: string;
  received_at: string | null;
  format_version: number | null;
  source_project: string | null;
  size_bytes: number | null;
  sha256: string | null;
  section_count: number | null;
  storage_file_count: number | null;
  storage_missing_count: number | null;
  failure_stage: string | null;
};

/* --------------------------------------------------------------------------
 * 1. Welcher Lauf gehört zu diesem Download
 * ----------------------------------------------------------------------- */

/**
 * Warum kein Lauf bestätigt werden konnte.
 *
 * Beides führt zu derselben neutralen Meldung auf dem Bildschirm; getrennt
 * geführt, weil „keiner" und „mehrere" verschiedene Ursachen haben und ein
 * späterer Leser das unterscheiden können soll.
 */
export type NoRunReason = "none" | "ambiguous";

export type RunMatch =
  | { ok: true; run: PlatformExportRun }
  | { ok: false; reason: NoRunReason; candidates: number };

/**
 * Der eine Lauf, der zu diesem Download gehört — oder keiner.
 *
 * EXAKT EINER, SONST NICHTS. Betrachtet werden nur Läufe mit
 * `status = 'generated'`, die seit dem Zeitpunkt entstanden sind, zu dem der
 * Browser die Anfrage abgeschickt hat. Sind es null, wurde nichts gebucht;
 * sind es mehrere, kann niemand sagen, welcher gemeint ist.
 *
 * DEN NEUESTEN ZU NEHMEN WÄRE DER FEHLER, DEN MAN NICHT BEMERKT. Zwei
 * gleichzeitige Downloads erzeugen zwei Läufe; der eine würde als bestätigt
 * geführt, obwohl die Datei zum anderen gehört. `received` wäre dann eine
 * Aussage über eine Datei, die niemand geprüft hat — und genau dafür gibt es
 * diesen Zustand.
 *
 * Die Prüfsumme kommt aus der Historienzeile, nie vom Aufrufer: wer den Hash
 * mitschicken dürfte, könnte jede Zeile bestätigen.
 */
export function confirmableRun(
  runs: readonly PlatformExportRun[],
  startedAt: Date,
): RunMatch {
  const since = startedAt.getTime();
  const candidates = runs.filter((run) => {
    if (run.status !== "generated") return false;
    const created = Date.parse(run.created_at);
    return Number.isFinite(created) && created >= since;
  });

  if (candidates.length === 1) {
    const run = candidates[0];
    // Ohne Prüfsumme gibt es nichts zu vergleichen, und
    // `admin_settle_platform_export()` würde ohnehin ablehnen.
    if (typeof run.sha256 === "string" && /^[0-9a-f]{64}$/.test(run.sha256)) {
      return { ok: true, run };
    }
    return { ok: false, reason: "none", candidates: 0 };
  }

  return {
    ok: false,
    reason: candidates.length === 0 ? "none" : "ambiguous",
    candidates: candidates.length,
  };
}

/* --------------------------------------------------------------------------
 * 2. Ist eine Sicherung fällig
 * ----------------------------------------------------------------------- */

/** Sieben Tage, in Millisekunden. Keine Kalenderlogik, kein Zeitzonenspiel. */
export const BACKUP_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Wann zuletzt eine Sicherung nachweislich außerhalb lag.
 *
 * NUR `received` ZÄHLT. Ein `generated` heißt, dass der Server ein Archiv
 * geschrieben hat — nicht, dass es jemand hat. Ein `failed` heißt gar nichts.
 * Die Erinnerung soll an die Sicherung erinnern, nicht an den Versuch.
 */
export function lastReceivedAt(runs: readonly PlatformExportRun[]): Date | null {
  let newest: number | null = null;
  for (const run of runs) {
    if (run.status !== "received" || run.received_at === null) continue;
    const at = Date.parse(run.received_at);
    if (!Number.isFinite(at)) continue;
    if (newest === null || at > newest) newest = at;
  }
  return newest === null ? null : new Date(newest);
}

/**
 * Ist eine Sicherung fällig?
 *
 * Fällig, wenn es keinen bestätigten Lauf gibt oder der letzte länger als
 * 7 × 24 Stunden her ist. Genau 7 Tage alt ist **fällig** — die Grenze
 * gehört zur Erinnerung, nicht zur Schonfrist.
 */
export function backupDue(runs: readonly PlatformExportRun[], now: Date): boolean {
  const last = lastReceivedAt(runs);
  if (last === null) return true;
  return now.getTime() - last.getTime() >= BACKUP_INTERVAL_MS;
}

/** Wie viele volle Tage seit der letzten Bestätigung. `null`, wenn keine. */
export function daysSinceLastBackup(
  runs: readonly PlatformExportRun[],
  now: Date,
): number | null {
  const last = lastReceivedAt(runs);
  if (last === null) return null;
  return Math.floor((now.getTime() - last.getTime()) / (24 * 60 * 60 * 1000));
}

/* --------------------------------------------------------------------------
 * 3. Wie ein Mensch eine Zeile liest
 * ----------------------------------------------------------------------- */

/** Die drei Zustände aus `0105`. */
export const RUN_STATUSES = ["generated", "received", "failed"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export function isRunStatus(value: string): value is RunStatus {
  return (RUN_STATUSES as readonly string[]).includes(value);
}

/** Die Fehlerstufen aus dem CHECK in `0105`. */
export const FAILURE_STAGES = [
  "database", "auth_inventory", "storage_manifest",
  "storage_files", "archive", "confirmation",
] as const;
export type FailureStageKey = (typeof FAILURE_STAGES)[number];

/**
 * Die Stufe eines Fehlschlags als Schlüssel für die Übersetzung.
 *
 * Eine unbekannte Stufe wird nicht erfunden und nicht roh angezeigt — sie
 * käme aus der Datenbank und hätte auf dem Bildschirm nichts verloren.
 */
export function failureStageKey(value: string | null): FailureStageKey | null {
  if (value === null) return null;
  return (FAILURE_STAGES as readonly string[]).includes(value)
    ? (value as FailureStageKey)
    : null;
}

/** Eine Größe, wie ein Mensch sie liest. */
export function humanBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return "–";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Die Prüfsumme, gekürzt.
 *
 * Vollständig gehört sie nicht auf einen Bildschirm — sie ist lang, sie wird
 * nicht gelesen, und der Vergleich passiert ohnehin in der Datenbank. Die
 * ersten zwölf Zeichen reichen, um zwei Läufe auseinanderzuhalten.
 */
export function shortHash(sha256: string | null): string {
  return typeof sha256 === "string" && sha256.length >= 12 ? `${sha256.slice(0, 12)}…` : "–";
}
