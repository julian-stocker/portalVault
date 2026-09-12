import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { SERIES_BARS } from "@/lib/ui/skeleton";

/**
 * The duplicate-key defect, held shut.
 *
 * `Encountered two children with the same key, 'w-28'` — the placeholder bars
 * were keyed by their Tailwind width class, and two of them are the same
 * width on purpose. React then treats the two as one element: it reuses the
 * first one's DOM node for the second and drops a bar, so the row was also
 * quietly one item short of what the code says.
 */
describe("placeholder bars have identities, not widths", () => {
  it("every id is unique", () => {
    const ids = SERIES_BARS.map((bar) => bar.id);
    expect(new Set(ids).size, `duplicates: ${ids.join(", ")}`).toBe(ids.length);
  });

  it("the widths deliberately repeat, which is why the width is not the id", () => {
    // If this ever stops being true the bug looks fixed for the wrong reason,
    // and the next repeated width brings it straight back.
    const widths = SERIES_BARS.map((bar) => bar.width);
    expect(new Set(widths).size).toBeLessThan(widths.length);
  });

  it("an id survives a reorder of the list", () => {
    // Built once at module level rather than from the render's index, so the
    // same bar keeps the same id however it is iterated.
    const shuffled = [...SERIES_BARS].reverse();
    expect(shuffled.map((b) => b.id).sort()).toEqual(SERIES_BARS.map((b) => b.id).sort());
  });

  it("carries a width every bar can actually use", () => {
    for (const bar of SERIES_BARS) expect(bar.width).toMatch(/^w-\d+$/);
  });
});

describe("both loading states key by the id", () => {
  const FILES = [
    "src/components/collection/collection-skeleton.tsx",
    "src/app/(public)/(catalog)/loading.tsx",
  ] as const;

  it.each(FILES)("%s keys by bar.id", (file) => {
    const code = readFileSync(file, "utf8");
    expect(code).toContain("key={bar.id}");
  });

  it.each(FILES)("%s keys by neither the width nor the index", (file) => {
    const code = readFileSync(file, "utf8");
    expect(code).not.toContain("key={width}");
    // The catalog used `key={index}` — it did not warn, but it said nothing
    // about what the key meant either.
    expect(code).not.toMatch(/\.map\(\(\w+, index\) => \(\s*<(Bar|Block) key=\{index\}/);
  });

  it("neither file keeps its own copy of the list", () => {
    for (const file of FILES) {
      const code = readFileSync(file, "utf8");
      expect(code).toContain('from "@/lib/ui/skeleton"');
      expect(code, `${file} still inlines the widths`).not.toMatch(/\["w-\d+",\s*"w-\d+"/);
    }
  });
});
