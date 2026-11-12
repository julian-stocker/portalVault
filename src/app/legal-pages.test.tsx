/**
 * Impressum, AGB, Widerruf, Datenschutz, Versand, Kontakt and the footer,
 * rendered from the seller row (ADR-0184, AP5) — and what each shows when the
 * row cannot be used. Which version is in force is the database's answer
 * (`fetchLegalVersions()`, 0191): before 0192 it names the archived
 * 2026-09-17, after it the built 2026-11-11. Both reads are mocked; the texts
 * are real.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { cloneElement, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const STATE = vi.hoisted(() => ({ result: null as unknown, versions: null as unknown, versionReads: 0 }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));
vi.mock("@/lib/legal/load", () => ({ loadLegalTexts: async () => STATE.result }));
vi.mock("@/lib/legal/versions", async (original) => ({
  ...(await original<typeof import("@/lib/legal/versions")>()),
  fetchLegalVersions: async () => { STATE.versionReads++; return STATE.versions; },
}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
/* The Versand page also renders the configured shipping rates. */
vi.mock("@/components/legal/shipping-rates", () => ({ ShippingRates: () => null }));

const { toLegalSeller } = await import("@/lib/legal/seller-text");
const { SELLER_LEGAL_FIXTURE: F } = await import("@/test-support/seller-legal");
const { FooterSellerLine } = await import("@/components/layout/site-footer");
const { de } = await import("@/lib/i18n/de");
const ArchivedLegalPage = (await import("./(public)/rechtstexte/[slug]/[version]/page")).default;

const PAGES = {
  impressum: (await import("./(public)/impressum/page")).default,
  agb: (await import("./(public)/agb/page")).default,
  widerruf: (await import("./(public)/widerruf/page")).default,
  datenschutz: (await import("./(public)/datenschutz/page")).default,
  versand: (await import("./(public)/versand/page")).default,
  kontakt: (await import("./(public)/kontakt/page")).default,
} as const;

/**
 * The pages are server components that render async server components; this
 * resolves every ASYNC function component in the tree before the static
 * render, the way the server does. Synchronous components render as usual.
 */
async function resolve(node: ReactNode): Promise<ReactNode> {
  if (Array.isArray(node)) return Promise.all(node.map(resolve));
  if (!isValidElement(node)) return node;
  const { type, props } = node as ReactElement<{ children?: ReactNode }>;
  if (typeof type === "function" && Object.prototype.toString.call(type) === "[object AsyncFunction]") {
    return resolve(await (type as (p: unknown) => Promise<ReactNode>)(props));
  }
  if (props.children === undefined) return node;
  return cloneElement(node, undefined, await resolve(props.children));
}

const html = async (page: () => ReactNode | Promise<ReactNode>) => {
  const element = await resolve(await page());
  return element ? renderToStaticMarkup(element as ReactElement) : "";
};

const OK = { status: "ok", seller: toLegalSeller(F) };
const AFTER_0192 = { status: "ok", versions: { agb: "2026-11-11", widerruf: "2026-11-11", datenschutz: "2026-11-11", impressum: "2026-11-11" } };
const BEFORE_0192 = { status: "ok", versions: { agb: "2026-09-17", widerruf: "2026-09-17", datenschutz: "2026-09-17", impressum: "2026-09-17" } };
const VERSIONS_DOWN = { status: "unavailable", reason: "rpc_error" };
const VERSIONED = ["impressum", "agb", "widerruf", "datenschutz"] as const;
const DOWN = { status: "unavailable", cause: "unavailable", codes: ["rpc_error"] };
const INCOMPLETE = { status: "unavailable", cause: "incomplete", codes: ["legal.street"] };

beforeEach(() => { STATE.result = OK; STATE.versions = AFTER_0192; STATE.versionReads = 0; });

describe("with a complete seller row", () => {
  it.each(Object.keys(PAGES) as (keyof typeof PAGES)[])("%s names the seller from the row", async (slug) => {
    const out = await html(PAGES[slug]);
    expect(out).toContain(F.legalName);
    expect(out).not.toMatch(/yulez/i);
    expect(out).not.toContain(de.legal.unavailable.heading);
  });

  it("Impressum, AGB and footer carry the contracting party", async () => {
    const party = `${F.legalName}, handelnd unter ${F.displayName}`;
    expect(await html(PAGES.impressum)).toContain(party);
    expect(await html(PAGES.agb)).toContain(party);
    expect(await html(FooterSellerLine)).toContain(party);
  });

  it("the Impressum lists only what exists", async () => {
    const out = await html(PAGES.impressum);
    expect(out).toContain(F.vatId!);
    expect(out).not.toContain("Wirtschafts-Identifikationsnummer");
    expect(out).not.toContain("Registernummer");
    STATE.result = { status: "ok", seller: toLegalSeller({ ...F, wId: "DE123456789-00001", vatId: null }) };
    const withWId = await html(PAGES.impressum);
    expect(withWId).toContain("DE123456789-00001");
    expect(withWId).not.toContain("Umsatzsteuer-Identifikationsnummer");
  });

  it("a stored further contact channel is shown as stored, and the 'no telephone' sentences go", async () => {
    const before = await html(PAGES.impressum);
    expect(before).toContain("Es gibt keine veröffentlichte Telefonnummer");
    expect(await html(PAGES.kontakt)).toContain("Es gibt keine Telefonnummer und keine Hotline");

    STATE.result = { status: "ok", seller: toLegalSeller({ ...F, directContact: "+49 000 000 000" }) };
    const impressum = await html(PAGES.impressum);
    const kontakt = await html(PAGES.kontakt);
    for (const out of [impressum, kontakt]) {
      expect(out).toContain("Weiterer Kontakt");
      expect(out).toContain("+49 000 000 000");
      expect(out).not.toContain(de.legal.unavailable.heading);
    }
    expect(impressum).not.toContain("Es gibt keine veröffentlichte Telefonnummer");
    expect(kontakt).not.toContain("Es gibt keine Telefonnummer");
    // Nothing is said about whether it suffices, or what kind of channel it is.
    expect(impressum + kontakt).not.toMatch(/ausreichend|genügt|Telefonnummer:/);
  });

  it("each versioned page links its archived versions", async () => {
    for (const slug of ["impressum", "agb", "widerruf", "datenschutz"] as const) {
      expect(await html(PAGES[slug]), slug).toContain(`href="/rechtstexte/${slug}/2026-09-17"`);
    }
  });

  it("the Widerruf uses the withdrawal contact, the AGB the complaints contact", async () => {
    expect(await html(PAGES.widerruf)).toContain(F.withdrawalContactEmail!);
    expect(await html(PAGES.agb)).toContain(F.complaintsContactEmail!);
  });
});

describe.each([["a failed read", DOWN], ["incomplete data", INCOMPLETE],
  ["data the text does not match", { status: "unavailable", cause: "mismatch", codes: ["text.dispute"] }]])(
  "with %s", (_label, result) => {
    beforeEach(() => { STATE.result = result; });

    it.each(Object.keys(PAGES) as (keyof typeof PAGES)[])("%s shows the error state and names nobody", async (slug) => {
      const out = await html(PAGES[slug]);
      expect(out).toContain(de.legal.unavailable.heading);
      expect(out).toContain('role="alert"');
      expect(out).not.toContain(F.legalName);
      expect(out).not.toMatch(/yulez|Julian Stocker|Lechhalde/i);
    });

    it("the footer leaves the seller line out", async () => {
      expect(await html(FooterSellerLine)).toBe("");
    });

    it("the Widerruf page still leads to the online withdrawal function", async () => {
      expect(await html(PAGES.widerruf)).toContain('href="/widerrufen"');
    });
  });

describe("an archived version", () => {
  const archived = async (slug: string, version: string) =>
    (await resolve(await ArchivedLegalPage({ params: Promise.resolve({ slug, version }) }))) as ReactElement;

  it("renders the frozen text, marked as archived, whatever today's row says", async () => {
    STATE.result = DOWN;
    const out = renderToStaticMarkup(await archived("agb", "2026-09-17"));
    expect(out).toContain("Archivierte Fassung 2026-09-17");
    expect(out).toContain("Julian Stocker, handelnd unter yulez.collectibles");
    expect(out).toContain('href="/agb"');
    expect(out).not.toContain(F.legalName);
  });

  it("the archived Widerruf brings its own model form", async () => {
    const out = renderToStaticMarkup(await archived("widerruf", "2026-09-17"));
    expect(out).toContain("Unzutreffendes streichen");
    expect(out).toContain("yulez.collectibles");
  });

  it("the CURRENT version under its versioned address is built from today's row", async () => {
    STATE.result = OK;
    const out = renderToStaticMarkup(await archived("agb", "2026-11-11"));
    expect(out).toContain(`${F.legalName}, handelnd unter ${F.displayName}`);
    expect(out).not.toContain("Archivierte Fassung");
    expect(out).not.toMatch(/yulez/i);
    STATE.result = DOWN;
    expect(renderToStaticMarkup(await archived("widerruf", "2026-11-11"))).toContain(de.legal.unavailable.heading);
  });

  it("an unknown version is not found", async () => {
    await expect(archived("agb", "2025-01-01")).rejects.toThrow("NOT_FOUND");
    await expect(archived("versand", "2026-09-17")).rejects.toThrow("NOT_FOUND");
  });
});

describe("before 0192 — the database names the archived 2026-09-17", () => {
  beforeEach(() => { STATE.versions = BEFORE_0192; });
  const versioned = async (slug: string, version: string) =>
    renderToStaticMarkup((await resolve(await ArchivedLegalPage({ params: Promise.resolve({ slug, version }) }))) as ReactElement);

  it.each(VERSIONED)("/%s renders exactly the 2026-09-17 text — no banner, no seller row needed", async (slug) => {
    STATE.result = DOWN; // the built text would fail; the archived one never reads the row
    const out = await html(PAGES[slug]);
    expect(out).toContain("yulez.collectibles");
    expect(out).not.toContain(F.legalName);
    expect(out).not.toContain("Archivierte Fassung");
    expect(out).not.toContain(de.legal.unavailable.heading);
    // Its own version is not "an earlier one".
    expect(out).not.toContain(`href="/rechtstexte/${slug}/2026-09-17"`);
  });

  it("the AGB and Widerruf say which version they are", async () => {
    expect(await html(PAGES.agb)).toContain("Fassung vom 17. September 2026");
    expect(await html(PAGES.widerruf)).toContain("Fassung vom 17. September 2026");
  });

  it("the metadata is that version's too", async () => {
    const agb = await import("./(public)/agb/page");
    expect((await agb.generateMetadata()).description).toContain("17. September 2026");
    STATE.versions = AFTER_0192;
    expect((await agb.generateMetadata()).description).toContain("11. November 2026");
  });

  it("the footer leaves today's seller line out beside the archived Impressum", async () => {
    expect(await html(FooterSellerLine)).toBe("");
    STATE.versions = AFTER_0192;
    expect(await html(FooterSellerLine)).toContain(F.legalName);
  });

  it("the versioned address of the version in force carries no banner", async () => {
    const out = await versioned("agb", "2026-09-17");
    expect(out).not.toContain("Archivierte Fassung");
    expect(out).toContain("yulez.collectibles");
  });

  it("the built 2026-11-11 under its versioned address says it is not the current one", async () => {
    const out = await versioned("agb", "2026-11-11");
    expect(out).toContain(de.legal.archive.notCurrent("2026-11-11"));
    expect(out).toContain(`${F.legalName}, handelnd unter ${F.displayName}`);
    expect(out).not.toContain("Archivierte Fassung");
  });

  it("after the switch the same addresses answer with 2026-11-11, and 2026-09-17 is archived", async () => {
    STATE.versions = AFTER_0192;
    expect(await html(PAGES.agb)).toContain("Fassung vom 11. November 2026");
    expect(await versioned("agb", "2026-09-17")).toContain("Archivierte Fassung 2026-09-17");
    expect(await versioned("agb", "2026-11-11")).not.toContain(de.legal.archive.notCurrent("2026-11-11"));
  });

  it("one request reads the versions once for page and footer alike (shared via cache())", () => {
    const source = readFileSync("src/lib/legal/versions.ts", "utf8");
    expect(source).toMatch(/export const fetchLegalVersions = cache\(async/);
    expect(source).toContain("await connection();");
  });
});

describe("when the database cannot say which version is in force", () => {
  beforeEach(() => { STATE.versions = VERSIONS_DOWN; });

  it.each(VERSIONED)("/%s shows the version error and no text at all — none is guessed", async (slug) => {
    const out = await html(PAGES[slug]);
    expect(out).toContain(de.legal.unavailable.versionsHeading);
    expect(out).not.toContain(F.legalName);
    expect(out).not.toMatch(/yulez/i);
  });

  it("the versioned addresses do not claim anything either", async () => {
    for (const version of ["2026-09-17", "2026-11-11"]) {
      const out = renderToStaticMarkup((await resolve(await ArchivedLegalPage({ params: Promise.resolve({ slug: "agb", version }) }))) as ReactElement);
      expect(out, version).toContain(de.legal.unavailable.versionsHeading);
      expect(out, version).not.toContain("Archivierte Fassung");
    }
  });

  it("the footer leaves the seller line out; the Widerruf page still leads to the online function", async () => {
    expect(await html(FooterSellerLine)).toBe("");
    expect(await html(PAGES.widerruf)).toContain('href="/widerrufen"');
  });

  it("Versand and Kontakt are not versioned documents and do not depend on it", async () => {
    expect(await html(PAGES.versand)).toContain(F.legalName);
    expect(await html(PAGES.kontakt)).toContain(F.legalName);
  });
});

describe("no active use of yulez outside the archive", () => {
  /** Every shipped source file, comments removed — prose may tell history, code may not. */
  function* sources(dir: string): Generator<string> {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) yield* sources(path);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) yield path;
    }
  }
  const code = (path: string) => readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

  it("appears in no shipped code but the archive and the list that detects it", () => {
    const hits: string[] = [];
    for (const path of [...sources("src"), ...sources("supabase/functions")]) {
      if (path.startsWith(join("src", "lib", "legal", "archive"))) continue;
      if (path.startsWith("src/test-support")) continue;
      const lines = code(path).split("\n").filter((l) => /yulez/i.test(l));
      for (const line of lines) {
        if (path === join("src", "lib", "identity", "model.ts") && line.includes("RETIRED_TRADE_NAMES")) continue;
        hits.push(`${path}: ${line.trim()}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("the archive keeps it — that is history, not an identity", () => {
    expect(readFileSync("src/lib/legal/archive/2026-09-17.ts", "utf8")).toContain("handelnd unter yulez.collectibles");
  });
});
