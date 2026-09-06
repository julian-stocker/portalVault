/**
 * Functional verification of the public shop (ADR-0043, migration 0006).
 *
 *   npm run verify:shop
 *
 * Read-only, and deliberately so. Every other verification tool in this
 * repository creates a fixture and cleans it up; this one cannot, because
 * `inventory_movements` is append-only and a stock fixture would leave a
 * permanent journal row in production data. So it asserts against what is
 * actually there instead:
 *
 *   1. `shop_inventory` and `inventory_movements` stay unreadable to anon and
 *      to a signed-in visitor. This is the property migration 0006 must not
 *      have weakened, and it is checked first.
 *   2. `shop_offers()` returns exactly four keys, and none of them is a stock
 *      level, a note or a cost.
 *   3. The set of offers anon sees is exactly the set the rules predict —
 *      computed independently here from the raw tables with the service role
 *      and compared row for row. That covers "no offer for software, for a
 *      hidden figure, for an inactive one, or for something not listed"
 *      without creating any of those cases.
 *   4. The category rule in the database is the same one the application
 *      uses.
 *
 * It writes nothing, and it creates no user.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { isCollectibleCategory, NON_COLLECTIBLE_CATEGORIES } from "../src/lib/catalog/collectible.ts";

type Result = { name: string; passed: boolean; detail: string };
const results: Result[] = [];
const check = (name: string, passed: boolean, detail = ""): void => {
  results.push({ name, passed, detail });
  console.log(`  ${passed ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};
const heading = (text: string) => console.log(`\n${text}\n${"-".repeat(text.length)}`);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. Run through npm, which loads .env.local.`);
    process.exit(1);
  }
  return value;
}

const URL_ = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const ANON = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const anonClient = () => createClient(URL_, ANON, { auth: { persistSession: false } });
const serviceClient = () =>
  createClient(URL_, requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

/** The four keys a public offer may carry, and nothing else. */
const PUBLIC_KEYS = ["sky_id", "condition", "sale_price", "available"];

/** PostgREST's code for "column does not exist". */
const UNDEFINED_COLUMN = "42703";

/** Column names that must never appear in a public answer. */
const FORBIDDEN = [
  "quantity",
  "reserved",
  "available_quantity",
  "note",
  "unit_cost",
  "currency",
  "created_by",
  "inventory_id",
  "id",
];

type OfferRow = Record<string, unknown>;

function key(row: OfferRow): string {
  return `${String(row.sky_id)}/${String(row.condition)}`;
}

async function main(): Promise<void> {
  const anon = anonClient();
  const service = serviceClient();

  heading("1. The tables stay closed");
  {
    const table = await anon.from("shop_inventory").select("quantity").limit(1);
    check("anon cannot read shop_inventory", table.error !== null, table.error?.code ?? "no error");

    const journal = await anon.from("inventory_movements").select("delta").limit(1);
    check(
      "anon cannot read inventory_movements",
      journal.error !== null,
      journal.error?.code ?? "no error",
    );

    const admin = await anon.rpc("admin_shop_inventory");
    check("anon cannot call the administrator's read", admin.error !== null);
  }

  heading("2. The projection");
  const offers = await anon.rpc("shop_offers");
  if (offers.error) {
    check("anon can call shop_offers()", false, `${offers.error.code}: ${offers.error.message}`);
    report();
    return;
  }
  check("anon can call shop_offers()", true, `${(offers.data ?? []).length} offers`);

  const rows = (offers.data ?? []) as OfferRow[];
  {
    // Asked of the function's own signature, not of the rows it happened to
    // return. PostgREST resolves `select=` against the result type, so this
    // holds even when the shop is empty — which is exactly when a check that
    // inspects returned keys proves nothing at all.
    const selectable = await anon.rpc("shop_offers").select(PUBLIC_KEYS.join(","));
    check(
      "the four public values are the signature",
      selectable.error === null,
      selectable.error?.message ?? "",
    );

    const exposed: string[] = [];
    for (const column of FORBIDDEN) {
      const probe = await anon.rpc("shop_offers").select(column);
      // 42703 is "column does not exist": the value is not in the result type.
      if (probe.error?.code !== UNDEFINED_COLUMN) exposed.push(column);
    }
    check(
      "no stock level, note, cost or id exists to ask for",
      exposed.length === 0,
      exposed.length > 0 ? exposed.join(", ") : `${FORBIDDEN.length} names refused`,
    );

    const keys = new Set(rows.flatMap((row) => Object.keys(row)));
    const leaked = FORBIDDEN.filter((column) => keys.has(column));
    check(
      "returned rows carry nothing else",
      leaked.length === 0,
      rows.length === 0 ? "no rows today" : `${rows.length} rows inspected`,
    );

    const priced = rows.every((row) => Number(row.sale_price) > 0);
    check("every offer carries a price above zero", priced);

    const conditions = rows.every((row) => row.condition === "loose" || row.condition === "boxed");
    check("every offer has a known condition", conditions);

    const booleans = rows.every((row) => typeof row.available === "boolean");
    check("availability is a boolean, never a count", booleans);
  }

  heading("3. The offers are exactly the ones the rules predict");
  {
    const expected = await expectedOffers(service);
    const actual = new Map(rows.map((row) => [key(row), row]));

    const missing = [...expected.keys()].filter((k) => !actual.has(k));
    const extra = [...actual.keys()].filter((k) => !expected.has(k));

    check("nothing that should be offered is missing", missing.length === 0, missing.join(", "));
    check("nothing is offered that should not be", extra.length === 0, extra.join(", "));

    const wrongPrice = [...expected.entries()].filter(([k, row]) => {
      const seen = actual.get(k);
      return seen !== undefined && Number(seen.sale_price) !== row.price;
    });
    check("every price matches the stored one", wrongPrice.length === 0);

    const wrongAvailability = [...expected.entries()].filter(([k, row]) => {
      const seen = actual.get(k);
      return seen !== undefined && seen.available !== row.available;
    });
    check("every availability flag matches the stock", wrongAvailability.length === 0);
  }

  heading("4. The category rule is one rule");
  {
    const { data, error } = await anon.rpc("non_collectible_categories");
    if (error) {
      check("the database names the excluded categories", false, error.message);
    } else {
      const database = [...((data ?? []) as string[])].sort();
      const application = [...NON_COLLECTIBLE_CATEGORIES].sort();
      check(
        "database and application exclude the same categories",
        database.join(",") === application.join(","),
        `db: [${database.join(", ")}]  app: [${application.join(", ")}]`,
      );
    }
  }

  report();
}

/**
 * What the offer list should contain, computed from the raw tables.
 *
 * Deliberately an independent implementation of the rule rather than a second
 * call to the same function: if both sides came from `shop_offers()` the
 * comparison would prove nothing.
 */
async function expectedOffers(
  service: SupabaseClient,
): Promise<Map<string, { price: number; available: boolean }>> {
  const [positions, figures, categories] = await Promise.all([
    service.from("shop_inventory").select("sky_id, condition, sale_price, is_listed, quantity, reserved"),
    service.from("skylanders").select("sky_id, is_active, catalog_visible, category_id"),
    service.from("categories").select("id, name"),
  ]);

  for (const result of [positions, figures, categories]) {
    if (result.error) throw new Error(result.error.message);
  }

  const categoryName = new Map(
    (categories.data ?? []).map((row) => [row.id as number, row.name as string]),
  );
  const shown = new Map<string, boolean>();
  for (const figure of figures.data ?? []) {
    const name = categoryName.get(figure.category_id as number) ?? "";
    shown.set(
      figure.sky_id as string,
      Boolean(figure.is_active) && Boolean(figure.catalog_visible) && isCollectibleCategory(name),
    );
  }

  const expected = new Map<string, { price: number; available: boolean }>();
  for (const position of positions.data ?? []) {
    if (!position.is_listed) continue;
    if (!shown.get(position.sky_id as string)) continue;
    expected.set(`${position.sky_id as string}/${position.condition as string}`, {
      price: Number(position.sale_price),
      available: Number(position.quantity) - Number(position.reserved) > 0,
    });
  }
  return expected;
}

function report(): void {
  const failed = results.filter((result) => !result.passed);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) {
    console.log("\nFAILED:");
    for (const f of failed) console.log(`  - ${f.name}${f.detail ? `  (${f.detail})` : ""}`);
    process.exit(1);
  }
  console.log("Shop verification passed.\n");
}

main().catch((error: unknown) => {
  console.error(`\nAborted: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
