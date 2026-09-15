// Where each contract sits on the map.
//
// Computed here, in Node, and embedded as numbers — never in the browser. Two reasons. The report
// must be reproducible: two runs on one commit produce byte-identical files, so `diff` between
// versions shows what the CODE changed rather than what a force simulation happened to settle on.
// And a layout is a claim about structure ("this is made by that"), so it belongs where it can be
// tested, not in a script that only runs when someone opens the page.
//
// Layered, left to right: things nothing here creates sit on the left, and each contract sits one
// column right of the furthest thing that makes or calls it. That is the reading order of a
// protocol — the admin's roots first, the user's contracts in the middle, what they produce last.
//
// Deterministic throughout: every ordering has an explicit tie-break, and nothing is random.

export const CARD = Object.freeze({ w: 212, h: 84, gapX: 104, gapY: 26 });

const byKey = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * @param nodes  [{ id, sort? }]          sort defaults to id
 * @param links  [{ from, to }]           directed; duplicates and self-links are ignored
 * @returns {{ pos: Map<id,{x,y,layer,standalone}>, width, height, reversed: [from,to][], standaloneTop }}
 */
export function layout(nodes, links, { card = CARD, sweeps = 8 } = {}) {
  const ids = [...nodes]
    .sort((a, b) => byKey(a.sort ?? a.id, b.sort ?? b.id) || byKey(a.id, b.id))
    .map((n) => n.id);
  const known = new Set(ids);

  const pairs = [];
  const seen = new Set();
  for (const l of links) {
    if (l.from === l.to || !known.has(l.from) || !known.has(l.to)) continue;
    const k = `${l.from}|${l.to}`;
    if (!seen.has(k)) { seen.add(k); pairs.push([l.from, l.to]); }
  }
  const rank = new Map(ids.map((id, i) => [id, i]));
  const succ = new Map(ids.map((id) => [id, []]));
  for (const [a, b] of pairs) succ.get(a).push(b);
  for (const id of ids) succ.get(id).sort((a, b) => rank.get(a) - rank.get(b));

  // ── 1. break cycles ───────────────────────────────────────────────────────────────────────────
  // A contract that makes another which makes the first back is common (a vault re-creating its
  // risk mirror). Layering needs a DAG, so back edges are reversed — and returned, not hidden.
  // Iterative DFS: a recursive one overflows the stack on a large codebase.
  const indeg0 = new Map(ids.map((id) => [id, 0]));
  for (const [, b] of pairs) indeg0.set(b, indeg0.get(b) + 1);
  const starts = [...ids.filter((id) => indeg0.get(id) === 0), ...ids.filter((id) => indeg0.get(id) > 0)];
  const state = new Map(); // absent = unvisited, 1 = on the DFS stack, 2 = finished
  const dag = new Map(ids.map((id) => [id, new Set()]));
  const reversed = [];
  for (const s of starts) {
    if (state.has(s)) continue;
    state.set(s, 1);
    const stack = [[s, 0]];
    while (stack.length) {
      const top = stack[stack.length - 1];
      const out = succ.get(top[0]);
      if (top[1] < out.length) {
        const w = out[top[1]++];
        const st = state.get(w);
        if (st === 1) {
          dag.get(w).add(top[0]);
          reversed.push([top[0], w]);
        } else {
          dag.get(top[0]).add(w);
          if (st === undefined) { state.set(w, 1); stack.push([w, 0]); }
        }
      } else {
        state.set(top[0], 2);
        stack.pop();
      }
    }
  }

  // ── 2. columns: longest path from the roots ─────────────────────────────────────────────────
  const dsucc = new Map(ids.map((id) => [id, [...dag.get(id)].sort((a, b) => rank.get(a) - rank.get(b))]));
  const preds = new Map(ids.map((id) => [id, []]));
  for (const id of ids) for (const w of dsucc.get(id)) preds.get(w).push(id);
  const indeg = new Map(ids.map((id) => [id, preds.get(id).length]));
  const layer = new Map(ids.map((id) => [id, 0]));
  const queue = ids.filter((id) => indeg.get(id) === 0);
  for (let qi = 0; qi < queue.length; qi++) {
    const v = queue[qi];
    for (const w of dsucc.get(v)) {
      layer.set(w, Math.max(layer.get(w), layer.get(v) + 1));
      indeg.set(w, indeg.get(w) - 1);
      if (indeg.get(w) === 0) queue.push(w);
    }
  }

  // Contracts connected to nothing are not roots of anything, and stacking them into the first
  // column would bury the protocol's real starting points. They get their own block underneath.
  const touched = new Set(pairs.flat());
  const standalone = ids.filter((id) => !touched.has(id));
  const layers = [];
  for (const id of ids) if (touched.has(id)) (layers[layer.get(id)] ??= []).push(id);
  for (let i = 0; i < layers.length; i++) layers[i] ??= [];

  // ── 3. order within a column: barycentre sweeps, to uncross the lines ──────────────────────
  const at = new Map();
  const renumber = (L) => L.forEach((id, i) => at.set(id, (i + 0.5) / L.length));
  layers.forEach(renumber);
  for (let s = 0; s < sweeps; s++) {
    const down = s % 2 === 0;
    const order = layers.map((_, i) => i);
    if (!down) order.reverse();
    for (const li of order) {
      const L = layers[li];
      const bc = new Map(L.map((id) => {
        const near = down ? preds.get(id) : dsucc.get(id);
        return [id, near.length ? near.reduce((acc, n) => acc + at.get(n), 0) / near.length : at.get(id)];
      }));
      L.sort((a, b) => bc.get(a) - bc.get(b) || at.get(a) - at.get(b) || rank.get(a) - rank.get(b));
      renumber(L);
    }
  }

  // ── 4. coordinates ────────────────────────────────────────────────────────────────────────────
  const pos = new Map();
  const colH = (n) => n * card.h + Math.max(0, n - 1) * card.gapY;
  const H = colH(Math.max(0, ...layers.map((L) => L.length)));
  layers.forEach((L, li) => {
    const top = Math.round((H - colH(L.length)) / 2);
    L.forEach((id, i) => pos.set(id, {
      x: li * (card.w + card.gapX), y: top + i * (card.h + card.gapY), layer: li, standalone: false,
    }));
  });
  const standaloneTop = standalone.length && layers.length ? H + card.gapY * 4 : 0;
  if (standalone.length) {
    const cols = Math.max(layers.length, Math.ceil(Math.sqrt(standalone.length)), 1);
    standalone.forEach((id, i) => pos.set(id, {
      x: (i % cols) * (card.w + card.gapX),
      y: standaloneTop + Math.floor(i / cols) * (card.h + card.gapY),
      layer: -1, standalone: true,
    }));
  }
  let width = 0;
  let height = 0;
  for (const p of pos.values()) {
    width = Math.max(width, p.x + card.w);
    height = Math.max(height, p.y + card.h);
  }
  return { pos, width, height, reversed, standaloneTop };
}
