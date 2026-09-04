import { describe, expect, it } from "vitest";

import {
  DEFAULT_SIGNED_IN_PATH,
  ONBOARDING_PATH,
  destinationAfterSignIn,
  safeRedirect,
  signInUrlFor,
} from "./redirect.ts";

describe("safeRedirect", () => {
  it("accepts a same-site path", () => {
    expect(safeRedirect("/dashboard")).toBe("/dashboard");
    expect(safeRedirect("/settings?tab=account")).toBe("/settings?tab=account");
  });

  it("falls back when nothing was requested", () => {
    expect(safeRedirect(null)).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(safeRedirect(undefined)).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(safeRedirect("")).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(safeRedirect("   ")).toBe(DEFAULT_SIGNED_IN_PATH);
  });

  it("rejects absolute URLs", () => {
    expect(safeRedirect("https://evil.example/steal")).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(safeRedirect("http://evil.example")).toBe(DEFAULT_SIGNED_IN_PATH);
  });

  it("rejects protocol-relative URLs", () => {
    // "//evil.example" is a host, not a path, and would leave the site.
    expect(safeRedirect("//evil.example")).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(safeRedirect("//evil.example/path")).toBe(DEFAULT_SIGNED_IN_PATH);
  });

  it("rejects backslash forms browsers may normalise into a host", () => {
    expect(safeRedirect("/\\evil.example")).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(safeRedirect("/path\\to")).toBe(DEFAULT_SIGNED_IN_PATH);
  });

  it("rejects a scheme smuggled into the first segment", () => {
    expect(safeRedirect("/javascript:alert(1)")).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(safeRedirect("/data:text/html,x")).toBe(DEFAULT_SIGNED_IN_PATH);
  });

  it("rejects anything not rooted at a slash", () => {
    expect(safeRedirect("dashboard")).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(safeRedirect("evil.example")).toBe(DEFAULT_SIGNED_IN_PATH);
  });

  it("honours a caller-supplied fallback", () => {
    expect(safeRedirect("https://evil.example", "/reset-password")).toBe("/reset-password");
  });
});

describe("destinationAfterSignIn", () => {
  it("sends a user without a username to onboarding, whatever they asked for", () => {
    expect(destinationAfterSignIn(false, "/settings")).toBe(ONBOARDING_PATH);
    expect(destinationAfterSignIn(false, null)).toBe(ONBOARDING_PATH);
  });

  it("honours a safe target once a username exists", () => {
    expect(destinationAfterSignIn(true, "/settings")).toBe("/settings");
    expect(destinationAfterSignIn(true, null)).toBe(DEFAULT_SIGNED_IN_PATH);
  });

  it("still refuses an unsafe target for a complete profile", () => {
    expect(destinationAfterSignIn(true, "https://evil.example")).toBe(DEFAULT_SIGNED_IN_PATH);
  });
});

describe("signInUrlFor", () => {
  it("preserves the requested target", () => {
    expect(signInUrlFor("/dashboard")).toBe("/login?next=%2Fdashboard");
    expect(signInUrlFor("/settings", "?tab=account")).toBe("/login?next=%2Fsettings%3Ftab%3Daccount");
  });

  it("does not add a pointless next for the home page or the login page itself", () => {
    expect(signInUrlFor("/")).toBe("/login");
    expect(signInUrlFor("/login")).toBe("/login");
  });
});
