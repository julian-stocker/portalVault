/**
 * Dotted usernames, and the one predicate that decides who may hold one
 * (migration 0051).
 *
 * TWO DEFECTS, ONE CAUSE — a rule written down twice.
 *
 * `0041` moved administration to `platform_admins` and redefined the no-arg
 * `is_shop_admin()` to follow it, but left `is_shop_admin_for(uuid)` reading
 * the legacy `shop_admins`. On Production the two disagreed and inverted: the
 * account just removed from `platform_admins` still counted as an
 * administrator, the real administrator did not. The Business panel refused to
 * offer a shop grant, and — quieter and worse — `send-order-mail` authorises
 * an administrator with that same predicate.
 *
 * The username rule had the opposite problem: it existed only in
 * `src/lib/auth/username.ts`, which says of itself that it is "a convenience,
 * never a boundary". A rule with no database half is not a rule.
 */
import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { code, latestFunction, migrationSource } from "@/test-support/migrations";
import { de } from "@/lib/i18n/de";
import {
  BUSINESS_USERNAME_PATTERN,
  RESERVED_USERNAMES,
  USERNAME_MAX_LENGTH,
  USERNAME_PATTERN,
  checkUsername,
} from "./username";

const SQL = migrationSource("0051_admin_predicate_and_business_usernames.sql");

/* ------------------------------------------------- the admin predicate --- */

describe("is_shop_admin_for() follows platform_admins", () => {
  const fn = latestFunction("is_shop_admin_for");

  it("is redefined by 0051, not by editing an applied migration", () => {
    expect(fn.file).toBe("0051_admin_predicate_and_business_usernames.sql");
    // 0019 and 0041 are applied everywhere and stay as they are.
    expect(migrationSource("0019_transactional_mail.sql")).toContain("public.shop_admins");
  });

  it("reads platform_admins", () => {
    expect(code(fn.body)).toContain("from public.platform_admins p");
  });

  it("and no longer reads shop_admins at all", () => {
    /*
     * The assertion that matters. A stale `shop_admins` row cannot make a
     * non-administrator look like one, and an absent row cannot hide a real
     * administrator, because the table is not consulted.
     */
    expect(code(fn.body)).not.toContain("shop_admins");
  });

  it("agrees with the no-argument predicate, which is the point", () => {
    // is_shop_admin() -> is_platform_admin() -> platform_admins
    expect(code(latestFunction("is_platform_admin").body)).toContain("public.platform_admins");
    expect(code(latestFunction("is_shop_admin").body)).toContain("public.is_platform_admin()");
  });

  it("keeps the signature and the security properties it had", () => {
    for (const property of ["returns boolean", "language sql", "stable", "security definer", "set search_path = ''"]) {
      expect(fn.body, property).toContain(property);
    }
    expect(SQL).toContain("revoke all on function public.is_shop_admin_for(uuid) from public, anon, authenticated;");
  });

  it("does not drop the legacy table", () => {
    // Redirecting the predicate and destroying the evidence in one change
    // would leave no way to see what it held.
    expect(code(SQL)).not.toMatch(/drop table[^;]*shop_admins/i);
  });

  it("covers every caller that asked the old question", () => {
    // All four go through the one function, so redefining it fixes all four.
    for (const caller of ["admin_find_accounts", "admin_commerce_state", "admin_tester_state"]) {
      expect(code(latestFunction(caller).body), caller).toContain("is_shop_admin_for");
    }
    const edge = readFileSync(join(process.cwd(), "supabase/functions/send-order-mail/index.ts"), "utf8");
    expect(edge).toContain('admin.rpc("is_shop_admin_for"');
  });
});

/* ----------------------------------------------------------- the syntax --- */

describe("username syntax, for everybody", () => {
  const cases: [string, boolean][] = [
    ["julianstocker", true],
    ["julian_stocker", true],
    ["abc", true],
    ["yulez.collectibles", true],
    ["a.b.c", true],
    [".yulez", false],
    ["yulez.", false],
    ["yulez..collectibles", false],
    ["yulez.collectibles.", false],
    [".", false],
    ["julian stocker", false],
    ["julian-stocker", false],
    ["jülian", false],
  ];

  for (const [value, ok] of cases) {
    it(`${ok ? "accepts" : "rejects"} ${JSON.stringify(value)}`, () => {
      expect(BUSINESS_USERNAME_PATTERN.test(value)).toBe(ok);
    });
  }

  it("mirrors the widened constraint in 0051", () => {
    expect(SQL).toContain("'^[A-Za-z0-9_]+(\\.[A-Za-z0-9_]+)*$'");
    expect(SQL).toContain("length(username) between 3 and 20");
  });

  it("loses nothing that was valid before", () => {
    // Every ordinary name still passes, so 0051 needs no backfill.
    for (const value of ["julianstocker", "julian_stocker", "abc", "A1_b2"]) {
      expect(USERNAME_PATTERN.test(value), value).toBe(true);
      expect(BUSINESS_USERNAME_PATTERN.test(value), value).toBe(true);
    }
  });
});

/* --------------------------------------------- the mirrored validator --- */

describe("the validator knows which account is asking", () => {
  const collector = { business: false };
  const shop = { business: true };

  it("accepts an ordinary name for either", () => {
    expect(checkUsername("julianstocker", collector)).toBeNull();
    expect(checkUsername("julian_stocker", collector)).toBeNull();
    expect(checkUsername("julianstocker", shop)).toBeNull();
  });

  it("rejects julian.stocker for a collector — and says why", () => {
    /*
     * Not "invalid characters". The name is fine; the account may not hold it.
     * Telling somebody their characters are wrong invites `julian.stocker2`.
     */
    expect(checkUsername("julian.stocker", collector)).toBe("business-only");
  });

  it("accepts yulez.collectibles for a shop", () => {
    expect(checkUsername("yulez.collectibles", shop)).toBeNull();
  });

  it("rejects bad dot placement for a shop too", () => {
    for (const value of [".yulez", "yulez.", "yulez..collectibles"]) {
      expect(checkUsername(value, shop), value).toBe("invalid-characters");
    }
  });

  it("still enforces length on a shop name", () => {
    const tooLong = "a".repeat(USERNAME_MAX_LENGTH - 3) + ".bcde";
    expect(tooLong.length).toBeGreaterThan(USERNAME_MAX_LENGTH);
    expect(checkUsername(tooLong, shop)).toBe("too-long");
    expect(checkUsername("ab", shop)).toBe("too-short");
  });

  it("still enforces reserved names on a shop name", () => {
    /*
     * The fall-through, not a shortcut. An earlier draft returned early once a
     * dotted name was permitted, which skipped this check entirely — the
     * database would still have refused, but the mirror would have lied.
     */
    const reserved = [...RESERVED_USERNAMES][0];
    expect(checkUsername(reserved, shop)).toBe("reserved");
    expect(checkUsername("admin", shop)).toBe("reserved");
  });

  it("defaults to the collector rule when no context is given", () => {
    // A caller that forgets the context gets the stricter answer, never the
    // looser one.
    expect(checkUsername("julian.stocker")).toBe("business-only");
  });
});

/* ------------------------------------------- the authorization boundary --- */

describe("the database is the boundary, not the validator", () => {
  it("permits a dot only for an account that operates an active seller", () => {
    const fn = code(latestFunction("profiles_business_username").body);
    expect(fn).toContain("position('.' in new.username)");
    expect(fn).toContain("public.operates_any_active_seller(new.id)");
    expect(fn).toContain("a username may contain a dot only while the account operates a shop");
  });

  it("is a trigger, so writing the row directly does not bypass it", () => {
    /*
     * RLS lets an authenticated account update its own profile — correctly.
     * That is exactly the path a client-only rule would miss, so the rule has
     * to live where the write lands.
     */
    expect(SQL).toContain("create trigger profiles_business_username_trg");
    expect(SQL).toContain("before insert or update on public.profiles");
  });

  it("does not weaken profiles_update_own", () => {
    expect(code(SQL)).not.toContain("profiles_update_own");
    expect(code(SQL)).not.toMatch(/drop policy|create policy|alter policy/i);
  });

  it("is a trigger because a CHECK cannot ask another table", () => {
    // The syntax stays a CHECK; the entitlement cannot be one.
    expect(SQL).toContain("add constraint profiles_username_format");
    const constraint = SQL.slice(SQL.indexOf("add constraint profiles_username_format"));
    expect(constraint.slice(0, 400)).not.toContain("seller_operators");
  });

  it("lets a NULL username through, so account creation still works", () => {
    // handle_new_user() inserts a profile with username NULL (0001).
    expect(code(latestFunction("profiles_business_username").body)).toContain(
      "if new.username is null",
    );
  });

  it("lets an UNCHANGED dotted username through, so no profile becomes uneditable", () => {
    const fn = code(latestFunction("profiles_business_username").body);
    expect(fn).toContain("new.username is not distinct from old.username");
  });

  it("does not touch OLD during an INSERT", () => {
    /*
     * PL/pgSQL evaluates a condition as one SQL expression instead of
     * short-circuiting, and OLD is unassigned on INSERT. A flat
     * `tg_op = 'UPDATE' and old.username …` would fail on every profile ever
     * created, so the test pins the nesting.
     */
    const fn = code(latestFunction("profiles_business_username").body);
    expect(fn).not.toMatch(/tg_op = 'UPDATE' and .*old\./);
    expect(fn).toMatch(/if tg_op = 'UPDATE' then\s+if new\.username is not distinct/);
  });
});

/* ------------------------------------------------ the revocation rule --- */

describe("shop access cannot be withdrawn under a dotted username", () => {
  const guard = code(latestFunction("seller_operators_username_guard").body);

  it("is installed on the canonical table, covering both ways a grant can go", () => {
    expect(SQL).toContain("create trigger seller_operators_username_guard_trg");
    expect(SQL).toContain("before update or delete on public.seller_operators");
  });

  it("ignores an update that leaves the grant enabled", () => {
    expect(guard).toMatch(/if tg_op = 'UPDATE' then\s+if new\.is_enabled then\s+return new;/);
  });

  it("only blocks when NO other qualifying grant would remain", () => {
    /*
     * `seller_operators` is keyed by (seller_id, user_id), so one account may
     * operate several shops. Losing one grant only matters when it was the
     * last one — the row being changed is excluded by its own key.
     */
    expect(guard).toContain("o.seller_id <> old.seller_id");
    expect(guard).toContain("o.is_enabled");
    expect(guard).toContain("s.is_active");
  });

  it("only blocks an account whose username actually needs the grant", () => {
    expect(guard).toContain("position('.' in v_username)");
  });

  it("renames nothing and invents nothing", () => {
    // The account changes its own name, or the grant stays. Those are the
    // only two outcomes.
    expect(guard).not.toMatch(/update public\.profiles|set username/i);
  });

  it("says what to do, in the error", () => {
    expect(guard).toContain("must be changed to a username without a dot before shop access is withdrawn");
    expect(guard).toContain("restrict_violation");
  });

  it("does not touch NEW during a DELETE", () => {
    // The mirror image of the INSERT problem above.
    expect(guard).not.toMatch(/tg_op = 'UPDATE' and new\./);
  });

  it("covers the canonical revocation path", () => {
    // admin_set_seller_operator() writes this table, so the trigger sees it
    // whether the UI pre-checked or not.
    expect(code(latestFunction("admin_set_seller_operator").body)).toContain(
      "public.seller_operators",
    );
  });
});

/* ------------------------------------------------- one shared predicate --- */

describe("one definition of 'operates a shop'", () => {
  it("exists once and is used by both rules", () => {
    const helper = code(latestFunction("operates_any_active_seller").body);
    expect(helper).toContain("o.is_enabled");
    expect(helper).toContain("s.is_active");
    expect(code(latestFunction("profiles_business_username").body)).toContain(
      "operates_any_active_seller",
    );
  });

  it("mirrors can_operate_active_seller(), the caller-facing one", () => {
    const caller = code(latestFunction("can_operate_active_seller").body);
    const row = code(latestFunction("operates_any_active_seller").body);
    for (const part of ["public.seller_operators", "public.sellers", "is_active", "is_enabled"]) {
      expect(caller, part).toContain(part);
      expect(row, part).toContain(part);
    }
    // The difference is only where the account comes from.
    expect(caller).toContain("auth.uid()");
    expect(row).toContain("p_user_id");
  });

  it("is reachable by no client role", () => {
    expect(SQL).toContain("revoke all on function public.operates_any_active_seller(uuid)");
  });
});

/* ----------------------------------------------------- application wiring - */

describe("the application asks the server, never the form", () => {
  const actions = readFileSync(join(process.cwd(), "src/lib/auth/actions.ts"), "utf8");

  it("takes the business flag from capabilities, not from the request", () => {
    expect(actions).toContain("const business = await canOperateSeller();");
    expect(actions).toContain("checkUsername(candidate, { business })");
    // Nothing is read out of the submitted form to decide this.
    expect(actions).not.toMatch(/formData\.get\("(business|isBusiness)"/);
  });

  it("translates the database refusal into a sentence", () => {
    const errors = readFileSync(join(process.cwd(), "src/lib/auth/errors.ts"), "utf8");
    expect(errors).toContain("profiles_username_business_only");
    expect(errors).toContain("usernameBusinessOnly");
    // And never leaks the raw Postgres text.
    expect(errors).not.toMatch(/return\s*\{[^}]*message:\s*error\.message/);
  });

  it("names the shop exception without telling a collector dots are theirs", () => {
    /*
     * ONE hint, not two. `/account/profile` may not know the account type —
     * signing out belongs to the account rather than the role, and
     * `three-accounts.test.ts` holds that page type-agnostic. A sentence that
     * attributes dots to shop accounts is accurate for everyone and misleads
     * nobody; the precise refusal lives in the error, where it is needed.
     */
    expect(de.auth.onboarding.hint).toContain("Shopkonten");
    expect(de.auth.onboarding.hint).toContain("Punkte");
    expect(de.auth.errors.usernameBusinessOnly).toContain("Shopkonten");

    // And the seller's own name is never typed into copy (ADR-0080).
    expect(de.auth.onboarding.hint).not.toContain("yulez");
    expect(de.auth.errors.usernameBusinessOnly).not.toContain("yulez");
  });

  it("keeps the profile page free of role questions", () => {
    // The guard that caught an earlier draft of this change.
    const profile = readFileSync(join(process.cwd(), "src/app/(app)/account/profile/page.tsx"), "utf8");
    for (const forbidden of ["capabilities", "sellerOperator", "platformAdmin", "accountType"]) {
      expect(profile, forbidden).not.toContain(forbidden);
    }
  });

  it("surfaces the revocation refusal in the admin panel", () => {
    const admin = readFileSync(join(process.cwd(), "src/lib/admin/actions.ts"), "utf8");
    expect(admin).toContain("seller_operators_username_guard");
    expect(admin).toContain("revokeBlockedByUsername");
  });
});
