import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { code, latestFunction, migrationFiles, migrationSource } from "@/test-support/migrations";
import { de } from "../i18n/de";

/**
 * `0114` — MEHRERE VERKÄUFE EINES KÄUFERS AN EINEM TAG, GOLDORANGE.
 *
 * WARUM DAS EINE MIGRATION BRAUCHTE. Die Tatsache war nicht herleitbar:
 * `buyer_repeat` sagt „hat vorher gekauft" und ist auch über Monate hinweg
 * wahr; `buyer_key` verlässt `seller_sales()` nicht und soll es nicht (er
 * enthält `orders.user_id`); `buyer_label` ist ein Anzeigename, und zwei
 * Marktplatzkonten können denselben tragen. Also wird die Zahl dort
 * gerechnet, wo der Schlüssel schon liegt, und nur die Zahl geht hinaus.
 *
 * WAS HIER GEPRÜFT WIRD. Dass `0114` genau eine Funktion ersetzt und sonst
 * nichts anfasst · dass die neue Zahl dieselbe Identität benutzt wie
 * `buyer_repeat` · dass ein undatierter Verkauf keinen Tagesnachbarn bekommt ·
 * und dass die Oberfläche nur die Datumsschrift einfärbt.
 */

const FILE = "0114_buyer_sales_per_day.sql";
const raw = migrationSource(FILE);
const exec = code(raw);
const LEDGER = readFileSync("src/components/business/sales-ledger.tsx", "utf8");
const QUERIES = readFileSync("src/lib/orderbook/sales-queries.ts", "utf8");
const CSS = readFileSync("src/app/globals.css", "utf8");
const copy = de.business.sales;

describe("0114 ist eine ersetzte Lesefunktion und sonst nichts", () => {
  it("ist die neueste Migration und steht allein auf ihrer Nummer", () => {
    expect(migrationFiles).toContain(FILE);
    expect(migrationFiles.filter((f) => f.startsWith("0114"))).toEqual([FILE]);
  });

  it("ersetzt genau seller_sales und erzeugt kein Schema", () => {
    expect([...exec.matchAll(/create or replace function public\.(\w+)/g)].map((m) => m[1]))
      .toEqual(["seller_sales"]);
    for (const forbidden of [
      /create table/i, /alter table/i, /create\s+(unique\s+)?index/i, /create trigger/i,
      /add constraint/i, /drop (table|column|trigger|index|constraint)/i,
      /insert into/i, /delete from/i, /^\s*update /im, /truncate/i, /grant|revoke/i,
    ]) {
      expect(exec, String(forbidden)).not.toMatch(forbidden);
    }
  });

  it("und ist die geltende Fassung", () => {
    expect(latestFunction("seller_sales").file).toBe(FILE);
  });

  it("nennt den Grund, warum es sie überhaupt gibt", () => {
    /* Eine Migration für eine Zahl braucht ihre Begründung neben sich. */
    expect(raw).toContain("buyer_repeat");
    expect(raw).toContain("buyer_key");
    expect(raw).toContain("buyer_label");
  });
});

describe("0114 — die Zahl", () => {
  const body = code(latestFunction("seller_sales").body);

  it("zählt über denselben Schlüssel wie buyer_repeat, nur anders gefenstert", () => {
    expect(body).toContain("count(*) over (partition by b.buyer_key, b.sale_day)");
    /* Dieselbe Identität: Konto-ID innen, Quelle plus Benutzername aussen. */
    expect(body).toContain("'skyisles:' || b.buyer_user_id::text");
    expect(body).toContain("b.channel || ':' || lower(btrim(b.buyer_ref))");
  });

  it("ein Verkauf ohne Tag hat keinen Tagesnachbarn", () => {
    /*
     * Ohne diesen `case` würde `partition by (buyer_key, NULL)` alle
     * undatierten Käufe eines Käufers in einen Topf werfen und sie über einen
     * Tag gruppieren, den keiner von ihnen hat.
     */
    expect(body).toContain("case when b.sale_day is null then 1");
  });

  it("projiziert die Zahl — und weiterhin NICHT den Schlüssel", () => {
    expect(body).toContain("'buyer_day_count', m.buyer_day_count");
    expect(body).not.toContain("'buyer_key'");
    expect(body).not.toContain("'buyer_user_id'");
  });

  it("stornierte und Test-Verkäufe liegen gar nicht im Fenster", () => {
    const buyers = body.slice(body.indexOf("buyers as ("), body.indexOf("repeats as ("));
    expect(buyers).toContain("where b.cancelled_at is null");
    expect(buyers).toContain("and not b.classified_test");
  });

  it("eine Gruppe von einem ist 1, nicht NULL", () => {
    expect(body).toContain("coalesce(r.buyer_day_count, 1)");
  });

  /*
   * EIN VERSENDETER VERKAUF ZÄHLT MIT — AUSDRÜCKLICH ENTSCHIEDEN.
   *
   * Naheliegend wäre das Gegenteil: wenn ein Paket schon raus ist, lässt sich
   * nichts mehr zusammenlegen. Die Entscheidung des Betreibers ist anders und
   * ist die engere: Orange heisst „derselbe Käufer, derselbe Tag, mehr als
   * einmal" — eine Tatsache über den Kauf, nicht über den Versand. Dass die
   * Zahl den Versandzustand nicht kennt, ist deshalb kein Versäumnis, und
   * dieser Test hält es fest, damit niemand ihn „zur Verbesserung" nachträgt.
   */
  it("der Versandzustand kommt im Fenster nicht vor", () => {
    const buyers = body.slice(body.indexOf("buyers as ("), body.indexOf("marked as ("));
    expect(buyers).not.toContain("shipped_at");
    expect(buyers).not.toContain("fulfillment_status");
    /* Storniert und Test dagegen schon — das sind die beiden Ausschlüsse. */
    expect(buyers).toContain("cancelled_at is null");
    expect(buyers).toContain("not b.classified_test");
  });

  /*
   * UND ALLES ANDERE IST UNVERÄNDERT.
   *
   * Diese Migration ersetzt 200 Zeilen, um eine Zahl hinzuzufügen. Was dabei
   * unbemerkt verschwindet, wäre gefährlicher als das, was dazukommt — also
   * wird gegen `0113` zeichenweise verglichen.
   */
  it("Reihenfolge, Zählungen, Offen-Regel und Summen stehen wie in 0113", () => {
    const old = code((() => {
      const sql = migrationSource("0113_sales_daily_index_and_repeat_buyers.sql");
      const at = sql.indexOf("create or replace function public.seller_sales(");
      return sql.slice(at, sql.indexOf("\n$$;", at));
    })());
    const between = (src: string, from: string, to: string) =>
      src.slice(src.indexOf(from), src.indexOf(to)).replace(/\s+/g, " ").trim();

    for (const [from, to] of [
      ["(b.cancelled_at is null", "as is_open"],
      ["jsonb_build_object(\n      'sale_count'", "as page_summary"],
      ["counts as (", "select page.page_rows"],
      ["order by m.effective_date desc nulls last", "'[]'::jsonb) as page_rows"],
    ] as const) {
      expect(between(body, from, to), from.slice(0, 32)).toBe(between(old, from, to));
    }
  });

  it("und buyer_repeat selbst ist unangetastet", () => {
    expect(body).toContain("b.id asc) > 1 as buyer_repeat");
    expect(body).toContain("order by b.sale_day asc nulls first");
  });

  it("die Nachbedingung sieht nach, dass nichts verloren ging", () => {
    const after = exec.slice(exec.lastIndexOf("do $$"));
    expect(after).toContain("buyer_day_count");
    expect(after).toContain("Merkmale verloren");
    for (const needle of ["buyer_repeat", "as is_open", "expected_payout", "closed_count"]) {
      expect(after, needle).toContain(needle);
    }
  });
});

describe("das Lesemodell nimmt die Zahl mit", () => {
  it("und rechnet sie nicht nach", () => {
    expect(QUERIES).toContain("buyerDayCount:");
    expect(QUERIES).toContain("r.buyer_day_count");
    /* Die Antwort hängt an einem Fenster über ALLE Verkäufe; die Seite kennt
       nur ihre Auswahl und könnte sie nicht herleiten. */
    expect(QUERIES).not.toMatch(/buyerDayCount:\s*(sales|rows)\./);
  });

  it("eine Datenbank ohne 0114 liefert 1, nicht NaN", () => {
    expect(QUERIES).toContain("r.buyer_day_count === null || r.buyer_day_count === undefined");
    expect(QUERIES).toContain("? 1 : Number(r.buyer_day_count)");
  });
});

describe("die Oberfläche färbt genau die Datumsschrift", () => {
  const row = LEDGER.slice(LEDGER.indexOf("<LedgerRow "), LEDGER.indexOf("</LedgerRow>"));

  it("goldorange nur bei mehr als einem", () => {
    expect(row).toContain("sale.buyerDayCount > 1 ? \"font-medium tabular-nums text-attention\"");
  });

  it("der Farbton ist als Token definiert und ist #F5B544", () => {
    expect(CSS).toContain("--attention: #f5b544;");
    expect(CSS).toContain("--color-attention: var(--attention);");
  });

  /*
   * GUT LESBAR IST EINE ZAHL, NICHT EINE MEINUNG.
   *
   * Der Ton wurde als „gut lesbares Goldorange" bestellt. Ob er das ist,
   * entscheidet das Kontrastverhältnis gegen den Grund, auf dem die Zeile
   * sitzt — also wird es gerechnet und nicht behauptet.
   */
  it("trägt auf dem Zeilengrund genug Kontrast — AAA, und wie das bestehende Grün", () => {
    const hex = (name: string): string => {
      const m = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(CSS);
      expect(m, name).not.toBeNull();
      return m![1];
    };
    const lum = (h: string): number => {
      const c = [0, 2, 4].map((i) => parseInt(h.slice(1 + i, 3 + i), 16) / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const ratio = (a: string, b: string): number => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    const ground = hex("--surface");
    const attention = hex("--attention");
    expect(attention).toBe("#f5b544");
    /* 7:1 ist AAA für Fließtext; das Datum ist Fließtext. */
    expect(ratio(attention, ground)).toBeGreaterThanOrEqual(7);
    /* Und nicht schlechter als der Ton, der dieselbe Aufgabe schon hat. */
    expect(ratio(attention, ground)).toBeGreaterThan(ratio(hex("--success"), ground) - 1);
  });

  it("NICHT die Zeile und NICHT der Info-Knopf", () => {
    /* Der Knopf steht vor der Datumsschrift; sein Abschnitt darf die Farbe
       nicht tragen, sonst sähe er aus wie ein Zustand. */
    const button = row.slice(row.indexOf("<button"), row.indexOf("</button>"));
    expect(button).not.toContain("text-attention");
    /* Und die Zeile selbst auch nicht. */
    expect(LEDGER.slice(LEDGER.indexOf("<LedgerRow "), LEDGER.indexOf(">", LEDGER.indexOf("<LedgerRow "))))
      .not.toContain("attention");
  });

  it("Farbe trägt die Aussage nicht allein", () => {
    expect(row).toContain("copy.sameDayBuyerHint(sale.buyerDayCount)");
    expect(copy.sameDayBuyerHint(2)).toContain("2");
    expect(copy.sameDayBuyerHint(2)).toMatch(/gemeinsam/);
    /* Und der Satz sagt „möglicherweise" — die Markierung legt nichts zusammen. */
    expect(copy.sameDayBuyerHint(2)).toMatch(/möglicherweise/);
  });

  it("die grüne Wiederholungskäufer-Markierung bleibt, wie sie war", () => {
    expect(row).toContain("sale.buyerRepeat ? \"font-medium text-success\" : \"text-muted\"");
    expect(row).toContain("aria-label={copy.repeatBuyer}");
    expect(row).toContain("↻");
  });

  it("und die Sortierung ist unberührt", () => {
    /*
     * Die Markierung ist visuell. Sie fasst nichts um und ordnet nichts neu —
     * `sortSales` steht im Lesemodell und kennt die Zahl nicht einmal.
     */
    expect(QUERIES).toContain("sortSales(sales)");
    expect(LEDGER).not.toMatch(/sort[\s\S]{0,80}buyerDayCount/);
    const sort = readFileSync("src/lib/orderbook/sales-view.ts", "utf8");
    const fn = sort.slice(sort.indexOf("export function sortSales"));
    expect(fn.slice(0, fn.indexOf("\n}"))).not.toContain("buyerDayCount");
  });
});
