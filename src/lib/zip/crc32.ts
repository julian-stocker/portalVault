/**
 * CRC32, wie ZIP sie verlangt.
 *
 * Das ist die gewöhnliche CRC-32/ISO-HDLC: Polynom `0xEDB88320` in
 * rückwärts laufender Schreibweise, Vorbesetzung und Endverknüpfung mit
 * `0xFFFFFFFF`. Genau diese Variante steht in jedem lokalen Dateikopf und
 * im zentralen Verzeichnis eines ZIP — ein Entpacker prüft damit, ob die
 * Bytes heil angekommen sind.
 *
 * Tabellengetrieben, weil die Alternative bei ein paar Megabyte spürbar
 * langsamer ist und die Tabelle 1 KB kostet. Sie wird einmal beim ersten
 * Aufruf gebaut, nicht beim Laden des Moduls.
 *
 * `>>> 0` an jeder Stelle, an der ein Ergebnis das Modul verlässt: in
 * JavaScript sind bitweise Operationen VORZEICHENBEHAFTET, und ohne diese
 * Verschiebung käme für jede zweite Datei eine negative Zahl heraus, die
 * `setUint32` dann still falsch schreibt.
 */

let table: Uint32Array | null = null;

function crcTable(): Uint32Array {
  if (table) return table;
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  table = t;
  return t;
}

/** Die Prüfsumme über einen Block. */
export function crc32(bytes: Uint8Array): number {
  const t = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
