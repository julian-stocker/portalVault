/**
 * Functional verification of the editorial layer (migration 0004).
 *
 * The counterpart to `verify:rls`, for what 0004 adds. Structural tests read
 * the SQL and prove it says the right thing; this script proves the database
 * DOES the right thing, with real anonymous, user and administrator sessions.
 *
 *   npm run verify:editorial
 *
 * It answers the question that made this migration change shape: a table
 * grant is column-blind, so "the app never selects admin_note" is not an
 * argument. Here the anonymous client asks for it directly.
 *
 * Roles, deliberately separated:
 *   service role  only to seed fixtures, create the two users, grant and
 *                 revoke the administrator row, and clean up. Never for an
 *                 assertion — it bypasses RLS and would prove nothing.
 *   anon key      + real JWTs for every assertion.
 *
 * Idempotent and self-cleaning: it removes both users, the administrator row
 * and every fixture, including the ones a failed run left behind.
 *
 * Run it AFTER 0004 has been applied. Before that it fails on the first
 * missing column, which is the correct answer.
 */
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

const RUN = Date.now();
const TEST_SERIES = { code: "TSTE", label: "Editorial Test Series", release_year: 2026, position: 98 };
const TEST_CATEGORY = { name: "Editorial Test Category", position: 0 };
// SKY-9995/9996 rather than 9997/9998: an earlier verify:rls run left
// SKY-9998 behind (the failed teardown of 2026-09-05), and a fixture that
// collides with another fixture is a fixture that cannot run.
const VISIBLE = { sky_id: "SKY-9995", name: "Editorial Visible", slug: `editorial-visible-${RUN}` };
const HIDDEN = { sky_id: "SKY-9996", name: "Editorial Hidden", slug: `editorial-hidden-${RUN}` };
const USER = { email: `editorial-user-${RUN}@portalvault.test`, password: `U-${RUN}-xK9!pQ` };
const ADMIN = { email: `editorial-admin-${RUN}@portalvault.test`, password: `A-${RUN}-mV4!zT` };
const NOTE = "internal: bought as a lot, do not publish";

type Result = { name: string; passed: boolean; detail: string };
const results: Result[] = [];

function check(name: string, passed: boolean, detail = ""): void {
  results.push({ name, passed, detail });
  console.log(`  ${passed ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

function heading(text: string): void {
  console.log(`\n${text}\n${"-".repeat(text.length)}`);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. Run through npm, which loads .env.local.`);
    process.exit(1);
  }
  return value;
}

const URL = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const ANON = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

const anonClient = () =>
  createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const serviceClient = () =>
  createClient(URL, requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

async function signedInUser(
  admin: SupabaseClient,
  credentials: { email: string; password: string },
): Promise<{ client: SupabaseClient; user: User }> {
  const created = await admin.auth.admin.createUser({
    email: credentials.email,
    password: credentials.password,
    email_confirm: true,
  });
  if (created.error) throw new Error(`createUser: ${created.error.message}`);

  const client = anonClient();
  const signIn = await client.auth.signInWithPassword(credentials);
  if (signIn.error) throw new Error(`signIn: ${signIn.error.message}`);
  return { client, user: created.data.user };
}

/** True when the call was refused, whatever the wording of the refusal. */
function refused(error: { message: string } | null, data: unknown): boolean {
  if (error) return true;
  // PostgREST answers a policy miss with an empty result rather than an error.
  return Array.isArray(data) ? data.length === 0 : data === null;
}

async function main(): Promise<void> {
  const admin = serviceClient();
  let categoryId: number | null = null;
  let user: Awaited<ReturnType<typeof signedInUser>> | null = null;
  let boss: Awaited<ReturnType<typeof signedInUser>> | null = null;

  try {
    heading("Setup (service role)");
    // Idempotent: a previous run that died between seed and cleanup must not
    // block this one.
    await admin.from("catalog_editorial").delete().in("sky_id", [VISIBLE.sky_id, HIDDEN.sky_id]);
    await admin.from("skylanders").delete().in("sky_id", [VISIBLE.sky_id, HIDDEN.sky_id]);
    await admin.from("categories").delete().eq("series_code", TEST_SERIES.code);
    await admin.from("series").delete().eq("code", TEST_SERIES.code);

    const series = await admin.from("series").insert(TEST_SERIES).select().single();
    if (series.error) throw new Error(`seed series: ${series.error.message}`);

    const category = await admin
      .from("categories")
      .insert({ ...TEST_CATEGORY, series_code: TEST_SERIES.code })
      .select()
      .single();
    if (category.error) throw new Error(`seed category: ${category.error.message}`);
    categoryId = category.data.id as number;

    const figures = await admin.from("skylanders").insert([
      { ...VISIBLE, series_code: TEST_SERIES.code, category_id: categoryId, catalog_visible: true },
      { ...HIDDEN, series_code: TEST_SERIES.code, category_id: categoryId, catalog_visible: false },
    ]);
    if (figures.error) throw new Error(`seed figures: ${figures.error.message}`);
    console.log("  one visible figure, one hidden figure, one test category");

    user = await signedInUser(admin, USER);
    boss = await signedInUser(admin, ADMIN);
    const grant = await admin.from("shop_admins").insert({ user_id: boss.user.id, note: "verify:editorial" });
    if (grant.error) throw new Error(`grant admin: ${grant.error.message}`);
    console.log("  one normal user, one administrator");

    // The note has to exist before anyone tries to read it.
    const seedNote = await admin
      .from("catalog_editorial")
      .insert({ sky_id: HIDDEN.sky_id, admin_note: NOTE });
    if (seedNote.error) throw new Error(`seed note: ${seedNote.error.message}`);

    // ------------------------------------------------------------------ anon
    heading("Anonymous client");
    const anon = anonClient();

    const anonVisible = await anon.from("skylanders").select("sky_id").eq("sky_id", VISIBLE.sky_id);
    check("reads a visible figure", !anonVisible.error && (anonVisible.data ?? []).length === 1);

    const anonHidden = await anon.from("skylanders").select("sky_id").eq("sky_id", HIDDEN.sky_id);
    check("cannot read a hidden figure", refused(anonHidden.error, anonHidden.data));

    const anonStar = await anon.from("skylanders").select("*").eq("sky_id", VISIBLE.sky_id).single();
    check(
      "select=* carries no internal column",
      !anonStar.error && !("admin_note" in (anonStar.data ?? {})) && !("edited_by" in (anonStar.data ?? {})),
      anonStar.data ? Object.keys(anonStar.data).join(",") : "",
    );

    const anonNote = await anon.from("catalog_editorial").select("admin_note");
    check("cannot read catalog_editorial", refused(anonNote.error, anonNote.data));

    const anonJournal = await anon.from("catalog_admin_changes").select("id");
    check("cannot read catalog_admin_changes", refused(anonJournal.error, anonJournal.data));

    for (const [label, run] of [
      ["insert catalog_admin_changes", () => anon.from("catalog_admin_changes").insert({ entity: "skylander", entity_id: VISIBLE.sky_id, field: "admin_note" }).select()],
      ["update catalog_admin_changes", () => anon.from("catalog_admin_changes").update({ new_value: "x" }).eq("id", 1).select()],
      ["delete catalog_admin_changes", () => anon.from("catalog_admin_changes").delete().eq("id", 1).select()],
      ["update skylanders", () => anon.from("skylanders").update({ catalog_visible: false }).eq("sky_id", VISIBLE.sky_id).select()],
      ["update categories.catalog_group", () => anon.from("categories").update({ catalog_group: "item" }).eq("id", categoryId!).select()],
      ["insert catalog_editorial", () => anon.from("catalog_editorial").insert({ sky_id: VISIBLE.sky_id, admin_note: "x" }).select()],
    ] as const) {
      const r = await run();
      check(`cannot ${label}`, refused(r.error, r.data), r.error?.message.slice(0, 40) ?? "");
    }

    const anonRpc = await anon.rpc("admin_set_catalog_visible", { p_sky_id: VISIBLE.sky_id, p_visible: false });
    check("cannot call an admin function", anonRpc.error !== null, anonRpc.error?.message.slice(0, 40) ?? "");

    // --------------------------------------------------------- normal user
    heading("Signed-in user without the permission");
    const u = user.client;

    const userHidden = await u.from("skylanders").select("sky_id").eq("sky_id", HIDDEN.sky_id);
    check("cannot read a hidden figure they do not own", refused(userHidden.error, userHidden.data));

    const userNote = await u.from("catalog_editorial").select("admin_note");
    check("cannot read catalog_editorial", refused(userNote.error, userNote.data));

    const userJournal = await u.from("catalog_admin_changes").select("id");
    check("cannot read catalog_admin_changes", refused(userJournal.error, userJournal.data));

    const userIsAdmin = await u.rpc("is_shop_admin");
    check("is_shop_admin() says false", !userIsAdmin.error && userIsAdmin.data === false);

    const userRpc = await u.rpc("admin_set_catalog_visible", { p_sky_id: VISIBLE.sky_id, p_visible: false });
    check("admin function refuses them", userRpc.error !== null, userRpc.error?.message.slice(0, 40) ?? "");

    const userNoteRpc = await u.rpc("admin_set_admin_note", { p_sky_id: VISIBLE.sky_id, p_value: "x" });
    check("note function refuses them", userNoteRpc.error !== null);

    const userGroupRpc = await u.rpc("admin_set_catalog_group", { p_category_id: categoryId, p_group: "item" });
    check("group function refuses them", userGroupRpc.error !== null);

    const userAudit = await u.rpc("admin_catalog_changes", { p_entity: "skylander", p_entity_id: HIDDEN.sky_id, p_limit: 5 });
    check("journal function refuses them", userAudit.error !== null);

    // ------------------------------------------------- owner of a hidden row
    heading("The owner of a figure that was hidden afterwards");
    const own = await u.from("collection_items").insert({ user_id: user.user.id, sky_id: HIDDEN.sky_id, quantity: 1 });
    check("can add it to their collection", own.error === null, own.error?.message.slice(0, 40) ?? "");

    const ownRow = await u.from("skylanders").select("sky_id, name, market_price, image_file").eq("sky_id", HIDDEN.sky_id);
    check(
      "now reads the hidden row with its product data",
      !ownRow.error && (ownRow.data ?? []).length === 1,
      ownRow.error?.message.slice(0, 40) ?? "",
    );

    const embedded = await u
      .from("collection_items")
      .select("sky_id, quantity, skylanders(name, market_price)")
      .eq("sky_id", HIDDEN.sky_id);
    check(
      "the collection query returns the figure, not a hole",
      !embedded.error && (embedded.data?.[0] as { skylanders?: unknown } | undefined)?.skylanders != null,
    );

    const stillNoNote = await u.from("catalog_editorial").select("admin_note").eq("sky_id", HIDDEN.sky_id);
    check("owning it still does not reveal the note", refused(stillNoNote.error, stillNoNote.data));

    // ------------------------------------------------------------- the admin
    heading("Administrator");
    const a = boss.client;

    const adminIsAdmin = await a.rpc("is_shop_admin");
    check("is_shop_admin() says true", !adminIsAdmin.error && adminIsAdmin.data === true);

    const adminHidden = await a.from("skylanders").select("sky_id").eq("sky_id", HIDDEN.sky_id);
    check("reads hidden figures", !adminHidden.error && (adminHidden.data ?? []).length === 1);

    const adminNote = await a.from("catalog_editorial").select("admin_note").eq("sky_id", HIDDEN.sky_id).single();
    check("reads the internal note", !adminNote.error && adminNote.data?.admin_note === NOTE);

    const setVisible = await a.rpc("admin_set_catalog_visible", { p_sky_id: HIDDEN.sky_id, p_visible: true });
    check("can show a hidden figure", setVisible.error === null, setVisible.error?.message.slice(0, 40) ?? "");

    const setName = await a.rpc("admin_set_display_name_override", { p_sky_id: VISIBLE.sky_id, p_value: "Neuer Name" });
    check("can set a display name override", setName.error === null);

    const resetName = await a.rpc("admin_set_display_name_override", { p_sky_id: VISIBLE.sky_id, p_value: "" });
    const afterReset = await admin.from("skylanders").select("display_name_override").eq("sky_id", VISIBLE.sky_id).single();
    check(
      "an empty value clears it",
      resetName.error === null && afterReset.data?.display_name_override === null,
    );

    const setNote = await a.rpc("admin_set_admin_note", { p_sky_id: VISIBLE.sky_id, p_value: "another note" });
    check("can write an internal note", setNote.error === null);

    const setGroup = await a.rpc("admin_set_catalog_group", { p_category_id: categoryId, p_group: "item" });
    check("can classify a category", setGroup.error === null);

    const badGroup = await a.rpc("admin_set_catalog_group", { p_category_id: categoryId, p_group: "not_a_group" });
    check("an unknown group is rejected by the CHECK", badGroup.error !== null);

    const journal = await a.rpc("admin_catalog_changes", { p_entity: "skylander", p_entity_id: VISIBLE.sky_id, p_limit: 10 });
    const fields = ((journal.data ?? []) as { field: string }[]).map((row) => row.field);
    check(
      "reads the journal, which recorded the edits",
      !journal.error && fields.includes("display_name_override") && fields.includes("admin_note"),
      fields.join(","),
    );

    const visibilityLogged = await a.rpc("admin_catalog_changes", { p_entity: "skylander", p_entity_id: HIDDEN.sky_id, p_limit: 10 });
    check(
      "a visibility change is recorded too",
      ((visibilityLogged.data ?? []) as { field: string }[]).some((row) => row.field === "catalog_visible"),
    );

    const groupLogged = await a.rpc("admin_catalog_changes", { p_entity: "category", p_entity_id: String(categoryId), p_limit: 10 });
    check(
      "so is a product group change",
      ((groupLogged.data ?? []) as { field: string }[]).some((row) => row.field === "catalog_group"),
    );

    // ---------------------------------------------------- append-only, truly
    heading("The journal is append-only, even for the service role");
    const anyRow = await admin.from("catalog_admin_changes").select("id").limit(1).single();
    if (!anyRow.error && anyRow.data) {
      const upd = await admin.from("catalog_admin_changes").update({ new_value: "tampered" }).eq("id", anyRow.data.id);
      check("service role cannot update a journal row", upd.error !== null, upd.error?.message.slice(0, 50) ?? "");
      const del = await admin.from("catalog_admin_changes").delete().eq("id", anyRow.data.id);
      check("service role cannot delete a journal row", del.error !== null, del.error?.message.slice(0, 50) ?? "");
    } else {
      check("journal has a row to test against", false, anyRow.error?.message ?? "empty");
    }

    // The one permitted UPDATE. Without it an account that ever edited the
    // catalog cannot be deleted at all: `changed_by` carries ON DELETE SET
    // NULL, and SET NULL is an UPDATE. Found the hard way — the first run of
    // this script left its administrator behind (ADR-0039).
    const beforeDelete = await admin
      .from("catalog_admin_changes")
      .select("id", { count: "exact", head: true })
      .eq("changed_by", boss.user.id);
    check(
      "the administrator left journal rows behind",
      (beforeDelete.count ?? 0) > 0,
      `${beforeDelete.count ?? 0} rows`,
    );
  } finally {
    heading("Cleanup (service role)");
    if (boss) {
      await admin.from("shop_admins").delete().eq("user_id", boss.user.id);
      // This is itself an assertion: deleting the administrator has to work,
      // which means the ON DELETE SET NULL on catalog_admin_changes.changed_by
      // has to get past the append-only trigger.
      const del = await admin.auth.admin.deleteUser(boss.user.id);
      check(
        "the administrator account can be deleted afterwards",
        del.error === null,
        del.error?.message ?? "",
      );
      if (!del.error) {
        const orphan = await admin
          .from("catalog_admin_changes")
          .select("id", { count: "exact", head: true })
          .eq("changed_by", boss.user.id);
        check("their journal rows survive, anonymised", (orphan.count ?? 0) === 0);
      }
    }
    if (user) {
      await admin.from("collection_items").delete().eq("user_id", user.user.id);
      await admin.auth.admin.deleteUser(user.user.id);
    }
    // The journal is append-only, so its rows outlive the fixtures. They
    // reference SKY-9997/9998 by text and hurt nothing; the figures go.
    await admin.from("catalog_editorial").delete().in("sky_id", [VISIBLE.sky_id, HIDDEN.sky_id]);
    await admin.from("skylanders").delete().in("sky_id", [VISIBLE.sky_id, HIDDEN.sky_id]);
    if (categoryId !== null) await admin.from("categories").delete().eq("id", categoryId);
    await admin.from("series").delete().eq("code", TEST_SERIES.code);
    console.log("  fixtures, users and the administrator row removed");
  }

  const failed = results.filter((r) => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) {
    console.log("\nFAILED:");
    for (const f of failed) console.log(`  - ${f.name}${f.detail ? `  (${f.detail})` : ""}`);
    process.exit(1);
  }
  console.log("Editorial verification passed.\n");
}

main().catch((error: unknown) => {
  console.error(`\nAborted: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
