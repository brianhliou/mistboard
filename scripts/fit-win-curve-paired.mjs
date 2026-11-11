#!/usr/bin/env node
// Match CC0 @6 win% to historical @5 win%, least squares on paired positions.
// No engine, build or network needed, including from a clean clone:
//   node scripts/fit-win-curve-paired.mjs
//   node scripts/fit-win-curve-paired.mjs --old path.json --new path.json --boot 2000 --seed 20261109
// Outcome cross-check: node scripts/fit-win-curve.mjs --in scripts/data/win-curve-samples-pikafish-cc0.json
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i < 0 ? fallback : args[i + 1];
};
const bootstrapReplicates = Number(arg('--boot', '2000'));
const seed = Number(arg('--seed', '20261109'));
if (!Number.isInteger(bootstrapReplicates) || bootstrapReplicates < 1) {
  throw new Error('--boot must be a positive integer');
}
if (!Number.isInteger(seed) || seed < 0 || seed >= 2 ** 31) {
  throw new Error('--seed must be an integer in [0, 2^31)');
}
const read = (flag, fallback) =>
  JSON.parse(readFileSync(resolve(root, arg(flag, fallback)), 'utf8')).samples;
const old = read('--old', 'scripts/data/win-curve-samples.json');
const fresh = read('--new', 'scripts/data/win-curve-samples-pikafish-cc0.json');
const keyOf = (row) => JSON.stringify([row.key, row.ply]);
function index(samples) {
  const out = new Map();
  for (const row of samples) {
    const key = keyOf(row);
    if (out.has(key)) throw new Error(`duplicate sample ${key}`);
    out.set(key, row);
  }
  return out;
}
index(old); // Reject ambiguous old pairs too; retain old order for seeded resampling.
const newByKey = index(fresh);
const rows = old.map((before) => {
  const after = newByKey.get(keyOf(before));
  if (!after) throw new Error(`missing paired sample ${keyOf(before)}`);
  return { key: before.key, cp5: before.cp, cp6: after.cp, mate5: before.mate, mate6: after.mate };
});
if (old.length !== fresh.length) throw new Error('sample files must contain the same positions');

const K5 = 0.00368208;
const clamp = (cp) => Math.max(-1000, Math.min(1000, cp));
const wp = (k, cp) => 1 / (1 + Math.exp(-k * clamp(cp)));
const paired = rows.filter((row) => row.cp5 != null && row.cp6 != null);
if (!paired.length) throw new Error('no paired centipawn samples');
for (const row of paired) {
  if (!Number.isFinite(row.cp5) || !Number.isFinite(row.cp6)) {
    throw new Error('paired centipawn scores must be finite numbers');
  }
  row.target = wp(K5, row.cp5);
  row.clamped6 = clamp(row.cp6);
}
const byGame = new Map();
for (const row of paired) {
  const game = byGame.get(row.key) ?? [];
  game.push(row);
  byGame.set(row.key, game);
}
const games = [...byGame.values()];
function fitK(set) {
  let lo = 0.0005;
  let hi = 0.02;
  const loss = (k) =>
    set.reduce((sum, row) => sum + (row.target - 1 / (1 + Math.exp(-k * row.clamped6))) ** 2, 0);
  for (let i = 0; i < 100; i += 1) {
    const a = hi - (hi - lo) / 1.618;
    const b = lo + (hi - lo) / 1.618;
    if (loss(a) < loss(b)) hi = b;
    else lo = a;
  }
  return (lo + hi) / 2;
}
const k6 = fitK(paired);
// Preserve the owning fit's floating-point LCG stream, including JS rounding.
// Switching to Math.imul would change the bootstrap draws and quoted interval.
let state = seed;
const random = () => {
  state = (state * 1103515245 + 12345) % 2 ** 31;
  return state / 2 ** 31;
};
const boots = [];
for (let b = 0; b < bootstrapReplicates; b += 1) {
  const set = [];
  for (let i = 0; i < games.length; i += 1) {
    set.push(...games[Math.floor(random() * games.length)]);
  }
  boots.push(fitK(set));
}
boots.sort((a, b) => a - b);
const q = (p) => boots[Math.floor(p * (boots.length - 1))];
const mean = (xs) => xs.reduce((sum, x) => sum + x, 0) / Math.max(1, xs.length);
const bands = [
  [0, 75],
  [75, 200],
  [200, 500],
  [500, 1000],
].map(([a, b]) => {
  const set = paired.filter((row) => Math.abs(row.cp5) >= a && Math.abs(row.cp5) < b);
  return {
    band: `${a}-${b}`,
    n: set.length,
    meanAbsCp5: Math.round(mean(set.map((row) => Math.abs(row.cp5)))),
    meanAbsCp6: Math.round(mean(set.map((row) => Math.abs(row.cp6)))),
    winDev5: +(100 * mean(set.map((row) => Math.abs(wp(K5, row.cp5) - 0.5)))).toFixed(1),
    winDev6: +(100 * mean(set.map((row) => Math.abs(wp(k6, row.cp6) - 0.5)))).toFixed(1),
  };
});
const inBand = paired.filter((row) => Math.abs(row.cp5) <= 1000 && Math.abs(row.cp6) <= 1000);
const regression =
  inBand.reduce((sum, row) => sum + row.cp5 * row.cp6, 0) /
  inBand.reduce((sum, row) => sum + row.cp6 * row.cp6, 0);
console.log(
  JSON.stringify(
    {
      positions: rows.length,
      paired: paired.length,
      games: games.length,
      k6: +k6.toFixed(8),
      ci95: [+q(0.025).toFixed(6), +q(0.975).toFixed(6)],
      bootstrapReplicates,
      seed,
      ratioK6toK5: +(k6 / K5).toFixed(3),
      cpRegression_cp5_per_cp6: +regression.toFixed(3),
      bands,
      signFlipsOver50: paired.filter(
        (row) => Math.sign(row.cp5) * Math.sign(row.cp6) < 0 && Math.abs(row.cp5) > 50,
      ).length,
      mates: {
        mate5: rows.filter((row) => row.mate5 != null).length,
        mate6: rows.filter((row) => row.mate6 != null).length,
      },
    },
    null,
    2,
  ),
);
