/**
 * `0135` — der Katalog bekommt einen Artikeltyp (ADR-0128, Schritt Z1).
 *
 * WAS DIESE DATEI PRÜFT UND WAS NICHT. Sie liest SQL-Text und
 * Anwendungsquelltext; sie beweist **kein** Datenbankverhalten. Dass die
 * Angebotsliste nach der Migration dieselbe ist, beweist allein die Migration
 * selbst — sie nimmt den Abdruck innerhalb ihrer Transaktion und bricht ab,
 * wenn er abweicht. Hier wird festgehalten, dass sie es TUT.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";

import { BACKUP_SECTIONS } from "@/lib/backup/manifest";
import { NON_COLLECTIBLE_CATEGORIES } from "@/lib/catalog/collectible";

const MIG = readFileSync("supabase/migrations/0135_catalog_item_type.sql", "utf8");
const PRE = readFileSync("supabase/checks/0135_preflight.sql", "utf8");
const POST = readFileSync("supabase/checks/0135_postflight.sql", "utf8");
const BACK = readFileSync("supabase/rollback/R0135_drop_item_type.sql", "utf8");

/**
 * Eine Datei ohne Prosa — für jede Abwesenheitsbehauptung.
 *
 * Zum vierten Mal dieselbe Falle in diesem Projekt: `0135` ERKLÄRT in einem
 * Kommentar, welche Anweisung dort nicht mehr steht, und ein `not.toContain`
 * über die ganze Datei findet die Erklärung.
 */
const ohneProsa = (sql: string): string =>
  sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");
const M0008 = readFileSync("supabase/migrations/0008_shop_listing_opt_out.sql", "utf8");

/** Der Rumpf der letzten Fassung von `is_shop_eligible` in einer Datei. */
function eligibleBody(sql: string): string {
  const i = sql.lastIndexOf("create or replace function public.is_shop_eligible");
  const a = sql.indexOf("$$", i) + 2;
  return sql.slice(a, sql.indexOf("$$", a));
}

describe("0135 legt die Spalte an, und zwar abgesichert", () => {
  it("item_type ist not null mit Vorgabewert figure", () => {
    expect(MIG).toContain("add column item_type text not null default 'figure'");
  });

  it("die Wertemenge steht als CHECK, mit allen fünf Werten", () => {
    expect(MIG).toContain("add constraint skylanders_item_type_known");
    for (const wert of ["figure", "game", "portal", "bundle", "other"]) {
      expect(MIG, wert).toContain(`'${wert}'`);
    }
  });

  it("bundle und other stehen absichtlich schon drin", () => {
    /* Einen CHECK nachträglich zu erweitern heißt, ihn zu ersetzen — eine
       Änderung mehr an einer Tabelle mit 605 Zeilen. */
    expect(MIG).toContain("Starter Packs und die beiden Taschen");
  });

  it("die Spalte trägt einen Kommentar, der die Entscheidung nennt", () => {
    expect(MIG).toContain("comment on column public.skylanders.item_type");
    expect(MIG).toContain("ADR-0128");
  });
});

describe("der Backfill kommt aus der Kategorie, nicht aus einem Namen", () => {
  it("er liest `categories.name = 'Spiele'`", () => {
    expect(MIG).toContain("set item_type = 'game'");
    expect(MIG).toContain("where c.id = s.category_id and c.name = 'Spiele'");
  });

  it("und nennt keinen Artikelnamen als Kriterium", () => {
    const code = MIG.slice(MIG.indexOf("-- 3. Der Backfill"), MIG.indexOf("-- 4."));
    expect(code).not.toMatch(/s\.name|ilike|display_name/);
  });

  it("die Kategorie, auf der er ruht, nennt auch die Anwendung", () => {
    /* `non_collectible_categories()` nennt sie, `collectible.ts` nennt sie,
       und der Backfill nennt sie.
       SEIT 0137 ist die Liste laenger — `Spiele` steht aber unveraendert
       darin, und das ist die Aussage, auf der `0135` ruht. Auf die LAENGE
       der Liste prueft `collectible.test.ts`. */
    expect([...NON_COLLECTIBLE_CATEGORIES]).toContain("Spiele");
    expect(MIG).toContain("'Spiele'");
  });

  it("die Vorbedingung bricht ab, wenn es die Kategorie nicht gibt", () => {
    expect(MIG).toContain("keine Kategorie \"Spiele\" — der Backfill haette nichts zu tun");
  });
});

describe("is_shop_eligible hängt am Artikeltyp — und nur daran zusätzlich", () => {
  it("der Rumpf ist der aus 0008 plus genau einer Zeile", () => {
    const alt = eligibleBody(M0008).split("\n");
    const neu = eligibleBody(MIG).split("\n");
    const zusatz = neu.filter((z) => !alt.includes(z));
    expect(zusatz.map((z) => z.trim())).toEqual(["and s.item_type = 'figure'"]);
    /* Und nichts ist verschwunden. */
    expect(alt.filter((z) => !neu.includes(z))).toEqual([]);
  });

  it("die Kategoriebedingung bleibt stehen", () => {
    expect(eligibleBody(MIG)).toContain("non_collectible_categories()");
  });

  it("non_collectible_categories() wird NICHT verändert", () => {
    expect(MIG).not.toContain("create or replace function public.non_collectible_categories");
    expect(MIG).toContain("non_collectible_categories() wurde veraendert");
  });

  it("die Rechte aus 0008 werden wiederholt, nicht erweitert", () => {
    expect(MIG).toContain("revoke all on function public.is_shop_eligible(text) from public;");
    expect(MIG).toContain("grant execute on function public.is_shop_eligible(text) to anon, authenticated;");
  });
});

describe("die Migration beweist selbst, dass sich kein Angebot ändert", () => {
  it("sie nimmt den Abdruck VOR der Änderung", () => {
    expect(MIG).toContain("create temporary table z1_abdruck");
    for (const schluessel of ["shopfaehig", "angebote", "angebote_md5", "sammelbar",
                              "sammelbar_je_serie", "override_md5", "zeilen", "spiele_zeilen"]) {
      expect(MIG, schluessel).toContain(`'${schluessel}'`);
    }
  });

  it("und vergleicht ihn danach, mit Abbruch", () => {
    for (const satz of [
      "die Angebotsliste hat sich geaendert",
      "shopfaehige Zeilen, vorher",
      "sammelbare Artikel, vorher",
      "der Nenner je Serie hat sich geaendert",
      "ein display_name_override hat sich geaendert",
      "Katalogzeilen, vorher",
    ]) {
      expect(MIG, satz).toContain(satz);
    }
  });

  it("der Abdruck ist die ganze Angebotszeile: Identität, Zustand, Preis", () => {
    expect(MIG).toContain("o.sky_id || '|' || o.condition || '|'");
  });

  it("die Hilfstabelle ist temporär und räumt sich in BEIDEN Fällen auf", () => {
    /*
     * `on commit drop` STATT EINES `drop table` AM ENDE.
     *
     * Hier stand die Erwartung, die Datei ende mit `drop table if exists
     * z1_abdruck;`. Das räumte nur den Erfolgsfall auf: bricht die Migration
     * in der Nachbedingung ab und läuft sie ohne Klammer, wären die
     * Anweisungen davor schon bestätigt und die Tabelle lebte mit veralteten
     * Abdrücken weiter. `on commit drop` gilt für `commit` UND `rollback`.
     */
    expect(MIG).toContain("create temporary table z1_abdruck");
    expect(MIG).toContain("on commit drop");
    expect(ohneProsa(MIG)).not.toContain("drop table if exists z1_abdruck");
    expect(ohneProsa(MIG)).not.toContain("if not exists z1_abdruck");
  });

  it("und sie bricht ab, wenn die Datei nicht in einer Transaktion läuft", () => {
    /* Ohne Klammer ist jede Anweisung ihre eigene Transaktion — dann ist die
       Tabelle mit `on commit drop` sofort wieder fort, und der erste DO-Block
       bricht ab, BEVOR die Spalte entsteht. Nachgefahren in PGlite:
       `npm run verify:check-sql`, Probelauf P2. */
    expect(MIG).toContain("to_regclass('pg_temp.z1_abdruck') is null");
    expect(MIG).toContain("laeuft nicht in einer Transaktion");
  });

  it("sie setzt ein Zeitlimit auf die Tabellensperre, transaktionslokal", () => {
    /* `add column` nimmt ACCESS EXCLUSIVE auf die weltlesbare Katalogtabelle.
       Fünf Sekunden Grenze heißt: die Migration bricht ab, statt den Shop
       hinter sich aufzustauen. */
    expect(MIG).toContain("set_config('lock_timeout', '5s', true)");
  });

  it("sie legt keinen Katalogartikel an und löscht keinen", () => {
    expect(MIG).not.toMatch(/insert\s+into\s+public\.skylanders/i);
    expect(MIG).not.toMatch(/delete\s+from\s+public\./i);
    /* Das einzige UPDATE ist der Backfill auf item_type. */
    const updates = MIG.match(/update\s+public\.\w+/gi) ?? [];
    expect(updates).toEqual(["update public.skylanders"]);
  });
});

describe("Pre- und Postflight prüfen gegenläufige Zustände", () => {
  it("der Preflight verlangt, dass die Spalte NOCH fehlt", () => {
    expect(PRE).toContain("Spalte item_type fehlt noch");
    expect(PRE).toContain("is_shop_eligible prueft item_type NOCH NICHT");
  });

  it("der Postflight verlangt, dass sie STEHT", () => {
    expect(POST).toContain("Spalte item_type STEHT, not null, Vorgabewert figure");
    expect(POST).toContain("is_shop_eligible prueft item_type = figure");
    expect(POST).toContain("und hat die Kategoriebedingung BEHALTEN");
  });

  it("beide nehmen denselben Shop-Abdruck", () => {
    for (const datei of [PRE, POST]) {
      expect(datei).toContain("md5 der Angebotsliste");
      expect(datei).toContain("ABDRUCK: sammelbare Artikel (Nenner)");
      expect(datei).toContain("ABDRUCK: Nenner je Serie");
    }
  });

  it("der Postflight prüft den Backfill in BEIDE Richtungen", () => {
    expect(POST).toContain("game-Zeilen ausserhalb der Kategorie Spiele (muss 0 sein)");
    expect(POST).toContain("Spiele-Zeilen, die nicht game sind (muss 0 sein)");
    expect(POST).toContain("andere Artikeltypen als figure/game (muss 0 sein");
  });

  it("beide halten die SKY-ID-Bereiche fest — der ZB-Bereich ist ein Loch", () => {
    for (const datei of [PRE, POST]) {
      expect(datei).toContain("belegte IDs im ZB-Bereich SKY-0615..SKY-0642 (muss 0 sein)");
      expect(datei).toContain("hoechste SKY-ID unter SKY-9000");
    }
  });
});

describe("die Rücknahme ist vollständig und weiß, wann sie nicht laufen darf", () => {
  it("sie stellt den Rumpf aus 0008 wieder her", () => {
    expect(eligibleBody(BACK)).toBe(eligibleBody(M0008));
  });

  it("sie entfernt CHECK und Spalte", () => {
    expect(BACK).toContain("drop constraint if exists skylanders_item_type_known");
    expect(BACK).toContain("drop column if exists item_type");
  });

  it("und bricht ab, wenn schon ein Portal im Katalog steht", () => {
    expect(BACK).toContain("item_type not in ('figure', 'game')");
    expect(BACK).toContain("erst non_collectible_categories() um deren Kategorien erweitern");
  });
});

describe("die neue Spalte ist im Backup entschieden — sie kommt mit", () => {
  /*
   * DIE ENTSCHEIDUNG WURDE GEDREHT, UND DAS IST DER PUNKT DIESES BLOCKS.
   *
   * Der erste Entwurf schloss `item_type` begründet aus: aus der exportierten
   * `category_id` ableitbar, also verzichtbar. Der Betreiber hat am
   * 2026-10-19 anders entschieden — der Artikeltyp ist eine eigenständige
   * fachliche Eigenschaft und soll bei einer Wiederherstellung abgelesen
   * werden, nicht rekonstruiert. Umgesetzt in `0136`; dieser Block hält fest,
   * dass beide Seiten — Manifest und SQL — dieselbe Entscheidung tragen.
   */
  const figures = () => BACKUP_SECTIONS.find((s) => s.key === "figures")!;

  it("sie steht in den exportierten Feldern", () => {
    expect(figures().fields).toContain("item_type");
  });

  it("und NICHT mehr als Ausschluss — eine Spalte ist einmal entschieden", () => {
    expect(figures().excluded ?? {}).not.toHaveProperty("item_type");
  });

  it("direkt neben card_type, weil 0136 genau dort eine Zeile einfügt", () => {
    const f = figures().fields;
    expect(f[f.indexOf("card_type") + 1]).toBe("item_type");
  });

  it("category_id bleibt dabei im Export — die Ableitung wäre weiter möglich", () => {
    /* Der Export ist dadurch nicht redundant, sondern lesbar ohne Regel: der
       Wert steht da, und die Kategorie steht daneben. */
    expect(figures().fields).toContain("category_id");
  });

  it("0136 ist die Migration dazu, und 0135 fasst die Sicherung nicht an", () => {
    const m135 = readFileSync(
      "supabase/migrations/0135_catalog_item_type.sql", "utf8");
    expect(m135).not.toContain("seller_business_backup");
    expect(m135).toContain("0136_business_backup_item_type.sql");
    const m136 = readFileSync(
      "supabase/migrations/0136_business_backup_item_type.sql", "utf8");
    expect(m136).toContain("'item_type', t.item_type,");
  });
});

/* ==========================================================================
 * Der Staging-Wächter: 0133 und 0134 sind NICHT angewendet
 * ======================================================================== */

describe("staging_pending_migrations.sql behauptet den Staging-Stand und prüft ihn", () => {
  const W = readFileSync("supabase/checks/staging_pending_migrations.sql", "utf8");

  /** Der letzte SQL-Stringliteral einer Prüfzeile — ihr Sollwert. */
  const soll = (nr: number): string => {
    const i = W.indexOf(`  (${nr}, '`);
    if (i < 0) throw new Error(`Zeile ${nr} fehlt`);
    const bis = W.indexOf("\n  (", i + 4);
    const m = [...W.slice(i, bis < 0 ? undefined : bis).matchAll(/'((?:[^']|'')*)'/g)];
    return m.length === 0 ? "(kein Sollwert)" : m[m.length - 1][1].replace(/''/g, "'");
  };

  it("0133 fehlt: Funktion und Trigger", () => {
    expect(soll(211)).toBe("FEHLT");
    expect(soll(212)).toBe("0");
    expect(W).toContain("purchases_paid_total_is_final");
    expect(W).toContain("purchases_paid_total_immutable_trg");
  });

  it("0134 fehlt: seller_purchase ist die Fassung aus 0119 und zeigt source_row nicht", () => {
    expect(soll(221)).toBe("0119");
    expect(soll(222)).toBe("false");
  });

  it("0132 steht", () => {
    expect(soll(201)).toBe("0132");
    expect(soll(202)).toBe("0132");
  });

  it("der Umgebungsstempel verlangt SKY-0821 und SKY-0822", () => {
    /* Beide sind laut PROJECT_STATUS.md bewusst nicht auf Production. Der
       Stempel fängt den Fall ab, dass eine Staging-Datei im falschen Fenster
       landet — er ersetzt die Projektkennung im Protokoll nicht. */
    expect(soll(101)).toBe("true");
    expect(W).toContain("'SKY-0821', 'SKY-0822'");
    expect(W).toContain("NUR FUER STAGING");
  });

  it("jeder Abdruck in der Tabelle stammt aus der Migration, die er behauptet", () => {
    const rumpf = (datei: string, name: string, args: string): string => {
      const sql = readFileSync(`supabase/migrations/${datei}`, "utf8");
      const i = sql.indexOf(`create or replace function public.${name}(${args}`);
      const a = sql.indexOf("as $$", i) + "as $$".length;
      return sql.slice(a, sql.indexOf("$$;", a));
    };
    const md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");
    const erwartet: [string, string][] = [
      [md5(rumpf("0132_purchase_item_remove_by_line.sql",
                 "seller_remove_purchase_item", "p_item_id")), "0132"],
      [md5(rumpf("0132_purchase_item_remove_by_line.sql",
                 "seller_update_purchase", "")), "0132"],
      [md5(rumpf("0119_orderbook_display_names.sql", "seller_purchase", "p_id")), "0119"],
      [md5(rumpf("0134_purchase_item_source_row_visible.sql",
                 "seller_purchase", "p_id")), "0134"],
      [md5(rumpf("0133_paid_total_immutable.sql",
                 "purchases_paid_total_is_final", "")), "0133"],
      [md5(rumpf("0131_business_backup_seller_fields.sql",
                 "seller_business_backup", "")), "0131"],
      [md5(rumpf("0136_business_backup_item_type.sql",
                 "seller_business_backup", "")), "0136"],
    ];
    for (const [abdruck, fassung] of erwartet) {
      expect(W, `${fassung}: ${abdruck}`).toContain(`('${abdruck}', '${fassung}')`);
    }
  });

  it("sie ist rein lesend und hat eine Zeile 9999", () => {
    const code = ohneProsa(W);
    expect(code).not.toMatch(/\bdo\s+\$\$/i);
    expect(code).not.toMatch(/^\s*(insert|update|delete|truncate|grant|revoke|alter|create|drop)\b/im);
    expect(W).toContain("blockierende Abweichungen (muss 0 sein)");
    expect(W.trimEnd().endsWith("order by nr;")).toBe(true);
  });
});

/* ==========================================================================
 * Der Laufzettel sagt dasselbe wie die Dateien
 * ======================================================================== */

describe("0135_0136_staging_run.md ist mit den Dateien deckungsgleich", () => {
  const RUN = readFileSync("supabase/checks/0135_0136_staging_run.md", "utf8");

  it("jede genannte Datei existiert wirklich", () => {
    const pfade = [...RUN.matchAll(/`(supabase\/[a-z0-9_/.]+\.(?:sql|md))`/g)]
      .map((m) => m[1]);
    expect(pfade.length).toBeGreaterThan(10);
    for (const pfad of new Set(pfade)) {
      expect(existsSync(pfad), `${pfad} fehlt`).toBe(true);
    }
  });

  it("er nennt die Umgebung, und nur Staging", () => {
    expect(RUN).toContain("qqxcpesbwfxzgytkdsac");
    /* Production darf GENANNT werden — aber nur als die Umgebung, die
       zugelassen bleibt. */
    expect(RUN).toContain("zmiwxswrpkmizvqsgype");
    expect(RUN).toContain("wird in diesem Lauf nicht geöffnet");
  });

  it("er nennt die fünf Vertragswerte und die eine set_config-Zeile", () => {
    for (const wert of ["534", "256", "4d1d6c30fe0ae886ca2689bcb1fe9634", "39"]) {
      expect(RUN, wert).toContain(wert);
    }
    expect(RUN).toContain("select set_config('skyisles.z0', 'staging', true);");
  });

  it("er klammert beide Migrationen und ordnet den Vertrag der Prüfdatei zu", () => {
    expect(RUN).toContain("begin;");
    expect(RUN).toContain("commit;");
    expect(RUN).toContain("Der Vertrag gehört zur Prüfdatei, nicht zur Migration");
  });

  it("er erklärt die abgebrochene Transaktion und nennt rollback als Antwort", () => {
    expect(RUN).toContain("25P02");
    expect(RUN).toContain("current transaction is aborted");
    expect(RUN).toContain("rollback;");
    expect(RUN).toContain("Nichts von Hand nachziehen");
  });

  it("er prüft am Ende Belegsperre, Dateninvarianten und die zwei offenen Migrationen", () => {
    expect(RUN).toContain("receipt_lock_check.sql");
    expect(RUN).toContain("RECEIPT_ISSUANCE_RELEASED` bleibt `false`");
    expect(RUN).toContain("4476.39");
    expect(RUN).toContain("285 / 812 / 26");
    expect(RUN).toContain("211 = `FEHLT`, 212 = `0`, 221 = `0119`, 222 = `false`");
  });

  it("und die Rücknahme nur in der Reihenfolge R0136, R0135", () => {
    const i = RUN.indexOf("R0136_back_to_0131.sql");
    const j = RUN.indexOf("R0135_drop_item_type.sql", i);
    expect(i).toBeGreaterThan(0);
    expect(j).toBeGreaterThan(i);
  });
});

/* ==========================================================================
 * Eine NEUE Zeile bekommt den richtigen Artikeltyp — ohne Heuristik
 * ======================================================================== */

describe("die Ableitungsregel ist eine Positivliste", () => {
  it("genau eine Zuordnung, und sie steht an einer Stelle", () => {
    expect(MIG).toContain("create or replace function public.catalog_item_type_for_category(p_category_name text)");
    expect(MIG).toContain("when 'Spiele' then 'game'");
    expect(MIG).toContain("else 'figure'");
    /* Die Funktion ist rein: `immutable`, leerer search_path, kein Tabellenzugriff. */
    const rumpf = MIG.slice(MIG.indexOf("catalog_item_type_for_category(p_category_name text)"));
    const koerper = rumpf.slice(rumpf.indexOf("as $$"), rumpf.indexOf("$$;"));
    expect(koerper).not.toMatch(/\bfrom\s+public\./i);
    expect(rumpf).toContain("immutable");
  });

  it("KEIN Fallback auf game — ein unbekannter Name ist eine Figur", () => {
    /*
     * Der Punkt dieser Datei. Ein `else 'game'` irgendwo, und die nächste
     * importierte Zubehörkategorie wäre pauschal ein Spiel — genau das, was
     * nicht passieren soll.
     */
    const code = ohneProsa(MIG);
    expect(code).not.toMatch(/else\s+'game'/);
    expect(code.match(/then 'game'/g) ?? []).toHaveLength(1);
    /* Und die Nachbedingung fährt den Fall selbst: fünf unbekannte Namen
       plus NULL müssen `figure` ergeben. */
    expect(MIG).toContain("'Portale', 'Bundles', 'Taschen', '', 'Unbekannt'");
    expect(MIG).toContain("eine Zeile ohne Kategorie ergibt nicht figure");
  });

  it("Portale und Bundles sind vorgesehen, aber noch nicht zugeordnet", () => {
    /* Die Wertemenge kennt sie (CHECK), die Ableitung noch nicht — Z3
       erweitert genau diese eine Funktion. */
    expect(MIG).toContain("'figure', 'game', 'portal', 'bundle', 'other'");
    expect(MIG).not.toMatch(/when 'Portale'/);
    expect(MIG).toContain("Z3 erweitert diese");
  });
});

describe("der Trigger greift auf jedem Schreibweg, überschreibt aber keine Entscheidung", () => {
  it("er hängt an insert UND an der Kategorieänderung", () => {
    expect(MIG).toContain("before insert or update of category_id on public.skylanders");
    expect(MIG).toContain("for each row execute function public.skylanders_set_item_type()");
  });

  it("er setzt nur den Vorgabewert, nicht eine ausdrückliche Angabe", () => {
    expect(MIG).toContain("if new.item_type = 'figure'");
    expect(MIG).toContain("new.item_type := v_abgeleitet");
  });

  it("die Nachbedingung prüft Form und Spaltenbindung des Triggers", () => {
    expect(MIG).toContain("der Trigger feuert nicht bei INSERT");
    expect(MIG).toContain("der Trigger feuert nicht bei UPDATE");
    expect(MIG).toContain("der UPDATE-Trigger haengt nicht an category_id");
  });

  it("und Ableitung und Sammelbarkeit widersprechen sich nicht", () => {
    /* Eine Kategorie, die `game` ergibt, darf nicht im Fortschritts-Nenner
       stehen — sonst hätte die Ableitung eine Nebenwirkung. */
    expect(MIG).toContain("eine Kategorie ergibt game, ist aber sammelbar");
  });

  it("der Importer nennt item_type weiterhin NICHT", () => {
    /* Der Trigger ist der Grund, warum er es nicht muss: der Vorgabewert
       kommt aus der Spalte, der richtige Wert aus der Regel. */
    const importer = readFileSync("tools/import-catalog.mts", "utf8");
    const block = importer.slice(importer.indexOf("figures.push({"),
                                 importer.indexOf("});", importer.indexOf("figures.push({")));
    expect(block).not.toContain("item_type");
    const payloadTest = readFileSync("src/lib/catalog/import-payload.test.ts", "utf8");
    expect(payloadTest).toContain('"item_type"');
  });
});
