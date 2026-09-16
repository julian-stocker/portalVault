/**
 * Reproducing a verified backup of figure images in another environment.
 *
 * THE SOURCE IS THE BACKUP, NOT PRODUCTION
 *
 * `export-image-overrides.mts` already read production once, verified every
 * object against its content-addressed path and wrote a manifest that says so.
 * This side never contacts production again — not for the bytes, not for the
 * paths, not for credentials. A sync that needed the source environment to be
 * reachable would be useless on the day it is actually needed.
 *
 * So `complete: true` in a manifest is a claim, and everything below is the
 * refusal to take it at face value: the files are re-hashed, the paths
 * re-checked, the set re-counted. A backup that was correct when it was made
 * can still have been edited, truncated or half-copied since.
 *
 * PURE ON PURPOSE
 *
 * No network and no Supabase client. The tool reads the filesystem and the
 * target database and hands the answers here; that is what lets every rule be
 * exercised with fakes.
 */
import { isOverridePath } from "../catalog/image.ts";
import {
  MANIFEST_SCHEMA_VERSION,
  hashInPath,
  sha256Hex,
  type Manifest,
  type ManifestObject,
} from "./image-backup.ts";

/** The bucket both environments use. Re-exported so the tool has one import. */
export { CATALOG_BUCKET } from "../catalog/image.ts";

/** One manifest entry paired with the bytes actually found on disk. */
export type LocalObject = {
  entry: ManifestObject;
  /** `null` when the file named by the manifest is not there. */
  bytes: Uint8Array | null;
};

/**
 * Everything wrong with the backup, before the target is even contacted.
 *
 * Returning all of them rather than the first: a half-copied directory has one
 * cause and many symptoms, and seeing the shape of the damage is what tells
 * somebody whether to re-copy or re-export.
 */
export function verifyBackup(manifest: Manifest, objects: readonly LocalObject[]): string[] {
  const problems: string[] = [];

  if (manifest.schema_version !== MANIFEST_SCHEMA_VERSION) {
    problems.push(
      `manifest schema ${manifest.schema_version} is not supported (expected ${MANIFEST_SCHEMA_VERSION})`,
    );
    // Nothing below can be trusted to mean what it appears to mean.
    return problems;
  }
  if (manifest.environment !== "production") {
    problems.push(`manifest environment is '${manifest.environment}', not production`);
  }
  if (manifest.bucket !== "catalog") {
    problems.push(`manifest bucket is '${manifest.bucket}', not catalog`);
  }
  if (!manifest.complete) {
    problems.push("manifest says complete=false — this directory is not a backup");
  }
  if (manifest.objects.length !== manifest.object_count) {
    problems.push(
      `manifest lists ${manifest.objects.length} objects but claims object_count ${manifest.object_count}`,
    );
  }
  if (manifest.object_count !== manifest.figure_count) {
    problems.push(
      `manifest covers ${manifest.object_count} of ${manifest.figure_count} figures`,
    );
  }

  const seenFigures = new Set<string>();
  const seenPaths = new Set<string>();
  for (const { entry, bytes } of objects) {
    const path = entry.image_override_path;

    if (seenFigures.has(entry.sky_id)) problems.push(`${entry.sky_id} appears twice in the manifest`);
    seenFigures.add(entry.sky_id);
    /*
     * Paths must be unique; HASHES need not be. Two figures may carry the same
     * picture, and then two distinct paths end in the same 16 characters —
     * production holds such a pair today. Only the path is a collision.
     */
    if (seenPaths.has(path)) problems.push(`${path} appears twice in the manifest`);
    seenPaths.add(path);

    if (!isOverridePath(path, entry.sky_id)) {
      problems.push(`${entry.sky_id}: '${path}' is not a valid override path for this figure`);
      continue;
    }
    if (entry.storage_path !== path) {
      problems.push(`${entry.sky_id}: storage_path '${entry.storage_path}' disagrees with '${path}'`);
    }
    if (bytes === null) {
      problems.push(`${entry.sky_id}: ${path} is missing from the backup directory`);
      continue;
    }
    if (bytes.length === 0) {
      problems.push(`${entry.sky_id}: ${path} is empty on disk`);
      continue;
    }
    if (bytes.length !== entry.byte_size) {
      problems.push(
        `${entry.sky_id}: ${path} is ${bytes.length} bytes, the manifest says ${entry.byte_size}`,
      );
    }

    const actual = sha256Hex(bytes);
    if (actual !== entry.sha256) {
      problems.push(`${entry.sky_id}: ${path} hashes to ${actual}, the manifest says ${entry.sha256}`);
      continue;
    }
    // And the path itself is a claim about the same bytes.
    const expected = hashInPath(path);
    if (expected !== actual.slice(0, 16)) {
      problems.push(`${entry.sky_id}: ${path} does not address its own bytes`);
    }
  }

  return problems;
}

/** What the target currently says about one figure. */
export type TargetState = {
  /** `null` when no row with this SKY-ID exists. */
  overridePath?: string | null;
  exists: boolean;
  /** Bytes of the object at the manifest's path, or `null` when absent. */
  objectBytes?: Uint8Array | null;
};

export type Classification =
  | "READY"
  | "ALREADY_SYNCED"
  | "DIFFERENT_OVERRIDE"
  | "MISSING_FIGURE"
  | "OBJECT_MISSING"
  | "OBJECT_DIFFERENT";

export type Entry = {
  entry: ManifestObject;
  state: Classification;
  /** Why, in one line, for the classifications that need one. */
  detail?: string;
};

/**
 * What the target would need for this figure to match the backup.
 *
 * The order of the questions is the order of the answers, and it matters. A
 * figure that does not exist cannot have an override; an object whose bytes
 * differ is a different fact from one that is absent; and "already synced"
 * requires BOTH halves to agree, because a row pointing at an object that is
 * not there is a broken figure, not a finished one.
 */
export function classify(entry: ManifestObject, state: TargetState): Entry {
  if (!state.exists) {
    return { entry, state: "MISSING_FIGURE", detail: "no row with this SKY-ID" };
  }

  const current = state.overridePath ?? null;
  const wanted = entry.image_override_path;

  if (current !== null && current !== wanted) {
    return {
      entry,
      state: "DIFFERENT_OVERRIDE",
      detail: `points at ${current}`,
    };
  }

  const bytes = state.objectBytes ?? null;

  if (bytes !== null && bytes.length > 0 && sha256Hex(bytes) !== entry.sha256) {
    /*
     * The same path holds other bytes. Uploading would overwrite somebody
     * else's picture, so this never becomes an automatic action — not even
     * when the row still points nowhere.
     */
    return { entry, state: "OBJECT_DIFFERENT", detail: `${wanted} holds other bytes` };
  }

  if (current === wanted) {
    if (bytes === null || bytes.length === 0) {
      // The row is right and the picture is gone: a repair, and an explicit
      // one — the upload is exactly the object the backup already verified.
      return { entry, state: "OBJECT_MISSING", detail: `${wanted} is not in the bucket` };
    }
    return { entry, state: "ALREADY_SYNCED" };
  }

  return { entry, state: "READY" };
}

/** What `--apply` may change without anybody looking at it first. */
export const AUTOMATIC: readonly Classification[] = ["READY", "OBJECT_MISSING"];

/** What stops the run and waits for a human. */
export const CONFLICTS: readonly Classification[] = [
  "DIFFERENT_OVERRIDE",
  "MISSING_FIGURE",
  "OBJECT_DIFFERENT",
];

export function isAutomatic(state: Classification): boolean {
  return AUTOMATIC.includes(state);
}

export function isConflict(state: Classification): boolean {
  return CONFLICTS.includes(state);
}

export type Action = {
  skyId: string;
  storagePath: string;
  /** `OBJECT_MISSING` needs no override write — the row already points here. */
  steps: ("UPLOAD" | "SET_OVERRIDE")[];
};

/** The plan, in manifest order, so two runs print the same thing. */
export function planFor(entries: readonly Entry[]): Action[] {
  const actions: Action[] = [];
  for (const { entry, state } of entries) {
    if (state === "READY") {
      actions.push({
        skyId: entry.sky_id,
        storagePath: entry.image_override_path,
        steps: ["UPLOAD", "SET_OVERRIDE"],
      });
    } else if (state === "OBJECT_MISSING") {
      actions.push({
        skyId: entry.sky_id,
        storagePath: entry.image_override_path,
        steps: ["UPLOAD"],
      });
    }
  }
  return actions;
}

export function countByState(entries: readonly Entry[]): Record<Classification, number> {
  const counts: Record<Classification, number> = {
    READY: 0,
    ALREADY_SYNCED: 0,
    DIFFERENT_OVERRIDE: 0,
    MISSING_FIGURE: 0,
    OBJECT_MISSING: 0,
    OBJECT_DIFFERENT: 0,
  };
  for (const entry of entries) counts[entry.state] += 1;
  return counts;
}
