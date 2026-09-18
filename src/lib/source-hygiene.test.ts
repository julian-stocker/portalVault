import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * No source file contains a control character.
 *
 * THE BUG THIS EXISTS FOR, TWICE.
 *
 * The performance report once grouped route pairs on a key joined with a
 * literal NUL byte, which made git stage `report.ts` as a binary file. The fix
 * came with a test — scoped to that one file.
 *
 * It happened again in `src/lib/import/classify.ts`, and the second time was
 * worse: the NUL sat inside a template literal, so the key the importer
 * computed (`SF\0free ranger oberteil`) never matched the key it stored
 * (`SF free ranger oberteil`). Saved resolutions silently stopped working.
 * TypeScript compiled it, the build passed, and `grep` said nothing at all —
 * because a NUL makes grep treat the file as binary. Only a failing test found
 * it, and only after the wrong answer had been believed for several steps.
 *
 * So the guard is repository-wide now. A control character in source is never
 * intentional: tabs, newlines and carriage returns are the only ones a text
 * file needs.
 */

function sources(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...sources(path));
    else if (/\.(ts|tsx|sql|css|json|md)$/.test(entry)) found.push(path);
  }
  return found;
}

const FILES = [...sources("src"), ...sources("supabase")];

/** Tab, newline, carriage return. Everything else below 0x20 is a mistake. */
const ALLOWED = new Set([0x09, 0x0a, 0x0d]);

describe("source files contain no control characters", () => {
  it("finds files to check", () => {
    // A guard on the guard: an empty list would pass everything below.
    expect(FILES.length).toBeGreaterThan(100);
  });

  it("and none of them has one", () => {
    for (const path of FILES) {
      const bytes = readFileSync(path);
      for (let i = 0; i < bytes.length; i += 1) {
        const byte = bytes[i];
        if (byte >= 0x20 || ALLOWED.has(byte)) continue;
        // Named precisely, because the whole difficulty last time was that the
        // character is invisible everywhere it appears.
        const where = bytes.subarray(Math.max(0, i - 40), i + 40).toString("utf8");
        expect.fail(
          `${path} byte ${i} is 0x${byte.toString(16).padStart(2, "0")} — near: ${JSON.stringify(where)}`,
        );
      }
    }
  });
});
