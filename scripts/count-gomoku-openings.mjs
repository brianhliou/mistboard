#!/usr/bin/env node
// Offline measurement only. Never writes the game's opening pool.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine, passesScreen, positionKey, SCREEN } from './screen-gomoku-openings.mjs';

const local = Array.from({ length: 25 }, (_, i) => [5 + Math.floor(i / 5), 5 + (i % 5)]);
const neighbours = local.map(([x, y], i) =>
  local.reduce(
    (mask, [a, b], j) =>
      i !== j && Math.max(Math.abs(x - a), Math.abs(y - b)) <= 2 ? mask | (1 << j) : mask,
    0,
  ),
);
const transforms = [-1, 1].flatMap((sx) =>
  [-1, 1].flatMap((sy) =>
    [false, true].map((swap) =>
      local.map(([x, y]) => {
        const a = (x - 7) * sx;
        const b = (y - 7) * sy;
        return 1 << ((2 + (swap ? b : a)) * 5 + 2 + (swap ? a : b));
      }),
    ),
  ),
);

function* choose(length, count, start = 0, selected = []) {
  if (!count) {
    yield selected;
    return;
  }
  for (let i = start; i <= length - count; i += 1)
    yield* choose(length, count - 1, i + 1, [...selected, i]);
}

function combinations(length, count) {
  let result = 1;
  for (let i = 1; i <= count; i += 1) result = (result * (length - i + 1)) / i;
  return result;
}

function validateShape(perColor) {
  if (perColor !== 2 && perColor !== 3) throw new Error('stones per colour must be 2 or 3');
}

const maskOf = (indices) => indices.reduce((mask, i) => mask | (1 << i), 0);
const hasNeighbours = (indices, mask) => indices.every((i) => (neighbours[i] & mask) !== 0);

export function isEligible(candidate, perColor) {
  validateShape(perColor);
  if (candidate.turn !== 'black' || candidate.stones.length !== perColor * 2) return false;
  const indices = [];
  for (const stone of candidate.stones) {
    if (!/^[f-j](?:[6-9]|10)$/.test(stone.square)) return false;
    indices.push((stone.square.charCodeAt(0) - 102) * 5 + Number(stone.square.slice(1)) - 6);
  }
  return (
    new Set(indices).size === indices.length &&
    candidate.stones.filter((s) => s.color === 'black').length === perColor &&
    candidate.stones.filter((s) => s.color === 'white').length === perColor &&
    hasNeighbours(indices, maskOf(indices))
  );
}

/** Canonicalize occupied geometry first to avoid constructing millions of
 * coloured objects. The eight transforms are around h8, with no translations.
 * Orbit sizes recover the raw (unordered, coloured) position count. */
function* geometries(perColor) {
  validateShape(perColor);
  for (const indices of choose(25, 2 * perColor)) {
    const mask = maskOf(indices);
    if (!hasNeighbours(indices, mask)) continue;
    const orbit = new Set();
    let canonical = true;
    for (const transform of transforms) {
      const transformed = indices.reduce((bits, i) => bits | transform[i], 0);
      if (transformed < mask) {
        canonical = false;
        break;
      }
      orbit.add(transformed);
    }
    if (!canonical) continue;
    yield { indices, orbitSize: orbit.size };
  }
}

/** Colours remain labelled. positionKey also removes any colourings related
 * by a symmetry that fixes this occupied geometry. Move order is irrelevant. */
function* colorings(indices, perColor) {
  const seen = new Set();
  for (const black of choose(indices.length, perColor)) {
    const candidate = {
      turn: 'black',
      stones: indices.map((i, slot) => ({
        square: `${String.fromCharCode(97 + local[i][0])}${local[i][1] + 1}`,
        color: black.includes(slot) ? 'black' : 'white',
      })),
    };
    const key = positionKey(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    yield candidate;
  }
}

export function* balancedOpenings(perColor) {
  for (const { indices } of geometries(perColor)) yield* colorings(indices, perColor);
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function countShape(perColor, { sampleSize = 0, seed = 36286 } = {}) {
  validateShape(perColor);
  if (!Number.isSafeInteger(sampleSize) || sampleSize < 0) throw new Error('invalid sample size');
  const random = seededRandom(seed);
  const sample = [];
  let raw = 0;
  let postSymmetry = 0;
  for (const { indices, orbitSize } of geometries(perColor)) {
    raw += orbitSize * combinations(perColor * 2, perColor);
    for (const opening of colorings(indices, perColor)) {
      postSymmetry += 1;
      if (!sampleSize) continue;
      if (sample.length < sampleSize) sample.push(opening);
      else {
        const slot = Math.floor(random() * postSymmetry);
        if (slot < sampleSize) sample[slot] = opening;
      }
    }
  }
  return {
    perColor,
    rawBeforeDistance: combinations(25, 2 * perColor) * combinations(2 * perColor, perColor),
    raw,
    postSymmetry,
    sample,
  };
}

export function screenPosition(engine, candidate) {
  const start = performance.now();
  const fast = engine.search(candidate, SCREEN.prefilterNodes);
  fast.seconds = (performance.now() - start) / 1000;
  let deep = null;
  if (fast.screen && Math.abs(fast.screen.finalScore) <= 170) {
    const deepStart = performance.now();
    deep = engine.search(candidate, SCREEN.nodes);
    deep.seconds = (performance.now() - deepStart) / 1000;
  }
  return {
    candidate,
    positionKey: positionKey(candidate),
    fast,
    deep,
    totalSeconds: (performance.now() - start) / 1000,
    inBand: Boolean(deep?.screen && deep.screen.winrate >= 0.48 && deep.screen.winrate <= 0.52),
    passesExistingScreen: Boolean(deep && passesScreen(deep.screen)),
  };
}

export function summarizeSample(rows) {
  const total = rows.reduce((sum, row) => sum + row.totalSeconds, 0);
  const deep = rows.filter((row) => row.deep);
  const deepSeconds = deep.reduce((sum, row) => sum + row.deep.seconds, 0);
  const inBand = rows.filter((row) => row.inBand).length;
  return {
    positions: rows.length,
    deepSearched: deep.length,
    validDeepResults: deep.filter((row) => row.deep.screen).length,
    prefilterRejected: rows.filter((row) => !row.deep && row.fast.screen).length,
    invalidPrefilter: rows.filter((row) => !row.fast.screen).length,
    invalidDeep: deep.filter((row) => !row.deep.screen).length,
    inBand,
    shareInBand: rows.length ? inBand / rows.length : null,
    passesExistingScreen: rows.filter((row) => row.passesExistingScreen).length,
    totalSearchSeconds: total,
    secondsPerPosition: rows.length ? total / rows.length : null,
    prefilterSecondsPerPosition: rows.length
      ? rows.reduce((sum, row) => sum + row.fast.seconds, 0) / rows.length
      : null,
    deepSecondsPerPosition: deep.length ? deepSeconds / deep.length : null,
  };
}

async function main() {
  const options = {};
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 2) {
    if (!['--sample', '--seed', '--screen-all', '--output'].includes(args[i]) || !args[i + 1])
      throw new Error(
        'Usage: --sample 40 --seed 36286 --output <json> OR --screen-all A|B --output <json>; no arguments counts only',
      );
    options[args[i].slice(2)] = args[i + 1];
  }
  const sampleSize = Number(options.sample ?? 0);
  const seed = Number(options.seed ?? 36286);
  const fullShape = options['screen-all'];
  if (
    !Number.isSafeInteger(sampleSize) ||
    sampleSize < 0 ||
    !Number.isSafeInteger(seed) ||
    (fullShape && !['A', 'B'].includes(fullShape)) ||
    (fullShape && sampleSize)
  )
    throw new Error('Invalid sample, seed or shape');
  if ((sampleSize || fullShape) && !options.output)
    throw new Error('--output is required for screening');
  const startedAt = new Date().toISOString();
  const a = countShape(2, { sampleSize, seed });
  const b = countShape(3);
  const { sample, ...shapeA } = a;
  const { sample: unused, ...shapeB } = b;
  void unused;
  const report = {
    startedAt,
    definition: {
      region: 'f6-j10 (h8 +/- 2)',
      turn: 'black',
      distance: 'Every stone has another stone within Chebyshev distance 2, either colour',
      identity: 'Unordered coloured positions, D4 around h8; no colour swaps or translations',
    },
    counts: { A: shapeA, B: shapeB },
  };
  console.log(JSON.stringify(report.counts));
  if (!sampleSize && !fullShape) return;
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const engineStart = performance.now();
  const engine = await loadEngine();
  const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
  report.screening = {
    ...SCREEN,
    minWinrate: 0.48,
    maxWinrate: 0.52,
    prefilterMaxAbsScore: 170,
    scorePerspective: 'Black (side to move)',
    hashPolicy: 'YXHASHCLEAR before every search',
    runtime: process.version,
    cpu: cpus()[0]?.model,
    logicalCpus: cpus().length,
    engine: engine.pin,
    wasmSha256: sha256(resolve(root, 'apps/web/public/engine/rapfi/rapfi-single-simd128.wasm')),
    scriptSha256: sha256(fileURLToPath(import.meta.url)),
    screenerSha256: sha256(resolve(root, 'scripts/screen-gomoku-openings.mjs')),
    engineInitializationSeconds: (performance.now() - engineStart) / 1000,
    samplePolicy: fullShape ? 'all distinct positions' : 'reservoir over distinct D4 classes',
    shape: fullShape ?? 'A',
    seed: fullShape ? null : seed,
  };
  report.rows = [];
  const output = resolve(options.output);
  if (output === resolve(root, 'packages/game/src/gomoku-openings.json'))
    throw new Error('Measurement must not overwrite the game opening pool');
  mkdirSync(dirname(output), { recursive: true });
  const save = (complete) => {
    report.complete = complete;
    report.summary = summarizeSample(report.rows);
    report.updatedAt = new Date().toISOString();
    writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  };
  const positions = fullShape ? balancedOpenings(fullShape === 'A' ? 2 : 3) : sample;
  save(false);
  for (const candidate of positions) {
    report.rows.push(screenPosition(engine, candidate));
    if (!fullShape || report.rows.length % 25 === 0) save(false);
    console.log(JSON.stringify(report.summary));
  }
  save(true);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
