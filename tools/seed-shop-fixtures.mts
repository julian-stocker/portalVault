/**
 * Staging seed: a controlled shop, for judging the customer-facing UX.
 *
 *   npm run seed:shop-fixtures:staging              dry run
 *   npm run seed:shop-fixtures:staging -- --apply   writes
 *
 * WHY IT IS INVENTED RATHER THAN COPIED
 *
 * Production stock, purchase costs and the movement journal are internal data
 * that must never leave the database (docs/SECURITY.md), so a staging shop
 * cannot be a copy of the real one. It is a fixture: real canonical figures —
 * their names, prices, images and categories all come from the catalog import
 * — carrying invented quantities chosen to produce every public state the shop
 * can be in.
 *
 * STAGING ONLY, UNCONDITIONALLY
 *
 * `requireStaging()` rather than the flag-driven variant: there is no
 * legitimate production run of this tool.
 *
 * STOCK COMES FROM MOVEMENTS, NEVER FROM AN UPDATE
 *
 * `record_inventory_movement()` is the only way a quantity changes here, which
 * is also the rule the admin UI follows (ADR-0037, ADR-0047). The function
 * creates the position if it does not exist, refuses a delta that would take
 * stock below what is reserved, and writes the journal row itself. Nothing in
 * this file assigns `quantity`, and nothing touches `reserved`.
 *
 * IDEMPOTENT, AND THAT IS THE PART THAT MATTERS
 *
 * A movement is append-only: booking one twice books stock twice. So a second
 * run must produce **no movement at all**, not "the same movement again". The
 * seed therefore reads the current quantity first and books only the
 * difference — and when the difference is zero it books nothing. A second run
 * against an already-seeded database reports "nothing to do" and leaves
 * `inventory_movements` untouched.
 *
 * WHAT IT WILL NOT TOUCH
 *
 * `PROTECTED` below. `SKY-9101` carries the payment smoke fixture and
 * `SKY-9998` the RLS one; both have orders, reservations and journal rows
 * hanging off them that cannot be recreated. The seed refuses to name them
 * even if a future fixture file does.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

import { isOfferCondition } from "../src/lib/shop/offer.ts";
import { requireStaging } from "./lib/staging-guard.mts";

const INPUT = "data/catalog/staging-shop-fixtures.json";

/** Figures whose stock belongs to an existing smoke and is never touched. */
const PROTECTED: ReadonlySet<string> = new Set(["SKY-9101", "SKY-9998"]);

/** Marks every position and movement this tool creates. */
const NOTE = "staging UX fixture";

/** The reason an opening balance is booked under (mirrors the legacy import). */
const REASON = "initial_import";

type Position = {
  skyId: string;
  name: string;
  series: string;
  condition: string;
  quantity: number;
  salePrice: number | null;
  isListed: boolean;
  state: string;
};

const SEED_ADMIN = {
  email: `seed-shop-fixtures-${Date.now()}@staging.invalid`,
  password: `seed-${Math.random().toString(36).slice(2)}-${Date.now()}`,
};

function heading(text: string): void {
  console.log(`\n${text}\n${"-".repeat(text.length)}`);
}

function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function main(): Promise<void> {
  requireStaging("seed:shop-fixtures");

  const apply = process.argv.includes("--apply");
  console.log(`\nSkyIsles staging shop fixtures - ${apply ? "APPLY" : "DRY RUN"}`);

  // ------------------------------------------------------------- 1. read
  heading("1. Input");
  const raw = JSON.parse(readFileSync(INPUT, "utf8")) as { positions?: unknown };
  if (!Array.isArray(raw.positions)) throw new Error(`${INPUT}: "positions" must be an array`);
  const wanted = raw.positions as Position[];
  console.log(`  ${INPUT}`);
  console.log(
    `  ${wanted.length} positions on ${new Set(wanted.map((p) => p.skyId)).size} figures`,
  );

  // ---------------------------------------------------------- 2. validate
  heading("2. Validate");
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const p of wanted) {
    const key = `${p.skyId}/${p.condition}`;
    if (seen.has(key)) problems.push(`duplicate position ${key}`);
    seen.add(key);

    if (!/^SKY-[0-9]{4}$/.test(p.skyId)) problems.push(`${key}: not a SKY-ID`);
    if (PROTECTED.has(p.skyId)) {
      problems.push(`${key}: belongs to an existing smoke fixture and must not be seeded`);
    }
    if (!isOfferCondition(p.condition)) problems.push(`${key}: unknown condition`);
    if (!Number.isInteger(p.quantity) || p.quantity < 0) {
      problems.push(`${key}: quantity must be a non-negative integer`);
    }
    if (p.salePrice !== null && !(typeof p.salePrice === "number" && p.salePrice > 0)) {
      problems.push(`${key}: salePrice must be null or a positive number`);
    }
    if (typeof p.isListed !== "boolean") problems.push(`${key}: isListed must be a boolean`);
  }

  const db = serviceClient();

  // Every figure must already exist: the shop decorates the catalog, it does
  // not invent entries in it.
  const skyIds = [...new Set(wanted.map((p) => p.skyId))];
  const { data: figures, error: figureError } = await db
    .from("skylanders")
    .select("sky_id, name, market_price")
    .in("sky_id", skyIds);
  if (figureError) throw new Error(`read figures: ${figureError.message}`);
  const known = new Map((figures ?? []).map((f) => [f.sky_id as string, f]));
  for (const id of skyIds) {
    if (!known.has(id)) problems.push(`${id}: no such figure - run the catalog import first`);
  }

  if (problems.length > 0) {
    for (const problem of problems) console.error(`  ! ${problem}`);
    throw new Error(`${problems.length} problem(s) - nothing was written`);
  }
  console.log(`  ${skyIds.length} figures exist, no protected fixture named, no duplicates`);

  // ------------------------------------------------------------- 3. plan
  heading("3. Plan");
  const { data: existing, error: invError } = await db
    .from("shop_inventory")
    .select("id, sky_id, condition, quantity, reserved, sale_price, is_listed");
  if (invError) throw new Error(`read shop_inventory: ${invError.message}`);
  const current = new Map(
    (existing ?? []).map((row) => [`${row.sky_id as string}/${row.condition as string}`, row]),
  );

  type Step = {
    position: Position;
    delta: number;
    listingChange: boolean;
    from: { quantity: number; salePrice: number | null; isListed: boolean } | null;
  };
  const steps: Step[] = [];

  for (const p of wanted) {
    const row = current.get(`${p.skyId}/${p.condition}`);
    const from = row
      ? {
          quantity: row.quantity as number,
          salePrice: row.sale_price === null ? null : Number(row.sale_price),
          isListed: row.is_listed as boolean,
        }
      : null;

    // The difference, never the target. Booking the target again on a second
    // run is exactly the bug this shape avoids.
    const delta = p.quantity - (from?.quantity ?? 0);
    const listingChange =
      from === null || from.salePrice !== p.salePrice || from.isListed !== p.isListed;

    if (delta !== 0 || listingChange) steps.push({ position: p, delta, listingChange, from });
  }

  const movements = steps.filter((s) => s.delta !== 0);
  const listings = steps.filter((s) => s.listingChange);

  for (const step of steps) {
    const { position: p } = step;
    const price = p.salePrice === null ? "auto" : p.salePrice.toFixed(2);
    console.log(
      `  ${`${p.skyId}/${p.condition}`.padEnd(18)} ` +
        `qty ${String(step.from?.quantity ?? 0).padStart(2)} -> ${String(p.quantity).padStart(2)}` +
        `${step.delta === 0 ? "        " : ` (${step.delta > 0 ? "+" : ""}${step.delta})`.padEnd(8)}` +
        ` price ${price.padEnd(7)} listed ${p.isListed ? "yes" : "no "}   ${p.name}`,
    );
  }

  console.log(
    `\n  ${movements.length} movement(s) to book, ${listings.length} listing(s) to set, ` +
      `${wanted.length - steps.length} position(s) already correct`,
  );

  if (!apply) {
    heading("Result");
    console.log("  DRY RUN - nothing was written.");
    console.log("  Re-run with --apply to write these changes.");
    return;
  }

  if (steps.length === 0) {
    heading("Result");
    console.log("  Nothing to do - the fixture is already in place.");
    console.log("  No movement was booked and no stock changed.");
    return;
  }

  // ------------------------------------------------------------ 4. apply
  heading("4. Apply");
  let adminUserId: string | null = null;

  try {
    const created = await db.auth.admin.createUser({
      email: SEED_ADMIN.email,
      password: SEED_ADMIN.password,
      email_confirm: true,
    });
    if (created.error || !created.data.user) {
      throw new Error(`create seed administrator: ${created.error?.message ?? "no user"}`);
    }
    adminUserId = created.data.user.id;

    const granted = await db
      .from("shop_admins")
      .insert({ user_id: adminUserId, note: "seed:shop-fixtures (temporary)" });
    if (granted.error) throw new Error(`grant seed administrator: ${granted.error.message}`);

    const asAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const signedIn = await asAdmin.auth.signInWithPassword(SEED_ADMIN);
    if (signedIn.error) throw new Error(`sign in seed administrator: ${signedIn.error.message}`);
    console.log("  temporary administrator created");

    /*
     * Stock first, listing second.
     *
     * `record_inventory_movement()` creates the position when it is missing,
     * so a position that needs both gets its row from the movement and its
     * price from the listing call. A position whose quantity is already right
     * books nothing at all — `delta === 0` is skipped, which is what makes a
     * second run leave the journal alone.
     *
     * No `unit_cost` is passed: a fixture has no purchase price, and inventing
     * one would put a fictional number in a journal that feeds the books.
     */
    let booked = 0;
    for (const step of movements) {
      const { position: p } = step;
      const { error } = await asAdmin.rpc("record_inventory_movement", {
        p_sky_id: p.skyId,
        p_condition: p.condition,
        p_delta: step.delta,
        p_reason: step.from === null ? REASON : "correction",
        p_note: NOTE,
      });
      if (error) throw new Error(`movement ${p.skyId}/${p.condition}: ${error.message}`);
      booked += 1;
    }
    console.log(`  ${booked} movement(s) booked through record_inventory_movement()`);

    let listed = 0;
    for (const step of listings) {
      const { position: p } = step;
      const { error } = await asAdmin.rpc("set_shop_listing", {
        p_sky_id: p.skyId,
        p_condition: p.condition,
        p_sale_price: p.salePrice,
        p_is_listed: p.isListed,
        p_note: NOTE,
      });
      if (error) throw new Error(`listing ${p.skyId}/${p.condition}: ${error.message}`);
      listed += 1;
    }
    console.log(`  ${listed} listing(s) set through set_shop_listing()`);

    await asAdmin.auth.signOut();
  } finally {
    if (adminUserId) {
      await db.from("shop_admins").delete().eq("user_id", adminUserId);
      const removed = await db.auth.admin.deleteUser(adminUserId);
      console.log(
        removed.error
          ? `  ! temporary administrator NOT removed: ${removed.error.message}`
          : "  temporary administrator removed",
      );
    }
  }

  heading("Result");
  console.log("  Applied.");
}

main().catch((error: unknown) => {
  console.error(`\nSeed aborted: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
