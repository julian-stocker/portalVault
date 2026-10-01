import { describe, expect, it } from "vitest";

import {
  BACKUP_INTERVAL_MS,
  FAILURE_STAGES,
  RUN_STATUSES,
  backupDue,
  confirmableRun,
  daysSinceLastBackup,
  failureStageKey,
  humanBytes,
  lastReceivedAt,
  shortHash,
  type PlatformExportRun,
} from "./platform-history";
import { de } from "../i18n/de";

/**
 * Die Regeln, an denen `received` und die Erinnerung hängen.
 *
 * Reine Funktionen, deshalb hier vollständig prüfbar. Genau das ist der
 * Grund, warum sie hier liegen und nicht in der Server Action: eine
 * Zuordnungsregel, die man nur gegen eine echte Datenbank ausprobieren kann,
 * wird irgendwann falsch, ohne dass es jemand merkt.
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-09-30T12:00:00.000Z");

function run(over: Partial<PlatformExportRun> = {}): PlatformExportRun {
  return {
    id: 1,
    status: "generated",
    created_at: "2026-09-30T11:59:00.000Z",
    received_at: null,
    format_version: 1,
    source_project: "qqxcpesbwfxzgytkdsac",
    size_bytes: 2240705,
    sha256: "a".repeat(64),
    section_count: 53,
    storage_file_count: 36,
    storage_missing_count: 0,
    failure_stage: null,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// 1. Welcher Lauf gehört zu diesem Download
// ---------------------------------------------------------------------------

describe("confirmableRun — exakt einer, sonst nichts", () => {
  const started = new Date("2026-09-30T11:58:00.000Z");

  it("findet den einen Lauf, der seit dem Start entstanden ist", () => {
    const match = confirmableRun([run({ id: 7 })], started);
    expect(match.ok).toBe(true);
    if (match.ok) {
      expect(match.run.id).toBe(7);
      expect(match.run.sha256).toBe("a".repeat(64));
    }
  });

  it("bestätigt nichts, wenn es keinen Kandidaten gibt", () => {
    const match = confirmableRun([], started);
    expect(match).toEqual({ ok: false, reason: "none", candidates: 0 });
  });

  it("bestätigt nichts, wenn es mehrere gibt — auch nicht den neuesten", () => {
    /*
     * Zwei gleichzeitige Downloads erzeugen zwei Läufe. Den neuesten zu
     * nehmen hieße, `received` an eine Datei zu hängen, die niemand geprüft
     * hat — und genau dafür gibt es diesen Zustand.
     */
    const match = confirmableRun(
      [run({ id: 8, created_at: "2026-09-30T11:59:30.000Z" }), run({ id: 7 })],
      started,
    );
    expect(match).toEqual({ ok: false, reason: "ambiguous", candidates: 2 });
  });

  it("sieht Läufe von vor dem Start nicht an", () => {
    const match = confirmableRun([run({ created_at: "2026-09-30T11:57:59.999Z" })], started);
    expect(match.ok).toBe(false);
  });

  it("nimmt einen Lauf, der genau im Startmoment entstand", () => {
    // `>=`: der Server kann die Zeile in derselben Millisekunde anlegen.
    const match = confirmableRun([run({ created_at: started.toISOString() })], started);
    expect(match.ok).toBe(true);
  });

  it("sieht weder received noch failed an", () => {
    for (const status of ["received", "failed"]) {
      expect(confirmableRun([run({ status })], started).ok).toBe(false);
    }
  });

  it("verweigert einen Lauf ohne brauchbare Prüfsumme", () => {
    // `admin_settle_platform_export()` würde ohnehin ablehnen; hier fällt es
    // auf, bevor eine Runde zur Datenbank geht.
    for (const sha256 of [null, "", "ZZZ", "a".repeat(63), "A".repeat(64)]) {
      expect(confirmableRun([run({ sha256 })], started).ok, String(sha256)).toBe(false);
    }
  });

  it("verträgt eine unlesbare Zeitangabe", () => {
    expect(confirmableRun([run({ created_at: "gestern" })], started).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Die Fälligkeit
// ---------------------------------------------------------------------------

describe("backupDue — nur received zählt, 7 × 24 Stunden", () => {
  const received = (daysAgo: number, over: Partial<PlatformExportRun> = {}) =>
    run({
      status: "received",
      received_at: new Date(NOW.getTime() - daysAgo * DAY).toISOString(),
      ...over,
    });

  it("sieben Tage sind sieben mal vierundzwanzig Stunden", () => {
    expect(BACKUP_INTERVAL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("kein Lauf → fällig", () => {
    expect(backupDue([], NOW)).toBe(true);
    expect(daysSinceLastBackup([], NOW)).toBeNull();
  });

  it("bestätigt vor 8 Tagen → fällig", () => {
    expect(backupDue([received(8)], NOW)).toBe(true);
    expect(daysSinceLastBackup([received(8)], NOW)).toBe(8);
  });

  it("exakt 7 Tage alt → fällig", () => {
    // Die Grenze gehört zur Erinnerung, nicht zur Schonfrist.
    expect(backupDue([received(7)], NOW)).toBe(true);
  });

  it("eine Millisekunde jünger als 7 Tage → nicht fällig", () => {
    const fast = run({
      status: "received",
      received_at: new Date(NOW.getTime() - BACKUP_INTERVAL_MS + 1).toISOString(),
    });
    expect(backupDue([fast], NOW)).toBe(false);
  });

  it("bestätigt vor 6 Tagen → nicht fällig", () => {
    expect(backupDue([received(6)], NOW)).toBe(false);
    expect(daysSinceLastBackup([received(6)], NOW)).toBe(6);
  });

  it("ein neuer generated nach einem alten received ändert nichts", () => {
    /*
     * Der Kern der Regel: ein erzeugtes Archiv, das niemand hat, ist keine
     * Sicherung. Sonst würde ein abgebrochener Download die Erinnerung
     * abstellen.
     */
    const runs = [run({ id: 9, created_at: NOW.toISOString() }), received(9)];
    expect(backupDue(runs, NOW)).toBe(true);
    expect(daysSinceLastBackup(runs, NOW)).toBe(9);
  });

  it("ein neuer failed nach einem alten received ändert nichts", () => {
    const runs = [
      run({ id: 9, status: "failed", failure_stage: "confirmation" }),
      received(9),
    ];
    expect(backupDue(runs, NOW)).toBe(true);
  });

  it("nimmt den neuesten bestätigten, egal in welcher Reihenfolge sie kommen", () => {
    expect(daysSinceLastBackup([received(9), received(2), received(30)], NOW)).toBe(2);
    expect(backupDue([received(9), received(2), received(30)], NOW)).toBe(false);
  });

  it("ignoriert ein received ohne Zeitpunkt und eine unlesbare Zeit", () => {
    expect(backupDue([run({ status: "received", received_at: null })], NOW)).toBe(true);
    expect(backupDue([run({ status: "received", received_at: "neulich" })], NOW)).toBe(true);
    expect(lastReceivedAt([run({ status: "received", received_at: null })])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. Was der Bildschirm daraus macht
// ---------------------------------------------------------------------------

describe("die Darstellung bleibt bei dem, was die Datenbank kennt", () => {
  it("die drei Zustände sind die aus 0105 — und alle drei haben einen Text", () => {
    expect([...RUN_STATUSES]).toEqual(["generated", "received", "failed"]);
    for (const status of RUN_STATUSES) {
      expect(de.admin.platformBackup.status[status], status).toBeTruthy();
      expect(de.admin.platformBackup.statusHint[status], status).toBeTruthy();
    }
  });

  it("die sechs Fehlerstufen sind die aus 0105 — und alle sechs haben einen Text", () => {
    expect([...FAILURE_STAGES]).toEqual([
      "database", "auth_inventory", "storage_manifest",
      "storage_files", "archive", "confirmation",
    ]);
    for (const stage of FAILURE_STAGES) {
      const text = de.admin.platformBackup.failureStage[stage];
      expect(text, stage).toBeTruthy();
      // Deutsch, nicht der Schlüssel selbst.
      expect(text, stage).not.toBe(stage);
    }
  });

  it("eine unbekannte Stufe wird nicht roh angezeigt", () => {
    // Sie käme aus der Datenbank und hätte auf dem Bildschirm nichts verloren.
    expect(failureStageKey("etwas_neues")).toBeNull();
    expect(failureStageKey(null)).toBeNull();
    expect(failureStageKey("archive")).toBe("archive");
  });

  it("Größen lesen sich wie Größen", () => {
    expect(humanBytes(0)).toBe("0 B");
    expect(humanBytes(512)).toBe("512 B");
    expect(humanBytes(2048)).toBe("2 KB");
    expect(humanBytes(2_240_705)).toBe("2.1 MB");
    expect(humanBytes(3_221_225_472)).toBe("3.00 GB");
    expect(humanBytes(null)).toBe("–");
    expect(humanBytes(-1)).toBe("–");
  });

  it("die Prüfsumme steht nie vollständig da", () => {
    const full = "0123456789abcdef".repeat(4);
    expect(shortHash(full)).toBe("0123456789ab…");
    expect(shortHash(full)).not.toContain(full);
    expect(shortHash(full).length).toBeLessThan(20);
    expect(shortHash(null)).toBe("–");
  });
});
