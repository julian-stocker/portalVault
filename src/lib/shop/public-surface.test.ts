import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";

/**
 * What the public may read of the shop — and what it may never read.
 *
 * `shop_inventory` holds stock levels, reservations, purchase prices and
 * internal notes. No client role has any privilege on it, and the only public
 * way in is a function that projects it down to what an offer is
 * (docs/SECURITY.md, migration 0006).
 *
 * This file exists so that stays true by accident as well as on purpose. A
 * later migration that adds `available_quantity` to a publicly executable
 * function — for a "only 3 left" badge, for a stock filter, for anything —
 * fails here rather than shipping. The rule is not "we do not display it"; it
 * is that it never leaves the database.
 */
const DIR = "supabase/migrations";

/** The columns that are a stock level, whatever they are called. */
const STOCK_COLUMNS = ["quantity", "reserved", "available_quantity"];

/** Internal business data that is not a stock level but is just as private. */
const INTERNAL_COLUMNS = ["unit_cost", "currency", "note", "created_by"];

type Fn = { name: string; body: string; returns: string };

const files = readdirSync(DIR)
  .filter((name) => name.endsWith(".sql"))
  .sort();

const sql = files.map((name) => readFileSync(`${DIR}/${name}`, "utf8")).join("\n");

/** SQL with comment lines removed, so a banner cannot satisfy an assertion. */
function stripComments(text: string): string {
  return text
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
}

const code = stripComments(sql);

/**
 * Every function definition, with its RETURNS clause isolated.
 *
 * The RETURNS clause is what actually leaves the database. A function may
 * compare a stock level all it likes — `shop_offers()` and
 * `shop_quantity_available()` both do — as long as it does not return one.
 */
function functions(text: string): Fn[] {
  const found: Fn[] = [];
  // The RETURNS clause ends where the function's attributes begin, at
  // `language`. Capturing to `as $$` would drag `security definer` and the
  // search_path into it and make the assertions below meaningless.
  const pattern =
    /create or replace function public\.(\w+)\s*\(([\s\S]*?)\)\s*returns([\s\S]*?)\blanguage\b([\s\S]*?)\bas \$\$([\s\S]*?)\$\$;/g;

  for (const match of text.matchAll(pattern)) {
    found.push({ name: match[1], returns: match[3], body: match[5] });
  }
  return found;
}

/** Which functions the anonymous or signed-in visitor may actually call. */
function granted(text: string): Set<string> {
  const roles = new Set<string>();
  const pattern = /grant execute on function public\.(\w+)\s*\([^)]*\)\s*to ([^;]+);/g;

  for (const match of text.matchAll(pattern)) {
    if (/anon|authenticated/.test(match[2])) roles.add(match[1]);
  }
  return roles;
}

const all = functions(code);

/**
 * A function granted to `authenticated` that begins by demanding
 * `is_shop_admin()` is not a public read path — it is the operator's own tool,
 * and it raises for everybody else (ADR-0039). Those may return stock levels,
 * because stock is exactly what an administrator is looking at.
 */
const adminOnly = new Set(
  all.filter((fn) => fn.body.includes("public.is_shop_admin()")).map((fn) => fn.name),
);

const callable = new Set([...granted(code)].filter((name) => !adminOnly.has(name)));

describe("the migrations parse", () => {
  it("finds the functions and the grants", () => {
    // A guard on the guard: if the patterns above ever stop matching, these
    // tests would pass vacuously.
    expect(all.length).toBeGreaterThan(5);
    expect(callable.size).toBeGreaterThan(2);
    expect(callable).toContain("shop_offers");
    expect(callable).toContain("shop_quantity_available");
  });
});

describe("no publicly callable function returns a stock level", () => {
  for (const column of [...STOCK_COLUMNS, ...INTERNAL_COLUMNS]) {
    it(`never returns ${column}`, () => {
      for (const fn of all) {
        if (!callable.has(fn.name)) continue;
        expect(
          fn.returns.includes(column),
          `public.${fn.name}() returns a column named "${column}"`,
        ).toBe(false);
      }
    });
  }

  it("shop_offers() returns exactly the four values an offer is", () => {
    const offers = all.filter((fn) => fn.name === "shop_offers");
    const latest = offers[offers.length - 1];
    const columns = [...latest.returns.matchAll(/^\s*(\w+)\s+\w+/gm)].map((m) => m[1]);
    expect(columns).toEqual(["sky_id", "condition", "price", "available"]);
  });

  it("shop_quantity_available() returns a bare boolean", () => {
    const check = all.find((fn) => fn.name === "shop_quantity_available");
    expect(check).toBeDefined();
    expect(check!.returns.trim()).toBe("boolean");
  });

  it("availability is a boolean derived from the count, never the count", () => {
    const offers = all.filter((fn) => fn.name === "shop_offers");
    const latest = offers[offers.length - 1];
    expect(latest.body).toContain("(i.available_quantity > 0) as available");
  });
});

describe("the table itself stays unreachable", () => {
  it("grants no privilege on shop_inventory to any client role", () => {
    const grants = [...code.matchAll(/grant ([^;]+?) on ([^;]+?) to ([^;]+);/g)];
    for (const [, privilege, target, roles] of grants) {
      if (!/anon|authenticated/.test(roles)) continue;
      // Function grants are how the shop is read; table grants are not.
      if (/on function/.test(`on ${target}`) || privilege.includes("execute")) continue;
      expect(target).not.toMatch(/shop_inventory|inventory_movements/);
    }
  });

  it("adds no row-level policy to the stock tables", () => {
    const policies = [...code.matchAll(/create policy[\s\S]*?on public\.(\w+)/g)].map((m) => m[1]);
    expect(policies).not.toContain("shop_inventory");
    expect(policies).not.toContain("inventory_movements");
  });
});

describe("what the application asks for", () => {
  it("never selects a stock column from the client or the server", () => {
    // The application reads the shop through shop_offers() and the quantity
    // check, and through nothing else.
    const app = readFileSync("src/lib/shop/queries.ts", "utf8");
    for (const column of STOCK_COLUMNS) {
      expect(app).not.toContain(column);
    }
  });

  it("has no type carrying a stock count across the server boundary", () => {
    const offer = readFileSync("src/lib/shop/offer.ts", "utf8");
    expect(offer).toContain("available: boolean");
    expect(offer).not.toMatch(/availableQuantity|stock\s*:|quantity\s*:\s*number/);
  });
});
