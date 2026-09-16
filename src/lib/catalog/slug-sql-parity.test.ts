import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { slugify } from "./slug.ts";

/**
 * Two implementations of ADR-0011, held against each other (V3.9).
 *
 * WHY THERE ARE TWO AT ALL
 *
 * The browser previews a slug while somebody types, and the database decides
 * the real one. The decision has to be in the database because the
 * uniqueness check and the INSERT must sit inside one transaction - computing
 * it in TypeScript would mean reading the taken slugs, deciding, and then
 * writing, which is the read-then-write race the create is built to avoid.
 *
 * A second implementation of a rule is a liability unless something holds it
 * to the first. Nothing in this product talks to a database from a test, so
 * the two halves are:
 *
 *   - this file, which reads the SQL and checks it performs the same steps in
 *     the same order as the TypeScript, and
 *   - supabase/tests/0033_slug_parity.sql, which EXECUTES public.slugify()
 *     over the fixtures below and raises on any disagreement.
 *
 * The fixtures are shared between them: the expected values in the SQL file
 * were produced by calling the TypeScript slugify() over these same names, so
 * a mismatch there is a real disagreement rather than a typo.
 */
const MIGRATION = "supabase/migrations/0033_admin_created_figures.sql";
const PARITY_SQL = "supabase/tests/0033_slug_parity.sql";

const source = (path: string) => readFileSync(path, "utf8");

/** The body of one SQL function, without the surrounding file. */
function body(sql: string, name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}`);
  expect(start, name).toBeGreaterThan(-1);
  const end = sql.indexOf("$$;", start);
  expect(end, `${name} body ends`).toBeGreaterThan(start);
  return sql.slice(start, end);
}

/**
 * Names and the slug the TypeScript gives them.
 *
 * Generated, not typed: these are the output of `slugify()` itself, so the
 * list cannot drift from the implementation it documents. The same pairs are
 * the expected values in the SQL parity file.
 */
const FIXTURES: ReadonlyArray<readonly [string, string]> = [
  ["Drobot", "drobot"],
  ["Spyro's Adventure", "spyros-adventure"],
  ["Spyro (Series 2)", "spyro-series-2"],
  ["Game (Xbox 360)", "game-xbox-360"],
  ["Dino-Rang", "dino-rang"],
  ["Grim Creeper - Lightcore", "grim-creeper-lightcore"],
  ["Eon's Elite Boomer", "eons-elite-boomer"],
  ["Start Strike (LC, Enchanted)", "start-strike-lc-enchanted"],
  ["Turbo Charge D.K.", "turbo-charge-d-k"],
  ["Kaos in OVP", "kaos-in-ovp"],
  ["Elite Boomer - ohne OVP", "elite-boomer-ohne-ovp"],
  ["Legendary Grim Creemper", "legendary-grim-creemper"],
  ["Blitzstrahl Über", "blitzstrahl-ueber"],
  ["Käpt'n Blaubär", "kaeptn-blaubaer"],
  ["Straße", "strasse"],
  ["ẞSTRASSE", "ssstrasse"],
  ["Zoo Lou (Légendaire)", "zoo-lou-legendaire"],
  ["Spüle Öl Ära", "spuele-oel-aera"],
  ["  Trim   Me  ", "trim-me"],
  ["Spyro’s", "spyros"],
  ["café crème", "cafe-creme"],
  ["---weird---", "weird"],
  ["Double Trouble 1.5", "double-trouble-1-5"],
  ["Horn Blast Whirwind (Clear Crystal)", "horn-blast-whirwind-clear-crystal"],
  ["Schöner Söldner", "schoener-soeldner"],
  ["ÄÖÜäöü", "aeoeueaeoeue"]
];

describe("the fixtures describe the TypeScript rule", () => {
  for (const [name, expected] of FIXTURES) {
    it(`${JSON.stringify(name)} -> ${JSON.stringify(expected)}`, () => {
      expect(slugify(name)).toBe(expected);
    });
  }
});

describe("the SQL performs the same steps, in the same order", () => {
  const sql = body(source(MIGRATION), "slugify");

  it("spells out the umlauts first, case-insensitively", () => {
    /*
     * Order matters: before decomposition, or "ü" collapses to a bare "u"
     * when the combining marks are stripped. Case-insensitively, because an
     * uppercase "Ü" would otherwise degrade the same way.
     */
    for (const [from, to] of [["ä", "ae"], ["ö", "oe"], ["ü", "ue"]]) {
      expect(sql, from).toContain(`regexp_replace(v, '${from}', '${to}', 'gi')`);
    }
    expect(sql).toContain("replace(v, 'ß', 'ss')");
    expect(sql).toContain("replace(v, 'ẞ', 'ss')");
  });

  it("decomposes and drops the combining marks", () => {
    expect(sql).toContain("normalize(v, NFKD)");
    // U+0300-U+036F, built with chr() so the file carries no invisible
    // characters that an editor could silently lose.
    expect(sql).toContain("chr(768)");
    expect(sql).toContain("chr(879)");
  });

  it("lowercases after the marks are gone, not before", () => {
    expect(sql.indexOf("chr(768)")).toBeLessThan(sql.indexOf("lower(v)"));
  });

  it("removes apostrophes without replacing them", () => {
    // "Spyro's" is "spyros", never "spyro-s" - so this has to happen before
    // the separator pass below.
    expect(sql).toContain("regexp_replace(v, '[''’]', '', 'g')");
    expect(sql.indexOf("'[''’]'")).toBeLessThan(sql.indexOf("[^a-z0-9]+"));
  });

  it("turns every other run into one hyphen, then collapses and trims", () => {
    expect(sql).toContain("regexp_replace(v, '[^a-z0-9]+', '-', 'g')");
    expect(sql).toContain("regexp_replace(v, '-{2,}', '-', 'g')");
    expect(sql).toContain("regexp_replace(v, '^-+|-+$', '', 'g')");
  });

  it("does exactly these steps and no more", () => {
    /*
     * Twelve, matching the TypeScript one for one: five umlaut replacements,
     * normalize, the combining marks, lower, the apostrophes, the separator
     * pass, the collapse and the trim. A thirteenth would be a step the
     * TypeScript does not have — a divergence the fixtures might not happen
     * to catch, because it would only show on a name nobody thought to list.
     */
    const steps = sql.match(/v := /g) ?? [];
    expect(steps).toHaveLength(12);
  });

  it("is immutable and reaches no schema of its own", () => {
    expect(sql).toContain("immutable");
    expect(sql).toContain("set search_path = ''");
  });
});

describe("the executable half exists and shares these fixtures", () => {
  const parity = source(PARITY_SQL);

  it("names every fixture and its expected value", () => {
    for (const [name, expected] of FIXTURES) {
      // Single quotes are doubled in SQL literals.
      expect(parity, name).toContain(`'${name.replace(/'/g, "''")}'`);
      expect(parity, expected).toContain(`'${expected}'`);
    }
  });

  it("fails loudly rather than reporting quietly", () => {
    expect(parity).toContain("raise exception");
    expect(parity).toContain("public.slugify(v_case.name)");
  });

  it("writes nothing", () => {
    for (const write of ["insert into", "update ", "delete from", "alter ", "drop "]) {
      expect(parity.toLowerCase(), write).not.toContain(write);
    }
  });
});

describe("the three-stage rule lives in the database", () => {
  const sql = body(source(MIGRATION), "next_figure_slug");

  it("qualifies with the series LABEL, not the code", () => {
    // "drobot-giants", never "drobot-g" (ADR-0011).
    expect(sql).toContain("select label into v_label from public.series where code = p_series_code");
    expect(sql).toContain("public.slugify(coalesce(v_label, p_series_code))");
  });

  it("falls back to the SKY-ID, which cannot collide", () => {
    expect(sql).toContain("public.slugify(p_sky_id)");
  });

  it("asks what is taken rather than assigning a set", () => {
    /*
     * Only the NEW figure is ever qualified. An existing slug is never
     * recomputed and never moved - that is the stability guarantee, and it is
     * why this reads `skylanders.slug` instead of planning a whole import.
     */
    expect((sql.match(/from public\.skylanders where slug = v_slug/g) ?? []).length).toBe(2);
    expect(sql).not.toContain("update public.skylanders");
  });

  it("refuses a name that normalises to nothing", () => {
    expect(sql).toContain("v_base = ''");
    expect(sql).toContain("raise exception");
  });
});
