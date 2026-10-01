import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  BACKUP_FORMAT, BACKUP_FORMAT_VERSION, BACKUP_METADATA_FIELDS, BACKUP_METADATA_SOURCE,
  BACKUP_SECTIONS, EXCLUDED_TABLES, FORBIDDEN_FIELDS,
} from "./manifest";

/**
 * Migration `0104` gegen das Manifest (V1, Schritt 2).
 *
 * Der SQL-Rumpf wurde aus `manifest.ts` erzeugt und nicht abgeschrieben.
 * Diese Datei ist die Gegenprobe: sie liest beide Seiten und vergleicht sie
 * Feld für Feld. Läuft irgendwann eines von beiden weiter — ein neues Feld
 * in der SQL, ein gestrichenes im Manifest —, schlägt sie an, statt dass
 * ein Backup entsteht, dessen Inhalt niemand mehr beschreiben kann.
 */
const FILE = "supabase/migrations/0104_business_backup_export.sql";
const SQL = readFileSync(FILE, "utf8");

/** Ohne Kommentare: die Kopfzeilen nennen Tabellen, die gerade NICHT vorkommen. */
const CODE = SQL.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");

/** Die Felder, die ein Bereich im SQL wirklich ausgibt. */
function sqlFields(key: string): string[] {
  const at = CODE.indexOf(`'${key}', coalesce((`);
  if (at < 0) return [];
  const end = CODE.indexOf("), '[]'::jsonb)", at);
  const block = CODE.slice(at, end);
  return [...block.matchAll(/^\s*'([a-z_0-9]+)',\s/gm)].map((m) => m[1]).slice(1);
}

describe("die Funktion ist read-only und richtig eingehängt", () => {
  it("ist stable, security definer und hat den leeren search_path", () => {
    expect(CODE).toContain("create or replace function public.seller_business_backup()");
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
      expect(CODE.toLowerCase().includes(write), `0104 darf ${write} nicht enthalten`)
        .toBe(false);
    }
  });

  it("nimmt den lesenden Schnappschuss, nicht den vergebenden", () => {
    /*
     * `txid_current()` ist volatile und VERGIBT eine Transaktionsnummer —
     * ein Schreibvorgang. `pg_current_snapshot()` ist stable und liest nur.
     */
    expect(CODE).toContain("pg_current_snapshot()::text");
  });

  it("steht hinter dem kanonischen Wächter und erfindet keine Rollenlogik", () => {
    expect(CODE).toContain("case when not public.can_operate_active_seller() then null");
    expect(CODE).not.toContain("raise exception");
    // Single-Seller: der Wächter IST der Mandantenfilter (ADR-0021, ADR-0064).
    expect(CODE).not.toMatch(/seller_id\s*=\s*p_/);
    expect(CODE).not.toContain("seller_operators");
  });

  it("vergibt die Rechte wie ihre Geschwister", () => {
    expect(CODE).toContain(
      "revoke all on function public.seller_business_backup() from public, anon;");
    expect(CODE).toContain(
      "grant execute on function public.seller_business_backup() to authenticated;");
  });

  it("ist genau eine Anweisung — daher eine Momentaufnahme", () => {
    /*
     * `language sql` mit einem `select`. Ein Statement sieht genau eine
     * MVCC-Momentaufnahme; jeder Bereich stammt aus demselben Augenblick,
     * ohne begin, ohne Isolationsstufe, ohne Sperre.
     */
    const body = CODE.slice(CODE.indexOf("as $$") + 5, CODE.indexOf("$$;"));
    /*
     * Der Beweis ist nicht die Zahl der `select` — Unterabfragen gibt es
     * viele —, sondern dass der Rumpf GENAU EIN Semikolon enthält, und zwar
     * als letztes Zeichen. Ein einziger Anweisungstrenner heißt: ein
     * Statement, und ein Statement sieht genau eine MVCC-Momentaufnahme.
     */
    expect((body.match(/;/g) ?? []).length, "mehr als ein Anweisungstrenner").toBe(1);
    expect(body.trimEnd().endsWith(";"), "das Semikolon schließt die eine Anweisung").toBe(true);
    expect(body).not.toContain("begin");
    expect(body).not.toContain("isolation level");
    expect(body.trimStart().startsWith("with used_figures as (")).toBe(true);
  });

  it("führt keine Sonderarchitektur ein", () => {
    for (const t of ["service_role", "dblink", "pg_read_file", "copy "]) {
      expect(CODE.toLowerCase().includes(t), `0104 darf ${t} nicht enthalten`).toBe(false);
    }
  });
});

describe("Format und Metadaten", () => {
  it("nennt Format und Version genau wie das Manifest", () => {
    expect(CODE).toContain(`'format',          '${BACKUP_FORMAT}'`);
    expect(CODE).toContain(`'format_version',  ${BACKUP_FORMAT_VERSION}`);
  });

  it("sagt, dass V1 keinen Restore kann", () => {
    expect(CODE).toContain("'restore_supported',      false");
  });

  it("kennzeichnet die Datei als personenbezogen", () => {
    expect(CODE).toContain("'contains_personal_data', true");
  });

  it("gibt genau die Metadaten aus, die laut Manifest aus der Datenbank kommen", () => {
    const ausDb = BACKUP_METADATA_FIELDS.filter((f) => BACKUP_METADATA_SOURCE[f] === "database");
    for (const f of ausDb) {
      expect(CODE, `Metadatum ${f} fehlt in 0104`).toContain(`'${f}',`);
    }
  });

  it("und keines, das laut Manifest die Route liefert", () => {
    // `source_project` kennt ein Postgres nicht, `counts` zählt die Route aus
    // dem fertigen Dokument. Ein Feld vorzutäuschen, das immer null wäre,
    // wäre schlimmer als eines, das ehrlich von außen kommt.
    const ausRoute = BACKUP_METADATA_FIELDS.filter((f) => BACKUP_METADATA_SOURCE[f] === "route");
    expect(ausRoute).toEqual(["source_project", "counts"]);
    for (const f of ausRoute) {
      expect(CODE, `${f} darf 0104 nicht selbst erfinden`).not.toContain(`'${f}',`);
    }
  });

  it("trägt die Prüfgrößen, an denen ein Backup plausibel wird", () => {
    expect(CODE).toContain("'inventory_units'");
    expect(CODE).toContain("public.orderbook_global_factor()::text");
  });
});

describe("die 25 Bereiche stimmen mit dem Manifest überein", () => {
  it("es sind genau die des Manifests, nicht mehr und nicht weniger", () => {
    const imSql = [...CODE.matchAll(/^\s{6}'([a-z_]+)', coalesce\(\(/gm)].map((m) => m[1]);
    expect(imSql).toEqual(BACKUP_SECTIONS.map((s) => s.key));
    expect(imSql).toHaveLength(25);
  });

  for (const section of BACKUP_SECTIONS) {
    it(`${section.key} gibt exakt die Felder des Manifests aus`, () => {
      const erwartet = [
        ...section.fields,
        ...(section.denormalised ?? []).map((d) => d.field),
      ];
      expect(sqlFields(section.key)).toEqual(erwartet);
    });
  }

  it("liest jeden Bereich aus seiner Manifest-Quelltabelle", () => {
    for (const s of BACKUP_SECTIONS) {
      expect(CODE, `${s.key} liest nicht aus ${s.source}`)
        .toContain(`from public.${s.source} t`);
    }
  });

  it("sortiert jeden Bereich deterministisch", () => {
    // Ohne feste Reihenfolge wären zwei Backups desselben Zustands nicht
    // vergleichbar.
    const aggs = CODE.match(/jsonb_agg\(/g) ?? [];
    const orders = CODE.match(/\) order by t\.[a-z_]+\)/g) ?? [];
    expect(orders.length).toBe(aggs.length);
  });
});

describe("die Sperren halten auch in der SQL", () => {
  it("kein gesperrtes Feld wird ausgegeben", () => {
    /*
     * Das Manifest verbietet sie; hier wird geprüft, dass die Ausführung
     * sich daran hält. Gesucht wird nach dem AUSGABE-Schlüssel `'feld',`,
     * nicht nach dem Spaltennamen: `inventory_id` etwa ist als Feld erlaubt
     * und taucht zusätzlich in Joins auf.
     */
    const verstoesse: string[] = [];
    for (const feld of Object.keys(FORBIDDEN_FIELDS)) {
      if (new RegExp(`^\\s*'${feld}',\\s`, "m").test(CODE)) verstoesse.push(feld);
    }
    expect(verstoesse).toEqual([]);
  });

  it("keine ausgeschlossene Tabelle wird als Bereich exportiert", () => {
    /*
     * Ausgeschlossen heißt: kein Bereich unter `data`. Es heißt NICHT, dass
     * die Tabelle nirgends berührt werden dürfte — aus `commerce_settings`
     * wird genau ein nicht-geheimes Feld für die Metadaten gelesen (`mode`,
     * damit Staging nicht mit Production verwechselt wird). Das Salz bleibt,
     * wo es ist; die Sperrliste sorgt dafür.
     */
    const bereiche = new Set(BACKUP_SECTIONS.map((s) => s.source));
    for (const t of Object.keys(EXCLUDED_TABLES)) {
      expect(bereiche.has(t), `${t} ist ausgeschlossen und trotzdem Bereich`).toBe(false);
      expect(CODE, `${t} darf keinen Bereich bilden`).not.toContain(`from public.${t} t`);
    }
  });

  it("aus commerce_settings kommt nur der Modus, niemals das Salz", () => {
    expect(CODE).toContain("select s.mode from public.commerce_settings s limit 1");
    expect(CODE).not.toContain("client_salt");
  });

  it("die Legacy-Maschinerie kommt nicht vor — der wichtigste Ausschluss", () => {
    for (const t of ["legacy_stock_events", "inventory_imports", "inventory_import_rows",
                     "inventory_import_mappings"]) {
      expect(CODE, `${t} darf in 0104 nicht vorkommen`).not.toContain(t);
    }
  });

  it("Käuferdaten nur aus den Rechnungen", () => {
    const at = CODE.indexOf("'invoices', coalesce((");
    const end = CODE.indexOf("), '[]'::jsonb)", at);
    const ausserhalb = CODE.slice(0, at) + CODE.slice(end);
    for (const f of ["customer_name", "customer_street", "customer_email"]) {
      expect(ausserhalb, `${f} steht außerhalb der Rechnungen`).not.toContain(`'${f}',`);
    }
    expect(CODE.slice(at, end)).toContain("'customer_name'");
  });
});

describe("Geld verliert nichts", () => {
  const MONEY = ["sale_price", "unit_cost", "total_cost", "market_price_snapshot",
    "items_subtotal", "shipping_charged", "reported_payout_amount",
    "buy_in_factor_snapshot", "amount", "shipping_amount", "total_amount", "unit_price",
    "line_total", "order_value", "merchandise_amount", "market_price", "price_percentage",
    "base_price", "discount_amount", "free_shipping_threshold"];

  it("jeder Betrag wird als Text ausgegeben, nie als JSON-Zahl", () => {
    /*
     * `jsonb` kennt nur `numeric`, aber jeder Leser danach hat einen
     * Gleitkommatyp — aus 7.85 würde irgendwo 7.849999999999999. Dieselbe
     * Regel, aus der der Webhook seine Beträge als String schickt.
     */
    const roh: string[] = [];
    for (const feld of MONEY) {
      for (const m of CODE.matchAll(new RegExp(`^\\s*'${feld}', (t\\.[a-z_]+)(::text)?`, "gm"))) {
        if (!m[2]) roh.push(`${feld} → ${m[1]}`);
      }
    }
    expect(roh).toEqual([]);
  });

  it("auch der Buy-in-Faktor in den Metadaten", () => {
    expect(CODE).toContain("public.orderbook_global_factor()::text");
  });
});

describe("die Denormalisierung aus dem Manifest ist umgesetzt", () => {
  for (const s of BACKUP_SECTIONS.filter((x) => x.denormalised?.length)) {
    it(`${s.key} trägt ${s.denormalised!.map((d) => d.field).join(" und ")}`, () => {
      const at = CODE.indexOf(`'${s.key}', coalesce((`);
      const block = CODE.slice(at, CODE.indexOf("), '[]'::jsonb)", at));
      expect(block).toContain("left join public.shop_inventory inv on inv.id = t.inventory_id");
      for (const d of s.denormalised!) expect(block).toContain(`'${d.field}', inv.${d.field}`);
    });
  }

  it("betrifft genau die zwei Bereiche, die nur eine Zeilennummer hätten", () => {
    expect(BACKUP_SECTIONS.filter((s) => s.denormalised?.length).map((s) => s.key))
      .toEqual(["inventory_movements", "order_reservations"]);
  });
});

describe("der Stammdatenschnappschuss bleibt klein", () => {
  it("führt nur SKY-IDs, die im Backup vorkommen", () => {
    expect(CODE).toContain("with used_figures as (");
    expect(CODE).toContain("where t.sky_id in (select sky_id from used_figures)");
    for (const q of ["shop_inventory", "purchase_items", "sale_items", "order_lines"]) {
      expect(CODE.slice(CODE.indexOf("with used_figures"), CODE.indexOf("select case when")))
        .toContain(`from public.${q}`);
    }
  });
});
