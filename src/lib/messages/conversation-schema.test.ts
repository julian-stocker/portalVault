/**
 * Was `0098` zusichert — geprüft am Migrationstext, so wie jede andere
 * Schemazusage in diesem Projekt.
 *
 * Es gibt hier keinen ausführbaren Testlauf gegen Postgres; was die Datenbank
 * garantiert, garantiert sie durch CHECKs, Trigger, Rechte und die Reihenfolge
 * der Anweisungen in den Funktionen. Genau das wird hier festgehalten — vor
 * allem die Stellen, an denen ein späterer Umbau still etwas aufweichen
 * könnte.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SQL = readFileSync("supabase/migrations/0098_order_conversations.sql", "utf8");
const body = (name: string): string => {
  const start = SQL.indexOf(`create or replace function public.${name}(`);
  expect(start, `${name} nicht gefunden`).toBeGreaterThan(-1);
  return SQL.slice(start, SQL.indexOf("\n$$;", start));
};

/*
 * Der Kanal ist ein Gespräch, keine Bestellhistorie. Zwei Ereignisse
 * beantworten je eine Frage, die sonst jemand stellen müsste — der Rest
 * bleibt unverändert in `order_events` und auf dem Bestellschirm.
 */
const SHOWN = ["order_shipped", "refund_recorded"];
const HIDDEN = ["payment_succeeded", "order_line_cancelled", "order_return_received",
                "order_cancelled", "withdrawal_declared",
                "placed", "invoice_issued", "payment_attempt_started", "sandbox_stock_reverted"];

describe("die Tabellen", () => {
  it("lassen als Urheber nur Menschen zu", () => {
    expect(SQL).toContain("check (author_kind in ('customer', 'seller'))");
    expect(SQL).not.toMatch(/author_kind in \([^)]*'system'/);
  });

  it("begrenzen den Text auf der Spalte", () => {
    expect(SQL).toContain("check (length(body) between 1 and 2000)");
  });

  it("halten jeden Clientzugriff fern", () => {
    for (const t of ["order_messages", "order_conversation_reads"]) {
      expect(SQL).toContain(`alter table public.${t} enable row level security;`);
      expect(SQL).toContain(`revoke all on public.${t} from public, anon, authenticated;`);
    }
    expect(SQL).not.toContain("create policy");
  });

  it("hängen an der Bestellung und geben sie nicht her", () => {
    expect(SQL).toMatch(/order_messages_order_fk[\s\S]{0,140}on delete restrict/);
    expect(SQL).toMatch(/order_conversation_reads_order_fk[\s\S]{0,160}on delete restrict/);
    expect(SQL).toMatch(/order_messages_author_fk[\s\S]{0,140}on delete set null/);
  });

  it("führen einen Lesestand je Seite, nicht je Person", () => {
    expect(SQL).toContain("primary key (order_id, reader)");
    expect(SQL).toContain("check (reader in ('customer', 'seller'))");
  });
});

describe("eine abgeschickte Nachricht bleibt, wie sie ist", () => {
  it("wird weder geändert noch gelöscht", () => {
    const fn = body("order_messages_protect");
    expect(fn).toContain("an order message is never edited");
    expect(fn).toContain("an order message is never deleted");
    expect(SQL).toContain("before update or delete on public.order_messages");
  });

  it("und keine Funktion versucht es", () => {
    expect(SQL).not.toContain("update public.order_messages");
    expect(SQL).not.toContain("delete from public.order_messages");
  });
});

describe("wer die Unterhaltung sehen darf", () => {
  const role = body("order_conversation_role");

  it("ist das Konto, das bestellt hat — oder der Betrieb", () => {
    expect(role).toContain("o.user_id = (select auth.uid())");
    expect(role).toContain("public.can_operate_active_seller()");
  });

  it("und sonst niemand", () => {
    expect(role).toContain("else null");
  });

  it("schließt Gastbestellungen aus, auch für den Betrieb", () => {
    expect(role).toContain("o.id = p_order_id and o.user_id is not null");
    expect(role.indexOf("user_id is not null"))
      .toBeLessThan(role.indexOf("can_operate_active_seller"));
  });

  it("ist für Clients nicht direkt aufrufbar", () => {
    expect(SQL).toContain(
      "revoke all on function public.order_conversation_role(bigint) from public, anon, authenticated;");
  });
});

describe("die Ereignis-Whitelist", () => {
  const fn = body("order_conversation_events");

  it("zeigt genau die zwei freigegebenen Typen", () => {
    for (const t of SHOWN) expect(fn, t).toContain(`'${t}'`);
    expect(fn).toContain("e.event_type in ('order_shipped', 'refund_recorded')");
  });

  it("und keinen der neun ausgeschlossenen", () => {
    for (const t of HIDDEN) expect(fn, t).not.toContain(`'${t}'`);
  });

  it("gibt aus der Payload genau zwei Felder heraus", () => {
    expect(fn).toContain("array['quantity', 'amount']");
  });

  /**
   * `order_line_id` war kurz auf der Liste, mit dem Argument, der Lesende
   * habe die Bestellung ohnehin vor sich. Es ist trotzdem ein interner
   * Primärschlüssel, und die Regel lautet nicht „im Einzelfall ungefährlich",
   * sondern „interne Identitäten verlassen den Kundenkanal nicht".
   */
  it("reicht keine einzige interne Identität durch", () => {
    expect(fn).not.toMatch(/'payload',\s*e\.payload/);
    for (const k of ["order_line_id", "movement_id", "correction_movement_id", "refund_id",
                     "attempt_id", "invoice_number", "stock_outcome",
                     "withdrawal_request_id", "has_tracking"]) {
      expect(fn, k).not.toContain(k);
    }
  });

  it("und nennt auch sonst nirgends ein internes Feld als freigegeben", () => {
    // Die Liste steht genau einmal im Migrationstext.
    expect((SQL.match(/array\['quantity', 'amount'\]/g) ?? []).length).toBe(1);
    expect(SQL).not.toContain("array['quantity', 'amount', 'order_line_id']");
  });

  it("ist in SQL festgelegt, nicht im Client wählbar", () => {
    expect(fn).toContain("order_conversation_events(p_order_id bigint)");
    expect(SQL).toContain(
      "revoke all on function public.order_conversation_events(bigint) from public, anon, authenticated;");
  });
});

describe("das Lesen", () => {
  const fn = body("order_conversation");

  it("antwortet auf unbekannt und fremd genau gleich", () => {
    expect(fn.split("return null;").length - 1).toBeGreaterThanOrEqual(2);
    expect(fn).toContain("if not found then");
    expect(fn).toContain("if v_role is null then");
  });

  it("zählt nur, was von der anderen Seite kam", () => {
    expect(fn).toContain("(m.author_kind <> v_role)");
    expect(fn).toContain("when 'customer' then e.actor_kind <> 'customer'");
    expect(fn).toContain("e.actor_kind <> 'admin'");
  });

  it("hält ohne Wasserstand alles für ungelesen", () => {
    expect(fn).toContain("v_read is null or s.at > v_read");
  });

  it("bleibt immer beschreibbar", () => {
    expect(fn).toContain("'writable', true");
    expect(fn).not.toContain("fulfillment_status = 'cancelled'");
  });

  it("schreibt nichts", () => {
    expect(fn).toContain("stable");
    for (const w of ["insert into", "update public.", "delete from"]) {
      expect(fn.toLowerCase(), w).not.toContain(w);
    }
  });
});

describe("das Schreiben", () => {
  const fn = body("post_order_message");

  it("setzt die Urheberseite selbst", () => {
    expect(fn).toContain("v_role := public.order_conversation_role(v_order_id);");
    expect(fn).toContain("values (v_order_id, v_role, (select auth.uid()), v_body)");
  });

  it("nimmt dafür keinen Parameter entgegen", () => {
    const signature = fn.slice(0, fn.indexOf(")"));
    expect(signature).toContain("p_order_number text");
    expect(signature).toContain("p_body");
    expect(signature).not.toContain("author");
    expect(signature).not.toContain("kind");
  });

  it("verrät nicht, ob es die Bestellung gibt", () => {
    expect(fn.split("no such conversation").length - 1).toBe(2);
  });

  it("prüft den Text dreifach: leer, zu lang, und auf der Spalte", () => {
    expect(fn).toContain("a message needs a body");
    expect(fn).toContain("if length(v_body) > 2000 then");
    expect(SQL).toContain("check (length(body) between 1 and 2000)");
  });

  it("verändert den Text nicht über ein btrim hinaus", () => {
    expect(fn).toContain("v_body := btrim(coalesce(p_body, ''));");
    for (const f of ["lower(", "upper(", "regexp_replace", "translate("]) {
      expect(fn, f).not.toContain(f);
    }
  });
});

describe("das Rate Limit sperrt zu", () => {
  const fn = body("post_order_message");

  it("zählt zwanzig je Bestellung und Stunde", () => {
    expect(fn).toContain("interval '1 hour'");
    expect(fn).toContain("if v_recent >= 20 then");
    expect(fn).toContain("too many messages for this order in the last hour");
  });

  it("zählt unter einer Sperre, damit zwei nicht gleichzeitig durchrutschen", () => {
    expect(fn).toContain("pg_catalog.pg_advisory_xact_lock(");
    expect(fn.indexOf("pg_advisory_xact_lock"))
      .toBeLessThan(fn.indexOf("select count(*) into v_recent"));
  });

  it("weist ab, bevor geschrieben wird — nicht danach", () => {
    expect(fn.indexOf("if v_recent >= 20 then"))
      .toBeLessThan(fn.indexOf("insert into public.order_messages"));
  });
});

describe("der Lesestand", () => {
  const fn = body("mark_order_conversation_read");

  it("geht nur vorwärts", () => {
    expect(fn).toContain(
      "greatest(public.order_conversation_reads.last_read_at, excluded.last_read_at)");
  });

  it("ist wiederholbar und verrät nichts", () => {
    expect(fn).toContain("on conflict (order_id, reader)");
    expect(fn).toContain("return null;");
  });

  it("wird vom Absenden mitgeführt", () => {
    expect(body("post_order_message")).toContain("insert into public.order_conversation_reads");
  });
});

describe("die Zahlen am Rand", () => {
  it("sind Aggregate, keine gezählten Listen", () => {
    for (const n of ["my_unread_total", "seller_unread_total"]) {
      expect(body(n), n).toContain("sum(c.unread)::integer");
      expect(body(n), n).not.toContain("limit");
    }
  });

  it("antworten einem Fremden mit null statt mit einem Fehler", () => {
    expect(body("my_unread_total")).toContain("when (select auth.uid()) is null then 0");
    expect(body("seller_unread_total")).toContain("when not public.can_operate_active_seller() then 0");
  });

  it("zählen die eigenen Handlungen nicht mit", () => {
    expect(body("conversation_summaries")).toContain("else e.actor_kind <> 'admin' end");
  });
});

describe("der Posteingang", () => {
  const fn = body("conversation_summaries");

  it("sortiert ungelesen zuerst, dann nach neuester Aktivität", () => {
    expect(fn).toContain("order by (count(*) filter (");
    expect(fn).toContain("max(st.at) desc");
  });

  it("behält die Sortierung durch die Aggregation hindurch", () => {
    for (const n of ["my_conversations", "seller_conversations"]) {
      expect(body(n), n).toContain("order by (c.unread > 0) desc, c.last_at desc)");
    }
  });

  it("zeigt nur Bestellungen der eigenen Seite", () => {
    expect(fn).toContain("when 'customer' then o.user_id = (select auth.uid())");
    expect(fn).toContain("else public.can_operate_active_seller()");
    expect(fn).toContain("o.user_id is not null");
  });

  /**
   * EIN POSTEINGANG LISTET GESPRÄCHE, KEINE BESTELLUNGEN.
   *
   * Ohne diese Bedingung genügte ein Versand, damit eine Bestellung unter
   * „Nachrichten" stand — ein Eintrag, auf den niemand antworten wollte, und
   * eine Zahl am Rand für eine Mitteilung, die auf der Bestellseite ohnehin
   * steht.
   */
  it("nimmt nur Bestellungen auf, in denen jemand geschrieben hat", () => {
    expect(fn).toContain(
      "and exists (select 1 from public.order_messages m where m.order_id = o.id)");
  });

  it("und lässt die Bestellseite davon unberührt", () => {
    // `order_conversation()` zeigt Versand und Erstattung auch dann, wenn nie
    // jemand geschrieben hat — dort ist es Kontext, kein Posteingangseintrag.
    const conv = body("order_conversation");
    expect(conv).not.toContain("exists (select 1 from public.order_messages");
    expect(conv).toContain("public.order_conversation_events(v_order.id) e");
  });

  it("wirkt damit auch auf die Zahlen am Rand", () => {
    // Beide Summen lesen dieselbe Funktion; eine Bestellung ohne Gespräch
    // kann deshalb keinen Badge erzeugen, der ins Leere zeigt.
    for (const n of ["my_unread_total", "seller_unread_total"]) {
      expect(body(n), n).toContain("public.conversation_summaries(");
    }
  });
});

/**
 * DER SCHNITT BEI DER EINFÜHRUNG.
 *
 * „Kein Wasserstand" heißt „alles ungelesen" — für eine neue Unterhaltung
 * richtig, am Einführungstag falsch: jede je versendete, stornierte oder
 * erstattete Bestellung bekäme rückwirkend rote Punkte für längst Erledigtes.
 *
 * Gelöst ohne Sonderfall im Zählen: jede Bestellung, die es beim Lauf der
 * Migration gibt, bekommt für beide Seiten einen Wasserstand auf jetzt.
 */
describe("der Schnitt bei der Einführung", () => {
  const seed = SQL.slice(SQL.indexOf("insert into public.order_conversation_reads (order_id, reader, last_read_at, updated_by)\nselect"));

  it("setzt für jede bestehende Bestellung beide Seiten auf gelesen", () => {
    expect(seed).toContain("cross join (values ('customer'), ('seller')) as r(reader)");
    expect(seed).toContain("select o.id, r.reader, now(), null");
    expect(seed).toContain("from public.orders o");
  });

  it("lässt Gastbestellungen aus — sie haben keine Unterhaltung", () => {
    expect(seed).toContain("where o.user_id is not null");
  });

  it("läuft genau einmal und überschreibt keinen echten Lesestand", () => {
    // Sobald irgendein Wasserstand existiert, ist das Feature in Betrieb:
    // ein zweiter Lauf darf die Geschichte einer inzwischen entstandenen
    // Bestellung nicht als gelesen erklären.
    expect(seed).toContain("and not exists (select 1 from public.order_conversation_reads)");
    expect(seed).toContain("on conflict (order_id, reader) do nothing;");
  });

  it("erfindet kein Ereignis und ändert keines", () => {
    // Der Schnitt ist eine Tatsache in `order_conversation_reads`, sonst
    // nirgends. `order_events` wird nur gelesen.
    expect(SQL).not.toContain("insert into public.order_events");
    expect(SQL).not.toContain("update public.order_events");
    expect(SQL).not.toContain("insert into public.order_messages (order_id, author_kind, author_user_id, body)\nselect");
  });

  it("braucht dafür keinen Zweig in der Zählung", () => {
    // Die Regel bleibt eine: neuer als der eigene Stand und nicht von mir.
    const fn = body("order_conversation");
    expect(fn).toContain("v_read is null or s.at > v_read");
    expect(fn).not.toContain("launched_at");
    expect(fn).not.toContain("feature_since");
  });

  it("wirkt auch für eine Bestellung ohne Gesprächsinhalt nicht störend", () => {
    // Ein Wasserstand ohne Strang taucht im Posteingang nicht auf: die
    // Zusammenfassung entsteht aus dem Strang, nicht aus den Leseständen.
    const fn = body("conversation_summaries");
    expect(fn).toContain("left join public.order_conversation_reads r");
    expect(fn).toContain("having count(*) > 0");
  });
});

describe("Rechte und Form aller Funktionen", () => {
  const client = ["order_conversation(text)", "post_order_message(text, text)",
                  "mark_order_conversation_read(text)", "my_conversations()",
                  "seller_conversations()", "my_unread_total()", "seller_unread_total()"];
  const internal = ["order_conversation_role(bigint)", "order_conversation_events(bigint)",
                    "conversation_summaries(text)", "order_messages_protect()"];

  /**
   * DER BEFUND, DER DIESEN TEST ERZWUNGEN HAT.
   *
   * `order_messages_protect()` hatte auf Staging EXECUTE für `anon`,
   * `authenticated` und `service_role` — nicht durch einen Grant, sondern
   * weil eine neu angelegte Funktion sie per Default mitbringt und in 0098
   * die eine Zeile fehlte, die sie entzieht. Dieselbe Lücke wie bei den zwei
   * Lesefunktionen in 0095 und bei 0082 davor: sie entsteht durch
   * Weglassen, nicht durch einen Fehler, und fällt nur im Katalog auf.
   *
   * Deshalb wird hier nicht eine Funktion geprüft, sondern eine Regel: JEDE
   * Funktion, die diese Migration anlegt, muss eine ausdrückliche
   * Rechteanweisung tragen. Eine neue Funktion ohne Revoke bricht den Test,
   * bevor jemand den Katalog ansieht.
   */
  it("gibt keiner einzigen Funktion die Default-Rechte zu behalten", () => {
    const created = (SQL.match(/create or replace function public\.(\w+)\(([^)]*)/g) ?? [])
      .map((m) => m.replace(/create or replace function public\./, ""));
    expect(created.length).toBe(11);
    for (const decl of created) {
      const name = decl.slice(0, decl.indexOf("("));
      expect(SQL, `${name} ohne Rechteanweisung`)
        .toMatch(new RegExp(`revoke all on function public\\.${name}\\(`));
    }
  });

  /**
   * Eine Triggerfunktion braucht NULL Rechte. Ein direkter Aufruf ist
   * unmöglich — PostgreSQL weist eine Funktion mit Rückgabetyp `trigger`
   * außerhalb eines Triggers ab —, und das Feuern prüft das EXECUTE-Recht
   * des Aufrufers nicht. Sie darf deshalb auch `service_role` nicht behalten.
   */
  it("entzieht der Triggerfunktion jedes EXECUTE, auch service_role", () => {
    expect(SQL).toContain(
      "revoke all on function public.order_messages_protect()\n  from public, anon, authenticated, service_role;");
    expect(SQL).not.toMatch(/grant execute on function public\.order_messages_protect/);
  });

  it("entzieht, bevor der Trigger angelegt wird", () => {
    expect(SQL.indexOf("revoke all on function public.order_messages_protect()"))
      .toBeLessThan(SQL.indexOf("create trigger order_messages_protect"));
  });

  it("gibt Clients nur die sieben gedachten Funktionen", () => {
    for (const f of client) {
      expect(SQL, f).toContain(`revoke all on function public.${f} from public, anon;`);
      expect(SQL, f).toContain(`grant execute on function public.${f} to authenticated;`);
    }
  });

  it("und entzieht die vier internen vollständig", () => {
    for (const f of internal) {
      const name = f.slice(0, f.indexOf("("));
      /* Zeilenumbruch und ein zusätzliches `service_role` sind erlaubt —
         die drei Clientrollen müssen im Entzug stehen. */
      const clause = SQL.slice(SQL.indexOf(`revoke all on function public.${f}`));
      expect(clause.slice(0, 200), `${name} ohne Entzug`).toMatch(
        /revoke all on function public\.\w+\([^)]*\)\s*\n?\s*from public, anon, authenticated/);
      expect(SQL, name).not.toMatch(
        new RegExp(`grant execute on function public\\.${name}\\(`));
    }
  });

  it("setzt überall search_path, und definer dort, wo entschieden wird", () => {
    expect((SQL.match(/create or replace function public\.\w+/g) ?? []).length).toBe(11);
    expect((SQL.match(/set search_path = ''/g) ?? []).length).toBe(11);
    expect((SQL.match(/security definer/g) ?? []).length).toBe(8);
  });

  it("legt keine Überladung an", () => {
    const names = (SQL.match(/create or replace function public\.(\w+)\(/g) ?? [])
      .map((m) => m.replace(/.*public\.(\w+)\(/, "$1"));
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("was 0098 nicht anfasst", () => {
  it("keine bestehende Commerce-Tabelle, keine frühere Migration", () => {
    for (const t of ["alter table public.orders", "alter table public.order_lines",
                     "alter table public.order_events", "alter table public.shop_inventory",
                     "alter table public.order_refunds", "alter table public.order_line_events",
                     "drop table", "drop function", "truncate"]) {
      expect(SQL.toLowerCase(), t).not.toContain(t);
    }
  });

  it("bewegt weder Bestand noch Geld", () => {
    for (const t of ["apply_inventory_movement", "record_inventory_movement",
                     "shop_inventory", "payment_status ="]) {
      expect(SQL, t).not.toContain(t);
    }
  });
});
