import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";

/**
 * CAT-03 — die Werkzeuge, die Katalogentwuerfe vorbereiten.
 *
 * WAS HIER GEPRUEFT WIRD, UND WARUM NICHT MEHR
 *
 * Die Auswertung selbst liegt in Python und laeuft gegen eine fremde .xlsx
 * und eine Momentaufnahme der Datenbank. Beides kann dieser Testlauf nicht
 * herstellen. Was er pruefen kann — und was den Schaden verhindert, um den
 * es geht — sind die ZUSAGEN der Werkzeuge, und die stehen in ihrem Quelltext:
 *
 *   1. kein Schreibpfad in die Datenbank, in keinem der beiden Werkzeuge
 *   2. der Probelauf ist der Standard, nicht eine Option
 *   3. jeder Entwurf traegt `draft`, und `catalog_visible` ist falsch
 *   4. keine SKY-ID im Voraus, kein Slug im Voraus
 *   5. kein Bild wird uebernommen
 *   6. die Dublettenpruefung ist fachlich (Name UND Serie), nicht ueber die ID
 *
 * Die ERGEBNISDATEIEN werden geprueft, WENN sie da sind — sie entstehen erst
 * bei einem Lauf gegen Staging, und ein Testlauf ohne sie ist kein Fehler.
 */

const lies = (p: string) => readFileSync(p, "utf8");
const AUFBEREITUNG = lies("tools/lib/cat03-drafts.py");
const HOLER = lies("tools/cat03-drafts.mts");
const IMPORT = lies("tools/cat03-import.mts");

/**
 * Nur ausfuehrbarer Code — Prosa, Kommentare und erzeugter TEXT sind keine
 * Anweisungen.
 *
 * DIE DREI AUSNAHMEN, und jede ist an einem Fehlalarm belegt, den dieser
 * Testlauf selbst erzeugt hat:
 *
 *   1. Python-Docstrings und `#`-Zeilen — sie SPRECHEN ueber `insert`.
 *   2. Block- und Zeilenkommentare in TypeScript, aus demselben Grund.
 *   3. TEMPLATE-LITERALE. `cat03-import.mts` baut darin die SQL-Huelle; die
 *      enthaelt `insert into`, geht aber in eine DATEI und nicht an die
 *      Datenbank. Wer sie ausfuehrt, prueft der Test darunter.
 */
const code = (s: string) =>
  s.replace(/"""[\s\S]*?"""/g, "").replace(/^\s*#.*$/gm, "")
   .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*(\/\/|\*).*$/gm, "")
   .replace(/`(?:[^`\\]|\\.)*`/g, "``");

describe("kein Werkzeug schreibt in die Datenbank", () => {
  it.each([
    ["tools/lib/cat03-drafts.py", AUFBEREITUNG],
    ["tools/cat03-drafts.mts", HOLER],
    ["tools/cat03-import.mts", IMPORT],
  ])("%s enthaelt keine schreibende Anweisung", (_name, text) => {
    /*
     * DIE GRENZE IST DER AUFTRAG. Der Betreiber hat Schreibzugriffe
     * ausgeschlossen, und das darf nicht an einer Zusage im Kopf haengen.
     * Gesucht wird im CODE, nicht in der Prosa — die Dateien SPRECHEN ueber
     * `insert` und `update`, und das soll sie nicht verdaechtig machen.
     */
    const c = code(text).toLowerCase();
    for (const verboten of ["insert into", "update public.", "delete from",
                            "alter table", "/rpc/", "method: \"post\"",
                            "method: \"patch\"", "method: \"put\"",
                            "method: \"delete\""]) {
      expect(c, verboten).not.toContain(verboten);
    }
  });

  it("und die Importhuelle wird vom Bediener gefahren, nicht vom Werkzeug", () => {
    /* Die SQL-Zeilen der Huelle stehen in einem Template-Literal — das ist
       Text, der in eine DATEI geht, und kein Aufruf. Der Test oben darf sie
       deshalb nicht sehen; dieser hier prueft, dass die Datei sagt, wer sie
       ausfuehrt. */
    expect(IMPORT).toContain("AUSGEFUEHRT WIRD SIE VOM BEDIENER");
    expect(IMPORT).toContain("keinen Schreibpfad in die Datenbank");
  });
});

describe("der Probelauf ist der Standard", () => {
  it("ohne --sql wird nichts geschrieben, auch keine Datei", () => {
    expect(IMPORT).toContain('const willSql = process.argv.includes("--sql")');
    /* Die Reihenfolge entscheidet: der Ausstieg kommt VOR dem Schreiben. */
    expect(IMPORT.indexOf("if (!willSql)"))
      .toBeLessThan(IMPORT.indexOf("writeFileSync(HUELLE"));
    expect(IMPORT).toContain("PROBELAUF — nichts geschrieben");
  });

  it("ein Lauf auf einer Akte mit Validierungsfehlern faengt nicht an", () => {
    expect(IMPORT).toContain("akte.validierungsfehler.length > 0");
    /* Gegen den AUFRUF, nicht gegen die Einfuhrzeile: `requireStaging`
       steht oben auch im `import`, und ein indexOf darauf verglich zwei
       Stellen, die nichts miteinander zu tun haben. */
    expect(IMPORT.indexOf("validierungsfehler.length > 0"))
      .toBeLessThan(IMPORT.indexOf('requireStaging("cat03:import:staging")'));
  });

  it("und beide Werkzeuge nennen ihre Umgebung im Namen", () => {
    /* CLAUDE.md: es gibt keinen umgebungsneutralen Alias. */
    const paket = JSON.parse(lies("package.json"));
    expect(paket.scripts["cat03:drafts:staging"]).toContain("--env-file=.env.staging");
    expect(paket.scripts["cat03:import:staging"]).toContain("--env-file=.env.staging");
    expect(paket.scripts).not.toHaveProperty("cat03:drafts");
    expect(paket.scripts).not.toHaveProperty("cat03:import");
  });

  it("der Waechter laeuft, bevor eine Verbindung entsteht", () => {
    for (const [name, text] of [["Holer", HOLER], ["Import", IMPORT]] as const) {
      /* Wieder der Aufruf und nicht die Einfuhrzeile. */
      const aufruf = text.indexOf("requireStaging(\"cat03:");
      expect(aufruf, name).toBeGreaterThan(-1);
      expect(aufruf, name).toBeLessThan(text.indexOf("await fetch("));
    }
  });
});

describe("jeder Entwurf ist ein Entwurf", () => {
  it("der Status steht fest auf draft", () => {
    expect(AUFBEREITUNG).toContain('"catalog_status": "draft"');
    expect(AUFBEREITUNG).toContain('if d["catalog_status"] != "draft"');
  });

  it("und die Huelle schreibt catalog_visible = false dazu", () => {
    expect(IMPORT).toContain("false, 'draft', 'admin', true)");
    /* Und sie prueft es danach selbst nach. */
    expect(IMPORT).toContain("catalog_status = 'draft' and catalog_visible");
    expect(IMPORT).toContain("Entwurf/Entwuerfe sind sichtbar — das darf");
  });

  it("die Herkunft steht in der internen Notiz, nicht auf skylanders", () => {
    /*
     * `source` KENNT NUR ZWEI WERTE (CHECK aus 0033), und 'import' waere
     * falsch: es sagte dem Katalogimport, die Zeile gehoere ihm. Die
     * Herkunft `cat01` gehoert deshalb nach `catalog_editorial.admin_note` —
     * `skylanders` ist weltlesbar (ADR-0039).
     */
    expect(AUFBEREITUNG).toContain('"source": "admin"');
    expect(AUFBEREITUNG).toContain('"herkunft": "cat01"');
    expect(AUFBEREITUNG).toContain('d["source"] not in ("import", "admin")');
    expect(IMPORT).toContain("catalog_editorial (sky_id, admin_note, updated_at)");
  });
});

describe("keine Identitaet wird im Voraus vergeben", () => {
  it("keine SKY-ID in der Aufbereitung", () => {
    /* Nicht einmal als Platzhalter: die ID kommt aus `sky_id_seq`. */
    expect(code(AUFBEREITUNG)).not.toMatch(/SKY-\d{4}/);
  });

  it("die Huelle zieht sie aus der Sequenz und ERST nach der Dublettenpruefung", () => {
    expect(IMPORT).toContain("nextval('public.sky_id_seq')");
    expect(IMPORT).toContain("lpad(v_next::text, 4, '0')");
    /* Die uebersprungene Zeile verbraucht keine ID — `continue` steht vorher. */
    expect(IMPORT.indexOf("v_uebersprungen := v_uebersprungen + 1"))
      .toBeLessThan(IMPORT.indexOf("nextval('public.sky_id_seq')"));
    /* Und der reservierte Bereich bleibt unerreichbar (ADR-0070). */
    expect(IMPORT).toContain("v_next > 8999");
  });

  it("und kein Slug: den bildet die Datenbank", () => {
    expect(AUFBEREITUNG).toContain("KEIN SLUG IM VORAUS");
    expect(IMPORT).toContain("public.next_figure_slug(r.name, r.series_code, v_sky)");
  });
});

describe("kein Bild wird uebernommen", () => {
  it("die externe Bildangabe ist ein Pfad, kein Download", () => {
    expect(AUFBEREITUNG).toContain('"bildquelle_extern"');
    expect(AUFBEREITUNG).toContain('"bildrechte_extern": "unverified"');
    /* Kein Entpacken, kein Schreiben nach public/. */
    /*
     * KEIN ENTPACKEN, KEIN LADEN, KEIN SCHREIBEN. Gesucht wird nach dem, was
     * TUN wuerde — nicht nach dem Wort: der Bericht SAGT „nichts nach
     * `public/` kopiert", und dieser Satz darf ihn nicht verdaechtig machen.
     */
    const c = code(AUFBEREITUNG);
    for (const verboten of ["ZipFile", "urlopen", "requests.", "shutil.",
                            "write_bytes", "copyfile"]) {
      expect(c, verboten).not.toContain(verboten);
    }
    /* Und geschrieben wird ausschliesslich nach `resources/analysis`. */
    for (const m of c.matchAll(/write_text\(|\.open\("w"/g)) {
      const umfeld = c.slice(Math.max(0, m.index - 160), m.index + 40);
      expect(umfeld, `Schreibziel bei ${m[0]}`).toMatch(/ANALYSE/);
    }
  });

  it("ein Projektbild ist ein VORSCHLAG und nur bei genau einem Treffer", () => {
    expect(AUFBEREITUNG).toContain("if len(bilder) == 1:");
    expect(AUFBEREITUNG).toContain('"bildstatus"] = "projektbild_vorschlag"');
    /* Und die Huelle setzt kein Bild — image_file kommt in ihrem INSERT nicht vor. */
    const spalten = IMPORT.slice(IMPORT.indexOf("insert into public.skylanders"),
                                 IMPORT.indexOf("-- Die interne Notiz"));
    expect(spalten).not.toContain("image_file");
    expect(spalten).not.toContain("image_override_path");
  });
});

describe("die Dublettenpruefung ist fachlich", () => {
  it("Name UND Serie, in beiden Werkzeugen und in der Huelle", () => {
    /*
     * ZWEI GETRENNTE RISIKEN. Die SKY-ID-Sequenz verhindert
     * ID-Kollisionen; sie verhindert keine fachliche Dublette. Deshalb
     * vergleicht jede Stufe Name und Serie zusammen — der Name allein ist
     * keine Identitaet (28 wiederholte Namen sind Wiederveroeffentlichungen).
     */
    expect(AUFBEREITUNG).toContain('schluessel = (D.falte(d["katalogname"]), d["series_code"])');
    expect(IMPORT).toContain("`${falte(d.katalogname)}|${d.series_code}`");
    expect(IMPORT).toContain("lower(btrim(s.name)) = lower(btrim(r.name))");
    expect(IMPORT).toContain("s.series_code = r.series_code");
  });

  it("und sie laeuft gegen den Katalog JETZT, nicht gegen die Momentaufnahme", () => {
    expect(IMPORT).toContain("Katalog JETZT");
    expect(IMPORT).toContain('lies("skylanders?select=');
  });

  it("die Huelle ist idempotent und sagt das", () => {
    expect(IMPORT).toContain("SIE IST IDEMPOTENT");
    expect(IMPORT).toContain("ein zweiter Lauf legt nichts doppelt an");
  });
});

describe("der Vollnamengriff im Abgleich", () => {
  const CAT01 = lies("tools/lib/cat01-diff.py");

  it("steht als ERSTER Griff, nicht als letzter", () => {
    /*
     * DER FEHLER, DEN ER BEHEBT. Der Abgleich zerlegte jeden Eintrag aus
     * einem Variantenabschnitt in Kern und Merkmal und suchte nur noch
     * danach. "Punch Pop Fizz" wurde zu (kern "pop fizz", merkmal
     * {"punch"}); der Katalog fuehrt aber den GANZEN Namen als Kern
     * (SKY-0144, oeffentlich sichtbar). Ergebnis war "Fehlende Variante" —
     * eine Figur als fehlend zu melden, die offen im Katalog steht. An 16
     * Zeilen, gefunden in CAT-03.
     */
    expect(CAT01).toContain("kat_vollname");
    expect(CAT01).toContain("NULLTER GRIFF");
    expect(CAT01.indexOf("NULLTER GRIFF"))
      .toBeLessThan(CAT01.indexOf("ZWEITDURCHGANG"));
  });

  it("gilt aber NUR, wenn jedes Merkmal im Namen steht", () => {
    /*
     * DER ZWEITE FEHLER, DER BEIM BEHEBEN DES ERSTEN ENTSTAND — und er ist
     * der Grund, warum diese Bedingung einen eigenen Test hat.
     *
     * "Punch Pop Fizz" traegt `punch` IM NAMEN. Den ganzen Namen zu
     * vergleichen heisst dann, Kern UND Merkmal zusammen zu vergleichen —
     * SKY-0144 heisst genau so, Treffer.
     *
     * Die Eon's-Elite-Zeile "Boomer" traegt `elite` aus dem ABSCHNITT. Der
     * Name allein traf SKY-0010, die GEWOEHNLICHE Figur; gemeint ist
     * SKY-0011 "Elite Boomer". Ohne diese Bedingung behob die Korrektur 16
     * Fehler und fuehrte neue ein.
     */
    expect(CAT01).toContain("merk_im_namen = all(m in voll_name for m in merk)");
    expect(CAT01).toContain("if merk_im_namen else []");
    /* Und die Datei sagt, warum — an genau diesem Beispiel. */
    expect(CAT01).toContain("Eon's Elite");
    expect(CAT01).toContain("GEWOEHNLICHE Figur");
  });

  it("und die Serie bleibt der Unterscheider", () => {
    /* Ein gleicher Name in einer ANDEREN Serie ist eine
       Wiederveroeffentlichung und nie "hoch". */
    const block = CAT01.slice(CAT01.indexOf("NULLTER GRIFF"),
                              CAT01.indexOf("stufe, grund"));
    expect(block).toContain('t["series_code"] == e["serie"]');
  });
});

describe("die Ergebnisdateien, wenn ein Lauf sie erzeugt hat", () => {
  const AKTE = "resources/analysis/cat-03-entwuerfe.json";

  it.runIf(existsSync(AKTE))("jeder Entwurf traegt draft, eine Kategorie und keine SKY-ID", () => {
    const akte = JSON.parse(lies(AKTE));
    expect(akte.entwuerfe.length).toBeGreaterThan(0);
    expect(akte.validierungsfehler).toEqual([]);
    for (const d of akte.entwuerfe) {
      expect(d.catalog_status).toBe("draft");
      expect(d.source).toBe("admin");
      expect(d.herkunft).toBe("cat01");
      expect(typeof d.category_id).toBe("number");
      expect(["figure", "game", "portal", "bundle", "other"]).toContain(d.item_type);
      expect(["standard", "special", "elite", "dark", "legendary", "chase", "prestige"])
        .toContain(d.card_type);
      expect(d.market_price).toBeNull();
      expect(d.element).toBeNull();
      expect(d).not.toHaveProperty("sky_id");
      expect(d).not.toHaveProperty("slug");
    }
  });

  it.runIf(existsSync(AKTE))("und kein Entwurf behauptet ein uebernommenes Bild", () => {
    const akte = JSON.parse(lies(AKTE));
    for (const d of akte.entwuerfe) {
      expect(["projektbild_vorschlag", "missing"]).toContain(d.bildstatus);
      expect(["unverified", "kein_bild"]).toContain(d.bildrechte_extern);
      /* Ein Vorschlag ist ein Vorschlag: er benennt, WOHER er kommt. */
      if (d.bildstatus === "projektbild_vorschlag") {
        expect(d.bildvorschlag).toMatch(/\.(webp|png|jpg)$/);
        expect(d.bildvorschlag_von).toMatch(/^SKY-\d{4}/);
      } else {
        expect(d.platzhalter).toBe(true);
      }
    }
  });
});

/* ==========================================================================
 * CAT-04A — die Charge begrenzt den Lauf auf benannte Kandidaten
 *
 * DER SCHADEN, UM DEN ES GEHT: ein erster Lauf auf Staging soll fünf Zeilen
 * anlegen und nicht 105. Ginge die Begrenzung still schief — ein Tippfehler
 * im Namen, ein Duplikat in der Liste —, entstünden entweder zu wenige
 * Zeilen (harmlos, aber unbemerkt) oder die Charge wäre wirkungslos. Beides
 * muss ABBRECHEN, nicht schrumpfen.
 * ======================================================================== */
describe("CAT-04A — die Chargenbegrenzung", () => {
  const CHARGE = "resources/analysis/cat-04-charge.json";
  /*
   * SEIT CAT-04E GIBT ES NUR NOCH EINE HUELLE. Der Excel-Import ist eine
   * EINMALIGE Vervollstaendigung und kein Dauerbetrieb: alle gueltigen
   * Entwuerfe gehen in einem Lauf, und die fuenf Testkandidaten sind darin
   * enthalten. Die separate Fuenfer-Huelle ist geloescht — eine zweite
   * Datei, die fast dasselbe tut, waere genau die Verwechslung, die der
   * Betreiber ausgeschlossen sehen wollte.
   */
  const HUELLE = "supabase/operations/staging-cat03-import.sql";

  it("ein unbekannter Name ist ein ABBRUCH, kein stilles Weglassen", () => {
    expect(IMPORT).toContain("Kandidat(en) der Charge stehen");
    expect(IMPORT).toContain("nicht in den Entwuerfen");
    /* Und der Ausstieg kommt, bevor irgendetwas ausgewählt wird. */
    expect(IMPORT.indexOf("fehlend.length > 0"))
      .toBeLessThan(IMPORT.indexOf("entwuerfe = gewaehlt"));
  });

  it("und die Zahl muss stimmen, sonst ebenfalls Abbruch", () => {
    expect(IMPORT).toContain("gewaehlt.length !== charge.kandidaten.length");
  });

  it("die Charge kann nur verkleinern, nie erweitern", () => {
    /*
     * Die Auswahl entsteht aus den ENTWUERFEN, nicht aus der Charge: jeder
     * Eintrag wird in der Entwurfsakte nachgeschlagen. Eine Charge kann
     * deshalb keine Zeile erfinden, die die Aufbereitung nicht geprüft hat.
     */
    expect(IMPORT).toContain("const nach = new Map(akte.entwuerfe.map(");
    expect(IMPORT).toContain("nach.get(`${k.katalogname}|${k.series_code}`)");
  });

  it("die Hülle bekommt einen eigenen Dateinamen", () => {
    /* Sonst überschriebe ein Chargenlauf die Hülle für alle 105 — und
       niemand sähe es der Datei an. */
    expect(IMPORT).toContain("`supabase/operations/staging-${charge.name.toLowerCase()}-import.sql`");
  });

  it.runIf(existsSync(CHARGE))("die Chargendatei nennt fünf begründete Kandidaten", () => {
    const charge = JSON.parse(lies(CHARGE));
    expect(charge.kandidaten).toHaveLength(5);
    const schluessel = new Set<string>();
    for (const k of charge.kandidaten) {
      expect(k.auswahl_begruendung.length).toBeGreaterThan(80);
      expect(k.bildentscheidung).toBe("platzhalter");
      expect(k.bildentscheidung_begruendung).toMatch(/passt NICHT|Platzhalter/);
      expect(["chase", "special", "dark", "legendary"]).toContain(k.card_type);
      expect(k.referenz_sky_id).toMatch(/^SKY-\d{4}/);
      schluessel.add(`${k.katalogname}|${k.series_code}`);
    }
    /* Kein Duplikat in der Charge selbst. */
    expect(schluessel.size).toBe(5);
  });

  it.runIf(existsSync(CHARGE))("und jeder Kandidat steht so in den Entwürfen", () => {
    const charge = JSON.parse(lies(CHARGE));
    const akte = JSON.parse(lies("resources/analysis/cat-03-entwuerfe.json"));
    const nach = new Map(akte.entwuerfe.map(
      (d: Record<string, unknown>) => [`${d.katalogname}|${d.series_code}`, d]));
    for (const k of charge.kandidaten) {
      const d = nach.get(`${k.katalogname}|${k.series_code}`) as Record<string, unknown>;
      expect(d, `${k.katalogname} fehlt in den Entwürfen`).toBeDefined();
      /* DIE AUSWAHLKRITERIEN, nachgerechnet statt behauptet. */
      expect(d.card_type_unsicher, `${k.katalogname}: Edition unsicher`).toBe(false);
      expect(d.card_type).toBe(k.card_type);
      expect(d.category_id).toBe(k.category_id);
      expect(d.catalog_status).toBe("draft");
      expect(String(d.referenz_sky_id).length).toBeGreaterThan(0);
      expect(String(d.category_begruendung)).toMatch(/^wie die Grundfigur/);
    }
  });

  it.runIf(existsSync(HUELLE))("die Hülle trägt so viele Zeilen wie der Lauf meldet", () => {
    const sql = lies(HUELLE);
    const werte = sql.slice(sql.indexOf("select * from (values"),
                            sql.indexOf(") as t(name, series_code"));
    const zeilen = werte.split("\n").filter((l) => l.trim().startsWith("('"));
    /* Die Zahl steht im Kopf der erzeugten Datei — beide muessen stimmen. */
    const kopf = sql.match(/(\d+) Katalogentwuerfe anlegen/);
    expect(kopf, "der Kopf nennt keine Zahl").not.toBeNull();
    expect(zeilen).toHaveLength(Number(kopf![1]));
    /* Und der Status steht fest in der INSERT-Zeile, nicht in den Werten. */
    expect(sql).toContain("false, 'draft', 'admin', true)");
    expect(werte).not.toContain("public");
  });

  it.runIf(existsSync(HUELLE) && existsSync(CHARGE))(
    "die fünf geprüften Kandidaten sind im Lauf enthalten", () => {
      /* Sie sind kein eigenes Verfahren mehr, aber sie sind geprueft — und
         sie muessen in dem einen Lauf vorkommen. */
      const sql = lies(HUELLE);
      for (const k of JSON.parse(lies(CHARGE)).kandidaten) {
        expect(sql, k.katalogname).toContain(`('${k.katalogname}'`);
      }
    });

  it.runIf(existsSync(HUELLE))("sie beweist, dass sonst nichts entstand oder verschwand", () => {
    const sql = lies(HUELLE);
    expect(sql).toContain("select count(*) into v_vorher from public.skylanders");
    expect(sql).toContain("v_nachher - v_vorher <> v_angelegt");
    /* Und sie erklaert sich selbst: woher sie kommt und was sie voraussetzt. */
    expect(sql).toContain("resources/analysis/cat-03-entwuerfe.json");
    expect(sql).toContain("ABBRUCH A2");
    expect(sql).toContain("ABBRUCH A4");
  });

  it("der Laufzettel nennt die Reihenfolge, die Risiken und die Abbruchgruende", () => {
    const zettel = lies("supabase/checks/cat04a_staging_run.md");
    /* Die eine zwingende Migration — und die drei, die es NICHT sind. */
    expect(zettel).toContain("Genau eine Migration: `0152`");
    for (const nicht of ["`0153`", "`0150`", "`0151`"]) expect(zettel, nicht).toContain(nicht);
    /* Der Admin-Testplan hat acht Schritte, und Schritt 8 prueft die SKY-ID. */
    expect(zettel).toContain("Admin-Testplan");
    expect(zettel).toMatch(/dieselbe SKY-ID/);
    /* Und er behauptet keine geklaerten Bildrechte. */
    expect(zettel).toContain("kann ich deshalb nicht behaupten");
    expect(zettel).toContain("PLATZHALTER");
  });

  it.runIf(existsSync(HUELLE))("sie fasst keine bestehende Zeile an", () => {
    /*
     * Kein `update public.skylanders`, kein `delete`. Die einzige
     * Aktualisierung ist der Upsert auf `catalog_editorial`, und der trifft
     * ausschliesslich die gerade erzeugte SKY-ID.
     */
    const sql = lies(HUELLE);
    expect(sql).not.toMatch(/update\s+public\.skylanders/i);
    expect(sql).not.toMatch(/delete\s+from/i);
    const upserts = [...sql.matchAll(/on conflict \(sky_id\) do update/g)];
    expect(upserts).toHaveLength(1);
    expect(sql.slice(sql.indexOf("insert into public.catalog_editorial"),
                     sql.indexOf("on conflict (sky_id) do update"))).toContain("v_sky");
  });
});
