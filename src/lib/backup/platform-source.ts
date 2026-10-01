/**
 * Woher die vier Bestandteile der Plattformsicherung kommen.
 *
 * Diese Datei ist die einzige im Backup-Code, die überhaupt etwas holt. Sie
 * holt es über die **Sitzung des angemeldeten Plattformadmins** — kein
 * Service-Role-Schlüssel, und in dieser Anwendung existiert auch keiner
 * (`docs/DEPLOYMENT.md:61`). Die Entscheidung, wer Daten bekommt, fällt
 * ausschließlich in der Datenbank:
 *
 *   system_platform_export()   is_platform_admin(), sonst SQL-NULL   (0105)
 *   system_auth_inventory()    is_platform_admin(), sonst SQL-NULL   (0107)
 *   storage catalog            Policy catalog_images_read            (0007)
 *
 * KEINE ZWEITE ROLLENLOGIK. Hier wird nichts geprüft, was die Datenbank schon
 * prüft. `null` von einer der beiden Funktionen heißt „der Wächter hat
 * abgelehnt", und das wird als solches weitergegeben — nicht als leeres
 * Backup, denn eine Datei mit `{}` sähe aus wie eine Sicherung ohne Inhalt.
 *
 * DER CLIENT WIRD ÜBERGEBEN, NICHT GEBAUT. Ein struktureller Typ statt
 * `SupabaseClient`: die Adapter brauchen drei Methoden, und ein Test soll sie
 * ohne Netz und ohne Cookies stellen können.
 *
 * NICHTS WIRD PROTOKOLLIERT. Kein Dokument, kein Ausschnitt, keine Zeilenzahl,
 * keine E-Mail-Adresse, kein Pfad. Fehlermeldungen tragen keinen Text aus der
 * Datenbank und keinen aus der Storage-API — beide können Tabellennamen oder
 * signierte Adressen enthalten.
 */

import { CATALOG_BUCKET } from "../catalog/image";
import { isSafeZipPath } from "../zip/zip-path";
import type { AuthInventoryRow, PlatformExportDocument, StorageObject } from "./platform-archive";

/** Genau die drei Fähigkeiten, die die Adapter brauchen. */
export type PlatformSourceClient = {
  rpc(fn: string): PromiseLike<{ data: unknown; error: unknown }>;
  storage: {
    from(bucket: string): {
      list(
        path: string,
        options?: { limit?: number; offset?: number; sortBy?: { column: string; order: string } },
      ): PromiseLike<{ data: RawStorageEntry[] | null; error: unknown }>;
      download(path: string): PromiseLike<{ data: Blob | null; error: unknown }>;
    };
  };
};

/** Eine Zeile, wie `storage.list()` sie liefert. Ordner haben `id === null`. */
export type RawStorageEntry = {
  name: string;
  id: string | null;
  created_at: string | null;
  updated_at: string | null;
  metadata: { size?: number | null; mimetype?: string | null; eTag?: string | null } | null;
};

/** Eine Quelle hat nicht geantwortet, oder nicht so, wie sie muss. */
export class PlatformSourceError extends Error {
  /** Passt zu `failure_stage` in `platform_export_runs` (0105). */
  stage: "database" | "auth_inventory" | "storage_manifest";

  constructor(stage: PlatformSourceError["stage"], message: string) {
    super(message);
    this.name = "PlatformSourceError";
    this.stage = stage;
  }
}

/* --------------------------------------------------------------------------
 * 1. database.json
 * ----------------------------------------------------------------------- */

/**
 * Das Datenbankdokument, unverändert aus `system_platform_export()`.
 *
 * Eine Quelle, ein Statement, eine MVCC-Momentaufnahme, 53 Bereiche. Diese
 * Funktion fragt keine Tabelle selbst und formt nichts um — die zweite
 * Definition der Bereiche, die hier entstehen könnte, wäre genau die, die es
 * nicht geben darf.
 */
export async function fetchPlatformDocument(
  client: PlatformSourceClient,
): Promise<PlatformExportDocument> {
  const { data, error } = await client.rpc("system_platform_export");
  if (error) {
    throw new PlatformSourceError("database", "Der Plattform-Export hat nicht geantwortet.");
  }
  // `null` heißt: der Wächter hat abgelehnt. Niemals als leeres Backup lesen.
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new PlatformSourceError("database", "Kein Plattform-Export für diese Sitzung.");
  }
  return data as PlatformExportDocument;
}

/* --------------------------------------------------------------------------
 * 2. auth-users.json
 * ----------------------------------------------------------------------- */

/**
 * Die Zeilen des Auth-Inventars, ungeformt.
 *
 * Geformt und auf die sieben erlaubten Felder reduziert wird in
 * `authInventoryDocument()` — dort, wo es ohne Netz prüfbar ist, und dort, wo
 * ein gesperrtes Feld einen Fehler auslöst statt still durchzugehen.
 */
export async function fetchAuthInventoryRows(
  client: PlatformSourceClient,
): Promise<AuthInventoryRow[]> {
  const { data, error } = await client.rpc("system_auth_inventory");
  if (error) {
    throw new PlatformSourceError("auth_inventory", "Das Auth-Inventar hat nicht geantwortet.");
  }
  if (data === null) {
    throw new PlatformSourceError("auth_inventory", "Kein Auth-Inventar für diese Sitzung.");
  }
  if (!Array.isArray(data)) {
    throw new PlatformSourceError("auth_inventory", "Das Auth-Inventar hat nicht die erwartete Form.");
  }
  return data as AuthInventoryRow[];
}

/* --------------------------------------------------------------------------
 * 3. storage-manifest.json und die Dateien
 * ----------------------------------------------------------------------- */

/** Wie viele Einträge eine Auflistung pro Runde holt. */
const PAGE = 100;

/*
 * OBERGRENZEN ALS SCHLEIFENSCHUTZ, NICHT ALS INHALTSGRENZE.
 *
 * Die Tiefe ist NICHT begrenzt — der Bucket ist heute eine Ebene tief
 * (`SKY-0007/<16 hex>.webp`, ADR-0046), aber eine Sicherung, die eine
 * zukünftige tiefere Struktur still ausließe, wäre wertlos. Gelistet wird
 * deshalb rekursiv, so weit die API Ordner nennt.
 *
 * Was begrenzt ist, ist die Anzahl der Runden um eine fremde API. Wird eine
 * dieser Grenzen erreicht, WIRFT diese Funktion — sie überspringt nichts. Ein
 * Backup mit stillschweigend fehlenden Dateien ist schlimmer als ein Backup,
 * das sagt, dass es nicht fertig wurde.
 */
const MAX_PREFIXES = 10_000;
const MAX_OBJECTS = 200_000;
const MAX_DEPTH = 32;

function isFolder(entry: RawStorageEntry): boolean {
  // Supabase kennzeichnet einen Präfix so: keine Kennung, keine Metadaten.
  return entry.id === null && entry.metadata === null;
}

function join(prefix: string, name: string): string {
  return prefix === "" ? name : `${prefix}/${name}`;
}

function toObject(prefix: string, entry: RawStorageEntry): StorageObject {
  return {
    name: join(prefix, entry.name),
    size: entry.metadata?.size ?? null,
    mimetype: entry.metadata?.mimetype ?? null,
    etag: entry.metadata?.eTag ?? null,
    created_at: entry.created_at,
    updated_at: entry.updated_at,
  };
}

/** Was eine Auflistung ergeben hat. */
export type BucketListing = {
  /** Jedes Objekt, das ins Archiv darf — nach Pfad sortiert. */
  objects: StorageObject[];
  /**
   * Objektnamen, die der ZIP-Schreiber nicht annehmen würde.
   *
   * Sie werden NICHT still verworfen: `platformArchive()` trägt sie ins
   * Storage-Manifest und zählt sie als fehlend. Ein Name aus einer fremden
   * API ist Eingabe, nicht Wahrheit — aber ein verworfener Name ist ein
   * Befund, kein Nichts.
   */
  rejected: string[];
};

/**
 * Jedes Objekt im Bucket, mit seinen Metadaten — beliebig tief.
 *
 * `storage.list()` liefert genau eine Ebene und höchstens `PAGE` Einträge,
 * also beides: Blättern und Absteigen. Ordner erkennt man daran, dass Supabase
 * sie ohne Kennung und ohne Metadaten nennt.
 *
 * Die Struktur wird NICHT erfunden, sie wird gelesen. Und sie wird nicht
 * abgeschnitten: taucht morgen `SKY-0007/2026/a.webp` auf, ist es im Backup.
 *
 * SCHUTZ GEGEN EINE API, DIE SICH VERSCHLUCKT. Ein Präfix wird höchstens
 * einmal besucht; nennt eine Antwort einen Präfix erneut, ist das eine
 * Schleife und wird zum Fehler. Ebenso eine leere Ordnerbezeichnung, ein
 * Ordnername mit `/` darin und jede der drei Obergrenzen. Kein Fall führt zum
 * stillen Überspringen.
 */
export async function listBucketObjects(
  client: PlatformSourceClient,
  bucket: string = CATALOG_BUCKET,
): Promise<BucketListing> {
  const bin = client.storage.from(bucket);
  const objects: StorageObject[] = [];
  const rejected: string[] = [];
  const visited = new Set<string>([""]);
  const queue: { prefix: string; depth: number }[] = [{ prefix: "", depth: 0 }];

  const fail = (why: string): never => {
    throw new PlatformSourceError("storage_manifest", `Die Objektliste wurde nicht fertig: ${why}`);
  };

  while (queue.length > 0) {
    const { prefix, depth } = queue.shift()!;
    if (depth > MAX_DEPTH) fail(`Verzeichnistiefe über ${MAX_DEPTH}`);

    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await bin.list(prefix, {
        limit: PAGE,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
      if (error) fail("der Bucket hat die Liste verweigert");

      const page = data ?? [];
      for (const entry of page) {
        if (typeof entry?.name !== "string" || entry.name === "") {
          fail("ein Eintrag ohne Namen");
        }
        if (isFolder(entry)) {
          // Ein Ordnername ist ein Segment. Enthielte er `/`, wäre die
          // Ebenenlogik nicht mehr die der API.
          if (entry.name.includes("/")) fail(`ein Ordnername mit Trennzeichen`);
          const next = join(prefix, entry.name);
          if (visited.has(next)) fail("ein Präfix wurde zweimal genannt");
          visited.add(next);
          if (visited.size > MAX_PREFIXES) fail(`mehr als ${MAX_PREFIXES} Verzeichnisse`);
          queue.push({ prefix: next, depth: depth + 1 });
          continue;
        }

        const object = toObject(prefix, entry);
        // Der Pfad, den das Archiv tragen würde — vor dem Archiv geprüft.
        if (isSafeZipPath(`storage/${bucket}/${object.name}`)) {
          objects.push(object);
          if (objects.length > MAX_OBJECTS) fail(`mehr als ${MAX_OBJECTS} Objekte`);
        } else {
          rejected.push(object.name);
        }
      }

      if (page.length < PAGE) break;
    }
  }

  return {
    objects: objects.sort((a, b) => a.name.localeCompare(b.name)),
    rejected: rejected.sort(),
  };
}

/**
 * Die Bytes eines Objekts, über dieselbe Sitzung.
 *
 * Nicht über die öffentliche Objekt-URL: die wäre eine zweite, unauthenti-
 * fizierte Verbindung zum selben Projekt, und sie hinge an einer Adresse, die
 * diese Funktion selbst zusammensetzen müsste. `download()` geht den Weg, den
 * `image-actions.ts` schon geht.
 *
 * Wirft mit dem Pfad, aber ohne die Meldung der Storage-API: die kann eine
 * signierte Adresse enthalten. Wer den Wurf fängt, zählt das Objekt als
 * fehlend — `platformArchive()` tut genau das, statt den Export abzubrechen.
 */
export function makeStorageByteSource(client: PlatformSourceClient) {
  return async function bytes(bucket: string, name: string): Promise<Uint8Array> {
    const { data, error } = await client.storage.from(bucket).download(name);
    if (error || data === null) {
      throw new PlatformSourceError("storage_manifest", `Objekt nicht lesbar: ${bucket}/${name}`);
    }
    return new Uint8Array(await data.arrayBuffer());
  };
}
