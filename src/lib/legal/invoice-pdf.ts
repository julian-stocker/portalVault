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
 * PAGES. A document is a list of pages and the cursor walks down the first
 * one until the next write would cross the bottom margin — then a new page
 * starts and the write lands at its top. `reserve()` is how a caller says
 * "the next n points belong together", so a table row is never split between
 * its name and its reference line. A document that fits on one page produces
 * exactly the object numbers, the cursor positions and the bytes it produced
 * before paging existed; `invoice-pdf-pages.test.ts` holds that down.
 *
 * WHAT THIS REPLACES. There was no check at all. The cursor simply kept
 * walking: at twelve invoice lines the seller footer sat below the bottom
 * margin, and at fifteen it sat at y = -24 — off the sheet, which means the
 * total, the § 19 sentence and the issuer were missing from the document.
 * Measured, not estimated.
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
/**
 * The lowest baseline content may use. The same as the margin: a descender
 * reaches a little into it, which is what a margin is for, but no line of
 * text starts below it.
 */
const BOTTOM = MARGIN;
/** Where the cursor starts on every page. */
const TOP = PAGE_HEIGHT - MARGIN;
/**
 * Where "Seite n von m" sits — inside the bottom margin, below BOTTOM, so it
 * can never collide with content. Only drawn when there is more than one
 * page: on a single-page document nothing is added and nothing moves.
 */
const FOLIO_Y = 32;

type Font = "regular" | "bold";

/** One positioned run of text. The whole document is a list of these. */
type Run = { x: number; y: number; size: number; font: Font; text: string };

/** A horizontal rule. The only graphic an invoice needs. */
type Rule = { x1: number; x2: number; y: number };

/**
 * The characters CP1252 puts somewhere OTHER than their Unicode code point.
 *
 * WinAnsi is Latin-1 from 0xA0 upwards — there the byte IS the code point,
 * and `pdfString` uses that directly rather than listing two hundred rows.
 * What needs a table is the 0x80-0x9F block, where CP1252 keeps typographic
 * characters that Unicode puts in the 0x2000 range: the quotation marks, the
 * dashes, the ellipsis.
 *
 * The Latin-1 entries below are kept even though the range rule would now
 * produce the same byte for each. They document which characters this
 * product actually prints, and removing them would make the table look like
 * it covers less than it does.
 *
 * The two spaces at the end are the one deliberate exception to "the byte is
 * the code point": a no-break space and a narrow no-break space are both
 * flattened to an ordinary space, because the line is being drawn, not
 * typeset, and a reader that lacks the glyph would show a box.
 */
const WINANSI: Record<string, number> = {
  "ä": 0xe4, "ö": 0xf6, "ü": 0xfc,
  "Ä": 0xc4, "Ö": 0xd6, "Ü": 0xdc,
  "ß": 0xdf,
  "é": 0xe9, "è": 0xe8, "ê": 0xea,
  "§": 0xa7, "°": 0xb0, "«": 0xab, "»": 0xbb,
  "„": 0x84, "“": 0x93, "”": 0x94,
  "–": 0x96, "—": 0x97, "’": 0x92, "‘": 0x91,
  /*
   * U+2026, and it was missing. `truncate()` in `invoice.ts` appends it to
   * any item name over 46 characters, so every long name ended in a question
   * mark: "Hot Streak mit Zubehör, originalverpackt (ori?" — seen on a
   * rendered sample, not deduced.
   */
  "…": 0x85,
  " ": 0x20, " ": 0x20,
};

/** A PDF string literal: WinAnsi bytes, with the three reserved ones escaped. */
function pdfString(text: string): string {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 63;
    let byte: number;
    if (code < 0x80) byte = code;
    /* The table first, so the two spaces keep their deliberate flattening. */
    else if (WINANSI[char] !== undefined) byte = WINANSI[char];
    /*
     * CP1252 IS LATIN-1 FROM 0xA0 UP — the byte is the code point.
     *
     * This replaces a question mark for every accented character the old
     * table did not happen to list. It was found through `·` (U+00B7), which
     * stands between the three parts of the sender line on EVERY invoice this
     * product has ever issued and rendered as "Julian Stocker ? Lechhalde
     * 1 1/2 ? 87629 Füssen". The same gap would have hit any customer named
     * Nuñez or Lefèvre, and any catalog name with an accent.
     *
     * Not a guess: every entry the table already holds in this range maps to
     * its own code point, so this rule produces exactly what they produce.
     */
    else if (code >= 0xa0 && code <= 0xff) byte = code;
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

/** A finished page: what was drawn on it, in drawing order. */
type Sheet = { runs: Run[]; rules: Rule[] };

/**
 * A document under construction. `y` walks down from the top margin, and down
 * onto the next page when it runs out of room.
 *
 * The name is historical — it was one page once, and renaming it would touch
 * every caller for nothing.
 */
export class PdfPage {
  /** Pages already finished, in order. */
  private sheets: Sheet[] = [];
  private runs: Run[] = [];
  private rules: Rule[] = [];
  y = TOP;

  get left(): number {
    return MARGIN;
  }
  get right(): number {
    return PAGE_WIDTH - MARGIN;
  }

  /** How many pages the document has so far, the one in progress included. */
  get pages(): number {
    return this.sheets.length + 1;
  }

  /**
   * Keep the next `height` points together.
   *
   * Call it before a group of writes that must not be split — a table row and
   * its second line, a heading and the row under it. If the group fits, this
   * does NOTHING AT ALL: no cursor movement, no run, no byte. That is what
   * lets a short document keep its exact previous output.
   */
  reserve(height: number): void {
    if (this.y - height < BOTTOM) this.nextPage();
  }

  /** Begin a new page. Ignored while the current one is still empty. */
  nextPage(): void {
    if (this.empty) return;
    this.sheets.push({ runs: this.runs, rules: this.rules });
    this.runs = [];
    this.rules = [];
    this.y = TOP;
  }

  /**
   * Move the cursor down by `dy` and answer where to draw.
   *
   * If that would cross the floor, a new page starts and the write lands at
   * its top margin instead — the `dy` is spent on the break, not added to the
   * new page, because leading between two lines means nothing across a page
   * boundary.
   *
   * An empty page never breaks. Otherwise a single item taller than a sheet
   * would push pages forever and draw nothing.
   */
  private get empty(): boolean {
    return this.runs.length === 0 && this.rules.length === 0;
  }

  private place(dy: number): number {
    /*
     * NO LEADING BEFORE THE FIRST THING ON A PAGE.
     *
     * `dy` is the space between this line and the one above it, and at the
     * top of a page there is no line above it. Without this, a page the
     * cursor arrived at through `reserve()` began 15 points lower than page
     * one — visible as an uneven top margin when the two sheets are held
     * side by side, and measured at y = 770,89 against 785,89.
     *
     * The break path below already worked this way: it returns the top
     * margin and spends the `dy` on the break. This makes the two paths the
     * same rule instead of two.
     */
    if (this.empty) return this.y;

    const next = this.y - dy;
    if (next < BOTTOM) {
      this.nextPage();
      return this.y;
    }
    this.y = next;
    return this.y;
  }

  text(text: string, options: { x?: number; size?: number; font?: Font; dy?: number } = {}): void {
    const { x = MARGIN, size = 10, font = "regular", dy = 0 } = options;
    this.runs.push({ x, y: this.place(dy), size, font, text });
  }

  /** Right-aligned against `x`. Used for every amount. */
  textRight(text: string, x: number, options: { size?: number; font?: Font; dy?: number } = {}) {
    const { size = 10, font = "regular", dy = 0 } = options;
    this.runs.push({ x: x - textWidth(text, size, font), y: this.place(dy), size, font, text });
  }

  rule(dy = 8): void {
    /*
     * EINE TRENNLINIE AM KOPF EINER SEITE TRENNT NICHTS.
     *
     * Dieselbe Regel wie beim Vorlauf, und sie wurde auf demselben Weg
     * gefunden: bei zwölf Positionen wechselt die Summenstaffel auf Seite
     * zwei, und deren erste Anweisung ist `rule(14)`. Die Linie landete dann
     * bündig am oberen Rand und sah aus wie ein Seitenrahmen, während der
     * erste Text fünfzehn Punkte darunter begann.
     *
     * Ohne sie beginnt die Seite mit ihrem ersten Wort, am oberen Rand, wie
     * jede andere Seite auch.
     */
    if (this.empty) return;
    const y = this.place(dy);
    this.rules.push({ x1: MARGIN, x2: PAGE_WIDTH - MARGIN, y });
  }

  /**
   * Pure cursor movement — no break.
   *
   * A gap is leading before something, and breaking here would start a page
   * whose first line then sits a gap further down than it should. The next
   * write is what notices it has no room, and it lands at the top margin.
   */
  gap(dy: number): void {
    /* Same rule: a gap before the first thing on a page is a gap before
       nothing. This is what actually moved the item rows down on page two,
       because a row begins with `gap(15)`. */
    if (this.empty) return;
    this.y -= dy;
  }

  private static content(sheet: Sheet): string {
    const parts: string[] = ["0.6 w"];
    for (const rule of sheet.rules) {
      parts.push(`0.8 0.8 0.8 RG ${rule.x1} ${rule.y} m ${rule.x2} ${rule.y} l S`);
    }
    parts.push("0 0 0 rg");
    for (const run of sheet.runs) {
      const font = run.font === "bold" ? "/F2" : "/F1";
      parts.push(`BT ${font} ${run.size} Tf 1 0 0 1 ${run.x} ${run.y} Tm (${pdfString(run.text)}) Tj ET`);
    }
    return parts.join("\n");
  }

  /**
   * Assemble the file.
   *
   * OBJECT NUMBERING IS CHOSEN SO ONE PAGE STAYS ONE PAGE, BYTE FOR BYTE:
   *
   *     1            Catalog
   *     2            Pages
   *     3 … 2+n      the n Page objects
   *     3+n … 2+2n   their content streams
   *     3+2n         /F1          3+2n+1  /F2        3+2n+2  Info
   *
   * With n = 1 that is 1,2,3,4,5,6,7 — the same seven objects, in the same
   * order, with the same references as before paging existed.
   *
   * Byte offsets in the cross-reference table must be exact, so the objects
   * are concatenated first and their positions measured as they go — a PDF
   * whose xref is one byte out opens in some readers and not others, which is
   * the worst possible failure for a document somebody has to keep.
   */
  render(title: string, stamp?: string): Uint8Array {
    const sheets: Sheet[] = [...this.sheets, { runs: this.runs, rules: this.rules }];
    const count = sheets.length;

    /*
     * „Seite n von m" — at render time, because a page cannot know how many
     * follow it. It sits in the bottom margin, below the content floor, so it
     * collides with nothing.
     *
     * WITHOUT A STAMP it appears only on a multi-page document, and a
     * single-page one is untouched — the rule the invoice has always had.
     *
     * WITH A STAMP it appears on EVERY page, the stamp in front of it. A
     * receipt that is kept for ten years should carry its number on each
     * sheet, so a page that gets separated from the others can still be
     * identified. The invoice passes no stamp and is unaffected.
     */
    if (count > 1 || stamp !== undefined) {
      sheets.forEach((sheet, index) => {
        const page = `Seite ${index + 1} von ${count}`;
        const label = stamp === undefined ? page : `${stamp} · ${page}`;
        sheet.runs.push({
          x: PAGE_WIDTH - MARGIN - textWidth(label, 8, "regular"),
          y: FOLIO_Y, size: 8, font: "regular", text: label,
        });
      });
    }

    const firstPage = 3;
    const firstStream = firstPage + count;
    const fontRegular = firstStream + count;
    const fontBold = fontRegular + 1;
    const info = fontBold + 1;

    const kids = sheets.map((_, i) => `${firstPage + i} 0 R`).join(" ");

    const objects: string[] = [
      "<< /Type /Catalog /Pages 2 0 R /Lang (de-DE) >>",
      `<< /Type /Pages /Kids [${kids}] /Count ${count} >>`,
    ];

    for (let i = 0; i < count; i += 1) {
      objects.push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
          `/Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >> ` +
          `/Contents ${firstStream + i} 0 R >>`,
      );
    }

    for (const sheet of sheets) {
      const stream = PdfPage.content(sheet);
      /*
       * `/Length` IS THE LATIN-1 BYTE COUNT, NOT THE UTF-8 ONE.
       *
       * This used to read `new TextEncoder().encode(stream).length`, and that
       * was wrong: the file is written one byte per character at the end of
       * this method, while `TextEncoder` returns two bytes for every
       * character above U+007F. Every invoice with an umlaut therefore
       * declared a stream longer than it was — six bytes too many on a
       * measured example.
       *
       * THE FIRST VERSION OF THIS COMMENT NAMED THE WRONG CAUSE. It blamed
       * `Füssen`, `Musterstraße` and "two `·`". The middle dots contributed
       * NOTHING: at the time they were not in the table at all and came out
       * as `?`, one ASCII byte. Counting the stream showed six non-ASCII
       * characters and they were `§`, `ß`, `ä` and `ü`. The number was right
       * and the reason was wrong, which is worse than no reason.
       *
       * Readers that trust `endstream` survived it; one that trusts `/Length`
       * reads past the stream. `pdfString` has already mapped every
       * character into a single WinAnsi byte, so the character count IS the
       * byte count.
       */
      objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    }

    objects.push(
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
      `<< /Title (${pdfString(title)}) /Producer (SkyIsles) >>`,
    );

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
      `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${info} 0 R >>\n` +
      `startxref\n${xrefAt}\n%%EOF\n`;

    // Latin-1 out: every byte was already mapped to WinAnsi above, so the
    // string is byte-for-byte what the file must contain.
    const full = body + xref + trailer;
    const bytes = new Uint8Array(full.length);
    for (let i = 0; i < full.length; i += 1) bytes[i] = full.charCodeAt(i) & 0xff;
    return bytes;
  }
}
