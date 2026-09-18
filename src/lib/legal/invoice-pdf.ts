/**
 * The invoice as a PDF, written by hand (ADR-0086).
 *
 * WHY NO LIBRARY
 *
 * This repository has five runtime dependencies. A PDF toolkit would be the
 * sixth and by far the largest, pulled in to lay out one page of text in two
 * fonts — and it would have to run in a serverless function on every download.
 * A single-page invoice needs a catalogue, a page, a content stream and two of
 * the fourteen fonts every PDF reader already has. That is a couple of hundred
 * lines, it is all here, and it has no supply chain.
 *
 * WHAT A HAND-WRITTEN PDF CANNOT DO, SAID PLAINLY
 *
 * It is not a tagged PDF. There is no structure tree, so a screen reader gets
 * a sequence of text runs rather than a marked-up table. What it does carry is
 * `/Lang (de-DE)`, a real document title, and text that extracts and searches
 * in reading order — not an image of a page.
 *
 * That limitation is why the PDF is the *second* route to the invoice, not the
 * only one: `/rechnung/<nummer>` renders the same figures as an ordinary
 * accessible HTML page with a real `<table>`, and the PDF is offered beside it
 * for filing and printing. Anyone who cannot use the PDF has lost nothing.
 *
 * ENCODING. Base-14 Helvetica with WinAnsiEncoding, which covers German
 * umlauts, ß and the euro sign. Anything outside it becomes `?` rather than
 * silently corrupting the byte stream — and `€` is written as `EUR` in the
 * figures anyway, because the euro sign sits at a different code point in
 * WinAnsi than in Unicode and one mis-mapped glyph on an invoice is a defect.
 */

/** A4 in PostScript points. */
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 56;

type Font = "regular" | "bold";

/** One positioned run of text. The whole document is a list of these. */
type Run = { x: number; y: number; size: number; font: Font; text: string };

/** A horizontal rule. The only graphic an invoice needs. */
type Rule = { x1: number; x2: number; y: number };

/**
 * WinAnsi (CP1252) for the characters German invoices actually contain.
 * Everything in ASCII maps to itself; the rest is listed because guessing is
 * how a `ü` becomes two bytes of nonsense.
 */
const WINANSI: Record<string, number> = {
  "ä": 0xe4, "ö": 0xf6, "ü": 0xfc,
  "Ä": 0xc4, "Ö": 0xd6, "Ü": 0xdc,
  "ß": 0xdf,
  "é": 0xe9, "è": 0xe8, "ê": 0xea,
  "§": 0xa7, "°": 0xb0, "«": 0xab, "»": 0xbb,
  "„": 0x84, "“": 0x93, "”": 0x94,
  "–": 0x96, "—": 0x97, "’": 0x92, "‘": 0x91,
  " ": 0x20, " ": 0x20,
};

/** A PDF string literal: WinAnsi bytes, with the three reserved ones escaped. */
function pdfString(text: string): string {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 63;
    let byte: number;
    if (code < 0x80) byte = code;
    else if (WINANSI[char] !== undefined) byte = WINANSI[char];
    else byte = 0x3f; // "?" — visible, rather than a broken stream.

    const literal = String.fromCharCode(byte);
    if (literal === "(" || literal === ")" || literal === "\\") out += `\\${literal}`;
    else out += literal;
  }
  return out;
}

/** Helvetica advance widths, /1000 em. Enough to right-align a column. */
const WIDTHS_REGULAR: Record<string, number> = {
  " ": 278, "!": 278, '"': 355, "#": 556, "$": 556, "%": 889, "&": 667, "'": 191,
  "(": 333, ")": 333, "*": 389, "+": 584, ",": 278, "-": 333, ".": 278, "/": 278,
  "0": 556, "1": 556, "2": 556, "3": 556, "4": 556, "5": 556, "6": 556, "7": 556,
  "8": 556, "9": 556, ":": 278, ";": 278, "<": 584, "=": 584, ">": 584, "?": 556,
};

/**
 * How wide a string is at a given size.
 *
 * Only digits, spaces and punctuation are measured precisely, because the only
 * thing that has to line up on this page is a column of amounts. Letters fall
 * back to a fair average — a name that is a point or two off the ideal is not
 * a defect; a total that does not right-align is.
 */
function textWidth(text: string, size: number, font: Font): number {
  let units = 0;
  for (const char of text) {
    const known = WIDTHS_REGULAR[char];
    units += known ?? (char === char.toUpperCase() && /[A-Z]/.test(char) ? 667 : 545);
  }
  return (units / 1000) * size * (font === "bold" ? 1.04 : 1);
}

/** A page under construction. `y` walks down from the top margin. */
export class PdfPage {
  private runs: Run[] = [];
  private rules: Rule[] = [];
  y = PAGE_HEIGHT - MARGIN;

  get left(): number {
    return MARGIN;
  }
  get right(): number {
    return PAGE_WIDTH - MARGIN;
  }

  text(text: string, options: { x?: number; size?: number; font?: Font; dy?: number } = {}): void {
    const { x = MARGIN, size = 10, font = "regular", dy = 0 } = options;
    this.y -= dy;
    this.runs.push({ x, y: this.y, size, font, text });
  }

  /** Right-aligned against `x`. Used for every amount. */
  textRight(text: string, x: number, options: { size?: number; font?: Font; dy?: number } = {}) {
    const { size = 10, font = "regular", dy = 0 } = options;
    this.y -= dy;
    this.runs.push({ x: x - textWidth(text, size, font), y: this.y, size, font, text });
  }

  rule(dy = 8): void {
    this.y -= dy;
    this.rules.push({ x1: MARGIN, x2: PAGE_WIDTH - MARGIN, y: this.y });
  }

  gap(dy: number): void {
    this.y -= dy;
  }

  private content(): string {
    const parts: string[] = ["0.6 w"];
    for (const rule of this.rules) {
      parts.push(`0.8 0.8 0.8 RG ${rule.x1} ${rule.y} m ${rule.x2} ${rule.y} l S`);
    }
    parts.push("0 0 0 rg");
    for (const run of this.runs) {
      const font = run.font === "bold" ? "/F2" : "/F1";
      parts.push(`BT ${font} ${run.size} Tf 1 0 0 1 ${run.x} ${run.y} Tm (${pdfString(run.text)}) Tj ET`);
    }
    return parts.join("\n");
  }

  /**
   * Assemble the file.
   *
   * Byte offsets in the cross-reference table must be exact, so the objects are
   * concatenated first and their positions measured as they go — a PDF whose
   * xref is one byte out opens in some readers and not others, which is the
   * worst possible failure for a document somebody has to keep.
   */
  render(title: string): Uint8Array {
    const stream = this.content();
    const streamBytes = new TextEncoder().encode(stream).length;

    const objects = [
      "<< /Type /Catalog /Pages 2 0 R /Lang (de-DE) >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
        "/Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>",
      `<< /Length ${streamBytes} >>\nstream\n${stream}\nendstream`,
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
      `<< /Title (${pdfString(title)}) /Producer (SkyIsles) >>`,
    ];

    let body = "%PDF-1.4\n";
    const offsets: number[] = [];
    objects.forEach((object, index) => {
      offsets.push(body.length);
      body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });

    const xrefAt = body.length;
    let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) {
      xref += `${offset.toString().padStart(10, "0")} 00000 n \n`;
    }

    const trailer =
      `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${objects.length} 0 R >>\n` +
      `startxref\n${xrefAt}\n%%EOF\n`;

    // Latin-1 out: every byte was already mapped to WinAnsi above, so the
    // string is byte-for-byte what the file must contain.
    const full = body + xref + trailer;
    const bytes = new Uint8Array(full.length);
    for (let i = 0; i < full.length; i += 1) bytes[i] = full.charCodeAt(i) & 0xff;
    return bytes;
  }
}
