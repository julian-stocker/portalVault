import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * The `src/` modules the command-line tools load must resolve under plain Node.
 *
 * WHAT BROKE, AND WHY IT BROKE SILENTLY
 *
 * `tools/import-characters.mts` imports `src/lib/catalog/character.ts` and runs
 * it with `node --env-file=…`. Node knows nothing about the `@/*` alias — that
 * mapping lives in `tsconfig.json` for the app and in `vitest.config.mts` for
 * the tests, and neither is in play there.
 *
 * Every import in those modules was type-only, so it was erased before Node
 * saw it and the alias never had to resolve. Nothing said so anywhere. Adding
 * one ordinary value import to `character.ts` broke `characters:import` at load
 * time — while the app still built and all 3066 tests still passed, because
 * neither of those runs the tool.
 *
 * So the rule is written down here: a module a tool loads may use the alias for
 * TYPES, and must use a relative specifier for anything that survives to
 * runtime.
 */
const TOOLS = "tools";
const ROOT = resolve(".");

/** Every `../src/...` a tool imports, as a repository path. */
function toolLoadedModules(): string[] {
  const found = new Set<string>();
  for (const file of readdirSync(TOOLS).filter((name) => name.endsWith(".mts"))) {
    const source = readFileSync(join(TOOLS, file), "utf8");
    for (const match of source.matchAll(/from\s+"(\.\.\/src\/[^"]+)"/g)) {
      found.add(resolve(dirname(join(ROOT, TOOLS, file)), match[1]).slice(ROOT.length + 1));
    }
  }
  return [...found].sort();
}

/**
 * Imports that still exist at runtime.
 *
 * `import type { … }` is erased; so is an inline `type` specifier. What is left
 * is what Node has to resolve.
 */
function runtimeImports(source: string): string[] {
  const specifiers: string[] = [];
  for (const match of source.matchAll(/^import\s+([\s\S]*?)\s+from\s+"([^"]+)";/gm)) {
    const [, clause, specifier] = match;
    if (clause.trimStart().startsWith("type ")) continue;
    // `import { type Element, ELEMENTS }` still imports a value.
    const onlyTypes =
      clause.includes("{") &&
      clause
        .slice(clause.indexOf("{") + 1, clause.lastIndexOf("}"))
        .split(",")
        .filter((part) => part.trim() !== "")
        .every((part) => part.trim().startsWith("type "));
    if (onlyTypes) continue;
    specifiers.push(specifier);
  }
  return specifiers;
}

describe("modules the tools load", () => {
  const modules = toolLoadedModules();

  it("are found at all — the test is worthless if the scan misses them", () => {
    expect(modules.length).toBeGreaterThanOrEqual(4);
    expect(modules).toContain("src/lib/catalog/character.ts");
    expect(modules).toContain("src/lib/catalog/slug.ts");
  });

  for (const path of modules) {
    it(`${path} resolves without the @/ alias at runtime`, () => {
      const offenders = runtimeImports(readFileSync(path, "utf8")).filter((specifier) =>
        specifier.startsWith("@/"),
      );
      expect(
        offenders,
        `${path} imports ${offenders.join(", ")} at runtime; Node cannot resolve '@/' — ` +
          "use a relative specifier with its .ts extension",
      ).toEqual([]);
    });
  }
});

describe("character.ts specifically", () => {
  const source = readFileSync("src/lib/catalog/character.ts", "utf8");

  it("reaches sky-id.ts relatively, with the extension Node needs", () => {
    expect(source).toContain('from "./sky-id.ts"');
  });

  it("says why, so the next value import does not repeat this", () => {
    expect(source).toContain("plain Node");
  });

  it("keeps the namespace in one place rather than copying it", () => {
    // The alternative that would also have worked — inlining the ranges here —
    // would put ADR-0070's namespace in two files.
    expect(source).not.toContain("8999");
    expect(readFileSync("src/lib/catalog/sky-id.ts", "utf8")).toContain("last: 8999");
  });
});
