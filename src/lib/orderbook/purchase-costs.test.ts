import { describe, expect, it } from "vitest";

import { code, latestFunction, migrationFiles, migrationSource } from "@/test-support/migrations";
import {
  DEFAULT_PAYMENT_METHOD, DEFAULT_PURCHASE_TEMPLATE, PAYMENT_METHODS,
  PURCHASE_TEMPLATES, isPaymentMethod, isPurchasePlatform, purchaseTemplate,
} from "./purchase-template";
import { costSplitAddsUp, hasCostSplit, purchaseCosts, storedCostSplit } from "./purchase-money";

/**
 * `0115` — KOSTENAUFTEILUNG, PLATTFORM, VERKÄUFER, TAGESPLATZ, VITRINE.
 *
 * Die echten Ableitungen werden AUSGEFÜHRT, die SQL-Zusicherungen am
 * Migrationstext gelesen. Was ein Texttest hier nicht kann, steht in der
 * Staging-Probe: dass PostgreSQL den CHECK wirklich greifen lässt, dass der
 * Tagesindex-Trigger unter Last serialisiert, dass der Backfill lückenlos ist.
 */

const FILE = "0115_purchase_costs_platform_and_day.sql";
const raw = migrationSource(FILE);
const exec = code(raw);

describe("0115 ist additiv und deutet nichts um", () => {
  it("ist die neueste Migration und steht allein auf ihrer Nummer", () => {
    expect(migrationFiles).toContain(FILE);
    expect(migrationFiles.filter((f) => f.startsWith("0115"))).toEqual([FILE]);
  });

  it("legt genau die sieben Spalten an und löscht keine", () => {
    for (const col of ["items_cost", "shipping_cost", "buyer_protection_cost",
                       "platform", "seller_name", "payment_method", "daily_index"]) {
      expect(exec, col).toContain(`add column if not exists ${col}`);
    }
    for (const forbidden of [/drop column/i, /drop table/i, /truncate/i,
                             /alter column .* type/i, /insert into/i, /delete from/i]) {
      expect(exec, String(forbidden)).not.toMatch(forbidden);
    }
  });

  /*
   * DIE WICHTIGSTE ZUSICHERUNG DER GANZEN MIGRATION (Entscheidung D2).
   *
   * `total_cost` ist seit `0053` „was tatsächlich bezahlt wurde", und daran
   * hängen der Faktor, das Ledger, der Import und der Backup-Export. Würde
   * diese Migration die Spalte anfassen, hätten 84 bestehende Einkäufe eine
   * andere Bedeutung als die neuen.
   */
  it("lässt `total_cost` vollständig unangetastet", () => {
    expect(exec).not.toMatch(/set\s+total_cost/i);
    expect(exec).not.toMatch(/update public\.purchases[\s\S]{0,400}total_cost\s*=/i);
    /* Geschrieben wird an Daten genau eines: der Tagesplatz. */
    const writes = [...exec.matchAll(/update public\.purchases[\s\S]{0,80}?set\s+(\w+)/gi)]
      .map((m) => m[1]);
    expect([...new Set(writes)]).toEqual(["daily_index"]);
  });

  it("die Aufteilung muss aufgehen — und nur, wenn es eine gibt", () => {
    const c = exec.slice(exec.indexOf("purchases_cost_split_adds_up"));
    expect(c).toContain("items_cost is null");
    expect(c).toContain("= round(total_cost, 2)");
    /* Versand und Käuferschutz zählen als 0, wenn die Aufteilung existiert. */
    expect(c).toContain("coalesce(shipping_cost, 0)");
    expect(c).toContain("coalesce(buyer_protection_cost, 0)");
  });

  it("eine Aufteilung ohne Artikelpreis ist keine", () => {
    expect(exec).toContain("purchases_cost_split_is_whole");
    const c = exec.slice(exec.indexOf("purchases_cost_split_is_whole"));
    expect(c).toContain("items_cost is not null");
  });

  it("die fünf Zahlungswege und die drei Plattformen stehen als CHECK", () => {
    expect(exec).toContain("payment_method in ('card', 'paypal', 'transfer', 'cash', 'platform')");
    expect(exec).toContain("platform in ('kleinanzeigen', 'willhaben', 'manual')");
  });

  /*
   * EIN STANDARDWERT IN DER DATENBANK WÄRE EINE BEHAUPTUNG ÜBER DIE
   * VERGANGENHEIT.
   *
   * `default 'card'` auf `payment_method` hätte jedem der 84 bestehenden
   * Einkäufe rückwirkend eine Zahlungsart zugeschrieben, die niemand erfasst
   * hat. Die Vorbelegung gehört ins Formular.
   */
  it("keine der neuen Spalten hat einen Standardwert", () => {
    const block = exec.slice(exec.indexOf("alter table public.purchases"),
                             exec.indexOf("comment on column"));
    expect(block).not.toMatch(/default/i);
  });

  it("der Tagesindex ist ein eindeutiger TEILindex auf purchased_at", () => {
    expect(exec).toMatch(
      /create unique index if not exists purchases_daily_index_uniq\s+on public\.purchases \(purchased_at, daily_index\)\s+where purchased_at is not null and daily_index is not null;/);
    expect(exec).toContain("purchases_day_order_idx");
    expect(exec).toContain("(purchased_at desc nulls last, daily_index desc nulls last, id desc)");
  });

  it("und es gibt KEINE zweite Tagesspalte", () => {
    /*
     * Beim Verkauf brauchte `0113` eine, weil `effective_date` ein `case`
     * über zwei Tabellen war. `purchases.purchased_at` IST der Tag; eine
     * Kopie daneben könnte auseinanderlaufen.
     */
    expect(exec).not.toContain("purchase_day");
    expect(exec).not.toContain("purchase_day_of");
  });

  /*
   * DIE REIHENFOLGE, DIE NICHT VERTAUSCHT WERDEN DARF — zweimal.
   */
  it("der Backfill läuft VOR dem Trigger", () => {
    const backfill = exec.indexOf("row_number() over (partition by p.purchased_at");
    const trigger = exec.indexOf("create trigger purchases_set_daily_index_trg");
    expect(backfill).toBeGreaterThan(-1);
    expect(trigger).toBeGreaterThan(-1);
    expect(backfill).toBeLessThan(trigger);
  });

  it("und der Tag-gleich-Platz-CHECK läuft NACH dem Backfill", () => {
    /*
     * Ein `add constraint` prüft die bestehenden Zeilen sofort. Vor dem
     * Backfill tragen alle 84 datierten Einkäufe `daily_index IS NULL` —
     * oben hätte dieser CHECK die Migration auf der ersten Zeile abgebrochen.
     */
    const backfill = exec.indexOf("row_number() over (partition by p.purchased_at");
    const check = exec.indexOf("add constraint purchases_day_and_index_agree");
    expect(check).toBeGreaterThan(backfill);
    expect(raw).toContain("prüft die BESTEHENDEN Zeilen sofort");
  });

  it("der Tie-Breaker ist `id`, und updated_at bleibt stehen", () => {
    expect(exec).toContain("row_number() over (partition by p.purchased_at order by p.id)");
    const backfill = exec.slice(exec.indexOf("with gap as ("),
                                exec.indexOf("add constraint purchases_day_and_index_agree"));
    expect(backfill).not.toContain("created_at");
    expect(backfill).not.toContain("updated_at");
    expect(backfill).not.toContain("updated_by");
  });

  it("der Trigger leitet nichts ab, sperrt je Tag und lässt den Tausch durch", () => {
    const fn = code(latestFunction("purchases_set_daily_index").body);
    expect(fn).toContain("if new.purchased_at is null then");
    expect(fn).toContain("new.daily_index := null;");
    /* Die Tür für den Tausch. */
    expect(fn).toContain("old.purchased_at is not distinct from new.purchased_at");
    expect(fn).toContain("new.daily_index is not null");
    /* Sperre je Tag, VOR dem Lesen des Maximums. */
    expect(fn).toContain("pg_advisory_xact_lock(");
    expect(fn.indexOf("pg_advisory_xact_lock")).toBeLessThan(fn.indexOf("max(p.daily_index)"));
    /* Ein geparkter Negativwert ist kein belegter Platz. */
    expect(fn).toContain("p.daily_index > 0");
  });

  it("kein CHECK verbietet den negativen Parkplatz", () => {
    expect(exec).not.toMatch(/add constraint[^;]*daily_index\s*>\s*0/);
    expect(raw).toContain("KEIN CHECK");
  });

  it("die Vitrine kommt als Wort hinzu, und nichts verschwindet", () => {
    const c = exec.slice(exec.indexOf("add constraint purchase_items_state_known"));
    for (const state of ["ordered", "arrived", "damaged", "missing", "booked",
                         "reconciled_legacy", "settled", "showcase"]) {
      expect(c, state).toContain(`'${state}'`);
    }
  });

  it("und die Nachbedingung sieht nach, dass kein Altdatensatz Kostenfelder bekam", () => {
    const after = exec.slice(exec.lastIndexOf("do $$"));
    expect(after).toContain("tragen plötzlich neue Kostenfelder");
    expect(after).toContain("ohne lückenlose Plätze 1..n");
    expect(after).toContain("mit einem Platz <= 0");
  });
});

// ---------------------------------------------------------------------------
describe("die Kostenrechnung, ausgeführt", () => {
  const costs = (items: string, shipping = "", protection = "") =>
    purchaseCosts({ items, shipping, buyerProtection: protection });

  it("Gesamtkosten = Kaufpreis + Versand + Käuferschutz", () => {
    const c = costs("42,50", "5,99", "1,20");
    expect(c.items).toBe(42.5);
    expect(c.shipping).toBe(5.99);
    expect(c.buyerProtection).toBe(1.2);
    expect(c.total).toBe(49.69);
  });

  it("ein leeres Feld ist 0 und nicht unbekannt", () => {
    expect(costs("30").total).toBe(30);
    expect(costs("30", "", "").shipping).toBe(0);
    expect(costs("30", "", "").buyerProtection).toBe(0);
  });

  it("deutsche Dezimalkommas, wie überall in diesem Formular", () => {
    /*
     * `parseMoney` ersetzt GENAU EIN Komma durch einen Punkt — kein
     * Tausendertrennzeichen. „1.234,56" ergibt deshalb nichts Brauchbares,
     * und das ist keine Lücke dieser Datei: dasselbe gilt im
     * Verkaufsformular, und beide Felder tragen `inputMode="decimal"`.
     * Festgehalten, damit niemand die Fähigkeit annimmt, die hier fehlt.
     */
    expect(costs("42,50").items).toBe(42.5);
    expect(costs("42.50").items).toBe(42.5);
    expect(costs("1234,56").items).toBe(1234.56);
  });

  /*
   * EINMAL RUNDEN, AUF DER SUMME.
   *
   * Drei einzeln gerundete Beträge können einen Cent neben ihrer eigenen
   * Summe landen — und genau daran würde `purchases_cost_split_adds_up` den
   * ganzen Einkauf ablehnen.
   */
  it("die Summe fällt nicht neben ihre Teile — DAS prüft der CHECK in 0115", () => {
    /*
     * Gefunden, indem dieser Test fehlschlug: die erste Fassung summierte
     * die ROHEN Werte und rundete danach. Gespeichert werden aber die
     * gerundeten Teile, und `purchases_cost_split_adds_up` addiert genau
     * diese — 10,01 + 0,01 + 0,01 = 10,03, während die rohe Summe 10,02
     * ergab. Der CHECK hätte den ganzen Einkauf abgelehnt.
     */
    for (const triple of [["10,005", "0,005", "0,005"], ["0,004", "0,004", "0,004"],
                          ["33,335", "1,115", "0,555"], ["42,50", "5,99", "1,20"]] as const) {
      const c = costs(triple[0], triple[1], triple[2]);
      const asStored = Math.round((c.items + c.shipping + c.buyerProtection) * 100) / 100;
      expect(asStored, triple.join(" + ")).toBe(c.total);
    }
  });

  it("eine Zeile ohne Aufteilung gilt als stimmig — es gibt nichts zu prüfen", () => {
    expect(hasCostSplit({ total_cost: 100 })).toBe(false);
    expect(storedCostSplit({ total_cost: 100 })).toBeNull();
    expect(costSplitAddsUp({ total_cost: 100 })).toBe(true);
  });

  it("eine gespeicherte Aufteilung wird gegen ihre Summe geprüft", () => {
    expect(costSplitAddsUp({ total_cost: "49.69", items_cost: "42.50",
                             shipping_cost: "5.99", buyer_protection_cost: "1.20" })).toBe(true);
    expect(costSplitAddsUp({ total_cost: "50.00", items_cost: "42.50",
                             shipping_cost: "5.99", buyer_protection_cost: "1.20" })).toBe(false);
  });

  it("eine Aufteilung ohne Versandzeile heisst „kein Versand", () => {
    const split = storedCostSplit({ total_cost: "30.00", items_cost: "30.00" });
    expect(split).not.toBeNull();
    expect(split!.shipping).toBe(0);
    expect(split!.buyerProtection).toBe(0);
    expect(costSplitAddsUp({ total_cost: "30.00", items_cost: "30.00" })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("die Plattformvorlagen", () => {
  it("vier Vorlagen, Kleinanzeigen als Standard", () => {
    /* eBay kam in 0118 dazu und steht an zweiter Stelle: es ist nach
       Kleinanzeigen der Marktplatz, über den tatsächlich eingekauft wird. */
    expect(PURCHASE_TEMPLATES.map((t) => t.id))
      .toEqual(["kleinanzeigen", "ebay", "willhaben", "manual"]);
    expect(DEFAULT_PURCHASE_TEMPLATE).toBe("kleinanzeigen");
    expect(purchaseTemplate("kleinanzeigen").platform).toBe("kleinanzeigen");
  });

  it("eine unbekannte Kennung fällt auf den Standard zurück, statt zu brechen", () => {
    /* Hier stand „ebay" — seit 0118 ist das eine bekannte Plattform. Der
       Test braucht eine, die es wirklich nicht gibt. */
    expect(purchaseTemplate("etsy").id).toBe("kleinanzeigen");
    expect(purchaseTemplate("").id).toBe("kleinanzeigen");
  });

  it("Kreditkarte ist die Vorbelegung des Formulars (D8)", () => {
    expect(DEFAULT_PAYMENT_METHOD).toBe("card");
    expect([...PAYMENT_METHODS])
      .toEqual(["card", "paypal", "transfer", "cash", "platform"]);
  });

  it("Käuferschutz nur dort, wo eine Plattform einen erheben kann", () => {
    expect(purchaseTemplate("kleinanzeigen").opensBuyerProtection).toBe(true);
    expect(purchaseTemplate("willhaben").opensBuyerProtection).toBe(true);
    /* Ein Flohmarktkauf hat keine Plattform, die einen Käuferschutz berechnet. */
    expect(purchaseTemplate("manual").opensBuyerProtection).toBe(false);
    /* Und eBay erhebt keinen, der auf einer Abrechnung erscheint (0118) —
       der Käuferschutz ist dort für den Käufer kostenfrei. */
    expect(purchaseTemplate("ebay").opensBuyerProtection).toBe(false);
    expect(purchaseTemplate("ebay").payment).toBe("paypal");
  });

  it("und die Vorlagen decken sich mit dem CHECK, wie er zuletzt gilt", () => {
    /*
     * NICHT MEHR GEGEN 0115 ALLEIN. `0118` hat `purchases_platform_known`
     * neu gesetzt, und ein Test gegen die erste Fassung hätte die Erweiterung
     * nicht gesehen — er hätte sie nur verboten. Gefragt ist der CHECK, wie
     * er GILT: die letzte Migration, die ihn definiert.
     */
    const platformCheck = (() => {
      for (let i = migrationFiles.length - 1; i >= 0; i--) {
        const sql = code(migrationSource(migrationFiles[i]));
        const at = sql.lastIndexOf("add constraint purchases_platform_known");
        if (at === -1) continue;
        return sql.slice(at, sql.indexOf(";", at));
      }
      throw new Error("keine Migration definiert purchases_platform_known");
    })();
    for (const t of PURCHASE_TEMPLATES) {
      expect(platformCheck, t.id).toContain(`'${t.platform}'`);
    }
    /* Und nichts darüber hinaus: der CHECK kennt genau die vier Vorlagen. */
    expect(platformCheck.match(/'[a-z_]+'/g)?.sort())
      .toEqual(["'ebay'", "'kleinanzeigen'", "'manual'", "'willhaben'"]);
    for (const m of PAYMENT_METHODS) {
      expect(exec, m).toContain(`'${m}'`);
    }
  });

  it("die Wächter nehmen nur, was die Datenbank auch nimmt", () => {
    expect(isPurchasePlatform("kleinanzeigen")).toBe(true);
    expect(isPurchasePlatform("ebay")).toBe(true);        // seit 0118
    expect(isPurchasePlatform("etsy")).toBe(false);
    expect(isPurchasePlatform(null)).toBe(false);         // „Unbekannt" ist NULL
    expect(isPaymentMethod("card")).toBe(true);
    expect(isPaymentMethod("bitcoin")).toBe(false);
  });

  /*
   * PLATTFORM UND VERKÄUFER SIND ZWEI DINGE.
   *
   * Das war eine ausdrückliche Vorgabe, und es ist die Art Verwechslung, die
   * man erst merkt, wenn in der Übersicht „kleinanzeigen" als Verkäufername
   * steht. Deshalb zwei Spalten, zwei CHECKs, zwei Kommentare.
   */
  it("Plattform und Verkäufername sind getrennte Spalten", () => {
    expect(exec).toContain("add column if not exists platform");
    expect(exec).toContain("add column if not exists seller_name");
    expect(raw).toContain("NOT the seller");
    /* Und `external_ref` ist die Bestellnummer, nicht der Verkäufer. */
    expect(exec).not.toMatch(/seller_name[^;]*external_ref/);
  });
});
