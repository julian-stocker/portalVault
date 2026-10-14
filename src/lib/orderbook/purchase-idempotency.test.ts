/**
 * 0120 — Zustand beim Anlegen, Pflichtdatum, und ein Entwurf speichert einmal.
 *
 * DREI ZUSICHERUNGEN, die diese Datei trägt:
 *
 * 1. KEINE TEILANLAGE. Ein `plpgsql`-Rumpf IST die Transaktion; jede
 *    `exception` darin nimmt Kopf und Positionen mit. Der Test prüft, dass
 *    niemand eine eigene Transaktionssteuerung hineingeschrieben hat, die das
 *    aufbrechen würde.
 *
 * 2. KEINE DOPPELANLAGE. Das ist ein ANDERES Problem, und es braucht einen
 *    anderen Mechanismus: die Transaktion schützt nicht gegen ein zweimal
 *    abgeschicktes Formular. Dafür gibt es den Entwurfstoken, die Sperre, den
 *    Fingerabdruckvergleich und den partiellen UNIQUE-Index — in dieser
 *    Reihenfolge.
 *
 * 3. KEINE LAGERBEWEGUNG. Keiner der fünf erlaubten Zustände bucht, und die
 *    Funktion prüft das nach, statt es zu behaupten.
 */
import { describe, expect, it } from "vitest";

import { allMigrations, code, latestFunction, migrationSource } from "@/test-support/migrations";

const SQL = migrationSource("0120_purchase_states_and_idempotency.sql");
const FN = latestFunction("seller_create_purchase_with_items");
const BODY = code(FN.body);

const NEW_SIGNATURE =
  "seller_create_purchase_with_items(date, numeric, text, boolean, jsonb, text, text, "
  + "numeric, numeric, numeric, text, text, text)";
const OLD_SIGNATURE =
  "seller_create_purchase_with_items(date, numeric, text, boolean, jsonb, text, text, "
  + "numeric, numeric, numeric, text, text)";

describe("Signatur und Berechtigungen", () => {
  it("0120 ist die Datei, die die Funktion zuletzt anlegt", () => {
    expect(FN.file).toBe("0120_purchase_states_and_idempotency.sql");
  });

  it("die alte Zwölf-Parameter-Fassung wird gelöscht, nicht überladen", () => {
    /*
     * PostgREST löst nach ARGUMENTNAMEN auf. Bliebe die alte Fassung stehen,
     * träfe der alte Aufruf weiter sie — und damit eine Funktion ohne
     * Datumsriegel. Dieselbe Falle, die `0116` schon einmal entschärft hat.
     */
    expect(SQL).toContain(`drop function if exists public.${OLD_SIGNATURE};`);
    const drops = (SQL.match(/^drop function if exists/gm) ?? []);
    expect(drops).toHaveLength(1);
    expect(SQL).toContain("erwartet genau einmal");
  });

  it("der Entwurfstoken ist der letzte Parameter und hat einen Default", () => {
    expect(FN.body).toContain("p_client_token   text   default null");
    /* Danach kommt nichts mehr — sonst wäre jeder bestehende Aufruf kaputt. */
    const args = FN.body.slice(FN.body.indexOf("("), FN.body.indexOf(")\nreturns"));
    expect(args.trimEnd().endsWith("p_client_token   text   default null")).toBe(true);
  });

  it("anon wird entzogen, authenticated erteilt — mit der NEUEN Signatur", () => {
    expect(SQL).toContain(`revoke all on function public.${NEW_SIGNATURE} from public, anon;`);
    expect(SQL).toContain(`grant execute on function public.${NEW_SIGNATURE} to authenticated;`);
    /* Und die Migration prüft es nach dem Lauf im Katalog, nicht im Text. */
    expect(SQL).toContain("has_function_privilege('anon'");
    expect(SQL).toContain("has_function_privilege('authenticated'");
  });

  it("bleibt security definer mit leerem search_path und Betreibergate", () => {
    expect(FN.body).toContain("security definer");
    expect(FN.body).toContain("set search_path = ''");
    expect(BODY).toContain("if not public.can_operate_active_seller() then");
    /* Das Gate steht VOR allem anderen. */
    expect(BODY.indexOf("can_operate_active_seller")).toBeLessThan(BODY.indexOf("p_purchased_at is null"));
  });
});

describe("Atomarität: keine Teilanlage", () => {
  it("keine eigene Transaktionssteuerung", () => {
    for (const forbidden of ["commit", "rollback", "savepoint", "begin transaction",
                             "set transaction"]) {
      expect(BODY.toLowerCase(), forbidden).not.toContain(forbidden);
    }
  });

  it("kein `exception when` fängt einen Fehler ab und macht weiter", () => {
    /*
     * Ein Handler wäre genau die Teilanlage, die ausgeschlossen werden soll:
     * er würde den Fehler schlucken und den halb erfassten Einkauf stehen
     * lassen.
     */
    expect(BODY.toLowerCase()).not.toContain("exception when");
  });

  it("alles entsteht in diesem einen Rumpf, über die kanonischen Schreiber", () => {
    expect(BODY).toContain("public.seller_create_purchase(p_purchased_at, p_total_cost, p_note, p_is_test)");
    expect(BODY).toContain("public.seller_add_purchase_item(");
    /* Niemals selbst in die Positionstabelle einfügen — das umginge die
       Positionsvergabe, die Namensprüfung und den Fremdschlüssel. */
    expect(BODY).not.toContain("insert into public.purchase_items");
  });

  it("die 200er-Obergrenze aus 0064 gilt weiter", () => {
    expect(BODY).toContain("jsonb_array_length(v_items) > 200");
    expect(BODY).toContain("program_limit_exceeded");
  });

  it("die Kostenaufteilung bleibt der Prüfung der Tabelle überlassen", () => {
    expect(FN.body).toContain("purchases_cost_split_adds_up");
  });
});

describe("Idempotenz: keine Doppelanlage", () => {
  it("der Token wird normalisiert und auf UUID-Form geprüft", () => {
    expect(BODY).toContain("lower(nullif(btrim(coalesce(p_client_token, '')), ''))");
    expect(BODY).toContain("a draft token must be a uuid");
  });

  it("gleichzeitige Aufrufe werden serialisiert, nicht gehofft", () => {
    /*
     * Ohne die Sperre lesen zwei gleichzeitige Aufrufe desselben Entwurfs
     * beide „kein Einkauf mit diesem Token" und fügen beide ein. Der UNIQUE
     * Index weist dann einen ab — mit einem Constraintnamen statt mit einer
     * Erklärung.
     */
    expect(BODY).toContain("pg_advisory_xact_lock(hashtext('seller_create_purchase_with_items')");
    expect(BODY).toContain("hashtext(v_token)");
    /* Die Sperre steht VOR dem Lesen des bestehenden Einkaufs. */
    expect(BODY.indexOf("pg_advisory_xact_lock"))
      .toBeLessThan(BODY.indexOf("from public.purchases p where p.client_token = v_token"));
  });

  it("der Fingerabdruck entsteht über jsonb und ist damit kanonisch", () => {
    /*
     * `jsonb` sortiert seine Schlüssel und entfernt Dubletten — die
     * Textdarstellung ist dadurch stabil. `round(…, 2)` nimmt der Summe die
     * Skalenfreiheit, sonst wären `10` und `10.00` zwei Fingerabdrücke für
     * denselben Einkauf.
     */
    expect(BODY).toContain("encode(sha256(convert_to(jsonb_build_object(");
    expect(BODY).toContain("round(p_total_cost, 2)");
    expect(BODY).toContain("'items',        v_items,");
    /* Jedes Feld, das den Einkauf ausmacht, geht in den Abdruck ein. */
    for (const field of ["purchased_at", "total_cost", "note", "is_test", "items",
                         "platform", "seller_name", "items_cost", "shipping_cost",
                         "buyer_protection_cost", "payment_method", "external_ref"]) {
      expect(BODY, field).toContain(`'${field}',`);
    }
  });

  it("gleiche Wiederholung gibt die bestehende id zurück, ohne zu schreiben", () => {
    const block = BODY.slice(BODY.indexOf("if v_prior_id is not null then"));
    expect(block).toContain("return v_prior_id;");
    /* Und zwar BEVOR irgendetwas angelegt wird. */
    expect(BODY.indexOf("return v_prior_id;"))
      .toBeLessThan(BODY.indexOf("v_id := public.seller_create_purchase("));
  });

  it("ABWEICHENDER Inhalt unter demselben Token wird abgewiesen, nicht bestätigt", () => {
    /*
     * Das ist die eigentliche Gefahr. Würde die Funktion hier die bestehende
     * id zurückgeben, hätte der Betreiber die Zusicherung „gespeichert" für
     * einen Einkauf, den niemand angelegt hat.
     */
    expect(BODY).toContain("if v_prior_fp is distinct from v_fp then");
    expect(BODY).toContain("with different content");
    const divergence = BODY.slice(BODY.indexOf("if v_prior_fp is distinct from v_fp then"));
    expect(divergence.slice(0, divergence.indexOf("end if;"))).toContain("raise exception");
    expect(divergence.slice(0, divergence.indexOf("end if;"))).not.toContain("return");
  });

  it("der partielle UNIQUE-Index ist die letzte Linie", () => {
    expect(SQL).toContain(
      "create unique index if not exists purchases_client_token_uniq\n"
      + "  on public.purchases (client_token) where client_token is not null;");
  });

  it("ohne Token verhält sich die Funktion wie bisher", () => {
    expect(BODY).toContain("if v_token is not null then");
    expect(BODY).toContain("case when v_token is null then null else v_fp end");
  });

  it("die zwei Spalten, ihre drei CHECKs und beides-oder-keines", () => {
    expect(SQL).toContain("alter table public.purchases add column if not exists client_token text;");
    expect(SQL).toContain(
      "alter table public.purchases add column if not exists client_request_fingerprint text;");
    expect(SQL).toContain("purchases_client_token_format");
    expect(SQL).toContain("purchases_client_fingerprint_format");
    /*
     * Ein Token ohne Fingerabdruck könnte eine Wiedergabe nicht prüfen und
     * müsste sie blind bestätigen oder blind ablehnen.
     */
    expect(SQL).toContain(
      "check ((client_token is null) = (client_request_fingerprint is null));");
    expect(SQL).toContain("^[0-9a-f]{64}$");
  });

  it("und kein bestehender Einkauf bekommt einen Token", () => {
    expect(SQL).toContain("bestehende Einkäufe tragen plötzlich einen Entwurfstoken");
    /* Die Spalten kommen ohne Default — NULL ist für 88 Einkäufe die wahre
       Antwort. */
    expect(SQL).not.toMatch(/client_token text (not null|default)/);
  });
});

describe("die fünf Zustände, und keine Buchung", () => {
  it("genau fünf sind beim Anlegen erlaubt", () => {
    expect(BODY).toContain("v_state not in ('ordered', 'arrived', 'damaged', 'missing', 'showcase')");
    expect(BODY).toContain("is not a state a new purchase item may start in");
  });

  it("die drei verbotenen werden damit abgewiesen", () => {
    /* Keiner von ihnen steht in der erlaubten Liste. */
    const allowed = BODY.slice(BODY.indexOf("v_state not in ("));
    const list = allowed.slice(0, allowed.indexOf(")"));
    for (const forbidden of ["booked", "reconciled_legacy", "settled"]) {
      expect(list, forbidden).not.toContain(forbidden);
    }
  });

  it("jeder Zustand wird VORAB geprüft, bevor eine Zeile entsteht", () => {
    /*
     * Der CHECK der Tabelle würde ein `settled` drei Elemente weiter unten
     * auch abweisen, und die Transaktion fiele korrekt zurück — aber die
     * Meldung spräche von einem Constraint statt von der Sache.
     */
    expect(BODY.indexOf("is not a state a new purchase item may start in"))
      .toBeLessThan(BODY.indexOf("v_id := public.seller_create_purchase("));
  });

  it("der Standard ist `ordered`, und nur eine Abweichung wird geschrieben", () => {
    expect(BODY).toContain("coalesce(nullif(btrim(coalesce(v_element->>'state', '')), ''), 'ordered')");
    expect(BODY).toContain("if v_state <> 'ordered' then");
    expect(BODY).toContain("update public.purchase_items set state = v_state");
  });

  it("KEINE Lagerbewegung entsteht beim Anlegen", () => {
    for (const forbidden of ["record_inventory_movement", "shop_inventory",
                             "inventory_movements", "apply_inventory_movement"]) {
      expect(BODY, forbidden).not.toContain(forbidden);
    }
  });

  it("und die Funktion prüft es nach, statt es zu behaupten", () => {
    expect(BODY).toContain("creating a purchase must not move stock");
    expect(BODY).toContain("where purchase_id = v_id and movement_id is not null");
    /* Die zweite Nachbedingung: kein Zustand, den das Anlegen nicht darf. */
    expect(BODY).toContain("a new purchase left % items in a state it may not create");
    /* Beide stehen VOR dem `return`, also in derselben Transaktion. */
    const tail = BODY.slice(BODY.indexOf("must not move stock"));
    expect(tail).toContain("return v_id;");
  });

  it("`seller_add_purchase_item` behält seine vier Parameter", () => {
    /*
     * Ein fünfter Parameter dort wäre eine zweite Überladung für einen Wert,
     * den der Detailbildschirm nicht kennt. Der Zustand wird deshalb danach
     * zugewiesen, in derselben Transaktion.
     */
    expect(allMigrations).not.toContain("drop function if exists public.seller_add_purchase_item");
    expect(SQL).not.toContain("create or replace function public.seller_add_purchase_item");
    expect(latestFunction("seller_add_purchase_item").body)
      .toContain("p_condition   text default 'loose'");
  });
});

describe("was 0120 nicht anfassen durfte", () => {
  it("der Importpfad und der Rumpf, an den delegiert wird", () => {
    for (const untouched of ["seller_create_purchase", "seller_import_purchase_group",
                             "seller_update_purchase", "seller_set_purchase_date"]) {
      expect(SQL, untouched)
        .not.toContain(`create or replace function public.${untouched}(`);
    }
    /* Und 0120 prüft deren Fortbestand selbst nach. */
    expect(SQL).toContain("seller_create_purchase hat sich verändert");
    expect(SQL).toContain("seller_import_purchase_group ist verschwunden");
  });

  it("die Buchung und die Zustandsänderung an bestehenden Einkäufen", () => {
    for (const untouched of ["seller_book_purchase_item", "seller_set_purchase_item_state",
                             "seller_remove_purchase_item", "record_inventory_movement"]) {
      expect(SQL, untouched)
        .not.toContain(`create or replace function public.${untouched}(`);
    }
    /* Beide bleiben die Funktionen, die sie waren — einzeln, eine Position
       auf einmal. */
    expect(latestFunction("seller_book_purchase_item").body)
      .toContain("where id = p_item_id for update");
    expect(latestFunction("seller_book_purchase_item").body)
      .toContain("record_inventory_movement");
  });

  it("der Zustandsvorrat der Tabelle bleibt bei acht Werten", () => {
    expect(SQL).not.toContain("add constraint purchase_items_state_known");
    expect(SQL).not.toContain("drop constraint if exists purchase_items_state_known");
    /* Nur gelesen, als Vorbedingung. */
    expect(SQL).toContain("showcase fehlt im Zustands-CHECK");
  });

  it("purchases.purchased_at bleibt nullable", () => {
    expect(SQL).not.toMatch(/alter column purchased_at set not null/);
    expect(SQL).toContain("a.attnotnull into v_notnull");
    expect(SQL).toContain("ist NOT NULL geworden — der Bestand wäre verloren");
  });

  it("jede Variable der Nachbedingungen hat genau eine Bedeutung", () => {
    /*
     * Die Lehre aus 0117: ein `v_count` für drei Zählungen hat dort die
     * NOTICE-Ausgabe falsch gemacht. Hier heisst jede Zählung, was sie zählt.
     */
    const post = SQL.slice(SQL.lastIndexOf("-- 3. Nachbedingungen"));
    for (const named of ["v_overloads", "v_tokened", "v_unbooked", "v_notnull",
                         "v_conname", "v_args", "v_oid"]) {
      expect(post, named).toContain(named);
    }
    expect(post).not.toContain("v_count");
  });
});
