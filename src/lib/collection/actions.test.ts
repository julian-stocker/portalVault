import { describe, expect, it } from "vitest";

/**
 * The mutation contract.
 *
 * setCollected talks to Supabase, so the round trip itself belongs in
 * verify:rls and the browser smoke test. What is worth pinning down here is
 * the shape of the contract, because that is what makes optimistic UI and
 * repeated taps safe (ADR-0027).
 */
import { setCollected } from "./actions.ts";

// Anything past the id check needs cookies() and therefore a request scope,
// which a unit test has none of. That half is covered by verify:rls and the
// browser smoke test.
describe("setCollected — the contract", () => {
  it("takes the desired end state, not a toggle", () => {
    // Two parameters: which figure, and whether it should be collected.
    // A toggle would take one, read the current state and flip it — which is
    // exactly what races when two taps arrive together.
    expect(setCollected.length).toBe(2);
  });

  it("rejects anything that is not a SKY-ID before touching the database", async () => {
    for (const bad of ["", "SKY-12", "sky-0001", "SKY-00001", "'; drop table", "SKY-0001 "]) {
      await expect(setCollected(bad, false)).resolves.toEqual({ ok: false, reason: "invalid" });
    }
  });

  it("rejects an invalid id the same way whether adding or removing", async () => {
    await expect(setCollected("nope", true)).resolves.toEqual({ ok: false, reason: "invalid" });
    await expect(setCollected("nope", false)).resolves.toEqual({ ok: false, reason: "invalid" });
  });
});
