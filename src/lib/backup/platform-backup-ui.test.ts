import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { fileNameFrom } from "@/components/admin/platform-backup-download";
import { platformArchiveFileName } from "./platform-archive";
import { FAILURE_STAGES, RUN_STATUSES } from "./platform-history";
import { de } from "../i18n/de";

/**
 * Seite, Knopf, Bestätigung und Erinnerung.
 *
 * WARUM AM QUELLTEXT. Diese Dateien hängen an React, an `next/headers` und an
 * einem Request-Kontext, den es in vitest nicht gibt. Was hier zählt, sind
 * ohnehin Eigenschaften der Dateien und nicht ihres gerenderten Ergebnisses:
 * in welcher REIHENFOLGE etwas passiert, welche Funktionen gerufen werden und
 * welche nicht. Die eigentliche Logik — Zuordnung, Fälligkeit, Darstellung —
 * ist in `platform-history.test.ts` als reine Funktion durchgespielt.
 */

/** Ausführbarer Code: die Kopfkommentare erklären gerade, was NICHT passiert. */
function codeOf(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//"))
    .join("\n");
}

const PAGE = "src/app/(admin)/admin/datensicherung/page.tsx";
const BUTTON = "src/components/admin/platform-backup-download.tsx";
const HISTORY = "src/components/admin/platform-backup-history.tsx";
const NOTICE = "src/components/admin/backup-due-notice.tsx";
const ACTION = "src/lib/admin/backup-actions.ts";
const QUERY = "src/lib/admin/backup-history.ts";
const DASHBOARD = "src/app/(admin)/admin/page.tsx";

const page = codeOf(PAGE);
const button = codeOf(BUTTON);
const history = codeOf(HISTORY);
const notice = codeOf(NOTICE);
const action = codeOf(ACTION);
const query = codeOf(QUERY);
const dashboard = codeOf(DASHBOARD);
const copy = de.admin.platformBackup;

// ---------------------------------------------------------------------------
// 1. Die Seite
// ---------------------------------------------------------------------------

describe("die Admin-Seite", () => {
  it("liegt im geschützten Adminbereich und baut keine zweite Prüfung", () => {
    // Das `(admin)`-Layout fragt `capabilities()` und antwortet einem
    // Nicht-Admin mit 404. Eine zweite Prüfung hier wäre eine zweite Wahrheit.
    expect(PAGE.startsWith("src/app/(admin)/admin/")).toBe(true);
    expect(page).not.toContain("isPlatformAdmin");
    expect(page).not.toContain("notFound");
  });

  it("wird nie zwischengelagert", () => {
    expect(page).toContain('export const dynamic = "force-dynamic"');
  });

  it("erklärt, was drin ist — alle neun Punkte", () => {
    expect(page).toContain("copy.containsItems.map");
    expect(copy.containsItems).toHaveLength(9);
    for (const wort of ["Plattform-Datenbank", "Katalog", "Sammlungsdaten",
                        "Verkäufer- und Shopdaten", "Lager und Orderbuch",
                        "Bestellungen", "Tester", "Inventar der Benutzerkonten",
                        "catalog-Speicher"]) {
      expect(copy.containsItems.join(" "), wort).toContain(wort);
    }
  });

  it("sagt, dass das Auth-Inventar kein Restore ist", () => {
    expect(page).toContain("copy.authTitle");
    expect(page).toContain("copy.authText");
    expect(copy.authTitle).toContain("kein Auth-Restore");
    expect(copy.authText).toContain("NICHT exportiert");
    for (const wort of ["Passwörter", "Tokens", "Zweitfaktor"]) {
      expect(copy.authText, wort).toContain(wort);
    }
  });

  it("warnt vor personenbezogenen Daten und vor geteilten Orten", () => {
    expect(page).toContain("copy.personalText");
    for (const wort of ["E-Mail-Adressen", "Anschriften", "Einkaufspreise",
                        "Repository", "Git", "GitHub", "geteilten Ordner"]) {
      expect(copy.personalText, wort).toContain(wort);
    }
  });

  it("sagt, dass es keinen Restore gibt", () => {
    expect(page).toContain("copy.noRestoreText");
    expect(copy.noRestoreText).toContain("nicht unterstützt");
  });

  it("nutzt die vorhandenen Bausteine statt einer eigenen Designsprache", () => {
    for (const klasse of ["rounded-sky-md", "bg-surface/70", "ring-border/70",
                          "bg-status-ground", "text-status-ink", "text-muted"]) {
      expect(page, klasse).toContain(klasse);
    }
    // Kein Inline-Style, keine eigenen Farben.
    expect(page).not.toContain("style={{");
    expect(page).not.toMatch(/#[0-9a-fA-F]{6}/);
  });

  it("holt die Historie über die vorhandene Leseschicht", () => {
    expect(page).toContain("fetchPlatformExportRuns()");
    expect(page).toContain("<PlatformBackupHistory runs={runs} />");
    expect(page).toContain("<PlatformBackupDownload />");
  });
});

// ---------------------------------------------------------------------------
// 2. Der Knopf und die Reihenfolge
// ---------------------------------------------------------------------------

describe("der Download", () => {
  it("ist eine Clientkomponente mit einem Knopf", () => {
    expect(button).toContain('"use client"');
    expect(button).toContain("<PendingButton");
    expect(button).toContain("{copy.download}");
    expect(copy.download).toBe("Plattform-Datensicherung erstellen");
  });

  it("merkt sich den Zeitpunkt VOR der Anfrage", () => {
    expect(button).toContain("const startedAt = new Date();");
    expect(button.indexOf("const startedAt")).toBeLessThan(button.indexOf("await fetch("));
  });

  it("holt die Adminroute ohne Zwischenspeicher", () => {
    expect(button).toContain('fetch("/admin/datensicherung/download", { cache: "no-store" })');
  });

  it("sperrt den Knopf und fängt den zweiten Klick doppelt ab", () => {
    expect(button).toContain("if (pending) return;");
    expect(button).toContain("setPending(true)");
    expect(button).toContain("pending={pending}");
    expect(button).toContain("pendingLabel={label}");
    expect(button).toContain("finally");
    expect(button).toContain("setPending(false)");
  });

  it("prüft response.ok, bevor irgendetwas weitergeht", () => {
    expect(button).toContain("if (!response.ok)");
    expect(button.indexOf("if (!response.ok)")).toBeLessThan(button.indexOf("response.blob()"));
  });

  it("bestätigt ERST nach dem vollständigen Blob", () => {
    /*
     * Die entscheidende Reihenfolge des ganzen Ablaufs. `response.ok` heißt
     * nur, dass die Kopfzeilen da sind; erst `await blob()` heißt, dass der
     * vollständige Körper beim Browser angekommen ist. Genau das behauptet
     * `received`.
     */
    const blobAt = button.indexOf("await response.blob()");
    const confirmAt = button.indexOf("await confirmPlatformBackup(");
    expect(blobAt).toBeGreaterThan(-1);
    expect(confirmAt).toBeGreaterThan(-1);
    expect(blobAt).toBeLessThan(confirmAt);
    // Und nicht parallel: kein Promise.all um die beiden.
    expect(button).not.toContain("Promise.all");
    expect(button).not.toContain("void confirmPlatformBackup");
  });

  it("übergibt der Action nur den Zeitpunkt, nie id oder Prüfsumme", () => {
    expect(button).toContain("confirmPlatformBackup(startedAt.toISOString())");
    for (const verboten of ["sha256", "run.id", "runId", "p_id", "p_sha256"]) {
      expect(button.includes(verboten), `${verboten} darf der Client nicht vorgeben`).toBe(false);
    }
  });

  it("reicht den Blob als Datei und gibt die Objekt-URL wieder frei", () => {
    expect(button).toContain("URL.createObjectURL(blob)");
    expect(button).toContain("link.click()");
    expect(button).toContain("URL.revokeObjectURL(url)");
    // Im `finally`, damit ein Fehler beim Klicken die URL nicht hängen lässt.
    const revoke = button.indexOf("URL.revokeObjectURL(url)");
    const fin = button.lastIndexOf("} finally {", revoke);
    expect(fin).toBeGreaterThan(-1);
  });

  it("legt nichts im Browserspeicher ab", () => {
    for (const verboten of ["localStorage", "sessionStorage", "indexedDB", "document.cookie"]) {
      expect(button.includes(verboten), `${verboten} ist kein Ort für diese Datei`).toBe(false);
    }
  });

  it("kennt die drei Ergebniszustände und sagt sie getrennt", () => {
    expect(button).toContain("copy.doneConfirmed");
    expect(button).toContain("copy.doneUnconfirmed");
    expect(button).toContain("copy.failed");
    expect(copy.doneConfirmed).toBe("Datensicherung erstellt und bestätigt.");
    expect(copy.doneUnconfirmed).toContain("konnte nicht abgeschlossen werden");
    expect(copy.failed).toBe("Die Datensicherung konnte nicht erstellt werden.");
  });

  it("verwirft eine empfangene Datei nicht, nur weil die Bestätigung fehlt", () => {
    // Der „unconfirmed"-Zustand trägt die Größe und ist kein `alert`.
    expect(button).toContain('kind: confirmed.ok ? "confirmed" : "unconfirmed"');
    const start = button.indexOf('outcome?.kind === "unconfirmed"');
    const block = button.slice(start, button.indexOf(") : null}", start));
    expect(block).toContain('role="status"');
    expect(block).not.toContain('role="alert"');
  });

  it("zeigt keine interne Fehlermeldung", () => {
    for (const verboten of ["error.message", "String(error)", "catch (error)",
                            "console.log", "console.error", "response.statusText"]) {
      expect(button.includes(verboten), `${verboten} gehört nicht auf den Bildschirm`).toBe(false);
    }
  });
});

describe("der Dateiname", () => {
  it("kommt aus dem Header, wenn er sicher ist", () => {
    expect(fileNameFrom('attachment; filename="skyisles-platform-backup-2026-09-30T143012Z.zip"', new Date()))
      .toBe("skyisles-platform-backup-2026-09-30T143012Z.zip");
  });

  it("fällt auf denselben kanonischen Helfer zurück — keine zweite Namenslogik", () => {
    const now = new Date("2026-09-30T14:30:12.000Z");
    expect(fileNameFrom(null, now)).toBe(platformArchiveFileName(now));
    expect(fileNameFrom("attachment", now)).toBe(platformArchiveFileName(now));
    expect(button).toContain("platformArchiveFileName(now)");
    // Kein selbstgebauter Name daneben.
    expect(button).not.toContain("toISOString().replace");
    expect(button).not.toContain('".zip"');
  });

  it("weist einen unsicheren Namen aus dem Header ab", () => {
    const now = new Date("2026-09-30T14:30:12.000Z");
    for (const böse of [
      'attachment; filename="../../etc/passwd"',
      'attachment; filename="/tmp/x.zip"',
      'attachment; filename="a\\b.zip"',
      `attachment; filename="${"x".repeat(200)}.zip"`,
    ]) {
      expect(fileNameFrom(böse, now), böse).toBe(platformArchiveFileName(now));
    }
  });

  it("trägt keine Projektreferenz und keinen Benutzernamen", () => {
    const name = platformArchiveFileName(new Date("2026-09-30T14:30:12.000Z"));
    expect(name).not.toContain("qqxcpesbwfxzgytkdsac");
    expect(name).not.toContain("@");
    expect(name).not.toContain(":");
  });
});

// ---------------------------------------------------------------------------
// 3. Die Bestätigung
// ---------------------------------------------------------------------------

describe("die Server Action", () => {
  it("ist eine Server Action", () => {
    expect(action).toContain('"use server"');
  });

  it("fragt zuerst die bestehende Plattformadmin-Prüfung", () => {
    expect(action).toContain("if (!(await isPlatformAdmin()))");
    expect(action.indexOf("isPlatformAdmin()")).toBeLessThan(action.indexOf("createClient()"));
    // Keine eigene Rollenlogik daneben.
    for (const verboten of ["platform_admins", "is_platform_admin", "accountType",
                            "getUser", "getSession"]) {
      expect(action.includes(verboten), `${verboten} wäre eine zweite Wahrheit`).toBe(false);
    }
  });

  it("benutzt die echte Sitzung und keinen Service-Key", () => {
    expect(action).toContain('from "@/lib/supabase/server"');
    for (const verboten of ["SERVICE_ROLE", "service_role", "apikey", "Bearer"]) {
      expect(action.includes(verboten), `${verboten} gehört nicht hierher`).toBe(false);
    }
  });

  it("liest die Historie nur über admin_platform_export_runs()", () => {
    expect(action).toContain('rpc("admin_platform_export_runs")');
    for (const verboten of [".from(", ".select(", ".insert(", ".update(", ".delete("]) {
      expect(action.includes(verboten), `${verboten} wäre ein direkter Tabellenzugriff`)
        .toBe(false);
    }
    /*
     * Der Tabellenname als solcher: `admin_platform_export_runs` enthält ihn
     * als Teilzeichenkette, deshalb wird der Wortanfang mitgeprüft.
     */
    expect(action).not.toMatch(/(?<![a-z_])platform_export_runs/);
  });

  it("betrachtet nur generated seit startTime — über die geprüfte Regel", () => {
    expect(action).toContain("confirmableRun(");
    // Die Regel selbst steht nicht hier, sondern in platform-history.ts, und
    // ist dort ohne Datenbank durchgespielt.
    expect(action).not.toContain('=== "generated"');
    expect(action).not.toContain("sort(");
    expect(action).not.toContain("[0]");
  });

  it("bestätigt nicht, wenn es null oder mehrere Kandidaten gibt", () => {
    expect(action).toContain("if (!match.ok) return { ok: false, unconfirmed: true };");
    const settleAt = action.indexOf('rpc("admin_settle_platform_export"');
    expect(action.indexOf("if (!match.ok)")).toBeLessThan(settleAt);
  });

  it("nimmt id und Prüfsumme aus der Historienzeile, nicht vom Aufrufer", () => {
    expect(action).toContain("p_id: match.run.id");
    expect(action).toContain("p_sha256: match.run.sha256");
    // Der einzige Parameter der Action ist der Zeitpunkt.
    expect(action).toContain("confirmPlatformBackup(startedAtIso: string)");
    expect(action).not.toMatch(/confirmPlatformBackup\([^)]*sha256/);
    expect(action).not.toMatch(/confirmPlatformBackup\([^)]*id\s*:/);
  });

  it("akzeptiert den Erfolg nur, wenn die Datenbank received sagt", () => {
    expect(action).toContain('settled.data !== "received"');
  });

  it("setzt niemals eine Fehlerstufe und legt nie einen Lauf an", () => {
    for (const verboten of ["p_failure_stage", "admin_record_platform_export"]) {
      expect(action.includes(verboten), `${verboten} gehört nicht in die Bestätigung`).toBe(false);
    }
  });

  it("gibt keine Meldung aus der Datenbank weiter und protokolliert nichts", () => {
    for (const verboten of ["error.message", "String(error)", "console.log",
                            "console.error", "JSON.stringify"]) {
      expect(action.includes(verboten), `${verboten} könnte Inhalt tragen`).toBe(false);
    }
  });

  it("frischt beide Seiten auf, die sich ändern", () => {
    expect(action).toContain('revalidatePath("/admin")');
    expect(action).toContain("revalidatePath(PAGE)");
  });
});

describe("die Leseschicht der Historie", () => {
  it("liest ausschließlich über die Funktion aus 0106", () => {
    expect(query).toContain('rpc("admin_platform_export_runs")');
    for (const verboten of [".from(", ".select(", "SERVICE_ROLE", "service_role", "order("]) {
      expect(query.includes(verboten), `${verboten} gehört nicht hierher`).toBe(false);
    }
  });

  it("sortiert nicht nach — die Reihenfolge kommt aus der Datenbank", () => {
    expect(query).not.toContain("sort(");
    expect(query).not.toContain("reverse(");
  });
});

// ---------------------------------------------------------------------------
// 4. Die Historienanzeige
// ---------------------------------------------------------------------------

describe("die Historienanzeige", () => {
  it("zeigt Zeitpunkt, Status, Größe, Bereiche und Storage-Dateien", () => {
    for (const teil of ["formatDate(run.created_at)", "copy.status[run.status]",
                        "humanBytes(run.size_bytes)", "run.section_count",
                        "run.storage_file_count"]) {
      expect(history, teil).toContain(teil);
    }
  });

  it("macht eine Lücke sichtbar, aber erfindet keine", () => {
    expect(history).toContain("copy.missingHint(missing)");
    expect(history).toContain("missing > 0");
    expect(copy.missingHint(1)).toContain("1 Speicherdatei fehlt");
    expect(copy.missingHint(3)).toContain("3 Speicherdateien fehlen");
  });

  it("übersetzt die Fehlerstufe und zeigt keine unbekannte roh", () => {
    expect(history).toContain("failureStageKey(run.failure_stage)");
    expect(history).toContain("copy.failureStage[stage]");
    expect(history).toContain("copy.failureUnknown");
    // Nie der rohe Wert aus der Datenbank.
    expect(history).not.toContain("{run.failure_stage}");
  });

  it("zeigt die Prüfsumme nur gekürzt", () => {
    expect(history).toContain("shortHash(run.sha256)");
    expect(history).not.toContain("{run.sha256}");
  });

  it("zeigt nichts Personenbezogenes — es gibt dort auch nichts", () => {
    /*
     * `platform_export_runs` trägt weder Inhalte noch Konten; die Anzeige
     * greift zusätzlich nach nichts anderem.
     */
    for (const verboten of ["email", "username", "user_id", "created_by",
                            "customer", "address", "source_project"]) {
      expect(history.includes(verboten), `${verboten} gehört nicht in die Anzeige`).toBe(false);
    }
  });

  it("jeder Zustand und jede Stufe hat einen deutschen Text", () => {
    for (const status of RUN_STATUSES) expect(copy.status[status]).toBeTruthy();
    for (const stage of FAILURE_STAGES) expect(copy.failureStage[stage]).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 5. Die Wochenerinnerung
// ---------------------------------------------------------------------------

describe("die Erinnerung", () => {
  it("steht auf der Adminübersicht, nicht global auf jeder Seite", () => {
    expect(dashboard).toContain("<BackupDueNotice runs={backupRuns} />");
    expect(dashboard).toContain("fetchPlatformExportRuns()");
    // Nicht im Layout, das jede Adminseite umschließt.
    expect(codeOf("src/app/(admin)/layout.tsx")).not.toContain("BackupDueNotice");
  });

  it("entscheidet über die geprüfte Regel, nicht über eine eigene", () => {
    expect(notice).toContain("backupDue(runs, now)");
    expect(notice).toContain("daysSinceLastBackup(runs, now)");
    for (const verboten of ['=== "received"', "7 *", "getTime()", "Date.parse"]) {
      expect(notice.includes(verboten), `${verboten} wäre eine zweite Regel`).toBe(false);
    }
  });

  it("schweigt, wenn nichts fällig ist", () => {
    expect(notice).toContain("if (!backupDue(runs, now)) return null;");
  });

  it("führt zur Seite", () => {
    expect(notice).toContain('href={PAGE}');
    expect(notice).toContain('const PAGE = "/admin/datensicherung"');
    expect(copy.dueTitle).toBe("Datensicherung fällig");
    expect(copy.dueAction).toBeTruthy();
  });

  it("braucht weder Tabelle noch Zeitplan noch Nachricht", () => {
    const beides = `${notice}\n${dashboard}`;
    for (const verboten of ["cron", "setInterval", "setTimeout", "sendMail",
                            "resend", "Notification", "push", "webhook"]) {
      expect(beides.toLowerCase().includes(verboten.toLowerCase()),
        `${verboten} gehört nicht in die Erinnerung`).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Quer über alles
// ---------------------------------------------------------------------------

describe("die Grenzen gelten in jeder der neuen Dateien", () => {
  const alle = { page, button, history, notice, action, query };

  for (const [name, code] of Object.entries(alle)) {
    it(`${name}: kein Service-Key, kein Protokoll, kein Request-Host`, () => {
      for (const verboten of ["SERVICE_ROLE", "service_role", "console.log",
                              "console.error", "console.warn", "x-forwarded",
                              "headers()"]) {
        expect(code.includes(verboten), `${verboten} in ${name}`).toBe(false);
      }
    });

    it(`${name}: schreibt nicht direkt auf platform_export_runs`, () => {
      expect(code, name).not.toMatch(/(?<![a-z_])platform_export_runs/);
    });
  }

  it("die Texte stehen in de.ts, nicht im JSX", () => {
    for (const [name, code] of Object.entries({ page, button, history, notice })) {
      // Ein deutscher Satz mit Umlaut oder Satzende hat im Markup nichts
      // verloren — er gehört nach de.ts (ADR-0019).
      const saetze = [...code.matchAll(/>\s*([A-ZÄÖÜ][a-zäöüß][^<>{}]{15,})\s*</g)];
      expect(saetze.map((m) => m[1]), name).toEqual([]);
    }
  });
});
