import { describe, expect, it } from "vitest";
import { expectedMigrationNumbers, RESERVED_MIGRATION_NUMBERS } from "./migration-sequence";

describe("the gapless sequence with reserved numbers", () => {
  it("a reserved number may be missing", () => {
    expect(RESERVED_MIGRATION_NUMBERS.has(177)).toBe(true);
    expect(expectedMigrationNumbers([175, 176, 178])).not.toContain(177);
  });

  it("once its migration exists, it is part of the sequence like any other", () => {
    expect(expectedMigrationNumbers([1, 2, 177])).toContain(177);
  });

  it("any other gap still fails", () => {
    const present = [1, 2, 4];
    expect(present).not.toEqual(expectedMigrationNumbers(present));
  });

  it("nothing but 0177 is reserved", () => {
    expect([...RESERVED_MIGRATION_NUMBERS]).toEqual([177]);
  });
});
