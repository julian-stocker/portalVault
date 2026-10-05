import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";

/**
 * Migration `0108` — SkyIsles handelt ausschließlich mit losen Figuren.
 *
 * WAS DIESE TESTS BEWEISEN. Sie lesen die SQL und prüfen, dass sie das
 * Richtige sagt: der partielle Index filtert auf `loose`, beide Funktionen
 * fragen `v1_sale_condition()`, keine Signatur hat sich bewegt (also entsteht
 * keine zweite Overload), die Rechte sind dieselben, und keine Spalte und
 * keine Zeile wird angefasst.
 *
 * WAS SIE NICHT BEWEISEN. Dass PostgreSQL sich so verhält — das zeigen die
 * Staging-Proben. Beides ist nötig: eine Migration, die auf Staging grün ist,
 * deren Absicht aber nirgends festgeschrieben steht, lädt die nächste
 * Änderung ein, sie still zu verlieren.
 */
const DIR = "supabase/migrations";
const FILE = `${DIR}/0108_loose_only_inventory.sql`;
const SQL = readFileSync(FILE, "utf8");

/** Ohne Zeilenkommentare: der Kopf nennt gerade, was NICHT passiert. */
const CODE = SQL.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");

/**
 * Nur ausführbare SQL: zusätzlich ohne `comment on … is '…'`.
 *
 * Dieselbe Trennung wie in `migration-names.test.ts`, plus Blockkommentare:
 * die Erläuterungen dieser Migration nennen absichtlich
 * `shop_inventory_sky_condition_key` und `system_record_inventory_movement` —
 * sie erklären, was unberührt bleibt und wohin der historische Pfad führt.
 * Prosa darf das benennen; ausführbare SQL darf es nicht anfassen.
 */
const EXEC = CODE
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/comment\s+on\s+[\s\S]*?;\s*$/gim, "");

/** Der Rumpf einer Funktion, zwischen ihren `$$`-Marken. */
function body(name: string): string {
  const at = CODE.indexOf(`create or replace function public.${name}(`);
  expect(at, `${name} fehlt`).toBeGreaterThan(-1);
  const open = CODE.indexOf("as $$", at);
  return CODE.slice(open + 5, CODE.indexOf("$$;", open));
}

/** Signatur und Flags: von der Anlage bis zum Rumpf. */
function head(name: string): string {
  const at = CODE.indexOf(`create or replace function public.${name}(`);
  return CODE.slice(at, CODE.indexOf("as $$", at));
}

/** Die Parametertypen in Reihenfolge — das, was die Overload bestimmt. */
function params(name: string): string[] {
  const h = head(name);
  const inner = h.slice(h.indexOf("(") + 1, h.indexOf(")"));
  return inner
    .split(",")
    .map((p) => p.trim().split(/\s+/)[1])
    .filter(Boolean);
}

const GUARDED = [
  { name: "record_inventory_movement", types: "text, text, integer, text, numeric, text, text" },
  { name: "set_shop_listing", types: "text, text, numeric, boolean, text" },
] as const;

// ---------------------------------------------------------------------------
// 1. Der partielle Unique-Index
// ---------------------------------------------------------------------------

describe("die operative Identität: eine lose Lagerzeile pro Figur", () => {
  it("legt den partiellen Unique-Index an", () => {
    expect(CODE).toContain("create unique index if not exists shop_inventory_loose_sky_key");
    expect(CODE).toContain("on public.shop_inventory (sky_id)");
  });

  it("filtert ausschließlich auf loose", () => {
    const at = CODE.indexOf("create unique index if not exists shop_inventory_loose_sky_key");
    const stmt = CODE.slice(at, CODE.indexOf(";", at));
    expect(stmt).toContain("where condition = 'loose'");
    // Nicht über alle Zeilen: ein volles unique (sky_id) hätte historische
    // boxed-Zeilen verboten.
    expect(stmt).not.toMatch(/\(sky_id\)\s*;/);
  });

  it("benutzt im Prädikat ein Literal, nicht die Funktion", () => {
    /*
     * Ein Index-Prädikat wird beim Schreiben ausgewertet und gespeichert.
     * Änderte jemand `v1_sale_condition()`, würden bestehende Einträge nicht
     * neu bewertet — der Index wiche still von seiner eigenen Bedingung ab.
     * Die Begründung steht im Kopf der Migration; dieser Test hält sie fest.
     */
    const at = CODE.indexOf("create unique index if not exists shop_inventory_loose_sky_key");
    const stmt = CODE.slice(at, CODE.indexOf(";", at));
    expect(stmt).not.toContain("v1_sale_condition");
  });

  it("prüft vorher, ob er überhaupt wahr sein kann — und nennt die Figuren", () => {
    expect(CODE).toContain("having count(*) > 1");
    expect(CODE).toContain("string_agg(sky_id");
    expect(CODE).toContain("mehr als eine lose Lagerzeile");
  });

  it("lässt den bestehenden Index aus 0003 unberührt", () => {
    // `shop_inventory_sky_condition_key` ist die strukturelle Garantie; der
    // neue Index benennt nur, was sie schon garantiert.
    expect(EXEC).not.toContain("drop index");
    expect(EXEC).not.toContain("shop_inventory_sky_condition_key");
    // Im Kommentar des neuen Index steht er dagegen ausdrücklich.
    expect(CODE).toContain("shop_inventory_sky_condition_key (0003) remains");
  });
});

// ---------------------------------------------------------------------------
// 2. Die beiden Wächter
// ---------------------------------------------------------------------------

describe("die zwei operativen Schreibtüren sind zu", () => {
  for (const fn of GUARDED) {
    it(`${fn.name} fragt v1_sale_condition() und weist alles andere ab`, () => {
      const b = body(fn.name);
      expect(b).toContain("if p_condition is distinct from public.v1_sale_condition() then");
      expect(b).toContain("errcode = 'check_violation'");
      expect(b).toContain("SkyIsles führt nur lose Figuren");
    });

    it(`${fn.name} nennt die Bedingung nicht als Literal`, () => {
      // Gefragt, nicht behauptet — dasselbe Muster wie create_order seit 0028.
      const b = body(fn.name);
      expect(b).not.toContain("'loose'");
      expect(b).not.toContain("'boxed'");
    });

    it(`${fn.name} prüft den Rollenwächter weiterhin ZUERST`, () => {
      const b = body(fn.name);
      const role = b.indexOf("can_operate_active_seller()");
      const cond = b.indexOf("v1_sale_condition()");
      expect(role).toBeGreaterThan(-1);
      expect(role).toBeLessThan(cond);
    });
  }

  it("record_inventory_movement reicht unverändert an apply_inventory_movement weiter", () => {
    const b = body("record_inventory_movement");
    expect(b).toContain("return public.apply_inventory_movement(");
    expect(b).toContain("(select auth.uid())");
    // Kein zweiter Bestandsweg, keine eigene Mengenrechnung.
    expect(b).not.toContain("update public.shop_inventory");
    expect(b).not.toContain("insert into public.inventory_movements");
  });

  it("set_shop_listing behält den Upsert aus 0041 wörtlich", () => {
    const b = body("set_shop_listing");
    expect(b).toContain("insert into public.shop_inventory (sky_id, condition, sale_price, is_listed, note)");
    expect(b).toContain("on conflict (sky_id, condition) do update");
    expect(b).toContain("set sale_price = excluded.sale_price");
    expect(b).toContain("is_listed  = excluded.is_listed");
    expect(b).toContain("note       = excluded.note");
    // Und es fasst Menge und Reservierung weiterhin nicht an.
    expect(b).not.toContain("quantity");
    expect(b).not.toContain("reserved");
  });
});

// ---------------------------------------------------------------------------
// 3. Keine neue Overload, keine Rechteänderung
// ---------------------------------------------------------------------------

describe("die Signaturen haben sich nicht bewegt", () => {
  it("record_inventory_movement hat dieselben sieben Parameter in derselben Reihenfolge", () => {
    expect(params("record_inventory_movement"))
      .toEqual(["text", "text", "integer", "text", "numeric", "text", "text"]);
  });

  it("set_shop_listing hat dieselben fünf", () => {
    expect(params("set_shop_listing"))
      .toEqual(["text", "text", "numeric", "boolean", "text"]);
  });

  it("die Parameternamen und Defaults sind unverändert", () => {
    expect(head("record_inventory_movement")).toContain("p_unit_cost numeric default null");
    expect(head("record_inventory_movement")).toContain("p_currency  text    default null");
    expect(head("record_inventory_movement")).toContain("p_note      text    default null");
    expect(head("set_shop_listing")).toContain("p_note       text default null");
  });

  it("Rückgabetyp, Sprache, Sicherheitsmodus und search_path sind unverändert", () => {
    for (const fn of GUARDED) {
      const h = head(fn.name);
      expect(h, fn.name).toContain("returns bigint");
      expect(h, fn.name).toContain("language plpgsql");
      expect(h, fn.name).toContain("security definer");
      expect(h, fn.name).toContain("set search_path = ''");
      // Volatilität: in 0003/0041 nicht genannt, also der Standard `volatile`.
      // Ein `stable` hier wäre eine stille Verhaltensänderung.
      expect(h, fn.name).not.toContain("stable");
      expect(h, fn.name).not.toContain("immutable");
    }
  });

  it("die Signaturen stimmen mit der letzten vorhandenen Definition überein", () => {
    /*
     * Der eigentliche Overload-Test: 0108 wird gegen 0041 gehalten. Weicht
     * eine Parameterliste ab, entstünde eine zweite Funktion mit demselben
     * Namen — und PostgREST könnte danach die falsche erwischen.
     */
    const prev = readFileSync(`${DIR}/0041_three_account_authorization.sql`, "utf8");
    for (const fn of GUARDED) {
      const at = prev.indexOf(`create or replace function public.${fn.name}(`);
      expect(at, `${fn.name} fehlt in 0041`).toBeGreaterThan(-1);
      const prevHead = prev.slice(at, prev.indexOf("as $$", at));
      const prevTypes = prevHead
        .slice(prevHead.indexOf("(") + 1, prevHead.indexOf(")"))
        .split(",").map((p) => p.trim().split(/\s+/)[1]).filter(Boolean);
      expect(params(fn.name), fn.name).toEqual(prevTypes);
    }
  });

  it("legt keine andere Funktion an", () => {
    const created = [...CODE.matchAll(/create or replace function public\.([a-z_]+)\(/g)]
      .map((m) => m[1]).sort();
    expect(created).toEqual(["record_inventory_movement", "set_shop_listing"]);
  });

  it("setzt die Rechte identisch zu 0003 — und gibt nichts an public oder anon", () => {
    for (const fn of GUARDED) {
      expect(CODE).toContain(
        `revoke all on function public.${fn.name}(${fn.types})\n  from public, anon;`);
      expect(CODE).toContain(
        `grant execute on function public.${fn.name}(${fn.types})\n  to authenticated;`);
    }
    expect(CODE).not.toMatch(/grant[^;]*\bto\b[^;]*\b(public|anon|service_role)\b/);
  });
});

// ---------------------------------------------------------------------------
// 4. Was 0108 ausdrücklich nicht tut
// ---------------------------------------------------------------------------

describe("0108 bleibt in seinem Umfang", () => {
  it("setzt KEINEN CHECK auf condition", () => {
    /*
     * Der naheliegende Griff, und er wäre falsch: `set_shop_listing` und
     * `apply_inventory_movement` schreiben beide per INSERT … ON CONFLICT,
     * also würde ein CHECK auch jede Korrektur an einer historischen
     * boxed-Zeile verbieten. Die Regel gehört in die Funktion, wo sie später
     * eine benannte Ausnahme kennen kann.
     */
    expect(CODE).not.toMatch(/add constraint[^;]*condition/i);
    expect(CODE).not.toMatch(/check\s*\(\s*condition/i);
  });

  it("entfernt keine Spalte und ändert keine Tabelle", () => {
    for (const verboten of ["drop column", "alter table", "add column", "create table",
                            "drop constraint"]) {
      expect(CODE.toLowerCase().includes(verboten), `${verboten} gehört nicht in 0108`)
        .toBe(false);
    }
  });

  it("ändert keine Zeile und löscht nichts", () => {
    for (const verboten of ["update public.shop_inventory", "delete from", "truncate",
                            "insert into public.inventory_movements", "drop index",
                            "drop function"]) {
      expect(CODE.toLowerCase().includes(verboten.toLowerCase()),
        `${verboten} gehört nicht in 0108`).toBe(false);
    }
  });

  it("fasst die Legacy- und Importpfade nicht an", () => {
    for (const fremd of ["system_record_inventory_movement", "system_add_legacy",
                         "system_sync_legacy", "seller_apply_import", "legacy_stock_events",
                         "inventory_import_rows", "inventory_import_mappings"]) {
      expect(EXEC, `${fremd} darf 0108 nicht berühren`).not.toContain(fremd);
    }
    // Der Funktionskommentar NENNT den historischen Pfad — das ist der Punkt.
    expect(CODE).toContain("system_record_inventory_movement(), which no browser can reach");
  });

  it("baut nichts aus den späteren Schritten", () => {
    for (const spaeter of ["external_stock_holds", "seller_ship_sale", "seller_cancel_sale",
                           "shipped_at", "cancelled_at"]) {
      expect(CODE, `${spaeter} kommt später`).not.toContain(spaeter);
    }
  });

  it("ändert apply_inventory_movement nicht", () => {
    // Der kanonische Bestandsweg aus 0093 bleibt, wie er ist. 0108 sitzt
    // davor, nicht darin.
    expect(CODE).not.toContain("create or replace function public.apply_inventory_movement");
  });
});

// ---------------------------------------------------------------------------
// 5. Die Verträge, die nicht brechen dürfen
// ---------------------------------------------------------------------------

describe("v1_sale_condition() und die Backupverträge", () => {
  it("v1_sale_condition() liefert weiterhin loose — und 0108 ändert sie nicht", () => {
    const def = readFileSync(`${DIR}/0028_v1_loose_only_commerce.sql`, "utf8");
    expect(def).toContain("select 'loose'::text");
    expect(CODE).not.toContain("create or replace function public.v1_sale_condition");
  });

  it("0104 bis 0107 sind byte-identisch geblieben", () => {
    const hash = (file: string) =>
      createHash("sha256").update(readFileSync(`${DIR}/${file}`)).digest("hex");
    expect(hash("0104_business_backup_export.sql"))
      .toBe("2f9184f34bcab010d514b47b67c5884073539437064c67fb016c50f898714edf");
    expect(hash("0105_platform_export.sql"))
      .toBe("e1fbd1e35253c1900d3aa166a8026644f6bcf7dea4ba4c2b9af37fcd746c9e68");
    expect(hash("0106_platform_export_history.sql"))
      .toBe("242867f59efbcdb0a7031c11f51da6406fffc17b652832e985718eed1e0f5118");
    expect(hash("0107_platform_auth_inventory.sql"))
      .toBe("0352b4e352d2f14e4a7c1e2a23ea2acef3e44ae945a874806a8a805e26f3e0b2");
  });

  it("die Backupmanifeste führen condition unverändert weiter", async () => {
    /*
     * 0104 und 0105 nennen `t.condition` und `inv.condition` wörtlich. Solange
     * die Spalte steht, bleiben beide Exportfunktionen aufrufbar — genau
     * deshalb entfernt 0108 keine Spalte. Dieser Test hält fest, dass der
     * Vertrag unberührt ist.
     */
    const business = await import("@/lib/backup/manifest");
    const platform = await import("@/lib/backup/platform-manifest");
    const withCondition = (sections: readonly { key: string; fields: readonly string[];
      denormalised?: readonly { field: string }[] }[]) =>
      sections.filter((s) => s.fields.includes("condition")
        || (s.denormalised ?? []).some((d) => d.field === "condition")).map((s) => s.key);

    const expected = ["shop_inventory", "inventory_movements", "purchase_items",
                      "sale_items", "order_lines", "order_reservations"];
    expect(withCondition(business.BACKUP_SECTIONS)).toEqual(expected);
    expect(withCondition(platform.PLATFORM_SECTIONS)).toEqual(expected);
  });

  it("die Verifier prüfen den neuen Vertrag, statt den alten zu löschen", () => {
    /*
     * Beide Verifier hatten boxed-ERFOLGSTESTS. Sie sind zu negativen
     * Vertragstests geworden, nicht verschwunden — und der Legacy-/Systempfad
     * wird weiterhin mit `boxed` geprüft, weil er historische Daten
     * verarbeitet und kein Teil des operativen Wegs ist.
     */
    const inv = readFileSync("tools/verify-inventory.mts", "utf8");
    expect(inv).toContain("the operative path refuses a movement that is not loose (0108)");
    expect(inv).toContain("the operative path refuses a listing that is not loose (0108)");
    expect(inv).toContain('boxedMovement.error?.code === "23514"');
    expect(inv).toContain('boxedListing.error?.code === "23514"');
    expect(inv).toContain("one operative position for one figure (0108)");
    // Und die Lesbarkeit historischer Zeilen bleibt eine Zusicherung.
    expect(inv).toContain("0108 closes writes, not reads");

    const rls = readFileSync("tools/verify-rls.mts", "utf8");
    expect(rls).toContain("loose still books after 0108");
    expect(rls).toContain("the operative movement path refuses a condition other than loose (0108)");
    expect(rls).toContain("the operative listing path refuses a condition other than loose (0108)");
    // Der Legacy-Pfad behält boxed, mit ausdrücklicher Begründung.
    expect(rls).toContain("`boxed` BLEIBT HIER ABSICHTLICH (0108)");
    expect(rls).toContain('p_sky_id: SHOP_SKY_ID, p_condition: "boxed", p_delta: 7, p_reason: "initial_import"');
  });

  it("kein operativer Verifier-Aufruf schickt mehr boxed in Erfolgserwartung", () => {
    const inv = readFileSync("tools/verify-inventory.mts", "utf8");
    const rls = readFileSync("tools/verify-rls.mts", "utf8");
    // `record_inventory_movement`/`set_shop_listing` mit boxed darf nur noch
    // in einem Test vorkommen, der einen Fehler ERWARTET.
    for (const [name, code] of [["verify-inventory", inv], ["verify-rls", rls]] as const) {
      /*
       * `[^}]` statt `.` mit dem `s`-Flag: es trifft Zeilenumbrüche von selbst,
       * und das Ziel dieses Projekts ist älter als `dotAll`.
       *
       * UND ES BINDET DIE SUCHE AN DAS AUFRUFOBJEKT. Mit einem ungebundenen
       * `[\s\S]*?` reichte ein Treffer über das Ende seines Aufrufs hinaus bis
       * zum nächsten `p_condition: "boxed"` — und das nächste gehört dem
       * SYSTEMPFAD, der boxed absichtlich behält. Der Test schlug dann an
       * einer Stelle an, an der nichts falsch war.
       */
      const calls = [...code.matchAll(
        /rpc\("(record_inventory_movement|set_shop_listing)",\s*\{[^}]*?p_condition:\s*"boxed"[^}]*?\}/g)];
      for (const call of calls) {
        // Nach jedem solchen Aufruf muss eine Fehlererwartung stehen.
        const after = code.slice((call.index ?? 0) + call[0].length, (call.index ?? 0) + call[0].length + 400);
        expect(after, `${name}: boxed-Aufruf ohne Fehlererwartung`)
          .toMatch(/error\s*(!==\s*null|\?\.code)/);
      }
    }
  });

  it("und keine spätere Migration nimmt die Loose-only-Regel zurück", () => {
    /*
     * HIER STAND `files.at(-1) === "0108…"`.
     *
     * Das war eine Momentaufnahme und keine Invariante: `0109` hat sie
     * fallen lassen, ohne dass irgendetwas an `0108` falsch geworden wäre.
     * Was dieser Test wirklich schützen soll, ist das Gegenteil einer
     * Nummer — dass die Regel hält, auch nachdem andere Migrationen dazu
     * gekommen sind. Also wird jetzt die GEFALTETE Historie gelesen, wie
     * `latestFunction` es überall sonst tut.
     */
    const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
    expect(files).toContain("0108_loose_only_inventory.sql");

    const later = files.filter((f) => f > "0108_loose_only_inventory.sql");
    for (const file of later) {
      const sql = readFileSync(`${DIR}/${file}`, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n")
        .replace(/comment\s+on\s+[\s\S]*?;\s*$/gim, "");
      // Der Index darf nicht verschwinden …
      expect(sql, `${file} löscht shop_inventory_loose_sky_key`)
        .not.toContain("drop index if exists public.shop_inventory_loose_sky_key");
      expect(sql, `${file} löscht shop_inventory_loose_sky_key`)
        .not.toContain("drop index shop_inventory_loose_sky_key");
      // … und wer eine der beiden Funktionen neu schreibt, muss den Wächter
      // mitschreiben. Ein `create or replace` ohne ihn wäre die stille
      // Rücknahme, gegen die dieser Test steht.
      for (const fn of ["record_inventory_movement", "set_shop_listing"]) {
        const at = sql.indexOf(`create or replace function public.${fn}(`);
        if (at === -1) continue;
        const open = sql.indexOf("as $$", at);
        const rewritten = sql.slice(open, sql.indexOf("$$;", open));
        expect(rewritten, `${file} schreibt ${fn} ohne den Loose-only-Wächter neu`)
          .toContain("public.v1_sale_condition()");
      }
    }
  });
});
