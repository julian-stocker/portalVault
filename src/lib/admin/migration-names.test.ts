import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";

/**
 * A migration must name tables as they are, not as they once were.
 *
 * WHY THIS EXISTS
 *
 * `0040` was written by reading the column list out of `0019`, which creates
 * `business_settings`. `0026` had renamed that table to `platform_settings`
 * fourteen migrations earlier. The new migration therefore said
 * `alter table public.business_settings`, typechecked fine, passed every test
 * in the suite — and failed on Staging with "relation does not exist".
 *
 * Reading a migration is not the same as reading the schema. The schema is the
 * FOLD of every migration, and a rename in the middle is invisible if you only
 * open the file that created the thing.
 *
 * So: collect every `alter table ... rename to`, and require that no LATER
 * migration uses the old name as a SQL identifier. Comments are stripped
 * first, because explaining the rename is exactly what a later migration
 * should do.
 */
const DIR = "supabase/migrations";

const files = readdirSync(DIR)
  .filter((name) => name.endsWith(".sql"))
  .sort();

/** Executable SQL only: prose about an old name is not a reference to it. */
function code(file: string): string {
  return readFileSync(`${DIR}/${file}`, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*--.*$/gm, "")
    // `comment on ... is '...'` is documentation too, and legitimately recalls
    // the old name.
    .replace(/comment\s+on\s+[\s\S]*?;\s*$/gim, "");
}

/** Every rename the migration history performs, in order. */
function renames(): { file: string; from: string; to: string }[] {
  const found: { file: string; from: string; to: string }[] = [];
  for (const file of files) {
    const sql = code(file);
    for (const match of sql.matchAll(
      /alter\s+table\s+(?:if\s+exists\s+)?public\.([a-z_]+)\s+rename\s+to\s+([a-z_]+)/gi,
    )) {
      found.push({ file, from: match[1], to: match[2] });
    }
  }
  return found;
}

/** Every `create or replace function public.x(...)` with its declared return. */
function definitions(): { file: string; name: string; args: string; returns: string }[] {
  const found: { file: string; name: string; args: string; returns: string }[] = [];
  for (const file of files) {
    const sql = code(file);
    for (const match of sql.matchAll(
      /create\s+or\s+replace\s+function\s+public\.([a-z_]+)\s*\(([\s\S]*?)\)\s*\n\s*returns\s+([\s\S]*?)\n\s*(?:language|security|stable|immutable|volatile)/gi,
    )) {
      found.push({
        file,
        name: match[1],
        // Parameter NAMES differ harmlessly; the types are what overload on.
        args: match[2].replace(/\s+/g, " ").trim(),
        returns: match[3].replace(/\s+/g, " ").trim(),
      });
    }
  }
  return found;
}

describe("a changed return type is dropped first", () => {
  /*
   * PostgreSQL cannot `create or replace` a function into a different return
   * type; it must be dropped first. Several migrations do exactly that on
   * purpose — `0007` even says so — so the rule is not "never change a return
   * type". It is: if you change one, drop it in the same migration.
   *
   * `0040` broke this by accident rather than on purpose. It named a NEW
   * function `admin_shop_settings()`, a name that has returned
   * `(price_percentage, updated_at)` since `0007` and is read by
   * `src/lib/admin/inventory.ts`. Staging answered "cannot change return type
   * of existing function"; had PostgreSQL allowed it, the pricing panel would
   * have broken silently instead. The fix was to pick a name nobody had used.
   */
  const history = definitions();
  const changes: { file: string; name: string; from: string; to: string }[] = [];
  const seen = new Map<string, string>();
  for (const definition of history) {
    const key = `${definition.name}(${definition.args})`;
    const previous = seen.get(key);
    if (previous !== undefined && previous !== definition.returns) {
      changes.push({ file: definition.file, name: definition.name, from: previous, to: definition.returns });
    }
    seen.set(key, definition.returns);
  }

  it("finds the return-type changes the history contains", () => {
    expect(changes.length).toBeGreaterThan(0);
  });

  it.each(changes)(
    "$file drops public.$name before changing its return type",
    ({ file, name }) => {
      const sql = code(file);
      const dropped = new RegExp(`drop\\s+function\\s+(?:if\\s+exists\\s+)?public\\.${name}\\b`, "i").test(sql);
      expect(
        dropped,
        `${file} changes the return type of public.${name} without dropping it first — PostgreSQL will refuse this at apply time`,
      ).toBe(true);
    },
  );
});

describe("renamed tables stay renamed", () => {
  const history = renames();

  it("finds the renames the history actually contains", () => {
    // If this ever reaches zero the guard below has nothing to check, and a
    // green suite would mean nothing.
    expect(history.length).toBeGreaterThan(0);
    expect(history).toContainEqual({
      file: "0026_platform_and_seller.sql",
      from: "business_settings",
      to: "platform_settings",
    });
  });

  it.each(renames())(
    "no migration after $file references public.$from",
    ({ file, from }) => {
      const after = files.filter((name) => name > file);
      const offenders = after.filter((name) =>
        new RegExp(
          `(alter\\s+table|insert\\s+into|update|delete\\s+from|from|join)\\s+(?:if\\s+exists\\s+)?public\\.${from}\\b`,
          "i",
        ).test(code(name)),
      );
      expect(
        offenders,
        `these migrations use the old name public.${from}, which ${file} renamed`,
      ).toEqual([]);
    },
  );
});
