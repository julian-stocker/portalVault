import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * CAT-08 Stufe 1 — die Familie entsteht von selbst (`0161`).
 *
 * WAS HIER GEPRÜFT WIRD und was nicht. Dass die Funktion das Richtige TUT,
 * prüft Probelauf **P70** gegen echtes PostgreSQL — mit Chop Chop, Stump
 * Smash, Wrecking Ball und dem Veto. Diese Datei prüft die Zusagen, die man
 * an der Datei selbst ablesen kann, und sie prüft die REGEL als Rechnung:
 * welche Namen gelten als vereinbar, welche nicht.
 *
 * DIE REGEL IST HIER ZWEIMAL AUFGESCHRIEBEN, und das ist Absicht. Im
 * Funktionsrumpf steht sie als SQL, hier als TypeScript — und die Tabelle
 * unten ist der Vertrag zwischen beiden. Läuft eine der beiden Fassungen
 * auseinander, fällt es an einem benannten Fall auf und nicht an einem
 * Gefühl.
 */

const MIG = "supabase/migrations/0161_variant_family_auto.sql";
const SQL = readFileSync(MIG, "utf8");
/** Der Rumpf allein, ohne Kopfkommentar und ohne Vor-/Nachbedingungen. */
const RUMPF = SQL.slice(SQL.indexOf("as $$", SQL.indexOf("admin_publish_variant_auto(")),
                        SQL.indexOf("\n$$;"));

/**
 * Die Vereinbarkeitsregel, wie `0161` sie rechnet.
 *
 * `m` ist der Name eines Mitglieds der gefundenen Familie, `n` der Name der
 * Basisfigur. Vereinbar heißt: gleich, oder einer endet an einer WORTGRENZE
 * auf den anderen. Verglichen wird mit `endsWith` — im SQL mit `right()` —
 * und nicht mit einem Muster: ein Name darf `%` oder `_` enthalten.
 */
function vereinbar(m: string, n: string): boolean {
  const a = m.toLowerCase();
  const b = n.toLowerCase();
  return a === b || a.endsWith(` ${b}`) || b.endsWith(` ${a}`);
}

describe("die Vereinbarkeitsregel entscheidet die drei genannten Fälle richtig", () => {
  it("Chop Chop: die zweite Serie findet die Familie der ersten", () => {
    /* SKY-0015 (SA) und SKY-0149 (G) heißen beide „Chop Chop" und sind
       derselbe Charakter. Die Familie der ersten enthält danach die
       Grundfigur und ihre Variante — beide vereinbar. */
    for (const mitglied of ["Chop Chop", "Gold Chop Chop", "Legendary Chop Chop",
                            "Twin Blade Chop Chop", "Metallic Blue Chop Chop"]) {
      expect(vereinbar(mitglied, "Chop Chop"), mitglied).toBe(true);
    }
  });

  it("Stump Smash und Wrecking Ball ebenso", () => {
    for (const mitglied of ["Stump Smash", "Flocked Stump Smash",
                            "White Flocked Stump Smash"]) {
      expect(vereinbar(mitglied, "Stump Smash"), mitglied).toBe(true);
    }
    for (const mitglied of ["Wrecking Ball", "Glow-in-the-Dark Wrecking Ball",
                            "Metallic Purple Wrecking Ball"]) {
      expect(vereinbar(mitglied, "Wrecking Ball"), mitglied).toBe(true);
    }
  });

  it("und sie weist ab, was nicht dazugehört — das ist das VETO", () => {
    /*
     * Jede dieser Zeilen ist ein Fall, in dem der NAME der Familie passt und
     * ein MITGLIED nicht. Genau dann darf die Automatik nicht zugreifen.
     */
    expect(vereinbar("Cynder", "Zook")).toBe(false);
    expect(vereinbar("Spyro", "Chop Chop")).toBe(false);
    /* Die Wortgrenze: „Shot Dog" endet nicht auf „ Hot Dog", obwohl der Text
       „ot Dog" gemeinsam ist. Ohne die Wortgrenze wäre das ein Treffer. */
    expect(vereinbar("Shot Dog", "Hot Dog")).toBe(false);
    /* Und ADR-0034s eigenes Gegenbeispiel: Drobit ist Drobots Mini und ein
       EIGENER Charakter. Die Regel bringt sie nicht zusammen. */
    expect(vereinbar("Mini Drobit", "Drobot")).toBe(false);
    expect(vereinbar("Drobit", "Drobot")).toBe(false);
  });

  it("die Klammerform wird nicht zerlegt (ADR-0034, CAT-06)", () => {
    /* „Eon's Elite Boomer (2)" ist die zweite Ausfertigung desselben
       Artikels, kein Variantenname — und die Regel macht daraus keine
       Verwandtschaft. */
    expect(vereinbar("Eon's Elite Boomer (2)", "Boomer")).toBe(false);
    expect(vereinbar("Elite Boomer (2)", "Elite Boomer")).toBe(false);
    /* Die Prefixform dagegen trägt: „Elite Boomer" endet auf „ Boomer". */
    expect(vereinbar("Elite Boomer", "Boomer")).toBe(true);
  });

  it("sie ist symmetrisch — die Basisfigur darf der kürzere Name sein", () => {
    expect(vereinbar("Chop Chop", "Gold Chop Chop")).toBe(true);
    expect(vereinbar("Gold Chop Chop", "Chop Chop")).toBe(true);
  });

  it("und ein Name mit SQL-Platzhaltern bricht sie nicht", () => {
    /*
     * DER GRUND, WARUM DER RUMPF `right()` BENUTZT UND NICHT `like`. Ein
     * Prozentzeichen im Namen wäre in einem Muster ein Platzhalter — und
     * damit würde plötzlich alles passen.
     */
    expect(vereinbar("100% Boomer", "Boomer")).toBe(true);
    expect(vereinbar("Boomer", "100% Boomer")).toBe(true);
    expect(vereinbar("Cynder", "100%")).toBe(false);
    expect(vereinbar("Cynder", "_ynder")).toBe(false);
  });
});

describe("der Rumpf von 0161 trägt die vier Zusagen", () => {
  it("die Vetoprüfung, mit right() und ohne like auf dem Namen", () => {
    expect(RUMPF).toContain("nicht vereinbar");
    expect(RUMPF).toContain("right(lower(s.name), length(v_klein) + 1)");
    expect(RUMPF).toContain("right(v_klein, length(s.name) + 1)");
    /* Und NICHT mit einem Muster: das ist die Stelle, an der ein `%` im
       Namen alles treffen würde. */
    expect(RUMPF).not.toMatch(/like\s+'%\s*'\s*\|\|\s*v_klein/);
    expect(RUMPF).not.toMatch(/s\.name\s+like/);
  });

  it("der Advisory-Lock auf dem kleingeschriebenen Familiennamen", () => {
    expect(RUMPF).toContain("pg_advisory_xact_lock(hashtext('skyisles.family:' || v_klein))");
    /* Er steht VOR der Suche — sonst wäre er wirkungslos. */
    expect(RUMPF.indexOf("pg_advisory_xact_lock"))
      .toBeLessThan(RUMPF.indexOf("from public.characters c"));
  });

  it("die feste Sperrordnung über beide Zeilen", () => {
    expect(RUMPF).toContain("where s.sky_id in (p_sky_id, p_base_sky_id)");
    expect(RUMPF).toContain("order by s.sky_id");
    expect(RUMPF).toContain("for update");
  });

  it("und sie schreibt nicht selbst, sondern ruft die drei vorhandenen Wege", () => {
    expect(RUMPF).not.toContain("update public.skylanders");
    expect(RUMPF).not.toContain("delete from");
    expect(RUMPF).toContain("public.admin_set_character(");
    expect(RUMPF).toContain("public.admin_set_variant_base(p_sky_id, p_base_sky_id, false)");
    expect(RUMPF).toContain("public.admin_set_catalog_status(p_sky_id, 'public')");
    /* Die Familie wird an EINER Stelle angelegt. */
    expect(RUMPF.match(/admin_create_character\(/g)).toHaveLength(1);
  });

  it("die vier Lagen stehen namentlich im Rumpf", () => {
    expect(RUMPF).toContain("'uebernommen'");
    expect(RUMPF).toContain("'nur die Variante hat eine'");
    expect(RUMPF).toContain("'vorhandene gefunden'");
    expect(RUMPF).toContain("'neu angelegt'");
    /* Und der Widerspruch bricht ab. */
    expect(RUMPF).toContain("klaeren, welche gilt");
  });

  it("sie setzt 0158, 0159 und 0152 voraus und ersetzt keine davon", () => {
    expect(SQL).toContain("0161 setzt 0159 voraus");
    expect(SQL).toContain("0161 setzt 0158 voraus");
    expect(SQL).toContain("0161 setzt 0152 voraus");
    /* KEIN `create or replace` auf einer fremden Funktion. */
    const erzeugt = [...SQL.matchAll(/create or replace function public\.(\w+)/g)]
      .map((m) => m[1]);
    expect(erzeugt).toEqual(["admin_publish_variant_auto"]);
    /* Und kein `drop function` auf einer fremden. */
    expect(SQL).not.toMatch(/drop function[^;]*admin_(set|publish|create)_(variant_base|with_base|character|as_variant)/);
  });

  it("und sie fasst keine Tabelle an", () => {
    expect(SQL).not.toMatch(/alter\s+table/i);
    expect(SQL).not.toMatch(/create\s+(table|index|trigger|policy)/i);
    expect(SQL).not.toMatch(/^\s*update\s+public\./im);
    expect(SQL).not.toMatch(/^\s*insert\s+into\s+public\./im);
  });

  it("der eindeutige Index ist eine Vorbedingung, kein Wunsch", () => {
    /* Ohne ihn wäre „die Familie mit diesem Namen" eine Auswahl und keine
       Beschreibung — dann dürfte die Funktion nicht suchen. */
    expect(SQL).toContain("lower(canonical_name)");
    expect(SQL).toContain("der eindeutige Index auf");
  });
});

describe("die Rücknahme nimmt eine Funktion und keine Zuordnung", () => {
  const R = readFileSync("supabase/rollback/R0161_drop_variant_family_auto.sql", "utf8");

  it("sie entfernt genau eine Funktion", () => {
    expect(R).toContain("drop function if exists public.admin_publish_variant_auto(text, text);");
    /* Gezählt wird im AUSFÜHRBAREN Teil: der Kopf nennt die Anweisung noch
       einmal im Klartext, und ein Kommentar löscht nichts. */
    const code = R.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
    expect(code.match(/drop function/g)).toHaveLength(1);
  });

  it("und keine Zeile, keine Spalte, keine Tabelle", () => {
    expect(R).not.toMatch(/alter\s+table/i);
    expect(R).not.toMatch(/^\s*update\s+public\./im);
    expect(R).not.toMatch(/^\s*delete\s+from/im);
    expect(R).not.toMatch(/\bdrop\s+(table|column|index|trigger|constraint)\b/i);
  });

  it("sie prüft nach, dass die Wege aus 0158/0159 noch stehen", () => {
    expect(R).toContain("admin_set_variant_base(text,text,boolean)");
    expect(R).toContain("admin_publish_with_base(text,text,boolean)");
    expect(R).toContain("ein Schritt zu viel");
  });
});

describe("die Oberfläche fragt nicht mehr nach der Familie", () => {
  const DIALOG = readFileSync("src/components/admin/draft-dialog.tsx", "utf8");
  const ACTIONS = readFileSync("src/lib/admin/actions.ts", "utf8");
  const I18N = readFileSync("src/lib/i18n/de.ts", "utf8");

  it("die Checkbox ist fort — samt ihrem Zustand und ihren Sätzen", () => {
    expect(DIALOG).not.toContain("famAnlegen");
    expect(DIALOG).not.toContain("baseFamilyCreate");
    expect(DIALOG).not.toContain("baseFamilyNoneYet");
    expect(I18N).not.toContain("baseFamilyCreate:");
    expect(I18N).not.toContain("baseFamilyNoneYet:");
  });

  it("der Dialog kündigt stattdessen an, was geschieht", () => {
    expect(DIALOG).toContain("de.admin.baseFamilyFromBase");
    expect(DIALOG).toContain("de.admin.baseFamilyAuto");
    expect(I18N).toContain("baseFamilyAuto:");
  });

  it("und er ruft die automatische Fassung auf — für CHARAKTERFIGUREN", () => {
    expect(DIALOG).toContain("publishDraftVariantAuto");
    expect(ACTIONS).toContain("admin_publish_variant_auto");
  });

  it("für Nicht-Charaktere geht er bewusst den Weg aus 0159, ohne Familie", () => {
    /*
     * CAT-08 KORREKTUR, und sie ist eine Zwischenlösung an der sicheren
     * Seite: `0161` regelt die CHARAKTERFAMILIE und kennt die Artikelart
     * nicht. Ein Trap, ein Fahrzeug, ein Kristall ist kein Charakter —
     * `characters` führt sie nicht (`character-data.test.ts`). Bis eine
     * Folgemigration der Funktion die Frage beibringt, nimmt der Dialog für
     * sie `admin_publish_with_base` mit `p_create_family = false`: das setzt
     * die Basiszuordnung und veröffentlicht, und es fasst die Familie
     * nachweislich nicht an.
     */
    expect(DIALOG).toContain("publishDraftWithBase");
    expect(DIALOG).toContain('basis?.art === "character"');
    expect(DIALOG).toContain("publishDraftWithBase(entwurf.skyId, gewaehlteBasis.skyId, false)");
    /* Und die Oberfläche sagt es, statt es stillschweigend zu tun. */
    expect(DIALOG).toContain("baseFamilyOnlyCharacters");
    /* Auch die Detailseite legt für Nicht-Charaktere keine Familie an. */
    const SELECT = readFileSync("src/components/admin/base-select.tsx", "utf8");
    expect(SELECT).toContain('basis?.art === "character"');
  });

  it("die Aktion mit Kennzeichen BLEIBT — 0159 ist unverändert gültig", () => {
    /* Sie wird vom Dialog nicht mehr gerufen, aber sie ist weiter da: die
       Oberfläche ist der Grund für CAT-08, nicht die Datenbank. */
    expect(ACTIONS).toContain("export async function publishDraftWithBase");
    expect(ACTIONS).toContain("export async function setVariantBase");
  });

  it("das Veto wird dem Bediener verständlich gesagt", () => {
    expect(ACTIONS).toContain("nicht vereinbar");
    expect(ACTIONS).toContain("de.admin.baseFamilyNotConfirmed");
    expect(I18N).toContain("baseFamilyNotConfirmed:");
    /* Und die Meldung nennt das Mitglied in der Hausform `SKY-xxxx Name` —
       nicht in der Klammerform, die im Projekt einen Variantennamen
       bezeichnet (CAT-06). */
    expect(ACTIONS).toContain("`${m[1]} ${m[2]}`");
  });

  it("die manuelle Familienverwaltung bleibt als Korrekturweg", () => {
    /* Anforderung 9: `family-select.tsx` auf der Detailseite bleibt. */
    const FAMILY = readFileSync("src/components/admin/family-select.tsx", "utf8");
    expect(FAMILY).toContain("setFigureCharacter");
    expect(ACTIONS).toContain("export async function setFigureCharacter");
    expect(ACTIONS).toContain("export async function createCharacterFamily");
  });
});
