/**
 * From the seller row to the legal texts (ADR-0184, AP5): which facts the
 * texts state, and what happens when the data no longer matches them.
 */
import { describe, expect, it } from "vitest";

import { countryName, resolveLegalTexts, textPremiseGaps, toLegalSeller } from "@/lib/legal/seller-text";
import { SELLER_LEGAL_FIXTURE as F } from "@/test-support/seller-legal";

describe("the facts the current texts state", () => {
  it("the fixture matches every one of them", () => {
    expect(textPremiseGaps(F)).toEqual([]);
  });

  it.each([
    ["text.legalForm", { legalForm: "GmbH" }],
    ["text.legalForm", { legalForm: null }],
    ["text.smallBusiness19", { smallBusiness19: false }],
    ["text.dispute", { disputeParticipation: true, disputeBody: "Universalschlichtungsstelle" }],
    ["text.returnPostage", { returnPostageBorneBy: "seller" }],
  ] as const)("%s: a changed fact makes the text unusable, not silently wrong", (code, change) => {
    expect(textPremiseGaps({ ...F, ...change })).toEqual([code]);
    expect(resolveLegalTexts({ status: "ok", seller: { ...F, ...change } }))
      .toEqual({ status: "unavailable", cause: "mismatch", codes: [code] });
  });
});

describe("a further contact channel", () => {
  it("is not a premise: a stored channel never makes a page unusable", () => {
    expect(textPremiseGaps({ ...F, directContact: "+49 000 000" })).toEqual([]);
    expect(resolveLegalTexts({ status: "ok", seller: { ...F, directContact: "+49 000 000" } }).status).toBe("ok");
  });

  it("is passed on exactly as stored", () => {
    expect(toLegalSeller({ ...F, directContact: "Kontaktformular unter /kontakt" }).directContact)
      .toBe("Kontaktformular unter /kontakt");
    expect(toLegalSeller(F).directContact).toBeNull();
  });
});

describe("what a text reads", () => {
  const S = toLegalSeller(F);

  it("platform, shop brand and legal operator stay three things", () => {
    expect(S.platformName).toBe("SkyIsles");
    expect(S.displayName).toBe(F.displayName);
    expect(S.legalName).toBe(F.legalName);
    expect(S.contractingParty).toBe(`${F.legalName}, handelnd unter ${F.displayName}`);
  });

  it("the country is named from its code", () => {
    expect(S.country).toBe("Deutschland");
    expect(countryName("at")).toBe("Österreich");
    expect(countryName("??")).toBe("??");
  });

  it("withdrawal and complaints go to their own contact, else to the contact e-mail", () => {
    expect(S.withdrawalEmail).toBe(F.withdrawalContactEmail);
    expect(S.complaintsEmail).toBe(F.complaintsContactEmail);
    const plain = toLegalSeller({ ...F, withdrawalContactEmail: null, complaintsContactEmail: null });
    expect(plain.withdrawalEmail).toBe(F.contactEmail);
    expect(plain.complaintsEmail).toBe(F.contactEmail);
  });
});

describe("the one decision every page makes", () => {
  it("passes on why a page cannot be shown — codes only", () => {
    expect(resolveLegalTexts({ status: "unavailable", reason: "function_missing" }))
      .toEqual({ status: "unavailable", cause: "unavailable", codes: ["function_missing"] });
    expect(resolveLegalTexts({ status: "incomplete", missing: ["legal.street"] }))
      .toEqual({ status: "unavailable", cause: "incomplete", codes: ["legal.street"] });
  });

  it("a complete, matching row is ok", () => {
    expect(resolveLegalTexts({ status: "ok", seller: F })).toEqual({ status: "ok", seller: toLegalSeller(F) });
  });
});
