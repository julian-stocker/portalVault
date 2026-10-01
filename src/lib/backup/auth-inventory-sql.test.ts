import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  AUTH_FORBIDDEN_FIELDS,
  AUTH_INVENTORY_DISCLAIMER,
  AUTH_INVENTORY_FIELDS,
  PLATFORM_ARCHIVE_LAYOUT,
} from "./platform-manifest";

/**
 * Migration `0107` gegen den Auth-Vertrag.
 *
 * DIE EINE PRÜFUNG, DIE HIER WIRKLICH ZÄHLT. `raw_app_meta_data` steht in
 * `AUTH_FORBIDDEN_FIELDS` — und muss trotzdem im SQL vorkommen, weil
 * `provider` daraus abgeleitet wird. Ein Test, der bloß
 * `expect(sql).not.toContain("raw_app_meta_data")` schriebe, wäre also
 * entweder rot oder müsste die Zeichenkette ausnehmen und damit auch ein
 * `'meta', u.raw_app_meta_data` durchlassen. Beides wäre Scheinsicherheit.
 *
 * Deshalb arbeitet diese Datei auf den AUSGABEPAAREN des
 * `jsonb_build_object` und auf jeder einzelnen Spaltenreferenz `u.<spalte>`:
 * welche Schlüssel entstehen, welcher Ausdruck steht hinter jedem, und wird
 * das verbotene Objekt an jeder Stelle, an der es auftaucht, unmittelbar mit
 * `->> 'provider'` zu Text reduziert.
 */
const DIR = "supabase/migrations";
const FILE = `${DIR}/0107_platform_auth_inventory.sql`;
const SQL = readFileSync(FILE, "utf8");

/** Ohne Zeilenkommentare: der Kopf nennt gerade die verbotenen Felder. */
const CODE = SQL.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");

/** Der Rumpf, zwischen den `$$`-Marken. */
const BODY = CODE.slice(CODE.indexOf("as $$") + 5, CODE.indexOf("$$;"));

/** Signatur und Flags: von der Anlage bis zum Rumpf. */
const HEAD = CODE.slice(
  CODE.indexOf("create or replace function public.system_auth_inventory("),
  CODE.indexOf("as $$"),
);

/**
 * Die Ausgabepaare des `jsonb_build_object`, geparst.
 *
 * Klammerbilanziert und zeichenkettenbewusst, damit `->> 'provider'` nicht
 * als Argumenttrenner missverstanden wird. Liefert `{ key, expression }` je
 * Paar — genau die Zuordnung, um die es geht: welcher Name trägt welchen Wert.
 */
function outputPairs(text: string): { key: string; expression: string }[] {
  const NAME = "jsonb_build_object";
  const at = text.indexOf(`${NAME}(`);
  expect(at, "jsonb_build_object fehlt").toBeGreaterThan(-1);

  const args: string[] = [];
  let depth = 0;
  let inString = false;
  let start = 0;
  for (let i = at + NAME.length; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "'") inString = false;
      continue;
    }
    if (c === "'") { inString = true; continue; }
    if (c === "(") { depth++; if (depth === 1) start = i + 1; continue; }
    if (c === ")") { depth--; if (depth === 0) { args.push(text.slice(start, i)); break; } continue; }
    if (c === "," && depth === 1) { args.push(text.slice(start, i)); start = i + 1; }
  }

  expect(args.length % 2, "ungerade Argumentzahl").toBe(0);
  const pairs: { key: string; expression: string }[] = [];
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].trim().replace(/^'(.*)'$/, "$1");
    pairs.push({ key, expression: args[i + 1].trim().replace(/\s+/g, " ") });
  }
  return pairs;
}

const PAIRS = outputPairs(BODY);

/** Jede Spaltenreferenz auf `auth.users`, mit ihrer Position. */
const COLUMN_REFS = [...BODY.matchAll(/\bu\.([a-z_0-9]+)/g)]
  .map((m) => ({ column: m[1], at: m.index ?? 0 }));

// ---------------------------------------------------------------------------
// 1. Form und Wächter
// ---------------------------------------------------------------------------

describe("system_auth_inventory() hat die vereinbarte Form", () => {
  it("existiert und heißt so", () => {
    expect(CODE).toContain("create or replace function public.system_auth_inventory()");
    expect(HEAD).toContain("returns jsonb");
  });

  it("ist language sql, stable, security definer mit leerem search_path", () => {
    expect(HEAD).toContain("language sql");
    expect(HEAD).toContain("stable");
    expect(HEAD).toContain("security definer");
    expect(HEAD).toContain("set search_path = ''");
    expect(HEAD).not.toContain("volatile");
    expect(HEAD).not.toContain("security invoker");
  });

  it("hat genau einen Wächter, und es ist der kanonische", () => {
    expect(BODY.match(/is_platform_admin\(\)/g) ?? []).toHaveLength(1);
    expect(BODY).toContain("select case when not public.is_platform_admin() then null else");
    for (const fremd of ["is_shop_admin", "can_operate_active_seller", "platform_admins",
                         "current_role", "session_user", "current_user"]) {
      expect(BODY, `${fremd} wäre ein zweiter Rollenbegriff`).not.toContain(fremd);
    }
  });

  it("liefert einem Nicht-Admin SQL-NULL, keinen Fehler", () => {
    // „nicht deins" und „nichts vorhanden" sollen gleich aussehen.
    expect(BODY).toMatch(/then null else/);
    expect(BODY).not.toContain("raise exception");
    expect(BODY).not.toContain("errcode");
  });

  it("ist genau eine Anweisung", () => {
    expect((BODY.match(/;/g) ?? []).length).toBe(1);
    expect(BODY.trimEnd().endsWith(";")).toBe(true);
    expect(BODY.trimStart().startsWith("select case when")).toBe(true);
    expect(BODY).not.toContain("begin");
  });

  it("gibt ein leeres Array aus, wenn es keine Konten gibt", () => {
    // Nicht `null`: ein Admin ohne Konten und ein Nicht-Admin sollen sich
    // unterscheiden lassen, sonst ist das Inventar nicht auswertbar.
    expect(BODY).toContain("'[]'::jsonb");
    expect(BODY).toContain("coalesce((");
  });
});

// ---------------------------------------------------------------------------
// 2. Genau die sieben Felder
// ---------------------------------------------------------------------------

describe("ausschließlich die sieben erlaubten Ausgabefelder", () => {
  it("die Schlüssel sind genau AUTH_INVENTORY_FIELDS, in derselben Reihenfolge", () => {
    expect(PAIRS.map((p) => p.key)).toEqual([...AUTH_INVENTORY_FIELDS]);
    expect(AUTH_INVENTORY_FIELDS).toHaveLength(7);
  });

  it("jedes Feld trägt den Ausdruck, den der Vertrag vorsieht", () => {
    const expected: Record<string, string> = {
      id: "u.id",
      email: "u.email::text",
      created_at: "u.created_at",
      last_sign_in_at: "u.last_sign_in_at",
      email_confirmed_at: "u.email_confirmed_at",
      provider: "u.raw_app_meta_data ->> 'provider'",
      banned_until: "u.banned_until",
    };
    for (const pair of PAIRS) {
      expect(pair.expression, `${pair.key} trägt den falschen Ausdruck`)
        .toBe(expected[pair.key]);
    }
  });

  it("liest keine Spalte, die nicht ausgegeben wird", () => {
    /*
     * Die Gegenrichtung: eine gelesene Spalte, die in keinem Paar landet,
     * wäre ein Zugriff ohne Zweck — und der nächste Schritt dahinter wäre,
     * sie doch auszugeben. `provider` ist kein Spaltenname, `raw_app_meta_data`
     * ist die Quelle dafür.
     */
    const erlaubt = new Set([
      ...AUTH_INVENTORY_FIELDS.filter((f) => f !== "provider"),
      "raw_app_meta_data",
    ]);
    const gelesen = [...new Set(COLUMN_REFS.map((r) => r.column))].sort();
    expect(gelesen).toEqual([...erlaubt].sort());
  });

  it("liest nur auth.users und nichts sonst", () => {
    const quellen = [...BODY.matchAll(/(?:from|join)\s+([a-z_0-9.]+)/g)].map((m) => m[1]);
    expect(quellen).toEqual(["auth.users"]);
  });

  it("nimmt nie die ganze Zeile", () => {
    /*
     * Jede dieser Formen würde das gesamte `auth.users`-Tupel ausgeben —
     * Passwortnachweis, Tokens und MFA-Verweise inbegriffen.
     */
    for (const alles of ["to_jsonb(u)", "to_json(u)", "row_to_json", "u.*",
                         "select *", "jsonb_agg(u)", "jsonb_agg(to_", "(u).*"]) {
      expect(BODY, `${alles} gäbe die ganze Zeile aus`).not.toContain(alles);
    }
  });

  it("filtert nicht — ein Inventar lässt kein Konto weg", () => {
    expect(BODY).not.toMatch(/\bwhere\b/i);
    expect(BODY).not.toMatch(/\blimit\b/i);
    expect(BODY).not.toContain("deleted_at");
  });
});

// ---------------------------------------------------------------------------
// 3. Die zwölf verbotenen Felder — und der eine erlaubte Sonderfall
// ---------------------------------------------------------------------------

describe("kein Passwort, kein Token, kein MFA-Geheimnis", () => {
  /** Die zwölf, die niemals mitkommen. */
  const FORBIDDEN = Object.keys(AUTH_FORBIDDEN_FIELDS);

  it("es sind die zwölf, von denen wir reden", () => {
    expect(FORBIDDEN).toHaveLength(12);
    expect(FORBIDDEN.sort()).toEqual([
      "confirmation_token", "email_change_token_current", "email_change_token_new",
      "encrypted_password", "encrypted_secret", "factors", "identities",
      "phone_change_token", "raw_app_meta_data", "raw_user_meta_data",
      "reauthentication_token", "recovery_token",
    ]);
  });

  for (const feld of Object.keys(AUTH_FORBIDDEN_FIELDS)) {
    it(`${feld} ist kein Ausgabefeld`, () => {
      // Als SCHLÜSSEL darf keines vorkommen — geprüft an den geparsten
      // Paaren, nicht an der Zeichenkette.
      expect(PAIRS.map((p) => p.key)).not.toContain(feld);
    });
  }

  for (const feld of Object.keys(AUTH_FORBIDDEN_FIELDS).filter((f) => f !== "raw_app_meta_data")) {
    it(`${feld} wird nicht einmal gelesen`, () => {
      expect(COLUMN_REFS.map((r) => r.column), `u.${feld} kommt vor`).not.toContain(feld);
      expect(BODY, `${feld} steht im Rumpf`).not.toContain(feld);
    });
  }

  it("kein Ausgabeausdruck nennt ein verbotenes Feld — außer der Ableitung", () => {
    for (const pair of PAIRS) {
      for (const feld of FORBIDDEN) {
        if (feld === "raw_app_meta_data" && pair.key === "provider") continue;
        expect(pair.expression, `${pair.key} liest ${feld}`).not.toContain(feld);
      }
    }
  });
});

describe("raw_app_meta_data — die Ableitung ist erlaubt, das Objekt nicht", () => {
  /*
   * Der Kern dieser Datei. Die Spalte MUSS vorkommen, weil `provider` daraus
   * entsteht; sie darf aber niemals als Objekt in die Ausgabe geraten. Der
   * Unterschied liegt in dem, was unmittelbar dahinter steht.
   */

  it("kommt genau einmal vor", () => {
    const treffer = COLUMN_REFS.filter((r) => r.column === "raw_app_meta_data");
    expect(treffer).toHaveLength(1);
    expect(BODY.match(/raw_app_meta_data/g) ?? []).toHaveLength(1);
  });

  it("wird an jeder Stelle unmittelbar mit ->> 'provider' zu Text reduziert", () => {
    /*
     * `->>` liefert `text`, `->` lieferte `jsonb` — der Unterschied zwischen
     * einem Wort und einem Objekt, das Anbietergeheimnisse tragen kann.
     */
    for (const ref of COLUMN_REFS.filter((r) => r.column === "raw_app_meta_data")) {
      const danach = BODY.slice(ref.at);
      expect(danach, "raw_app_meta_data ohne ->> 'provider'")
        .toMatch(/^u\.raw_app_meta_data\s*->>\s*'provider'/);
    }
  });

  it("nicht mit -> , das gäbe jsonb zurück", () => {
    expect(BODY).not.toMatch(/raw_app_meta_data\s*->(?!>)/);
  });

  it("und ist nur dem Feld provider zugeordnet", () => {
    const traeger = PAIRS.filter((p) => p.expression.includes("raw_app_meta_data"));
    expect(traeger.map((p) => p.key)).toEqual(["provider"]);
  });

  it("der Test erkennt die verbotene Form tatsächlich — Selbstprobe", () => {
    /*
     * Ohne diese Probe wäre nicht belegt, dass die Prüfung oben überhaupt
     * etwas fängt. Hier wird die verbotene Form künstlich eingesetzt und
     * dieselbe Regel darauf angewandt; sie muss anschlagen.
     */
    const boese = BODY.replace(
      "'provider',           u.raw_app_meta_data ->> 'provider'",
      "'provider',           u.raw_app_meta_data",
    );
    const refs = [...boese.matchAll(/\bu\.([a-z_0-9]+)/g)]
      .filter((m) => m[1] === "raw_app_meta_data");
    const verstoesse = refs.filter(
      (m) => !/^u\.raw_app_meta_data\s*->>\s*'provider'/.test(boese.slice(m.index ?? 0)),
    );
    expect(verstoesse.length, "die Regel hätte anschlagen müssen").toBeGreaterThan(0);

    // Und derselbe Gegentest für die Paare.
    const paare = outputPairs(boese);
    expect(paare.find((p) => p.key === "provider")!.expression).toBe("u.raw_app_meta_data");
    expect(paare.find((p) => p.key === "provider")!.expression)
      .not.toBe("u.raw_app_meta_data ->> 'provider'");
  });

  it("die echte Form besteht dieselbe Regel", () => {
    const paar = PAIRS.find((p) => p.key === "provider")!;
    expect(paar.expression).toBe("u.raw_app_meta_data ->> 'provider'");
  });
});

// ---------------------------------------------------------------------------
// 4. Sortierung, Schreibfreiheit, keine dynamische SQL
// ---------------------------------------------------------------------------

describe("deterministisch, lesend, statisch", () => {
  it("sortiert nach auth.users.id", () => {
    // Ohne feste Reihenfolge wären zwei Sicherungen desselben Zustands nicht
    // vergleichbar — und der Hash in platform_export_runs wäre wertlos.
    expect(BODY).toContain("order by u.id");
    expect(BODY).not.toContain("order by u.created_at");
    expect(BODY).not.toContain("order by u.email");
    expect(BODY.match(/order by/g) ?? []).toHaveLength(1);
  });

  it("schreibt nichts — in keiner Form", () => {
    for (const write of ["insert into", "update ", "delete from", "create table",
                         "create temp", "alter table", "truncate", "merge into",
                         "nextval", "setval", "txid_current()", "for update"]) {
      expect(BODY.toLowerCase().includes(write), `${write} darf nicht vorkommen`).toBe(false);
    }
  });

  it("baut nichts zur Laufzeit zusammen", () => {
    for (const dynamisch of ["execute", "format(", "quote_ident", "quote_literal",
                             "string_agg(", "dblink", "pg_read_file"]) {
      expect(BODY.toLowerCase().includes(dynamisch), `${dynamisch} wäre dynamische SQL`)
        .toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Rechte
// ---------------------------------------------------------------------------

describe("nur authenticated, und der Wächter dahinter", () => {
  it("entzieht public und anon", () => {
    expect(CODE).toContain(
      "revoke all     on function public.system_auth_inventory() from public, anon;");
  });

  it("entzieht die Service Role ausdrücklich", () => {
    /*
     * Wie in 0106: Supabase' Default-Privileges vergeben EXECUTE an
     * service_role, obwohl keine Migration es tut. Der Export läuft in der
     * Sitzung des Admins; ein Service-Role-Schlüssel hat hier nichts zu
     * suchen.
     */
    expect(CODE).toContain(
      "revoke execute on function public.system_auth_inventory() from service_role;");
  });

  it("vergibt EXECUTE ausschließlich an authenticated", () => {
    expect(CODE).toContain(
      "grant  execute on function public.system_auth_inventory() to authenticated;");
    const grants = [...CODE.matchAll(/grant\s+execute on function [^;]*to ([a-z_, ]+);/g)]
      .map((m) => m[1].trim());
    expect(grants).toEqual(["authenticated"]);
  });

  it("vergibt nirgends ein Recht an public, anon oder service_role", () => {
    expect(CODE).not.toMatch(/grant[^;]*\bto\b[^;]*\b(public|anon|service_role)\b/);
  });

  it("die Revokes stehen vor dem Grant", () => {
    // Sonst nähme ein Revoke dem authenticated wieder, was der Grant gab.
    expect(CODE.indexOf("revoke all     on function"))
      .toBeLessThan(CODE.indexOf("grant  execute on function"));
    expect(CODE.indexOf("revoke execute on function"))
      .toBeLessThan(CODE.indexOf("grant  execute on function"));
  });
});

// ---------------------------------------------------------------------------
// 6. Umfang und Drift
// ---------------------------------------------------------------------------

describe("0107 bleibt in seinem Umfang", () => {
  it("legt eine Funktion an und sonst nichts", () => {
    const anlagen = [...CODE.matchAll(/create\s+(or replace\s+)?(\w+)/gi)].map((m) => m[2].toLowerCase());
    expect(anlagen).toEqual(["function"]);
    for (const mehr of ["create table", "alter table", "create trigger", "create policy",
                        "create index", "drop ", "delete from", "truncate"]) {
      expect(CODE.toLowerCase().includes(mehr), `${mehr} gehört nicht in 0107`).toBe(false);
    }
  });

  it("fasst 0104 bis 0106 nicht an", () => {
    for (const fremd of ["seller_business_backup", "system_platform_export",
                         "platform_export_runs", "admin_record_platform_export",
                         "admin_settle_platform_export", "admin_platform_export_runs",
                         "platform_export_runs_protect"]) {
      expect(CODE, `${fremd} darf hier nicht vorkommen`).not.toContain(fremd);
    }
  });

  it("enthält keine Route, keine UI, kein ZIP, kein Storage, keinen Restore", () => {
    /*
     * Gegen den RUMPF, nicht gegen die ganze Datei: der Funktionskommentar
     * sagt ausdrücklich „no way to restore or impersonate an account", und
     * dieser Satz soll dort stehen dürfen.
     */
    for (const spaeter of ["storage.", "http", "zip", "bucket", "restore",
                           "pg_cron", "cron.", "copy "]) {
      expect(BODY.toLowerCase().includes(spaeter), `${spaeter} gehört nicht in den Rumpf`)
        .toBe(false);
    }
  });

  it("sagt im Kommentar, dass es kein Auth-Backup ist", () => {
    // Der Satz, den ein späterer Leser zuerst findet, trägt die Warnung — nicht
    // nur dieser Test.
    const kommentar = CODE.slice(CODE.indexOf("comment on function public.system_auth_inventory()"));
    expect(kommentar).toContain("NOT an auth backup");
    expect(kommentar).toContain("no password");
    expect(kommentar).toContain("DERIVED");
  });

  it("der Disclaimer des Manifests passt zu dem, was die SQL tut", () => {
    expect(AUTH_INVENTORY_DISCLAIMER).toContain("kein Auth-Backup");
    expect(AUTH_INVENTORY_DISCLAIMER).toContain("E-Mail-Adresse");
    expect(PLATFORM_ARCHIVE_LAYOUT.authUsers).toBe("auth-users.json");
  });

  it("0104, 0105 und 0106 sind byte-identisch geblieben", () => {
    const hash = (file: string) =>
      createHash("sha256").update(readFileSync(`${DIR}/${file}`)).digest("hex");
    expect(hash("0104_business_backup_export.sql"))
      .toBe("2f9184f34bcab010d514b47b67c5884073539437064c67fb016c50f898714edf");
    expect(hash("0105_platform_export.sql"))
      .toBe("e1fbd1e35253c1900d3aa166a8026644f6bcf7dea4ba4c2b9af37fcd746c9e68");
    expect(hash("0106_platform_export_history.sql"))
      .toBe("242867f59efbcdb0a7031c11f51da6406fffc17b652832e985718eed1e0f5118");
  });
});
