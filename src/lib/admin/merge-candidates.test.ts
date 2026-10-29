import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  falte, findeTreffer, GENERISCH, MERGE_FELDER, nutzlast, tabellenzeilen,
  vorschau, ZUSAMMEN,
  type Kandidatenzeile, type Werte,
} from "./merge-candidates";

/**
 * Die Migration, in der die GÜLTIGE Fassung der Übernahmeregeln steht.
 *
 * `0154` hat sie gebracht, `0156` hat die Feldauswahl ergänzt, `0157` hat
 * `admin_note` herausgenommen. Eine angewendete Migration wird nicht
 * verändert (`APPLIED.md`, Regel 1) — die jeweils letzte ersetzt den
 * Funktionsrumpf, und genau sie muss die Spiegelung hier treffen. Diese
 * Konstante ist die eine Stelle, die bei der nächsten Fassung umzuhängen
 * ist.
 */
const GUELTIG = "supabase/migrations/0157_audit_fields_and_automatic_notes.sql";

/**
 * CAT-05 — die Vorschläge für eine Zusammenführung.
 *
 * DREI FEHLSCHLÜSSE SIND BEIM BAUEN PASSIERT, und jeder hätte zu einer
 * falschen Gleichsetzung geführt. Sie haben hier je einen Test, damit sie
 * nicht wiederkommen:
 *
 *   1. eine Variante ist nicht ihre Grundfigur
 *   2. bei Zubehör ist die Farbe die Identität
 *   3. ein Merkmalswort auf nur einer Seite ist ein Unterschied
 */

const zeile = (ueber: Partial<Kandidatenzeile> = {}): Kandidatenzeile => ({
  skyId: "SKY-0100", name: "Eruptor", seriesCode: "SA", categoryName: "Figuren",
  cardType: "standard", catalogStatus: "public", ...ueber,
});
const entwurf = (ueber: Record<string, unknown> = {}) => ({
  ...zeile({ skyId: "SKY-0900", catalogStatus: "draft" }),
  kern: "eruptor", hatFamilie: false, istFigur: true, ...ueber,
} as Kandidatenzeile & { kern: string; hatFamilie: boolean; istFigur: boolean });

describe("1 — eine Variante ist nicht ihre Grundfigur", () => {
  it("die Grundfigur wird als Bezug gezeigt, nicht als Dublette", () => {
    const t = findeTreffer(
      entwurf({ name: "Silver Eruptor", hatFamilie: true, kern: "eruptor" }),
      [zeile({ name: "Eruptor" })]);
    expect(t).toHaveLength(1);
    expect(t[0].stufe).toBe("Grundfigur");
    expect(t[0].grund).toContain("keine Dublette");
  });

  it("und zwei Varianten derselben Figur sind erst recht keine Dublette", () => {
    /* „Chrome Spyro" und „Dark Spyro" haben denselben Kern und verschiedene
       Ausführungen — zwei Produkte. */
    const t = findeTreffer(
      entwurf({ name: "Chrome Spyro", hatFamilie: true, kern: "spyro" }),
      [zeile({ name: "Dark Spyro" })]);
    expect(t.every((x) => x.stufe !== "wahrscheinlich identisch")).toBe(true);
    expect(t.every((x) => x.stufe !== "eindeutig identisch")).toBe(true);
  });
});

describe("2 — bei Zubehör ist die Farbe die Identität", () => {
  it("Gold Mystery Chest ist nicht Mystery Chest Blue", () => {
    const t = findeTreffer(
      entwurf({ name: "Gold Mystery Chest", seriesCode: "I",
                categoryName: "Locations & Truhen", istFigur: false, kern: "" }),
      [zeile({ skyId: "SKY-0584", name: "Mystery Chest Blue", seriesCode: "I",
               categoryName: "Locations & Truhen" })]);
    expect(t.every((x) => x.stufe !== "wahrscheinlich identisch")).toBe(true);
  });

  it("aber dieselben Wörter in anderer Stellung schon", () => {
    const t = findeTreffer(
      entwurf({ name: "Gold Mystery Chest", seriesCode: "I",
                categoryName: "Locations & Truhen", istFigur: false, kern: "" }),
      [zeile({ skyId: "SKY-0587", name: "Mystery Chest Gold", seriesCode: "I",
               categoryName: "Locations & Truhen" })]);
    expect(t[0].stufe).toBe("wahrscheinlich identisch");
  });
});

describe("3 — ein Merkmalswort auf einer Seite ist ein Unterschied", () => {
  it("Snow-Brite Stormblade (Employee Edition) ist nicht Stormblade", () => {
    const t = findeTreffer(
      entwurf({ name: "Snow-Brite Stormblade (Employee Edition)", seriesCode: "SC",
                categoryName: "Figuren", kern: "" }),
      [zeile({ skyId: "SKY-0488", name: "Stormblade", seriesCode: "SC",
               categoryName: "Figuren" })]);
    expect(t[0].stufe).toBe("unsicher");
    expect(t[0].grund).toContain("eher Variante als Dublette");
  });
});

describe("die sichere Seite", () => {
  it("ein zeichengleicher Name in derselben Serie ist eindeutig", () => {
    const t = findeTreffer(entwurf({ name: "Kaos Trap", kern: "" }),
                           [zeile({ skyId: "SKY-0419", name: "kaos trap" })]);
    expect(t[0].stufe).toBe("eindeutig identisch");
  });

  it("eine andere Serie ist kein Treffer", () => {
    /* Gleiche Namen in verschiedenen Serien sind Wiederveröffentlichungen —
       der Grund, warum die Serie überall der Unterscheider ist. */
    const t = findeTreffer(entwurf({ name: "Eruptor", kern: "" }),
                           [zeile({ name: "Eruptor", seriesCode: "G" })]);
    expect(t).toHaveLength(0);
  });

  it("und der Entwurf trifft nie sich selbst", () => {
    const selbst = entwurf({ name: "Eruptor", kern: "" });
    expect(findeTreffer(selbst, [selbst])).toHaveLength(0);
  });

  it("die Faltung ignoriert Schreibweise, nicht Bedeutung", () => {
    expect(falte("Dino-Rang")).toBe(falte("Dino Rang"));
    expect(falte("Eon’s Elite")).toBe("eons elite");
  });
});

describe("die Vorschau sagt dasselbe wie die geltende Migration", () => {
  it("was der Entwurf hat, geht über — was er nicht hat, bleibt", () => {
    const v = vorschau(
      { name: "Pirate Ship", display_name_override: "Alt" },
      { name: "Pirate Seas", display_name_override: null });
    const felder = v.aenderungen.map((a) => a.feld);
    expect(felder).toContain("name");
    /* LEER IST KEINE ANGABE: der Entwurf hat keinen Anzeigenamen, der
       bestehende bleibt. */
    expect(felder).not.toContain("display_name_override");
    expect(v.aenderungen.find((a) => a.feld === "name")).toMatchObject(
      { alt: "Pirate Ship", neu: "Pirate Seas" });
  });

  it("ein Platzhalter ersetzt keine Angabe", () => {
    /*
     * `standard` steht bei 51 der 105 Entwürfe nur, weil es einen
     * Vorgabewert gibt. Ihn auf eine belegte `chase`-Edition zu schreiben
     * wäre ein Rückschritt, der wie eine Pflege aussieht.
     */
    const v = vorschau({ card_type: "chase" }, { card_type: "standard" });
    expect(v.aenderungen.map((a) => a.feld)).not.toContain("card_type");
    expect(v.behalten.map((a) => a.feld)).toContain("card_type");
  });

  it("umgekehrt aber schon", () => {
    const v = vorschau({ card_type: "standard" }, { card_type: "chase" });
    expect(v.aenderungen.map((a) => a.feld)).toContain("card_type");
  });

  it("die interne Notiz ist überhaupt keine Zeile mehr (CAT-05I)", () => {
    /*
     * Sie WAR eine Zeile mit Kästchen, bis `0156`. Jetzt verarbeitet `0157`
     * sie bei jeder Zusammenführung über `public.merge_note()` — unabhängig
     * von jeder Auswahl. Eine Vorschauzeile dafür wäre ein Kästchen, das
     * nichts entscheidet, und die Regel steht in der Datenbank.
     *
     * Der Riegel liegt im TYPSYSTEM: `admin_note` ist kein `MergeFeld`, ein
     * Aufruf mit ihr würde nicht kompilieren. Deshalb prüft diese Zeile die
     * Liste selbst.
     */
    expect(MERGE_FELDER as readonly string[]).not.toContain("admin_note");
    expect(MERGE_FELDER).toHaveLength(8);
    const v = vorschau({ name: "Pirate Ship" }, { name: "Pirate Seas" });
    expect([...v.aenderungen, ...v.behalten].map((a) => a.feld as string))
      .not.toContain("admin_note");
  });

  it("Serie und Kategorie wandern gemeinsam", () => {
    const v = vorschau({ series_code: "SA", category_id: "10" },
                       { series_code: "G", category_id: "16" });
    const felder = v.aenderungen.map((a) => a.feld);
    expect(felder).toContain("series_code");
    expect(felder).toContain("category_id");
  });

  it("ein gültiges false oder 0 ist kein leerer Wert", () => {
    /* „leer" heisst NULL oder nur Leerzeichen — nicht „sieht unwichtig aus". */
    const v = vorschau({ character_id: "7" }, { character_id: "0" });
    expect(v.aenderungen.map((a) => a.feld)).toContain("character_id");
  });

  it("deckt genau die Felder ab, die die geltende Fassung anfasst", () => {
    const sql = readFileSync("supabase/migrations/0154_merge_draft_into_figure.sql", "utf8");
    for (const feld of MERGE_FELDER) {
      expect(sql, feld).toContain(feld);
    }
    /* Und die geschützten kommen in keinem `update` der Funktion vor. */
    const rumpf = sql.slice(sql.indexOf("create or replace function public.admin_merge_draft"));
    for (const geschuetzt of ["set sky_id", "set slug", "set catalog_status",
                              "set catalog_visible", "set market_price",
                              "set image_file", "set source"]) {
      expect(rumpf, geschuetzt).not.toContain(geschuetzt);
    }
  });

  it("und die generischen Vorgabewerte stehen auf beiden Seiten gleich", () => {
    const sql = readFileSync("supabase/migrations/0154_merge_draft_into_figure.sql", "utf8");
    expect(sql).toContain("c_generisch_card text := 'standard'");
    expect(sql).toContain("c_generisch_item text := 'figure'");
    expect(GENERISCH.card_type).toBe("standard");
    expect(GENERISCH.item_type).toBe("figure");
  });
});

describe("die Oberfläche kann nicht mehr als die Datenbank", () => {
  const panel = readFileSync("src/components/admin/draft-dialog.tsx", "utf8");
  const action = readFileSync("src/lib/admin/actions.ts", "utf8");

  it("sie sperrt, solange etwas auf den Entwurf zeigt", () => {
    expect(panel).toContain('setZustand("gesperrt")');
    expect(panel).toContain("const bedienbar = zustand === \"ok\"");
    /* Und sie unterscheidet drei Lagen: gesperrt, nicht freigeschaltet,
       Fehler. Eine leere Referenzliste bei einem Verbindungsfehler wäre die
       gefährliche Antwort. */
    expect(panel).toContain("mergeReferencesUnknown");
    expect(panel).toContain("mergeNotEnabled");
  });

  it("die Aktion prüft die Form, bevor sie die Datenbank fragt", () => {
    expect(action).toContain("if (draftId === targetId)");
    expect(action).toContain("SKY_ID.test(draftId)");
    /* Die Auswahl heisst `p_selection` und ist ein Objekt mit Werten — die
       alte, wertlose Feldliste `p_fields` ist es ausdruecklich nicht. */
    expect(action).not.toContain("p_fields");
    expect(action).toContain("p_selection: auswahl");
  });

  it("und die Abweisung wegen Referenzen wird ein Satz, kein Fehlercode", () => {
    expect(action).toContain('text.includes("zeigen noch Daten")');
    expect(action).toContain("de.admin.mergeBlocked");
  });

  it("die Bedienelemente halten 44 px", () => {
    /* Der Adminbereich benutzt `min-h-11`; auf dem iPhone ist das die
       Grenze, unter der ein Ziel schwer zu treffen ist. */
    const knoepfe = panel.match(/min-h-\d+/g) ?? [];
    expect(knoepfe.length).toBeGreaterThan(0);
    expect(knoepfe.every((k) => k === "min-h-11")).toBe(true);
    /* Und der Schliessen-Knopf ist eine 44-px-Flaeche. */
    expect(panel).toContain("size-11");
  });

  it("und der Dialog passt ans Telefon", () => {
    /* Von unten am Telefon, mittig am Schreibtisch, und nie höher als der
       Bildschirm — `dvh` statt `vh`, weil iOS die Leiste einblendet. */
    expect(panel).toContain("max-h-[90dvh]");
    expect(panel).toContain("items-end");
    expect(panel).toContain("sm:items-center");
    expect(panel).toContain("overflow-y-auto");
  });
});

/* ==========================================================================
 * CAT-05F — die Änderungstabelle
 *
 * WAS HIER GEPRÜFT WIRD. Nicht, dass ein Kästchen aussieht wie ein Kästchen,
 * sondern die zwei Zusagen dahinter: dass gekoppelte Felder eine Zeile sind
 * und nicht zwei, und dass die Nutzlast genau die angezeigten Werte trägt —
 * denn `0156` vergleicht sie mit seiner eigenen Rechnung und bricht bei
 * jeder Abweichung ab.
 * ======================================================================= */

describe("die Änderungstabelle", () => {
  const ziel: Werte = {
    name: "Pirate Ship", series_code: "SA", category_id: "10",
    card_type: "chase", item_type: "figure",
    image_override_path: "SKY-0100/1111111111111111.webp",
  };
  const entwurf: Werte = {
    name: "Pirate Seas", series_code: "G", category_id: "11",
    card_type: "standard", item_type: "figure",
    image_override_path: "SKY-0900/2222222222222222.webp",
  };
  const zeilen = tabellenzeilen(vorschau(ziel, entwurf, "SKY-0100"));

  it("führt Serie und Kategorie zu EINER Zeile zusammen", () => {
    /*
     * `(series_code, category_id)` ist ein zusammengesetzter Fremdschlüssel.
     * Zwei Kästchen hiesse, man könnte die Figur in eine Kategorie einer
     * anderen Serie legen — `0156` weist eine halbe Auswahl ab, und die
     * Oberfläche bietet sie deshalb gar nicht erst an.
     */
    const serie = zeilen.find((z) => z.id === "series");
    expect(serie).toBeDefined();
    expect(serie!.felder).toEqual(["series_code", "category_id"]);
    expect(zeilen.map((z) => z.id)).not.toContain("series_code");
    expect(zeilen.map((z) => z.id)).not.toContain("category_id");
  });

  it("zeigt nur die Felder, die sich wirklich ändern", () => {
    /* `item_type` ist auf beiden Seiten `figure` — keine Zeile. `card_type`
       bringt ein generisches `standard` gegen ein spezifisches `chase` —
       auch keine Zeile, sondern ein „bleibt". */
    expect(zeilen.map((z) => z.id)).toEqual([
      "name", "series", "image_override_path"]);
    expect(vorschau(ziel, entwurf, "SKY-0100").behalten.map((a) => a.feld))
      .toEqual(["card_type"]);
  });

  it("die Nutzlast trägt genau die angezeigten Werte, beide Schlüssel immer", () => {
    const alles = nutzlast(zeilen, new Set(zeilen.map((z) => z.id)));
    expect(Object.keys(alles).sort()).toEqual([
      "category_id", "image_override_path", "name", "series_code"]);
    expect(alles.name).toEqual({ old: "Pirate Ship", new: "Pirate Seas" });
    expect(alles.series_code).toEqual({ old: "SA", new: "G" });
    expect(alles.category_id).toEqual({ old: "10", new: "11" });
    /* DER PFAD IST DER ENDGÜLTIGE — unter der SKY-ID des ZIELS. */
    expect(alles.image_override_path!.new).toBe("SKY-0100/2222222222222222.webp");
    /* Und ein leerer Ausgangswert ist `null` und nicht `undefined`: `0156`
       vergleicht gegen jsonb-`null`, ein fehlender Schlüssel wäre ein
       Abbruch. */
    for (const paar of Object.values(alles)) {
      expect(Object.keys(paar).sort()).toEqual(["new", "old"]);
    }
  });

  it("eine Zeile abwählen nimmt beide Felder der Kopplung heraus", () => {
    const ohneSerie = nutzlast(zeilen, new Set(["name"]));
    expect(Object.keys(ohneSerie).sort()).toEqual(["name"]);
    expect(ohneSerie.series_code).toBeUndefined();
    expect(ohneSerie.category_id).toBeUndefined();
  });

  it("das Bild abwählen lässt die Nutzlast ohne Bildpfad", () => {
    const ohneBild = nutzlast(zeilen, new Set(["name", "series"]));
    expect(ohneBild.image_override_path).toBeUndefined();
    /* Serie bleibt vollständig. */
    expect(ohneBild.series_code).toBeDefined();
    expect(ohneBild.category_id).toBeDefined();
  });

  it("nichts angekreuzt ist eine leere Nutzlast — und die Aktion schickt sie nicht", () => {
    expect(nutzlast(zeilen, new Set())).toEqual({});
    const action = readFileSync("src/lib/admin/actions.ts", "utf8");
    expect(action).toContain("if (felder.length === 0) return { ok: false, message: de.admin.mergeNoFields }");
  });

  it("und die Vorschau sagt dasselbe wie die Datenbank, Feld für Feld", () => {
    const sql = readFileSync(GUELTIG, "utf8");
    /* Die Allowlist der Datenbank IST die Feldliste hier. */
    for (const feld of MERGE_FELDER) expect(sql, feld).toContain(`'${feld}'`);
    /* Die Platzhalterregel steht auf beiden Seiten gleich. */
    expect(sql).toContain("c_generisch_card text := 'standard'");
    expect(sql).toContain("c_generisch_item text := 'figure'");
    /* Die Kopplung steht in der Datenbank und nicht nur in der Oberfläche. */
    expect(sql).toContain("(p_selection ? 'series_code') <> (p_selection ? 'category_id')");
    expect(Object.values(ZUSAMMEN).flat().sort())
      .toEqual(["category_id", "series_code"]);
  });
});

describe("die geltende Fassung lässt sich von der Oberfläche nichts vorschreiben", () => {
  const sql = readFileSync(GUELTIG, "utf8");
  const plan = sql.slice(sql.indexOf("create or replace function public.admin_merge_plan"),
                         sql.indexOf("create or replace function public.admin_merge_draft"));
  /* NUR DER RUMPF der Vierparameterfassung — ohne die `grant execute`-Zeilen
     darunter, sonst fände ein Riegel gegen dynamisches SQL das Wort
     „execute" in einer Rechtevergabe. */
  const rumpf = (() => {
    const von = sql.indexOf(
      "create or replace function public.admin_merge_draft(\n  p_draft      text,"
      + "\n  p_target     text,\n  p_image_path text,");
    const bis = sql.indexOf("comment on function public.admin_merge_draft(text, text, text, jsonb)");
    return sql.slice(von, bis);
  })();

  it("die geschützten Spalten kommen in keinem update vor", () => {
    for (const geschuetzt of ["set sky_id", "set slug", "set catalog_status",
                              "set catalog_visible", "set market_price",
                              "set price_updated_at", "set image_file",
                              "set source", "set is_active"]) {
      expect(rumpf, geschuetzt).not.toContain(geschuetzt);
    }
  });

  it("es gibt kein dynamisches SQL — jede Spalte steht da", () => {
    /* Ein `execute format(...)` mit einem Feldnamen aus dem Aufruf wäre die
       bequeme Lösung und die gefährliche: die Allowlist müsste dann lückenlos
       sein, statt nur vollständig. Hier sind die Spalten getippt. */
    expect(rumpf).not.toContain("execute ");
    expect(rumpf).not.toContain("format(");
    expect(rumpf).not.toContain("quote_ident");
  });

  it("geschrieben wird aus der Zeile des Entwurfs, nicht aus dem Aufruf", () => {
    /*
     * JEDE Zuweisung einzeln. Sieben Felder nehmen ihren Wert aus `v_draft`,
     * also aus der Zeile des Entwurfs; nur zwei aus dem Plan, weil der Wert
     * dort erst entsteht — die angehängte Notiz und der umgezogene Bildpfad.
     * Aus `p_selection` kommt KEIN Wert: das ist der Unterschied zwischen
     * einer Behauptung und einer Anweisung.
     */
    for (const [spalte, quelle] of [
      ["name", "v_draft.name"],
      ["display_name_override", "v_draft.display_name_override"],
      ["card_type", "v_draft.card_type"],
      ["item_type", "v_draft.item_type"],
      ["character_id", "v_draft.character_id"],
    ] as const) {
      expect(rumpf, spalte).toContain(`set ${spalte} = ${quelle}`);
    }
    expect(rumpf).toContain(
      "set series_code = v_draft.series_code, category_id = v_draft.category_id");
    expect(rumpf).toContain("set image_override_path = v_eintrag ->> 'new'");
    /* Die Notiz kommt seit `0157` aus `merge_note()` und nicht aus dem Plan —
       sie ist kein auswählbares Feld mehr, sondern eine Regel. */
    expect(rumpf).toContain("v_neuenote := public.merge_note(v_zielnote, v_note)");
    expect(rumpf).toContain("values (p_target, v_neuenote, now())");

    /* Und nirgends ein Wert aus der Auswahl. */
    const zuweisungen = [...rumpf.matchAll(/(?:set|values \(p_target,) [^;]*?p_selection/g)];
    expect(zuweisungen).toEqual([]);
  });

  it("die Allowlist ist eine Konstante im Rumpf und kommt nicht von aussen", () => {
    expect(rumpf).toContain("c_allow text[] := array[");
    expect(rumpf).toContain("if not (v_feld = any (c_allow)) then");
  });

  it("der Plan ist stable und schreibt nichts", () => {
    expect(plan).toContain("stable");
    for (const schreibend of ["update ", "insert ", "delete "]) {
      expect(plan, schreibend).not.toContain(schreibend);
    }
  });

  it("die Prüfungen laufen vollständig, BEVOR etwas geschrieben wird", () => {
    const ersteSchreibung = rumpf.indexOf("update public.skylanders set name");
    for (const pruefung of ["kein uebernehmbares Feld",
                            "zusammengesetzter Fremdschluessel",
                            "nicht ausgewaehlt",
                            "seit der Vorschau geaendert",
                            "kein Feld zur Übernahme"]) {
      expect(rumpf.indexOf(pruefung), pruefung).toBeGreaterThan(0);
      expect(rumpf.indexOf(pruefung), pruefung).toBeLessThan(ersteSchreibung);
    }
  });

  it("und die Dreiparameterfassung bleibt, als Weiterleitung", () => {
    /*
     * SIE STEHT IN `0156` UND NICHT IN `0157`. `0157` fasst sie nicht an —
     * eine Weiterleitung, die sich nicht ändert, wird nicht neu geschrieben.
     * Dass sie weiterleitet, bleibt deshalb dort nachzulesen; dass sie noch
     * steht, prüft die Nachkontrolle von `0157` an der Datenbank.
     */
    const s0156 = readFileSync("supabase/migrations/0156_merge_selected_fields.sql", "utf8");
    expect(s0156).toContain("select public.admin_merge_draft(p_draft, p_target, p_image_path, null::jsonb)");
    expect(s0156).toContain("grant execute on function public.admin_merge_draft(text, text, text) to authenticated");
    expect(sql).toContain("grant execute on function public.admin_merge_draft(text, text, text, jsonb) to authenticated");
    expect(sql).toContain("revoke all on function public.admin_merge_draft(text, text, text, jsonb) from public, anon");
  });
});

describe("die Bildübernahme wird nur angefasst, wenn sie ausgewählt ist", () => {
  const action = readFileSync("src/lib/admin/actions.ts", "utf8");

  it("der Speichervorgang steht INNERHALB der Bedingung", () => {
    const bedingung = action.indexOf('if ("image_override_path" in auswahl) {');
    const kopie = action.indexOf(".copy(draftImagePath, zielPfad)");
    const aufruf = action.indexOf('"admin_merge_draft",');
    expect(bedingung).toBeGreaterThan(0);
    expect(kopie).toBeGreaterThan(bedingung);
    /* Und die Kopie liegt VOR dem Datenbankaufruf — die Reihenfolge ist die
       Sicherheit, weil es keine gemeinsame Transaktion gibt. */
    expect(kopie).toBeLessThan(aufruf);
  });

  it("ein Fehler beim Kopieren lässt die Datenbank unberührt", () => {
    /* Der `return` liegt vor dem Aufruf — es gibt keinen Weg, mit
       fehlgeschlagener Kopie weiterzulaufen. */
    const fehler = action.indexOf("de.admin.mergeImageFailed");
    const aufruf = action.indexOf('"admin_merge_draft",');
    expect(fehler).toBeGreaterThan(0);
    expect(fehler).toBeLessThan(aufruf);
    expect(action).toContain("if (error && !/duplicate|exists|409/i.test(error.message ?? \"\"))");
  });

  it("und ein 409 gilt als Erfolg, weil die Kopie inhaltsadressiert ist", () => {
    expect(action).toContain("409");
    /* Kein `remove`, kein `delete` — ein verwaistes Objekt ist billiger als
       ein verlorenes Bild. */
    const merge = action.slice(action.indexOf("export async function mergeDraftIntoFigure"),
                               action.indexOf("export async function discardDraft"));
    expect(merge).not.toContain(".remove(");
  });

  it("der Zielpfad muss der sein, den die Vorschau versprochen hat", () => {
    expect(action).toContain("if (auswahl.image_override_path?.new !== zielPfad)");
    expect(action).toContain("de.admin.mergeStale");
  });
});

describe("die Tabelle am Telefon", () => {
  const panel = readFileSync("src/components/admin/draft-dialog.tsx", "utf8");

  it("scrollt horizontal, und nur die Tabelle", () => {
    expect(panel).toContain("overflow-x-auto");
    expect(panel).toContain("min-w-[28rem]");
    /* Der Dialog selbst bleibt in der Breite — er darf nicht über den
       Bildschirm hinausragen, nur die Tabelle darin scrollt. */
    expect(panel).toContain("max-w-xl");
    expect(panel).not.toContain("min-w-screen");
  });

  it("die Kästchen sind 44-px-Flächen", () => {
    /* Ein 16-px-Kästchen in einer 44-px-Beschriftung: gut sichtbar und gut
       treffbar, ohne die Zeilenhöhe aufzublähen. */
    expect(panel).toContain('className="flex size-11 cursor-pointer items-center justify-start"');
    expect(panel).toContain("size-4");
  });

  it("der Knopf nennt die Zahl und sperrt bei null", () => {
    expect(panel).toContain("de.admin.mergeSubmitCount(anzahl)");
    expect(panel).toContain("|| anzahl === 0}");
  });

  it("es gibt eine Kopfzeile für alle, und sie kennt beide Richtungen", () => {
    expect(panel).toContain("onChange={alleUmschalten}");
    expect(panel).toContain("de.admin.mergeSelectAll");
    expect(panel).toContain("de.admin.mergeSelectNone");
  });

  it("die Bildzeile zeigt zwei Vorschaubilder und einen Platzhalter", () => {
    expect(panel).toContain("de.admin.mergeImageOld");
    expect(panel).toContain("de.admin.mergeImageNew");
    expect(panel).toContain("de.admin.mergeImageNone");
    /* „Bisher" ist, was die Karte HEUTE zeigt — auch ein Altimportbild. */
    expect(panel).toContain("imageFile: ziel.imageFile");
  });

  it("und sie vergleicht die Spalte `name`, nicht den Anzeigenamen", () => {
    /* Sonst nennte die Vorschau bei jeder Figur mit Anzeigenamen einen
       anderen Ausgangswert als `0156` — und jeder Merge bräche als
       „veraltet" ab. */
    expect(panel).toContain("name: z.nameRaw");
    expect(panel).not.toContain("name: z.name,");
  });
});

/* ==========================================================================
 * CAT-05G — die Spalten stehen untereinander
 *
 * WARUM DIESE ZEILEN STEHEN. Auf dem Bildschirm des Betreibers standen Kopf
 * und Inhalt nicht untereinander, Namen waren rechtsbündig und die beiden
 * Vorschaubilder saßen verschieden. Die Ursache war EINE vererbte
 * Eigenschaft: der Dialog wird innerhalb der Katalogtabelle gerendert, in
 * der Zelle der Aktionsspalte — und die trägt `text-right`, damit die drei
 * Icons rechts stehen. `position: fixed` nimmt das Element aus dem Fluss,
 * aber `text-align` kaskadiert durch den DOM-Baum weiter. Die Kopfzeile
 * setzte ihr `text-left` selbst, die Zellen im Rumpf erbten rechts.
 *
 * Diese Tests halten die Ursache fest, nicht nur das Symptom.
 * ======================================================================= */

describe("die Merge-Tabelle richtet sich an einer Stelle aus", () => {
  const panel = readFileSync("src/components/admin/draft-dialog.tsx", "utf8");
  const seite = readFileSync("src/app/(admin)/admin/catalog/page.tsx", "utf8");

  it("die Zelle, in der der Dialog hängt, ist wirklich rechtsbündig", () => {
    /*
     * Die Zusage dieses Tests ist unbequem: er beschreibt den Zustand, der
     * den Fehler verursacht hat, und er darf nicht grün werden, indem
     * jemand die Aktionsspalte umbaut — dann wäre der `text-left`-Riegel im
     * Dialog nur noch zufällig richtig. Ändert sich die Spalte, soll diese
     * Zeile auffallen und gelesen werden.
     */
    expect(seite).toContain('<td className="py-2 pl-1 text-right">');
    expect(seite).toContain("<RowActions");
  });

  it("deshalb setzt der Dialog die Ausrichtung selbst, EINMAL und oben", () => {
    const wurzel = panel.slice(panel.indexOf("max-h-[90dvh]"),
                               panel.indexOf("<div className=\"flex items-start"));
    expect(wurzel).toContain("text-left");
  });

  it("und keine Zelle richtet sich mehr einzeln aus", () => {
    const tabelle = panel.slice(panel.indexOf("<table"), panel.indexOf("</table>"));
    for (const verboten of ["text-right", "justify-between", "text-center",
                            "items-end", "justify-end", "text-left"]) {
      expect(tabelle, verboten).not.toContain(verboten);
    }
  });

  it("die Spaltenbreiten stehen in EINEM colgroup und gelten für Kopf und Rumpf", () => {
    expect(panel).toContain("table-fixed");
    const cols = panel.slice(panel.indexOf("<colgroup>"), panel.indexOf("</colgroup>"));
    const breiten = [...cols.matchAll(/className="(w-[^"]+)"/g)].map((m) => m[1]);
    expect(breiten).toEqual(["w-11", "w-[5.5rem]", "w-[35%]", "w-[35%]"]);
    /* Vier Spalten im colgroup, vier im Kopf, vier je Zeile. */
    const kopf = panel.slice(panel.indexOf("<thead>"), panel.indexOf("</thead>"));
    expect([...kopf.matchAll(/<th /g)]).toHaveLength(4);
  });

  it("`table-fixed` ist der Grund, warum die Breiten verbindlich sind", () => {
    /* Ohne `table-fixed` ist eine Breitenangabe nur ein Vorschlag: der
       Browser rechnet aus dem Inhalt, und zwei Zeilen mit unterschiedlich
       langen Werten verschieben die Spalten gegeneinander. Genau das war zu
       sehen. */
    const tabelle = panel.slice(panel.indexOf("<table"), panel.indexOf("<colgroup>"));
    expect(tabelle).toContain("table-fixed");
  });

  it("jede Zelle trägt dasselbe Padding und dieselbe vertikale Ausrichtung", () => {
    const rumpf = panel.slice(panel.indexOf("<tbody>"), panel.indexOf("</tbody>"));
    const zellen = [...rumpf.matchAll(/<td className=\{?[`"]([^`"]+)/g)].map((m) => m[1]);
    expect(zellen.length).toBeGreaterThanOrEqual(6);
    for (const z of zellen) {
      expect(z, z).toContain("px-2");
      expect(z, z).toContain("py-1.5");
      expect(z, z).toContain("align-middle");
    }
    /* Und der Kopf benutzt dasselbe waagerechte Padding wie der Rumpf —
       sonst sitzt die Überschrift neben ihrer Spalte. */
    const kopf = panel.slice(panel.indexOf("<thead>"), panel.indexOf("</thead>"));
    for (const th of [...kopf.matchAll(/<th scope="col" className="([^"]+)"/g)]) {
      expect(th[1], th[1]).toContain("px-2");
    }
  });

  it("beide Vorschaubilder haben identische Größe und Zellform", () => {
    /* 48 x 48, und zwar auch der Platzhalter — sonst springt die Zeile, je
       nachdem ob die bestehende Figur schon ein Bild hat. */
    const bildchen = panel.slice(panel.indexOf("function Bildchen"),
                                 panel.indexOf("export function MergeDialog"));
    expect([...bildchen.matchAll(/size-12/g)]).toHaveLength(2);
    expect(bildchen).toContain("width={48}");
    expect(bildchen).toContain("height={48}");
    expect(bildchen).not.toContain("size-10");

    /* Und beide Bildzellen sind Zeichen für Zeichen dieselbe Zellform. */
    const rumpf = panel.slice(panel.indexOf("{bild ? ("), panel.indexOf("</>\n                          ) : ("));
    const bildzellen = [...rumpf.matchAll(/<td className="([^"]+)">\s*\n\s*<Bildchen/g)]
      .map((m) => m[1]);
    expect(bildzellen).toHaveLength(2);
    expect(bildzellen[0]).toBe(bildzellen[1]);
  });

  it("Werte dürfen umbrechen statt die Spalte zu sprengen", () => {
    /* Bei `table-fixed` kann eine Spalte nicht wachsen; ein langer Wert muss
       also brechen, sonst überlappt er. `break-words` und nicht `break-all`:
       ein Name soll an der Wortgrenze brechen. */
    const rumpf = panel.slice(panel.indexOf("<tbody>"), panel.indexOf("</tbody>"));
    expect([...rumpf.matchAll(/break-words/g)].length).toBeGreaterThanOrEqual(2);
  });
});
