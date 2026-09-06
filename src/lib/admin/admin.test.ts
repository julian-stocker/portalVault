import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The administration area's security, read from the source.
 *
 * These are questions about wiring — which predicate is asked, where, and
 * what happens when the answer is no. No rendered output would answer them,
 * and the environment has no DOM (ADR-0013). What the database enforces is
 * checked separately, against the migration text, further down.
 */
function source(path: string): string {
  return readFileSync(path, "utf8");
}

const ADAPTER = "src/lib/auth/admin.ts";
const LAYOUT = "src/app/(admin)/layout.tsx";
const ACTIONS = "src/lib/admin/actions.ts";
const MIGRATION = "supabase/migrations/0004_catalog_editorial.sql";

describe("the admin adapter", () => {
  const adapter = source(ADAPTER);

  it("asks the database, not the session or a claim", () => {
    expect(adapter).toContain('supabase.rpc("is_shop_admin")');
    expect(adapter).not.toMatch(/localStorage|cookies\(\)|headers\(\)|process\.env/);
  });

  it("says no for an anonymous request without asking", () => {
    // No session can ever be an admin; the round trip would only confirm it.
    expect(adapter).toContain("if (!(await currentUser())) return false;");
  });

  it("denies when the check itself fails", () => {
    // An error is not a permission. This is the line that decides whether a
    // database outage opens or closes the admin area.
    expect(adapter).toContain("if (error) return false;");
  });

  it("returns a real boolean, never a truthy value", () => {
    expect(adapter).toContain("return data === true;");
  });

  it("is memoised per request, like the user lookup", () => {
    expect(adapter).toContain("cache(async ()");
  });
});

describe("the admin route group", () => {
  const layout = source(LAYOUT);

  it("checks before anything below it renders", () => {
    expect(layout).toContain("if (!(await isAdmin())) notFound();");
  });

  it("answers 404, not 403", () => {
    // A "forbidden" page confirms that there is something to be forbidden.
    // Checked against the code, not the comment that explains the choice.
    const code = layout
      .split("\n")
      .filter((line) => !/^\s*(\*|\/\*|\/\/)/.test(line))
      .join("\n");
    expect(code).toContain("notFound()");
    expect(code).not.toMatch(/403|forbidden/i);
  });

  it("covers every admin page, because it is the group's layout", () => {
    // The check sits in (admin)/layout.tsx, so no page under it can forget
    // to ask. This test fails the moment a page moves out of the group.
    for (const page of [
      "src/app/(admin)/admin/page.tsx",
      "src/app/(admin)/admin/catalog/page.tsx",
      "src/app/(admin)/admin/catalog/[skyId]/page.tsx",
      "src/app/(admin)/admin/catalog/categories/page.tsx",
    ]) {
      expect(() => source(page), page).not.toThrow();
    }
  });
});

describe("editorial writes are guarded twice", () => {
  const actions = source(ACTIONS);
  const sql = source(MIGRATION);

  it("checks in the server action", () => {
    expect(actions).toContain("if (!(await isAdmin()))");
  });

  it("and again in every database function", () => {
    // The one that actually decides: a request that never touched the UI
    // still fails here.
    const functions = [
      "admin_set_catalog_visible",
      "admin_set_display_name_override",
      "admin_set_admin_note",
      "admin_set_catalog_group",
      "admin_catalog_changes",
    ];
    for (const name of functions) {
      const start = sql.indexOf(`create or replace function public.${name}`);
      expect(start, name).toBeGreaterThan(-1);
      const body = sql.slice(start, sql.indexOf("$$;", start));
      expect(body, name).toContain("if not public.is_shop_admin() then");
      expect(body, name).toContain("insufficient_privilege");
      expect(body, name).toContain("security definer");
      expect(body, name).toContain("set search_path = ''");
    }
  });

  it("grants execute to authenticated only, never to anon", () => {
    expect(sql).toMatch(/revoke all on function public\.admin_set_catalog_visible[^\n]*from public, anon;/);
    expect(sql).toMatch(/grant execute on function public\.admin_set_catalog_visible[^\n]*to authenticated;/);
    expect(sql).not.toMatch(/grant execute on function public\.admin_[^\n]*to anon/);
  });

  it("gives clients no table privilege on the catalog", () => {
    // The editorial columns are closed for the same reason the imported ones
    // are: nobody may write skylanders or categories through PostgREST.
    expect(sql).not.toMatch(/grant\s+(insert|update|delete)[^\n]*on public\.(skylanders|categories)/);
  });
});

/**
 * The column-level question (ADR-0039).
 *
 * `grant select on public.skylanders to anon` covers every column the table
 * will ever have, and RLS filters rows, not columns. Measured against the
 * running database on 2026-09-06: an anonymous client reads `select=*` and
 * gets all twelve columns. So an internal note on that table would have been
 * public — the draft of this migration had exactly that flaw.
 *
 * The functional proof runs in `npm run verify:editorial` against real
 * sessions. These tests hold the structure that makes it true.
 */
describe("internal data is not on a world-readable table", () => {
  const sql = source(MIGRATION);

  it("keeps admin_note off public.skylanders", () => {
    const block = sql.slice(sql.indexOf("alter table public.skylanders"), sql.indexOf("create index skylanders_public_catalog_idx"));
    expect(block).toContain("add column catalog_visible");
    expect(block).toContain("add column display_name_override");
    expect(block).not.toContain("admin_note");
    // And no author column either: who curates the catalog is not public.
    expect(block).not.toContain("edited_by");
  });

  it("gives the note a table of its own, closed to clients", () => {
    expect(sql).toContain("create table public.catalog_editorial");
    expect(sql).toContain("alter table public.catalog_editorial enable row level security;");
    expect(sql).toContain("revoke all on public.catalog_editorial from anon, authenticated;");
    // Two locks: anon holds nothing at all, authenticated meets the policy.
    expect(sql).toContain("grant select on public.catalog_editorial to authenticated;");
    expect(sql).toMatch(/create policy catalog_editorial_select_admin[\s\S]*using \(public\.is_shop_admin\(\)\)/);
    expect(sql).not.toMatch(/grant\s+(insert|update|delete)[^\n]*catalog_editorial/);
  });

  it("does not read the note through the public figure row", () => {
    const queries = source("src/lib/admin/queries.ts");
    const columns = queries.slice(queries.indexOf("const ADMIN_COLUMNS"), queries.indexOf(";", queries.indexOf("const ADMIN_COLUMNS")));
    expect(columns).not.toContain("admin_note");
    expect(queries).toContain('from("catalog_editorial")');
  });
});

describe("which rows a direct client may read", () => {
  const sql = source(MIGRATION);

  it("replaces the old 'every row for everyone' policy", () => {
    // It was `using (true)`, which was right while every row was public.
    expect(sql).toContain("drop policy skylanders_select_public on public.skylanders;");
  });

  it("shows an anonymous client the public catalog and nothing else", () => {
    const policy = sql.slice(
      sql.indexOf("create policy skylanders_select_anon"),
      sql.indexOf("create policy skylanders_select_authenticated"),
    );
    expect(policy).toContain("for select to anon");
    expect(policy).toContain("using (is_active and catalog_visible)");
    // anon has no EXECUTE on is_shop_admin(), so calling it here would turn
    // every anonymous catalog request into a permission error.
    expect(policy).not.toContain("is_shop_admin");
  });

  it("lets a signed-in user see what is public, what they own, or everything if admin", () => {
    const policy = sql.slice(
      sql.indexOf("create policy skylanders_select_authenticated"),
      sql.indexOf("-- series and categories keep"),
    );
    expect(policy).toContain("(is_active and catalog_visible)");
    expect(policy).toContain("or public.is_shop_admin()");
    expect(policy).toMatch(/from public\.collection_items ci[\s\S]*ci\.user_id = \(select auth\.uid\(\)\)/);
  });

  it("cannot recurse: the ownership branch reads a table that never reads back", () => {
    // collection_items' own policies compare auth.uid() to user_id and do not
    // mention skylanders, so there is no cycle between the two.
    const initial = source("supabase/migrations/0001_initial_schema.sql");
    const collectionPolicies = initial.slice(initial.indexOf("collection_items_select_own"));
    expect(collectionPolicies.slice(0, 400)).not.toContain("skylanders");
  });

  it("still keeps series and categories public", () => {
    // A product group is public catalog data (ADR-0041).
    expect(sql).not.toContain("drop policy categories_select_public");
    expect(sql).not.toContain("drop policy series_select_public");
  });
});

describe("the audit journal", () => {
  const sql = source(MIGRATION);

  it("is append-only, enforced by a trigger rather than a policy", () => {
    // RLS does not apply to the service role; triggers do.
    expect(sql).toContain("create trigger catalog_admin_changes_append_only");
    expect(sql).toContain("before update or delete on public.catalog_admin_changes");
    expect(sql).toContain("restrict_violation");
  });

  it("permits exactly one update: anonymising a deleted account", () => {
    // `changed_by` carries ON DELETE SET NULL, and SET NULL is an UPDATE. A
    // blanket refusal makes every account that ever edited the catalog
    // undeletable — the same defect ADR-0037 fixed for inventory_movements,
    // reproduced here and found by verify:editorial leaving an account
    // behind.
    const body = sql.slice(
      sql.indexOf("function public.prevent_catalog_change_edit"),
      sql.indexOf("$$;", sql.indexOf("function public.prevent_catalog_change_edit")),
    );
    expect(body).toContain("old.changed_by is not null");
    expect(body).toContain("new.changed_by is null");
    // Every factual column has to be unchanged, NULL-safely.
    expect(body).toContain("is not distinct from");
    for (const column of ["new.id", "new.entity", "new.entity_id", "new.field", "new.old_value", "new.new_value", "new.changed_at"]) {
      expect(body, column).toContain(column);
    }
  });

  it("still refuses every delete", () => {
    const body = sql.slice(
      sql.indexOf("function public.prevent_catalog_change_edit"),
      sql.indexOf("$$;", sql.indexOf("function public.prevent_catalog_change_edit")),
    );
    // The DELETE branch is the fall-through after the UPDATE branch.
    expect(body).toMatch(/raise exception[\s\S]*% on id % is not allowed/);
  });

  it("is written by the table, not by the application", () => {
    // No write path can forget to log, including a service-role script.
    expect(sql).toContain("create trigger skylanders_log_editorial");
    expect(sql).toContain("after update on public.skylanders");
    expect(sql).toContain("create trigger categories_log_group");
  });

  it("logs the note from its own table, since that is where it lives", () => {
    expect(sql).toContain("create trigger catalog_editorial_log_note");
    expect(sql).toContain("after insert or update on public.catalog_editorial");
  });

  it("records the three editorial fields and the product group", () => {
    for (const field of [
      "'catalog_visible'",
      "'display_name_override'",
      "'admin_note'",
      "'catalog_group'",
    ]) {
      expect(sql, field).toContain(field);
    }
  });

  it("is unreadable and unwritable for clients", () => {
    expect(sql).toContain("alter table public.catalog_admin_changes enable row level security;");
    expect(sql).toContain("revoke all on public.catalog_admin_changes from anon, authenticated;");
    // No policy exists, so RLS denies everything.
    expect(sql).not.toMatch(/create policy[^\n]*catalog_admin_changes/);
  });

  it("survives the person: changed_by is nulled, the row stays", () => {
    expect(sql).toContain("references auth.users (id) on delete set null");
  });
});

describe("the functional verifier", () => {
  const tool = source("tools/verify-editorial.mts");

  it("asserts with real sessions, never with the service role", () => {
    // The service role bypasses RLS; an assertion made with it proves
    // nothing. It seeds, grants, revokes and cleans up — that is all.
    expect(tool).toContain("anon key      + real JWTs for every assertion");
    expect(tool).toContain("signInWithPassword");
  });

  it("asks anonymously for the internal note, rather than assuming", () => {
    expect(tool).toContain('anon.from("catalog_editorial").select("admin_note")');
    expect(tool).toContain('anon.from("skylanders").select("*")');
  });

  it("covers the owner of a figure hidden after the fact", () => {
    expect(tool).toContain("now reads the hidden row with its product data");
    expect(tool).toContain("owning it still does not reveal the note");
  });

  it("cleans up the administrator row it granted", () => {
    expect(tool).toContain('admin.from("shop_admins").delete().eq("user_id", boss.user.id)');
  });

  it("treats deleting the administrator as an assertion, not a chore", () => {
    // The leftover account that exposed the trigger defect was found exactly
    // here: the cleanup failed silently.
    expect(tool).toContain("the administrator account can be deleted afterwards");
    expect(tool).toContain("their journal rows survive, anonymised");
  });
});

describe("the grant tool", () => {
  const tool = source("tools/grant-admin.mts");

  it("never carries an address in its source", () => {
    // The address is an argument, resolved to a user id. Nothing else.
    expect(tool).not.toMatch(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  });

  it("writes nothing without --apply", () => {
    expect(tool).toContain("DRY RUN - nothing was written");
    const applyGuards = [...tool.matchAll(/if \(!options\.apply\)/g)];
    expect(applyGuards.length).toBeGreaterThanOrEqual(2); // grant and revoke
  });

  it("is idempotent", () => {
    // Granting twice is not an error; the desired end state is "is an admin".
    expect(tool).toContain("ignoreDuplicates: true");
    expect(tool).toContain("Nothing to do — the permission is already granted.");
  });

  it("shows what it is about to change before changing it", () => {
    expect(tool).toContain("user id:");
    expect(tool).toContain("confirmed:");
    expect(tool).toContain("is admin:");
  });

  it("masks the address and prints the id in full", () => {
    expect(tool).toContain("function mask(");
    expect(tool).toContain("${local.slice(0, 2)}***@${domain}");
  });

  it("refuses to guess between two accounts", () => {
    expect(tool).toContain("Refusing to guess");
  });

  it("runs only with the service role, which lives locally", () => {
    expect(tool).toContain('requireEnv("SUPABASE_SERVICE_ROLE_KEY")');
  });
});
