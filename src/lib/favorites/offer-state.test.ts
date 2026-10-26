import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { columnsOf, tablesOf } from "@/test-support/migrations";
import { EXCLUDED_TABLES } from "@/lib/backup/manifest";
import { PLATFORM_EXCLUDED_TABLES, platformSourceTables } from "@/lib/backup/platform-manifest";

/**
 * Der Angebotsspiegel (`0146`, Phase 4 Schritt S1).
 *
 * ARBEITSTEILUNG MIT P53. Probelauf **P53** in
 * `tools/validate-check-sql.mts` FÄHRT die Migration an echtem PostgreSQL:
 * sechzehn Szenarien, alle drei Preisquellen, Reservierungsflattern,
 * Drosselung, Rücknahme. Das ist der stärkere Nachweis.
 *
 * Hier stehen die Aussagen, die ein Lauf nicht zeigen kann:
 *
 *   * **die Antwort `locked`** — PGlite fährt EINE Verbindung, und ein
 *     Beratschlagungsschloss lässt dieselbe Sitzung wieder durch. Dass der
 *     Zweig existiert, dass er `locked` zurückgibt und dass er VOR dem
 *     Schreiben steht, ist am Text zu lesen und sonst nirgends;
 *   * **Absichten**: kein Trigger, keine Benachrichtigung, keine
 *     personenbezogene Spalte, keine zweite Preisrechnung;
 *   * **die Entscheidung in beiden Sicherungen**.
 */

const MIG = "supabase/migrations/0146_offer_state.sql";
const ROLLBACK = "supabase/rollback/R0146_drop_offer_state.sql";
const PRE = "supabase/checks/0146_preflight.sql";
const POST = "supabase/checks/0146_postflight.sql";

const datei = (p: string): string => readFileSync(p, "utf8");
const SQL = datei(MIG);

/** Die Datei ohne Kommentare — fragt, was sie TUT, nicht was sie sagt. */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((z) => !z.trimStart().startsWith("--"))
    .join("\n");
}
const CODE = code(SQL);
/** Nur der Rumpf von `refresh_offer_state()`. */
const RUMPF = CODE.slice(
  CODE.indexOf("create or replace function public.refresh_offer_state()"),
  CODE.indexOf("comment on function public.refresh_offer_state()"));


describe("die Tabelle, wie 0146 sie anlegt", () => {
  it("trägt die acht Spalten des Konzepts — plus die eine aus 0147", () => {
    /*
     * `columnsOf()` liest die GANZE Historie, nicht nur `0146`. Seit
     * `0147` (Phase 4 S2) kommt `buyable_since` dazu: die Phasengrenze, die
     * eine Preisänderung nicht zurücksetzt. Dass `0146` selbst acht legt,
     * prüft seine eigene Abschlussmeldung und Zeile 102 seiner
     * Nachkontrolle.
     */
    expect([...columnsOf("offer_state")].sort()).toEqual([
      /* Alphabetisch, und „cheapest" steht vor „checked" — 'a' < 'k'. */
      "announced_at", "announced_buyable", "announced_cents",
      "buyable", "buyable_since", "changed_at", "cheapest_cents", "checked_at",
      "sky_id",
    ]);
  });

  it("und 0146 selbst legt acht — als Messung in seiner Abschlussmeldung", () => {
    expect(SQL).toContain("offer_state steht (8 Spalten");
  });

  it("und `tablesOf()` sieht sie — sonst könnte kein Wächter nach ihr fragen", () => {
    expect(tablesOf()).toContain("offer_state");
  });

  it("eine Zeile je Figur, nicht je Ereignis", () => {
    expect(CODE).toContain("constraint offer_state_pk primary key (sky_id)");
  });

  it("die Katalogzeile bricht nicht unter dem Spiegel weg", () => {
    expect(CODE).toContain("references public.skylanders (sky_id)");
    expect(CODE).toContain("on delete restrict");
  });

  it("zwei Zeitstempel mit zwei Aufgaben, und ein CHECK dazwischen", () => {
    /*
     * `changed_at` ist die letzte ECHTE Änderung, `checked_at` die letzte
     * Prüfung. Dass eine Prüfung ohne Änderung die erste nicht zurücksetzt,
     * steht als CHECK da und nicht als Absicht.
     */
    expect(CODE).toContain("constraint offer_state_checked_after_changed");
    expect(CODE).toContain("check (checked_at >= changed_at)");
  });

  it("kaufbar heißt: es gibt einen Preis — und umgekehrt", () => {
    expect(CODE).toContain("constraint offer_state_price_consistent");
    expect(CODE).toMatch(/buyable and cheapest_cents is not null/);
    expect(CODE).toMatch(/not buyable and cheapest_cents is null/);
  });

  it("der Preis-CHECK lässt NULL Cent zu, und das ist Absicht", () => {
    /*
     * `shop_price()` rundet `market_price * percentage / 100` auf zwei
     * Dezimalstellen — bei einem sehr kleinen Marktwert kann daraus `0.00`
     * werden. Ein `> 0` hätte den ganzen Spiegellauf an einer solchen Zeile
     * abbrechen lassen, und ein Spiegel, der an echten Daten scheitert, ist
     * schlechter als einer, der eine Null abbildet.
     */
    expect(CODE).toContain("check (cheapest_cents is null or cheapest_cents >= 0)");
    expect(CODE).not.toContain("cheapest_cents > 0");
  });

  it("kein `seller_id` — der Zustand gehört der Figur (ADR-0021)", () => {
    /*
     * AM SCHEMA, NICHT AM TEXT. Der Tabellenkommentar sagt ausdrücklich
     * „Kein seller_id" — und eine Prüfung über die ganze Datei fand genau
     * diesen Satz, weil ein `comment on` ein Stringliteral ist und kein
     * Kommentar. Was nicht vorkommen darf, ist die SPALTE.
     */
    expect(columnsOf("offer_state")).not.toContain("seller_id");
    const tabelle = CODE.slice(CODE.indexOf("create table public.offer_state"),
                               CODE.indexOf("comment on table"));
    expect(tabelle.toLowerCase()).not.toContain("seller_id");
  });

  it("RLS an, KEINE Richtlinie, kein Clientrecht", () => {
    expect(CODE).toContain("alter table public.offer_state enable row level security");
    expect(CODE).toContain("revoke all on public.offer_state from public, anon, authenticated");
    /* Die Form der Handelstabellen seit `0010`: RLS ohne Richtlinie. */
    expect(CODE).not.toContain("create policy");
    expect(CODE).not.toContain("grant select on public.offer_state");
  });
});


describe("die Sicht ist die einzige fachliche Wahrheit", () => {
  const SICHT = CODE.slice(CODE.indexOf("create view public.offer_state_live"),
                           CODE.indexOf("comment on view"));

  it("sie liest `shop_offers()` und rechnet keinen Preis nach", () => {
    /*
     * DIE WICHTIGSTE ZUSAGE VON S1. Hier darf keine Prozentzahl, kein
     * Marktwert und keine Bestandsregel stehen — sonst gäbe es eine zweite
     * Definition von „kaufbar", und eine davon wäre irgendwann die falsche.
     */
    expect(SICHT).toContain("from public.shop_offers() o");
    for (const verboten of ["price_percentage", "market_price", "sale_price",
                            "available_quantity", "quantity", "reserved",
                            "is_listed", "shop_price(", "is_position_sellable"]) {
      expect(SICHT, verboten).not.toContain(verboten);
    }
  });

  it("sie nimmt `available` UND den V1-Zustand — dieselben zwei Filter wie der Code", () => {
    /*
     * `v1BuyableOffers()` in `src/lib/shop/offer.ts` filtert beides, obwohl
     * `shop_offers()` den Zustand seit `0029` selbst setzt. Zwei Orte,
     * dieselbe Regel — und der Spiegel soll „was V1 verkauft" bedeuten, auch
     * wenn die Projektion eines Tages breiter wird.
     */
    expect(SICHT).toContain("where o.available");
    expect(SICHT).toContain("o.condition = public.v1_sale_condition()");
    const ts = datei("src/lib/shop/offer.ts");
    expect(ts).toContain("offer.available && offer.condition === V1_CONDITION");
  });

  it("Cent als ganze Zahl, mit ausdrücklichem Rundungsvertrag", () => {
    expect(SICHT).toContain("min(round(o.price * 100))::integer");
  });

  it("`min` über die kaufbaren — mehrere Angebote einer Figur sind damit erledigt", () => {
    expect(SICHT).toContain("group by o.sky_id");
  });

  it("und kein Clientrecht auf sie", () => {
    expect(CODE).toContain(
      "revoke all on public.offer_state_live from public, anon, authenticated");
  });
});


describe("die Auffrischung: drei Antworten, zwei Riegel", () => {
  it("sie gibt `ran`, `throttled` und `locked` getrennt zurück", () => {
    /*
     * KEIN `boolean`. Ein Aufrufer darf `locked` niemals als eigenen Erfolg
     * lesen: der konkurrierende Lauf kann abbrechen, und dann hat NIEMAND
     * geprüft. Drei unterscheidbare Antworten sind die Voraussetzung dafür,
     * dass S2 das überhaupt merken kann.
     */
    expect(CODE).toContain(
      "returns table (ran boolean, reason text, rows_checked integer, rows_changed integer)");
    for (const grund of ["'ran'", "'throttled'", "'locked'"]) {
      expect(RUMPF, grund).toContain(grund);
    }
  });

  it("das Schloss steht VOR jedem Schreibvorgang", () => {
    const schloss = RUMPF.indexOf("pg_try_advisory_xact_lock");
    const schreiben = RUMPF.indexOf("insert into public.offer_state");
    expect(schloss).toBeGreaterThan(-1);
    expect(schreiben).toBeGreaterThan(-1);
    expect(schloss, "geschrieben wird vor dem Schloss").toBeLessThan(schreiben);
  });

  it("`try` und nicht warten — ein zweiter Besucher hängt nicht", () => {
    expect(RUMPF).toContain("pg_try_advisory_xact_lock(146, 1)");
    expect(RUMPF).not.toContain("pg_advisory_lock");
    expect(RUMPF).not.toContain("pg_advisory_xact_lock(146");
  });

  it("und es ist ein TRANSAKTIONSschloss — ein gescheiterter Lauf lässt keines zurück", () => {
    /*
     * `xact` fällt mit der Transaktion, auch bei einem Abbruch. Damit ist
     * „eine gescheiterte Aktualisierung muss beim nächsten geeigneten Aufruf
     * wieder möglich sein" keine Aufräumlogik, sondern die Bauform.
     */
    expect(RUMPF).toContain("_xact_lock");
  });

  it("die Drosselung wird ZWEIMAL geprüft — davor und darunter", () => {
    /*
     * Zwei Aufrufe, die die erste Prüfung gleichzeitig passieren, würden
     * sonst beide laufen. Ohne die Wiederholung unter dem Schloss wäre die
     * Drosselung eine Empfehlung statt einer Grenze.
     */
    const treffer = RUMPF.split("now() - v_letzte < public.offer_state_window()").length - 1;
    expect(treffer, "nur einmal geprüft").toBe(2);
    const schloss = RUMPF.indexOf("pg_try_advisory_xact_lock");
    const zweite = RUMPF.lastIndexOf("now() - v_letzte < public.offer_state_window()");
    expect(zweite, "die zweite Prüfung steht nicht unter dem Schloss")
      .toBeGreaterThan(schloss);
  });

  it("das Fenster ist eine Funktion, keine Zahl im Rumpf", () => {
    expect(RUMPF).toContain("public.offer_state_window()");
    expect(RUMPF).not.toContain("interval '1 minute'");
    expect(CODE).toContain("create or replace function public.offer_state_window()");
  });

  it("das Alter kommt aus `max(checked_at)` — keine zweite Wahrheit daneben", () => {
    /* Ein erfolgreicher Lauf setzt `checked_at` auf jeder Zeile, also ist
       das Maximum genau der Zeitpunkt des letzten Erfolgs. Kein
       zusätzlicher Zeitstempel, keine Hilfstabelle. */
    expect(RUMPF).toContain("select max(s.checked_at) into v_letzte");
    expect(CODE).not.toContain("offer_state_meta");
    expect(CODE).not.toContain("ran_at");
  });

  it("`changed_at` nur bei echter Änderung, `checked_at` bei jedem Lauf", () => {
    expect(RUMPF).toContain("s.buyable is distinct from true");
    expect(RUMPF).toContain("s.cheapest_cents is distinct from excluded.cheapest_cents");
    expect(RUMPF).toContain("else s.changed_at");
    expect(RUMPF).toContain("checked_at     = now()");
  });

  it("eine Zeile verschwindet nie — „nicht kaufbar“ ist ein Zustand", () => {
    /* Ohne ihn könnte die nächste Verfügbarkeit keine Kante sein. */
    expect(RUMPF).toContain("update public.offer_state s");
    expect(RUMPF).toContain("set buyable        = false");
    expect(RUMPF).not.toContain("delete from public.offer_state");
  });

  it("die Erstbefüllung legt jede Zeile BEREITS GEMELDET an", () => {
    /*
     * „Sichere Initialisierung ohne künstliche Benachrichtigungsereignisse":
     * ein Angebot, das seit Wochen steht, ist keine Neuigkeit. Jede SPÄTER
     * entstehende Zeile bekommt dagegen `announced_* = null` und ist damit
     * zu Recht eine.
     */
    expect(RUMPF).toContain("v_erst := not exists (select 1 from public.offer_state)");
    expect(RUMPF).toContain("case when v_erst then true end");
    expect(RUMPF).toContain("case when v_erst then l.cheapest_cents end");
    /* Und gelesen wird das UNTER dem Schloss. */
    const schloss = RUMPF.indexOf("pg_try_advisory_xact_lock");
    expect(RUMPF.indexOf("v_erst :=")).toBeGreaterThan(schloss);
  });

  it("die Zahl der Änderungen wird VOR dem Schreiben gezählt", () => {
    const zaehlen = RUMPF.indexOf("select count(*) into v_geaendert");
    const schreiben = RUMPF.indexOf("insert into public.offer_state");
    expect(zaehlen).toBeGreaterThan(-1);
    expect(zaehlen, "danach wäre die Antwort immer null").toBeLessThan(schreiben);
  });
});


describe("Sicherheit und Abgrenzung", () => {
  it("`definer` mit leerem `search_path`, und nur für `authenticated`", () => {
    expect(CODE).toContain("security definer");
    expect(CODE).toContain("set search_path = ''");
    expect(CODE).toContain(
      "revoke all on function public.refresh_offer_state() from public, anon");
    expect(CODE).toContain(
      "grant execute on function public.refresh_offer_state() to authenticated");
  });

  it("NICHT für `anon` — eine schreibende Funktion ohne Nutzen entsteht nicht", () => {
    /*
     * Abweichung vom Konzept, und bewusst: dort stand, auch ein anonymer
     * Shopbesucher dürfe auffrischen. Die Meldungen gehen an angemeldete
     * Sammler, und deren eigener Seitenaufbau frischt auf. Kommt niemand,
     * braucht niemand eine Meldung.
     */
    expect(CODE).not.toMatch(/grant execute on function public\.refresh_offer_state\(\)[^;]*anon/);
  });

  it("das Fenster hat gar kein Clientrecht", () => {
    expect(CODE).toContain(
      "revoke all on function public.offer_state_window() from public, anon, authenticated");
  });

  it("keine personenbezogenen Daten, nirgends", () => {
    /* Die Funktion nennt `favorites` nicht, liest es nicht und kennt keine
       `user_id`. Der Spiegel ist Shopzustand. */
    for (const wort of ["favorites", "user_id", "auth.uid", "profiles"]) {
      expect(CODE, wort).not.toContain(wort);
    }
  });

  it("KEIN TRIGGER — die zentrale Zusage, und sie steht als Messung da", () => {
    expect(CODE).not.toContain("create trigger");
    /* Und die Nachbedingung der Migration misst es selbst. */
    expect(SQL).toContain("Trigger mit offer_state im Namen");
    expect(POSTTEXT()).toContain("kein Trigger mit offer_state im Namen");
  });

  it("und S1 erzeugt KEINE Benachrichtigung", () => {
    for (const wort of ["notification", "notify", "favorite_notifications",
                        "read_at", "announced_buyable =", "announced_at ="]) {
      expect(RUMPF, wort).not.toContain(wort);
    }
    /* `announced_*` kommt genau einmal vor: in der Erstbefüllung. */
    expect(RUMPF.split("announced_buyable").length - 1).toBe(1);
  });

  it("sie fasst keine bestehende Tabelle schreibend an", () => {
    for (const verboten of ["update public.shop_inventory", "update public.skylanders",
                            "update public.shop_settings", "alter table public.shop_inventory",
                            "insert into public.favorites", "drop function public.shop_offers"]) {
      expect(CODE, verboten).not.toContain(verboten);
    }
  });

  function POSTTEXT(): string { return datei(POST); }
});


describe("`checked_at` ist KEINE Frischegarantie, und die Dateien sagen es", () => {
  /*
   * DER PUNKT, DEN DER BETREIBER BENANNT HAT. Steht im Spiegel „kaufbar"
   * und ist es nicht mehr, wäre eine Meldung daraus falsch — und kein
   * Zeitstempel kann das verhindern. Eine Minute Drosselung heißt nicht,
   * dass der Spiegel eine Minute alt ist, sondern dass er HÖCHSTENS jede
   * Minute nachgezogen wird.
   *
   * S1 kann die Garantie nicht geben. Was es kann, ist sie nicht zu
   * behaupten und die Voraussetzungen zu liefern. Diese Gruppe prüft, dass
   * genau das in den Dateien steht — eine Scheingarantie wäre schlimmer als
   * keine.
   */
  it("der Spaltenkommentar sagt ausdrücklich, was sie nicht beweist", () => {
    expect(SQL).toContain("comment on column public.offer_state.checked_at");
    expect(SQL).toContain("BEWEIST NICHT");
    expect(SQL).toContain("S2 muss gegen offer_state_live gegenpruefen");
  });

  it("der Funktionskommentar nennt den Vertrag für S2", () => {
    expect(SQL).toContain("DER VERTRAG FUER S2");
    expect(SQL).toContain("checked_at ist keine Frischegarantie");
  });

  it("und die drei Voraussetzungen sind wirklich da", () => {
    /* (1) die Gegenwart als lesbare Sicht, (2) das Alter je Zeile,
       (3) drei unterscheidbare Antworten. */
    expect(CODE).toContain("create view public.offer_state_live");
    expect(columnsOf("offer_state")).toContain("checked_at");
    expect(CODE).toContain("'locked'");
  });

  it("das Konzept führt den Vertrag als Pflicht für S2", () => {
    const konzept = datei("docs/FAVORITE_NOTIFICATIONS.md");
    expect(konzept).toContain("offer_state_live");
    expect(konzept).toMatch(/S2 MUSS/);
  });
});


describe("die Rücknahme", () => {
  const R = code(datei(ROLLBACK));

  it("nimmt in der richtigen Reihenfolge: Funktion, Sicht, Tabelle, Fenster", () => {
    const f = R.indexOf("drop function if exists public.refresh_offer_state");
    const v = R.indexOf("drop view if exists public.offer_state_live");
    const t = R.indexOf("drop table public.offer_state");
    const w = R.indexOf("drop function if exists public.offer_state_window");
    expect(f).toBeGreaterThan(-1);
    expect(v).toBeGreaterThan(f);
    expect(t).toBeGreaterThan(v);
    expect(w).toBeGreaterThan(t);
  });

  it("schützt den GEMELDETEN Stand hinter einem Schalter in der Datei", () => {
    /*
     * `buyable`, `cheapest_cents` und `changed_at` entstehen beim nächsten
     * Lauf neu — `announced_*` nicht. Wer sie verwirft und S2 läuft schon,
     * meldet jede Figur erneut.
     */
    expect(R).toContain("v_auch_gemeldet boolean := false");
    expect(R).toContain("GEMELDETEN Stand");
  });

  it("und prüft hinterher, dass sie NICHT zu viel mitgenommen hat", () => {
    for (const bleibt of ["public.shop_offers()", "public.v1_sale_condition()",
                          "public.reservation_ttl()", "public.shop_inventory",
                          "public.favorites"]) {
      expect(R, bleibt).toContain(bleibt);
    }
  });
});


describe("die beiden Prüfdateien", () => {
  const PRETEXT = datei(PRE);
  const POSTTEXT = datei(POST);

  it("sind rein lesend", () => {
    for (const [name, text] of [["preflight", PRETEXT], ["postflight", POSTTEXT]] as const) {
      const c = code(text).toLowerCase();
      for (const muster of [/\binsert\s+into\b/, /\bupdate\s+public\./,
                            /\bdelete\s+from\b/, /\bdrop\s+(table|function|view)\b/,
                            /\balter\s+table\b/, /\bcreate\s+(table|view)\b/,
                            /\btruncate\s+(table\s+)?public\./,
                            /\bgrant\s+/, /\brevoke\s+/]) {
        expect(c, `${name}: ${muster.source}`).not.toMatch(muster);
      }
    }
  });

  it("der Preflight prüft, dass es die shop_offers()-Fassung aus 0139 ist", () => {
    /*
     * Rechnet `0146` mit einer anderen Projektion als der, die der Shop
     * zeigt, ist der Spiegel von Anfang an falsch. Erkennbar an der fünften
     * Spalte und an `is_position_sellable()`.
     */
    expect(PRETEXT).toContain("sky_id,condition,price,available,delivery_scope");
    expect(PRETEXT).toContain("is_position_sellable(i.id)");
  });

  it("und er zählt KEINE Trigger — das war schon einmal der Fehler", () => {
    /*
     * In `0142` standen feste Geschäftszahlen als blockierende Sollwerte und
     * hielten ein Release an. Eine feste Trigger-Anzahl ist dieselbe Sorte
     * Konstante: eine berechtigte künftige Migration bricht sie. Blockierend
     * ist allein „keiner trägt offer_state im Namen".
     */
    expect(PRETEXT).toContain("Info: eigene Trigger auf shop_inventory");
    expect(PRETEXT).toContain(
      "(124, 'Kein Trigger', 'und keiner davon traegt offer_state im Namen'");
  });

  it("beide tragen die zwei Basisverträge unverändert", () => {
    for (const text of [PRETEXT, POSTTEXT]) {
      expect(text).toContain("skyisles-base-1|");
      expect(text).toContain("skyisles-coll-1|");
    }
    /* Und der Messblock ist zeichengleich der aus 0142–0145. */
    const block = (t: string) =>
      t.slice(t.indexOf("basis_mess as ("), t.indexOf("basis_feld as ("));
    expect(block(PRETEXT)).toBe(block(datei("supabase/checks/0145_preflight.sql")));
    expect(block(POSTTEXT)).toBe(block(datei("supabase/checks/0145_postflight.sql")));
  });

  it("der Postflight verlangt eine LEERE Tabelle", () => {
    /* Die Erstbefüllung gehört in den ersten Aufruf der Funktion, nicht in
       die Migration — sonst entstünden Zeilen, die niemand geprüft hat. */
    expect(POSTTEXT).toContain("die Migration hat KEINE Zeile angelegt");
  });

  it("und beide enden auf Zeile 9999 mit der Null", () => {
    for (const text of [PRETEXT, POSTTEXT]) {
      expect(text).toContain("blockierende Abweichungen (muss 0 sein)");
    }
  });
});


describe("der Spiegel ist in BEIDEN Sicherungen entschieden", () => {
  it("im Betriebsexport dauerhaft draußen, mit Grund", () => {
    expect(Object.keys(EXCLUDED_TABLES)).toContain("offer_state");
    const grund = EXCLUDED_TABLES.offer_state;
    expect(grund).toContain("shop_offers()");
    expect(grund).toContain("announced_");
  });

  it("in der Plattformsicherung vorübergehend draußen — MIT Bedingung (D-6)", () => {
    expect(Object.keys(PLATFORM_EXCLUDED_TABLES)).toContain("offer_state");
    const grund = PLATFORM_EXCLUDED_TABLES.offer_state;
    expect(grund).toContain("GEHOERT INS ARCHIV");
    expect(grund).toContain("0144");
    expect(grund).toContain("Production");
    expect(grund).toContain("announced_");
  });

  it("und ist noch KEIN Bereich — das ist der offene Punkt", () => {
    expect(platformSourceTables()).not.toContain("offer_state");
  });
});
