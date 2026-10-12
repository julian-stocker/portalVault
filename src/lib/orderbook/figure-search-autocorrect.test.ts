import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { searchFigures, searchState, type FigureChoice } from "./figure-search";

/**
 * EIN ANGEKLICKTER KATALOGTREFFER DARF KEIN FREIER ARTIKEL WERDEN.
 *
 * DER GEMELDETE FALL. Getippt „doom", die Liste zeigt „Doom Stone", der
 * Vorschlag wird mit der Maus angeklickt — und angelegt wird ein freier
 * Artikel namens „dem".
 *
 * DIE URSACHE IST KEIN EVENT-BUBBLING. Zwischen `mousedown` und `click`
 * verliert das Eingabefeld den Fokus. Genau dann greift die Textersetzung von
 * iOS/macOS und schreibt „dem" in das Feld. Das löst ein `change` aus, die
 * Suche findet nichts mehr, die Trefferliste wird LEER — und an derselben
 * Bildschirmstelle erscheint der Knopf „freien Artikel anlegen". Der Klick
 * landet auf dem, was dort inzwischen steht.
 *
 * WAS DIESE DATEI PRÜFT. Die Kette, die diesen Austausch möglich macht, wird
 * AUSGEFÜHRT — mit echten Katalogeinträgen, echter Suche und echter
 * Zustandsableitung. Dass die Auswahl auf `mousedown` fällt und das Feld
 * keine Ersetzung zulässt, wird am Quelltext gelesen: ein Texttest kann keine
 * Fokusreihenfolge ausführen, aber er kann festhalten, an welchem Ereignis
 * die Entscheidung hängt.
 */

const SEARCH = readFileSync("src/components/business/figure-search.tsx", "utf8");
const PURCHASE = readFileSync("src/components/business/add-purchase-item.tsx", "utf8");

/** Der Katalog, so klein wie die Aussage es erlaubt. */
const CATALOG: FigureChoice[] = [
  { skyId: "SKY-0123", name: "Doom Stone", series: "SF", image: null, marketPrice: 12.5 },
  { skyId: "SKY-0456", name: "Pop Fizz", series: "SG", image: null, marketPrice: 8 },
];

describe("die Kette, die aus einem Treffer einen freien Artikel machte", () => {
  it("„doom\" findet Doom Stone — es gibt etwas anzuklicken", () => {
    const hits = searchFigures(CATALOG, "doom", 10);
    expect(hits.map((h) => h.skyId)).toEqual(["SKY-0123"]);
    expect(searchState(CATALOG, "doom", hits)).not.toBe("empty");
  });

  it("…und „dem\" findet nichts, also erscheint dort der Freitext-Knopf", () => {
    /*
     * DAS IST DER AUSTAUSCH, ausgeführt statt behauptet: dieselbe Komponente,
     * ein durch Ersetzung geändertes Wort, und aus „ein Treffer" wird
     * „empty" — der einzige Zustand, in dem `free` gesetzt ist.
     */
    const hits = searchFigures(CATALOG, "dem", 10);
    expect(hits).toEqual([]);
    expect(searchState(CATALOG, "dem", hits)).toBe("empty");
  });

  it("der Freitext-Knopf hängt genau an diesem Zustand", () => {
    expect(SEARCH).toContain('const free = onFree !== undefined && state === "empty" ? query.trim() : null;');
  });
});

describe("die Auswahl fällt, bevor das Feld den Fokus verlieren kann", () => {
  /** Der Rumpf eines Knopfes, von seinem `<button` bis zum Ende des Tags. */
  const button = (marker: string): string => {
    const at = SEARCH.indexOf(marker);
    expect(at, `${marker} fehlt`).toBeGreaterThan(-1);
    const open = SEARCH.lastIndexOf("<button", at);
    return SEARCH.slice(open, at + marker.length + 400);
  };

  it("der Katalogtreffer wählt auf mousedown und verhindert den Fokuswechsel", () => {
    const b = button("choose(choice)");
    expect(b).toContain("onMouseDown={(event) => { event.preventDefault(); choose(choice); }}");
  });

  it("der Freitext-Knopf ebenso — und mit dem Namen, den er anzeigt", () => {
    const b = button("chooseFree(free)");
    expect(b).toContain("onMouseDown={(event) => { event.preventDefault(); chooseFree(free); }}");
    /* `free` aus dem Abschluss, nicht der Feldinhalt von jetzt: eine
       verspätete Ersetzung darf nicht etwas anderes anlegen als das, was
       auf dem Knopf stand. */
    expect(SEARCH).not.toMatch(/chooseFree\(\s*input\.current/);
    expect(SEARCH).not.toMatch(/chooseFree\(\s*query/);
  });

  it("und ein Klick ohne Zeigegerät bleibt möglich — für die Tastatur", () => {
    /*
     * Enter oder Leertaste auf einem fokussierten Knopf lösen `click` OHNE
     * `mousedown` aus und tragen `detail === 0`. Ohne diesen Zweig wäre der
     * Vorschlag mit der Tastatur nicht mehr auswählbar; mit ihm wählt kein
     * Zeigegerät doppelt.
     */
    expect(button("choose(choice)"))
      .toContain("onClick={(event) => { if (event.detail === 0) choose(choice); }}");
    expect(button("chooseFree(free)"))
      .toContain("onClick={(event) => { if (event.detail === 0) chooseFree(free); }}");
  });

  it("Enter im Eingabefeld wählt weiterhin den hervorgehobenen Treffer", () => {
    expect(SEARCH).toContain("if (results[active]) choose(results[active]);");
    /* Und es schickt niemals das umgebende Formular ab. */
    const enter = SEARCH.slice(SEARCH.indexOf('event.key === "Enter"'));
    expect(enter.slice(0, 200)).toContain("event.preventDefault()");
  });

  it("die Auswahl leert das Feld — damit keine Ersetzung mehr etwas trifft", () => {
    const choose = SEARCH.slice(SEARCH.indexOf("function choose(choice"),
                                SEARCH.indexOf("function onKeyDown"));
    expect(choose).toContain("onSelect(choice)");
    expect(choose).toContain('setQuery("")');
    /* Die Reihenfolge zählt: erst übernehmen, dann leeren. */
    expect(choose.indexOf("onSelect(choice)")).toBeLessThan(choose.indexOf('setQuery("")'));
  });
});

describe("kein Wörterbuch in einem Feld für Eigennamen", () => {
  /** Das Suchfeld, vom `<input` bis zu seinem Ende. */
  const searchInput = (): string => {
    const at = SEARCH.indexOf('type="search"');
    const open = SEARCH.lastIndexOf("<input", at);
    return SEARCH.slice(open, SEARCH.indexOf("/>", at));
  };

  it("das Figuren-Suchfeld schaltet Ersetzung, Großschreibung und Prüfung ab", () => {
    const field = searchInput();
    expect(field).toContain('autoCorrect="off"');
    expect(field).toContain('autoCapitalize="off"');
    expect(field).toContain("spellCheck={false}");
    expect(field).toContain('autoComplete="off"');
  });

  it("…und das Namensfeld für nicht katalogisierte Einkaufspositionen ebenso", () => {
    const at = PURCHASE.indexOf("value={rawName}");
    const field = PURCHASE.slice(PURCHASE.lastIndexOf("<input", at), PURCHASE.indexOf("/>", at));
    expect(field).toContain('autoCorrect="off"');
    expect(field).toContain('autoCapitalize="off"');
    expect(field).toContain("spellCheck={false}");
  });

  it("jedes <input> dieser beiden Dateien, das einen NAMEN aufnimmt, ist abgesichert", () => {
    /*
     * Die Zusicherung gilt der Klasse, nicht den zwei bekannten Feldern: ein
     * drittes Namensfeld ohne diese Attribute fällt hier auf.
     */
    for (const [file, source] of [["figure-search", SEARCH], ["add-purchase-item", PURCHASE]] as const) {
      const inputs = [...source.matchAll(/<input[\s\S]*?\/>/g)].map((m) => m[0])
        .filter((tag) => /type="search"|value=\{rawName\}/.test(tag));
      expect(inputs.length, file).toBeGreaterThan(0);
      for (const tag of inputs) {
        expect(tag, `${file}: autoCorrect`).toContain('autoCorrect="off"');
        expect(tag, `${file}: spellCheck`).toContain("spellCheck={false}");
      }
    }
  });
});
