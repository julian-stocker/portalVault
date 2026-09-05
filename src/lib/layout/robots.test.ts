import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";

import { metadata } from "@/app/layout";

/**
 * The test deployment must not be indexed (docs/DEPLOYMENT.md).
 *
 * This guard exists to be **deliberately deleted**. The noindex belongs to
 * the *.vercel.app test phase; when skyisles.de goes live it has to go, and
 * a failing test at that moment is the reminder that removing it is a
 * decision rather than an oversight.
 *
 * Removal checklist at launch:
 *   1. drop the `robots` block in src/app/layout.tsx
 *   2. drop this file
 *   3. update docs/DEPLOYMENT.md and PROJECT_STATUS.md
 */
describe("the temporary test deployment stays out of search engines", () => {
  it("answers noindex, nofollow on every route", () => {
    // Root metadata is inherited by every page, so one declaration covers
    // the catalog, the detail pages and the auth screens alike.
    expect(metadata.robots).toMatchObject({ index: false, follow: false });
  });

  it("says the same thing to Googlebot specifically", () => {
    expect(metadata.robots).toMatchObject({ googleBot: { index: false, follow: false } });
  });

  it("has no robots.txt that would keep the crawler from reading it", () => {
    // A blanket Disallow would stop the fetch and therefore the noindex, and
    // a linked URL could still be indexed as a bare address.
    expect(existsSync("src/app/robots.ts")).toBe(false);
    expect(existsSync("public/robots.txt")).toBe(false);
  });
});
