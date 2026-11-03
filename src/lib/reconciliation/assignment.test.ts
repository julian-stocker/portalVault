import { describe, expect, it } from "vitest";
import { assignMaximum, type Edge } from "./assignment";

const pairs = (edges: Edge[]) => assignMaximum(edges).map((e) => [e.row, e.col]);

describe("assignMaximum", () => {
  it("finds the global optimum where greedy fails", () => {
    // Greedy takes 0→0 (score 10) and leaves row 1 alone (total 10).
    // The optimum is 0→1, 1→0 (9 + 8 = 17).
    expect(pairs([
      { row: 0, col: 0, score: 10 }, { row: 0, col: 1, score: 9 }, { row: 1, col: 0, score: 8 },
    ])).toEqual([[0, 1], [1, 0]]);
  });

  it("uses each row and each column at most once", () => {
    const chosen = assignMaximum([
      { row: 0, col: 0, score: 5 }, { row: 1, col: 0, score: 5 }, { row: 2, col: 0, score: 5 },
    ]);
    expect(chosen).toHaveLength(1);
  });

  it("solves rectangular problems in both directions", () => {
    expect(pairs([{ row: 0, col: 0, score: 1 }, { row: 0, col: 1, score: 3 }, { row: 0, col: 2, score: 2 }])).toEqual([[0, 1]]);
    expect(pairs([{ row: 0, col: 0, score: 1 }, { row: 1, col: 0, score: 3 }, { row: 2, col: 0, score: 2 }])).toEqual([[1, 0]]);
  });

  it("ignores non-positive edges and leaves rows without an edge unassigned", () => {
    expect(pairs([{ row: 0, col: 0, score: 0 }, { row: 1, col: 1, score: -3 }, { row: 2, col: 2, score: 4 }])).toEqual([[2, 2]]);
  });

  it("solves independent components independently", () => {
    expect(pairs([
      { row: 0, col: 0, score: 2 }, { row: 1, col: 0, score: 3 }, { row: 1, col: 1, score: 1 },
      { row: 5, col: 7, score: 4 },
    ])).toEqual([[0, 0], [1, 1], [5, 7]]);
  });

  it("is deterministic", () => {
    const edges: Edge[] = [
      { row: 0, col: 0, score: 5 }, { row: 0, col: 1, score: 5 }, { row: 1, col: 0, score: 5 }, { row: 1, col: 1, score: 5 },
    ];
    expect(pairs(edges)).toEqual(pairs([...edges].reverse()));
  });

  it("keeps the better of two edges given for the same pair", () => {
    expect(assignMaximum([{ row: 0, col: 0, score: 1 }, { row: 0, col: 0, score: 7 }])[0].score).toBe(7);
  });
});
