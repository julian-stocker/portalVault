/**
 * Zubehör als Katalogartikel — die SQL-Seite (ADR-0128, Schritte Z2 und Z3).
 *
 * WAS HIER GEPRÜFT WIRD. Der TEXT von `0137` und `0138`, ihrer Flüge und
 * ihrer Rücknahmen: welche Kategorien eine Art ergeben, was die Anlegefunktion
 * schreibt und was sie ablehnt, welche 21 SKY-IDs `0138` setzt — und dass
 * diese 21 Zeichen für Zeichen die der Arbeitsmappe sind, wie
 * `docs/SKYLANDERS_DATA.md` sie festhält.
 *
 * WAS HIER NICHT GEPRÜFT WIRD. Laufzeitverhalten. Dass die Migrationen in
 * einer Transaktion durchlaufen, bei vertauschter Reihenfolge abbrechen und
 * nach einem Abbruch nichts zurücklassen, fährt `npm run verify:check-sql`
 * gegen echtes PostgreSQL nach (Durchgänge P22–P27). Dass sie auf Staging
 * laufen, beweist allein ein Ergebnisblatt aus dem SQL-Editor
 * (`supabase/checks/open_verifications.md`, Abschnitt 3a).
 *
 * DIE SUCHE UND DIE OBERFLÄCHE stehen in
 * `src/lib/orderbook/accessory-search.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { code, latestFunction, migrationSource } from "@/test-support/migrations";

const M137 = migrationSource("0137_catalog_accessories.sql");
const M138 = migrationSource("0138_catalog_portals.sql");
const R137 = readFileSync("supabase/rollback/R0137_back_to_0135.sql", "utf8");
const R138 = readFileSync("supabase/rollback/R0138_drop_portals.sql", "utf8");
const VOR138 = readFileSync("supabase/checks/0138_preflight.sql", "utf8");
const NACH138 = readFileSync("supabase/checks/0138_postflight.sql", "utf8");
const DATEN = readFileSync("docs/SKYLANDERS_DATA.md", "utf8");

/* ===================================================================== */
/* 0137 — der Weg                                                        */
/* ===================================================================== */
describe("0137 legt den Weg, und nur den Weg", () => {
  it("legt keinen Artikel an", () => {
    /* Die eigentliche Trennung zu `0138`: diese Datei schreibt keine
       Katalogzeile. Ein `insert into public.skylanders` steht darin genau
       einmal — im RUMPF der Anlegefunktion, nicht als Anweisung. */
    const anweisungen = code(M137)
      .split(/\$\$/)
      .filter((_, i) => i % 2 === 0)           // ausserhalb der Funktionsrümpfe
      .join("\n");
    expect(anweisungen).not.toContain("insert into public.skylanders");
    expect(anweisungen).not.toContain("insert into public.categories");
  });

  it("die Kategorieregel bleibt eine Positivliste", () => {
    const fn = code(latestFunction("catalog_item_type_for_category").body);
    for (const [kategorie, art] of [["Spiele", "game"], ["Portale", "portal"],
      ["Bundles", "bundle"], ["Taschen", "other"], ["Zubehör", "other"]] as const) {
      /* Die Zweige sind in der Datei ausgerichtet; verglichen wird der
         Zweig, nicht seine Einrückung. */
      expect(fn.replace(/[ \t]+/g, " "), kategorie)
        .toContain(`when '${kategorie}' then '${art}'`);
    }
    /* Kein `ilike`, kein `position`, kein Namensabgleich: eine unbekannte
       Kategorie wird NIE zum Spiel oder zum Portal. */
    expect(fn.toLowerCase()).not.toContain("ilike");
    expect(fn.toLowerCase()).not.toContain("position(");
    expect(fn).toContain("else 'figure'");
  });

  it("die Anlegefunktion lehnt eine Figur mit eigener Meldung ab", () => {
    const fn = latestFunction("seller_create_catalog_item");
    expect(fn.file).toBe("0137_catalog_accessories.sql");
    expect(fn.body).toContain("a figure is created in the catalog administration");
    /* „nicht erlaubt" und „kenne ich nicht" sind verschiedene Auskünfte, und
       die erste muss sagen, wohin man stattdessen geht. */
    expect(fn.body).toContain("unknown item type");
    expect(fn.body).toContain("insufficient_privilege");
  });

  it("sie entscheidet nichts, was dem Adminbereich gehört", () => {
    const fn = code(latestFunction("seller_create_catalog_item").body);
    expect(fn).toContain("false, 'admin'");          // catalog_visible, source
    for (const spalte of ["market_price", "image_file", "image_override_path",
                          "display_name_override", "character_id"]) {
      expect(fn, spalte).not.toContain(spalte);
    }
  });

  it("sie fragt dasselbe Tor wie jede andere seller-Funktion und ist nur authenticated erlaubt", () => {
    expect(code(latestFunction("seller_create_catalog_item").body))
      .toContain("public.can_operate_active_seller()");
    expect(M137).toContain(
      "revoke all on function public.seller_create_catalog_item(text, text, text) from public, anon;");
    expect(M137).toContain(
      "grant execute on function public.seller_create_catalog_item(text, text, text) to authenticated;");
  });

  it("die SKY-ID kommt aus der Sequenz und niemals aus einem Namen", () => {
    const fn = code(latestFunction("seller_create_catalog_item").body);
    expect(fn).toContain("nextval('public.sky_id_seq')");
    /* Der reservierte Fixture-Bereich bleibt unerreichbar (ADR-0070). */
    expect(fn).toContain("v_next > 8999");
    /*
     * Und sie wird nicht aus dem BESTAND abgeleitet — kein „höchste ID plus
     * eins". Das `max()` in dieser Funktion gehört der KATEGORIEPOSITION,
     * und das ist etwas anderes: eine Position ist Darstellungsreihenfolge,
     * eine SKY-ID ist Identität. Geprüft wird deshalb, wo das `max` steht.
     */
    expect(fn).toContain("max(c.position)");
    expect(fn).not.toContain("max(s.sky_id");
    expect(fn).not.toContain("max(sky_id");
  });

  it("und die Entstehung kommt ins Katalogjournal", () => {
    const fn = code(latestFunction("seller_create_catalog_item").body);
    expect(fn).toContain("insert into public.catalog_admin_changes");
    expect(fn).toContain("'created'");
  });

  it("die Artikelauswahl erfährt den Artikeltyp als ACHTE Spalte", () => {
    const fn = latestFunction("seller_import_catalog");
    expect(fn.file).toBe("0137_catalog_accessories.sql");
    const decl = /returns table \(([\s\S]*?)\n\)/.exec(fn.body)![1];
    const spalten = decl.replace(/\/\*[\s\S]*?\*\//g, "").split(",")
      .map((z) => z.trim().split(/\s+/)[0]).filter(Boolean);
    expect(spalten).toEqual(["sky_id", "name", "series_code", "category",
      "display_name", "catalog_visible", "is_active", "item_type"]);
    /* Und sie filtert weiter nicht — der Arbeitsmappen-Import muss eine
       ausgeblendete Zeile finden können. */
    expect(code(fn.body).toLowerCase()).not.toContain("where");
  });

  it("nimmt ihre Abdrücke VOR der Änderung und vergleicht sie danach", () => {
    for (const schluessel of ["angebote_md5", "sammelbar_je_serie", "typen", "zeilen"]) {
      /* Einmal beim Eintragen, einmal beim Vergleichen. */
      expect(M137.split(schluessel).length - 1, schluessel).toBeGreaterThanOrEqual(2);
    }
    expect(M137).toContain("on commit drop");
    expect(M137).toContain("laeuft nicht in einer Transaktion");
  });
});

/* ===================================================================== */
/* 0138 — die 21 Portale                                                 */
/* ===================================================================== */

/** Die Artikelliste aus `0138`, aus ihrem eigenen `values`-Block gelesen. */
function portaleAus(sql: string): { skyId: string; name: string; serie: string }[] {
  const block = sql.slice(sql.indexOf("insert into z3_portal"),
                         sql.indexOf("do $$"));
  return [...block.matchAll(/\('(SKY-\d{4})',\s*'([^']*)',\s*'([A-Z]{1,4})'\)/g)]
    .map((m) => ({ skyId: m[1], name: m[2], serie: m[3] }));
}

/**
 * Dieselbe Liste aus der Datenakte — Spalte A, Spalte B und die Serie.
 *
 * ZEILENWEISE UND ÜBER ECHTE ZELLEN. Die Plattformspalte enthält Zeichen wie
 * `Wii \| Wii U \| PS3`: in Markdown ist das EIN Zelleninhalt mit maskierten
 * Trennern. Ein naives `split("|")` verschiebt dort jede folgende Spalte, und
 * dann vergleicht dieser Test Plattformen mit Serien. Getrennt wird deshalb
 * nur an einem Strich, dem KEIN Backslash vorangeht.
 */
function portaleAusDoku(): { skyId: string; name: string; serie: string }[] {
  const out: { skyId: string; name: string; serie: string }[] = [];
  for (const zeile of DATEN.split("\n")) {
    if (!/^\|\s*\*{0,2}SKY-\d{4}/.test(zeile)) continue;
    const zellen = zeile.split(/(?<!\\)\|/).slice(1, -1)
      .map((z) => z.trim().replace(/^\*\*|\*\*$/g, "").trim());
    if (zellen.length < 4) continue;
    const skyId = zellen[0];
    if (skyId < "SKY-0615" || skyId > "SKY-0642") continue;
    out.push({ skyId, name: zellen[1].replace(/^`|`$/g, ""), serie: zellen[3] });
  }
  return out;
}

describe("0138 übernimmt die 21 SKY-IDs des Betreibers", () => {
  const liste = portaleAus(M138);

  it("genau 21 Zeilen, und genau diese Nummern", () => {
    expect(liste).toHaveLength(21);
    expect(liste.map((z) => z.skyId)).toEqual([
      "SKY-0615", "SKY-0616", "SKY-0617", "SKY-0618", "SKY-0619", "SKY-0620",
      "SKY-0621", "SKY-0622", "SKY-0624", "SKY-0625", "SKY-0626", "SKY-0627",
      "SKY-0628", "SKY-0629", "SKY-0630", "SKY-0632", "SKY-0633", "SKY-0634",
      "SKY-0635", "SKY-0636", "SKY-0637",
    ]);
  });

  it("die zwei Lücken sind die Disney-Infinity-Portale, und sie sind benannt", () => {
    /* `SKY-0623` und `SKY-0631` fehlen nicht aus Versehen — ADR-0128, Punkt 9.
       Beide stehen in der Datei, aber nur als Kommentar und in der
       Abbruchbedingung, nie in der Artikelliste. */
    expect(liste.map((z) => z.skyId)).not.toContain("SKY-0623");
    expect(liste.map((z) => z.skyId)).not.toContain("SKY-0631");
    expect(M138).toContain("Disney-Infinity-Portal");
    expect(M138).toContain("nicht in den Skylanders-Katalog gehoert");
  });

  it("und der Rest des ZB-Bereichs bleibt ebenfalls aussen vor", () => {
    /* Die Beleg-URL `SKY-0638` ist gar kein Artikel; Bundles und Taschen
       sind ein eigener Schritt. */
    for (const id of ["SKY-0638", "SKY-0639", "SKY-0640", "SKY-0641", "SKY-0642"]) {
      expect(liste.map((z) => z.skyId), id).not.toContain(id);
    }
  });

  it("die Namen sind zeichengleich zu docs/SKYLANDERS_DATA.md", () => {
    /* DIE EIGENTLICHE PARITÄTSPRÜFUNG. Die Datenakte hält fest, was in Spalte
       B der Arbeitsmappe steht; die Migration schreibt es in den Katalog.
       Weicht eines ab, hat jemand einen Namen „korrigiert" (CLAUDE.md
       Regel 4) — und genau das soll auffallen, bevor es eine Identität
       bekommt. */
    const doku = portaleAusDoku();
    expect(doku).toHaveLength(21);
    expect(liste.map((z) => `${z.skyId} ${z.name}`))
      .toEqual(doku.map((z) => `${z.skyId} ${z.name}`));
  });

  it("die Serie ist die der Akte — und SKY-0637 ist die eine Entscheidung", () => {
    const doku = new Map(portaleAusDoku().map((z) => [z.skyId, z.serie]));
    for (const z of liste) {
      if (z.skyId === "SKY-0637") continue;
      expect(z.serie, z.skyId).toBe(doku.get(z.skyId));
    }
    /*
     * `SKY-0637` ist in der Mappe `SF, T, SC`. `series_code` ist einwertig
     * und trägt einen Fremdschlüssel; die Einordnung ist `SF` — die erste
     * und älteste der drei, entschieden vom Betreiber am 2026-10-20.
     * Die vollständige Zuordnung bleibt im ROHNAMEN lesbar, also in den
     * Quelldaten und nicht in einer abgeleiteten Spalte.
     */
    expect(doku.get("SKY-0637")).toBe("SF, T, SC");
    const z0637 = liste.find((z) => z.skyId === "SKY-0637")!;
    expect(z0637.serie).toBe("SF");
    expect(z0637.name).toBe("84721790 (SF, T, SC)");
  });

  it("kein Name wird beschnitten, normalisiert oder ergänzt", () => {
    for (const z of liste) {
      expect(z.name.trim(), z.skyId).toBe(z.name);
      expect(z.name.length, z.skyId).toBeGreaterThan(0);
      /* Niemand hat „Portal of Power" davorgeschrieben. */
      expect(z.name, z.skyId).not.toContain("Portal of Power");
    }
  });
});

describe("0138 schreibt, was ein Portal ist — und nichts darüber hinaus", () => {
  it("portal, unsichtbar, aktiv, ohne Preis, source admin, card_type standard", () => {
    const sql = code(M138);
    expect(sql).toContain("'portal', 'standard', false, 'admin', true");
    /* Kein Preis, kein Bild, keine Charakterzuordnung, kein Override: die
       Spaltenliste des INSERT nennt sie gar nicht. */
    const insert = sql.slice(sql.indexOf("insert into public.skylanders"));
    const spalten = insert.slice(0, insert.indexOf(")"));
    for (const spalte of ["market_price", "image_file", "image_override_path",
                          "display_name_override", "character_id"]) {
      expect(spalten, spalte).not.toContain(spalte);
    }
  });

  it("zieht KEINE SKY-ID aus der Sequenz", () => {
    /* Das ist der Unterschied zu `seller_create_catalog_item`: diese 21
       Nummern sind vergeben, nicht zu vergeben (CLAUDE.md Regel 2). */
    expect(code(M138)).not.toContain("nextval");
    expect(code(M138)).not.toContain("currval");
    /* Und der Sequenzstand wird als Abdruck genommen und verglichen. */
    expect(M138.split("'sequenz'").length - 1).toBeGreaterThanOrEqual(2);
    expect(M138).toContain("zieht keine SKY-ID");
  });

  it("der Slug entsteht zeilenweise, damit zwei gleiche Grundslugs nicht kollidieren", () => {
    expect(code(M138)).toContain("public.next_figure_slug(v_p.name, v_p.serie, v_p.sky_id)");
    /* In EINER Anweisung sähen alle 21 Aufrufe denselben Schnappschuss. */
    expect(M138).toContain("EINE SCHLEIFE UND KEIN `insert ... select`");
  });

  it("prüft den GANZEN ZB-Bereich auf Freiheit, nicht nur die 21 Nummern", () => {
    expect(code(M138)).toContain("where sky_id between 'SKY-0615' and 'SKY-0642'");
    expect(M138).toContain("eine SKY-ID wird nie neu vergeben");
  });

  it("fragt 0137 nach seiner WIRKUNG und nicht nach seiner Nummer", () => {
    const sql = code(M138);
    expect(sql).toContain("'Portale' = any (public.non_collectible_categories())");
    expect(sql).toContain("public.catalog_item_type_for_category('Portale') <> 'portal'");
  });

  it("ändert keine Funktion, keinen Trigger und kein Recht", () => {
    const sql = code(M138).toLowerCase();
    expect(sql).not.toContain("create or replace function");
    expect(sql).not.toContain("create trigger");
    expect(sql).not.toContain("grant ");
    expect(sql).not.toContain("revoke ");
    expect(sql).not.toContain("alter table public.skylanders");
  });

  it("und beweist selbst, dass sich die Zahlen der Nutzer nicht bewegen", () => {
    for (const schluessel of ["angebote_md5", "sammelbar", "sammelbar_je_serie",
                              "override_md5", "shopfaehig"]) {
      expect(M138.split(`'${schluessel}'`).length - 1, schluessel)
        .toBeGreaterThanOrEqual(2);
    }
    expect(M138).toContain("on commit drop");
    expect(M138).toContain("laeuft nicht in einer Transaktion");
  });

  it("zwei unabhängige Riegel, getrennt geprüft", () => {
    const sql = code(M138);
    /* Die Kategorie … */
    expect(sql).toContain("stehen in einer sammelbaren Kategorie");
    /* … und der Artikeltyp über die Shop-Eignung. */
    expect(sql).toContain("Portal(e) sind shopfaehig");
  });
});

/* ===================================================================== */
/* Flüge und Rücknahmen                                                  */
/* ===================================================================== */
describe("die beiden Flüge und die Rücknahme", () => {
  it("Pre- und Postflight tragen denselben Z0-Vertrag", () => {
    for (const wert of ["'shopfaehig',   '534'", "'angebote',     '256'",
      "'angebote_md5', '4d1d6c30fe0ae886ca2689bcb1fe9634'",
      "'sammelbar',    '534'", "'spiele_overrides', '39'"]) {
      expect(VOR138, wert).toContain(wert);
      expect(NACH138, wert).toContain(wert);
    }
  });

  it("der Postflight führt die 21 Zeilen UNABHÄNGIG von der Migration", () => {
    /* Sonst prüfte er die Migration gegen sich selbst. */
    const doku = portaleAusDoku();
    for (const z of doku) expect(NACH138, z.skyId).toContain(`('${z.skyId}', '${z.name}'`);
  });

  it("beide Flüge sind rein lesend", () => {
    for (const [name, sql] of [["preflight", VOR138], ["postflight", NACH138]] as const) {
      const ausfuehrbar = code(sql).toLowerCase();
      for (const schreibend of ["insert into", "update ", "delete from",
                                "alter ", "drop ", "create "]) {
        expect(ausfuehrbar, `${name}: ${schreibend}`).not.toContain(schreibend);
      }
    }
  });

  it("R0138 fragt jede Tabelle, die an einer SKY-ID hängt — und benennt die zwei mit CASCADE", () => {
    for (const tabelle of ["collection_items", "shop_inventory", "inventory_movements",
      "purchase_items", "sale_items", "cart_items", "catalog_editorial",
      "legacy_stock_events", "orderbook_name_mappings", "inventory_import_mappings"]) {
      expect(R138, tabelle).toContain(`public.${tabelle}`);
    }
    expect(R138).toContain("ON DELETE CASCADE");
    /* Eine Bewegung hängt an der Lagerzeile, nicht an der SKY-ID. */
    expect(R138).toContain("join public.shop_inventory i on i.id = m.inventory_id");
  });

  it("R0138 löscht das Journal NICHT und sagt warum", () => {
    expect(code(R138)).not.toContain("delete from public.catalog_admin_changes");
    expect(R138).toContain("append-only");
  });

  it("und die Reihenfolge ist zwingend: erst R0138, dann R0137", () => {
    expect(R138).toContain("ERST DIESE, DANN `R0137`");
    /* `R0137` setzt das von seiner Seite durch, und zwar schon vor 0138. */
    expect(R137).toContain("stehen in einer Zubehoerkategorie");
  });
});
