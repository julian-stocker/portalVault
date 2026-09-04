import { describe, expect, it } from "vitest";

import { assignSlugs, seriesSlug, slugify } from "./slug.ts";

describe("slugify", () => {
  it("lowercases and joins words with hyphens", () => {
    expect(slugify("Trigger Happy")).toBe("trigger-happy");
  });

  it("drops apostrophes instead of turning them into separators", () => {
    expect(slugify("Spyro's Adventure")).toBe("spyros-adventure");
  });

  it("keeps bracket content and removes only the brackets", () => {
    expect(slugify("Spyro (Series 2)")).toBe("spyro-series-2");
    expect(slugify("Game (Xbox 360)")).toBe("game-xbox-360");
    expect(slugify("Wham-Shell (Clear Crystal)")).toBe("wham-shell-clear-crystal");
  });

  it("spells out umlauts rather than stripping them", () => {
    expect(slugify("Spiel für Xbox One")).toBe("spiel-fuer-xbox-one");
    expect(slugify("Öl")).toBe("oel");
    expect(slugify("Maß")).toBe("mass");
    expect(slugify("ÜBER Alles")).toBe("ueber-alles");
    expect(slugify("Ärger")).toBe("aerger");
  });

  it("collapses repeated separators and trims the edges", () => {
    expect(slugify("  Elite Boomer  -  ohne OVP  ")).toBe("elite-boomer-ohne-ovp");
    expect(slugify("Start Strike (LC, Enchanted)")).toBe("start-strike-lc-enchanted");
  });

  it("treats a hyphen and a space the same way", () => {
    // A documented fragility: the catalog spells some figures both ways.
    expect(slugify("Eye-Brawl")).toBe(slugify("Eye Brawl"));
  });

  it("keeps digits and turns dots into separators", () => {
    expect(slugify("Double Trouble 1.5")).toBe("double-trouble-1-5");
    expect(slugify("Dark Turbo Charge D.K.")).toBe("dark-turbo-charge-d-k");
  });
});

describe("seriesSlug", () => {
  it("uses the label, not the code", () => {
    expect(seriesSlug("Spyro's Adventure")).toBe("spyros-adventure");
    expect(seriesSlug("Swap Force")).toBe("swap-force");
    expect(seriesSlug("SuperChargers")).toBe("superchargers");
  });
});

describe("assignSlugs — first import", () => {
  const drobotSa = { skyId: "SKY-0001", name: "Drobot", seriesLabel: "Spyro's Adventure" };
  const drobotG = { skyId: "SKY-0100", name: "Drobot", seriesLabel: "Giants" };
  const camo = { skyId: "SKY-0002", name: "Camo", seriesLabel: "Spyro's Adventure" };

  it("leaves an uncontested name bare", () => {
    const [assignment] = assignSlugs([camo]);
    expect(assignment).toEqual({ skyId: "SKY-0002", slug: "camo", stage: "name" });
  });

  it("qualifies both sides of a collision, not just the later one", () => {
    const result = assignSlugs([drobotSa, drobotG]);
    expect(result.map((r) => r.slug)).toEqual(["drobot-spyros-adventure", "drobot-giants"]);
    expect(result.every((r) => r.stage === "series")).toBe(true);
  });

  it("does not depend on input order", () => {
    const forward = assignSlugs([drobotSa, drobotG]).map((r) => `${r.skyId}:${r.slug}`).sort();
    const reverse = assignSlugs([drobotG, drobotSa]).map((r) => `${r.skyId}:${r.slug}`).sort();
    expect(forward).toEqual(reverse);
  });

  it("falls back to the SKY-ID when name and series still collide", () => {
    const a = { skyId: "SKY-0010", name: "Eye Brawl", seriesLabel: "Giants" };
    const b = { skyId: "SKY-0011", name: "Eye-Brawl", seriesLabel: "Giants" };
    const result = assignSlugs([a, b]);
    expect(result[0].slug).toBe("eye-brawl-giants");
    expect(result[1].slug).toBe("eye-brawl-giants-sky-0011");
    expect(result[1].stage).toBe("sky-id");
  });

  it("produces unique slugs for every input", () => {
    const result = assignSlugs([drobotSa, drobotG, camo]);
    expect(new Set(result.map((r) => r.slug)).size).toBe(result.length);
  });
});

describe("assignSlugs — stability on later imports", () => {
  it("never recomputes an existing slug, even after a rename", () => {
    const existing = new Map([["SKY-0001", "drobot"]]);
    const [assignment] = assignSlugs(
      [{ skyId: "SKY-0001", name: "Drobot Renamed", seriesLabel: "Spyro's Adventure" }],
      existing,
    );
    expect(assignment.slug).toBe("drobot");
    expect(assignment.stage).toBe("existing");
  });

  it("qualifies only the newcomer when it collides with a stored slug", () => {
    const existing = new Map([["SKY-0001", "kaos"]]);
    const result = assignSlugs(
      [
        { skyId: "SKY-0001", name: "Kaos", seriesLabel: "Trap Team" },
        { skyId: "SKY-0500", name: "Kaos", seriesLabel: "Imaginators" },
      ],
      existing,
    );
    expect(result.find((r) => r.skyId === "SKY-0001")?.slug).toBe("kaos");
    expect(result.find((r) => r.skyId === "SKY-0500")?.slug).toBe("kaos-imaginators");
  });
});
