#!/usr/bin/env node
// Offline, serial, single-thread WASM. No browser, server, network or ratings.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { tsImport } from 'tsx/esm/api';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { RAPFI_LEVELS, rapfiCommands } = await tsImport(
  '../apps/web/src/engine/rapfi.ts',
  import.meta.url,
);
const {
  GOMOKU_OPENINGS,
  createInitialGomokuState,
  applyGomokuMove,
  getGomokuLegalMoves,
  winsInOne,
  mustBlock,
} = await tsImport('../packages/game/src/variants-gomoku.ts', import.meta.url);
const sha256 = (data) => createHash('sha256').update(data).digest('hex');

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

export async function playGame({ opening, black, white }) {
  let state = createInitialGomokuState(opening);
  const moves = [];
  while (state.status.type === 'playing') {
    const color = state.status.turn;
    const move = await (color === 'black' ? black : white)(state);
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
    const game = await playGame({
      opening,
      black: strongerColor === 'black' ? stronger : weaker,
      white: strongerColor === 'white' ? stronger : weaker,
    });
    if (game.winner === null) result.draws += 1;
    else if (game.winner === strongerColor) result.strongerWins += 1;
    else result.weakerWins += 1;
    result.games.push({ opening, strongerColor, ...game });
    onGame(result, index + 1);
  }
  result.wallTimeMs = Math.round(performance.now() - started);
  result.strongerScore = (result.strongerWins + result.draws / 2) / games;
  return result;
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
      const telemetry = { searches: 0, wallTimeMs: 0, maxMoveMs: 0, ceilingHits: 0 };
      return {
        telemetry,
        async choose(state) {
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
          const { lines, elapsedMs: elapsed } = await request(
            { type: 'commands', commands: rapfiCommands(position, tier).lines },
            tier.timeMs + 250,
          );
          telemetry.searches += 1;
          telemetry.wallTimeMs += elapsed;
          telemetry.maxMoveMs = Math.max(telemetry.maxMoveMs, elapsed);
          if (elapsed >= tier.timeMs) telemetry.ceilingHits += 1;
          if (elapsed > tier.timeMs + 250)
            throw new Error(`Rapfi exceeded browser watchdog: ${elapsed}ms`);
          const failure = lines.find((line) => /^(ERROR|UNKNOWN)\b/.test(line));
          if (failure) throw new Error(failure);
          const reply = lines.findLast((line) => /^\d+,\d+$/.test(line));
          if (!reply) throw new Error(`Rapfi returned no move: ${lines.join('\n')}`);
          const [x, y] = reply.split(',').map(Number);
          if (x >= 15 || y >= 15) throw new Error(`Rapfi returned out-of-bounds move: ${reply}`);
          return { to: `${String.fromCharCode(97 + x)}${y + 1}` };
        },
      };
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
  if (!Number.isSafeInteger(seed) || seed < 0)
    throw new Error('--seed must be a nonnegative integer');
  const nodes = option('--budgets', RAPFI_LEVELS.map((tier) => tier.nodes).join(','))
    .split(',')
    .map(Number);
  if (
    nodes.length !== 5 ||
    nodes.some((n, i) => !Number.isSafeInteger(n) || n < 1 || (i > 0 && n <= nodes[i - 1]))
  )
    throw new Error('--budgets needs five increasing positive integers');
  const levels = RAPFI_LEVELS.map((tier, index) => ({ ...tier, nodes: nodes[index] }));
  const pairIds = option('--pairs', 'baseline,1-2,2-3,3-4,4-5').split(',');
  if (pairIds.some((id) => !['baseline', '1-2', '2-3', '3-4', '4-5'].includes(id)))
    throw new Error('Unknown pairing');
  const output = option('--output');
  if (!output) throw new Error('--output <record.json> is required (existing runs are appended)');
  const startedAt = new Date().toISOString();
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
    for (const id of pairIds) {
      const [low, high] = id === 'baseline' ? [0, 1] : id.split('-').map(Number);
      const baseline = seededRandom(seed ^ 0xb451);
      const weaker = low
        ? weakerEngine.player(levels[low - 1])
        : { choose: (state) => baselineMove(state, baseline) };
      const stronger = strongerEngine.player(levels[high - 1]);
      const result = await runPairing({
        id,
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
        weaker: low
          ? levels[low - 1]
          : { level: 'baseline', policy: 'random legal, win-in-one then block-in-one' },
        stronger: levels[high - 1],
        telemetry: { weaker: weaker.telemetry ?? null, stronger: stronger.telemetry },
      });
      // Checkpoint after each complete pairing; partial runs are never counted.
      const run = {
        label: option('--label', 'initial'),
        startedAt,
        wallTimeMs: Math.round(performance.now() - started),
        seed,
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
      const record = existsSync(output)
        ? JSON.parse(readFileSync(output, 'utf8'))
        : { schemaVersion: 1, levels: RAPFI_LEVELS, runs: [] };
      record.levels = RAPFI_LEVELS;
      const prior = record.runs.findIndex((entry) => entry.startedAt === startedAt);
      if (prior >= 0) record.runs[prior] = run;
      else record.runs.push(run);
      mkdirSync(dirname(resolve(output)), { recursive: true });
      const temporary = `${output}.tmp-${process.pid}`;
      writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`);
      renameSync(temporary, output);
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
