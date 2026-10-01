import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { PLATFORM_ARCHIVE_LAYOUT } from "./platform-manifest";

/**
 * Die Adminroute, geprüft an ihrem Quelltext.
 *
 * WARUM SO UND NICHT DURCH AUFRUFEN. `GET()` hängt an `cookies()` aus
 * `next/headers` und damit an einem Request-Kontext, den es in vitest nicht
 * gibt. Was hier zählt, sind ohnehin Eigenschaften der Datei und nicht ihres
 * Rückgabewerts: welche Prüfung zuerst steht, welche Kopfzeilen gesetzt sind,
 * welche Funktionen gerufen werden — und vor allem, welche NICHT. Der
 * fachliche Ablauf ist in `platform-export.test.ts` mit einem gestellten
 * Client vollständig durchgespielt.
 */
const FILE = "src/app/(admin)/admin/datensicherung/download/route.ts";
const SOURCE = readFileSync(FILE, "utf8");

/** Ausführbarer Code: der Kopf erklärt gerade, was die Route NICHT tut. */
const CODE = SOURCE
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .filter((l) => !l.trimStart().startsWith("//"))
  .join("\n");

describe("Laufzeit und Zwischenspeicher", () => {
  it("läuft auf Node, weil der Hash inkrementell entsteht", () => {
    /*
     * `crypto.subtle` kann nicht schrittweise hashen. Auf Edge wäre die
     * Wahl: das ganze Archiv puffern oder eigenen Kryptocode schreiben.
     */
    expect(CODE).toContain('export const runtime = "nodejs"');
    expect(CODE).not.toContain('"edge"');
  });

  it("wird nie zwischengelagert", () => {
    expect(CODE).toContain('export const dynamic = "force-dynamic"');
  });
});

describe("die Sicherheitskette", () => {
  it("fragt zuerst die bestehende Plattformadmin-Prüfung", () => {
    // Route Handler führen kein Layout aus, deshalb wird der Gate-Aufruf des
    // (admin)-Layouts hier wiederholt statt geerbt.
    expect(CODE).toContain('import { isPlatformAdmin } from "@/lib/auth/capabilities"');
    const body = CODE.slice(CODE.indexOf("export async function GET"));
    const gate = body.indexOf("await isPlatformAdmin()");
    expect(gate).toBeGreaterThan(-1);
    // Vor allem anderen: vor dem Client, vor der Vorbereitung.
    expect(gate).toBeLessThan(body.indexOf("createClient"));
    expect(gate).toBeLessThan(body.indexOf("preparePlatformExport"));
  });

  it("erfindet keine eigene Rollenlogik", () => {
    for (const verboten of ["platform_admins", "is_platform_admin", "accountType",
                            "capabilities(", "getUser", "getSession", "jwt"]) {
      expect(CODE.includes(verboten), `${verboten} wäre eine zweite Wahrheit`).toBe(false);
    }
  });

  it("antwortet einem Nicht-Admin mit 404, nicht mit 403", () => {
    // Wie im ganzen Adminbereich (ADR-0039): ein 403 verriete, dass hier
    // etwas liegt.
    expect(CODE).toContain("if (!(await isPlatformAdmin())) return notFound();");
    expect(CODE).toContain('return new Response("Not found", { status: 404 })');
    expect(CODE).not.toContain("403");
  });

  it("benutzt die Sitzung des Admins und keinen Service-Key", () => {
    expect(CODE).toContain('import { createClient } from "@/lib/supabase/server"');
    for (const verboten of ["SERVICE_ROLE", "service_role", "SUPABASE_SERVICE",
                            "createServerClient", "apikey", "Authorization", "Bearer"]) {
      expect(CODE.includes(verboten), `${verboten} gehört nicht in diese Route`).toBe(false);
    }
  });

  it("fragt keine Tabelle als Ersatz für die vorhandenen RPCs", () => {
    for (const verboten of [".from(", ".select(", ".insert(", ".update(", ".delete(",
                            "platform_export_runs", "auth.users", "skylanders"]) {
      expect(CODE.includes(verboten), `${verboten} wäre eine zweite Quelle`).toBe(false);
    }
  });

  it("bestimmt source_project aus der kanonischen Projektadresse", () => {
    expect(CODE).toContain("supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL");
    for (const verboten of ["request", "req.", "headers()", "host", "origin",
                            "x-forwarded", "referer"]) {
      expect(CODE.toLowerCase().includes(verboten.toLowerCase()),
        `${verboten} darf hier nichts bestimmen`).toBe(false);
    }
  });
});

describe("der Export selbst", () => {
  it("benutzt preparePlatformExport und baut keinen zweiten Export", () => {
    expect(CODE).toContain("preparePlatformExport({");
    for (const verboten of ["system_platform_export", "system_auth_inventory",
                            "listBucketObjects", "platformArchive", "zipStream",
                            "authInventoryDocument", "storageManifestDocument"]) {
      expect(CODE.includes(verboten), `${verboten} gehört in die Fachschicht, nicht hierher`)
        .toBe(false);
    }
  });

  it("baut den ZIP-Schreiber nicht nach", () => {
    for (const verboten of ["crc32", "0x504b", "deflate", "CompressionStream",
                            "central directory", "PK\\x03"]) {
      expect(CODE.includes(verboten), `${verboten} wäre ein zweiter ZIP-Schreiber`).toBe(false);
    }
  });

  it("puffert das Archiv nicht", () => {
    /*
     * Kein `arrayBuffer()`, kein `Buffer.concat`, kein Array von Blöcken: der
     * Strom geht durch. Der einzige Umweg ist ein TransformStream, der jeden
     * Block unverändert weitergibt und am Ende den Lauf festhält.
     */
    for (const verboten of ["arrayBuffer", "Buffer.concat", "Buffer.from",
                            "new Blob", "blocks.push", "chunks.push",
                            "JSON.stringify", "await new Response("]) {
      expect(CODE.includes(verboten), `${verboten} würde puffern`).toBe(false);
    }
    expect(CODE).toContain("pipeThrough");
    expect(CODE).toContain("controller.enqueue(chunk)");
  });

  it("gibt den Strom direkt als Antwortkörper", () => {
    expect(CODE).toContain("return new Response(body, {");
  });
});

describe("die Kopfzeilen", () => {
  const headers = CODE.slice(CODE.indexOf("return new Response(body, {"));

  it("nennt den Typ, den ein ZIP hat", () => {
    expect(headers).toContain('"Content-Type": "application/zip"');
  });

  it("lädt herunter statt anzuzeigen, mit dem Namen aus der Fachschicht", () => {
    expect(headers).toContain('"Content-Disposition": `attachment; filename="${prepared.fileName}"`');
    // Der Name wird nicht hier gebaut: platformArchiveFileName() ist getestet.
    expect(CODE).not.toContain("toISOString");
    expect(CODE).not.toContain("skyisles-platform-backup-");
  });

  it("verbietet jeden Zwischenspeicher und jedes Raten", () => {
    expect(headers).toContain('"Cache-Control": "private, no-store"');
    expect(headers).toContain('"X-Content-Type-Options": "nosniff"');
  });

  it("trägt keine Kennung, keinen Namen und keine Projektreferenz", () => {
    for (const verboten of ["qqxcpesbwfxzgytkdsac", "username", "email", "user_id",
                            "sha256", "X-Run", "X-Sha"]) {
      expect(headers.includes(verboten), `${verboten} gehört in keine Kopfzeile`).toBe(false);
    }
  });
});

describe("generated, received und der Abbruch", () => {
  it("hält den Lauf erst fest, wenn der letzte Block erzeugt wurde", () => {
    /*
     * `flush()` eines TransformStream läuft, wenn die schreibende Seite
     * geschlossen ist — also nach dem letzten Block. Vorher ist `measured()`
     * `null`, und `0105` würde eine Zeile ohne die sieben Messwerte am CHECK
     * `platform_export_runs_success_is_measured` ablehnen.
     */
    expect(CODE).toContain("async flush()");
    const flush = CODE.slice(CODE.indexOf("async flush()"));
    expect(flush).toContain("prepared.measured()");
    expect(flush).toContain("recordGeneratedRun(supabase, measured)");
    // Und die Reihenfolge: erst messen, dann buchen.
    expect(flush.indexOf("prepared.measured()"))
      .toBeLessThan(flush.indexOf("recordGeneratedRun"));
  });

  it("täuscht keinen Lauf vor, wenn der Strom abbrach", () => {
    const flush = CODE.slice(CODE.indexOf("async flush()"));
    expect(flush).toContain("if (measured === null) return;");
  });

  it("setzt NIEMALS received", () => {
    /*
     * HTTP-Streaming kann nicht beweisen, dass der Browser die Datei
     * vollständig auf die Platte geschrieben hat. `received` heißt laut 0105
     * genau das — und es braucht deshalb eine ausdrückliche Bestätigung,
     * nicht die Vermutung dieser Route.
     */
    for (const verboten of ["received", "confirmReceivedRun",
                            "admin_settle_platform_export", "p_sha256"]) {
      expect(CODE.includes(verboten), `${verboten} darf diese Route nicht tun`).toBe(false);
    }
  });

  it("ruft genau eine Historienfunktion, und zwar die zum Festhalten", () => {
    expect(CODE).toContain("recordGeneratedRun");
    expect(CODE).not.toContain("recordFailedRun");
    expect(CODE).not.toContain("admin_platform_export_runs");
  });
});

describe("Fehler und Protokolle", () => {
  it("gibt keine Meldung aus Datenbank oder Storage nach außen", () => {
    expect(CODE).toContain('return new Response("Backup failed", { status: 500 })');
    for (const verboten of ["error.message", "String(error)", "error.stack",
                            "JSON.stringify(error", "cause"]) {
      expect(CODE.includes(verboten), `${verboten} könnte einen Tabellennamen tragen`).toBe(false);
    }
  });

  it("antwortet auf einen abgelehnten Wächter wie auf einen unbekannten Pfad", () => {
    expect(CODE).toContain('error.stage === "database"');
    expect(CODE).toContain("return notFound();");
  });

  it("fängt alles ab, was vor dem Strom noch ein Status werden kann", () => {
    const body = CODE.slice(CODE.indexOf("export async function GET"));
    // Die Vorbereitung liegt in einem try, der Strom danach nicht mehr.
    expect(body.indexOf("try {")).toBeLessThan(body.indexOf("preparePlatformExport"));
    expect(body.indexOf("preparePlatformExport")).toBeLessThan(body.indexOf("} catch"));
    expect(body.indexOf("} catch")).toBeLessThan(body.indexOf("pipeThrough"));
  });

  it("schreibt nichts in ein Protokoll", () => {
    for (const verboten of ["console.log", "console.error", "console.warn",
                            "console.info", "console.debug", "process.stdout"]) {
      expect(CODE.includes(verboten), `${verboten} könnte Backup-Inhalt tragen`).toBe(false);
    }
  });
});

describe("die Route liegt, wo der Adminbereich liegt", () => {
  it("unter (admin)/admin/datensicherung/download", () => {
    expect(FILE).toBe("src/app/(admin)/admin/datensicherung/download/route.ts");
  });

  it("und liefert genau die vier vereinbarten Artefakte — über die Fachschicht", () => {
    /*
     * Die Route entscheidet den Archivinhalt nicht; sie kennt keinen der vier
     * Namen. Dass sie stimmen, prüfen platform-archive.test.ts und
     * platform-export.test.ts am tatsächlichen ZIP.
     */
    for (const name of Object.values(PLATFORM_ARCHIVE_LAYOUT)) {
      expect(CODE.includes(name), `${name} gehört nicht in die Route`).toBe(false);
    }
  });

  it("exportiert nur GET", () => {
    const exported = [...CODE.matchAll(/export (?:async )?(?:function|const) (\w+)/g)]
      .map((m) => m[1]);
    expect(exported.sort()).toEqual(["GET", "dynamic", "runtime"]);
  });
});
