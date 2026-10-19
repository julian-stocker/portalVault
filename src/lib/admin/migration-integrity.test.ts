import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";

import { LIST, coveredFiles, digestOf, parse, render }
  from "../../../tools/checksums.mts";

/**
 * Was eine angewendete Migration vor unbemerkter Änderung schützt.
 *
 * WARUM DIESE DATEI EXISTIERT
 *
 * `0130` wurde auf Staging ausgeführt und danach um vier Zeilen ergänzt. Es
 * fiel nichts auf: `0126`–`0131` waren nicht committet, und die einzige
 * Prüfsummenliste deckte `supabase/checks/` ab, nicht die Migrationen. Eine
 * Migration, die nach ihrer Ausführung geändert wird, sieht hinterher genau
 * aus wie die, die gelaufen ist.
 *
 * Drei Dinge werden hier geprüft, und alle drei scheitern lieber, als etwas
 * durchzulassen:
 *
 *   1. Die Prüfsummenliste ist vollständig und stimmt — ein vergessenes
 *      `npm run sums:write` fällt hier auf, nicht erst auf Staging.
 *   2. Jede Zeile in `APPLIED.md` beschreibt die Datei, die wirklich gelaufen
 *      ist. Die eine dokumentierte Abweichung (`0130`) muss als Abweichung
 *      dastehen UND über ihr Rezept nachrechenbar sein.
 *   3. Die Erwartungswerte der Staging-Prüfung `0131_function_body_check.sql`
 *      stammen aus der Migrationsdatei — nicht aus dem Gedächtnis.
 */

const sha = (s: string | Buffer) =>
  createHash("sha256").update(s as never).digest("hex");

/* ==========================================================================
 * 1. Die Prüfsummenliste
 * ======================================================================== */
describe("supabase/SHA256SUMS.txt deckt alles ab und stimmt", () => {
  const liste = parse(readFileSync(LIST, "utf8"));
  const dateien = coveredFiles();

  it("die Liste ist genau so, wie das Werkzeug sie schreiben würde", () => {
    /* Ein vergessenes `npm run sums:write` fällt hier und nirgends später. */
    expect(readFileSync(LIST, "utf8")).toBe(render());
  });

  it("deckt alles ab, was gegen unbemerkte Änderung zu schützen ist", () => {
    /*
     * Drei Gruppen, drei Gründe:
     *   * `migrations` — angewendet, darf sich nicht ändern,
     *   * `checks` (samt `checks/dr`) — läuft lesend gegen Production,
     *   * `operations` — ÄNDERT Production, erst recht.
     * Die Summe muss aufgehen: keine abgedeckte Datei darf in keiner Gruppe
     * liegen, sonst wüchse die Liste an einer Stelle, die niemand prüft.
     */
    const migrationen = dateien.filter((p) => p.startsWith("supabase/migrations/"));
    const pruefdateien = dateien.filter((p) => p.startsWith("supabase/checks/"));
    const schalter = dateien.filter((p) => p.startsWith("supabase/operations/"));
    expect(migrationen.length).toBeGreaterThanOrEqual(131);
    expect(pruefdateien.length).toBeGreaterThanOrEqual(35);
    expect(schalter.length).toBeGreaterThanOrEqual(2);
    expect(dateien.length)
      .toBe(migrationen.length + pruefdateien.length + schalter.length);
  });

  it("die Sperrdateien sind in der Liste — sie ändern Rechte auf Production", () => {
    const liste2 = parse(readFileSync(LIST, "utf8"));
    for (const p of ["supabase/operations/lock-receipt-issuance.sql",
                     "supabase/operations/unlock-receipt-issuance.sql",
                     "supabase/checks/receipt_lock_check.sql"]) {
      expect(liste2.has(p), p).toBe(true);
    }
  });

  it("jede abgedeckte Datei steht drin, mit der richtigen Prüfsumme", () => {
    for (const p of dateien) {
      expect(liste.has(p), `fehlt in der Liste: ${p}`).toBe(true);
      expect(liste.get(p), p).toBe(digestOf(p));
    }
  });

  it("und nichts steht drin, was es nicht gibt", () => {
    for (const p of liste.keys()) expect(existsSync(p), p).toBe(true);
  });

  it("die Liste enthält sich selbst nicht", () => {
    expect(liste.has(LIST)).toBe(false);
  });

  it("jede .sql-Migration ist abgedeckt", () => {
    const alle = readdirSync("supabase/migrations")
      .filter((n) => n.endsWith(".sql")).sort();
    for (const n of alle) {
      expect(liste.has(`supabase/migrations/${n}`), n).toBe(true);
    }
    expect(alle.length).toBeGreaterThanOrEqual(131);
  });

  it("POSITIVKONTROLLE: ein geänderter Inhalt ergäbe eine andere Prüfsumme", () => {
    const p = "supabase/migrations/0131_business_backup_seller_fields.sql";
    const geaendert = readFileSync(p, "utf8") + "\n-- ein Zeichen mehr\n";
    expect(sha(geaendert)).not.toBe(liste.get(p));
  });
});

/* ==========================================================================
 * 2. APPLIED.md — die Fassung, die wirklich gelaufen ist
 * ======================================================================== */
describe("APPLIED.md beschreibt die ausgeführten Fassungen", () => {
  const AKTE = "supabase/migrations/APPLIED.md";
  const text = readFileSync(AKTE, "utf8");

  type Zeile = { datei: string; digest: string; heute: string };

  /**
   * Die Akte führt ZWEI Tabellen — eine je Umgebung. Sie werden getrennt
   * gelesen: `0130` lief auf Staging in einer anderen Fassung als auf
   * Production (dort erstmalig, in der heutigen), und das darf nicht
   * verschmelzen.
   */
  function tabelle(ueberschrift: string): Zeile[] {
    const von = text.indexOf(`## ${ueberschrift}`);
    expect(von, `Abschnitt ## ${ueberschrift} fehlt`).toBeGreaterThan(-1);
    const bis = text.indexOf("\n## ", von + 1);
    const block = text.slice(von, bis === -1 ? undefined : bis);
    return [...block.matchAll(
      /^\| `(\d{4}_[a-z0-9_]+\.sql)` \| `([0-9a-f]{64})` \| ([^|]+?) \|/gm)]
      .map((m) => ({ datei: m[1], digest: m[2], heute: m[3].trim() }));
  }

  const zeilen: Zeile[] = tabelle("Staging");
  const production: Zeile[] = tabelle("Production");

  it("die Staging-Tabelle führt die dreizehn angewendeten", () => {
    /*
     * Elf waren es bis zum 2026-10-18 (`0122`–`0132`). Am 2026-10-19 kamen
     * `0135` und `0136` dazu — in EINEM Durchgang über
     * `supabase/operations/staging-0135-0136.sql`. `0133` und `0134` fehlen
     * weiter: die Tabelle hat damit eine Lücke, und die ist gewollt (die
     * Nummer ist eine Reihenfolge, keine Kette).
     */
    expect(zeilen.length).toBe(13);
    expect(zeilen.map((z) => z.datei)).toContain("0135_catalog_item_type.sql");
    expect(zeilen.map((z) => z.datei)).toContain("0136_business_backup_item_type.sql");
    expect(zeilen.map((z) => z.datei)).not.toContain("0133_paid_total_immutable.sql");
    expect(zeilen.map((z) => z.datei)).not.toContain("0134_purchase_item_source_row_visible.sql");
  });

  it("und die Akte ist ab 0122 lückenlos — angewendet ODER ausdrücklich nicht", () => {
    /*
     * `0134` liegt vor und ist nirgends ausgeführt. Eine Akte, die nur
     * Angewendetes kennt, würde eine solche Datei stillschweigend übergehen —
     * und genau das Übergehen war der Anlass für diese Akte. Deshalb drei
     * Quellen: BEIDE Umgebungstabellen und die Liste „Nicht angewendet".
     *
     * Beide, nicht nur Staging: `0132` und `0133` wurden am 2026-10-18
     * versehentlich auf Production ausgeführt und stehen auf Staging noch aus.
     * Eine Vollständigkeitsprüfung, die Staging als die weiter fortgeschrittene
     * Umgebung voraussetzt, hätte genau diesen Fall als Lücke gemeldet — und
     * die Akte ist dafür da, ihn zu FÜHREN.
     */
    const erfasst = new Set([
      ...zeilen.map((z) => z.datei),
      ...production.map((z) => z.datei),
      ...[...text.matchAll(/^\| `(\d{4}_[a-z0-9_]+\.sql)` \| lokal vorbereitet/gm)]
        .map((m) => m[1]),
    ]);
    const abGrenze = readdirSync("supabase/migrations")
      .filter((n) => n.endsWith(".sql") && n >= "0122").sort();
    for (const n of abGrenze) expect(erfasst, `${n} fehlt in APPLIED.md`).toContain(n);
    expect(erfasst.size).toBe(abGrenze.length);
  });

  it("die nicht angewendeten stehen in KEINER Umgebungstabelle", () => {
    const offen = [...text.matchAll(/^\| `(\d{4}_[a-z0-9_]+\.sql)` \| lokal vorbereitet/gm)]
      .map((m) => m[1]);
    expect(offen).toContain("0134_purchase_item_source_row_visible.sql");
    for (const n of offen) {
      expect(zeilen.map((z) => z.datei), n).not.toContain(n);
      expect(production.map((z) => z.datei), n).not.toContain(n);
    }
  });

  it("jede Datei existiert und jede Prüfsumme ist eine", () => {
    for (const z of zeilen) {
      expect(existsSync(`supabase/migrations/${z.datei}`), z.datei).toBe(true);
      expect(z.digest).toMatch(/^[0-9a-f]{64}$/);
      expect(["gleich", "abweichend"], z.datei)
        .toContain(z.heute.split(" ")[0]);
    }
  });

  it("wo `gleich` steht, ist die Datei bitgenau die ausgeführte Fassung", () => {
    const gleiche = zeilen.filter((z) => z.heute === "gleich");
    /* Zehn bis zum 2026-10-18, zwölf seit `0135`/`0136`. Nur `0130` weicht ab
       und zeigt auf ihren Nachtrag. */
    expect(gleiche.length).toBe(12);
    for (const z of gleiche) {
      expect(digestOf(`supabase/migrations/${z.datei}`), z.datei).toBe(z.digest);
    }
  });

  it("wo `abweichend` steht, weicht sie wirklich ab — und zeigt auf den Nachtrag", () => {
    const andere = zeilen.filter((z) => z.heute !== "gleich");
    expect(andere.length).toBe(1);
    const z = andere[0];
    expect(z.datei).toBe("0130_business_backup_fields.sql");
    expect(digestOf(`supabase/migrations/${z.datei}`)).not.toBe(z.digest);
    expect(z.heute).toContain("0130_amendment.md");
    expect(existsSync("supabase/checks/0130_amendment.md")).toBe(true);
  });

  /*
   * DER KERN DER REVISIONSSICHERHEIT. Die ausgeführte Fassung von `0130`
   * liegt NICHT als zweite, ausführbare Datei daneben — die führte irgendwann
   * jemand aus. Sie liegt als Rezept: heutige Datei minus vier Zeilen.
   */
  it("und das Rezept aus dem Nachtrag stellt genau diese Prüfsumme her", () => {
    const NACHTRAG =
      "    if split_part(v_key, '|', 1) = '' or split_part(v_key, '|', 2) = '' then\n" +
      "      raise exception '%: der Pruefeintrag \"%\" hat keine Form Bereich|Feldzeile',\n" +
      "        v_wer, v_key;\n" +
      "    end if;\n";
    const datei = readFileSync(
      "supabase/migrations/0130_business_backup_fields.sql", "utf8");
    expect(datei.split(NACHTRAG).length - 1).toBe(1);
    const z = zeilen.find((x) => x.datei === "0130_business_backup_fields.sql")!;
    expect(sha(datei.replace(NACHTRAG, ""))).toBe(z.digest);
  });

  it("die Production-Tabelle führt die sechs des Rollouts und die zwei vom 2026-10-18", () => {
    expect(production.map((z) => z.datei)).toEqual([
      "0126_purchase_item_edit.sql",
      "0127_purchase_item_swap.sql",
      "0128_purchase_receipt_corrections.sql",
      "0129_business_backup_receipts.sql",
      "0130_business_backup_fields.sql",
      "0131_business_backup_seller_fields.sql",
      "0132_purchase_item_remove_by_line.sql",
      "0133_paid_total_immutable.sql",
    ]);
  });

  it("und die Akte sagt, dass die beiden letzten unbeabsichtigt dort liefen", () => {
    /* Ein Vorfall, der nur im Chatverlauf steht, ist nicht dokumentiert. */
    expect(text).toContain("unbeabsichtigt");
    expect(text).toContain("Auf Staging sind");
    expect(text).toContain("docs/history/2026-10-18-production-0132-0133.md");
  });

  it("0132 steht inzwischen AUCH auf Staging, 0133 noch nicht", () => {
    /*
     * Der Vorfall vom 2026-10-18 ist damit zur Hälfte nachgezogen: `0132`
     * wurde auf Staging angewendet und mit zwei Postflights belegt, `0133`
     * steht dort weiter aus. Beides muss die Akte auseinanderhalten können.
     */
    expect(zeilen.map((z) => z.datei))
      .toContain("0132_purchase_item_remove_by_line.sql");
    expect(zeilen.map((z) => z.datei))
      .not.toContain("0133_paid_total_immutable.sql");
    expect(production.map((z) => z.datei))
      .toContain("0133_paid_total_immutable.sql");
  });

  it("und jede davon ist bitgenau die Datei im Repository", () => {
    /*
     * Auf Production lief `0130` ERSTMALIG, also in der heutigen Fassung —
     * anders als auf Staging. Genau deshalb stehen die Umgebungen in zwei
     * Tabellen und nicht in einer.
     */
    for (const z of production) {
      expect(z.heute).toBe("gleich");
      expect(digestOf(`supabase/migrations/${z.datei}`), z.datei).toBe(z.digest);
    }
  });

  it("die Production-Zeile zu 0130 trägt die HEUTIGE Prüfsumme, nicht die von Staging", () => {
    const prod = production.find((z) => z.datei === "0130_business_backup_fields.sql")!;
    const stag = zeilen.find((z) => z.datei === "0130_business_backup_fields.sql")!;
    expect(prod.digest).not.toBe(stag.digest);
    expect(prod.digest).toBe(digestOf("supabase/migrations/0130_business_backup_fields.sql"));
  });

  it("die Akte nennt die Belegsperre und ihre Folge für den Postflight", () => {
    expect(text).toContain("lock-receipt-issuance.sql");
    expect(text).toContain("Prüfung 223");
    expect(text).toContain("Freigabe B");
  });

  it("die Regel gegen den nächsten Fall steht in der Akte", () => {
    expect(text).toContain("wird nicht mehr geändert");
    expect(text).toContain("nicht erneut angewendet");
  });
});

/* ==========================================================================
 * 3. Die Staging-Prüfung rechnet mit Werten aus der Datei
 * ======================================================================== */
describe("0131_function_body_check.sql erwartet, was die Migration enthält", () => {
  const PRUEFUNG = "supabase/checks/0131_function_body_check.sql";
  const MIGRATION =
    "supabase/migrations/0131_business_backup_seller_fields.sql";

  /** Genau der Text zwischen den Dollarzeichen — das ist `prosrc`. */
  function rumpfVon(sql: string): string {
    const i = sql.indexOf(
      "create or replace function public.seller_business_backup()");
    const a = sql.indexOf("\nas $$", i) + "\nas $$".length;
    return sql.slice(a, sql.indexOf("\n$$;", a) + 1);
  }

  /** Der Kommentartext, wie er in `pg_description` landet. */
  function kommentarVon(sql: string): string {
    const j = sql.indexOf(
      "comment on function public.seller_business_backup() is");
    const anfang = sql.indexOf("'", j);
    return sql.slice(anfang + 1, sql.indexOf("';", j)).replace(/''/g, "'");
  }

  const sql = readFileSync(MIGRATION, "utf8");
  const pruefung = readFileSync(PRUEFUNG, "utf8");
  const md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");

  const rumpf = rumpfVon(sql);
  const kommentar = kommentarVon(sql);

  it("der erwartete md5 des Rumpfs stimmt mit der Migration überein", () => {
    expect(md5(rumpf)).toBe("24c3810288bb20929fe995554a267adf");
    expect(pruefung).toContain("24c3810288bb20929fe995554a267adf");
  });

  it("und die erwartete Länge", () => {
    expect(rumpf.length).toBe(21458);
    /*
     * DIE ERWARTUNG IST KEIN EINZELWERT MEHR.
     *
     * Hier stand `toContain("'21458'")` — ein quotiertes Literal, weil die
     * Prüfdatei die Länge als Sollwert einer Zeile trug. Seit `0136` kennt sie
     * eine TABELLE bekannter Stände, und Länge, Kommentar und Feldzahl stehen
     * dort als Zahlen in der Zeile ihres Abdrucks. Geprüft wird deshalb der
     * Eintrag, nicht das Literal — vollständig in
     * `src/lib/backup/backup-item-type.test.ts`, das jede Standzeile gegen
     * ihre Migrationsdatei rechnet.
     */
    expect(pruefung).toContain("'24c3810288bb20929fe995554a267adf', 21458");
  });

  it("der erwartete md5 des Kommentars stimmt ebenfalls", () => {
    expect(md5(kommentar)).toBe("6b980ac961d1d6ac704587ecc6e9524f");
    expect(kommentar.length).toBe(674);
    expect(pruefung).toContain("'6b980ac961d1d6ac704587ecc6e9524f',   674");
  });

  it("der Vergleichswert für Stand 0130 stimmt mit 0130 überein", () => {
    /* Prüfung 401 unterscheidet STAND_0131 von STAND_0130 — der zweite Wert
       muss der Rumpf aus 0130 sein, sonst sagt der Befund Unsinn. */
    const rumpf0130 = rumpfVon(
      readFileSync("supabase/migrations/0130_business_backup_fields.sql", "utf8"));
    expect(md5(rumpf0130)).toBe("a27b61db988df7627a4992b1770ac626");
    expect(pruefung).toContain("a27b61db988df7627a4992b1770ac626");
  });

  it("die Zeilenzahlen, die die Prüfung erwartet, stehen so im Rumpf", () => {
    const zeilen = rumpf.split("\n");
    const bereiche = zeilen.filter((z) =>
      /^ {6}'[a-z_0-9]+', coalesce\(\($/.test(z)).length;
    const felder = zeilen.filter((z) => /^ {10}'[a-z_0-9]+',/.test(z)).length;
    expect(bereiche).toBe(28);
    expect(felder).toBe(352);
    /* 28 Bereiche sind in jedem Stand gleich und bleiben ein harter Sollwert. */
    expect(pruefung).toContain("'28'");
    /* Die Feldzahl gehört zum Stand: 352 in `0131`, 353 ab `0136`. */
    expect(pruefung).toContain("674, 352, 'STAND_0131_ZEICHENGLEICH'");
  });

  it("und die Prüfdatei kennt den Stand aus 0136 als zweiten freigegebenen", () => {
    const r0136 = rumpfVon(
      readFileSync("supabase/migrations/0136_business_backup_item_type.sql", "utf8"));
    expect(md5(r0136)).toBe("f6d08440707ba72a8040a8d1e666c092");
    expect(r0136.length).toBe(21494);
    expect(pruefung).toContain("'f6d08440707ba72a8040a8d1e666c092', 21494");
    expect(pruefung).toContain("890, 353, 'STAND_0136_ZEICHENGLEICH'");
    /* Und `0130` steht als bekannt, aber nicht freigegeben. */
    expect(pruefung).toContain("'STAND_0130',               false");
  });

  it("die Prüfung schreibt nichts", () => {
    const ohneProsa = pruefung.replace(/--.*$/gm, "");
    expect(ohneProsa).not.toMatch(/\bdo\s+\$\$/i);
    expect(ohneProsa).not.toMatch(/\binsert\s+into\b/i);
    expect(ohneProsa).not.toMatch(/\bupdate\s+public\./i);
    expect(ohneProsa).not.toMatch(/\bdelete\s+from\b/i);
    expect(ohneProsa).not.toMatch(/\b(create|alter|drop|grant|revoke|truncate)\b/i);
    /* Und sie ruft die Funktion nicht auf — sie liest ihre Definition. */
    expect(ohneProsa).not.toContain("seller_business_backup()");
  });
});

/* ==========================================================================
 * 4. Der leere search_path wird QUOTIERT abgelegt
 * ======================================================================== */

/**
 * DER FEHLGRIFF, DEN DIESER BLOCK VERHINDERT — ZUM ZWEITEN MAL.
 *
 * `set search_path = ''` landet in `pg_proc.proconfig` nicht als
 * `search_path=`, sondern als `search_path=""`: PostgreSQL legt einen leeren
 * GUC-Wert quotiert ab. Ein Textvergleich gegen `search_path=` schlägt deshalb
 * fehl, obwohl die Funktion vollkommen in Ordnung ist.
 *
 * Das ist auf Staging zweimal passiert:
 *
 *   1. `0124`-Preflight, Befund 106 — damals erkannt und in `0124`, `0125`
 *      und `0127` richtiggestellt (Präfix prüfen, Wert auspacken).
 *   2. `0131_function_body_check.sql`, erste Fassung, Prüfung 206 — dieselbe
 *      naive Erwartung wiederholt. Staging meldete `search_path=""` gegen
 *      erwartet `search_path=`, Gesamt 9999 = 1, bei im Übrigen
 *      zeichengleichem Funktionsrumpf.
 *
 * Eine Lehre, die im Kommentar steht, aber nicht geprüft wird, hält genau so
 * lange wie das Gedächtnis. Also wird sie hier geprüft.
 */
describe("search_path: die quotierte Darstellung von PostgreSQL", () => {
  /** Wie der Wert auf Staging wirklich aussieht — gemessen, nicht geraten. */
  const WIE_POSTGRES_ES_ABLEGT = 'search_path=""';

  /** Der naive Vergleich, der zweimal gefallen ist. */
  const naiv = (eintrag: string) => eintrag === "search_path=";

  /** Was die Prüfdateien stattdessen tun: Präfix + Wert auspacken. */
  const hatFestlegung = (proconfig: readonly string[]) =>
    proconfig.some((c) => c.startsWith("search_path="));
  const wertIstLeer = (proconfig: readonly string[]) => {
    const c = proconfig.find((x) => x.startsWith("search_path="));
    if (c === undefined) return false;
    return c.slice("search_path=".length).replace(/^"+|"+$/g, "") === "";
  };

  it("der naive Textvergleich scheitert an der echten Darstellung", () => {
    expect(naiv(WIE_POSTGRES_ES_ABLEGT)).toBe(false);
  });

  it("Präfix plus ausgepackter Wert erkennt sie richtig", () => {
    const proconfig = [WIE_POSTGRES_ES_ABLEGT];
    expect(hatFestlegung(proconfig)).toBe(true);
    expect(wertIstLeer(proconfig)).toBe(true);
  });

  it("und lässt einen NICHT leeren search_path nicht durch", () => {
    expect(hatFestlegung(["search_path=public"])).toBe(true);
    expect(wertIstLeer(["search_path=public"])).toBe(false);
  });

  it("und sieht eine FEHLENDE Festlegung als fehlend", () => {
    expect(hatFestlegung([])).toBe(false);
    expect(wertIstLeer([])).toBe(false);
  });

  /** Ausführbares SQL ohne Prosa — ein Kommentar darf den Fehlgriff nennen. */
  function ohneProsa(sql: string): string {
    return sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--.*$/gm, "");
  }

  const dateien = readdirSync("supabase/checks")
    .filter((n) => n.endsWith(".sql"))
    .map((n) => [n, ohneProsa(readFileSync(`supabase/checks/${n}`, "utf8"))] as const);

  /*
   * Die naive Form ist genau das Literal `'search_path='` — mit dem
   * schliessenden Hochkomma direkt hinter dem Gleichheitszeichen. Die
   * richtigen Formen sehen anders aus: `'search\_path=%'` (LIKE-Praefix, mit
   * Escape) und `'search_path=(.*)$'` (das Auspacken). Nach ihnen wird hier
   * also nicht gesucht — nur nach der einen falschen.
   */
  const NAIV = "'search_path='";

  it(`keine Prüfdatei vergleicht gegen das Literal ${NAIV}`, () => {
    expect(dateien.length).toBeGreaterThanOrEqual(18);
    const schuldige = dateien.filter(([, sql]) => sql.includes(NAIV)).map(([n]) => n);
    expect(schuldige, "naive search_path-Erwartung").toEqual([]);
  });

  it("wer proconfig liest, packt den Wert aus statt ihn zu vergleichen", () => {
    /* Nur Dateien, die `proconfig` wirklich LESEN. Eine Datei, die bloss
       selbst eine Funktion mit `set search_path = ''` anlegt, prüft nichts. */
    const pruefende = dateien.filter(([, sql]) => sql.includes("proconfig"));
    expect(pruefende.length).toBeGreaterThanOrEqual(14);
    for (const [name, sql] of pruefende) {
      const sauber = sql.includes("search\\_path=%")
        || sql.includes("substring(c from 'search_path=(.*)$')");
      expect(sauber, `${name} prüft den search_path als Text`).toBe(true);
    }
  });

  it("0131_function_body_check.sql prüft Vorhandensein, Wert und Anzahl", () => {
    const sql = readFileSync(
      "supabase/checks/0131_function_body_check.sql", "utf8");
    expect(sql).toContain("es gibt eine search_path-Festlegung");
    expect(sql).toContain("und ihr Wert ist LEER");
    expect(sql).toContain("genau EINE Festlegung");
    expect(sql).toContain("btrim(substring(c from 'search_path=(.*)$'), '\"')");
    expect(sql).toContain("array_length(f.proconfig, 1)");
  });

  it("POSITIVKONTROLLE: die naive Erwartung von damals würde auffallen", () => {
    /*
     * Genau die Zeile, die auf Staging 9999 = 1 ergab, wieder eingesetzt:
     *
     *   (206, 'Form', 'search_path ist leer gesetzt',
     *        (select coalesce(array_to_string(f.proconfig, ','), '(keins)') …),
     *        'search_path='),
     */
    const naiveFassung = readFileSync(
      "supabase/checks/0131_function_body_check.sql", "utf8")
      .replace("       'true'),", "       'search_path='),");
    expect(ohneProsa(naiveFassung).includes(NAIV)).toBe(true);
  });
});
