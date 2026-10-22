import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { de } from "@/lib/i18n/de";

/**
 * Arbeitsstand und gespeicherte Kalkulation (Calculator V2, ADR-0131).
 *
 * DIE EINE FRAGE, DIE DIESE DATEI STELLT: kann etwas unbemerkt verloren
 * gehen oder unbemerkt überschrieben werden? Alles andere im Kalkulator ist
 * eine Annehmlichkeit; das hier ist die Zusicherung.
 *
 * Statisch, wie die übrigen Oberflächenprüfungen des Projekts: geprüft wird
 * der Quelltext, nicht ein gerenderter Baum. Was eine solche Prüfung nicht
 * kann, steht am Ende dieser Datei.
 */
const MODAL = "src/components/calculator/calculator-modal.tsx";
const PANEL = "src/components/calculator/saved-panel.tsx";
const ACTIONS = "src/lib/calculator/saved-actions.ts";
const DRAFT = "src/lib/calculator/draft.ts";
const MIGRATION = "supabase/migrations/0142_purchase_calculations.sql";

const roh = (p: string) => readFileSync(p, "utf8");
const code = (p: string) =>
  roh(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*(?:\/\/|\*).*$/gm, "");

const modal = code(MODAL);
const panel = code(PANEL);
const actions = code(ACTIONS);

/* ===================================================================== */
describe("1. automatisch merken ist nicht automatisch anlegen", () => {
  it("der Browserspeicher darf im Anfangszustand gelesen werden — weil der Server das Fenster nie rendert", () => {
    /*
     * DIE BEDINGUNG, AN DER DIESE LÖSUNG HÄNGT.
     *
     * `useState(readDraft)` liest `localStorage` vor dem ersten Bild. Das
     * ist nur deshalb kein Hydrationsfehler, weil `calculator-launcher.tsx`
     * das Fenster erst nach einem Klick einhängt — der Server rendert es
     * nie. Fiele diese Bedingung (etwa durch ein `mounted` mit Startwert
     * `true`), bekäme React auf dem Server einen anderen Baum als im
     * Browser, und der Fehler wäre schwer zu finden.
     *
     * Deshalb steht die Bedingung hier als Test und nicht nur als
     * Kommentar.
     */
    const launcher = code("src/components/calculator/calculator-launcher.tsx");
    expect(launcher).toContain("const [mounted, setMounted] = useState(false);");
    expect(launcher).toContain("{mounted ? (");
    expect(launcher).toContain("lazy(");
    /* Und das Fenster liest den Stand im Anfangszustand, nicht in einem
       Effekt — ein Effekt, der synchron Zustand setzt, löst eine zweite
       Renderrunde aus (die Regel dieses Projekts). */
    expect(modal).toContain("const [restored] = useState(readDraft);");
    const effekte = modal.match(/useEffect\(/g) ?? [];
    const restoreImEffekt = /useEffect\([^)]*\{[^}]*readDraft\(\)/.test(modal);
    expect(restoreImEffekt, "readDraft gehört nicht in einen Effekt").toBe(false);
    expect(effekte.length).toBeLessThanOrEqual(5);
  });

  it("der Arbeitsstand geht in den Browser und sonst nirgendwohin", () => {
    /* Der Schreibvorgang bei jeder Änderung ruft `writeDraft` — und keine
       Serveraktion. */
    expect(modal).toContain("writeDraft({ lines, factor, loadedId, loadedName, loadedFingerprint })");
    const effekt = modal.slice(modal.indexOf("writeDraft({"), modal.indexOf("writeDraft({") + 300);
    expect(effekt).not.toContain("createCalculation");
    expect(effekt).not.toContain("updateCalculation");
  });

  it("eine Zeile in der Datenbank entsteht nur durch einen Druck auf Speichern", () => {
    /*
     * `createCalculation` wird an genau einer Stelle gerufen: in `save()`,
     * und `save()` hängt an einem Knopf. Kein Effekt, kein Timer, kein
     * Schließen.
     */
    expect(modal.match(/createCalculation\(/g)).toHaveLength(1);
    const stelle = modal.indexOf("createCalculation(");
    const umgebung = modal.slice(stelle - 600, stelle);
    expect(umgebung).toContain("const save = useCallback(");
    expect(umgebung).not.toContain("useEffect");
  });

  it("und die Liste zeigt nur, was gespeichert wurde", () => {
    expect(panel).toContain("calculations.map");
    expect(panel).not.toContain("readDraft");
    expect(panel).not.toContain("localStorage");
  });

  it("der Hinweis im Kopf sagt beides, in einem Satz", () => {
    expect(de.calculator.hint).toContain("gemerkt");
    expect(de.calculator.draftHint).toContain("Knopfdruck");
  });
});

/* ===================================================================== */
describe("2. Zurücksetzen trifft den Arbeitsstand, nicht die Sammlung der Kalkulationen", () => {
  it("es leert die Positionen und den Browserspeicher", () => {
    const reset = modal.slice(modal.indexOf("const resetDraft = useCallback"),
                              modal.indexOf("const loadCalculation = useCallback"));
    expect(reset).toContain("setLines([])");
    expect(reset).toContain("clearDraft()");
  });

  it("aber es löscht keine gespeicherte Kalkulation", () => {
    const reset = modal.slice(modal.indexOf("const resetDraft = useCallback"),
                              modal.indexOf("const loadCalculation = useCallback"));
    expect(reset).not.toContain("deleteCalculation");
    expect(reset).not.toContain("setSaved([])");
  });

  it("`clearDraft` fasst genau einen Schlüssel an", () => {
    const draft = code(DRAFT);
    expect(draft).toContain("window.localStorage.removeItem(DRAFT_KEY)");
    expect(draft).not.toContain("clear()");
  });

  it("und es fragt nur, wenn es etwas zu verlieren gibt", () => {
    expect(modal).toContain("onClick={() => (unsaved ? setConfirmClear(true) : resetDraft())}");
  });

  it("der Knopf ist sichtbar, trägt ein Zeichen und hat dieselbe Höhe wie die anderen", () => {
    /*
     * In V1 war er ein kleiner Link im Fuß, in V2 ein Knopf in einer eigenen
     * Werkzeugleiste — und die kostete so viel Höhe, dass die Figurenliste
     * zusammenschrumpfte (Befund aus dem Praxistest). Seit V2.1 stehen alle
     * drei in der KOPFREIHE, mit einer Höhe aus einer Konstante: 44 px am
     * Finger, 36 px an der Maus.
     */
    const leiste = modal.slice(modal.indexOf("{copy.save}"), modal.indexOf("{copy.clear}") + 40);
    expect(leiste).toContain("ACTION_NEUTRAL");
    expect(leiste).toContain("TOOL_BUTTON");
    expect(de.calculator.clear).toBe("Zurücksetzen");

    /* Eine Höhe für alle drei, und zwar aus EINER Quelle. */
    expect(modal).toContain(
      'const TOOL_BUTTON = "h-11 min-h-11 sm:h-9 sm:min-h-9 w-auto gap-1.5 px-2.5 text-xs sm:px-3"');
    expect(modal.match(/\$\{TOOL_BUTTON\}/g)!.length).toBeGreaterThanOrEqual(3);
    /* Keiner nimmt die ganze Breite. */
    expect(leiste).not.toContain("w-full");
    /* Und jeder trägt ein Zeichen im Hausstil neben seinem Wort. */
    for (const glyph of ["<SaveGlyph />", "<SavedGlyph />", "<ResetGlyph />"]) {
      expect(modal, glyph).toContain(glyph);
    }
    expect(modal).toContain('strokeWidth: "1.8"');
  });

  it("die drei Aktionen stehen in der Kopfreihe, nicht in einem eigenen Streifen", () => {
    /*
     * DAS IST DIE HÖHE, DIE DIE LISTE ZURÜCKBEKOMMEN HAT. Kopf und
     * Werkzeugleiste waren zwei Streifen à etwa 60 px; jetzt ist es einer,
     * der auf dem Telefon umbricht.
     */
    const kopf = modal.slice(modal.indexOf("<header"), modal.indexOf("</header>"));
    for (const teil of ["{copy.save}", "{copy.clear}", "copy.savedListOpen(saved.length)"]) {
      expect(kopf, teil).toContain(teil);
    }
    expect(kopf).toContain("flex-wrap");
    /* Und der Fuß trägt keine Aktion mehr, nur noch Zahlen. */
    const fuss = modal.slice(modal.indexOf("<footer"));
    expect(fuss).not.toContain("copy.clear");
  });
});

/* ===================================================================== */
describe("3. nichts wird stillschweigend überschrieben", () => {
  it("eine geladene Kalkulation lässt zwei Wege zu, und beide stehen da", () => {
    expect(modal).toContain("void save(loadedId === null ? \"new\" : \"update\")");
    expect(modal).toContain("copy.saveUpdate");
    expect(modal).toContain("{copy.saveNew}");
    /* Und die Beschriftungen sagen, was sie tun — nicht beide „Speichern". */
    expect(de.calculator.saveUpdate).toContain("aktualisieren");
    expect(de.calculator.saveNew).toContain("neue");
    expect(modal).toContain('onClick={() => void save("new")}');
  });

  it("das Bearbeiten einer geladenen Kalkulation schreibt nicht von selbst", () => {
    /* `updateCalculation` wird nur in `save("update")` gerufen — nicht in
       einem Effekt, der auf `lines` hört. */
    expect(modal.match(/updateCalculation\(/g)).toHaveLength(1);
    const stelle = modal.indexOf("updateCalculation(");
    expect(modal.slice(stelle - 400, stelle)).toContain("const save = useCallback(");
  });

  it("ungespeicherte Änderungen werden erkannt, und zwar als Vergleich", () => {
    expect(modal).toContain("const unsaved = useMemo(");
    expect(modal).toContain("draftFingerprint(lines, factor)");
    expect(modal).toContain("jetzt !== loadedFingerprint");
  });

  it("wer eine andere Kalkulation öffnet, wird vorher gefragt", () => {
    expect(modal).toContain("const requestOpen = useCallback((calculation: SavedCalculation) => {");
    expect(modal).toContain('setPending({ kind: "open", calculation })');
    /* Und die Rückfrage bietet an, vorher zu speichern — nicht nur
       „verwerfen“ oder „abbrechen“. */
    expect(modal).toContain("{copy.discardSaveFirst}");
    expect(de.calculator.discardOpen("X")).toContain("verwerfen");
  });

  it("die Liste öffnet über `requestOpen`, nicht direkt", () => {
    /* Sonst ginge die Rückfrage am häufigsten Weg vorbei. */
    expect(modal).toContain("onOpen={requestOpen}");
  });

  it("nach dem Speichern gilt der neue Stand als der gespeicherte", () => {
    expect(modal).toContain(
      "setLoadedFingerprint(draftFingerprint(result.calculation.lines, result.calculation.factorPercent))");
  });
});

/* ===================================================================== */
describe("4. ein Fehlschlag verliert nichts", () => {
  it("der Arbeitsstand bleibt, und die Meldung sagt genau das", () => {
    const save = modal.slice(modal.indexOf("const save = useCallback"),
                             modal.indexOf("const rename = useCallback"));
    expect(save).toContain("setSaveError(true)");
    /* Kein `setLines([])`, kein `clearDraft()` auf dem Fehlerweg. */
    expect(save).not.toContain("clearDraft");
    expect(de.calculator.saveFailed).toContain("Arbeitsstand bleibt erhalten");
    expect(de.calculator.saveFailed).toContain("versuchen");
  });

  it("und ein zweiter Versuch ist einen Klick entfernt", () => {
    expect(modal).toContain("role=\"alert\"");
    expect(modal).toContain("{copy.saveFailed}");
  });

  it("die Liste unterscheidet „nichts gespeichert“ von „konnte nicht nachsehen“", () => {
    expect(panel).toContain('state === "failed"');
    expect(panel).toContain("{copy.savedListFailed}");
    expect(panel).toContain("{copy.savedListEmpty}");
    expect(de.calculator.savedListEmpty).not.toBe(de.calculator.savedListFailed);
  });

  it("ein Löschen der geladenen Kalkulation wirft die Positionen NICHT fort", () => {
    const remove = modal.slice(modal.indexOf("const remove = useCallback"),
                               modal.indexOf("const remove = useCallback") + 900);
    expect(remove).toContain("setLoadedId(null)");
    expect(remove).not.toContain("setLines([])");
  });
});

/* ===================================================================== */
describe("5. die Liste ist bedienbar, auch mit dem Daumen", () => {
  it("jede Aktion ist mindestens 40 px hoch", () => {
    /* Die Liste steht in einem Dialog; 40 px ist die Höhe, die das Projekt
       für Listenaktionen benutzt (`h-10`), 44 px für die Hauptknöpfe. */
    for (const stelle of ["{copy.savedOpen}", "{copy.savedRename}", "{copy.savedDelete}"]) {
      const i = panel.indexOf(stelle);
      expect(i, stelle).toBeGreaterThan(-1);
      expect(panel.slice(i - 420, i)).toMatch(/min-h-10|h-10/);
    }
  });

  it("sie bricht um statt zu schrumpfen", () => {
    expect(panel).toContain("flex-wrap");
    expect(panel).toContain("basis-48");
  });

  it("Löschen fragt vorher, und der Name steht in der Frage", () => {
    expect(panel).toContain("setConfirming(true)");
    expect(panel).toContain("{copy.savedDeleteConfirm(calculation.name)}");
    expect(de.calculator.savedDeleteConfirm("Willhaben")).toContain("Willhaben");
  });

  it("Umbenennen geht an der Stelle, an der der Name steht", () => {
    expect(panel).toContain("setRenaming(true)");
    expect(panel).toContain('if (e.key === "Enter") commitRename();');
    expect(panel).toContain('if (e.key === "Escape")');
  });

  it("und sie nennt die Zahlen, an denen man ein Inserat wiedererkennt", () => {
    expect(panel).toContain("copy.savedListCount(calculation.positions, calculation.units)");
    expect(panel).toContain("formatPrice(centsToEuro(calculation.totalCents))");
    expect(panel).toContain("copy.savedListUpdated(");
  });

  it("der Fuß mit der Entscheidungszahl bleibt sichtbar, während die Liste offen ist", () => {
    /*
     * Deshalb tauscht die Liste die MITTE und steht nicht unter dem Fuß:
     * sonst schöbe sie bei zehn Einträgen den maximalen Einkaufspreis aus
     * dem Bild — die Zahl, wegen der das Fenster überhaupt aufgeht.
     */
    const umschalter = modal.indexOf('{view === "saved" ? (');
    const fuss = modal.indexOf("<Summary");
    expect(umschalter).toBeGreaterThan(-1);
    expect(fuss).toBeGreaterThan(umschalter);
  });
});

/* ===================================================================== */
describe("6. wer was sehen darf", () => {
  it("die Benutzerzuordnung kommt aus der Sitzung, nie aus dem Aufruf", () => {
    expect(actions).toContain("const { data: auth } = await supabase.auth.getUser()");
    expect(actions).toContain("user_id: auth.user.id");
    /* Kein `user_id` aus einem Parameter. */
    expect(actions).not.toMatch(/user_id:\s*payload/);
    expect(actions).not.toMatch(/userId[?:]/);
  });

  it("jede Änderung ist zusätzlich auf das eigene Konto eingeschränkt", () => {
    /* Die Richtlinie entscheidet; das hier macht die Absicht lesbar und
       verwandelt eine fremde ID in „nichts getroffen“. */
    expect(actions.match(/\.eq\("user_id", auth\.user\.id\)/g)!.length).toBeGreaterThanOrEqual(4);
  });

  it("keine zweite Rollenlogik — und keine Betriebsrolle", () => {
    expect(actions).not.toContain("canOperateSeller");
    expect(actions).not.toContain("isPlatformAdmin");
  });

  it("die Aktionen schreiben nichts im Geschäftsbetrieb", () => {
    for (const verboten of ["shop_inventory", "inventory_movements", "purchases",
      "purchase_items", "orders", "platform_receipts", "sale_price", "shop_price"]) {
      expect(actions.includes(verboten), verboten).toBe(false);
    }
  });

  it("und es sind nur asynchrone Funktionen — die Regel für \"use server\"", () => {
    expect(actions).toContain('"use server"');
    const exporte = actions.match(/^export (async function|type)/gm) ?? [];
    expect(exporte.filter((e) => e === "export async function").length).toBe(6);
    expect(actions).not.toMatch(/^export const/m);
  });
});

/* ===================================================================== */
describe("7. die Datenbank hält dieselben Regeln", () => {
  const migration = roh(MIGRATION);

  it("`anon` bekommt sein automatisches Recht ENTZOGEN, nicht nur nicht erteilt", () => {
    /*
     * DER FEHLER, DEN DIESE ZEILE VERHINDERT. Supabase setzt
     * `ALTER DEFAULT PRIVILEGES` auf `public`: jede neue Tabelle gibt `anon`
     * automatisch `ALL`. Ein `grant` an `authenticated` entzieht davon
     * nichts — ohne ein ausdrückliches `revoke` hätte `anon` Rechte auf
     * dieser Tabelle gehabt (die Policies hätten ihn abgewiesen, aber
     * `truncate` kennt keine Policy).
     *
     * Die erste Fassung dieser Migration hatte nur den `grant`. Der
     * Probelauf fand es nicht — PGlite kennt diese Standardrechte nicht.
     */
    expect(migration).toContain("revoke all on public.purchase_calculations from anon");
    expect(migration)
      .toContain("revoke truncate, references, trigger on public.purchase_calculations");
    /* Und die Migration prüft ihre eigene Rechteliste nach. */
    expect(migration).toContain("'DELETE,INSERT,SELECT,UPDATE'");
  });

  it("vier Policies, und keine für anon", () => {
    expect(migration.match(/create policy/g)).toHaveLength(4);
    expect(migration).toContain("for select to authenticated");
    expect(migration).toContain("for insert to authenticated");
    expect(migration).toContain("for update to authenticated");
    expect(migration).toContain("for delete to authenticated");
    expect(migration).not.toContain("to anon");
  });

  it("die Änderung prüft BEIDE Hälften", () => {
    /* Ohne `with check` könnte jemand seine Zeile einem anderen Konto
       zuschieben — derselbe Kommentar steht in `0001`. */
    const update = migration.slice(migration.indexOf("purchase_calculations_update_own"));
    expect(update).toContain("using ((select auth.uid()) = user_id)");
    expect(update).toContain("with check ((select auth.uid()) = user_id)");
  });

  it("RLS ist eingeschaltet, und die Migration prüft es selbst nach", () => {
    expect(migration).toContain("alter table public.purchase_calculations enable row level security");
    expect(migration).toContain("relrowsecurity");
  });

  it("sie legt keine Zeile an und fasst keine bestehende Tabelle an", () => {
    expect(migration).toContain("die Migration hat % Zeile(n) angelegt");
    /* Nur ein `create table`, kein `alter table` auf etwas Bestehendes,
       kein `update`, kein `insert` auf Anweisungsebene. */
    expect(migration.match(/^create table public\./gm)).toHaveLength(1);
    const anweisungen = migration
      .replace(/\$\$[\s\S]*?\$\$/g, "$$ … $$")
      .replace(/^\s*--.*$/gm, "");
    expect(anweisungen).not.toMatch(/^\s*insert into/m);
    expect(anweisungen).not.toMatch(/^\s*update public\./m);
    expect(anweisungen).not.toMatch(/^\s*drop /m);
  });

  it("und sie ist nirgends angewendet — das steht auch so drin", () => {
    expect(migration).toContain("NICHT ANGEWENDET");
    const register = roh("supabase/migrations/APPLIED.md");
    expect(register).not.toContain("0142_purchase_calculations.sql |");
  });
});

/* ===================================================================== */
describe("8. die Höhe gehört der Figurenliste (V2.1)", () => {
  /*
   * DER BEFUND AUS DEM ERSTEN PRAXISTEST, und er war berechtigt: Kopf und
   * Werkzeugleiste waren zwei Streifen, dazu eine Bestätigungszeile, eine
   * Hinweiszeile im Fuß und eine Suche, die bis `45dvh` wachsen durfte. Übrig
   * blieb für die Positionsliste zu wenig.
   *
   * Diese Prüfungen halten die vier Stellen fest, an denen die Höhe
   * zurückgeholt wurde. Was sie NICHT können: Pixel messen — dafür gibt es
   * keinen Layoutmotor in dieser Suite. Sie halten die ENTSCHEIDUNGEN fest,
   * nicht das Ergebnis; das Ergebnis sieht man im Browser.
   */
  it("die Höhenkette ist geschlossen — und zwar genau einmal", () => {
    expect(modal).toContain('className="flex min-h-0 flex-1 flex-col"');
    /* Der wachsende Teil ist die Liste, und sie trägt beide Klassen, die ein
       innerer Rollbereich braucht. */
    expect(modal).toContain('className="min-h-0 flex-1 overflow-y-auto');
    /* Genau EIN wachsender Bereich in der Kalkulationsansicht: zwei würden
       sich den Platz teilen, und keiner hätte genug. */
    expect(modal.match(/flex-1 overflow-y-auto/g)).toHaveLength(1);
  });

  it("über der Liste steht nur noch Festes, und es ist klein", () => {
    /* Kopf: eine Reihe. Suche: gedeckelt. Der vergängliche Streifen: nur da,
       wenn er gebraucht wird. */
    expect(modal).toContain("max-h-[28dvh] shrink-0 overflow-y-auto border-b");
    expect(modal).toContain("{saveOpen || pending !== null || confirmClear || saveError ? (");
    /* Und der Fuß hat keine eigene Hinweisreihe mehr. */
    expect(modal).not.toContain('className="mt-2 flex flex-wrap items-center justify-between gap-2"');
  });

  it("keine verschachtelten Rollbereiche — die zwei sind Geschwister", () => {
    /*
     * Suche und Liste rollen beide, stehen aber nebeneinander im selben
     * Flex-Behälter. Verschachtelt wäre, wenn die Liste IN der Suche läge:
     * dann würde ein Rad am Rand den falschen Bereich bewegen.
     */
    const suche = modal.indexOf("max-h-[28dvh]");
    const liste = modal.indexOf('className="min-h-0 flex-1 overflow-y-auto');
    expect(suche).toBeGreaterThan(-1);
    expect(liste).toBeGreaterThan(suche);
    /* Zwischen beiden endet der Kasten der Suche. */
    expect(modal.slice(suche, liste)).toContain("</div>");
  });

  it("und die Zahl, wegen der jemand das Fenster öffnet, bleibt im Fuß", () => {
    const fuss = modal.slice(modal.indexOf("<footer"));
    expect(fuss).toContain("copy.maxPurchase");
    expect(fuss).toContain("text-2xl");
    expect(fuss).toContain("COMMERCE_INK");
  });
});

/* ===================================================================== */
describe("9. Rückmeldungen kosten keine dauerhafte Höhe (V2.1)", () => {
  it("die Erfolgsmeldung steht im Kopf und geht von selbst", () => {
    const kopf = modal.slice(modal.indexOf("<header"), modal.indexOf("</header>"));
    expect(kopf).toContain("{copy.savedShort}");
    expect(kopf).toContain('role="status"');
    /* Ein Zeitgeber räumt sie weg — und der Abbau bestellt ihn ab. */
    expect(modal).toContain("noteTimer.current = setTimeout(() => setSavedNote(null), 2500)");
    expect(modal).toContain("clearTimeout(noteTimer.current)");
    expect(de.calculator.savedShort.length).toBeLessThan(20);
  });

  it("der Fehler dagegen bleibt stehen, bis man ihn wegklickt", () => {
    /* Die eine Rückmeldung, die man nicht verpassen darf. */
    expect(modal).toContain("{copy.saveFailed}");
    expect(modal).toContain('role="alert"');
    expect(modal).not.toMatch(/setSaveError\(false\),\s*\d+\)/);
  });

  it("Geöffnet und ungespeicherte Änderungen bleiben, in einer Zeile", () => {
    const kopf = modal.slice(modal.indexOf("<header"), modal.indexOf("</header>"));
    expect(kopf).toContain("copy.loadedName(loadedName)");
    expect(kopf).toContain("{copy.unsaved}");
    /* Eine Zeile, `text-[11px]`, umbrechend — keine zweite Reihe. */
    expect(kopf).toContain("text-[11px] leading-tight");
  });
});

/* ===================================================================== */
describe("10. keine Sackgasse zwischen den zwei Ansichten (V2.1)", () => {
  it("der Umschalter steht im Kopf und gilt in beide Richtungen", () => {
    const kopf = modal.slice(modal.indexOf("<header"), modal.indexOf("</header>"));
    expect(kopf).toContain('onClick={() => setView(view === "saved" ? "calc" : "saved")}');
    expect(kopf).toContain('aria-pressed={view === "saved"}');
    /* Und seine Beschriftung sagt, wohin er führt. */
    expect(kopf).toContain("copy.backToCalc");
    expect(de.calculator.backToCalc).not.toBe(de.calculator.savedListOpen(0));
  });

  it("die Liste hat zusätzlich einen eigenen, sichtbaren Rückweg", () => {
    expect(panel).toContain("{copy.savedListBack}");
    expect(panel).toContain("ACTION_NEUTRAL");
    /* Kein unterstrichener Text mehr für die einzige Stelle, an der man
       diese Ansicht verlässt. */
    const rueck = panel.slice(panel.indexOf("{copy.savedListTitle}"),
                              panel.indexOf("{copy.savedListBack}"));
    expect(rueck).not.toContain("underline");
    expect(rueck).toContain("min-h-11");
  });

  it("und eine eigene Überschrift", () => {
    expect(panel).toContain("{copy.savedListTitle}");
    expect(panel).toContain("<h3");
  });

  it("der Ansichtswechsel rührt die Kalkulation nicht an", () => {
    /*
     * `setView` ist das Einzige, was der Umschalter tut. Würde er `setLines`
     * oder `setLoadedId` anfassen, wäre ein Blick in die Liste ein
     * Datenverlust.
     */
    const kopf = modal.slice(modal.indexOf("<header"), modal.indexOf("</header>"));
    const umschalter = kopf.slice(kopf.indexOf('onClick={() => setView(view === "saved"'));
    const bisEnde = umschalter.slice(0, umschalter.indexOf("</button>"));
    for (const verboten of ["setLines", "setFactor", "setLoadedId", "clearDraft"]) {
      expect(bisEnde, verboten).not.toContain(verboten);
    }
  });

  it("Kopf und Fuß bleiben in der Listenansicht stehen", () => {
    /* Der Umschalter tauscht nur die Mitte: das SELECT steht zwischen Kopf
       und Fuß, und beide liegen außerhalb der Bedingung. */
    const schalter = modal.indexOf('{view === "saved" ? (');
    expect(modal.indexOf("<header")).toBeLessThan(schalter);
    expect(modal.indexOf("<Summary")).toBeGreaterThan(schalter);
  });
});

/* ===================================================================== */
describe("8. der Weg nach Staging ist vorbereitet, nicht gegangen", () => {
  it("es gibt einen Einmal-Lauf, und er trägt den Staging-Stempel", () => {
    const lauf = roh("supabase/operations/staging-0142.sql");
    expect(lauf).toContain("SKY-0821");
    expect(lauf).toContain("SKY-0822");
    expect(lauf).toContain("ABBRUCH A1");
    /* Zeichengleich eingebettet — `staging-oneshot.test.ts` prüft das. */
    expect(lauf).toContain("-- >>> EINGEBETTET: supabase/migrations/0142_purchase_calculations.sql");
  });

  it("eine lesende Nachkontrolle prüft Tabelle, Richtlinien und Rechte", () => {
    const post = roh("supabase/checks/0142_postflight.sql");
    for (const zeile of ["zwoelf Spalten", "vier Richtlinien",
      "keine Richtlinie gilt fuer anon", "anon hat KEIN Tabellenrecht",
      "kein truncate", "PARTIELLE Unique-Index"]) {
      expect(post, zeile).toContain(zeile);
    }
    /*
     * „die Tabelle ist LEER" stand hier und ist fort (2026-10-22). Die Zeile
     * verlangte null Zeilen — richtig in der Minute nach der Migration und
     * falsch, sobald jemand eine Kalkulation gespeichert hat. Genau das ist
     * auf Staging passiert. Dass die MIGRATION keine Zeile anlegt, prüft sie
     * in ihrer eigenen Transaktion, und dort ist es beweisbar; in der
     * Nachkontrolle ist es seitdem eine Messung.
     */
    expect(post).not.toContain("die Tabelle ist LEER");
    expect(post).toContain("Info: gespeicherte Kalkulationen");
    /* Beweisbar ist die Aussage dort, wo sie gilt: in der Migration selbst. */
    expect(roh(MIGRATION)).toContain("die Migration hat % Zeile(n) angelegt");
    /* Und sie sagt, was sie NICHT beantwortet. */
    expect(post).toContain("ob die Richtlinien WIRKEN");
  });

  it("und sie prüft die Nachbartabelle als EIGENSCHAFT, nicht als Zahl", () => {
    /*
     * DER BEFUND VOM 2026-10-22. Die Zeile verlangte „genau vier
     * Richtlinien" auf `collection_items`; auf Staging sind es fünf, weil
     * `staging-agent-setup.sql` je Tabelle eine Lesepolicy für die
     * Prüfrolle anlegt (`docs/SECURITY.md`, 4b). Die fünfte stand dort lange
     * vor `0142` — falsch war die Zahl, nicht die Datenbank.
     *
     * Eine Zahl bricht, sobald jemand eine berechtigte Policy hinzufügt,
     * und sagt nichts darüber, ob die vier, auf die es ankommt, noch da
     * sind. Geprüft wird deshalb: die vier EIGENEN stehen, für
     * `authenticated`, und keine gibt `anon` etwas.
     */
    const post = roh("supabase/checks/0142_postflight.sql");
    expect(post).toContain("collection_items_select_own");
    expect(post).toContain("collection_items_delete_own");
    expect(post).toContain("'authenticated' = any (roles)");
    expect(post).toContain("und keine davon gibt anon etwas");
    /* Und sie nennt die Richtlinien beim Namen, damit die nächste
       Abweichung eine Auskunft ist und keine Zahl. */
    expect(post).toContain("alle Richtlinien von collection_items, mit Befehl und Rollen");
    /* Die alte Formulierung ist fort. */
    expect(post).not.toContain("hat weiter genau vier Richtlinien");
  });

  it("und ein Lauf mit zwei echten Sitzungen, der die Dienstrolle nicht für Behauptungen benutzt", () => {
    /*
     * Der Unterschied, auf den es ankommt: eine Richtlinie, die richtig
     * KONFIGURIERT ist, und eine, die WIRKT, sind zwei Aussagen. Die zweite
     * braucht zwei echte JWT — die Dienstrolle umgeht RLS und würde nichts
     * beweisen (dieselbe Trennung wie in `verify-rls.mts`).
     */
    const tool = code("tools/verify-calculations.mts");
    expect(tool).toContain("requireStagingIfRequested");
    expect(tool).toContain("createSignedInUser");
    expect(tool).toContain("B sieht die von A NICHT");
    expect(tool).toContain("B kann KEINE Zeile für A anlegen");
    expect(tool).toContain("eine zweite auf denselben Einkauf NICHT");
    /* Es räumt auf, und zwar beides. */
    expect(tool).toContain("admin.auth.admin.deleteUser");
    expect(tool).toContain("keine Probezeile bleibt zurück");
  });

  it("die Anleitung für die Handproben nennt den Fall, der schiefgehen könnte", () => {
    const anleitung = roh("supabase/checks/0142_staging_run.md");
    /* Punkt 7 des Auftrags: die Zuordnung nach einem Neuladen. */
    expect(anleitung).toContain("Zuordnung nach Neuladen");
    expect(anleitung).toContain("Bestehende aktualisieren");
    expect(anleitung).toContain("wäre die Zuordnung verloren");
    /* Und sie sagt, warum die schreibenden Schritte nicht von hier kommen. */
    expect(anleitung).toContain("keinen schreibenden Zugang zur Staging-Datenbank");
    expect(anleitung).toContain("default_transaction_read_only");
  });
});

/* ===================================================================== */
describe("was diese Datei NICHT prüft", () => {
  it("nennt es, statt es offen zu lassen", () => {
    /*
     * Geprüft wird Quelltext. Dass der Arbeitsstand nach einem echten
     * Neuladen wirklich wieder erscheint, dass die Richtlinie einem
     * fremden Konto wirklich nichts gibt, und dass die Liste auf einem
     * echten Telefon bedienbar ist, zeigt erst ein Lauf gegen Staging:
     *
     *   npm run dev:staging   — Arbeitsstand, Speichern, Öffnen, Umbenennen
     *   npm run verify:rls:staging — die Richtlinie mit zwei Konten
     *
     * Diese Zeile ist kein Platzhalter: sie hält fest, dass die Aussage
     * dieser Datei begrenzt ist, damit niemand sie für mehr nimmt.
     */
    expect(true).toBe(true);
  });
});
