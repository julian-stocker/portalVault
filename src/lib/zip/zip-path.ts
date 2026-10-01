/**
 * Welcher Pfad in ein Archiv darf.
 *
 * WARUM DAS EIN EIGENES MODUL IST. Ein Archiv ist eine Anweisung an ein
 * fremdes Programm, Dateien anzulegen — und die klassische Lücke („Zip
 * Slip") ist ein Eintrag wie `../../.ssh/authorized_keys`, den ein
 * gutgläubiger Entpacker außerhalb des Zielordners schreibt. Der Schreiber
 * darf so einen Eintrag gar nicht erst erzeugen, unabhängig davon, wer ihn
 * mit welchen Daten füttert.
 *
 * ABLEHNEN STATT REPARIEREN. Ein Pfad wird nicht zurechtgebogen, sondern
 * zurückgewiesen. Stillschweigendes Normalisieren erzeugt zwei Wahrheiten
 * darüber, wie die Datei heißt — und irgendwann schreibt der eine Teil
 * `a//b` und der andere sucht `a/b`.
 */

export class ZipPathError extends Error {
  readonly path: string;

  constructor(path: string, reason: string) {
    // Der Pfad stammt vom Aufrufer, nicht aus den Daten — er darf in die
    // Meldung.
    super(`Ungültiger Archivpfad ${JSON.stringify(path)}: ${reason}`);
    this.name = "ZipPathError";
    this.path = path;
  }
}

/** ZIP speichert die Namenslänge in 16 Bit. */
const MAX_NAME_BYTES = 0xffff;

/** Steuerzeichen und NUL — in einem Dateinamen hat beides nichts zu suchen. */
const CONTROL_CHARS = new RegExp("[\\u0000-\\u001f\\u007f]");

/**
 * Prüft einen Pfad und gibt ihn unverändert zurück.
 *
 * Erlaubt ist ein relativer Pfad aus `/`-getrennten Segmenten. Alles
 * andere fliegt.
 */
export function assertSafeZipPath(path: string): string {
  const bad = (reason: string): never => {
    throw new ZipPathError(path, reason);
  };

  if (path === "") bad("leer");
  if (CONTROL_CHARS.test(path)) bad("enthält ein Steuerzeichen oder NUL");

  // Ein Backslash ist unter Windows ein Trenner. Ein Entpacker, der ihn so
  // liest, käme über einen Aufstieg nach oben — deshalb gar nicht zulassen.
  if (path.includes("\\")) bad("enthält einen Backslash");

  if (path.startsWith("/")) bad("ist absolut");
  if (/^[A-Za-z]:/.test(path)) bad("beginnt mit einem Laufwerksbuchstaben");
  if (path.endsWith("/")) bad("endet auf einen Trenner (Verzeichnisse werden nicht geschrieben)");

  for (const segment of path.split("/")) {
    if (segment === "") bad("enthält ein leeres Segment");
    if (segment === ".") bad("enthält ein Punktsegment");
    if (segment === "..") bad("enthält einen Aufstieg (..)");
  }

  if (new TextEncoder().encode(path).length > MAX_NAME_BYTES) {
    bad(`ist länger als ${MAX_NAME_BYTES} Bytes`);
  }

  return path;
}

/** Ob ein Pfad zulässig wäre — für Aufrufer, die nicht werfen wollen. */
export function isSafeZipPath(path: string): boolean {
  try {
    assertSafeZipPath(path);
    return true;
  } catch {
    return false;
  }
}
