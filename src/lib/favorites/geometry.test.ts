import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { ARTWORK_TONE, CARD_ASPECT, INSET, ROWS } from "@/lib/catalog/card-template";

/**
 * DIE MASSE DES HERZENS, NACHGERECHNET STATT GESCHÄTZT.
 *
 * WARUM DIESE DATEI EXISTIERT. Das Herz zeichnete 14 px, und das war auf
 * einem Laptop zu klein — der Betreiber hat es an den drei Bash-Karten
 * gesehen, nicht an einer Zahl. Der Grund steht in den Konstanten: eine
 * Karte ist dort 268 px breit, und 14 px sind davon 5,2 %. Die erste Fassung
 * war an einer 211-px-Karte entworfen, und dort sind es 6,6 % — derselbe
 * Wert, zwei Eindrücke.
 *
 * Eine Prüfung, die nur „steht `h-[22px]` in der Datei" fragt, hätte das
 * nicht verhindert. Diese Datei rechnet deshalb die KARTE aus: Breite je
 * Rasterpunkt aus `max-w-6xl`, Spalten und Abständen, Höhe aus
 * `CARD_ASPECT`, Fenster aus `INSET.image`, Bildzeile aus `ROWS`. Dann
 * prüft sie, ob das Herz und seine Fläche dort hineinpassen und sichtbar
 * genug sind.
 *
 * WAS SIE NICHT KANN: sagen, wie es AUSSIEHT. Kein Browser, keine Pixel.
 * Sie kann sagen, dass die Fläche hineinpasst, dass der Glyph nicht auf dem
 * Rahmen landet und dass er auf der GRÖSSTEN Karte nicht unter einen Anteil
 * fällt, der schon einmal zu klein war. Das Urteil bleibt ein Blick.
 */

const HEART = "src/components/catalog/favorite-heart.tsx";
const CARD = "src/components/catalog/figure-card.tsx";
const quelle = (p: string): string => readFileSync(p, "utf8");

/* ------------------------------------------------- die Maße aus dem Bauteil */

/**
 * Eine Tailwind-Spur wie `h-11` oder `h-[22px]` in Pixel.
 *
 * `fehlt` ist der Wert fuer eine Klasse, die es nicht gibt. Ohne ihn warf
 * diese Funktion, als das Polster am Knopf auf 0 fiel — und „keine Klasse
 * `p-…`" heisst hier genau „kein Polster", nicht „Fehler".
 */
function px(klasse: string, text: string, fehlt?: number): number {
  const eckig = new RegExp(`${klasse}-\\[(\\d+)px\\]`).exec(text);
  if (eckig) return Number(eckig[1]);
  const spur = new RegExp(`${klasse}-(\\d+(?:\\.\\d+)?)\\b`).exec(text);
  if (!spur) {
    if (fehlt !== undefined) return fehlt;
    throw new Error(`keine Klasse ${klasse}-… gefunden`);
  }
  /* Tailwinds Skala: 1 = 0.25rem = 4 px. */
  return Number(spur[1]) * 4;
}

const herz = quelle(HEART);
const KNOPF = herz.slice(herz.indexOf("const KNOPF"), herz.indexOf("const GRUND"));
const GRUND = herz.slice(herz.indexOf("const GRUND"), herz.indexOf("const SYMBOL"));
const SYMBOL = herz.slice(herz.indexOf("const SYMBOL ="), herz.indexOf("export function"));

/** Das sichtbare Herz. */
const GLYPH = px("h", SYMBOL);
/** Die Trage-/Klickfläche. */
const FLAECHE = px("h", KNOPF);
/**
 * Der Versatz des Glyphs gegen die Ecke der Flaeche: Knopfpolster plus
 * Grundpolster. Seit dem dritten Durchgang sind das 0 + 6 px, und
 * `figure-card.tsx` zieht genau diese Summe von der gemessenen Lage ab —
 * verschoben wird der KNOPF, landen soll der GLYPH.
 */
const POLSTER_KNOPF = px("p", KNOPF, 0);
const POLSTER_GRUND = px("p", GRUND);

/* ---------------------------------------------------- die Karte, gerechnet */

/** `main` ist `max-w-6xl` (1152 px) mit `px-4`. */
const inhalt = (viewport: number): number => Math.min(viewport, 1152) - 32;

/** Die Rasterpunkte aus `figure-grid.tsx`, mit echten Abständen. */
const RASTER = [
  { name: "Telefon 390", viewport: 390, spalten: 2, gap: 12 },
  { name: "Telefon 430", viewport: 430, spalten: 2, gap: 12 },
  { name: "Tablet 768", viewport: 768, spalten: 3, gap: 16 },
  { name: "Laptop 1024", viewport: 1024, spalten: 4, gap: 16 },
  { name: "Laptop 1280", viewport: 1280, spalten: 4, gap: 16 },
  { name: "Laptop 1280 dicht", viewport: 1280, spalten: 5, gap: 16 },
  { name: "Desktop 1600", viewport: 1600, spalten: 4, gap: 16 },
] as const;

function karte(r: (typeof RASTER)[number]) {
  const breite = (inhalt(r.viewport) - r.gap * (r.spalten - 1)) / r.spalten;
  /* `CARD_ASPECT` ist "2 / 3" — Höhe = Breite × 3/2. */
  const [w, h] = CARD_ASPECT.split("/").map((t) => Number(t.trim()));
  const hoehe = (breite * h) / w;
  const einzug = (Number.parseFloat(INSET.image) / 100) * breite;
  const bildAnteil = ROWS.find((z) => z.area === "image")!.height / 100;
  return {
    breite,
    hoehe,
    /** Die Fensteröffnung, waagrecht. */
    fenster: breite - 2 * einzug,
    /** Die Bildzeile, senkrecht. */
    bildzeile: hoehe * bildAnteil,
  };
}


describe("die Masse, wie sie im Bauteil stehen", () => {
  it("das Herz zeichnet 22 bis 24 px", () => {
    expect(GLYPH).toBeGreaterThanOrEqual(22);
    expect(GLYPH).toBeLessThanOrEqual(24);
  });

  it("und nicht mehr 14 — das war der Befund", () => {
    expect(GLYPH).toBeGreaterThan(14);
  });

  it("die Flaeche misst mindestens 44 px, in beiden Richtungen", () => {
    /* Apples Empfehlung. Die vorige Fassung lag mit 36 px darunter. */
    expect(FLAECHE).toBeGreaterThanOrEqual(44);
    expect(px("w", KNOPF)).toBe(FLAECHE);
    expect(px("w", SYMBOL)).toBe(GLYPH);
  });

  it("das Mass ist FEST, nicht an die Kartenbreite gebunden", () => {
    /*
     * Alles andere auf dieser Karte skaliert mit `cqw`, weil es Text ist.
     * Ein Bedienelement folgt dem Finger, nicht der Typografie — und ein
     * mitschrumpfendes Herz waere genau dort am kleinsten, wo der Finger am
     * groebsten ist.
     */
    for (const teil of [KNOPF, GRUND, SYMBOL]) {
      expect(teil).not.toContain("cqw");
      expect(teil).not.toContain("%");
    }
  });
});


describe("das Herz passt in jedes Fenster — auf jedem Rasterpunkt", () => {
  it.each(RASTER)("$name", (r) => {
    const k = karte(r);

    /* 1. Die Flaeche passt in die Fensteroeffnung, waagrecht und senkrecht. */
    expect(FLAECHE, `Fenster ${k.fenster.toFixed(0)} px breit`)
      .toBeLessThanOrEqual(k.fenster);
    expect(FLAECHE, `Bildzeile ${k.bildzeile.toFixed(0)} px hoch`)
      .toBeLessThanOrEqual(k.bildzeile);

    /* 2. Und sie nimmt nicht die halbe Karte: der Rest ist der
          Sammeln-Toggle, und der ist die Hauptaktion (ADR-0038). */
    const anteil = (FLAECHE * FLAECHE) / (k.breite * k.hoehe);
    expect(anteil, `${(anteil * 100).toFixed(1)} % der Kartenflaeche`)
      .toBeLessThan(0.08);
  });

  it("die kleinste Karte ist die engste Stelle, und auch dort reicht es", () => {
    const kleinste = RASTER.map(karte).reduce((a, b) => (a.breite < b.breite ? a : b));
    expect(kleinste.breite).toBeLessThan(180);
    expect(Math.min(kleinste.fenster, kleinste.bildzeile)).toBeGreaterThanOrEqual(FLAECHE);
  });
});


describe("sichtbar genug — auch auf der groessten Karte", () => {
  /*
   * DIE ZAHL, DIE DEN BEFUND ERKLAERT. Nicht die absolute Groesse war das
   * Problem, sondern ihr ANTEIL an einer breiten Karte: 14 px auf 268 px
   * sind 5,2 %. Diese Gruppe haelt eine Untergrenze fest.
   */
  const groesste = RASTER.map(karte).reduce((a, b) => (a.breite > b.breite ? a : b));

  it("die groesste Karte ist 268 px breit — dort entstand der Befund", () => {
    expect(Math.round(groesste.breite)).toBe(268);
  });

  it("das Herz nimmt dort mindestens 8 % der Kartenbreite ein", () => {
    const anteil = GLYPH / groesste.breite;
    expect(anteil, `${(anteil * 100).toFixed(1)} %`).toBeGreaterThanOrEqual(0.08);
  });

  it("und die alte Groesse haette diese Grenze gerissen", () => {
    /* Der Gegenbeweis: 14 px sind dort 5,2 %, also unter der Grenze. Ohne
       diese Zeile waere die Grenze eine Behauptung. */
    expect(14 / groesste.breite).toBeLessThan(0.08);
  });

  it("auf jedem Rasterpunkt bleibt es ueber 8 %", () => {
    for (const r of RASTER) {
      const k = karte(r);
      expect(GLYPH / k.breite, r.name).toBeGreaterThanOrEqual(0.08);
    }
  });
});


describe("es landet nicht auf dem Rahmen — gemessen, nicht geschaetzt", () => {
  /*
   * DIE LAGE STAMMT AUS EINER MESSUNG AM ALPHAKANAL DER ARTWORKS.
   *
   * `INSET.image` (10,8 %) ist das Polster des BILDES, nicht die
   * Fensteroeffnung: in den Artworks liegt die Oeffnung weiter aussen, und
   * das Herz sass deshalb 16 bis 18 px innerhalb der Rahmenkante.
   *
   * Gemessen wurde in allen SIEBEN Vorlagen, die der Katalog wirklich
   * benutzt — `standard`, `special`, `chase`, `elite`, `dark`, `legendary`
   * und `prestige` —, gegen den echten Umriss des Herzens (nicht gegen
   * seinen Huellkasten: der traegt rechts 3,25 px und oben 5,8 px Luft) plus
   * 2 px Halo, bei sechs Kartenbreiten.
   *
   * ERGEBNIS: der Glyphkasten darf bis `rechts 9,8 %` und `oben 11,0 %` der
   * Karte, dann bleibt die Tinte auf jeder Vorlage frei. Die Schranke ist
   * `prestige` — es hat die tiefste Rahmenkante, und dort sind es nur noch
   * rund 1 px Spielraum. Die uebrigen sechs Vorlagen haetten `rechts 8,1 %`
   * erlaubt.
   *
   * Abstand der Tinte zur rechten Rahmenkante an dieser Stelle:
   *
   *   standard / special / legendary   5,7 … 6,7 px
   *   chase / elite                    5,4 … 6,3 px
   *   dark                             5,9 … 7,1 px
   *   prestige                         3,4 … 3,6 px
   *
   * WAS DIESE DATEI PRUEFEN KANN: dass die Zahlen im Code die gemessenen
   * sind und dass die Rechnung, die sie in Pixel umsetzt, aufgeht. Die
   * Messung selbst wiederholt sie NICHT — dafuer muesste sie sieben WebP
   * dekodieren, und ein Testlauf ist nicht der Ort dafuer. Die Messung steht
   * im Kommentar oben und in ADR-0136; was hier steht, ist der Riegel gegen
   * ein unbemerktes Verschieben.
   */

  /** Die gemessene Lage des Glyphkastens, in Prozent der Karte. */
  const LAGE = { rechts: 9.8, oben: 11.0 };
  /** Wie weit der Knopf verschoben wird, damit der GLYPH dort landet. */
  const VERSATZ = 6;

  const karteQuelle = quelle(CARD);
  const block = karteQuelle.slice(karteQuelle.indexOf('data-slot="favorite"'));
  const stil = block.slice(0, block.indexOf("}}"));

  it("die Lage steht als `top`/`right` im Code, mit den gemessenen Zahlen", () => {
    expect(stil).toContain(`top: "calc(${LAGE.oben}% - ${VERSATZ}px)"`);
    expect(stil).toContain(`right: "calc(${LAGE.rechts}% - ${VERSATZ}px)"`);
  });

  it("und NICHT als Prozent-Padding — das rechnet senkrecht gegen die Breite", () => {
    /*
     * DIE FALLE. `padding-top: 11%` sind 11 % der BREITE des Containers,
     * auch senkrecht — so sagt es CSS. Bei 1007:1562 waere das gut ein
     * Drittel zu wenig. Ein absolut gesetztes `top` rechnet gegen die Hoehe.
     */
    expect(stil).not.toContain("paddingTop");
    expect(stil).not.toContain("paddingInline");
    expect(block.slice(0, block.indexOf(">"))).toContain("absolute");
  });

  it("der Versatz ist genau das Polster des Kreises", () => {
    /*
     * Verschoben wird der KNOPF, landen soll der GLYPH. Stimmen die beiden
     * nicht zusammen, sitzt das Herz um die Differenz daneben — und das
     * faellt an einer Karte kaum auf und an sieben Vorlagen sehr wohl.
     */
    expect(POLSTER_KNOPF).toBe(0);
    expect(POLSTER_GRUND).toBe(VERSATZ);
    expect(POLSTER_KNOPF + POLSTER_GRUND).toBe(VERSATZ);
  });

  it("die Lage ist naeher an der Ecke als die alte — um 10 bis 12 px", () => {
    /*
     * Der Befund in einer Zahl. Alt: `INSET.image` 10,8 % plus 9 px Polster.
     * Neu: 9,8 % plus 0 px, also die Tinte 10 bis 12 px weiter aussen.
     */
    const altProzent = Number.parseFloat(INSET.image);
    for (const r of RASTER) {
      const k = karte(r);
      const alt = (altProzent / 100) * k.breite + 9;
      const neu = (LAGE.rechts / 100) * k.breite;
      const gewinn = alt - neu;
      expect(gewinn, `${r.name}: ${gewinn.toFixed(1)} px`).toBeGreaterThan(9);
      expect(gewinn, `${r.name}: ${gewinn.toFixed(1)} px`).toBeLessThan(14);
    }
  });

  it("der Glyph bleibt auf JEDER Breite im Fenster, auch auf der kleinsten", () => {
    /*
     * Der Riegel gegen eine Breite, die es heute nicht gibt. Die Messung
     * galt fuer 173 bis 268 px; diese Zeile prueft die REGEL, die daraus
     * folgt: der Glyph liegt rechts weiter innen als die Oeffnung, und zwar
     * auf jeder Breite, weil die Lage prozentual ist.
     *
     * Die Oeffnung liegt bei rund 8,3 % vom rechten Rand (`x 83…923` von
     * 1007, `card-template.ts`). Der Glyphkasten bei 9,8 % liegt dahinter —
     * UNABHAENGIG von der Kartenbreite, weil beide Prozentwerte sind.
     */
    const OEFFNUNG = ((1007 - 923) / 1007) * 100;
    expect(OEFFNUNG).toBeCloseTo(8.34, 1);
    expect(LAGE.rechts).toBeGreaterThan(OEFFNUNG);
    /* Und die Tinte sitzt noch weiter innen: der Huellkasten traegt rechts
       3,25 px Luft. */
    for (const r of RASTER) {
      const k = karte(r);
      const glyphAussen = (LAGE.rechts / 100) * k.breite;
      const oeffnungAussen = (OEFFNUNG / 100) * k.breite;
      expect(glyphAussen, r.name).toBeGreaterThan(oeffnungAussen);
    }
  });

  it("senkrecht liegt der Kasten unter der tiefsten Rahmenkante", () => {
    /*
     * `card-template.ts` nennt die obersten Lochpunkte je Artwork:
     * card 99, chase 99, special 103, dark 103, legendary 103, prestige 141
     * — von 1562. Die tiefste ist `prestige` mit 9,03 %, und sie gilt in der
     * MITTE der Karte; in der Ecke zieht sich das Fenster weiter zurueck.
     * Die gemessenen 11,0 % liegen darunter.
     */
    const PRESTIGE_OBEN = (141 / 1562) * 100;
    expect(PRESTIGE_OBEN).toBeCloseTo(9.03, 1);
    expect(LAGE.oben).toBeGreaterThan(PRESTIGE_OBEN);
  });

  it("und die Flaeche waechst nach unten links, nicht zur Ecke", () => {
    expect(KNOPF).toContain("items-start");
    expect(KNOPF).toContain("justify-end");
    /* Von 44 px liegen 44 − 22 − 6 = 16 px unterhalb und links des Glyphs. */
    const ueberhang = FLAECHE - GLYPH - VERSATZ;
    expect(ueberhang).toBeGreaterThan(12);
  });

  it("die Position ist bei jeder Kartenvorlage dieselbe", () => {
    /*
     * Eine Lage je Artwork waere sieben Lagen, die gleich aussehen sollen.
     * Die gemessene ist die engste, die ALLE sieben frei laesst — deshalb
     * darf `figure-card.tsx` die Vorlage an dieser Stelle nicht lesen.
     */
    const umgebung = karteQuelle.slice(
      karteQuelle.indexOf('data-slot="favorite"') - 200,
      karteQuelle.indexOf('data-slot="favorite"') + 400);
    expect(umgebung).not.toContain("cardType");
    expect(umgebung).not.toContain("artwork");
    expect(umgebung).not.toContain("ARTWORK_TONE");
    /* Und es gibt genau EINE Lage im Bauteil. */
    expect((karteQuelle.match(/data-slot="favorite"/g) ?? []).length).toBe(1);
  });
});


describe("die Flaeche erscheint nur als Kreis hinter dem Glyph", () => {
  it("der Knopf selbst traegt keinen Grund — auch keinen auf Hover", () => {
    /*
     * Sonst waere die graue Scheibe zurueck, nur 44 px gross statt 36. Der
     * Grund sitzt am GRUND-Wrapper, der dem Glyph folgt.
     */
    const unbedingt = [...KNOPF.matchAll(/(^|[\s"'+])(bg-[a-z0-9/[\]._-]+)/g)].map((m) => m[2]);
    expect(unbedingt, "der Knopf hat einen Hintergrund").toEqual([]);
    expect(KNOPF).not.toContain("hover:bg-");
  });

  it("der Kreis dahinter ist rund und nur bei Hover oder Fokus da", () => {
    expect(GRUND).toContain("rounded-full");
    expect(GRUND).toContain("group-hover/fav:bg-");
    expect(GRUND).toContain("group-focus-visible/fav:bg-");
    const unbedingt = [...GRUND.matchAll(/(^|[\s"'+])(bg-[a-z0-9/[\]._-]+)/g)]
      .map((m) => m[2]).filter((k) => !k.includes(":"));
    expect(unbedingt, "der Kreis ist dauerhaft sichtbar").toEqual([]);
  });

  it("und er ist kleiner als die Trageflaeche", () => {
    /* 22 + 2 × 5 = 32 px gegen 44 px. Ein Kreis in Flaechengroesse waere
       wieder eine Scheibe. */
    const kreis = GLYPH + 2 * POLSTER_GRUND;
    expect(kreis).toBeLessThan(FLAECHE);
  });

  it("der Fokusring sitzt am Kreis, nicht an der unsichtbaren Flaeche", () => {
    /* Ein Ring um etwas Unsichtbares umschliesst nichts, was man sieht. */
    expect(GRUND).toContain("group-focus-visible/fav:outline");
    expect(KNOPF).toContain("focus-visible:outline-none");
  });
});


describe("der Kontrast auf hellen und dunklen Karten", () => {
  it("der leere Umriss traegt DREI dunkle Schatten, nicht einen", () => {
    /*
     * Das Artwork hinter dem Herz ist nicht eine Farbe: `standard` ist
     * elfenbeinhell, `dark` und `legendary` sind dunkle Ware, `chase` und
     * `prestige` sind Ornament. Ein weisser Umriss braucht auf dem hellen
     * Grund eine Trennung, und die leistet ein enger dunkler Halo — jetzt
     * mit mehr Deckung, weil der Glyph groesser ist und mehr Flaeche hat,
     * auf der er verschwinden kann.
     */
    const halo = herz.slice(herz.indexOf("const HALO_LEER"), herz.indexOf("const HALO_VOLL"));
    expect((halo.match(/drop-shadow/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(halo).toContain("rgb(10 9 24 / 0.95)");
  });

  it("der gefuellte traegt das Leuchten, aber keinen Umriss-Halo", () => {
    const halo = herz.slice(herz.indexOf("const HALO_VOLL"), herz.indexOf("function HeartGlyph"));
    expect(halo).toContain("var(--favorite-glow)");
  });

  it("und beide Zustaende benutzen DENSELBEN Pfad", () => {
    /* Ein gefuelltes und ein leeres Herz am selben Ort sind derselbe
       Gegenstand in zwei Zustaenden. Zwei Umrisse waeren zwei Gegenstaende. */
    expect((herz.match(/const HERZ =/g) ?? []).length).toBe(1);
    expect((herz.match(/<path d=\{HERZ\} \/>/g) ?? []).length).toBe(1);
  });

  it("und es verzweigt NICHT nach Kartenvorlage oder Tonwert", () => {
    /*
     * DIE DREI KARTEN AUS DEM BEFUND sind genau die beiden Extreme:
     * „Bash" ist `standard`, „Blue Bash" ist `special` — beide `light` —,
     * und „Legendary Bash" ist `legendary`, also `dark` (`ARTWORK_TONE`).
     *
     * Das Herz kennt diesen Unterschied nicht und soll ihn nicht kennen:
     * der Halo traegt den Kontrast auf beidem. Zwei Farbsaetze je Tonwert
     * waeren zwei Bedienelemente, die gleich aussehen sollen und
     * auseinanderlaufen — und `FigureCard` reicht dem Herz die Vorlage gar
     * nicht durch (es kommt als `favoriteSlot`, also als Inhalt).
     */
    expect(Object.keys(ARTWORK_TONE)).toContain("standard");
    expect(Object.keys(ARTWORK_TONE)).toContain("special");
    expect(ARTWORK_TONE.standard).toBe("light");
    expect(ARTWORK_TONE.special).toBe("light");
    expect(ARTWORK_TONE.legendary).toBe("dark");

    for (const wort of ["cardType", "ARTWORK_TONE", "template-ink", "tone"]) {
      expect(herz, wort).not.toContain(wort);
    }
  });

  it("die Strichstaerke ist bei 22 px feiner als bei 14 — gleiche optische Dicke", () => {
    /* Der Pfad ist in einem 24er Koordinatensystem gezeichnet: bei 22 px
       Darstellung rendert `1.9` rund 1,7 px, bei 14 px waeren es 1,1 px.
       Dieselbe Zahl haette also dicker gewirkt. */
    const breite = /strokeWidth=\{filled \? ([\d.]+) : ([\d.]+)\}/.exec(herz);
    expect(breite).toBeTruthy();
    expect(Number(breite![2])).toBeLessThan(2.1);
    expect(Number(breite![2])).toBeGreaterThan(Number(breite![1]));
  });
});
