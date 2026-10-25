import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { PLATFORM_FORMAT_VERSION, PLATFORM_SECTIONS, SECTIONS_BY_FORMAT_VERSION }
  from "./platform-manifest";
import { columnsOf } from "@/test-support/migrations";

/**
 * Migration `0144` — und der Beweis, dass sie den Rumpf aus `0105` KOPIERT.
 *
 * WORUM ES HIER GEHT. `0144` ersetzt `system_platform_export()`, also die
 * eine Funktion, die unter Supabase Free unsere gesamte Absicherung ist. Ein
 * Fehler darin fällt erst auf, wenn man die Sicherung braucht — und dann ist
 * es zu spät. Der Rumpf ist deshalb nicht neu getippt, sondern kopiert, und
 * diese Datei rechnet das bei jedem Testlauf nach:
 *
 *   1. Beide Abdrücke stimmen mit den Zahlen in der Migration überein.
 *   2. Der neue Rumpf MINUS den neuen Bereich, mit Version und Gruppenkopf
 *      zurückgedreht, ist Zeichen für Zeichen der alte. Das ist die
 *      eigentliche Zusicherung: 30 405 Zeichen gehen unverändert durch.
 *   3. `R0144` stellt genau den alten Rumpf wieder her.
 *
 * WIE DIE ABDRÜCKE ENTSTANDEN. Nicht geraten: gemessen. PostgreSQL legt in
 * `prosrc` den Inhalt zwischen den `$$`-Marken ab — beginnend mit dem
 * Zeilenumbruch NACH `as $$`. Das wurde an echtem PostgreSQL (PGlite)
 * nachgefahren, bevor eine Zahl in die Migration kam, und Probelauf **P51**
 * fährt es bei jedem `npm run check` erneut.
 */

const md5 = (s: string) => createHash("md5").update(s).digest("hex");

const ALT = "2e2da90e976a1e73ca00aba7cd830fae";
const NEU = "4c4d2e7c81e4efa8e18cdffa06bba40a";

const P0105 = "supabase/migrations/0105_platform_export.sql";
const P0144 = "supabase/migrations/0144_platform_export_calculations.sql";
const PR0144 = "supabase/rollback/R0144_platform_export_back_to_0105.sql";

/**
 * Der Rumpf, genau wie PostgreSQL ihn speichert.
 *
 * Ab dem Zeichen nach `as $$` — das ist der Zeilenumbruch — bis
 * einschliesslich des `\n` vor `$$;`. Diese Grenzen sind gemessen, nicht
 * angenommen; eine um ein Zeichen verschobene Grenze ergäbe einen Abdruck,
 * der nie zu dem der Datenbank passt.
 */
function rumpf(datei: string): string {
  const sql = readFileSync(datei, "utf8");
  const von = sql.indexOf("create or replace function public.system_platform_export()");
  expect(von, `${datei}: keine Funktionsdefinition`).toBeGreaterThan(-1);
  const a = sql.indexOf("as $$", von) + "as $$".length;
  const b = sql.indexOf("\n$$;", a);
  return sql.slice(a, b + 1);
}

const ALTER_RUMPF = rumpf(P0105);
const NEUER_RUMPF = rumpf(P0144);
const bereiche = (s: string) => (s.match(/coalesce\(\(/g) ?? []).length;

describe("die beiden Abdrücke", () => {
  it("der Rumpf aus 0105 ist der, den die Migration voraussetzt", () => {
    expect(md5(ALTER_RUMPF)).toBe(ALT);
    expect(bereiche(ALTER_RUMPF)).toBe(53);
  });

  it("der Rumpf aus 0144 ist der, den sie zusichert", () => {
    expect(md5(NEUER_RUMPF)).toBe(NEU);
    expect(bereiche(NEUER_RUMPF)).toBe(54);
  });

  it("und die Migration nennt beide — als Riegel und als Nachbedingung", () => {
    const sql = readFileSync(P0144, "utf8");
    /* Der Vorriegel: nur der bekannte Rumpf wird ersetzt. */
    expect(sql).toContain(`if v_abdruck <> '${ALT}' then`);
    /* Der Wiederanwendungsschutz: der neue Rumpf steht schon. */
    expect(sql).toContain(`if v_abdruck = '${NEU}' then`);
    /* Und die Nachbedingung. */
    expect(sql).toContain(`if v_abdruck <> '${NEU}' then`);
  });
});

describe("der neue Rumpf ist der alte plus EIN Bereich", () => {
  /**
   * Die Umkehrung, und sie ist die stärkste Aussage dieser Datei.
   *
   * Statt zu prüfen, dass bestimmte Dinge noch da sind — eine Liste, die
   * jemand pflegen müsste —, wird der neue Rumpf zurückgedreht: Bereich
   * heraus, Version zurück, Gruppenkopf zurück. Was übrig bleibt, MUSS
   * byteweise der alte sein. Eine vierte Änderung, irgendwo in 30 405
   * Zeichen, fällt damit auf, auch wenn niemand sie sucht.
   */
  const ABSCHNITT_VON = "        ), '[]'::jsonb),\n\n        'purchase_calculations', coalesce((";
  const ABSCHNITT_BIS = "from public.purchase_calculations t\n        ), '[]'::jsonb)";

  it("zurückgedreht ist er Zeichen für Zeichen der alte", () => {
    const a = NEUER_RUMPF.indexOf(ABSCHNITT_VON);
    const b = NEUER_RUMPF.indexOf(ABSCHNITT_BIS) + ABSCHNITT_BIS.length;
    expect(a, "der neue Bereich steht nicht, wo er stehen soll").toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);

    const zurueck = (NEUER_RUMPF.slice(0, a) + "        ), '[]'::jsonb)" + NEUER_RUMPF.slice(b))
      .replace("    'format_version', 2,\n", "    'format_version', 1,\n")
      .replace("      /* ---- Lager und Orderbuch — 13 Bereiche, 26 Argumente ---- */",
               "      /* ---- Lager und Orderbuch — 12 Bereiche, 24 Argumente ---- */");

    expect(md5(zurueck)).toBe(ALT);
    expect(zurueck).toBe(ALTER_RUMPF);
  });

  it("genau drei Unterschiede, und jeder ist benannt", () => {
    /* 1. Die Formatversion. */
    expect(ALTER_RUMPF).toContain("'format_version', 1,");
    expect(NEUER_RUMPF).toContain("'format_version', 2,");
    /* 2. Der Gruppenkopf. */
    expect(NEUER_RUMPF).toContain("Lager und Orderbuch — 13 Bereiche, 26 Argumente");
    /* 3. Der Bereich selbst, genau einmal. */
    expect(NEUER_RUMPF.match(/'purchase_calculations', coalesce\(\(/g)).toHaveLength(1);
    /* Und 18 Zeilen mehr, nicht mehr und nicht weniger. */
    const zeilen = (s: string) => s.split("\n").length;
    expect(zeilen(NEUER_RUMPF) - zeilen(ALTER_RUMPF)).toBe(18);
  });

  it("der Bereich führt alle zwölf Spalten der Tabelle", () => {
    /*
     * Gegen das SCHEMA, nicht gegen eine Liste: `columnsOf` faltet die
     * Spalten aus den Migrationen. Eine Spalte, die `0142` anlegt und die
     * hier fehlte, fiele aus der Sicherung — genau der Fehler, den diese
     * Migration behebt, nur eine Ebene tiefer.
     */
    const a = NEUER_RUMPF.indexOf("'purchase_calculations', coalesce((");
    const b = NEUER_RUMPF.indexOf("from public.purchase_calculations t", a);
    const block = NEUER_RUMPF.slice(a, b);
    const spalten = [...columnsOf("purchase_calculations")].sort();
    expect(spalten).toHaveLength(12);
    for (const spalte of spalten) {
      expect(block, `${spalte} fehlt im Exportbereich`).toContain(`'${spalte}', t.${spalte}`);
    }
  });

  it("und das Manifest führt dieselben zwölf", () => {
    const abschnitt = PLATFORM_SECTIONS.find((s) => s.source === "purchase_calculations");
    expect(abschnitt, "kein Manifestabschnitt").toBeDefined();
    expect([...abschnitt!.fields].sort()).toEqual([...columnsOf("purchase_calculations")].sort());
    expect(abschnitt!.personalData).toBe(true);
    expect(abschnitt!.restoreRelevant).toBe(true);
  });
});

describe("die Formatversion und die alten Archive", () => {
  it("das Manifest sagt 2, und die Zuordnung kennt beide Versionen", () => {
    expect(PLATFORM_FORMAT_VERSION).toBe(2);
    expect(SECTIONS_BY_FORMAT_VERSION).toEqual({ 1: 53, 2: 54 });
  });

  it("die Zahl zu Version 2 ist die Zahl der Bereiche im Manifest", () => {
    expect(SECTIONS_BY_FORMAT_VERSION[2]).toBe(PLATFORM_SECTIONS.length);
  });

  it("und die zu Version 1 ist das Manifest ohne den neuen Bereich", () => {
    /*
     * Damit bleibt ein Archiv der Version 1 prüfbar: 53 ist nicht eine
     * Zahl, die jemand getippt hat, sondern die heutige minus dem einen
     * Bereich, den `0144` hinzugefügt hat.
     */
    const ohneNeu = PLATFORM_SECTIONS.filter((s) => s.source !== "purchase_calculations");
    expect(SECTIONS_BY_FORMAT_VERSION[1]).toBe(ohneNeu.length);
  });
});

describe("was 0144 ausdrücklich NICHT tut", () => {
  const sql = readFileSync(P0144, "utf8");
  const code = sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");

  it("keine Tabelle, keine Spalte, kein Index, keine Richtlinie", () => {
    for (const verboten of ["create table", "alter table", "create index",
                            "create policy", "drop table", "drop policy",
                            "insert into", "update public.", "delete from"]) {
      expect(code.toLowerCase().includes(verboten), `0144 darf ${verboten} nicht tun`)
        .toBe(false);
    }
  });

  it("keine Rechteänderung ausser der ausdrücklichen Wiederholung", () => {
    /* Genau zwei Zeilen, und beide stellen den bestehenden Zustand fest. */
    expect(code).toContain("revoke all on function public.system_platform_export() "
      + "from public, anon;");
    expect(code).toContain("grant execute on function public.system_platform_export() "
      + "to authenticated;");
    expect(code.match(/^grant /gm)).toHaveLength(1);
    expect(code.match(/^revoke /gm)).toHaveLength(1);
  });

  it("rührt Belegsperre und Verkaufsfreigaben nicht an", () => {
    /*
     * HIER STAND EINE ZU GROBE LISTE, und sie war falsch: `shop_inventory`
     * und `inventory_movements` STEHEN im Rumpf, weil der Export sie
     * exportiert — sie sind Bereiche seit `0105`. Ein Name im Rumpf ist
     * keine Berührung; was zählt, ist ein SCHREIBVORGANG, und den schliesst
     * der Test darüber aus.
     *
     * Was wirklich nirgends vorkommen darf, sind die Belegausstellung und
     * die Freigabelogik — beides nennt der Export nicht und soll er nicht
     * nennen.
     */
    for (const fremd of ["issue_platform_receipt", "correct_platform_receipt",
                         "sale_released", "is_position_sellable", "shop_offers"]) {
      expect(code.includes(fremd), `${fremd} gehört nicht in 0144`).toBe(false);
    }
    /* Und die Gegenprobe, damit die Liste nicht leer wirkt: die Bereiche,
       die der Export legitim führt, stehen sehr wohl drin. */
    expect(code).toContain("from public.shop_inventory t");
    expect(code).toContain("from public.inventory_movements t");
  });

  it("behebt die vier bekannten Spaltenlücken NICHT — die bleiben dokumentiert", () => {
    /*
     * `item_type`, `usk_rating`, `sale_released` und `delivery_scope` fehlen
     * weiter im Export. Das ist Absicht und eine eigene Entscheidung
     * (`supabase/checks/platform_export_gap.md`); sie hier mitzunehmen wäre
     * eine Änderung, die niemand geprüft hat.
     */
    const a = NEUER_RUMPF.indexOf("'skylanders', coalesce((");
    const b = NEUER_RUMPF.indexOf("), '[]'::jsonb)", a);
    const katalog = NEUER_RUMPF.slice(a, b);
    expect(katalog).not.toContain("'item_type'");
    expect(katalog).not.toContain("'usk_rating'");
    const gap = readFileSync("supabase/checks/platform_export_gap.md", "utf8");
    expect(gap).toContain("item_type");
    expect(gap).toContain("usk_rating");
  });

  it("und baut keine Wiederherstellung", () => {
    /*
     * Gegen die DEFINITIONEN, nicht gegen das Wort: der
     * `comment on function` erklärt ausdrücklich, dass es keine
     * Wiederherstellung gibt, und enthält deshalb „restore". Was zählt: die
     * Datei legt genau eine Funktion an, und das ist die Exportfunktion.
     */
    const definitionen = [...code.matchAll(/create (?:or replace )?(?:function|procedure) ([a-z_.]+)/g)]
      .map((m) => m[1]);
    expect(definitionen).toEqual(["public.system_platform_export"]);
    /* Und die Grenzen stehen geschrieben, statt verschwiegen zu werden. */
    expect(sql).toContain("0144_restore_limits.md");
    expect(sql).toContain("`restore_supported` bleibt `false`");
  });
});

describe("die Rücknahme R0144", () => {
  const sql = readFileSync(PR0144, "utf8");
  const code = sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");

  it("stellt Zeichen für Zeichen den Rumpf aus 0105 wieder her", () => {
    expect(md5(rumpf(PR0144))).toBe(ALT);
    expect(rumpf(PR0144)).toBe(ALTER_RUMPF);
    expect(bereiche(rumpf(PR0144))).toBe(53);
  });

  it("und fasst keine Nutzerdaten an", () => {
    for (const verboten of ["drop table", "delete from", "update public.",
                            "insert into", "truncate", "alter table"]) {
      expect(code.toLowerCase().includes(verboten), `R0144 darf ${verboten} nicht tun`)
        .toBe(false);
    }
    /* Sie liest die Zeilenzahl nur, um sie zu MELDEN. */
    expect(code).toContain("select count(*) into v_zeilen from public.purchase_calculations;");
  });

  it("ist idempotent und weist eine dritte Fassung ab", () => {
    expect(sql).toContain(`if v_abdruck = '${ALT}' then`);
    expect(sql).toContain("aendert nichts");
    expect(sql).toContain("Eine dritte Fassung wird nicht");
  });
});
