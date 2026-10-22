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

  it("der Knopf ist sichtbar und nicht ein unterstrichener Text", () => {
    /* Der Auftrag nennt ihn „gut sichtbar“. In V1 war er ein kleiner Link
       im Fuß. */
    const leiste = modal.slice(modal.indexOf("{copy.save}"), modal.indexOf("{copy.clear}") + 40);
    expect(leiste).toContain("ACTION_NEUTRAL");
    expect(leiste).toContain("min-h-11");
    expect(de.calculator.clear).toBe("Zurücksetzen");
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
