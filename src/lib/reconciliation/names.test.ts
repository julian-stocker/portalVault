import { describe, expect, it } from "vitest";
import { buildAliasIndex, compareNames, comparePiece, listingSeries, matchPieces, seriesHint } from "./names";
import { ledgerSale } from "./testing/ledger-fixture";
import type { ExternalLine } from "./types";

describe("compareNames — the same object", () => {
  it.each([
    ["Swarm", "Swarm", "exact"],
    ["Lighting Rod", "lighting rod", "exact"],
    ["Stealth Elf (Legendary)", "Legendary Stealth Elf", "normalized"],
    ["Spyro (Dark)", "Dark Spyro", "normalized"],
    ["Giants (PlayStation3)", "Giants PS3", "normalized"],
    ["Giants (Nintendo Wii U)", "Giants Wii U", "normalized"],
    ["Spyros Adventure (Nintendo Wii)", "Wii Spyros Adventure", "normalized"],
    ["Swap Force Portal (0000547)", "0000547 (SF)", "normalized"],
    ["Trap Team Portal 87031790 (xBox)", "87031790 (T)", "normalized"],
    ["Drobot LC", "Drobot Light Core", "normalized"],
    ["Warnado LC", "Warnado - Lightcore", "normalized"],
    ["Turbo Charge D.K.", "Turbo Charge Donkey Kong", "normalized"],
    ["3.0 Obi-Wan Kenobi (Light FX)", "3.0 Obi Wan Kenobi (LFX)", "normalized"],
    ["Boomer (Eons Elite)", "Elite Boomer - ohne OVP", "normalized"],
    ["Chopscrotch (Candy Coated)", "C.C. Chopscrotch", "normalized"],
    ["Jet Vac (Legendary)", "Legendary Jet-Vac", "normalized"],
    ["Water Tiki (Trap)", "Water Tiki", "normalized"],
    ["Fire Reactor (Crystal)", "Fire Reactor", "normalized"],
    ["Magic Log Holder (Trap)", "Magic Logholder", "normalized"],
    ["Booster Pack 2", "Battlecast: Booster Pack 2", "normalized"],
    ["Mystery Chest Silber (Item)", "Mystery Chest Silver", "normalized"],
    ["Spry", "Mini Spry", "fuzzy"],
    ["Gryphon Park Observatory (Item)", "Gryphon Park Observatory Location", "fuzzy"],
    ["Splitfire", "Spitfire", "fuzzy"],
    ["Smoulderdash", "Smolderdash", "fuzzy"],
    ["Fizzy Frenzy Pop Fiz", "Fizzy Frenzy Pop Fizz", "fuzzy"],
  ] as const)("%s ≈ %s (%s)", (external, ledger, tier) => {
    expect(compareNames(external, ledger)).toBe(tier);
  });
});

describe("compareNames — different objects stay different", () => {
  it.each([
    ["Scorp", "Scorpion Striker Catapult"],
    ["Portal 84148790 (Wireless)", "83973080A Wireless (SA)"],
    ["Trap Team Portal (84394790)", "0000586 (T)"],
    ["Spyro", "Dark Spyro"],
    ["Stealth Elf", "Legendary Stealth Elf"],
    ["Ignitor", "Ignitor LC"],
    ["Eruptor", "Lava Barf Eruptor"],
    ["Dragonfire Cannon (Item)", "Golden Dragonfire Cannon"],
    ["Giants (PlayStation3)", "Swap Force PS3"],
    ["Giants (PlayStation3)", "Spiel für Sony Playstation 3 PS3"],
    ["Hex", "Rex"],
    ["Zap", "Zook"],
  ])("%s ≠ %s", (external, ledger) => {
    expect(compareNames(external, ledger)).toBeNull();
  });
});

describe("comparePiece and the ledger as alias table", () => {
  const history = [
    ledgerSale({ id: 1, sold: "2026-02-01", pieces: ["Ice Crave|Empire of Ice|SKY-0580"] }),
    ledgerSale({ id: 2, sold: "2026-03-01", pieces: ["Ice Crave||SKY-0580"] }),
  ];
  const aliases = buildAliasIndex(history);

  it("prefers the piece's own names", () => {
    expect(comparePiece("Dark Spyro", { itemId: 1, skyId: "SKY-1", name: "Dark Spyro", rawName: null })).toBe("exact");
  });

  it("recognises a name another sale of the same SKY-ID was booked under", () => {
    expect(comparePiece("Empire of Ice (Item)", history[1].pieces[0], aliases)).toBe("alias");
    expect(comparePiece("Empire of Ice (Item)", history[1].pieces[0])).toBeNull();
  });

  it("never bridges a fuzzy spelling through the alias table", () => {
    expect(comparePiece("Empire of Ise", history[1].pieces[0], aliases)).toBeNull();
  });
});

describe("matchPieces", () => {
  const line = (name: string, quantity = 1): ExternalLine =>
    ({ lineRef: null, listingId: "1", title: "t", variant: null, name, quantity, unitPrice: 1, value: quantity });

  it("pairs each piece once, and a quantity of 3 is three pieces", () => {
    const sale = ledgerSale({ id: 1, sold: "2026-04-27", pieces: ["Water Armor", "Dark Pyramid", "Fire Reactor"] });
    const m = matchPieces({ lines: [line("Water Armor (Crystal)"), line("Dark Pyramid (Crystal)"), line("Fire Reactor (Crystal)", 3)] }, sale);
    expect(m.pairs).toHaveLength(3);
    expect(m.unmatchedExternal).toEqual([{ line: 2, name: "Fire Reactor (Crystal)" }, { line: 2, name: "Fire Reactor (Crystal)" }]);
    expect(m.unmatchedLedger).toEqual([]);
    expect(m.ratio).toBeCloseTo(3 / 5);
  });

  it("lets an exact pair win over an earlier, weaker one", () => {
    const sale = ledgerSale({ id: 1, sold: "2026-01-01", pieces: ["Mini Spry", "Spry"] });
    const m = matchPieces({ lines: [line("Spry")] }, sale);
    expect(m.pairs).toEqual([{ line: 0, piece: 1, tier: "exact" }]);
  });
});

describe("series hints", () => {
  it("reads the series from a listing title", () => {
    expect(listingSeries("Skylanders Giants Figuren - Große Auswahl")).toBe("G");
    expect(listingSeries("Skylanders Spyros Adventure Figuren")).toBe("SA");
    expect(listingSeries("Skylanders Trap Team Fallen")).toBe("T");
    expect(listingSeries("Disney Infinity Figuren")).toBeNull();
  });

  it("is only a hint, and only when both sides know a series", () => {
    const giants = { title: "Skylanders Giants Figuren - Große Auswahl" };
    expect(seriesHint(giants, { itemId: 1, skyId: "S", name: "Stealth Elf", rawName: null, seriesCode: "SA" }))
      .toEqual({ listing: "G", ledger: "SA" });
    expect(seriesHint(giants, { itemId: 1, skyId: "S", name: "Stealth Elf", rawName: null, seriesCode: "G" })).toBeNull();
    expect(seriesHint(giants, { itemId: 1, skyId: "S", name: "Stealth Elf", rawName: null })).toBeNull();
  });
});
