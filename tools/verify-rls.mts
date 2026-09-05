/**
 * V1.2C — functional Row Level Security verification.
 *
 * Proves with two REAL authenticated sessions that the policies from
 * 0001_initial_schema.sql actually take effect, and that the
 * on_auth_user_created trigger creates exactly one profile per new auth user.
 *
 * Structural verification (V1.2B) showed the policies are CONFIGURED as
 * intended. This script shows they WORK.
 *
 * Run:
 *   npm run verify:rls
 *
 * The .mts extension makes Node treat the file as an ES module without adding
 * "type": "module" to package.json, which would change how Next.js resolves
 * every other file in the project.
 *
 * Roles used, deliberately separated:
 *   - service role  ONLY to seed the catalog test row, create the two test
 *                   users and clean everything up afterwards. Never for an
 *                   assertion: it bypasses RLS and would prove nothing.
 *   - anon key      + a real user JWT for every single assertion.
 *
 * The script is idempotent and removes everything it created, including the
 * two auth users. It writes no secrets to stdout.
 */
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

// --- Test fixtures ---------------------------------------------------------
// Deliberately outside the real catalog: SKY-9999 is the highest ID the format
// allows and will never be issued by the legacy ledger (highest_issued = 820).
const TEST_SERIES = { code: "TEST", label: "RLS Test Series", release_year: 2026, position: 99 };
const TEST_CATEGORY = { name: "RLS Test Category", position: 0 };
const TEST_SKY_ID = "SKY-9999";
const TEST_CHARACTER = "RLS Test Character";
const TEST_SKYLANDER = {
  sky_id: TEST_SKY_ID,
  name: "RLS Test Figure",
  slug: "rls-test-figure",
  market_price: 9.99,
};

const RUN = Date.now();
const USER_A = { email: `rls-test-a-${RUN}@portalvault.test`, password: `A-${RUN}-xK9!pQ` };
const USER_B = { email: `rls-test-b-${RUN}@portalvault.test`, password: `B-${RUN}-mV4!zT` };
// Booked and then deleted inside section 9, to exercise ON DELETE SET NULL on
// the real foreign key rather than on a hand-written UPDATE.
const USER_C = { email: `rls-test-c-${RUN}@portalvault.test`, password: `C-${RUN}-nW7!yR` };

// --- Tiny assertion harness ------------------------------------------------
type Result = { name: string; passed: boolean; detail: string };
const results: Result[] = [];

function check(name: string, passed: boolean, detail = ""): void {
  results.push({ name, passed, detail });
  console.log(`  ${passed ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`\nMissing environment variable: ${name}`);
    console.error("Copy .env.example to .env.local and fill in the values from");
    console.error("Supabase → Project Settings → API. See docs/SECURITY.md.\n");
    process.exit(1);
  }
  return value;
}

const SUPABASE_URL = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const ANON_KEY = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

/** Client without any session: the anonymous visitor. */
function anonClient(): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Setup and teardown only. Bypasses RLS, so never used for an assertion. */
function serviceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * A real, logged-in user. Signs up through the normal Supabase Auth path;
 * if the project requires email confirmation, signUp returns no session, so
 * the account is created through the admin API instead and then signed in
 * normally. Either way the returned client carries a genuine user JWT.
 */
async function createSignedInUser(
  admin: SupabaseClient,
  credentials: { email: string; password: string },
): Promise<{ client: SupabaseClient; user: User; path: string }> {
  const client = anonClient();

  const signUp = await client.auth.signUp(credentials);
  let path = "signUp";

  if (signUp.error || !signUp.data.session) {
    // Email confirmation is enabled: create a confirmed user, then sign in.
    const created = await admin.auth.admin.createUser({
      email: credentials.email,
      password: credentials.password,
      email_confirm: true,
    });
    if (created.error) throw new Error(`admin.createUser: ${created.error.message}`);
    path = "admin.createUser + signInWithPassword";

    const signIn = await client.auth.signInWithPassword(credentials);
    if (signIn.error) throw new Error(`signInWithPassword: ${signIn.error.message}`);
  }

  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new Error(`getUser: ${error?.message ?? "no user"}`);

  return { client, user: data.user, path };
}

async function main(): Promise<void> {
  const admin = serviceClient();
  let categoryId: number | null = null;
  let characterId: number | null = null;
  let userA: Awaited<ReturnType<typeof createSignedInUser>> | null = null;
  let userB: Awaited<ReturnType<typeof createSignedInUser>> | null = null;
  let userC: Awaited<ReturnType<typeof createSignedInUser>> | null = null;

  try {
    // ---------------------------------------------------------------- setup
    console.log("\nSetup — minimal catalog fixture (service role)");

    const series = await admin.from("series").insert(TEST_SERIES).select().single();
    if (series.error) throw new Error(`seed series: ${series.error.message}`);

    const category = await admin
      .from("categories")
      .insert({ ...TEST_CATEGORY, series_code: TEST_SERIES.code })
      .select()
      .single();
    if (category.error) throw new Error(`seed category: ${category.error.message}`);
    categoryId = category.data.id as number;

    const skylander = await admin
      .from("skylanders")
      .insert({ ...TEST_SKYLANDER, series_code: TEST_SERIES.code, category_id: categoryId })
      .select()
      .single();
    if (skylander.error) throw new Error(`seed skylander: ${skylander.error.message}`);

    // Migration 0002 may not be applied yet. Rather than crashing setup, note
    // it and let the other checks run — the character section then reports a
    // single, unmistakable failure instead of a stack trace.
    const character = await admin
      .from("characters")
      .insert({ canonical_name: TEST_CHARACTER, element: "Tech", role_type: "core" })
      .select()
      .single();
    if (character.error) {
      console.log(`  ! characters unavailable: ${character.error.message}`);
    } else {
      characterId = character.data.id as number;
    }

    console.log(
      `  seeded series ${TEST_SERIES.code}, one category, ${TEST_SKY_ID}` +
        (characterId === null ? "" : `, character #${characterId}`),
    );

    console.log("\nSetup — two real auth users");
    userA = await createSignedInUser(admin, USER_A);
    userB = await createSignedInUser(admin, USER_B);
    console.log(`  user A created via ${userA.path}`);
    console.log(`  user B created via ${userB.path}`);

    const a = userA.client;
    const b = userB.client;
    const idA = userA.user.id;
    const idB = userB.user.id;

    // ------------------------------------------- 1. profile trigger
    console.log("\n1. on_auth_user_created");

    for (const [label, client, id] of [
      ["A", a, idA],
      ["B", b, idB],
    ] as const) {
      const own = await client.from("profiles").select("id, username").eq("id", id);
      check(
        `trigger created exactly one profile for user ${label}`,
        !own.error && own.data?.length === 1 && own.data[0].id === id,
        own.error ? own.error.message : `${own.data?.length ?? 0} row(s)`,
      );
      check(
        `profile of user ${label} starts with username = null`,
        !own.error && own.data?.[0]?.username === null,
        own.error ? own.error.message : `username=${String(own.data?.[0]?.username)}`,
      );
    }

    // ------------------------------------------- 2. own profile
    console.log("\n2. Own profile: read and update");

    const allA = await a.from("profiles").select("id");
    check(
      "user A sees exactly one profile in total (their own)",
      !allA.error && allA.data?.length === 1 && allA.data[0].id === idA,
      allA.error ? allA.error.message : `${allA.data?.length ?? 0} row(s)`,
    );

    const updA = await a.from("profiles").update({ username: `rls_a_${RUN % 100000}` }).eq("id", idA).select();
    check(
      "user A can update their own profile",
      !updA.error && updA.data?.length === 1,
      updA.error ? updA.error.message : `${updA.data?.length ?? 0} row(s)`,
    );

    const updB = await b.from("profiles").update({ username: `rls_b_${RUN % 100000}` }).eq("id", idB).select();
    check(
      "user B can update their own profile",
      !updB.error && updB.data?.length === 1,
      updB.error ? updB.error.message : `${updB.data?.length ?? 0} row(s)`,
    );

    // ------------------------------------------- 3. cross-user profile
    console.log("\n3. Cross-user profile access must fail");

    const readBfromA = await a.from("profiles").select("id, username").eq("id", idB);
    check(
      "user A cannot read the profile of user B",
      !readBfromA.error && readBfromA.data?.length === 0,
      readBfromA.error ? readBfromA.error.message : `${readBfromA.data?.length ?? 0} row(s)`,
    );

    const writeBfromA = await a.from("profiles").update({ username: "hijacked_by_a" }).eq("id", idB).select();
    check(
      "user A cannot update the profile of user B",
      !!writeBfromA.error || writeBfromA.data?.length === 0,
      writeBfromA.error ? `rejected: ${writeBfromA.error.code}` : `${writeBfromA.data?.length ?? 0} row(s) changed`,
    );

    const readAfromB = await b.from("profiles").select("id, username").eq("id", idA);
    check(
      "user B cannot read the profile of user A",
      !readAfromB.error && readAfromB.data?.length === 0,
      readAfromB.error ? readAfromB.error.message : `${readAfromB.data?.length ?? 0} row(s)`,
    );

    const writeAfromB = await b.from("profiles").update({ username: "hijacked_by_b" }).eq("id", idA).select();
    check(
      "user B cannot update the profile of user A",
      !!writeAfromB.error || writeAfromB.data?.length === 0,
      writeAfromB.error ? `rejected: ${writeAfromB.error.code}` : `${writeAfromB.data?.length ?? 0} row(s) changed`,
    );

    const delOwnA = await a.from("profiles").delete().eq("id", idA).select();
    check(
      "user A cannot delete their own profile row (no DELETE policy)",
      !!delOwnA.error || delOwnA.data?.length === 0,
      delOwnA.error ? `rejected: ${delOwnA.error.code}` : `${delOwnA.data?.length ?? 0} row(s) deleted`,
    );

    // Verify the profile of B is genuinely untouched, read with B's own session.
    const bStillOwn = await b.from("profiles").select("username").eq("id", idB).single();
    check(
      "profile of user B is unchanged after A's attempts",
      !bStillOwn.error && bStillOwn.data?.username === `rls_b_${RUN % 100000}`,
      bStillOwn.error ? bStillOwn.error.message : `username=${String(bStillOwn.data?.username)}`,
    );

    // ------------------------------------------- 4. own collection
    console.log("\n4. Own collection_items");

    const insA = await a
      .from("collection_items")
      .insert({ user_id: idA, sky_id: TEST_SKY_ID, quantity: 2 })
      .select()
      .single();
    check(
      "user A can add a figure to their own collection",
      !insA.error && insA.data?.quantity === 2,
      insA.error ? insA.error.message : `quantity=${String(insA.data?.quantity)}`,
    );

    const insB = await b
      .from("collection_items")
      .insert({ user_id: idB, sky_id: TEST_SKY_ID, quantity: 1 })
      .select()
      .single();
    check(
      "user B can add a figure to their own collection",
      !insB.error && insB.data?.quantity === 1,
      insB.error ? insB.error.message : `quantity=${String(insB.data?.quantity)}`,
    );

    const itemA = insA.data?.id as string | undefined;
    const itemB = insB.data?.id as string | undefined;

    const updOwnA = await a.from("collection_items").update({ quantity: 3 }).eq("id", itemA!).select();
    check(
      "user A can change the quantity of their own item",
      !updOwnA.error && updOwnA.data?.length === 1 && updOwnA.data[0].quantity === 3,
      updOwnA.error ? updOwnA.error.message : `quantity=${String(updOwnA.data?.[0]?.quantity)}`,
    );

    const listA = await a.from("collection_items").select("id, user_id");
    check(
      "user A sees exactly one collection item (their own)",
      !listA.error && listA.data?.length === 1 && listA.data[0].user_id === idA,
      listA.error ? listA.error.message : `${listA.data?.length ?? 0} row(s)`,
    );

    // ------------------------------------------- 5. cross-user collection
    console.log("\n5. Cross-user collection access must fail");

    const readItemBfromA = await a.from("collection_items").select("id").eq("id", itemB!);
    check(
      "user A cannot read the collection item of user B",
      !readItemBfromA.error && readItemBfromA.data?.length === 0,
      readItemBfromA.error ? readItemBfromA.error.message : `${readItemBfromA.data?.length ?? 0} row(s)`,
    );

    const insForB = await a
      .from("collection_items")
      .insert({ user_id: idB, sky_id: TEST_SKY_ID, quantity: 99 })
      .select();
    check(
      "user A cannot create a collection item for user B",
      !!insForB.error,
      insForB.error ? `rejected: ${insForB.error.code}` : "INSERT SUCCEEDED — RLS HOLE",
    );

    const updItemBfromA = await a.from("collection_items").update({ quantity: 99 }).eq("id", itemB!).select();
    check(
      "user A cannot change the collection item of user B",
      !!updItemBfromA.error || updItemBfromA.data?.length === 0,
      updItemBfromA.error ? `rejected: ${updItemBfromA.error.code}` : `${updItemBfromA.data?.length ?? 0} row(s) changed`,
    );

    const stealB = await a.from("collection_items").update({ user_id: idA }).eq("id", itemB!).select();
    check(
      "user A cannot reassign the item of user B to themselves",
      !!stealB.error || stealB.data?.length === 0,
      stealB.error ? `rejected: ${stealB.error.code}` : `${stealB.data?.length ?? 0} row(s) changed`,
    );

    const giveAwayA = await a.from("collection_items").update({ user_id: idB }).eq("id", itemA!).select();
    check(
      "user A cannot move their own item to user B (WITH CHECK)",
      !!giveAwayA.error || giveAwayA.data?.length === 0,
      giveAwayA.error ? `rejected: ${giveAwayA.error.code}` : `${giveAwayA.data?.length ?? 0} row(s) changed`,
    );

    const delItemBfromA = await a.from("collection_items").delete().eq("id", itemB!).select();
    check(
      "user A cannot delete the collection item of user B",
      !!delItemBfromA.error || delItemBfromA.data?.length === 0,
      delItemBfromA.error ? `rejected: ${delItemBfromA.error.code}` : `${delItemBfromA.data?.length ?? 0} row(s) deleted`,
    );

    const bItemIntact = await b.from("collection_items").select("id, quantity, user_id").eq("id", itemB!);
    check(
      "collection item of user B survived every attempt by A, unchanged",
      !bItemIntact.error &&
        bItemIntact.data?.length === 1 &&
        bItemIntact.data[0].quantity === 1 &&
        bItemIntact.data[0].user_id === idB,
      bItemIntact.error ? bItemIntact.error.message : `quantity=${String(bItemIntact.data?.[0]?.quantity)}`,
    );

    const delOwn = await a.from("collection_items").delete().eq("id", itemA!).select();
    check(
      "user A can delete their own collection item",
      !delOwn.error && delOwn.data?.length === 1,
      delOwn.error ? delOwn.error.message : `${delOwn.data?.length ?? 0} row(s) deleted`,
    );

    // ------------------------------------------- 6. catalog is read-only
    console.log("\n6. Catalog stays read-only for clients");

    const catRead = await a.from("skylanders").select("sky_id").eq("sky_id", TEST_SKY_ID);
    check(
      "an authenticated user can read the catalog",
      !catRead.error && catRead.data?.length === 1,
      catRead.error ? catRead.error.message : `${catRead.data?.length ?? 0} row(s)`,
    );

    const catWrite = await a
      .from("skylanders")
      .update({ market_price: 1.0 })
      .eq("sky_id", TEST_SKY_ID)
      .select();
    check(
      "an authenticated user cannot change the catalog",
      !!catWrite.error || catWrite.data?.length === 0,
      catWrite.error ? `rejected: ${catWrite.error.code}` : `${catWrite.data?.length ?? 0} row(s) changed`,
    );

    const catInsert = await a.from("skylanders").insert({
      sky_id: "SKY-9998",
      name: "Injected",
      slug: "injected",
      series_code: TEST_SERIES.code,
      category_id: categoryId,
    });
    check(
      "an authenticated user cannot insert into the catalog",
      !!catInsert.error,
      catInsert.error ? `rejected: ${catInsert.error.code}` : "INSERT SUCCEEDED — RLS HOLE",
    );

    // ------------------------------------------- 7. anonymous visitor
    console.log("\n7. Anonymous visitor");

    const anon = anonClient();

    const anonCatalog = await anon.from("skylanders").select("sky_id").eq("sky_id", TEST_SKY_ID);
    check(
      "anonymous can read the catalog",
      !anonCatalog.error && anonCatalog.data?.length === 1,
      anonCatalog.error ? anonCatalog.error.message : `${anonCatalog.data?.length ?? 0} row(s)`,
    );

    const anonProfiles = await anon.from("profiles").select("id");
    check(
      "anonymous cannot read profiles",
      !!anonProfiles.error || anonProfiles.data?.length === 0,
      anonProfiles.error ? `rejected: ${anonProfiles.error.code}` : `${anonProfiles.data?.length ?? 0} row(s)`,
    );

    const anonItems = await anon.from("collection_items").select("id");
    check(
      "anonymous cannot read collection items",
      !!anonItems.error || anonItems.data?.length === 0,
      anonItems.error ? `rejected: ${anonItems.error.code}` : `${anonItems.data?.length ?? 0} row(s)`,
    );

    // ------------------------------------------- 8. characters (migration 0002)
    console.log("\n8. Character metadata is public but curated");

    if (characterId === null) {
      // Every check below would either crash or pass for the wrong reason
      // (a missing table rejects writes too). One clear failure instead.
      check(
        "migration 0002_characters.sql is applied",
        false,
        "the characters fixture could not be created - run the migration first",
      );
    } else {
    const charRead = await a.from("characters").select("id, canonical_name").limit(1);
    check(
      "an authenticated user can read characters",
      !charRead.error,
      charRead.error ? charRead.error.message : `${charRead.data?.length ?? 0} row(s)`,
    );

    const anonChar = await anon.from("characters").select("id, canonical_name").limit(1);
    check(
      "anonymous can read characters",
      !anonChar.error,
      anonChar.error ? anonChar.error.message : `${anonChar.data?.length ?? 0} row(s)`,
    );

    const charInsert = await a
      .from("characters")
      .insert({ canonical_name: `RLS Injected ${Date.now()}` });
    check(
      "an authenticated user cannot insert a character",
      !!charInsert.error,
      charInsert.error ? `rejected: ${charInsert.error.code}` : "INSERT SUCCEEDED - RLS HOLE",
    );

    const anonInsert = await anon
      .from("characters")
      .insert({ canonical_name: `RLS Injected ${Date.now()}` });
    check(
      "anonymous cannot insert a character",
      !!anonInsert.error,
      anonInsert.error ? `rejected: ${anonInsert.error.code}` : "INSERT SUCCEEDED - RLS HOLE",
    );

      const charUpdate = await a
        .from("characters")
        .update({ element: "Dark" })
        .eq("id", characterId)
        .select();
      check(
        "an authenticated user cannot change a character",
        !!charUpdate.error || charUpdate.data?.length === 0,
        charUpdate.error
          ? `rejected: ${charUpdate.error.code}`
          : `${charUpdate.data?.length ?? 0} row(s) changed`,
      );

      const charDelete = await a.from("characters").delete().eq("id", characterId).select();
      check(
        "an authenticated user cannot delete a character",
        !!charDelete.error || charDelete.data?.length === 0,
        charDelete.error
          ? `rejected: ${charDelete.error.code}`
          : `${charDelete.data?.length ?? 0} row(s) deleted`,
      );

      const linkWrite = await a
        .from("skylanders")
        .update({ character_id: characterId })
        .eq("sky_id", TEST_SKY_ID)
        .select();
      check(
        "an authenticated user cannot link a figure to a character",
        !!linkWrite.error || linkWrite.data?.length === 0,
        linkWrite.error
          ? `rejected: ${linkWrite.error.code}`
          : `${linkWrite.data?.length ?? 0} row(s) changed`,
      );

      // The curated path itself must work: the service role writes the link.
      const adminLink = await admin
        .from("skylanders")
        .update({ character_id: characterId })
        .eq("sky_id", TEST_SKY_ID)
        .select("sky_id, character_id");
      check(
        "the service role can link a figure to a character",
        !adminLink.error && adminLink.data?.[0]?.character_id === characterId,
        adminLink.error ? adminLink.error.message : `linked ${adminLink.data?.[0]?.sky_id ?? "-"}`,
      );

      const restrict = await admin.from("characters").delete().eq("id", characterId);
      check(
        "a character still linked to a figure cannot be deleted (on delete restrict)",
        !!restrict.error,
        restrict.error ? `rejected: ${restrict.error.code}` : "DELETE SUCCEEDED - FK NOT ENFORCED",
      );

      const badElement = await admin
        .from("characters")
        .insert({ canonical_name: `RLS Element ${Date.now()}`, element: "Banana" });
      check(
        "an element outside the ten is rejected by the CHECK",
        !!badElement.error,
        badElement.error ? `rejected: ${badElement.error.code}` : "INSERT SUCCEEDED - CHECK MISSING",
      );

      const badRole = await admin
        .from("characters")
        .insert({ canonical_name: `RLS Role ${Date.now()}`, role_type: "villain" });
      check(
        "a role_type outside the eight is rejected by the CHECK",
        !!badRole.error,
        badRole.error ? `rejected: ${badRole.error.code}` : "INSERT SUCCEEDED - CHECK MISSING",
      );

      const longText = await admin.from("characters").insert({
        canonical_name: `RLS Text ${Date.now()}`,
        short_description: "x".repeat(601),
      });
      check(
        "a description longer than 600 characters is rejected by the CHECK",
        !!longText.error,
        longText.error ? `rejected: ${longText.error.code}` : "INSERT SUCCEEDED - CHECK MISSING",
      );

      const badUrl = await admin
        .from("characters")
        .insert({ canonical_name: `RLS Url ${Date.now()}`, source_url: "http://example.org" });
      check(
        "a non-https source_url is rejected by the CHECK",
        !!badUrl.error,
        badUrl.error ? `rejected: ${badUrl.error.code}` : "INSERT SUCCEEDED - CHECK MISSING",
      );
    }

    // ------------------------------------- 9. shop foundation (migration 0003)
    console.log("\n9. Shop foundation: role, stock, journal");

    const shopReady = !(await admin.from("shop_inventory").select("id").limit(1)).error;
    if (!shopReady) {
      // One clear failure instead of forty that pass for the wrong reason:
      // a missing table rejects writes too.
      check(
        "migration 0003_shop_foundation.sql is applied",
        false,
        "shop_inventory is not reachable - run the migration first",
      );
    } else {
      // The shop fixture is PERMANENT, unlike the catalog fixture above.
      //
      // inventory_movements is append-only for every role, and a position that
      // carries history cannot be deleted (FK RESTRICT) — so shop test data
      // cannot be torn down, and must not be: weakening that invariant for the
      // convenience of a test would defeat the point of an audit trail.
      //
      // Instead the fixture is inert. SKY-9998 is inactive, so it is outside
      // the catalog, the collection and every completion count, and it hangs
      // off an EXISTING series and category so that no phantom series appears
      // in the UI. Every run reuses it, and the assertions below are written
      // against the stock that is already there rather than against zero.
      const host = await admin.from("categories").select("id, series_code").limit(1).maybeSingle();
      if (!host.data) {
        check(
          "a catalog category exists to host the shop fixture",
          false,
          "run the catalog import first",
        );
      } else {
      const SHOP_SKY_ID = "SKY-9998";
      const fixture = await admin.from("skylanders").upsert(
        {
          sky_id: SHOP_SKY_ID,
          name: "RLS Shop Fixture",
          slug: "rls-shop-fixture",
          series_code: host.data.series_code,
          category_id: host.data.id,
          is_active: false,
        },
        { onConflict: "sky_id" },
      );
      check(
        "the permanent shop fixture figure exists and is inactive",
        !fixture.error,
        fixture.error ? fixture.error.message : `${SHOP_SKY_ID} ready`,
      );

      // userA becomes the shop admin, userB stays an ordinary collector. The
      // grant runs through the service role, exactly as the later tool will.
      const grant = await admin
        .from("shop_admins")
        .upsert({ user_id: userA.user.id, note: "verify-rls fixture" });
      check(
        "the service role can grant the shop admin role",
        !grant.error,
        grant.error ? grant.error.message : "granted",
      );

      const stockOf = async (condition: string): Promise<{ id: number; quantity: number } | null> => {
        const row = await admin
          .from("shop_inventory")
          .select("id, quantity")
          .eq("sky_id", SHOP_SKY_ID)
          .eq("condition", condition)
          .maybeSingle();
        return row.data ? { id: row.data.id as number, quantity: row.data.quantity as number } : null;
      };
      const movementCount = async (inventoryId: number): Promise<number> => {
        const { count } = await admin
          .from("inventory_movements")
          .select("id", { count: "exact", head: true })
          .eq("inventory_id", inventoryId);
        return count ?? -1;
      };

      // ---------------------------------------------------- 9.1 authorization
      for (const [label, client] of [["an authenticated user", b], ["anonymous", anon]] as const) {
        for (const table of ["shop_admins", "shop_inventory", "inventory_movements"] as const) {
          const read = await client.from(table).select("*").limit(1);
          check(
            `${label} cannot read ${table}`,
            !!read.error || read.data?.length === 0,
            read.error ? `rejected: ${read.error.code}` : `${read.data?.length ?? 0} row(s)`,
          );
        }
      }

      const selfGrant = await b.from("shop_admins").insert({ user_id: userB.user.id });
      check(
        "an authenticated user cannot make themselves a shop admin",
        !!selfGrant.error,
        selfGrant.error ? `rejected: ${selfGrant.error.code}` : "INSERT SUCCEEDED - PRIVILEGE ESCALATION",
      );

      const directStock = await b
        .from("shop_inventory")
        .insert({ sky_id: SHOP_SKY_ID, condition: "loose", quantity: 5 });
      check(
        "an authenticated user cannot write stock directly",
        !!directStock.error,
        directStock.error ? `rejected: ${directStock.error.code}` : "INSERT SUCCEEDED - RLS HOLE",
      );

      const nonAdminMove = await b.rpc("record_inventory_movement", {
        p_sky_id: SHOP_SKY_ID, p_condition: "loose", p_delta: 1, p_reason: "purchase",
      });
      check(
        "an authenticated user cannot book a movement (is_shop_admin gate)",
        !!nonAdminMove.error,
        nonAdminMove.error ? `rejected: ${nonAdminMove.error.code}` : "RPC SUCCEEDED - AUTHORIZATION HOLE",
      );

      const nonAdminListing = await b.rpc("set_shop_listing", {
        p_sky_id: SHOP_SKY_ID, p_condition: "loose", p_sale_price: 1, p_is_listed: false,
      });
      check(
        "an authenticated user cannot set a listing",
        !!nonAdminListing.error,
        nonAdminListing.error ? `rejected: ${nonAdminListing.error.code}` : "RPC SUCCEEDED - AUTHORIZATION HOLE",
      );

      // The system path is separated by EXECUTE privilege, not by a check
      // inside the function - so a client is refused before the body runs.
      for (const [label, client] of [["an authenticated user", b], ["anonymous", anon]] as const) {
        const systemPath = await client.rpc("system_record_inventory_movement", {
          p_sky_id: SHOP_SKY_ID, p_condition: "loose", p_delta: 1, p_reason: "initial_import",
        });
        check(
          `${label} cannot use the system import path`,
          !!systemPath.error,
          systemPath.error ? `rejected: ${systemPath.error.code}` : "RPC SUCCEEDED - SYSTEM PATH EXPOSED",
        );
      }

      const internal = await a.rpc("apply_inventory_movement", {
        p_sky_id: SHOP_SKY_ID, p_condition: "loose", p_delta: 1, p_reason: "purchase",
        p_unit_cost: null, p_currency: null, p_note: null, p_created_by: userB.user.id,
      });
      check(
        "even a shop admin cannot call the internal mutation directly",
        !!internal.error,
        internal.error ? `rejected: ${internal.error.code}` : "RPC SUCCEEDED - created_by IS FORGEABLE",
      );

      // -------------------------------------------------------- 9.2 movements
      // Measured as deltas against whatever earlier runs left behind.
      const before = await stockOf("loose");
      const q0 = before?.quantity ?? 0;
      const m0 = before ? await movementCount(before.id) : 0;

      const buy = await a.rpc("record_inventory_movement", {
        p_sky_id: SHOP_SKY_ID, p_condition: "loose", p_delta: 3, p_reason: "purchase",
        p_unit_cost: 4.5, p_currency: "EUR", p_note: "verify-rls",
      });
      const afterBuy = await stockOf("loose");
      check(
        "a shop admin can book a purchase of 3",
        !buy.error && afterBuy?.quantity === q0 + 3,
        buy.error ? buy.error.message : `quantity ${q0} -> ${afterBuy?.quantity ?? "-"}`,
      );
      const inventoryId = afterBuy?.id ?? -1;

      const derived = await admin
        .from("shop_inventory")
        .select("quantity, reserved, available_quantity")
        .eq("id", inventoryId)
        .maybeSingle();
      check(
        "available_quantity is derived, not stored twice",
        derived.data?.available_quantity ===
          (derived.data?.quantity ?? 0) - (derived.data?.reserved ?? 0),
        `available=${derived.data?.available_quantity ?? "-"}`,
      );

      const sell = await a.rpc("record_inventory_movement", {
        p_sky_id: SHOP_SKY_ID, p_condition: "loose", p_delta: -1, p_reason: "sale_external",
      });
      const afterSell = await stockOf("loose");
      check(
        "an external sale of 1 takes it back down by one",
        !sell.error && afterSell?.quantity === q0 + 2,
        sell.error ? sell.error.message : `quantity=${afterSell?.quantity ?? "-"}`,
      );

      const oversell = await a.rpc("record_inventory_movement", {
        p_sky_id: SHOP_SKY_ID, p_condition: "loose", p_delta: -(q0 + 50), p_reason: "sale_skyisles",
      });
      const afterOversell = await stockOf("loose");
      check(
        "selling more than there is, is refused",
        !!oversell.error,
        oversell.error ? `rejected: ${oversell.error.code}` : "RPC SUCCEEDED - NEGATIVE STOCK",
      );
      check(
        "the refused sale changed nothing (transaction rolled back)",
        afterOversell?.quantity === q0 + 2,
        `quantity=${afterOversell?.quantity ?? "-"}`,
      );
      check(
        "the refused sale left no journal row either",
        (await movementCount(inventoryId)) === m0 + 2,
        `${await movementCount(inventoryId)} row(s), expected ${m0 + 2}`,
      );

      const actor = await admin
        .from("inventory_movements")
        .select("created_by")
        .eq("inventory_id", inventoryId)
        .eq("reason", "purchase")
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle();
      check(
        "created_by is the acting admin, taken from the request",
        actor.data?.created_by === userA.user.id,
        `created_by=${actor.data?.created_by ?? "null"}`,
      );

      // -------------------------------------------------------- 9.3 cost basis
      const costNoCurrency = await a.rpc("record_inventory_movement", {
        p_sky_id: SHOP_SKY_ID, p_condition: "loose", p_delta: 1, p_reason: "purchase",
        p_unit_cost: 3, p_currency: null,
      });
      check(
        "a unit_cost without a currency is refused",
        !!costNoCurrency.error,
        costNoCurrency.error ? `rejected: ${costNoCurrency.error.code}` : "RPC SUCCEEDED - CHECK MISSING",
      );

      const costOnSale = await a.rpc("record_inventory_movement", {
        p_sky_id: SHOP_SKY_ID, p_condition: "loose", p_delta: -1, p_reason: "sale_external",
        p_unit_cost: 3, p_currency: "EUR",
      });
      check(
        "a cost on anything but a purchase is refused",
        !!costOnSale.error,
        costOnSale.error ? `rejected: ${costOnSale.error.code}` : "RPC SUCCEEDED - CHECK MISSING",
      );

      const costFree = await a.rpc("record_inventory_movement", {
        p_sky_id: SHOP_SKY_ID, p_condition: "loose", p_delta: 1, p_reason: "purchase",
      });
      check(
        "a purchase without a known cost is allowed",
        !costFree.error,
        costFree.error ? costFree.error.message : "accepted",
      );

      // --------------------------------------------------------- 9.4 reserved
      const held = (await stockOf("loose"))?.quantity ?? 0;
      await admin.from("shop_inventory").update({ reserved: held }).eq("id", inventoryId);

      const belowReserved = await a.rpc("record_inventory_movement", {
        p_sky_id: SHOP_SKY_ID, p_condition: "loose", p_delta: -1, p_reason: "sale_external",
      });
      check(
        "stock cannot be taken below what is reserved",
        !!belowReserved.error,
        belowReserved.error ? `rejected: ${belowReserved.error.code}` : "RPC SUCCEEDED - RESERVATION IGNORED",
      );

      const overReserve = await admin
        .from("shop_inventory")
        .update({ reserved: held + 1 })
        .eq("id", inventoryId);
      check(
        "reserved cannot exceed quantity",
        !!overReserve.error,
        overReserve.error ? `rejected: ${overReserve.error.code}` : "UPDATE SUCCEEDED - CHECK MISSING",
      );

      const negativeReserved = await admin
        .from("shop_inventory")
        .update({ reserved: -1 })
        .eq("id", inventoryId);
      check(
        "reserved cannot go negative",
        !!negativeReserved.error,
        negativeReserved.error ? `rejected: ${negativeReserved.error.code}` : "UPDATE SUCCEEDED - CHECK MISSING",
      );
      await admin.from("shop_inventory").update({ reserved: 0 }).eq("id", inventoryId);

      // ---------------------------------------------------- 9.5 initial_import
      const importCost = await a.rpc("record_inventory_movement", {
        p_sky_id: SHOP_SKY_ID, p_condition: "boxed", p_delta: 1, p_reason: "initial_import",
        p_unit_cost: 1, p_currency: "EUR",
      });
      check(
        "initial_import refuses a cost basis",
        !!importCost.error,
        importCost.error ? `rejected: ${importCost.error.code}` : "RPC SUCCEEDED - CHECK MISSING",
      );

      const importNegative = await a.rpc("record_inventory_movement", {
        p_sky_id: SHOP_SKY_ID, p_condition: "boxed", p_delta: -1, p_reason: "initial_import",
      });
      check(
        "initial_import refuses a negative delta",
        !!importNegative.error,
        importNegative.error ? `rejected: ${importNegative.error.code}` : "RPC SUCCEEDED - CHECK MISSING",
      );

      // Booked on the first run ever; refused with 23505 on every run after —
      // both outcomes prove the partial unique index is in place.
      const systemImport = await admin.rpc("system_record_inventory_movement", {
        p_sky_id: SHOP_SKY_ID, p_condition: "boxed", p_delta: 7, p_reason: "initial_import",
        p_note: "verify-rls opening balance",
      });
      check(
        "the system path books the opening balance, or it is already booked",
        !systemImport.error || systemImport.error.code === "23505",
        systemImport.error ? `already booked: ${systemImport.error.code}` : `movement ${systemImport.data}`,
      );

      if (!systemImport.error) {
        const systemActor = await admin
          .from("inventory_movements")
          .select("created_by")
          .eq("id", systemImport.data)
          .maybeSingle();
        check(
          "a system movement records no actor rather than inventing one",
          systemActor.data?.created_by === null,
          `created_by=${systemActor.data?.created_by ?? "null"}`,
        );
      } else {
        const systemActor = await admin
          .from("inventory_movements")
          .select("created_by")
          .eq("reason", "initial_import")
          .limit(1)
          .maybeSingle();
        check(
          "a system movement records no actor rather than inventing one",
          systemActor.data?.created_by === null,
          `created_by=${systemActor.data?.created_by ?? "null"}`,
        );
      }

      const secondImport = await admin.rpc("system_record_inventory_movement", {
        p_sky_id: SHOP_SKY_ID, p_condition: "boxed", p_delta: 7, p_reason: "initial_import",
      });
      check(
        "a second opening balance for the same position is refused (idempotent import)",
        secondImport.error?.code === "23505",
        secondImport.error ? `rejected: ${secondImport.error.code}` : "RPC SUCCEEDED - IMPORT WOULD DOUBLE STOCK",
      );

      // ----------------------------------------------------- 9.6 schema guards
      const dupe = await admin
        .from("shop_inventory")
        .insert({ sky_id: SHOP_SKY_ID, condition: "loose" });
      check(
        "(sky_id, condition) is unique",
        !!dupe.error,
        dupe.error ? `rejected: ${dupe.error.code}` : "INSERT SUCCEEDED - DUPLICATE POSITION",
      );

      const badCondition = await admin
        .from("shop_inventory")
        .insert({ sky_id: SHOP_SKY_ID, condition: "sealed" });
      check(
        "a condition outside loose/boxed is refused",
        !!badCondition.error,
        badCondition.error ? `rejected: ${badCondition.error.code}` : "INSERT SUCCEEDED - CHECK MISSING",
      );

      const negativeQuantity = await admin
        .from("shop_inventory")
        .update({ quantity: -1 })
        .eq("id", inventoryId);
      check(
        "quantity cannot go negative",
        !!negativeQuantity.error,
        negativeQuantity.error ? `rejected: ${negativeQuantity.error.code}` : "UPDATE SUCCEEDED - CHECK MISSING",
      );

      const freePrice = await a.rpc("set_shop_listing", {
        p_sky_id: SHOP_SKY_ID, p_condition: "loose", p_sale_price: 0, p_is_listed: false,
      });
      check(
        "a sale price of 0 is refused, as with market_price",
        !!freePrice.error,
        freePrice.error ? `rejected: ${freePrice.error.code}` : "RPC SUCCEEDED - CHECK MISSING",
      );

      const listedWithoutPrice = await a.rpc("set_shop_listing", {
        p_sky_id: SHOP_SKY_ID, p_condition: "loose", p_sale_price: null, p_is_listed: true,
      });
      check(
        "listing without a price is refused",
        !!listedWithoutPrice.error,
        listedWithoutPrice.error ? `rejected: ${listedWithoutPrice.error.code}` : "RPC SUCCEEDED - CHECK MISSING",
      );

      const quantityBeforeListing = (await stockOf("loose"))?.quantity ?? -1;
      const listing = await a.rpc("set_shop_listing", {
        p_sky_id: SHOP_SKY_ID, p_condition: "loose", p_sale_price: 12.5, p_is_listed: true,
        p_note: "verify-rls",
      });
      const listed = await admin
        .from("shop_inventory")
        .select("sale_price, is_listed, quantity, reserved")
        .eq("id", inventoryId)
        .maybeSingle();
      check(
        "a shop admin can price and list a position without touching stock",
        !listing.error &&
          listed.data?.is_listed === true &&
          listed.data?.quantity === quantityBeforeListing &&
          listed.data?.reserved === 0,
        listing.error ? listing.error.message : `price=${listed.data?.sale_price}, quantity=${listed.data?.quantity}`,
      );

      const zeroDelta = await a.rpc("record_inventory_movement", {
        p_sky_id: SHOP_SKY_ID, p_condition: "loose", p_delta: 0, p_reason: "correction",
      });
      check(
        "a movement of zero is refused",
        !!zeroDelta.error,
        zeroDelta.error ? `rejected: ${zeroDelta.error.code}` : "RPC SUCCEEDED - CHECK MISSING",
      );

      const badReason = await a.rpc("record_inventory_movement", {
        p_sky_id: SHOP_SKY_ID, p_condition: "loose", p_delta: 1, p_reason: "donation",
      });
      check(
        "an unknown movement reason is refused",
        !!badReason.error,
        badReason.error ? `rejected: ${badReason.error.code}` : "RPC SUCCEEDED - CHECK MISSING",
      );

      // ------------------------------------------- 9.7 identity and append-only
      const repoint = await admin
        .from("shop_inventory")
        .update({ condition: "boxed" })
        .eq("id", inventoryId);
      check(
        "a position cannot be re-pointed, not even by the service role",
        !!repoint.error,
        repoint.error ? `rejected: ${repoint.error.code}` : "UPDATE SUCCEEDED - HISTORY WOULD BE REWRITTEN",
      );

      const historyBefore = await movementCount(inventoryId);

      const movementUpdate = await admin
        .from("inventory_movements")
        .update({ delta: 99 })
        .eq("inventory_id", inventoryId);
      check(
        "a journal row cannot be updated, not even by the service role",
        !!movementUpdate.error,
        movementUpdate.error ? `rejected: ${movementUpdate.error.code}` : "UPDATE SUCCEEDED - JOURNAL IS NOT APPEND-ONLY",
      );

      const movementDelete = await admin
        .from("inventory_movements")
        .delete()
        .eq("inventory_id", inventoryId);
      check(
        "a journal row cannot be deleted, not even by the service role",
        !!movementDelete.error,
        movementDelete.error ? `rejected: ${movementDelete.error.code}` : "DELETE SUCCEEDED - JOURNAL IS NOT APPEND-ONLY",
      );

      // The other way around history could vanish: take the position with it.
      // RESTRICT closes that route, so there is no path to a deleted journal.
      const positionDelete = await admin.from("shop_inventory").delete().eq("id", inventoryId);
      check(
        "a position with history cannot be deleted, not even by the service role",
        !!positionDelete.error,
        positionDelete.error ? `rejected: ${positionDelete.error.code}` : "DELETE SUCCEEDED - HISTORY WOULD VANISH",
      );

      check(
        "the history is still complete after all three attempts",
        (await movementCount(inventoryId)) === historyBefore,
        `${await movementCount(inventoryId)} row(s), expected ${historyBefore}`,
      );

      // ------------------------------- 9.8 the one permitted change: the actor
      const actorSwap = await admin
        .from("inventory_movements")
        .update({ created_by: userB.user.id })
        .eq("inventory_id", inventoryId)
        .eq("reason", "purchase");
      check(
        "the actor cannot be swapped for someone else",
        !!actorSwap.error,
        actorSwap.error ? `rejected: ${actorSwap.error.code}` : "UPDATE SUCCEEDED - ACTOR IS FORGEABLE",
      );

      const boxed = await stockOf("boxed");
      const actorFill = await admin
        .from("inventory_movements")
        .update({ created_by: userA.user.id })
        .eq("inventory_id", boxed?.id ?? -1)
        .is("created_by", null);
      check(
        "an anonymised movement cannot be given an actor again",
        !!actorFill.error,
        actorFill.error ? `rejected: ${actorFill.error.code}` : "UPDATE SUCCEEDED - ACTOR IS FORGEABLE",
      );

      for (const [column, value] of [
        ["note", "tampered"],
        ["delta", 99],
        ["reason", "correction"],
      ] as const) {
        const tamper = await admin
          .from("inventory_movements")
          .update({ [column]: value })
          .eq("inventory_id", inventoryId);
        check(
          `a movement's ${column} cannot be changed`,
          !!tamper.error,
          tamper.error ? `rejected: ${tamper.error.code}` : "UPDATE SUCCEEDED - HISTORY IS MUTABLE",
        );
      }

      const anonWithChange = await admin
        .from("inventory_movements")
        .update({ created_by: null, note: "tampered" })
        .eq("inventory_id", inventoryId)
        .eq("reason", "purchase");
      check(
        "anonymising cannot smuggle a second change along with it",
        !!anonWithChange.error,
        anonWithChange.error ? `rejected: ${anonWithChange.error.code}` : "UPDATE SUCCEEDED - HISTORY IS MUTABLE",
      );

      // The real foreign-key path: an account that booked something is deleted.
      // Its history has to survive, minus the personal identifier.
      userC = await createSignedInUser(admin, USER_C);
      await admin.from("shop_admins").upsert({ user_id: userC.user.id, note: "verify-rls fixture" });

      const cMovement = await userC.client.rpc("record_inventory_movement", {
        p_sky_id: SHOP_SKY_ID, p_condition: "loose", p_delta: 1, p_reason: "correction",
        p_note: "verify-rls anonymisation",
      });
      const cRowBefore = await admin
        .from("inventory_movements")
        .select("id, inventory_id, delta, reason, unit_cost, currency, note, created_at, created_by")
        .eq("id", cMovement.data ?? -1)
        .maybeSingle();
      check(
        "a third admin books one movement, to be anonymised next",
        !cMovement.error && cRowBefore.data?.created_by === userC.user.id,
        cMovement.error ? cMovement.error.message : `movement ${cMovement.data}`,
      );

      const cDelete = await admin.auth.admin.deleteUser(userC.user.id);
      check(
        "an account with booking history can be deleted",
        !cDelete.error,
        cDelete.error ? `${cDelete.error.message} (status ${cDelete.error.status ?? "?"})` : "deleted",
      );
      if (!cDelete.error) userC = null;

      const cRowAfter = await admin
        .from("inventory_movements")
        .select("id, inventory_id, delta, reason, unit_cost, currency, note, created_at, created_by")
        .eq("id", cMovement.data ?? -1)
        .maybeSingle();
      check(
        "the movement survives the account deletion",
        !!cRowAfter.data,
        cRowAfter.data ? `movement ${cRowAfter.data.id} still there` : "MOVEMENT VANISHED",
      );
      check(
        "created_by is anonymised to NULL",
        cRowAfter.data?.created_by === null,
        `created_by=${cRowAfter.data?.created_by ?? "null"}`,
      );

      const unchanged = (["inventory_id", "delta", "reason", "unit_cost", "currency", "note", "created_at"] as const)
        .filter((column) => cRowBefore.data?.[column] !== cRowAfter.data?.[column]);
      check(
        "every factual column is untouched by the anonymisation",
        cRowAfter.data !== null && unchanged.length === 0,
        unchanged.length === 0 ? "inventory_id, delta, reason, unit_cost, currency, note, created_at" : `changed: ${unchanged.join(", ")}`,
      );

      // ---------------------------------------------------- 9.9 reconciliation
      const drift = await admin
        .from("shop_inventory_reconciliation")
        .select("sky_id, condition, quantity, movement_sum, drift")
        .neq("drift", 0);
      check(
        "stock and journal agree everywhere (no drift)",
        !drift.error && (drift.data?.length ?? 0) === 0,
        drift.error ? drift.error.message : `${drift.data?.length ?? 0} position(s) with drift`,
      );

      const anonDrift = await anon.from("shop_inventory_reconciliation").select("*").limit(1);
      check(
        "the reconciliation view is not public",
        !!anonDrift.error || anonDrift.data?.length === 0,
        anonDrift.error ? `rejected: ${anonDrift.error.code}` : `${anonDrift.data?.length ?? 0} row(s)`,
      );
      }
    }
  } finally {
    // ------------------------------------------------------------- teardown
    console.log("\nTeardown");
    const admin2 = serviceClient();

    for (const [label, u] of [["A", userA], ["B", userB], ["C", userC]] as const) {
      if (!u) {
        console.log(`  test user ${label} cleanup: ok (already removed)`);
        continue;
      }
      await admin2.from("collection_items").delete().eq("user_id", u.user.id);
      const del = await admin2.auth.admin.deleteUser(u.user.id);
      if (!del.error) {
        console.log(`  test user ${label} cleanup: ok`);
        continue;
      }
      // The admin API answers with a bare "Database error deleting user", so
      // name what is still pointing at the account instead.
      const blocking = await admin2
        .from("inventory_movements")
        .select("id", { count: "exact", head: true })
        .eq("created_by", u.user.id);
      console.log(
        `  test user ${label} cleanup: FAILED - ${del.error.message} ` +
          `(status ${del.error.status ?? "?"}, id ${u.user.id}, ` +
          `${blocking.count ?? "?"} movement(s) still reference it)`,
      );
    }

    // The shop admin grant goes (it also cascades with the user anyway). The
    // shop fixture itself stays: its journal is append-only and its positions
    // carry history, so nothing there can be removed — by design. SKY-9998 is
    // inactive and outside every catalog and collection query.
    await admin2.from("shop_admins").delete().eq("note", "verify-rls fixture");

    await admin2.from("skylanders").delete().eq("sky_id", TEST_SKY_ID);
    // With the figure gone nothing references the character any more, so the
    // restrict constraint lets it go.
    await admin2.from("characters").delete().eq("canonical_name", TEST_CHARACTER);
    if (categoryId !== null) await admin2.from("categories").delete().eq("id", categoryId);
    await admin2.from("series").delete().eq("code", TEST_SERIES.code);
    console.log("  catalog fixture removed");

    const counts = await Promise.all(
      ([
        "series", "categories", "skylanders", "profiles", "collection_items",
        "characters", "shop_admins", "shop_inventory", "inventory_movements",
      ] as const).map(
        async (table) => {
          const { count } = await admin2.from(table).select("*", { count: "exact", head: true });
          return `${table}=${count ?? "?"}`;
        },
      ),
    );
    console.log(`  row counts after cleanup: ${counts.join(", ")}`);
  }

  // ------------------------------------------------------------------ report
  const failed = results.filter((r) => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) {
    console.log("\nFAILED:");
    for (const f of failed) console.log(`  - ${f.name}${f.detail ? `  (${f.detail})` : ""}`);
    process.exit(1);
  }
  console.log("Functional RLS verification passed.\n");
}

main().catch((error: unknown) => {
  console.error("\nVerification aborted:", error instanceof Error ? error.message : error);
  process.exit(1);
});
