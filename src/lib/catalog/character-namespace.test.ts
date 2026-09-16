import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { validateCuratedFile } from "./character.ts";
import { SKY_ID_NAMESPACE, isCuratableSkyId, skyIdRange } from "./sky-id.ts";

/**
 * Which SKY-IDs a curated character may name, now that there are two issuers
 * (ADR-0070).
 *
 * Before ADR-0070 the question did not exist: every id came from the legacy
 * ledger, so `products.json` was the catalogue and "not in the export" meant
 * "not real". SkyIsles issues its own now, and a validator that still equates
 * the two rejects genuine rows.
 *
 * The split this file holds:
 *
 *   offline, against the export — shape, range, and no double assignment.
 *                                 Existence is not answerable here.
 *   the import, against the DB  — existence, before anything is written.
 *
 * Neither half is optional. The first stops a fixture or a typo'd range from
 * ever reaching curated data; the second is what actually proves the figure is
 * there.
 */
const CHARACTER = {
  canonical_name: "Testfigur",
  element: "Fire",
  species: null,
  role_type: "core",
  short_description: "Eine Testfigur, lang genug für die Beschreibungsgrenze dieser Datei.",
  source_url: "https://example.com/x",
  source_label: "Test",
  verified_at: "2026-09-16",
};

const file = (skyIds: string[], over: Record<string, unknown> = {}) => ({
  characters: [{ ...CHARACTER, ...over, sky_ids: skyIds }],
});

/** The live catalogue: legacy rows, one SkyIsles row, and the fixtures. */
const DATABASE = new Set(["SKY-0210", "SKY-0211", "SKY-0821", "SKY-9994", "SKY-9998"]);
/** The legacy export: it cannot contain SKY-0821, and never will. */
const EXPORT = new Set(["SKY-0210", "SKY-0211"]);

const problemsOf = (...args: Parameters<typeof validateCuratedFile>) =>
  validateCuratedFile(...args).problems;

describe("the namespace matches what the migration declares", () => {
  const migration = readFileSync("supabase/migrations/0033_admin_created_figures.sql", "utf8");

  it("states the same three ranges as 0033", () => {
    // Two statements of one rule — SQL and TypeScript — held together here.
    expect(migration).toContain("SKY-0001 - SKY-0820");
    expect(migration).toContain("SKY-0821 - SKY-8999");
    expect(migration).toContain("SKY-9000 - SKY-9999");
    expect(SKY_ID_NAMESPACE.historical).toEqual({ first: 1, last: 820 });
    expect(SKY_ID_NAMESPACE.productive).toEqual({ first: 821, last: 8999 });
    expect(SKY_ID_NAMESPACE.reserved).toEqual({ first: 9000, last: 9999 });
  });

  it("classifies the boundaries", () => {
    for (const [id, range] of [
      ["SKY-0001", "historical"],
      ["SKY-0820", "historical"],
      ["SKY-0821", "productive"],
      ["SKY-8999", "productive"],
      ["SKY-9000", "reserved"],
      ["SKY-9999", "reserved"],
      ["SKY-0000", "malformed"],
      ["SKY-12345", "malformed"],
      ["nonsense", "malformed"],
    ] as const) {
      expect(skyIdRange(id), id).toBe(range);
    }
  });

  it("allows curation of the two real ranges and nothing else", () => {
    expect(isCuratableSkyId("SKY-0210")).toBe(true);
    expect(isCuratableSkyId("SKY-0821")).toBe(true);
    expect(isCuratableSkyId("SKY-9998")).toBe(false);
  });
});

describe("offline, against the legacy export", () => {
  it("accepts a productive id it cannot possibly contain", () => {
    /*
     * THE RULE THIS WHOLE FILE EXISTS FOR. `products.json` holds 600 rows up
     * to SKY-0614 and is incapable of holding SKY-0821. Demanding membership
     * would reject a canonical figure for having been created in the product
     * rather than the spreadsheet.
     */
    expect(problemsOf(file(["SKY-0210", "SKY-0821"]), EXPORT, "legacy-export")).toEqual([]);
  });

  it("still demands membership for a legacy id", () => {
    // Unchanged strictness where the export IS the authority: a typo in the
    // historical range is still a typo.
    const problems = problemsOf(file(["SKY-0599"]), EXPORT, "legacy-export");
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("does not exist in the catalog");
  });

  it("refuses the reserved range whatever the scope", () => {
    for (const scope of ["legacy-export", "database"] as const) {
      const problems = problemsOf(file(["SKY-9998"]), DATABASE, scope);
      expect(problems, scope).toHaveLength(1);
      // Present in the database, and still not a catalogue figure: it carries
      // orders and journal rows as a fixture.
      expect(problems[0]).toContain("reserved range and may not be curated");
    }
  });

  it("refuses a malformed id", () => {
    for (const bad of ["SKY-12345", "sky-0210", "SKY-021", "0210", ""]) {
      expect(problemsOf(file([bad]), EXPORT, "legacy-export"), bad).not.toEqual([]);
    }
  });

  it("refuses the same figure assigned to two characters", () => {
    const two = {
      characters: [
        { ...CHARACTER, canonical_name: "Eine", sky_ids: ["SKY-0821"] },
        { ...CHARACTER, canonical_name: "Andere", sky_ids: ["SKY-0821"] },
      ],
    };
    const problems = problemsOf(two, EXPORT, "legacy-export");
    expect(problems.some((p) => p.includes("already assigned"))).toBe(true);
  });

  it("refuses the same figure twice inside one character", () => {
    const problems = problemsOf(file(["SKY-0821", "SKY-0821"]), EXPORT, "legacy-export");
    expect(problems.some((p) => p.includes("already assigned"))).toBe(true);
  });
});

describe("against the live catalogue, nothing is waived", () => {
  it("accepts a productive id that exists", () => {
    expect(problemsOf(file(["SKY-0821"]), DATABASE, "database")).toEqual([]);
  });

  it("REJECTS a productive id that does not", () => {
    /*
     * The gate that actually protects the data. Offline this id is merely
     * well-formed; here it is absent, and the import refuses before it writes
     * anything.
     */
    const problems = problemsOf(file(["SKY-0830"]), DATABASE, "database");
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("SKY-0830 does not exist in the catalog");
  });

  it("defaults to the strict scope", () => {
    // `tools/import-characters.mts` passes no scope, so the default must be
    // the one that checks everything.
    expect(problemsOf(file(["SKY-0830"]), DATABASE)).toEqual(
      problemsOf(file(["SKY-0830"]), DATABASE, "database"),
    );
  });
});

describe("the import is still the existence gate", () => {
  const tool = readFileSync("tools/import-characters.mts", "utf8");

  it("builds its known ids from the target database, not from a file", () => {
    expect(tool).toContain('client.from("skylanders").select("sky_id")');
    expect(tool).toContain("knownSkyIds = new Set(");
    expect(tool).not.toContain("products.json");
  });

  it("passes no scope, so the strict default applies", () => {
    expect(tool).toContain("validateCuratedFile(raw, knownSkyIds)");
  });

  it("refuses to write when the file has any problem", () => {
    expect(tool).toContain("the curated file is not valid - nothing was written");
  });

  it("matches nothing by name", () => {
    for (const heuristic of ["ilike", "startsWith(", "endsWith("]) {
      expect(tool, heuristic).not.toContain(heuristic);
    }
  });
});
