/**
 * Functional verification of the stock administration (migration 0005).
 *
 *   npm run verify:inventory
 *
 * Runs AFTER 0005 has been applied. Before that it fails on the first missing
 * function, which is the correct answer.
 *
 * Two properties this script exists for:
 *
 *   1. Reading stock is an administrator's privilege. anon and a signed-in
 *      visitor must get nothing — not an empty list, an error.
 *   2. Stock moves only through movements, and the database refuses one that
 *      would take a position below what is reserved.
 *
 * It books against a fixture figure it creates and removes afterwards. What
 * it cannot remove is the journal: movements are append-only by design
 * (ADR-0037), so the fixture's positions and its catalog row stay behind —
 * which is why the fixture is created with `is_active = false` and therefore
 * never appears in the operational list or the public catalog.
 */
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

const RUN = Date.now();
const SKY = "SKY-9994";
const USER = { email: `inv-user-${RUN}@portalvault.test`, password: `U-${RUN}-xK9!pQ` };
const ADMIN = { email: `inv-admin-${RUN}@portalvault.test`, password: `A-${RUN}-mV4!zT` };

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

async function signedIn(
  admin: SupabaseClient,
  credentials: { email: string; password: string },
): Promise<{ client: SupabaseClient; user: User }> {
  const created = await admin.auth.admin.createUser({ ...credentials, email_confirm: true });
  if (created.error) throw new Error(`createUser: ${created.error.message}`);
  const client = anonClient();
  const signIn = await client.auth.signInWithPassword(credentials);
  if (signIn.error) throw new Error(`signIn: ${signIn.error.message}`);
  return { client, user: created.data.user };
}

async function main(): Promise<void> {
  const admin = serviceClient();
  let user: Awaited<ReturnType<typeof signedIn>> | null = null;
  let boss: Awaited<ReturnType<typeof signedIn>> | null = null;

  try {
    heading("Setup (service role)");
    // Inactive on purpose: whatever the journal keeps alive afterwards must
    // never reach the operational list or the public catalog.
    const category = await admin
      .from("categories")
      .select("id")
      .eq("series_code", "SA")
      .eq("name", "Figuren")
      .single();
    if (category.error) throw new Error(`category: ${category.error.message}`);

    // Repeatable: the fixture figure cannot be deleted once it carries
    // positions, because those carry append-only movements. So it is created
    // once and reused, and every assertion below is relative to what the
    // position already holds rather than to a fresh zero.
    const existing = await admin.from("skylanders").select("sky_id").eq("sky_id", SKY).maybeSingle();
    if (!existing.data) {
      const figure = await admin.from("skylanders").insert({
        sky_id: SKY,
        name: "Inventory Fixture",
        slug: `inventory-fixture-${RUN}`,
        series_code: "SA",
        category_id: category.data.id,
        is_active: false,
      });
      if (figure.error) throw new Error(`figure: ${figure.error.message}`);
    }

    user = await signedIn(admin, USER);
    boss = await signedIn(admin, ADMIN);
    const grant = await admin
      .from("shop_admins")
      .insert({ user_id: boss.user.id, note: "verify:inventory" });
    if (grant.error) throw new Error(`grant: ${grant.error.message}`);
    console.log("  one inactive fixture figure, one user, one administrator");

    // ------------------------------------------------------------------ anon
    heading("Anonymous client");
    const anon = anonClient();
    const anonRead = await anon.rpc("admin_shop_inventory");
    check("cannot read stock", anonRead.error !== null, anonRead.error?.message.slice(0, 45) ?? "");
    const anonMoves = await anon.rpc("admin_inventory_movements", { p_inventory_id: 1, p_limit: 5 });
    check("cannot read movements", anonMoves.error !== null);
    const anonBook = await anon.rpc("record_inventory_movement", {
      p_sky_id: SKY, p_condition: "loose", p_delta: 1, p_reason: "purchase",
    });
    check("cannot book a movement", anonBook.error !== null, anonBook.error?.message.slice(0, 45) ?? "");
    const anonList = await anon.rpc("set_shop_listing", {
      p_sky_id: SKY, p_condition: "loose", p_sale_price: 1, p_is_listed: true,
    });
    check("cannot set price or listing", anonList.error !== null);
    const anonTable = await anon.from("shop_inventory").select("quantity");
    check("cannot read the table directly", anonTable.error !== null);

    // -------------------------------------------------------- signed-in user
    heading("Signed-in user without the permission");
    const u = user.client;
    check("cannot read stock", (await u.rpc("admin_shop_inventory")).error !== null);
    check("cannot read movements",
      (await u.rpc("admin_inventory_movements", { p_inventory_id: 1, p_limit: 5 })).error !== null);
    const userBook = await u.rpc("record_inventory_movement", {
      p_sky_id: SKY, p_condition: "loose", p_delta: 1, p_reason: "purchase",
    });
    check("cannot book a movement", userBook.error !== null, userBook.error?.message.slice(0, 45) ?? "");
    check("cannot set price or listing",
      (await u.rpc("set_shop_listing", { p_sky_id: SKY, p_condition: "loose", p_sale_price: 1, p_is_listed: false })).error !== null);
    check("cannot reach the system path",
      (await u.rpc("system_record_inventory_movement", { p_sky_id: SKY, p_condition: "loose", p_delta: 1, p_reason: "initial_import" })).error !== null);

    // ------------------------------------------------------------ the admin
    heading("Administrator");
    const a = boss.client;

    type Row = { inventory_id: number; sky_id: string; condition: string; quantity: number; reserved: number; available: number; is_listed: boolean; sale_price: number | null };
    const read = async (condition: string): Promise<Row | undefined> => {
      const all = ((await a.rpc("admin_shop_inventory")).data ?? []) as Row[];
      return all.find((row) => row.sky_id === SKY && row.condition === condition);
    };

    const before = (await read("loose"))?.quantity ?? 0;

    const first = await a.rpc("record_inventory_movement", {
      p_sky_id: SKY, p_condition: "loose", p_delta: 3, p_reason: "purchase",
      p_unit_cost: 4.5, p_currency: "EUR", p_note: "verify:inventory",
    });
    check("books a movement, opening the position if it is new", first.error === null,
      first.error?.message.slice(0, 60) ?? "");

    const loose = await read("loose");
    check("reads it back", loose !== undefined);
    check("quantity rose by exactly the delta",
      loose?.quantity === before + 3 && loose?.reserved === 0 && loose?.available === before + 3,
      `${before} → ${loose?.quantity}`);

    // The actor, while the account still exists: record_inventory_movement()
    // reads auth.uid() itself and never accepts it as an argument
    // (ADR-0037). After the account is deleted this becomes NULL — the
    // anonymisation path, asserted at the end.
    const booked = await admin
      .from("inventory_movements")
      .select("created_by")
      .eq("id", first.data as number)
      .single();
    check("records the administrator as the actor", booked.data?.created_by === boss.user.id,
      String(booked.data?.created_by).slice(0, 8));

    const sale = await a.rpc("record_inventory_movement", {
      p_sky_id: SKY, p_condition: "loose", p_delta: -1, p_reason: "sale_external",
    });
    check("books a sale", sale.error === null);

    const tooMany = await a.rpc("record_inventory_movement", {
      p_sky_id: SKY, p_condition: "loose", p_delta: -(before + 10), p_reason: "correction",
    });
    check("refuses a movement that would go negative", tooMany.error !== null,
      tooMany.error?.message.slice(0, 60) ?? "");

    const boxed = await a.rpc("record_inventory_movement", {
      p_sky_id: SKY, p_condition: "boxed", p_delta: 1, p_reason: "return",
    });
    check("keeps loose and boxed apart", boxed.error === null);
    const both = ((await a.rpc("admin_shop_inventory")).data ?? []) as Row[];
    check("two positions for one figure",
      both.filter((row) => row.sky_id === SKY).length === 2);

    const listing = await a.rpc("set_shop_listing", {
      p_sky_id: SKY, p_condition: "loose", p_sale_price: 12.5, p_is_listed: true, p_note: null,
    });
    check("sets price and listing", listing.error === null, listing.error?.message.slice(0, 45) ?? "");

    const after = await read("loose");
    check("price and listing are stored", Number(after?.sale_price) === 12.5 && after?.is_listed === true,
      `${after?.sale_price} / ${after?.is_listed}`);
    check("stock is untouched by a listing change", after?.quantity === before + 2,
      `${after?.quantity}`);

    const market = await admin.from("skylanders").select("market_price").eq("sky_id", SKY).single();
    check("the catalog's market price is untouched", market.data?.market_price === null,
      String(market.data?.market_price));

    const listedWithoutPrice = await a.rpc("set_shop_listing", {
      p_sky_id: SKY, p_condition: "boxed", p_sale_price: null, p_is_listed: true,
    });
    check("refuses a listing without a price", listedWithoutPrice.error !== null);

    const history = await a.rpc("admin_inventory_movements", {
      p_inventory_id: after?.inventory_id ?? 0,
      p_limit: 10,
    });
    const moves = (history.data ?? []) as { delta: number; reason: string; unit_cost: number | null }[];
    check("reads the journal of the position", history.error === null && moves.length >= 2,
      `${moves.length} movements`);
    check("the purchase kept its cost basis",
      moves.some((m) => m.reason === "purchase" && Number(m.unit_cost) === 4.5));

    heading("The journal stays append-only");
    const anyMove = await admin.from("inventory_movements").select("id").limit(1).single();
    const upd = await admin.from("inventory_movements").update({ note: "tampered" }).eq("id", anyMove.data!.id);
    check("service role cannot edit a movement", upd.error !== null, upd.error?.message.slice(0, 50) ?? "");
    const del = await admin.from("inventory_movements").delete().eq("id", anyMove.data!.id);
    check("service role cannot delete a movement", del.error !== null);
  } finally {
    heading("Cleanup (service role)");
    if (boss) {
      await admin.from("shop_admins").delete().eq("user_id", boss.user.id);
      const d = await admin.auth.admin.deleteUser(boss.user.id);
      check("the administrator account can be deleted", d.error === null, d.error?.message ?? "");
      if (!d.error) {
        const orphaned = await admin
          .from("inventory_movements")
          .select("id", { count: "exact", head: true })
          .eq("created_by", boss.user.id);
        check("their movements survive, anonymised", (orphaned.count ?? 0) === 0);
      }
    }
    if (user) await admin.auth.admin.deleteUser(user.user.id);
    // The positions and the figure stay: movements reference them and
    // movements are append-only (ADR-0037). The figure is inactive, so it is
    // in no catalog and in no operational list.
    console.log(`  users removed; ${SKY} stays inactive with its journal, by design`);
  }

  const failed = results.filter((r) => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) {
    console.log("\nFAILED:");
    for (const f of failed) console.log(`  - ${f.name}${f.detail ? `  (${f.detail})` : ""}`);
    process.exit(1);
  }
  console.log("Inventory verification passed.\n");
}

main().catch((error: unknown) => {
  console.error(`\nAborted: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
