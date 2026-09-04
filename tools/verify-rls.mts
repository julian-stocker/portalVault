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
  } finally {
    // ------------------------------------------------------------- teardown
    console.log("\nTeardown");
    const admin2 = serviceClient();

    for (const u of [userA, userB]) {
      if (!u) continue;
      await admin2.from("collection_items").delete().eq("user_id", u.user.id);
      const del = await admin2.auth.admin.deleteUser(u.user.id);
      console.log(`  auth user removed: ${del.error ? del.error.message : "ok"}`);
    }

    await admin2.from("skylanders").delete().eq("sky_id", TEST_SKY_ID);
    // With the figure gone nothing references the character any more, so the
    // restrict constraint lets it go.
    await admin2.from("characters").delete().eq("canonical_name", TEST_CHARACTER);
    if (categoryId !== null) await admin2.from("categories").delete().eq("id", categoryId);
    await admin2.from("series").delete().eq("code", TEST_SERIES.code);
    console.log("  catalog fixture removed");

    const counts = await Promise.all(
      (["series", "categories", "skylanders", "profiles", "collection_items", "characters"] as const).map(
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
