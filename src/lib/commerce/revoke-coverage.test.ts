import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Jede Funktion, die eine Migration NEU anlegt, muss ihre Rechte nennen.
 *
 * WARUM ES DIESE DATEI GIBT — UND ZWAR SEIT DEM 2026-09-28.
 *
 * `0019` hatte `claim_order_mail()` und die drei `mark_order_mail_*()`
 * ausdrücklich für `public, anon, authenticated` gesperrt. `0100` hat sie mit
 * einem Parameter mehr neu angelegt — und ein Entzug hängt an der SIGNATUR,
 * nicht am Namen. Die neuen Funktionen kamen mit Postgres' Vorgabe hoch
 * (`EXECUTE` an `PUBLIC`, dazu Supabases `anon`/`authenticated`), und auf
 * Staging war einen Tag lang jeder mit dem öffentlichen Schlüssel in der Lage,
 * `claim_order_mail` zu rufen und damit den echten Versand einer Bestätigung
 * zu unterdrücken.
 *
 * `0019` beschreibt diese Falle in seinem eigenen Kommentar. Ein Kommentar
 * hat sie nicht verhindert. Diese Datei tut es.
 *
 * DIE REGEL, ENG GEFASST: wo eine Migration `drop function` UND danach
 * `create … function` für denselben Namen schreibt, entsteht eine neue
 * Funktion ohne Rechtegeschichte — dort MUSS in derselben Datei ein `revoke`
 * oder ein ausdrücklicher `grant` stehen. Ein `create or replace` ohne `drop`
 * behält die Rechte und braucht nichts.
 */
const DIR = "supabase/migrations";

type Created = { file: string; name: string; dropped: boolean };

/** Welche Funktionen eine Datei anlegt, und ob sie vorher gelöscht wurden. */
function functionsIn(sql: string, file: string): Created[] {
  const dropped = new Set(
    [...sql.matchAll(/^drop function if exists public\.([a-z_]+)\(/gm)].map((m) => m[1]),
  );
  const created = [...sql.matchAll(/^create (?:or replace )?function public\.([a-z_]+)\(/gm)]
    .map((m) => m[1]);
  return [...new Set(created)].map((name) => ({ file, name, dropped: dropped.has(name) }));
}

/** Nennt die Datei für diesen Namen ein Recht — entzogen oder erteilt? */
function statesRights(sql: string, name: string): boolean {
  const revoke = new RegExp(`^revoke [^;]*on function public\\.${name}\\(`, "m");
  const grant = new RegExp(`^grant [^;]*on function public\\.${name}\\(`, "m");
  return revoke.test(sql) || grant.test(sql);
}

describe("0100 sperrt jede Funktion, die es neu anlegt", () => {
  const sql = readFileSync(join(DIR, "0100_mail_event_identity.sql"), "utf8");
  const created = functionsIn(sql, "0100");

  it("legt die erwarteten Funktionen an", () => {
    expect(created.map((c) => c.name).sort()).toEqual([
      "claim_order_mail",
      "mark_order_mail_failed",
      "mark_order_mail_sent",
      "mark_order_mail_unresolved",
      "message_notice_due",
      "seller_cancel_order_line",
    ]);
  });

  it("und entzieht jeder neu angelegten das Recht — mit der NEUEN Signatur", () => {
    for (const signature of [
      "claim_order_mail(text, text, boolean, text)",
      "mark_order_mail_sent(text, text, text, text)",
      "mark_order_mail_failed(text, text, text, text)",
      "mark_order_mail_unresolved(text, text, text, text)",
      "message_notice_due(text, text)",
    ]) {
      expect(sql, signature).toContain(
        `revoke all on function public.${signature} from public, anon, authenticated;`,
      );
    }
  });

  it("die vier alten Drei-Parameter-Fassungen sind gelöscht", () => {
    for (const old of [
      "claim_order_mail(text, text, boolean)",
      "mark_order_mail_sent(text, text, text)",
      "mark_order_mail_failed(text, text, text)",
      "mark_order_mail_unresolved(text, text, text)",
    ]) {
      expect(sql, old).toContain(`drop function if exists public.${old};`);
    }
  });

  it("seller_cancel_order_line behält seine Rechte und bekommt keinen Entzug", () => {
    /*
     * Gleiche Argumentliste, also `create or replace` OHNE `drop` — die ACL
     * aus `0097` bleibt erhalten (`anon` entzogen, `authenticated` erlaubt).
     * Ein Entzug hier nähme dem Betrieb das Storno.
     */
    const entry = created.find((c) => c.name === "seller_cancel_order_line");
    expect(entry?.dropped).toBe(false);
    expect(sql).not.toMatch(/^revoke [^;]*on function public\.seller_cancel_order_line\(/m);
    const previous = readFileSync(join(DIR, "0097_cancellation_reason.sql"), "utf8");
    expect(previous).toContain("grant execute on function public.seller_cancel_order_line");
  });
});

describe("die Regel gilt für jede Migration, nicht nur für 0100", () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();

  /** Alles, was eine Datei löscht und neu anlegt, ohne Rechte zu nennen. */
  const gaps = files.flatMap((file) => {
    const sql = readFileSync(join(DIR, file), "utf8");
    return functionsIn(sql, file)
      .filter((fn) => fn.dropped && !statesRights(sql, fn.name))
      .map((fn) => `${file}: ${fn.name}`);
  });

  it("findet überhaupt Migrationen", () => {
    expect(files.length).toBeGreaterThan(90);
  });

  it("ab 0098 gibt es keine einzige Lücke", () => {
    /*
     * Der Block, den dieses Projekt gerade baut, hält die Regel vollständig.
     * Was hier auftaucht, ist ein neuer Fehler und kein geerbter.
     */
    const recent = gaps.filter((g) => Number(g.slice(0, 4)) >= 98);
    expect(recent, `neue Lücken:\n${recent.join("\n")}`).toEqual([]);
  });

  it("und die geerbten Fälle sind genau diese neun — nicht mehr", () => {
    /*
     * ÄLTER ALS DIESER BLOCK UND HIER NICHT REPARIERT.
     *
     * Diese neun Funktionen wurden in `0041`, `0062` und `0063` gelöscht und
     * neu angelegt, ohne dass dieselbe Datei ihre Rechte nennt. Ob sie
     * deshalb heute wirklich für `anon` oder `authenticated` ausführbar sind,
     * ist damit NICHT gesagt — ein späterer `grant`/`revoke` in einer anderen
     * Datei kann es längst geregelt haben, und die einzige verlässliche
     * Antwort steht im Katalog (`information_schema.routine_privileges`),
     * nicht im Migrationstext.
     *
     * Die Liste ist deshalb eine Bestandsaufnahme, keine Freigabe: sie ist
     * eingefroren, damit sie nicht wächst, und sie wartet auf eine eigene
     * Prüfung. Eine zehnte Zeile lässt diesen Test fehlschlagen.
     */
    expect(gaps.sort()).toEqual([
      "0041_three_account_authorization.sql: admin_platform_settings",
      "0041_three_account_authorization.sql: admin_set_shop_policies",
      "0062_orderbook_sale_maintenance.sql: seller_set_sale_date",
      "0062_orderbook_sale_maintenance.sql: seller_set_sale_payout",
      "0062_orderbook_sale_maintenance.sql: seller_update_sale",
      "0063_orderbook_test_classification.sql: seller_create_purchase",
      "0063_orderbook_test_classification.sql: seller_create_sale",
      "0063_orderbook_test_classification.sql: seller_orderbook_ledger",
      "0063_orderbook_test_classification.sql: seller_sales",
    ]);
  });
});
