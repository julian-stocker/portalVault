import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

/**
 * Keine Abweisung der Datenbank darf im Auffangtext verschwinden.
 *
 * WARUM DIESE DATEI EXISTIERT. Am 2026-10-28 ist der erste echte
 * Merge-Versuch auf Staging mit „Das hat nicht geklappt." gescheitert — und
 * das war die EINZIGE Information, die es gab. `call()` hat den Fehler
 * ersatzlos verworfen: kein SQLSTATE, keine Meldung, kein Protokoll. Die
 * Ursachensuche musste dreizehn Möglichkeiten rein lesend ausschliessen,
 * weil die eine Zeile fehlte, die den Grund genannt hätte.
 *
 * Zwei Dinge halten das hier fest:
 *
 *   1. `call()` PROTOKOLLIERT jeden Fehler, bevor es antwortet, und der
 *      Auffangtext nennt den Code. Ein verschluckter Fehler ist schlimmer
 *      als ein hässlicher.
 *   2. JEDE `raise exception`-Meldung der Merge-Migrationen hat einen
 *      deutschen Satz. Die Zuordnung geschieht über Textstücke; ein neuer
 *      `raise` ohne passendes Stück fällt hier auf, nicht erst im Betrieb.
 *
 * WAS NICHT GEPRÜFT WIRD: ob der Satz gut ist. Nur, dass es einen gibt.
 */

const action = readFileSync("src/lib/admin/actions.ts", "utf8");

/**
 * Erreicht diese Meldung überhaupt je die Oberfläche?
 *
 * Drei Sorten tun es nicht, und sie sind benannt statt pauschal übergangen:
 *
 *   * **Vor- und Nachbedingungen** laufen beim EINSPIELEN der Migration im
 *     SQL-Editor, nicht beim Aufruf. Dort liest ein Mensch sie direkt.
 *   * **`not authorised`** kommt über den SQLSTATE `42501` und nicht über
 *     den Text — der Code ist stabil, der Wortlaut nicht.
 *   * **Ein interner Fehler der Migration selbst** („ist ein Fehler in
 *     0156") ist kein Eingabefehler. Der Betreiber kann damit nichts
 *     anfangen; der Auffangtext mit Code und das Serverprotokoll sind dafür
 *     genau richtig.
 */
const zurLaufzeit = (m: string): boolean =>
  !/^\d{4} (Vorbedingung|Nachbedingung)/.test(m)
  && !/^\d{4} setzt \d{4} voraus/.test(m)
  && m !== "not authorised"
  && !m.includes("ist ein Fehler in");

/** Der Block einer Serveraktion, von ihrer Signatur bis zur nächsten. */
function aktion(name: string): string {
  const von = action.indexOf(`export async function ${name}(`);
  expect(von, name).toBeGreaterThan(-1);
  const bis = action.indexOf("\nexport async function ", von + 1);
  return action.slice(von, bis === -1 ? undefined : bis);
}

/** Jede `raise exception`-Meldung einer Migration, zusammengefügt. */
function meldungen(datei: string): string[] {
  const sql = readFileSync(`supabase/migrations/${datei}`, "utf8");
  const gefunden: string[] = [];
  const re = /raise exception\s+((?:'(?:[^']|'')*'\s*)+)/g;
  for (let m = re.exec(sql); m !== null; m = re.exec(sql)) {
    /*
     * BENACHBARTE LITERALE GEHÖREN ZUSAMMEN. PostgreSQL fügt sie beim
     * Ausführen zusammen; wer nur das erste liest, sucht später nach einem
     * Textstück, das es so nie gibt — derselbe Fehler, der die Nachkontrolle
     * von `0156` an Zeile 115 scheitern liess.
     */
    const text = [...m[1].matchAll(/'((?:[^']|'')*)'/g)]
      .map((x) => x[1].replace(/''/g, "'")).join("");
    gefunden.push(text);
  }
  return gefunden;
}

describe("call() verschluckt keinen Fehler", () => {
  it("es protokolliert, BEVOR es antwortet", () => {
    const block = action.slice(action.indexOf("async function call("),
                               action.indexOf("\n/**", action.indexOf("async function call(")));
    expect(block).toContain("protokolliere(fn, args, error)");
    expect(block.indexOf("protokolliere(fn, args, error)"))
      .toBeLessThan(block.indexOf("domainError?.(error)"));
  });

  it("das Protokoll trägt Code, Meldung, Details und Hinweis", () => {
    const fn = action.slice(action.indexOf("function protokolliere("),
                            action.indexOf("async function call("));
    for (const feld of ["code", "message", "details", "hint"]) {
      expect(fn, feld).toContain(`${feld}: error.${feld}`);
    }
  });

  it("aber NICHT die Werte der Argumente", () => {
    /* `call()` bedient auch Handelsvorgänge, deren Argumente Kundendaten
       tragen. Die Schlüssel sagen, welcher Aufruf es war; mehr braucht die
       Ursachensuche nicht. */
    const fn = action.slice(action.indexOf("function protokolliere("),
                            action.indexOf("async function call("));
    expect(fn).toContain("argumentschluessel: Object.keys(args)");
    expect(fn).not.toContain("JSON.stringify(args)");
    expect(fn).not.toMatch(/\bargs\s*,?\s*\}/);
  });

  it("der Auffangtext nennt den Code, und die rohe Meldung erreicht ihn nicht", () => {
    const block = action.slice(action.indexOf("async function call("),
                               action.indexOf("\n/**", action.indexOf("async function call(")));
    expect(block).toContain("de.admin.writeFailedCode(code)");
    /* Der Code wird geprüft, bevor er angezeigt wird — eine Zeichenkette
       aus der Datenbank gehört nicht ungeprüft in die Oberfläche. */
    expect(block).toContain("/^[A-Z0-9]{5,8}$/.test(error.code)");
    expect(block).not.toContain("message: error.message");
  });
});

describe("jede Abweisung der Merge-Migrationen hat einen deutschen Satz", () => {
  const merge = aktion("mergeDraftIntoFigure");
  const discard = aktion("discardDraft");

  /**
   * Die Textstücke, auf die die Zuordner prüfen.
   *
   * Aus dem Code gelesen und nicht getippt: eine getippte Liste wäre beim
   * nächsten `raise` still falsch (ADR-0134, dieselbe Regel wie bei der
   * Referenzzählung).
   */
  const stuecke = (block: string): string[] =>
    [...block.matchAll(/text\.includes\("([^"]+)"\)/g)].map((m) => m[1]);

  it("die Zuordner prüfen überhaupt Textstücke", () => {
    expect(stuecke(merge).length).toBeGreaterThanOrEqual(10);
    expect(stuecke(discard).length).toBeGreaterThanOrEqual(1);
  });

  it("0157: jede Meldung wird von einem Stück getroffen (die geltende Fassung)", () => {
    const meine = stuecke(merge);
    const offen = meldungen("0157_audit_fields_and_automatic_notes.sql")
      .filter(zurLaufzeit)
      .filter((m) => !meine.some((s) => m.includes(s)));
    expect(offen, `ohne Satz: ${offen.join(" | ")}`).toEqual([]);
  });

  it("0156: jede Meldung wird von einem Stück getroffen", () => {
    const meine = stuecke(merge);
    const offen = meldungen("0156_merge_selected_fields.sql")
      /* Die Vorbedingungen und Nachbedingungen der Migration erreichen die
         Oberfläche nie — sie laufen beim Einspielen, nicht beim Aufruf. */
      .filter(zurLaufzeit)
      .filter((m) => !meine.some((s) => m.includes(s)));
    expect(offen, `ohne Satz: ${offen.join(" | ")}`).toEqual([]);
  });

  it("0154: auch ihre Meldungen sind abgedeckt — die Dreiparameterfassung lebt", () => {
    const meine = stuecke(merge);
    const offen = meldungen("0154_merge_draft_into_figure.sql")
      .filter(zurLaufzeit)
      .filter((m) => !meine.some((s) => m.includes(s)));
    expect(offen, `ohne Satz: ${offen.join(" | ")}`).toEqual([]);
  });

  it("0155: die Meldungen des Verwerfens ebenso", () => {
    const meine = stuecke(discard);
    const offen = meldungen("0155_discard_draft.sql")
      .filter(zurLaufzeit)
      .filter((m) => !meine.some((s) => m.includes(s)));
    expect(offen, `ohne Satz: ${offen.join(" | ")}`).toEqual([]);
  });

  it("der Berechtigungsfehler kommt über den SQLSTATE, nicht über den Text", () => {
    /* `not authorised` ist der Wortlaut von `raise … using errcode = '42501'`.
       Auf den Code zu prüfen ist richtig: er ist stabil, der Text nicht. */
    expect(merge).toContain('error.code === "42501"');
    expect(merge).toContain("de.admin.mergeNotAdmin");
  });

  it("die spezifischere Bildmeldung wird VOR der allgemeineren gefragt", () => {
    /*
     * „nicht ausgewaehlt" steckt auch in der Meldung über den mitgeschickten
     * Bildpfad. Stünde der allgemeine Zuordner zuerst, bekäme der Bediener
     * den falschen Satz — richtig, aber am falschen Problem.
     */
    expect(merge.indexOf('text.includes("kein Bildpfad mit")'))
      .toBeLessThan(merge.indexOf('text.includes("nicht ausgewaehlt")'));
  });

  it("und jeder genannte Satz existiert wirklich in de.ts", () => {
    const deTs = readFileSync("src/lib/i18n/de.ts", "utf8");
    const schluessel = [...merge.matchAll(/de\.admin\.(\w+)/g)].map((m) => m[1]);
    expect(schluessel.length).toBeGreaterThan(8);
    for (const k of new Set(schluessel)) {
      expect(deTs, k).toContain(`${k}:`);
    }
  });
});

describe("die Diagnosedateien von CAT-05H sind rein lesend", () => {
  const dateien = readdirSync("supabase/checks")
    .filter((n) => n.startsWith("cat05h_"));

  it("es gibt sie", () => {
    expect(dateien.length).toBeGreaterThanOrEqual(3);
  });

  for (const datei of dateien) {
    it(`${datei} schreibt nicht und ruft admin_merge_draft nicht auf`, () => {
      const sql = readFileSync(`supabase/checks/${datei}`, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");
      for (const v of ["insert into", "update ", "delete from", "alter ",
                       "drop "]) {
        expect(sql.toLowerCase(), v).not.toContain(v);
      }
      /*
       * NUR ECHTE AUFRUFE sind verboten, nicht jede Nennung: die Diagnose
       * FRAGT mit `to_regprocedure('public.admin_merge_draft(…)')`, ob die
       * Funktion steht, und das ist rein lesend. Ein `select public.…(` wäre
       * ein Aufruf — und der schreibt.
       */
      for (const v of ["select public.admin_merge_draft(",
                       "select public.admin_discard_draft(",
                       "perform public.admin_merge_draft(",
                       "select public.admin_merge_plan("]) {
        expect(sql.toLowerCase(), v).not.toContain(v);
      }
    });
  }
});


describe("die Vorschau lädt, was sie vergleicht", () => {
  const suche = readFileSync("src/lib/admin/merge-search.ts", "utf8");

  it("die internen Notizen werden wirklich geladen", () => {
    /*
     * CAT-05H. Hier stand `new Map()` — leer, und nichts hat sie je
     * gefüllt. `adminNote` war deshalb bei jeder Zeile `null`, bei Ziel wie
     * Entwurf. Die Folge war still: `vorschau()` sah im Entwurf keine Notiz
     * und bot keine Tabellenzeile dafür an, das Kästchen konnte nicht
     * angekreuzt werden — und `0156` übernimmt nur Ausgewähltes. Die
     * Herkunftszeile des Imports wäre bei jeder Zusammenführung verloren
     * gegangen.
     */
    expect(suche).toContain("fetchAdminNotes()");
    expect(suche).not.toContain("new Map<string, string | null>()");
  });

  it("jedes Feld, das die Vorschau vergleicht, kommt aus der Zeile und nicht aus einem Platzhalter", () => {
    /*
     * Dieselbe Fehlerklasse, zweite Fassung: der Dialog baute die
     * Entwurfszeile früher aus der Katalogliste zusammen und füllte
     * Fehlendes mit `"figure"` und `null`. Jetzt liefert die Suche die
     * vollständige Zeile.
     */
    expect(suche).toContain("entwurf: Zielzeile | null");
    const panel = readFileSync("src/components/admin/draft-dialog.tsx", "utf8");
    expect(panel).toContain("setEntwurfVoll(antwort.entwurf)");
    expect(panel).toContain("werteVon(entwurfVoll)");
    expect(panel).not.toContain('itemType: "figure"');
  });
});
