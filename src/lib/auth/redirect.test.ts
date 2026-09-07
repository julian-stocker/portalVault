import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  DEFAULT_SIGNED_IN_PATH,
  ONBOARDING_PATH,
  SIGN_IN_PATH,
  destinationAfterSignIn,
  safeOrigin,
  safeRedirect,
  signInUrlFor,
} from "./redirect.ts";

describe("safeRedirect", () => {
  it("accepts a same-site path", () => {
    expect(safeRedirect("/collection")).toBe("/collection");
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
    expect(safeRedirect("collection")).toBe(DEFAULT_SIGNED_IN_PATH);
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

describe("catalog context survives sign-in (ADR-0027)", () => {
  it("keeps series and search in the return target", () => {
    const target = "/?series=g&q=bash";
    expect(safeRedirect(target)).toBe(target);
    expect(destinationAfterSignIn(true, target)).toBe(target);
  });

  it("still refuses an off-site target dressed up as catalog context", () => {
    expect(safeRedirect("//evil.example/?series=g")).toBe(DEFAULT_SIGNED_IN_PATH);
  });
});

describe("signInUrlFor", () => {
  it("preserves the requested target", () => {
    expect(signInUrlFor("/collection")).toBe("/login?next=%2Fcollection");
    expect(signInUrlFor("/settings", "?tab=account")).toBe("/login?next=%2Fsettings%3Ftab%3Daccount");
  });

  it("does not add a pointless next for the home page or the login page itself", () => {
    expect(signInUrlFor("/")).toBe("/login");
    expect(signInUrlFor("/login")).toBe("/login");
  });
});

describe("safeOrigin", () => {
  it("keeps a normal origin", () => {
    expect(safeOrigin("https://skyisles.example")).toBe("https://skyisles.example");
    expect(safeOrigin("http://localhost:3000")).toBe("http://localhost:3000");
  });

  it("reports nothing for the empty value a form sends before hydration", () => {
    // The hidden field renders as "" on the server. Passing that through built
    // a relative emailRedirectTo; the caller now omits the option instead.
    expect(safeOrigin("")).toBeNull();
    expect(safeOrigin(null)).toBeNull();
    expect(safeOrigin(undefined)).toBeNull();
    expect(safeOrigin("   ")).toBeNull();
  });

  it("rejects anything that is not an http(s) origin", () => {
    expect(safeOrigin("/auth/callback")).toBeNull();
    expect(safeOrigin("//evil.example")).toBeNull();
    expect(safeOrigin("javascript:alert(1)")).toBeNull();
    expect(safeOrigin("data:text/html,x")).toBeNull();
    expect(safeOrigin("ftp://example.com")).toBeNull();
  });

  it("rejects credentials, which would travel into an email link", () => {
    expect(safeOrigin("https://user:pass@evil.example")).toBeNull();
  });

  it("drops a smuggled path, query or fragment", () => {
    expect(safeOrigin("https://skyisles.example/evil?a=1#b")).toBe("https://skyisles.example");
  });
});

describe("where a sign-in lands (V7)", () => {
  it("sends everybody to the catalog by default", () => {
    // It used to be /collection, which is a page an administrator never uses
    // — their destinations are Katalog, Lager, Admin (ADR-0042). The catalog
    // is the front page and the one place both roles work.
    expect(DEFAULT_SIGNED_IN_PATH).toBe("/");
    expect(destinationAfterSignIn(true, null)).toBe("/");
    expect(destinationAfterSignIn(true, "")).toBe("/");
  });

  it("does not decide by role", () => {
    // A landing page that forks on a permission is a second thing that can
    // disagree with the navigation.
    // The code, not the comment that explains what it used to be.
    const source = readFileSync("src/lib/auth/redirect.ts", "utf8")
      .split("\n")
      .filter((line) => {
        const trimmed = line.trimStart();
        return !trimmed.startsWith("*") && !trimmed.startsWith("//") && !trimmed.startsWith("/*");
      })
      .join("\n");
    expect(source).not.toContain("isAdmin");
    expect(source).not.toContain("is_shop_admin");
    expect(source).not.toContain("/collection");
  });

  it("still honours a page somebody asked for before signing in", () => {
    expect(destinationAfterSignIn(true, "/collection")).toBe("/collection");
    expect(destinationAfterSignIn(true, "/skylanders/bash")).toBe("/skylanders/bash");
    expect(destinationAfterSignIn(true, "/?series=G&figure=SKY-0007")).toBe(
      "/?series=G&figure=SKY-0007",
    );
  });

  it("still sends somebody without a username to onboarding first", () => {
    expect(destinationAfterSignIn(false, "/collection")).toBe(ONBOARDING_PATH);
  });

  it("still refuses an off-site target", () => {
    expect(destinationAfterSignIn(true, "//evil.example")).toBe("/");
    expect(destinationAfterSignIn(true, "https://evil.example")).toBe("/");
  });

  it("asks for no `next` when the catalog itself is the target", () => {
    // /login?next=%2F would be a round trip to the same place.
    expect(signInUrlFor("/")).toBe(SIGN_IN_PATH);
    expect(signInUrlFor("/collection")).toBe("/login?next=%2Fcollection");
  });

  it("is the same value every redirect path falls back to", () => {
    // login, email confirmation and finishing onboarding.
    const actions = readFileSync("src/lib/auth/actions.ts", "utf8");
    expect(actions).toContain("destinationAfterSignIn(hasUsername, String(formData.get(\"next\") ?? \"\"))");
    expect(actions).toContain('safeRedirect(String(formData.get("next") ?? ""), DEFAULT_SIGNED_IN_PATH)');
    const callback = readFileSync("src/app/auth/callback/route.ts", "utf8");
    expect(callback).toContain("destinationAfterSignIn(hasUsername, null)");
    // And no route hardcodes the old destination any more.
    for (const file of [actions, callback]) expect(file).not.toContain('"/collection"');
  });

  it("leaves /dashboard pointing at the collection, for old links", () => {
    const dashboard = readFileSync("src/app/(app)/dashboard/page.tsx", "utf8");
    expect(dashboard).toContain('permanentRedirect("/collection")');
  });
});
