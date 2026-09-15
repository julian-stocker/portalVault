import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";

import { OFFER_CONDITIONS, V1_CONDITION } from "@/lib/shop/offer";

/**
 * `0029` — the storefront stops advertising what the platform will not sell.
 *
 * 0028 shut the two doors a boxed position could be bought through. This one
 * closes the third, which sells nothing but describes what is for sale:
 * `shop_offers()` was still publishing boxed rows to anon — sky_id, condition,
 * price and an availability flag — for articles `create_order()` now refuses.
 *
 * That gap is the original defect, not a tidy-up: the catalogue card said
 * "Angebote ab 21,50 €" for SKY-0043 while the quick view would not open,
 * because the card believed the projection and the quick view believed the V1
 * rule. The application filters on every surface now; this moves the answer to
 * where the question is asked.
 *
 * What these tests guard:
 *
 *  - the rule is added to the 0008 definition, not substituted for it;
 *  - the word `loose` is asked for, never written a second time;
 *  - nothing about the data model, the admin reads or the order history moves;
 *  - the two verifiers that measure this projection still measure something.
 */
const MIGRATIONS = "supabase/migrations";
const MIGRATION = `${MIGRATIONS}/0029_v1_loose_only_offers.sql`;
const SOURCE = `${MIGRATIONS}/0008_shop_listing_opt_out.sql`;

const sql = readFileSync(MIGRATION, "utf8");

const strip = (text: string): string =>
  text
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");

const code = strip(sql);

/** The migration with `comment on … is '…'` removed: prose, not code. */
const statements = code.replace(/comment on [\s\S]*?';/g, "");

/** What applying the migration does, with every `$$ … $$` body removed. */
const applied = statements.replace(/as \$\$[\s\S]*?\$\$;/g, "as $$ … $$;");

function part(text: string, from: string, to: string): string {
  const start = text.indexOf(from);
  expect(start, `${from} is missing`).toBeGreaterThan(-1);
  return text.slice(start, text.indexOf(to, start));
}

const HEAD_FROM = "create or replace function public.shop_offers()";
const head = part(code, HEAD_FROM, "as $$");
const body = part(code, "as $$", "$$;");
/** The same function's body in 0008 — located by name, not by the first `$$`. */
const sourceBody = (() => {
  const text = strip(readFileSync(SOURCE, "utf8"));
  const at = text.indexOf(HEAD_FROM);
  expect(at, "shop_offers() is missing from 0008").toBeGreaterThan(-1);
  return part(text.slice(at), "as $$", "$$;");
})();

/** Lines `after` has that `before` does not, counting duplicates. */
function addedLines(before: string, after: string): string[] {
  const left = new Map<string, number>();
  for (const line of before.split("\n")) left.set(line, (left.get(line) ?? 0) + 1);
  const added: string[] = [];
  for (const line of after.split("\n")) {
    const n = left.get(line) ?? 0;
    if (n > 0) left.set(line, n - 1);
    else added.push(line);
  }
  return added;
}

const executable = (lines: string[]) =>
  lines.filter((line) => line.trim() && !line.trimStart().startsWith("--"));

describe("A — 0029 replaces the current shop_offers() and nothing else", () => {
  it("holds its number alone, after the definitions it depends on", () => {
    // Unique, and ordered after 0008 (the definition it replaces) and 0028
    // (which creates the function it calls). Not "is the newest file" — the
    // series keeps growing, and that assertion would break on 0030.
    const numbers = readdirSync(MIGRATIONS)
      .filter((name) => name.endsWith(".sql"))
      .map((name) => name.slice(0, 4));
    expect(numbers.filter((n) => n === "0029")).toHaveLength(1);
    for (const earlier of ["0008", "0028"]) {
      expect(numbers).toContain(earlier);
      expect("0029" > earlier, `0029 must run after ${earlier}`).toBe(true);
    }
  });

  it("replaces exactly one function", () => {
    expect(code.match(/create or replace function/g)).toHaveLength(1);
    expect(code).toContain(HEAD_FROM);
  });

  it("keeps the signature: no argument, and none to come", () => {
    // A condition the client could name is precisely the choice V1 does not
    // offer. An argument here would hand it back.
    expect(head).toContain("public.shop_offers()");
    expect(head).not.toMatch(/\bp_[a-z_]+/);
  });

  it("removes nothing from the 0008 definition", () => {
    expect(addedLines(body, sourceBody)).toEqual([]);
  });

  it("adds exactly one executable line", () => {
    expect(executable(addedLines(sourceBody, body))).toEqual([
      "    and i.condition = public.v1_sale_condition()",
    ]);
  });
});

describe("B, C — the rule is asked for, not restated", () => {
  it("filters on v1_sale_condition()", () => {
    expect(body).toContain("and i.condition = public.v1_sale_condition()");
  });

  it("writes no condition literal of its own", () => {
    // 0028 owns the word. A second copy here is a second opinion waiting to
    // drift, which is the whole failure this series of migrations is about.
    expect(statements).not.toContain("'loose'");
    expect(statements).not.toContain("'boxed'");
  });

  it("agrees with the application's constant", () => {
    const helper = readFileSync(`${MIGRATIONS}/0028_v1_loose_only_commerce.sql`, "utf8");
    expect(helper).toContain(`select '${V1_CONDITION}'::text`);
  });
});

describe("D — every filter 0008 applied still applies", () => {
  it("keeps the release, eligibility and price rules", () => {
    expect(body).toContain("where i.is_listed");
    expect(body).toContain("and public.is_shop_eligible(i.sky_id)");
    expect(body).toContain(
      "and public.shop_price(i.sale_price, s.market_price, st.price_percentage) is not null",
    );
  });

  it("keeps the same sources and the same ordering", () => {
    expect(body).toContain("from public.shop_inventory i");
    expect(body).toContain("join public.skylanders s on s.sky_id = i.sky_id");
    expect(body).toContain("cross join public.shop_settings st");
    expect(body).toContain("order by i.sky_id, i.condition");
  });

  it("keeps the flags", () => {
    expect(head).toContain("language sql");
    expect(head).toContain("stable");
    expect(head).toContain("security definer");
    expect(head).toContain("set search_path = ''");
  });
});

describe("E — the return contract is unchanged", () => {
  it("returns the same four values, with the same types", () => {
    for (const column of [
      "sky_id    text",
      "condition text",
      "price     numeric",
      "available boolean",
    ]) {
      expect(head).toContain(column);
    }
  });

  it("still publishes condition, rather than dropping the column", () => {
    // One condition today does not make the column redundant: the value is
    // what the cart stores, what create_order() is given back and what an
    // order line records. Removing it would be a breaking change dressed up
    // as a simplification.
    expect(body).toContain("i.condition,");
  });

  it("publishes no stock level, cost, note or id", () => {
    for (const forbidden of [
      "i.quantity",
      "i.reserved",
      "i.available_quantity as",
      "i.id",
      "i.note",
      "unit_cost",
    ]) {
      expect(body, `${forbidden} must not be published`).not.toContain(forbidden);
    }
    expect(body).toContain("(i.available_quantity > 0) as available");
  });
});

describe("F — the grants are restated, not widened", () => {
  it("repeats the pair from 0008 exactly", () => {
    const pair = (text: string) =>
      text
        .split("\n")
        .map((line) => line.trim())
        .filter(
          (line) =>
            line.includes("public.shop_offers()") &&
            (line.startsWith("revoke") || line.startsWith("grant")),
        );
    expect(pair(code)).toEqual(["revoke all on function public.shop_offers() from public;",
      "grant execute on function public.shop_offers() to anon, authenticated;"]);
  });

  it("names no other role", () => {
    for (const line of code.split("\n").filter((l) => l.trimStart().startsWith("grant"))) {
      expect(line).toContain("to anon, authenticated;");
      expect(line).not.toContain("service_role");
    }
  });
});

describe("G, H — nothing internal, historical or structural is touched", () => {
  it("leaves every admin and history function alone", () => {
    for (const untouched of [
      "admin_shop_inventory",
      "admin_inventory_movements",
      "admin_orders",
      "admin_order",
      "my_orders",
      "my_order",
      "set_shop_listing",
      "record_inventory_movement",
      "create_order",
      "shop_quantity_available",
      "v1_sale_condition",
    ]) {
      expect(
        code,
        `${untouched} must not be redefined here`,
      ).not.toContain(`create or replace function public.${untouched}(`);
    }
  });

  it("changes no table, constraint, trigger, policy or index", () => {
    for (const forbidden of [
      "alter table",
      "create table",
      "drop table",
      "drop column",
      "add constraint",
      "drop constraint",
      "create trigger",
      "create policy",
      "create index",
      "drop function",
    ]) {
      expect(applied.toLowerCase(), `${forbidden} has no business here`).not.toContain(forbidden);
    }
  });

  it("reads and writes no row", () => {
    for (const forbidden of ["insert into", "update public.", "delete from", "truncate"]) {
      expect(applied.toLowerCase(), `${forbidden} would change data`).not.toContain(forbidden);
    }
  });

  it("keeps boxed a legal condition in the application", () => {
    expect(OFFER_CONDITIONS).toContain("boxed");
    expect(OFFER_CONDITIONS).toContain(V1_CONDITION);
  });

  it("says in its comment that boxed still exists", () => {
    // The projection narrows; the product does not lose a concept. A comment
    // claiming boxed is gone would be false and would mislead the next reader
    // into deleting data.
    const note = sql.slice(sql.indexOf("comment on function public.shop_offers()"));
    expect(note).toContain("boxed");
    expect(note.toLowerCase()).toContain("admin");
  });
});

describe("I — the shop verifier expects the same rule", () => {
  const verifier = readFileSync("tools/verify-shop.mts", "utf8");

  it("filters its own expectation by the V1 condition", () => {
    expect(verifier).toContain("if (position.condition !== V1_CONDITION) continue;");
  });

  it("takes that condition from the application, not from a fresh literal", () => {
    expect(verifier).toContain('import { automaticShopPrice, V1_CONDITION } from "../src/lib/shop/offer.ts";');
    expect(verifier).not.toMatch(/const\s+\w*[Cc]ondition\w*\s*=\s*"loose"/);
  });

  it("still computes the expectation from the raw tables, not from shop_offers()", () => {
    // The whole value of this verifier is that the two sides are independent.
    const fn = verifier.slice(verifier.indexOf("async function expectedOffers("));
    expect(fn).toContain('from("shop_inventory")');
    expect(fn).not.toContain('rpc("shop_offers")');
  });

  it("asserts the published condition instead of accepting any known one", () => {
    expect(verifier).toContain("every public offer is in the V1 sale condition");
    expect(verifier).not.toContain('row.condition === "loose" || row.condition === "boxed"');
  });
});

describe("J — the inventory verifier's ADR-0048 check still bites", () => {
  const verifier = readFileSync("tools/verify-inventory.mts", "utf8");

  it("no longer keys the claim on the inactive fixture", () => {
    /*
     * The fixture figure is created with `is_active = false`, so the catalog
     * gate keeps it out of the projection whatever its price and whatever its
     * condition. Asking whether SKY-9994/boxed is absent therefore proved
     * nothing — before 0029 as much as after it.
     */
    expect(verifier).not.toContain('o.sky_id === SKY && o.condition === "boxed"');
  });

  it("asserts the price rule over the whole projection, where it can be violated", () => {
    // Anchored on the predicate, not on the label: a renamed check still
    // contains its old name as a substring, so a label assertion would pass
    // on a check that had been turned off.
    expect(verifier).toContain("o.price === null || !(Number(o.price) > 0)");
    const claim = verifier.slice(verifier.indexOf("const priceless = publicOffers.filter("));
    expect(claim.slice(0, claim.indexOf(");", claim.indexOf("check(")))).toContain("priceless.length === 0");
  });

  it("refuses to pass on an empty projection", () => {
    // An invariant over nothing is satisfied by everything.
    expect(verifier).toContain("the public projection has offers to inspect");
  });

  it("also asserts the 0029 rule, from the application's constant", () => {
    expect(verifier).toContain("o.condition !== V1_CONDITION");
    expect(verifier).toContain('import { V1_CONDITION } from "../src/lib/shop/offer.ts";');
  });

  it("still proves boxed survives where it belongs", () => {
    expect(verifier).toContain("boxed stock stays visible to the administrator");
  });
});

describe("the application keeps filtering on its own side", () => {
  const offer = readFileSync("src/lib/shop/offer.ts", "utf8");

  it("keeps every V1 guard the surfaces rely on", () => {
    // 0029 is defence in depth, not a licence to trust the payload. A page
    // renders whatever it is handed, and what it is handed is a network
    // response.
    // `toContain("export function isV1Buyable")` also matches
    // `isV1BuyableRENAMED`, so the open bracket is part of the assertion.
    for (const guard of ["v1BuyableOffers", "hasV1BuyableOffer", "isV1Buyable"]) {
      expect(offer, `${guard} must still exist under that name`).toContain(
        `export function ${guard}(`,
      );
    }
  });

  it("keeps the cart guard", () => {
    expect(readFileSync("src/lib/cart/cart.ts", "utf8")).toContain("isV1Buyable(offer)");
  });

  it("keeps the quick view guard", () => {
    expect(readFileSync("src/lib/ui/quick-view.ts", "utf8")).toContain("v1BuyableOffers");
  });

  it("still parses both conditions defensively", () => {
    // The projection narrowing is not a reason to stop validating input.
    expect(offer).toContain('export const OFFER_CONDITIONS = ["loose", "boxed"] as const;');
  });
});
