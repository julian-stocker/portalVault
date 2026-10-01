import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  AUTH_FORBIDDEN_FIELDS,
  PLATFORM_ARCHIVE_LAYOUT,
  PLATFORM_EXCLUDED_TABLES,
  PLATFORM_FORBIDDEN_FIELDS,
  PLATFORM_FORMAT,
  PLATFORM_FORMAT_VERSION,
  PLATFORM_METADATA_FIELDS,
  PLATFORM_METADATA_SOURCE,
  PLATFORM_SECTIONS,
  allPlatformFields,
} from "./platform-manifest";

/**
 * Migration `0105` gegen das Plattform-Manifest (Schritt 3).
 *
 * Der SQL-Rumpf wurde aus `platform-manifest.ts` ERZEUGT und nicht
 * abgeschrieben. Diese Datei ist die Gegenprobe: sie liest beide Seiten und
 * vergleicht sie Feld für Feld. Läuft irgendwann eines von beiden weiter —
 * ein neues Feld in der SQL, ein gestrichenes im Manifest —, schlägt sie an.
 * Sie gleicht dabei ausdrücklich NICHT still eine Seite an die andere an:
 * ein roter Test ist eine Entscheidung, die jemand treffen muss.
 */
const FILE = "supabase/migrations/0105_platform_export.sql";
const SQL = readFileSync(FILE, "utf8");

/** Ohne Kommentare: die Kopfzeilen nennen Tabellen, die gerade NICHT vorkommen. */
const CODE = SQL.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");

/** Der Rumpf der Exportfunktion, zwischen den `$$`-Marken. */
const BODY = CODE.slice(CODE.indexOf("as $$") + 5, CODE.indexOf("$$;"));

/** Die Definition der Historientabelle, von `create table` bis zur Klammer. */
const TABLE = CODE.slice(
  CODE.indexOf("create table if not exists public.platform_export_runs ("),
  CODE.indexOf("comment on table public.platform_export_runs"),
);

/**
 * Jeder `jsonb_build_object(`-Aufruf im Rumpf, klammerbilanziert.
 *
 * NICHT über Zeichenketten gezählt: Argumente werden an Kommas der Tiefe 1
 * getrennt, und Kommas in Zeichenkettenliteralen, Blockkommentaren und
 * verschachtelten Klammern zählen dabei nicht mit. Genau daran ist `0105`
 * beim ersten Versuch gescheitert — `FUNC_MAX_ARGS` ist 100, der `data`-Block
 * hatte 106.
 */
type Call = { line: number; args: string[]; length: number; at: number };

function buildObjectCalls(text: string): Call[] {
  const NAME = "jsonb_build_object";
  const out: Call[] = [];
  for (let i = 0; i < text.length; i++) {
    if (!text.startsWith(`${NAME}(`, i)) continue;
    if (i > 0 && /[A-Za-z0-9_]/.test(text[i - 1])) continue;
    let depth = 0;
    let inString = false;
    let start = 0;
    const args: string[] = [];
    let j = i + NAME.length;
    for (; j < text.length; j++) {
      const c = text[j];
      if (inString) {
        if (c === "'") inString = false;
        continue;
      }
      if (c === "'") { inString = true; continue; }
      if (c === "-" && text[j + 1] === "-") {
        const nl = text.indexOf("\n", j);
        if (nl < 0) break;
        j = nl;
        continue;
      }
      if (c === "/" && text[j + 1] === "*") { j = text.indexOf("*/", j) + 1; continue; }
      if (c === "(") { depth++; if (depth === 1) start = j + 1; continue; }
      if (c === ")") {
        depth--;
        if (depth === 0) { args.push(text.slice(start, j)); break; }
        continue;
      }
      if (c === "," && depth === 1) { args.push(text.slice(start, j)); start = j + 1; }
    }
    out.push({ at: i, line: text.slice(0, i).split("\n").length, args, length: j + 1 - i });
  }
  return out;
}

/** Die Felder, die ein Bereich im SQL wirklich ausgibt. */
function sqlFields(key: string): string[] {
  const at = BODY.indexOf(`'${key}', coalesce((`);
  if (at < 0) return [];
  const block = BODY.slice(at, BODY.indexOf("), '[]'::jsonb)", at));
  return [...block.matchAll(/^\s*'([a-z_0-9]+)',\s/gm)].map((m) => m[1]).slice(1);
}

// ---------------------------------------------------------------------------
// 1. Die Historie
// ---------------------------------------------------------------------------

describe("platform_export_runs hält genau die Fragen fest, die es beantworten soll", () => {
  /** Die Spalten der Tabelle, in Reihenfolge — ohne Constraints. */
  const columns = [...TABLE.matchAll(/^  ([a-z_0-9]+) (bigint|text|timestamptz|integer)/gm)]
    .map((m) => m[1]);

  it("hat genau die zwölf begründeten Spalten", () => {
    expect(columns).toEqual([
      "id",
      "status",
      "created_at",
      "received_at",
      "format_version",
      "source_project",
      "size_bytes",
      "sha256",
      "section_count",
      "storage_file_count",
      "storage_missing_count",
      "failure_stage",
    ]);
  });

  it("führt keine Spalte, die eine andere schon sagt", () => {
    /*
     * `generated_at` wäre stets gleich `created_at`, `failed_at` entweder
     * gleich `created_at` oder der Moment, in dem `received_at` gerade nicht
     * gesetzt wird. `format` hätte genau einen Wert. `created_by` wäre ein
     * Personenbezug ohne Erkenntnisgewinn — es gibt einen Plattformadmin.
     */
    for (const spalte of ["generated_at", "failed_at", "created_by", "updated_at"]) {
      expect(columns, `${spalte} ist redundant`).not.toContain(spalte);
    }
    expect(columns).not.toContain("format");
  });

  it("trägt weder Inhalte noch Fehlertext noch Geheimnisse", () => {
    /*
     * Eine Historie, die das Archiv mitspeichert, ist eine zweite Kopie im
     * selben Projekt — genau das, was wir NICHT wollen. Und eine
     * Postgres-Meldung kann Werte aus Zeilen enthalten, deshalb steht ein
     * Fehlschlag als Stufe da, nie als Text.
     */
    for (const verboten of ["jsonb", "json ", "bytea", "blob", "document",
                            "payload", "error_message", "failure_message",
                            "detail", "stack", "storage_path", "email",
                            "token", "secret"]) {
      expect(TABLE.toLowerCase().includes(verboten), `${verboten} gehört nicht hinein`)
        .toBe(false);
    }
  });

  it("kennt drei Zustände und ausdrücklich kein „downloaded“", () => {
    /*
     * „downloaded" wäre eine Behauptung über einen Browservorgang, den der
     * Server nicht beobachten kann. Der Tabellenkommentar sagt genau das
     * und darf das Wort deshalb nennen — die Spalten dürfen es nicht.
     */
    expect(TABLE).toContain("check (status in ('generated', 'received', 'failed'))");
    expect(TABLE).not.toContain("downloaded");
  });

  it("lässt Status und Bestätigungszeit nicht auseinanderlaufen", () => {
    expect(TABLE).toContain("check ((status = 'received') = (received_at is not null))");
  });

  it("verlangt bei Erfolg die Kennzahlen, bei Fehlschlag nicht", () => {
    expect(TABLE).toContain("platform_export_runs_success_is_measured");
    for (const feld of ["format_version", "source_project", "size_bytes", "sha256",
                        "section_count", "storage_file_count", "storage_missing_count"]) {
      expect(
        TABLE.slice(TABLE.indexOf("platform_export_runs_success_is_measured")),
        `${feld} muss bei Erfolg gesetzt sein`,
      ).toContain(`${feld} is not null`);
    }
  });

  it("nimmt einen Fehlschlag nur als Stufe aus einer festen Liste", () => {
    expect(TABLE).toContain("failure_stage in ('database', 'auth_inventory', 'storage_manifest',");
    expect(TABLE).toContain("check (status = 'failed' or failure_stage is null)");
  });

  it("prüft die Form von Hash und Projektreferenz", () => {
    expect(TABLE).toContain("sha256 ~ '^[0-9a-f]{64}$'");
    expect(TABLE).toContain("source_project ~ '^[a-z0-9]{8,64}$'");
  });

  it("ist von außen vollständig geschlossen", () => {
    /*
     * RLS an, keine Policy, keine Grants. Der Weg hinein führt einzig über
     * `security definer`-Funktionen, die mit der Route kommen. Eine
     * Historie, die ein Client direkt schreiben kann, ist keine.
     */
    expect(CODE).toContain(
      "alter table public.platform_export_runs enable row level security;");
    expect(CODE).toContain(
      "revoke all on table public.platform_export_runs from public, anon, authenticated;");
    expect(CODE).not.toContain("create policy");
    expect(CODE).not.toMatch(/grant[^;]*on table public\.platform_export_runs/);
  });

  it("wird selbst nicht mitgesichert", () => {
    // Ein Backup, das seine eigene Vorgeschichte mitschleppt, wächst ohne
    // Erkenntnisgewinn — das Manifest sagt es, hier steht die Ausführung.
    expect(Object.keys(PLATFORM_EXCLUDED_TABLES)).toContain("platform_export_runs");
    expect(BODY).not.toContain("platform_export_runs");
  });

  it("legt an, löscht aber nichts — der Rückbau ist zwei Anweisungen", () => {
    expect(CODE).toContain("create table if not exists public.platform_export_runs (");
    for (const zerstoerend of ["drop table", "drop function", "delete from", "truncate",
                               "alter table public.platform_export_runs drop"]) {
      expect(CODE.toLowerCase().includes(zerstoerend), `0105 darf ${zerstoerend} nicht tun`)
        .toBe(false);
    }
    expect(SQL).toContain("drop function if exists public.system_platform_export();");
    expect(SQL).toContain("drop table if exists public.platform_export_runs;");
  });
});

// ---------------------------------------------------------------------------
// 2. Die Exportfunktion
// ---------------------------------------------------------------------------

describe("system_platform_export() ist read-only und richtig eingehängt", () => {
  it("ist stable, security definer und hat den leeren search_path", () => {
    expect(CODE).toContain("create or replace function public.system_platform_export()");
    expect(CODE).toContain("language sql");
    expect(CODE).toContain("stable");
    expect(CODE).toContain("security definer");
    expect(CODE).toContain("set search_path = ''");
    expect(CODE).not.toContain("volatile");
  });

  it("schreibt nichts — in keiner Form", () => {
    for (const write of ["insert into", "update ", "delete from", "create table",
                         "create temp", "alter table", "truncate", "merge into",
                         "nextval", "setval", "txid_current()"]) {
      expect(BODY.toLowerCase().includes(write), `der Rumpf darf ${write} nicht enthalten`)
        .toBe(false);
    }
  });

  it("nimmt den lesenden Schnappschuss, nicht den vergebenden", () => {
    /*
     * `txid_current()` ist volatile und VERGIBT eine Transaktionsnummer —
     * ein Schreibvorgang in einer Funktion, die keiner sein darf.
     * `pg_current_snapshot()` ist stable und liest nur.
     */
    expect(BODY).toContain("pg_current_snapshot()::text");
  });

  it("steht hinter dem kanonischen Plattformwächter", () => {
    expect(BODY).toContain("select case when not public.is_platform_admin() then null");
    // „nicht deins“ und „nichts vorhanden“ sollen gleich aussehen.
    expect(BODY).not.toContain("raise exception");
    expect(BODY).not.toContain("can_operate_active_seller");
    expect(BODY).not.toContain("is_shop_admin");
  });

  it("gibt keine Rechte an public, anon oder die Service Role", () => {
    /*
     * Die spätere Route läuft in der Sitzung des Admins, also reicht
     * `authenticated` plus der Wächter im Rumpf. Eine Service-Role-Freigabe
     * aus Bequemlichkeit gäbe es hier nicht.
     */
    expect(CODE).toContain(
      "revoke all on function public.system_platform_export() from public, anon;");
    expect(CODE).toContain(
      "grant execute on function public.system_platform_export() to authenticated;");
    expect(CODE).not.toContain("service_role");
    expect(CODE).not.toMatch(/grant[^;]*to (public|anon)\b/);
  });

  it("ist genau eine Anweisung — daher eine Momentaufnahme", () => {
    /*
     * Der Beweis ist nicht die Zahl der `select` — Unterabfragen gibt es
     * viele —, sondern dass der Rumpf GENAU EIN Semikolon enthält, und zwar
     * als letztes Zeichen. Ein einziger Anweisungstrenner heißt: ein
     * Statement, und ein Statement sieht genau eine MVCC-Momentaufnahme.
     */
    expect((BODY.match(/;/g) ?? []).length, "mehr als ein Anweisungstrenner").toBe(1);
    expect(BODY.trimEnd().endsWith(";"), "das Semikolon schließt die eine Anweisung").toBe(true);
    expect(BODY).not.toContain("begin");
    expect(BODY).not.toContain("isolation level");
    expect(BODY).not.toContain("for update");
    expect(BODY).not.toContain("lock table");
  });

  it("führt keine Sonderarchitektur ein", () => {
    for (const t of ["dblink", "pg_read_file", "pg_ls_dir", "copy ", "lo_export",
                     "pg_cron", "cron.schedule", "http_post", "net.http"]) {
      expect(CODE.toLowerCase().includes(t), `0105 darf ${t} nicht enthalten`).toBe(false);
    }
  });
});

describe("Format und Metadaten des Datenbankdokuments", () => {
  it("nennt Format und Version genau wie das Manifest", () => {
    expect(BODY).toContain(`'format',         '${PLATFORM_FORMAT}'`);
    expect(BODY).toContain(`'format_version', ${PLATFORM_FORMAT_VERSION}`);
  });

  it("gibt genau die Metadaten aus, die laut Manifest aus der Datenbank kommen", () => {
    const ausDb = PLATFORM_METADATA_FIELDS.filter((f) => PLATFORM_METADATA_SOURCE[f] === "database");
    expect(ausDb).toEqual(["created_at", "commerce_mode"]);
    for (const f of ausDb) {
      expect(BODY, `Metadatum ${f} fehlt in 0105`).toContain(`'${f}',`);
    }
  });

  it("erfindet keines, das laut Manifest die Route liefert", () => {
    /*
     * Ein Postgres kennt seine Supabase-Projektreferenz nicht, es zählt
     * keine Storage-Objekte und es sieht das fertige Archiv nie. Ein Feld
     * vorzutäuschen, das immer null wäre, wäre schlimmer als eines, das
     * ehrlich von außen kommt.
     */
    const ausRoute = PLATFORM_METADATA_FIELDS
      .filter((f) => PLATFORM_METADATA_SOURCE[f] === "route")
      .filter((f) => f !== "format" && f !== "format_version");
    for (const f of ausRoute) {
      expect(BODY, `${f} darf 0105 nicht selbst erfinden`).not.toContain(`'${f}',`);
    }
  });

  it("nennt Format und Version trotzdem im Dokument selbst", () => {
    /*
     * Die AUSNAHME zur Regel darüber, und zwar mit Grund: `database.json`
     * kann einzeln aus dem Archiv fallen. Eine Datei, die ihren eigenen
     * Vertrag nicht nennt, ist später nicht deutbar. Das `manifest.json`
     * wiederholt beides — die Route schreibt es, das Manifest sagt es.
     */
    expect(PLATFORM_METADATA_SOURCE.format).toBe("route");
    expect(PLATFORM_METADATA_SOURCE.format_version).toBe("route");
    expect(BODY).toContain("'format',");
    expect(BODY).toContain("'format_version',");
  });

  it("baut genau eine Archivdatei, nicht das Archiv", () => {
    /*
     * `database.json`. Auth-Inventar, Objektliste, Dateien und das
     * `manifest.json` entstehen außerhalb; diese Migration weiß nichts
     * davon und soll nichts davon wissen.
     */
    expect(PLATFORM_ARCHIVE_LAYOUT.database).toBe("database.json");
    for (const fremd of ["auth-users", "storage-manifest", "manifest.json", "storage/"]) {
      expect(CODE, `${fremd} gehört nicht in 0105`).not.toContain(fremd);
    }
  });

  it("hat oben genau fünf Angaben, dann die Bereiche", () => {
    const kopf = BODY.slice(0, BODY.indexOf("'data', ("));
    const schluessel = [...kopf.matchAll(/^\s{4}'([a-z_]+)',/gm)].map((m) => m[1]);
    expect(schluessel).toEqual([
      "format", "format_version", "created_at", "commerce_mode", "snapshot_txid",
    ]);
  });
});

// ---------------------------------------------------------------------------
// 2b. FUNC_MAX_ARGS — die Grenze, an der der erste Versuch scheiterte
// ---------------------------------------------------------------------------

describe("kein jsonb_build_object überschreitet die Argumentgrenze", () => {
  const calls = buildObjectCalls(BODY);

  it("findet alle Aufrufe: Wurzel, sechs Gruppen, 53 Bereiche", () => {
    expect(calls).toHaveLength(1 + 6 + PLATFORM_SECTIONS.length);
  });

  it("bleibt überall unter 80 Argumenten — mit Abstand zu Postgres' 100", () => {
    /*
     * `FUNC_MAX_ARGS` ist 100. `0105` ist beim ersten Versuch mit
     * `54023: cannot pass more than 100 arguments to a function` gescheitert,
     * weil 53 Bereiche als Schlüssel/Wert-Paare 106 Argumente sind — und
     * zwar schon beim Anlegen der Funktion, weil Postgres SQL-Rümpfe sofort
     * analysiert. 80 ist die Schwelle mit Luft: ein Bereich mit 40 Feldern
     * oder eine Gruppe mit 40 Bereichen fällt auf, bevor Postgres es tut.
     */
    const zuGross = calls
      .filter((c) => c.args.length > 80)
      .map((c) => `Zeile ${c.line}: ${c.args.length} Argumente`);
    expect(zuGross).toEqual([]);
    expect(Math.max(...calls.map((c) => c.args.length))).toBeLessThanOrEqual(80);
  });

  it("jeder Aufruf hat eine gerade Argumentzahl — Schlüssel und Wert", () => {
    const ungerade = calls.filter((c) => c.args.length % 2 !== 0).map((c) => c.line);
    expect(ungerade).toEqual([]);
  });

  it("der data-Block besteht aus genau sechs mit || verketteten Gruppen", () => {
    const data = BODY.slice(BODY.indexOf("'data', ("));
    /*
     * Eine Gruppe erkennt man daran, dass ihr zweites Argument ein ganzer
     * Bereich ist (`coalesce((select …))`), während bei einem Bereichsobjekt
     * dort eine Spalte steht (`t.sky_id`).
     */
    const gruppen = buildObjectCalls(data).filter((c) =>
      (c.args[1]?.trim() ?? "").startsWith("coalesce(("));
    expect(gruppen).toHaveLength(6);
    // Fünf Verkettungen zwischen sechs Gruppen, und kein `union`.
    const verkettungen = [...data.matchAll(/^\s+\|\|$/gm)];
    expect(verkettungen).toHaveLength(5);
    expect(data).not.toMatch(/\bunion\b/i);
  });

  it("die sechs Gruppen ergeben zusammen die kanonische Reihenfolge", () => {
    /*
     * Der Schnitt ist eine mechanische Rücksicht auf Postgres, keine
     * fachliche Aussage. Deshalb muss die Verkettung der Gruppen Bereich für
     * Bereich dieselbe Folge sein wie `PLATFORM_SECTIONS` — ohne Lücke, ohne
     * Dopplung, ohne Umsortierung.
     */
    const data = BODY.slice(BODY.indexOf("'data', ("));
    const gruppen = [...data.matchAll(/\/\* ---- (.+?) — (\d+) Bereiche, (\d+) Argumente ---- \*\//g)];
    expect(gruppen).toHaveLength(6);

    const proGruppe = data
      .split(/\/\* ---- .+? — \d+ Bereiche, \d+ Argumente ---- \*\//)
      .slice(1)
      .map((teil) => [...teil.matchAll(/^\s{8}'([a-z_0-9]+)', coalesce\(\(/gm)].map((x) => x[1]));

    // Jede Gruppe sagt selbst, wie viele Bereiche sie hat — und hält es ein.
    gruppen.forEach((g, i) => {
      expect(proGruppe[i], `${g[1]} zählt falsch`).toHaveLength(Number(g[2]));
      expect(Number(g[3]), `${g[1]} rechnet falsch`).toBe(Number(g[2]) * 2);
      expect(Number(g[3]), `${g[1]} ist zu groß`).toBeLessThanOrEqual(80);
    });

    const verkettet = proGruppe.flat();
    expect(verkettet).toEqual(PLATFORM_SECTIONS.map((s) => s.key));
    expect(new Set(verkettet).size, "ein Bereich kommt doppelt vor").toBe(verkettet.length);
    expect(verkettet).toHaveLength(53);
  });

  it("die Gruppierung bleibt ein Ausdruck in einer Anweisung", () => {
    /*
     * `||` auf zwei `jsonb`-Objekten mischt nur die Schlüssel. Es ist keine
     * zweite Abfrage, kein zweiter Moment und kein zweiter RPC — der Rumpf
     * hat genau ein Semikolon und genau einen Wächter.
     */
    expect((BODY.match(/;/g) ?? []).length).toBe(1);
    expect(BODY.match(/is_platform_admin\(\)/g) ?? []).toHaveLength(1);
    expect(BODY.match(/pg_current_snapshot\(\)/g) ?? []).toHaveLength(1);
    expect(BODY.trimStart().startsWith("select case when")).toBe(true);
    for (const zweiterWeg of ["with ", "union", "lateral", "perform", "rpc(",
                              "dblink", "execute "]) {
      expect(BODY.toLowerCase().includes(zweiterWeg), `${zweiterWeg} wäre ein zweiter Weg`)
        .toBe(false);
    }
  });

  it("baut die SQL nicht zur Laufzeit zusammen", () => {
    // Kein `format()`, kein `execute`, kein `quote_ident` — der Rumpf ist
    // buchstäblich das, was im Dateitext steht.
    for (const dynamisch of ["execute", "format(", "quote_ident", "quote_literal",
                             "string_agg(", "to_jsonb(t)", "row_to_json"]) {
      expect(BODY.toLowerCase().includes(dynamisch), `${dynamisch} wäre dynamische SQL`)
        .toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Manifest ↔ SQL, Bereich für Bereich
// ---------------------------------------------------------------------------

describe(`die ${PLATFORM_SECTIONS.length} Bereiche stimmen mit dem Manifest überein`, () => {
  it("es sind genau die des Manifests, nicht mehr und nicht weniger", () => {
    const imSql = [...BODY.matchAll(/^\s{8}'([a-z_0-9]+)', coalesce\(\(/gm)].map((m) => m[1]);
    expect(imSql).toEqual(PLATFORM_SECTIONS.map((s) => s.key));
    expect(imSql).toHaveLength(53);
  });

  for (const section of PLATFORM_SECTIONS) {
    it(`${section.key} gibt exakt die Felder des Manifests aus`, () => {
      const erwartet = [
        ...section.fields,
        ...(section.denormalised ?? []).map((d) => d.field),
      ];
      expect(sqlFields(section.key)).toEqual(erwartet);
    });
  }

  it("gibt insgesamt genau so viele Felder aus, wie das Manifest zählt", () => {
    // `allPlatformFields()` zählt die gebildeten bereits mit.
    const gesamt = PLATFORM_SECTIONS.reduce((n, s) => n + sqlFields(s.key).length, 0);
    const gebildet = PLATFORM_SECTIONS.reduce((n, s) => n + (s.denormalised?.length ?? 0), 0);
    expect(gesamt).toBe(allPlatformFields().length);
    expect(gesamt).toBe(486);
    expect(gebildet).toBe(4);
  });

  it("liest jeden Bereich aus seiner Manifest-Quelltabelle", () => {
    for (const s of PLATFORM_SECTIONS) {
      expect(BODY, `${s.key} liest nicht aus ${s.source}`)
        .toContain(`from public.${s.source} t`);
    }
  });

  it("liest keine Tabelle, die kein Bereich ist", () => {
    /*
     * Die einzige Ausnahme ist `shop_inventory` als Join-Partner der
     * Denormalisierung — und die ist selbst ein Bereich.
     */
    const gelesen = new Set(
      [...BODY.matchAll(/(?:from|join) public\.([a-z_0-9]+)/g)].map((m) => m[1]),
    );
    const erlaubt = new Set([
      ...PLATFORM_SECTIONS.map((s) => s.source),
      "commerce_settings", // nur `mode` für die Metadaten
    ]);
    expect([...gelesen].filter((t) => !erlaubt.has(t))).toEqual([]);
  });

  it("sortiert jeden Bereich deterministisch", () => {
    // Ohne feste Reihenfolge wären zwei Exporte desselben Zustands nicht
    // byteweise vergleichbar — und genau das prüft der Admin am Hash.
    const aggs = BODY.match(/jsonb_agg\(/g) ?? [];
    const orders = BODY.match(/\) order by t\.[a-z_0-9]+[^)]*\)/g) ?? [];
    expect(orders.length).toBe(aggs.length);
    expect(aggs).toHaveLength(PLATFORM_SECTIONS.length);
  });

  it("sortiert Tabellen ohne id nach ihrem natürlichen Schlüssel", () => {
    /*
     * `order by t.id` auf einer Tabelle ohne `id` wäre schlicht ein Fehler;
     * hier steht, dass jede solche Tabelle stattdessen ihren eigenen
     * Schlüssel nennt.
     */
    for (const s of PLATFORM_SECTIONS.filter((x) => !x.fields.includes("id"))) {
      const at = BODY.indexOf(`'${s.key}', coalesce((`);
      const block = BODY.slice(at, BODY.indexOf("), '[]'::jsonb)", at));
      expect(block, `${s.key} sortiert nach einem Feld, das es nicht hat`)
        .not.toContain(") order by t.id)");
      // Bis zum Zeilenende, nicht bis zur ersten Klammer: `order_mail`
      // sortiert unter anderem nach `coalesce(t.ref, '')`.
      const order = block.match(/\) order by (.+)$/m)?.[1] ?? "";
      const spalten = [...order.matchAll(/\bt\.([a-z_0-9]+)/g)].map((m) => m[1]);
      expect(spalten.length, `${s.key} hat keine Sortierung`).toBeGreaterThan(0);
      for (const name of spalten) {
        expect(s.fields, `${s.key} sortiert nach ${name}, das kein Feld ist`).toContain(name);
      }
    }
  });
});

describe("die Denormalisierung aus dem Manifest ist umgesetzt", () => {
  for (const s of PLATFORM_SECTIONS.filter((x) => x.denormalised?.length)) {
    it(`${s.key} trägt ${s.denormalised!.map((d) => d.field).join(" und ")}`, () => {
      const at = BODY.indexOf(`'${s.key}', coalesce((`);
      const block = BODY.slice(at, BODY.indexOf("), '[]'::jsonb)", at));
      expect(block).toContain("left join public.shop_inventory inv on inv.id = t.inventory_id");
      for (const d of s.denormalised!) expect(block).toContain(`'${d.field}', inv.${d.field}`);
    });
  }

  it("betrifft genau die zwei Bereiche, die nur eine Zeilennummer hätten", () => {
    expect(PLATFORM_SECTIONS.filter((s) => s.denormalised?.length).map((s) => s.key))
      .toEqual(["inventory_movements", "order_reservations"]);
  });
});

// ---------------------------------------------------------------------------
// 4. Die Sperren halten auch in der SQL
// ---------------------------------------------------------------------------

describe("kein Geheimnis, keine Altlast, keine Auth-Tabelle", () => {
  it("kein gesperrtes Feld wird ausgegeben", () => {
    /*
     * Das Manifest verbietet sie; hier wird geprüft, dass die Ausführung
     * sich daran hält. Gesucht wird nach dem AUSGABE-Schlüssel `'feld',`,
     * nicht nach dem Spaltennamen: `inventory_id` etwa ist als Feld erlaubt
     * und taucht zusätzlich in Joins auf.
     */
    const verstoesse: string[] = [];
    for (const feld of Object.keys(PLATFORM_FORBIDDEN_FIELDS)) {
      if (new RegExp(`^\\s*'${feld}',\\s`, "m").test(BODY)) verstoesse.push(feld);
    }
    expect(verstoesse).toEqual([]);
  });

  it("aus commerce_settings kommt nur der Modus, niemals das Salz", () => {
    expect(BODY).toContain("select s.mode from public.commerce_settings s limit 1");
    expect(CODE).not.toContain("client_salt");
  });

  it("liest überhaupt kein auth-Schema", () => {
    /*
     * Das Auth-Inventar kommt später über einen privilegierten Weg, nicht
     * aus dieser Funktion. Und selbst dann nur als Inventar: die zwölf
     * Felder aus `AUTH_FORBIDDEN_FIELDS` verlassen die Datenbank nie.
     */
    expect(CODE).not.toContain("auth.");
    expect(CODE).not.toContain("from auth");
    for (const feld of Object.keys(AUTH_FORBIDDEN_FIELDS)) {
      expect(CODE, `${feld} darf nirgends vorkommen`).not.toContain(feld);
    }
  });

  it("keine ausgeschlossene Tabelle wird als Bereich exportiert", () => {
    const bereiche = new Set(PLATFORM_SECTIONS.map((s) => s.source));
    for (const t of Object.keys(PLATFORM_EXCLUDED_TABLES)) {
      expect(bereiche.has(t), `${t} ist ausgeschlossen und trotzdem Bereich`).toBe(false);
      expect(BODY, `${t} darf keinen Bereich bilden`).not.toContain(`from public.${t} t`);
    }
  });

  it("die Legacy-Maschinerie kommt nicht vor — der wichtigste Ausschluss", () => {
    /*
     * Ein Backup, das sie enthielte, lüde irgendwann jemanden ein, sie
     * zurückzuspielen. Dieser Weg ist dauerhaft verboten, und 806 ist kein
     * Sollbestand mehr.
     */
    for (const t of ["legacy_stock_events", "inventory_imports", "inventory_import_rows",
                     "inventory_import_mappings", "cutover", "rebaseline", "pre_go_live"]) {
      expect(CODE, `${t} darf in 0105 nicht vorkommen`).not.toContain(t);
    }
  });

  it("fasst 0104 und seine Funktion nicht an", () => {
    for (const t of ["seller_business_backup", "0104"]) {
      expect(CODE, `0105 darf ${t} nicht berühren`).not.toContain(t);
    }
  });
});

describe("Geld verliert nichts", () => {
  const MONEY = [
    "market_price", "sale_price", "unit_cost", "total_cost", "market_price_snapshot",
    "items_subtotal", "shipping_charged", "discount_amount", "reported_payout_amount",
    "buy_in_factor_snapshot", "amount", "shipping_amount", "total_amount", "unit_price",
    "line_total", "order_value", "merchandise_amount", "price_percentage",
    "free_shipping_threshold", "base_price", "catalog_market_boost_percent",
  ];

  it("jeder Betrag wird als Text ausgegeben, nie als JSON-Zahl", () => {
    /*
     * `jsonb` kennt nur `numeric`, aber jeder Leser danach hat einen
     * Gleitkommatyp — aus 7.85 würde irgendwo 7.849999999999999.
     */
    const roh: string[] = [];
    for (const feld of MONEY) {
      for (const m of BODY.matchAll(new RegExp(`^\\s*'${feld}', (t\\.[a-z_]+)(::text)?`, "gm"))) {
        if (!m[2]) roh.push(`${feld} → ${m[1]}`);
      }
    }
    expect(roh).toEqual([]);
  });

  it("die Liste deckt jedes Geldfeld des Manifests ab", () => {
    /*
     * Die Gegenrichtung: ein neues Betragsfeld im Manifest, das hier fehlte,
     * ginge sonst still als JSON-Zahl durch. Erkannt am Namen — dieselbe
     * Heuristik, mit der die SQL erzeugt wurde.
     */
    const verdaechtig = allPlatformFields().filter((f) =>
      /(^|_)(price|amount|cost|total|subtotal|payout|factor|percent|threshold)$/.test(f));
    const fehlend = [...new Set(verdaechtig)].filter((f) => !MONEY.includes(f));
    expect(fehlend).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 5. Was diese Migration ausdrücklich noch nicht ist
// ---------------------------------------------------------------------------

describe("0105 bleibt in seinem Umfang", () => {
  it("enthält weder Zeitplan noch Rotation noch Bucket", () => {
    /*
     * Production läuft auf Supabase Free. Ein automatischer Lauf INNERHALB
     * desselben Projekts wäre keine Sicherung, sondern eine zweite Kopie im
     * selben Brandabschnitt — deshalb gibt es ihn nicht, und deshalb steht
     * hier, dass er nicht heimlich zurückkommt.
     */
    for (const spaeter of ["pg_cron", "cron.", "schedule", "rotation", "bucket",
                           "storage.objects", "cloudflare"]) {
      expect(CODE.toLowerCase().includes(spaeter), `${spaeter} gehört nicht in V1`).toBe(false);
    }
  });

  it("baut keinen Rückweg in die Datenbank", () => {
    // V1 hat keinen Restore und bereitet keinen vor; `format_version` ist
    // der Vertrag, der einen später möglich hält.
    for (const t of ["restore", "import", "load into", "upsert", "on conflict"]) {
      expect(BODY.toLowerCase().includes(t), `${t} gehört nicht in den Rumpf`).toBe(false);
    }
  });

  it("lässt 0104 unverändert", () => {
    /*
     * Die Datei ist eingefroren und auf Staging wie Production ausgeführt.
     * Der Hash steht hier, damit eine Änderung auffällt, statt still zu
     * passieren.
     */
    const hash = createHash("sha256")
      .update(readFileSync("supabase/migrations/0104_business_backup_export.sql"))
      .digest("hex");
    expect(hash).toBe("2f9184f34bcab010d514b47b67c5884073539437064c67fb016c50f898714edf");
  });
});
