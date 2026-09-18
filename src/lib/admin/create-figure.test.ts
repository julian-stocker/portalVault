import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Creating a catalogue figure: the identity, the transaction, the journal and
 * who may do it (V3.9, ADR-0070).
 *
 * WHAT THIS FILE CAN AND CANNOT PROVE
 *
 * Nothing in this product talks to a database from a test. So these hold the
 * SQL's SHAPE — that the allocator is a sequence and not a max()+1, that the
 * ceiling is checked before the insert, that the admin check comes first,
 * that no client role gains a write — and `supabase/tests/0033_slug_parity.sql`
 * is what gets executed against staging. The split is the one
 * `lib/ui/quick-view-ux.test.ts` already uses for layout.
 */
const MIGRATION = "supabase/migrations/0033_admin_created_figures.sql";
const ACTION = "src/lib/admin/create-actions.ts";
const IMPORT = "tools/import-catalog.mts";

const source = (path: string) => readFileSync(path, "utf8");

/** The source with comments stripped, so an explanation cannot satisfy a test. */
const code = (path: string) =>
  source(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*--.*$/gm, "")
    .replace(/^\s*\/\/.*$/gm, "");

function fn(sql: string, name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}`);
  expect(start, name).toBeGreaterThan(-1);
  const end = sql.indexOf("$$;", start);
  return sql.slice(start, end);
}

describe("the SKY-ID comes from a sequence, and only from there", () => {
  const sql = code(MIGRATION);

  it("starts one past the legacy high-water mark", () => {
    // The legacy ledger's `highest_issued` is 820 and the allocator there is
    // frozen (ADR-0070). Verified read-only against both environments before
    // this migration was written: neither holds a SKY-ID in 0821-8999.
    expect(sql).toContain("create sequence if not exists public.sky_id_seq as bigint start with 821");
  });

  it("is never read by anything but the create function", () => {
    // A caller who reaches a sequence can burn numbers — 0010 records how
    // that was found out about `order_number_seq`.
    expect(sql).toContain("revoke all on sequence public.sky_id_seq from public, anon, authenticated");
    expect((sql.match(/nextval\('public\.sky_id_seq'\)/g) ?? []).length).toBe(1);
  });

  it("never computes an identity from the rows that exist", () => {
    /*
     * `select max(sky_id) + 1` is the whole reason this is a sequence: two
     * simultaneous creates read the same maximum and write the same identity.
     */
    expect(sql).not.toMatch(/max\(\s*sky_id/i);
    expect(sql).not.toContain("count(*) + 1");
  });

  it("stops below the reserved system/test range", () => {
    expect(sql).toContain("if v_next > 8999 then");
    // And says why, because the next person to read the error will not have
    // this migration open.
    expect(source(MIGRATION)).toContain("reserved system/test range");
  });

  it("checks the ceiling before it writes, not after", () => {
    const create = fn(sql, "admin_create_figure");
    expect(create.indexOf("v_next > 8999")).toBeLessThan(create.indexOf("insert into public.skylanders"));
  });

  it("formats to four digits", () => {
    expect(sql).toContain("'SKY-' || lpad(v_next::text, 4, '0')");
  });

  it("does not narrow the global format constraint", () => {
    /*
     * The format says what a SKY-ID may LOOK like; the 8999 ceiling says what
     * may be ISSUED. `SKY-9994` and `SKY-9998` are valid rows in daily use,
     * and a CHECK narrowed to 8999 would invalidate them.
     */
    expect(sql).not.toContain("skylanders_sky_id_format");
    expect(sql).not.toContain("SKY-[0-8]");
  });
});

describe("source is provenance, and is used for nothing else", () => {
  const sql = code(MIGRATION);

  it("is NOT NULL with a default, so no backfill is needed", () => {
    expect(sql).toContain("add column if not exists source text not null default 'import'");
    expect(sql).toContain("check (source in ('import', 'admin'))");
  });

  it("is set to admin by the create function", () => {
    expect(fn(sql, "admin_create_figure")).toContain("'admin'");
  });

  it("is read in exactly one place in the product, and only to skip a warning", () => {
    /*
     * The one permitted use (ADR-0070): the import tells its own rows apart
     * so an admin-created figure does not sit in "in the database but not in
     * the export" forever. Anything else - visibility, permissions, commerce,
     * which artwork is printed, ordering - would make it a class rather than
     * a provenance.
     */
    const importer = code(IMPORT);
    expect(importer).toContain('(row.source as string | null) !== "admin"');
    expect((importer.match(/\.source\b/g) ?? []).length).toBe(1);
  });

  it("never reaches a row through the import payload", () => {
    // The payload is pinned in import-payload.test.ts as well; this is the
    // same rule stated where `source` was introduced.
    const payload = code(IMPORT).slice(code(IMPORT).indexOf("figures.push({"));
    expect(payload.slice(0, 400)).not.toContain("source");
  });
});

describe("the create is one transaction", () => {
  const create = fn(code(MIGRATION), "admin_create_figure");

  it("asks who is calling before it does anything else", () => {
    expect(create).toContain("if not public.is_shop_admin() then");
    expect(create).toContain("errcode = 'insufficient_privilege'");
    expect(create.indexOf("is_shop_admin")).toBeLessThan(create.indexOf("nextval"));
  });

  it("writes the row, the note and the journal entry in one function", () => {
    expect(create).toContain("insert into public.skylanders");
    expect(create).toContain("insert into public.catalog_editorial");
    expect(create).toContain("insert into public.catalog_admin_changes");
  });

  it("returns the identity it issued", () => {
    expect(create).toContain("return v_sky_id");
    expect(code(MIGRATION)).toContain("returns text");
  });

  it("hides the new figure by default", () => {
    expect(code(MIGRATION)).toContain("p_catalog_visible       boolean default false");
    expect(create).toContain("coalesce(p_catalog_visible, false)");
  });

  it("defaults the card type to standard", () => {
    expect(code(MIGRATION)).toContain("p_card_type             text    default 'standard'");
  });

  it("writes no column that belongs to somebody else", () => {
    /*
     * `market_price` is the legacy path (ADR-0007), `image_file` the import's
     * (ADR-0009), `image_override_path` the storage bucket's (ADR-0046) and
     * `character_id` the curated file's (ADR-0034). None of them is a
     * parameter, and none is named in the INSERT.
     */
    for (const owned of ["market_price", "price_updated_at", "image_file", "image_override_path", "character_id"]) {
      expect(create, owned).not.toContain(owned);
    }
  });

  it("takes neither a SKY-ID nor a slug from its caller", () => {
    expect(create).not.toContain("p_sky_id");
    expect(create).not.toContain("p_slug");
    expect(create).toContain("public.next_figure_slug(");
  });

  it("writes an empty note as no note at all", () => {
    // An empty row in catalog_editorial is a note that says nothing, and its
    // INSERT trigger would journal it as a change.
    expect(create).toContain("if v_note is not null then");
    expect(create).toContain("nullif(btrim(coalesce(p_admin_note, '')), '')");
  });

  it("does not re-ask whether the category belongs to the series", () => {
    // `skylanders_category_fk` is composite and decides that. One rule, in
    // one place.
    expect(create).not.toContain("select 1 from public.categories");
  });
});

describe("the journal gains two fields and no second system", () => {
  const sql = code(MIGRATION);

  it("knows created and card_type", () => {
    expect(sql).toContain("'image_override_path', 'card_type', 'created'");
  });

  it("logs the creation once, from the function", () => {
    const create = fn(sql, "admin_create_figure");
    expect(create).toContain("'created', null, v_name");
    expect((create.match(/insert into public\.catalog_admin_changes/g) ?? []).length).toBe(1);
  });

  it("logs card_type from the trigger, so no caller can avoid it", () => {
    /*
     * ONE SOURCE PER MUTATION. Logging inside `admin_set_card_type()` would
     * cover that one caller; a service-role UPDATE or a later second RPC
     * would write the column and leave nothing behind. The trigger sits on
     * the table.
     */
    const trigger = fn(sql, "log_skylander_editorial_change");
    expect(trigger).toContain("new.card_type is distinct from old.card_type");
    expect(trigger).toContain("'card_type'");
  });

  it("does not also log card_type from the setter, which would double it", () => {
    expect(sql).not.toContain("create or replace function public.admin_set_card_type");
  });

  it("stays an AFTER UPDATE trigger, so the create is not journalled twice", () => {
    // An INSERT does not fire it, which is why a new figure gets one
    // `created` entry rather than one entry per column.
    expect(source(MIGRATION)).toContain("It stays AFTER UPDATE");
    expect(sql).not.toContain("after insert on public.skylanders");
  });

  it("backfills nothing", () => {
    /*
     * A row invented now would claim a timestamp and an actor nobody knows.
     * What that rules out is a SET-BASED insert - one that reads the figures
     * table and writes a journal entry per row. The per-row insert in the
     * create function is the opposite of a backfill: it records something
     * that is happening.
     */
    const inserts = [...sql.matchAll(/insert into public\.catalog_admin_changes([\s\S]{0,240})/gi)];
    expect(inserts.length).toBeGreaterThan(0);
    for (const [, tail] of inserts) {
      // Every one states its row literally. A backfill would read the
      // catalogue and invent an entry per figure.
      expect(tail).toContain("values");
      expect(tail.toLowerCase()).not.toContain("select *");
      expect(tail.toLowerCase()).not.toContain("from public.skylanders");
    }
  });
});

describe("no client may write the catalogue", () => {
  const sql = code(MIGRATION);

  it("opens no table privilege at all", () => {
    for (const grant of [
      "grant insert on public.skylanders",
      "grant update on public.skylanders",
      "grant delete on public.skylanders",
      "grant all on public.skylanders",
    ]) {
      expect(sql, grant).not.toContain(grant);
    }
  });

  it("revokes the function from all three before granting it", () => {
    // Supabase grants EXECUTE on every new function in `public` to anon and
    // authenticated explicitly, so revoking PUBLIC alone leaves both.
    expect(sql).toContain(
      "revoke all on function public.admin_create_figure(text, text, bigint, text, boolean, text, text)\n  from public, anon, authenticated",
    );
    expect(sql).toContain("to authenticated");
  });

  it("keeps its helpers unreachable", () => {
    expect(sql).toContain("revoke all on function public.slugify(text) from public, anon, authenticated");
    expect(sql).toContain(
      "revoke all on function public.next_figure_slug(text, text, text) from public, anon, authenticated",
    );
  });

  it("runs every function with an empty search path", () => {
    for (const name of ["slugify", "next_figure_slug", "admin_create_figure", "log_skylander_editorial_change"]) {
      expect(fn(sql, name), name).toContain("set search_path = ''");
    }
  });

  it("makes only the create a definer — the helpers need no privileges", () => {
    expect(fn(sql, "admin_create_figure")).toContain("security definer");
    expect(fn(sql, "slugify")).not.toContain("security definer");
    expect(fn(sql, "next_figure_slug")).not.toContain("security definer");
  });
});

describe("there is no delete", () => {
  const sql = code(MIGRATION);

  it("adds no delete function and no delete grant", () => {
    /*
     * `collection_items` and `shop_inventory` are both `on delete restrict`,
     * and `order_lines.sky_id` is not a foreign key at all — a delete is
     * either refused or quietly leaves order lines pointing at nothing. A
     * figure created by mistake is hidden through the editor that exists, and
     * its SKY-ID stays spent (ADR-0001).
     */
    expect(sql).not.toContain("admin_delete_figure");
    expect(sql).not.toMatch(/delete from public\.skylanders/i);
  });
});

describe("the action sends no identity and decides nothing", () => {
  const action = code(ACTION);

  it("calls the one function and passes no SKY-ID or slug", () => {
    expect(action).toContain('supabase.rpc("admin_create_figure"');
    expect(action).not.toContain("p_sky_id");
    expect(action).not.toContain("p_slug");
  });

  it("asks isPlatformAdmin() for the message, not as the boundary", () => {
    expect(action).toContain("await isPlatformAdmin()");
    expect(action).toContain("de.admin.notAllowed");
  });

  it("returns the issued identity, because the picture needs it", () => {
    expect(action).toContain("ok: true; skyId: string");
    expect(action).toContain("return { ok: true, skyId: data }");
  });

  it("never retries by itself", () => {
    /*
     * A retry would draw a second sequence value, and a failed create that
     * silently becomes a different SKY-ID is exactly the confusion a
     * permanent identity must not produce.
     */
    // One rpc call in the whole module: there is no path that creates twice.
    expect((action.match(/supabase\.rpc\(/g) ?? []).length).toBe(1);
  });

  it("uses no service-role key", () => {
    expect(action).not.toContain("SERVICE_ROLE");
  });
});
