// Estimate near-even openings for a stone shape, Black to move, counting a
// shape once across rotations, reflections AND translations.
// node scripts/sample-gomoku-shapes.mjs <black> <white> <half-width> <sample> <out.json>
// NO_ENGINE=1 skips Rapfi and checks the shape estimate against an exact
// enumeration (small shapes only; 2 2 2 gives 1,949 exact).
// Stones fall in the (2h+1)^2 square around h8, each within Chebyshev 2 of
// another. A sampled position is reduced to its shape class (D4 x translation),
// then placed with its bounding box centred on h8 for the engine. Class counts
// are estimated by weighting each sample by 1 / (raw positions in its class).
import { writeFileSync } from 'node:fs';
import { screenPosition } from './count-gomoku-openings.mjs';
import { loadEngine } from './screen-gomoku-openings.mjs';

const [nb, nw, H, N] = process.argv.slice(2, 6).map(Number);
const out = process.argv[6];
const k = nb + nw;
const cells = [];
for (let x = -H; x <= H; x++) for (let y = -H; y <= H; y++) cells.push([x, y]);
const near = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])) <= 2;
const ok = (pts) => pts.every((c, i) => pts.some((d, j) => i !== j && near(c, d)));
const transforms = [];
for (const sx of [-1, 1])
  for (const sy of [-1, 1])
    for (const swap of [false, true])
      transforms.push(([x, y]) => (swap ? [y * sx, x * sy] : [x * sx, y * sy]));
// Shift so the bounding box starts at 0,0; key on the sorted coloured points.
const normal = (pts) => {
  const mx = Math.min(...pts.map((p) => p[0])),
    my = Math.min(...pts.map((p) => p[1]));
  return pts.map(([x, y, c]) => [x - mx, y - my, c]);
};
const keyOf = (pts) =>
  pts
    .map(([x, y, c]) => `${c}:${x},${y}`)
    .sort()
    .join(';');
function shapeClass(pts) {
  const images = new Set(
    transforms.map((t) => keyOf(normal(pts.map(([x, y, c]) => [...t([x, y]), c])))),
  );
  const key = [...images].sort()[0];
  // Raw positions in this class: each distinct image times the placements of
  // its bounding box inside the square.
  const span = 2 * H + 1;
  let raw = 0;
  for (const image of images) {
    const p = image.split(';').map((s) => s.split(':')[1].split(',').map(Number));
    const w = Math.max(...p.map((q) => q[0])) + 1,
      h = Math.max(...p.map((q) => q[1])) + 1;
    raw += (span - w + 1) * (span - h + 1);
  }
  return { key, raw };
}
const binom = (n, r) => {
  let v = 1;
  for (let i = 0; i < r; i++) v = (v * (n - i)) / (i + 1);
  return v;
};
let s = 36286 >>> 0;
const rand = () => {
  s += 0x6d2b79f5;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
// Uniform over raw coloured positions that pass the distance rule; count
// accepted vs drawn to estimate the raw total.
const square = ([x, y]) => `${String.fromCharCode(104 + x)}${8 + y}`;
const seen = new Map();
let drawn = 0,
  accepted = 0;
while (seen.size < N && drawn < 5e6) {
  drawn++;
  const idx = [];
  while (idx.length < k) {
    const i = Math.floor(rand() * cells.length);
    if (!idx.includes(i)) idx.push(i);
  }
  const set = idx.map((i) => cells[i]);
  if (!ok(set)) continue;
  accepted++;
  const order = [...set.keys()].sort(() => rand() - 0.5);
  const pts = set.map((c, i) => [c[0], c[1], order.indexOf(i) < nb ? 'black' : 'white']);
  const cls = shapeClass(pts);
  if (seen.has(cls.key)) {
    seen.get(cls.key).hits++;
    continue;
  }
  // Engine placement: canonical shape with its bounding box centred on h8.
  const p = cls.key.split(';').map((t) => {
    const [c, xy] = t.split(':');
    const [x, y] = xy.split(',').map(Number);
    return [x, y, c];
  });
  const ox = Math.floor(Math.max(...p.map((q) => q[0])) / 2),
    oy = Math.floor(Math.max(...p.map((q) => q[1])) / 2);
  const candidate = {
    turn: 'black',
    stones: p.map(([x, y, c]) => ({ square: square([x - ox, y - oy]), color: c })),
  };
  seen.set(cls.key, { candidate, raw: cls.raw, hits: 1 });
}
const rawTotal = binom(cells.length, k) * (accepted / drawn) * binom(k, nb);
if (process.env.NO_ENGINE) {
  // Validation: exact class count by enumeration, against the estimate.
  const exact = new Set();
  const walk = (start, chosen) => {
    if (chosen.length === k) {
      if (!ok(chosen)) return;
      const colourings = (i, b, acc) => {
        if (i === k) {
          if (b === nb) exact.add(shapeClass(acc).key);
          return;
        }
        colourings(i + 1, b + 1, [...acc, [...chosen[i], 'black']]);
        colourings(i + 1, b, [...acc, [...chosen[i], 'white']]);
      };
      colourings(0, 0, []);
      return;
    }
    for (let i = start; i < cells.length; i++) walk(i + 1, [...chosen, cells[i]]);
  };
  walk(0, []);
  const estimate = Math.round(
    (rawTotal / accepted) * [...seen.values()].reduce((sum, v) => sum + v.hits / v.raw, 0),
  );
  console.log(
    JSON.stringify({ exactShapes: exact.size, estimate, rawTotal: Math.round(rawTotal) }),
  );
  process.exit(0);
}
const engine = await loadEngine();
const rows = [...seen.values()].map(({ candidate, raw, hits }) => ({
  ...screenPosition(engine, candidate),
  raw,
  hits,
}));
// Each accepted draw lands in a class with probability raw/rawTotal, so
// hits/raw summed over a set of classes estimates its size.
const est = (pred) =>
  Math.round((rawTotal / accepted) * rows.filter(pred).reduce((sum, r) => sum + r.hits / r.raw, 0));
const win = (r) => r.deep?.screen?.winrate;
const inBand = (lo, hi) => (r) => win(r) !== undefined && win(r) >= lo && win(r) <= hi;
const summary = {
  shape: `${nb}B+${nw}W, Black to move, ${2 * H + 1}x${2 * H + 1}`,
  sampledShapes: N,
  shapesEstimate: est(() => true),
  deepSearched: rows.filter((r) => win(r) !== undefined).length,
  forcedOrMate: rows.filter((r) => !r.fast.screen).length,
  band48_52: rows.filter(inBand(0.48, 0.52)).length,
  band45_55: rows.filter(inBand(0.45, 0.55)).length,
  projected48_52: est(inBand(0.48, 0.52)),
  projected45_55: est(inBand(0.45, 0.55)),
};
writeFileSync(
  out,
  JSON.stringify({
    summary,
    rows: rows.map((r) => ({
      candidate: r.candidate,
      raw: r.raw,
      fast: r.fast.screen,
      deep: r.deep?.screen ?? null,
    })),
  }),
);
console.log(JSON.stringify(summary));
process.exit(0);
