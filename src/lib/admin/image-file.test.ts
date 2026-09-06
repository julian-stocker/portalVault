import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { imagePathFor, MAX_IMAGE_BYTES, sniffImage } from "@/lib/admin/image-file";

/**
 * What may be uploaded (ADR-0046).
 *
 * The type of a file is decided by its first bytes. `File.type` comes from
 * the browser and is whatever the client says it is — an HTML page announced
 * as `image/webp` would otherwise become an object in a public bucket.
 */
function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00);
const WEBP = bytes(
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50,
);

describe("what counts as an image", () => {
  it("recognises the three formats we accept", () => {
    expect(sniffImage(JPEG)).toEqual({ mime: "image/jpeg", extension: "jpg" });
    expect(sniffImage(PNG)).toEqual({ mime: "image/png", extension: "png" });
    expect(sniffImage(WEBP)).toEqual({ mime: "image/webp", extension: "webp" });
  });

  it("refuses anything else, whatever it claims to be", () => {
    // An SVG is an image and is also a script host; a PDF is neither.
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/>');
    const html = new TextEncoder().encode("<!doctype html><html>");
    const pdf = bytes(0x25, 0x50, 0x44, 0x46, 0x2d);
    const gif = bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61);

    for (const input of [svg, html, pdf, gif, bytes(), bytes(0x00)]) {
      expect(sniffImage(input)).toBeNull();
    }
  });

  it("is not fooled by a RIFF container that is not WebP", () => {
    // A WAV file is RIFF too. Only the form type at byte 8 settles it.
    const wav = bytes(
      0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
    );
    expect(sniffImage(wav)).toBeNull();
  });

  it("caps the size where the bucket does", () => {
    // Two ends of the same rule: the action checks, the bucket enforces.
    expect(MAX_IMAGE_BYTES).toBe(2 * 1024 * 1024);
    const migration = readFileSync("supabase/migrations/0007_shop_pricing_and_images.sql", "utf8");
    expect(migration).toContain(String(MAX_IMAGE_BYTES));
  });
});

describe("where an upload lands", () => {
  it("is content-addressed under the figure's own SKY-ID", () => {
    const path = imagePathFor("SKY-0007", WEBP, { mime: "image/webp", extension: "webp" });
    expect(path).toMatch(/^SKY-0007\/[0-9a-f]{16}\.webp$/);
  });

  it("gives different bytes a different path", () => {
    // The reason it is a hash: a replacement must not reuse a URL a browser
    // or a CDN may still be serving from cache.
    const kind = { mime: "image/webp", extension: "webp" } as const;
    const a = imagePathFor("SKY-0007", WEBP, kind);
    const b = imagePathFor("SKY-0007", bytes(...WEBP, 0x01), kind);
    expect(a).not.toBe(b);
  });

  it("gives identical bytes the same path", () => {
    const kind = { mime: "image/webp", extension: "webp" } as const;
    expect(imagePathFor("SKY-0007", WEBP, kind)).toBe(imagePathFor("SKY-0007", WEBP, kind));
  });

  it("keeps two figures apart even for the same picture", () => {
    const kind = { mime: "image/webp", extension: "webp" } as const;
    expect(imagePathFor("SKY-0007", WEBP, kind)).not.toBe(imagePathFor("SKY-0008", WEBP, kind));
  });
});

describe("how an upload is written", () => {
  /** The file without its comments — what it does, not what it says. */
  function code(path: string): string {
    return readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => {
        const trimmed = line.trimStart();
        return !trimmed.startsWith("*") && !trimmed.startsWith("//") && !trimmed.startsWith("/*");
      })
      .join("\n");
  }

  const actions = code("src/lib/admin/image-actions.ts");

  it("never uses a service-role key", () => {
    // The write is allowed by a storage policy whose predicate is
    // is_shop_admin(), not by a key that bypasses everything.
    expect(actions).not.toContain("SERVICE_ROLE");
    // The session client — cookies and the anon key — not a client built
    // from a key of its own.
    expect(actions).toContain('from "@/lib/supabase/server"');
    expect(actions).not.toContain("@supabase/supabase-js");
    expect(actions).not.toMatch(/createClient\([^)]/);
  });

  it("asks isAdmin() before anything else", () => {
    expect(actions).toContain("if (!(await isAdmin()))");
  });

  it("validates the SKY-ID rather than trusting the form", () => {
    expect(actions).toContain("const SKY_ID = /^SKY-[0-9]{4}$/;");
    expect(actions).toContain("if (!SKY_ID.test(skyId))");
  });

  it("decides the type from the bytes", () => {
    expect(actions).toContain("const kind = sniffImage(bytes);");
    // Never from what the browser announced.
    expect(actions).not.toContain("file.type");
  });

  it("deletes only the path the database says was in use", () => {
    // Never a path that came in from the browser.
    expect(actions).toContain("async function currentOverride(");
    expect(actions).toContain("isOverridePath(path, skyId)");
    expect(actions).toContain("if (previous && previous !== path) await removeObject(previous);");
  });

  it("uploads before it points, and points before it deletes", () => {
    const upload = actions.indexOf(".upload(");
    const point = actions.indexOf("await setImageOverride(skyId, path)");
    const remove = actions.indexOf("if (previous && previous !== path)");
    expect(upload).toBeLessThan(point);
    expect(point).toBeLessThan(remove);
  });

  it("never touches the imported file", () => {
    // image_file belongs to the catalog import; the override is a second
    // column so that clearing it brings the imported picture back.
    expect(actions).not.toContain("image_file");
    expect(code("src/lib/admin/actions.ts")).not.toContain("image_file");
  });
});

describe("the importer stays out of the override", () => {
  it("does not name the column", () => {
    const importer = readFileSync("tools/import-catalog.mts", "utf8");
    expect(importer).not.toContain("image_override_path");
  });
});
