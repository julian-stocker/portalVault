import { describe, expect, it } from "vitest";

import { authContext, favoursRegistration } from "@/lib/auth/context";
import { safeRedirect } from "@/lib/auth/redirect";

describe("authContext", () => {
  it("says nothing without a next parameter", () => {
    expect(authContext(null)).toBeNull();
    expect(authContext(undefined)).toBeNull();
    expect(authContext("")).toBeNull();
  });

  it("recognises the catalog's collect link", () => {
    // Exactly what CatalogView builds in `signInHref` (ADR-0027).
    expect(authContext("/?series=SSA&figure=SKY-0042")).toBe("collect");
    expect(authContext("/?series=SSA&q=spyro&figure=SKY-0042")).toBe("collect");
    expect(authContext("/?figure=SKY-0001")).toBe("collect");
  });

  it("recognises the figure page's collect link", () => {
    expect(authContext("/skylanders/spyro?figure=SKY-0042")).toBe("collect");
  });

  it("does not claim a collect intent for the bare catalog", () => {
    expect(authContext("/")).toBeNull();
    expect(authContext("/?series=SSA")).toBeNull();
    expect(authContext("/skylanders/spyro")).toBeNull();
  });

  it("ignores a figure parameter that is not a SKY-ID", () => {
    expect(authContext("/?figure=spyro")).toBeNull();
    expect(authContext("/?figure=SKY-42")).toBeNull();
  });

  it("names the protected destinations", () => {
    expect(authContext("/collection")).toBe("collection");
    expect(authContext("/dashboard")).toBe("collection");
    expect(authContext("/settings")).toBe("account");
    expect(authContext("/onboarding")).toBe("account");
  });

  it("names the two commerce pages, which redirect nobody today", () => {
    expect(authContext("/cart")).toBe("cart");
    expect(authContext("/checkout")).toBe("checkout");
  });

  it("tolerates trailing slashes and fragments", () => {
    expect(authContext("/collection/")).toBe("collection");
    expect(authContext("/collection#top")).toBe("collection");
  });

  it("stays silent on anything it does not know", () => {
    expect(authContext("/admin")).toBeNull();
    expect(authContext("/ueber-skyisles")).toBeNull();
    expect(authContext("/shop")).toBeNull();
  });

  /**
   * The one thing this module must not become: a second opinion about where
   * somebody may be sent. It reads the value; `safeRedirect` decides it.
   */
  it("never turns a rejected redirect into a context", () => {
    for (const hostile of ["//evil.example", "https://evil.example", "/\\evil", "javascript:x"]) {
      expect(safeRedirect(hostile)).toBe("/");
      expect(authContext(safeRedirect(hostile))).toBeNull();
    }
  });
});

describe("favoursRegistration", () => {
  it("offers registration only after a collect attempt", () => {
    expect(favoursRegistration("collect")).toBe(true);
    expect(favoursRegistration("collection")).toBe(false);
    expect(favoursRegistration("account")).toBe(false);
    expect(favoursRegistration("cart")).toBe(false);
    expect(favoursRegistration("checkout")).toBe(false);
    expect(favoursRegistration(null)).toBe(false);
  });
});
