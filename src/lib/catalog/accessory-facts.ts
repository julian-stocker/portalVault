/**
 * Was sich über ein Zubehörteil aus den vorhandenen Daten SAGEN lässt.
 *
 * Zwei Angaben, beide ABGELEITET und keine gespeichert:
 *
 *   Plattform   nur bei Spielen. Steht im ROHNAMEN — `Spiel für Xbox One`,
 *               `Wii U Spiel`, `Game (Nintendo 3DS)`.
 *   Modell      nur bei Portalen. Ist der Rohname ohne die Serienklammer —
 *               `84709790 (SF)` → `84709790`.
 *
 * ---------------------------------------------------------------------------
 * WARUM ABGELEITET UND NICHT GESPEICHERT
 *
 * ADR-0128 hatte Spalten `platforms` und `model_no` vorgesehen und sie dann
 * NICHT gebaut: beides steht in Spalte B der Arbeitsmappe und damit im
 * Namen, und eine Spalte ohne Leser veraltet. Dieses Modul ist der Leser —
 * es schreibt nichts, es ändert keinen Namen, und es korrigiert keinen
 * (CLAUDE.md Regel 4).
 *
 * UND SIE WIRD AUS DEM ROHNAMEN GEZOGEN, NICHT AUS DEM ANZEIGENAMEN.
 * Die 39 Spiele tragen heute alle einen redaktionellen Anzeigenamen der Form
 * `Skylanders Giants – PS3`, aus dem sich die Plattform bequemer lesen
 * liesse. Aber ein Anzeigename gehört dem Adminbereich und darf sich ändern
 * (ADR-0039); der Rohname ist Quelldatum und ändert sich nie. Eine Ableitung
 * hängt an dem, was stabil ist.
 *
 * KEIN TREFFER HEISST KEINE ANGABE. Es wird nie geraten: steht im Namen
 * keine bekannte Plattform, bleibt das Feld leer. Lieber eine Zeile ohne
 * Plattform als eine mit der falschen.
 * ---------------------------------------------------------------------------
 */
import { itemTypeOf } from "@/lib/catalog/item-type";

/**
 * Die bekannten Plattformen, LÄNGSTE ZUERST.
 *
 * Die Reihenfolge ist die ganze Logik: `Wii U` muss vor `Wii` stehen, sonst
 * wird aus `Wii U Spiel` ein Wii-Spiel. Und `Playstation 3` vor `PS3`, damit
 * `Spiel für Sony Playstation 3 PS3` nur einmal trifft.
 *
 * Links das Wort, wie es im Rohnamen steht; rechts das Etikett, wie es auf
 * dem Schirm erscheint. Zwei Schreibweisen derselben Plattform teilen sich
 * ein Etikett — `Playstation 4` und `PS4` sind dasselbe Gerät.
 */
const PLATTFORMEN: readonly (readonly [string, string])[] = [
  ["Nintendo Switch", "Nintendo Switch"],
  ["Nintendo 3DS", "Nintendo 3DS"],
  ["Xbox 360", "Xbox 360"],
  ["Xbox One", "Xbox One"],
  ["Playstation 4", "PS4"],
  ["Playstation 3", "PS3"],
  ["PS4", "PS4"],
  ["PS3", "PS3"],
  ["Wii U", "Wii U"],
  ["Wii", "Wii"],
  ["PC", "PC"],
];

/** Alle Etiketten, ohne Doppelung, in der Reihenfolge von oben. */
export const PLATFORM_LABELS: readonly string[] =
  [...new Set(PLATTFORMEN.map(([, label]) => label))];

/**
 * Steht das Wort als eigenes Wort im Namen?
 *
 * `PC` darf nicht in `PCX` treffen und `Wii` nicht in `Wiings`. Geprüft wird
 * deshalb an beiden Enden auf ein Zeichen, das kein Buchstabe und keine
 * Ziffer ist — Klammern und Leerzeichen zählen als Grenze, und damit trifft
 * `Game (PC)` genauso wie `Wii Spiel`.
 */
function alsWort(haystack: string, needle: string): boolean {
  const i = haystack.toLowerCase().indexOf(needle.toLowerCase());
  if (i === -1) return false;
  const davor = i === 0 ? "" : haystack[i - 1];
  const danach = haystack[i + needle.length] ?? "";
  const grenze = (c: string) => c === "" || !/[a-z0-9]/i.test(c);
  return grenze(davor) && grenze(danach);
}

/**
 * Die Plattform eines SPIELS, oder null.
 *
 * Für ein Portal immer null: die Arbeitsmappe führt zwar Plattformköpfe über
 * den Portalzeilen, aber ADR-0128 hält fest, dass die eine Lesehilfe sind
 * und keine nachgewiesene Kompatibilität — und gespeichert ist davon nichts.
 * Etwas anzuzeigen, das nirgends steht, wäre eine Erfindung.
 */
export function platformOf(item: { itemType?: string | null; canonicalName: string }):
  string | null {
  if (itemTypeOf(item) !== "game") return null;
  for (const [wort, etikett] of PLATTFORMEN) {
    if (alsWort(item.canonicalName, wort)) return etikett;
  }
  return null;
}

/**
 * Die Modellnummer eines PORTALS, oder null.
 *
 * Der Rohname ohne die Serienklammer am Ende: `84709790 (SF)` → `84709790`,
 * `83973080A Wireless (SA)` → `83973080A Wireless`. Rein strukturell, kein
 * Muster über den Inhalt — was vor der letzten Klammer steht, ist das
 * Modell, und steht dort keine Klammer, gibt es keine Angabe.
 */
export function modelOf(item: { itemType?: string | null; canonicalName: string }):
  string | null {
  if (itemTypeOf(item) !== "portal") return null;
  const treffer = /^(.+?)\s*\([^()]*\)\s*$/.exec(item.canonicalName);
  const modell = treffer?.[1]?.trim();
  return modell === undefined || modell === "" ? null : modell;
}

/**
 * Die eine Angabe, die neben Art und Serie in der Zeile steht.
 *
 * Ein Spiel zeigt seine Plattform, ein Portal seine Modellnummer — beides
 * ist dasselbe Feld in der Zeile, weil es dieselbe Frage beantwortet:
 * „welches genau?".
 */
export function accessoryDetail(item: { itemType?: string | null; canonicalName: string }):
  string | null {
  return platformOf(item) ?? modelOf(item);
}

/**
 * Welche Plattformen in einer Menge vorkommen, in der Reihenfolge von oben.
 *
 * Damit die Plattformauswahl nur anbietet, was es gibt.
 */
export function platformsPresent(
  items: readonly { itemType?: string | null; canonicalName: string }[],
): string[] {
  const seen = new Set(items.map(platformOf).filter((p): p is string => p !== null));
  return PLATFORM_LABELS.filter((label) => seen.has(label));
}

/**
 * ALLE Serien, denen ein Artikel zugeordnet ist — nicht nur die eine.
 *
 * DER FALL, UM DEN ES GEHT: `SKY-0637` heisst `84721790 (SF, T, SC)`. Die
 * Arbeitsmappe ordnet dieses Portal drei Serien zu; `skylanders.series_code`
 * ist aber einwertig und trägt einen Fremdschlüssel, also steht dort `SF`
 * (Entscheidung des Betreibers, ADR-0128). Die vollständige Zuordnung blieb
 * bewusst im ROHNAMEN — `series_scope` wurde nicht gebaut, weil es dort
 * schon steht.
 *
 * Diese Funktion liest sie von dort. Wer im Zubehörkatalog „Trap Team"
 * wählt, bekommt das Portal zu sehen, das für Trap Team gilt — auch wenn es
 * unter `SF` eingeordnet ist. Das ist die fachlich richtige Behandlung einer
 * Mehrfachzuordnung, und sie kostet keine Spalte.
 *
 * ---------------------------------------------------------------------------
 * GERATEN WIRD NICHTS. Drei Riegel:
 *
 *   1. Nur PORTALE. Ein Spiel heisst `Game (PC)`, und `PC` ist keine Serie —
 *      die Klammer eines Spiels trägt die Plattform, nicht die Zuordnung.
 *   2. Jeder Eintrag der Klammer muss ein BEKANNTER Seriencode sein. Die
 *      Liste kommt vom Aufrufer aus `fetchSeries()`, nicht aus dieser Datei.
 *   3. ALLES ODER NICHTS. Passt auch nur ein Eintrag nicht, gilt allein
 *      `series_code`. Eine halb verstandene Klammer ist keine Zuordnung.
 *
 * Die eingeordnete Serie ist immer dabei, auch wenn die Klammer sie nicht
 * nennt: sie ist die gespeicherte Wahrheit, und die wird nicht überstimmt.
 * ---------------------------------------------------------------------------
 */
export function seriesScopeOf(
  item: { itemType?: string | null; canonicalName: string; seriesCode: string },
  knownCodes: ReadonlySet<string>,
): string[] {
  const eigen = [item.seriesCode];
  if (itemTypeOf(item) !== "portal") return eigen;

  const klammer = /\(([^()]*)\)\s*$/.exec(item.canonicalName)?.[1];
  if (klammer === undefined) return eigen;

  const codes = klammer.split(",").map((t) => t.trim()).filter((t) => t !== "");
  if (codes.length === 0) return eigen;
  if (!codes.every((c) => knownCodes.has(c))) return eigen;

  /* Reihenfolge: die eingeordnete Serie zuerst, dann die übrigen der
     Klammer. Doppelte fallen weg. */
  return [...new Set([item.seriesCode, ...codes])];
}

/** Gehört der Artikel zu dieser Serie — als Einordnung oder laut Klammer? */
export function inSeries(
  item: { itemType?: string | null; canonicalName: string; seriesCode: string },
  code: string,
  knownCodes: ReadonlySet<string>,
): boolean {
  return seriesScopeOf(item, knownCodes).includes(code);
}
