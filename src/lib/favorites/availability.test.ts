import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

import { join } from "node:path";

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


/* ==========================================================================
 * DIE TRIGGER-ERWARTUNG
 * ==========================================================================
 *
 * DER ABBRUCH VOM 2026-10-26. `0147` zählte Trigger an den Quellen und
 * erwartete **null** — und brach den Staging-Lauf mit sechs völlig legitimen
 * Triggern ab: Zeitstempel, Unveränderlichkeit von `sky_id` und
 * Lageridentität, Redaktionsprotokoll, Artikeltyp-Ableitung. Die Quellen
 * HABEN Trigger, und sie sollen sie haben.
 *
 * Dieselbe Sorte Fehler wie die Richtlinienzahl in `0142` und die
 * Trigger-Zahl, die `0146` bewusst VERMIED (es fragte nur nach Triggern mit
 * `offer_state` im Namen). Ich habe das beim Verbreitern kaputtgemacht.
 *
 * Jetzt eine benannte Erwartung — und die steht an drei Stellen: Migration,
 * Preflight, Nachkontrolle. Laufen sie auseinander, bricht die eine ab, wo
 * die andere durchlässt. Dieser Block hält sie zusammen UND gegen die
 * Migrationshistorie.
 */

describe("die sechs bekannten Trigger", () => {
  const DATEIEN = {
    Migration: MIG,
    Preflight: "supabase/checks/0147_preflight.sql",
    Nachkontrolle: "supabase/checks/0147_postflight.sql",
    Huelle: "supabase/operations/staging-0147.sql",
  } as const;

  /** Die Erwartungsliste aus einer Datei lesen — `tabelle.trigger`, sortiert. */
  const liste = (pfad: string): string[] => {
    const t = datei(pfad);
    const treffer = [...t.matchAll(/'(shop_inventory|skylanders|shop_settings|offer_state)\.(\w+)'/g)]
      .map((m) => `${m[1]}.${m[2]}`);
    return [...new Set(treffer)].sort();
  };

  /**
   * Was die Migrationen WIRKLICH an den Quellen anlegen.
   *
   * Nicht abgeschrieben: aus `create trigger <name> ... on public.<tabelle>`
   * gelesen, über die ganze Historie, und um später wieder entfernte
   * bereinigt.
   */
const BIS = "0151";

  /**
   * DIE HISTORIE BIS `0151`, und die Grenze ist kein Trick.
   *
   * Das Inventar in `0147`s vier Dateien beschreibt die Welt, fuer die es
   * geschrieben wurde. `0152` legt einen siebten Trigger an
   * (`skylanders_sync_catalog_status`, CAT-02B) — er hat mit dem
   * Angebotsspiegel nichts zu tun, und `0147`s eingefrorene Pruefdateien
   * nachtraeglich umzuschreiben waere der falsche Weg: sie sind der Nachweis
   * eines Laufs, keine lebende Liste.
   *
   * Die Zusage bleibt trotzdem scharf: der Vergleich endet bei `0151`, und
   * der eigene Test unten zaehlt auf, was danach hinzukam. Ein
   * UNANGEKUENDIGTER Trigger faellt also weiterhin auf — in genau einem der
   * beiden Tests.
   */
  const ausHistorie = (): string[] => {
    const quellen = new Set(["shop_inventory", "skylanders", "shop_settings"]);
    const da = new Set<string>();
    for (const f of readdirSync("supabase/migrations")
      .filter((x) => x.endsWith(".sql") && x.slice(0, 4) <= BIS).sort()) {
      const t = readFileSync(join("supabase/migrations", f), "utf8");
      for (const m of t.matchAll(
        /create\s+trigger\s+(\w+)[\s\S]{0,200}?\bon\s+public\.(\w+)/gi)) {
        if (quellen.has(m[2])) da.add(`${m[2]}.${m[1]}`);
      }
      for (const m of t.matchAll(
        /drop\s+trigger\s+(?:if exists\s+)?(\w+)\s+on\s+public\.(\w+)/gi)) {
        if (quellen.has(m[2])) da.delete(`${m[2]}.${m[1]}`);
      }
    }
    return [...da].sort();
  };

  it("und was NACH 0151 hinzukam, ist einzeln aufgezaehlt", () => {
    /*
     * Die Gegenprobe zur Grenze oben: jeder Trigger, den eine Migration nach
     * `0151` an einer der drei Quellen anlegt, steht hier mit Namen. Kommt
     * einer dazu, den niemand genannt hat, faellt dieser Test.
     */
    const quellen = new Set(["shop_inventory", "skylanders", "shop_settings"]);
    const spaeter = new Set<string>();
    for (const f of readdirSync("supabase/migrations")
      .filter((x) => x.endsWith(".sql") && x.slice(0, 4) > BIS).sort()) {
      const t = readFileSync(join("supabase/migrations", f), "utf8");
      for (const m of t.matchAll(/create\s+trigger\s+(\w+)[\s\S]{0,200}?\bon\s+public\.(\w+)/gi)) {
        if (quellen.has(m[2])) spaeter.add(`${m[2]}.${m[1]}`);
      }
    }
    expect([...spaeter].sort()).toEqual([
      /*
       * 0159, CAT-07: haelt die Variantenbeziehung eine Ebene tief. Ein
       * Fremdschluessel kann nicht in eine andere Zeile sehen — die
       * genannte Basisfigur muss selbst eine Basisfigur sein, und eine
       * Zeile mit Varianten wird selbst keine. Beide Richtungen, weil die
       * verbotene Kette von beiden Enden gebaut werden kann.
       */
      "skylanders.skylanders_variant_base_guard_trg",
      // 0152, CAT-02B: haelt catalog_status und catalog_visible in Deckung.
      "skylanders.skylanders_sync_catalog_status",
      /*
       * 0163, CAT-10: haelt `types` kanonisch — sortiert, jeder Wert
       * einmal. Er fuegt KEINEN Wert hinzu und entfernt keinen; „keine
       * Doppel" braucht eine Unterabfrage und geht in einer CHECK nicht,
       * also macht ein Trigger die Spalte kanonisch statt sie zu pruefen.
       * Er feuert nur bei `update of types` und bei `insert`, nicht bei
       * jeder Katalogaenderung.
       */
      "skylanders.skylanders_canonical_types",
    ].sort());
  });

  it("die Historie legt genau diese sechs an", () => {
    expect(ausHistorie()).toEqual([
      "shop_inventory.shop_inventory_identity_immutable",
      "shop_inventory.shop_inventory_set_updated_at",
      "skylanders.skylanders_item_type_from_category",
      "skylanders.skylanders_log_editorial",
      "skylanders.skylanders_set_updated_at",
      "skylanders.skylanders_sky_id_immutable",
    ]);
  });

  it("und Migration, Preflight, Nachkontrolle und Hülle führen dieselbe Liste", () => {
    /*
     * DIE DRIFTGEFAHR. Vier Dateien, eine Erwartung. Weicht eine ab, bricht
     * sie ab, wo die anderen durchlassen — oder umgekehrt, und das ist
     * schlimmer.
     */
    const erwartet = ausHistorie();
    for (const [name, pfad] of Object.entries(DATEIEN)) {
      expect(liste(pfad), `${name} (${pfad})`).toEqual(erwartet);
    }
  });

  it("keine der vier zählt Trigger mehr pauschal", () => {
    /*
     * DER FEHLGRIFF, als Regel. `count(*) ... = 0` über die Quellen ist
     * genau die Form, die am 2026-10-26 abgebrochen hat.
     */
    for (const [name, pfad] of Object.entries(DATEIEN)) {
      const text = code(datei(pfad));
      const stelle = text.indexOf("from pg_trigger");
      expect(stelle, `${name}: keine Triggerabfrage`).toBeGreaterThan(-1);
      /* Wo die Quellen zusammen abgefragt werden, muss eine Namensliste
         dabeistehen — nicht nur ein Zähler. */
      const alleVier = text.includes("to_regclass('public.shop_inventory')")
        && text.includes("to_regclass('public.skylanders')");
      if (alleVier) {
        expect(text, `${name}: Erwartungsliste fehlt`)
          .toContain("skylanders.skylanders_sky_id_immutable");
      }
    }
  });

  it("der Spiegel wird ZUERST geprüft — die präzisere Meldung gewinnt", () => {
    /*
     * Ein Trigger auf `offer_state` stünde auch nicht in der
     * Erwartungsliste, die ihn also ebenfalls fände. Dann hieße der Abbruch
     * aber „unerwarteter Trigger" statt „Trigger auf dem Spiegel", und das
     * ist die wichtigere Aussage der Phase 4.
     */
    const spiegel = CODE.indexOf("Trigger auf offer_state");
    const liste_ = CODE.indexOf("skylanders.skylanders_sky_id_immutable");
    expect(spiegel).toBeGreaterThan(-1);
    expect(liste_).toBeGreaterThan(spiegel);
  });

  it("und 0147 legt selbst keinen Trigger an", () => {
    expect(CODE).not.toMatch(/create\s+trigger/i);
  });
});
