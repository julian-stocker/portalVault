/**
 * CAT-05 — welcher bestehende Eintrag könnte derselbe sein wie dieser Entwurf?
 *
 * WAS DIESE DATEI TUT UND WAS AUSDRÜCKLICH NICHT
 *
 * Sie schlägt vor. Sie entscheidet nichts. Eine Zusammenführung ist
 * unumkehrbar — sie löscht einen Eintrag —, und die Entscheidung dafür
 * gehört einem Menschen, der beide Zeilen gesehen hat. Was hier entsteht,
 * ist eine **geordnete Liste mit Begründung**, damit das Suchen entfällt und
 * nicht das Prüfen.
 *
 * DREI FEHLSCHLÜSSE, DIE BEIM BAUEN PASSIERT SIND — und deshalb stehen sie
 * hier als Regel und nicht als Kommentar irgendwo:
 *
 *   1. **Eine Variante ist nicht ihre Grundfigur.** „Silver Eruptor" und
 *      „Eruptor" sind zwei Produkte; auf dieser Unterscheidung beruht der
 *      ganze Katalog. Die Grundfigur wird gezeigt — als Bezug, nicht als
 *      Verdacht.
 *   2. **Bei Zubehör ist die Farbe die Identität.** „Gold Mystery Chest" und
 *      „Mystery Chest Blue" sind zwei Truhen. Merkmalswörter dürfen nur bei
 *      FIGUREN abgezogen werden.
 *   3. **Ein Merkmalswort auf nur einer Seite ist ein Unterschied.**
 *      „Snow-Brite Stormblade (Employee Edition)" ist nicht „Stormblade".
 */

/** Wie sicher ein Treffer ist. Die Reihenfolge ist die Sortierung. */
export const STUFEN = ["eindeutig identisch", "wahrscheinlich identisch",
                       "unsicher", "Grundfigur"] as const;
export type Stufe = (typeof STUFEN)[number];

export type Kandidatenzeile = {
  skyId: string;
  name: string;
  seriesCode: string;
  categoryName: string;
  cardType: string;
  catalogStatus: string;
};

export type Treffer = Kandidatenzeile & { stufe: Stufe; grund: string };

/**
 * Ausführungsmerkmale.
 *
 * Sie stehen in Dutzenden Namen und unterscheiden dort nichts — bei FIGUREN.
 * Bei Zubehör sind dieselben Wörter die Identität, und deshalb wird die
 * Liste dort nicht angewendet.
 */
const MERKMAL = new Set((
  "legendary dark elite lightcore chrome silver gold golden pearl jade granite "
  + "molten polar glow flocked crystal clear metallic power blue steel plated "
  + "patina sidekick mini springtime volcanic eggsellent jingle bell frito lay "
  + "green red purple bronze easter glitter royale royal nitro pink orange rock "
  + "candy white employee edition variant ultimate sparkle e3 enchanted stone "
  + "punch love potion winterfest birthday bash missile tow snow brite heavy"
).split(" "));

/** Kategorien, deren Einträge kein Variantenschema haben. */
const ZUBEHOER = /Trap|Kristall|Location|Magic Item|Troph|Fahrzeug|Truhe/i;

export function falte(s: string): string {
  return (s || "").normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase()
    .replace(/['’`]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}
const ohneLuecken = (s: string) => falte(s).replace(/ /g, "");
const worte = (s: string) => falte(s).split(" ").filter(Boolean);

/**
 * Die Treffer zu einem Entwurf, geordnet.
 *
 * `kern` ist der Name der Grundfigur, wie CAT-03 ihn ermittelt hat; ist er
 * leer, entfällt die Grundfigur-Einstufung.
 */
export function findeTreffer(
  entwurf: Kandidatenzeile & { kern: string; hatFamilie: boolean; istFigur: boolean },
  bestand: readonly Kandidatenzeile[],
): Treffer[] {
  const meine = worte(entwurf.name);
  const meinKern = entwurf.istFigur ? meine.filter((x) => !MERKMAL.has(x)) : meine;
  const meineMerkmale = meine.filter((x) => MERKMAL.has(x));
  const treffer: Treffer[] = [];

  for (const r of bestand) {
    if (r.skyId === entwurf.skyId) continue;
    let stufe: Stufe | null = null;
    let grund = "";

    const gleicheSerie = r.seriesCode === entwurf.seriesCode;
    const gleicheKat = gleicheSerie && r.categoryName === entwurf.categoryName;

    if (gleicheSerie && falte(r.name) === falte(entwurf.name)) {
      stufe = "eindeutig identisch"; grund = "Name gefaltet gleich, gleiche Serie";
    } else if (gleicheSerie && ohneLuecken(r.name) === ohneLuecken(entwurf.name)) {
      stufe = "eindeutig identisch"; grund = "Name ohne Wortgrenzen gleich, gleiche Serie";
    } else if (entwurf.hatFamilie && entwurf.kern && falte(r.name) === entwurf.kern) {
      stufe = "Grundfigur"; grund = "Grundfigur zu dieser Variante — keine Dublette";
    } else if (!entwurf.hatFamilie && gleicheKat) {
      const zubehoer = ZUBEHOER.test(r.categoryName);
      const rWorte = worte(r.name);
      const rKern = (entwurf.istFigur && !zubehoer) ? rWorte.filter((x) => !MERKMAL.has(x)) : rWorte;
      const rMerkmale = rWorte.filter((x) => MERKMAL.has(x));
      const schnitt = meinKern.filter((x) => rKern.includes(x));
      const deckend = schnitt.length > 0
        && schnitt.length === Math.min(meinKern.length, rKern.length)
        && Math.abs(meinKern.length - rKern.length) <= 1;
      const merkmalUngleich = meineMerkmale.length !== rMerkmale.length
        || meineMerkmale.some((x) => !rMerkmale.includes(x));

      if (deckend && merkmalUngleich) {
        stufe = "unsicher";
        grund = `Kernname deckungsgleich (${schnitt.join(" ")}), aber die Ausführungen `
              + `unterscheiden sich — eher Variante als Dublette`;
      } else if (deckend) {
        stufe = "wahrscheinlich identisch";
        grund = `Kernname deckungsgleich (${schnitt.join(" ")}), gleiche Serie und Kategorie`;
      } else if (schnitt.length >= 1
                 && schnitt.length >= Math.min(meinKern.length, rKern.length) - 1) {
        stufe = "unsicher";
        grund = `gleiche Serie und Kategorie, gemeinsam: ${schnitt.join(" ")}`;
      }
    }
    if (stufe === null) continue;
    treffer.push({ ...r, stufe, grund });
  }

  treffer.sort((a, b) => STUFEN.indexOf(a.stufe) - STUFEN.indexOf(b.stufe)
                      || a.skyId.localeCompare(b.skyId));
  return treffer;
}

/* -------------------------------------------------------------------------
 * Die Vorschau
 *
 * SIE MUSS DASSELBE SAGEN WIE `0154`, sonst ist sie eine Lüge mit
 * Fortschrittsbalken. Jede Regel hier hat ihre Entsprechung dort, und der
 * Test `merge-candidates.test.ts` liest beide Seiten.
 * ---------------------------------------------------------------------- */

/**
 * Die fachlichen Felder, die wandern können — und die der Bediener auswählt.
 *
 * `admin_note` STEHT HIER NICHT (CAT-05I). Eine interne Notiz ist keine
 * fachliche Katalogangabe, über die man Fall für Fall entscheidet; sie ist
 * Buchhaltung. `0157` verarbeitet sie bei JEDER Zusammenführung über
 * `public.merge_note()` — Zielnotiz bleibt, veraltete Importhinweise fallen
 * weg, der Rest wird einmal angehängt. Sie taucht deshalb weder im
 * Änderungsplan noch in der Tabelle auf, und eine Auswahl, die sie trotzdem
 * nennt, weist `0157` ab. Das Entfernen des Kästchens ist keine blosse
 * Anzeigeänderung.
 */
export const MERGE_FELDER = [
  "name", "display_name_override", "series_code", "category_id",
  "card_type", "item_type", "character_id", "image_override_path",
] as const;
export type MergeFeld = (typeof MERGE_FELDER)[number];

/**
 * Die generischen Vorgabewerte.
 *
 * `standard` und `figure` stehen bei vielen Entwürfen nur, weil es einen
 * Vorgabewert gibt — bei 51 von 105 liess sich die Edition nicht belegen.
 * **Ein Platzhalter ersetzt keine Angabe.**
 */
export const GENERISCH: Partial<Record<MergeFeld, string>> = {
  card_type: "standard",
  item_type: "figure",
};

export type Werte = Partial<Record<MergeFeld, string | null>>;

export type Aenderung = {
  feld: MergeFeld;
  alt: string | null;
  neu: string | null;
  /** Warum sie geschieht — oder warum sie es nicht tut. */
  grund?: string;
};

export type Vorschau = {
  aenderungen: Aenderung[];
  /** Felder, die der Entwurf hat, die aber bewusst NICHT übergehen. */
  behalten: Aenderung[];
};

const leer = (v: string | null | undefined) => v === null || v === undefined || v.trim() === "";

/**
 * Was die Zusammenführung tun wird.
 *
 * `NULL`/leer heisst „keine Information" und lässt den bisherigen Wert
 * stehen. Ein gültiger Wert wie `false` oder `0` ist KEIN leerer Wert — er
 * kommt hier als Zeichenkette `"false"` beziehungsweise `"0"` an und wird
 * übernommen wie jeder andere.
 */
export function vorschau(ziel: Werte, entwurf: Werte, zielSkyId?: string): Vorschau {
  const aenderungen: Aenderung[] = [];
  const behalten: Aenderung[] = [];

  const einfach = (feld: MergeFeld) => {
    const a = ziel[feld] ?? null;
    const b = entwurf[feld] ?? null;
    if (leer(b) || (a ?? "") === (b ?? "")) return;
    const generisch = GENERISCH[feld];
    if (generisch !== undefined && b === generisch && a !== generisch) {
      /* Ein Platzhalter gegen eine Angabe — der bisherige Wert bleibt. */
      behalten.push({ feld, alt: a, neu: b,
                      grund: "unspezifischer Wert ersetzt keinen spezifischen" });
      return;
    }
    aenderungen.push({ feld, alt: a, neu: b });
  };

  einfach("name");
  einfach("display_name_override");

  /* SERIE UND KATEGORIE IMMER GEMEINSAM — ein zusammengesetzter
     Fremdschlüssel lässt sich nicht halb setzen. */
  const sAlt = ziel.series_code ?? null, sNeu = entwurf.series_code ?? null;
  const kAlt = ziel.category_id ?? null, kNeu = entwurf.category_id ?? null;
  if (!leer(sNeu) && !leer(kNeu) && ((sAlt ?? "") !== (sNeu ?? "") || (kAlt ?? "") !== (kNeu ?? ""))) {
    aenderungen.push({ feld: "series_code", alt: sAlt, neu: sNeu });
    aenderungen.push({ feld: "category_id", alt: kAlt, neu: kNeu });
  }

  einfach("card_type");
  einfach("item_type");
  einfach("character_id");

  /*
   * DAS BILD ZIEHT IN DEN ORDNER DER ZIELFIGUR UM.
   *
   * Die Vorschau zeigt deshalb den ENDGÜLTIGEN Pfad und nicht den des
   * Entwurfs: `SKY-<Ziel>/<derselbe Hash>`. Die Aktion kopiert das Objekt
   * vorher dorthin, und `0154` nimmt nur einen Pfad an, der der Zielfigur
   * gehört. Eine Vorschau, die den alten Ordner zeigte, versprächse etwas
   * anderes, als geschieht.
   */
  const bAlt = ziel.image_override_path ?? null;
  const bNeu = entwurf.image_override_path ?? null;
  if (!leer(bNeu)) {
    const datei = bNeu!.slice(bNeu!.indexOf("/") + 1);
    const endgueltig = zielSkyId === undefined ? bNeu! : `${zielSkyId}/${datei}`;
    if (endgueltig !== (bAlt ?? "")) {
      aenderungen.push({ feld: "image_override_path", alt: bAlt, neu: endgueltig,
                         grund: "wird unter die bestehende SKY-ID kopiert" });
    }
  }

  /*
   * DIE NOTIZ STEHT HIER NICHT MEHR (CAT-05I).
   *
   * Sie war bis `0156` eine Zeile mit Kästchen. Jetzt verarbeitet `0157` sie
   * immer und unabhängig von jeder Auswahl; eine Vorschauzeile dafür wäre
   * ein Kästchen, das nichts entscheidet.
   */

  return { aenderungen, behalten };
}

/** Was die bestehende Figur in jedem Fall behält — für die Anzeige. */
export const GESCHUETZT = [
  "SKY-ID", "Slug", "Status", "Sichtbarkeit", "Preis", "Lager", "Angebote",
  "Sammlungen", "Favoriten", "Bestellungen",
] as const;

/* -------------------------------------------------------------------------
 * CAT-05F — die Änderungstabelle
 *
 * Die Vorschau rechnet FELDER; die Tabelle zeigt ZEILEN. Das ist nicht
 * dasselbe: `series_code` und `category_id` sind ein zusammengesetzter
 * Fremdschlüssel und damit eine Zeile mit einem Kästchen. Liesse man sie
 * einzeln abwählen, entstünde eine Figur in einer Kategorie einer anderen
 * Serie — `0156` weist eine halbe Auswahl deshalb ab, und die Oberfläche
 * bietet sie gar nicht erst an.
 * ---------------------------------------------------------------------- */

/** Felder, die nur gemeinsam wandern können — Schlüssel ist die Zeilen-ID. */
export const ZUSAMMEN: Record<string, readonly MergeFeld[]> = {
  series: ["series_code", "category_id"],
};

export type Tabellenzeile = {
  /** Stabile Kennung der Zeile — das ist, was angekreuzt wird. */
  id: string;
  /** Die Felder, die diese Zeile überträgt. Meist eines, bei `series` zwei. */
  felder: MergeFeld[];
  /** Die Änderungen dieser Zeile, in der Reihenfolge der Vorschau. */
  aenderungen: Aenderung[];
};

/**
 * Die Vorschau als Tabellenzeilen.
 *
 * Reihenfolge und Inhalt kommen aus `vorschau()` — hier wird nur gruppiert,
 * nichts neu entschieden. Unveränderte Felder kommen nicht vor; sie stehen
 * gar nicht in der Vorschau.
 */
export function tabellenzeilen(plan: Vorschau): Tabellenzeile[] {
  const zeilen: Tabellenzeile[] = [];
  const gruppeVon = new Map<MergeFeld, string>();
  for (const [id, felder] of Object.entries(ZUSAMMEN)) {
    for (const f of felder) gruppeVon.set(f, id);
  }

  for (const a of plan.aenderungen) {
    const id = gruppeVon.get(a.feld) ?? a.feld;
    const schon = zeilen.find((z) => z.id === id);
    if (schon) { schon.felder.push(a.feld); schon.aenderungen.push(a); }
    else zeilen.push({ id, felder: [a.feld], aenderungen: [a] });
  }
  return zeilen;
}

/**
 * Was je Feld an `0156` geschickt wird.
 *
 * **Beide Schlüssel sind immer gesetzt, auch als `null`.** Der Server
 * vergleicht mit `is distinct from` gegen jsonb-`null`; ein fehlender
 * Schlüssel wäre SQL-`NULL` und damit verschieden — also ein Abbruch, und
 * zwar ein verwirrender.
 */
export type MergeAuswahl = Record<string, { old: string | null; new: string | null }>;

/**
 * Die Nutzlast aus den angekreuzten Zeilen.
 *
 * Sie trägt die Werte, die der Bediener GESEHEN hat. `0156` benutzt sie
 * nicht zum Schreiben, sondern zum Vergleichen: stimmt sie nicht mit dem
 * überein, was der Server jetzt rechnet, bricht er ab. Die Nutzlast ist eine
 * Behauptung über den Bildschirm, keine Anweisung an die Datenbank.
 */
export function nutzlast(
  zeilen: readonly Tabellenzeile[], gewaehlt: ReadonlySet<string>,
): MergeAuswahl {
  const aus: MergeAuswahl = {};
  for (const z of zeilen) {
    if (!gewaehlt.has(z.id)) continue;
    for (const a of z.aenderungen) aus[a.feld] = { old: a.alt, new: a.neu };
  }
  return aus;
}
