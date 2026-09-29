import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Wer den eigenen Ankaufsfaktor erfahren darf (0103).
 *
 * DER BEFUND. `orderbook_global_factor()` — Ausgaben ÷ bekannter Marktwert
 * über alle Einkäufe — stand seit `0059` jedem angemeldeten Konto offen: der
 * Rechteblock am Ende jener Migration vergab `grant execute … to
 * authenticated` für neunzehn `seller_*`-Funktionen und für diese eine
 * mit, die als einzige keinen Rollenwächter im Rumpf hat. Zu welchem Anteil
 * am Marktwert ein Betrieb einkauft, ist eine Geschäftszahl.
 *
 * Die Prüfungen hier sind Quelltextprüfungen. Was die Datenbank tatsächlich
 * gewährt, sagt nur der Katalog — und genau deshalb steht im Rolloutplan ein
 * `pg_proc`-Abgleich nach der Anwendung. Diese Datei hält fest, dass die
 * Migration das Richtige VERLANGT und dass niemand sie später versehentlich
 * zurücknimmt.
 */
const MIGRATION = "supabase/migrations/0103_buy_in_factor_is_not_public.sql";

function sql(path: string): string {
  return readFileSync(path, "utf8");
}

/** Ohne Kommentare: die Kopfzeilen zitieren die alten Grants im Wortlaut. */
function code(path: string): string {
  return sql(path)
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
}

describe("die Lücke wird geschlossen", () => {
  const migration = code(MIGRATION);

  it("entzieht jeder Clientrolle das Ausführungsrecht", () => {
    expect(migration).toContain(
      "revoke all on function public.orderbook_global_factor() from public, anon, authenticated;",
    );
  });

  it("legt die Funktion dabei nicht neu an", () => {
    /*
     * Ein `create or replace` würde die ACL zurücksetzen — genau der Fehler
     * aus 0100, wo `drop` + `create` vier Mail-RPCs wieder für anon öffnete.
     * Hier wird nur ein Recht genommen, der Rumpf bleibt der aus 0059.
     */
    expect(migration).not.toContain("create or replace function public.orderbook_global_factor");
    expect(migration).not.toContain("drop function");
  });

  it("ändert die Formel nicht", () => {
    // Nichts aus dem Rechenweg taucht in dieser Migration auf.
    for (const token of ["total_cost", "purchase_market_value", "known_value", "sum("]) {
      expect(migration.includes(token), `0103 darf ${token} nicht enthalten`).toBe(false);
    }
  });

  it("fasst keine Daten an", () => {
    for (const write of ["insert into", "update ", "delete from", "alter table", "create table"]) {
      expect(migration.toLowerCase().includes(write), `0103 darf ${write} nicht enthalten`)
        .toBe(false);
    }
  });
});

describe("der Betrieb behält seinen Weg", () => {
  const migration = code(MIGRATION);

  it("bekommt eine Funktion mit dem kanonischen Wächter", () => {
    expect(migration).toContain("create or replace function public.seller_buy_in_factor()");
    expect(migration).toContain("public.can_operate_active_seller()");
    // Keine neue Rollenlogik: dieselbe Prüfung wie überall im Betrieb (0041).
    expect(migration).not.toContain("seller_operators");
    expect(migration).not.toContain("is_shop_admin");
  });

  it("ruft die bestehende Rechnung auf, statt sie zu wiederholen", () => {
    expect(migration).toContain("then public.orderbook_global_factor() end");
  });

  it("bleibt lesend", () => {
    expect(migration).toContain("stable");
    expect(migration).not.toContain("volatile");
  });

  it("antwortet einem Unbefugten wie einem leeren Orderbuch", () => {
    /*
     * NULL statt Fehler, wie `seller_attention_total()` in 0099 mit 0
     * antwortet: ein Fehler wäre selbst eine Auskunft — er verriete, dass es
     * etwas zu holen gibt.
     */
    expect(migration).not.toContain("raise exception");
    expect(migration).toContain("case when public.can_operate_active_seller()");
  });

  it("wird genau der Rolle gewährt, die auch die Geschwister haben", () => {
    expect(migration).toContain(
      "revoke all on function public.seller_buy_in_factor() from public, anon;",
    );
    expect(migration).toContain(
      "grant execute on function public.seller_buy_in_factor() to authenticated;",
    );
  });
});

describe("die inneren Aufrufer bleiben unberührt", () => {
  /*
   * Alle drei sind `security definer` und laufen als ihr Eigentümer, nicht
   * als der Anrufer — der Entzug gegen `authenticated` erreicht sie nicht.
   * Bräche einer davon, bräche der Zahlungspfad: `orders_register_sale()`
   * hängt am Trigger, der beim Bezahlen den Orderbuch-Verkauf anlegt, und
   * 0078 hält fest, dass ein Fehler dort schon einmal zwei bestätigte
   * Zahlungen zurückgerollt hat.
   */
  const callers: [string, string][] = [
    ["supabase/migrations/0078_register_sale_created_by_is_a_uuid.sql", "orders_register_sale()"],
    ["supabase/migrations/0073_sales_settle_and_cancel_rules.sql", "seller_book_sale_item(p_item_id bigint)"],
  ];

  for (const [file, fn] of callers) {
    it(`${fn} ist security definer und erreicht die Funktion weiterhin`, () => {
      const text = sql(file);
      const at = text.indexOf(`create or replace function public.${fn}`);
      expect(at, `${fn} nicht gefunden`).toBeGreaterThan(-1);
      const head = text.slice(at, at + 400);
      expect(head).toContain("security definer");
      expect(text).toContain("public.orderbook_global_factor()");
    });
  }

  it("0103 fasst keinen dieser Aufrufer an", () => {
    const migration = code(MIGRATION);
    expect(migration).not.toContain("orders_register_sale");
    expect(migration).not.toContain("seller_book_sale_item");
    expect(migration).not.toContain("buy_in_factor_snapshot");
  });

  it("und 0059 bleibt unverändert", () => {
    // Die alte Migration wird nicht umgeschrieben; 0103 ist additiv.
    const old = sql("supabase/migrations/0059_orderbook_sales.sql");
    expect(old).toContain("grant execute on function public.orderbook_global_factor() to authenticated;");
  });
});

describe("der Kalkulator geht durch die neue Tür", () => {
  const actions = readFileSync("src/lib/calculator/actions.ts", "utf8");

  it("ruft die abgesicherte Funktion, nicht mehr die interne", () => {
    expect(actions).toContain('supabase.rpc("seller_buy_in_factor")');
    expect(actions).not.toContain('supabase.rpc("orderbook_global_factor")');
  });

  it("prüft zusätzlich vor dem Aufruf — zwei Schlösser, nicht eines", () => {
    expect(actions).toContain("if (!(await canOperateSeller())) return null;");
  });

  it("die Sicherheit hängt an der Datenbank, nicht an dieser Prüfung", () => {
    // Steht so im Kommentar, und der Test hält die Aussage fest: ein
    // direkter RPC-Aufruf umgeht die Server Action, nicht den Wächter.
    expect(code(MIGRATION)).toContain("can_operate_active_seller()");
  });
});
