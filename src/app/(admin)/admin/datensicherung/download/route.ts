/**
 * Die vollständige Plattformsicherung als ZIP-Datei.
 *
 * WOFÜR. Production läuft auf Supabase Free — keine nativen Backups, kein
 * PITR. Diese Route ist die einzige Absicherung, die wir selbst in der Hand
 * haben: der Plattformadmin lädt das Archiv herunter und bewahrt es außerhalb
 * des Projekts auf.
 *
 * ZWEI SCHLÖSSER, WIE ÜBERALL. Hier steht das erste, und es ist nicht das
 * entscheidende: `isPlatformAdmin()` erspart der Datenbank die Runde und macht
 * die Antwort eindeutig. Das entscheidende Schloss sitzt in der Datenbank —
 * `system_platform_export()` (0105) und `system_auth_inventory()` (0107) fragen
 * beide `is_platform_admin()` und liefern jedem anderen SQL-NULL. Eine Anfrage,
 * die an dieser Datei vorbeikäme, käme nicht am Wächter vorbei.
 *
 * 404, NICHT 403. Wie im ganzen Adminbereich (ADR-0039): für wen es nichts zu
 * holen gibt, existiert die Route nicht. Ein 403 verriete, dass hier etwas
 * liegt. Route Handler führen kein Layout aus, deshalb wird der Gate-Aufruf
 * des `(admin)`-Layouts hier wiederholt statt geerbt.
 *
 * MIT DER SITZUNG DES ADMINS, NICHT MIT SERVICE ROLE. `createClient()` baut
 * den Server-Client aus dem Cookie. Dieses Deployment hält keinen
 * Service-Role-Schlüssel (`docs/DEPLOYMENT.md:61`), und dieser Weg braucht
 * auch keinen: der Bucket `catalog` ist öffentlich lesbar (0007), und beide
 * RPCs stehen `authenticated` offen.
 *
 * `runtime = "nodejs"`. Der Hash entsteht inkrementell mit `node:crypto`;
 * `crypto.subtle` kann nicht schrittweise hashen, und ein eigener SHA256 wäre
 * Kryptocode für nichts.
 *
 * ECHTES STREAMING. Das Archiv wird nirgends vollständig gepuffert:
 * `zipStream()` schreibt jeden Eintrag sofort in den Strom und behält danach
 * nur dessen Kopfdaten, und die Einträge entstehen faul. Im Speicher liegen
 * gleichzeitig das Datenbankdokument, das Auth-Inventar, die Objektliste und
 * GENAU EIN Storage-Objekt.
 *
 * NICHTS WIRD PROTOKOLLIERT. Kein Dokument, kein Ausschnitt, keine
 * E-Mail-Adresse, kein Objektpfad, keine Zeilenzahl, keine Kennung. Auch die
 * Fehlerantworten tragen keinen Text aus Datenbank oder Storage-API — beide
 * können Tabellennamen oder signierte Adressen enthalten.
 *
 * WAS DIESE ROUTE NICHT TUT: sie setzt NIEMALS `received`. Siehe unten.
 */
import { isPlatformAdmin } from "@/lib/auth/capabilities";
import { createClient } from "@/lib/supabase/server";
import {
  PlatformExportError,
  preparePlatformExport,
  recordGeneratedRun,
} from "@/lib/backup/platform-export";

/** Der Hash braucht `node:crypto`. Kein Edge. */
export const runtime = "nodejs";

/* Eine Sicherung ist immer die von jetzt. Nichts daran darf zwischengelagert
   werden — weder von Next noch von einem Zwischenspeicher unterwegs. */
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  if (!(await isPlatformAdmin())) return notFound();

  const supabase = await createClient();

  /*
   * ALLES, WAS NOCH EIN STATUS WERDEN KANN, PASSIERT HIER.
   *
   * Die drei Quellen — Datenbankdokument, Auth-Inventar, Objektliste — werden
   * vor dem ersten Byte geholt. Scheitert eine, ist noch keine Antwort
   * unterwegs und ein HTTP-Status ist möglich. Sobald der Strom läuft, gibt es
   * keinen Status mehr, nur noch einen Abbruch.
   */
  let prepared;
  try {
    prepared = await preparePlatformExport({
      client: supabase,
      /*
       * Die kanonische Projektadresse, nicht der Host der Anfrage: der wäre
       * vom Aufrufer bestimmbar, und `source_project` entscheidet später,
       * welche von drei Dateien auf der Platte aus Production stammt.
       */
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    });
  } catch (error) {
    /*
     * `database`, `auth_inventory` und `storage_manifest` heißen hier
     * dasselbe: es gibt nichts auszuliefern. Kein Grund und kein Detail nach
     * außen, und für einen abgelehnten Wächter dieselbe Antwort wie für einen
     * unbekannten Pfad.
     */
    if (error instanceof PlatformExportError && error.stage === "database") return notFound();
    return failed();
  }

  /*
   * DER STROM, UND WAS DANACH PASSIERT.
   *
   * Der Lauf wird erst festgehalten, wenn der letzte Block erzeugt wurde:
   * `measured()` ist bis dahin `null`, und `admin_record_platform_export()`
   * verlangt alle sieben Messwerte — `0105` würde eine Zeile ohne sie am CHECK
   * `platform_export_runs_success_is_measured` ablehnen.
   *
   * Bricht der Strom ab, bleibt `measured()` `null`, und es entsteht KEINE
   * Zeile. Eine Sicherung, die es nicht gab, soll auch nicht in der Historie
   * stehen.
   *
   * Ein Fehlschlag beim Festhalten ändert an der Datei nichts — der Admin hat
   * sie. Der Strom ist längst durch, ein Status ist nicht mehr möglich, und
   * abbrechen würde eine gültige Sicherung zerstören, um eine Buchung zu
   * erzwingen. Der Lauf fehlt dann in der Historie, und das ist der kleinere
   * Schaden.
   */
  const body = prepared.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        controller.enqueue(chunk);
      },
      async flush() {
        const measured = prepared.measured();
        if (measured === null) return;
        try {
          await recordGeneratedRun(supabase, measured);
        } catch {
          // Siehe oben. Kein Protokoll, keine Auswirkung auf die Datei.
        }
      },
    }),
  );

  return new Response(body, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${prepared.fileName}"`,
      /* Eine vollständige Datenkopie der Plattform gehört in keinen
         gemeinsamen Zwischenspeicher — dieselbe Regel wie beim
         Business-Export und bei der Rechnung als PDF. */
      "Cache-Control": "private, no-store",
      /* Der Browser soll den Typ nehmen, den wir nennen, und nicht raten. */
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** Unbekannt und nicht-deins antworten gleich. */
function notFound(): Response {
  return new Response("Not found", { status: 404 });
}

/** Ein Fehler ohne Inhalt: die Oberfläche sagt den Satz, nicht der Server. */
function failed(): Response {
  return new Response("Backup failed", { status: 500 });
}
