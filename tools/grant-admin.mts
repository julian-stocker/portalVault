/**
 * Grants and revokes the SkyIsles administrator permission.
 *
 *   npm run admin:grant -- --list                      who is an admin today
 *   npm run admin:grant -- --email <address>           dry run, writes nothing
 *   npm run admin:grant -- --email <address> --apply   writes
 *   npm run admin:grant -- --revoke <user-id> --apply  takes it back
 *
 * The permission is a row in `shop_admins`, keyed by the auth user id. Despite
 * its name that table is the general administrator permission today
 * (ADR-0039); `public.is_shop_admin()` is the only predicate that reads it.
 *
 * Why a local tool and not a page:
 *
 *   - `shop_admins` has no privileges for `anon` or `authenticated` and no RLS
 *     policy, so no client role can read or write it, ever. There is no
 *     "make me an admin" request to defend against, because there is no
 *     endpoint at all.
 *   - The only key that can write it is the service role, and that key exists
 *     exclusively in `.env.local` on the developer machine. It is not in
 *     Vercel and must never be (docs/DEPLOYMENT.md).
 *
 * No address appears in this file, in the scripts, or in the documentation.
 * The address is an argument, resolved to a user id, and only the id is
 * stored. Output masks the address; the id is printed in full, because the id
 * is what you are about to grant a permission to.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type Options = {
  email: string | null;
  revoke: string | null;
  list: boolean;
  apply: boolean;
};

function parseArgs(argv: readonly string[]): Options {
  const options: Options = { email: null, revoke: null, list: false, apply: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") options.apply = true;
    else if (arg === "--list") options.list = true;
    else if (arg === "--email") options.email = argv[++i] ?? null;
    else if (arg === "--revoke") options.revoke = argv[++i] ?? null;
    else if (arg.startsWith("--email=")) options.email = arg.slice("--email=".length);
    else if (arg.startsWith("--revoke=")) options.revoke = arg.slice("--revoke=".length);
    else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(1);
    }
  }
  return options;
}

/**
 * Keeps the first two characters and the domain, drops the rest.
 *
 * Enough to recognise the account you meant, not enough to be an address in
 * a log or a screenshot. No address is written anywhere in this file.
 */
function mask(email: string | undefined | null): string {
  if (!email) return "(no address)";
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  return `${local.slice(0, 2)}***@${domain}`;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. Run through npm, which loads .env.local.`);
    process.exit(1);
  }
  return value;
}

function serviceClient(): SupabaseClient {
  return createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

function heading(text: string): void {
  console.log(`\n${text}\n${"-".repeat(text.length)}`);
}

/** Every auth user, paged. Small installation; one page is normally enough. */
async function allUsers(client: SupabaseClient) {
  const users: { id: string; email?: string; created_at?: string; email_confirmed_at?: string }[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`list users: ${error.message}`);
    users.push(...data.users);
    if (data.users.length < 200) break;
  }
  return users;
}

async function currentAdmins(client: SupabaseClient) {
  const { data, error } = await client
    .from("shop_admins")
    .select("user_id, granted_at, note")
    .order("granted_at");
  if (error) throw new Error(`read shop_admins: ${error.message}`);
  return data ?? [];
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const client = serviceClient();

  if (options.list) {
    const [admins, users] = await Promise.all([currentAdmins(client), allUsers(client)]);
    const byId = new Map(users.map((user) => [user.id, user]));
    heading(`Administrators (${admins.length})`);
    if (admins.length === 0) console.log("  none");
    for (const admin of admins) {
      const user = byId.get(admin.user_id as string);
      console.log(`  ${admin.user_id as string}  ${mask(user?.email)}  since ${String(admin.granted_at).slice(0, 10)}`);
      if (admin.note) console.log(`      note: ${admin.note as string}`);
    }
    return;
  }

  if (options.revoke) {
    const admins = await currentAdmins(client);
    const held = admins.some((admin) => admin.user_id === options.revoke);
    heading("Revoke");
    console.log(`  user id:      ${options.revoke}`);
    console.log(`  is admin:     ${held ? "yes" : "no — nothing to revoke"}`);
    if (!held) return;
    if (!options.apply) {
      console.log("\n  DRY RUN - nothing was written. Re-run with --apply.");
      return;
    }
    const { error } = await client.from("shop_admins").delete().eq("user_id", options.revoke);
    if (error) throw new Error(`revoke: ${error.message}`);
    console.log("\n  Revoked.");
    return;
  }

  if (!options.email) {
    console.error(
      "Usage:\n" +
        "  npm run admin:grant -- --list\n" +
        "  npm run admin:grant -- --email <address> [--apply]\n" +
        "  npm run admin:grant -- --revoke <user-id> --apply",
    );
    process.exit(1);
  }

  const wanted = options.email.trim().toLowerCase();
  const users = await allUsers(client);
  const matches = users.filter((user) => (user.email ?? "").toLowerCase() === wanted);

  heading("Account");
  if (matches.length === 0) {
    console.error(`  No auth user with that address (${mask(options.email)}).`);
    console.error("  The business account signs up through /register like anyone else (ADR-0032).");
    process.exit(1);
  }
  if (matches.length > 1) {
    console.error(`  ${matches.length} users share that address. Refusing to guess.`);
    process.exit(1);
  }

  const user = matches[0];
  const admins = await currentAdmins(client);
  const already = admins.some((admin) => admin.user_id === user.id);

  // Everything that identifies the target, before anything is written.
  console.log(`  address:      ${mask(user.email)}`);
  console.log(`  user id:      ${user.id}`);
  console.log(`  created:      ${String(user.created_at ?? "?").slice(0, 10)}`);
  console.log(`  confirmed:    ${user.email_confirmed_at ? "yes" : "NO — the account cannot sign in yet"}`);
  console.log(`  is admin:     ${already ? "yes, already" : "no"}`);

  heading("Plan");
  if (already) {
    // Idempotent: the desired end state is "this user is an administrator".
    console.log("  Nothing to do — the permission is already granted.");
    return;
  }
  console.log(`  insert into shop_admins (user_id) values ('${user.id}')`);

  if (!options.apply) {
    console.log("\n  DRY RUN - nothing was written.");
    console.log("  Re-run with --apply to grant the permission.");
    return;
  }

  const { error } = await client
    .from("shop_admins")
    .upsert(
      // No address in the note either: the row identifies an account by id,
      // and a note is not a place to reintroduce one.
      { user_id: user.id, note: `granted via tools/grant-admin.mts on ${new Date().toISOString().slice(0, 10)}` },
      { onConflict: "user_id", ignoreDuplicates: true },
    );
  if (error) throw new Error(`grant: ${error.message}`);

  heading("Result");
  console.log("  Granted. is_shop_admin() is true for this user from the next request on.");
}

main().catch((error: unknown) => {
  console.error(`\nAborted: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
