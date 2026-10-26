import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { columnsOf } from "@/test-support/migrations";
import { EXCLUDED_TABLES } from "@/lib/backup/manifest";
import { PLATFORM_EXCLUDED_TABLES } from "@/lib/backup/platform-manifest";

/**
 * Die Verfügbarkeitskante (`0147`, Phase 4 Schritt S2).
 *
 * ARBEITSTEILUNG MIT P55. Probelauf **P55** in
 * `tools/validate-check-sql.mts` FÄHRT beide Migrationen an echtem
 * PostgreSQL und durchläuft jeden Fall des Auftrags: nicht kaufbar →
 * kaufbar → 30 Minuten, Verschwinden vor Ablauf, kurze
 * Warenkorbreservierung, wiederholte Aufrufe, Erstbestand, zweiter Zyklus,
 * Varianten, Gegenprobe gegen die Gegenwart, Rücknahme. Das ist der
 * stärkere Nachweis.
 *
 * Hier stehen die Aussagen, die ein Lauf nicht zeigen kann:
 *
 *   * **echte Parallelität** — PGlite fährt EINE Verbindung. Dass
 *     gleichzeitige Aufrufe unkritisch sind, folgt daraus, dass die
 *     Entscheidung nichts schreiben KANN (`stable`), und das ist am Text zu
 *     lesen;
 *   * **Absichten**: kein Trigger, keine Tabelle, kein Scheduler, keine
 *     Benachrichtigung, kein Clientrecht, keine zweite Definition von
 *     „kaufbar";
 *   * **die Lücke, die diese Migration behebt**, und dass sie als Lücke
 *     dasteht und nicht als stille Annahme.
 */

const MIG = "supabase/migrations/0147_offer_availability.sql";
const ROLLBACK = "supabase/rollback/R0147_offer_availability.sql";

const datei = (p: string): string => readFileSync(p, "utf8");
const SQL = datei(MIG);

/** Die Datei ohne Kommentare — fragt, was sie TUT, nicht was sie sagt. */
const code = (text: string): string => text
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .filter((z) => !z.trimStart().startsWith("--"))
  .join("\n");

const CODE = code(SQL);


describe("0147 baut auf 0146 auf, ohne es umzudeuten", () => {
  it("setzt 0146 und 0010 ausdrücklich voraus", () => {
    for (const n of ["public.offer_state", "public.offer_state_live",
                     "public.reservation_ttl()", "public.offer_state_window()"]) {
      expect(CODE, n).toContain(n);
    }
    expect(CODE).toContain("0147 setzt 0146 voraus");
  });

  it("prüft VOR der Änderung, dass acht Spalten dastehen", () => {
    /* Eine andere Fassung als gedacht soll abbrechen, nicht raten. */
    expect(CODE).toMatch(/if v_n <> 8 then/);
    expect(SQL).toContain("erwartet werden die 8 aus");
  });

  it("legt genau EINE Spalte an, und keine Tabelle", () => {
    const spalten = [...CODE.matchAll(/add column (\w+)/g)].map((m) => m[1]);
    expect(spalten).toEqual(["buyable_since"]);
    expect(CODE).not.toMatch(/create table/i);
  });

  it("und deutet `changed_at` NICHT um", () => {
    /*
     * Die Spalte ist angewendet, ihr Kommentar steht, und die
     * Preisänderung ist das Signal für die späteren Preissenkungsmeldungen.
     * Zwei Fragen, zwei Spalten.
     */
    expect(CODE).not.toMatch(/comment on column public\.offer_state\.changed_at/);
    expect(SQL).toContain("Zwei Fragen, zwei\n-- Spalten.");
  });
});


describe("die Lücke steht als Lücke da", () => {
  it("der Dateikopf benennt beide Hälften", () => {
    /* Der Auftrag verlangte ausdrücklich: Lücke erklären, nicht stillschweigend
       eine fehleranfällige Lösung einbauen. */
    expect(SQL).toContain("EINE PREISAENDERUNG SETZT IHN ZURUECK");
    expect(SQL).toContain("EINE KURZE ABWESENHEIT IST HINTERHER NICHT VON EINER ECHTEN ZU");
    expect(SQL).toContain("EINE SPALTE BEHEBT BEIDES");
  });

  it("und sagt, warum keine Ereignistabelle", () => {
    expect(SQL).toContain("WARUM KEINE EREIGNISTABELLE");
    expect(SQL).toContain("ABLEITBAR");
  });
});


describe("die Phasengrenze", () => {
  it("bewegt sich nur bei einem echten Übergang nach kaufbar", () => {
    /*
     * Die drei Zweige in Worten: war schon kaufbar → bleibt; Abwesenheit
     * kürzer als die Reservierungsdauer → bleibt; sonst → jetzt.
     */
    const stelle = CODE.indexOf("buyable_since  = case");
    expect(stelle).toBeGreaterThan(-1);
    const zweig = CODE.slice(stelle, stelle + 420);
    expect(zweig).toContain("when s.buyable and s.buyable_since is not null");
    expect(zweig).toContain("now() - s.changed_at < public.reservation_ttl()");
    expect(zweig).toContain("else now()");
  });

  it("und eine Preisänderung kommt in diesem Zweig NICHT vor", () => {
    /* Genau das ist der Unterschied zu `changed_at` — und der Grund, warum
       S3 gegen diese Spalte rechnen darf. */
    const stelle = CODE.indexOf("buyable_since  = case");
    const zweig = CODE.slice(stelle, stelle + 420);
    expect(zweig).not.toContain("cheapest_cents");
  });

  it("bleibt stehen, wenn die Figur nicht mehr kaufbar ist", () => {
    /* Sonst könnte eine kurze Abwesenheit nicht als dieselbe Phase erkannt
       werden — der Rückstellungszweig fasst sie nicht an. */
    const stelle = CODE.indexOf("update public.offer_state s\n     set buyable        = false");
    expect(stelle).toBeGreaterThan(-1);
    const zweig = CODE.slice(stelle, stelle + 400);
    expect(zweig).not.toContain("buyable_since");
  });

  it("und jede kaufbare Zeile muss sie haben", () => {
    expect(CODE).toContain("offer_state_buyable_since_present");
    expect(CODE).toContain("check (not buyable or buyable_since is not null)");
  });
});


describe("die Entscheidung", () => {
  it("ist `stable` und kann deshalb nichts verbrauchen", () => {
    /*
     * DIE ZUSAGE AN S3. Ein Ereignis gilt erst als übernommen, wenn S3
     * `announced_*` setzt — in derselben Transaktion, in der es die
     * Meldungen anlegt. Wäre diese Funktion `volatile`, könnte sie ein
     * Ereignis verbrauchen, bevor es jemand übernehmen kann.
     */
    const stelle = CODE.indexOf("create or replace function public.offer_availability_due()");
    expect(stelle).toBeGreaterThan(-1);
    const kopf = CODE.slice(stelle, stelle + 300);
    expect(kopf).toContain("stable");
    expect(kopf).not.toContain("volatile");
    expect(kopf).toContain("security definer");
    expect(kopf).toContain("set search_path = ''");
  });

  it("schreibt in ihrem Rumpf nichts", () => {
    const stelle = CODE.indexOf("create or replace function public.offer_availability_due()");
    const rumpf = CODE.slice(stelle, CODE.indexOf("$$;", stelle));
    for (const wort of ["insert", "update", "delete", "set announced"]) {
      expect(rumpf.toLowerCase(), wort).not.toContain(wort);
    }
  });

  it("fragt alle vier Bedingungen", () => {
    const stelle = CODE.indexOf("create or replace function public.offer_availability_due()");
    const rumpf = CODE.slice(stelle, CODE.indexOf("$$;", stelle));
    /* kaufbar · stabil · noch nicht berichtet · und JETZT wirklich kaufbar */
    expect(rumpf).toContain("where s.buyable");
    expect(rumpf).toContain("now() - s.buyable_since >= public.offer_availability_grace()");
    expect(rumpf).toContain("s.announced_at is null or s.buyable_since > s.announced_at");
    expect(rumpf).toContain("join public.offer_state_live l on l.sky_id = s.sky_id");
  });

  it("die Gegenprobe ist ein INNERER Verbund, kein `left join`", () => {
    /*
     * Ein `left join` liesse eine Zeile stehen, die die Sicht nicht mehr
     * kennt — und genau die darf nicht gemeldet werden. Das ist die
     * Forderung aus dem Vertrag von `0146`.
     */
    const stelle = CODE.indexOf("create or replace function public.offer_availability_due()");
    const rumpf = CODE.slice(stelle, CODE.indexOf("$$;", stelle));
    expect(rumpf).not.toMatch(/left\s+join/i);
    expect(rumpf).toContain("join public.offer_state_live");
  });

  it("nennt keine Nutzer und keine personenbezogene Spalte", () => {
    /*
     * Wer vorgemerkt hat, entscheidet S3 — über `favorites.created_at <
     * buyable_since`. S2 kennt nur Figuren.
     *
     * Gefragt sind ZUGRIFFE, nicht Erwähnungen: der Funktionskommentar
     * nennt `favorites.created_at` ausdrücklich, weil dort steht, was S3
     * tun wird. Ein Kommentar liest keine Tabelle.
     */
    expect(CODE).not.toMatch(/(?:from|join|insert into|update)\s+public\.favorites/);
    expect(CODE).not.toMatch(/\buser_id\b(?![^\n]*')/);
    expect(CODE).not.toContain("auth.uid()");
  });

  it("und gibt das Alter des Spiegels mit zurück", () => {
    /* Keine Frischegarantie — die Angabe, die eine Frischeprüfung erst
       möglich macht. */
    expect(CODE).toContain("mirror_checked_at");
    expect(SQL).toContain("KEINE Frischegarantie");
  });
});


describe("die Karenzzeit", () => {
  it("steht als Beziehung zur Reservierungsdauer, nicht als Zahl", () => {
    expect(CODE).toContain("public.reservation_ttl() + interval '10 minutes'");
    /* Keine 30 im Code. */
    const stelle = CODE.indexOf("offer_availability_grace()");
    expect(CODE.slice(stelle, stelle + 400)).not.toContain("'30 minutes'");
  });

  it("und ist `immutable`", () => {
    const stelle = CODE.indexOf("create or replace function public.offer_availability_grace()");
    expect(CODE.slice(stelle, stelle + 200)).toContain("immutable");
  });
});


describe("was 0147 nicht anfasst", () => {
  it("kein Trigger, kein Scheduler, keine Benachrichtigung", () => {
    expect(CODE).not.toMatch(/create\s+trigger/i);
    for (const wort of ["pg_cron", "pg_net", "cron.schedule", "notification",
                        "notifications", "pg_notify"]) {
      expect(CODE.toLowerCase(), wort).not.toContain(wort);
    }
  });

  it("schreibt ausschliesslich in offer_state", () => {
    const ziele = new Set([
      ...[...CODE.matchAll(/insert into public\.(\w+)/g)].map((m) => m[1]),
      ...[...CODE.matchAll(/update public\.(\w+)/g)].map((m) => m[1]),
      ...[...CODE.matchAll(/alter table public\.(\w+)/g)].map((m) => m[1]),
    ]);
    expect([...ziele].sort()).toEqual(["offer_state"]);
  });

  it("und erteilt kein einziges Clientrecht", () => {
    expect(CODE).not.toMatch(/^grant /im);
    for (const f of ["offer_availability_due()", "offer_availability_grace()"]) {
      expect(CODE, f).toContain(
        `revoke all on function public.${f} from public, anon, authenticated`);
    }
  });

  it("die Nachfüllung macht keine GEMELDETE Zeile wieder fällig", () => {
    /*
     * ENGER GEFASST ALS ZUERST GEDACHT. Eine Zeile mit `announced_at is
     * null` ist ZU RECHT fällig — `0146` legt jede nach der Erstbefüllung
     * entstehende Zeile so an, weil eine neu kaufbare Figur eine Neuigkeit
     * ist. Die erste Fassung dieser Prüfung hätte die Migration
     * abgebrochen, sobald eine einzige Figur dazugekommen wäre: ein Abbruch
     * ohne Mangel.
     */
    expect(CODE).toContain(
      "announced_at is not null and buyable_since > announced_at");
    expect(SQL).toContain("bereits gemeldete Zeile(n) waeren nach der");
    expect(SQL).toContain("ein Abbruch ohne");
  });
});


describe("die Rücknahme", () => {
  const R = datei(ROLLBACK);

  it("nimmt in der umgekehrten Reihenfolge zurück", () => {
    /*
     * Gemessen am CODE, nicht am Kopfkommentar — der listet die vier
     * Schritte in derselben Reihenfolge auf, und `indexOf` fand sie dort
     * zuerst. Eine Reihenfolgeprüfung, die den Kommentar liest, prüft die
     * Absicht und nicht die Datei.
     */
    const rc = code(R);
    const due = rc.indexOf("drop function if exists public.offer_availability_due()");
    const refresh = rc.indexOf("create or replace function public.refresh_offer_state()");
    const spalte = rc.indexOf("drop column if exists buyable_since");
    const grace = rc.indexOf("drop function if exists public.offer_availability_grace()");
    expect(due).toBeGreaterThan(-1);
    expect(refresh).toBeGreaterThan(due);
    expect(spalte).toBeGreaterThan(refresh);
    expect(grace).toBeGreaterThan(spalte);
  });

  it("stellt refresh_offer_state() auf die Fassung aus 0146 zurück", () => {
    const r = code(R);
    const stelle = r.indexOf("create or replace function public.refresh_offer_state()");
    const rumpf = r.slice(stelle, r.indexOf("$$;", stelle));
    expect(rumpf).not.toContain("buyable_since");
    /* Aber alles andere bleibt: Drosselung, Schloss, Erstbefüllung. */
    expect(rumpf).toContain("pg_try_advisory_xact_lock(146, 1)");
    expect(rumpf).toContain("'throttled'");
    expect(rumpf).toContain("'locked'");
  });

  it("und fasst announced_* NICHT an", () => {
    /* Der gemeldete Stand ist der einzige nicht wiederherstellbare Teil des
       Spiegels — er gehört `0146`. */
    const r = code(R);
    expect(r).not.toMatch(/set announced_/);
    expect(r).not.toMatch(/drop column if exists announced_/);
    expect(R).toContain("announced_* unberuehrt");
  });

  it("sagt vorher, was verloren geht", () => {
    expect(R).toContain("WAS VERLOREN GEHT");
    expect(R).toContain("KEINE falsche Meldung");
  });
});


describe("die Spalte in den beiden Sicherungen", () => {
  it("`offer_state` bleibt in beiden Ausschlusslisten — 0147 ändert daran nichts", () => {
    /*
     * Der Spiegel steht mit Ablaufdatum aus der Plattformsicherung
     * (ADR-0136, D-6): die Folgemigration muss ihn hineinnehmen, nicht
     * diese. Eine neue Spalte auf einer ausgeschlossenen Tabelle ändert die
     * Entscheidung nicht — aber sie muss bewusst dastehen.
     */
    expect(Object.keys(PLATFORM_EXCLUDED_TABLES)).toContain("offer_state");
    expect(Object.keys(EXCLUDED_TABLES)).toContain("offer_state");
  });

  it("und die Migrationen führen die Spalte als letzte", () => {
    /* `columnsOf` liest die Historie; die Reihenfolge ist die, die der
       Postflight erwartet. */
    const spalten = columnsOf("offer_state");
    expect(spalten).toContain("buyable_since");
    expect(spalten).toHaveLength(9);
  });
});


describe("der Vertrag für S3", () => {
  it("steht als vollständige Anweisung im Kopf, nicht als Andeutung", () => {
    /*
     * S3 muss die Meldungen und den Vermerk in EINER Transaktion schreiben.
     * Damit das nachvollziehbar ist, steht die Anweisung ausgeschrieben in
     * der Migration — mit `returning`, denn daran erkennt S3, ob ihm das
     * Ereignis gehört.
     */
    expect(SQL).toContain("DER VERTRAG FUER S3");
    expect(SQL).toContain("update public.offer_state s");
    expect(SQL).toContain("returning s.sky_id;");
    expect(SQL).toContain("KOMMT KEINE ZEILE ZURUECK, IST DAS EREIGNIS SCHON UEBERNOMMEN");
  });

  it("und seine Bedingung läuft NICHT von der Entscheidung weg", () => {
    /*
     * DIE DRIFTGEFAHR. Dieselbe Fälligkeitsbedingung steht an zwei Stellen:
     * in `offer_availability_due()` und im dokumentierten `update` für S3.
     * Laufen sie auseinander, entstehen genau die Duplikate, die beide
     * verhindern sollen.
     *
     * Also: jede der drei Bedingungen der Funktion muss im Vertrag
     * wiederkehren. Textgleich, nur `s.` statt `s.` — die Funktion benutzt
     * denselben Alias.
     */
    const stelle = CODE.indexOf("create or replace function public.offer_availability_due()");
    const rumpf = CODE.slice(stelle, CODE.indexOf("$$;", stelle));
    const vertrag = SQL.slice(SQL.indexOf("DER VERTRAG FUER S3"),
                              SQL.indexOf("returning s.sky_id;"));
    for (const bedingung of [
      "s.buyable_since is not null",
      "now() - s.buyable_since >= public.offer_availability_grace()",
      "s.announced_at is null or s.buyable_since > s.announced_at",
    ]) {
      expect(rumpf, `Funktion: ${bedingung}`).toContain(bedingung);
      expect(vertrag, `Vertrag: ${bedingung}`).toContain(bedingung);
    }
  });

  it("er erklärt, warum die Bedingung an der ZEILE hängt", () => {
    /*
     * Eine `stable` Hilfsfunktion im `where` eines `update` sieht den
     * Schnappschuss der Anweisung, nicht die neu gelesene Zeile — sie würde
     * nach dem Warten auf die Sperre weiter `true` sagen. Das ist der Grund
     * gegen eine Hilfsfunktion, und er muss dastehen, sonst baut ihn jemand.
     */
    expect(SQL).toContain("UND DESHALB STEHT SIE AN DER ZEILE");
    expect(SQL).toContain("READ COMMITTED");
  });

  it("und nennt, was S3 NICHT von hier bekommt: die Konten", () => {
    expect(SQL).toContain("favorites.created_at < buyable_since");
  });
});
