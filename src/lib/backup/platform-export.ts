/**
 * Der Ablauf einer Plattformsicherung, von der Anfrage bis zur Historie.
 *
 * DIE REIHENFOLGE, UND WARUM SIE SO IST
 *
 *   1. system_platform_export()   das Datenbankdokument (0105)
 *   2. system_auth_inventory()    das Kontoinventar (0107)
 *   3. Objektliste des Buckets    Metadaten, keine Bytes (0007)
 *   4. Archiv streamen            jede Datei einmal, keine zweimal
 *   5. Historie schreiben         admin_record_platform_export() (0106)
 *
 * Schritt 1 bis 3 sind billig und können scheitern, ohne dass etwas begonnen
 * wurde — deshalb stehen sie vor dem Strom. Ab Schritt 4 läuft die Antwort,
 * und ein Fehler darin kann nicht mehr zu einem HTTP-Status werden. Genau
 * deshalb zählt `platformArchive()` fehlende Dateien statt abzubrechen.
 *
 * EIN DURCHLAUF, EIN PUFFER VON EINER DATEI
 *
 * `zipStream()` hält jeden Eintrag vollständig im Speicher, aber nur einen:
 * es sieht ihn, schreibt Kopf und Inhalt sofort in den Strom und behält danach
 * nur Pfad, CRC, Größen und Offset für das zentrale Verzeichnis. Die faule
 * Eintragsquelle (`AsyncIterable`) ist der Grund, warum das hier auch gilt —
 * die Bytes eines Objekts entstehen erst, wenn der Schreiber danach fragt.
 *
 * Gleichzeitig im Speicher liegen damit: das Datenbankdokument (auf Staging
 * ~2,2 MB), das Auth-Inventar und die Objektliste (beide klein), die
 * Kopfdatensätze aller Einträge, und GENAU EIN Storage-Objekt. Das Archiv
 * selbst wird nirgends zusätzlich gepuffert — es geht durch.
 *
 * SHA256 OHNE ZWEITEN DURCHLAUF
 *
 * Der Hash entsteht am durchlaufenden Strom: jeder Block geht in `update()`
 * und weiter an den Empfänger. Zwei Durchläufe (einmal hashen, einmal
 * ausliefern) hieße, das Archiv doppelt zu erzeugen oder es vollständig zu
 * puffern — beides wäre genau das, was hier vermieden werden soll.
 *
 * Der Preis: der Hash steht erst fest, wenn der letzte Block draußen ist. Es
 * gibt also KEINEN Weg, ihn in einen HTTP-Header der Antwort zu schreiben, die
 * bereits läuft. Das ist kein Problem, sondern passt genau zur Bedeutung der
 * drei Zustände aus `0105`:
 *
 *   generated   das Archiv ist gebaut und ausgeliefert. Der Server kennt
 *               Größe und Hash des ausgelieferten Stroms — mehr behauptet er
 *               nicht. Die Zeile entsteht, wenn der letzte Block geschrieben
 *               ist.
 *   received    der Admin hat die Datei bestätigt. Erst das heißt „liegt
 *               außerhalb". Dafür vergleicht `admin_settle_platform_export()`
 *               die übergebene Prüfsumme mit der gespeicherten.
 *   failed      Erzeugung oder Bestätigung gescheitert.
 *
 * Wie der Admin an „seinen" Lauf kommt, ohne dass die Antwort den Hash tragen
 * kann: über `admin_platform_export_runs()` — neueste zuerst. Das ist kein
 * Umweg, sondern der vorgesehene Weg, und er stammt aus `0106`.
 *
 * KEIN DIREKTER SCHREIBZUGRIFF. `platform_export_runs` hat keine Policy und
 * keine Grants; es gibt buchstäblich keinen anderen Weg als die drei
 * Funktionen aus `0106`. Diese Datei ruft nur sie.
 *
 * NICHTS WIRD PROTOKOLLIERT. Kein Dokument, kein Ausschnitt, keine
 * E-Mail-Adresse, kein Objektpfad, keine Zeilenzahl.
 */

import { createHash } from "node:crypto";

import { CATALOG_BUCKET } from "../catalog/image";
import { zipStream } from "../zip/zip-writer";
import {
  authInventoryDocument,
  exportMeasurements,
  expectedStoragePaths,
  platformArchive,
  platformArchiveFileName,
  type ArchiveOutcome,
  type PlatformExportMeasurements,
} from "./platform-archive";
import { projectRefFromUrl } from "./document";
import {
  PlatformSourceError,
  fetchAuthInventoryRows,
  fetchPlatformDocument,
  listBucketObjects,
  makeStorageByteSource,
  type PlatformSourceClient,
} from "./platform-source";

/** Die Stufen, die `platform_export_runs.failure_stage` (0105) kennt. */
export type FailureStage =
  | "database"
  | "auth_inventory"
  | "storage_manifest"
  | "storage_files"
  | "archive"
  | "confirmation";

/** Ein Export ist gescheitert, und zwar an einer benennbaren Stufe. */
export class PlatformExportError extends Error {
  stage: FailureStage;

  constructor(stage: FailureStage, message: string) {
    super(message);
    this.name = "PlatformExportError";
    this.stage = stage;
  }
}

/** Was eine vorbereitete Sicherung ausliefern kann. */
export type PreparedPlatformExport = {
  /** Der Dateiname für `Content-Disposition`. */
  fileName: string;
  /** Der Archivstrom. Genau einmal lesbar. */
  body: ReadableStream<Uint8Array>;
  /**
   * Was am Ende gemessen wurde. Erst gültig, wenn `body` vollständig gelesen
   * ist — vorher `null`.
   */
  measured: () => PlatformExportMeasurements | null;
};

/**
 * Alles, was vor dem ersten Byte passieren muss.
 *
 * Wirft mit einer Stufe, wenn eine Quelle nicht antwortet. Ein Aufrufer kann
 * daraus einen HTTP-Status machen, solange noch keine Antwort läuft — und, wo
 * es fachlich stimmt, einen gescheiterten Lauf verbuchen.
 */
export async function preparePlatformExport(input: {
  client: PlatformSourceClient;
  /** `NEXT_PUBLIC_SUPABASE_URL`. Niemals der Host der eingehenden Anfrage. */
  supabaseUrl: string | undefined;
  now?: Date;
  bucket?: string;
}): Promise<PreparedPlatformExport> {
  const bucket = input.bucket ?? CATALOG_BUCKET;
  const sourceProject = projectRefFromUrl(input.supabaseUrl);

  let document;
  let authRows;
  let listing;
  try {
    document = await fetchPlatformDocument(input.client);
    authRows = await fetchAuthInventoryRows(input.client);
    listing = await listBucketObjects(input.client, bucket);
  } catch (error) {
    if (error instanceof PlatformSourceError) {
      throw new PlatformExportError(error.stage, error.message);
    }
    throw new PlatformExportError("archive", "Die Sicherung konnte nicht vorbereitet werden.");
  }

  /*
   * Hier, vor dem Strom: `authInventoryDocument()` WIRFT, wenn die Quelle ein
   * gesperrtes Feld mitgeschickt hat. Das ist die Stelle, an der ein
   * versehentliches `select *` in einer künftigen Migration auffällt — und
   * zwar bevor ein einziges Byte das Haus verlässt.
   */
  const auth = authInventoryDocument(authRows);

  const archive = platformArchive({
    document,
    auth,
    listed: listing.objects,
    rejected: listing.rejected,
    expected: expectedStoragePaths(document),
    bytes: makeStorageByteSource(input.client),
    sourceProject,
    bucket,
  });

  const digest = createHash("sha256");
  let sizeBytes = 0;
  let measured: PlatformExportMeasurements | null = null;

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const block of zipStream(archive.entries())) {
          digest.update(block);
          sizeBytes += block.length;
          controller.enqueue(block);
        }
      } catch {
        /*
         * Ab hier läuft die Antwort schon; ein Status ist nicht mehr möglich.
         * Der Strom bricht ab, der Browser bekommt eine unvollständige Datei —
         * und `measured()` bleibt `null`, sodass kein Lauf als `generated`
         * verbucht wird. Eine Sicherung, die es nicht gab, soll auch nicht in
         * der Historie stehen.
         */
        controller.error(new PlatformExportError("archive", "Das Archiv brach ab."));
        return;
      }

      /*
       * Der Hash steht erst jetzt fest. `outcome()` ebenfalls: die Zahlen des
       * Storage-Manifests entstehen, während die Dateien durchlaufen.
       */
      let outcome: ArchiveOutcome;
      try {
        outcome = archive.outcome();
      } catch {
        controller.error(new PlatformExportError("archive", "Das Archiv blieb unvollständig."));
        return;
      }

      measured = exportMeasurements({
        outcome,
        // Ohne Projektreferenz gäbe es keinen gültigen Lauf — `0105` verlangt
        // sie als NOT NULL für alles außer `failed`.
        sourceProject: sourceProject ?? "",
        sizeBytes,
        sha256: digest.digest("hex"),
      });
      controller.close();
    },
  });

  return {
    fileName: platformArchiveFileName(input.now ?? new Date()),
    body,
    measured: () => measured,
  };
}

/* --------------------------------------------------------------------------
 * Die Historie — ausschließlich über die Funktionen aus 0106
 * ----------------------------------------------------------------------- */

/** Der Client, wie die Historie ihn braucht: ein RPC mit Argumenten. */
export type HistoryClient = {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};

/**
 * Einen erzeugten Lauf festhalten.
 *
 * Erst mit den TATSÄCHLICH gemessenen Werten: Größe und Prüfsumme des
 * ausgelieferten Stroms, Bereiche und Storage-Zahlen aus dem fertigen Archiv.
 * `0105` würde eine Zeile ohne sie gar nicht annehmen — der CHECK
 * `platform_export_runs_success_is_measured` verlangt alle sieben.
 */
export async function recordGeneratedRun(
  client: HistoryClient,
  measured: PlatformExportMeasurements,
): Promise<number> {
  const { data, error } = await client.rpc("admin_record_platform_export", {
    p_format_version: measured.format_version,
    p_source_project: measured.source_project,
    p_size_bytes: measured.size_bytes,
    p_sha256: measured.sha256,
    p_section_count: measured.section_count,
    p_storage_file_count: measured.storage_file_count,
    p_storage_missing_count: measured.storage_missing_count,
  });
  if (error || typeof data !== "number") {
    throw new PlatformExportError("archive", "Der Lauf konnte nicht festgehalten werden.");
  }
  return data;
}

/**
 * Einen Lauf bestätigen.
 *
 * `received` heißt: die Datei, die ankam, ist die Datei, die ging. Die
 * Prüfsumme kommt von dem, der die Datei hat; `admin_settle_platform_export()`
 * vergleicht sie mit der gespeicherten und weist ab, wenn sie abweicht. Diese
 * Funktion prüft den Hash absichtlich NICHT selbst — eine zweite Prüfung
 * neben dem DB-Wächter wäre eine zweite Wahrheit.
 */
export async function confirmReceivedRun(
  client: HistoryClient,
  runId: number,
  sha256: string,
): Promise<void> {
  const { error } = await client.rpc("admin_settle_platform_export", {
    p_id: runId,
    p_sha256: sha256,
  });
  if (error) {
    throw new PlatformExportError("confirmation", "Die Bestätigung wurde nicht angenommen.");
  }
}

/**
 * Einen Lauf als gescheitert festhalten.
 *
 * Nur für einen Lauf, den es schon gibt — also für ein Scheitern bei der
 * BESTÄTIGUNG. Scheitert das Erzeugen, existiert keine Zeile, und es entsteht
 * auch keine: `admin_record_platform_export()` legt ausschließlich `generated`
 * an. Das ist die bekannte Grenze aus `0106`, und sie wird hier nicht
 * umgangen.
 */
export async function recordFailedRun(
  client: HistoryClient,
  runId: number,
  stage: FailureStage,
): Promise<void> {
  const { error } = await client.rpc("admin_settle_platform_export", {
    p_id: runId,
    p_failure_stage: stage,
  });
  if (error) {
    throw new PlatformExportError("confirmation", "Der Fehlschlag konnte nicht festgehalten werden.");
  }
}
