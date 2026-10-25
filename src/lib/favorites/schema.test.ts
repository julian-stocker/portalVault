import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { code, columnsOf, tablesOf } from "@/test-support/migrations";
import { EXCLUDED_TABLES } from "@/lib/backup/manifest";
import { PLATFORM_EXCLUDED_TABLES, platformSourceTables } from "@/lib/backup/platform-manifest";

/**
 * Was `0145` zusagt — gelesen an der Migration, nicht an ihrer Beschreibung.
 *
 * WARUM DIESE DATEI UND NICHT NUR DER PROBELAUF. `P52` in
 * `tools/validate-check-sql.mts` FÄHRT die Migration an echtem PostgreSQL:
 * der Primärschlüssel greift, `favorite_demand()` weist ohne Betriebsrolle
 * ab, die Rücknahme schützt Zeilen. Das ist der stärkere Nachweis, aber er
 * läuft nur in `npm run check`, dauert Minuten und sagt nichts über
 * ABSICHTEN — etwa darüber, dass in dieser Datei kein `seller_id` vorkommen
 * darf und keine E-Mail-Funktion. Hier stehen die Aussagen, die am TEXT
 * hängen; dort die, die am VERHALTEN hängen.
 *
 * Beide zusammen, nicht eins statt des anderen.
 */

const MIG = "supabase/migrations/0145_favorites.sql";
const ROLLBACK = "supabase/rollback/R0145_drop_favorites.sql";
const PRE = "supabase/checks/0145_preflight.sql";
const POST = "supabase/checks/0145_postflight.sql";

const datei = (pfad: string): string => readFileSync(pfad, "utf8");
const SQL = datei(MIG);
const CODE = code(SQL);


describe("die Tabelle, wie 0145 sie anlegt", () => {
  it("trägt genau die drei Spalten, die der Auftrag nennt", () => {
    /*
     * `columnsOf` faltet jede Migration — ein spätere `alter table` käme
     * hier an. Dass heute nur `0145` die Tabelle anfasst, ist genau das,
     * was eine zusätzliche Spalte morgen auffallen lassen soll.
     */
    expect([...columnsOf("favorites")].sort())
      .toEqual(["created_at", "sky_id", "user_id"]);
  });

  it("und `tablesOf()` sieht sie — sonst könnte kein Wächter nach ihr fragen", () => {
    expect(tablesOf()).toContain("favorites");
  });

  it("der Primärschlüssel IST die Eindeutigkeit, nicht ein Zusatz daneben", () => {
    /*
     * „Keine doppelten Favoriten für dieselbe Kombination" ist damit kein
     * Zustand, den die Datenbank kennt und eine Nebenbedingung verbietet —
     * er ist nicht darstellbar.
     */
    expect(CODE).toContain("constraint favorites_pk primary key (user_id, sky_id)");
    expect(CODE).not.toContain("unique (user_id, sky_id)");
  });

  it("kein Surrogatschlüssel und kein updated_at — beides hätte nichts zu tun", () => {
    expect(columnsOf("favorites")).not.toContain("id");
    expect(columnsOf("favorites")).not.toContain("updated_at");
    /* Und also auch kein Trigger, der ihn pflegen müsste. */
    expect(CODE.toLowerCase()).not.toContain("create trigger");
  });

  it("die Katalogzeile bricht nicht unter einer Wunschliste weg", () => {
    expect(CODE).toContain("references public.skylanders (sky_id)");
    expect(CODE).toContain("on delete restrict");
  });

  it("und das Konto löschen löscht die Wunschliste mit (DSGVO)", () => {
    expect(CODE).toContain("references auth.users (id)");
    expect(CODE).toContain("on delete cascade");
  });

  it("der Index auf sky_id steht — die Nachfrage-Richtung", () => {
    expect(CODE).toContain("create index favorites_sky_id_idx");
    expect(CODE).toContain("on public.favorites (sky_id)");
  });
});


describe("wer eine Zeile sehen und ändern darf", () => {
  const RICHTLINIEN = ["favorites_select_own", "favorites_insert_own", "favorites_delete_own"];

  it("RLS ist an", () => {
    expect(CODE).toContain("alter table public.favorites enable row level security");
  });

  it("genau drei Richtlinien, und jede fragt BEIDE Hälften", () => {
    for (const name of RICHTLINIEN) {
      expect(CODE, name).toContain(`create policy ${name} on public.favorites`);
    }
    /* Drei `create policy` auf dieser Tabelle, nicht vier und nicht zwei. */
    const anzahl = CODE.split("create policy").length - 1;
    expect(anzahl).toBe(3);

    /* Und das Muster von `collection_items` NACH 0042: Konto UND Rolle. */
    const vorkommen = CODE.split("public.is_collector_account()").length - 1;
    expect(vorkommen, "is_collector_account in jeder der drei").toBeGreaterThanOrEqual(3);
  });

  it("es gibt KEINE update-Richtlinie — es gibt nichts zu ändern", () => {
    /*
     * Die engere Fassung von „keine fremden Favoriten ändern": der Weg
     * existiert nicht. `collection_items` braucht `with check`, damit
     * niemand seine Zeile einem fremden Konto zuschiebt; hier gibt es kein
     * `update`, über das das ginge.
     */
    expect(CODE).not.toContain("for update");
  });

  it("anon bekommt nichts, authenticated genau drei Rechte", () => {
    expect(CODE).toContain("revoke all on public.favorites from anon");
    expect(CODE).toContain("grant select, insert, delete on public.favorites to authenticated");
    /* Kein `update`, kein `truncate` — für truncate gilt RLS nicht. */
    expect(CODE).toContain(
      "revoke update, truncate, references, trigger on public.favorites from authenticated");
  });

  it("und jede der drei gilt für authenticated, keine für anon oder public", () => {
    /*
     * BLOCKWEISE, NICHT ZEILENWEISE. `create policy … on public.favorites`
     * steht auf einer Zeile, `for select to authenticated` auf der nächsten
     * — eine Prüfung je Zeile fand deshalb nichts und war grün, weil sie am
     * falschen Ort suchte. Gefunden beim ersten Lauf dieser Datei.
     */
    const bloecke = CODE.split("create policy ").slice(1);
    expect(bloecke).toHaveLength(3);
    for (const b of bloecke) {
      const kopf = b.slice(0, b.indexOf(";"));
      expect(kopf, kopf.split("\n")[0]).toContain("to authenticated");
      expect(kopf).not.toContain("to anon");
      expect(kopf).not.toContain("to public");
    }
  });
});


describe("favorite_demand() — Zahlen für den Betrieb, niemals Zeilen", () => {
  it("läuft als definer und stable, mit leerem search_path", () => {
    expect(CODE).toContain("create or replace function public.favorite_demand(");
    expect(CODE).toContain("security definer");
    expect(CODE).toContain("set search_path = ''");
    expect(CODE).toMatch(/returns table \(sky_id text, users integer\)/);
  });

  it("gibt AUSSCHLIESSLICH sky_id und die Anzahl zurück", () => {
    /*
     * DER KERN DER GANZEN FUNKTION. Eine `user_id` in ihrer Signatur wäre
     * genau das Leck, das sie verhindern soll — „nur aggregierte Zahlen,
     * niemals Nutzeridentitäten".
     */
    const signatur = CODE.slice(
      CODE.indexOf("create or replace function public.favorite_demand("),
      CODE.indexOf("as $$"));
    expect(signatur).not.toContain("user_id");
    expect(signatur).not.toContain("created_at");
  });

  it("fragt das Betriebstor, bevor sie etwas zählt", () => {
    const rumpf = CODE.slice(CODE.indexOf("as $$"));
    const tor = rumpf.indexOf("can_operate_active_seller()");
    const zaehlung = rumpf.indexOf("from public.favorites");
    expect(tor).toBeGreaterThan(-1);
    expect(zaehlung).toBeGreaterThan(-1);
    expect(tor, "das Tor steht VOR der Zählung").toBeLessThan(zaehlung);
  });

  it("ist für PUBLIC und anon nicht ausführbar", () => {
    expect(CODE).toContain("revoke all on function public.favorite_demand(text[]) from public, anon");
    expect(CODE).toContain("grant execute on function public.favorite_demand(text[]) to authenticated");
  });

  it("und hat eine Decke gegen den Unfall", () => {
    expect(CODE).toContain("> 2000");
  });
});


describe("was 0145 ausdrücklich NICHT tut", () => {
  it("kein seller_id, keine Marketplace-Struktur (ADR-0021, CLAUDE.md)", () => {
    /*
     * AM CODE, NICHT AM TEXT. Der Kopf der Migration schreibt ausdrücklich
     * „kein `seller_id`" — eine Prüfung über die ganze Datei fand genau
     * diesen Satz und schlug an. Was nicht vorkommen darf, ist die SACHE,
     * nicht ihr Name in einer Abgrenzung.
     */
    const c = CODE.toLowerCase();
    expect(c).not.toContain("seller_id");
    for (const wort of ["listing", "stripe", "payout", "provision", "coupon"]) {
      expect(c, wort).not.toContain(wort);
    }
  });

  it("heißt nicht wishlist_items — der Andockpunkt aus ADR-0021 bleibt frei", () => {
    expect(CODE).not.toContain("wishlist_items");
    /* Und trägt dessen `priority`-Spalte nicht. */
    expect(columnsOf("favorites")).not.toContain("priority");
  });

  it("keine E-Mail, keine Benachrichtigung, kein Versand", () => {
    for (const wort of ["resend", "send_mail", "notification", "email"]) {
      expect(CODE.toLowerCase(), wort).not.toContain(wort);
    }
  });

  it("fasst die Sammlung nicht an — sie kommt nur in den Vorbedingungen vor", () => {
    /*
     * `collection_items` darf GENANNT werden (die Richtlinien kopieren ihr
     * Muster, und die Rücknahme prüft, dass sie steht). Was nicht vorkommen
     * darf, ist ein Schreibzugriff.
     */
    for (const schreiben of ["insert into public.collection_items",
                             "update public.collection_items",
                             "delete from public.collection_items",
                             "alter table public.collection_items",
                             "drop table public.collection_items"]) {
      expect(CODE, schreiben).not.toContain(schreiben);
    }
  });

  it("und schreibt überhaupt in keine bestehende Tabelle", () => {
    /* Rein additiv: das einzige `create table` ist das eigene. */
    const anzahl = CODE.split("create table").length - 1;
    expect(anzahl).toBe(1);
    expect(CODE).toContain("create table public.favorites");
  });

  it("legt keine Zeile an, und sagt es in ihrer eigenen Nachbedingung", () => {
    expect(CODE).toContain("die Migration hat % Zeile(n) angelegt");
  });
});


describe("die Rücknahme", () => {
  const R = code(datei(ROLLBACK));

  it("nimmt die Funktion MIT — eine Funktion über einer fehlenden Tabelle ist kaputt", () => {
    const fn = R.indexOf("drop function if exists public.favorite_demand");
    const tab = R.indexOf("drop table public.favorites");
    expect(fn).toBeGreaterThan(-1);
    expect(tab).toBeGreaterThan(-1);
    expect(fn, "erst die Funktion, dann die Tabelle").toBeLessThan(tab);
  });

  it("schützt vorhandene Zeilen hinter einem Schalter in der Datei", () => {
    expect(R).toContain("v_auch_mit_daten boolean := false");
    expect(R).toContain("Zeile(n) stehen in der Tabelle");
  });

  it("und prüft hinterher, dass sie NICHT zu viel mitgenommen hat", () => {
    for (const bleibt of ["public.collection_items", "public.skylanders",
                          "public.is_collector_account()",
                          "public.can_operate_active_seller()"]) {
      expect(R, bleibt).toContain(bleibt);
    }
  });
});


describe("die beiden Prüfdateien", () => {
  const PRETEXT = datei(PRE);
  const POSTTEXT = datei(POST);

  it("sind rein lesend — ein einziges SELECT, kein Schreibwort", () => {
    for (const [name, text] of [["preflight", PRETEXT], ["postflight", POSTTEXT]] as const) {
      /*
       * ALS ANWEISUNGSANFANG, NICHT ALS TEILWORT. „Platzhalter" enthält
       * „alter ", und die erste Fassung dieser Prüfung schlug deshalb an
       * einem Fließtext an. `\b` vorn löst das: gesucht ist das Wort, das
       * eine Anweisung beginnt.
       *
       * UND MIT ZIEL, WO DAS WORT AUCH ALS TEXT VORKOMMT: Zeile 122 des
       * Postflights heißt „kein update, kein truncate (dafuer gilt RLS
       * nicht)" — das ist die Beschriftung einer Prüfung, kein `truncate`.
       * Gesucht ist deshalb `truncate public.…`, also das Wort MIT einem
       * Ziel im eigenen Schema.
       */
      const c = code(text).toLowerCase();
      for (const muster of [/\binsert\s+into\b/, /\bupdate\s+public\./,
                            /\bdelete\s+from\b/, /\bdrop\s+(table|function|policy)\b/,
                            /\balter\s+table\b/, /\bcreate\s+table\b/,
                            /\btruncate\s+(table\s+)?public\./,
                            /\bgrant\s+/, /\brevoke\s+/]) {
        expect(c, `${name}: ${muster.source}`).not.toMatch(muster);
      }
    }
  });

  it("der Preflight gibt BEIDE Basiszeilen aus, 900 und 901", () => {
    expect(PRETEXT).toContain("(900, 'BASIS'");
    expect(PRETEXT).toContain("(901, 'BASIS'");
    expect(PRETEXT).toContain("skyisles-base-1|");
    expect(PRETEXT).toContain("skyisles-coll-1|");
  });

  it("der Sammlungs-Vertrag hat fünf Felder, und das fünfte ist die Schutzsumme", () => {
    /*
     * Die feste, dokumentierte Reihenfolge:
     *   skyisles-coll-1|zeilen|konten|sammlung_md5|schutz
     */
    expect(PRETEXT).toContain("skyisles-coll-1|zeilen|konten|sammlung_md5|schutz");
    expect(PRETEXT).toContain("left(md5(kern), 12)");
    /* `k`, nicht `t`: zwei Verträge, zwei Namen — siehe den Kommentar an
       `coll_teil` im Postflight. */
    expect(POSTTEXT).toContain("k[5] = left(md5(array_to_string(k[2:4], '|')), 12)");
  });

  it("eine fehlende Sammlungs-Baseline ist eine BLOCKIERENDE Abweichung", () => {
    /* Zeile 821 hat eine Erwartung ('ja'), ist also kein Info-Feld. */
    expect(POSTTEXT).toContain("(821, 'Sammlung', 'eine Sammlungs-Baseline ist uebergeben worden'");
    expect(POSTTEXT).toMatch(/else 'ja' end from coll\), 'ja'\)/);
  });

  it("und der Platzhalter zählt NICHT als Baseline", () => {
    expect(POSTTEXT).toContain("'SAMMLUNG-HIER-EINSETZEN'");
    expect(POSTTEXT).toContain("'BASIS-HIER-EINSETZEN'");
  });

  it("die sieben Shop-Werte UND die drei Sammlungswerte werden verglichen, nicht gezeigt", () => {
    for (const nr of [811, 812, 813, 814, 815, 816, 817, 831, 832, 833]) {
      expect(POSTTEXT, `Zeile ${nr}`).toContain(`(${nr}, `);
    }
    /* Jeder dieser Vergleiche holt seinen Sollwert aus der übergebenen Zeile. */
    const vergleiche = POSTTEXT.split("(keine gueltige Basis)").length - 1;
    expect(vergleiche).toBe(10);
  });

  it("der Postflight liest proconfig AUSGEPACKT, nicht als Text", () => {
    /* Die Projektregel aus `migration-integrity.test.ts`: `set search_path = ''`
       liegt als `search_path=""` ab, ein Literalvergleich wäre ein Fehlalarm. */
    expect(POSTTEXT).toContain("substring(c from 'search\\_path=(.*)$')");
    expect(POSTTEXT).toContain("'\"\"'");
  });

  it("und beide Dateien enden auf Zeile 9999 mit der Null", () => {
    for (const text of [PRETEXT, POSTTEXT]) {
      expect(text).toContain("blockierende Abweichungen (muss 0 sein)");
    }
  });
});


describe("die Tabelle ist in BEIDEN Sicherungen entschieden", () => {
  /*
   * Die Wächter aus Phase 1 (ADR-0134) schlugen bei `favorites` an — beide,
   * und zwar namentlich. Das war ihre Aufgabe. Hier steht, WIE entschieden
   * wurde, damit die Begründung nicht nur im Kommentar lebt.
   */
  it("im Betriebsexport dauerhaft draußen, mit Grund", () => {
    expect(Object.keys(EXCLUDED_TABLES)).toContain("favorites");
    const grund = EXCLUDED_TABLES.favorites;
    expect(grund).toContain("user_id");
    expect(grund).toContain("favorite_demand");
  });

  it("in der Plattformsicherung vorübergehend draußen — MIT Bedingung und Ablauf", () => {
    /*
     * Die Zusage des Betreibers vom 2026-10-25: persönliche Nutzerdaten
     * bleiben nicht dauerhaft draußen. Dieser Test hält fest, dass der
     * Ausschluss seinen eigenen Ablauf benennt — ein Eintrag ohne diese
     * Sätze wäre der stille Dauerausschluss, den es nicht geben soll.
     */
    expect(Object.keys(PLATFORM_EXCLUDED_TABLES)).toContain("favorites");
    const grund = PLATFORM_EXCLUDED_TABLES.favorites;
    expect(grund).toContain("0144");
    expect(grund).toContain("Production");
    expect(grund).toMatch(/Folgemigration/);
    expect(grund).toMatch(/GEHOERT INS ARCHIV|gehört ins Archiv/);
  });

  it("und ist noch KEIN Bereich — das ist der offene Punkt, nicht der Endzustand", () => {
    expect(platformSourceTables()).not.toContain("favorites");
  });
});
