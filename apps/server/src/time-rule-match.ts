/**
 * Clocked self-play for the live bot time rules (MISTBOARD_BOT_TIME_RULE): the
 * same top xiangqi bot with one rule against itself with another, on a real
 * Fischer clock, so a rule that spends badly loses games and a rule that
 * overspends flags. Not part of the server; a CLI the Modal runner
 * (`scripts/bot-time-match-modal.py`) bundles with esbuild.
 *
 * Each side is its own Pikafish process (same binary, net, Threads and Hash, a
 * `ucinewgame` per game), so neither shares the other's hash. A move is charged
 * its measured wall time plus `overheadMs` (prod's server and network share of a
 * bot turn); the clock is debited, checked for a flag, then given its increment.
 * Openings are a seeded random first two plies, played twice with colours
 * swapped (a pair), and a pair's score feeds the pentanomial SPRT below.
 *
 *   tsx src/time-rule-match.ts --a phase --b flat --seed 7 --pairs 1 \
 *     --bin <pikafish> --net <pikafish.nnue> [--tc 60000+1000] [--overhead-ms 150]
 *
 * Prints one JSON line per pair.
 */

import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

import { type BotTimeRule, liveBotMoveTime, uciClockWords } from './engine-time-budget.js';
import { playVariantEngineGame } from './variant-eve.js';
import { xiangqiEngineTierFor } from './xiangqi-engine-catalog.js';
import { xiangqiEveAdapter } from './xiangqi-eve-adapter.js';

export const MATCH_ENGINE_ID = 'pikafish-xiangqi-level-8';

// ---------------------------------------------------------------------------
// SPRT: pentanomial GSPRT on pair scores (fishtest's normal approximation).

export type SprtBounds = { elo0: number; elo1: number; alpha: number; beta: number };

const expectedScore = (elo: number) => 1 / (1 + 10 ** (-elo / 400));

/**
 * Log-likelihood ratio of elo1 over elo0 from per-pair scores (each 0, 0.25,
 * 0.5, 0.75 or 1, from arm A's side). Zero until the pairs have any spread.
 */
export function pentanomialLlr(pairScores: readonly number[], elo0: number, elo1: number): number {
  const n = pairScores.length;
  if (n < 2) return 0;
  const mean = pairScores.reduce((a, b) => a + b, 0) / n;
  const variance = pairScores.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  if (variance <= 0) return 0;
  const s0 = expectedScore(elo0);
  const s1 = expectedScore(elo1);
  return ((s1 - s0) * (2 * mean - s0 - s1) * n) / (2 * variance);
}

export function sprtBoundsLlr(b: SprtBounds): { lower: number; upper: number } {
  return { lower: Math.log(b.beta / (1 - b.alpha)), upper: Math.log((1 - b.beta) / b.alpha) };
}

/** Logistic elo and a 95% interval from pair scores. */
export function pairElo(pairScores: readonly number[]): { elo: number; lo: number; hi: number } {
  const n = pairScores.length;
  const mean = n === 0 ? 0.5 : pairScores.reduce((a, b) => a + b, 0) / n;
  const sd = n < 2 ? 0 : Math.sqrt(pairScores.reduce((a, b) => a + (b - mean) ** 2, 0) / n / n);
  const toElo = (s: number) => {
    const c = Math.min(0.999, Math.max(0.001, s));
    return -400 * Math.log10(1 / c - 1);
  };
  return { elo: toElo(mean), lo: toElo(mean - 1.96 * sd), hi: toElo(mean + 1.96 * sd) };
}

// ---------------------------------------------------------------------------
// One UCI engine process per side.

class UciProcess {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly waiters: Array<(line: string) => boolean> = [];

  constructor(bin: string) {
    this.child = spawn(bin, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    const rl = createInterface({ input: this.child.stdout });
    rl.on('line', (line) => {
      const i = this.waiters.findIndex((w) => w(line));
      if (i >= 0) this.waiters.splice(i, 1);
    });
  }

  send(cmd: string): void {
    this.child.stdin.write(`${cmd}\n`);
  }

  /** Resolves with the first line matching `test`, and every `info` line before it. */
  until(test: (line: string) => boolean, timeoutMs: number, infos?: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`uci timeout after ${timeoutMs} ms`)),
        timeoutMs,
      );
      this.waiters.push((line) => {
        if (infos && line.startsWith('info ')) infos.push(line);
        if (!test(line)) return false;
        clearTimeout(timer);
        resolve(line);
        return true;
      });
    });
  }

  async init(net: string, threads = 1, hashMb = 16): Promise<void> {
    this.send('uci');
    await this.until((l) => l === 'uciok', 30_000);
    this.send(`setoption name Threads value ${threads}`);
    this.send(`setoption name Hash value ${hashMb}`);
    this.send(`setoption name EvalFile value ${net}`);
    await this.ready();
  }

  async ready(): Promise<void> {
    this.send('isready');
    await this.until((l) => l === 'readyok', 30_000);
  }

  quit(): void {
    this.send('quit');
    setTimeout(() => this.child.kill('SIGKILL'), 1_000).unref();
  }
}

// ---------------------------------------------------------------------------
// One clocked game.

export type MoveRecord = {
  ply: number;
  arm: 'A' | 'B';
  rule: BotTimeRule;
  clockBeforeMs: number;
  /** The `go` limit sent: a movetime, or the told clock under native. */
  go: string;
  spentMs: number;
  nodes: number | null;
  /** The node budget stopped the search before the time limit did. */
  nodesBound: boolean;
  /** The engine's last reported score, red's point of view (mate = +-100000). */
  score?: number | null;
};

export type ClockedGame = {
  redArm: 'A' | 'B';
  result: 'A' | 'B' | 'draw' | 'aborted';
  termination: string;
  plies: number;
  wallMs: number;
  moves: MoveRecord[];
};

class Flag extends Error {
  constructor(readonly color: string) {
    super(`${color} flagged`);
  }
}

/** A game stopped early by score adjudication (cutechess-style resign/draw rules). */
class Adjudicated extends Error {
  constructor(
    readonly winner: 'red' | 'black' | 'draw',
    readonly termination: string,
  ) {
    super(termination);
  }
}

export type Adjudication = {
  /** Win: both sides' last `resignPlies` scores at least `resignCp` for the same colour. */
  resignPlies: number;
  resignCp: number;
  /** Draw: from ply `drawFromPly`, the last `drawPlies` scores all within `drawCp` of 0. */
  drawFromPly: number;
  drawPlies: number;
  drawCp: number;
};

/**
 * Resign as fishtest (3 moves a side at 600 cp, two-sided). Draw much later than
 * fishtest's move 34 / 20 cp: in a local smoke 3 of 4 xiangqi games were cut at
 * exactly move 34, and near-zero stretches there are still won by the stronger side,
 * which would bias a strength test toward zero. Draw from move 60, 10 moves a side
 * within 10 cp.
 */
export const MATCH_ADJUDICATION: Adjudication = {
  resignPlies: 6,
  resignCp: 600,
  drawFromPly: 120,
  drawPlies: 20,
  drawCp: 10,
};

const MATE_CP = 100_000;

/** The last reported score in red's point of view, or null. */
export function redScore(infos: readonly string[], color: string): number | null {
  for (let i = infos.length - 1; i >= 0; i--) {
    const m = / score (cp|mate) (-?\d+)/.exec(infos[i]!);
    if (!m) continue;
    const v = Number(m[2]);
    const mover = m[1] === 'mate' ? (v > 0 ? MATE_CP : -MATE_CP) : v;
    return color === 'red' ? mover : -mover;
  }
  return null;
}

export function adjudicate(
  scores: readonly (number | null)[],
  ply: number,
  rule: Adjudication,
): 'red' | 'black' | 'draw' | null {
  const tail = (n: number) => (scores.length >= n ? scores.slice(-n) : null);
  const r = tail(rule.resignPlies);
  if (r && r.every((v) => v !== null && v >= rule.resignCp)) return 'red';
  if (r && r.every((v) => v !== null && v <= -rule.resignCp)) return 'black';
  const d = tail(rule.drawPlies);
  if (ply >= rule.drawFromPly && d && d.every((v) => v !== null && Math.abs(v) <= rule.drawCp))
    return 'draw';
  return null;
}

export async function playClockedGame(input: {
  rules: { A: BotTimeRule; B: BotTimeRule };
  engines: { A: UciProcess; B: UciProcess };
  redArm: 'A' | 'B';
  seed: string;
  tc: { initialMs: number; incrementMs: number };
  overheadMs: number;
  openingPlies: number;
  /** Per-arm node cap; 0 sends no `nodes` limit. Defaults to the tier's anchor. */
  nodes?: { A: number; B: number };
  adjudication?: Adjudication | null;
}): Promise<ClockedGame> {
  const tier = xiangqiEngineTierFor(MATCH_ENGINE_ID);
  if (!tier || !('nodes' in tier)) throw new Error(`${MATCH_ENGINE_ID} has no node budget`);
  const tierNodes = (tier as { nodes: number }).nodes;
  const nodesFor = (arm: 'A' | 'B') => input.nodes?.[arm] ?? tierNodes;
  const scores: (number | null)[] = [];
  const armOf = (color: string): 'A' | 'B' =>
    color === 'red' ? input.redArm : input.redArm === 'A' ? 'B' : 'A';
  const clocks: Record<string, number> = { red: input.tc.initialMs, black: input.tc.initialMs };
  const moves: MoveRecord[] = [];
  const started = Date.now();
  for (const e of [input.engines.A, input.engines.B]) {
    e.send('ucinewgame');
    await e.ready();
  }
  const roomId = `time-match-${input.seed}-${input.redArm}`;
  try {
    const game = await playVariantEngineGame(xiangqiEveAdapter, {
      firstEngineId: MATCH_ENGINE_ID,
      secondEngineId: MATCH_ENGINE_ID,
      maxPlies: 400,
      roomId,
      openingPolicy: { kind: 'random_first_n_plies', n: input.openingPlies, seed: input.seed },
      moveProvider: async ({ history, legalMoves, color }) => {
        const arm = armOf(color);
        const engine = input.engines[arm];
        const rule = input.rules[arm];
        const clockBeforeMs = clocks[color]!;
        const time = liveBotMoveTime({
          rule,
          engineId: MATCH_ENGINE_ID,
          roomId,
          ply: history.length,
          legalCount: legalMoves.length,
          initialMs: input.tc.initialMs,
          remainingMs: clockBeforeMs,
          incrementMs: input.tc.incrementMs,
          ceilingMs: tier.movetimeMs,
          flatReserveMs: 1_000,
          floorMs: 50,
          engineVsEngine: true,
        });
        const limit = time.clock ? uciClockWords(time.clock) : `movetime ${time.movetimeMs}`;
        const position =
          history.length > 0 ? `position startpos moves ${history.join(' ')}` : 'position startpos';
        const infos: string[] = [];
        const t0 = Date.now();
        engine.send(position);
        const nodes = nodesFor(arm);
        engine.send(nodes > 0 ? `go nodes ${nodes} ${limit}` : `go ${limit}`);
        const best = await engine.until(
          (l) => l.startsWith('bestmove'),
          time.movetimeMs + 4_000,
          infos,
        );
        const spentMs = Date.now() - t0 + input.overheadMs;
        const lastNodes = [...infos].reverse().find((l) => / nodes \d+/.test(l));
        const searched = lastNodes ? Number(/ nodes (\d+)/.exec(lastNodes)![1]) : null;
        moves.push({
          ply: history.length,
          arm,
          rule: time.rule,
          clockBeforeMs,
          go: limit,
          spentMs,
          nodes: searched,
          nodesBound: nodes > 0 && searched !== null && searched >= nodes,
          score: redScore(infos, color),
        });
        if (spentMs >= clockBeforeMs) throw new Flag(color);
        clocks[color] = clockBeforeMs - spentMs + input.tc.incrementMs;
        if (input.adjudication) {
          scores.push(redScore(infos, color));
          const verdict = adjudicate(scores, history.length + 1, input.adjudication);
          if (verdict) {
            throw new Adjudicated(
              verdict,
              verdict === 'draw' ? 'adjudicated-draw' : 'adjudicated-win',
            );
          }
        }
        const uci = best.split(/\s+/)[1];
        return uci && uci !== '(none)' ? uci : null;
      },
    });
    const winner =
      game.result === 'red-wins'
        ? armOf('red')
        : game.result === 'black-wins'
          ? armOf('black')
          : game.result === 'draw'
            ? 'draw'
            : 'aborted';
    return {
      redArm: input.redArm,
      result: winner,
      termination: game.termination,
      plies: game.plyCount,
      wallMs: Date.now() - started,
      moves,
    };
  } catch (error) {
    if (error instanceof Adjudicated) {
      return {
        redArm: input.redArm,
        result: error.winner === 'draw' ? 'draw' : armOf(error.winner),
        termination: error.termination,
        plies: moves.length + input.openingPlies,
        wallMs: Date.now() - started,
        moves,
      };
    }
    if (!(error instanceof Flag)) throw error;
    const loser = armOf(error.color);
    return {
      redArm: input.redArm,
      result: loser === 'A' ? 'B' : 'A',
      termination: 'flag',
      plies: moves.length,
      wallMs: Date.now() - started,
      moves,
    };
  }
}

/** Arm A's score for a game: 1 win, 0.5 draw, 0 loss (an aborted game counts as a draw). */
export function scoreForA(game: ClockedGame): number {
  return game.result === 'A' ? 1 : game.result === 'B' ? 0 : 0.5;
}

// ---------------------------------------------------------------------------
// CLI: play `--pairs` pairs from `--seed`, one JSON line per pair.

function arg(argv: string[], name: string, fallback?: string): string {
  const i = argv.indexOf(`--${name}`);
  const value = i >= 0 ? argv[i + 1] : fallback;
  if (value === undefined) throw new Error(`missing --${name}`);
  return value;
}

function parseRule(value: string): BotTimeRule {
  if (value === 'flat' || value === 'phase' || value === 'native') return value;
  throw new Error(`unknown rule ${value}`);
}

export async function main(argv: string[]): Promise<void> {
  const rules = { A: parseRule(arg(argv, 'a')), B: parseRule(arg(argv, 'b')) };
  const [initialMs, incrementMs] = arg(argv, 'tc', '60000+1000').split('+').map(Number);
  const tc = { initialMs: initialMs!, incrementMs: incrementMs! };
  const seed = Number(arg(argv, 'seed'));
  const pairs = Number(arg(argv, 'pairs', '1'));
  const overheadMs = Number(arg(argv, 'overhead-ms', '150'));
  const openingPlies = Number(arg(argv, 'opening-plies', '2'));
  const bin = arg(argv, 'bin');
  const net = arg(argv, 'net');
  const num = (name: string, fallback: string) => Number(arg(argv, name, fallback));
  const hw = {
    A: { threads: num('a-threads', '1'), hashMb: num('a-hash', '16') },
    B: { threads: num('b-threads', '1'), hashMb: num('b-hash', '16') },
  };
  const nodesArg = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? Number(argv[i + 1]) : undefined;
  };
  const aNodes = nodesArg('a-nodes');
  const bNodes = nodesArg('b-nodes');
  const tierNodes = (xiangqiEngineTierFor(MATCH_ENGINE_ID) as { nodes: number }).nodes;
  const nodes = { A: aNodes ?? tierNodes, B: bNodes ?? tierNodes };
  const adjudication = argv.includes('--adjudicate') ? MATCH_ADJUDICATION : null;
  const engines = { A: new UciProcess(bin), B: new UciProcess(bin) };
  await Promise.all([
    engines.A.init(net, hw.A.threads, hw.A.hashMb),
    engines.B.init(net, hw.B.threads, hw.B.hashMb),
  ]);
  try {
    for (let p = 0; p < pairs; p++) {
      const pairSeed = String(seed + p);
      const games: ClockedGame[] = [];
      for (const redArm of ['A', 'B'] as const) {
        games.push(
          await playClockedGame({
            rules,
            engines,
            redArm,
            seed: pairSeed,
            tc,
            overheadMs,
            openingPlies,
            nodes,
            adjudication,
          }),
        );
      }
      const score = (scoreForA(games[0]!) + scoreForA(games[1]!)) / 2;
      process.stdout.write(
        `${JSON.stringify({ pairSeed, rules, hw, nodes, adjudicated: adjudication !== null, tc, overheadMs, score, games })}\n`,
      );
    }
  } finally {
    engines.A.quit();
    engines.B.quit();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    () => process.exit(0),
    (error) => {
      console.error(error);
      process.exit(1);
    },
  );
}
