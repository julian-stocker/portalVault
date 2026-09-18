/**
 * What the shop's settings are, as shapes (ADR-0075).
 *
 * The half of the shop settings that a client component may import: types,
 * defaults and the two fallback rules. The half that talks to the database
 * lives in `shop-profile.ts`, the same split `commerce-model.ts` /
 * `commerce.ts` and `tester-model.ts` / `tester.ts` already use.
 *
 * NO PLATFORM CONTACTS HERE. The seller's screen used to carry the SkyIsles
 * support address; a Business operator has no business editing a platform
 * setting, so it moved to the platform's own panel and its own guard
 * (ADR-0077).
 *
 * WHY EVERY IDENTITY FIELD IS NULLABLE
 *
 * None of them is known yet. A legal name, an address, a register entry and a
 * tax number are facts about a real person, and this file has no business
 * inventing any of them — a placeholder in an Impressum field is not a
 * half-finished setting, it is a false statement waiting to be published.
 * `null` means "not supplied"; the admin screen shows an empty field and the
 * future legal pages will refuse to render without it.
 */

/** Who the seller is. Everything here is NULL until somebody types it. */
export type SellerIdentity = {
  /** What a customer sees. The only one of these that is set today. */
  displayName: string | null;
  /** The natural or legal person who is liable. */
  legalName: string | null;
  /** What they trade as — "yulez.collectibles". */
  tradingName: string | null;
  legalForm: string | null;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  countryCode: string | null;
  phone: string | null;
  /** A second rapid channel. A telephone is not compelled; a channel is. */
  directContact: string | null;
  registerCourt: string | null;
  registerNumber: string | null;
  vatId: string | null;
  /** Wirtschafts-Identifikationsnummer (§ 139c AO), if one was issued. */
  wId: string | null;
};

export type SellerContacts = {
  /** The seller's authoritative address. */
  contactEmail: string | null;
  replyTo: string | null;
  /** NULL means "same as contactEmail" — never a copy of it. */
  withdrawalContactEmail: string | null;
  complaintsContactEmail: string | null;
};

export type ShopPolicies = {
  /** § 19 UStG small-business scheme. A regime, never a rate. */
  smallBusiness19: boolean;
  disputeParticipation: boolean;
  disputeBody: string | null;
  returnPostageBorneBy: "customer" | "seller";
  /** NULL until a delivery window is actually decided. */
  dispatchStatement: string | null;
  /** The seller's, not the platform's — it lives on `sellers` (ADR-0076). */
  freeShippingThreshold: number;
};

export type ShippingCountry = { countryCode: string; label: string; isEnabled: boolean };
export type ShippingMethod = { code: string; name: string; basePrice: number; isEnabled: boolean };

export type ShopSettings = {
  identity: SellerIdentity;
  contacts: SellerContacts;
  policies: ShopPolicies;
  countries: ShippingCountry[];
  methods: ShippingMethod[];
};

/**
 * What a database without an active seller looks like — and what a collector's
 * page load returns, because the reader asks `isAdmin()` before it asks the
 * database.
 */
export const NO_SHOP_SETTINGS: ShopSettings = {
  identity: {
    displayName: null,
    legalName: null,
    tradingName: null,
    legalForm: null,
    street: null,
    postalCode: null,
    city: null,
    countryCode: null,
    phone: null,
    directContact: null,
    registerCourt: null,
    registerNumber: null,
    vatId: null,
    wId: null,
  },
  contacts: {
    contactEmail: null,
    replyTo: null,
    withdrawalContactEmail: null,
    complaintsContactEmail: null,
  },
  policies: {
    smallBusiness19: true,
    disputeParticipation: false,
    disputeBody: null,
    returnPostageBorneBy: "customer",
    dispatchStatement: null,
    freeShippingThreshold: 75,
  },
  countries: [],
  methods: [],
};

/**
 * Where a withdrawal declaration actually goes.
 *
 * The fallback exists so the seller's address is stored once. Copying it into
 * a second column would look identical today and silently stop following the
 * first the day it changes — which is how a settings screen starts lying.
 *
 * `admin_shop_profile()` computes the same thing server-side; this is for the
 * panel, so the operator can see the consequence of leaving a field empty
 * without saving first.
 */
export function withdrawalContact(contacts: SellerContacts): string | null {
  return contacts.withdrawalContactEmail ?? contacts.contactEmail;
}

/** Same rule, for complaints. */
export function complaintsContact(contacts: SellerContacts): string | null {
  return contacts.complaintsContactEmail ?? contacts.contactEmail;
}

/** The countries a customer may actually pick. */
export function enabledCountries(countries: readonly ShippingCountry[]): ShippingCountry[] {
  return countries.filter((country) => country.isEnabled);
}

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null;

const flag = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

const money = (value: unknown, fallback: number): number => {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : fallback;
};

/**
 * Reads `admin_shop_profile()`'s document.
 *
 * Tolerant by design: a database without `0040` returns an error the caller
 * turns into `NO_SHOP_SETTINGS`, and a document missing a key yields the same
 * defaults rather than `undefined` reaching a form field.
 */
export function readShopSettings(document: unknown): ShopSettings {
  if (document === null || typeof document !== "object") return NO_SHOP_SETTINGS;
  const root = document as Record<string, unknown>;
  const seller = (root.seller ?? {}) as Record<string, unknown>;
  const shop = (root.shop ?? {}) as Record<string, unknown>;

  const postage = seller.return_postage_borne_by;
  return {
    identity: {
      displayName: text(seller.display_name),
      legalName: text(seller.legal_name),
      tradingName: text(seller.trading_name),
      legalForm: text(seller.legal_form),
      street: text(seller.street),
      postalCode: text(seller.postal_code),
      city: text(seller.city),
      countryCode: text(seller.country_code),
      phone: text(seller.phone),
      directContact: text(seller.direct_contact),
      registerCourt: text(seller.register_court),
      registerNumber: text(seller.register_number),
      vatId: text(seller.vat_id),
      wId: text(seller.w_id),
    },
    contacts: {
      contactEmail: text(seller.contact_email),
      replyTo: text(seller.transactional_reply_to),
      withdrawalContactEmail: text(seller.withdrawal_contact_email),
      complaintsContactEmail: text(seller.complaints_contact_email),
    },
    policies: {
      smallBusiness19: flag(seller.small_business_19, true),
      disputeParticipation: flag(seller.dispute_participation, false),
      disputeBody: text(seller.dispute_body),
      returnPostageBorneBy: postage === "seller" ? "seller" : "customer",
      dispatchStatement: text(seller.dispatch_statement),
      freeShippingThreshold: money(shop.free_shipping_threshold, 75),
    },
    countries: Array.isArray(root.shipping_countries)
      ? root.shipping_countries.flatMap((row) => {
          const country = row as Record<string, unknown>;
          const code = text(country.country_code);
          return code === null
            ? []
            : [{ countryCode: code, label: text(country.label) ?? code, isEnabled: flag(country.is_enabled, false) }];
        })
      : [],
    methods: Array.isArray(root.shipping_methods)
      ? root.shipping_methods.flatMap((row) => {
          const method = row as Record<string, unknown>;
          const code = text(method.code);
          return code === null
            ? []
            : [
                {
                  code,
                  name: text(method.name) ?? code,
                  basePrice: money(method.base_price, 0),
                  isEnabled: flag(method.is_enabled, false),
                },
              ];
        })
      : [],
  };
}
