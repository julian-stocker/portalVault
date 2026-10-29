import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

/**
 * Jede Prüfzeile, die einen FUNKTIONSRUMPF durchsucht, muss ihn auch treffen.
 *
 * WARUM DIESE DATEI EXISTIERT. Am 2026-10-28 hat die Nachkontrolle von
 * `0156` mit `9999 = 1` abgewichen — an Zeile 115, und die Ursache lag in
 * der PRÜFDATEI und nicht in der Migration. Die Zeile suchte
 * `%kein Bildpfad%`; im Quelltext ist diese Meldung aber über **zwei**
 * SQL-Literale verteilt:
 *
 *     raise exception '0156: das Bild ist ausgewaehlt, aber es kommt kein '
 *       'Bildpfad mit';
 *
 * PostgreSQL fügt benachbarte Literale erst beim Ausführen zusammen;
 * `pg_proc.prosrc` trägt den Rumpf so, wie er geschrieben ist — mit
 * Zeilenumbruch und Anführungszeichen dazwischen. Das Muster konnte also
 * nie treffen, obwohl der Riegel steht und wirkt (Probelauf P63 löst ihn
 * aus). Ein Lauf gegen die echte Datenbank hat das gefunden; diese Datei
 * findet es vorher.
 *
 * DIE ZWEITE SORTE FEHLER, DIE HIER AUFFÄLLT: ein Muster, das **nicht
 * scheitern kann**. `%series_code%category_id%` war grün, aber wertlos —
 * beide Namen stehen ein Dutzend Mal in demselben Rumpf. Deshalb prüft die
 * letzte Zusage, dass kein Muster aus mehreren kurzen Teilen besteht, die
 * einzeln überall vorkommen.
 *
 * WAS HIER NICHT GEPRÜFT WIRD: ob die Funktion auf der Datenbank dieselbe
 * ist wie in der Datei. Das ist die Aufgabe des Laufs selbst. Hier geht es
 * allein um die Frage, ob eine Prüfung ihr eigenes Ziel überhaupt treffen
 * kann.
 */

/** Die Rümpfe aller Funktionen aus allen Migrationen — die letzte gilt. */
function alleRumpfe(): Map<string, string> {
  const rumpfe = new Map<string, string>();
  const dateien = readdirSync("supabase/migrations")
    .filter((n) => n.endsWith(".sql")).sort();
  for (const datei of dateien) {
    const sql = readFileSync(`supabase/migrations/${datei}`, "utf8");
    const re = /create (?:or replace )?function\s+public\.(\w+)\s*\(([\s\S]*?)\)\s*\n\s*returns/g;
    for (let m = re.exec(sql); m !== null; m = re.exec(sql)) {
      const [, name, args] = m;
      /* Die Parameter zählen, nicht benennen: eine Signatur in der Prüfdatei
         nennt Typen, hier stehen Namen. Die ZAHL reicht zur Unterscheidung —
         und `0156` ist genau der Fall, der sie braucht (drei gegen vier). */
      const n = args.split("\n")
        .map((z) => z.replace(/--.*$/, "").trim())
        .filter((z) => z !== "" && !z.startsWith("*") && !z.startsWith("/*"))
        .join(" ")
        .split(",").map((a) => a.trim()).filter((a) => a !== "").length;
      /* Der Rumpf liegt zwischen dem Dollar-Zeichenpaar. */
      const anfang = sql.slice(m.index).search(/as \$(\w*)\$/);
      if (anfang < 0) continue;
      const marke = /as \$(\w*)\$/.exec(sql.slice(m.index + anfang))![0].slice(3);
      const von = m.index + anfang + 3 + marke.length;
      const bis = sql.indexOf(marke, von);
      if (bis < 0) continue;
      rumpfe.set(`${name}/${n}`, sql.slice(von, bis));
    }
  }
  return rumpfe;
}

/** SQL `LIKE`: `%` steht für beliebig viele Zeichen, `_` für genau eines. */
function like(text: string, muster: string): boolean {
  const rx = muster.split(/([%_])/)
    .map((t) => (t === "%" ? "[\\s\\S]*" : t === "_" ? "[\\s\\S]"
                 : t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("");
  return new RegExp(`^${rx}$`).test(text);
}

type Zeile = {
  datei: string; nr: string; muster: string;
  /**
   * Die Rümpfe, die diese Zeile meint.
   *
   * ZWEI SCHREIBWEISEN GIBT ES. `to_regprocedure('public.fn(text,jsonb)')`
   * nennt eine Signatur und damit genau einen Rumpf; `p.proname = 'fn'`
   * (oder `in (…)`) nennt einen Namen und trifft bei Überladung mehrere.
   * Für die zweite Form lautet die Zusage „mindestens einer passt" — das
   * ist genau, was so eine Zeile zählt.
   */
  ziele: string[];
  genau: boolean;
  negiert: boolean;
};

/**
 * Jede Prüfzeile, die `prosrc like` benutzt, samt der Signatur im selben
 * Block.
 */
function zeilenMitRumpfmuster(): Zeile[] {
  const gefunden: Zeile[] = [];
  for (const datei of readdirSync("supabase/checks").filter((n) => n.endsWith(".sql"))) {
    const sql = readFileSync(`supabase/checks/${datei}`, "utf8");
    const re = /\((\d+),\s*'[^']*',\s*'[^']*',\s*\n([\s\S]{0,900}?)\),\s*\n/g;
    for (let m = re.exec(sql); m !== null; m = re.exec(sql)) {
      const block = m[2];
      const treffer = /(not \()?p\.prosrc like '((?:[^']|'')*)'/.exec(block);
      if (treffer === null) continue;
      /* `''` im SQL-Literal ist ein einfaches Anführungszeichen. */
      const muster = treffer[2].replace(/''/g, "'");
      const negiert = treffer[1] !== undefined;

      const sig = /to_regprocedure\('public\.(\w+)\(([^)]*)\)'\)/.exec(block);
      if (sig !== null) {
        const n = sig[2].split(",").filter((x) => x.trim() !== "").length;
        gefunden.push({ datei, nr: m[1], muster, negiert,
                        ziele: [`${sig[1]}/${n}`], genau: true });
        continue;
      }
      /* Die zweite Schreibweise: über den Namen, ohne Signatur. */
      const namen = [...block.matchAll(/p\.proname (?:=|in \()\s*((?:'[^']+'(?:,\s*)?)+)/g)]
        .flatMap((x) => [...x[1].matchAll(/'([^']+)'/g)].map((y) => y[1]));
      if (namen.length === 0) continue;
      const ziele = [...RUMPFE_NAMEN.keys()]
        .filter((k) => namen.includes(k.slice(0, k.lastIndexOf("/"))));
      gefunden.push({ datei, nr: m[1], muster, negiert, ziele, genau: false });
    }
  }
  return gefunden;
}

const RUMPFE = alleRumpfe();
/* Derselbe Inhalt, eigener Name — der Parser liest ihn, und das soll man an
   der Benutzungsstelle sehen. */
const RUMPFE_NAMEN = RUMPFE;
const ZEILEN = zeilenMitRumpfmuster();

/**
 * Die Prüfdateien, für die diese Datei vollständig einsteht.
 *
 * Bewusst eine Liste und kein „alle": manche Prüfzeilen lesen Funktionen,
 * die eine viel ältere Migration anlegt, und manche Signaturen sind
 * überladen. Wo der Rumpf hier nicht auflösbar ist, kann diese Datei nichts
 * sagen — und sie behauptet es dann auch nicht.
 */
const VOLLSTAENDIG = [
  "0153_postflight.sql",
  "0154_postflight.sql", "0155_postflight.sql", "0156_postflight.sql",
  "0157_postflight.sql", "0158_postflight.sql",
];

describe("ein Rumpfmuster muss seinen Rumpf treffen können", () => {
  it("die Rümpfe der Migrationen lassen sich überhaupt lesen", () => {
    /* Ohne diese Zusage wäre jede folgende still grün. */
    expect(RUMPFE.size).toBeGreaterThan(100);
    expect(RUMPFE.has("admin_merge_draft/4")).toBe(true);
    expect(RUMPFE.has("admin_merge_draft/3")).toBe(true);
    expect(RUMPFE.has("admin_merge_plan/3")).toBe(true);
    expect(RUMPFE.has("admin_discard_draft/1")).toBe(true);
    /* Und die vier- und die dreiparametrige sind NICHT dieselbe. */
    expect(RUMPFE.get("admin_merge_draft/4")!.length)
      .toBeGreaterThan(RUMPFE.get("admin_merge_draft/3")!.length * 10);
  });

  it("es gibt überhaupt Zeilen dieser Art zu prüfen", () => {
    expect(ZEILEN.length).toBeGreaterThan(10);
  });

  for (const datei of VOLLSTAENDIG) {
    const meine = ZEILEN.filter((z) => z.datei === datei);

    it(`${datei}: jede Zeile nennt eine auflösbare Funktion`, () => {
      expect(meine.length).toBeGreaterThan(0);
      for (const z of meine) {
        expect(z.ziele.length, `${datei} Zeile ${z.nr}: kein Rumpf gefunden`)
          .toBeGreaterThan(0);
        for (const ziel of z.ziele) {
          expect(RUMPFE.has(ziel), `${datei} Zeile ${z.nr}: ${ziel}`).toBe(true);
        }
      }
    });

    it(`${datei}: jedes bejahende Muster trifft wirklich`, () => {
      for (const z of meine) {
        if (z.negiert) continue;
        const treffer = z.ziele.filter((ziel) => like(RUMPFE.get(ziel)!, z.muster));
        /* Bei einer Signatur: genau dieser Rumpf. Bei einem Namen mit
           Überladung: mindestens einer — mehr zählt die Zeile nicht. */
        expect(treffer.length,
               `${datei} Zeile ${z.nr} sucht '${z.muster}' in `
               + `${z.ziele.join(", ")} — trifft nicht. Liegt das Muster `
               + "vielleicht ueber zwei SQL-Literale verteilt? `prosrc` traegt "
               + "den Rumpf so, wie er geschrieben ist.").toBeGreaterThan(0);
        if (z.genau) expect(treffer).toEqual(z.ziele);
      }
    });

    it(`${datei}: jedes verneinende Muster trifft wirklich NICHT`, () => {
      for (const z of meine) {
        if (!z.negiert) continue;
        for (const ziel of z.ziele) {
          expect(like(RUMPFE.get(ziel)!, z.muster),
                 `${datei} Zeile ${z.nr} verlangt, dass '${z.muster}' NICHT `
                 + `in ${ziel} steht — es steht aber drin.`).toBe(false);
        }
      }
    });
  }

  it("kein Muster besteht aus mehreren kurzen Teilen, die überall vorkommen", () => {
    /*
     * `%series_code%category_id%` war grün und wertlos: beide Namen stehen
     * ein Dutzend Mal in demselben Rumpf, und das Muster hätte auch ohne
     * jede Kopplungsprüfung getroffen. Ein Muster mit mehreren Platzhaltern
     * in der Mitte braucht deshalb mindestens EIN Stück, das für sich schon
     * spezifisch ist.
     */
    for (const z of ZEILEN) {
      if (z.negiert || !VOLLSTAENDIG.includes(z.datei)) continue;
      const teile = z.muster.split("%").filter((t) => t !== "");
      if (teile.length < 2) continue;
      const laengstes = Math.max(...teile.map((t) => t.length));
      expect(laengstes,
             `${z.datei} Zeile ${z.nr}: '${z.muster}' besteht nur aus kurzen `
             + "Teilen. Ein Muster, das nicht scheitern kann, ist keine "
             + "Pruefung.").toBeGreaterThanOrEqual(18);
    }
  });
});


/* ==========================================================================
 * ZAEHLENDE BEHAUPTUNGEN
 *
 * WARUM DIESER ABSCHNITT EXISTIERT. Am 2026-10-28 hat die Nachkontrolle von
 * `0153` mit `9999 = 1` abgewichen — an Zeile 104, und die Ursache lag
 * wieder in der PRÜFDATEI. Sie zählte, wie oft die Zeichenfolge
 * `catalog_status` im Funktionsrumpf steht, und erwartete **1**. Tatsächlich
 * sind es **2**, denn eine Feldzeile dieses Exports nennt den Namen zweimal:
 *
 *     'catalog_status', t.catalog_status,
 *      ^^^^^^^^^^^^^^     ^^^^^^^^^^^^^^
 *      JSON-Schlüssel     Spaltenreferenz
 *
 * Das ist die kanonische Form JEDES Feldes dort — acht weitere Felder des
 * Bereichs `skylanders` kommen aus demselben Grund genau zweimal vor. Die
 * Erwartung war nicht knapp daneben, sondern begrifflich verkehrt: die Zeile
 * wollte eine ZEILE prüfen und zählte ein VORKOMMEN.
 *
 * Dieselbe Klasse wie `%kein Bildpfad%` in `0156` und die von Hand getippte
 * Signatur im `0152`-Preflight: eine Behauptung über einen Funktionsrumpf,
 * die niemand gegen den Rumpf nachgerechnet hat. Der Abschnitt oben schließt
 * sie für `like`-Muster; dieser schließt sie für Zählungen.
 *
 * WAS GEPRÜFT WIRD: jede Prüfzeile der Form
 *
 *     (length(p.prosrc) - length(replace(p.prosrc, '<Muster>', '')))
 *       / length('<Muster>')
 *
 * mit einem erwarteten Zahlwert wird gegen den echten Rumpf nachgerechnet.
 * Stimmt die Zahl nicht, fällt es hier auf — vor dem SQL-Editor.
 * ======================================================================= */

type Zaehlung = {
  datei: string; nr: string; muster: string; ziel: string; erwartet: number;
};

/**
 * Jede zählende Behauptung über einen Funktionsrumpf, samt Erwartung.
 *
 * Die Form ist eng gefasst und absichtlich so: nur Zeilen, die durch
 * `length('<dasselbe Muster>')` teilen, zählen VORKOMMEN. Eine Zeile, die
 * nur die Differenz bildet (`0150` zählt so Semikolons), zählt etwas
 * anderes und wird nicht mitgemessen.
 */
function zaehlendeZeilen(): Zaehlung[] {
  const gefunden: Zaehlung[] = [];
  for (const datei of readdirSync("supabase/checks").filter((n) => n.endsWith(".sql"))) {
    const sql = readFileSync(`supabase/checks/${datei}`, "utf8");
    const re = /\((\d+),\s*'[^']*',\s*'[^']*',\s*\n([\s\S]{0,1200}?)\),\s*'(\d+)'\),/g;
    for (let m = re.exec(sql); m !== null; m = re.exec(sql)) {
      const block = m[2];
      /* `length(replace(p.prosrc, '<A>', ''))` … `/ length('<B>')`, und A
         muss B sein — sonst zählt die Zeile nicht, was sie zu zählen meint. */
      const ersetzt = /length\(replace\(\s*p\.prosrc,\s*\n?\s*'((?:[^']|'')*)'/.exec(block);
      const geteilt = /\/\s*length\('((?:[^']|'')*)'\)/.exec(block);
      if (ersetzt === null || geteilt === null) continue;
      if (ersetzt[1] !== geteilt[1]) continue;
      const sig = /to_regprocedure\('public\.(\w+)\(([^)]*)\)'\)/.exec(block);
      if (sig === null) continue;
      const n = sig[2].split(",").filter((x) => x.trim() !== "").length;
      gefunden.push({
        datei, nr: m[1],
        muster: ersetzt[1].replace(/''/g, "'"),
        ziel: `${sig[1]}/${n}`,
        erwartet: Number(m[3]),
      });
    }
  }
  return gefunden;
}

const ZAEHLUNGEN = zaehlendeZeilen();

describe("eine zählende Behauptung muss die Zahl treffen, die wirklich dasteht", () => {
  it("es gibt überhaupt solche Zeilen zu prüfen", () => {
    /* Ohne diese Zusage wäre jede folgende still grün — derselbe Riegel wie
       im Abschnitt oben. */
    expect(ZAEHLUNGEN.length).toBeGreaterThan(0);
    expect(ZAEHLUNGEN.some((z) => z.datei === "0153_postflight.sql")).toBe(true);
  });

  it("jede nennt eine auflösbare Funktion", () => {
    for (const z of ZAEHLUNGEN) {
      expect(RUMPFE.has(z.ziel), `${z.datei} Zeile ${z.nr}: ${z.ziel}`).toBe(true);
    }
  });

  it("und jede zählt, was der echte Rumpf wirklich enthält", () => {
    for (const z of ZAEHLUNGEN) {
      const body = RUMPFE.get(z.ziel);
      expect(body, z.ziel).toBeDefined();
      const ist = body!.split(z.muster).length - 1;
      expect(ist,
             `${z.datei} Zeile ${z.nr} erwartet ${z.erwartet}x '${z.muster}' in `
             + `${z.ziel}, der Rumpf enthaelt es aber ${ist}x. Zaehlt die Zeile `
             + "vielleicht eine ZEICHENFOLGE, wo sie eine ZEILE meint? Eine "
             + "Feldzeile nennt ihren Namen zweimal — als Schluessel und als "
             + "Spaltenreferenz.").toBe(z.erwartet);
    }
  });

  it("0153 Zeile 104 zählt das vollständige Muster, nicht die Zeichenfolge", () => {
    /*
     * Der konkrete Fall, namentlich festgehalten. Die neue Fassung ist
     * STRENGER als die alte: sie nagelt Schlüssel und Spalte in genau dieser
     * Paarung fest. Ein `'catalog_status', t.card_type,` fiele auf, während
     * die Zeichenfolgenzählung es durchliess.
     */
    const z = ZAEHLUNGEN.find((x) => x.datei === "0153_postflight.sql" && x.nr === "104");
    expect(z, "Zeile 104 nicht gefunden").toBeDefined();
    expect(z!.muster).toBe("'catalog_status', t.catalog_status,");
    expect(z!.erwartet).toBe(1);
    /* Und die alte, falsche Fassung steht nicht mehr drin. */
    const sql = readFileSync("supabase/checks/0153_postflight.sql", "utf8");
    expect(sql).not.toContain("replace(p.prosrc, 'catalog_status', '')");
  });

  it("die Zeichenfolge allein kommt ZWEIMAL vor — das ist der Befund, der dahinter steht", () => {
    /*
     * Keine Prüfung der Prüfdatei, sondern die Begründung in Code: so sieht
     * jede Feldzeile dieses Exports aus, und eins wäre unmöglich.
     */
    const body = RUMPFE.get("system_platform_export/0");
    expect(body, "system_platform_export nicht gefunden").toBeDefined();
    expect(body!.split("catalog_status").length - 1).toBe(2);
    /* Und nicht nur bei diesem Feld — bei jedem, dessen Name sonst nirgends
       im Rumpf vorkommt. */
    for (const feld of ["catalog_visible", "card_type", "image_file",
                        "display_name_override", "character_id"]) {
      expect(body!.split(feld).length - 1, feld).toBe(2);
    }
  });
});

/* ==========================================================================
 * MASKIERUNG IN SUCHMUSTERN
 *
 * WARUM DIESER ABSCHNITT EXISTIERT. Am 2026-10-28 hat die Nachkontrolle von
 * `0159` mit `9999 = 1` abgewichen — an Zeile 123, und die Ursache lag zum
 * dritten Mal in der PRÜFDATEI. Die Zeile suchte in `pg_proc.proconfig`:
 *
 *     c like 'search\\_path=%'      ← zwei Backslashes
 *
 * SQL `LIKE` deutet `\\` als **einen echten Backslash** im Suchmuster. Die
 * Zeile suchte also Einträge, die wörtlich mit `search\_path=` beginnen — die
 * gibt es nicht. `count(*)` war 0, die Zeile meldete 0 statt 2, obwohl beide
 * Funktionen richtig konfiguriert waren: `security definer` mit genau einer
 * `search_path`-Festlegung, gemessen.
 *
 * DASS ES EIN TIPPFEHLER WAR UND KEIN DENKFEHLER, zeigt dieselbe Datei: im
 * Vorspann `fn` steht dasselbe Muster richtig, mit einem Backslash. Die
 * Datei war durch mehrere Maskierungsschichten erzeugt, und an genau dieser
 * Stelle hat eine Schicht zu viel überlebt.
 *
 * WARUM KEIN ANDERES WERKZEUG DAS FINDET. Die Datei ist syntaktisch
 * einwandfrei, jeder Name löst auf, jeder Typ passt — `verify:check-sql`
 * (Stufe 2) war grün und blieb grün. Der Fehler sitzt in der BEDEUTUNG des
 * Musters. `P68` dort hält jetzt die Semantik gegen echte
 * `proconfig`-Einträge; dieser Abschnitt hält die Schreibweise in ALLEN
 * Prüfdateien, auch denen, für die es keinen Probelauf gibt.
 *
 * WAS GEPRÜFT WIRD: jedes Suchmuster einer Prüfdatei — das Literal hinter
 * `like` und das in `substring(… from '…')`.
 *
 * EINE EIGENHEIT DIESES ABSCHNITTS: er schreibt keinen einzigen Backslash
 * in ein Stringliteral, sondern setzt ihn über `BS` zusammen. Ein Test über
 * Maskierungsfehler, der seine eigene Behauptung durch zwei
 * Maskierungsebenen schickt, wäre genau der Fehler, den er sucht —
 * `"search\_path"` ist in TypeScript `search_path`, ohne Backslash.
 * ======================================================================= */

/** Ein Backslash, ohne Maskierung aufgeschrieben. Siehe oben. */
const BS = String.fromCharCode(92);

type Suchmuster = { datei: string; art: "like" | "substring"; muster: string };

/**
 * Alle Suchmuster aller Prüfdateien.
 *
 * ZWEI ARTEN, UND SIE HABEN VERSCHIEDENE REGELN. Ein `LIKE`-Muster kennt
 * `_` als Platzhalter für genau ein Zeichen; ein wörtlich gemeinter
 * Unterstrich muss dort maskiert werden. `substring(… from …)` ist ein
 * POSIX-Ausdruck, in dem `_` nichts Besonderes ist — dort ist die
 * Maskierung erlaubt, aber nicht nötig (beide Schreibweisen kommen in den
 * Prüfdateien vor, und beide sind richtig). Die Arten werden getrennt
 * geführt, damit keine Zusage der einen über die andere behauptet wird.
 */
function alleSuchmuster(): Suchmuster[] {
  const gefunden: Suchmuster[] = [];
  for (const datei of readdirSync("supabase/checks").filter((n) => n.endsWith(".sql"))) {
    const sql = readFileSync(`supabase/checks/${datei}`, "utf8");
    for (const m of sql.matchAll(/\b(?:i?like)\s+'((?:[^']|'')*)'/g)) {
      gefunden.push({ datei, art: "like", muster: m[1].replace(/''/g, "'") });
    }
    for (const m of sql.matchAll(/substring\(\s*[\w.]+\s+from\s+'((?:[^']|'')*)'\s*\)/g)) {
      gefunden.push({ datei, art: "substring", muster: m[1].replace(/''/g, "'") });
    }
  }
  return gefunden;
}

const SUCHMUSTER = alleSuchmuster();

describe("ein Suchmuster muss richtig maskiert sein", () => {
  it("es gibt überhaupt Muster zu prüfen", () => {
    /* Ohne diese Zusage wäre jede folgende still grün — derselbe Riegel wie
       in den Abschnitten oben. Am 2026-10-28 sind es 357 `LIKE`-Muster und
       46 Ausdrücke; die Schranken liegen bewusst weit darunter. */
    expect(SUCHMUSTER.filter((m) => m.art === "like").length).toBeGreaterThan(200);
    expect(SUCHMUSTER.filter((m) => m.art === "substring").length).toBeGreaterThan(20);
  });

  it("keines trägt einen doppelten Backslash", () => {
    /*
     * DIE ZENTRALE ZUSAGE. Zwei Backslashes in einem SQL-Literal sind ein
     * echter Backslash im Suchmuster — und auf `proconfig`, `prosrc` oder
     * einem Spaltenwert dieses Projekts kann das nichts treffen. Es gibt
     * heute keine Prüfung, die einen Backslash SUCHEN will. Käme eine, wäre
     * sie eine bewusste Ausnahme und gehörte hier namentlich eingetragen —
     * nicht stillschweigend durchgelassen.
     */
    for (const m of SUCHMUSTER) {
      expect(m.muster.includes(BS + BS),
             `${m.datei}: das Muster '${m.muster}' traegt einen doppelten `
             + "Backslash. SQL deutet das als EINEN echten Backslash im "
             + "Suchmuster — die Pruefung kann dann nichts treffen und meldet "
             + "0. Gemeint ist fast sicher EIN Backslash, der den Unterstrich "
             + "maskiert.").toBe(false);
    }
  });

  it("jedes LIKE-Muster auf search_path maskiert den Unterstrich mit genau einem Backslash", () => {
    /*
     * Die engere Zusage für den Fall, der wirklich passiert ist. Ein
     * unmaskiertes `search_path=%` wäre ebenfalls falsch, nur leiser: `_`
     * trifft dann jedes Zeichen, und ein `searchXpath=` würde mitzählen.
     */
    const pfad = SUCHMUSTER.filter(
      (m) => m.art === "like" && m.muster.includes("search") && m.muster.includes("_path"));
    expect(pfad.length, "keine search_path-Muster gefunden").toBeGreaterThan(50);
    for (const m of pfad) {
      expect(m.muster.includes("search" + BS + "_path"),
             `${m.datei}: '${m.muster}' maskiert den Unterstrich nicht mit genau `
             + `einem Backslash. Erwartet ist 'search${BS}_path=%'.`).toBe(true);
    }
  });

  it("0159 Zeile 123 ist repariert und bleibt es", () => {
    /*
     * Der konkrete Fall, namentlich festgehalten — wie `0153` Zeile 104 im
     * Abschnitt oben. Diese Zusage hält die eine Zeile, die am 2026-10-28
     * einen Stagingdurchgang gekostet hat.
     */
    const sql = readFileSync("supabase/checks/0159_postflight.sql", "utf8");
    expect(sql.includes("where c like 'search" + BS + "_path=%') = 1), '2'),"),
           "Zeile 123 traegt das richtige Muster nicht mehr").toBe(true);
    expect(sql.includes("search" + BS + BS + "_path"),
           "der doppelte Backslash ist zurueck").toBe(false);
    /* Und die VIER Vorkommen in dieser Datei sind alle gleich geschrieben:
       drei im Vorspann `fn` (ein `substring`, zwei `like`) und das eine in
       Zeile 123. Dass drei davon immer richtig waren, ist der Beleg, dass
       hier ein Tippfehler saß und kein Missverständnis. */
    expect(sql.split("search" + BS + "_path").length - 1).toBe(4);
  });
});
