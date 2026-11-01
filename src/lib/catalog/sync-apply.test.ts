import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/* ==========================================================================
 * DER APPLY-PFAD — die Zusagen am QUELLTEXT festgenagelt
 *
 * Dieses Werkzeug DARF schreiben. Gerade deshalb gehören seine Riegel
 * geprüft, und zwar so, dass die Prüfung nichts ausführt: dieselbe Vorsicht,
 * mit der `import-payload.test.ts` die Importspalten festhält.
 * ========================================================================== */

const Q = readFileSync("tools/catalog-sync-apply.mts", "utf8");
const CODE = Q.replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").filter((z) => !z.trimStart().startsWith("//")).join("\n");

describe("catalog-sync-apply.mts — die Tore", () => {
  it("schreibt ohne --apply nichts: der Schreibzweig liegt hinter dem Vorschau-continue", () => {
    const vorschau = CODE.indexOf('if (!APPLY) {');
    const ersterSchreibvorgang = Math.min(
      ...[".rpc(", "setzeFelder("].map((m) => {
        const i = CODE.indexOf(m, vorschau);
        return i === -1 ? Number.MAX_SAFE_INTEGER : i;
      }));
    expect(vorschau).toBeGreaterThan(-1);
    expect(ersterSchreibvorgang).toBeGreaterThan(vorschau);
    // und der Vorschauzweig endet mit `continue`
    expect(CODE.slice(vorschau, vorschau + 260)).toContain("continue;");
  });

  it("verlangt --confirm-production zusätzlich zu --apply", () => {
    expect(CODE).toContain('ZIEL === "production" && !flag("confirm-production")');
  });

  it("prüft die Projektkennung, bevor eine Verbindung benutzt wird", () => {
    expect(CODE).toContain("TOR 0");
    expect(CODE).toContain("STAGING_REF");
    expect(CODE).toContain("PRODUCTION_REF");
  });

  it("misst TOR 1 gegen den Plan, bevor geschrieben wird", () => {
    const tor1 = CODE.indexOf("TOR 1 —");
    const schreib = CODE.indexOf("async function setzeFelder");
    expect(tor1).toBeGreaterThan(-1);
    expect(tor1).toBeLessThan(schreib);
  });

  it("legt die Bedingung IN die schreibende Anweisung (Compare-and-Set)", () => {
    /*
     * `for (const s of schritte)` steht ZWEIMAL — einmal in der
     * Feld-Positivliste weiter oben, einmal als Ausfuehrungsschleife. Also
     * ab der Funktion vorwaerts suchen, nicht vom Dateianfang.
     */
    const ab = CODE.indexOf("async function setzeFelder");
    expect(ab).toBeGreaterThan(-1);
    const fn = CODE.slice(ab, CODE.indexOf("for (const s of schritte)", ab));
    expect(fn).toContain('.update(werte)');
    expect(fn).toContain('.eq("sky_id", sky_id)');
    expect(fn).toContain('.eq("updated_at", updatedAt as string)');
    /*
     * `.select("sky_id,updated_at")` seit dem 2026-10-31: das `returning`
     * gibt die NEUE Vergleichsmarke mit, damit ein zweiter Schritt an
     * derselben Figur nicht gegen die alte vergleicht. Vorher stand hier
     * `.select("sky_id")` — die Zeilenzahl genuegte, die Marke fehlte.
     */
    expect(fn).toContain('.select("sky_id,updated_at")');
    expect(fn).toContain("!== 1");           // 0 Zeilen = Verweigerung
  });

  it("nennt market_price nirgends", () => {
    expect(CODE).not.toContain("market_price");
  });

  it("schreibt `name`, `slug`, `series_code` nur über die allgemeine Feldliste — "
     + "die Richtung entscheidet der Plan, nicht dieses Werkzeug", () => {
    // Es gibt keinen Sonderzweig, der `name` nach Production schriebe.
    expect(CODE).not.toMatch(/name.*production/i);
  });

  it("führt Klasse B ausschließlich über die vier atomaren RPCs", () => {
    for (const [feld, fn] of [["types", "admin_set_figure_types"],
                              ["visible_type", "admin_set_visible_type"],
                              ["familie", "admin_set_character"],
                              ["base_sky_id", "admin_set_variant_base"]]) {
      expect(CODE).toContain(`${feld}:`);
      expect(CODE).toContain(fn);
    }
    // und niemals über ein direktes update
    const schleife = CODE.slice(CODE.indexOf("for (const s of schritte)"));
    expect(schleife).toContain("s.feld in RPC_B");
  });

  it("übergibt p_create_family NIE — eine Familie entsteht nicht als Nebenwirkung", () => {
    /*
     * `admin_set_variant_base(p_sky_id, p_base_sky_id, p_create_family default false)`
     * (0159). Das dritte Argument legt eine FAMILIE an, wenn weder Variante
     * noch Basisfigur eine hat. Der Sync setzt `familie` in einem eigenen
     * Schritt und mit einer eigenen Journalzeile — eine nebenbei entstehende
     * Familie waere eine Zuordnung, die in keinem Plan steht.
     *
     * Der Vorgabewert ist `false`, also genuegt es, das Argument nicht zu
     * nennen. Genau das wird hier festgehalten.
     */
    expect(CODE).not.toContain("p_create_family");
  });

  it("nennt für jede Klasse-B-RPC genau den Parameternamen der Migration", () => {
    /*
     * PostgREST loest eine Funktion ueber die ARGUMENTNAMEN auf. Ein falscher
     * Name ergibt kein Rechteproblem, sondern „Could not find the function" —
     * und sieht damit aus wie eine fehlende Migration. Genau das ist mir im
     * Preflight am 2026-10-30 passiert, mit `p_force` statt `p_create_family`.
     */
    for (const [fn, arg] of [["admin_set_figure_types", "p_types"],
                             ["admin_set_visible_type", "p_type"],
                             ["admin_set_character", "p_character_id"],
                             ["admin_set_variant_base", "p_base_sky_id"]]) {
      const i = CODE.indexOf(fn);
      expect(i, fn).toBeGreaterThan(-1);
      expect(CODE.slice(i - 80, i + 80), fn).toContain(arg);
    }
    expect(CODE).toContain('{ p_sky_id: s.sky_id, [r.arg]: wert }');
  });

  it("legt Figuren nur über system_sync_create_figure an", () => {
    expect(CODE).toContain('R.rpc("system_sync_create_figure"');
    expect(CODE).not.toContain('from("skylanders").insert');
  });

  it("weist einen Kategoriewechsel ausdrücklich ab", () => {
    expect(CODE).toContain('s.feld === "kategorie"');
    expect(CODE).toContain("eigene, einzeln freigegebene Handlung");
  });

  it("überspringt visible_type_decided, wenn die RPC es mitsetzt", () => {
    expect(CODE).toContain("setztBanner");
    /* Nur wenn das Ziel `true` ist — genau das, was die RPC setzt (CAT-11). */
    expect(CODE).toContain('s.feld === "visible_type_decided" && setztBanner.has(s.sky_id) && s.nach === "true"');
  });

  it("schreibt catalog_visible und catalog_status in EINER Anweisung", () => {
    expect(CODE).toContain("catalog_visible: s.nach ===");
    expect(CODE).toContain("catalog_status: status.nach");
  });

  it("holt das Passwort nie aus argv und nie aus einer Repodatei", () => {
    expect(CODE).toContain("find-generic-password");
    expect(CODE).not.toMatch(/--password/);
    expect(CODE).not.toMatch(/process\.argv[\s\S]{0,80}passwor/i);
  });

  it("meldet die Adminsitzung am Ende ab", () => {
    expect(CODE).toContain("auth.signOut()");
  });

  it("prüft beide Arten geschützter Tabellen im Postflight", () => {
    expect(CODE).toContain("ART_A");
    expect(CODE).toContain("ART_B");
    // Art A: byte-identisch. Art B: jede VORHER vorhandene Zeile unverändert.
    expect(CODE).toContain("der Abdruck hat sich bewegt");
    expect(CODE).toContain("die vorher vorhandene Zeile");
  });

  it("rechnet die Journalerwartung vorher aus und vergleicht sie nachher", () => {
    expect(CODE).toContain("erwarteteJournalzeilen");
    expect(CODE).toContain("journalDelta !== erwarteteJournalzeilen");
  });

  it("führt die drei Reihenfolgeabhängigkeiten", () => {
    /*
     * `RANG` steht seit dem 2026-10-31 nur noch EINMAL, in
     * `src/lib/catalog/sync-character-gate.ts`, und wird dort behaupt- und
     * prüfbar gehalten (`sync-character-gate.test.ts`). Hier wird nur noch
     * festgenagelt, dass dieses Werkzeug genau diese Tabelle benutzt und
     * keine zweite daneben führt.
     */
    expect(CODE).toContain('import { charakterRiegel, RANG } from '
      + '"../src/lib/catalog/sync-character-gate.ts"');
    expect(CODE).not.toMatch(/const RANG: Record<string, number> = \{/);
    expect(CODE).toContain("(RANG[a.art] ?? 9) - (RANG[b.art] ?? 9)");
    expect(CODE).toContain("FELDRANG");
    expect(CODE).toContain("types: 0");       // types vor visible_type
    expect(CODE).toContain("visible_type: 1");
  });
});

describe("der Plan trägt alles, was der Apply-Pfad braucht", () => {
  const plan = JSON.parse(readFileSync("resources/analysis/sync-dryrun.json", "utf8")) as
    { plan: { art: string; sky_id: string; quelle?: Record<string, unknown> }[] };

  it("jede Figurenanlage führt ihre Quellwerte mit", () => {
    /*
     * KEINE UNTERGRENZE. Diese Zusage galt bis zum 2026-10-31 nur, solange
     * der Plan überhaupt Figurenanlagen führte — und als Etappe D die 33
     * angelegt hatte, schlug der Test fehl, obwohl nichts kaputt war. Die
     * Zusage ist eine Wenn-Dann-Zusage: WENN der Plan eine Anlage führt,
     * trägt sie ihre Quellwerte. Ein Plan ohne Anlagen erfüllt sie auch.
     */
    const anlagen = plan.plan.filter((s) => s.art === "figur-anlegen");
    for (const a of anlagen) {
      expect(a.quelle, a.sky_id).toBeTruthy();
      for (const f of ["name", "slug", "series_code", "category_id", "card_type",
                       "item_type", "catalog_status", "source"]) {
        expect(a.quelle, `${a.sky_id}.${f}`).toHaveProperty(f);
      }
    }
  });

  it("keine Quellwerte nennen einen Preis", () => {
    for (const a of plan.plan.filter((s) => s.quelle)) {
      expect(Object.keys(a.quelle!)).not.toContain("market_price");
      expect(Object.keys(a.quelle!)).not.toContain("price_updated_at");
    }
  });
});

/*
 * ===========================================================================
 * DER FEHLER VOM 2026-10-31 — `updated_at` FUER EINE IM LAUF NEUE FIGUR
 *
 * Der Abschlusslauf ist in Etappe C abgebrochen:
 *
 *     SKY-0821: invalid input syntax for type timestamp with time zone:
 *     "undefined"
 *
 * `jetzt._zeilen` ist die Momentaufnahme des ZIELS vor dem Lauf. Eine Figur,
 * die IN diesem Lauf entsteht, steht dort nicht — `zeile?.updated_at` war
 * `undefined`, und PostgREST hat die Zeichenkette `"undefined"`
 * weitergegeben.
 *
 * BETROFFEN WAR NICHT NUR SKY-0821. 30 Planschritte haengen an einer im Lauf
 * angelegten Figur: 1 nach Staging und 29 nach Production. Etappe D haette
 * denselben Fehler 29-mal gehabt.
 * ===========================================================================
 */
describe("eine im Lauf angelegte Figur bekommt eine echte Vergleichsmarke", () => {
  const QUELLE = readFileSync("tools/catalog-sync-apply.mts", "utf8");

  it("nach dem Anlegen wird die neue Zeile zurueckgelesen", () => {
    expect(QUELLE).toContain('await R.from("skylanders")');
    expect(QUELLE).toContain(".select(SKY_SPALTEN).eq(\"sky_id\", s.sky_id).single()");
    expect(QUELLE).toContain("jetzt._zeilen.set(s.sky_id, frisch as unknown as Zeile)");
  });

  it("und ein fehlgeschlagenes Zuruecklesen bricht ab, statt weiterzuschreiben", () => {
    expect(QUELLE).toContain("angelegt, aber nicht zurueckgelesen");
    expect(QUELLE).toContain("kann kein Folgeschritt sicher schreiben");
  });

  /*
   * DIE ZWEITE HAELFTE: eine fehlende Marke darf nie mehr an die Datenbank
   * gehen. Der Fehler war lesbar, weil die Spalte ein Zeitstempel ist — bei
   * einer Textspalte waere `"undefined"` als Wert DURCHGEGANGEN.
   */
  it("setzeFelder verweigert eine fehlende Vergleichsmarke", () => {
    expect(QUELLE).toContain("if (updatedAt === undefined || updatedAt === null)");
    expect(QUELLE).toContain("keine Vergleichsmarke (updated_at)");
    expect(QUELLE).toContain("Es wird nichts geschrieben.");
  });

  it("die Vergleichsbedingung selbst bleibt — kein Weglassen", () => {
    expect(QUELLE).toContain('.eq("updated_at", updatedAt as string)');
    expect(QUELLE).toContain("TOR 2");
  });

  /*
   * UND DIE WEGANGABE IM PLAN STIMMT JETZT. Sie versprach
   * `system_set_image_override` — und der Apply-Pfad ruft die Funktion
   * nirgends auf (gemessen: 0 Treffer).
   */
  it("der Planer verspricht keinen Weg, den der Apply-Pfad nicht nimmt", () => {
    const planer = readFileSync("tools/catalog-sync.mts", "utf8");
    /*
     * GEPRUEFT WIRD DIE TABELLE, NICHT DIE AUFRUFSTELLE. Eine erste Fassung
     * dieses Tests suchte das Literal neben `feld: "image_override_path"` —
     * und der Planer holt den Wert jetzt aus `WEG`, an EINER Stelle fuer alle
     * Bildschritte. Genau das war die Korrektur; der Test hing noch an der
     * Form davor.
     */
    expect(planer).toContain(
      '  image_override_path: "R update (Trigger journalisiert)",');
    expect(planer).not.toContain(
      '  image_override_path: "R system_set_image_override (0035)",');
    // Und die Aufrufstellen nehmen den Wert aus der Tabelle — seit CAT-11
    // fuer neue Figuren generisch ueber `WEG[f.feld]` (folgeschritte()).
    expect(planer).toContain("weg: WEG[f.feld]");
    // Der Apply-Pfad ruft die RPC nirgends auf — das war der Anlass.
    expect(QUELLE).not.toContain("system_set_image_override");
  });
});

/*
 * ===========================================================================
 * DIE MOMENTAUFNAHME WIRD NACH JEDEM EIGENEN SCHREIBVORGANG NACHGEZOGEN
 *
 * Dritte Erscheinungsform desselben Fehlers. `jetzt._zeilen` ist EINE
 * Aufnahme, einmal vor dem Lauf genommen — aber jeder Schreibvorgang
 * verschiebt `updated_at` (Trigger `skylanders_set_updated_at`, 0001). Ein
 * ZWEITER Schritt an derselben Figur verglich gegen die alte Marke und
 * scheiterte an TOR 2, obwohl sich nichts Fremdes bewegt hatte.
 *
 * Am 2026-10-31 brach der Abschlusslauf daran ab:
 *
 *     TOR 2 — Precondition verletzt: SKY-0584 hat sich seit dem Plan bewegt
 *     (image_override_path)
 *
 * Gemessener Umfang: Staging 1 Figur, PRODUCTION 288 Figuren mit mehr als
 * einem Schreibvorgang — 283 davon mit einer RPC UND einem `update`.
 * ===========================================================================
 */
describe("nach jedem Schreibvorgang wird die Vergleichsmarke nachgezogen", () => {
  const Q = readFileSync("tools/catalog-sync-apply.mts", "utf8");

  it("setzeFelder nimmt die neue Marke aus dem returning", () => {
    expect(Q).toContain('await q.select("sky_id,updated_at")');
    expect(Q).toContain("vorhanden.updated_at = neueMarke");
  });

  it("und nach den Klasse-B-RPCs wird sie nachgelesen — mit dem Feldwert (TOR 2b, CAT-11)", () => {
    /* `markeNachziehen` las nur die Marke; seit CAT-11 liest `liesKlasseB`
       Marke UND Wert, und die neue Marke wird nur uebernommen, wenn der Wert
       der geplante ist. */
    expect(Q).toContain("async function liesKlasseB(");
    expect(Q).toContain("const nachher = await liesKlasseB(s.sky_id, feldB)");
    expect(Q).toContain("if (eintrag) eintrag.updated_at = nachher.marke");
  });

  it("ein fehlgeschlagenes Nachlesen bricht ab, statt stillschweigend weiterzumachen", () => {
    expect(Q).toContain("liess sich nicht lesen");
    expect(Q).toContain("Es wird nichts geschrieben.");
  });

  /*
   * UND DIE BEDINGUNG BLEIBT. Die Korrektur war NICHT, TOR 2 zu lockern —
   * das waere der bequeme und falsche Weg gewesen.
   */
  it("TOR 2 ist unveraendert scharf", () => {
    expect(Q).toContain('.eq("updated_at", updatedAt as string)');
    expect(Q).toContain("TOR 2 — Precondition verletzt");
    expect(Q).toContain("Nichts geschrieben. Neu planen.");
    // Kein Weg, die Bedingung zu ueberspringen.
    expect(Q).not.toMatch(/--(force|skip-tor|no-cas)/);
  });
});
