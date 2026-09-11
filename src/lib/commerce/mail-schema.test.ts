import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * A contract test on migration 0019.
 *
 * The runtime suite proves what the database does. This proves what the
 * migration *says* — the promises that are easy to break by editing one line
 * and that no unit test would otherwise notice.
 */
const SQL = readFileSync("supabase/migrations/0019_transactional_mail.sql", "utf8");

/** The migration with its comments stripped, for "is it actually in the code". */
const CODE = SQL.split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

describe("business_settings is its own entity", () => {
  it("is a table of its own, not columns bolted onto shop_settings", () => {
    expect(CODE).toContain("create table if not exists public.business_settings");
    // Pricing is a different question from identity: 0019 must not touch it.
    expect(CODE).not.toContain("alter table public.shop_settings");
    expect(CODE).not.toContain("function public.admin_shop_settings");
  });

  it("is a singleton", () => {
    expect(CODE).toContain("constraint business_settings_singleton check (id)");
  });

  /**
   * The exact column list, not just an absence check.
   *
   * The legal block will add Betreibername, Anschrift, Telefon and tax fields
   * here deliberately and will decide each one's visibility at that point.
   * Until then this test is the record of what was agreed, and it fails on any
   * addition — which is the moment to make that decision rather than after.
   */
  it("holds exactly the agreed columns", () => {
    const table = CODE.slice(
      CODE.indexOf("create table if not exists public.business_settings ("),
      CODE.indexOf("comment on table public.business_settings"),
    );
    const columns = [...table.matchAll(/^\s{2}([a-z_]+)\s+(?:boolean|text|timestamptz|uuid)/gm)].map(
      (m) => m[1],
    );
    expect(columns).toEqual([
      "id",
      "contact_email",
      "transactional_reply_to",
      "updated_at",
      "updated_by",
    ]);
  });

  it("ships only the two fields the mail block needs", () => {
    // The legal block adds legal name, address, phone and tax details. An
    // empty column today is a promise nobody checked.
    const table = CODE.slice(
      CODE.indexOf("create table if not exists public.business_settings"),
      CODE.indexOf("comment on table public.business_settings"),
    );
    for (const premature of ["legal_name", "trading_name", "street", "postal_code", "vat_id", "tax_id", "phone"]) {
      expect(table, `${premature} was added before anything renders it`).not.toContain(premature);
    }
    expect(table).toContain("contact_email");
    expect(table).toContain("transactional_reply_to");
  });

  it("carries no address as a literal", () => {
    // No business datum is ever hardcoded — not in a seed, not in a default.
    expect(SQL).not.toMatch(/@(gmail|googlemail|outlook|web|gmx|yahoo)\./i);
    const seed = CODE.slice(CODE.indexOf("insert into public.business_settings"));
    expect(seed.slice(0, 200)).toContain("(id) values (true)");
  });

  it("is closed to every client role", () => {
    expect(CODE).toContain("alter table public.business_settings enable row level security");
    expect(CODE).toContain("revoke all on public.business_settings from anon, authenticated");
    expect(CODE).not.toMatch(/grant\s+select\s+on\s+public\.business_settings/);
  });
});

describe("the public projection is an allow-list", () => {
  const fn = CODE.slice(
    CODE.indexOf("create or replace function public.business_settings_public()"),
    CODE.indexOf("comment on function public.business_settings_public()"),
  );

  it("names its columns literally", () => {
    expect(fn).toContain("select b.contact_email");
    // Either of these would publish whatever the legal block adds next.
    expect(fn).not.toContain("b.*");
    expect(fn).not.toContain("information_schema");
    expect(fn).not.toContain("pg_attribute");
  });

  it("returns exactly one column today", () => {
    const returns = fn.slice(fn.indexOf("returns table ("), fn.indexOf(")", fn.indexOf("returns table (")));
    expect(returns).toContain("contact_email");
    expect(returns).not.toContain("transactional_reply_to");
  });

  it("is granted to nobody yet", () => {
    expect(CODE).toContain(
      "revoke all on function public.business_settings_public() from public, anon, authenticated",
    );
    expect(CODE).not.toMatch(/grant execute on function public\.business_settings_public\(\)\s+to/);
  });
});

describe("order_mail keeps delivery state and nothing else", () => {
  const table = CODE.slice(
    CODE.indexOf("create table if not exists public.order_mail"),
    CODE.indexOf("comment on table public.order_mail"),
  );

  it("is keyed by order and kind, which is what makes the insert a lock", () => {
    expect(table).toContain("constraint order_mail_pk primary key (order_id, kind)");
  });

  it("knows exactly the three mails, and the four states", () => {
    expect(table).toContain(
      "check (kind in ('payment_confirmation', 'shipping_confirmation', 'resolution_alert'))",
    );
    expect(table).toContain("check (state in ('sending', 'sent', 'failed', 'unresolved'))");
  });

  it("stores no recipient, no subject and no body", () => {
    for (const forbidden of ["recipient", "to_address", "subject", "body", "html", "payload"]) {
      expect(table, forbidden).not.toContain(forbidden);
    }
  });

  it("ties `sent` to `sent_at` so neither can exist without the other", () => {
    expect(table).toContain("check ((state = 'sent') = (sent_at is not null))");
  });
});

describe("a sent mail is terminal", () => {
  it("the guard refuses to unsend it", () => {
    expect(CODE).toContain("if old.state = 'sent' and new.state is distinct from 'sent' then");
    expect(CODE).toContain("a sent mail cannot be unsent");
  });

  it("the claim refuses it before the force flag is even read", () => {
    const claim = CODE.slice(
      CODE.indexOf("create or replace function public.claim_order_mail"),
      CODE.indexOf("comment on function public.claim_order_mail"),
    );
    const sentCheck = claim.indexOf("if v_row.state = 'sent' then");
    const forceCheck = claim.indexOf("p_force");
    expect(sentCheck).toBeGreaterThan(-1);
    // Order matters: `already_sent` must win over any acknowledgement.
    expect(sentCheck).toBeLessThan(claim.indexOf("coalesce(p_force, false)"));
    expect(forceCheck).toBeGreaterThan(-1);
  });

  it("delivery records are never deleted", () => {
    expect(CODE).toContain("delivery records are not deleted");
    expect(CODE).toContain("before delete on public.order_mail");
  });
});

describe("the mail payload carries nothing it should not", () => {
  const fn = CODE.slice(
    CODE.indexOf("create or replace function public.order_mail_payload"),
    CODE.indexOf("comment on function public.order_mail_payload"),
  );

  it("omits every internal identifier", () => {
    for (const forbidden of [
      "'id'",
      "user_id",
      "request_id",
      "client_hash",
      "payment_token_hash",
      "provider_payment_id",
      "session_id",
    ]) {
      expect(fn, forbidden).not.toContain(forbidden);
    }
  });

  it("omits the SKY-ID from the line items", () => {
    expect(fn).not.toContain("sky_id");
  });

  it("carries what a confirmation actually needs", () => {
    for (const field of [
      "order_number",
      "items_subtotal",
      "shipping_amount",
      "total_amount",
      "shipping_method",
      "address",
      "lines",
    ]) {
      expect(fn, field).toContain(field);
    }
  });
});

describe("delivery is service-role only", () => {
  it("revokes every delivery function from the client roles", () => {
    for (const fn of [
      "public.claim_order_mail(text, text, boolean)",
      "public.mark_order_mail_sent(text, text, text)",
      "public.mark_order_mail_failed(text, text, text)",
      "public.mark_order_mail_unresolved(text, text, text)",
      "public.order_mail_payload(text)",
      "public.mail_contact_settings()",
    ]) {
      expect(CODE, fn).toContain(`revoke all on function ${fn}`);
      expect(CODE, `${fn} must not be granted`).not.toContain(
        `grant execute on function ${fn} to`,
      );
    }
  });

  it("grants the administrator's two, where is_shop_admin() decides", () => {
    expect(CODE).toContain("grant execute on function public.admin_business_settings() to authenticated");
    expect(CODE).toContain(
      "grant execute on function public.admin_set_business_contact(text, text) to authenticated",
    );
  });

  it("every admin function asks is_shop_admin() itself", () => {
    for (const name of [
      "public.admin_business_settings()",
      "public.admin_set_business_contact(",
      "public.admin_order(p_order_number",
    ]) {
      const start = CODE.indexOf(`create or replace function ${name}`);
      expect(start, name).toBeGreaterThan(-1);
      const body = CODE.slice(start, start + 1400);
      expect(body, name).toContain("if not public.is_shop_admin() then");
    }
  });

  /** Nothing here authorises by address. That rule is older than this file. */
  it("never compares an e-mail address to decide anything", () => {
    expect(CODE).not.toMatch(/contact_email\s*=\s*[^ ]*email/i);
    expect(CODE).not.toMatch(/if\s+.*contact_email\s*=/);
  });
});

describe("the database sends nothing", () => {
  it("has no HTTP call, no provider name, no key", () => {
    for (const forbidden of ["pg_net", "net.http", "resend", "RESEND", "http_post", "extensions.http"]) {
      expect(SQL, forbidden).not.toContain(forbidden);
    }
  });

  it("has no scheduler, no sweep, no queue", () => {
    for (const forbidden of ["cron.schedule", "pg_cron", "listen ", "notify "]) {
      expect(CODE, forbidden).not.toContain(forbidden);
    }
  });
});
