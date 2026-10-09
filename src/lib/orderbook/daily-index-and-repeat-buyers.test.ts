import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { code, latestFunction, migrationFiles, migrationSource } from "@/test-support/migrations";
import { de } from "../i18n/de";
import { sortSales } from "./sales-view";

/**
 * `0113` — DER PLATZ EINES VERKAUFS AM TAG, UND WER SCHON EINMAL GEKAUFT HAT.
 *
 * ZWEI DINGE IN EINER MIGRATION, WEIL DAS ZWEITE DAS ERSTE BRAUCHT.
 * „Wiederholungskäufer" ist eine Aussage über eine REIHENFOLGE — wer war
 * zuerst —, und bei zwei Verkäufen am selben Tag war das Datum keine
 * Reihenfolge, sondern eine Lücke, die `id` zufällig gefüllt hat.
 *
 * WAS EIN TEXTTEST HIER ZEIGT. Nicht, dass PostgreSQL den Tausch atomar
 * ausführt oder dass der Teilindex zwei gleichzeitige Vergaben wirklich
 * serialisiert — das zeigt die Staging-Probe. Wohl aber, dass die Datei die
 * Regeln SAGT, auf die sich alles Weitere verlässt, und zwar in der
 * Reihenfolge, auf die es ankommt: der Backfill steht VOR den Triggern, die
 * Tagessperre VOR dem ersten `for update`, der Käuferschlüssel enthält
 * keinen Namen.
 *
 * Die eine echte Ableitung auf der Clientseite — `sortSales` — wird
 * ausgeführt und nicht gelesen.
 */

const FILE = "0113_sales_daily_index_and_repeat_buyers.sql";
const raw = migrationSource(FILE);
const exec = code(raw);

const QUERIES = readFileSync("src/lib/orderbook/sales-queries.ts", "utf8");
const ACTIONS = readFileSync("src/lib/orderbook/sales-actions.ts", "utf8");
const LEDGER = readFileSync("src/components/business/sales-ledger.tsx", "utf8");
const DETAILS = readFileSync("src/components/business/sale-details.tsx", "utf8");

const copy = de.business.sales;
const modal = copy.detailsModal;

// ---------------------------------------------------------------------------
// 1. Die Datei
// ---------------------------------------------------------------------------

describe("0113 fügt zwei Spalten hinzu und nimmt nichts weg", () => {
  it("ist die neueste Migration und steht allein auf ihrer Nummer", () => {
    expect(migrationFiles).toContain(FILE);
    expect(migrationFiles.filter((f) => f.startsWith("0113"))).toEqual([FILE]);
  });

  it("legt genau zwei Spalten an und löscht nichts", () => {
    expect(exec).toContain("add column if not exists sale_day    date");
    expect(exec).toContain("add column if not exists daily_index integer");
    for (const forbidden of [
      /create table/i, /drop (table|column|constraint)/i, /delete from/i,
      /truncate/i, /insert into/i, /alter table public\.(?!sales\b)/i,
    ]) {
      expect(exec, String(forbidden)).not.toMatch(forbidden);
    }
    /* Und keine andere Tabelle wird geschrieben. `orders` wird gelesen, und
       der Trigger auf ihr stößt NUR `sales` an. */
    const updates = [...exec.matchAll(/update\s+public\.(\w+)/g)].map((m) => m[1]);
    expect([...new Set(updates)]).toEqual(["sales"]);
  });

  it("rührt Bestand, Hold, Erstattungen und Commerce nicht an", () => {
    /*
     * ZWEI VERSCHIEDENE AUSSAGEN, UND SIE WERDEN GETRENNT GEPRÜFT.
     *
     * NIE GENANNT: alles, was Bestand oder Geld BEWEGT. Käme eines davon in
     * dieser Datei vor, wäre 0113 keine Sortiermigration mehr.
     *
     * NUR GELESEN: `shop_inventory`, `order_reservations`, `skylanders` und
     * die beiden Erstattungstabellen stehen in den ersetzten Lesefunktionen — Rümpfe aus `0075` und
     * `0110`, Zeile für Zeile übernommen (siehe die Vertragsprüfung unten).
     * Sie dürfen gelesen werden und sonst nichts, und dass nur `sales`
     * geschrieben wird, steht als eigene Zusicherung darüber.
     */
    for (const forbidden of ["inventory_movements", "apply_inventory_movement",
                             "hold_sale_item", "release_sale_item_hold",
                             "convert_sale_item_hold",
                             "payment_events", "invoice", "stripe"]) {
      expect(exec, forbidden).not.toContain(forbidden);
    }
    /* Und die drei gelesenen stehen ausschließlich in den ersetzten Lesern. */
    const readers = exec.indexOf("create or replace function public.seller_sales(");
    for (const readOnly of ["shop_inventory", "order_reservations", "skylanders",
                            "order_refunds", "sale_refunds"]) {
      expect(exec.slice(0, readers), readOnly).not.toContain(readOnly);
    }
  });

  it("erzeugt genau die sechs geplanten Funktionen und zwei Trigger", () => {
    expect([...exec.matchAll(/create or replace function public\.(\w+)/g)].map((m) => m[1]))
      .toEqual(["sale_day_of", "sales_set_day_and_index", "orders_restate_sale_day",
                "seller_swap_sale_daily_index", "seller_sales", "seller_sale"]);
    expect(exec).toMatch(
      /create trigger sales_set_day_and_index_trg\s+before insert or update on public\.sales/);
    expect(exec).toMatch(
      /create trigger orders_restate_sale_day_trg\s+after update of paid_at on public\.orders/);
  });

  it("der eindeutige Platz ist ein TEILindex, und ein zweiter sortiert", () => {
    expect(exec).toMatch(
      /create unique index if not exists sales_daily_index_uniq\s+on public\.sales \(sale_day, daily_index\)\s+where sale_day is not null and daily_index is not null;/);
    expect(exec).toContain(
      "create index if not exists sales_sale_day_idx");
    expect(exec).toContain("(sale_day desc nulls last, daily_index desc nulls last, id desc)");
  });

  /*
   * KEIN CHECK `daily_index > 0`, UND DAS IST ABSICHT.
   *
   * Der Sentinel-Tausch parkt einen Platz auf einem negativen Wert. Ein
   * Positivitäts-CHECK würde genau diese Transaktion verbieten — die Datei
   * sagt das, damit niemand ihn „zur Sicherheit" nachträgt.
   */
  it("nennt den Grund, warum es keinen Positivitäts-CHECK gibt", () => {
    expect(exec).not.toMatch(/add constraint[^;]*daily_index/);
    expect(raw).toContain("KEINEN CHECK `daily_index > 0`");
  });
});

// ---------------------------------------------------------------------------
// 2. Der Geschäftstag
// ---------------------------------------------------------------------------

describe("0113 — sale_day_of ist die eine Ableitung", () => {
  const fn = code(latestFunction("sale_day_of").body);

  it("ist genau der `case`, den `seller_sales` seit 0059 im Rumpf trug", () => {
    expect(fn).toContain("case when p_order_id is null then p_sold_at");
    expect(fn).toContain("select o.paid_at::date from public.orders o where o.id = p_order_id");
  });

  it("ist niemandem direkt zugänglich", () => {
    expect(exec).toMatch(
      /revoke all on function public\.sale_day_of\(bigint, date\) from public, anon, authenticated;/);
    expect(exec).not.toMatch(/grant[^;]*sale_day_of/);
  });

  it("und ist die einzige Stelle, die den Tag ableitet", () => {
    /*
     * Zwei Stellen mit demselben `case` wären zwei Meinungen über denselben
     * Tag. Nach 0113 steht er einmal in `sale_day_of` — Trigger, Backfill und
     * Nachbedingung RUFEN ihn, und `seller_sales` liest nur noch die Spalte.
     */
    const sales = code(latestFunction("seller_sales").body);
    expect(sales).toContain("s.sale_day as effective_date");
    expect(sales).not.toContain("o.paid_at::date");
    expect([...exec.matchAll(/public\.sale_day_of\(/g)].length).toBeGreaterThanOrEqual(4);
  });
});

// ---------------------------------------------------------------------------
// 3. Der Backfill
// ---------------------------------------------------------------------------

describe("0113 — der Backfill ist deterministisch und läuft vor den Triggern", () => {
  it("steht VOR der Trigger-Erzeugung", () => {
    /*
     * DIE EINE REIHENFOLGE, DIE NICHT VERTAUSCHT WERDEN DARF.
     *
     * Liefe der Zuweisungstrigger schon, bekäme jede Zeile ihren Platz in
     * der Reihenfolge, in der PostgreSQL sie zufällig aktualisiert — zwei
     * Umgebungen hätten für dieselben Daten verschiedene Tagesreihenfolgen.
     */
    const backfill = exec.indexOf("row_number() over (partition by s.sale_day");
    const trigger = exec.indexOf("create trigger sales_set_day_and_index_trg");
    expect(backfill).toBeGreaterThan(-1);
    expect(trigger).toBeGreaterThan(-1);
    expect(backfill).toBeLessThan(trigger);
  });

  it("der Tie-Breaker ist `id` und nichts anderes (D-2)", () => {
    expect(exec).toContain("row_number() over (partition by s.sale_day order by s.id)");
    /* Nicht `created_at`: zwei importierte Zeilen derselben Arbeitsmappe
       tragen denselben Zeitstempel, und dann wäre es wieder offen. */
    const backfill = exec.slice(exec.indexOf("update public.sales s\n   set sale_day"),
                                exec.indexOf("create or replace function public.sales_set_day_and_index"));
    expect(backfill).not.toContain("created_at");
    /* Und ein Backfill ist keine Korrektur des Betreibers. */
    expect(backfill).not.toContain("updated_at");
    expect(backfill).not.toContain("updated_by");
  });

  it("vergibt nur, was noch keinen Platz hat", () => {
    expect(exec).toContain("where s.sale_day is not null and s.daily_index is null");
    /* Ein zweites Anwenden darf eine von Hand getauschte Reihenfolge nicht
       platt machen. */
    expect(raw).toContain("Ein zweites Anwenden findet nichts");
  });

  it("und ein Verkauf ohne Tag trägt keinen Platz", () => {
    expect(exec).toContain("update public.sales set daily_index = null\n where sale_day is null");
  });
});

// ---------------------------------------------------------------------------
// 4. Der Trigger
// ---------------------------------------------------------------------------

describe("0113 — Tag und Platz halten sich selbst in Ordnung", () => {
  const fn = code(latestFunction("sales_set_day_and_index").body);

  it("leitet den Tag immer selbst ab und übernimmt ihn nie vom Aufrufer", () => {
    expect(fn).toContain("v_day := public.sale_day_of(new.order_id, new.sold_at);");
    expect(fn).toContain("new.sale_day := v_day;");
    /* Die Zuweisung steht VOR jeder Entscheidung über den Platz. */
    expect(fn.indexOf("new.sale_day := v_day")).toBeLessThan(fn.indexOf("new.daily_index"));
  });

  it("kein Tag heißt kein Platz", () => {
    const branch = fn.slice(fn.indexOf("if v_day is null then"));
    expect(branch.slice(0, branch.indexOf("end if"))).toContain("new.daily_index := null;");
  });

  /*
   * DIE TÜR FÜR DEN TAUSCH — UND DER GRUND, WARUM EIN GEWÖHNLICHES UPDATE
   * DIE REIHENFOLGE NICHT DURCHEINANDERBRINGT.
   */
  it("lässt einen gegebenen Platz am unveränderten Tag stehen", () => {
    expect(fn).toContain("old.sale_day is not distinct from v_day");
    expect(fn).toContain("new.daily_index is not null");
    const door = fn.indexOf("old.sale_day is not distinct from v_day");
    expect(door).toBeLessThan(fn.indexOf("pg_advisory_xact_lock"));
  });

  it("stellt sonst hinten an — unter einer Sperre je Tag", () => {
    expect(fn).toContain("pg_advisory_xact_lock(hashtext('sales_daily_index:' || v_day::text)::bigint)");
    expect(fn).toContain("select coalesce(max(s.daily_index), 0) + 1 into v_next");
    /* Die Sperre liegt VOR dem Lesen des Maximums, sonst lesen zwei
       gleichzeitige Verkäufe dieselbe Zahl. */
    expect(fn.indexOf("pg_advisory_xact_lock")).toBeLessThan(fn.indexOf("max(s.daily_index)"));
    /* Und ein geparkter Negativwert ist kein belegter Platz. */
    expect(fn).toContain("s.daily_index > 0");
  });

  it("und die Zahlung einer Bestellung stößt ihren Verkauf an", () => {
    const orders = code(latestFunction("orders_restate_sale_day").body);
    expect(orders).toContain("if new.paid_at is not distinct from old.paid_at then");
    expect(orders).toContain("update public.sales set sale_day = new.paid_at::date where order_id = new.id");
    /* Mehr tut sie nicht: den Tag leitet der BEFORE-Trigger ohnehin selbst ab. */
    expect(orders).not.toContain("daily_index");
  });
});

// ---------------------------------------------------------------------------
// 5. Der Tausch
// ---------------------------------------------------------------------------

describe("0113 — seller_swap_sale_daily_index", () => {
  const fn = code(latestFunction("seller_swap_sale_daily_index").body);

  it("ist gesperrt, definer und mit gesetztem search_path", () => {
    expect(fn).toContain("security definer");
    expect(fn).toMatch(/set search_path = ''/);
    expect(fn.indexOf("can_operate_active_seller")).toBeLessThan(fn.indexOf("from public.sales"));
    expect(fn).toContain("insufficient_privilege");
  });

  it("nur `authenticated` darf ihn rufen — `anon` nie", () => {
    expect(exec).toMatch(
      /revoke all on function public\.seller_swap_sale_daily_index\(bigint, integer\) from public, anon;/);
    expect(exec).toMatch(
      /grant execute on function public\.seller_swap_sale_daily_index\(bigint, integer\) to authenticated;/);
    expect(exec).not.toMatch(/grant[^;]*seller_swap_sale_daily_index[^;]*anon/);
  });

  it("weist ab, was es abweisen muss", () => {
    for (const refusal of ["a place in a day starts at one",
                           "no such sale",
                           "a sale without a day has no place to swap",
                           "no sale holds that place in the day",
                           "this sale changed its day concurrently"]) {
      expect(fn, refusal).toContain(refusal);
    }
  });

  it("die Tagessperre liegt vor dem ersten `for update`", () => {
    /*
     * Zwei gleichzeitige Tauschvorgänge am selben Tag, die ihre Zeilen in
     * verschiedener Reihenfolge sperren, verklemmen sich. Dieselbe Sperre,
     * die der Zuweisungstrigger nimmt, macht aus beiden eine Schlange.
     */
    const lock = fn.indexOf("pg_advisory_xact_lock");
    expect(lock).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(fn.indexOf("for update"));
    expect(fn).toContain("hashtext('sales_daily_index:' || v_day::text)::bigint");
  });

  it("tauscht in drei Anweisungen, mit einem negativen Parkplatz", () => {
    const swap = fn.slice(fn.indexOf("v_from := v_a.daily_index;"));
    const writes = [...swap.matchAll(/update public\.sales set daily_index = ([^\s]+)/g)]
      .map((m) => m[1]);
    expect(writes).toEqual(["-p_with_index", "v_from,", "p_with_index,"]);
    /* Der Parkplatz ist negativ, also kollidiert er mit keinem echten Platz. */
    expect(raw).toContain("DER PARKPLATZ IST `-p_with_index`");
  });

  it("schon dort ist kein Fehler und kein Schreibvorgang", () => {
    const already = fn.slice(fn.indexOf("if v_a.daily_index = p_with_index then"));
    const branch = already.slice(0, already.indexOf("end if"));
    expect(branch).toContain("'moved', false");
    expect(branch).not.toContain("update");
  });

  it("und schreibt die Prüfspur mit", () => {
    expect(fn).toContain("updated_by = (select auth.uid())");
  });
});

// ---------------------------------------------------------------------------
// 6. Die Reihenfolge und der Wiederholungskäufer
// ---------------------------------------------------------------------------

describe("0113 — seller_sales ordnet nach dem Platz und beantwortet die Wiederkehr", () => {
  const fn = code(latestFunction("seller_sales").body);

  it("höchster Platz oben (D-1), undatiert unten, `id` als letzter Ausweg", () => {
    expect(fn).toContain("order by m.effective_date desc nulls last,\n"
      + "               m.daily_index desc nulls last,\n"
      + "               m.id desc");
  });

  it("liefert Platz, Anzeigename und Wiederkehr mit", () => {
    expect(fn).toContain("'daily_index', m.daily_index");
    expect(fn).toContain("'buyer_label', m.buyer_label");
    expect(fn).toContain("'buyer_repeat', m.buyer_repeat");
    /* `buyer_ref` bleibt unverändert daneben — zwei Bedeutungen in einem
       Feld wären der Anfang vom Ende beider. */
    expect(fn).toContain("'buyer_ref', m.buyer_ref");
  });

  /*
   * DER SCHLÜSSEL IST DIE GANZE ENTSCHEIDUNG (B).
   *
   * Eng und ausdrücklich: Konto-ID für eine Bestellung, Quelle PLUS
   * Benutzername für einen externen Verkauf. Jede Lockerung hier verknüpft
   * zwei Menschen, die nichts miteinander zu tun haben.
   */
  it("intern ausschließlich über die SkyIsles-Konto-ID", () => {
    const buyers = fn.slice(fn.indexOf("buyers as ("), fn.indexOf("repeats as ("));
    expect(buyers).toContain("'skyisles:' || b.buyer_user_id::text");
    expect(buyers).toContain("when b.buyer_user_id is null then null");
    /* Kein Name, keine E-Mail, keine Adresse — und auch nicht der
       Anzeigename, der direkt daneben steht. */
    for (const forbidden of ["first_name", "last_name", "email", "buyer_label",
                             "street", "postal_code", "city"]) {
      expect(buyers, forbidden).not.toContain(forbidden);
    }
  });

  it("extern über Quelle UND Benutzername, roh verglichen nach Groß-/Kleinschreibung", () => {
    const buyers = fn.slice(fn.indexOf("buyers as ("), fn.indexOf("repeats as ("));
    expect(buyers).toContain("b.channel || ':' || lower(btrim(b.buyer_ref))");
    /* `manual:` ist damit mitgedeckt (B-4): `channel` IST 'manual'. */
    expect(buyers).toContain("when nullif(btrim(coalesce(b.buyer_ref, '')), '') is null then null");
    /* Und zwei Quellen werden nie verknüpft (B-3). */
    expect(buyers).not.toMatch(/union|or b\.channel =/);
  });

  it("storniert und Test zählen nicht — in keiner Richtung (B-2, B-3)", () => {
    const buyers = fn.slice(fn.indexOf("buyers as ("), fn.indexOf("repeats as ("));
    expect(buyers).toContain("where b.cancelled_at is null");
    expect(buyers).toContain("and not b.classified_test");
  });

  it("die Wiederkehr entscheidet sich an (sale_day, daily_index, id)", () => {
    const repeats = fn.slice(fn.indexOf("repeats as ("), fn.indexOf("marked as ("));
    expect(repeats).toContain("row_number() over (partition by b.buyer_key");
    expect(repeats).toContain("order by b.sale_day asc nulls first");
    expect(repeats).toContain("b.daily_index asc nulls first");
    expect(repeats).toContain("b.id asc) > 1 as buyer_repeat");
    /* Ein nicht zuordenbarer Käufer fällt heraus statt „neu" zu heißen. */
    expect(repeats).toContain("where b.buyer_key is not null");
  });

  it("und das Fenster läuft über ALLE Verkäufe, nicht über die Seite", () => {
    /*
     * Der erste Kauf im Januar macht den im Oktober zum Wiederholungskauf,
     * auch wenn nur Oktober angezeigt wird. `buyers` liest deshalb `base`
     * und nicht `filtered`, `searched` oder `matched`.
     */
    const buyers = fn.slice(fn.indexOf("buyers as ("), fn.indexOf("repeats as ("));
    expect(buyers).toContain("from base b");
    for (const late of ["filtered", "searched", "matched", "hits"]) {
      expect(buyers, late).not.toContain(late);
    }
  });

  it("der Anzeigename ist intern die eingefrorene Lieferadresse (B-1)", () => {
    expect(fn).toContain("then nullif(btrim(coalesce(a.first_name, '') || ' '");
    expect(fn).toContain("|| coalesce(a.last_name, '')), '')");
    expect(fn).toContain("else nullif(btrim(coalesce(s.buyer_ref, '')), '')");
    /* Und er ist auffindbar — die Zeile war über ihren Käufer nicht zu suchen. */
    expect(fn).toContain("coalesce(h.buyer_label, '')   ilike '%'||v_q||'%'");
  });

  /*
   * UND ALLES ANDERE IST UNVERÄNDERT.
   *
   * Diese Funktion trägt jede Zählung und jede Geldableitung des
   * Verkaufsbuchs. Ein Umbau an `is_open` oder an `outbooked_count` wäre eine
   * Regression, die kein anderer Test dieser Datei bemerkt — also wird gegen
   * `0075` verglichen, Ausdruck für Ausdruck.
   */
  it("Zählungen, Offen-Regel und Summen stehen Zeichen für Zeichen wie in 0075", () => {
    const old = code(
      (() => {
        const sql = migrationSource("0075_sales_returns_in_the_counts.sql");
        const at = sql.indexOf("create or replace function public.seller_sales(");
        return sql.slice(at, sql.indexOf("\n$$;", at));
      })());
    const between = (body: string, from: string, to: string) =>
      body.slice(body.indexOf(from), body.indexOf(to)).replace(/\s+/g, " ").trim();

    for (const [from, to] of [
      ["(b.cancelled_at is null", "as is_open"],
      ["(select count(*) from public.sale_items i\n             where i.sale_id = b.id\n               and i.movement_id is not null", "as closed_count"],
      ["jsonb_build_object(\n      'sale_count'", "as page_summary"],
      ["counts as (", "select page.page_rows"],
    ] as const) {
      expect(between(fn, from, to), from.slice(0, 30)).toBe(between(old, from, to));
    }
  });
});

describe("0113 — seller_sale nennt den Tag als Liste", () => {
  const fn = code(latestFunction("seller_sale").body);

  it("liefert Anzeigename, Tagesanzahl und die belegten Plätze", () => {
    expect(fn).toContain("'buyer_label', case when v_sale.order_id is not null");
    expect(fn).toContain("'daily_index_count', case when v_sale.sale_day is null then 0");
    expect(fn).toContain("'day_order', case when v_sale.sale_day is null then '[]'::jsonb");
    expect(fn).toContain("order by d.daily_index desc");
    /* Lücken bleiben sichtbar: die Liste nennt die belegten Plätze, statt
       1…n zu behaupten. */
    expect(fn).toContain("d.daily_index is not null");
  });

  it("und `sale_day`/`daily_index` kommen ohne Zutun mit", () => {
    /* `to_jsonb(v_sale)` liefert jede Spalte der Zeile — die zwei neuen also
       auch, ohne dass sie hier aufgezählt werden müssten. */
    expect(fn).toContain("'sale', to_jsonb(v_sale)");
  });
});

// ---------------------------------------------------------------------------
// 7. Die Nachbedingungen
// ---------------------------------------------------------------------------

describe("0113 prüft sich selbst nach", () => {
  const after = exec.slice(exec.lastIndexOf("do $$"));

  it("Spalten, Teilindex, Trigger und Tauschfunktion", () => {
    for (const needed of ["sales.sale_day fehlt", "sales.daily_index fehlt",
                          "sales_daily_index_uniq ist nicht als Teilindex eindeutig",
                          "sales_set_day_and_index_trg", "orders_restate_sale_day_trg",
                          "seller_swap_sale_daily_index"]) {
      expect(after, needed).toContain(needed);
    }
  });

  it("die Spalte sagt nichts anderes als die Ableitung", () => {
    expect(after).toContain(
      "where s.sale_day is distinct from public.sale_day_of(s.order_id, s.sold_at)");
  });

  it("kein Tag ohne Platz, kein Platz ohne Tag, kein geparkter Wert liegengeblieben", () => {
    expect(after).toContain("where (s.sale_day is null) <> (s.daily_index is null)");
    expect(after).toContain("where daily_index <= 0");
  });

  it("und jeder Tag trägt nach dem Backfill genau 1..n", () => {
    expect(after).toContain("having min(s.daily_index) <> 1 or max(s.daily_index) <> count(*)");
  });
});

// ---------------------------------------------------------------------------
// 8. Die eine echte Ableitung auf der Clientseite
// ---------------------------------------------------------------------------

describe("sortSales ordnet nach Tag, dann Platz, dann id", () => {
  type Row = { id: number; soldAt: string | null; dailyIndex: number | null };
  const ids = (rows: readonly Row[]) => sortSales(rows).map((r) => r.id);

  it("neuester Tag oben", () => {
    expect(ids([
      { id: 1, soldAt: "2026-10-01", dailyIndex: 1 },
      { id: 2, soldAt: "2026-10-07", dailyIndex: 1 },
    ])).toEqual([2, 1]);
  });

  it("am selben Tag entscheidet der höchste Platz (D-1) — nicht die id", () => {
    /*
     * GENAU DER FEHLER, DEN 0113 BEHEBT. Vorher stand hier `[7, 3]`: der
     * später angelegte Verkauf oben, obwohl der Betrieb ihn an Platz 1
     * gestellt hat.
     */
    expect(ids([
      { id: 3, soldAt: "2026-10-07", dailyIndex: 2 },
      { id: 7, soldAt: "2026-10-07", dailyIndex: 1 },
    ])).toEqual([3, 7]);
  });

  it("undatiert steht unten, und zwei davon nach id", () => {
    expect(ids([
      { id: 4, soldAt: null, dailyIndex: null },
      { id: 9, soldAt: "2026-01-02", dailyIndex: 1 },
      { id: 5, soldAt: null, dailyIndex: null },
    ])).toEqual([9, 5, 4]);
  });

  it("ein fehlender Platz steht hinter einem vorhandenen desselben Tages", () => {
    expect(ids([
      { id: 1, soldAt: "2026-10-07", dailyIndex: null },
      { id: 2, soldAt: "2026-10-07", dailyIndex: 1 },
    ])).toEqual([2, 1]);
  });

  it("und die Reihenfolge ist stabil, egal wie die Eingabe aussieht", () => {
    const rows: Row[] = [
      { id: 11, soldAt: "2026-10-07", dailyIndex: 1 },
      { id: 12, soldAt: "2026-10-07", dailyIndex: 3 },
      { id: 13, soldAt: "2026-10-07", dailyIndex: 2 },
      { id: 14, soldAt: "2026-10-06", dailyIndex: 1 },
    ];
    expect(ids(rows)).toEqual([12, 13, 11, 14]);
    expect(ids([...rows].reverse())).toEqual([12, 13, 11, 14]);
  });
});

// ---------------------------------------------------------------------------
// 9. Der Weg bis auf den Bildschirm
// ---------------------------------------------------------------------------

describe("das Lesemodell nimmt die drei neuen Tatsachen mit", () => {
  it("und rechnet keine davon nach", () => {
    expect(QUERIES).toContain("dailyIndex: maybe(r.daily_index),");
    expect(QUERIES).toContain("buyerLabel: (r.buyer_label as string) ?? null,");
    expect(QUERIES).toContain("buyerRepeat: r.buyer_repeat === true,");
    /* `buyerRepeat` hängt an einem Fenster über ALLE Verkäufe; die Seite
       kennt nur ihre eigene Auswahl und könnte es nicht herleiten. */
    expect(QUERIES).not.toMatch(/buyerRepeat:\s*(sales|rows)\./);
  });
});

describe("der Wiederholungskäufer steht grün in der Zeile — und nicht nur grün", () => {
  it("Farbe, Zeichen und ganzer Satz", () => {
    const row = LEDGER.slice(LEDGER.indexOf("<LedgerRow "), LEDGER.indexOf("</LedgerRow>"));
    expect(row).toContain("sale.buyerRepeat ? \"font-medium text-success\" : \"text-muted\"");
    /* Ohne Farbe lesbar: eigenes Zeichen mit eigenem zugänglichen Namen. */
    expect(row).toContain("aria-label={copy.repeatBuyer}");
    expect(row).toContain("↻");
    expect(row).toContain("copy.repeatBuyerHint");
    expect(row).toContain("{sale.buyerLabel ?? \"—\"}");
  });

  it("die Zeile entscheidet es nicht selbst", () => {
    expect(LEDGER).not.toMatch(/buyerRepeat\s*=/);
    expect(LEDGER).not.toContain("buyer_key");
  });

  it("und die Wörter stehen in de.ts", () => {
    expect(copy.repeatBuyer).toBe("Wiederholungskäufer");
    expect(copy.repeatBuyerHint).toContain("schon einmal gekauft");
  });
});

describe("der Platz am Tag wird im Verkaufsfenster angezeigt und getauscht", () => {
  it("die Zeile steht immer, sobald es einen Tag gibt", () => {
    expect(DETAILS).toContain("label={modal.dailyIndex}");
    expect(DETAILS).toContain("modal.dailyIndexNone");
    expect(DETAILS).toContain("modal.dailyIndexAlone");
    expect(DETAILS).toContain("modal.dailyIndexOf(sale.dailyIndex, dayCount)");
  });

  it("getauscht wird nur, wo es einen Partner gibt — und nie mit sich selbst", () => {
    expect(DETAILS).toContain("sale.dailyIndex !== null && dayOrder.length > 1");
    expect(DETAILS).toContain("dayOrder.filter((row) => row.id !== sale.id)");
    expect(DETAILS).toContain("swapSaleDailyIndex");
  });

  it("die Liste kommt aus der Datenbank und wird nicht erschlossen", () => {
    expect(DETAILS).toContain("loaded?.day_order");
    /* Kein `Array.from({length: n})`: eine Lücke — ein Verkauf, der seinen
       Tag gewechselt hat — soll sichtbar sein. */
    expect(DETAILS).not.toContain("Array.from({ length");
  });

  it("das Wort ist tauschen und nicht verschieben", () => {
    expect(modal.swapPlace).toBe("Platz tauschen mit");
    expect(modal.swapPlaceHint).toContain("getauscht, nicht verschoben");
    expect(modal.dailyIndexOf(2, 3)).toBe("2 von 3");
    expect(modal.swapPlaceDone(2)).toContain("Platz 2");
  });

  it("und der Käufername steht jetzt auch bei einer Bestellung (B-1)", () => {
    expect(DETAILS).toContain("{sale.buyerLabel ? (");
    expect(DETAILS).toContain("value={sale.buyerLabel}");
    expect(DETAILS).toContain("hint={sale.buyerRepeat ? copy.repeatBuyer : null}");
  });
});

describe("die Ablehnungen des Tauschs haben jede einen Satz", () => {
  it("und keine wirft dem Betreiber einen Fehler vor, den er nicht gemacht hat", () => {
    expect(ACTIONS).toContain('text.includes("without a day has no place")');
    expect(ACTIONS).toContain('text.includes("no sale holds that place")');
    expect(ACTIONS).toContain('text.includes("changed its day concurrently")');
    expect(copy.errors.undatedHasNoPlace).toContain("Verkaufsdatum");
    expect(copy.errors.placeGone).toContain("neu laden");
  });

  it("die Action schickt nur die zwei Angaben und rechnet nichts nach", () => {
    const at = ACTIONS.indexOf("export async function swapSaleDailyIndex");
    const body = ACTIONS.slice(at, ACTIONS.indexOf("\n}", at));
    expect(body).toContain('supabase.rpc("seller_swap_sale_daily_index", {');
    expect(body).toContain("p_id: id, p_with_index: withIndex,");
    expect(body.indexOf("canOperateSeller")).toBeLessThan(body.indexOf("supabase.rpc"));
    expect(body).not.toContain("sort");
  });
});
