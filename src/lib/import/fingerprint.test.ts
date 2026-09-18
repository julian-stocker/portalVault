/**
 * What the fingerprint must and must not notice (ADR-0087).
 *
 * The four cases below are the whole specification. Each one is a way the
 * bytes of `skylanders.xlsx` can change, and for each the fingerprint has to
 * give the right answer about whether the *stock-take* changed.
 */
import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  FINGERPRINT_VERSION,
  canonicalise,
  fingerprint,
  type FingerprintRow,
} from "./fingerprint";

const SNAPSHOT: FingerprintRow[] = [
  { sheet: "SA", name: "Bash", storage: 3 },
  { sheet: "SA", name: "Gill Grunt", storage: 0 },
  { sheet: "G", name: "Bash", storage: 1 },
  { sheet: "SF", name: "Blast Zone - Oberteil", storage: null },
];

describe("the same stock-take, arriving as different bytes", () => {
  it("survives replacing every picture in the file", async () => {
    /*
     * 449 of the workbook's 450 MB are in-cell photographs. Swapping one — or
     * all of them — changes the ZIP completely and changes nothing about what
     * is on the shelf. The fingerprint never sees a picture, so this holds by
     * construction, and the test pins the construction.
     */
    const before = await fingerprint(SNAPSHOT);
    const after = await fingerprint([...SNAPSHOT]);
    expect(after).toBe(before);
  });

  it("survives a re-save that reorders or recompresses the archive", async () => {
    // Excel is free to write the members in a different order, at a different
    // compression level, with a different timestamp. Rows arrive in whatever
    // order the sheets are walked; the canonical form sorts them.
    const reordered = [SNAPSHOT[2], SNAPSHOT[0], SNAPSHOT[3], SNAPSHOT[1]];
    expect(await fingerprint(reordered)).toBe(await fingerprint(SNAPSHOT));
  });

  it("survives whitespace the owner cannot see", async () => {
    const padded = SNAPSHOT.map((row) => ({ ...row, name: `  ${row.name} ` }));
    expect(await fingerprint(padded)).toBe(await fingerprint(SNAPSHOT));
  });
});

describe("a different stock-take", () => {
  it("is a different fingerprint when one count moves", async () => {
    const changed = SNAPSHOT.map((row) =>
      row.sheet === "SA" && row.name === "Bash" ? { ...row, storage: 4 } : row,
    );
    expect(await fingerprint(changed)).not.toBe(await fingerprint(SNAPSHOT));
  });

  it("distinguishes a blank cell from a zero", async () => {
    // Blank is "unknown" and zero is a reconciliation target. The importer
    // treats them differently, so the fingerprint must too.
    const zeroed = SNAPSHOT.map((row) => (row.storage === null ? { ...row, storage: 0 } : row));
    expect(await fingerprint(zeroed)).not.toBe(await fingerprint(SNAPSHOT));
  });

  it("is scoped by sheet, so two games' rows never collapse", async () => {
    // `Bash` exists in both SA and G with different counts. If the sheet were
    // dropped from the key, moving stock from one to the other would be
    // invisible.
    const swapped = SNAPSHOT.map((row) =>
      row.name === "Bash" ? { ...row, sheet: row.sheet === "SA" ? "G" : "SA" } : row,
    );
    expect(await fingerprint(swapped)).not.toBe(await fingerprint(SNAPSHOT));
  });

  it("notices a row being added or removed", async () => {
    expect(await fingerprint(SNAPSHOT.slice(1))).not.toBe(await fingerprint(SNAPSHOT));
    expect(
      await fingerprint([...SNAPSHOT, { sheet: "T", name: "Trigger Happy", storage: 2 }]),
    ).not.toBe(await fingerprint(SNAPSHOT));
  });
});

describe("what it is computed over", () => {
  it("is the extracted rows, never the file", () => {
    // The signature takes rows. There is no `File`, no `ArrayBuffer` and no
    // byte stream anywhere in this module — reading 450 MB to identify 614
    // numbers is the mistake this exists to avoid.
    const source = readFileSync(join(process.cwd(), "src/lib/import/fingerprint.ts"), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const forbidden of ["File", "ArrayBuffer", "arrayBuffer", "slice(", "Blob"]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it("is computed before resolution, never after", () => {
    /*
     * No SKY-ID, no classification, no quantity delta. Those are SkyIsles'
     * reading of the workbook and they move when the catalog gains a figure or
     * a mapping is saved — neither of which is a change to the shelf. A
     * fingerprint that shifted then could not answer the only question it has.
     */
    const source = readFileSync(join(process.cwd(), "src/lib/import/fingerprint.ts"), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const forbidden of ["skyId", "sky_id", "classification", "delta", "desired"]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
    // And the input type admits exactly three fields.
    const row: FingerprintRow = { sheet: "SA", name: "Bash", storage: 1 };
    expect(Object.keys(row).sort()).toEqual(["name", "sheet", "storage"]);
  });

  it("puts a version in front, so a format change is never read as a stock change", () => {
    expect(canonicalise(SNAPSHOT).split("\n")[0]).toBe(FINGERPRINT_VERSION);
  });

  it("cannot have a field boundary shifted by a name", async () => {
    // A name containing the separator or a quote must not be able to
    // impersonate another row's fields.
    const hostile: FingerprintRow[] = [{ sheet: "SA", name: '","G","', storage: 1 }];
    const other: FingerprintRow[] = [{ sheet: "SA", name: "", storage: 1 }];
    expect(await fingerprint(hostile)).not.toBe(await fingerprint(other));
    expect(canonicalise(hostile).split("\n")).toHaveLength(2);
  });

  it("cannot have ONE row impersonate TWO rows", async () => {
    /*
     * The real collision, and the reason the fields are JSON-encoded rather
     * than joined with a separator. With a plain `sheet,name,storage` join, a
     * name carrying a comma and a newline reproduces two whole lines
     * character-for-character:
     *
     *     one row   name = "a,\nSA,b"  →  "SA,a,\nSA,b,1"
     *     two rows  {a, null}, {b, 1}   →  "SA,a,"  +  "SA,b,1"
     *
     * — identical text, so a stock-take of one figure would fingerprint the
     * same as a stock-take of two. JSON.stringify escapes both characters, so
     * neither can cross a boundary.
     */
    const oneRow: FingerprintRow[] = [{ sheet: "SA", name: "a,\nSA,b", storage: 1 }];
    const twoRows: FingerprintRow[] = [
      { sheet: "SA", name: "a", storage: null },
      { sheet: "SA", name: "b", storage: 1 },
    ];
    expect(await fingerprint(oneRow)).not.toBe(await fingerprint(twoRows));
    // One row is one line, whatever the name contains.
    expect(canonicalise(oneRow).split("\n")).toHaveLength(2);
    expect(canonicalise(twoRows).split("\n")).toHaveLength(3);
  });
});

describe("the shape it produces", () => {
  it("is 64 lowercase hex characters, as the CHECK constraint demands", async () => {
    expect(await fingerprint(SNAPSHOT)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is stable across runs", async () => {
    expect(await fingerprint(SNAPSHOT)).toBe(await fingerprint(SNAPSHOT));
  });

  it("handles an empty workbook without throwing", async () => {
    expect(await fingerprint([])).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("what it is allowed to do to an import", () => {
  it("nothing — it never blocks one", () => {
    /*
     * The workbook is the absolute truth about physical stock. Re-importing the
     * same snapshot is harmless (every delta is zero), and refusing it would be
     * SkyIsles overruling an instruction the owner just gave on purpose. So no
     * caller may branch on it.
     */
    const client = readFileSync(
      join(process.cwd(), "src/components/admin/inventory-import.tsx"),
      "utf8",
    );
    const code = client.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).toContain("contentFingerprint");
    expect(code).not.toMatch(/if\s*\(\s*!?contentFingerprint/);
    expect(code).not.toMatch(/contentFingerprint\s*[=!]==/);

    // And the column is nullable in 0048 — an import without one is legal.
    const sql = readFileSync(
      join(process.cwd(), "supabase/migrations/0048_inventory_import.sql"),
      "utf8",
    );
    expect(sql).toContain("content_fingerprint text,");
    expect(sql).not.toContain("content_fingerprint text not null");
    expect(sql).toContain("content_fingerprint is null or content_fingerprint ~");
  });

  it("no longer calls itself a file hash", () => {
    // The old name described the wrong thing and invited exactly the wrong
    // implementation.
    const sql = readFileSync(
      join(process.cwd(), "supabase/migrations/0048_inventory_import.sql"),
      "utf8",
    );
    expect(sql).not.toContain("file_hash");
    expect(sql).not.toContain("p_file_hash");
  });
});
