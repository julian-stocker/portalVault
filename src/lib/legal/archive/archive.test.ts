/**
 * The archive of earlier legal texts (ADR-0184, AP5) cannot change by
 * accident.
 *
 * THE PINNED FINGERPRINT IS THE PROOF OF "UNCHANGED". On 2026-11-11 the
 * 2026-09-17 documents were rendered from the code of commit `9977fdd` —
 * `IMPRESSUM`, `AGB`, `WIDERRUF`, `WIDERRUFSFORMULAR`, `DATENSCHUTZ` with
 * `SELLER_IDENTITY` — and serialised. `CONTENT_SHA256` is the SHA-256 of that
 * serialisation, taken before the modules were rewritten; the archive must
 * still produce it. `FILE_SHA256` pins the file itself, comments included.
 *
 * A failure here is never fixed by updating the hash. An archived text that
 * needs correcting is a NEW current version.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { ARCHIVE_2026_09_17 } from "@/lib/legal/archive/2026-09-17";
import { ARCHIVED_SLUGS, LEGAL_ARCHIVE, archivePath, archivedDocument, archivedVersions } from "@/lib/legal/archive";

const CONTENT_SHA256 = "44910d5c291b07c622c7c8c0fd5dcdbee2a13feee60745f4d24bda60b97c38af";
const FILE_SHA256 = "1a20cfb531c8a889e4bcf753c506d6e3b35a8d13551fefe61507e518cdf873fc";

const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

describe("the 2026-09-17 archive", () => {
  it("is byte for byte the text rendered from the code before AP5", () => {
    expect(sha256(JSON.stringify(ARCHIVE_2026_09_17))).toBe(CONTENT_SHA256);
  });

  it("the file itself is unchanged", () => {
    expect(sha256(readFileSync("src/lib/legal/archive/2026-09-17.ts"))).toBe(FILE_SHA256);
  });

  it("keeps the seller identity of that time — history, not an active identity", () => {
    const text = JSON.stringify(ARCHIVE_2026_09_17);
    expect(text).toContain("Julian Stocker, handelnd unter yulez.collectibles");
    expect(text).toContain("info@skyisles.de");
    expect(ARCHIVE_2026_09_17.widerrufsformular.recipient).toContain("yulez.collectibles");
  });

  it("every archived document carries its own version id", () => {
    for (const slug of ARCHIVED_SLUGS) expect(ARCHIVE_2026_09_17[slug].version, slug).toBe("2026-09-17");
  });

  it("claims no publication date or period of validity of its own", () => {
    const source = readFileSync("src/lib/legal/archive/2026-09-17.ts", "utf8");
    const header = source.slice(0, source.indexOf("export const"));
    expect(header).toContain("No publication date and no period of validity");
    expect(header).not.toMatch(/gültig (vom|bis|ab)|veröffentlicht am/i);
  });

  it("the registry says what an entry proves: a repository state, not every state ever served", () => {
    const index = readFileSync("src/lib/legal/archive/index.ts", "utf8");
    expect(index).toContain("REPOSITORY STATE");
    expect(index).toContain("713527c");
    expect(index).toContain("not necessarily the only text ever served");
    // The earlier state is documented, not archived without a basis.
    expect(Object.keys(LEGAL_ARCHIVE)).toEqual(["2026-09-17"]);
  });

  it("reads nothing live: no seller row, no database", () => {
    for (const file of ["src/lib/legal/archive/index.ts", "src/lib/legal/archive/2026-09-17.ts"]) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/identity\/public|supabase|loadLegalTexts|seller-text/);
    }
  });
});

describe("stable URLs", () => {
  it("one address per document and version", () => {
    expect(archivePath("agb", "2026-09-17")).toBe("/rechtstexte/agb/2026-09-17");
    expect(archivedVersions("widerruf")).toEqual(["2026-09-17"]);
  });

  it("an unknown slug or version is nothing, not a guess", () => {
    expect(archivedDocument("agb", "2026-09-17")).toBe(LEGAL_ARCHIVE["2026-09-17"].agb);
    expect(archivedDocument("versand", "2026-09-17")).toBeNull();
    expect(archivedDocument("agb", "2026-01-01")).toBeNull();
    expect(archivedDocument("agb", "constructor")).toBeNull();
    expect(archivedDocument("__proto__", "2026-09-17")).toBeNull();
  });

  it("an archived version is rendered from the frozen data and nothing from today's row", () => {
    const source = readFileSync("src/lib/legal/active.ts", "utf8");
    const at = source.slice(source.indexOf("export async function legalTextAt"), source.indexOf("export async function activeLegalText"));
    // Today's row is read only for the BUILT version, before the archived branch.
    const archived = at.slice(at.indexOf("const document = archivedDocument(slug, version);"));
    expect(archived).toContain("if (!document) return null;");
    expect(archived).not.toMatch(/loadLegalTexts|fetchSellerLegal|texts\./);
    expect(at.indexOf("version === LEGAL_VERSIONS[slug]")).toBeLessThan(at.indexOf("archivedDocument(slug, version)"));
    // And the route 404s on a version this code does not carry.
    const route = readFileSync("src/app/(public)/rechtstexte/[slug]/[version]/page.tsx", "utf8");
    expect(route).toContain("if (!text) notFound();");
  });
});
