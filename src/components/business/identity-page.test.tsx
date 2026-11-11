/** @vitest-environment jsdom */
/**
 * "Identität & Dokumente" (ADR-0184, AP3), rendered.
 *
 * What the page promises: the gate before any read, the old address still
 * working, one place to edit the contact e-mail (the legal panel cannot
 * overwrite it with the value it loaded), and findings, platform identity and
 * name usage shown as the model computed them. Every write is mocked.
 */
import { readFileSync } from "node:fs";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const MOCK = vi.hoisted(() => ({ policies: [] as Record<string, unknown>[], details: [] as Record<string, unknown>[] }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/lib/admin/actions", () => ({
  setShopPolicies: async (fields: Record<string, unknown>) => { MOCK.policies.push(fields); return { ok: true }; },
  setSellerDetails: async (fields: Record<string, unknown>) => { MOCK.details.push(fields); return { ok: true }; },
  setShippingCountry: async () => ({ ok: true }),
  setShippingMethod: async () => ({ ok: true }),
}));

const { ShopProfilePanel } = await import("@/components/admin/shop-profile-panel");
const { IdentityFindings, NameUsage, PlatformIdentity } = await import("./identity-overview");
const { NO_SHOP_SETTINGS } = await import("@/lib/admin/shop-profile-model");
const { buildIdentity, identityFindings, nameUsage } = await import("@/lib/identity/model");
const { SELLER_IDENTITY } = await import("@/lib/legal/seller-identity");
const { de } = await import("@/lib/i18n/de");

const SETTINGS = {
  ...NO_SHOP_SETTINGS,
  identity: {
    ...NO_SHOP_SETTINGS.identity, displayName: "skyisles.shop", legalName: "Julian Stocker",
    tradingName: "yulez.collectibles", street: "Lechhalde 1 1/2", postalCode: "87629", city: "Füssen",
    countryCode: "DE", vatId: "DE321022065",
  },
  contacts: { ...NO_SHOP_SETTINGS.contacts, contactEmail: "info@skyisles.de", replyTo: null },
};

let root: Root | null = null;
let container: HTMLElement | null = null;
beforeEach(() => { MOCK.policies = []; MOCK.details = []; });
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  container?.remove(); root = null; container = null;
});
async function mount(element: ReturnType<typeof createElement>) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => { root!.render(element); });
}
const text = () => document.body.textContent ?? "";

describe("the page", () => {
  const PAGE = readFileSync("src/app/(business)/business/profile/page.tsx", "utf8");
  const LEGAL = readFileSync("src/app/(business)/business/legal/page.tsx", "utf8");

  it("asks for the seller operator before it reads anything", () => {
    const gate = PAGE.indexOf("if (!(await canOperateSeller())) notFound();");
    expect(gate).toBeGreaterThan(-1);
    expect(PAGE.indexOf("fetchIdentity()")).toBeGreaterThan(gate);
  });

  it("reuses the existing forms, each once", () => {
    expect((PAGE.match(/<SellerSettings/g) ?? []).length).toBe(1);
    expect((PAGE.match(/<ShopProfilePanel/g) ?? []).length).toBe(1);
  });

  it("the old address leads to the legal section of the merged page, reading nothing", () => {
    expect(LEGAL).toContain('redirect("/business/profile#betreiber")');
    expect(LEGAL).not.toMatch(/fetch|rpc|createClient/);
    expect(PAGE).toContain('id="betreiber"');
  });

  it("changes nothing by itself: no action is called while rendering", () => {
    expect(PAGE).not.toMatch(/set[A-Z][A-Za-z]+\(/);
  });
});

describe("the legal panel on this page cannot overwrite the contact e-mail", () => {
  it("shows the address instead of a second input", async () => {
    await mount(createElement(ShopProfilePanel, {
      settings: SETTINGS, groups: ["contact"], heading: "B", hint: "h", contactEmailEditable: false,
    }));
    expect(document.querySelector("#c-seller")).toBeNull();
    expect(text()).toContain("info@skyisles.de");
    expect(text()).toContain(de.admin.shopProfile.sellerContactElsewhere);
  });

  it("saving the contact group leaves contactEmail out", async () => {
    await mount(createElement(ShopProfilePanel, {
      settings: SETTINGS, groups: ["contact"], heading: "B", hint: "h", contactEmailEditable: false,
    }));
    const save = [...document.querySelectorAll("button")].find((b) => b.textContent === de.admin.shopProfile.save)!;
    await act(async () => { save.click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(MOCK.policies).toHaveLength(1);
    expect(MOCK.policies[0]).not.toHaveProperty("contactEmail");
    expect(MOCK.policies[0]).toHaveProperty("withdrawalContactEmail");
  });

  it("elsewhere the panel is unchanged: the input is there and is saved", async () => {
    await mount(createElement(ShopProfilePanel, {
      settings: SETTINGS, groups: ["contact"], heading: "B", hint: "h",
    }));
    expect(document.querySelector("#c-seller")).not.toBeNull();
    const save = [...document.querySelectorAll("button")].find((b) => b.textContent === de.admin.shopProfile.save)!;
    await act(async () => { save.click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(MOCK.policies[0]).toMatchObject({ contactEmail: "info@skyisles.de" });
  });

  it("names trading_name as the former designation that is shown nowhere", async () => {
    await mount(createElement(ShopProfilePanel, {
      settings: SETTINGS, groups: ["seller"], heading: "B", hint: "h", contactEmailEditable: false,
    }));
    expect(document.querySelector("label[for=s-trading]")!.textContent).toBe("Frühere Geschäftsbezeichnung");
    expect(text()).toContain("Wird nirgends angezeigt.");
  });
});

describe("the read-only sections", () => {
  const identity = buildIdentity(SETTINGS, null);

  it("findings: the old designation and the legal pages' fixed values are named", async () => {
    await mount(createElement(IdentityFindings, { findings: identityFindings(identity, SELLER_IDENTITY) }));
    expect(text()).toContain("yulez.collectibles");
    expect(text()).toContain(de.business.identity.levels.conflict);
    expect(text()).toContain("AP5");
  });

  it("findings: nothing to report says so", async () => {
    await mount(createElement(IdentityFindings, { findings: [] }));
    expect(text()).toContain(de.business.identity.findingsNone);
  });

  it("platform: a seller who is not a platform admin is told, not shown an empty address", async () => {
    await mount(createElement(PlatformIdentity, { identity, canEdit: false }));
    expect(text()).toContain("SkyIsles");
    expect(text()).toContain(de.business.identity.platform.supportHidden);
    expect(document.querySelector('a[href="/admin"]')).toBeNull();
  });

  it("platform: an admin sees the address and where to change it", async () => {
    await mount(createElement(PlatformIdentity, {
      identity: buildIdentity(SETTINGS, { supportEmail: "support@skyisles.de" }), canEdit: true,
    }));
    expect(text()).toContain("support@skyisles.de");
    expect(document.querySelector('a[href="/admin"]')).not.toBeNull();
  });

  it("usage: every row with its value and its real source", async () => {
    const rows = nameUsage(identity, SELLER_IDENTITY);
    await mount(createElement(NameUsage, { rows }));
    expect(document.querySelectorAll("tbody tr")).toHaveLength(rows.length);
    expect(text()).toContain("sellers.display_name über seller_public()");
    expect(text()).toContain(SELLER_IDENTITY.contractingParty);
    expect(text()).toContain(de.business.identity.usage.notReadable);
  });
});
