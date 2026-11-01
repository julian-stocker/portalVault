import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { OVP_REMOVAL, OVP_REMOVED_SKY_IDS, istEntferntesOvpDuplikat, ledgerOhneEntfernte, pruefeEntfernte } from "./ovp-removal";
import { parseEliteEdition } from "./variant";
import { pruefeDrift } from "./publish-drift";

/* ==========================================================================
 * DIE 30 OVP-DUPLIKATE — Liste, Schutz der regulaeren Figuren, keine
 * Wiederanlage, und der Publish danach (CAT-12, ADR-0166)
 * ========================================================================== */

type Item = { id: string; name: string; series: string };
const EXPORT = (JSON.parse(readFileSync("data/catalog/products.json", "utf8")) as { items: Item[] }).items;
const LISTE = OVP_REMOVAL.eintraege;

describe("die Liste ist exakt und explizit", () => {
  it("30 Eintraege, 30 verschiedene SKY-IDs, jede im historischen Bereich", () => {
    expect(LISTE).toHaveLength(30);
    expect(OVP_REMOVED_SKY_IDS.size).toBe(30);
    for (const e of LISTE) expect(e.sky_id).toMatch(/^SKY-0[0-8]\d{2}$/);
  });

  it("14 + 14 Eon's-Elite-Schachteln und die zwei mit OVP im Namen", () => {
    const zahl = (g: string) => LISTE.filter((e) => e.gruppe === g).length;
    expect(zahl("elite-ovp-series-1")).toBe(14);
    expect(zahl("elite-ovp-series-2")).toBe(14);
    expect(LISTE.filter((e) => e.gruppe === "ovp-im-namen").map((e) => `${e.sky_id} ${e.name}`))
      .toEqual(["SKY-0564 Kaos in OVP", "SKY-0591 Dark Pyramid - OVP"]);
  });

  it("Gegenprobe: jede Elite-Schachtel ist nach der App-eigenen Regel eine OVP-Ausgabe", () => {
    /* Nicht die Quelle der Liste — sie ist kuratiert —, sondern ihr Beleg:
       die Schachtel wird nur erkannt, wenn ihre lose Schwester existiert. */
    for (const e of LISTE.filter((x) => x.gruppe !== "ovp-im-namen")) {
      const lose = EXPORT.find((i) => i.id === e.regulaere_figur)!;
      const namen = new Set([e.name, lose.name]);
      expect(parseEliteEdition(e.name, namen)?.editionLabel, e.sky_id)
        .toBe(e.gruppe === "elite-ovp-series-1" ? "OVP Series 1" : "OVP Series 2");
    }
  });
});

describe("die regulaeren Figuren bleiben", () => {
  it("keine regulaere Figur steht auf der Liste", () => {
    const regulaer = new Set(LISTE.map((e) => e.regulaere_figur));
    expect(regulaer.size).toBe(16);
    for (const id of regulaer) expect(istEntferntesOvpDuplikat(id), id).toBe(false);
  });

  it("alle 16 stehen weiter im Export, mit ihrem Namen — die 14 losen Elite-Figuren, Kaos, Dark Pyramid", () => {
    for (const e of LISTE) {
      const r = EXPORT.find((i) => i.id === e.regulaere_figur);
      expect(r, e.regulaere_figur).toBeTruthy();
      if (e.gruppe !== "ovp-im-namen") expect(r!.name).toMatch(/- ohne OVP$/);
    }
  });

  it("der Export hat genau die 30 verloren: 570 Zeilen, keine davon auf der Liste", () => {
    expect(EXPORT).toHaveLength(570);
    for (const i of EXPORT) expect(OVP_REMOVED_SKY_IDS.has(i.id), i.id).toBe(false);
  });

  it("keine Charakterzuordnung und keine Shop-Fixture zeigt noch auf die 30", () => {
    for (const datei of ["data/characters/characters.json", "data/catalog/staging-shop-fixtures.json"]) {
      const text = readFileSync(datei, "utf8");
      for (const id of OVP_REMOVED_SKY_IDS) expect(text.includes(`"${id}"`), `${datei}: ${id}`).toBe(false);
    }
  });
});

describe("keine Wiederanlage", () => {
  it("Riegel 6 findet jeden Schritt an einer entfernten SKY-ID — Anlage und Feld, in jede Richtung", () => {
    const plan = [
      { ziel: "production", art: "figur-anlegen", sky_id: "SKY-0012" },
      { ziel: "staging", art: "figur-anlegen", sky_id: "SKY-0564" },
      { ziel: "production", art: "feld", sky_id: "SKY-0013", feld: "catalog_status" },
      { ziel: "production", art: "figur-anlegen", sky_id: "SKY-0929" },
      { ziel: "production", art: "feld", sky_id: "SKY-0011", feld: "types" },
    ];
    expect(pruefeEntfernte(plan).map((s) => s.sky_id)).toEqual(["SKY-0012", "SKY-0564", "SKY-0013"]);
  });

  it("der Planer prueft ihn in BEIDEN Modi, vor der Einwegpruefung", () => {
    const sync = readFileSync("tools/catalog-sync.mts", "utf8");
    const r6 = sync.indexOf("const r6 = pruefeEntfernte(plan)");
    expect(r6).toBeGreaterThan(-1);
    expect(sync.slice(r6 - 400, r6)).not.toContain("if (!BOOTSTRAP)");
    expect(r6).toBeLessThan(sync.indexOf("RIEGEL 4: die Einwegrichtung */"));
  });

  it("der Katalogimport sondert sie aus, bevor er validiert und plant", () => {
    const imp = readFileSync("tools/import-catalog.mts", "utf8");
    const aus = imp.indexOf("data.items = data.items.filter((item) => !OVP_REMOVED_SKY_IDS.has(item.id))");
    expect(aus).toBeGreaterThan(-1);
    expect(aus).toBeLessThan(imp.indexOf("validate(data);"));
  });

  it("und die Datenbank haelt es selbst: der Trigger aus 0167 steht vor JEDEM Insert", () => {
    const sql = readFileSync("supabase/migrations/0167_ovp_removal.sql", "utf8");
    expect(sql).toContain("before insert on public.skylanders");
    expect(sql).toContain("public.catalog_removed_sky_ids r where r.sky_id = new.sky_id");
  });
});

describe("der Publish nach der Bereinigung", () => {
  const FELDER = ["series_code", "catalog_status"];
  const zeile = (s: string) => `SA|${s}`;
  const ledger = {
    geregelte_felder: FELDER,
    stand: { "SKY-0011": zeile("public"), "SKY-0012": zeile("hidden"), "SKY-0564": zeile("hidden") },
  } as unknown as Parameters<typeof pruefeDrift>[0];

  it("zwischen Phase A und B: Staging ohne, Production mit — kein Drift, kein Abbruch", () => {
    const b = pruefeDrift(ledger, { "SKY-0011": zeile("public") },
      { "SKY-0011": zeile("public"), "SKY-0012": zeile("hidden"), "SKY-0564": zeile("hidden") });
    expect(b.ok).toBe(true);
    expect(b.drift).toEqual([]);
  });

  it("nach Phase B: beide ohne — kein Drift; die Ledger-Eintraege fallen beim naechsten Publish fort", () => {
    const b = pruefeDrift(ledger, { "SKY-0011": zeile("public") }, { "SKY-0011": zeile("public") });
    expect(b.ok).toBe(true);
    expect(b.fehlen_auf_production).toEqual(["SKY-0012", "SKY-0564"]);
    /* Das Ledger wird nach jedem erfolgreichen Publish aus dem Production-Stand
       neu geschrieben — die entfernten Zeilen stehen darin dann nicht mehr. */
    const pub = readFileSync("tools/catalog-publish.mts", "utf8");
    expect(pub).toContain("stand: standP");
  });
});

describe("Riegel 6 und der Gleichstand blockieren den Publish nicht dauerhaft", () => {
  it("beide Werkzeuge nehmen die 30 aus der geregelten Projektion — nicht aus dem Bootstrap-Fingerprint", () => {
    const sync = readFileSync("tools/catalog-sync.mts", "utf8");
    const pub = readFileSync("tools/catalog-publish.mts", "utf8");
    const stand = sync.slice(sync.indexOf("function geregelterStand"), sync.indexOf("if (BOOTSTRAP) {"));
    expect(stand).toContain("if (OVP_REMOVED_SKY_IDS.has(id)) continue;");
    expect(pub).toContain("if (OVP_REMOVED_SKY_IDS.has(id)) continue;");
    const aus = sync.slice(sync.indexOf("const ausgeschlossen = "), sync.indexOf("/** Bereich 1-4 des Fingerprints"));
    expect(aus).not.toContain("OVP_REMOVED");
  });

  it("vorher, zwischen Phase A und B und nachher: dieselbe Projektion auf beiden Seiten", () => {
    /* Was `geregelterStand` jetzt tut, als Rechnung: die 30 fallen auf beiden
       Seiten heraus, egal wo sie gerade noch stehen. */
    const projektion = (ids: string[]) => ids.filter((id) => !OVP_REMOVED_SKY_IDS.has(id)).sort();
    const regulaer = ["SKY-0010", "SKY-0011"];
    const vorher = projektion([...regulaer, "SKY-0012", "SKY-0564"]);
    const zwischenStaging = projektion(regulaer);
    const zwischenProduction = projektion([...regulaer, "SKY-0012", "SKY-0564"]);
    expect(zwischenStaging).toEqual(zwischenProduction);
    expect(vorher).toEqual(zwischenStaging);
  });

  it("Riegel 6 liest nur den Plan, nie das Ledger — alte Ledger-Eintraege koennen ihn nicht ausloesen", () => {
    const sync = readFileSync("tools/catalog-sync.mts", "utf8");
    const r6 = sync.slice(sync.indexOf("RIEGEL 6: keine entfernte"), sync.indexOf("RIEGEL 4: die Einwegrichtung */"));
    expect(r6).toContain("pruefeEntfernte(plan)");
    expect(r6).not.toMatch(/ledger|stand\b/i);
  });
});

describe("Entfernung und Grabstein in derselben Transaktion", () => {
  it("die Funktion loescht und schreibt den Grabstein in EINEM Rumpf, die Huelle klammert alle 30", () => {
    const sql = readFileSync("supabase/migrations/0167_ovp_removal.sql", "utf8");
    const fn = sql.slice(sql.indexOf("create or replace function public.system_remove_ovp_figure"));
    expect(fn.indexOf("delete from public.skylanders where sky_id = p_sky_id"))
      .toBeLessThan(fn.indexOf("insert into public.catalog_removed_sky_ids"));
    for (const datei of ["supabase/operations/staging-ovp-removal.sql", "supabase/operations/prod-ovp-removal.sql"]) {
      const h = readFileSync(datei, "utf8");
      expect(h.match(/^begin;$/gm), datei).toHaveLength(1);
      expect(h.trimEnd().endsWith("commit;"), datei).toBe(true);
    }
  });
});

describe("das Ledger verliert die 30 — nur wenn sonst nichts anders ist", () => {
  const regulaer = { "SKY-0010": "SA|public", "SKY-0011": "SA|public" };
  const ledger = { ...regulaer, "SKY-0012": "SA|hidden", "SKY-0564": "I|hidden" };

  it("nach der Bereinigung: das Ledger ohne die 30 ist genau der Production-Stand", () => {
    const r = ledgerOhneEntfernte(ledger, regulaer, regulaer);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.stand).toEqual(regulaer);
      expect(r.entfernt).toEqual(["SKY-0012", "SKY-0564"]);
    }
  });

  it("eine weitere Abweichung auf Production: keine Fortschreibung — das waere ein Publish", () => {
    const r = ledgerOhneEntfernte(ledger, regulaer, { ...regulaer, "SKY-0011": "SA|hidden" });
    expect(r.ok).toBe(false);
  });

  it("Staging steht anders: keine Fortschreibung", () => {
    const r = ledgerOhneEntfernte(ledger, { ...regulaer, "SKY-0929": "SA|public" }, regulaer);
    expect(r.ok).toBe(false);
  });

  it("nichts zu entfernen: keine Fortschreibung", () => {
    expect(ledgerOhneEntfernte(regulaer, regulaer, regulaer).ok).toBe(false);
  });

  it("der Publish nutzt sie im 0-Schritte-Zweig, schreibt die Datei nur mit --apply und prueft den neuen Stand", () => {
    const pub = readFileSync("tools/catalog-publish.mts", "utf8");
    const zweig = pub.slice(pub.indexOf('if (nach(p0, "production") === 0) {'), pub.indexOf("[FERTIG] 0 offene Schritte"));
    expect(zweig).toContain("ledgerOhneEntfernte(ledgerRoh.stand, await geregelterStand(S), await geregelterStand(P))");
    expect(zweig).toContain("pruefeLedger(neu)");
    expect(zweig.indexOf("if (APPLY)")).toBeLessThan(zweig.indexOf("writeFileSync(LEDGER"));
    expect(zweig).not.toMatch(/\.(insert|update|delete|upsert|rpc)\(/);
  });
});

