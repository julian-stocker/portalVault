import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { GEREGELT } from "./publish-compare";
import { folgeschritte, zustandNachLauf, NACH_ANLAGE, VON_DER_ANLAGE } from "./publish-new-figure";
import { pruefeBasisziele } from "./publish-variants";

/* ==========================================================================
 * EINE NEUE FIGUR — EIN PUBLISH, DANN EIN LEERER PLAN (CAT-11)
 *
 * Vorher kamen `display_name_override` und `visible_type_decided` erst im
 * zweiten Lauf. Hier wird fuer jede Form einer neuen Zeile gerechnet: was
 * steht nach dem ERSTEN Lauf auf Production — und plant der Vergleich danach
 * noch irgendetwas? Er darf nicht.
 * ========================================================================== */

/** Eine Staging-Zeile in der Schreibweise des Plans. */
function zeile(ueber: Record<string, string>): Record<string, string> {
  return {
    series_code: "SA", kategorie: "Figuren", name: "X", slug: "x",
    display_name_override: "~", card_type: "standard", item_type: "figure",
    is_active: "true", catalog_visible: "true", catalog_status: "public",
    base_sky_id: "~", familie: "~", types: "~", visible_type: "~",
    visible_type_decided: "false", image_file: "~", image_override_path: "~",
    source: "admin", usk_rating: "~",
    ...ueber,
  };
}

/** Der Feldvergleich des Planers fuer eine BESTEHENDE Zeile: was weicht ab? */
function naechsterPlan(staging: Record<string, string>, production: Record<string, string>) {
  return GEREGELT.filter((f) => staging[f] !== production[f]);
}

const FAELLE: [string, Record<string, string>][] = [
  ["eine schlichte Figur", zeile({})],
  ["Silver Boomer: Chase-Variante von Boomer, Banner entschieden",
    zeile({ name: "Silver Boomer", card_type: "chase", base_sky_id: "SKY-0010",
            types: "chase", visible_type: "chase", visible_type_decided: "true" })],
  ["ausdrücklich KEIN Banner (NULL, entschieden)",
    zeile({ types: "chase", visible_type: "~", visible_type_decided: "true" })],
  ["ein Banner, das als unentschieden gilt", zeile({ types: "giant", visible_type: "giant" })],
  ["mit Anzeigename", zeile({ display_name_override: "Silver Boomer" })],
  ["mit Bild und Familie", zeile({ image_override_path: "SKY-0929/a.webp", familie: "Boomer" })],
  ["inaktiv", zeile({ is_active: "false" })],
  ["alles zugleich", zeile({ display_name_override: "Y", base_sky_id: "SKY-0010",
    familie: "Boomer", types: "chase+giant", visible_type: "~",
    visible_type_decided: "true", image_override_path: "SKY-0931/b.webp", is_active: "false" })],
];

describe("der erste Publish macht die neue Figur vollstaendig", () => {
  for (const [titel, staging] of FAELLE) {
    it(`${titel} — danach plant der Vergleich nichts mehr`, () => {
      const schritte = folgeschritte(staging, GEREGELT);
      const production = zustandNachLauf(staging, schritte);
      expect(naechsterPlan(staging, production)).toEqual([]);
    });
  }

  it("Anzeigename und Bannerkennzeichen sind dabei — die zwei, die fehlten", () => {
    const a = folgeschritte(zeile({ display_name_override: "Silver Boomer" }), GEREGELT);
    expect(a).toContainEqual({ feld: "display_name_override", von: "~", nach: "Silver Boomer" });
    const b = folgeschritte(zeile({ visible_type_decided: "true" }), GEREGELT);
    expect(b).toContainEqual({ feld: "visible_type_decided", von: "false", nach: "true" });
  });

  it("nach einem Bannerschritt ist der erwartete alte Wert des Kennzeichens `true`", () => {
    const s = folgeschritte(zeile({ types: "giant", visible_type: "giant" }), GEREGELT);
    expect(s).toContainEqual({ feld: "visible_type_decided", von: "true", nach: "false" });
  });

  it("und kein ueberfluessiger Schritt: Banner gesetzt und entschieden braucht keinen eigenen", () => {
    const s = folgeschritte(FAELLE[1][1], GEREGELT);
    expect(s.map((x) => x.feld)).toEqual(["types", "visible_type", "base_sky_id"]);
  });

  it("eine schlichte Figur hat keinen einzigen Folgeschritt", () => {
    expect(folgeschritte(zeile({}), GEREGELT)).toEqual([]);
  });

  it("jedes geregelte Feld ist entweder Sache der Anlage oder hat einen Vorgabewert", () => {
    /* Ein spaeter dazukommendes geregeltes Feld faellt hier auf, statt still
       im zweiten Lauf nachzukommen. */
    for (const f of GEREGELT) {
      expect((VON_DER_ANLAGE as readonly string[]).includes(f) || f in NACH_ANLAGE, f).toBe(true);
    }
  });

  it("die Variante einer neuen Basisfigur hat ihr Ziel im selben Lauf", () => {
    const plan = [
      { art: "figur-anlegen", sky_id: "SKY-0930" },
      { art: "figur-anlegen", sky_id: "SKY-0931" },
      { art: "feld-neu", sky_id: "SKY-0931", feld: "base_sky_id", von: "~", nach: "SKY-0930" },
    ];
    expect(pruefeBasisziele(plan, new Set()).ok).toBe(true);
  });
});

describe("der Planer und der Apply-Pfad benutzen das", () => {
  const sync = readFileSync("tools/catalog-sync.mts", "utf8");
  const apply = readFileSync("tools/catalog-sync-apply.mts", "utf8");

  it("der Planer rechnet die Folgeschritte aus `folgeschritte()`, nicht aus einer Handliste", () => {
    expect(sync).toContain("folgeschritte(quelleFelder, GEREGELT)");
    expect(sync).not.toContain('for (const f of ["types", "visible_type", "familie", "base_sky_id"] as const)');
  });

  it("der Apply-Pfad ueberspringt das Kennzeichen nur, wenn die RPC genau das setzt", () => {
    expect(apply).toContain('setztBanner.has(s.sky_id) && s.nach === "true"');
    expect(apply).toContain('if (s.feld === "visible_type_decided" && setztBanner.has(s.sky_id)) s.von = "true";');
  });
});
