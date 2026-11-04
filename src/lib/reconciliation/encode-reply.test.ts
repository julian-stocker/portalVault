/**
 * The upload limit is measured on the body Next actually sends.
 *
 * A server action's arguments travel through React's `encodeReply` — not
 * `JSON.stringify`. This holds `encodedBody` byte for byte against the
 * encoder installed with Next, so an upgrade that changes the wire format
 * fails here instead of slipping past the 900 KiB guard.
 */
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import { buildPreview, encodedBody, MAX_PAYLOAD_BYTES, payloadBytes } from "./preview";
import type { UploadInput } from "./server/payload";
import { sha256Text } from "./sha256";
import { ebayReport, type FixtureOrder } from "./testing/ebay-fixture";

const require = createRequire(import.meta.url);
// The client build Next itself calls in `server-action-reducer.js`.
const { encodeReply, createTemporaryReferenceSet } = require("next/dist/compiled/react-server-dom-turbopack/client.edge") as {
  encodeReply: (value: unknown, options: object) => Promise<string | FormData>;
  createTemporaryReferenceSet: () => unknown;
};

const NEXT_DEFAULT_LIMIT = 1024 * 1024; // action-handler.js: `1024 * 1024 // 1 MB`

async function wire(upload: UploadInput): Promise<string> {
  const body = await encodeReply([upload], { temporaryReferences: createTemporaryReferenceSet() });
  if (typeof body !== "string") throw new Error("encodeReply chose multipart — the size rule no longer holds");
  return body;
}

const order = (n: number, over: Partial<FixtureOrder> = {}): FixtureOrder => ({
  ref: `03-${String(n).padStart(5, "0")}-00001`, record: 2000 + n, sold: "2026-06-02",
  lines: [{ unit: 7.5, character: `Figur ${n}` }], ...over,
});

async function uploadOf(text: string): Promise<UploadInput> {
  const p = await buildPreview([{ name: "bericht.csv", size: text.length, text }], sha256Text);
  if (!p.upload) throw new Error(p.blockers.join(","));
  return p.upload;
}

describe("encodedBody is exactly what encodeReply sends", () => {
  it("for an ordinary report", async () => {
    const upload = await uploadOf(ebayReport([order(1), order(2)]));
    expect(encodedBody(upload)).toBe(await wire(upload));
  });

  it("for strings that start with $ — React escapes them, and they get longer", async () => {
    const upload = await uploadOf(ebayReport([
      order(1, { lines: [{ unit: 3, title: "$5 Rabatt Skylanders", character: "$pecial" }] }),
      order(2, { service: "$-Versand" }),
    ]));
    const body = await wire(upload);
    expect(encodedBody(upload)).toBe(body);
    expect(body).toContain('"$$5 Rabatt Skylanders"');
    expect(payloadBytes(upload)).toBeGreaterThan(new TextEncoder().encode(JSON.stringify([upload])).length);
  });

  it("for umlauts, the euro sign and emoji — counted as UTF-8 bytes", async () => {
    const upload = await uploadOf(ebayReport([order(1, { lines: [{ unit: 3, title: "Spyro Käfig € 🐉", character: "Spyro" }] })]));
    const body = await wire(upload);
    expect(encodedBody(upload)).toBe(body);
    expect(payloadBytes(upload)).toBe(Buffer.byteLength(body, "utf8"));
  });

  it("for -0, which React tags", async () => {
    const upload = await uploadOf(ebayReport([order(1)]));
    upload.files[0].report.orders[0].shipping = -0;
    expect(encodedBody(upload)).toBe(await wire(upload));
  });

  it("near the limit, the guard still leaves Next's 1 MB untouched", async () => {
    const long = "Skylanders Figur mit langem Angebotstitel ".repeat(6);
    const upload = await uploadOf(ebayReport(Array.from({ length: 720 }, (_, i) => order(i, {
      record: 3000 + i * 3, lines: [{ unit: 3, title: long, character: `Figur ${i}` }, { unit: 4, title: `$${long}`, character: `Figur ${i}b` }],
    }))));
    const bytes = Buffer.byteLength(await wire(upload), "utf8");
    expect(payloadBytes(upload)).toBe(bytes);
    expect(bytes).toBeGreaterThan(MAX_PAYLOAD_BYTES * 0.8);
    expect(MAX_PAYLOAD_BYTES).toBeLessThan(NEXT_DEFAULT_LIMIT);
  });
});
