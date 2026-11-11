/**
 * Who SkyIsles is, who the shop is, and who is legally selling — one model
 * (ADR-0184, AP2).
 *
 * THREE IDENTITIES THAT ARE NEVER ONE FIELD
 *
 *   platform  SkyIsles — the product, the website, catalog/accounts/checkout
 *   shop      skyisles.shop — the shop brand customers buy from
 *             (`sellers.display_name`)
 *   legal     the person or company that is the contracting party: name,
 *             legal form, address, tax and register details (`sellers.legal_*`)
 *
 * A brand never stands in for the legal seller: every place that names the
 * contracting party carries `legal.legalName` (ADR-0184, ADR-0086).
 *
 * PURE. This file reads nothing and writes nothing. `server.ts` loads the
 * values through the existing seller-gated `admin_shop_profile()`; the
 * published legal pages still read `SELLER_IDENTITY` until AP5, and the
 * comparison below says where the two disagree instead of hiding it.
 *
 * NOTHING IS INVENTED OR ASSUMED. A missing field is reported missing; no
 * register entry, telephone number or tax status is inferred. The tax flag is
 * shown as stored.
 */
import type { ShopSettings } from "@/lib/admin/shop-profile-model";
import { withdrawalContact, complaintsContact } from "@/lib/admin/shop-profile-model";

/**
 * The platform's name. A product name, not a business setting — one constant,
 * here (ADR-0184). Kept as a separate field from the shop brand on purpose.
 */
export const PLATFORM_NAME = "SkyIsles";

/**
 * Names that are no longer an active identity (ADR-0184). Historical
 * documents keep them — this list is only for spotting them in CURRENT data.
 */
export const RETIRED_TRADE_NAMES: readonly string[] = ["yulez.collectibles"];

export type PlatformIdentity = {
  name: string;
  /** `platform_settings.support_email` — readable only to a platform admin. */
  supportEmail: string | null;
  /** False when the viewer may not read platform settings at all. */
  supportReadable: boolean;
};

export type ShopIdentity = {
  /** `sellers.display_name` — the shop brand. */
  displayName: string | null;
  /** `sellers.contact_email` — the published customer contact. */
  contactEmail: string | null;
  /** `sellers.transactional_reply_to`, NULL meaning "use contactEmail". */
  replyTo: string | null;
  /** What a reply to a customer mail actually reaches. */
  effectiveReplyTo: string | null;
};

export type LegalIdentity = {
  legalName: string | null;
  legalForm: string | null;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  countryCode: string | null;
  vatId: string | null;
  wId: string | null;
  registerCourt: string | null;
  registerNumber: string | null;
  /** As stored; never changed or inferred here. */
  smallBusiness19: boolean;
  /**
   * `sellers.trading_name` — read nowhere a customer sees (no invoice, mail,
   * snapshot or receipt copies it). Kept to be SHOWN, so a second, different
   * business designation cannot sit unnoticed beside the shop brand.
   */
  legacyTradingName: string | null;
};

export type Identity = {
  platform: PlatformIdentity;
  shop: ShopIdentity;
  legal: LegalIdentity;
  contacts: { withdrawal: string | null; complaints: string | null };
};

/** From the seller row (`admin_shop_profile()`) and, if readable, the platform row. */
export function buildIdentity(
  settings: ShopSettings,
  platform: { supportEmail: string | null } | null,
): Identity {
  const { identity: s, contacts: c, policies: p } = settings;
  return {
    platform: {
      name: PLATFORM_NAME,
      supportEmail: platform?.supportEmail ?? null,
      supportReadable: platform !== null,
    },
    shop: {
      displayName: s.displayName,
      contactEmail: c.contactEmail,
      replyTo: c.replyTo,
      effectiveReplyTo: c.replyTo ?? c.contactEmail,
    },
    legal: {
      legalName: s.legalName,
      legalForm: s.legalForm,
      street: s.street,
      postalCode: s.postalCode,
      city: s.city,
      countryCode: s.countryCode,
      vatId: s.vatId,
      wId: s.wId,
      registerCourt: s.registerCourt,
      registerNumber: s.registerNumber,
      smallBusiness19: p.smallBusiness19,
      legacyTradingName: s.tradingName,
    },
    contacts: { withdrawal: withdrawalContact(c), complaints: complaintsContact(c) },
  };
}

/**
 * What the published legal pages say today — `SELLER_IDENTITY` in
 * `src/lib/legal/seller-identity.ts`, until AP5 moves them onto this model.
 * Passed in rather than imported, so the model stays free of the legal texts.
 */
export type PublishedIdentity = {
  legalName: string;
  tradeName: string;
  contractingParty: string;
  street: string;
  postalCode: string;
  city: string;
  email: string;
  vatId: string;
};

export type FindingLevel = "missing" | "conflict" | "notice";
export type Finding = { level: FindingLevel; code: string; message: string };

const norm = (value: string | null | undefined) => (value ?? "").trim().toLowerCase();
const isRetired = (value: string | null) =>
  value !== null && RETIRED_TRADE_NAMES.some((name) => norm(name) === norm(value));

/**
 * Everything the operator should know before a customer sees it: what is
 * missing for an invoice and an Impressum, where two sources disagree, and
 * where a retired identity is still active.
 */
export function identityFindings(identity: Identity, published: PublishedIdentity): Finding[] {
  const { shop, legal } = identity;
  const findings: Finding[] = [];
  const missing = (code: string, label: string) =>
    findings.push({ level: "missing", code, message: `${label} fehlt.` });

  /* Required for an invoice (§ 14/§ 34a UStDV: name and address) and an
     Impressum (§ 5 DDG: name, address, e-mail). Tax and register details are
     NOT required here: whether they exist is not something to assume. */
  if (shop.displayName === null) missing("shop.displayName", "Der Shopname");
  if (legal.legalName === null) missing("legal.legalName", "Der rechtliche Name des Betreibers");
  if (legal.street === null) missing("legal.street", "Die Straße der Geschäftsanschrift");
  if (legal.postalCode === null) missing("legal.postalCode", "Die Postleitzahl der Geschäftsanschrift");
  if (legal.city === null) missing("legal.city", "Der Ort der Geschäftsanschrift");
  if (legal.countryCode === null) missing("legal.countryCode", "Das Land der Geschäftsanschrift");
  if (shop.contactEmail === null) missing("shop.contactEmail", "Die Kontakt-E-Mail für Kundinnen und Kunden");

  /* Platform and shop are two identities and must not collapse into one name. */
  if (shop.displayName !== null && norm(shop.displayName) === norm(identity.platform.name)) {
    findings.push({
      level: "conflict", code: "shop.equalsPlatform",
      message: `Der Shopname ist identisch mit dem Plattformnamen „${identity.platform.name}“. `
        + "Plattform und Shop sind getrennte Identitäten.",
    });
  }

  /* A retired identity in current data. */
  if (isRetired(shop.displayName)) {
    findings.push({
      level: "conflict", code: "shop.retired",
      message: `Der Shopname ist noch „${shop.displayName}“ — diese Identität wird nicht mehr verwendet.`,
    });
  }

  /* `trading_name`: a second business designation beside the shop brand. */
  if (legal.legacyTradingName !== null) {
    const same = norm(legal.legacyTradingName) === norm(shop.displayName);
    findings.push({
      level: same ? "notice" : "conflict",
      code: "legal.legacyTradingName",
      message: same
        ? "Im Feld „Frühere Geschäftsbezeichnung“ steht derselbe Name wie der Shopname. "
          + "Das Feld wird nirgends verwendet und kann geleert werden."
        : `Im Feld „Frühere Geschäftsbezeichnung“ steht noch „${legal.legacyTradingName}“. `
          + "Das Feld wird nirgends angezeigt, ist aber eine zweite Geschäftsbezeichnung neben "
          + "dem Shopnamen. Zum Vereinheitlichen das Feld leeren und speichern.",
    });
  }

  /* The published legal pages read constants until AP5. Say where they
     disagree with the data — field by field, never silently. */
  const differs = (a: string | null, b: string) => a !== null && norm(a) !== norm(b);
  const pages = "Impressum, AGB, Widerruf, Datenschutz und Footer";
  if (shop.displayName !== null && norm(shop.displayName) !== norm(published.tradeName)) {
    findings.push({
      level: "conflict", code: "published.tradeName",
      message: `${pages} nennen noch „${published.contractingParty}“; der Shopname ist „${shop.displayName}“. `
        + "Die Rechtstexte lesen bis zur Umstellung (AP5) feste Werte.",
    });
  }
  if (differs(legal.legalName, published.legalName)) {
    findings.push({ level: "conflict", code: "published.legalName",
      message: `${pages} nennen als Betreiber „${published.legalName}“, die Geschäftsdaten „${legal.legalName}“.` });
  }
  if (differs(legal.street, published.street) || differs(legal.postalCode, published.postalCode)
    || differs(legal.city, published.city)) {
    findings.push({ level: "conflict", code: "published.address",
      message: `${pages} nennen die Anschrift „${published.street}, ${published.postalCode} ${published.city}“, `
        + "die Geschäftsdaten eine andere." });
  }
  if (differs(shop.contactEmail, published.email)) {
    findings.push({ level: "conflict", code: "published.email",
      message: `${pages} nennen die E-Mail „${published.email}“, die Kontakt-E-Mail ist „${shop.contactEmail}“.` });
  }
  if (differs(legal.vatId, published.vatId)) {
    findings.push({ level: "conflict", code: "published.vatId",
      message: `${pages} nennen die USt-IdNr. „${published.vatId}“, die Geschäftsdaten „${legal.vatId}“.` });
  }

  if (shop.replyTo === null && shop.contactEmail !== null) {
    findings.push({ level: "notice", code: "shop.replyTo",
      message: "Keine eigene Antwortadresse: Antworten auf Kundenmails gehen an die Kontakt-E-Mail." });
  }
  return findings;
}

/** One row of "Wo erscheint welcher Name?". */
export type UsageRow = {
  area: string;
  /** What a customer sees there, or null where it cannot be read. */
  shows: string | null;
  source: string;
  /** Where the value really lives — the honest part of the overview. */
  kind: "database" | "snapshot" | "code" | "secret" | "unused";
};

/**
 * Every customer-facing place a name or contact appears, with the value it
 * would show for a NEW order today and where that value comes from. Measured
 * against the code (`0047`, `0122`, `templates.ts`, `seller-identity.ts`).
 */
export function nameUsage(identity: Identity, published: PublishedIdentity): UsageRow[] {
  const { shop, legal } = identity;
  const address = [legal.street, [legal.postalCode, legal.city].filter(Boolean).join(" ")]
    .filter((part) => part && part.trim() !== "").join(", ") || null;
  const seller = [shop.displayName, legal.legalName].filter(Boolean).join(" · ") || null;
  return [
    { area: "Plattform (Website, Konten, Kasse)", shows: identity.platform.name,
      source: "Produktname im Code", kind: "code" },
    { area: "Shop, Katalog, Warenkorb, Kasse", shows: shop.displayName,
      source: "sellers.display_name über seller_public()", kind: "database" },
    { area: "Kundenmails: Anrede im Text", shows: shop.displayName,
      source: "Bestellsnapshot (seller_name ← display_name bei Bestellung)", kind: "snapshot" },
    { area: "Kundenmails: Verkäuferblock", shows: [seller, address].filter(Boolean).join(", ") || null,
      source: "Bestellsnapshot (display_name, legal_name, Anschrift)", kind: "snapshot" },
    { area: "Kundenmails: Absender", shows: null,
      source: "MAIL_FROM im Secret der Function send-order-mail (hier nicht lesbar)", kind: "secret" },
    { area: "Kundenmails: Antwortadresse", shows: shop.effectiveReplyTo,
      source: "sellers.transactional_reply_to, sonst contact_email", kind: "database" },
    { area: "Neue Rechnungen: Verkäufer", shows: [seller, address].filter(Boolean).join(", ") || null,
      source: "issue_invoice() kopiert legal_name, display_name und Anschrift", kind: "database" },
    { area: "Eigenbelege beim Einkauf", shows: seller,
      source: "kopiert legal_name und display_name", kind: "database" },
    { area: "Impressum, AGB, Widerruf, Datenschutz, Footer, Serviceseiten",
      shows: published.contractingParty,
      source: "SELLER_IDENTITY im Code (bis zur Umstellung in AP5)", kind: "code" },
    { area: "Frühere Geschäftsbezeichnung", shows: legal.legacyTradingName,
      source: "sellers.trading_name — wird nirgends angezeigt, nur gesichert", kind: "unused" },
  ];
}
