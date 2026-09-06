import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

import { hasImageOverride, imageSrc, isOverridePath, storageUrl } from "@/lib/catalog/image";

/**
 * One picture, three possible sources (ADR-0046).
 *
 * The order is the whole design: an upload wins, the imported file is the
 * fallback, and nothing is a real answer. What makes "remove my image" safe
 * is that the second source is never overwritten by the first.
 */
const SUPABASE = "https://example.supabase.co";

afterEach(() => {
  vi.unstubAllEnvs();
});

function withProject() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE);
}

describe("which picture wins", () => {
  it("prefers the administrator's upload", () => {
    withProject();
    expect(imageSrc({ imageFile: "aaaaaaaaaaaaaaaa.webp", imageOverridePath: "SKY-0007/bbbbbbbbbbbbbbbb.webp" }))
      .toBe(`${SUPABASE}/storage/v1/object/public/catalog/SKY-0007/bbbbbbbbbbbbbbbb.webp`);
  });

  it("falls back to the imported file", () => {
    withProject();
    expect(imageSrc({ imageFile: "aaaaaaaaaaaaaaaa.webp", imageOverridePath: null }))
      .toBe("/images/skylanders/aaaaaaaaaaaaaaaa.webp");
  });

  it("answers null when there is neither", () => {
    // 27 collectibles genuinely have no picture. The empty plate is a design
    // state, not an error (ADR-0009).
    withProject();
    expect(imageSrc({ imageFile: null, imageOverridePath: null })).toBeNull();
  });

  it("treats a missing override as absent, not as empty", () => {
    withProject();
    expect(imageSrc({ imageFile: "aaaaaaaaaaaaaaaa.webp" })).toBe(
      "/images/skylanders/aaaaaaaaaaaaaaaa.webp",
    );
  });

  it("says which one it is", () => {
    expect(
      hasImageOverride({ imageFile: null, imageOverridePath: "SKY-0007/bbbbbbbbbbbbbbbb.webp" }),
    ).toBe(true);
    expect(hasImageOverride({ imageFile: "a.webp", imageOverridePath: null })).toBe(false);
  });
});

describe("without a configured project", () => {
  it("does not build a broken URL", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    expect(storageUrl("SKY-0007/bbbbbbbbbbbbbbbb.webp")).toBeNull();
    // And falls through to the imported file rather than showing nothing.
    expect(imageSrc({ imageFile: "aaaaaaaaaaaaaaaa.webp", imageOverridePath: "SKY-0007/bbbbbbbbbbbbbbbb.webp" }))
      .toBe("/images/skylanders/aaaaaaaaaaaaaaaa.webp");
  });

  it("does not double a trailing slash", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", `${SUPABASE}/`);
    expect(storageUrl("SKY-0007/bbbbbbbbbbbbbbbb.webp")).toBe(
      `${SUPABASE}/storage/v1/object/public/catalog/SKY-0007/bbbbbbbbbbbbbbbb.webp`,
    );
  });
});

describe("which paths we recognise as ours", () => {
  it("accepts a content-addressed path under the figure's own SKY-ID", () => {
    expect(isOverridePath("SKY-0007/0123456789abcdef.webp", "SKY-0007")).toBe(true);
    expect(isOverridePath("SKY-0007/0123456789abcdef.png", "SKY-0007")).toBe(true);
    expect(isOverridePath("SKY-0007/0123456789abcdef.jpg", "SKY-0007")).toBe(true);
  });

  it("refuses another figure's file", () => {
    // The guard that stops a delete or an override from reaching across.
    expect(isOverridePath("SKY-0008/0123456789abcdef.webp", "SKY-0007")).toBe(false);
  });

  it("refuses anything that is not one of ours", () => {
    for (const path of [
      "../secrets.env",
      "SKY-0007/../../other.webp",
      "SKY-0007/evil.svg",
      "SKY-0007/0123456789abcdef.exe",
      "/SKY-0007/0123456789abcdef.webp",
      "SKY-7/0123456789abcdef.webp",
    ]) {
      expect(isOverridePath(path, "SKY-0007")).toBe(false);
    }
  });

  it("matches the CHECK in the database", () => {
    // Two statements of one rule; they have to agree or a valid upload is
    // rejected by the row it is about to be written to.
    const migration = readFileSync("supabase/migrations/0007_shop_pricing_and_images.sql", "utf8");
    expect(migration).toContain("image_override_path ~ '^SKY-[0-9]{4}/[0-9a-f]{16}\\.(webp|png|jpg)$'");
  });
});

describe("every surface resolves the same way", () => {
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

  it("builds the static path in exactly one place", () => {
    // Three components used to do this by hand. Adding a second source would
    // have had to be remembered three times.
    for (const file of [
      "src/components/catalog/figure-image.tsx",
      "src/components/collection/collection-table.tsx",
      "src/components/admin/admin-thumb.tsx",
      "src/components/cart/cart-view.tsx",
    ]) {
      expect(code(file)).not.toContain("/images/skylanders/");
    }
    expect(code("src/lib/catalog/image.ts")).toContain('"/images/skylanders/"');
  });

  it("has every image surface take a resolved src", () => {
    for (const file of [
      "src/components/catalog/figure-image.tsx",
      "src/components/admin/admin-thumb.tsx",
    ]) {
      expect(code(file)).toContain("src: string | null");
    }
  });
});
