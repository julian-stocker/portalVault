import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

import { MANIFEST_SCHEMA_VERSION, sha256Hex, type Manifest, type ManifestObject } from "./image-backup.ts";
import {
  AUTOMATIC,
  CONFLICTS,
  classify,
  countByState,
  isConflict,
  planFor,
  verifyBackup,
  type LocalObject,
} from "./image-sync.ts";

/**
 * Putting a verified backup into another environment, without trusting it.
 *
 * The backup already claimed to be complete once. These rules are the refusal
 * to take that at face value, plus the question the tool asks about every
 * figure before it moves a byte: does the target need this, already have it,
 * or disagree about it?
 *
 * Nothing here touches a network or a database. The fakes below stand in for
 * both, which is the point.
 */
const bytesOf = (text: string) => new TextEncoder().encode(text);

function pathFor(skyId: string, bytes: Uint8Array, extension = "webp"): string {
  return `${skyId}/${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}.${extension}`;
}

const PICTURE = bytesOf("the real picture");
const OTHER = bytesOf("some other picture");

function object(over: Partial<ManifestObject> = {}): ManifestObject {
  const path = pathFor("SKY-0009", PICTURE);
  return {
    sky_id: "SKY-0009",
    name: "Drobot",
    image_file: null,
    image_override_path: path,
    source: "import",
    updated_at: null,
    storage_path: path,
    extension: "webp",
    byte_size: PICTURE.length,
    sha256: sha256Hex(PICTURE),
    ...over,
  };
}

function manifest(objects: ManifestObject[], over: Partial<Manifest> = {}): Manifest {
  return {
    schema_version: MANIFEST_SCHEMA_VERSION,
    environment: "production",
    created_at: "2026-09-16T13:06:58.602Z",
    project_ref: "abcdefgh",
    bucket: "catalog",
    figure_count: objects.length,
    object_count: objects.length,
    complete: true,
    objects,
    orphans: [],
    problems: [],
    ...over,
  };
}

const onDisk = (objects: ManifestObject[], bytes: Uint8Array | null = PICTURE): LocalObject[] =>
  objects.map((entry) => ({ entry, bytes }));

describe("the backup is re-verified, never trusted", () => {
  it("accepts a complete backup whose files still hash correctly", () => {
    const objects = [object()];
    expect(verifyBackup(manifest(objects), onDisk(objects))).toEqual([]);
  });

  it("rejects complete=false outright", () => {
    const objects = [object()];
    const problems = verifyBackup(manifest(objects, { complete: false }), onDisk(objects));
    expect(problems.some((p) => p.includes("this directory is not a backup"))).toBe(true);
  });

  it("rejects a manifest from the wrong environment", () => {
    const objects = [object()];
    const problems = verifyBackup(
      manifest(objects, { environment: "staging" as unknown as "production" }),
      onDisk(objects),
    );
    expect(problems.some((p) => p.includes("not production"))).toBe(true);
  });

  it("rejects an unsupported schema, and says nothing else", () => {
    // Every later rule reads fields whose meaning the version defines.
    const objects = [object()];
    const problems = verifyBackup(manifest(objects, { schema_version: 99 }), onDisk(objects));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("schema 99 is not supported");
  });

  it("rejects the wrong bucket", () => {
    const objects = [object()];
    const problems = verifyBackup(manifest(objects, { bucket: "public" }), onDisk(objects));
    expect(problems.some((p) => p.includes("not catalog"))).toBe(true);
  });

  it("rejects a missing local file", () => {
    const objects = [object()];
    const problems = verifyBackup(manifest(objects), onDisk(objects, null));
    expect(problems.some((p) => p.includes("missing from the backup directory"))).toBe(true);
  });

  it("rejects an empty local file", () => {
    const objects = [object()];
    const problems = verifyBackup(manifest(objects), onDisk(objects, new Uint8Array(0)));
    expect(problems.some((p) => p.includes("is empty on disk"))).toBe(true);
  });

  it("rejects a corrupted local file — the check that matters", () => {
    // Bytes edited since the export. The manifest still says complete.
    const objects = [object()];
    const problems = verifyBackup(manifest(objects), onDisk(objects, OTHER));
    expect(problems.some((p) => p.includes("hashes to"))).toBe(true);
  });

  it("rejects a size that disagrees with the manifest", () => {
    const objects = [object({ byte_size: 1 })];
    const problems = verifyBackup(manifest(objects), onDisk(objects));
    expect(problems.some((p) => p.includes("the manifest says 1"))).toBe(true);
  });

  it("rejects a duplicate SKY-ID", () => {
    const objects = [object(), object()];
    const problems = verifyBackup(manifest(objects), onDisk(objects));
    expect(problems.some((p) => p.includes("appears twice in the manifest"))).toBe(true);
  });

  it("rejects a duplicate storage path", () => {
    const shared = pathFor("SKY-0009", PICTURE);
    const objects = [object(), object({ sky_id: "SKY-0010" })];
    objects[1].image_override_path = shared;
    objects[1].storage_path = shared;
    const problems = verifyBackup(manifest(objects), onDisk(objects));
    expect(problems.length).toBeGreaterThan(0);
  });

  it("rejects a path that belongs to another figure", () => {
    const objects = [object({ sky_id: "SKY-0010" })];
    const problems = verifyBackup(manifest(objects), onDisk(objects));
    expect(problems.some((p) => p.includes("not a valid override path"))).toBe(true);
  });

  it("rejects a manifest that covers fewer figures than it claims", () => {
    const objects = [object()];
    const problems = verifyBackup(manifest(objects, { figure_count: 36 }), onDisk(objects));
    expect(problems.some((p) => p.includes("covers 1 of 36 figures"))).toBe(true);
  });

  it("ALLOWS the same picture under two SKY-IDs", () => {
    /*
     * Production holds such a pair. Two paths, one hash — a collision only if
     * something compares hashes instead of paths.
     */
    const a = object({ sky_id: "SKY-0082", image_override_path: pathFor("SKY-0082", PICTURE), storage_path: pathFor("SKY-0082", PICTURE) });
    const b = object({ sky_id: "SKY-0280", image_override_path: pathFor("SKY-0280", PICTURE), storage_path: pathFor("SKY-0280", PICTURE) });
    expect(a.image_override_path.split("/")[1]).toBe(b.image_override_path.split("/")[1]);
    expect(verifyBackup(manifest([a, b]), onDisk([a, b]))).toEqual([]);
  });
});

describe("what the target needs, per figure", () => {
  const entry = object();
  const wanted = entry.image_override_path;

  it("READY — the figure is there and points nowhere", () => {
    expect(classify(entry, { exists: true, overridePath: null, objectBytes: null }).state).toBe("READY");
  });

  it("ALREADY_SYNCED — the row points here and the object matches", () => {
    expect(
      classify(entry, { exists: true, overridePath: wanted, objectBytes: PICTURE }).state,
    ).toBe("ALREADY_SYNCED");
  });

  it("DIFFERENT_OVERRIDE — the figure points somewhere else", () => {
    const result = classify(entry, {
      exists: true,
      overridePath: "SKY-0009/ffffffffffffffff.webp",
      objectBytes: null,
    });
    expect(result.state).toBe("DIFFERENT_OVERRIDE");
    expect(result.detail).toContain("points at");
  });

  it("MISSING_FIGURE — there is no such row", () => {
    expect(classify(entry, { exists: false }).state).toBe("MISSING_FIGURE");
  });

  it("OBJECT_MISSING — the row is right, the picture is gone", () => {
    expect(
      classify(entry, { exists: true, overridePath: wanted, objectBytes: null }).state,
    ).toBe("OBJECT_MISSING");
  });

  it("OBJECT_DIFFERENT — the path is taken by other bytes", () => {
    const result = classify(entry, { exists: true, overridePath: null, objectBytes: OTHER });
    expect(result.state).toBe("OBJECT_DIFFERENT");
    expect(result.detail).toContain("holds other bytes");
  });

  it("treats a foreign object at the path as a conflict even when the row is free", () => {
    // Uploading would destroy somebody's picture. Never automatic.
    const result = classify(entry, { exists: true, overridePath: null, objectBytes: OTHER });
    expect(isConflict(result.state)).toBe(true);
  });
});

describe("the plan", () => {
  it("uploads and points for READY", () => {
    const entries = [classify(object(), { exists: true, overridePath: null, objectBytes: null })];
    expect(planFor(entries)).toEqual([
      { skyId: "SKY-0009", storagePath: object().image_override_path, steps: ["UPLOAD", "SET_OVERRIDE"] },
    ]);
  });

  it("uploads only for OBJECT_MISSING — the row is already right", () => {
    const entry = object();
    const entries = [
      classify(entry, { exists: true, overridePath: entry.image_override_path, objectBytes: null }),
    ];
    expect(planFor(entries)[0].steps).toEqual(["UPLOAD"]);
  });

  it("plans nothing for ALREADY_SYNCED — a rerun is a no-op", () => {
    const entry = object();
    const entries = [
      classify(entry, { exists: true, overridePath: entry.image_override_path, objectBytes: PICTURE }),
    ];
    expect(planFor(entries)).toEqual([]);
    expect(countByState(entries).ALREADY_SYNCED).toBe(1);
  });

  it("plans nothing for any conflict", () => {
    const entry = object();
    const entries = [
      classify(entry, { exists: false }),
      classify(entry, { exists: true, overridePath: "SKY-0009/ffffffffffffffff.webp" }),
      classify(entry, { exists: true, overridePath: null, objectBytes: OTHER }),
    ];
    expect(planFor(entries)).toEqual([]);
  });

  it("names exactly which states may change automatically", () => {
    expect([...AUTOMATIC]).toEqual(["READY", "OBJECT_MISSING"]);
    expect([...CONFLICTS]).toEqual(["DIFFERENT_OVERRIDE", "MISSING_FIGURE", "OBJECT_DIFFERENT"]);
  });
});

describe("the sync tool", () => {
  const tool = readFileSync("tools/sync-image-overrides.mts", "utf8");
  const code = tool.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("never deletes anything", () => {
    for (const forbidden of [".remove(", ".delete(", ".move(", "truncate"]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it("never contacts production", () => {
    expect(code).not.toContain("requireProduction");
    expect(code).not.toContain(".env.local");
    expect(code).not.toContain("export-image-overrides");
  });

  it("verifies the backup before it builds a client", () => {
    expect(code.indexOf("verifyBackup(")).toBeLessThan(code.indexOf("createClient("));
  });

  it("confirms staging before it builds a client", () => {
    expect(code.indexOf('requireStaging("images:sync:staging")')).toBeLessThan(
      code.indexOf("createClient("),
    );
  });

  it("is a dry run unless --apply is passed", () => {
    expect(code).toContain('const apply = args.includes("--apply")');
    expect(code).toContain("if (!apply) {");
    expect(code).toContain("DRY RUN - nothing was uploaded and nothing was written.");
    // The dry run returns before the apply section exists.
    expect(code.indexOf("if (!apply) {")).toBeLessThan(code.indexOf(".upload("));
  });

  it("refuses --apply while conflicts are unresolved", () => {
    const applyBlock = code.slice(code.indexOf("if (!apply) {"));
    expect(applyBlock.indexOf("conflicts.length > 0")).toBeLessThan(applyBlock.indexOf(".upload("));
  });

  it("uploads, reads back, and only then writes the row", () => {
    const loop = code.slice(code.indexOf("for (const action of plan)"));
    expect(loop.indexOf(".upload(")).toBeLessThan(loop.indexOf("objectBytes(client"));
    expect(loop.indexOf("objectBytes(client")).toBeLessThan(loop.indexOf(".rpc("));
  });

  it("skips the row when the object did not verify", () => {
    const loop = code.slice(code.indexOf("for (const action of plan)"));
    const guard = loop.indexOf("did not verify");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(loop.indexOf(".rpc("));
    expect(loop).toContain("continue;");
  });

  it("never overwrites an existing object", () => {
    expect(code).toContain("upsert: false");
    expect(code).not.toContain("upsert: true");
  });

  it("leaves an uploaded object in place when the row write fails", () => {
    expect(code).toContain("uploaded, RPC failed — object left in place");
  });

  it("writes the row through the system function, not a direct update", () => {
    /*
     * `admin_set_image_override()` asks `is_shop_admin()`, and a service-role
     * tool has no `auth.uid()` to answer with. 0035 is the service-role path,
     * and it repeats the same path-belongs-to-figure check.
     */
    expect(code).toContain('client.rpc("system_set_image_override"');
    expect(code).not.toMatch(/from\("skylanders"\)[\s\S]{0,80}\.update\(/);
  });

  it("touches no column but the override", () => {
    // Column names, not words: `name` alone appears in type annotations.
    for (const column of ["image_file", "card_type", "catalog_visible", "character_id"]) {
      expect(code, column).not.toContain(column);
    }
    // The only columns it names at all are the two it reads.
    expect(code).toContain('.select("sky_id, image_override_path")');
  });

  it("resolves without the @/ alias, because bare Node runs it", () => {
    expect(code).not.toContain('from "@/');
    expect(code).toContain('from "../src/lib/admin/image-sync.ts"');
  });
});

describe("migration 0035 opens the service-role path only", () => {
  /*
   * Comments AND the `comment on` text stripped: both explain at length which
   * columns the function does not touch, and an explanation must not satisfy
   * the test that checks it.
   */
  const sql = readFileSync("supabase/migrations/0035_system_set_image_override.sql", "utf8")
    .replace(/^\s*--.*$/gm, "")
    // Up to the quote that closes the literal: the text itself contains a
    // semicolon, so stopping at the first one leaves half the sentence behind.
    .replace(/comment on function[\s\S]*?';/g, "");

  it("grants execute to service_role and nobody else", () => {
    expect(sql).toContain(
      "revoke all on function public.system_set_image_override(text, text)\n  from public, anon, authenticated",
    );
    expect(sql).toContain("to service_role");
    expect(sql).not.toContain("to authenticated");
  });

  it("keeps the path-belongs-to-figure check", () => {
    expect(sql).toContain("split_part(v_clean, '/', 1) <> p_sky_id");
  });

  it("touches only image_override_path", () => {
    expect(sql).toContain("update public.skylanders set image_override_path = v_clean");
    for (const column of ["image_file", "card_type", "catalog_visible", "character_id"]) {
      expect(sql, column).not.toContain(column);
    }
  });

  it("leaves the admin path alone", () => {
    expect(sql).not.toContain("create or replace function public.admin_set_image_override");
  });

  it("runs with an empty search path", () => {
    expect(sql).toContain("set search_path = ''");
  });
});
