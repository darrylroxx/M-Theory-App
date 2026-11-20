/**
 * The search every Harmonize line and chord layer is chosen with: the whole phrase at once, not
 * one note at a time (a Viterbi search, as harmonisers in the research literature use, e.g.
 * music21's and the voice-leading search of `ekzhang/harmony`, BSD-3). Each slot of the phrase
 * has candidates; a candidate costs something on its own (how it sounds there) and a move costs
 * something (how the line or the voices get there from the last two). The cheapest path wins;
 * ties go to the earlier candidate, so the same input always gives the same answer.
 */

/**
 * The cheapest path through `cands`: node(i, c) for each slot, plus edge(i, z, a, b) for each move
 * a → b into slot i, with z the candidate two slots back (null at i < 2): a second-order search,
 * so a leap can be answered, a direction kept, or a run of leaps priced.
 * A big problem is pruned to the 12 cheapest candidates of each slot by their own cost.
 */
export function bestPath<C>(cands0: C[][], node: (i: number, c: C) => number, edge: (i: number, z: C | null, a: C, b: C) => number): { path: C[]; cost: number } {
  const n = cands0.length;
  if (!n || cands0.some((c) => !c.length)) return { path: [], cost: Infinity };
  const work = cands0.reduce((s, c) => s + c.length ** 3, 0);
  const cands = work > 3e6 ? cands0.map((c, i) => (c.length > 12 ? c.map((x, k) => ({ x, k, v: node(i, x) })).sort((p, q) => p.v - q.v || p.k - q.k).slice(0, 12).sort((p, q) => p.k - q.k).map((p) => p.x) : c)) : cands0;
  const own = cands.map((c, i) => c.map((x) => node(i, x)));
  if (n === 1) {
    let j = 0;
    for (let k = 1; k < own[0].length; k++) if (own[0][k] < own[0][j] - 1e-9) j = k;
    return { path: [cands[0][j]], cost: own[0][j] };
  }
  // cost[a][b]: the cheapest path ending with candidate a at slot i−1 and b at slot i
  let cost: number[][] = cands[0].map((x, a) => cands[1].map((y, b) => own[0][a] + own[1][b] + edge(1, null, x, y)));
  const back: Int32Array[][] = [];
  for (let i = 2; i < n; i++) {
    const prev = cands[i - 2];
    const mid = cands[i - 1];
    const next = cands[i];
    const nc: number[][] = mid.map(() => new Array(next.length).fill(Infinity));
    const nb: Int32Array[] = mid.map(() => new Int32Array(next.length));
    for (let b = 0; b < mid.length; b++)
      for (let c = 0; c < next.length; c++) {
        let best = Infinity;
        let arg = 0;
        for (let a = 0; a < prev.length; a++) {
          const v = cost[a][b];
          if (v === Infinity) continue;
          const t = v + edge(i, prev[a], mid[b], next[c]);
          if (t < best - 1e-9) {
            best = t;
            arg = a;
          }
        }
        nc[b][c] = best + own[i][c];
        nb[b][c] = arg;
      }
    cost = nc;
    back.push(nb);
  }
  let ba = 0;
  let bb = 0;
  for (let a = 0; a < cost.length; a++) for (let b = 0; b < cost[a].length; b++) if (cost[a][b] < cost[ba][bb] - 1e-9) [ba, bb] = [a, b];
  const total = cost[ba][bb];
  const idx = new Array<number>(n);
  idx[n - 1] = bb;
  idx[n - 2] = ba;
  for (let i = n - 1; i >= 2; i--) idx[i - 2] = back[i - 2][idx[i - 1]][idx[i]];
  return { path: idx.map((k, i) => cands[i][k]), cost: total };
}

/** The cheapest path when a move depends only on the last candidate (a first-order search: quicker, for chords). */
export function bestPath1<C>(cands: C[][], node: (i: number, c: C) => number, edge: (i: number, a: C, b: C) => number): { path: C[]; cost: number } {
  const n = cands.length;
  if (!n || cands.some((c) => !c.length)) return { path: [], cost: Infinity };
  let cost = cands[0].map((x) => node(0, x));
  const back: Int32Array[] = [];
  for (let i = 1; i < n; i++) {
    const nc: number[] = [];
    const nb = new Int32Array(cands[i].length);
    cands[i].forEach((b, j) => {
      let best = Infinity;
      let arg = 0;
      cands[i - 1].forEach((a, k) => {
        const t = cost[k] + edge(i, a, b);
        if (t < best - 1e-9) {
          best = t;
          arg = k;
        }
      });
      nc.push(best + node(i, b));
      nb[j] = arg;
    });
    cost = nc;
    back.push(nb);
  }
  let j = 0;
  for (let k = 1; k < cost.length; k++) if (cost[k] < cost[j] - 1e-9) j = k;
  const total = cost[j];
  const idx = new Array<number>(n);
  for (let i = n - 1; i >= 0; i--) {
    idx[i] = j;
    if (i > 0) j = back[i - 1][j];
  }
  return { path: idx.map((k, i) => cands[i][k]), cost: total };
}
