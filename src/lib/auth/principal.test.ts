import { describe, expect, it } from "vitest";

import { GUEST, principalFor, principalKey, samePrincipal } from "./principal";

describe("who the browser is acting as", () => {
  it("is a guest without a user id", () => {
    for (const value of [null, undefined, ""]) {
      expect(principalFor(value)).toEqual(GUEST);
    }
  });

  it("is the account when there is one", () => {
    expect(principalFor("abc")).toEqual({ kind: "user", id: "abc" });
  });

  it("gives two accounts two different keys, and neither is the guest's", () => {
    const a = principalKey(principalFor("a"));
    const b = principalKey(principalFor("b"));
    const guest = principalKey(GUEST);
    expect(new Set([a, b, guest]).size).toBe(3);
  });

  it("compares by account, not by object identity", () => {
    expect(samePrincipal(principalFor("a"), principalFor("a"))).toBe(true);
    expect(samePrincipal(principalFor("a"), principalFor("b"))).toBe(false);
    expect(samePrincipal(principalFor("a"), GUEST)).toBe(false);
    expect(samePrincipal(GUEST, GUEST)).toBe(true);
    expect(samePrincipal(null, GUEST)).toBe(false);
    expect(samePrincipal(null, null)).toBe(true);
  });
});
