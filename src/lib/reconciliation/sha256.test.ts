import { createHash, webcrypto } from "node:crypto";

import { describe, expect, it } from "vitest";

import { fileFingerprint } from "./dedupe";
import { sha256, sha256Bytes, sha256Text } from "./sha256";

const node = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

describe("the pure SHA-256", () => {
  it("matches the published test vectors (FIPS 180-4 examples)", () => {
    expect(sha256Text("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Text("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Text("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"))
      .toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
    expect(sha256Text("a".repeat(1_000_000)))
      .toBe("cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
  });

  it("equals node:crypto at every padding boundary and beyond", () => {
    for (const n of [1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 1000, 4097]) {
      const text = Array.from({ length: n }, (_, i) => String.fromCharCode(33 + ((i * 7) % 90))).join("");
      expect(sha256Text(text), String(n)).toBe(node(text));
    }
  });

  it("hashes UTF-8, not UTF-16 — umlauts, the euro sign, the BOM, emoji", () => {
    for (const text of ["Käufer", "12,99 €", "﻿Verkaufsprotokollnummer", "Spyro 🐉", "ß\r\n"]) {
      expect(sha256Text(text), text).toBe(node(text));
    }
  });

  it("works on raw bytes", () => {
    expect(sha256Bytes(new Uint8Array([0x61, 0x62, 0x63]))).toBe(node("abc"));
  });

  it("is always 64 lowercase hex digits — the shape the server demands", () => {
    expect(sha256Text("x")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("the browser entry point", () => {
  const text = "﻿eine Zeile;mit € und Umlaut ä\r\n";

  it("without crypto.subtle (an http page on a phone) it falls back to the pure one", async () => {
    expect(await sha256(text, undefined)).toBe(node(text));
  });

  it("with crypto.subtle it gives the same digest", async () => {
    expect(await sha256(text, webcrypto.subtle as never)).toBe(node(text));
  });

  it("the file fingerprint is the same either way", async () => {
    const withSubtle = await fileFingerprint(text, (t) => sha256(t, webcrypto.subtle as never));
    const without = await fileFingerprint(text, (t) => sha256(t, undefined));
    expect(withSubtle).toBe(without);
    expect(without).toBe(node("eine Zeile;mit € und Umlaut ä\n"));
  });
});
