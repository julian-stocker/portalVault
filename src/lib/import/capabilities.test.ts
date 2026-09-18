/**
 * The gate that runs before the file is touched (ADR-0087).
 */
import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { REQUIRED_CAPABILITIES, missingCapabilities, type Capability } from "./capabilities";

const present = (key: string): Capability => ({ key, present: () => true });
const absent = (key: string): Capability => ({ key, present: () => false });

describe("detecting what the browser has", () => {
  it("names every missing API, not just the first", () => {
    expect(missingCapabilities([absent("A"), present("B"), absent("C")])).toEqual(["A", "C"]);
  });

  it("says nothing is missing when everything is there", () => {
    expect(missingCapabilities([present("A"), present("B")])).toEqual([]);
  });

  it("requires the four APIs the importer actually uses", () => {
    const keys = REQUIRED_CAPABILITIES.map((c) => c.key);
    expect(keys).toContain("DecompressionStream deflate-raw");
    expect(keys).toContain("File.prototype.slice");
    expect(keys).toContain("crypto.subtle");
    expect(keys).toContain("TextDecoder");
  });

  it("asks deflate-raw by constructing it, not by asking whether the class exists", () => {
    /*
     * Safari 16.4 shipped `DecompressionStream` with gzip and deflate only, and
     * a ZIP member is neither. `typeof DecompressionStream !== "undefined"`
     * would have passed that browser straight into the failure it is meant to
     * catch.
     */
    const source = readFileSync(join(process.cwd(), "src/lib/import/capabilities.ts"), "utf8");
    expect(source).toContain('new DecompressionStream("deflate-raw")');
    expect(source).toMatch(/try\s*{[\s\S]*new DecompressionStream/);
  });

  it("detects features, never a user-agent string", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/import/capabilities.ts"), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const forbidden of ["userAgent", "navigator", "vendor", "Safari", "Chrome"]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });
});

describe("where the gate sits in the workflow", () => {
  const client = readFileSync(
    join(process.cwd(), "src/components/admin/inventory-import.tsx"),
    "utf8",
  );
  const code = client.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("runs before anything is read", () => {
    expect(code.indexOf("missingCapabilities()")).toBeGreaterThan(-1);
    expect(code.indexOf("missingCapabilities()")).toBeLessThan(code.indexOf("readWorkbookParts("));
  });

  it("runs before anything is parsed or classified", () => {
    const gate = code.indexOf("missingCapabilities()");
    for (const later of ["parseSheet(", "parseSharedStrings(", "classifyRow(", "reconcile("]) {
      expect(gate, later).toBeLessThan(code.indexOf(later));
    }
  });

  it("runs before an import batch exists and before stock could move", () => {
    const gate = code.indexOf("missingCapabilities()");
    expect(gate).toBeLessThan(code.indexOf("createImportPreview("));
    expect(gate).toBeLessThan(code.indexOf("applyImport("));
    expect(gate).toBeLessThan(code.indexOf("loadBaseline("));
  });

  it("stops on the FIRST missing API, and returns instead of falling through", () => {
    // The threshold is pinned too: a gate that only fires at some larger count
    // detects everything and prevents nothing.
    expect(code).toContain("if (missing.length > 0) {");
    const block = code.slice(code.indexOf("const missing = missingCapabilities()"));
    expect(block.slice(0, 220)).toContain("return;");
  });

  it("says something the owner can act on", () => {
    const de = readFileSync(join(process.cwd(), "src/lib/i18n/de.ts"), "utf8");
    expect(code).toContain("copy.unsupportedBrowser");
    expect(de).toContain("unsupportedBrowser:");
    const message = de.slice(de.indexOf("unsupportedBrowser:"), de.indexOf("unsupportedBrowser:") + 400);
    // It names a remedy, and it says nothing was changed.
    expect(message).toMatch(/Chrome|Edge|Firefox|Safari/);
    expect(message).toContain("nichts geändert");
  });
});

describe("the defensive checks further down", () => {
  it("are still there", () => {
    /*
     * The gate produces a sentence for a person; these keep a call site honest
     * if one is ever added that skips the gate. Removing them because "the UI
     * checks now" would make the reader's safety depend on the caller.
     */
    const reader = readFileSync(join(process.cwd(), "src/lib/import/xlsx-reader.ts"), "utf8");
    expect(reader).toContain("DecompressionStream");
    expect(reader).toMatch(/typeof DecompressionStream === "undefined"/);
  });
});
