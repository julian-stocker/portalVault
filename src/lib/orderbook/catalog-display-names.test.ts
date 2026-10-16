/**
 * Die Anzeigenamen und die Figurenauswahl (0117), und eBay als Plattform (0118).
 *
 * WAS DAS GEKOSTET HAT, GEMESSEN
 *
 * Die Einkaufsmaske bot für jede Eon's-Elite-Figur DREI Einträge an —
 * „Elite Spyro", „Elite Spyro - ohne OVP" und „Elite Spyro (2)" —, obwohl
 * zwei davon im Katalog seit Langem ausgeblendet sind und über alle elf
 * referenzierenden Tabellen keine einzige Referenz tragen. Der Grund war
 * nicht der Katalog, sondern `seller_import_catalog()`: sie lieferte den
 * ROHNAMEN und filterte nichts. Dieselbe Funktion bediente auch die 40
 * Spielzeilen, von denen sechs „Wii U Spiel" heissen und sich nur durch ihre
 * Kategorie unterscheiden.
 *
 * Diese Datei hält beide Hälften der Lösung fest: die Funktion liefert
 * `display_name` und die beiden Sichtbarkeitsflaggen, und GEFILTERT wird in
 * der Auswahlliste — nie im Importpfad.
 */
import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { code, latestFunction, migrationFiles, migrationSource } from "@/test-support/migrations";
import { rankFigure, searchFigures, type FigureChoice } from "@/lib/orderbook/figure-search";

const FILE_0117 = "0117_catalog_display_names_and_picker.sql";
const FILE_0118 = "0118_purchase_platform_ebay.sql";
const sql0117 = migrationSource(FILE_0117);
const exec0117 = code(sql0117);
const exec0118 = code(migrationSource(FILE_0118));
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const QUERIES = read("src/lib/orderbook/queries.ts");
const ADD_ITEM = read("src/components/business/add-purchase-item.tsx");
const LEDGER = read("src/components/business/orderbook-ledger.tsx");
const DETAILS = read("src/components/business/purchase-details.tsx");
const DE = read("src/lib/i18n/de.ts");

// ---------------------------------------------------------------------------
describe("0117 steht allein auf seiner Nummer und fasst nur eine Spalte an", () => {
  it("ist eine Migration und die einzige mit dieser Nummer", () => {
    expect(migrationFiles).toContain(FILE_0117);
    expect(migrationFiles.filter((f) => f.startsWith("0117"))).toEqual([FILE_0117]);
  });

  it("schreibt AUSSCHLIESSLICH display_name_override", () => {
    /*
     * Die eine Zusicherung, auf der alles andere ruht: genau eine
     * UPDATE-Anweisung, auf genau eine Tabelle, mit genau einer Spalte —
     * nicht `name`, nicht `slug`, nicht `market_price`, nicht
     * `catalog_visible`.
     *
     * Gelesen wird die SET-Klausel bis zum `from`/`where`, nicht der ganze
     * Rest der Anweisung: dort stehen Vergleiche wie `s.name = n.expect`,
     * und die sind die Sicherung und keine Zuweisung. Ein `set search_path`
     * in der Funktionsdefinition ist aus demselben Grund keine.
     */
    const updates = [...exec0117.matchAll(
      /update\s+(public\.[a-z_]+)\b[^;]*?\bset\b([\s\S]*?)\b(?:from|where)\b/g)];
    expect(updates).toHaveLength(1);
    expect(updates[0][1]).toBe("public.skylanders");
    const assigned = [...updates[0][2].matchAll(/([a-z_]+)\s*=/g)].map((m) => m[1]);
    expect(assigned).toEqual(["display_name_override"]);
  });

  it("fasst keine Zeile einer Geschäftstabelle an", () => {
    for (const forbidden of ["insert into public.purchases", "insert into public.sale",
                             "delete from", "truncate", "alter table public.purchases",
                             "alter table public.purchase_items",
                             "alter table public.shop_inventory"]) {
      expect(exec0117.toLowerCase(), forbidden).not.toContain(forbidden);
    }
  });

  it("lässt den Rohnamen in Ruhe — und prüft ihn als Sicherung", () => {
    // Nie geschrieben …
    expect(exec0117).not.toMatch(/set\s+name\s*=/);
    expect(exec0117).not.toMatch(/set\s+slug\s*=/);
    // … aber als Bedingung verlangt, damit kein Name auf die falsche Figur geht.
    expect(exec0117).toContain("and s.name = n.expect");
  });

  it("bricht ab, wenn eine Zeile fehlt oder anders heisst", () => {
    expect(exec0117).toContain("fehlen oder tragen einen anderen Rohnamen");
    expect(exec0117).toContain("tragen bereits einen anderen Anzeigenamen");
  });

  it("jede Zählung hat ihre eigene Variable", () => {
    /*
     * DER FEHLER, DEN DIESER TEST VERHINDERT, WAR SCHON DA.
     *
     * Ein wiederverwendetes `v_count` stand für drei verschiedene Zählungen,
     * und die Schlussmeldung griff auf die LETZTE davon zu: sie nannte die
     * Zahl der ausgeblendeten Elite-Zeilen mit Anzeigenamen — null, wie es
     * sein muss — als „Overrides gesamt". Die Prüfungen waren richtig, die
     * Meldung log.
     *
     * Also: die Gesamtzahl steht in `v_after`, und `v_after` wird genau
     * einmal belegt. Keine Meldung darf eine Variable nennen, die danach
     * noch einmal beschrieben wird.
     */
    const block = exec0117.slice(0, exec0117.indexOf("drop function"));
    expect([...block.matchAll(/into\s+v_after\b/g)]).toHaveLength(1);
    expect(block).toContain("v_before, v_after;");
    // Und die drei Meldungsgrößen sind nicht dasselbe Fass.
    for (const v of ["v_after", "v_hidden", "v_invisible", "v_touched"]) {
      expect(block, v).toContain(`${v} `);
    }
  });

  it("ein zweiter Lauf schreibt nichts und sagt es", () => {
    /*
     * Die drei Eigenschaften, die Wiederholbarkeit ausmachen:
     *
     *   1. das UPDATE überspringt eine Zeile, die den Namen schon trägt
     *   2. die Vorprüfung lässt einen bereits KORREKTEN Namen durch und
     *      bricht nur bei einem ABWEICHENDEN ab
     *   3. die Nachbedingung zählt den ZUSTAND (14 / 39), nicht die Änderung
     *
     * Zusammen heisst das: Lauf 2 fasst null Zeilen an, `v_touched` ist 0,
     * `v_after` gleich `v_before`, und 14/39 gelten weiter.
     */
    expect(exec0117).toContain("s.display_name_override is distinct from n.want");
    expect(exec0117).toContain("and s.display_name_override is distinct from n.want");
    expect(exec0117).toContain("where n.kind = 'elite' and s.display_name_override = n.want");
    expect(exec0117).toContain("where n.kind = 'game' and s.display_name_override = n.want");
    /* Die relative Prüfung trägt beide Fälle: 0 + 53 beim ersten Lauf,
       53 + 0 beim zweiten. */
    expect(exec0117).toContain("v_after <> v_before + v_touched");
  });

  it("der Kopfkommentar nennt keine umgebungsabhängigen Zahlen", () => {
    /*
     * „ALLE 603 Katalogzeilen … 32 ausgeblendete … 2 abgeschaltete" und die
     * Kategorie-IDs 2/6/12/17/24/28 waren Production-Werte. Auf Staging sind
     * es 605/30/2 und 9/13/19/24/31/35 — ein Kommentar, der in einer der
     * beiden Umgebungen falsch ist, ist in beiden wertlos.
     *
     * Die 53 SKY-IDs und die Zahlen 14, 39 und 53 sind dagegen Eigenschaften
     * DIESER Migration und dürfen bleiben.
     */
    const header = sql0117.slice(0, sql0117.indexOf("-- 1. Vorbedingungen"));
    for (const n of ["603", "605", "32 ", "30 ", "kat 2→", "2→SA", "9→SA"]) {
      expect(header, n).not.toContain(n);
    }
    expect(header).toContain("je Umgebung");
  });

  it("prüft hinterher relativ, nicht gegen fest eingetragene Zahlen", () => {
    /*
     * Eine Erwartung wie „hinterher 59 Overrides" wäre auf Production
     * richtig und auf Staging falsch. Gefragt ist der ZUWACHS.
     */
    expect(exec0117).toContain("v_before + v_touched");
    expect(exec0117).not.toMatch(/<>\s*59\b/);
    expect(exec0117).not.toMatch(/<>\s*603\b/);
  });
});

// ---------------------------------------------------------------------------
describe("die 53 Anzeigenamen", () => {
  /** Die Liste aus der Migration, zurückgelesen: (sky_id, erwartet, gewollt, Art). */
  const entries = [...sql0117.matchAll(
    /\('(SKY-\d{4})',\s*'((?:[^']|'')*)',\s*'((?:[^']|'')*)',\s*'(elite|game)'\)/g)]
    .map((m) => ({
      skyId: m[1],
      expect: m[2].replace(/''/g, "'"),
      want: m[3].replace(/''/g, "'"),
      kind: m[4],
    }));

  it("sind 14 Eon's Elite und 39 Spiele", () => {
    expect(entries).toHaveLength(53);
    expect(entries.filter((e) => e.kind === "elite")).toHaveLength(14);
    expect(entries.filter((e) => e.kind === "game")).toHaveLength(39);
  });

  it("jede SKY-ID genau einmal, jeder Anzeigename genau einmal", () => {
    expect(new Set(entries.map((e) => e.skyId)).size).toBe(53);
    /* Der zweite Teil ist der eigentliche Zweck der Übung: nach 0117 ist
       kein Anzeigename mehr doppelt. Vorher hiessen sechs Zeilen „Wii U
       Spiel". */
    expect(new Set(entries.map((e) => e.want)).size).toBe(53);
  });

  it("Eon's Elite: der Anzeigename ist der Rohname ohne den OVP-Zusatz", () => {
    for (const e of entries.filter((x) => x.kind === "elite")) {
      expect(e.expect, e.skyId).toMatch(/ohne OVP$/);
      expect(e.want, e.skyId).not.toContain("OVP");
      /* Und er ist wirklich nur gekürzt, nicht umgeschrieben: der gewollte
         Name steckt im Rohnamen. SKY-0075 ist der Fall mit dem fehlenden
         Leerzeichen — auch dort muss das gelten. */
      expect(e.expect.startsWith(e.want), `${e.skyId}: „${e.expect}" vs „${e.want}"`).toBe(true);
    }
  });

  it("Spiele: Serie und Plattform, und keine Serie zweimal dieselbe Plattform", () => {
    const SERIES = ["Spyro's Adventure", "Giants", "Swap Force",
                    "Trap Team", "SuperChargers", "Imaginators"];
    const seen = new Set<string>();
    for (const e of entries.filter((x) => x.kind === "game")) {
      expect(e.want, e.skyId).toMatch(/^Skylanders .+ – .+$/);
      const [, rest] = /^Skylanders (.+)$/.exec(e.want)!;
      const series = SERIES.find((s) => rest.startsWith(`${s} – `));
      expect(series, `${e.skyId}: „${e.want}" nennt keine bekannte Serie`).toBeDefined();
      const platform = rest.slice(series!.length + 3);
      expect(platform.length, `${e.skyId}: keine Plattform`).toBeGreaterThan(0);
      const key = `${series}|${platform}`;
      expect(seen.has(key), `${e.skyId}: ${key} kommt zweimal vor`).toBe(false);
      seen.add(key);
    }
    /* Alle sechs Serien kommen vor — keine Generation vergessen. */
    expect(new Set([...seen].map((k) => k.split("|")[0])).size).toBe(6);
  });

  it("die (EN)-Ausgabe bleibt eine eigene Zeile", () => {
    const en = entries.find((e) => e.skyId === "SKY-0307");
    expect(en?.expect).toBe("Spiel für Xbox One (EN)");
    expect(en?.want).toBe("Skylanders Trap Team – Xbox One (EN)");
    /* Und sie ist nicht mit der deutschen Xbox-One-Zeile derselben Serie
       verschmolzen. */
    expect(entries.find((e) => e.skyId === "SKY-0306")?.want)
      .toBe("Skylanders Trap Team – Xbox One");
  });

  it("nennt die ausgeblendeten Varianten nicht", () => {
    /* Die 28 OVP- und (2)-Zeilen werden nicht angefasst. Keine ihrer IDs
       steht in der Liste. */
    for (const hidden of ["SKY-0012", "SKY-0013", "SKY-0057", "SKY-0058",
                          "SKY-0090", "SKY-0091"]) {
      expect(entries.some((e) => e.skyId === hidden), hidden).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
describe("die Funktion liefert, die Auswahl filtert", () => {
  const fn = latestFunction("seller_import_catalog");

  it("die Funktion hat kein where — sie versteckt nichts vor dem Import", () => {
    expect(code(fn.body).toLowerCase()).not.toContain("where");
  });

  it("sie löst den Anzeigenamen wie der öffentliche Katalog", () => {
    expect(code(fn.body)).toContain("coalesce(s.display_name_override, s.name)");
  });

  it("die vier Spalten aus 0052 behalten die Positionen 1 bis 4", () => {
    /*
     * WARUM ANGEHÄNGT UND NICHT EINGESCHOBEN.
     *
     * `display_name` stand zuerst zwischen `name` und `series_code`, weil es
     * dorthin gehört. Beide Aufrufer lesen über den Feldnamen und PostgREST
     * liefert JSON-Objekte — die Ordnungszahl kommt beim Client gar nicht
     * an. Aber ein künftiges `select * into record` würde positional
     * zuweisen, und eine verschobene Spalte wäre dort ein Fehler, den
     * niemand sieht. Anhängen kostet nichts und nimmt die Möglichkeit weg.
     *
     * Geprüft wird die REIHENFOLGE, nicht nur die Anwesenheit: eine Liste
     * von `toContain` hätte eine Verschiebung durchgelassen.
     */
    const decl = /returns table \(([\s\S]*?)\n\)/.exec(fn.body)![1];
    const cols = decl
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split(",")
      .map((l) => l.trim().split(/\s+/).filter(Boolean))
      .filter((parts) => parts.length === 2);
    expect(cols).toEqual([
      ["sky_id", "text"],
      ["name", "text"],
      ["series_code", "text"],
      ["category", "text"],
      ["display_name", "text"],
      ["catalog_visible", "boolean"],
      ["is_active", "boolean"],
    ]);
    /* Und die SELECT-Liste führt dieselbe Reihenfolge — sonst landete der
       Anzeigename in der Kategoriespalte, und zwar lautlos. */
    const query = code(fn.body).slice(code(fn.body).indexOf("return query"));
    const order = ["s.sky_id", "s.name", "s.series_code", "coalesce(c.name, '')",
                   "coalesce(s.display_name_override, s.name)",
                   "s.catalog_visible", "s.is_active"];
    let at = -1;
    for (const expr of order) {
      const next = query.indexOf(expr, at + 1);
      expect(next, `${expr} nach Position ${at}`).toBeGreaterThan(at);
      at = next;
    }
  });

  it("die Nachbedingung prüft den Rückgabetyp als ganze Zeichenkette", () => {
    /* Eine Folge von `position(… in …)`-Prüfungen hätte eine Verschiebung
       der Spalten nicht gesehen. Der Vergleich der ganzen Zeichenkette
       prüft Namen, Typen und Reihenfolge in einem Zug. */
    expect(exec0117).toContain(
      "'TABLE(sky_id text, name text, series_code text, category text, '");
    expect(exec0117).toContain(
      "|| 'display_name text, catalog_visible boolean, is_active boolean)'");
  });

  it("die Auswahlliste filtert beide Riegel", () => {
    expect(QUERIES).toContain(
      ".filter((r) => r.catalog_visible !== false && r.is_active !== false)");
  });

  it("und verhält sich bei alter Funktionsfassung wie vorher", () => {
    /*
     * Zwischen Migration und Deployment — oder bei einem Rückbau — fehlen
     * die drei neuen Spalten. `!== false` und der `display_name`-Rückfall
     * machen daraus genau das alte Verhalten, statt die Liste zu leeren.
     */
    expect(QUERIES).toContain("r.display_name === undefined || r.display_name === null");
    expect(QUERIES).not.toContain(".filter((r) => r.catalog_visible && r.is_active)");
  });

  it("der ROHNAME geht an die Datenbank, der Anzeigename auf den Schirm", () => {
    /*
     * `seller_add_purchase_item` legt das dritte Argument als `raw_name` ab,
     * und das Feld ist Provenienz: „what the source called it" (0053).
     *
     * WAS SICH IN 0120 GEÄNDERT HAT. Hier stand die Forderung, den ROHEN
     * Katalognamen zu schreiben — richtig gegen den Anzeigenamen, falsch
     * gegen gar keinen. Eine Figur, die gerade aus dem Katalog gewählt wurde,
     * hat keine frühere Quelle; jeder Name, der dort landet, ist ein
     * erfundener Schnappschuss. Und ein neu angelegter Einkauf schrieb schon
     * vorher keinen, also waren es zwei Pfade mit zwei Ergebnissen.
     *
     * Die Prüfung ist damit STRENGER als vorher: verboten sind jetzt BEIDE
     * Namen, nicht nur der Anzeigename.
     */
    expect(ADD_ITEM).toContain("add(choice.skyId, null)");
    expect(ADD_ITEM).not.toContain("add(choice.skyId, choice.name)");
    expect(ADD_ITEM).not.toContain("choice.rawName ?? choice.name");
  });
});

// ---------------------------------------------------------------------------
describe("die Suche findet beide Namen, zeigt aber einen", () => {
  const spyro: FigureChoice = {
    skyId: "SKY-0056", name: "Elite Spyro",
    rawName: "Elite Spyro - ohne OVP", series: "SA", marketPrice: 28.99,
  };
  const giants: FigureChoice = {
    skyId: "SKY-0113", name: "Skylanders Giants – Wii U",
    rawName: "Wii U Spiel", series: "G", marketPrice: 24.99,
  };

  it("der Anzeigename trifft genau und steht oben", () => {
    expect(rankFigure(spyro, "elite spyro")).toBe(0);
    expect(searchFigures([spyro], "Elite Spyro")).toEqual([spyro]);
  });

  it("der alte Name findet die Zeile noch — aber nachrangig", () => {
    const viaRaw = rankFigure(spyro, "ohne ovp");
    expect(viaRaw).not.toBeNull();
    /* Schlechter als jeder Treffer im Anzeigenamen und schlechter als die ID:
       wer den neuen Namen tippt, soll nicht hinter einem Rohnamen landen. */
    expect(viaRaw!).toBeGreaterThan(rankFigure(spyro, "elite")!);
    expect(viaRaw!).toBeGreaterThan(rankFigure(spyro, "0056")!);
  });

  it("ein Spiel ist über Serie UND Plattform zu finden", () => {
    expect(rankFigure(giants, "giants")).not.toBeNull();
    expect(rankFigure(giants, "wii u")).not.toBeNull();
    /* Und über den alten, mehrdeutigen Namen auch noch. */
    expect(rankFigure(giants, "wii u spiel")).not.toBeNull();
  });

  it("ohne rawName verhält sich alles wie vor 0117", () => {
    const plain: FigureChoice = { skyId: "SKY-0014", name: "Camo", series: "SA", marketPrice: 1 };
    expect(rankFigure(plain, "camo")).toBe(0);
    expect(rankFigure(plain, "ohne ovp")).toBeNull();
  });

  it("ein rawName, der dem Anzeigenamen gleicht, zählt nicht doppelt", () => {
    const same: FigureChoice = {
      skyId: "SKY-0014", name: "Camo", rawName: "Camo", series: "SA", marketPrice: 1,
    };
    expect(rankFigure(same, "camo")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe("0118: eBay, und die Plattform in der Übersicht", () => {
  it("steht allein auf seiner Nummer und erweitert nur den CHECK", () => {
    expect(migrationFiles.filter((f) => f.startsWith("0118"))).toEqual([FILE_0118]);
    expect(exec0118).toContain("add constraint purchases_platform_known");
    expect(exec0118).toContain("'ebay'");
    // Keine Funktion, keine Spalte, keine Zeile.
    expect(exec0118).not.toContain("create or replace function");
    expect(exec0118).not.toMatch(/add column/);
    expect(exec0118.toLowerCase()).not.toMatch(/\bupdate public\./);
    expect(exec0118.toLowerCase()).not.toContain("delete from");
  });

  it("prüft vorher, dass kein bestehender Wert unzulässig würde", () => {
    expect(exec0118).toContain("wären nach der Erweiterung unzulässig");
  });

  it("die Übersicht hat eine Plattformspalte, Kopf und Zelle", () => {
    expect(DE).toContain('platform: "Plattform"');
    expect(DE).toContain('ebay: "eBay"');
    expect(DE).toContain('platformUnknown: "Unbekannt"');
    expect(LEDGER).toContain("{copy.columns.platform}");
    expect(LEDGER).toContain("platformLabel(purchase.platform)");
  });

  it("„Unbekannt“ ist ein Wort, keine leere Zelle", () => {
    /* Dasselbe Argument, das `formatDate` für ein fehlendes Datum macht:
       eine leere Zelle in einer tabellarischen Zeile liest sich wie ein
       Darstellungsfehler. */
    expect(LEDGER).toContain("copy.detailsModal.platformUnknown");
    expect(DETAILS).toContain('<option value="">{modal.platformUnknown}</option>');
  });

  it("die Spuren passen in den erklärten Boden", () => {
    /*
     * Hieß „die achte Spur" und erwartete acht. `0124` hat zwei schmale
     * Zustandsspuren vor `Lager` ergänzt; die RECHNUNG darunter ist
     * unverändert und prüft die neue Breite genauso streng.
     */
    const tracks = /const PURCHASE_COLUMNS =\s*\n?\s*"([^"]*)"/.exec(LEDGER)![1];
    const floor = Number(/const PURCHASE_MIN_WIDTH = "([\d.]+)rem"/.exec(LEDGER)![1]);
    const parts = tracks.replace(/minmax\(([^)]*)\)/g, (m) => m.replace(/,\s*/g, ","))
      .split(/\s+/).filter(Boolean);
    expect(parts).toHaveLength(10);
    const sum = parts.reduce((t, p) => {
      const m = /minmax\(\s*([\d.]+)rem/.exec(p) ?? /([\d.]+)rem/.exec(p);
      return t + (/minmax\(\s*0/.test(p) ? 0 : Number(m?.[1] ?? 0));
    }, 0);
    /* Spuren + sieben Lücken à 0,75rem + 0,75rem Zeilenrand je Seite. */
    const needed = sum + 0.75 * (parts.length - 1) + 1.5;
    expect(floor, `braucht ${needed}rem`).toBeGreaterThanOrEqual(needed);
  });

  it("und der Boden bleibt breiter als jedes Telefon", () => {
    const floor = Number(/const PURCHASE_MIN_WIDTH = "([\d.]+)rem"/.exec(LEDGER)![1]) * 16;
    expect(floor).toBeGreaterThan(414);
  });
});
