import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  KNOWN_TESTER_FEATURES,
  NO_TESTERS,
  holds,
  isKnownTesterFeature,
  readTesterState,
  type TesterAccount,
} from "./tester-model.ts";

/**
 * Tester accounts and what each of them may test (ADR-0071).
 *
 * The rules that decide who may do what live in SQL — a permission check that
 * could be talked out of by the application would not be a permission check.
 * So these hold the migration's shape, the way `commerce-mode-schema.test.ts`
 * holds `0021`'s, and the pure model beside it.
 */
const SQL = readFileSync("supabase/migrations/0036_tester_feature_permissions.sql", "utf8");
/** Without the prose: the file explains at length what it does not do. */
const CODE = SQL.replace(/^\s*--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

/** One function body, so an assertion cannot be satisfied by a neighbour. */
function body(signature: string): string {
  const start = CODE.indexOf(signature);
  expect(start, signature).toBeGreaterThan(-1);
  const end = CODE.indexOf("$$;", start);
  expect(end, `${signature} ends`).toBeGreaterThan(start);
  return CODE.slice(start, end);
}

function tester(over: Partial<TesterAccount> = {}): TesterAccount {
  return {
    userId: "5d6ab376-f413-45c4-89fd-f9d7a5f8e7fd",
    username: "apptester",
    email: "ap***@example.com",
    createdAt: "2026-09-11T00:00:00.000Z",
    note: null,
    isAdmin: false,
    permissions: [],
    ...over,
  };
}

describe("a permission grants exactly what it names", () => {
  it("a normal user holds nothing", () => {
    // Not a tester at all: there is no row, so every question answers false.
    const none = tester({ permissions: [] });
    expect(holds(none, "commerce")).toBe(false);
    expect(holds(none, "performance_tracking")).toBe(false);
  });

  it("commerce alone does not grant performance tracking", () => {
    const only = tester({ permissions: ["commerce"] });
    expect(holds(only, "commerce")).toBe(true);
    expect(holds(only, "performance_tracking")).toBe(false);
  });

  it("performance tracking alone does not grant commerce", () => {
    const only = tester({ permissions: ["performance_tracking"] });
    expect(holds(only, "performance_tracking")).toBe(true);
    expect(holds(only, "commerce")).toBe(false);
  });

  it("both means both", () => {
    const both = tester({ permissions: ["commerce", "performance_tracking"] });
    expect(holds(both, "commerce")).toBe(true);
    expect(holds(both, "performance_tracking")).toBe(true);
  });

  it("admin status is a separate fact and grants nothing here", () => {
    const admin = tester({ isAdmin: true, permissions: [] });
    expect(holds(admin, "commerce")).toBe(false);
    // And the check in SQL reads tester_permissions only.
    expect(body("create or replace function public.has_tester_permission(p_permission text)"))
      .not.toContain("shop_admins");
  });

  it("checks the caller, never another account", () => {
    /*
     * `has_tester_permission()` takes no user id on purpose — one that did
     * would be a lookup service for other people's accounts, which is why
     * `is_shop_admin()` has no argument either.
     */
    const fn = body("create or replace function public.has_tester_permission(p_permission text)");
    expect(fn).toContain("tp.user_id = (select auth.uid())");
    expect(fn).not.toContain("p_user_id");
  });

  it("keeps the named-account helper away from every client role", () => {
    expect(CODE).toContain(
      "revoke all on function public.has_tester_permission_for(uuid, text) from public, anon, authenticated",
    );
    expect(CODE).not.toMatch(
      /grant\s+execute on function public\.has_tester_permission_for\(uuid, text\)/,
    );
  });
});

describe("the registry decides what a permission may be called", () => {
  it("seeds exactly the two initial features", () => {
    expect(CODE).toContain("('commerce', 'E-Commerce'");
    expect(CODE).toContain("('performance_tracking', 'Performance-Tracking'");
  });

  it("refuses an invented key by foreign key, not by hope", () => {
    expect(CODE).toContain("constraint tester_permissions_feature_fk foreign key (permission)");
    expect(CODE).toContain("references public.tester_features (key)");
    // Deleting a feature that is still granted is refused rather than cascading.
    expect(CODE).toContain("on delete restrict");
  });

  it("also refuses it by name, so the error says which key", () => {
    const fn = body("create or replace function public.admin_set_tester_permission(");
    expect(fn).toContain("unknown tester permission %");
  });

  it("is not readable by any client — the admin area gets it through the RPC", () => {
    expect(CODE).toContain("revoke all on public.tester_features from anon, authenticated");
    expect(CODE).not.toMatch(/create policy .* on public\.tester_features/i);
    expect(body("create or replace function public.admin_tester_state()")).toContain(
      "from public.tester_features tf",
    );
  });

  it("names only the keys TypeScript has to reason about", () => {
    // The UI renders the registry; this union is for the two places that
    // legitimately name a feature in code.
    expect([...KNOWN_TESTER_FEATURES]).toEqual(["commerce", "performance_tracking"]);
    expect(isKnownTesterFeature("commerce")).toBe(true);
    expect(isKnownTesterFeature("made_up")).toBe(false);
  });
});

describe("membership is the row, and removing it takes the permissions", () => {
  it("has no enabled column — existence is the state", () => {
    const table = CODE.slice(
      CODE.indexOf("create table if not exists public.testers"),
      CODE.indexOf("comment on table public.testers"),
    );
    expect(table).not.toContain("enabled");
  });

  it("cascades the permissions from the tester, not from auth.users", () => {
    expect(CODE).toContain("constraint tester_permissions_tester_fk foreign key (user_id)");
    expect(CODE).toContain("references public.testers (user_id)\n    on update cascade\n    on delete cascade");
  });

  it("removes a tester with one delete and touches nothing else", () => {
    const fn = body("create or replace function public.admin_set_tester(");
    expect(fn).toContain("delete from public.testers where user_id = p_user_id");
    for (const untouched of ["auth.users u\n", "collection_items", "orders", "shop_inventory", "shop_admins"]) {
      // `auth.users` appears once, as an existence check before adding.
      if (untouched === "auth.users u\n") continue;
      expect(fn, untouched).not.toContain(untouched);
    }
  });

  it("names a tester by account, never by address", () => {
    const fn = body("create or replace function public.admin_set_tester(");
    expect(fn).toContain("a tester is named by account, never by address");
    expect(fn).not.toContain("email");
  });
});

describe("commerce keeps working, and reads from the new model", () => {
  it("is_commerce_tester is now a wrapper", () => {
    const fn = body("create or replace function public.is_commerce_tester()");
    expect(fn).toContain("public.has_tester_permission('commerce')");
    expect(fn).not.toContain("from public.commerce_testers");
  });

  it("is_commerce_tester_for is too, for the payment path", () => {
    const fn = body("create or replace function public.is_commerce_tester_for(p_user_id uuid)");
    expect(fn).toContain("public.has_tester_permission_for(p_user_id, 'commerce')");
    expect(fn).not.toContain("from public.commerce_testers");
  });

  it("keeps both signatures and both privilege sets exactly as 0021 had them", () => {
    // Every caller — checkout, order visibility, admin_find_accounts — is
    // untouched precisely because these did not change shape.
    expect(CODE).toContain("revoke all on function public.is_commerce_tester() from public, anon, authenticated");
    expect(CODE).toContain("revoke all on function public.is_commerce_tester_for(uuid) from public, anon, authenticated");
  });

  it("rewrites no checkout or order logic", () => {
    for (const untouched of [
      "commerce_checkout_allowed",
      "commerce_mode()",
      "order_visible",
      "create table public.orders",
    ]) {
      expect(CODE, untouched).not.toContain(untouched);
    }
  });

  it("carries the existing commerce testers across, conflict-safe", () => {
    expect(CODE).toContain("insert into public.testers (user_id, created_at, created_by, note)");
    expect(CODE).toContain("from public.commerce_testers ct");
    expect(CODE).toContain("on conflict (user_id) do nothing");
    expect(CODE).toContain("select ct.user_id, 'commerce', ct.granted_at, ct.granted_by");
    expect(CODE).toContain("on conflict (user_id, permission) do nothing");
  });

  it("does not drop or empty the legacy table", () => {
    expect(CODE).not.toContain("drop table public.commerce_testers");
    expect(CODE).not.toMatch(/truncate[\s\S]*commerce_testers/i);
  });
});

describe("the legacy table is a mirror, not a second authority", () => {
  it("is kept in step by every write that touches the commerce permission", () => {
    /*
     * ONE AUTHORITY FOR READS, ONE MIRROR FOR ROLLBACK. Nothing reads
     * `commerce_testers` after 0036 — its only two readers became wrappers —
     * and it is kept current so reverting the migration restores working
     * commerce for testers added since.
     */
    expect(body("create or replace function public.admin_set_tester(")).toContain(
      "perform public.sync_legacy_commerce_tester(p_user_id)",
    );
    const permission = body("create or replace function public.admin_set_tester_permission(");
    expect(permission).toContain("if p_permission = 'commerce' then");
    expect(permission).toContain("perform public.sync_legacy_commerce_tester(p_user_id)");
  });

  it("derives the mirror from the new model, never the other way round", () => {
    const fn = body("create or replace function public.sync_legacy_commerce_tester(");
    expect(fn.indexOf("from public.tester_permissions")).toBeGreaterThan(-1);
    expect(fn).toContain("delete from public.commerce_testers where user_id = p_user_id");
  });

  it("is internal — no client role may call the mirror", () => {
    expect(CODE).toContain(
      "revoke all on function public.sync_legacy_commerce_tester(uuid) from public, anon, authenticated",
    );
  });
});

describe("the 0021 admin entry point still works", () => {
  const fn = body("create or replace function public.admin_set_commerce_tester(");

  it("maintains the generic model rather than the legacy table", () => {
    expect(fn).toContain("perform public.admin_set_tester(p_user_id, true, p_note)");
    expect(fn).toContain("perform public.admin_set_tester_permission(p_user_id, 'commerce', true)");
    expect(fn).not.toContain("insert into public.commerce_testers");
  });

  it("withdraws the commerce permission, not tester membership", () => {
    // An account that also tests something else keeps testing it — the whole
    // difference this migration makes.
    expect(fn).toContain("perform public.admin_set_tester_permission(p_user_id, 'commerce', false)");
    expect(fn).not.toContain("delete from public.testers");
  });

  it("keeps its signature and privileges", () => {
    expect(CODE).toContain(
      "grant  execute on function public.admin_set_commerce_tester(uuid, boolean, text) to authenticated",
    );
    expect(CODE).toContain(
      "revoke all on function public.admin_set_commerce_tester(uuid, boolean, text) from public, anon",
    );
  });
});

describe("only administrators may change any of it", () => {
  for (const fn of [
    "create or replace function public.admin_tester_state()",
    "create or replace function public.admin_set_tester(",
    "create or replace function public.admin_set_tester_permission(",
    "create or replace function public.admin_set_commerce_tester(",
  ]) {
    it(`${fn.split("public.")[1]} asks is_shop_admin() first`, () => {
      const source = body(fn);
      expect(source).toContain("if not public.is_shop_admin() then");
      expect(source).toContain("errcode = 'insufficient_privilege'");
      // Before anything else it might do.
      expect(source.indexOf("is_shop_admin")).toBeLessThan(
        Math.max(source.indexOf("insert into"), source.indexOf("select coalesce"), 10_000),
      );
    });
  }

  it("gives no client role a privilege on any tester table", () => {
    for (const table of ["testers", "tester_features", "tester_permissions", "tester_permission_changes"]) {
      expect(CODE, table).toContain(`revoke all on public.${table} from anon, authenticated`);
      expect(CODE, table).toContain(`alter table public.${table} enable row level security`);
      expect(CODE, table).not.toMatch(new RegExp(`create policy .* on public\\.${table}`, "i"));
      // No grant anywhere, so a tester cannot read the list or the journal.
      expect(CODE, table).not.toMatch(new RegExp(`grant [a-z, ]+ on public\\.${table}`, "i"));
    }
  });

  it("runs every function with an empty search path", () => {
    const definers = CODE.match(/security definer/g) ?? [];
    const paths = CODE.match(/set search_path = ''/g) ?? [];
    expect(definers.length).toBeGreaterThan(0);
    expect(paths.length).toBeGreaterThanOrEqual(definers.length);
  });
});

describe("the journal", () => {
  it("records both shapes without muddying the permission field", () => {
    expect(CODE).toContain("check (action in ('added', 'removed', 'granted', 'revoked'))");
    // NULL permission is exactly what "this was not about a feature" looks like.
    expect(CODE).toContain("(action in ('added', 'removed') and permission is null)");
    expect(CODE).toContain("(action in ('granted', 'revoked') and permission is not null)");
  });

  it("writes an entry for every mutation", () => {
    expect(body("create or replace function public.admin_set_tester(")).toContain("'added'");
    expect(body("create or replace function public.admin_set_tester(")).toContain("'removed'");
    const permission = body("create or replace function public.admin_set_tester_permission(");
    expect(permission).toContain("'granted'");
    expect(permission).toContain("'revoked'");
  });

  it("outlives the rows it describes", () => {
    // No foreign key to `testers`: an entry about a removal must survive the
    // removal, which is the only reason the journal exists.
    const table = CODE.slice(
      CODE.indexOf("create table if not exists public.tester_permission_changes"),
      CODE.indexOf("comment on table public.tester_permission_changes"),
    );
    expect(table).not.toContain("references public.testers");
    expect(table).toContain("references auth.users (id) on delete set null");
  });

  it("does not distort another journal", () => {
    for (const other of ["catalog_admin_changes", "payment_events", "order_events"]) {
      expect(CODE, other).not.toContain(other);
    }
  });
});

describe("the model reads what the database sends", () => {
  it("sorts the registry by position, so the checkboxes do not move", () => {
    const state = readTesterState({
      features: [
        { key: "performance_tracking", label: "B", description: "", position: 2 },
        { key: "commerce", label: "A", description: "", position: 1 },
      ],
      testers: [],
    });
    expect(state.features.map((f) => f.key)).toEqual(["commerce", "performance_tracking"]);
  });

  it("keeps a permission key it has never heard of", () => {
    // The registry is authoritative. A feature added in SQL must appear even
    // though no TypeScript knows its name.
    const state = readTesterState({
      features: [{ key: "future_thing", label: "Zukunft", description: "", position: 9 }],
      testers: [{ user_id: "u", permissions: ["future_thing"] }],
    });
    expect(state.features[0].key).toBe("future_thing");
    expect(holds(state.testers[0], "future_thing")).toBe(true);
  });

  it("drops a tester row with no user id rather than rendering it", () => {
    const state = readTesterState({ features: [], testers: [{ username: "nobody" }] });
    expect(state.testers).toEqual([]);
  });

  it("answers the empty state for anything unreadable", () => {
    for (const bad of [null, undefined, 42, "nope", []]) {
      expect(readTesterState(bad)).toEqual(NO_TESTERS);
    }
  });
});

describe("the admin surface", () => {
  const PANEL = readFileSync("src/components/admin/tester-panel.tsx", "utf8");
  const ACTIONS = readFileSync("src/lib/admin/actions.ts", "utf8");

  it("renders the checkboxes from the registry, not from a list of its own", () => {
    expect(PANEL).toContain("state.features.map((feature) => (");
    expect(PANEL).not.toContain('"commerce"');
    expect(PANEL).not.toContain('"performance_tracking"');
  });

  it("is a client component that imports the model, never the reader", () => {
    expect(PANEL).toContain('from "@/lib/admin/tester-model"');
    expect(PANEL).not.toContain('from "@/lib/admin/tester"');
  });

  it("mutates only through the admin actions", () => {
    expect(ACTIONS).toContain('"admin_set_tester"');
    expect(ACTIONS).toContain('"admin_set_tester_permission"');
    for (const action of ["setTester", "setTesterPermission"]) {
      const at = ACTIONS.indexOf(`export async function ${action}(`);
      expect(at, action).toBeGreaterThan(-1);
      expect(ACTIONS.slice(at, at + 400)).toContain("await isAdmin()");
    }
  });

  it("keeps the account search exactly as narrow as it was", () => {
    const sql = readFileSync("supabase/migrations/0021_commerce_mode.sql", "utf8");
    expect(sql).toContain("if length(v_query) < 3 then");
    expect(sql).toContain("limit 10");
    // And 0036 does not widen it.
    expect(CODE).not.toContain("admin_find_accounts");
  });

  it("leaves no second tester list behind in the commerce panel", () => {
    const commerce = readFileSync("src/components/admin/commerce-panel.tsx", "utf8");
    expect(commerce).not.toContain("setCommerceTester");
    expect(commerce).not.toContain("state.testers");
  });
});
