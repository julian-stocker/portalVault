import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { columnsOf, tablesOf } from "@/test-support/migrations";
import { EXCLUDED_TABLES } from "@/lib/backup/manifest";
import { PLATFORM_EXCLUDED_TABLES } from "@/lib/backup/platform-manifest";

/**
 * Persönliche Verfügbarkeitsmeldungen (`0148`, Phase 4 Schritt S3).
 *
 * ARBEITSTEILUNG MIT P56. Probelauf **P56** fährt `0146`–`0148` an echtem
 * PostgreSQL und durchläuft jeden fachlichen Fall: zwei Nutzer vor der Phase
 * und einer danach, wiederholte Aufrufe, Preisänderung allein, kurze
 * Reservierung, zweiter echter Zyklus, Varianten, RLS mit drei Identitäten,
 * und „keine beanspruchte Phase ohne Meldung". Das ist der stärkere
 * Nachweis.
 *
 * Hier stehen die Aussagen, die ein Lauf nicht zeigen kann:
 *
 *   * **echte Gleichzeitigkeit** — PGlite fährt eine Verbindung. Dass zwei
 *     Aufrufe keine zwei Meldungen erzeugen, hängt am Primärschlüssel und
 *     an der Fälligkeitsbedingung im `where`, und das ist am Text zu lesen;
 *   * **Atomarität** — dass es genau EIN Statement ist;
 *   * **Absichten**: keine E-Mail, kein Push, kein Preisalarm, kein
 *     Scheduler, keine `read_at`-Spalte, kein Schreibweg für Clients, keine
 *     Nachfragezahl in der Rückgabe.
 */

const MIG = "supabase/migrations/0148_availability_notifications.sql";
const ROLLBACK = "supabase/rollback/R0148_availability_notifications.sql";

const datei = (p: string): string => readFileSync(p, "utf8");
const SQL = datei(MIG);

const code = (text: string): string => text
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").filter((z) => !z.trimStart().startsWith("--")).join("\n");

const CODE = code(SQL);
/** Der Rumpf der Funktion, ohne den Rest der Datei. */
const RUMPF = CODE.slice(
  CODE.indexOf("create or replace function public.claim_availability_notifications()"),
  CODE.indexOf("comment on function public.claim_availability_notifications()"));


describe("0148 setzt 0145, 0146 und 0147 voraus", () => {
  it("und prüft jedes davon, bevor es etwas anlegt", () => {
    for (const n of ["public.favorites", "public.offer_state",
                     "public.offer_availability_due()",
                     "public.offer_availability_grace()",
                     "public.is_collector_account()"]) {
      expect(CODE, n).toContain(n);
    }
    expect(CODE).toContain("offer_state.buyable_since fehlt");
  });

  it("und bricht ab, wenn die Tabelle schon steht", () => {
    expect(CODE).toContain("availability_notifications steht schon");
  });
});


describe("der Primärschlüssel IST der Duplikatschutz", () => {
  it("(user_id, sky_id, buyable_since)", () => {
    expect(CODE).toContain(
      "primary key (user_id, sky_id, buyable_since)");
  });

  it("und die Migration misst ihn, statt ihn anzunehmen", () => {
    /*
     * Eine Zusage, die nur im Kommentar steht, ist eine Absicht. Die
     * Migration liest den Schlüssel aus `pg_constraint` zurück.
     */
    expect(CODE).toContain("der Primaerschluessel ist (%)");
    expect(CODE).toContain("ER ist der Duplikatschutz");
  });

  it("die fünf Spalten, in dieser Reihenfolge", () => {
    expect([...columnsOf("availability_notifications")]).toEqual([
      "user_id", "sky_id", "buyable_since", "cheapest_cents", "created_at",
    ]);
    expect(CODE).toContain("'user_id,sky_id,buyable_since,cheapest_cents,created_at'");
  });

  it("und KEINE read_at-Spalte — das ist S4", () => {
    /*
     * Eine Spalte anzulegen, deren Mechanik noch fehlt, wäre Vorbereiten.
     * ADR-0021 untersagt genau das, und ADR-0136 hat es für `priority`
     * schon einmal abgelehnt.
     */
    expect([...columnsOf("availability_notifications")]).not.toContain("read_at");
    expect(SQL).toContain("KEINE `read_at`-Spalte");
  });

  it("und `tablesOf()` sieht die Tabelle — sonst könnte kein Wächter fragen", () => {
    expect(tablesOf()).toContain("availability_notifications");
  });
});


describe("die Verarbeitung ist EINE Anweisung", () => {
  it("ein `with`-Ausdruck, kein plpgsql", () => {
    expect(RUMPF).toContain("language sql");
    expect(RUMPF).not.toContain("plpgsql");
    expect(RUMPF).not.toContain("begin");
  });

  it("und die Migration MISST, dass es eine ist", () => {
    /*
     * DIE ATOMARITAETSZUSAGE. Mehr als ein Semikolon im Rumpf heißt mehr als
     * eine Anweisung — und dann gäbe es einen Zustand mit beanspruchtem
     * Ereignis und fehlenden Meldungen.
     */
    expect(CODE).toContain("mehr als eine Anweisung");
    expect(CODE).toContain("replace(v_t, ';', '')");
  });

  it("das insert liest aus dem returning des update", () => {
    /* Damit kann es nur für Zeilen schreiben, die DIESE Anweisung
       beansprucht hat. */
    expect(RUMPF).toContain("from beansprucht b");
    const upd = RUMPF.indexOf("update public.offer_state s");
    const ret = RUMPF.indexOf("returning s.sky_id, s.buyable_since, s.cheapest_cents");
    const ins = RUMPF.indexOf("insert into public.availability_notifications");
    expect(upd).toBeGreaterThan(-1);
    expect(ret).toBeGreaterThan(upd);
    expect(ins).toBeGreaterThan(ret);
  });

  it("und `on conflict do nothing` ist der zweite Riegel", () => {
    expect(RUMPF).toContain("on conflict do nothing");
  });
});


describe("die Fälligkeitsbedingung", () => {
  /*
   * WARUM DIESE PRUEFUNG HIER UND NICHT IN P56. Eine Mutationsprobe hat es
   * gezeigt: entfernt man die Bedingung aus dem `where`, bleibt P56 GRUEN.
   * Richtig so — sie wirkt nur unter ECHTER Gleichzeitigkeit, als
   * Nachprüfung unter der Zeilensperre, und PGlite fährt eine Verbindung.
   * Im einfädigen Lauf hat `offer_availability_due()` schon gefiltert und
   * der Primärschlüssel hält den Rest.
   *
   * Also steht die Zusage hier, am Text. Sie ist die Hälfte des
   * Duplikatschutzes, die man nicht fahren kann.
   */
  it("steht im `where` des update — das ist das Beanspruchen", () => {
    for (const bedingung of [
      "s.buyable_since is not null",
      "now() - s.buyable_since >= public.offer_availability_grace()",
      "s.announced_at is null or s.buyable_since > s.announced_at",
    ]) {
      expect(RUMPF, bedingung).toContain(bedingung);
    }
  });

  it("und ist textgleich mit der von 0147 — sonst laufen sie auseinander", () => {
    /*
     * DIE DRIFTGEFAHR, und sie ist dieselbe wie beim Vertrag im Kopf von
     * `0147`: zwei Stellen, eine Bedingung. Weichen sie ab, beansprucht die
     * eine, was die andere nicht für fällig hält.
     */
    const s0147 = readFileSync("supabase/migrations/0147_offer_availability.sql", "utf8");
    const vertrag = s0147.slice(s0147.indexOf("DER VERTRAG FUER S3"),
                                s0147.indexOf("returning s.sky_id;"));
    for (const bedingung of [
      "s.buyable_since is not null",
      "now() - s.buyable_since >= public.offer_availability_grace()",
      "s.announced_at is null or s.buyable_since > s.announced_at",
    ]) {
      expect(vertrag, `0147: ${bedingung}`).toContain(bedingung);
    }
  });

  it("die Erkennung kommt aus 0147, nicht aus 0148", () => {
    expect(RUMPF).toContain("public.offer_availability_due()");
    /* Keine zweite Definition von „kaufbar". */
    expect(RUMPF).not.toContain("offer_state_live");
    expect(RUMPF).not.toContain("shop_offers()");
    expect(CODE).toContain("eine zweite Erkennung ist nicht vorgesehen");
  });
});


describe("wer benachrichtigt wird", () => {
  it("wer VOR der Phasengrenze vorgemerkt hat", () => {
    expect(RUMPF).toContain("v.created_at < b.buyable_since");
  });

  it("und der Verbund läuft über die exakte sky_id", () => {
    expect(RUMPF).toContain("join public.favorites v on v.sky_id = b.sky_id");
    /* Keine Variantenlogik, kein Charakterbezug. */
    expect(RUMPF).not.toContain("character_id");
    expect(RUMPF).not.toContain("slug");
  });
});


describe("was die Funktion zurückgibt", () => {
  it("nur die Zahl für den Aufrufer", () => {
    expect(RUMPF).toContain("where user_id = (select auth.uid())");
    expect(RUMPF).toContain("returns integer");
  });

  it("und ausdrücklich keine Zahl je Figur — das wäre die Nachfrage", () => {
    /*
     * `favorite_demand()` ist nach ADR-0136 dem aktiven Verkäuferbetrieb
     * vorbehalten, damit ein Sammler nicht erfährt, wie viele andere eine
     * Figur vorgemerkt haben. Eine Rückgabe „SKY-0001: 7" hätte diese
     * Grenze umgangen, ohne dass jemand eine Richtlinie angefasst hätte.
     */
    expect(RUMPF).not.toMatch(/returns\s+table/i);
    expect(RUMPF).not.toContain("group by");
    expect(SQL).toContain("die Begrenzung von");
    expect(SQL).toContain("waere umgangen");
  });
});


describe("die Sicherheit", () => {
  it("RLS an, genau EINE Richtlinie, nur lesen", () => {
    expect(CODE).toContain(
      "alter table public.availability_notifications enable row level security");
    const policies = [...CODE.matchAll(/create policy (\w+)/g)].map((m) => m[1]);
    expect(policies).toEqual(["availability_notifications_select_own"]);
    expect(CODE).toContain("for select to authenticated");
    expect(CODE).toContain("(select auth.uid()) = user_id and public.is_collector_account()");
  });

  it("und die Rechte durch ENTZIEHEN, nicht durch Hoffen", () => {
    /* Supabase setzt ALTER DEFAULT PRIVILEGES: jedes `create table` gibt
       anon, authenticated und service_role automatisch ALL. */
    expect(CODE).toContain("revoke all on public.availability_notifications from anon");
    expect(CODE).toContain(
      "revoke all on public.availability_notifications from authenticated");
    expect(CODE).toContain("grant select on public.availability_notifications to authenticated");
  });

  it("kein Schreibweg für Clients — auch kein update", () => {
    expect(CODE).not.toMatch(/grant\s+(insert|update|delete)\s+on\s+public\.availability_notifications/);
    expect(CODE).not.toContain("for insert to authenticated");
    expect(CODE).not.toContain("for update to authenticated");
    expect(CODE).not.toContain("for delete to authenticated");
  });

  it("die Funktion: definer, volatile, leerer Pfad, nur authenticated", () => {
    expect(RUMPF).toContain("security definer");
    expect(RUMPF).toContain("volatile");
    expect(RUMPF).toContain("set search_path = ''");
    expect(CODE).toContain(
      "revoke all on function public.claim_availability_notifications() from public, anon");
    expect(CODE).toContain(
      "grant execute on function public.claim_availability_notifications() to authenticated");
  });

  it("und die Migration misst jedes dieser Rechte", () => {
    expect(CODE).toContain("erwartet nur SELECT");
    expect(CODE).toContain("Recht(e) fuer anon oder PUBLIC");
    expect(CODE).toContain("EXECUTE fuer anon oder PUBLIC");
  });
});


describe("was 0148 nicht tut", () => {
  it("keine E-Mail, kein Push, kein Preisalarm, kein Scheduler", () => {
    /*
     * GEFRAGT WIRD DER CODE OHNE ZEICHENKETTEN. Der Funktionskommentar
     * ZUSICHERT „erzeugt keine E-Mail, keine Push-Nachricht, keinen
     * Preisalarm" — das ist eine Zusage und kein Mechanismus. Eine Prüfung,
     * die darauf anschlägt, verwechselt beides (schon zweimal passiert).
     */
    const ohneZeichenketten = CODE.replace(/'(?:[^']|'')*'/g, "''");
    for (const mechanismus of ["pg_cron", "pg_net", "cron.schedule", "pg_notify",
                               "net.http", "supabase_functions", "extensions.http"]) {
      expect(ohneZeichenketten.toLowerCase(), mechanismus).not.toContain(mechanismus);
    }
    /* Und die Zusage soll dastehen — im Kommentar und im Funktionskommentar. */
    expect(SQL).toContain("keine E-Mail");
    expect(SQL).toContain("Erzeugt keine E-Mail");
  });

  it("kein Trigger — und die Migration misst es", () => {
    expect(CODE).not.toMatch(/create\s+trigger/i);
    expect(CODE).toContain("unerwartete Trigger");
  });

  it("schreibt nur in die neue Tabelle und in offer_state.announced_*", () => {
    const ziele = new Set([
      ...[...CODE.matchAll(/insert into public\.(\w+)/g)].map((m) => m[1]),
      ...[...CODE.matchAll(/update public\.(\w+)/g)].map((m) => m[1]),
      ...[...CODE.matchAll(/alter table public\.(\w+)/g)].map((m) => m[1]),
    ]);
    expect([...ziele].sort()).toEqual(["availability_notifications", "offer_state"]);
  });

  it("und legt keine Meldung an", () => {
    expect(CODE).toContain("sie legt");
    expect(CODE).toContain("keine an");
  });
});


describe("die Tabelle in den beiden Sicherungen", () => {
  it("Plattformsicherung: vorübergehend draußen, mit Ablaufdatum", () => {
    const grund = PLATFORM_EXCLUDED_TABLES["availability_notifications"];
    expect(grund).toBeDefined();
    expect(grund).toContain("GEHOERT INS ARCHIV");
    expect(grund).toContain("Formatversion 3");
    expect(grund).toContain("VOR");
  });

  it("Betriebssicherung: dauerhaft draußen, und das steht da", () => {
    const grund = EXCLUDED_TABLES["availability_notifications"];
    expect(grund).toBeDefined();
    expect(grund).toContain("dauerhaft");
    expect(grund).toContain("Plattformsicherung");
  });
});


describe("die Rücknahme", () => {
  const R = datei(ROLLBACK);

  it("nimmt den Schreiber vor dem Geschriebenen zurück", () => {
    const fn = R.indexOf("drop function if exists public.claim_availability_notifications()");
    const tab = R.indexOf("drop table if exists public.availability_notifications");
    expect(fn).toBeGreaterThan(-1);
    expect(tab).toBeGreaterThan(fn);
  });

  it("sagt vorher, wie viele Meldungen verschwinden", () => {
    expect(R).toContain("gespeicherte Meldung(en) werden geloescht");
  });

  it("und sagt die Folge: diese Phasen gelten weiter als gemeldet", () => {
    /*
     * `offer_state.announced_*` bleibt. Nach einer Rücknahme und einem
     * erneuten `0148` entsteht für DIESE Phasen also keine neue Meldung —
     * lieber eine verlorene Anzeige als eine zweite Benachrichtigung.
     */
    expect(R).toContain("gelten also weiter als");
    expect(R).toContain("lieber eine verlorene Anzeige");
  });

  it("und fasst offer_state, favorites und 0147 nicht an", () => {
    const r = code(R);
    expect(r).not.toMatch(/drop\s+(table|function|view)\s+(?:if exists\s+)?public\.offer_state/);
    expect(r).not.toMatch(/drop\s+table\s+(?:if exists\s+)?public\.favorites/);
    expect(r).not.toContain("drop function if exists public.offer_availability_due");
    expect(r).toContain("0146/0147 sind beschaedigt");
  });
});
