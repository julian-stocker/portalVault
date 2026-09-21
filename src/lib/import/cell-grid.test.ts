import { describe, expect, it } from "vitest";

import { cellAt, readCellGrid, unescapeXml } from "./cell-grid";

const sheet = (rows: string) => `<sheetData>${rows}</sheetData>`;

describe("empty cells do not swallow their neighbours", () => {
  /**
   * THE REGRESSION THIS FILE EXISTS FOR.
   *
   * `Order 2026!4` is the header row of both order blocks and looks like
   * this: some populated cells, several empty ones, then `K4` holding
   * `Datum`. A combined `(?:\/>|>...)` alternation loses `K4` entirely — and
   * losing it loses the first sale group's date, which quietly moved fifty
   * dated 2026 sales into the reconstructed opening balance.
   */
  it("reads a populated cell that follows an empty one", () => {
    const grid = readCellGrid(sheet(
      `<row r="4">`
      + `<c r="A4" s="28" t="s"><v>0</v></c>`
      + `<c r="D4" s="6"/>`
      + `<c r="E4" s="6"/>`
      + `<c r="K4" s="28" t="s"><v>1</v></c>`
      + `</row>`), ["Date", "Datum"]);

    expect(cellAt(grid, 4, "A").value).toBe("Date");
    expect(cellAt(grid, 4, "K").value).toBe("Datum");
    expect([...grid.get(4)!.keys()]).toEqual(["A", "D", "E", "K"]);
  });

  it("keeps an empty cell distinguishable from an absent one", () => {
    const grid = readCellGrid(sheet(`<row r="7"><c r="B7" s="1"/></row>`), []);
    expect(grid.get(7)!.has("B")).toBe(true);
    expect(cellAt(grid, 7, "B").value).toBe("");
    expect(grid.get(7)!.has("C")).toBe(false);
    expect(cellAt(grid, 7, "C").value).toBe("");
  });

  it("survives a run of empty cells between two values", () => {
    const empties = ["C", "D", "E", "F", "G", "H", "I", "J"]
      .map((column) => `<c r="${column}9" s="6"/>`).join("");
    const grid = readCellGrid(sheet(
      `<row r="9"><c r="B9" t="s"><v>0</v></c>${empties}<c r="K9" t="s"><v>1</v></c></row>`),
      ["links", "rechts"]);
    expect(cellAt(grid, 9, "B").value).toBe("links");
    expect(cellAt(grid, 9, "K").value).toBe("rechts");
  });

  it("does not let a self-closing row swallow the next one", () => {
    const grid = readCellGrid(sheet(
      `<row r="2" s="1"/><row r="3"><c r="A3" t="s"><v>0</v></c></row>`), ["hier"]);
    expect(grid.get(2)!.size).toBe(0);
    expect(cellAt(grid, 3, "A").value).toBe("hier");
  });
});

describe("what a cell carries", () => {
  it("keeps the formula and the cached value apart", () => {
    const grid = readCellGrid(sheet(
      `<row r="5"><c r="P5"><f>T!I124</f><v>3.49</v></c></row>`), []);
    expect(cellAt(grid, 5, "P")).toEqual({ formula: "T!I124", value: "3.49" });
  });

  it("resolves a shared string and leaves a number alone", () => {
    const grid = readCellGrid(sheet(
      `<row r="5"><c r="O5" t="s"><v>2</v></c><c r="K5"><v>46023</v></c></row>`),
      ["a", "b", "Kaos"]);
    expect(cellAt(grid, 5, "O").value).toBe("Kaos");
    expect(cellAt(grid, 5, "K").value).toBe("46023");
  });

  it("reads an inline string", () => {
    const grid = readCellGrid(sheet(
      `<row r="5"><c r="A5" t="inlineStr"><is><t>Datum</t></is></c></row>`), []);
    expect(cellAt(grid, 5, "A").value).toBe("Datum");
  });

  it("unescapes entities in both the value and the formula", () => {
    const grid = readCellGrid(sheet(
      `<row r="2"><c r="K2"><f>COUNTIF(K5:K10,"&gt;=1")</f><v>291</v></c></row>`), []);
    expect(cellAt(grid, 2, "K").formula).toBe('COUNTIF(K5:K10,">=1")');
  });

  it("turns the ampersand back last, so &amp;lt; stays text", () => {
    expect(unescapeXml("&amp;lt;")).toBe("&lt;");
    expect(unescapeXml("a &lt; b &amp;&amp; c")).toBe("a < b && c");
  });

  it("ignores a row without a number", () => {
    expect(readCellGrid(sheet(`<row><c r="A1"><v>1</v></c></row>`), []).size).toBe(0);
  });
});
