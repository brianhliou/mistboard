#!/usr/bin/env node
// Offline, serial, single-thread WASM. No browser, server, network or ratings.
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { tsImport } from 'tsx/esm/api';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const {
  RAPFI_LEVELS,
  rapfiCommands,
  parseRapfiOutput,
  selectRapfiMove,
  rapfiGameSeed,
  rapfiPlySeed,
} = await tsImport('../apps/web/src/engine/rapfi.ts', import.meta.url);
const {
  GOMOKU_OPENINGS,
  createInitialGomokuState,
  applyGomokuMove,
  getGomokuLegalMoves,
  winsInOne,
  mustBlock,
} = await tsImport('../packages/game/src/variants-gomoku.ts', import.meta.url);
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const BASELINE = Object.freeze({
  level: 'baseline',
  policy: 'random legal, win-in-one then block-in-one',
});

/** Baseline at every level, plus two-level gaps. Explicit adjacent pairs and
 * the old baseline alias remain available for historical comparisons. */
export function pairingPlan(levels = RAPFI_LEVELS, pairs) {
  const ids =
    pairs === undefined
      ? [
          ...levels.map(({ level }) => `baseline-${level}`),
          ...levels.slice(2).map(({ level }) => `${level - 2}-${level}`),
        ]
      : pairs.split(',');
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate pairing');
  return ids.map((id) => {
    const match = /^(baseline|\d+)-(\d+)$/.exec(id === 'baseline' ? 'baseline-1' : id);
    const weaker =
      match?.[1] === 'baseline'
        ? BASELINE
        : levels.find(({ level }) => level === Number(match?.[1]));
    const stronger = levels.find(({ level }) => level === Number(match?.[2]));
    if (!match || !weaker || !stronger || (weaker !== BASELINE && weaker.level >= stronger.level))
      throw new Error(`Unknown pairing: ${id}`);
    return { id, weaker, stronger };
  });
}

/** Replace only this run's checkpoint. Older runs, including the budget-only
 * schema-v1 records without runId/game seeds, retain their original contents. */
export function writeRun(output, run, levels = RAPFI_LEVELS) {
  if (typeof run.runId !== 'string' || !run.runId.length) throw new Error('Missing run id');
  const record = existsSync(output)
    ? JSON.parse(readFileSync(output, 'utf8'))
    : { schemaVersion: 1, levels, runs: [] };
  record.levels = levels;
  const prior = record.runs.findIndex((entry) => entry.runId === run.runId);
  if (prior >= 0) record.runs[prior] = run;
  else record.runs.push(run);
  mkdirSync(dirname(resolve(output)), { recursive: true });
  const temporary = `${output}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`);
  renameSync(temporary, output);
}

export function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let n = Math.imul(value ^ (value >>> 15), value | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random legal play, with only immediate five completion/blocking. */
export function baselineMove(state, random) {
  const choices = winsInOne(state).length ? winsInOne(state) : mustBlock(state);
  const moves = choices.length ? choices : getGomokuLegalMoves(state);
  return moves[Math.floor(random() * moves.length)];
}

export async function playGame({ opening, black, white, seed = 0 }) {
  let state = createInitialGomokuState(opening);
  const moves = [];
  while (state.status.type === 'playing') {
    const color = state.status.turn;
    const move = await (color === 'black' ? black : white)(state, {
      gameSeed: seed,
      plySeed: rapfiPlySeed(seed, state.ply),
    });
    const next = move && typeof move.to === 'string' ? applyGomokuMove(state, move) : state;
    if (next === state)
      throw new Error(
        `Illegal engine reply for ${color} at ply ${state.ply}: ${JSON.stringify(move)}`,
      );
    moves.push(move.to);
    state = next;
  }
  return { ...state.status, moves, finalPly: state.ply };
}

export async function runPairing({
  id,
  seed = 0,
  games,
  openings,
  weaker,
  stronger,
  beforeGame = () => {},
  onGame = () => {},
}) {
  if (!Number.isInteger(games) || games < 2 || games % 2)
    throw new Error('games must be a positive even count');
  if (openings.length < games / 2) throw new Error('Not enough paired openings');
  const result = { id, weakerWins: 0, strongerWins: 0, draws: 0, games: [] };
  const started = performance.now();
  for (let index = 0; index < games; index += 1) {
    await beforeGame();
    const opening = openings[Math.floor(index / 2)];
    const strongerColor = index % 2 ? 'black' : 'white';
    const gameSeed = rapfiGameSeed(`${id}:${index}`, seed);
    const game = await playGame({
      opening,
      seed: gameSeed,
      black: strongerColor === 'black' ? stronger : weaker,
      white: strongerColor === 'white' ? stronger : weaker,
    });
    if (game.winner === null) result.draws += 1;
    else if (game.winner === strongerColor) result.strongerWins += 1;
    else result.weakerWins += 1;
    result.games.push({ opening, strongerColor, seed: gameSeed, ...game });
    onGame(result, index + 1);
  }
  result.wallTimeMs = Math.round(performance.now() - started);
  result.strongerScore = (result.strongerWins + result.draws / 2) / games;
  return result;
}

/** Transport seam exercises exactly the browser command/parser/choice policy
 * with stub transcripts in tests and the pinned WASM in measurements. */
export function createRapfiPlayer(tier, request) {
  if (tier.evalMargin !== undefined && tier.candidateCount === undefined)
    throw new Error('Rapfi eval margin requires a candidate count');
  const evalMargin = tier.evalMargin ?? 0;
  if (!Number.isFinite(evalMargin) || evalMargin < 0) throw new Error('Invalid Rapfi eval margin');
  const telemetry = { searches: 0, wallTimeMs: 0, maxMoveMs: 0, ceilingHits: 0 };
  return {
    telemetry,
    async choose(state, { plySeed }) {
      const position = {
        turn: state.status.turn === 'black' ? 1 : 2,
        stones: state.board.flatMap((color, index) =>
          color
            ? [
                {
                  x: index % 15,
                  y: Math.floor(index / 15),
                  player: color === 'black' ? 1 : 2,
                },
              ]
            : [],
        ),
      };
      // Empty-board Rapfi returns centre without structured candidates. Match
      // the live adapter's plain BEGIN for this forced opening reply.
      const candidateCount = position.stones.length ? tier.candidateCount : undefined;
      const { lines, elapsedMs: elapsed } = await request(
        { type: 'commands', commands: rapfiCommands(position, { ...tier, candidateCount }).lines },
        tier.timeMs + 250,
      );
      if (typeof elapsed !== 'number' || !Number.isFinite(elapsed) || elapsed < 0)
        throw new Error('Invalid Rapfi elapsed time');
      if (elapsed > tier.timeMs + 250)
        throw new Error(`Rapfi exceeded browser watchdog: ${elapsed}ms`);
      const failure = lines.find((line) => /^(ERROR|UNKNOWN)\b/.test(line));
      if (failure) throw new Error(failure);
      const reply = lines.findLast((line) => /^\d+,\d+$/.test(line));
      const [x, y] = reply ? reply.split(',').map(Number) : [NaN, NaN];
      if (
        !Number.isInteger(x) ||
        !Number.isInteger(y) ||
        x >= 15 ||
        y >= 15 ||
        state.board[y * 15 + x] !== null
      )
        throw new Error(`Rapfi returned an invalid move: ${reply}`);
      const move =
        candidateCount === undefined
          ? { x, y }
          : selectRapfiMove(position, parseRapfiOutput(lines), {
              candidateCount,
              evalMargin,
              seed: plySeed,
            });
      telemetry.searches += 1;
      telemetry.wallTimeMs += elapsed;
      telemetry.maxMoveMs = Math.max(telemetry.maxMoveMs, elapsed);
      if (elapsed >= tier.timeMs) telemetry.ceilingHits += 1;
      return { to: `${String.fromCharCode(97 + move.x)}${move.y + 1}` };
    },
  };
}

export async function loadRapfi() {
  const dir = resolve(root, 'apps/web/public/engine/rapfi');
  const pin = JSON.parse(readFileSync(resolve(dir, 'net.json'), 'utf8'));
  const data = readFileSync(resolve(dir, pin.file));
  if (data.length !== pin.bytes || sha256(data) !== pin.sha256)
    throw new Error('Rapfi data does not match net.json');
  const js = readFileSync(resolve(dir, 'rapfi-single-simd128.js'));
  const thread = new Worker(new URL('./rapfi-node-worker.mjs', import.meta.url), {
    workerData: dir,
  });
  let lines = [];
  let pending;
  let timer;
  const fail = (error) => {
    clearTimeout(timer);
    pending?.reject(error);
    pending = undefined;
    void thread.terminate();
  };
  thread.on('error', fail);
  thread.on('exit', (code) => {
    if (pending) fail(new Error(`Rapfi thread exited (${code})`));
  });
  thread.on('message', (message) => {
    if (message.type === 'line') lines.push(message.line);
    else if (message.type === 'error') fail(new Error(message.error));
    else if (message.type === 'ready' || message.type === 'done') {
      clearTimeout(timer);
      const active = pending;
      pending = undefined;
      active?.resolve({ lines, elapsedMs: message.elapsedMs });
    }
  });
  const request = (message, timeoutMs) =>
    new Promise((resolve, reject) => {
      if (pending) return reject(new Error('Rapfi already has an outstanding request'));
      lines = [];
      pending = { resolve, reject };
      timer = setTimeout(
        () => fail(new Error(`Rapfi worker timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
      thread.postMessage(message);
    });
  const initialized = await request({ type: 'init' }, 30_000);
  if (!initialized.lines.includes('MESSAGE Evaluator set to mix9svq.')) {
    await thread.terminate();
    throw new Error('Pinned neural evaluator did not initialize');
  }
  return {
    // Offline acceptance fixtures record the scored protocol from this same
    // serial transport, rather than inventing evaluations for generated moves.
    request,
    pin: {
      ...pin,
      loaderSha256: sha256(js),
      wasmSha256: sha256(readFileSync(resolve(dir, 'rapfi-single-simd128.wasm'))),
    },
    reset() {
      // Browser games start a new worker. Clear prior-game search state here;
      // each colour owns a separate WASM module, just as two browsers would.
      return request({ type: 'commands', commands: ['YXHASHCLEAR'] }, 1_000);
    },
    stop: () => thread.terminate(),
    player(tier) {
      return createRapfiPlayer(tier, request);
    },
  };
}

async function main() {
  const args = process.argv.slice(2);
  const allowed = new Set(['--games', '--seed', '--pairs', '--budgets', '--output', '--label']);
  for (let index = 0; index < args.length; index += 2) {
    if (!allowed.has(args[index]) || !args[index + 1])
      throw new Error(`Unknown or missing argument: ${args[index]}`);
  }
  const option = (name, fallback) =>
    args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
  const games = Number(option('--games', '20'));
  const seed = Number(option('--seed', '20261101'));
  if (!Number.isInteger(games) || games < 2 || games % 2 || games / 2 > GOMOKU_OPENINGS.length)
    throw new Error('--games must be even, between 2 and twice the pool size');
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
    throw new Error('--seed must be an unsigned 32-bit integer');
  const nodes = option('--budgets', RAPFI_LEVELS.map((tier) => tier.nodes).join(','))
    .split(',')
    .map(Number);
  if (
    nodes.length !== RAPFI_LEVELS.length ||
    nodes.some((n, i) => !Number.isSafeInteger(n) || n < 1 || (i > 0 && n <= nodes[i - 1]))
  )
    throw new Error(`--budgets needs ${RAPFI_LEVELS.length} increasing positive integers`);
  const levels = RAPFI_LEVELS.map((tier, index) => ({ ...tier, nodes: nodes[index] }));
  const plan = pairingPlan(levels, option('--pairs'));
  const output = option('--output');
  if (!output) throw new Error('--output <record.json> is required (existing runs are appended)');
  const startedAt = new Date().toISOString();
  const runId = randomUUID();
  const started = performance.now();
  const random = seededRandom(seed);
  // Same uniform screened pool as the live tenant, sampled without replacement.
  const pool = [...GOMOKU_OPENINGS];
  const openings = Array.from(
    { length: games / 2 },
    () => pool.splice(Math.floor(random() * pool.length), 1)[0],
  );
  const weakerEngine = await loadRapfi();
  let strongerEngine;
  try {
    strongerEngine = await loadRapfi();
    const pairings = [];
    for (const pair of plan) {
      const { id } = pair;
      const weaker =
        pair.weaker.level !== 'baseline'
          ? weakerEngine.player(pair.weaker)
          : { choose: (state, { plySeed }) => baselineMove(state, seededRandom(plySeed)) };
      const stronger = strongerEngine.player(pair.stronger);
      const result = await runPairing({
        id,
        seed,
        games,
        openings,
        weaker: weaker.choose,
        stronger: stronger.choose,
        beforeGame: async () => {
          await weakerEngine.reset();
          await strongerEngine.reset();
        },
        onGame: (tally, count) =>
          console.log(
            `${id} ${count}/${games}: stronger ${tally.strongerWins}, weaker ${tally.weakerWins}, draws ${tally.draws}`,
          ),
      });
      pairings.push({
        ...result,
        weaker: pair.weaker,
        stronger: pair.stronger,
        telemetry: { weaker: weaker.telemetry ?? null, stronger: stronger.telemetry },
      });
      // Checkpoint after each complete pairing; partial runs are never counted.
      const run = {
        runId,
        label: option('--label', 'initial'),
        startedAt,
        wallTimeMs: Math.round(performance.now() - started),
        seed,
        seedPolicy:
          'FNV-1a UTF-16: game:<runSeed>:<pairingId>:<zero-based game index>; ply:<gameSeed>:<absolute kernel ply>; one Mulberry32 sample per move',
        gamesPerPair: games,
        levels,
        engine: strongerEngine.pin,
        hashPolicy:
          'separate WASM heaps per side; YXHASHCLEAR before each game; browser START 15 before each move',
        openingsSha256: sha256(
          readFileSync(resolve(root, 'packages/game/src/gomoku-openings.json')),
        ),
        pairings,
      };
      writeRun(output, run);
    }
  } finally {
    await weakerEngine.stop();
    await strongerEngine?.stop();
  }
  console.log(
    `Completed in ${((performance.now() - started) / 1000).toFixed(1)}s; record: ${output}`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
