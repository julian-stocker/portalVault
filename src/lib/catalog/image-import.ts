/**
 * CAT-04E — welches Bild an welche Figur darf, und welches nicht.
 *
 * WARUM DAS EIN MODUL IST UND KEIN WERKZEUG
 *
 * Der Bildimport lädt Bytes in einen öffentlichen Bucket und schreibt eine
 * Spalte. Beides ist schwer rückgängig zu machen: ein veröffentlichtes Objekt
 * ist veröffentlicht, und ein überschriebenes Adminbild ist fort. Die
 * Entscheidung, ob ein Bild überhaupt angefasst wird, gehört deshalb dorthin,
 * wo ein Testlauf sie durchspielen kann — nicht in ein Skript, das man nur
 * ausführen kann, um es zu prüfen.
 *
 * `tools/cat04-image-import.mts` ist die dünne Hülle darum: sie holt die
 * Figuren, liest die Bytes und tut, was `entscheide()` sagt.
 *
 * DIE REGELN DER PIPELINE WERDEN NICHT NACHGEBAUT, sondern benutzt:
 * `sniffImage()` und `imagePathFor()` sind dieselben Funktionen, die die
 * Adminoberfläche beim Hochladen verwendet (`src/lib/admin/image-file.ts`).
 * Eine zweite Fassung derselben Regel wäre eine zweite Wahrheit.
 */
/*
 * RELATIV UND MIT `.ts`, nicht ueber den `@/`-Alias: `tools/cat05-bilder.mts`
 * laedt diese Datei unter schlichtem Node, und Node kennt den Alias nicht.
 * Dieselbe Regel wie bei `src/lib/catalog/character.ts`.
 */
import { imagePathFor, MAX_IMAGE_BYTES, sniffImage } from "../admin/image-file.ts";

/** Eine Zeile des Bildmanifests aus CAT-04D. */
export type Bildzeile = {
  entwurf: string;
  katalogname: string;
  series_code: string;
  medium: string;
  sha256_16: string;
  /** `eindeutig` · `mehrdeutig` · `fehlt` */
  zuordnung: string;
};

/** Eine Katalogzeile, so weit der Bildimport sie braucht. */
export type Figur = {
  sky_id: string;
  name: string;
  series_code: string;
  image_override_path: string | null;
};

export type Uebersprungen =
  | "mehrdeutig"
  | "ausgeschlossen"
  | "ohne_sky_id"
  | "hat_schon_ein_bild";

export type Fehler = "format_unbekannt" | "zu_gross" | "hash_weicht_ab" | "keine_bytes";

export type Entscheidung =
  | { art: "hochladen"; skyId: string; pfad: string; bytes: number }
  | { art: "uebersprungen"; grund: Uebersprungen; skyId: string | null }
  | { art: "fehler"; grund: Fehler; skyId: string | null; text: string };

/**
 * Entwürfe, die NIE automatisch ein Bild bekommen — namentlich.
 *
 * Alle drei sind im Manifest schon `mehrdeutig`, die Liste ist also ein
 * ZWEITER Riegel und kein erster. Sie steht hier, weil eine spätere
 * Änderung am Manifest-Werkzeug die Einstufung verschieben könnte, ohne dass
 * jemand an diese drei denkt:
 *
 *   Mobile Hot Streak        teilt sein Bild mit dem GEWÖHNLICHEN
 *                            „Hot Streak" — das wäre das Standardbild für
 *                            eine Variante, und genau das soll nie passieren.
 *   Blue Chest (…Tiki…)      beide Truhen teilen eine Abbildung; welche sie
 *   Blue Chest (…Mines…)     zeigt, entscheidet kein Werkzeug.
 */
export const NIE_AUTOMATISCH: readonly string[] = [
  "Mobile Hot Streak",
  "Blue Chest (Cursed Tiki Temple)",
  "Blue Chest (Lost Imaginite Mines)",
];

/** Unicode falten — dieselbe Regel wie im Abgleich, nur für den Namensschlüssel. */
export function falte(s: string): string {
  return s.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase()
    .replace(/['’`]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

/** Der Schlüssel, unter dem Manifest und Katalog sich treffen. */
export function schluessel(name: string, serie: string): string {
  return `${falte(name)}|${serie}`;
}

/**
 * Die SKY-ID wird GESUCHT, nie gerechnet.
 *
 * Fünf Entwürfe nacheinander anzulegen ergibt nicht fünf fortlaufende IDs:
 * `sky_id_seq` zieht auch bei einem abgebrochenen Lauf weiter, und zwischen
 * zwei Läufen kann jemand anderes eine Figur anlegen (ADR-0070 nennt die
 * Lücke ausdrücklich beabsichtigt). Wer hier `erste + i` rechnete, bebilderte
 * irgendwann die falsche Figur.
 */
export function figurFuer(
  zeile: Bildzeile,
  figuren: readonly Figur[],
): Figur | null {
  const gesucht = schluessel(zeile.katalogname, zeile.series_code);
  const treffer = figuren.filter((f) => schluessel(f.name, f.series_code) === gesucht);
  /* ZWEI TREFFER SIND KEINE IDENTITÄT. Dann ist unklar, welche Figur gemeint
     ist, und der Import lässt beide in Ruhe. */
  return treffer.length === 1 ? treffer[0] : null;
}

/**
 * Was mit dieser Zeile geschieht — die einzige Stelle, die das entscheidet.
 *
 * `bytes` ist `null`, solange niemand die Datei gelesen hat; dann kann die
 * Entscheidung nur „überspringen" lauten oder ein Fehler sein. Der Probelauf
 * ruft dieselbe Funktion mit denselben Bytes wie der echte Lauf — es gibt
 * keinen zweiten Entscheidungsweg, der im Ernstfall anders abbiegt.
 */
export function entscheide(
  zeile: Bildzeile,
  figuren: readonly Figur[],
  bytes: Uint8Array | null,
): Entscheidung {
  if (zeile.zuordnung !== "eindeutig") {
    return { art: "uebersprungen", grund: "mehrdeutig", skyId: null };
  }
  if (NIE_AUTOMATISCH.includes(zeile.katalogname)) {
    return { art: "uebersprungen", grund: "ausgeschlossen", skyId: null };
  }

  const figur = figurFuer(zeile, figuren);
  if (figur === null) {
    return { art: "uebersprungen", grund: "ohne_sky_id", skyId: null };
  }

  /* DER WIEDEREINSTIEG. Was schon ein Bild hat, wird nie angefasst — auch
     dann nicht, wenn es ein anderes ist als unseres. Die Spalte gehört dem
     Admin (ADR-0039). */
  if (figur.image_override_path) {
    return { art: "uebersprungen", grund: "hat_schon_ein_bild", skyId: figur.sky_id };
  }

  if (bytes === null || bytes.length === 0) {
    return { art: "fehler", grund: "keine_bytes", skyId: figur.sky_id,
             text: `${zeile.medium} konnte nicht gelesen werden` };
  }
  if (bytes.length > MAX_IMAGE_BYTES) {
    return { art: "fehler", grund: "zu_gross", skyId: figur.sky_id,
             text: `${bytes.length} Bytes, erlaubt sind ${MAX_IMAGE_BYTES}` };
  }

  /* DIE BYTES ENTSCHEIDEN, nicht der Dateiname — dieselbe Regel wie beim
     Upload über die Oberfläche. */
  const art = sniffImage(bytes);
  if (art === null) {
    return { art: "fehler", grund: "format_unbekannt", skyId: figur.sky_id,
             text: `${zeile.medium} ist weder PNG, JPEG noch WebP` };
  }

  const pfad = imagePathFor(figur.sky_id, bytes, art);

  /*
   * DIE PRÜFSUMME IST DER ABGLEICH ZWISCHEN MANIFEST UND DATEI.
   *
   * `imagePathFor` bildet den Pfad aus `sha256(bytes)`; die ersten 16 Zeichen
   * davon stehen auch im Manifest. Stimmen sie nicht überein, ist die Datei
   * eine andere als die, die CAT-04D zugeordnet hat — dann wird NICHT
   * hochgeladen, sondern angehalten.
   */
  const hash = pfad.slice(pfad.indexOf("/") + 1, pfad.lastIndexOf("."));
  if (hash !== zeile.sha256_16) {
    return { art: "fehler", grund: "hash_weicht_ab", skyId: figur.sky_id,
             text: `Datei hat ${hash}, das Manifest nennt ${zeile.sha256_16}` };
  }

  return { art: "hochladen", skyId: figur.sky_id, pfad, bytes: bytes.length };
}

/**
 * Der Plan für einen ganzen Lauf, als Zahlen.
 *
 * Er sagt NICHT, ob hochgeladen werden darf — das entscheidet die Freigabe
 * in der Hülle. Er sagt nur, was zu tun wäre.
 */
export type Plan = {
  hochladen: number;
  uebersprungen: Record<Uebersprungen, number>;
  fehler: Record<Fehler, number>;
};

export function fasseZusammen(entscheidungen: readonly Entscheidung[]): Plan {
  const plan: Plan = {
    hochladen: 0,
    uebersprungen: { mehrdeutig: 0, ausgeschlossen: 0, ohne_sky_id: 0, hat_schon_ein_bild: 0 },
    fehler: { format_unbekannt: 0, zu_gross: 0, hash_weicht_ab: 0, keine_bytes: 0 },
  };
  for (const e of entscheidungen) {
    if (e.art === "hochladen") plan.hochladen += 1;
    else if (e.art === "uebersprungen") plan.uebersprungen[e.grund] += 1;
    else plan.fehler[e.grund] += 1;
  }
  return plan;
}

/**
 * Darf dieser Lauf wirklich hochladen?
 *
 * ZWEI FLAGGEN, UND SIE SAGEN VERSCHIEDENES. `--upload` ist die Absicht,
 * `--rechte-geklaert` die Zusage, dass die Nutzungsrechte an den Bildern der
 * fremden Checkliste geklärt sind. Der Bucket `catalog` ist öffentlich
 * lesbar; ein Upload ist damit eine Veröffentlichung, und die zweite Flagge
 * ist genau die Aussage, die das verantwortet.
 *
 * Fehlt eine von beiden, ist der Lauf ein Probelauf — das ist der Standard
 * und kein Sonderfall.
 */
export function darfHochladen(argv: readonly string[]): boolean {
  return argv.includes("--upload") && argv.includes("--rechte-geklaert");
}
