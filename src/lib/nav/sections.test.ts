import { describe, expect, it } from "vitest";

import { activeSection } from "./sections.ts";

/**
 * The navigation highlight.
 *
 * Worth pinning down because the previous version had no mapping at all —
 * every protected route passed `null` and nothing lit up. These are the real
 * routes the app has today.
 */
describe("activeSection", () => {
  it("treats the catalog and every figure page as one section", () => {
    expect(activeSection("/")).toBe("catalog");
    expect(activeSection("/skylanders")).toBe("catalog");
    expect(activeSection("/skylanders/drobot-spyros-adventure")).toBe("catalog");
    expect(activeSection("/skylanders/fire-bone-hot-dog")).toBe("catalog");
  });

  it("treats the collection and its legacy path as one section", () => {
    expect(activeSection("/collection")).toBe("collection");
    // /dashboard redirects to /collection; highlighting the same entry keeps
    // the bar from flickering on the way.
    expect(activeSection("/dashboard")).toBe("collection");
  });

  it("treats settings and onboarding as the account section", () => {
    expect(activeSection("/settings")).toBe("account");
    expect(activeSection("/onboarding")).toBe("account");
  });

  it("highlights nothing for routes outside the three sections", () => {
    for (const path of ["/login", "/register", "/verify-email", "/auth-error", "/nope"]) {
      expect(activeSection(path), path).toBeNull();
    }
  });

  it("does not mistake a similar prefix for a figure page", () => {
    // "/skylanders-shop" must not light up the catalog.
    expect(activeSection("/skylanders-shop")).toBeNull();
    expect(activeSection("/skylandersfoo")).toBeNull();
  });

  it("ignores a trailing slash", () => {
    expect(activeSection("/collection/")).toBe("collection");
    expect(activeSection("//")).toBe("catalog");
  });
});
