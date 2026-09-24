/**
 * WAS 0095 DER DATENBANK BEIBRINGT — UND WAS ES IHR NICHT ERLAUBT.
 *
 * Die Migration ist der Ort, an dem „kann nicht geliefert werden" und „liegt
 * wieder im Lager" auseinandergehalten werden. Diese Datei hält das fest:
 * gegen den Migrationstext, weil hier keine Datenbank läuft, und gegen die
 * reine Logik daneben, damit beide dasselbe rechnen.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { code, latestFunction, migrationSource } from "@/test-support/migrations";
import { lineQuantities, resolveStockOutcome } from "./order-lines.ts";

const SQL = migrationSource("0095_order_cancellation_and_returns.sql");
const CANCEL = code(latestFunction("seller_cancel_order_line").body);
const RETURN = code(latestFunction("seller_receive_order_return").body);
const SHIP = code(latestFunction("admin_mark_order_shipped").body);
const REFUND = code(latestFunction("seller_record_refund").body);
const TRIGGER = code(latestFunction("orders_protect_fulfillment").body);
const CONTEXT = code(latestFunction("order_withdrawal_context").body);
const QUANTITIES = code(latestFunction("order_line_quantities").body);

describe("the ledger of line events", () => {
  it("is append-only in shape: no quantity is ever stored on the line", () => {
    expect(SQL).toContain("create table if not exists public.order_line_events");
    // Keine Zaehlerspalte auf order_lines, nirgends.
    expect(SQL).not.toMatch(/alter table public\.order_lines[\s\S]{0,200}add column/);
    expect(SQL).not.toContain("cancelled_quantity");
    expect(SQL).not.toContain("returned_quantity");
  });

  it("knows two kinds and three stock outcomes, and nothing else", () => {
    expect(SQL).toContain("check (kind in ('cancelled', 'returned'))");
    expect(SQL).toContain("check (stock_outcome in ('restocked', 'shortfall', 'none'))");
  });

  it("makes the business rules constraints, not comments", () => {
    // Eine Retoure ist immer ein echter Wareneingang.
    expect(SQL).toContain("check (kind <> 'returned' or stock_outcome = 'restocked')");
    // Jeder Ausgang hat genau die Bewegungen, die er haben muss.
    expect(SQL).toContain("(stock_outcome = 'restocked'\n         and movement_id is not null and correction_movement_id is null)");
    expect(SQL).toContain("(stock_outcome = 'shortfall'\n         and movement_id is not null and correction_movement_id is not null)");
    expect(SQL).toContain("(stock_outcome = 'none'\n         and movement_id is null and correction_movement_id is null)");
  });

  it("lets one movement belong to one event only", () => {
    expect(SQL).toContain("constraint order_line_events_movement_unique unique (movement_id)");
    expect(SQL).toContain("constraint order_line_events_correction_unique unique (correction_movement_id)");
  });

  it("is closed to every client role", () => {
    expect(SQL).toContain("alter table public.order_line_events enable row level security");
    expect(SQL).toContain("revoke all on public.order_line_events from public, anon, authenticated");
  });
});

describe("cancelling a quantity of a line", () => {
  it("is the seller's act, through the canonical stock path", () => {
    expect(CANCEL).toContain("if not public.can_operate_active_seller() then");
    expect(latestFunction("seller_cancel_order_line").body).toContain("security definer");
    expect(latestFunction("seller_cancel_order_line").body).toContain("set search_path = ''");
    // Nie direkt am Bestand.
    expect(CANCEL).not.toContain("update public.shop_inventory");
    expect(CANCEL).toContain("public.apply_inventory_movement(");
  });

  it("asks the operator one question and decides the outcome itself", () => {
    // Der Client sagt 'present' oder 'missing' — mehr nicht.
    expect(CANCEL).toContain("p_stock_presence not in ('present', 'missing')");
    // 'none' kommt aus der technischen Tatsache, nicht aus der Antwort.
    expect(CANCEL).toContain("when not v_booked then 'none'");
    expect(CANCEL).toContain("when p_stock_presence = 'present' then 'restocked'");
    expect(CANCEL).toContain("else 'shortfall'");
    // Und diese Tatsache ist die Sale-Bewegung der Reservierung.
    expect(CANCEL).toContain("and r.movement_id is not null");
  });

  it("books nothing at all when the position never left stock", () => {
    expect(CANCEL).toContain("if v_outcome <> 'none' then");
  });

  it("books two movements for a shortfall, net zero", () => {
    expect(CANCEL).toContain("p_quantity, 'return'");
    expect(CANCEL).toContain("-p_quantity, 'correction'");
    expect(CANCEL).toContain("if v_outcome = 'shortfall' then");
    // Beide im selben RPC, also in derselben Transaktion: das Ereignis wird
    // erst danach geschrieben und existiert bei einem Fehlschlag nicht.
    expect(CANCEL.indexOf("insert into public.order_line_events"))
      .toBeGreaterThan(CANCEL.indexOf("-p_quantity, 'correction'"));
  });

  it("checks the open quantity under the line lock", () => {
    expect(CANCEL).toContain("for update");
    expect(CANCEL).toContain("select q.cancellable into v_open");
    expect(CANCEL).toContain("if p_quantity > v_open then");
  });

  it("refuses a shipped order — that is a return, not a cancellation", () => {
    expect(CANCEL).toContain("if v_order.fulfillment_status <> 'unfulfilled' then");
  });

  it("cancels the whole order only when nothing is left to deliver", () => {
    expect(CANCEL).toContain("v_remaining := public.order_fulfillable_total(v_order.id)");
    expect(CANCEL).toContain("if v_remaining = 0 and v_order.fulfillment_status = 'unfulfilled' then");
    expect(CANCEL).toContain("set fulfillment_status = 'cancelled'");
    // payment_status wird NICHT angefasst: eine bezahlte Bestellung bleibt
    // bezahlt, bis Geld zurueckgeht (und paid_at haengt am CHECK).
    expect(CANCEL).not.toContain("payment_status =");
  });

  it("stays inside its own world and out of the sandbox path", () => {
    expect(CANCEL).toContain("v_order.commerce_mode is distinct from public.commerce_mode()");
    expect(CANCEL).toContain("e.event_type = 'sandbox_stock_reverted'");
  });
});

describe("receiving a return", () => {
  it("books one movement through the canonical path", () => {
    expect(RETURN).toContain("p_quantity, 'return'");
    expect(RETURN).not.toContain("'correction'");
    expect(RETURN).not.toContain("update public.shop_inventory");
    expect(RETURN).toContain("'returned', p_quantity, 'restocked'");
  });

  it("only from a shipped order, and only what actually went out", () => {
    expect(RETURN).toContain("if v_order.fulfillment_status <> 'shipped' then");
    expect(RETURN).toContain("this position never left stock; there is nothing to book back");
  });

  it("allows a partial return and refuses more than is out", () => {
    expect(RETURN).toContain("select q.returnable into v_open");
    expect(RETURN).toContain("if p_quantity > v_open then");
    expect(RETURN).toContain("for update");
  });
});

describe("the fulfillment trigger", () => {
  it("gains exactly one transition", () => {
    expect(TRIGGER).toContain("old.fulfillment_status = 'unfulfilled' and new.fulfillment_status = 'shipped'");
    expect(TRIGGER).toContain("old.fulfillment_status = 'shipped' and new.fulfillment_status = 'unfulfilled'");
    expect(TRIGGER).toContain("old.fulfillment_status = 'unfulfilled' and new.fulfillment_status = 'cancelled'");
    // Und keine weitere: versendet wird nicht storniert, storniert ist terminal.
    expect(TRIGGER).not.toContain("'shipped' and new.fulfillment_status = 'cancelled'");
    expect(TRIGGER).not.toContain("old.fulfillment_status = 'cancelled'");
  });

  it("still takes shipped_at from the server clock", () => {
    expect(TRIGGER).toContain("new.shipped_at := now();");
    expect(TRIGGER).toContain("new.shipped_at := old.shipped_at;");
  });
});

describe("when an order may be shipped", () => {
  it("a withdrawal blocks it, in the database", () => {
    expect(SHIP).toContain("from public.withdrawal_requests w where w.order_id = v_order.id");
    expect(SHIP).toContain("resolve the withdrawal before shipping");
  });

  it("an order with nothing left blocks it", () => {
    expect(SHIP).toContain("if public.order_fulfillable_total(v_order.id) = 0 then");
  });

  /**
   * DER ALLTAGSFALL WÜRDE SONST AN DER ERSTATTUNG SCHEITERN.
   *
   * Acht Figuren, eine storniert, 3,49 € erstattet — und danach müssen die
   * sieben anderen raus. Mit `<> 'paid'` wäre die Bestellung ab der
   * Erstattung nicht mehr versandfähig gewesen.
   */
  it("a partially refunded order may still be shipped", () => {
    expect(SHIP).toContain("v_order.payment_status not in ('paid', 'partially_refunded')");
    // Vollständig erstattet heißt: es geht nichts mehr raus.
    expect(SHIP).not.toContain("'refunded'");
  });

  it("a partial cancellation does NOT block it", () => {
    // Es gibt keine Bedingung auf die blosse Existenz eines Storno-Ereignisses.
    expect(SHIP).not.toContain("order_line_events");
    // Und die Logik daneben sagt dasselbe.
    expect(lineQuantities(8, [{ kind: "cancelled", quantity: 1 }]).fulfillable).toBe(7);
  });
});

describe("a refund may say what it was for", () => {
  it("keeps its old signature working", () => {
    // Der neue Parameter hat einen Default; jeder bestehende Aufruf bleibt gueltig.
    expect(latestFunction("seller_record_refund").body)
      .toContain("p_allocations jsonb default null");
  });

  /**
   * DIE FALLE, IN DIE 0095 BEIM ERSTEN LAUF GETRETEN IST.
   *
   * `create or replace` ersetzt nur bei gleicher Argumentliste. Ein Parameter
   * mehr erzeugt eine ÜBERLADUNG — und dann kann PostgREST einen Aufruf mit
   * den alten Parametern nicht mehr zuordnen (`PGRST203`), was den ganzen
   * Weg lahmlegt. Wer eine Signatur erweitert, muss die alte fallen lassen.
   */
  it("drops the old overload instead of standing beside it", () => {
    expect(SQL).toContain(
      "drop function if exists public.seller_record_refund(text, numeric, text, bigint, text);");
    expect(SQL.indexOf("drop function if exists public.seller_record_refund"))
      .toBeLessThan(SQL.indexOf("create or replace function public.seller_record_refund"));
  });

  it("and nothing else in this migration changed an argument list", () => {
    /*
     * Jede andere hier neu geschriebene Funktion behaelt ihre Signatur, also
     * reicht `create or replace`. Faellt das eines Tages, faellt es hier auf.
     */
    for (const [name, args] of [
      ["admin_mark_order_shipped", "p_order_number    text,"],
      ["admin_order", "(p_order_number text)"],
      ["orders_protect_fulfillment", "()"],
    ] as const) {
      expect(SQL, name).toContain(`create or replace function public.${name}${args.startsWith("(") ? args : "(\n  " + args}`);
    }
  });

  it("refuses parts that do not add up, before writing anything", () => {
    expect(REFUND).toContain("if round(v_sum, 2) <> round(p_amount, 2) then");
    expect(REFUND.indexOf("if round(v_sum, 2)"))
      .toBeLessThan(REFUND.indexOf("insert into public.order_refunds"));
  });

  it("refuses an allocation for a position of another order", () => {
    expect(REFUND).toContain("where l.id = v_line and l.order_id = v_order.id");
  });

  it("still moves no money and no stock", () => {
    expect(REFUND).not.toContain("apply_inventory_movement");
    expect(REFUND).not.toContain("shop_inventory");
    expect(REFUND).not.toContain("stripe");
  });

  it("the allocation table allows the five shapes the operator needs", () => {
    expect(SQL).toContain("check (allocation_type in ('line', 'shipping', 'goodwill', 'other'))");
    expect(SQL).toContain("check ((allocation_type = 'line') = (order_line_id is not null))");
    expect(SQL).toContain("on delete cascade");
  });
});

describe("the authorised order context", () => {
  it("is gated the same way the withdrawal state is", () => {
    expect(CONTEXT).toContain("public.authorize_order_payment(v_order.id, (select auth.uid()), p_token)");
    expect(CONTEXT).toContain("return null;");
  });

  it("takes the name from the order's shipping address, never from the caller", () => {
    expect(CONTEXT).toContain("from public.order_addresses a");
    expect(CONTEXT).toContain("a.kind = 'shipping'");
  });

  it("returns nothing an unauthorised caller could learn", () => {
    expect(latestFunction("order_withdrawal_context").body).toContain("stable");
    expect(SQL).toContain("grant execute on function public.order_withdrawal_context(text, text) to anon, authenticated;");
  });
});

describe("the derived quantities agree on both sides", () => {
  it("SQL and TypeScript compute the same four numbers", () => {
    expect(QUANTITIES).toContain("greatest(0, l.quantity - e.cancelled)");
    expect(QUANTITIES).toContain("greatest(0, l.quantity - e.cancelled - e.returned)");
    const q = lineQuantities(3, [
      { kind: "cancelled", quantity: 1 },
      { kind: "returned", quantity: 1 },
    ]);
    expect(q).toMatchObject({ fulfillable: 2, outstanding: 1, cancellable: 1, returnable: 1 });
  });

  it("the outcome rule is the same one the RPC applies", () => {
    expect(resolveStockOutcome(false, "present")).toBe("none");
    expect(resolveStockOutcome(true, "present")).toBe("restocked");
    expect(resolveStockOutcome(true, "missing")).toBe("shortfall");
  });
});

/**
 * JEDE FUNKTION, DIE 0095 NEU ANLEGT, SAGT AUCH, WER SIE AUFRUFEN DARF.
 *
 * Eine frisch angelegte Funktion hält in PostgreSQL EXECUTE für PUBLIC. Bei
 * den beiden Hilfsfunktionen wäre das heute kein Leck — sie sind `security
 * invoker` und könnten nichts lesen, was der Aufrufer nicht ohnehin darf —,
 * aber die Sicherheit hinge dann an den Rechten einer anderen Tabelle. 0082
 * hat genau diese Lücke schon einmal nachgetragen; hier wird sie nicht erst
 * aufgerissen.
 */
describe("every function 0095 creates names its callers", () => {
  const CREATED = [
    ["order_line_quantities", "bigint"],
    ["order_fulfillable_total", "bigint"],
    ["seller_cancel_order_line", "bigint, integer, text, text"],
    ["seller_receive_order_return", "bigint, integer, text"],
    ["seller_record_refund", "text, numeric, text, bigint, text, jsonb"],
    ["order_withdrawal_context", "text, text"],
  ] as const;

  it.each(CREATED)("%s is revoked before anything is granted", (name, args) => {
    const revoke = SQL.indexOf(`revoke all on function public.${name}(${args})`);
    expect(revoke, `${name}: no revoke`).toBeGreaterThan(-1);
    const grant = SQL.indexOf(`grant execute on function public.${name}(${args})`);
    if (grant > -1) expect(grant).toBeGreaterThan(revoke);
  });

  it("the two helpers are reachable by nobody", () => {
    for (const name of ["order_line_quantities", "order_fulfillable_total"]) {
      expect(SQL, name)
        .toContain(`revoke all on function public.${name}(bigint) from public, anon, authenticated;`);
      expect(SQL, name).not.toContain(`grant execute on function public.${name}`);
    }
  });

  it("and the two that a signed-in operator calls are granted to authenticated only", () => {
    for (const [name, args] of [
      ["seller_cancel_order_line", "bigint, integer, text, text"],
      ["seller_receive_order_return", "bigint, integer, text"],
    ] as const) {
      expect(SQL, name).toContain(`revoke all on function public.${name}(${args})\n  from public, anon;`);
      expect(SQL, name).toContain(`grant execute on function public.${name}(${args})\n  to authenticated;`);
    }
  });
});

describe("the migration changes no data", () => {
  it("writes no row of its own", () => {
    const body = code(SQL);
    // Jedes insert/update steht INNERHALB einer Funktion, keines auf Dateiebene.
    for (const statement of body.split("\n")) {
      const line = statement.trim();
      if (line.startsWith("insert into") || line.startsWith("update public.")) {
        // In den Funktionen ist das erwartet; auf Dateiebene gaebe es kein `v_`.
        expect(body).toContain("create or replace function");
      }
    }
    expect(body).not.toContain("delete from");
    expect(body).not.toContain("truncate");
  });

  it("never touches the legacy history or the inventory journal directly", () => {
    const body = code(SQL);
    expect(body).not.toContain("legacy_stock_events");
    expect(body).not.toMatch(/update public\.inventory_movements/);
    expect(body).not.toMatch(/delete from public\.inventory_movements/);
  });
});

/* ===================================================================== */
/**
 * DIE OBERFLÄCHE, UND WAS SIE NICHT FRAGT.
 *
 * Der Operator beantwortet eine physische Frage. „War nie ausgebucht" steht
 * bewusst nicht zur Wahl — das ist ein technischer Zustand, und ein Mensch,
 * den man danach fragt, kann ihn nur falsch beantworten.
 */
describe("the operator's screen", () => {
  const source = (path: string) => readFileSync(path, "utf8");
  const ACTIONS_UI = source("src/components/admin/order-line-actions.tsx");
  const ACTIONS = source("src/lib/admin/order-line-actions.ts");
  const ORDER_PAGE = source("src/app/(business)/business/orders/[orderNumber]/page.tsx");

  it("asks one question, with two answers and no default", () => {
    expect(ACTIONS_UI).toContain("copy.presenceQuestion");
    expect(ACTIONS_UI).toContain('(["present", "missing"] as const)');
    expect(ACTIONS_UI).toContain("useState<StockPresence | null>(null)");
    /*
     * Keine dritte Antwort: die Auswahl kennt genau zwei Beschriftungen, und
     * „none" kommt im Formular nicht vor. (`mode: … | "none"` ist etwas
     * anderes — das sagt, dass diese Position gar keine Aktion hat.)
     */
    const fieldset = ACTIONS_UI.slice(ACTIONS_UI.indexOf("<fieldset"),
                                      ACTIONS_UI.indexOf("</fieldset>"));
    expect(fieldset).toContain("copy.presentLabel");
    expect(fieldset).toContain("copy.missingLabel");
    expect(fieldset).not.toContain("none");
    // Und der Ausgang wird nirgends im Browser bestimmt.
    expect(ACTIONS_UI).not.toContain("stock_outcome");
    expect(ACTIONS_UI).not.toContain("shortfall");
    expect(ACTIONS_UI).not.toContain("restocked");
  });

  it("refuses to submit a cancellation before that question is answered", () => {
    expect(ACTIONS_UI).toContain('if (mode === "cancel" && presence === null)');
  });

  it("sends only the presence, never an outcome", () => {
    expect(ACTIONS).toContain("p_stock_presence: input.presence");
    expect(ACTIONS).not.toContain("stock_outcome:");
    expect(ACTIONS).toContain('input.presence !== "present" && input.presence !== "missing"');
  });

  it("offers the action the order's state allows, and no other", () => {
    expect(ORDER_PAGE).toContain('order.fulfillment_status === "unfulfilled"');
    expect(ORDER_PAGE).toContain('? "cancel"');
    expect(ORDER_PAGE).toContain('order.fulfillment_status === "shipped" ? "return" : "none"');
  });

  it("shows the withdrawal before the shipping control", () => {
    expect(ORDER_PAGE.indexOf("copy.withdrawalBanner"))
      .toBeLessThan(ORDER_PAGE.indexOf("<ShipOrderForm"));
    expect(ORDER_PAGE).toContain("copy.withdrawalBlocksShipping");
  });

  it("shows what is still owed, from the cancelled quantities", () => {
    /* Seit 0097 eine Quelle statt zweier: `openLineRefunds()` liefert die
       Posten, `openRefundTotal()` ihre Summe. `suggestedRefund()` steckt
       darin und wird von der Seite nicht mehr selbst aufgerufen. */
    expect(ORDER_PAGE).toContain("openLineRefunds(");
    expect(ORDER_PAGE).toContain("openRefundTotal(openLines)");
    expect(ORDER_PAGE).toContain("copy.money.open");
  });

  it("revalidates the shelf as well, because it may have moved", () => {
    expect(ACTIONS).toContain('"/business/inventory"');
  });
});

/* ===================================================================== */
describe("the withdrawal form's order context", () => {
  const source = (path: string) => readFileSync(path, "utf8");
  const CONTEXT_TS = source("src/lib/legal/withdrawal-context.ts");
  const FLOW = source("src/components/legal/withdrawal-flow.tsx");
  const PAGE = source("src/app/(public)/widerrufen/page.tsx");
  const ORDER = source("src/app/(app)/account/orders/[orderNumber]/page.tsx");

  it("takes a pointer from the URL and nothing else", () => {
    expect(ORDER).toContain("?bestellung=${encodeURIComponent(String(order.order_number))}");
    expect(PAGE).toContain("fetchWithdrawalContext(bestellung)");
    /*
     * Aus der Adresse kommt AUSSCHLIESSLICH die Bestellnummer. Name und
     * E-Mail liest der Server aus der Bestellung — ein `?name=` waere ein
     * Feld, das ein Angreifer ausfuellt.
     */
    expect(PAGE).not.toContain("searchParams.name");
    expect(PAGE).not.toContain("searchParams.email");
    const params = PAGE.slice(PAGE.indexOf("searchParams: Promise<"),
                              PAGE.indexOf("}>;"));
    expect(params).toContain("bestellung?: string");
    expect(params).not.toContain("name");
    expect(params).not.toContain("email");
    // Der Kontext-Leser nimmt genau ein Argument entgegen.
    expect(CONTEXT_TS).toContain("async (orderNumber: string | undefined)");
    expect(CONTEXT_TS).toContain("p_token: null");
  });

  it("lets the database decide who may see it", () => {
    expect(CONTEXT_TS).toContain('supabase.rpc("order_withdrawal_context"');
    expect(CONTEXT_TS).toContain("return null;");
  });

  it("keeps the two statutory steps and the guest path", () => {
    expect(FLOW).toContain("context?.orderNumber ?? \"\"");
    expect(FLOW).toContain("context?.customerEmail ?? \"\"");
    expect(FLOW).toContain('const [step, setStep] = useState<Step>("form")');
    expect(FLOW).toContain('setStep("confirm")');
    // Der Gastweg ist genau der Fall `context === null`.
    expect(FLOW).toContain("context = null");
  });
});

/* ===================================================================== */
describe("documenting the repayment", () => {
  const source = (path: string) => readFileSync(path, "utf8");
  const FORM = source("src/components/admin/refund-form.tsx");
  const ACTION = source("src/lib/admin/refund-actions.ts");
  const ORDER_PAGE = source("src/app/(business)/business/orders/[orderNumber]/page.tsx");

  it("still moves no money", () => {
    expect(FORM).not.toContain("stripe");
    expect(ACTION).not.toContain("stripe");
    expect(ACTION).toContain("WHAT THIS DOES NOT DO: move money");
  });

  it("carries the allocation only while the amount is the suggested one", () => {
    /* Seit 0097 ist `target` der Vorschlag PLUS dem angehakten Versand —
       die Aufteilung reist weiterhin nur bei unveraendertem Betrag mit. */
    expect(FORM).toContain("Math.round(value * 100) === Math.round(target * 100)");
    expect(FORM).toContain("allocations");
    // Ein geaenderter Betrag bekommt keine falsche Aufteilung, sondern keine.
    expect(FORM).toContain(": [];");
  });

  it("checks the split before it reaches the database, and again inside it", () => {
    expect(ACTION).toContain("allocationsValid(allocations, input.amount)");
    expect(REFUND).toContain("if round(v_sum, 2) <> round(p_amount, 2) then");
  });

  it("is offered on the order, with the open amount", () => {
    expect(ORDER_PAGE).toContain("<RefundForm");
    /* Seit 0096 heisst der Vorschlag `refundOpen`: `money` ist jetzt die
       Geldaufstellung der Bestellung und hat kein `open` mehr. */
    expect(ORDER_PAGE).toContain("suggested={refundOpen}");
    /* Betrag und Aufteilung stammen aus derselben Liste. */
    expect(ORDER_PAGE).toContain("cancelled={openLines.map(");
  });
});
