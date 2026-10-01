/**
 * Die vier Bestandteile einer Plattformsicherung, als reine Funktionen.
 *
 * WAS HIER PASSIERT UND WAS NICHT. Diese Datei rechnet, sie holt nichts. Kein
 * Datenbankzugriff, kein `fetch`, kein Supabase-Client, keine Umgebungs-
 * variable. Sie nimmt, was ein Aufrufer gemessen hat, und formt daraus die
 * Dateien des Archivs. Alles Privilegierte — `system_platform_export()`
 * aufrufen, das Auth-Inventar lesen, Storage auflisten und herunterladen —
 * passiert außerhalb, und zwar dort, wo die Rechte dafür hingehören.
 *
 * Das ist nicht nur Ordnung: die Redaktionsregel („kein Geheimnis im ZIP")
 * lässt sich nur dort prüfen, wo sie ohne Netz und ohne Datenbank prüfbar ist.
 * `authInventoryDocument()` WIRFT, wenn eine Zeile ein gesperrtes Feld trägt,
 * und `platform-archive.test.ts` hält das an echten Feldnamen fest.
 *
 * DAS ARCHIV
 *
 *   manifest.json            was diese Sicherung ist, und wie vollständig
 *   database.json            unverändert aus system_platform_export() (0105)
 *   auth-users.json          das Inventar der Konten — kein Auth-Backup
 *   storage-manifest.json    was im Bucket liegt, und was fehlt
 *   storage/catalog/…        die Dateien selbst
 *
 * KEINE ZWEITE EXPORTLOGIK. `database.json` geht durch, wie die Datenbank es
 * geliefert hat. Diese Datei filtert dort nichts, ergänzt nichts und sortiert
 * nichts um — die 53 Bereiche sind auf Staging so validiert worden, wie sie
 * aus dem einen Statement kommen.
 *
 * WARUM EIN FEHLENDES BYTE DEN EXPORT ABBRICHT. `storage_missing_count` zählt
 * Objekte, die laut Datenbank erwartet werden und im Bucket NICHT liegen — ein
 * bekannter, dokumentierter Zustand, der im Archiv sichtbar wird. Scheitert
 * dagegen das Lesen eines Objekts, das die Auflistung nennt, dann stimmen die
 * Zahlen in `manifest.json` nicht mehr mit dem Inhalt überein. Ein Archiv, das
 * Vollständigkeit behauptet und sie nicht hat, ist schlimmer als kein Archiv:
 * deshalb `PlatformArchiveError` und ein Lauf, der als gescheitert gilt.
 */

import {
  AUTH_FORBIDDEN_FIELDS,
  AUTH_INVENTORY_DISCLAIMER,
  AUTH_INVENTORY_FIELDS,
  PLATFORM_ARCHIVE_LAYOUT,
  PLATFORM_FORBIDDEN_FIELDS,
  PLATFORM_FORMAT,
  PLATFORM_FORMAT_VERSION,
  PLATFORM_SECTIONS,
  STORAGE_BUCKETS_INCLUDED,
} from "./platform-manifest";
import { sectionCounts } from "./document";
import type { ZipEntry } from "../zip/zip-writer";

/* --------------------------------------------------------------------------
 * Was hereinkommt
 * ----------------------------------------------------------------------- */

/** Das Dokument von `system_platform_export()`, unangetastet. */
export type PlatformExportDocument = {
  format?: unknown;
  format_version?: unknown;
  created_at?: unknown;
  commerce_mode?: unknown;
  snapshot_txid?: unknown;
  data?: Record<string, unknown>;
};

/**
 * Eine Zeile, wie der privilegierte Auth-Pfad sie liefert.
 *
 * Absichtlich weit typisiert: die Quelle steht noch nicht fest, und diese
 * Schicht soll nicht vorgeben, wie sie aussieht — sie soll prüfen, was
 * ankommt.
 */
export type AuthInventoryRow = Record<string, unknown>;

/** Ein Objekt, wie die Storage-Auflistung es beschreibt. */
export type StorageObject = {
  /** Pfad innerhalb des Buckets, z. B. `SKY-0009/c29021891080cd90.jpg`. */
  name: string;
  size: number | null;
  mimetype: string | null;
  etag: string | null;
  created_at: string | null;
  updated_at: string | null;
};

/** Woher die Bytes eines Objekts kommen. Nur beim Zusammensetzen gerufen. */
export type StorageByteSource = (bucket: string, name: string) => Promise<Uint8Array>;

/** Ein Archiv, das Vollständigkeit behauptet, muss sie haben. */
export class PlatformArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlatformArchiveError";
  }
}

/** Ein gesperrtes Feld hat es bis hierher geschafft. Nicht weiter. */
export class BackupRedactionError extends Error {
  /** Die Feldnamen, die nicht hätten ankommen dürfen. */
  fields: string[];

  constructor(fields: string[]) {
    super(`Gesperrte Felder im Export: ${fields.join(", ")}`);
    this.name = "BackupRedactionError";
    this.fields = fields;
  }
}

/* --------------------------------------------------------------------------
 * 1. auth-users.json — ein Inventar, ausdrücklich kein Auth-Backup
 * ----------------------------------------------------------------------- */

/** Jeder Feldname, der in keiner Exportdatei vorkommen darf. */
const FORBIDDEN = new Set([
  ...Object.keys(AUTH_FORBIDDEN_FIELDS),
  ...Object.keys(PLATFORM_FORBIDDEN_FIELDS),
]);

export type AuthInventoryDocument = {
  format: string;
  format_version: number;
  disclaimer: string;
  restore_supported: false;
  auth_user_count: number;
  users: Record<string, unknown>[];
};

/**
 * Das Auth-Inventar.
 *
 * ZWEI SCHLÖSSER, WIE BEI DER HISTORIE. Erstens wird jede Zeile auf die
 * sieben erlaubten Felder REDUZIERT — was nicht in `AUTH_INVENTORY_FIELDS`
 * steht, kommt nicht mit, auch wenn die Quelle es mitschickt. Zweitens wirft
 * diese Funktion, wenn die Quelle überhaupt ein gesperrtes Feld geliefert hat.
 *
 * Das zweite Schloss ist das wichtigere. Die Reduktion allein würde ein
 * versehentliches `select *` still schlucken; ein Aufrufer, der Passwort-
 * Hashes über die Anwendung trägt, soll davon erfahren, statt dass es
 * unbemerkt gut ausgeht.
 */
export function authInventoryDocument(rows: readonly AuthInventoryRow[]): AuthInventoryDocument {
  const offenders = new Set<string>();
  const users: Record<string, unknown>[] = [];

  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (FORBIDDEN.has(key)) offenders.add(key);
    }
    const shaped: Record<string, unknown> = {};
    for (const field of AUTH_INVENTORY_FIELDS) {
      shaped[field] = field in row ? row[field] : null;
    }
    users.push(shaped);
  }

  if (offenders.size > 0) throw new BackupRedactionError([...offenders].sort());

  return {
    format: PLATFORM_FORMAT,
    format_version: PLATFORM_FORMAT_VERSION,
    disclaimer: AUTH_INVENTORY_DISCLAIMER,
    restore_supported: false,
    auth_user_count: users.length,
    // Nach id, damit zwei Sicherungen desselben Zustands vergleichbar sind.
    users: users.sort((a, b) => String(a.id ?? "").localeCompare(String(b.id ?? ""))),
  };
}
/* --------------------------------------------------------------------------
 * 2. storage-manifest.json — was liegt da, was fehlt, was war nicht lesbar
 * ----------------------------------------------------------------------- */

export type StorageManifestDocument = {
  format: string;
  format_version: number;
  buckets: readonly string[];
  storage_object_count: number;
  storage_missing_count: number;
  /**
   * Was fehlt, nach Ursache getrennt — und beides zählt in
   * `storage_missing_count`.
   *
   *   missing_from_bucket  laut Datenbank erwartet, in der Auflistung nicht da
   *   unreadable           in der Auflistung genannt, beim Lesen gescheitert
   *
   * Die Trennung ist keine Kosmetik: das erste ist ein bekannter Zustand des
   * Buckets, das zweite ein Vorfall während genau dieses Exports. Wer die
   * Sicherung später beurteilt, muss das unterscheiden können.
   */
  missing_from_bucket: string[];
  unreadable: string[];
  /**
   * Objektnamen, die kein sicherer Archivpfad wären — verworfen, aber genannt.
   * Sie zählen in `storage_missing_count`: eine Datei, die es gibt und die
   * nicht im Archiv liegt, fehlt, gleich aus welchem Grund.
   */
  rejected: string[];
  /** Im Bucket vorhanden, von keiner Figur referenziert. Kostet nur Platz. */
  unreferenced_count: number;
  /** Nur die Objekte, die tatsächlich im Archiv liegen. */
  objects: (StorageObject & { bucket_id: string })[];
};

/**
 * Welche Objekte die Datenbank erwartet.
 *
 * Genau eine Quelle: `skylanders.image_override_path`. Das ist die Spalte, die
 * ein Administrator beim Hochladen setzt (ADR-0046) — `image_file` zeigt auf
 * Dateien aus dem Deployment und liegt nicht im Bucket.
 *
 * Gelesen wird aus dem FERTIGEN Dokument, nicht durch eine zweite Abfrage: die
 * Erwartung soll aus derselben MVCC-Momentaufnahme stammen wie die Daten, die
 * sie prüft.
 */
export function expectedStoragePaths(document: PlatformExportDocument): string[] {
  const rows = document.data?.skylanders;
  if (!Array.isArray(rows)) return [];
  const paths = new Set<string>();
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const path = (row as Record<string, unknown>).image_override_path;
    if (typeof path === "string" && path !== "") paths.add(path);
  }
  return [...paths].sort();
}

/**
 * Das Storage-Inventar, mit der Lücke ausdrücklich darin.
 *
 * `objects` sind die Objekte, die WIRKLICH im Archiv liegen — deshalb wird
 * dieses Dokument erst gebaut, wenn alle Dateien durch sind. `written` sagt,
 * was gelungen ist, `unreadable`, was die Auflistung nannte und sich nicht
 * lesen ließ.
 */
export function storageManifestDocument(input: {
  listed: readonly StorageObject[];
  written?: readonly StorageObject[];
  unreadable?: readonly string[];
  rejected?: readonly string[];
  expected: readonly string[];
  bucket?: string;
}): StorageManifestDocument {
  const bucket = input.bucket ?? STORAGE_BUCKETS_INCLUDED[0];
  const written = input.written ?? input.listed;
  const unreadable = [...(input.unreadable ?? [])].sort();
  const rejected = [...(input.rejected ?? [])].sort();

  const listedNames = new Set(input.listed.map((o) => o.name));
  const expected = new Set(input.expected);

  const missingFromBucket = [...expected].filter((p) => !listedNames.has(p)).sort();
  const unreferenced = [...listedNames].filter((p) => !expected.has(p));

  const objects = [...written]
    .map((o) => ({ bucket_id: bucket, ...o }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    format: PLATFORM_FORMAT,
    format_version: PLATFORM_FORMAT_VERSION,
    buckets: [bucket],
    storage_object_count: objects.length,
    // Alle drei Ursachen zusammen: „wie viele Dateien fehlen in dieser
    // Sicherung". Getrennt aufgeführt, damit man sie unterscheiden kann.
    storage_missing_count: missingFromBucket.length + unreadable.length + rejected.length,
    missing_from_bucket: missingFromBucket,
    unreadable,
    rejected,
    unreferenced_count: unreferenced.length,
    objects,
  };
}

/* --------------------------------------------------------------------------
 * 3. manifest.json — was diese Sicherung ist
 * ----------------------------------------------------------------------- */

export type PlatformManifestDocument = {
  format: string;
  format_version: number;
  created_at: string | null;
  source_project: string | null;
  commerce_mode: string | null;
  counts: Record<string, number>;
  auth_user_count: number;
  storage_object_count: number;
  storage_missing_count: number;
  files: string[];
  contains_personal_data: true;
  auth_inventory_only: true;
  restore_supported: false;
};

/**
 * Das Deckblatt.
 *
 * `created_at` und `commerce_mode` kommen aus dem Datenbankdokument — laut
 * `PLATFORM_METADATA_SOURCE` sind genau diese zwei „database", alles andere
 * „route". `source_project` liefert der Aufrufer aus
 * `NEXT_PUBLIC_SUPABASE_URL`; ein Postgres kennt seine Projektreferenz nicht,
 * und der Host der eingehenden Anfrage wäre vom Aufrufer bestimmbar.
 *
 * KEIN sha256 DES ARCHIVS. Das Manifest liegt IM Archiv — es könnte den
 * eigenen Hash nur enthalten, wenn es ihn vor sich selbst kennt. Die Prüfsumme
 * gehört deshalb in `platform_export_runs` (0105/0106), berechnet über den
 * fertigen ZIP-Strom.
 */
export function platformManifestDocument(input: {
  document: PlatformExportDocument;
  auth: AuthInventoryDocument;
  storage: StorageManifestDocument;
  sourceProject: string | null;
  files: readonly string[];
}): PlatformManifestDocument {
  const { document, auth, storage } = input;
  return {
    format: PLATFORM_FORMAT,
    format_version: PLATFORM_FORMAT_VERSION,
    created_at: typeof document.created_at === "string" ? document.created_at : null,
    source_project: input.sourceProject,
    commerce_mode: typeof document.commerce_mode === "string" ? document.commerce_mode : null,
    counts: sectionCounts(document),
    auth_user_count: auth.auth_user_count,
    storage_object_count: storage.storage_object_count,
    storage_missing_count: storage.storage_missing_count,
    files: [...input.files],
    contains_personal_data: true,
    auth_inventory_only: true,
    restore_supported: false,
  };
}

/* --------------------------------------------------------------------------
 * 4. Das Archiv zusammensetzen
 * ----------------------------------------------------------------------- */

const encoder = new TextEncoder();

/** Ein JSON-Dokument als Archiveintrag. Zwei Leerzeichen, damit es lesbar ist. */
function jsonEntry(path: string, value: unknown): ZipEntry {
  return { path, bytes: encoder.encode(`${JSON.stringify(value, null, 2)}\n`) };
}

/** Der Archivpfad eines Storage-Objekts: `storage/<bucket>/<name>`. */
export function storageEntryPath(bucket: string, name: string): string {
  return `${PLATFORM_ARCHIVE_LAYOUT.storagePrefix}${bucket}/${name}`;
}

/** Was nach dem vollständigen Durchlauf über das Archiv bekannt ist. */
export type ArchiveOutcome = {
  /** Jeder Pfad, der wirklich im Archiv liegt, in Schreibreihenfolge. */
  files: string[];
  storage: StorageManifestDocument;
  manifest: PlatformManifestDocument;
  /** Bereiche, am Dokument gezählt — nicht aus dem Manifest der Codebasis. */
  sectionCount: number;
};

/**
 * Das Archiv, faul und in EINEM Durchlauf.
 *
 * WARUM DIE BEIDEN MANIFESTE AM ENDE STEHEN. Ein Objekt kann sich beim Lesen
 * verweigern, und ein Export soll daran nicht sterben — er soll die Lücke
 * NENNEN. Damit stehen `storage_object_count`, `storage_missing_count`,
 * `unreadable` und die Dateiliste erst fest, wenn die letzte Datei durch ist.
 * Ein `manifest.json`, das vorne im Archiv liegt, müsste diese Zahlen also
 * raten — und ein Deckblatt, das Vollständigkeit behauptet, die das Archiv
 * nicht hat, ist schlimmer als ein Deckblatt an unerwarteter Stelle. Ein ZIP
 * hat keine vorgeschriebene Reihenfolge; ein Leser findet jede Datei über das
 * zentrale Verzeichnis.
 *
 * Reihenfolge: `database.json`, `auth-users.json`, die Objekte nach Pfad,
 * `storage-manifest.json`, `manifest.json`. Deterministisch, also ergeben
 * zwei Sicherungen desselben Zustands dasselbe Archiv.
 *
 * `outcome()` ist erst nach dem letzten Eintrag gültig und wirft vorher.
 */
export function platformArchive(input: {
  document: PlatformExportDocument;
  auth: AuthInventoryDocument;
  listed: readonly StorageObject[];
  /** Namen, die die Auflistung verworfen hat. Werden im Manifest genannt. */
  rejected?: readonly string[];
  expected: readonly string[];
  bytes: StorageByteSource;
  sourceProject: string | null;
  bucket?: string;
}): { entries: () => AsyncGenerator<ZipEntry, void, undefined>; outcome: () => ArchiveOutcome } {
  const bucket = input.bucket ?? STORAGE_BUCKETS_INCLUDED[0];
  const layout = PLATFORM_ARCHIVE_LAYOUT;
  let result: ArchiveOutcome | null = null;

  async function* entries(): AsyncGenerator<ZipEntry, void, undefined> {
    const files: string[] = [];
    const written: StorageObject[] = [];
    const unreadable: string[] = [];

    const emit = (entry: ZipEntry): ZipEntry => {
      files.push(entry.path);
      return entry;
    };

    // Unverändert durch. Keine zweite Exportlogik.
    yield emit(jsonEntry(layout.database, input.document));
    yield emit(jsonEntry(layout.authUsers, input.auth));

    const ordered = [...input.listed].sort((a, b) => a.name.localeCompare(b.name));
    for (const object of ordered) {
      let bytes: Uint8Array;
      try {
        bytes = await input.bytes(bucket, object.name);
      } catch {
        /*
         * Kein Abbruch, und ausdrücklich keine Weitergabe der Ursache: eine
         * Fehlermeldung der Storage-API kann eine signierte Adresse tragen.
         * Der Pfad wird vermerkt, der Export läuft weiter, und das
         * Storage-Manifest sagt es.
         */
        unreadable.push(object.name);
        continue;
      }
      if (object.size !== null && bytes.length !== object.size) {
        // Ein Objekt, dessen Länge der Auflistung widerspricht, ist nicht das
        // Objekt, das die Auflistung beschreibt. Es gilt als nicht lesbar.
        unreadable.push(object.name);
        continue;
      }
      written.push(object);
      yield emit({ path: storageEntryPath(bucket, object.name), bytes });
    }

    const storage = storageManifestDocument({
      listed: input.listed, written, unreadable, rejected: input.rejected,
      expected: input.expected, bucket,
    });
    yield emit(jsonEntry(layout.storageManifest, storage));

    /*
     * Das Deckblatt zuletzt, und es nennt sich selbst mit: `files` ist die
     * Liste des fertigen Archivs, und `manifest.json` gehört dazu.
     */
    const manifest = platformManifestDocument({
      document: input.document, auth: input.auth, storage,
      sourceProject: input.sourceProject,
      files: [...files, layout.manifest],
    });
    yield emit(jsonEntry(layout.manifest, manifest));

    const data = input.document.data;
    result = {
      files,
      storage,
      manifest,
      sectionCount: typeof data === "object" && data !== null ? Object.keys(data).length : 0,
    };
  }

  return {
    entries,
    outcome: () => {
      if (result === null) {
        throw new PlatformArchiveError(
          "Das Ergebnis steht erst fest, wenn das Archiv vollständig durchlaufen ist.",
        );
      }
      return result;
    },
  };
}

/* --------------------------------------------------------------------------
 * 5. Was über den fertigen Lauf in die Historie geht
 * ----------------------------------------------------------------------- */

/** Die Messwerte, die `admin_record_platform_export()` (0106) verlangt. */
export type PlatformExportMeasurements = {
  format_version: number;
  source_project: string;
  size_bytes: number;
  sha256: string;
  section_count: number;
  storage_file_count: number;
  storage_missing_count: number;
};

/**
 * Was über den fertigen Lauf in die Historie geht.
 *
 * `section_count` wird am Dokument GEZÄHLT, nicht aus dem Manifest der
 * Codebasis übernommen: weicht es von 53 ab, ist etwas verloren gegangen, und
 * genau das soll die Zahl zeigen können.
 */
export function exportMeasurements(input: {
  outcome: ArchiveOutcome;
  sourceProject: string;
  sizeBytes: number;
  sha256: string;
}): PlatformExportMeasurements {
  return {
    format_version: PLATFORM_FORMAT_VERSION,
    source_project: input.sourceProject,
    size_bytes: input.sizeBytes,
    sha256: input.sha256,
    section_count: input.outcome.sectionCount,
    storage_file_count: input.outcome.storage.storage_object_count,
    storage_missing_count: input.outcome.storage.storage_missing_count,
  };
}

/** Wie viele Bereiche der Vertrag erwartet. Für die Plausibilitätsprüfung. */
export const EXPECTED_SECTION_COUNT = PLATFORM_SECTIONS.length;

/**
 * Der Dateiname des Archivs.
 *
 * Dieselbe Form wie beim Business-Export: sortierbar, ohne Doppelpunkte (die
 * Windows im Dateinamen nicht erlaubt), ohne Projektreferenz — ein Dateiname
 * wandert durch Downloadordner und Chatfenster.
 */
export function platformArchiveFileName(now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const iso = `${stamp.slice(0, 8)}T${stamp.slice(9)}`;
  return `skyisles-platform-backup-${iso.slice(0, 4)}-${iso.slice(4, 6)}-${iso.slice(6)}.zip`;
}
