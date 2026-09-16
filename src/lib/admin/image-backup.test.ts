import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

import {
  MANIFEST_SCHEMA_VERSION,
  backupPathFor,
  buildManifest,
  extensionOf,
  hashInPath,
  orphanPathFor,
  setProblems,
  sha256Hex,
  verifyObject,
  type ManifestObject,
  type OverrideRow,
} from "./image-backup.ts";
import { imagePathFor } from "./image-file.ts";

/**
 * A backup nobody verified is a folder that will be trusted for no reason.
 *
 * These are the rules that decide whether an export may call itself complete.
 * None of them touches a database or a network: the tool does the talking and
 * hands the answers to the pure functions below, which is what lets the rules
 * be exercised with fakes instead of against a real project.
 */
const bytesOf = (text: string) => new TextEncoder().encode(text);

/** A path that genuinely addresses these bytes, the way storage does. */
function realPath(skyId: string, bytes: Uint8Array, extension = "webp"): string {
  return `${skyId}/${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}.${extension}`;
}

function row(over: Partial<OverrideRow> = {}): OverrideRow {
  const bytes = bytesOf("a picture");
  return {
    sky_id: "SKY-0009",
    name: "Drobot",
    image_file: "0123456789abcdef.webp",
    image_override_path: realPath("SKY-0009", bytes),
    source: "import",
    updated_at: "2026-09-16T08:00:00.000Z",
    ...over,
  };
}

function manifestObject(over: Partial<ManifestObject> = {}): ManifestObject {
  const bytes = bytesOf("a picture");
  const path = realPath("SKY-0009", bytes);
  return {
    sky_id: "SKY-0009",
    name: "Drobot",
    image_file: null,
    image_override_path: path,
    source: "import",
    updated_at: null,
    storage_path: path,
    extension: "webp",
    byte_size: bytes.length,
    sha256: sha256Hex(bytes),
    ...over,
  };
}

describe("the hash is the claim a path makes", () => {
  it("computes the same digest the upload path does", () => {
    /*
     * `imagePathFor()` is what wrote these objects. If the two ever disagreed,
     * every verification below would be checking the wrong thing.
     */
    const bytes = bytesOf("some bytes");
    const path = imagePathFor("SKY-0009", bytes, { extension: "webp", mime: "image/webp" });
    expect(path).toBe(`SKY-0009/${sha256Hex(bytes).slice(0, 16)}.webp`);
  });

  it("reads the hash back out of a path", () => {
    expect(hashInPath("SKY-0009/c29021891080cd90.jpg")).toBe("c29021891080cd90");
    expect(extensionOf("SKY-0009/c29021891080cd90.jpg")).toBe("jpg");
  });

  it("refuses to read one out of a path that is not ours", () => {
    for (const bad of [
      "SKY-0009/short.jpg",
      "SKY-0009/C29021891080CD90.jpg",
      "SKY-9/c29021891080cd90.jpg",
      "c29021891080cd90.jpg",
      "SKY-0009/c29021891080cd90.gif",
    ]) {
      expect(hashInPath(bad), bad).toBeNull();
    }
  });
});

describe("one object at a time", () => {
  it("accepts bytes that match the path they came from", () => {
    const bytes = bytesOf("a picture");
    expect(verifyObject({ row: row(), bytes })).toEqual([]);
  });

  it("rejects a hash mismatch — the check that matters", () => {
    // The path claims one thing, the bytes are another. Either the object was
    // overwritten under a fixed name or the wrong file came back.
    const problems = verifyObject({ row: row(), bytes: bytesOf("different bytes") });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("contains bytes whose sha256 starts");
  });

  it("rejects a zero-byte object", () => {
    const problems = verifyObject({ row: row(), bytes: new Uint8Array(0) });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("is empty");
  });

  it("rejects a malformed override path", () => {
    const problems = verifyObject({
      row: row({ image_override_path: "SKY-0009/nope.gif" }),
      bytes: bytesOf("a picture"),
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("is not a valid override path");
  });

  it("rejects a path belonging to another figure", () => {
    // `isOverridePath()` already enforces this for the database; a backup must
    // not quietly accept what the application would refuse.
    const bytes = bytesOf("a picture");
    const problems = verifyObject({
      row: row({ sky_id: "SKY-0010", image_override_path: realPath("SKY-0009", bytes) }),
      bytes,
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("is not a valid override path");
  });
});

describe("rules about the set", () => {
  it("fails when fewer objects were written than the database reported", () => {
    const problems = setProblems([manifestObject()], 36);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("reported 36 figures");
  });

  it("fails on a duplicate figure", () => {
    const problems = setProblems([manifestObject(), manifestObject()], 2);
    expect(problems.some((p) => p.includes("SKY-0009 appears twice"))).toBe(true);
  });

  it("fails on a duplicate storage path", () => {
    const shared = realPath("SKY-0082", bytesOf("shared"));
    const problems = setProblems(
      [
        manifestObject({ sky_id: "SKY-0082", image_override_path: shared, storage_path: shared }),
        manifestObject({ sky_id: "SKY-0083", image_override_path: shared, storage_path: shared }),
      ],
      2,
    );
    expect(problems.some((p) => p.includes("appears twice"))).toBe(true);
  });

  it("ALLOWS the same picture under two different figures", () => {
    /*
     * Production holds exactly this today — `SKY-0082/f6bd960ece6605ee.jpg`
     * and `SKY-0280/f6bd960ece6605ee.jpg`. Same bytes, same hash, two paths,
     * two figures. Treating that as a collision would drop one of them.
     */
    const bytes = bytesOf("one picture, two figures");
    const a = realPath("SKY-0082", bytes, "jpg");
    const b = realPath("SKY-0280", bytes, "jpg");
    expect(a.split("/")[1]).toBe(b.split("/")[1]);

    const problems = setProblems(
      [
        manifestObject({ sky_id: "SKY-0082", image_override_path: a, storage_path: a, sha256: sha256Hex(bytes) }),
        manifestObject({ sky_id: "SKY-0280", image_override_path: b, storage_path: b, sha256: sha256Hex(bytes) }),
      ],
      2,
    );
    expect(problems).toEqual([]);
  });

  it("keeps the two apart in the backup directory", () => {
    const bytes = bytesOf("one picture, two figures");
    expect(backupPathFor(realPath("SKY-0082", bytes, "jpg"))).not.toBe(
      backupPathFor(realPath("SKY-0280", bytes, "jpg")),
    );
    // And never flattened by hash, which would collapse them into one file.
    expect(backupPathFor("SKY-0082/f6bd960ece6605ee.jpg")).toBe(
      "objects/SKY-0082/f6bd960ece6605ee.jpg",
    );
  });
});

describe("the manifest", () => {
  const base = {
    createdAt: "2026-09-16T10:00:00.000Z",
    projectRef: "abcdefgh",
    bucket: "catalog",
    orphans: [],
    problems: [],
  };

  it("is complete only when nothing went wrong", () => {
    const manifest = buildManifest({ ...base, figureCount: 1, objects: [manifestObject()] });
    expect(manifest.complete).toBe(true);
    expect(manifest.problems).toEqual([]);
    expect(manifest.object_count).toBe(1);
    expect(manifest.schema_version).toBe(MANIFEST_SCHEMA_VERSION);
  });

  it("is never complete when an object is missing", () => {
    const manifest = buildManifest({ ...base, figureCount: 36, objects: [manifestObject()] });
    expect(manifest.complete).toBe(false);
    expect(manifest.problems.length).toBeGreaterThan(0);
  });

  it("is never complete when the caller already knows something failed", () => {
    // A download that errored never becomes an object, so the count would also
    // catch it — but the reason has to survive into the file.
    const manifest = buildManifest({
      ...base,
      figureCount: 1,
      objects: [manifestObject()],
      problems: ["SKY-0010: could not be downloaded (404)"],
    });
    expect(manifest.complete).toBe(false);
    expect(manifest.problems[0]).toContain("could not be downloaded");
  });

  it("sorts deterministically by SKY-ID", () => {
    const manifest = buildManifest({
      ...base,
      figureCount: 3,
      objects: [
        manifestObject({ sky_id: "SKY-0280" }),
        manifestObject({ sky_id: "SKY-0009" }),
        manifestObject({ sky_id: "SKY-0082" }),
      ],
    });
    expect(manifest.objects.map((o) => o.sky_id)).toEqual(["SKY-0009", "SKY-0082", "SKY-0280"]);
  });

  it("produces the same bytes twice for the same input", () => {
    const input = {
      ...base,
      figureCount: 2,
      objects: [manifestObject({ sky_id: "SKY-0280" }), manifestObject({ sky_id: "SKY-0009" })],
    };
    expect(JSON.stringify(buildManifest(input))).toBe(JSON.stringify(buildManifest(input)));
  });

  it("keeps orphans out of the active set", () => {
    const manifest = buildManifest({
      ...base,
      figureCount: 1,
      objects: [manifestObject()],
      orphans: [{ storage_path: "SKY-0009/deadbeefdeadbeef.webp", byte_size: 9, sha256: "x" }],
    });
    expect(manifest.object_count).toBe(1);
    expect(manifest.orphans).toHaveLength(1);
    expect(manifest.complete).toBe(true);
    expect(orphanPathFor("SKY-0009/deadbeefdeadbeef.webp")).toBe(
      "orphans/SKY-0009/deadbeefdeadbeef.webp",
    );
  });

  it("carries nothing anybody could authenticate with", () => {
    const manifest = buildManifest({ ...base, figureCount: 1, objects: [manifestObject()] });
    const text = JSON.stringify(manifest);
    for (const secret of ["eyJ", "service_role", "SUPABASE_SERVICE", "token", "password", "http"]) {
      expect(text.toLowerCase(), secret).not.toContain(secret.toLowerCase());
    }
    // The project reference, never the URL it came from.
    expect(manifest.project_ref).toBe("abcdefgh");
  });
});

describe("the export tool only reads", () => {
  const tool = readFileSync("tools/export-image-overrides.mts", "utf8");
  /** Without the prose, which discusses the very calls it must not make. */
  const code = tool.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("calls no mutating database or storage method", () => {
    for (const forbidden of [
      ".insert(",
      ".update(",
      ".delete(",
      ".upsert(",
      ".rpc(",
      ".upload(",
      ".remove(",
      ".move(",
      ".copy(",
      "createSignedUrl",
    ]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it("uses only select, list and download", () => {
    expect(code).toContain(".select(");
    expect(code).toContain(".list(");
    expect(code).toContain(".download(");
  });

  it("confirms it is production before it builds a client", () => {
    expect(code.indexOf("requireProduction(")).toBeLessThan(code.indexOf("createClient("));
  });

  it("writes only under the gitignored backup directory", () => {
    expect(code).toContain('const BACKUP_ROOT = ".backups/image-overrides/production"');
    expect(readFileSync(".gitignore", "utf8")).toContain("/.backups/");
    // Never into the shipped assets.
    expect(code).not.toContain("public/images");
  });

  it("gives every run its own directory", () => {
    expect(code).toContain("stamp(new Date())");
    expect(code).toContain("join(BACKUP_ROOT,");
  });

  it("exits non-zero when the backup is not complete", () => {
    expect(code).toContain("if (!manifest.complete)");
    expect(code).toContain("process.exit(1)");
    expect(code).toContain("Do not treat this directory as a backup.");
  });

  it("puts no credential in the manifest", () => {
    expect(code).toContain("projectRef: projectRef(url)");
    expect(code).not.toMatch(/manifest[\s\S]{0,200}SERVICE_ROLE/);
  });

  it("resolves without the @/ alias, because bare Node runs it", () => {
    expect(code).toContain('from "../src/lib/admin/image-backup.ts"');
    expect(code).not.toContain('from "@/');
  });
});
