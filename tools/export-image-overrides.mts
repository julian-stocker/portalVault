/**
 * Backs up the administrator's figure images from PRODUCTION.
 *
 *   npm run images:export:prod
 *
 * READ ONLY. It runs SELECTs, it lists the bucket and it downloads objects.
 * There is no INSERT, UPDATE, DELETE, upload, remove or RPC call anywhere in
 * this file, and `images-export.test.ts` holds that.
 *
 * WHY IT EXISTS
 *
 * A figure's picture comes from one of two places (ADR-0046). The imported one
 * is a file in `public/images/skylanders/`, committed to Git — losing it is a
 * `git checkout`. The administrator's replacement is an object in the storage
 * bucket `catalog`, and it exists exactly once: not in Git, not in staging,
 * not in any export.
 *
 * Two ordinary actions in the admin UI destroy it. Replacing a picture deletes
 * the object it replaced; "Bild entfernen" deletes the current one. Neither
 * asks twice, and neither is recoverable. Production currently holds 36 such
 * pictures, each of them work somebody did by hand.
 *
 * WHAT A GOOD BACKUP MEANS HERE
 *
 * Not "files were downloaded". Every object is verified against the path it
 * came from: the path is content-addressed, so `SKY-0009/c29021891080cd90.jpg`
 * is a claim that the bytes hash to `c29021891080cd90…`. If a claim fails, the
 * export fails — a folder that will be trusted later has to earn it now.
 *
 * WHERE IT WRITES
 *
 * Only into `.backups/`, which is gitignored. Production image bytes are not
 * repository assets and this tool does not make them any (see ADR-0046); a
 * later decision may promote individual pictures, one at a time.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  CATALOG_BUCKET,
  backupPathFor,
  buildManifest,
  extensionOf,
  orphanPathFor,
  sha256Hex,
  verifyObject,
  type ManifestObject,
  type OrphanObject,
  type OverrideRow,
} from "../src/lib/admin/image-backup.ts";
import { projectRef, requireProduction } from "./lib/staging-guard.mts";

const BACKUP_ROOT = ".backups/image-overrides/production";

function heading(text: string): void {
  console.log(`\n${text}\n${"-".repeat(text.length)}`);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`\nMissing ${name}. Run through npm, which loads .env.local.\n`);
    process.exit(1);
  }
  return value;
}

/** A timestamp that sorts, and that a filesystem accepts. */
function stamp(now: Date): string {
  return now.toISOString().replace(/[:.]/g, "-");
}

async function download(client: SupabaseClient, path: string): Promise<Uint8Array | string> {
  const { data, error } = await client.storage.from(CATALOG_BUCKET).download(path);
  if (error || !data) return error?.message ?? "no data";
  return new Uint8Array(await data.arrayBuffer());
}

/**
 * Every object in the bucket, one SKY-ID directory at a time.
 *
 * The storage API lists one prefix per call and does not recurse, so the
 * directories come from the first listing and their contents from a second
 * round. Anything deeper than `SKY-xxxx/<file>` is not a shape this
 * application creates; if one turns up it is reported rather than walked, so
 * the census says what it actually saw.
 */
async function listBucket(
  client: SupabaseClient,
): Promise<{ paths: string[]; notes: string[] }> {
  const notes: string[] = [];
  const paths: string[] = [];

  const root = await client.storage.from(CATALOG_BUCKET).list("", { limit: 1000 });
  if (root.error) {
    notes.push(`bucket listing failed: ${root.error.message}`);
    return { paths, notes };
  }

  for (const entry of root.data ?? []) {
    // A directory has no id; a file at the root would be unexpected here.
    if (entry.id !== null) {
      notes.push(`unexpected file at the bucket root: ${entry.name}`);
      continue;
    }
    const inner = await client.storage.from(CATALOG_BUCKET).list(entry.name, { limit: 1000 });
    if (inner.error) {
      notes.push(`listing ${entry.name}/ failed: ${inner.error.message}`);
      continue;
    }
    for (const object of inner.data ?? []) {
      if (object.id === null) {
        notes.push(`nested directory not walked: ${entry.name}/${object.name}/`);
        continue;
      }
      paths.push(`${entry.name}/${object.name}`);
    }
  }

  return { paths, notes };
}

async function write(file: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, bytes);
}

async function main(): Promise<void> {
  heading("1. Environment");
  // Before the client exists: a backup labelled "production" has to be one.
  const origin = requireProduction("images:export:prod");
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const client = createClient(url, requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  console.log(`  origin: ${origin}`);

  heading("2. Overrides in the database");
  const { data, error } = await client
    .from("skylanders")
    .select("sky_id, name, image_file, image_override_path, source, updated_at")
    .not("image_override_path", "is", null)
    .order("sky_id");
  if (error) throw new Error(`read skylanders: ${error.message}`);

  const rows = (data ?? []) as OverrideRow[];
  console.log(`  figures with an override: ${rows.length}`);
  if (rows.length === 0) {
    console.log("\n  Nothing to back up. No directory was created.\n");
    return;
  }

  /*
   * A directory per run, named for the moment it started, and never reused:
   * `writeFile` would overwrite, and an export that silently merges into an
   * older one is an export nobody can date. A clash needs no handling because
   * the name carries milliseconds.
   */
  const directory = join(BACKUP_ROOT, stamp(new Date()));
  console.log(`  backup directory: ${directory}/`);

  heading("3. Objects");
  const objects: ManifestObject[] = [];
  const problems: string[] = [];

  for (const row of rows) {
    const path = row.image_override_path;
    const bytes = await download(client, path);
    if (typeof bytes === "string") {
      problems.push(`${row.sky_id}: ${path} could not be downloaded (${bytes})`);
      console.log(`  ✗ ${row.sky_id}  ${path}  — ${bytes}`);
      continue;
    }

    const found = verifyObject({ row, bytes });
    if (found.length > 0) {
      problems.push(...found);
      for (const problem of found) console.log(`  ✗ ${problem}`);
      continue;
    }

    await write(join(directory, backupPathFor(path)), bytes);
    objects.push({
      sky_id: row.sky_id,
      name: row.name,
      image_file: row.image_file,
      image_override_path: path,
      source: row.source,
      updated_at: row.updated_at,
      storage_path: path,
      extension: extensionOf(path) ?? "",
      byte_size: bytes.length,
      sha256: sha256Hex(bytes),
    });
    console.log(`  ✓ ${row.sky_id}  ${path}  ${bytes.length} B`);
  }

  heading("4. Orphans");
  /*
   * Objects nothing points at — remnants of earlier replacements. They are not
   * deleted, not modified and not mixed into the active set: they are somebody's
   * previous picture, and the whole point of this run is that such things stop
   * disappearing unnoticed.
   */
  const referenced = new Set(rows.map((row) => row.image_override_path));
  const { paths, notes } = await listBucket(client);
  for (const note of notes) console.log(`  ! ${note}`);

  const orphans: OrphanObject[] = [];
  for (const path of paths) {
    if (referenced.has(path)) continue;
    const bytes = await download(client, path);
    if (typeof bytes === "string") {
      console.log(`  ! orphan ${path} could not be downloaded (${bytes})`);
      continue;
    }
    await write(join(directory, orphanPathFor(path)), bytes);
    orphans.push({ storage_path: path, byte_size: bytes.length, sha256: sha256Hex(bytes) });
    console.log(`  + orphan ${path}  ${bytes.length} B`);
  }
  console.log(`  referenced ${referenced.size}, in bucket ${paths.length}, orphaned ${orphans.length}`);

  heading("5. Manifest");
  const manifest = buildManifest({
    createdAt: new Date().toISOString(),
    // The reference, never the URL and never the key: a manifest is a file
    // somebody will copy around.
    projectRef: projectRef(url),
    bucket: CATALOG_BUCKET,
    figureCount: rows.length,
    objects,
    orphans,
    problems: [...problems, ...notes],
  });
  await write(
    join(directory, "manifest.json"),
    new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`),
  );

  console.log(`  objects ${manifest.object_count}/${manifest.figure_count}, orphans ${orphans.length}`);
  heading("Result");
  if (!manifest.complete) {
    console.error(`  INCOMPLETE — ${manifest.problems.length} problem(s):`);
    for (const problem of manifest.problems) console.error(`    - ${problem}`);
    console.error(`\n  ${directory}/manifest.json records complete=false.`);
    console.error("  Do not treat this directory as a backup.\n");
    process.exit(1);
  }
  console.log(`  Complete. ${manifest.object_count} pictures verified and written.`);
  console.log(`  ${directory}/\n`);
}

main().catch((error: unknown) => {
  console.error(`\nExport aborted: ${error instanceof Error ? error.message : error}`);
  console.error("Production was only ever read.\n");
  process.exit(1);
});
