import { describe, expect, it } from "vitest";

import { RESERVED_USERNAMES, checkUsername, isUsernameAcceptable } from "./username.ts";

describe("checkUsername", () => {
  it("accepts ordinary names", () => {
    expect(checkUsername("julian")).toBeNull();
    expect(checkUsername("Sky_Collector_99")).toBeNull();
    expect(checkUsername("abc")).toBeNull();
    expect(checkUsername("a".repeat(20))).toBeNull();
  });

  it("rejects empty input", () => {
    expect(checkUsername("")).toBe("empty");
    expect(checkUsername("   ")).toBe("empty");
  });

  it("enforces the length bounds from the database constraint", () => {
    expect(checkUsername("ab")).toBe("too-short");
    expect(checkUsername("a".repeat(21))).toBe("too-long");
  });

  it("rejects characters the constraint does not allow", () => {
    expect(checkUsername("julian stocker")).toBe("invalid-characters");
    expect(checkUsername("julian-stocker")).toBe("invalid-characters");
    expect(checkUsername("julian@home")).toBe("invalid-characters");
    expect(checkUsername("jülian")).toBe("invalid-characters");
  });

  it("rejects reserved names regardless of case", () => {
    expect(checkUsername("admin")).toBe("reserved");
    expect(checkUsername("ADMIN")).toBe("reserved");
    expect(checkUsername("Admin")).toBe("reserved");
    expect(checkUsername("portalvault")).toBe("reserved");
    expect(checkUsername("Datenschutz")).toBe("reserved");
  });

  it("does not reject names that merely contain a reserved word", () => {
    expect(checkUsername("admin_helper")).toBeNull();
    expect(checkUsername("notadmin")).toBeNull();
  });

  it("trims before checking", () => {
    expect(checkUsername("  julian  ")).toBeNull();
  });
});

describe("RESERVED_USERNAMES mirrors the database", () => {
  it("contains the names named explicitly in ADR-0016", () => {
    for (const name of ["admin", "api", "support", "portalvault"]) {
      expect(RESERVED_USERNAMES.has(name)).toBe(true);
    }
  });

  it("is stored lowercase so the case-insensitive lookup works", () => {
    for (const name of RESERVED_USERNAMES) {
      expect(name).toBe(name.toLowerCase());
    }
  });
});

describe("isUsernameAcceptable", () => {
  it("agrees with checkUsername", () => {
    expect(isUsernameAcceptable("julian")).toBe(true);
    expect(isUsernameAcceptable("admin")).toBe(false);
    expect(isUsernameAcceptable("ab")).toBe(false);
  });
});
