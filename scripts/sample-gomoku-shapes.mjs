// Offline Black-to-move shape sampling, with D4 + translation deduplication.
// node scripts/sample-gomoku-shapes.mjs <black> <white> <half-width> <max-shapes> <out.json>
//   [--until-in-band 250 --band 0.48,0.52 --resume --seed-from <previous.json>]
// Full atomic checkpoints every 25 searches; the adjacent .journal.jsonl is
// fsynced after EACH completed search. Keep both files when moving a live run.
// --resume uses the output if present, otherwise starts (optionally from seeds).
// Legacy seeds have no draw/PRNG state: their evidence counts toward the target,
// but their sampling hits start at zero. Redraws update hits without searching.
// NO_ENGINE=1 retains the small-shape exact-enumeration estimator check.
import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { screenPosition } from './count-gomoku-openings.mjs';
import { loadEngine, SCREEN } from './screen-gomoku-openings.mjs';

const INITIAL_SEED = 36286;
const MAX_DRAWS = 5_000_000;
const CHECKPOINT_EVERY = 25;
const enginePin = JSON.parse(
  readFileSync(new URL('../apps/web/public/engine/rapfi/net.json', import.meta.url)),
);
const near = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])) <= 2;
const eligible = (pts) => pts.every((c, i) => pts.some((d, j) => i !== j && near(c, d)));
const transforms = [];
for (const sx of [-1, 1])
  for (const sy of [-1, 1])
    for (const swap of [false, true])
      transforms.push(([x, y]) => (swap ? [y * sx, x * sy] : [x * sx, y * sy]));
const normal = (pts) => {
  const mx = Math.min(...pts.map((p) => p[0]));
  const my = Math.min(...pts.map((p) => p[1]));
  return pts.map(([x, y, c]) => [x - mx, y - my, c]);
};
const keyOf = (pts) =>
  pts
    .map(([x, y, c]) => `${c}:${x},${y}`)
    .sort()
    .join(';');

export function shapeClass(pts, halfWidth) {
  const images = new Set(
    transforms.map((t) => keyOf(normal(pts.map(([x, y, c]) => [...t([x, y]), c])))),
  );
  let raw = 0;
  for (const image of images) {
    const p = image.split(';').map((s) => s.split(':')[1].split(',').map(Number));
    const w = Math.max(...p.map((q) => q[0])) + 1;
    const h = Math.max(...p.map((q) => q[1])) + 1;
    raw += (2 * halfWidth + 2 - w) * (2 * halfWidth + 2 - h);
  }
  return { key: [...images].sort()[0], raw };
}
const binom = (n, r) => {
  let v = 1;
  for (let i = 0; i < r; i++) v = (v * (n - i)) / (i + 1);
  return v;
};
const square = ([x, y]) => `${String.fromCharCode(104 + x)}${8 + y}`;
function placement(key) {
  const p = key.split(';').map((t) => {
    const [color, xy] = t.split(':');
    return [...xy.split(',').map(Number), color];
  });
  const ox = Math.floor(Math.max(...p.map((q) => q[0])) / 2);
  const oy = Math.floor(Math.max(...p.map((q) => q[1])) / 2);
  return {
    turn: 'black',
    stones: p.map(([x, y, color]) => ({ square: square([x - ox, y - oy]), color })),
  };
}
function cellsFor(halfWidth) {
  const cells = [];
  for (let x = -halfWidth; x <= halfWidth; x++)
    for (let y = -halfWidth; y <= halfWidth; y++) cells.push([x, y]);
  return cells;
}
function validateOptions(o) {
  if (
    ![o.black, o.white, o.halfWidth, o.sample].every((n) => Number.isSafeInteger(n) && n > 0) ||
    o.halfWidth > 7 ||
    o.black + o.white > (2 * o.halfWidth + 1) ** 2
  )
    throw new Error('Expected positive black/white counts, half-width 1..7 and max-shapes');
  if (o.untilInBand !== undefined && (!Number.isSafeInteger(o.untilInBand) || o.untilInBand < 1))
    throw new Error('--until-in-band must be a positive integer');
  if (
    !Array.isArray(o.band) ||
    o.band.length !== 2 ||
    !o.band.every(Number.isFinite) ||
    o.band[0] < 0 ||
    o.band[1] > 1 ||
    o.band[0] > o.band[1]
  )
    throw new Error('--band must be inclusive lower,upper probabilities in 0..1');
}
export function parseArgs(args) {
  const [black, white, halfWidth, sample] = args.slice(0, 4).map(Number);
  const o = { black, white, halfWidth, sample, output: args[4], band: [0.48, 0.52] };
  if (!o.output || o.output.startsWith('--')) throw new Error('An output JSON path is required');
  for (let i = 5; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--resume') {
      o.resume = true;
      continue;
    }
    if (!['--until-in-band', '--band', '--seed-from'].includes(flag))
      throw new Error(`Unknown flag ${flag}`);
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    if (flag === '--until-in-band') o.untilInBand = Number(value);
    if (flag === '--band') o.band = value.split(',').map(Number);
    if (flag === '--seed-from') o.seedFrom = value;
  }
  validateOptions(o);
  return o;
}
const inBand = (row, [lo, hi]) =>
  Number.isFinite(row.deep?.winrate) && row.deep.winrate >= lo && row.deep.winrate <= hi;
function normalizeRow(row, o, seeded = false) {
  const candidate = row.candidate;
  if (candidate?.turn !== 'black' || !Array.isArray(candidate.stones))
    throw new Error('Invalid seed/checkpoint candidate');
  const pts = candidate.stones.map(({ square: sq, color }) => {
    if (!/^[a-o](?:[1-9]|1[0-5])$/.test(sq) || !['black', 'white'].includes(color))
      throw new Error('Invalid seed/checkpoint stone');
    return [sq.charCodeAt(0) - 104, Number(sq.slice(1)) - 8, color];
  });
  if (
    pts.length !== o.black + o.white ||
    pts.filter((p) => p[2] === 'black').length !== o.black ||
    new Set(pts.map(([x, y]) => `${x},${y}`)).size !== pts.length ||
    pts.some(([x, y]) => Math.max(Math.abs(x), Math.abs(y)) > o.halfWidth) ||
    !eligible(pts)
  )
    throw new Error('Seed/checkpoint candidate does not match shape configuration');
  const cls = shapeClass(pts, o.halfWidth);
  if (row.raw !== cls.raw || (row.key !== undefined && row.key !== cls.key))
    throw new Error('Seed/checkpoint raw class size or key mismatch');
  const hits = seeded ? 0 : row.hits;
  if (!Number.isSafeInteger(hits) || hits < 0) throw new Error('Invalid checkpoint hits');
  if (!Object.hasOwn(row, 'fast') || !Object.hasOwn(row, 'deep'))
    throw new Error('Missing screening evidence');
  return {
    key: cls.key,
    candidate: placement(cls.key),
    raw: cls.raw,
    hits,
    fast: row.fast,
    deep: row.deep,
  };
}
function durableWrite(path, content, flag = 'w') {
  const fd = openSync(path, flag);
  try {
    writeFileSync(fd, content);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** Screen is injected for deterministic engine-free failure/recovery tests. */
export function mineShapes(options, { screen, onCheckpoint = () => {} } = {}) {
  const o = { band: [0.48, 0.52], ...options };
  validateOptions(o);
  const config = {
    black: o.black,
    white: o.white,
    halfWidth: o.halfWidth,
    screening: SCREEN,
    prefilterMaxAbsScore: 170,
    engineDataSha256: enginePin.sha256,
  };
  const journal = o.output && `${o.output}.journal.jsonl`;
  const seen = new Map();
  let state = { drawn: 0, accepted: 0, prngState: INITIAL_SEED, sequence: 0, seededShapes: 0 };
  const insert = (row, seeded = false) => {
    const normalized = normalizeRow(row, o, seeded);
    if (seen.has(normalized.key)) {
      if (!seeded) throw new Error('Duplicate class in checkpoint/journal');
      const prior = seen.get(normalized.key);
      if (
        JSON.stringify([prior.fast, prior.deep]) !==
        JSON.stringify([normalized.fast, normalized.deep])
      )
        throw new Error('Conflicting seed evidence for a class');
    } else seen.set(normalized.key, normalized);
  };
  const resuming = o.resume && o.output && existsSync(o.output);
  if (o.output && !resuming && (existsSync(o.output) || existsSync(journal)))
    throw new Error('Output or journal exists; use --resume or a new output path');
  if (resuming) {
    const data = JSON.parse(readFileSync(o.output, 'utf8'));
    if (data.version !== 1 || JSON.stringify(data.config) !== JSON.stringify(config))
      throw new Error('Resume configuration does not match checkpoint');
    state = data.state;
    for (const row of data.rows) insert(row);
    if (existsSync(journal)) {
      const content = readFileSync(journal, 'utf8');
      const end = content.lastIndexOf('\n') + 1;
      for (const line of content.slice(0, end).split('\n').filter(Boolean)) {
        const entry = JSON.parse(line);
        if (!Number.isSafeInteger(entry.sequence)) throw new Error('Invalid journal sequence');
        // Atomic rename can succeed just before journal truncation is interrupted.
        if (entry.sequence <= state.sequence) continue;
        if (entry.sequence !== state.sequence + 1 || entry.state.sequence !== entry.sequence)
          throw new Error('Journal sequence gap');
        for (const [key, hits] of entry.hits) {
          if (!seen.has(key) || !Number.isSafeInteger(hits) || hits < 1)
            throw new Error('Invalid journal hits');
          seen.get(key).hits += hits;
        }
        insert(entry.row);
        state = entry.state;
      }
      // Only a newline-terminated record was committed. Remove any torn tail.
      truncateSync(journal, Buffer.byteLength(content.slice(0, end)));
    }
    if (
      !state ||
      !['drawn', 'accepted', 'prngState', 'sequence', 'seededShapes'].every(
        (field) => Number.isSafeInteger(state[field]) && state[field] >= 0,
      ) ||
      state.prngState > 0xffffffff ||
      state.drawn < state.accepted ||
      state.sequence + state.seededShapes !== seen.size ||
      [...seen.values()].reduce((n, row) => n + row.hits, 0) !== state.accepted
    )
      throw new Error('Invalid checkpoint counters/PRNG/hits');
  } else if (o.seedFrom) {
    const data = JSON.parse(readFileSync(o.seedFrom, 'utf8'));
    if (!Array.isArray(data.rows)) throw new Error('Seed must contain screened rows');
    for (const row of data.rows) insert(row, true);
    state.seededShapes = seen.size;
  }
  const cells = cellsFor(o.halfWidth);
  const k = o.black + o.white;
  let inBandCount = [...seen.values()].filter((row) => inBand(row, o.band)).length;
  const targetReached = () => o.untilInBand !== undefined && inBandCount >= o.untilInBand;
  const snapshot = () => {
    const rows = [...seen.values()];
    const rawTotal = state.drawn
      ? binom(cells.length, k) * (state.accepted / state.drawn) * binom(k, o.black)
      : 0;
    const est = (pred) =>
      state.accepted
        ? Math.round(
            (rawTotal / state.accepted) *
              rows.filter(pred).reduce((sum, row) => sum + row.hits / row.raw, 0),
          )
        : null;
    const summary = {
      shape: `${o.black}B+${o.white}W, Black to move, ${2 * o.halfWidth + 1}x${2 * o.halfWidth + 1}`,
      sampledShapes: rows.length,
      shapesEstimate: est(() => true),
      deepSearched: rows.filter((row) => Number.isFinite(row.deep?.winrate)).length,
      forcedOrMate: rows.filter((row) => !row.fast).length,
      band48_52: rows.filter((row) => inBand(row, [0.48, 0.52])).length,
      band45_55: rows.filter((row) => inBand(row, [0.45, 0.55])).length,
      projected48_52: est((row) => inBand(row, [0.48, 0.52])),
      projected45_55: est((row) => inBand(row, [0.45, 0.55])),
      band: o.band,
      inBand: inBandCount,
      untilInBand: o.untilInBand ?? null,
      stopReason: targetReached()
        ? 'target'
        : seen.size >= o.sample
          ? 'shape-limit'
          : state.drawn >= MAX_DRAWS
            ? 'draw-limit'
            : 'running',
    };
    return { version: 1, config, state: { ...state }, summary, rows };
  };
  const checkpoint = () => {
    const data = snapshot();
    if (o.output) {
      durableWrite(`${o.output}.tmp`, `${JSON.stringify(data)}\n`);
      renameSync(`${o.output}.tmp`, o.output);
      durableWrite(journal, '');
    }
    onCheckpoint(data);
  };
  if (!resuming) checkpoint();
  const rand = () => {
    state.prngState = (state.prngState + 0x6d2b79f5) >>> 0;
    let t = state.prngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const hitUpdates = new Map();
  while (!targetReached() && seen.size < o.sample && state.drawn < MAX_DRAWS) {
    state.drawn++;
    const idx = [];
    while (idx.length < k) {
      const i = Math.floor(rand() * cells.length);
      if (!idx.includes(i)) idx.push(i);
    }
    const set = idx.map((i) => cells[i]);
    if (!eligible(set)) continue;
    state.accepted++;
    const order = [...set.keys()].sort(() => rand() - 0.5);
    const cls = shapeClass(
      set.map((c, i) => [...c, order.indexOf(i) < o.black ? 'black' : 'white']),
      o.halfWidth,
    );
    if (seen.has(cls.key)) {
      seen.get(cls.key).hits++;
      hitUpdates.set(cls.key, (hitUpdates.get(cls.key) ?? 0) + 1);
      continue;
    }
    const candidate = placement(cls.key);
    const result = screen(candidate);
    const row = {
      key: cls.key,
      candidate,
      raw: cls.raw,
      hits: 1,
      fast: result.fast?.screen ?? null,
      deep: result.deep?.screen ?? null,
    };
    state.sequence++;
    if (journal)
      durableWrite(
        journal,
        `${JSON.stringify({ sequence: state.sequence, state, row, hits: [...hitUpdates] })}\n`,
        'a',
      );
    hitUpdates.clear();
    seen.set(cls.key, row);
    if (inBand(row, o.band)) inBandCount++;
    if (state.sequence % CHECKPOINT_EVERY === 0) checkpoint();
  }
  checkpoint();
  return snapshot();
}

function exactShapes(o) {
  const cells = cellsFor(o.halfWidth);
  const k = o.black + o.white;
  const exact = new Set();
  const walk = (start, chosen) => {
    if (chosen.length === k) {
      if (!eligible(chosen)) return;
      const colourings = (i, b, acc) => {
        if (b > o.black || b + k - i < o.black) return;
        if (i === k) {
          exact.add(shapeClass(acc, o.halfWidth).key);
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
  return exact.size;
}
async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (process.env.NO_ENGINE) {
    if (o.resume || o.seedFrom || o.untilInBand)
      throw new Error('NO_ENGINE validates fixed samples only');
    const data = mineShapes(
      { ...o, output: undefined },
      {
        screen: (candidate) => ({ candidate, fast: null, deep: null }),
      },
    );
    console.log(
      JSON.stringify({ exactShapes: exactShapes(o), estimate: data.summary.shapesEstimate }),
    );
    return;
  }
  const engine = await loadEngine();
  const data = mineShapes(o, {
    screen: (candidate) => screenPosition(engine, candidate),
    onCheckpoint: (data) => console.log(JSON.stringify(data.summary)),
  });
  if (o.untilInBand && data.summary.inBand < o.untilInBand) process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
  process.exit(process.exitCode ?? 0);
}
