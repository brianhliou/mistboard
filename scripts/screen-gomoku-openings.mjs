#!/usr/bin/env node
// Offline Rapfi screening. Run from the repo root after staging net.json's data.
// node scripts/screen-gomoku-openings.mjs --audit /tmp/gomoku-screen.jsonl
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

export const SCREEN = Object.freeze({
  nodes: 1_000_000,
  prefilterNodes: 10_000,
  maxAbsScore: 40,
  minWinrate: 0.45,
  maxWinrate: 0.55,
  timeoutMs: 60_000,
});
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const square = (x, y) => `${String.fromCharCode(97 + x)}${y + 1}`;
const coordinates = (stone) => [stone.square.charCodeAt(0) - 97, Number(stone.square.slice(1)) - 1];
const opening = (points, classicId) => ({
  classicId,
  stones: points.map(([x, y], ply) => ({
    square: square(x, y),
    color: ply % 2 ? 'white' : 'black',
  })),
  turn: points.length % 2 ? 'white' : 'black',
});

/** The 13 direct and 13 indirect three-stone openings, up to D4 symmetry:
 * Black at h8, White at h9 or i9, Black's third in the central 5x5.
 * Keep one representative under the reflection fixing the first two stones. */
export function classicOpenings() {
  const result = [];
  for (const diagonal of [false, true]) {
    let number = 0;
    for (let x = -2; x <= 2; x += 1) {
      for (let y = -2; y <= 2; y += 1) {
        if ((x === 0 && y === 0) || (x === Number(diagonal) && y === 1)) continue;
        if (diagonal ? x < y : x < 0) continue;
        result.push(
          opening(
            [
              [7, 7],
              [7 + Number(diagonal), 8],
              [7 + x, 7 + y],
            ],
            `${diagonal ? 'indirect' : 'direct'}-${++number}`,
          ),
        );
      }
    }
  }
  return result;
}

export function positionKey(candidate) {
  const points = candidate.stones.map((stone) => [...coordinates(stone), stone.color]);
  return [-1, 1]
    .flatMap((sx) =>
      [-1, 1].flatMap((sy) =>
        [false, true].map((swap) =>
          points
            .map(([x, y, color]) => {
              const a = (x - 7) * sx;
              const b = (y - 7) * sy;
              return `${color}:${swap ? b : a},${swap ? a : b}`;
            })
            .sort()
            .join(';'),
        ),
      ),
    )
    .sort()[0];
}

/** Deterministic breadth-first extensions; no rotations/reflections counted
 * as extra openings. The fourth and fifth stones stay in the central 5x5. */
export function* candidates() {
  const classics = classicOpenings();
  const seen = new Set();
  const local = [];
  for (let x = 5; x <= 9; x += 1) for (let y = 5; y <= 9; y += 1) local.push([x, y]);
  const unique = function* (candidate) {
    const key = positionKey(candidate);
    if (!seen.has(key)) {
      seen.add(key);
      yield candidate;
    }
  };
  for (const classic of classics) yield* unique(classic);
  const fours = [];
  for (let offset = 0; offset < local.length; offset += 1) {
    for (const classic of classics) {
      const points = classic.stones.map(coordinates);
      const next = local[offset];
      if (points.some(([x, y]) => x === next[0] && y === next[1])) continue;
      const four = opening([...points, next], classic.classicId);
      fours.push(four);
      yield* unique(four);
    }
  }
  for (const next of local) {
    for (const four of fours) {
      const points = four.stones.map(coordinates);
      if (!points.some(([x, y]) => x === next[0] && y === next[1]))
        yield* unique(opening([...points, next], four.classicId));
    }
  }
}

/** Use the last completed PV's paired EVAL/WINRATE, AND the final summary
 * score (which may come from an interrupted iteration). Never synthesize a
 * winrate from a score. Missing/truncated telemetry fails closed. */
export function parseScreen(lines, requestedNodes) {
  let pv = {};
  let complete;
  for (const line of lines) {
    if (line === 'INFO PV 0') pv = {};
    const match = /^INFO (EVAL|WINRATE|DEPTH|TOTALNODES) (\S+)$/.exec(line);
    if (match) pv[match[1]] = Number(match[2]);
    if (line === 'INFO PV DONE') complete = { ...pv };
  }
  const summary = lines.findLast((line) => /^MESSAGE Speed /.test(line));
  const finalScore = Number(/\| Eval (-?\d+) \|/.exec(summary ?? '')?.[1]);
  const node = /\| Node ([\d.]+)([KM]?) \|/.exec(summary ?? '');
  const nodes = node ? Number(node[1]) * { '': 1, K: 1_000, M: 1_000_000 }[node[2]] : NaN;
  const forcedWin =
    lines.some((line) => /(?:INFO EVAL |\| Eval )[-+]?M\d*/.test(line)) ||
    Math.abs(finalScore) >= 29_000;
  if (
    !complete ||
    ![complete.EVAL, complete.WINRATE, complete.DEPTH, finalScore, nodes].every(Number.isFinite) ||
    complete.WINRATE < 0 ||
    complete.WINRATE > 1 ||
    nodes < requestedNodes ||
    forcedWin
  )
    return null;
  return {
    score: complete.EVAL,
    winrate: complete.WINRATE,
    finalScore,
    nodes,
    depth: complete.DEPTH,
    forcedWin: false,
  };
}

export function passesScreen(screen) {
  return (
    screen !== null &&
    !screen.forcedWin &&
    Math.abs(screen.score) <= SCREEN.maxAbsScore &&
    Math.abs(screen.finalScore) <= SCREEN.maxAbsScore &&
    screen.winrate >= SCREEN.minWinrate &&
    screen.winrate <= SCREEN.maxWinrate
  );
}

export async function loadEngine() {
  const dir = resolve(root, 'apps/web/public/engine/rapfi');
  const pin = JSON.parse(readFileSync(resolve(dir, 'net.json'), 'utf8'));
  const data = readFileSync(resolve(dir, pin.file));
  if (data.length !== pin.bytes || createHash('sha256').update(data).digest('hex') !== pin.sha256)
    throw new Error('Rapfi data does not match net.json');
  const context = vm.createContext({
    require: createRequire(import.meta.url),
    process,
    console,
    performance,
    TextEncoder,
    TextDecoder,
    setTimeout,
    clearTimeout,
    URL,
    __dirname: dir,
    __filename: resolve(dir, 'rapfi-single-simd128.js'),
  });
  vm.runInContext(readFileSync(resolve(dir, 'rapfi-single-simd128.js'), 'utf8'), context);
  let lines = [];
  const engine = await context.Rapfi({
    // Emscripten otherwise forwards this script's --audit/--count to Rapfi,
    // which can skip its config and silently run without the neural evaluator.
    arguments: [],
    locateFile: (file) => resolve(dir, file),
    onReceiveStdout: (line) => lines.push(line),
    onReceiveStderr: (line) => {
      throw new Error(line);
    },
  });
  if (!lines.includes('MESSAGE Evaluator set to mix9svq.'))
    throw new Error('Rapfi did not initialize its pinned neural evaluator');
  let started = false;
  return {
    pin,
    search(candidate, nodes) {
      lines = [];
      const board = [
        'BOARD',
        ...candidate.stones.map(
          (stone) => `${coordinates(stone).join(',')},${stone.color === candidate.turn ? 1 : 2}`,
        ),
        'DONE',
      ].join('\n');
      for (const command of [
        started ? 'RESTART' : 'START 15',
        'INFO rule 0',
        'INFO show_detail 3',
        'YXHASHCLEAR',
        `INFO max_node ${nodes}`,
        `INFO timeout_turn ${SCREEN.timeoutMs}`,
        board,
      ])
        engine.sendCommand(command);
      started = true;
      if (lines.some((line) => /^(ERROR|UNKNOWN)\b/.test(line))) throw new Error(lines.join('\n'));
      return { screen: parseScreen(lines, nodes), lines };
    },
  };
}

export function writePool(
  accepted,
  screened,
  deepScreened,
  pin,
  {
    output = resolve(root, 'packages/game/src/gomoku-openings.json'),
    note = resolve(root, 'docs-private/analysis/gomoku-opening-pool.md'),
    audit,
  },
) {
  const metadata = {
    engineCommit: pin.engineCommit,
    networksCommit: pin.networksCommit,
    dataSha256: pin.sha256,
    rule: 'freestyle',
    boardSize: 15,
    ...SCREEN,
    screened,
    deepScreened,
    accepted: accepted.length,
    scorePerspective: 'side-to-move',
    hashPolicy: 'YXHASHCLEAR before every search',
    prefilterMaxAbsScore: 170,
  };
  writeFileSync(
    output,
    `${JSON.stringify({ screening: metadata, openings: accepted }, null, 2)}\n`,
  );
  const range = (key) =>
    `${Math.min(...accepted.map((o) => o.screening[key]))} to ${Math.max(...accepted.map((o) => o.screening[key]))}`;
  mkdirSync(dirname(note), { recursive: true });
  writeFileSync(
    note,
    `# Gomoku opening pool (#769)\n\n` +
      `Rapfi ${metadata.engineCommit}, networks ${metadata.networksCommit}; data SHA-256 ${metadata.dataSha256}.\n\n` +
      `${screened} unique candidates examined, ${deepScreened} deeply screened, ${accepted.length} passed. ` +
      `Candidates start with all 26 classic three-stone openings (13 direct, 13 indirect), then legal four- and five-stone extensions within the central 5x5. D4-equivalent boards count once.\n\n` +
      `Fixed deep budget: ${SCREEN.nodes} nodes, single-thread SIMD128 WASM, freestyle 15x15, hash cleared before each search. ` +
      `A ${SCREEN.prefilterNodes}-node prefilter skips extensions with final absolute score above 170; every classic gets the deep search. ` +
      `The ${SCREEN.timeoutMs}ms safeguard is not the search budget: an under-budget result is rejected.\n\n` +
      `Acceptance: completed-PV score AND final summary score within ±${SCREEN.maxAbsScore}, engine-reported winrate ${SCREEN.minWinrate}–${SCREEN.maxWinrate}, no mate report. ` +
      `All values are from the side-to-move perspective. Score spread: ${range('score')}; final score spread: ${range('finalScore')}; winrate spread: ${range('winrate')}. ` +
      `Stone counts: ${JSON.stringify(Object.fromEntries([3, 4, 5].map((n) => [n, accepted.filter((o) => o.stones.length === n).length])))}.\n\n` +
      `No forced win was found within this finite search; this is screening evidence, not a solved draw. ` +
      `WINRATE comes directly from INFO WINRATE, paired with the last completed INFO PV; the separate final summary can be an interrupted iteration and must pass too. Missing, nonnumeric, mate or short-budget telemetry is rejected.\n\n` +
      `Reproduce: node scripts/screen-gomoku-openings.mjs --audit /tmp/gomoku-screen.jsonl. ` +
      `This run's full telemetry: ${audit}. New casual games and rematches draw randomly; opening: 'free' requests an empty board. Legacy logs without setup stay empty-board games.\n`,
  );
  return metadata;
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (name, fallback) => {
    const i = args.indexOf(name);
    return i < 0 ? fallback : args[i + 1];
  };
  const audit = arg('--audit');
  if (!audit) throw new Error('--audit /tmp/<run>.jsonl is required');
  const target = Number(arg('--count', '50'));
  if (!Number.isInteger(target) || target < 50) throw new Error('--count must be at least 50');
  const output = arg('--output', resolve(root, 'packages/game/src/gomoku-openings.json'));
  const note = arg('--note', resolve(root, 'docs-private/analysis/gomoku-opening-pool.md'));
  const engine = await loadEngine();
  const accepted = [];
  let screened = 0;
  let deepScreened = 0;
  for (const candidate of candidates()) {
    screened += 1;
    const fast = engine.search(candidate, SCREEN.prefilterNodes);
    let deep;
    if (candidate.stones.length === 3 || (fast.screen && Math.abs(fast.screen.finalScore) <= 170)) {
      deepScreened += 1;
      deep = engine.search(candidate, SCREEN.nodes);
    }
    const passed = deep && passesScreen(deep.screen);
    appendFileSync(
      audit,
      `${JSON.stringify({ candidate, fast, deep, passed: Boolean(passed) })}\n`,
    );
    if (passed)
      accepted.push({
        id: `gmk-${String(accepted.length + 1).padStart(3, '0')}`,
        ...candidate,
        screening: deep.screen,
      });
    if (screened % 25 === 0 || passed)
      console.log(`screened=${screened} deep=${deepScreened} passed=${accepted.length}`);
    if (accepted.length >= target) break;
  }
  if (accepted.length < target)
    throw new Error(`Only ${accepted.length}/${target} passed; pool was not written`);
  console.log(
    JSON.stringify(
      writePool(accepted, screened, deepScreened, engine.pin, { output, note, audit }),
    ),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
