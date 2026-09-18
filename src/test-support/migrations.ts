/**
 * Reading the schema as it actually IS, rather than as one file left it.
 *
 * TEST SUPPORT ONLY. Nothing in the application imports this; `vitest.config`
 * collects `src/**\/*.test.ts`, so this module exists solely to be imported by
 * those.
 *
 * WHY IT EXISTS
 *
 * The migration history is a fold, not a list. `admin_orders()` is defined in
 * `0018`, redefined in `0021`, again in `0024`, again in `0041`, again in
 * `0045` and again in `0046`. A test that reads `0045` and asserts something
 * about "the function" is asserting something about a version the database no
 * longer runs — and it keeps passing while the live behaviour drifts away from
 * it. That is the same defect `migration-names.test.ts` was written for after
 * `0040` read a table name out of a file that a later rename had invalidated.
 *
 * So: find the LAST migration that defines a thing, and read that one.
 */
import { readdirSync, readFileSync } from "node:fs";

const DIR = "supabase/migrations";

/** Every migration, in apply order. */
export const migrationFiles: readonly string[] = readdirSync(DIR)
  .filter((name) => name.endsWith(".sql"))
  .sort();

export function migrationSource(file: string): string {
  return readFileSync(`${DIR}/${file}`, "utf8");
}

/** The whole history concatenated, in order. For "does this exist anywhere". */
export const allMigrations: string = migrationFiles.map(migrationSource).join("\n");

/**
 * The body of the LAST `create or replace function public.<name>(` in the
 * history, up to its closing `$$;`.
 *
 * Throws rather than returning empty when there is no such function: a test
 * asserting against "" would pass every `not.toContain` it made.
 */
export function latestFunction(name: string): { file: string; body: string } {
  for (let i = migrationFiles.length - 1; i >= 0; i--) {
    const file = migrationFiles[i];
    const sql = migrationSource(file);
    const start = sql.lastIndexOf(`create or replace function public.${name}(`);
    if (start === -1) continue;
    const end = sql.indexOf("\n$$;", start);
    if (end === -1) continue;
    return { file, body: sql.slice(start, end) };
  }
  throw new Error(`no migration defines public.${name}()`);
}

/** Executable SQL only — prose and `comment on` are documentation. */
export function code(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*--.*$/gm, "")
    .replace(/comment\s+on\s+[\s\S]*?;\s*$/gim, "");
}

/**
 * Every column a table has, folded over the whole migration history.
 *
 * WHY THIS EXISTS, AND WHAT IT COST TO LEARN. Every other test in this project
 * reads migration *text*. That catches a great deal, but it is structurally
 * blind to one thing: a statement naming the **wrong table** is perfectly
 * well-formed text. `0047` seeded the seller's identity into
 * `public.shop_settings` — legal_name, street, vat_id, the lot — and not one
 * of 63 source-analysis tests could notice, because the assertions were about
 * words in a file and the words were all there. Postgres noticed, on the first
 * apply: `column "legal_name" does not exist`.
 *
 * Those columns live on `public.sellers`, added by `0040`. Nothing in the file
 * said so, and nothing checked.
 *
 * So this folds `create table` and `alter table … add column` across the
 * history, the same way `latestFunction()` folds redefinitions, and lets a
 * test ask the only question that would have caught it: does this column
 * exist on this table at all?
 *
 * Deliberately conservative — it understands the two forms this project
 * actually uses and nothing else. A table it cannot parse returns an empty set,
 * and `columnsOf` throws rather than quietly reporting "no columns", because a
 * guard that fails open is not a guard.
 */
export function columnsOf(table: string): ReadonlySet<string> {
  const out = new Set<string>();

  /*
   * Comments first, and this is not tidiness. `0040`'s ALTER carries the
   * comment "…the natural or legal person; `trading_name` is what they trade
   * as" — and that semicolon ends the statement as far as a regex is
   * concerned, three lines before the first `add column`. Matching raw text
   * found 12 columns and silently missed 13.
   */
  const history = code(allMigrations);

  const created = new RegExp(
    `create table (?:if not exists )?public\\.${table}\\s*\\(([\\s\\S]*?)\\n\\);`,
    "g",
  );
  for (const match of history.matchAll(created)) {
    for (const line of match[1].split("\n")) {
      const column = line.match(/^\s{2}(\w+)\s+\S/);
      if (!column) continue;
      if (["constraint", "primary", "foreign", "unique", "check", "exclude"].includes(column[1])) {
        continue;
      }
      out.add(column[1]);
    }
  }

  // `alter table public.<t>` … up to the terminating semicolon, which may
  // carry several `add column if not exists` clauses at once.
  const altered = new RegExp(`alter table public\\.${table}\\b([\\s\\S]*?);`, "g");
  for (const match of history.matchAll(altered)) {
    for (const add of match[1].matchAll(/add column (?:if not exists )?(\w+)/g)) {
      out.add(add[1]);
    }
    for (const drop of match[1].matchAll(/drop column (?:if exists )?(\w+)/g)) {
      out.delete(drop[1]);
    }
  }

  if (out.size === 0) {
    throw new Error(
      `columnsOf("${table}"): no columns found — the table name is wrong, or it is ` +
        `declared in a form this helper does not parse. Failing rather than passing vacuously.`,
    );
  }
  return out;
}

/**
 * Columns a statement writes to a table, as written in the SQL.
 *
 * Handles the two shapes that matter: an `insert into public.<t> (a, b, c)`
 * column list, and an `update public.<t> set a = …, b = …`.
 */
export function columnsWritten(sql: string, table: string): string[] {
  const out = new Set<string>();
  const clean = code(sql);

  for (const match of clean.matchAll(
    new RegExp(`insert into public\\.${table}\\s*\\(([^)]*)\\)`, "gi"),
  )) {
    for (const raw of match[1].split(",")) {
      const name = raw.trim();
      if (/^\w+$/.test(name)) out.add(name);
    }
  }

  for (const match of clean.matchAll(
    new RegExp(`update public\\.${table}(?:\\s+\\w+)?\\s+set\\b([\\s\\S]*?)(?:\\bwhere\\b|\\breturning\\b|;)`, "gi"),
  )) {
    for (const assignment of match[1].matchAll(/(?:^|,)\s*(\w+)\s*=/g)) out.add(assignment[1]);
  }

  return [...out].sort();
}
