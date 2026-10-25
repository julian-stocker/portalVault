import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

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

  /**
   * Jede Prüfzeile des `values`-Blocks als eigener Brocken.
   *
   * Nötig, weil die Frage „was erwartet DIESE Zeile" nur auf einer ganzen
   * Zeile beantwortbar ist: der Sollwert steht am Ende, die Abfrage in der
   * Mitte. Die erste Fassung dieses Wächters schnitt am ersten `),` ab und
   * las damit einen leeren Abschnitt — sie hätte die alte Formulierung
   * **nicht** gefangen. Gemerkt habe ich es, weil ich sie gegen
   * `git show HEAD:…` gefahren habe, statt sie zu behaupten.
   */
  function pruefzeilen(text: string): string[] {
    const block = text.slice(text.indexOf("as (values"));
    return block.split("\n  (").slice(1).map((z) => `(${z}`);
  }

  it("zaehlt KEINE Richtlinien von collection_items — sie prueft Eigenschaften", () => {
    /*
     * DER REGRESSIONSTEST ZU EINEM FEHLER, DEN DIESES PROJEKT ZWEIMAL HATTE.
     *
     * Beide Dateien verlangten „genau vier Richtlinien" auf
     * `collection_items`. Auf Staging sind es fünf: `staging-agent-setup.sql`
     * legt die Lesepolicy `agent_read_collection_items` für die Rolle
     * `skyisles_agent` an (`docs/SECURITY.md` 4b). `0142` hatte denselben
     * Fehler, er wurde am 2026-10-22 gefunden und dort berichtigt — und
     * `0145` hat die ALTE Formulierung kopiert statt der neuen. Gefunden hat
     * es der Betreiber beim Preflight-Lauf am 2026-10-25.
     *
     * Eine Zahl ist hier die falsche Frage: sie bricht an einer berechtigten
     * Diagnosepolicy und sagt nichts darüber, ob die VIER, auf die es
     * ankommt, noch stehen.
     *
     * DIE REGEL, die dieser Test durchsetzt: wer über `pg_policies` dieser
     * Tabelle zählt und eine POSITIVE Zahl erwartet („so viele müssen da
     * sein"), muss die Richtlinien benennen. Eine Erwartung von `0` („nichts
     * dieser Art existiert") darf und soll das nicht — sonst liefe sie an
     * dem vorbei, wonach sie sucht.
     */
    for (const [name, text] of [["preflight", PRETEXT], ["postflight", POSTTEXT]] as const) {
      const verstoesse = pruefzeilen(text).filter((z) =>
        z.includes("tablename = 'collection_items'")
        && z.includes("count(*)")
        && !z.includes("policyname in")
        && /,\s*'[1-9][0-9]*'\)/.test(z));
      expect(verstoesse.map((z) => z.split("\n")[0]),
             `${name}: zählt Richtlinien statt sie zu benennen`).toEqual([]);
    }
  });

  it("nennt die vier beim Namen und laesst die Agentenpolicy AUSDRUECKLICH zu", () => {
    for (const [name, text] of [["preflight", PRETEXT], ["postflight", POSTTEXT]] as const) {
      for (const richtlinie of ["collection_items_select_own", "collection_items_insert_own",
                                "collection_items_update_own", "collection_items_delete_own"]) {
        expect(text, `${name}: ${richtlinie}`).toContain(richtlinie);
      }
      /* Zugelassen nur in ihrer bekannten Form — Befehl, Rolle und
         Permissivität werden mitgeprüft, nicht nur der Name. */
      expect(text, name).toContain("p.policyname = 'agent_read_collection_items'");
      expect(text, name).toContain("p.cmd = 'SELECT'");
      expect(text, name).toContain("array_to_string(p.roles, '+') = 'skyisles_agent'");
    }
  });

  it("und eine unbekannte weitere Richtlinie faellt trotzdem auf", () => {
    /*
     * Der Punkt, an dem diese Fassung über die von `0142` hinausgeht: dort
     * werden die vier geprüft und alles andere übergangen. Hier muss die
     * Menge „weder eine der vier noch die bekannte Agentenpolicy" LEER
     * sein — eine sechste Richtlinie ist eine blockierende Abweichung.
     */
    for (const [name, nr] of [["preflight", 125], ["postflight", 145]] as const) {
      const text = name === "preflight" ? PRETEXT : POSTTEXT;
      expect(text, name).toContain(`(${nr}, `);
      const block = text.slice(text.indexOf(`(${nr}, `));
      expect(block.slice(0, block.indexOf("),")), name).toContain("not (p.policyname in");
    }
  });

  it("und beide Dateien enden auf Zeile 9999 mit der Null", () => {
    for (const text of [PRETEXT, POSTTEXT]) {
      expect(text).toContain("blockierende Abweichungen (muss 0 sein)");
    }
  });
});


describe("die Staging-Nachkontrolle traegt ihre gemessenen Baselines", () => {
  /*
   * WAS HIER GEPRUEFT WIRD UND WARUM ES NICHT TRIVIAL IST.
   *
   * `staging-s-postflight-0145.sql` trug Platzhalter, der erste Lauf endete
   * mit `9999 = 18` — genau die achtzehn Zeilen der Baseline-Uebergabe, alles
   * andere grün. Die gemessenen Werte stehen jetzt in der Datei, damit der
   * Wiederholungslauf ohne Handarbeit durchläuft.
   *
   * Zwei Dinge dürfen dabei nicht schiefgehen, und beide stehen unten:
   *
   *   1. Die Werte müssen UNBESCHÄDIGT sein. Sie sind durch einen
   *      SQL-Editor, einen Chat und eine Datei gereist. Dafür trägt jede
   *      Zeile ihre Schutzsumme — und dieser Test rechnet sie nach, statt
   *      sie anzusehen.
   *   2. Sie dürfen NICHT nach Production wandern. Dort werden sie frisch
   *      gemessen; eine eingebaute Staging-Zahl wäre dort ein Sollwert, den
   *      niemand gemessen hat, und würde entweder blockieren oder — schlimmer
   *      — zufällig passen.
   */
  const STAGING_POST = "supabase/operations/staging-s-postflight-0145.sql";
  const PROD_POST = "supabase/operations/prod-s-postflight-0145.sql";
  const STAGING_PRE = "supabase/operations/staging-s-preflight-0145.sql";
  const PROD_PRE = "supabase/operations/prod-s-preflight-0145.sql";

  /** Die Werte, die eine Hülle wirklich setzt — aus dem ausführbaren Teil. */
  function gesetzt(pfad: string): Record<string, string> {
    const text = datei(pfad);
    const out: Record<string, string> = {};
    for (const m of text.matchAll(
      /^select set_config\('(skyisles\.[a-z]+)',\s*\n?\s*'([^']*)', true\);/gm)) {
      out[m[1]] = m[2];
    }
    return out;
  }

  /** `left(md5(<die Felder ohne Marke und ohne Summe>), 12)`, wie im SQL. */
  function schutz(zeile: string): { ok: boolean; felder: number; marke: string } {
    const t = zeile.split("|");
    const kern = t.slice(1, t.length - 1).join("|");
    return {
      ok: createHash("md5").update(kern).digest("hex").slice(0, 12) === t[t.length - 1],
      felder: t.length,
      marke: t[0],
    };
  }

  it("setzt beide Werte, und zwar echte statt Platzhalter", () => {
    const werte = gesetzt(STAGING_POST);
    expect(Object.keys(werte).sort()).toEqual(["skyisles.base", "skyisles.coll"]);
    expect(werte["skyisles.base"]).not.toContain("HIER-EINSETZEN");
    expect(werte["skyisles.coll"]).not.toContain("HIER-EINSETZEN");
  });

  it("und beide sind unbeschaedigt — die Schutzsumme nachgerechnet, nicht angesehen", () => {
    /*
     * DER TEST, DER EINEN TIPPFEHLER FINDET. Eine verlorene Stelle in einer
     * Zahl, zwei vertauschte Felder, eine abgeschnittene Zeile: alles davon
     * ändert die Summe. Ohne diese Prüfung fiele es erst auf Staging auf —
     * als rote Zeile 804 oder 824, und dann rätselt jemand, ob sich der Shop
     * bewegt hat oder ob eine Ziffer fehlt.
     */
    const werte = gesetzt(STAGING_POST);
    const base = schutz(werte["skyisles.base"]);
    expect(base.marke).toBe("skyisles-base-1");
    expect(base.felder).toBe(9);
    expect(base.ok, "die Schutzsumme der Shop-Baseline stimmt nicht").toBe(true);

    const coll = schutz(werte["skyisles.coll"]);
    expect(coll.marke).toBe("skyisles-coll-1");
    expect(coll.felder).toBe(5);
    expect(coll.ok, "die Schutzsumme der Sammlungs-Baseline stimmt nicht").toBe(true);
  });

  it("beide stehen in DERSELBEN Klammer wie die Abfrage", () => {
    /*
     * `set_config(…, true)` gilt nur in seiner Transaktion, und der
     * SQL-Editor führt jeden Lauf getrennt aus. Stünden die Zeilen außerhalb
     * der Klammer, käme die Nachkontrolle ohne Baseline an — und blockierte
     * zu Recht.
     */
    const text = datei(STAGING_POST);
    const beginn = text.indexOf("\nbegin;");
    const konfig = text.indexOf("select set_config('skyisles.base'");
    const abfrage = text.indexOf(">>> EINGEBETTET: supabase/checks/0145_postflight.sql");
    const ende = text.indexOf("\nrollback;");
    expect(beginn).toBeGreaterThan(-1);
    expect(konfig).toBeGreaterThan(beginn);
    expect(abfrage).toBeGreaterThan(konfig);
    expect(ende).toBeGreaterThan(abfrage);
    /* Und genau eine Klammer, die mit `rollback` endet. */
    const zeilen = text.split("\n").map((z) => z.trim());
    expect(zeilen.filter((z) => z === "begin;")).toHaveLength(1);
    expect(zeilen.filter((z) => z === "rollback;")).toHaveLength(1);
    expect(zeilen.filter((z) => z === "commit;")).toHaveLength(0);
  });

  it("PRODUCTION traegt weiter Platzhalter — und KEINEN Staging-Wert", () => {
    /*
     * Die wichtigste Zeile dieser Gruppe. Eine Staging-Zahl in der
     * Production-Hülle wäre ein Sollwert, den auf Production niemand gemessen
     * hat. Er würde dort entweder blockieren (und jemand sucht den Fehler am
     * falschen Ende) oder zufällig passen (und der Vergleich sagt nichts).
     */
    const werte = gesetzt(PROD_POST);
    expect(werte["skyisles.base"]).toBe("BASIS-HIER-EINSETZEN");
    expect(werte["skyisles.coll"]).toBe("SAMMLUNG-HIER-EINSETZEN");

    const staging = gesetzt(STAGING_POST);
    const prod = datei(PROD_POST);
    for (const wert of Object.values(staging)) {
      expect(prod, "ein Staging-Wert steht in der Production-Huelle")
        .not.toContain(wert);
      /* Auch kein Einzelfeld daraus — etwa der Angebots-Abdruck. */
      for (const feld of wert.split("|").slice(1, -1)) {
        if (feld.length >= 8) expect(prod, feld).not.toContain(feld);
      }
    }
  });

  it("und die beiden Preflights setzen ueberhaupt nichts — sie MESSEN", () => {
    for (const p of [STAGING_PRE, PROD_PRE]) {
      expect(Object.keys(gesetzt(p)), p).toEqual([]);
    }
  });

  it("die Werte gelten erklaert NUR fuer diesen einen Lauf", () => {
    /*
     * Eine eingebaute Zahl ohne diesen Satz wird beim naechsten Mal kopiert.
     * Der Kasten im Kopf sagt, wofuer sie NICHT gilt — Production, eine
     * spaetere Migration, ein zweiter Lauf zu einem anderen Zeitpunkt.
     */
    const kopf = datei(STAGING_POST).slice(0, datei(STAGING_POST).indexOf("\nbegin;"));
    expect(kopf).toContain("AUSSCHLIESSLICH ZUM STAGING-ROLLOUT VON");
    expect(kopf).toContain("2026-10-25");
    expect(kopf).toContain("KEIN Sollwert");
    expect(kopf).toContain("nicht fuer Production");
    expect(kopf).toContain("nicht fuer eine spaetere Migration");
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
