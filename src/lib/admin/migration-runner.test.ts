import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { pruefeBaseline, PLATZHALTER, VERTRAEGE } from "@/../tools/lib/baseline.mts";
import {
  fahreAblauf, ladeAkte, ladePlaene, sammleBaselines, aktePfad,
  type Ablauf, type Plan, type Werkzeuge,
} from "@/../tools/db-migrate-staging.mts";

/**
 * Der Migrations-Runner (`npm run db:migrate:staging`).
 *
 * WARUM ER GEBAUT WURDE. Bei `0145` und bei `0146` hat die Nachkontrolle
 * `9999 = 18` gemeldet — achtzehn rote Zeilen, und zwar **ausschliesslich**
 * die der Baseline-Übergabe (801–804, 811–817, 821–824, 831–833). Beide Male
 * war die Ursache dieselbe: die Hüllen tragen Platzhalter, die ein Mensch
 * ersetzen muss, und er hat es nicht. Die Riegel haben funktioniert; der
 * Ablauf war der Fehler.
 *
 * WAS HIER GEPRÜFT WIRD UND WAS NICHT. Diese Datei fasst keine Datenbank an.
 * Geprüft wird das Rechnende und das Entscheidende — der Vertragsprüfer, das
 * Einsammeln, das Einfrieren, die Akte. Dass der Runner gegen Staging das
 * Richtige tut, zeigt erst ein Lauf; was er dort tut, steht in
 * `supabase/checks/0146_staging_run.md`.
 */

const TMP: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), "skyisles-akte-"));
  TMP.push(d);
  return d;
};
afterEach(() => {
  for (const d of TMP.splice(0)) rmSync(d, { recursive: true, force: true });
});

/**
 * Eine Quelldatei ohne ihre Kommentare.
 *
 * Mehrere Zusagen werden an der Quelle geprueft, und dann muss die Frage den
 * Code treffen und nicht die Erklaerung darueber. Ein Kommentar, der den
 * `SERVICE_ROLE`-Schluessel erwaehnt, um zu sagen dass er nicht verwendet
 * wird, darf die Pruefung nicht roetlich machen.
 */
const ohneKommentare = (quelle: string): string =>
  quelle
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((z) => !z.trimStart().startsWith("//"))
    .join("\n");

/** Die beiden echten Zeilen aus dem Lauf vom 2026-10-25. */
const BASE = "skyisles-base-1|256|4d1d6c30fe0ae886ca2689bcb1fe9634|534|534|286|626"
  + "|3821eb4f6bb067a408d973c3c14145e0|e61aa1ea49a4";
const COLL = "skyisles-coll-1|1|1|a8c965923be52b4d6fee837ae35fd22e|c8a5542794f2";

/**
 * Eine GUELTIGE andere Shop-Baseline bauen — Schutzsumme nachgerechnet.
 *
 * Ein Test, der „die Welt hat sich veraendert" zeigen will, braucht eine
 * Zeile, die der Pruefer annimmt. Nur eine Zahl zu ersetzen zerstoert die
 * Schutzsumme, und dann prueft der Test den Pruefer statt den Ablauf.
 */
const andereBasis = (angebote: string): string => {
  const f = BASE.split("|").slice(0, -1);
  f[1] = angebote;
  const schutz = createHash("md5").update(f.slice(1).join("|")).digest("hex").slice(0, 12);
  return `${f.join("|")}|${schutz}`;
};


describe("der Vertragsprüfer rechnet, statt hinzusehen", () => {
  it("nimmt eine heile Zeile und sagt, welcher Vertrag es ist", () => {
    const b = pruefeBaseline(BASE);
    expect(b.ok).toBe(true);
    if (b.ok) {
      expect(b.name).toBe("skyisles.base");
      expect(b.felder).toBe(9);
      expect(b.schutz).toBe("e61aa1ea49a4");
    }
    const c = pruefeBaseline(COLL);
    expect(c.ok).toBe(true);
    if (c.ok) expect(c.name).toBe("skyisles.coll");
  });

  it("weist eine fehlende, leere und eine Platzhalter-Zeile ab", () => {
    for (const roh of [null, undefined, "", "   ", ...PLATZHALTER]) {
      const b = pruefeBaseline(roh as string);
      expect(b.ok, JSON.stringify(roh)).toBe(false);
    }
  });

  it("der Platzhalter zählt wie eine FEHLENDE Zeile, nicht wie ein Wert", () => {
    /*
     * Die Hülle bringt ihn mit, damit niemand die Zeile vergisst — und genau
     * deshalb darf er nicht als Baseline durchgehen. Sonst wäre die
     * Bequemlichkeit der Hülle die Lücke im Riegel.
     */
    const b = pruefeBaseline("BASIS-HIER-EINSETZEN");
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.grund).toContain("Platzhalter");
  });

  it("weist eine fremde Marke ab", () => {
    const b = pruefeBaseline(BASE.replace("skyisles-base-1", "skyisles-base-9"));
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.grund).toContain("Marke");
  });

  it("weist eine abgeschnittene und eine zu lange Zeile ab", () => {
    const t = BASE.split("|");
    for (const kaputt of [t.slice(0, 8).join("|"), `${BASE}|zuviel`]) {
      const b = pruefeBaseline(kaputt);
      expect(b.ok).toBe(false);
      if (!b.ok) expect(b.grund).toContain("Felder");
    }
  });

  it("weist zwei vertauschte Felder ab — die Schutzsumme merkt es", () => {
    const t = BASE.split("|");
    const vertauscht = [t[0], t[2], t[1], ...t.slice(3)].join("|");
    const b = pruefeBaseline(vertauscht);
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.grund).toContain("Schutzsumme");
  });

  it("weist eine veränderte Zahl ab, auch wenn nur eine Stelle fehlt", () => {
    const b = pruefeBaseline(BASE.replace("|256|", "|25|"));
    expect(b.ok).toBe(false);
  });

  it("und kennt beide Verträge mit ihrer Zeile und Feldzahl", () => {
    expect(VERTRAEGE["skyisles.base"]).toEqual(
      { marke: "skyisles-base-1", felder: 9, zeile: 900 });
    expect(VERTRAEGE["skyisles.coll"]).toEqual(
      { marke: "skyisles-coll-1", felder: 5, zeile: 901 });
  });
});


describe("das Einsammeln aus dem Preflight", () => {
  /** Ein Preflight-Befund, wie `fahreEintrag` ihn zurückgibt. */
  const befund = (zeilen: { nr: number; befund: string }[]) => ({
    datei: "0146_preflight.sql", zweck: "Preflight", status: "ok" as const,
    abweichungen: "0", offen: "0", zeilen: zeilen as never[], auffaellig: [],
    dauerMs: 1, sha256: "a".repeat(64),
  });
  const LIEFERT = { "skyisles.base": 900, "skyisles.coll": 901 } as const;

  it("nimmt Zeile 900 und 901 und ordnet sie dem Vertrag zu", () => {
    const r = sammleBaselines(
      befund([{ nr: 1, befund: "626" }, { nr: 900, befund: BASE }, { nr: 901, befund: COLL }]),
      LIEFERT);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.vertraege["skyisles.base"]).toBe(BASE);
      expect(r.vertraege["skyisles.coll"]).toBe(COLL);
    }
  });

  it("übernimmt sie UNVERÄNDERT — Zeichen für Zeichen", () => {
    /*
     * Die wichtigste Zusage. Eine gekürzte, getrimmte oder neu
     * zusammengesetzte Baseline wäre eine andere Baseline, und der Vergleich
     * verglich dann etwas anderes als gemessen wurde.
     */
    const r = sammleBaselines(befund([{ nr: 900, befund: BASE }, { nr: 901, befund: COLL }]),
                              LIEFERT);
    if (!r.ok) throw new Error(r.grund);
    expect(r.vertraege["skyisles.base"]).toHaveLength(BASE.length);
    expect(r.vertraege["skyisles.base"].split("|")).toHaveLength(9);
  });

  it("bricht ab, wenn eine Zeile fehlt", () => {
    const r = sammleBaselines(befund([{ nr: 900, befund: BASE }]), LIEFERT);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.grund).toContain("901");
  });

  it("bricht ab, wenn eine Zeile beschädigt ist", () => {
    const r = sammleBaselines(
      befund([{ nr: 900, befund: BASE.replace("|256|", "|999|") }, { nr: 901, befund: COLL }]),
      LIEFERT);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.grund).toContain("Schutzsumme");
  });

  it("bricht ab, wenn in Zeile 900 die Sammlungszeile steht", () => {
    /* Zugeordnet wird über die MARKE, nicht über die Reihenfolge. Zwei
       vertauschte Zeilen sind damit ein Abbruch und keine stille
       Verwechslung. */
    const r = sammleBaselines(
      befund([{ nr: 900, befund: COLL }, { nr: 901, befund: BASE }]), LIEFERT);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.grund).toContain("Marke");
  });

  it("und ein stehengelassener Platzhalter ist ein Abbruch", () => {
    const r = sammleBaselines(
      befund([{ nr: 900, befund: "BASIS-HIER-EINSETZEN" }, { nr: 901, befund: COLL }]),
      LIEFERT);
    expect(r.ok).toBe(false);
  });
});


describe("die Akte", () => {
  it("wird bei jedem Lesen nachgerechnet, nicht geglaubt", () => {
    /*
     * Dass eine Datei auf der Platte liegt, heisst nicht, dass ihr Inhalt
     * heil ist. Eine Akte, der man blind glaubt, ist keine Akte.
     */
    const d = tmp();
    writeFileSync(join(d, "baseline-9999.json"), JSON.stringify({
      migration: "9999", erhoben: "x", herkunft: "preflight", preflightSha256: null,
      vertraege: { "skyisles.base": BASE.replace("|626|", "|627|") },
    }), "utf8");
    const r = ladeAkte(join(d, "baseline-9999.json"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.grund).toContain("Schutzsumme");
  });

  it("weist eine Zeile ab, die unter dem falschen Namen steht", () => {
    const d = tmp();
    writeFileSync(join(d, "a.json"), JSON.stringify({
      migration: "9999", erhoben: "x", herkunft: "preflight", preflightSha256: null,
      vertraege: { "skyisles.base": COLL },
    }), "utf8");
    const r = ladeAkte(join(d, "a.json"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.grund).toContain("skyisles.coll");
  });

  it("weist eine fehlende und eine unlesbare Datei ab", () => {
    const d = tmp();
    expect(ladeAkte(join(d, "gibt-es-nicht.json")).ok).toBe(false);
    writeFileSync(join(d, "kaputt.json"), "{ das ist kein JSON", "utf8");
    const r = ladeAkte(join(d, "kaputt.json"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.grund).toContain("JSON");
  });

  it("die echte Akte von 0146 ist heil und trägt ihre Herkunft", () => {
    const r = ladeAkte(aktePfad("0146"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.akte.vertraege["skyisles.base"]).toBe(BASE);
    expect(r.akte.vertraege["skyisles.coll"]).toBe(COLL);
    /* NACHGETRAGEN, und das steht darin — nicht vom Runner erhoben. */
    expect(r.akte.herkunft).toBe("bediener");
    expect(r.akte.bemerkung).toContain("NACHGETRAGEN");
    expect(r.akte.bemerkung).toContain("NICHT nach der Migration erhoben");
  });

  it("liegt in einem VERSIONIERTEN Verzeichnis, das Protokoll nicht", () => {
    /*
     * Ein Wiederaufnahmelauf muss die Akte auch nach einem frischen Clone
     * finden. Die Laufprotokolle dagegen sind Ausgabe und bleiben draußen.
     *
     * Gefragt werden die WIRKSAMEN Zeilen der `.gitignore`. Die Datei
     * erklaert die Baselines in einem Kommentar, und ein Kommentar schliesst
     * nichts aus — ihn mitzulesen hiesse, die Erklaerung mit der Regel zu
     * verwechseln.
     */
    expect(aktePfad("0146")).toBe("supabase/baselines/baseline-0146.json");
    const regeln = readFileSync(".gitignore", "utf8")
      .split("\n")
      .map((z) => z.trim())
      .filter((z) => z !== "" && !z.startsWith("#"));
    expect(regeln).toContain("supabase/log/");
    expect(regeln.some((z) => z.includes("baselines"))).toBe(false);
  });
});


describe("die Pläne sind Daten, nicht Sonderlogik", () => {
  const plaene = ladePlaene();

  it("0146 ist eingetragen, mit allen fünf Angaben", () => {
    const p = plaene["0146"];
    expect(p).toBeDefined();
    expect(p.preflight).toBe("0146_preflight.sql");
    expect(p.lauf).toBe("staging-0146.sql");
    expect(p.postflight).toBe("0146_postflight.sql");
    expect(p.liefert).toEqual({ "skyisles.base": 900, "skyisles.coll": 901 });
    expect(p.braucht).toEqual(["skyisles.base", "skyisles.coll"]);
  });

  it("jeder Plan nennt eine LESENDE Standsabfrage mit einer Spalte `erfuellt`", () => {
    for (const [nummer, p] of Object.entries(plaene)) {
      expect(p.angewendet.sql, nummer).toContain("as erfuellt");
      /* Lesend: kein Schreibwort darin. */
      for (const wort of ["insert", "update", "delete", "drop", "alter", "create"]) {
        expect(p.angewendet.sql.toLowerCase(), `${nummer}: ${wort}`).not.toContain(wort);
      }
    }
  });

  it("und jede genannte Datei existiert wirklich", () => {
    for (const [nummer, p] of Object.entries(plaene)) {
      for (const [art, pfad] of [
        ["preflight", `supabase/checks/${p.preflight}`],
        ["postflight", `supabase/checks/${p.postflight}`],
        ["lauf", `supabase/operations/${p.lauf}`],
      ] as const) {
        expect(() => readFileSync(pfad, "utf8"), `${nummer} ${art}`).not.toThrow();
      }
    }
  });

  it("eine neue Migration braucht einen Eintrag und keinen neuen Code", () => {
    /*
     * Der Runner liest die Plandatei; sein CODE kennt keine
     * Migrationsnummer. Im Kopfkommentar stehen `0145` und `0146` sehr wohl —
     * als Nutzungsbeispiel und als die Geschichte der achtzehn Abweichungen.
     * Das ist Prosa und darf dort stehen; gefragt ist der Code.
     */
    const code = ohneKommentare(readFileSync("tools/db-migrate-staging.mts", "utf8"));
    expect(code).not.toContain("0146");
    expect(code).not.toContain("0145");
    expect(code).toContain("migration-plans.json");
  });
});


describe("die Sicherheitsriegel des Runners", () => {
  const runner = readFileSync("tools/db-migrate-staging.mts", "utf8");
  /** Die Datei ohne Kommentare — fragt, was sie tut. */
  const code = ohneKommentare(runner);

  it("er kann NICHT schreiben, und er baut sich keinen Weg dazu", () => {
    /*
     * Der lesende Prüfzugang ist an der ROLLE auf
     * `default_transaction_read_only` gesetzt. Dass der Runner das nicht
     * umgeht, ist die zentrale Zusage: er führt keine Migration aus, kein
     * DDL, kein `insert`.
     */
    for (const wort of ["SERVICE_ROLE", "serviceClient", "exec_sql",
                        "create table", "alter table", "drop table",
                        "insert into", "set transaction read write"]) {
      expect(code, wort).not.toContain(wort);
    }
  });

  it("die Umgebungsprüfung ist die vorhandene — keine zweite Wahrheit", () => {
    expect(code).toContain("verbindeStaging()");
    expect(code).toContain("staging-db.mts");
    /* Keine eigene Projektprüfung daneben. */
    expect(code).not.toContain("qqxcpesbwfxzgytkdsac");
    expect(code).not.toContain("zmiwxswrpkmizvqsgype");
  });

  it("das Zugangsdatum liegt außerhalb des Repositorys", () => {
    expect(code).toContain(".skyisles/staging-db.env");
  });

  it("es gibt keinen Production-Pfad", () => {
    for (const wort of [".env.local", "prod-", "PRODUCTION"]) {
      expect(code, wort).not.toContain(wort);
    }
  });

  it("eine bereits angewendete Migration wird NICHT erneut gefahren", () => {
    expect(code).toContain("liegtSchon && !resume");
    expect(runner).toContain("Sie wird NICHT erneut angewendet");
  });

  it("ein unklarer Stand ist ein Abbruch, keine Vermutung", () => {
    expect(code).toContain('!("erfuellt" in antwort[0])');
    expect(runner).toContain("nicht zweifelsfrei feststellbar");
  });

  it("ein fehlgeschlagener Preflight verhindert die Migration", () => {
    const stelle = code.indexOf('if (b.status !== "ok")');
    expect(stelle).toBeGreaterThan(-1);
    expect(runner).toContain("Die Migration wird nicht angewendet");
  });

  it("ein fehlgeschlagener Postflight führt NICHT zu einem zweiten Lauf", () => {
    expect(runner).toContain("wird deshalb NICHT erneut angewendet");
    /* Und der Runner kann sie ohnehin nicht fahren. */
    expect(code).not.toContain("fahreMigration");
  });

  it("der Wiederaufnahmezweig LIEST die Baselines und sammelt sie nicht", () => {
    /*
     * Die Reihenfolge ist die Sicherheit: eine nach der Migration erhobene
     * Baseline ist der aktuelle Stand, und dann vergleichen sich die Daten
     * mit sich selbst. Der Ablauf selbst ist oben durchlaufen worden; hier
     * wird die Quelle gefragt, weil ein kuenftiger Umbau diesen Zweig
     * verschieben koennte.
     *
     * Der Marker wird ERST NACHGEWIESEN. `indexOf` liefert -1, wenn er
     * fehlt, und `slice(-1)` ist dann das letzte Zeichen der Datei — eine
     * Behauptung, die stillschweigend wahr waere. Genau diesen Leerlauf
     * hatte die erste Fassung dieses Tests.
     */
    const marker = "NACHKONTROLLE (Wiederaufnahme)";
    const stelle = ohneKommentare(runner.replace(`/* ---- ${marker}`, marker))
      .indexOf("const gelesen = ladeAkte(akte)");
    expect(stelle, "der Wiederaufnahmezweig ist nicht auffindbar")
      .toBeGreaterThan(-1);
    expect(runner).toContain(marker);

    const zweig = ohneKommentare(runner).slice(stelle);
    expect(zweig).toContain("ladeAkte(akte)");
    expect(zweig).not.toContain("sammleBaselines");
    /* Und das Einfrieren steht VOR diesem Zweig, nicht darin. */
    expect(ohneKommentare(runner).slice(0, stelle)).toContain("writeFileSync(akte");
  });

  it("eine vorhandene Akte wird nicht überschrieben", () => {
    expect(code).toContain("if (existsSync(akte))");
    expect(runner).toContain("wird NICHT ueberschrieben");
  });

  it("eine fehlende Akte im Wiederaufnahmemodus ist ein Abbruch", () => {
    expect(runner).toContain("Sie werden NICHT neu erhoben");
  });

  it("und es gibt keinen automatischen Rollback", () => {
    expect(code).not.toContain("R0146");
    expect(code).not.toContain("rollback/");
  });
});


/* ==========================================================================
 * DER ABLAUF
 * ==========================================================================
 *
 * Die Zusagen dieses Runners sind Zusagen ueber eine REIHENFOLGE, und eine
 * Reihenfolge prueft man, indem man sie durchlaeuft. Die Verbindung und die
 * Pruefdateien sind eingesetzt; die Akte wird WIRKLICH in ein temporaeres
 * Verzeichnis geschrieben und wirklich zurueckgelesen, denn sie ist der Kern
 * der Zusage.
 */

/** Ein Plan, wie `migration-plans.json` ihn liefert. */
const PLAN: Plan = {
  zweck: "Testmigration",
  preflight: "x_preflight.sql",
  lauf: "staging-x.sql",
  postflight: "0146_postflight.sql",
  angewendet: { beschreibung: "Tabelle x vorhanden", sql: "select false as erfuellt" },
  liefert: { "skyisles.base": 900, "skyisles.coll": 901 },
  braucht: ["skyisles.base", "skyisles.coll"],
};

/** Ein Befund, wie `fahreEintrag` ihn liefert. */
const preflightBefund = (status: "ok" | "abweichung", zeilen = [
  { nr: 900, befund: BASE }, { nr: 901, befund: COLL },
]) => ({
  datei: "x_preflight.sql", zweck: "Preflight", status,
  abweichungen: status === "ok" ? "0" : "18", offen: "0",
  zeilen: zeilen as never[],
  auffaellig: [], dauerMs: 1, sha256: "b".repeat(64),
});

type Lauf = {
  /** Was tatsaechlich gefahren wurde, in der Reihenfolge. */
  gefahren: { datei: string; vertraege: Record<string, string> }[];
  /** Jedes an die Datenbank gegebene SQL. */
  sql: string[];
  w: Werkzeuge;
};

/**
 * Werkzeuge fuer einen Lauf.
 *
 * `liegtSchon` steuert die Standsabfrage, `befunde` die Antwort je
 * Pruefdatei. Alles wird mitgeschrieben, damit ein Test fragen kann, WAS
 * gefahren wurde — nicht nur, was herauskam.
 */
const werkzeuge = (o: {
  akteDir: string;
  liegtSchon?: boolean | "unklar" | "leer" | "zwei";
  preflight?: ReturnType<typeof preflightBefund>;
  postflight?: "ok" | "abweichung";
  /** Zeilennummern, die die Pruefdatei als `KEIN-RECHT` zurueckgibt. */
  offen?: number[];
  checkDir?: string;
  bruch?: "stand" | "preflight" | "postflight";
  plan?: Plan;
}): Lauf => {
  const gefahren: Lauf["gefahren"] = [];
  const sql: string[] = [];
  const stand = o.liegtSchon ?? false;
  const w: Werkzeuge = {
    db: {
      fuehre: async (s2) => {
        sql.push(s2);
        if (o.bruch === "stand") throw new Error("Connection terminated unexpectedly");
        if (stand === "unklar") return [[{ etwas_anderes: true }]];
        if (stand === "leer") return [[]];
        if (stand === "zwei") return [[{ erfuellt: true }, { erfuellt: false }]];
        return [[{ erfuellt: stand }]];
      },
    },
    fahre: async (eintrag, vertraege) => {
      gefahren.push({ datei: eintrag.datei, vertraege: Object.fromEntries(vertraege) });
      if (eintrag.datei.includes("preflight") && !eintrag.datei.includes("post")) {
        if (o.bruch === "preflight") throw new Error("terminated");
        return o.preflight ?? preflightBefund("ok");
      }
      if (o.bruch === "postflight") throw new Error("Connection terminated unexpectedly");
      const status = o.postflight ?? "ok";
      /* `offen`: Zeilen mit `KEIN-RECHT`, wie die Pruefdatei sie liefert. */
      const offeneZ = (o.offen ?? []).map((nummer) => ({
        nr: nummer, pruefung: `Zeile ${nummer}`, befund: "KEIN-RECHT",
      }));
      return {
        datei: eintrag.datei, zweck: "Nachkontrolle", status,
        abweichungen: status === "ok" ? "0" : "18",
        offen: String(offeneZ.length),
        zeilen: offeneZ as never[],
        auffaellig: [], dauerMs: 1, sha256: "c".repeat(64),
      };
    },
    plaene: { "0199": o.plan ?? PLAN },
    akteDir: o.akteDir,
    /* Die echten Pruefdateien — die Huelle soll die wirkliche einbetten. */
    checkDir: o.checkDir ?? "supabase/checks",
    logDir: o.akteDir,
    jetzt: () => new Date("2026-10-25T10:00:00.000Z"),
    melde: () => {},
  };
  return { gefahren, sql, w };
};

const grund = (a: Ablauf): string => (a.ende === "abbruch" ? a.grund : `kein Abbruch: ${a.ende}`);


describe("der erfolgreiche vollstaendige Ablauf", () => {
  it("Preflight, Baselines eingefroren, dann die eine Handarbeit", async () => {
    const d = tmp();
    const l = werkzeuge({ akteDir: d });
    const a = await fahreAblauf(l.w, "0199", false);

    expect(a.ende).toBe("handarbeit");
    if (a.ende !== "handarbeit") return;
    expect(a.neu).toBe(true);
    expect(l.gefahren.map((g) => g.datei)).toEqual(["x_preflight.sql"]);
    /* Die Akte liegt da, mit beiden Zeilen und der Herkunft `preflight`. */
    const akte = ladeAkte(join(d, "baseline-0199.json"));
    expect(akte.ok).toBe(true);
    if (!akte.ok) return;
    expect(akte.akte.vertraege).toEqual({ "skyisles.base": BASE, "skyisles.coll": COLL });
    expect(akte.akte.herkunft).toBe("preflight");
    expect(akte.akte.preflightSha256).toBe("b".repeat(64));
  });

  it("und die Wiederaufnahme danach ist gruen", async () => {
    const d = tmp();
    await fahreAblauf(werkzeuge({ akteDir: d }).w, "0199", false);
    /* Jetzt liegt sie — wie nach dem Einfuegen im SQL-Editor. */
    const l = werkzeuge({ akteDir: d, liegtSchon: true });
    const a = await fahreAblauf(l.w, "0199", true);

    expect(a.ende).toBe("bestanden");
    expect(l.gefahren.map((g) => g.datei)).toEqual(["0146_postflight.sql"]);
  });

  it("die Nachkontrolle bekommt die Baselines in DERSELBEN Einreichung", async () => {
    /*
     * Das ist die behobene Ursache. Fruether trug die Hülle Platzhalter, und
     * ein Mensch musste sie ersetzen; zweimal hat er es nicht, und zweimal
     * meldete die Nachkontrolle achtzehn Abweichungen. Jetzt reicht der
     * Runner die Zeilen selbst mit.
     */
    const d = tmp();
    await fahreAblauf(werkzeuge({ akteDir: d }).w, "0199", false);
    const l = werkzeuge({ akteDir: d, liegtSchon: true });
    await fahreAblauf(l.w, "0199", true);

    expect(l.gefahren[0].vertraege).toEqual({
      "skyisles.base": BASE, "skyisles.coll": COLL });
    /* Kein Platzhalter mehr im Spiel. */
    for (const p of PLATZHALTER) {
      expect(JSON.stringify(l.gefahren[0].vertraege)).not.toContain(p);
    }
  });

  it("der Preflight bekommt KEINE Baselines — er misst sie ja erst", async () => {
    const l = werkzeuge({ akteDir: tmp() });
    await fahreAblauf(l.w, "0199", false);
    expect(l.gefahren[0].vertraege).toEqual({});
  });
});


describe("ein fehlgeschlagener Preflight", () => {
  it("verhindert die Migration und friert NICHTS ein", async () => {
    const d = tmp();
    const l = werkzeuge({ akteDir: d, preflight: preflightBefund("abweichung") });
    const a = await fahreAblauf(l.w, "0199", false);

    expect(a.ende).toBe("abbruch");
    if (a.ende !== "abbruch") return;
    expect(a.stufe).toBe("preflight");
    expect(a.grund).toContain("wird nicht angewendet");
    /* Keine Akte. Ein roter Preflight hat keine gueltige Baseline gemessen. */
    expect(existsSync(join(d, "baseline-0199.json"))).toBe(false);
    /* Aber der Befund bleibt, damit das Protokoll ihn zeigt. */
    expect(a.befunde).toHaveLength(1);
  });
});


describe("eine fehlgeschlagene Nachkontrolle", () => {
  it("fuehrt NICHT zu einem zweiten Lauf der Migration", async () => {
    const d = tmp();
    await fahreAblauf(werkzeuge({ akteDir: d }).w, "0199", false);
    const l = werkzeuge({ akteDir: d, liegtSchon: true, postflight: "abweichung" });
    const a = await fahreAblauf(l.w, "0199", true);

    expect(a.ende).toBe("abbruch");
    if (a.ende !== "abbruch") return;
    expect(a.stufe).toBe("nachkontrolle");
    expect(a.grund).toContain("NICHT erneut angewendet");
    /* Gefahren wurde genau die Nachkontrolle, einmal. */
    expect(l.gefahren.map((g) => g.datei)).toEqual(["0146_postflight.sql"]);
  });

  it("und ruehrt die eingefrorene Akte nicht an", async () => {
    /*
     * Der verfuehrerische Fehler: nach einer roten Nachkontrolle die
     * Baselines „aktualisieren", damit es gruen wird. Das waere der
     * Vergleich der Daten mit sich selbst.
     */
    const d = tmp();
    await fahreAblauf(werkzeuge({ akteDir: d }).w, "0199", false);
    const vorher = readFileSync(join(d, "baseline-0199.json"), "utf8");
    await fahreAblauf(
      werkzeuge({ akteDir: d, liegtSchon: true, postflight: "abweichung" }).w, "0199", true);
    expect(readFileSync(join(d, "baseline-0199.json"), "utf8")).toBe(vorher);
  });
});


describe("fehlende oder ungueltige Baseline", () => {
  it("Wiederaufnahme ohne Akte bricht ab und erhebt sie NICHT neu", async () => {
    const d = tmp();
    const l = werkzeuge({ akteDir: d, liegtSchon: true });
    const a = await fahreAblauf(l.w, "0199", true);

    expect(a.ende).toBe("abbruch");
    if (a.ende !== "abbruch") return;
    expect(a.stufe).toBe("akte");
    expect(a.grund).toContain("NICHT neu erhoben");
    /* Nichts gefahren — keine Nachkontrolle mit erfundenen Sollwerten. */
    expect(l.gefahren).toEqual([]);
  });

  it("eine beschaedigte Akte bricht ab, statt sie zu reparieren", async () => {
    const d = tmp();
    writeFileSync(join(d, "baseline-0199.json"), JSON.stringify({
      migration: "0199", erhoben: "x", herkunft: "preflight", preflightSha256: null,
      vertraege: { "skyisles.base": BASE.replace("|534|534|", "|534|535|") },
    }), "utf8");
    const l = werkzeuge({ akteDir: d, liegtSchon: true });
    const a = await fahreAblauf(l.w, "0199", true);

    expect(a.ende).toBe("abbruch");
    expect(grund(a)).toContain("Schutzsumme");
    expect(l.gefahren).toEqual([]);
  });

  it("eine Akte ohne den gebrauchten Vertrag bricht ab", async () => {
    const d = tmp();
    writeFileSync(join(d, "baseline-0199.json"), JSON.stringify({
      migration: "0199", erhoben: "x", herkunft: "preflight", preflightSha256: null,
      vertraege: { "skyisles.base": BASE },
    }), "utf8");
    const a = await fahreAblauf(werkzeuge({ akteDir: d, liegtSchon: true }).w, "0199", true);
    expect(grund(a)).toContain("skyisles.coll");
  });

  it("ein Preflight ohne Zeile 901 friert nichts ein", async () => {
    const d = tmp();
    const l = werkzeuge({
      akteDir: d,
      preflight: preflightBefund("ok", [{ nr: 900, befund: BASE }]),
    });
    const a = await fahreAblauf(l.w, "0199", false);
    expect(a.ende).toBe("abbruch");
    if (a.ende !== "abbruch") return;
    expect(a.stufe).toBe("baselines");
    expect(existsSync(join(d, "baseline-0199.json"))).toBe(false);
  });
});


describe("die bereits angewendete Migration", () => {
  it("wird ohne --resume abgewiesen, mit dem richtigen naechsten Befehl", async () => {
    const l = werkzeuge({ akteDir: tmp(), liegtSchon: true });
    const a = await fahreAblauf(l.w, "0199", false);

    expect(a.ende).toBe("abbruch");
    if (a.ende !== "abbruch") return;
    expect(a.stufe).toBe("liegt-schon");
    expect(a.grund).toContain("NICHT erneut angewendet");
    expect(a.grund).toContain("--resume");
    /* Kein Preflight. Er wuerde den Stand VOR der Migration behaupten, den
       es nicht mehr gibt. */
    expect(l.gefahren).toEqual([]);
  });

  it("und --resume auf eine NICHT angewendete Migration bricht auch ab", async () => {
    const l = werkzeuge({ akteDir: tmp(), liegtSchon: false });
    const a = await fahreAblauf(l.w, "0199", true);
    expect(grund(a)).toContain("liegt noch nicht");
    expect(l.gefahren).toEqual([]);
  });
});


describe("ein unklarer Stand ist ein Abbruch", () => {
  for (const [was, stand] of [
    ["keine Spalte `erfuellt`", "unklar"], ["keine Zeile", "leer"], ["zwei Zeilen", "zwei"],
  ] as const) {
    it(`${was} → Abbruch, nichts gefahren`, async () => {
      const l = werkzeuge({ akteDir: tmp(), liegtSchon: stand });
      const a = await fahreAblauf(l.w, "0199", false);
      expect(a.ende).toBe("abbruch");
      if (a.ende !== "abbruch") return;
      expect(a.stufe).toBe("stand");
      expect(a.grund).toContain("nicht zweifelsfrei");
      expect(l.gefahren).toEqual([]);
    });
  }

  it("eine unbekannte Migrationsnummer fragt die Datenbank gar nicht erst", async () => {
    const l = werkzeuge({ akteDir: tmp() });
    const a = await fahreAblauf(l.w, "0777", false);
    expect(grund(a)).toContain("keinen Plan");
    expect(l.sql).toEqual([]);
  });
});


describe("ein Verbindungsabbruch", () => {
  for (const [wann, bruch] of [
    ["bei der Standsabfrage", "stand"], ["im Preflight", "preflight"],
    ["in der Nachkontrolle", "postflight"],
  ] as const) {
    it(`${wann} → sicherer Abbruch, keine Migration`, async () => {
      const d = tmp();
      if (bruch === "postflight") await fahreAblauf(werkzeuge({ akteDir: d }).w, "0199", false);
      const l = werkzeuge({
        akteDir: d, bruch, liegtSchon: bruch === "postflight",
      });
      const a = await fahreAblauf(l.w, "0199", bruch === "postflight");

      expect(a.ende).toBe("abbruch");
      if (a.ende !== "abbruch") return;
      expect(a.stufe).toBe("verbindung");
      expect(a.grund).toContain("Nichts wurde geschrieben");
    });
  }

  it("und die Meldung ist redigiert — kein Kennwort in der Ausgabe", async () => {
    /*
     * Eine Verbindungsmeldung von `pg` enthaelt gern die ganze
     * Zeichenkette, und darin steht das Kennwort. Der Wert unten ist
     * ERFUNDEN — kein Geheimnis, nur die Form eines Geheimnisses, damit
     * `redigiere()` etwas zu greifen hat.
     */
    const ERFUNDEN = "nicht-echt-nur-die-form";
    const l = werkzeuge({ akteDir: tmp() });
    l.w.db.fuehre = async () => {
      throw new Error(`could not connect: postgresql://postgres:${ERFUNDEN}@db.host:5432/x`);
    };
    const a = await fahreAblauf(l.w, "0199", false);
    expect(grund(a)).not.toContain(ERFUNDEN);
    expect(grund(a)).toContain("***");
  });

  it("ein Abbruch kann keine halbe Migration hinterlassen", async () => {
    /*
     * Nicht weil aufgeraeumt wird, sondern weil es nichts aufzuraeumen gibt:
     * der Runner hat keinen schreibenden Zugang. Das einzige, was er
     * hinterlaesst, ist die Akte — nach bestandenem Preflight, danach nie
     * geaendert.
     */
    const d = tmp();
    const l = werkzeuge({ akteDir: d, bruch: "preflight" });
    await fahreAblauf(l.w, "0199", false);
    expect(existsSync(join(d, "baseline-0199.json"))).toBe(false);
  });
});


describe("die unveraenderte Uebernahme", () => {
  it("die Nachkontrolle bekommt genau die eingefrorenen Zeichen", async () => {
    const d = tmp();
    await fahreAblauf(werkzeuge({ akteDir: d }).w, "0199", false);
    const l = werkzeuge({ akteDir: d, liegtSchon: true });
    await fahreAblauf(l.w, "0199", true);
    const uebergeben = l.gefahren[0].vertraege;
    const eingefroren = JSON.parse(readFileSync(join(d, "baseline-0199.json"), "utf8"));
    expect(uebergeben).toEqual(eingefroren.vertraege);
  });

  it("KEINE stille Ersetzung durch aktuelle Daten", async () => {
    /*
     * DIE ZENTRALE ZUSAGE. Die Welt hat sich zwischen Preflight und
     * Nachkontrolle veraendert — der Preflight wuerde heute andere Zahlen
     * messen. Die Nachkontrolle muss trotzdem gegen die ALTEN vergleichen,
     * sonst prueft sie nichts.
     */
    const d = tmp();
    await fahreAblauf(werkzeuge({ akteDir: d }).w, "0199", false);

    const ANDERS = andereBasis("999");
    const l = werkzeuge({
      akteDir: d, liegtSchon: true,
      preflight: preflightBefund("ok", [{ nr: 900, befund: ANDERS }]),
    });
    await fahreAblauf(l.w, "0199", true);

    expect(l.gefahren[0].vertraege["skyisles.base"]).toBe(BASE);
    expect(l.gefahren[0].vertraege["skyisles.base"]).not.toContain("|999|");
  });

  it("ein zweiter Lauf ohne --resume ueberschreibt die Akte nicht", async () => {
    /* Etwa wenn jemand den Befehl vor dem Einfuegen nochmal startet: der
       Preflight laeuft, aber was er misst, ersetzt die Akte nicht. */
    const d = tmp();
    await fahreAblauf(werkzeuge({ akteDir: d }).w, "0199", false);
    const vorher = readFileSync(join(d, "baseline-0199.json"), "utf8");

    const ANDERS = andereBasis("777");
    const l = werkzeuge({
      akteDir: d, preflight: preflightBefund("ok", [
        { nr: 900, befund: ANDERS }, { nr: 901, befund: COLL }]),
    });
    const a = await fahreAblauf(l.w, "0199", false);

    expect(a.ende).toBe("handarbeit");
    if (a.ende !== "handarbeit") return;
    expect(a.neu).toBe(false);
    expect(readFileSync(join(d, "baseline-0199.json"), "utf8")).toBe(vorher);
    expect(a.vertraege.get("skyisles.base")).toBe(BASE);
  });
});


describe("keine Aenderung an Shop-, Lager- oder Sammlungsdaten", () => {
  it("der Runner gibt der Datenbank NUR die lesende Standsabfrage", async () => {
    /*
     * Alles andere laeuft ueber `fahreEintrag`, also ueber die vorhandenen
     * Pruefdateien. Der Runner selbst formuliert genau eine Anweisung — und
     * die liest.
     */
    const l = werkzeuge({ akteDir: tmp() });
    await fahreAblauf(l.w, "0199", false);
    expect(l.sql).toEqual([PLAN.angewendet.sql]);
    expect(l.sql[0].toLowerCase()).not.toMatch(/insert|update|delete|drop|alter|create/);
  });

  it("und bei jedem Abbruch bleibt es dabei", async () => {
    for (const o of [
      { preflight: preflightBefund("abweichung") },
      { liegtSchon: true as const },
      { liegtSchon: "unklar" as const },
    ]) {
      const l = werkzeuge({ akteDir: tmp(), ...o });
      await fahreAblauf(l.w, "0199", false);
      expect(l.sql.length).toBeLessThanOrEqual(1);
    }
  });
});


/* ==========================================================================
 * RECHTE: WAS DER PRUEFZUGANG NICHT LESEN DARF
 * ==========================================================================
 *
 * DER ANLASS. `--resume` fuer `0146` scheiterte mit `permission denied for
 * view offer_state_live`. Richtig so: `0146` erteilt auf `offer_state` und
 * `offer_state_live` bewusst KEIN Clientrecht, und der lesende Pruefzugang
 * hat `select` auf genau zwoelf Tabellen — diese zwei nicht.
 *
 * Falsch war nur die FOLGE: PostgreSQL prueft die Rechte aller Relationen
 * eines Plans beim Ausfuehrungsstart, also nahm EIN fehlendes Recht die
 * ganze Einreichung mit — rund hundert gute Katalogpruefungen inbegriffen.
 *
 * Gemessen: 32 von 74 Pruefdateien lesen Objekte, auf die der Zugang kein
 * `select` hat. Das ist keine Eigenheit von `0146`, sondern die Regel.
 */

describe("offene Zeilen sind weder bestanden noch abgewichen", () => {
  it("der Lauf heisst nicht BESTANDEN, wenn Zeilen offen sind", async () => {
    const d = tmp();
    await fahreAblauf(werkzeuge({ akteDir: d }).w, "0199", false);
    const l = werkzeuge({ akteDir: d, liegtSchon: true, offen: [124, 161] });
    const a = await fahreAblauf(l.w, "0199", true);

    expect(a.ende).toBe("bestanden");
    if (a.ende !== "bestanden") return;
    /* 9999 = 0 heisst: keine Abweichung UNTER DEN DURCHGEFUEHRTEN. */
    expect(a.offen.map((o) => o.nr)).toEqual([124, 161]);
  });

  it("und ohne offene Zeilen ist er vollstaendig", async () => {
    const d = tmp();
    await fahreAblauf(werkzeuge({ akteDir: d }).w, "0199", false);
    const a = await fahreAblauf(werkzeuge({ akteDir: d, liegtSchon: true }).w, "0199", true);
    expect(a.ende).toBe("bestanden");
    if (a.ende !== "bestanden") return;
    expect(a.offen).toEqual([]);
    expect(a.huelle).toBeNull();
  });

  it("die Huelle fuer den berechtigten Weg hat die Baselines SCHON drin", async () => {
    /*
     * Dieselbe Lehre wie bei den achtzehn Abweichungen: ein Handgriff, den
     * ein Werkzeug tun kann, gehoert nicht auf den Laufzettel. Der Runner
     * hat die eingefrorenen Zeilen — also setzt er sie ein.
     */
    const d = tmp();
    await fahreAblauf(werkzeuge({ akteDir: d }).w, "0199", false);
    const l = werkzeuge({ akteDir: d, liegtSchon: true, offen: [161] });
    const a = await fahreAblauf(l.w, "0199", true);

    expect(a.ende).toBe("bestanden");
    if (a.ende !== "bestanden" || a.huelle === null) throw new Error("keine Huelle");
    const text = readFileSync(a.huelle, "utf8");
    expect(text).toContain(`set_config('skyisles.base', '${BASE}', true)`);
    expect(text).toContain(`set_config('skyisles.coll', '${COLL}', true)`);
    /*
     * Gefragt werden die `set_config`-ZEILEN, nicht die ganze Datei. Die
     * Pruefdatei nennt die Platzhalter selbst — als Werte, die sie
     * zurueckweist. Sie dort zu verbieten hiesse, den Riegel mit dem
     * Versaeumnis zu verwechseln.
     */
    const uebergabe = text.split("\n").filter((z) => z.startsWith("select set_config("));
    expect(uebergabe).toHaveLength(2);
    for (const pl of PLATZHALTER) {
      expect(uebergabe.join("\n"), pl).not.toContain(pl);
    }
    /* Lesend durch Bauart: begin … rollback, kein commit. */
    const zeilen = text.split("\n").map((z) => z.trim());
    expect(zeilen.filter((z) => z === "begin;")).toHaveLength(1);
    expect(zeilen.filter((z) => z === "rollback;")).toHaveLength(1);
    expect(zeilen.filter((z) => z === "commit;")).toHaveLength(0);
    /* Und sie bettet die Pruefdatei Zeichen fuer Zeichen ein. */
    expect(text).toContain(readFileSync("supabase/checks/0146_postflight.sql", "utf8").trimEnd());
  });

  it("sie liegt in der ungetrackten Laufausgabe, nicht im Quelltext", async () => {
    const d = tmp();
    await fahreAblauf(werkzeuge({ akteDir: d }).w, "0199", false);
    const a = await fahreAblauf(
      werkzeuge({ akteDir: d, liegtSchon: true, offen: [161] }).w, "0199", true);
    if (a.ende !== "bestanden" || a.huelle === null) throw new Error("keine Huelle");
    /* In der Anwendung ist es `supabase/log/staging` (ungetrackt); hier
         zeigt `logDir` in das Wegwerfverzeichnis des Tests. */
      expect(a.huelle.endsWith("0199-postflight-berechtigt.sql")).toBe(true);
    const regeln = readFileSync(".gitignore", "utf8").split("\n")
      .map((z) => z.trim()).filter((z) => z !== "" && !z.startsWith("#"));
    expect(regeln).toContain("supabase/log/");
  });

  it("eine Abweichung bleibt eine Abweichung, auch mit offenen Zeilen", async () => {
    /* Offen entschuldigt nichts. */
    const d = tmp();
    await fahreAblauf(werkzeuge({ akteDir: d }).w, "0199", false);
    const a = await fahreAblauf(werkzeuge({
      akteDir: d, liegtSchon: true, postflight: "abweichung", offen: [161],
    }).w, "0199", true);
    expect(a.ende).toBe("abbruch");
    if (a.ende !== "abbruch") return;
    expect(a.stufe).toBe("nachkontrolle");
  });
});


describe("die Pruefdatei von 0146 traegt das Rechtevorzeichen", () => {
  const datei = readFileSync("supabase/checks/0146_postflight.sql", "utf8");

  it("die beiden Datenzeilen stehen hinter has_table_privilege", () => {
    for (const objekt of ["offer_state", "offer_state_live"]) {
      expect(datei).toContain(`has_table_privilege('public.${objekt}', 'select')`);
    }
    /* Und keine davon liest mehr unmittelbar. */
    expect(datei).not.toMatch(/\(select count\(\*\)::text from public\.offer_state\b/);
  });

  it("und der Funktionsaufruf hinter has_function_privilege (Zeile 142)", () => {
    /*
     * DER FALL, DER NACH DEN TABELLEN UEBRIG BLIEB. Zeile 142 ruft
     * `offer_state_window()` auf; `0146` entzieht PUBLIC das
     * Ausfuehrungsrecht, und der Pruefzugang hat es nicht erteilt bekommen.
     */
    expect(datei).toContain(
      "has_function_privilege('public.offer_state_window()', 'execute')");
    expect(datei).not.toMatch(/\(select public\.offer_state_window\(\)::text\)/);
  });

  it("alles drei liest ueber query_to_xml — sonst bricht der Plan trotzdem ab", () => {
    /*
     * NACHGEMESSEN, und das ist der ganze Trick: PostgreSQL prueft die
     * Rechte ALLER Relationen UND aller Funktionen eines Plans beim
     * Ausfuehrungsstart, auch im nicht genommenen `case`-Zweig — bei
     * Funktionen genauso wie bei Tabellen, und selbst wenn der Aufruf nur im
     * `where` einer Unterabfrage steht. Ein blosses `case` bricht also
     * trotzdem ab. `query_to_xml` haelt den Zugriff aus dem Plan heraus.
     */
    expect(datei).toContain("query_to_xml(");
    expect(datei).toContain("ALLER Relationen UND aller Funktionen");
    /*
     * KEINE ZAHL. Wie viele Stellen geschuetzt sind, waechst mit dem Wissen
     * — am 2026-10-25 kamen `shop_offers()` im Basis-Vertrag und Zeile 312
     * dazu, nachdem der dritte Lauf `permission denied for function
     * shop_offers` meldete. Eine festgeschriebene Zahl haette diesen Test
     * jedes Mal rot gemacht, ohne etwas zu sagen.
     *
     * Gefragt wird stattdessen: zu JEDEM `query_to_xml` gehoert eine
     * Rechteabfrage und ein Rueckfallwert. Kein ungeschuetztes
     * `query_to_xml`, kein `KEIN-RECHT` ohne Vorbedingung.
     */
    /* Gezaehlt wird im CODE: der Dateikopf erklaert den Mechanismus und
       nennt `query_to_xml` dabei in Prosa. */
    const sqlCode = datei
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .split("\n").filter((z) => !z.trimStart().startsWith("--")).join("\n");
    const xml = (sqlCode.match(/query_to_xml\(/g) ?? []).length;
    const rueckfall = (sqlCode.match(/else 'KEIN-RECHT' end/g) ?? []).length;
    const vorbedingung = (sqlCode.match(/has_(?:table|function)_privilege\(/g) ?? []).length;
    expect(xml).toBeGreaterThanOrEqual(3);
    expect(rueckfall, "jedes query_to_xml braucht einen Rueckfallwert").toBe(xml);
    expect(vorbedingung, "jeder Rueckfall braucht mindestens eine Rechteabfrage")
      .toBeGreaterThanOrEqual(rueckfall);
  });

  it("und der Preflight genauso — er waere als Naechstes gescheitert", () => {
    /*
     * `reservation_ttl()` (0010) und `v1_sale_condition()` (0028) sind
     * PUBLIC ebenfalls entzogen. Der Preflight von `0146` ruft beide auf;
     * ohne diesen Schutz haette die naechste Wiederaufnahme dort
     * angeschlagen.
     */
    const pre = readFileSync("supabase/checks/0146_preflight.sql", "utf8");
    expect(pre).toContain("has_function_privilege('public.reservation_ttl()', 'execute')");
    expect(pre).toContain("has_function_privilege('public.v1_sale_condition()', 'execute')");
    expect(pre).toContain("select 9998, 'GESAMT'");
    expect(pre).toContain("case when befund = 'KEIN-RECHT' then null");
  });

  it("KEIN-RECHT zaehlt in 9998 und NICHT in 9999", () => {
    expect(datei).toContain("where befund = 'KEIN-RECHT'");
    expect(datei).toContain("select 9998, 'GESAMT'");
    /* Und es wird ausdruecklich nicht als falsch gebucht. */
    expect(datei).toContain("case when befund = 'KEIN-RECHT' then null");
  });

  it("und die Datei erteilt kein einziges Recht", () => {
    /* Eine Pruefdatei ist lesend. Der Weg ueber Rechte waere gewesen, dem
       Zugang `select` zu geben — ausdruecklich nicht getan. */
    for (const wort of ["grant ", "revoke ", "alter role", "create policy"]) {
      expect(datei.toLowerCase()).not.toContain(wort);
    }
  });
});


describe("der Waechter: eine neue Migration faellt beim Schreiben auf", () => {
  /**
   * Was der lesende Pruefzugang DARF — aus `staging-agent-setup.sql`
   * gelesen, nicht abgeschrieben. Eine zweite Liste waere eine zweite
   * Wahrheit.
   */
  const setup = readFileSync("supabase/operations/staging-agent-setup.sql", "utf8");
  const tabellen = new Set([...setup.matchAll(
    /grant select on table public\.(\w+)\s+to skyisles_agent/g)].map((m) => m[1]));
  const funktionen = new Set([...setup.matchAll(
    /grant execute on function public\.(\w+)\s*\([^)]*\)\s+to skyisles_agent/g)]
    .map((m) => m[1]));

  /** Alles, was die Migrationen anlegen: Tabellen, Sichten, Funktionen. */
  const angelegt = (() => {
    const tab = new Set<string>();
    const fn = new Set<string>();
    for (const f of readdirSync("supabase/migrations").filter((x) => x.endsWith(".sql"))) {
      const t = readFileSync(join("supabase/migrations", f), "utf8");
      for (const m of t.matchAll(
        /create\s+(?:or replace\s+)?(?:table|view|materialized view)\s+(?:if not exists\s+)?public\.(\w+)/gi)) {
        tab.add(m[1]);
      }
      for (const m of t.matchAll(
        /create\s+(?:or replace\s+)?function\s+public\.(\w+)\s*\(/gi)) fn.add(m[1]);
    }
    return { tab, fn };
  })();

  /**
   * Die direkten Zugriffe einer Pruefdatei — und nur die direkten.
   *
   * ZUERST FLIEGEN ALLE ZEICHENKETTEN HERAUS, und das ist der ganze Kniff.
   * Was in Anfuehrungszeichen steht, ist kein Zugriff im Plan: weder
   * `to_regprocedure('public.v1_sale_condition()')` (eine Katalogabfrage)
   * noch die geschuetzte Form `query_to_xml('select … from public.x')`. Was
   * danach uebrig bleibt, referenziert PostgreSQL wirklich beim Planen — und
   * genau darauf prueft es die Rechte beim Ausfuehrungsstart.
   *
   * Die erste Fassung dieses Waechters sah nur `from`/`join`. Ein
   * FUNKTIONSAUFRUF passt auf kein solches Muster, und deshalb fiel
   * `offer_state_window()` in Zeile 142 durch — der naechste Fehlschlag bei
   * der naechsten Wiederaufnahme.
   */
  const direkt = (sql: string): { tabellen: string[]; funktionen: string[] } => {
    const text = sql
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/^\s*--.*$/gm, " ")
      .replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, " ")
      .replace(/'(?:[^']|'')*'/g, "''");
    return {
      tabellen: [...text.matchAll(/(?:from|join)\s+public\.(\w+)/gi)].map((m) => m[1]),
      funktionen: [...text.matchAll(/public\.(\w+)\s*\(/g)].map((m) => m[1]),
    };
  };

  it("der Pruefzugang hat select auf zwoelf Tabellen und execute auf drei Funktionen", () => {
    expect(tabellen.size).toBe(12);
    expect(funktionen.size).toBe(3);
    expect(tabellen.has("offer_state")).toBe(false);
    expect(tabellen.has("favorites")).toBe(false);
    expect(funktionen.has("offer_state_window")).toBe(false);
  });

  it("jede Datei aus migration-plans.json greift nur auf Erlaubtes direkt zu", () => {
    /*
     * DER STRUKTURELLE TEIL DER BEHEBUNG.
     *
     * Dieser Test faellt um, sobald eine Pruefdatei, die der Runner fahrt,
     * ein ungeteiltes Objekt UNGESCHUETZT liest ODER eine ungeteilte
     * Funktion UNGESCHUETZT aufruft. Dann ist zur Wahl: die Zeile hinter
     * `has_table_privilege` / `has_function_privilege` + `query_to_xml`
     * setzen, oder sie gar nicht aus Daten beantworten. Was NICHT zur Wahl
     * steht, ist dem Pruefzugang ein Recht mehr zu geben — sonst ist er in
     * zwanzig Migrationen ein Vollleser.
     *
     * WARUM AUCH `v1_sale_condition()` UND `reservation_ttl()` DAZU ZAEHLEN,
     * obwohl sie nicht zu `0146` gehoeren: die Migrationen entziehen PUBLIC
     * ausdruecklich das Ausfuehrungsrecht (`0028` bzw. `0010`), und der
     * Pruefzugang hat es nicht erteilt bekommen. Gezaehlt wird, was ihm
     * AUSDRUECKLICH erteilt ist — sich auf ein Standardrecht zu verlassen,
     * waere ein Zufall, der bei der naechsten Haertung endet.
     */
    const funde: string[] = [];
    for (const [nummer, plan] of Object.entries(ladePlaene())) {
      for (const datei of [plan.preflight, plan.postflight]) {
        const z = direkt(readFileSync(join("supabase/checks", datei), "utf8"));
        for (const t of new Set(z.tabellen)) {
          if (angelegt.tab.has(t) && !tabellen.has(t)) {
            funde.push(`${nummer} ${datei}: Tabelle public.${t}`);
          }
        }
        for (const f of new Set(z.funktionen)) {
          if (angelegt.fn.has(f) && !funktionen.has(f)) {
            funde.push(`${nummer} ${datei}: Funktion public.${f}()`);
          }
        }
      }
    }
    expect(funde, "ungeschuetzter direkter Zugriff auf ein ungeteiltes Objekt")
      .toEqual([]);
  });

  describe("und er erkennt die Faelle wirklich — Gegenproben", () => {
    const fund = (sql: string) => {
      const z = direkt(sql);
      return [
        ...new Set(z.tabellen.filter((t) => angelegt.tab.has(t) && !tabellen.has(t))),
        ...new Set(z.funktionen.filter((f) => angelegt.fn.has(f) && !funktionen.has(f))),
      ];
    };

    it("ungeschuetzter Tabellenzugriff → gefunden", () => {
      expect(fund("select count(*) from public.offer_state")).toEqual(["offer_state"]);
    });

    it("ungeschuetzter SICHTzugriff → gefunden", () => {
      expect(fund("select count(*) from public.offer_state_live"))
        .toEqual(["offer_state_live"]);
    });

    it("ungeschuetzter FUNKTIONSAUFRUF → gefunden (der Fall von Zeile 142)", () => {
      expect(fund("select public.offer_state_window()::text"))
        .toEqual(["offer_state_window"]);
    });

    it("ein Aufruf im `where` einer Unterabfrage → auch gefunden", () => {
      /* Dort stand `v1_sale_condition()` im Preflight — und auch so bricht
         die Anweisung ab, nachgemessen. */
      expect(fund("select count(*) from public.shop_offers() o "
        + "where o.condition = public.v1_sale_condition()"))
        .toEqual(["v1_sale_condition"]);
    });

    it("geschuetzt ueber query_to_xml → NICHT gefunden", () => {
      expect(fund(
        "select case when has_function_privilege('public.offer_state_window()', 'execute')\n"
        + " then (xpath('/row/c/text()', query_to_xml(\n"
        + "   'select public.offer_state_window()::text as c', false, true, '')))[1]::text\n"
        + " else 'KEIN-RECHT' end")).toEqual([]);
    });

    it("eine Katalogabfrage in Anfuehrungszeichen → NICHT gefunden", () => {
      expect(fund("select to_regprocedure('public.offer_state_window()') is not null"))
        .toEqual([]);
      expect(fund("select prosrc like '%public.offer_state_window()%' from pg_proc"))
        .toEqual([]);
    });

    it("was erteilt ist → NICHT gefunden", () => {
      expect(fund("select count(*) from public.skylanders")).toEqual([]);
      expect(fund("select count(*) from public.shop_offers()")).toEqual([]);
      expect(fund("select public.is_shop_eligible('SKY-0001')")).toEqual([]);
    });

    it("ein Kommentar taeuscht ihn nicht", () => {
      expect(fund("-- select public.offer_state_window()\nselect 1")).toEqual([]);
      expect(fund("/* from public.offer_state */ select 1")).toEqual([]);
    });

    it("und etwas, das die Migrationen gar nicht anlegen, ist kein Fund", () => {
      expect(fund("select count(*) from public.gibt_es_nicht")).toEqual([]);
      expect(fund("select now(), count(*) from pg_proc")).toEqual([]);
    });
  });
});
