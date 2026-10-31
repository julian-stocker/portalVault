import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/*
 * ===========================================================================
 * DER ABSCHLUSSLAUF — WAS ER NICHT DARF, UND WAS ER BEWEISEN MUSS
 *
 * ADR-0163: Staging fuehrt den Katalog, Production wird veroeffentlicht.
 * Etappe C ist die EINMALIGE Gegenrichtung.
 * ===========================================================================
 */
/**
 * Der Quelltext ohne Kommentare — und ohne das erlaubte
 * `createHash(...).update(` aus `node:crypto`, das kein
 * Datenbankschreibvorgang ist. Es wird BENANNT und entfernt, statt das
 * Muster unten aufzuweichen: ein Riegel, der viele Formen durchlaesst, um
 * eine erlaubte zu erlauben, ist kein Riegel. Dasselbe tut
 * `sync-plan.test.ts` seit dem 2026-10-30.
 */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/createHash\([^)]*\)\.update\(/g, "createHash(")
  .split("\n").filter((z) => !z.trimStart().startsWith("//")).join("\n");

const RUNNER = readFileSync("tools/catalog-finish.mts", "utf8");
const PLANER = readFileSync("tools/catalog-sync.mts", "utf8");

describe("der Runner reiht, er implementiert nicht nach", () => {
  it("er ruft die vorhandenen Werkzeuge auf", () => {
    for (const w of ["tools/storage-transfer.mts", "tools/catalog-sync.mts",
                     "tools/catalog-sync-apply.mts"]) {
      expect(RUNNER, `${w} fehlt`).toContain(w);
    }
  });

  /*
   * ER SCHREIBT NICHT SELBST. Kein PostgREST-Schreibvorgang, kein Upload,
   * kein Loeschen — das tun die aufgerufenen Werkzeuge, die dafuer geprueft
   * sind.
   */
  it("er schreibt keine Zeile und kein Objekt selbst", () => {
    const c = code(RUNNER);
    for (const m of [".insert(", ".update(", ".delete(", ".upsert(", ".rpc(",
                     ".upload(", ".remove("]) {
      expect(c, `${m} gehoert nicht in den Reihenfolger`).not.toContain(m);
    }
  });

  /*
   * UND ER LOESCHT NICHTS PAUSCHAL. Der Auftrag nennt es ausdruecklich:
   * kein TRUNCATE, kein DROP, kein vollstaendiger Import.
   */
  it("kein truncate, kein drop, kein pauschaler Import", () => {
    const c = code(RUNNER).toLowerCase();
    for (const m of ["truncate", "drop table", "drop function", "replace into"]) {
      expect(c, `${m} darf nicht vorkommen`).not.toContain(m);
    }
  });

  it("ohne --apply und --confirm-production schreibt er nichts", () => {
    expect(RUNNER).toContain('const APPLY = process.argv.includes("--apply")');
    expect(RUNNER).toContain('const BESTAETIGT = process.argv.includes("--confirm-production")');
    expect(RUNNER).toContain("if (APPLY && !BESTAETIGT)");
    expect(RUNNER).toContain("RIEGEL 0");
  });

  it("im Trockenlauf werden die schreibenden Aufrufe uebersprungen", () => {
    expect(RUNNER).toContain('if (!APPLY && argumente.includes("--apply"))');
    expect(RUNNER).toContain("(Trockenlauf: nicht aufgerufen)");
  });
});

describe("die Voraussetzungen werden VOR dem ersten Schreibzugriff geprüft", () => {
  /*
   * DER FEHLER VOM 2026-10-31, FESTGENAGELT.
   *
   * Die erste Fassung prueefte die Adminsitzung in Etappe B — also NACH den
   * 47 Uploads in A. Ein Apply-Lauf ohne hinterlegtes Passwort haette damit
   * alle 47 Bildobjekte uebertragen und waere dann abgebrochen: ein halber
   * Lauf. Eine Voraussetzung, die erst nach dem ersten Schreibzugriff
   * geprueft wird, ist keine Voraussetzung.
   */
  it("der Voraussetzungsblock steht vor Etappe A", () => {
    const c = code(RUNNER);
    const vor = c.indexOf("[VORAUSSETZUNGEN]");
    /*
     * Der Anker ist seit dem 2026-10-31 der Apply-Aufruf IN der
     * Richtungsschleife. Vorher standen hier zwei feste Aufrufe
     * (`"--ziel", "staging", "--apply"`); der Runner waehlt jetzt je
     * Richtung, weil eine erledigte Richtung verifiziert und nicht
     * uebertragen wird. Die Zusage ist dieselbe: der erste Upload darf nicht
     * vor der Pruefung stehen.
     */
    const a = c.indexOf('["--ziel", ziel, "--apply"]');
    expect(vor).toBeGreaterThan(-1);
    expect(a).toBeGreaterThan(-1);
    expect(vor, "die Pruefung muss VOR dem ersten Upload stehen").toBeLessThan(a);
  });

  it("er prüft die Adresse UND die Erreichbarkeit des Passworts", () => {
    expect(RUNNER).toContain("SKYISLES_SYNC_ADMIN");
    expect(RUNNER).toContain("keychainVorhanden");
    expect(RUNNER).toContain('"find-generic-password", "-s", dienst, "-a", konto');
  });

  /*
   * UND ER HOLT DAS PASSWORT NICHT. `find-generic-password` OHNE `-w` gibt
   * nur die Metadaten zurueck. Ein `-w` hier waere ein Geheimnis im
   * Reihenfolger, und das hat dort nichts zu suchen.
   */
  it("aber er holt das Passwort nicht — kein -w, keine Ausgabe", () => {
    const c = code(RUNNER);
    expect(c).not.toMatch(/find-generic-password[^)]*"-w"/);
    expect(c).toContain('stdio: ["ignore", "ignore", "ignore"]');
  });

  it("im Apply-Modus bricht er dort ab, und sagt dass nichts geschrieben ist", () => {
    expect(RUNNER).toContain('abbruch("VORAUSSETZUNGEN"');
    expect(RUNNER).toContain("Es ist NICHTS geschrieben worden");
    expect(RUNNER).toContain("vor Etappe A");
  });
});

describe("die Reihenfolge und ihre Abbruchbedingungen", () => {
  /*
   * B VOR A, DANN C, DANN D.
   *
   * „Vor dem ersten Storage-Upload muessen beide erforderlichen
   * Admin-Anmeldungen erfolgreich getestet werden." Eine erste Fassung hatte
   * A zuerst — 47 Uploads, dann die Anmeldeprobe. Im Fehlerfall ein halber
   * Lauf.
   */
  it("B vor A vor C vor D", () => {
    const c = code(RUNNER);
    const b = c.indexOf('"--target=production"]');          // Anmeldeprobe
    const a = c.indexOf('["--ziel", ziel, "--apply"]');       // erster Upload
    const cc = c.indexOf('"--target=staging", "--apply"');
    const d = c.indexOf('"--target=production", "--apply", "--confirm-production"');
    for (const [n, v] of [["B", b], ["A", a], ["C", cc], ["D", d]] as const) {
      expect(v, `Etappe ${n} nicht gefunden`).toBeGreaterThan(-1);
    }
    expect(b, "die Anmeldeprobe muss VOR dem ersten Upload stehen").toBeLessThan(a);
    expect(a).toBeLessThan(cc);
    expect(cc).toBeLessThan(d);
  });

  it("die Anmeldeprobe läuft auch im Trockenlauf — sie schreibt nichts", () => {
    expect(RUNNER).toContain("function werkzeugImmer(");
    expect(RUNNER).toContain('werkzeugImmer("B", "tools/catalog-sync-apply.mts", ["--target=staging"])');
    expect(RUNNER).toContain('werkzeugImmer("B", "tools/catalog-sync-apply.mts", ["--target=production"])');
    // Und sie kann kein --apply tragen.
    expect(RUNNER).toContain('if (argumente.includes("--apply")) {');
  });

  it("nach C darf kein Staging-Schritt offen sein", () => {
    expect(RUNNER).toContain('if (APPLY && nach(p1, "staging") !== 0)');
  });

  it("nach D darf in keiner Richtung ein Schritt offen sein", () => {
    expect(RUNNER).toContain('nach(p2, "production") !== 0 || nach(p2, "staging") !== 0');
  });

  /*
   * DREI BEREICHE MUESSEN GLEICH SEIN, DER VIERTE DARF ES NICHT.
   *
   * Eine erste Fassung verlangte alle vier Fingerprints — und haette den
   * echten Lauf an einem RICHTIGEN Zustand abbrechen lassen: Staging fuehrt
   * 40 ausgeschlossene Zeilen (37 Entwuerfe), Production 2. Entwuerfe werden
   * nach ADR-0163 nicht veroeffentlicht; die Zahlen koennen nie gleich sein.
   */
  it("blind auf Gleichheit geprueft wird nur, was vollstaendig abgeglichen ist", () => {
    /*
     * BIS ZUM 2026-10-31 WAREN ES DREI BEREICHE — und zwei davon enthielten
     * Felder, die der Publish nicht uebertraegt: `name` im
     * `katalog_freigegeben`-Abdruck (ADR-0030, die Excel ist Hoheit) und die
     * sieben kuratierten Metadatenfelder im `charaktere`-Abdruck (ADR-0034).
     * Etappe E konnte deshalb nie bestehen, auch nicht bei einem Plan auf
     * null — genau daran brach der Lauf ab.
     *
     * Geblieben ist die Gleichheitsfrage dort, wo sie gilt: die Kategorien
     * werden vollstaendig abgeglichen. Katalog und Charaktere beantwortet
     * Etappe E1 getrennt nach Hoheit (`publish-compare.test.ts`).
     */
    expect(RUNNER).toContain('const VERGLICHEN = ["kategorien"]');
    expect(RUNNER).toContain('const NUR_BERICHT = ["ausgeschlossen"]');
    expect(RUNNER).toContain("duerfen abweichen");
    expect(code(RUNNER)).not.toContain(
      '["katalog_freigegeben", "kategorien", "charaktere"]');
  });

  it("und Etappe E1 prueft Katalog und Charaktere getrennt nach Hoheit", () => {
    // was der Publish regelt: Gleichheit, keine Toleranz
    expect(code(RUNNER)).toContain("beurteileEtappeE(mess, erwartung)");
    expect(code(RUNNER)).toContain('abbruch("E1"');
    // was er nicht regelt: Erwartung aus den Entscheidungen, nicht Nachsicht
    expect(code(RUNNER)).toContain("publish_ungeregelt");
    expect(code(RUNNER)).toContain("erwartung === undefined");
  });

  it("und der Ausschluss darf nicht WACHSEN", () => {
    expect(RUNNER).toContain("ausNachherS.anzahl > ausVorherS.anzahl");
    expect(RUNNER).toContain("ausNachherP.anzahl > ausVorherP.anzahl");
  });

  it("bei einem Abbruch wird nicht zurueckgerollt und nichts wiederholt", () => {
    expect(RUNNER).toContain("Es wird nicht");
    expect(RUNNER).toContain("zurueckgerollt und nichts wiederholt");
    // Kein Wiederholungsversuch irgendwo.
    expect(code(RUNNER)).not.toMatch(/retry|versuch\s*\+\+|for \(let v = 0; v < 3/i);
  });
});

describe("zwei Admin-Konten, eins je Umgebung", () => {
  const APPLYTOOL = readFileSync("tools/catalog-sync-apply.mts", "utf8");

  /*
   * DER FEHLER VOM 2026-10-31. Es gab EINE Variable `SKYISLES_SYNC_ADMIN` und
   * EINEN Keychain-Dienst fuer beide Umgebungen — und die beiden Konten
   * existieren jeweils NUR in ihrer eigenen Umgebung. Ein Lauf gegen
   * Production mit der Staging-Adresse waere an `Invalid login credentials`
   * gescheitert, mitten im Schreiben.
   */
  it("die alte, gemeinsame Variable gibt es nicht mehr", () => {
    /*
     * IM CODE, nicht im Kommentar: dort steht sie absichtlich, als
     * Erklaerung des Fehlers vom 2026-10-31.
     */
    for (const q of [APPLYTOOL, RUNNER]) {
      expect(code(q)).not.toMatch(/SKYISLES_SYNC_ADMIN(?![_A-Z])/);
    }
  });

  it.each([
    ["staging", "SKYISLES_SYNC_ADMIN_STAGING", "skyisles-sync-admin-staging"],
    ["production", "SKYISLES_SYNC_ADMIN_PRODUCTION", "skyisles-sync-admin-production"],
  ])("%s hat eigene Variable und eigenen Keychain-Dienst", (_u, variable, dienst) => {
    for (const q of [APPLYTOOL, RUNNER]) {
      expect(q).toContain(variable);
      expect(q).toContain(dienst);
    }
  });

  /*
   * EINE ANMELDUNG IST KEINE BERECHTIGUNG. Ein Konto, das sich anmelden kann,
   * aber nicht in `platform_admins` steht, haette den Lauf begonnen und waere
   * beim ersten der vier RPCs mit `42501` gescheitert.
   */
  it("nach der Anmeldung wird is_platform_admin() geprüft", () => {
    expect(APPLYTOOL).toContain('c.rpc("is_platform_admin")');
    expect(APPLYTOOL).toContain("istAdmin !== true");
    expect(APPLYTOOL).toContain("KEIN Plattformadmin");
    // Und bei Misserfolg wird abgemeldet, bevor abgebrochen wird.
    expect(APPLYTOOL).toContain("await c.auth.signOut();");
  });

  it("das Passwort steht nirgends im Code und in keinem Argument", () => {
    for (const q of [APPLYTOOL, RUNNER]) {
      const c = code(q);
      expect(c).not.toMatch(/password\s*[:=]\s*["'][^"']+["']/);
      expect(c).not.toMatch(/--password/);
    }
    // Es kommt aus der Keychain oder aus verdeckter Eingabe.
    expect(APPLYTOOL).toContain('"find-generic-password", "-w", "-s", dienst, "-a", konto');
    expect(APPLYTOOL).toContain("setRawMode");
  });

  it("der Runner holt das Passwort NICHT — er prüft nur, ob es da ist", () => {
    const c = code(RUNNER);
    expect(c).not.toMatch(/find-generic-password[^)]*"-w"/);
    expect(c).toContain('stdio: ["ignore", "ignore", "ignore"]');
  });
});

describe("der geschuetzte Production-Bestand", () => {
  /*
   * DIE MARKTPREISE MIT ABDRUCK, NICHT NUR MIT ZAHL. Eine gleichbleibende
   * Anzahl bei veraenderten Werten waere die unangenehmste Form des Schadens
   * (ADR-0010).
   */
  it("wird vorher und nachher gemessen, Preise mit Abdruck", () => {
    for (const t of ["collection_items", "favorites", "cart_items", "order_lines",
                     "orders", "shop_inventory", "inventory_movements"]) {
      expect(RUNNER, `${t} fehlt in der Schutzmessung`).toContain(t);
    }
    expect(RUNNER).toContain("preise_abdruck");
    expect(RUNNER).toContain("market_price");
    expect(RUNNER).toContain("const schutzVorher = await schutzmessung(P)");
    expect(RUNNER).toContain("const schutzNachher = await schutzmessung(P)");
  });

  it("und eine Bewegung lässt den Lauf fehlschlagen", () => {
    expect(RUNNER).toContain("if (bewegt.length > 0)");
    expect(RUNNER).toContain("auch wenn alles andere gelang");
  });
});

describe("der Planer ist seit ADR-0163 symmetrisch", () => {
  /*
   * OHNE DAS KANN KRITERIUM E NIE 0 ERREICHEN. `SKY-0821` existiert nur auf
   * Production; ein Planer, der nur `staging -> production` kennt, haelt den
   * Vergleich fuer immer bei mindestens einem Unterschied — oder zwingt zu
   * einer stillschweigenden Ausnahme.
   */
  it("er plant die Figurenanlage in beide Richtungen", () => {
    expect(PLANER).toContain("function planeFigurenanlage(ziel: Umgebung)");
    expect(PLANER).toContain('planeFigurenanlage("production");');
    expect(PLANER).toContain('planeFigurenanlage("staging");');
  });

  it("und er plant den Bildverweis neuer Figuren mit", () => {
    expect(PLANER).toContain('feld: "image_override_path"');
    expect(PLANER).toContain("Bild der neuen Zeile");
  });

  it("die Zielkategorie wird über (series_code, Name) aufgelöst, nie über die Zahl", () => {
    expect(PLANER).toContain("abzug[ziel].categories.find");
    expect(PLANER).toContain("c.series_code === r.series_code && c.name === r.kategorie");
  });

  it("der Planer bleibt schreibfrei", () => {
    const c = code(PLANER);
    for (const m of [".insert(", ".update(", ".delete(", ".upsert(", ".rpc(",
                     ".upload(", ".remove("]) {
      expect(c, `${m} im Planer`).not.toContain(m);
    }
  });
});

describe("das Siegel", () => {
  it("trägt Marke, Entscheidung, Fingerprints und eine Selbstprobe", () => {
    expect(RUNNER).toContain('marke: "skyisles-katalog-baseline-1"');
    expect(RUNNER).toContain("ADR-0163");
    expect(RUNNER).toContain("selbstprobe:");
    expect(RUNNER).toContain("resources/sync/catalog-baseline.json");
  });

  it("und es nennt ausdrücklich, warum der Ausschluss abweicht", () => {
    expect(RUNNER).toContain("hinweis_ausschluss");
  });

  it("im Trockenlauf wird es nicht geschrieben", () => {
    expect(RUNNER).toContain("if (APPLY) {\n  writeFileSync(BASELINE");
  });
});

/*
 * ===========================================================================
 * RIEGEL 2: TOR BEIM KALTSTART, MESSUNG NACH EIGENEM SCHREIBEN
 *
 * Vierte Erscheinungsform desselben Themas — ein einmal erhobener Zustand,
 * der nach einer Aenderung weiterverwendet wird.
 *
 * Riegel 2 vergleicht den gemessenen Fingerprint gegen einen eingefrorenen
 * Wert. Fuer einen Kaltstart ist das richtig. Der Abschlusslauf rechnet aber
 * ZWISCHEN seinen Etappen neu — nach C und nach D, also nach seinen EIGENEN
 * Schreibvorgaengen. Mit Riegel 2 als Tor koennte er Etappe C nie verlassen;
 * am 2026-10-31 ist das aufgefallen, nachdem 23 Schritte geschrieben waren.
 * ===========================================================================
 */
describe("Riegel 2 riegelt beim Kaltstart und misst nach eigenem Schreiben", () => {
  const PLANER = readFileSync("tools/catalog-sync.mts", "utf8");

  it("der Planer kennt die Flagge, und ohne sie bleibt er ein Tor", () => {
    expect(PLANER).toContain('const RIEGEL2_MESSEN = process.argv.includes("--riegel2=messen")');
    expect(PLANER).toContain("if (abweichungen.length > 0 && !RIEGEL2_MESSEN)");
    expect(PLANER).toContain("RIEGEL 2 — Abbruch");
    expect(PLANER).toContain("process.exit(1)");
  });

  it("mit der Flagge berichtet er und sagt, warum das hier richtig ist", () => {
    expect(PLANER).toContain("Riegel 2 ALS MESSUNG");
    expect(PLANER).toContain("nicht geriegelt");
    expect(PLANER).toContain("Den Zielzustand");
  });

  /*
   * DER ERSTE PLAN BLEIBT GATED. Eine FREMDE Aenderung soll den Lauf sehr
   * wohl aufhalten, bevor er beginnt — nur die eigene Drift darf er
   * ignorieren.
   */
  it("der Runner setzt die Flagge nur nach C und E, nie beim ersten Plan", () => {
    expect(RUNNER).toContain('const p0 = planeNeu("PLAN")');
    expect(RUNNER).toContain('const p1 = planeNeu("C", true)');
    expect(RUNNER).toContain('const p2 = planeNeu("E", true)');
    expect(RUNNER).toContain("nachEigenemSchreiben = false");
    // Der erste Aufruf traegt kein zweites Argument.
    expect(RUNNER).not.toContain('planeNeu("PLAN", true)');
  });

  it("und das Abschlusskriterium bleibt strenger als der Riegel", () => {
    expect(RUNNER).toContain('nach(p2, "production") !== 0 || nach(p2, "staging") !== 0');
    expect(RUNNER).toContain("const ungleich = VERGLICHEN.filter");
  });
});

describe("der Runner behauptet keine Zahlen, die er zählen kann", () => {
  it("zählt Figuren- und Charakteranlagen aus dem Plan", () => {
    /*
     * Hier stand "darunter 33 neue Figuren und 5 Charaktere" als fester
     * Satz. Nach dem Teillauf vom 2026-10-31 sind beide 0 — ein fester Satz
     * hätte etwas Falsches ins Protokoll geschrieben, und zwar in genau das
     * Protokoll, auf das man sich später beruft.
     */
    expect(code(RUNNER)).not.toContain("darunter 33 neue Figuren und 5 Charaktere");
    expect(code(RUNNER)).toContain('zaehle(p1, "figur-anlegen")');
    expect(code(RUNNER)).toContain('zaehle(p1, "charakter-anlegen")');
  });

  it("verlangt nach Etappe C null offene Staging-Schritte", () => {
    expect(code(RUNNER)).toContain('nach(p1, "staging") !== 0');
  });

  it("verlangt nach Etappe D null Schritte in BEIDEN Richtungen", () => {
    expect(code(RUNNER))
      .toContain('nach(p2, "production") !== 0 || nach(p2, "staging") !== 0');
  });
});
