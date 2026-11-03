/**
 * The best one-to-one assignment between two sets — globally, not greedily.
 *
 * WHY NOT GREEDY
 *
 * Taking the best pair first and repeating is wrong as soon as two candidates
 * compete: order A fits sale 1 slightly better than sale 2, order B fits only
 * sale 1. Greedy gives A→1 and leaves B alone; the right answer is A→2, B→1.
 * The Hungarian method finds the assignment with the highest total score, and
 * "leave unassigned" is always one of its options (a zero-score dummy), so a
 * weak pair is never forced.
 *
 * The full matrix would be 311 × 334 for one season of eBay. The edges are
 * sparse — a sale is a candidate only within a few days — so the problem is
 * split into connected components first, each solved on its own. A typical
 * component is a handful of orders from neighbouring days.
 *
 * Deterministic: the same input yields the same assignment.
 */

export type Edge = { row: number; col: number; score: number };

/** Minimal-cost assignment for a dense n × m matrix (n ≤ m). Returns col per row, -1 for none. */
function hungarian(cost: number[][]): number[] {
  const n = cost.length;
  const m = cost[0]?.length ?? 0;
  const INF = Number.POSITIVE_INFINITY;
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(m + 1).fill(0);
  const p = new Array<number>(m + 1).fill(0);
  const way = new Array<number>(m + 1).fill(0);
  for (let i = 1; i <= n; i += 1) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(m + 1).fill(INF);
    const used = new Array<boolean>(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = INF;
      let j1 = 0;
      for (let j = 1; j <= m; j += 1) {
        if (used[j]) continue;
        const current = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (current < minv[j]) {
          minv[j] = current;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= m; j += 1) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== 0);
  }
  const result = new Array<number>(n).fill(-1);
  for (let j = 1; j <= m; j += 1) if (p[j] > 0) result[p[j] - 1] = j - 1;
  return result;
}

/**
 * Maximise the total score over the given edges (only edges with a positive
 * score are considered). Returns the chosen edges, each row and each column
 * at most once.
 */
export function assignMaximum(edges: readonly Edge[]): Edge[] {
  const usable = edges.filter((e) => e.score > 0);

  // Connected components over rows and columns (union-find on `r:` / `c:` keys).
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root) as string;
    let node = x;
    while (node !== root) {
      const next = parent.get(node) as string;
      parent.set(node, root);
      node = next;
    }
    return root;
  };
  const add = (x: string) => {
    if (!parent.has(x)) parent.set(x, x);
  };
  for (const e of usable) {
    const r = `r:${e.row}`;
    const c = `c:${e.col}`;
    add(r);
    add(c);
    const a = find(r);
    const b = find(c);
    if (a !== b) parent.set(a, b);
  }
  const components = new Map<string, Edge[]>();
  for (const e of usable) {
    const root = find(`r:${e.row}`);
    const list = components.get(root);
    if (list) list.push(e);
    else components.set(root, [e]);
  }

  const chosen: Edge[] = [];
  for (const list of components.values()) {
    const rows = [...new Set(list.map((e) => e.row))].sort((a, b) => a - b);
    const cols = [...new Set(list.map((e) => e.col))].sort((a, b) => a - b);
    const rowAt = new Map(rows.map((r, i) => [r, i]));
    const colAt = new Map(cols.map((c, i) => [c, i]));
    // Columns: the real ones, then one zero-cost dummy per row ("unassigned").
    const width = cols.length + rows.length;
    const cost = rows.map(() => new Array<number>(width).fill(0));
    // A missing edge costs more than staying unassigned, so it is never taken.
    for (const row of cost) for (let j = 0; j < cols.length; j += 1) row[j] = 1;
    const best = new Map<string, Edge>();
    for (const e of list) {
      const key = `${e.row}:${e.col}`;
      const kept = best.get(key);
      if (!kept || e.score > kept.score) best.set(key, e);
    }
    for (const e of best.values()) cost[rowAt.get(e.row) as number][colAt.get(e.col) as number] = -e.score;
    const assignment = hungarian(cost);
    assignment.forEach((j, i) => {
      if (j < 0 || j >= cols.length) return;
      const edge = best.get(`${rows[i]}:${cols[j]}`);
      if (edge) chosen.push(edge);
    });
  }
  return chosen.sort((a, b) => a.row - b.row);
}
