/**
 * Ein ZIP schreiben, ohne Abhängigkeit und ohne das Archiv zu kennen.
 *
 * WAS DIESES MODUL NICHT WEISS: was SkyIsles ist, was ein Backup ist, was
 * eine Tabelle ist, wer es aufruft. Pfade und Bytes hinein, ZIP-Blöcke
 * hinaus. Alles Fachliche steht anderswo, und das ist der Grund, warum
 * dieses Modul für sich prüfbar ist.
 *
 * KEINE NEUE ABHÄNGIGKEIT. Komprimiert wird mit `CompressionStream
 * ("deflate-raw")` aus der Laufzeit — das Gegenstück zu dem
 * `DecompressionStream`, mit dem `src/lib/import/xlsx-reader.ts` seit
 * ADR-0087 Arbeitsmappen liest. Dieselbe Familie, dieselbe Laufzeit, in
 * beide Richtungen geprüft.
 *
 * GESTREAMT, NICHT GEPUFFERT. `zipStream()` ist ein asynchroner Generator
 * und gibt Block für Block aus: je Eintrag den lokalen Kopf und die Daten,
 * am Ende das zentrale Verzeichnis. Im Speicher liegt damit **ein Eintrag**,
 * nicht das Archiv. Ein späterer HTTP-Download kann daraus unmittelbar eine
 * Antwort bauen, ohne dass das fertige ZIP je vollständig existiert.
 * `zipBytes()` ist der bequeme Sonderfall für Tests und kleine Archive.
 *
 * WARUM JEDER EINTRAG DOCH EINMAL GANZ IM SPEICHER LIEGT: der lokale
 * Dateikopf trägt CRC32 und beide Größen, und er steht VOR den Daten. Wer
 * das umgehen will, braucht Data Descriptors — eine Zusatzfunktion, an der
 * ältere Entpacker gelegentlich scheitern. Ein Eintrag nach dem anderen ist
 * der ehrlichere Handel: die Grenze ist die größte Einzeldatei, nicht die
 * Summe.
 *
 * DETERMINISTISCH. Kein `Date.now()`, keine Zufallswerte. Ohne
 * ausdrückliche Zeitangabe trägt jeder Eintrag den DOS-Nullpunkt, also
 * ergeben gleiche Eingaben Byte für Byte dasselbe Archiv. Wer eine echte
 * Zeit will, gibt sie mit.
 *
 * KEIN ZIP64. Die Felder für Größe und Versatz sind 32 Bit breit. Statt bei
 * 4 GB still falsche Zahlen zu schreiben, wirft dieses Modul — siehe
 * `ZipLimitError`. Zip64 wäre die nächste Ausbaustufe, falls ein Archiv
 * jemals dorthin wächst.
 */
import { crc32 } from "./crc32";
import { assertSafeZipPath } from "./zip-path";

/** Eine Datei, die ins Archiv soll. */
export type ZipEntry = {
  /** Relativer Pfad im Archiv, `/`-getrennt. Wird geprüft, nie repariert. */
  path: string;
  /** Der Inhalt. Leer ist erlaubt. */
  bytes: Uint8Array;
};

export type ZipOptions = {
  /**
   * Der Zeitstempel für alle Einträge. Ohne Angabe der DOS-Nullpunkt
   * (1980-01-01 00:00), damit die Ausgabe deterministisch bleibt.
   */
  modifiedAt?: Date;
  /**
   * Ob komprimiert wird. `false` legt die Bytes unverändert ab (Methode
   * `store`) — nützlich für bereits komprimierte Daten wie WebP, wo Deflate
   * nur Rechenzeit kostet.
   */
  compress?: boolean;
};

export class ZipLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipLimitError";
  }
}

/* ZIP kennt Größen und Versätze nur in 32 Bit. */
const MAX_32 = 0xffffffff;

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

/** Bit 11: der Dateiname ist UTF-8 und nicht CP437. */
const FLAG_UTF8 = 0x0800;

/** Ohne eigene Zeitangabe: der früheste Zeitpunkt, den DOS kennt. */
const DOS_EPOCH = new Date(Date.UTC(1980, 0, 1, 0, 0, 0));

/**
 * Datum und Uhrzeit im DOS-Format, zwei 16-Bit-Wörter.
 *
 * Sekunden haben zwei Bit weniger, als sie bräuchten — DOS zählt sie in
 * Zweierschritten. Das ist keine Ungenauigkeit dieses Moduls, sondern des
 * Formats von 1980.
 */
function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getUTCFullYear());
  return {
    time:
      (date.getUTCHours() << 11) |
      (date.getUTCMinutes() << 5) |
      (Math.floor(date.getUTCSeconds() / 2) & 0x1f),
    date: ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
  };
}

/** `deflate-raw` über die Laufzeit. Genau das, was ZIP als Methode 8 erwartet. */
async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream()
    .pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

type Placed = {
  path: string;
  nameBytes: Uint8Array;
  crc: number;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
};

function localHeader(e: Placed, when: { time: number; date: number }): Uint8Array {
  const head = new Uint8Array(30 + e.nameBytes.length);
  const view = new DataView(head.buffer);
  view.setUint32(0, SIG_LOCAL, true);
  view.setUint16(4, 20, true);                 // benötigte Version: 2.0
  view.setUint16(6, FLAG_UTF8, true);
  view.setUint16(8, e.method, true);
  view.setUint16(10, when.time, true);
  view.setUint16(12, when.date, true);
  view.setUint32(14, e.crc, true);
  view.setUint32(18, e.compressedSize, true);
  view.setUint32(22, e.uncompressedSize, true);
  view.setUint16(26, e.nameBytes.length, true);
  view.setUint16(28, 0, true);                 // kein Extrafeld
  head.set(e.nameBytes, 30);
  return head;
}

function centralEntry(e: Placed, when: { time: number; date: number }): Uint8Array {
  const head = new Uint8Array(46 + e.nameBytes.length);
  const view = new DataView(head.buffer);
  view.setUint32(0, SIG_CENTRAL, true);
  view.setUint16(4, 20, true);                 // erzeugt von Version 2.0
  view.setUint16(6, 20, true);                 // benötigt Version 2.0
  view.setUint16(8, FLAG_UTF8, true);
  view.setUint16(10, e.method, true);
  view.setUint16(12, when.time, true);
  view.setUint16(14, when.date, true);
  view.setUint32(16, e.crc, true);
  view.setUint32(20, e.compressedSize, true);
  view.setUint32(24, e.uncompressedSize, true);
  view.setUint16(28, e.nameBytes.length, true);
  view.setUint16(30, 0, true);                 // Extrafeld
  view.setUint16(32, 0, true);                 // Kommentar
  view.setUint16(34, 0, true);                 // Datenträger
  view.setUint16(36, 0, true);                 // interne Attribute
  view.setUint32(38, 0, true);                 // externe Attribute
  view.setUint32(42, e.localHeaderOffset, true);
  head.set(e.nameBytes, 46);
  return head;
}

function endOfCentralDirectory(count: number, size: number, offset: number): Uint8Array {
  const tail = new Uint8Array(22);
  const view = new DataView(tail.buffer);
  view.setUint32(0, SIG_EOCD, true);
  view.setUint16(4, 0, true);                  // dieser Datenträger
  view.setUint16(6, 0, true);                  // Datenträger mit Verzeichnisbeginn
  view.setUint16(8, count, true);
  view.setUint16(10, count, true);
  view.setUint32(12, size, true);
  view.setUint32(16, offset, true);
  view.setUint16(20, 0, true);                 // kein Archivkommentar
  return tail;
}

/**
 * Das Archiv als Folge von Blöcken.
 *
 * Reihenfolge der Ausgabe ist die Reihenfolge der Einträge — der Aufrufer
 * bestimmt sie, dieses Modul sortiert nicht um.
 */
/**
 * Woher die Einträge kommen.
 *
 * Ein Array geht weiter wie bisher — es IST ein `Iterable`. Zusätzlich wird
 * ein `AsyncIterable` angenommen, und das ist der Grund für diese Erweiterung:
 * der Plattform-Export legt Storage-Dateien ins Archiv, und die müssen nicht
 * alle gleichzeitig im Speicher liegen. `zipStream` sieht jeden Eintrag genau
 * einmal und behält danach nur seine Kopfdaten (Pfad, CRC, Größen, Offset) für
 * das zentrale Verzeichnis. Mit einer faulen Quelle ist der Spitzenbedarf
 * damit EIN Eintrag, nicht das ganze Archiv.
 */
export type ZipEntrySource = Iterable<ZipEntry> | AsyncIterable<ZipEntry>;

export async function* zipStream(
  entries: ZipEntrySource,
  options: ZipOptions = {},
): AsyncGenerator<Uint8Array, void, undefined> {
  const when = dosDateTime(options.modifiedAt ?? DOS_EPOCH);
  const compress = options.compress ?? true;
  const encoder = new TextEncoder();

  const seen = new Set<string>();
  const placed: Placed[] = [];
  let offset = 0;

  for await (const entry of entries) {
    const path = assertSafeZipPath(entry.path);
    if (seen.has(path)) {
      // Zwei Einträge desselben Namens: welcher gilt, entscheidet dann der
      // Entpacker. Das ist keine Frage, die ein Archiv offen lassen darf.
      throw new ZipLimitError(`Doppelter Archivpfad: ${JSON.stringify(path)}`);
    }
    seen.add(path);

    const nameBytes = encoder.encode(path);
    const uncompressedSize = entry.bytes.length;

    /*
     * Komprimiert wird nur, wenn es etwas bringt. Deflate macht bereits
     * komprimierte Bytes gern ein paar Prozent größer; dann wird gespeichert.
     * Eine leere Datei wird nie deflatiert — manche Entpacker stolpern über
     * einen Deflate-Block ohne Inhalt.
     */
    let method = METHOD_STORE;
    let payload = entry.bytes;
    if (compress && uncompressedSize > 0) {
      const deflated = await deflateRaw(entry.bytes);
      if (deflated.length < uncompressedSize) {
        method = METHOD_DEFLATE;
        payload = deflated;
      }
    }

    if (uncompressedSize > MAX_32 || payload.length > MAX_32) {
      throw new ZipLimitError(
        `${path} überschreitet die 32-Bit-Grenze von ZIP. Dafür bräuchte es Zip64.`,
      );
    }

    const record: Placed = {
      path,
      nameBytes,
      crc: crc32(entry.bytes),
      method,
      compressedSize: payload.length,
      uncompressedSize,
      localHeaderOffset: offset,
    };

    const head = localHeader(record, when);
    offset += head.length + payload.length;
    if (offset > MAX_32) {
      throw new ZipLimitError("Das Archiv überschreitet 4 GB. Dafür bräuchte es Zip64.");
    }

    placed.push(record);
    yield head;
    if (payload.length > 0) yield payload;
  }

  const directoryOffset = offset;
  let directorySize = 0;
  for (const record of placed) {
    const block = centralEntry(record, when);
    directorySize += block.length;
    yield block;
  }

  if (directoryOffset + directorySize > MAX_32) {
    throw new ZipLimitError("Das zentrale Verzeichnis liegt jenseits von 4 GB.");
  }

  yield endOfCentralDirectory(placed.length, directorySize, directoryOffset);
}

/** Dasselbe Archiv in einem Stück. Für Tests und kleine Archive. */
export async function zipBytes(
  entries: ZipEntrySource,
  options: ZipOptions = {},
): Promise<Uint8Array> {
  const blocks: Uint8Array[] = [];
  let total = 0;
  for await (const block of zipStream(entries, options)) {
    blocks.push(block);
    total += block.length;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const block of blocks) {
    out.set(block, at);
    at += block.length;
  }
  return out;
}
