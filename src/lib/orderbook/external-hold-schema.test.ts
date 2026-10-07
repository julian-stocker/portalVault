import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

import {
  allMigrations, code, columnsOf, latestFunction, migrationFiles, migrationSource,
} from "@/test-support/migrations";

/**
 * `0109` — DER SCHEMA-VERTRAG FÜR EXTERNAL HOLDS.
 *
 * WAS `0109` IST. Eine Spalte, zwei Lockerungen, vier CHECKs, ein
 * Fremdschlüssel, ein partieller Unique-Index und eine Ausnahme im
 * Löschschutz. Keine Funktion, die Holds anlegt oder verbraucht — die kommen
 * in `0110`. Keine Zeile wird geschrieben.
 *
 * WARUM DIESE TESTS AM TEXT PRÜFEN. Weil niemand hier DDL ausführt: die
 * Migration wird von Hand im SQL Editor angewendet, und zwischen „geschrieben"
 * und „angewendet" liegt ein Schritt, den keine Testumgebung abdeckt. Was
 * geprüft werden KANN, ist, dass die Datei genau das sagt, was der abgenommene
 * Plan beschlossen hat — und nichts darüber hinaus.
 *
 * `columnsOf` faltet dagegen die ganze Historie und beantwortet die eine Frage,
 * für die Text nicht reicht: existiert die Spalte auf DIESER Tabelle.
 */

const FILE = "0109_external_hold_schema.sql";
const PATH = `supabase/migrations/${FILE}`;
const raw = readFileSync(PATH, "utf8");
/** Ausführbarer Teil: ohne Prosa und ohne `comment on`. */
const exec = code(raw);

/** Was aus `0010`/`0083` unverändert bestehen bleiben muss. */
const INHERITED = [
  "order_reservations_one_per_position",
  "order_reservations_movement_unique",
  "order_reservations_movement_only_when_converted",
  "order_reservations_released_consistent",
  "order_reservations_converted_consistent",
  "order_reservations_quantity_positive",
  "order_reservations_state_known",
  "order_reservations_order_fk",
  "order_reservations_inventory_fk",
  "order_reservations_movement_fk",
  "order_reservations_reverted_movement_fk",
  "order_reservations_one_return_each",
  "order_reservations_order_idx",
  "order_reservations_due_idx",
  "order_reservations_no_delete",
] as const;

// ---------------------------------------------------------------------------
// 1. Die Datei
// ---------------------------------------------------------------------------

describe("0109 existiert und ist die letzte Migration", () => {
  it("liegt unter dem erwarteten Namen", () => {
    expect(existsSync(PATH)).toBe(true);
    expect(migrationFiles).toContain(FILE);
  });

  it("liegt zwischen 0108 und 0110, und bleibt dort", () => {
    /*
     * KEINE MOMENTAUFNAHME DER HÖCHSTEN NUMMER. Hier stand einmal „0111 und
     * 0112 existieren noch nicht" — eine Aussage über einen Plan, und Pläne
     * ändern sich: `0111` ist gebaut und trägt den Stripe-Erstattungsvertrag,
     * nicht das, was damals dafür vorgesehen war. Was dauerhaft gilt, ist die
     * REIHENFOLGE, und die wird hier geprüft.
     */
    const at = migrationFiles.indexOf(FILE);
    expect(at).toBeGreaterThan(-1);
    expect(migrationFiles[at - 1]).toBe("0108_loose_only_inventory.sql");
    expect(migrationFiles[at + 1]).toBe("0110_external_hold_runtime.sql");
  });

  it("und 0104 bis 0108 sind unverändert", () => {
    const frozen: Record<string, string> = {
      "0104_business_backup_export.sql":
        "2f9184f34bcab010d514b47b67c5884073539437064c67fb016c50f898714edf",
      "0105_platform_export.sql":
        "e1fbd1e35253c1900d3aa166a8026644f6bcf7dea4ba4c2b9af37fcd746c9e68",
      "0106_platform_export_history.sql":
        "242867f59efbcdb0a7031c11f51da6406fffc17b652832e985718eed1e0f5118",
      "0107_platform_auth_inventory.sql":
        "0352b4e352d2f14e4a7c1e2a23ea2acef3e44ae945a874806a8a805e26f3e0b2",
      "0108_loose_only_inventory.sql":
        "aaef73e21d4c57f21959eca494c55bfba6d5909cc1df2a847a087ddc4b5d1f1c",
    };
    for (const [file, sha] of Object.entries(frozen)) {
      expect(createHash("sha256").update(migrationSource(file)).digest("hex"), file).toBe(sha);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Nur Schema, und nur dieses
// ---------------------------------------------------------------------------

describe("0109 ändert ausschließlich das Schema", () => {
  it("bewegt keine Zeile", () => {
    for (const forbidden of [/^\s*insert\b/im, /^\s*update\b/im, /^\s*delete\b/im,
                             /\btruncate\b/i, /\bcopy\b/i]) {
      expect(exec, String(forbidden)).not.toMatch(forbidden);
    }
  });

  it("entfernt nichts und benennt nichts um", () => {
    for (const forbidden of ["drop column", "drop table", "drop index", "drop function",
                             "drop trigger", "rename to", "rename column"]) {
      expect(exec.toLowerCase(), forbidden).not.toContain(forbidden);
    }
  });

  it("rührt keine ACL an", () => {
    for (const forbidden of ["grant ", "revoke ", "service_role", "alter default privileges",
                             "create policy", "alter policy", "drop policy",
                             "enable row level security"]) {
      expect(exec.toLowerCase(), forbidden).not.toContain(forbidden);
    }
  });

  it("enthält nichts aus den Schritten davor und danach", () => {
    for (const forbidden of [
      // 0110 — die Hold-Laufzeit
      "seller_hold_sale_item", "seller_release_sale_item_hold",
      "seller_book_sale_item", "seller_unbook_sale_item", "record_inventory_movement",
      "apply_inventory_movement", "shop_inventory",
      // 0111 — der Stripe-Erstattungsvertrag. Eine andere Domäne, und diese
      // Datei fasst sie nicht an.
      "order_refunds", "provider_status", "submit_order_refund",
      "attach_order_refund", "record_refund_event",
      // nie gebaut und hier ebenso wenig: ein Orderstatus, ein Backupformat
      "seller_set_sale_status", "stock_released_at",
      "system_platform_export", "system_business_backup",
    ]) {
      expect(exec, forbidden).not.toContain(forbidden);
    }
  });

  it("und berührt keine andere Tabelle als order_reservations", () => {
    const tables = [...exec.matchAll(/alter table (?:if exists )?public\.(\w+)/gi)]
      .map((m) => m[1]);
    expect(tables.length).toBeGreaterThan(0);
    expect([...new Set(tables)]).toEqual(["order_reservations"]);
  });
});

// ---------------------------------------------------------------------------
// 3. Die Spalte
// ---------------------------------------------------------------------------

describe("order_reservations.sale_item_id", () => {
  it("wird idempotent angelegt und ist nullable", () => {
    expect(exec).toContain("add column if not exists sale_item_id bigint;");
    // Kein `not null` auf der neuen Spalte: eine Checkout-Reservierung hat keine.
    expect(exec).not.toMatch(/sale_item_id bigint\s+not null/i);
  });

  it("gehört laut gefalteter Historie jetzt zu dieser Tabelle", () => {
    const columns = columnsOf("order_reservations");
    expect(columns.has("sale_item_id")).toBe(true);
    // Und die alten Spalten sind alle noch da.
    for (const column of ["order_id", "inventory_id", "quantity", "state", "reserved_at",
                          "expires_at", "released_at", "converted_at", "movement_id",
                          "reverted_movement_id"]) {
      expect(columns.has(column), column).toBe(true);
    }
  });

  it("und wird erklärt, einschließlich der Cascade-Begründung", () => {
    expect(raw).toContain("comment on column public.order_reservations.sale_item_id is");
    expect(raw).toContain("Exactly one of order_id and sale_item_id is set");
    expect(raw).toContain("ON DELETE CASCADE");
  });
});

// ---------------------------------------------------------------------------
// 4. Die zwei Lockerungen
// ---------------------------------------------------------------------------

describe("genau zwei Spalten verlieren ihr not null", () => {
  it("order_id und expires_at, in einer Anweisung", () => {
    expect(exec).toMatch(
      /alter table public\.order_reservations\s*\n\s*alter column order_id\s+drop not null,\s*\n\s*alter column expires_at drop not null;/,
    );
  });

  it("und keine dritte", () => {
    const dropped = [...exec.matchAll(/alter column (\w+)\s+drop not null/gi)].map((m) => m[1]);
    expect(dropped.sort()).toEqual(["expires_at", "order_id"]);
    // Und nichts wird auf not null GESETZT: das wäre eine Verschärfung.
    expect(exec.toLowerCase()).not.toContain("set not null");
  });
});

// ---------------------------------------------------------------------------
// 5. Die vier Constraints
// ---------------------------------------------------------------------------

describe("die vier neuen CHECKs", () => {
  /** Das Prädikat eines benannten CHECKs, Weißraum normalisiert. */
  const predicate = (name: string): string => {
    const at = exec.indexOf(`add constraint ${name}\n  check (`);
    expect(at, `${name} fehlt`).toBeGreaterThan(-1);
    return exec.slice(at, exec.indexOf(";", at)).replace(/\s+/g, " ");
  };

  it("genau ein Eigentümer, als exklusives Oder", () => {
    expect(predicate("order_reservations_one_owner"))
      .toContain("check ((order_id is null) <> (sale_item_id is null))");
    // `<>` und nicht `or`: eine Zeile mit BEIDEN Eigentümern wäre erlaubt.
    expect(predicate("order_reservations_one_owner")).not.toContain(" or ");
  });

  it("ein Checkout-Hold hat immer einen Ablauf", () => {
    expect(predicate("order_reservations_order_hold_expires"))
      .toContain("check (order_id is null or expires_at is not null)");
  });

  it("ein externer Hold hat nie einen", () => {
    expect(predicate("order_reservations_sale_hold_never_expires"))
      .toContain("check (sale_item_id is null or expires_at is null)");
  });

  it("und hält genau ein Stück", () => {
    expect(predicate("order_reservations_sale_hold_is_one"))
      .toContain("check (sale_item_id is null or quantity = 1)");
  });

  it("alle vier werden idempotent gesetzt", () => {
    for (const name of ["order_reservations_one_owner",
                        "order_reservations_order_hold_expires",
                        "order_reservations_sale_hold_never_expires",
                        "order_reservations_sale_hold_is_one",
                        "order_reservations_sale_item_fk"]) {
      expect(exec, name).toContain(`drop constraint if exists ${name};`);
      expect(exec, name).toContain(`add constraint ${name}`);
      // Nicht `not valid`: bestehende Zeilen MÜSSEN die Regel erfüllen,
      // und beim ersten Lauf erfüllen sie sie trivial.
      const block = exec.slice(exec.indexOf(`add constraint ${name}`));
      expect(block.slice(0, block.indexOf(";")).toLowerCase(), name).not.toContain("not valid");
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Der Fremdschlüssel
// ---------------------------------------------------------------------------

describe("der Fremdschlüssel auf sale_items", () => {
  it("zeigt auf die Position und räumt mit ihr ab", () => {
    const at = exec.indexOf("add constraint order_reservations_sale_item_fk");
    const fk = exec.slice(at, exec.indexOf(";", at)).replace(/\s+/g, " ");
    expect(fk).toContain("foreign key (sale_item_id)");
    expect(fk).toContain("references public.sale_items (id)");
    expect(fk).toContain("on update cascade");
    expect(fk).toContain("on delete cascade");
    // `restrict` würde jede Position mit Hold-Historie unlöschbar machen,
    // `set null` würde order_reservations_one_owner verletzen.
    expect(fk).not.toContain("on delete restrict");
    expect(fk).not.toContain("on delete set null");
  });

  it("und sale_items ist die Tabelle, die es gibt", () => {
    expect(columnsOf("sale_items").has("id")).toBe(true);
    expect(allMigrations).toContain("create table if not exists public.sale_items (");
  });
});

// ---------------------------------------------------------------------------
// 7. Höchstens ein aktiver Hold je Position
// ---------------------------------------------------------------------------

describe("der partielle Unique-Index", () => {
  it("steht auf sale_item_id und nur auf active", () => {
    expect(exec).toMatch(
      /create unique index if not exists order_reservations_one_active_hold_per_item\s*\n\s*on public\.order_reservations \(sale_item_id\)\s*\n\s*where sale_item_id is not null and state = 'active';/,
    );
  });

  it("ist partiell, damit Historie sich stapeln darf", () => {
    /*
     * Entscheidung 4 des Plans: eine Rückbuchung reaktiviert den gewandelten
     * Hold NICHT, sondern legt einen neuen an. Ohne das `state = 'active'` im
     * Prädikat wäre die zweite Buchung derselben Position unmöglich.
     */
    const at = exec.indexOf("create unique index if not exists order_reservations_one_active_hold_per_item");
    const block = exec.slice(at, exec.indexOf(";", at));
    expect(block).toContain("where");
    expect(block).toContain("state = 'active'");
    expect(raw).toContain("comment on index public.order_reservations_one_active_hold_per_item is");
  });

  it("und ersetzt nicht die Unique aus 0010", () => {
    /*
     * `0109` NENNT sie — die Nachprüfung in Abschnitt 9 verlangt, dass sie
     * noch da ist. Was es nicht tut, ist sie anzufassen: kein `drop`, kein
     * zweites `add constraint` unter demselben Namen.
     */
    expect(exec).not.toContain("drop constraint if exists order_reservations_one_per_position");
    expect(exec).not.toContain("add constraint order_reservations_one_per_position");
    expect(allMigrations)
      .toContain("constraint order_reservations_one_per_position unique (order_id, inventory_id)");
  });
});

// ---------------------------------------------------------------------------
// 8. Der Löschschutz
// ---------------------------------------------------------------------------

describe("reservations_deny_delete lernt genau eine Ausnahme", () => {
  const latest = latestFunction("reservations_deny_delete");
  const body = latest.body;

  it("die jüngste Fassung steht in 0109", () => {
    expect(latest.file).toBe(FILE);
  });

  it("mit unveränderter Signatur und ohne security definer", () => {
    expect(body).toContain("returns trigger");
    expect(body).toContain("language plpgsql");
    expect(body).toContain("set search_path = ''");
    // `0010` hat sie als invoker angelegt; ein `definer` hier wäre eine
    // stillschweigende Rechteerweiterung.
    expect(body).not.toContain("security definer");
  });

  it("erlaubt die Löschung nur unter allen vier Bedingungen", () => {
    expect(body).toContain("old.sale_item_id is not null");
    expect(body).toContain("old.state = 'released'");
    expect(body).toContain("old.movement_id is null");
    expect(body).toContain("old.reverted_movement_id is null");
    // Und sie sind mit `and` verknüpft, nicht mit `or`.
    const guard = body.slice(body.indexOf("if old.sale_item_id"), body.indexOf("return old;"));
    expect((guard.match(/\band\b/g) ?? []).length).toBe(3);
    expect(guard).not.toContain(" or ");
  });

  it("und lehnt alles andere mit demselben Satz wie 0010 ab", () => {
    expect(body).toContain("raise exception 'a reservation is released, never deleted'");
    expect(body).toContain("using errcode = 'restrict_violation'");
    // Wortgleich: der Satz ist in `sales-actions.ts` und in der Doku zitiert.
    expect(migrationSource("0010_commerce_core.sql"))
      .toContain("raise exception 'a reservation is released, never deleted'");
  });

  it("eine Bestell-Reservierung fällt immer in die Ablehnung", () => {
    /*
     * `old.sale_item_id is not null` ist die erste Bedingung. Für jede Zeile,
     * die ein Checkout angelegt hat, ist sie falsch — der Schutz aus `0010`
     * gilt dort unverändert, und das ist der ganze Punkt der Bedingung.
     */
    const guard = body.slice(body.indexOf("if "), body.indexOf("then"));
    expect(guard.trimStart().startsWith("if old.sale_item_id is not null")).toBe(true);
  });

  it("der Trigger selbst wird nicht neu angelegt", () => {
    // `create or replace function` genügt: der Trigger aus `0010` hängt an
    // derselben Funktion und muss nicht angefasst werden.
    expect(exec).not.toContain("create trigger");
    expect(migrationSource("0010_commerce_core.sql"))
      .toContain("create trigger order_reservations_no_delete");
  });
});

// ---------------------------------------------------------------------------
// 9. Bestehende Checkout-Holds bleiben gültig
// ---------------------------------------------------------------------------

describe("die Kompatibilität ist nachgewiesen, nicht behauptet", () => {
  it("der Ablauf-Sweep kann einen externen Hold nicht finden", () => {
    /*
     * Zwei unabhängige Gründe, und beide werden hier festgehalten:
     *   1. `release_expired_reservations` VERGLEICHT `expires_at`; NULL
     *      erfüllt `<= now()` nicht.
     *   2. `order_reservations_sale_hold_never_expires` erzwingt, dass ein
     *      externer Hold gar kein Datum HAT — das überlebt auch eine spätere
     *      Änderung der Funktion.
     */
    const sweep = code(latestFunction("release_expired_reservations").body);
    expect(sweep).toContain("r.expires_at <= now()");
    expect(exec).toContain("check (sale_item_id is null or expires_at is null)");
  });

  it("der Zahlungsstart prüft weiter gegen die Positionen der Bestellung", () => {
    // `where r.order_id = p_order_id` — NULL erfüllt das nie.
    const history = code(allMigrations);
    expect(history).toContain("and r.state = 'active'");
    expect(history).toContain("where r.order_id = p_order_id");
  });

  it("die Abstimmsicht deckt externe Holds ohne Änderung mit ab", () => {
    /*
     * `reservation_reconciliation` summiert ALLE aktiven Reservierungen je
     * Lagerposition, ohne Filter auf `order_id`. Ein aktiver externer Hold
     * zählt also mit, und `drift` bleibt 0 — dieselbe Sicht, dieselbe Zusage.
     */
    const view = migrationSource("0010_commerce_core.sql");
    const at = view.indexOf("create or replace view public.reservation_reconciliation as");
    const sql = view.slice(at, view.indexOf(";", at));
    expect(sql).toContain("where r.state = 'active'");
    expect(sql).not.toContain("order_id");
    expect(sql).toContain("as drift");
  });

  it("und 0109 prüft sie als einzige Vorbedingung", () => {
    expect(exec).toContain("from public.reservation_reconciliation");
    expect(exec).toContain("where drift <> 0");
    expect(exec).toContain("using errcode = 'data_corrupted'");
    // Plus die eine Abhängigkeit, die der Löschschutz braucht.
    expect(exec).toContain("and a.attname = 'reverted_movement_id'");
  });

  it("nichts aus 0010 oder 0083 wird gelöscht oder umbenannt", () => {
    for (const name of INHERITED) {
      expect(exec, `${name} darf nicht gedroppt werden`)
        .not.toContain(`drop constraint if exists ${name}`);
      expect(exec, name).not.toContain(`drop index if exists ${name}`);
    }
    // Umgekehrt: 0109 darf sie nur in Prosa und in der Nachprüfung nennen.
    expect(raw).toContain("order_reservations_one_per_position");
  });
});

// ---------------------------------------------------------------------------
// 10. Die Nachprüfung in der Migration selbst
// ---------------------------------------------------------------------------

describe("0109 prüft sein Ergebnis selbst", () => {
  it("zwei do-Blöcke: eine Vorbedingung, eine Nachprüfung", () => {
    expect((exec.match(/^do \$\$/gm) ?? []).length).toBe(2);
  });

  it("die Nachprüfung liest den Katalog, nicht die Absicht", () => {
    const after = exec.slice(exec.lastIndexOf("do $$"));
    for (const probe of ["pg_attribute", "pg_constraint", "pg_class", "pg_trigger"]) {
      expect(after, probe).toContain(probe);
    }
    expect(after).toContain("0109 unvollständig");
  });

  it("und hält fest, dass 0109 keinen einzigen Hold anlegt", () => {
    const after = exec.slice(exec.lastIndexOf("do $$"));
    expect(after).toContain("from public.order_reservations where sale_item_id is not null");
    expect(after).toContain("0109 schreibt keine");
  });

  it("die Statementbilanz ist genau die geplante", () => {
    const top = exec.split("\n").filter((l) =>
      /^(do|alter|create|comment|revoke|grant|drop|insert|update|delete)\b/i.test(l));
    expect(top.filter((l) => l.startsWith("do $$"))).toHaveLength(2);
    expect(top.filter((l) => l.startsWith("alter table"))).toHaveLength(12);
    expect(top.filter((l) => l.startsWith("create unique index"))).toHaveLength(1);
    expect(top.filter((l) => l.startsWith("create or replace function"))).toHaveLength(1);
    expect(top).toHaveLength(16);
    // Vier Kommentare: Spalte, Index, Funktion, Tabelle.
    expect((raw.match(/^comment on /gm) ?? []).length).toBe(4);
  });

  it("und der Rückbau steht im Kopf, vollständig", () => {
    for (const step of ["drop index  if exists public.order_reservations_one_active_hold_per_item",
                        "drop constraint if exists order_reservations_sale_item_fk",
                        "drop column     if exists sale_item_id",
                        "alter column order_id   set not null"]) {
      expect(raw, step).toContain(step);
    }
  });
});
