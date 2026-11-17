/** Serial, resumable classical Jungle pilot. The platform kernel is the referee.
 * Usage: node --import tsx scripts/jungle-classical-ladder.ts --binary /path/to/jungle-engine
 *   --out /private/tmp/jungle-ladder/run.jsonl --pairs 30 --matchups 1-2,2-3
 * Summary only: --summary /path/to/run.jsonl
 * No public bot roster, ratings, data or production rooms are changed.
 */
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  applyJungleMove,
  createInitialJungleState,
  engineUciToJungleMove,
  getJungleLegalMoves,
  type JungleColor,
  type JungleGameState,
  jungleMoveToEngineUci,
  jungleRepSeedFens,
  jungleStateToEngineFen,
} from '@mistboard/game';
import { buildJunglePositionCommand } from '../apps/server/src/jungle-engine.js';
import { UciEngineSession } from '../apps/server/src/uci-engine-harness.js';
import {
  buildJungleClassicalGoCommand,
  JUNGLE_CLASSICAL_POLICIES,
  jungleClassicalSeed,
} from '../packages/game/src/jungle-classical-levels.js';

export function randomGenerator(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let x = Math.imul(value ^ (value >>> 15), 1 | value);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export function pairedOpening(pair: number, seed: number): string[] {
  const rng = randomGenerator(jungleClassicalSeed(String(seed), pair, 0));
  let state = createInitialJungleState('opening');
  const moves: string[] = [];
  for (let i = 0; i < 8 + (pair % 3) * 2; i++) {
    const legal = getJungleLegalMoves(state);
    const move = legal[Math.floor(rng() * legal.length)]!;
    state = applyJungleMove(state, move);
    if (state.status.type !== 'playing') throw new Error('terminal calibration opening');
    moves.push(jungleMoveToEngineUci(move));
  }
  return moves;
}

type Decision = {
  level: number;
  seed: number;
  move: string;
  nodes: number | null;
  depth: number | null;
  timeMs: number | null;
};
export type CalibrationGame = {
  key: string;
  low: number;
  high: number;
  pair: number;
  highSeat: JungleColor;
  opening: string[];
  moves: string[];
  decisions: Decision[];
  winner: JungleColor | null;
  reason: string;
  censored: boolean;
};

export function summarize(games: readonly CalibrationGame[]) {
  const groups = new Map<string, CalibrationGame[]>();
  for (const game of games) {
    const key = `${game.low}-${game.high}`;
    groups.set(key, [...(groups.get(key) ?? []), game]);
  }
  return [...groups].map(([matchup, records]) => {
    const pairs = new Map<number, CalibrationGame[]>();
    for (const game of records) pairs.set(game.pair, [...(pairs.get(game.pair) ?? []), game]);
    const complete = [...pairs.values()].filter(
      (p) => p.length === 2 && p[0]!.highSeat !== p[1]!.highSeat && p.every((g) => !g.censored),
    );
    const scores = complete.map(
      (p) =>
        p.reduce((sum, g) => sum + (g.winner === null ? 0.5 : g.winner === g.highSeat ? 1 : 0), 0) /
        2,
    );
    const mean = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
    const rng = randomGenerator(917);
    const bootstrap = scores.length
      ? Array.from(
          { length: 4000 },
          () =>
            scores.reduce((sum) => sum + scores[Math.floor(rng() * scores.length)]!, 0) /
            scores.length,
        ).sort((a, b) => a - b)
      : [];
    return {
      matchup,
      games: records.length,
      completePairs: scores.length,
      distinctOpenings: new Set(complete.map((p) => p[0]!.opening.join(' '))).size,
      highWins: records.filter((g) => g.winner === g.highSeat).length,
      lowWins: records.filter((g) => g.winner !== null && g.winner !== g.highSeat).length,
      draws: records.filter((g) => !g.censored && g.winner === null).length,
      censored: records.filter((g) => g.censored).length,
      highScore: mean,
      pairedBootstrap95: bootstrap.length ? [bootstrap[100], bootstrap[3899]] : null,
      // This is only a pilot screen. Confirmation uses fresh seeds after any tuning.
      separated:
        scores.length >= 30 &&
        bootstrap[100]! > 0.5 &&
        new Set(complete.map((p) => p[0]!.opening.join(' '))).size === scores.length,
    };
  });
}

export async function main(argv: string[]): Promise<void> {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]!;
    if (
      ![
        '--binary',
        '--out',
        '--pairs',
        '--matchups',
        '--seed',
        '--max-plies',
        '--summary',
        '--shard',
      ].includes(key) ||
      !argv[i + 1]
    ) {
      throw new Error(`invalid argument ${key}`);
    }
    args.set(key, argv[i + 1]!);
  }
  const readGames = (file: string): CalibrationGame[] =>
    existsSync(file)
      ? readFileSync(file, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line))
      : [];
  if (args.has('--summary')) {
    console.log(JSON.stringify(summarize(readGames(resolve(args.get('--summary')!))), null, 2));
    return;
  }
  if (!args.has('--binary') || !args.has('--out')) throw new Error('--binary and --out required');
  const binary = resolve(args.get('--binary')!);
  const out = resolve(args.get('--out')!);
  const pairs = Number(args.get('--pairs') ?? 30);
  const seed = Number(args.get('--seed') ?? 20261116);
  const maxPlies = Number(args.get('--max-plies') ?? 600);
  const shard = args.get('--shard') ?? '0/1';
  if (!/^\d+\/\d+$/.test(shard)) throw new Error('invalid shard');
  const [shardIndex, shardCount] = shard.split('/').map(Number) as [number, number];
  if (shardCount < 1 || shardIndex >= shardCount) throw new Error('invalid shard');
  if (![pairs, seed, maxPlies].every((v) => Number.isSafeInteger(v) && v > 0))
    throw new Error('invalid numeric option');
  const matchups = (args.get('--matchups') ?? '1-2,2-3,3-4,4-5,5-6,6-7').split(',').map((p) => {
    if (!/^[1-7]-[1-7]$/.test(p)) throw new Error(`invalid matchup ${p}`);
    const [low, high] = p.split('-').map(Number) as [number, number];
    if (low >= high) throw new Error(`unordered matchup ${p}`);
    return [low, high] as const;
  });
  const manifest = {
    schema: 1,
    binarySha256: createHash('sha256').update(readFileSync(binary)).digest('hex'),
    harnessSha256: createHash('sha256')
      .update(readFileSync(new URL(import.meta.url)))
      .digest('hex'),
    kernelSha256: createHash('sha256')
      .update(readFileSync(new URL('../packages/game/src/variants-jungle.ts', import.meta.url)))
      .update(readFileSync(new URL('../packages/game/src/jungle-fen.ts', import.meta.url)))
      .digest('hex'),
    policies: JUNGLE_CLASSICAL_POLICIES,
    matchups,
    pairs,
    seed,
    maxPlies,
    shard,
    referee: 'packages/game Jungle, progress 200, threefold repetition',
    limits: 'node bound, movetime 0; latency recorded separately',
  };
  mkdirSync(dirname(out), { recursive: true });
  const manifestPath = `${out}.manifest.json`;
  if (existsSync(manifestPath)) {
    if (
      JSON.stringify(JSON.parse(readFileSync(manifestPath, 'utf8'))) !== JSON.stringify(manifest)
    ) {
      throw new Error('manifest differs; use a fresh output path');
    }
  } else {
    if (existsSync(out) && readFileSync(out, 'utf8').length)
      throw new Error('records without manifest');
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  }
  const games = readGames(out);
  const done = new Set(games.map((g) => g.key));
  if (done.size !== games.length) throw new Error('duplicate game records');
  const engine = new UciEngineSession({
    bin: binary,
    initCommands: ['uci', 'ucinewgame', 'isready'],
    name: 'Jungle calibration',
  });
  try {
    await engine.ready();
    for (const [low, high] of matchups) {
      for (let pair = shardIndex; pair < pairs; pair += shardCount) {
        const opening = pairedOpening(pair, seed);
        for (const highSeat of ['red', 'black'] as const) {
          const key = `${low}-${high}:${pair}:${highSeat}`;
          if (done.has(key)) continue;
          let state = createInitialJungleState(`jungle-pair-${seed}-${pair}`);
          const history: JungleGameState[] = [state];
          const moves: string[] = [];
          const decisions: Decision[] = [];
          for (const uci of opening) {
            state = applyJungleMove(state, engineUciToJungleMove(uci)!);
            moves.push(uci);
            history.push(state);
          }
          while (state.status.type === 'playing' && moves.length < maxPlies) {
            const level = state.status.turn === highSeat ? high : low;
            const policy = JUNGLE_CLASSICAL_POLICIES[level - 1]!;
            const moveSeed = jungleClassicalSeed(state.id, moves.length, level);
            const result = await engine.evalPosition({
              positionCommand: buildJunglePositionCommand(
                jungleStateToEngineFen(state),
                jungleRepSeedFens(history),
              ),
              goCommand: buildJungleClassicalGoCommand(policy, moveSeed, 0),
              timeoutMs: 30_000,
              timeoutMessage: `Jungle calibration ${key}`,
            });
            const move = engineUciToJungleMove(result.best);
            if (
              !move ||
              !getJungleLegalMoves(state).some((m) => m.from === move.from && m.to === move.to)
            ) {
              throw new Error(`illegal engine proposal ${key} ply ${moves.length}: ${result.best}`);
            }
            decisions.push({
              level,
              seed: moveSeed,
              move: result.best!,
              nodes: result.nodes ?? null,
              depth: result.depth,
              timeMs: result.timeMs ?? null,
            });
            state = applyJungleMove(state, move);
            moves.push(result.best!);
            history.push(state);
          }
          const finished = state.status.type === 'finished' ? state.status : null;
          const game: CalibrationGame = {
            key,
            low,
            high,
            pair,
            highSeat,
            opening,
            moves,
            decisions,
            winner: finished?.winner ?? null,
            reason: finished?.reason ?? 'ply-cap',
            censored: finished === null,
          };
          appendFileSync(out, `${JSON.stringify(game)}\n`);
          games.push(game);
          done.add(key);
          console.log(
            JSON.stringify({ key, winner: game.winner, reason: game.reason, plies: moves.length }),
          );
        }
      }
      console.log(JSON.stringify(summarize(games)));
    }
  } finally {
    engine.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
