/**
 * Reproduces a verified production image backup in STAGING.
 *
 *   npm run images:sync:staging -- <backup-directory>            dry run
 *   npm run images:sync:staging -- <backup-directory> --apply    writes
 *
 * DRY RUN IS THE DEFAULT. `--apply` is never implied, never inferred from a
 * clean plan, and never skipped because the previous run was fine.
 *
 * PRODUCTION IS NOT INVOLVED
 *
 * The source is the backup directory and nothing else — no production URL, no
 * production key, no download. That is the point: a restore that needed the
 * source environment to be reachable would be useless on the day it is needed.
 *
 * WHAT IT WILL NOT DO
 *
 * It never deletes. Not an object, not a row, not a path it does not
 * recognise. It never overwrites an object whose bytes differ from the
 * backup's, and it never repoints a figure that already points somewhere else.
 * Those are `DIFFERENT_OVERRIDE` and `OBJECT_DIFFERENT`, and they stop the run
 * rather than being resolved by a tool that cannot know which picture was
 * meant.
 *
 * THE TWO HALVES ARE NOT A TRANSACTION
 *
 * Storage and the database cannot commit together. So the order is fixed:
 * upload, verify the upload by reading it back, and only then point the figure
 * at it. Every failure leaves the target in a state a rerun understands — an
 * object without a row is `READY` again, and nothing has been lost.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { backupPathFor, sha256Hex, type Manifest } from "../src/lib/admin/image-backup.ts";
import {
  CATALOG_BUCKET,
  classify,
  countByState,
  isConflict,
  planFor,
  verifyBackup,
  type Entry,
  type LocalObject,
} from "../src/lib/admin/image-sync.ts";
import { requireStaging } from "./lib/staging-guard.mts";

function heading(text: string): void {
  console.log(`\n${text}\n${"-".repeat(text.length)}`);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`\nMissing ${name}. Run through npm, which loads .env.staging.\n`);
    process.exit(1);
  }
  return value;
}

function fail(message: string): never {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

async function readIfPresent(file: string): Promise<Uint8Array | null> {
  try {
    return new Uint8Array(await readFile(file));
  } catch {
    return null;
  }
}

/** Reads back what was just written, so "uploaded" means "there and correct". */
async function objectBytes(client: SupabaseClient, path: string): Promise<Uint8Array | null> {
  const { data, error } = await client.storage.from(CATALOG_BUCKET).download(path);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const directory = args.find((arg) => !arg.startsWith("--"));
  if (!directory) {
    console.error("\nUsage: npm run images:sync:staging -- <backup-directory> [--apply]\n");
    process.exit(1);
  }

  heading("1. Backup");
  console.log(`  ${directory}`);
  const manifestRaw = await readIfPresent(join(directory, "manifest.json"));
  if (manifestRaw === null) fail(`no manifest.json in ${directory}`);

  let manifest: Manifest;
  try {
    manifest = JSON.parse(new TextDecoder().decode(manifestRaw)) as Manifest;
  } catch (error) {
    fail(`manifest.json is not valid JSON: ${error instanceof Error ? error.message : error}`);
  }

  const local: LocalObject[] = [];
  for (const entry of manifest.objects ?? []) {
    local.push({
      entry,
      bytes: await readIfPresent(join(directory, backupPathFor(entry.image_override_path))),
    });
  }

  /*
   * `complete: true` is a claim the export made at the time. Files can be
   * edited, truncated or half-copied afterwards, so every one of them is
   * re-hashed here before the target is contacted at all.
   */
  const problems = verifyBackup(manifest, local);
  if (problems.length > 0) {
    console.error(`\n  The backup did not verify — ${problems.length} problem(s):`);
    for (const problem of problems) console.error(`    - ${problem}`);
    fail("Nothing was contacted and nothing was written.");
  }
  console.log(`  verified: ${manifest.object_count} objects, taken ${manifest.created_at}`);

  heading("2. Target");
  // Before the client exists, and before a single byte moves.
  requireStaging("images:sync:staging");
  const client = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  heading("3. Current state");
  const skyIds = manifest.objects.map((object) => object.sky_id);
  const { data: rows, error } = await client
    .from("skylanders")
    .select("sky_id, image_override_path")
    .in("sky_id", skyIds);
  if (error) throw new Error(`read skylanders: ${error.message}`);

  const current = new Map((rows ?? []).map((row) => [row.sky_id as string, row]));
  const entries: Entry[] = [];
  for (const object of manifest.objects) {
    const row = current.get(object.sky_id);
    entries.push(
      classify(object, {
        exists: row !== undefined,
        overridePath: (row?.image_override_path as string | null) ?? null,
        objectBytes: await objectBytes(client, object.image_override_path),
      }),
    );
  }

  const counts = countByState(entries);
  for (const [state, count] of Object.entries(counts)) console.log(`  ${state.padEnd(20)} ${count}`);

  const conflicts = entries.filter((entry) => isConflict(entry.state));
  if (conflicts.length > 0) {
    console.log("\n  Conflicts — not changed automatically:");
    for (const entry of conflicts) {
      console.log(`    ${entry.entry.sky_id}  ${entry.state}  ${entry.detail ?? ""}`);
    }
  }

  heading("4. Plan");
  const plan = planFor(entries);
  if (plan.length === 0) {
    console.log("  Nothing to do.");
  }
  for (const action of plan) {
    console.log(`  ${action.skyId}  ${action.steps.join(" + ")}  ${action.storagePath}`);
  }

  if (!apply) {
    heading("Result");
    console.log("  DRY RUN - nothing was uploaded and nothing was written.");
    if (conflicts.length > 0) {
      console.log(`  ${conflicts.length} conflict(s) need a decision before --apply.`);
    }
    console.log("  Re-run with --apply to perform the plan.\n");
    return;
  }

  if (conflicts.length > 0) {
    fail(
      `${conflicts.length} conflict(s) are unresolved. Review them first; ` +
        "--apply changes only READY and OBJECT_MISSING entries.",
    );
  }

  heading("5. Apply");
  const bytesOf = new Map(local.map((object) => [object.entry.image_override_path, object.bytes!]));
  let uploaded = 0;
  let pointed = 0;
  const failures: string[] = [];

  for (const action of plan) {
    const bytes = bytesOf.get(action.storagePath)!;
    const extension = action.storagePath.split(".").pop();
    const contentType =
      extension === "png" ? "image/png" : extension === "jpg" ? "image/jpeg" : "image/webp";

    /*
     * `upsert: false`. The classification already proved this path is either
     * absent or holds exactly these bytes; refusing to overwrite is the belt
     * to that brace, and it is what keeps a race from destroying a picture.
     */
    const upload = await client.storage
      .from(CATALOG_BUCKET)
      .upload(action.storagePath, bytes, { contentType, upsert: false });

    /*
     * READ BACK BEFORE BELIEVING IT. A successful upload call is a claim; the
     * object is only there once it comes back with the right bytes.
     *
     * An error is not automatically a failure either: a rerun of a run that
     * stopped between the upload and the RPC finds the object already present,
     * and `upsert: false` reports that as a collision. The hash decides which
     * of the two happened.
     */
    const readBack = await objectBytes(client, action.storagePath);
    if (readBack === null || sha256Hex(readBack) !== sha256Hex(bytes)) {
      const why = upload.error ? upload.error.message : "bytes do not match";
      failures.push(`${action.skyId}: ${action.storagePath} did not verify (${why})`);
      console.log(`  ✗ ${action.skyId}  ${why}`);
      continue;
    }
    uploaded += 1;

    if (!action.steps.includes("SET_OVERRIDE")) {
      console.log(`  ✓ ${action.skyId}  repaired object only`);
      continue;
    }

    /*
     * The system path (0035), not `admin_set_image_override()`: that one asks
     * `is_shop_admin()`, and a service-role tool has no `auth.uid()` to answer
     * with. Both validate that the path belongs to the figure, and both journal
     * through the same trigger.
     */
    const { error: rpcError } = await client.rpc("system_set_image_override", {
      p_sky_id: action.skyId,
      p_path: action.storagePath,
    });
    if (rpcError) {
      // The object stays. It is exactly the verified backup byte-for-byte, and
      // a rerun sees READY again and finishes the job.
      failures.push(`${action.skyId}: object uploaded, override not set (${rpcError.message})`);
      console.log(`  ! ${action.skyId}  uploaded, RPC failed — object left in place`);
      continue;
    }
    pointed += 1;
    console.log(`  ✓ ${action.skyId}  ${action.storagePath}`);
  }

  heading("Result");
  console.log(`  objects uploaded/present: ${uploaded}`);
  console.log(`  overrides set:            ${pointed}`);
  if (failures.length > 0) {
    console.error(`\n  ${failures.length} problem(s):`);
    for (const failure of failures) console.error(`    - ${failure}`);
    console.error("\n  Nothing was deleted. Re-run to continue where this stopped.\n");
    process.exit(1);
  }
  console.log("\n  Done. Re-run without --apply to confirm ALREADY_SYNCED.\n");
}

main().catch((error: unknown) => {
  console.error(`\nSync aborted: ${error instanceof Error ? error.message : error}`);
  console.error("Nothing was deleted.\n");
  process.exit(1);
});
