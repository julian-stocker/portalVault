/**
 * `legal_versions_public()` as the code reads it (ADR-0184, AP5; 0191): the
 * database names the version in force, the code renders only versions it
 * carries, and anything else is `unavailable` — never a guessed version.
 * The function itself is tested against PostgreSQL in
 * `create-order-terms-0191.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { LEGAL_ARCHIVE } from "@/lib/legal/archive";
import { LEGAL_VERSIONS } from "@/lib/legal/documents";
import { interpretLegalVersions, isRenderable } from "@/lib/legal/versions";

const ROW = { agb: "2026-09-17", widerruf: "2026-09-17", datenschutz: "2026-09-17", impressum: "2026-09-17" };
const read = (data: unknown, error: { code?: string } | null = null) => {
  const log: string[] = [];
  return { result: interpretLegalVersions({ data, error }, (m) => log.push(m)), log };
};

describe("the versions in force", () => {
  it("the archived and the built version are both renderable, nothing else is", () => {
    expect(isRenderable("agb", "2026-09-17")).toBe(true);
    expect(isRenderable("agb", LEGAL_VERSIONS.agb)).toBe(true);
    expect(isRenderable("agb", "2026-01-01")).toBe(false);
    expect(isRenderable("impressum", "constructor")).toBe(false);
  });

  it("every version a migration can set is one this code carries", () => {
    // 0047 seeded 2026-09-17, 0192 sets 2026-11-11.
    for (const slug of Object.keys(LEGAL_VERSIONS) as (keyof typeof LEGAL_VERSIONS)[]) {
      for (const version of [...Object.keys(LEGAL_ARCHIVE), LEGAL_VERSIONS[slug]]) {
        expect(isRenderable(slug, version), `${slug}@${version}`).toBe(true);
      }
    }
  });

  it("before 0192 and after it: exactly what the row names", () => {
    expect(read([ROW]).result).toEqual({ status: "ok", versions: ROW });
    const after = { agb: "2026-11-11", widerruf: "2026-11-11", datenschutz: "2026-11-11", impressum: "2026-11-11" };
    expect(read([after]).result).toEqual({ status: "ok", versions: after });
    // Mixed is the database's business; the code renders each as named.
    expect(read([{ ...ROW, agb: "2026-11-11" }]).result).toMatchObject({ status: "ok", versions: { agb: "2026-11-11", widerruf: "2026-09-17" } });
  });

  it("extra columns are ignored, never passed on", () => {
    const { result } = read([{ ...ROW, effective_from: "2026-09-17", updated_at: "x" }]);
    expect(result.status === "ok" && Object.keys(result.versions).sort()).toEqual(["agb", "datenschutz", "impressum", "widerruf"]);
  });
});

describe("never a guess", () => {
  it.each([
    ["0191 not applied (PostgREST)", null, { code: "PGRST202" }, "function_missing"],
    ["0191 not applied (PostgreSQL)", null, { code: "42883" }, "function_missing"],
    ["a version missing in the table (LV003)", null, { code: "LV003" }, "incomplete"],
    ["any other error", null, { code: "57014" }, "rpc_error"],
    ["no row", [], null, "malformed"],
    ["two rows", [ROW, ROW], null, "malformed"],
    ["not a row set", ROW, null, "malformed"],
    ["a null version", [{ ...ROW, widerruf: null }], null, "incomplete"],
    ["an empty version", [{ ...ROW, agb: "" }], null, "incomplete"],
    ["a column missing", [{ agb: "2026-09-17", widerruf: "2026-09-17", datenschutz: "2026-09-17" }], null, "incomplete"],
    ["a malformed version", [{ ...ROW, agb: "latest" }], null, "malformed"],
    ["a version this code does not carry", [{ ...ROW, agb: "2027-01-01" }], null, "unknown_version"],
  ])("%s → unavailable", (_label, data, error, reason) => {
    const { result, log } = read(data, error);
    expect(result).toEqual({ status: "unavailable", reason });
    expect(log).toHaveLength(1);
    // Codes and slugs only.
    expect(log[0]).not.toMatch(/2026|2027|latest/);
  });
});
