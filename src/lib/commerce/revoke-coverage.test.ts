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

/**
 * Die Namen, deren Rechte eine Datei in einer Schleife setzt:
 * `foreach fn in array array['name(…)', …] loop execute format('revoke … on
 * function public.%s …') … end loop` — so tun es `0062` und `0063`. Bis M-05B
 * (2026-11-10) sah dieser Test diese Form nicht und führte ihre Funktionen
 * deshalb als Lücken, obwohl das Staging-Schema sie längst gesperrt zeigt.
 */
function namesInRightsLoops(sql: string): Set<string> {
  const out = new Set<string>();
  for (const m of sql.matchAll(/foreach\s+\w+\s+in\s+array\s+array\[([\s\S]*?)\]\s*loop([\s\S]*?)end loop/gi)) {
    if (!/(revoke|grant)[^;]*on function public\.%s/i.test(m[2])) continue;
    for (const n of m[1].matchAll(/'([a-z_]+)\(/g)) out.add(n[1]);
  }
  return out;
}

/** Nennt die Datei für diesen Namen ein Recht — entzogen oder erteilt, direkt oder in einer Schleife? */
function statesRights(sql: string, name: string): boolean {
  const revoke = new RegExp(`^\\s*revoke [^;]*on function public\\.${name}\\(`, "m");
  const grant = new RegExp(`^\\s*grant [^;]*on function public\\.${name}\\(`, "m");
  return revoke.test(sql) || grant.test(sql) || namesInRightsLoops(sql).has(name);
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

  it("und jede geerbte Lücke ist geschlossen — nachgewiesen, nicht eingefroren (M-05B)", () => {
    /*
     * BIS 2026-11-10 STAND HIER EINE EINGEFRORENE LISTE VON NEUN FUNKTIONEN.
     *
     * Der Abgleich mit dem Staging-Schema vom 2026-11-09 (M-05) hat gezeigt:
     * acht davon waren nie offen — `0062` und `0063` setzen ihre Rechte in
     * Schleifen, die dieser Test nicht las (`namesInRightsLoops` liest sie
     * jetzt), und `admin_platform_settings` wurde in `0094` mit Rechten neu
     * angelegt. Offen war genau eine: `admin_set_shop_policies` aus `0041`;
     * `0187` schließt sie.
     *
     * Die Regel jetzt: eine Lücke (gelöscht und neu angelegt ohne Rechte)
     * gilt nur als geschlossen, wenn dieselbe Datei die Rechte in einer
     * Schleife setzt oder eine SPÄTERE Datei sie für diesen Namen nennt. Was
     * so nicht geschlossen ist, lässt den Test fehlschlagen — es gibt keine
     * Ausnahmeliste mehr.
     */
    const offen = gaps.filter((g) => {
      const [file, name] = g.split(": ");
      return !files.some((later) => later > file && statesRights(readFileSync(join(DIR, later), "utf8"), name));
    });
    expect(offen, `offene Lücken:\n${offen.join("\n")}`).toEqual([]);
  });

  it("die acht früher eingefrorenen Fälle sind durch ihre eigene Schleife oder eine spätere Datei belegt", () => {
    const belegt = (file: string, name: string) => {
      const sql = readFileSync(join(DIR, file), "utf8");
      return namesInRightsLoops(sql).has(name);
    };
    for (const name of ["seller_set_sale_date", "seller_set_sale_payout", "seller_update_sale"]) {
      expect(belegt("0062_orderbook_sale_maintenance.sql", name), name).toBe(true);
    }
    for (const name of ["seller_create_purchase", "seller_create_sale", "seller_orderbook_ledger", "seller_sales"]) {
      expect(belegt("0063_orderbook_test_classification.sql", name), name).toBe(true);
    }
    expect(statesRights(readFileSync(join(DIR, "0094_catalog_market_boost.sql"), "utf8"), "admin_platform_settings")).toBe(true);
    expect(statesRights(readFileSync(join(DIR, "0187_revoke_shop_policies_public.sql"), "utf8"), "admin_set_shop_policies")).toBe(true);
  });
});

describe("jede NEU eingeführte security-definer-Funktion nennt ihre Rechte (M-05B)", () => {
  /*
   * Die zweite Falle neben drop + create: eine Funktion, die es vorher gar
   * nicht gab. Auch sie bekommt die Vorgabe (EXECUTE für PUBLIC) und Supabases
   * Standardrechte (anon). Seit `0098` setzt jede neu eingeführte
   * `security definer`-Funktion ihre Rechte in derselben Datei — gemessen am
   * 2026-11-10, ohne Ausnahme. Ab jetzt ist das eine Regel: eine neue
   * Funktion ohne Rechte lässt diesen Test fehlschlagen. Triggerfunktionen
   * sind ausgenommen (sie lassen sich nicht direkt aufrufen).
   */
  const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
  const seen = new Set<string>();
  const missing: string[] = [];
  for (const file of files) {
    const sql = readFileSync(join(DIR, file), "utf8");
    for (const m of sql.matchAll(/^create (?:or replace )?function public\.([a-z_]+)\(([\s\S]*?)\$\$/gm)) {
      const [, name, head] = m;
      const first = !seen.has(name);
      seen.add(name);
      if (!first || Number(file.slice(0, 4)) < 98) continue;
      if (/returns\s+trigger/i.test(head) || !/security definer/i.test(head)) continue;
      if (!statesRights(sql, name)) missing.push(`${file}: ${name}`);
    }
  }

  it("ab 0098 nennt jede neue security-definer-Funktion ihre Rechte in ihrer Datei", () => {
    expect(missing, `ohne Rechte:\n${missing.join("\n")}`).toEqual([]);
  });

  it("die Regel erkennt eine neue Funktion ohne Rechte (Positivkontrolle)", () => {
    const sql = "create or replace function public.brand_new_writer(p int)\nreturns void language plpgsql security definer set search_path = ''\nas $$ begin end $$;";
    expect(statesRights(sql, "brand_new_writer")).toBe(false);
    expect(statesRights(sql + "\nrevoke all on function public.brand_new_writer(int) from public, anon;", "brand_new_writer")).toBe(true);
  });
});
