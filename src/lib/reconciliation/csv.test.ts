import { describe, expect, it } from "vitest";
import { isEmptyRecord, parseCsv } from "./csv";

const fields = (text: string, delimiter = ";") => parseCsv(text, delimiter).records.map((r) => r.fields);

describe("parseCsv", () => {
  it("drops a UTF-8 byte order mark", () => {
    expect(fields("﻿a;b\n1;2\n")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("splits on the given delimiter only", () => {
    expect(fields("a,b;c\n")).toEqual([["a,b", "c"]]);
    expect(fields("a,b;c\n", ",")).toEqual([["a", "b;c"]]);
  });

  it("keeps a delimiter inside quotes as data", () => {
    expect(fields('"Pop Fizz; Punch";2\n')).toEqual([["Pop Fizz; Punch", "2"]]);
  });

  it("reads a doubled quote as one quote", () => {
    expect(fields('"5"" Figur";x\n')).toEqual([['5" Figur', "x"]]);
  });

  it("keeps a quote that does not open the field as data", () => {
    expect(fields('5" Figur;x\n')).toEqual([['5" Figur', "x"]]);
  });

  it("keeps a line break inside quotes and counts lines correctly", () => {
    const { records } = parseCsv('"Zeile 1\nZeile 2";b\nc;d\n', ";");
    expect(records.map((r) => r.fields)).toEqual([["Zeile 1\nZeile 2", "b"], ["c", "d"]]);
    expect(records.map((r) => r.line)).toEqual([1, 3]);
  });

  it("accepts CRLF and a lone CR as record ends", () => {
    expect(fields("a;b\r\nc;d\re;f")).toEqual([["a", "b"], ["c", "d"], ["e", "f"]]);
  });

  it("keeps empty records and does not invent one after the final line break", () => {
    expect(fields("a\n\n;;\nb\n")).toEqual([["a"], [""], ["", "", ""], ["b"]]);
  });

  it("reports an unterminated quote", () => {
    const result = parseCsv('a;"open\n', ";");
    expect(result.unterminatedQuote).toBe(true);
    expect(result.records[0].fields).toEqual(["a", "open\n"]);
  });

  it("refuses a delimiter that cannot work", () => {
    expect(() => parseCsv("a", '"')).toThrow();
    expect(() => parseCsv("a", ";;")).toThrow();
  });

  it("tells an empty record from a short one", () => {
    expect(isEmptyRecord(["", " ", ""])).toBe(true);
    expect(isEmptyRecord(["", "x"])).toBe(false);
  });
});
