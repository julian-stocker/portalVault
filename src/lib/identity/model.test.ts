/**
 * The identity model (ADR-0184, AP2): three identities, required fields,
 * conflicts — and where each name really comes from.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { NO_SHOP_SETTINGS, type ShopSettings } from "@/lib/admin/shop-profile-model";
import { SELLER_IDENTITY } from "@/lib/legal/seller-identity";
import {
  PLATFORM_NAME, RETIRED_TRADE_NAMES, buildIdentity, identityFindings, nameUsage,
  type PublishedIdentity,
} from "./model";

/** A complete seller row as `admin_shop_profile()` would describe it. */
function settings(over: {
  identity?: Partial<ShopSettings["identity"]>;
  contacts?: Partial<ShopSettings["contacts"]>;
} = {}): ShopSettings {
  return {
    ...NO_SHOP_SETTINGS,
    identity: {
      ...NO_SHOP_SETTINGS.identity,
      displayName: "skyisles.shop", legalName: "Julian Stocker", legalForm: "Einzelunternehmen",
      street: "Lechhalde 1 1/2", postalCode: "87629", city: "Füssen", countryCode: "DE",
      vatId: "DE321022065", tradingName: null, ...over.identity,
    },
    contacts: { ...NO_SHOP_SETTINGS.contacts, contactEmail: "info@skyisles.de", replyTo: "info@skyisles.de", ...over.contacts },
  };
}

/** The legal pages as they will read once they follow the data. */
const ALIGNED: PublishedIdentity = {
  legalName: "Julian Stocker", tradeName: "skyisles.shop",
  contractingParty: "Julian Stocker, handelnd unter skyisles.shop",
  street: "Lechhalde 1 1/2", postalCode: "87629", city: "Füssen",
  email: "info@skyisles.de", vatId: "DE321022065",
};
/** The legal pages as they read today. */
const TODAY: PublishedIdentity = { ...SELLER_IDENTITY };

const codes = (list: { code: string }[]) => list.map((f) => f.code);

describe("three identities, never one field", () => {
  it("keeps platform, shop and legal seller apart", () => {
    const id = buildIdentity(settings(), { supportEmail: "support@skyisles.de" });
    expect(id.platform).toEqual({ name: "SkyIsles", supportEmail: "support@skyisles.de", supportReadable: true });
    expect(id.shop.displayName).toBe("skyisles.shop");
    expect(id.legal.legalName).toBe("Julian Stocker");
    /* The brand is not the legal seller, and the platform is not the brand. */
    expect(id.shop.displayName).not.toBe(id.legal.legalName);
    expect(id.platform.name).not.toBe(id.shop.displayName);
  });

  it("the platform name is the one the legal pages use today", () => {
    expect(PLATFORM_NAME).toBe(SELLER_IDENTITY.platformName);
  });

  it("a viewer who may not read platform settings sees that, not an empty address", () => {
    const id = buildIdentity(settings(), null);
    expect(id.platform.supportReadable).toBe(false);
    expect(id.platform.supportEmail).toBeNull();
  });

  it("the reply address falls back to the contact e-mail, as send-order-mail does", () => {
    expect(buildIdentity(settings({ contacts: { replyTo: null } }), null).shop.effectiveReplyTo)
      .toBe("info@skyisles.de");
    const mail = readFileSync("supabase/functions/send-order-mail/index.ts", "utf8");
    expect(mail).toContain("settings.transactional_reply_to ?? contactEmail");
  });

  it("shows the tax flag as stored and assumes nothing", () => {
    const stored = { ...settings(), policies: { ...NO_SHOP_SETTINGS.policies, smallBusiness19: false } };
    expect(buildIdentity(stored, null).legal.smallBusiness19).toBe(false);
  });
});

describe("findings", () => {
  it("a complete, aligned identity has nothing to report", () => {
    expect(identityFindings(buildIdentity(settings(), null), ALIGNED)).toEqual([]);
  });

  it("reports every required field that is missing — and only those", () => {
    const empty = buildIdentity(NO_SHOP_SETTINGS, null);
    expect(codes(identityFindings(empty, ALIGNED).filter((f) => f.level === "missing"))).toEqual([
      "shop.displayName", "legal.legalName", "legal.street", "legal.postalCode",
      "legal.city", "legal.countryCode", "shop.contactEmail",
    ]);
    /* Tax and register details are never demanded: whether they exist is not assumed. */
    const noTax = buildIdentity(settings({ identity: { vatId: null, registerCourt: null } }), null);
    expect(identityFindings(noTax, { ...ALIGNED, vatId: "" }).filter((f) => f.level === "missing")).toEqual([]);
  });

  it("flags a retired identity still in use as the shop name", () => {
    const old = buildIdentity(settings({ identity: { displayName: "yulez.collectibles" } }), null);
    expect(codes(identityFindings(old, { ...ALIGNED, tradeName: "yulez.collectibles" }))).toContain("shop.retired");
    expect(RETIRED_TRADE_NAMES).toContain("yulez.collectibles");
  });

  it("a different trading_name is a conflict: two business designations", () => {
    const two = buildIdentity(settings({ identity: { tradingName: "yulez.collectibles" } }), null);
    const finding = identityFindings(two, ALIGNED).find((f) => f.code === "legal.legacyTradingName")!;
    expect(finding.level).toBe("conflict");
    expect(finding.message).toContain("yulez.collectibles");
    expect(finding.message).toContain("leeren");
  });

  it("the same trading_name is only a notice", () => {
    const same = buildIdentity(settings({ identity: { tradingName: "SkyIsles.shop" } }), null);
    expect(identityFindings(same, ALIGNED).find((f) => f.code === "legal.legacyTradingName")!.level).toBe("notice");
  });

  it("names every field in which the published legal pages disagree with the data", () => {
    const id = buildIdentity(settings({
      identity: { legalName: "J. Stocker", street: "Andere Straße 2", vatId: "DE000000000" },
      contacts: { contactEmail: "hallo@skyisles.shop" },
    }), null);
    expect(codes(identityFindings(id, ALIGNED))).toEqual(expect.arrayContaining([
      "published.legalName", "published.address", "published.email", "published.vatId",
    ]));
  });

  it("today: the legal pages still name yulez.collectibles — said, not hidden", () => {
    const finding = identityFindings(buildIdentity(settings(), null), TODAY)
      .find((f) => f.code === "published.tradeName")!;
    expect(finding.level).toBe("conflict");
    expect(finding.message).toContain(SELLER_IDENTITY.contractingParty);
    expect(finding.message).toContain("skyisles.shop");
  });

  it("platform and shop must not carry the same name", () => {
    const merged = buildIdentity(settings({ identity: { displayName: "SkyIsles" } }), null);
    expect(codes(identityFindings(merged, { ...ALIGNED, tradeName: "SkyIsles" }))).toContain("shop.equalsPlatform");
  });

  it("a missing own reply address is a notice", () => {
    const id = buildIdentity(settings({ contacts: { replyTo: null } }), null);
    expect(identityFindings(id, ALIGNED).map((f) => [f.code, f.level])).toEqual([["shop.replyTo", "notice"]]);
  });
});

describe("Wo erscheint welcher Name?", () => {
  const rows = nameUsage(buildIdentity(settings({ identity: { tradingName: "yulez.collectibles" } }), null), TODAY);
  const row = (area: string) => rows.find((r) => r.area.startsWith(area))!;

  it("shop, mails and new invoices show the shop brand from the seller row", () => {
    expect(row("Shop, Katalog").shows).toBe("skyisles.shop");
    expect(row("Kundenmails: Anrede").shows).toBe("skyisles.shop");
    expect(row("Neue Rechnungen").shows).toContain("skyisles.shop · Julian Stocker");
  });

  it("…which is what the code really does (0047, 0122, the mail payload)", () => {
    const legal = readFileSync("supabase/migrations/0047_legal_layer.sql", "utf8");
    expect(legal).toContain("coalesce(v_seller.display_name, v_snap.seller_name)");
    expect(legal).toContain("select s.display_name, s.legal_name, s.street, s.postal_code, s.city,");
    const receipts = readFileSync("supabase/migrations/0122_purchase_receipts.sql", "utf8");
    expect(receipts).toContain("nullif(btrim(coalesce(v_seller.display_name, '')), ''),");
    /* trading_name: in no invoice, snapshot or receipt insert. */
    expect(legal.slice(legal.indexOf("insert into public.invoices"))).not.toMatch(/trading_name[\s\S]{0,40}\)\s*values/);
    expect(receipts).not.toContain("v_seller.trading_name");
  });

  it("the legal pages are marked as code until AP5", () => {
    expect(row("Impressum").kind).toBe("code");
    expect(row("Impressum").shows).toBe(SELLER_IDENTITY.contractingParty);
  });

  it("the sender is a secret and is not guessed", () => {
    expect(row("Kundenmails: Absender")).toMatchObject({ shows: null, kind: "secret" });
  });

  it("trading_name is shown as unused", () => {
    expect(row("Frühere Geschäftsbezeichnung")).toMatchObject({ shows: "yulez.collectibles", kind: "unused" });
  });
});

describe("the model only reads", () => {
  it("neither the model nor the loader writes", () => {
    for (const file of ["src/lib/identity/model.ts", "src/lib/identity/server.ts"]) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/rpc\("(admin_set|seller_set|set_)/);
      expect(source, file).not.toContain('"use server"');
    }
    const server = readFileSync("src/lib/identity/server.ts", "utf8");
    expect([...server.matchAll(/rpc\("([a-z_]+)"/g)].map((m) => m[1])).toEqual(["admin_shop_profile"]);
  });
});
