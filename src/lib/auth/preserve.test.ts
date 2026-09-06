import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { survivesError } from "@/lib/auth/preserve";

describe("what a failed submission keeps", () => {
  it("keeps the e-mail address", () => {
    // A wrong password must cost the password, not the whole form.
    expect(survivesError("email")).toBe(true);
  });

  it("keeps a username", () => {
    expect(survivesError("username")).toBe(true);
  });

  it("never keeps the password", () => {
    expect(survivesError("password")).toBe(false);
  });
});

/**
 * The rule has to reach the form, not just exist.
 *
 * Read from the source: whether an input is controlled is a question about
 * the component's wiring, and there is no DOM in this test environment to
 * answer it by rendering (ADR-0013 — Playwright covers that later).
 */
describe("the auth form applies the rule", () => {
  const form = readFileSync("src/components/auth/auth-form.tsx", "utf8");

  it("controls the value of a field that survives, so the reset cannot clear it", () => {
    expect(form).toContain("survivesError");
    expect(form).toMatch(/value=\{survivesError\(field\.name\) \? \(kept\[field\.name\]/);
    expect(form).toMatch(/onChange=/);
  });

  it("leaves everything else uncontrolled, so React still empties it", () => {
    // The password field keeps `defaultValue` and no `value`, which is what
    // makes the post-action reset clear it.
    expect(form).toMatch(/defaultValue=\{/);
  });

  it("stores the kept value in component state only", () => {
    expect(form).toContain("useState");
    expect(form).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
  });
});
