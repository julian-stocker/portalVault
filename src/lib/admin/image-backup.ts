/**
 * What a backup of the administrator's image overrides has to contain, and
 * what makes one trustworthy.
 *
 * WHY THIS EXISTS AT ALL
 *
 * A figure's picture comes from one of two places (ADR-0046). The imported
 * one is a file in `public/images/skylanders/`, committed to Git and shipped
 * by the deploy — losing it is a `git checkout`. The administrator's
 * replacement is an object in the Supabase storage bucket `catalog`, and it
 * exists **once**: not in Git, not in the other environment, not in any
 * export. Two ordinary admin actions delete it for good — replacing the
 * picture removes the object it replaced, and "Bild entfernen" removes the
 * current one.
 *
 * So the bytes need a backup, and a backup nobody has verified is a folder
 * that will be trusted later for no reason. Everything below is the
 * verification.
 *
 * PURE ON PURPOSE
 *
 * No network, no filesystem, no Supabase client. The tool does the talking and
 * hands the answers here, which is what lets the rules be tested with fakes
 * rather than against a real project.
 */
import { createHash } from "node:crypto";

import { isOverridePath } from "../catalog/image.ts";

/** Bumped when the manifest shape changes in a way a reader must notice. */
export const MANIFEST_SCHEMA_VERSION = 1;

/** The bucket the overrides live in. One name, from the application. */
export { CATALOG_BUCKET } from "../catalog/image.ts";

/** A row exactly as the production query returns it. */
export type OverrideRow = {
  sky_id: string;
  name: string;
  image_file: string | null;
  image_override_path: string;
  source: string | null;
  updated_at: string | null;
};

/** One object, downloaded and measured. */
export type DownloadedObject = {
  row: OverrideRow;
  bytes: Uint8Array;
};

export type ManifestObject = {
  sky_id: string;
  name: string;
  image_file: string | null;
  image_override_path: string;
  source: string | null;
  updated_at: string | null;
  /** Where the bytes sit inside the backup, mirroring the storage layout. */
  storage_path: string;
  extension: string;
  byte_size: number;
  sha256: string;
};

export type Manifest = {
  schema_version: number;
  environment: "production";
  created_at: string;
  /** The project reference, e.g. `abcdefgh`. Never a URL, never a key. */
  project_ref: string | null;
  bucket: string;
  /** How many rows the database said carry an override. */
  figure_count: number;
  /** How many objects were actually written. Equal to figure_count, or it failed. */
  object_count: number;
  /**
   * The one field a restore may trust.
   *
   * False until every rule below has passed. A partial export writes the
   * manifest anyway — knowing what was reached is worth more than an empty
   * directory — but it can never call itself complete.
   */
  complete: boolean;
  objects: ManifestObject[];
  /** Objects in the bucket no row points at. Backed up separately, never mixed in. */
  orphans: OrphanObject[];
  /** Empty on success. Every reason the export is not trustworthy. */
  problems: string[];
};

export type OrphanObject = {
  storage_path: string;
  byte_size: number;
  sha256: string;
};

/** Full SHA-256, hex. The same digest `imagePathFor()` truncates. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * The 16 hex characters a storage path encodes, or `null` if it encodes none.
 *
 * `SKY-0009/c29021891080cd90.jpg` → `c29021891080cd90`.
 */
export function hashInPath(storagePath: string): string | null {
  const match = /^SKY-[0-9]{4}\/([0-9a-f]{16})\.(webp|png|jpg)$/.exec(storagePath);
  return match ? match[1] : null;
}

/** The file extension a storage path carries. */
export function extensionOf(storagePath: string): string | null {
  const match = /\.([a-z0-9]+)$/.exec(storagePath);
  return match ? match[1] : null;
}

/**
 * Everything wrong with one downloaded object.
 *
 * The hash check is the one that matters. A path is content-addressed, so the
 * bytes and the name are two statements about the same thing — if they
 * disagree, either the object was overwritten under a fixed name or something
 * handed us the wrong file, and neither is a backup anybody should keep.
 */
export function verifyObject(object: DownloadedObject): string[] {
  const problems: string[] = [];
  const { row, bytes } = object;
  const path = row.image_override_path;

  if (!isOverridePath(path, row.sky_id)) {
    problems.push(`${row.sky_id}: '${path}' is not a valid override path for this figure`);
    return problems;
  }
  if (bytes.length === 0) {
    problems.push(`${row.sky_id}: ${path} is empty`);
    return problems;
  }

  const expected = hashInPath(path);
  const actual = sha256Hex(bytes).slice(0, 16);
  if (expected !== actual) {
    problems.push(
      `${row.sky_id}: ${path} contains bytes whose sha256 starts ${actual}, not ${expected}`,
    );
  }
  return problems;
}

/** Deterministic: by SKY-ID, then by path for the rare figure with two rows. */
function byIdentity(a: ManifestObject, b: ManifestObject): number {
  if (a.sky_id !== b.sky_id) return a.sky_id < b.sky_id ? -1 : 1;
  return a.image_override_path < b.image_override_path ? -1 : 1;
}

/**
 * Rules about the SET, as opposed to the individual objects.
 *
 * `figure_count` is what the database said; the objects are what was actually
 * written. A backup that quietly holds fewer is the failure this catches.
 */
export function setProblems(objects: readonly ManifestObject[], figureCount: number): string[] {
  const problems: string[] = [];

  if (objects.length !== figureCount) {
    problems.push(
      `the database reported ${figureCount} figures with an override, ${objects.length} objects were written`,
    );
  }

  const seenFigures = new Set<string>();
  const seenPaths = new Set<string>();
  for (const object of objects) {
    if (seenFigures.has(object.sky_id)) problems.push(`${object.sky_id} appears twice`);
    seenFigures.add(object.sky_id);
    /*
     * Paths are unique, figures are unique — but the HASH is not. Two figures
     * may legitimately carry the same picture, and then two different paths
     * end in the same 16 characters. Production already has such a pair.
     * Nothing here may treat that as a collision.
     */
    if (seenPaths.has(object.image_override_path)) {
      problems.push(`${object.image_override_path} appears twice`);
    }
    seenPaths.add(object.image_override_path);
  }

  return problems;
}

export function buildManifest(input: {
  createdAt: string;
  projectRef: string | null;
  bucket: string;
  figureCount: number;
  objects: readonly ManifestObject[];
  orphans: readonly OrphanObject[];
  /** Anything the caller already knows went wrong — a failed download, say. */
  problems: readonly string[];
}): Manifest {
  const objects = [...input.objects].sort(byIdentity);
  const orphans = [...input.orphans].sort((a, b) =>
    a.storage_path < b.storage_path ? -1 : a.storage_path > b.storage_path ? 1 : 0,
  );
  /*
   * Per-object verification already happened at download time, where the
   * bytes existed — the manifest does not carry them and cannot redo it. What
   * is left to check here is the SET: the count, and that no figure or path
   * appears twice.
   */
  const problems = [...input.problems, ...setProblems(objects, input.figureCount)];

  return {
    schema_version: MANIFEST_SCHEMA_VERSION,
    environment: "production",
    created_at: input.createdAt,
    project_ref: input.projectRef,
    bucket: input.bucket,
    figure_count: input.figureCount,
    object_count: objects.length,
    complete: problems.length === 0,
    objects,
    orphans,
    problems,
  };
}

/**
 * Where an object goes inside the backup.
 *
 * The storage layout, preserved rather than flattened. Two figures may share a
 * picture — `SKY-0082/f6bd960ece6605ee.jpg` and `SKY-0280/f6bd960ece6605ee.jpg`
 * exist in production today — and a hash-named flat directory would silently
 * keep one of them.
 */
export function backupPathFor(storagePath: string): string {
  return `objects/${storagePath}`;
}

/** The same, for an object nothing points at. Kept apart, never merged in. */
export function orphanPathFor(storagePath: string): string {
  return `orphans/${storagePath}`;
}
