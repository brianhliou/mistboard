// Both engines' evaluation of every position of chosen Gomoku title-match games,
// for the match study (scripts/variant-lab/gomoku-title-study.ts). Each position
// is searched by Rapfi and by KataGomo at the work each did in a median rematch
// move (3 seconds each on the match machine): Rapfi 450,000 positions, KataGomo 139
// visits (gomoku-title-match.json equal.total.timing). A count, not a clock, so a
// busy machine slows the run without weakening either search; the time limits are
// only a ceiling. One search thread each, Rapfi 1387d11 with Rapfi Networks 7eeb19b
// and a 32 MB hash, KataGomo df15211 with b10_freestyle15x on its CPU backend and
// the match's GTP config. The two searches of a position run side by side.
//
// One JSON file per game in --out, written after every position so a run can be
// read while it goes and resumed after a stop. Scores are Black's expected score
// in [0, 1] (a draw counts half):
//   - Rapfi: its eval through its own win curve, 1 / (1 + e^(-eval / 200))
//     (Rapfi's ScalingFactor, scoretables.h valueToWinRate); a forced five is 1 or 0.
//   - KataGomo: its root winrate for the side to move, 0.5 * (1 + winLoss), where a
//     full board is 0.5 (noResultUtilityForWhite = 0).
// The final position is the result: 1 or 0 for a five, 0.5 for a full board.
//
//   npx tsx scripts/variant-lab/gomoku-title-evals.ts --run run-equal-3s \
//     --games 0,1,6 --out <dir> [--parallel 4]

import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import {
  applyGomokuRoomMove,
  createGomokuRoomState,
  type GomokuRoomState,
  type GomokuSquare,
} from '@mistboard/game';
import { RapfiSession } from '../../apps/server/src/gomoku-analysis.ts';

const HOME = process.env.HOME ?? '';
const LAB = resolve(HOME, 'projects/mistboard-engine/lab/gomoku-title-match-2026-11');
const RAPFI_BIN = resolve(HOME, 'projects/tools/rapfi-native-1387d113/bin/rapfi');
const KATAGO_BIN = resolve(HOME, 'projects/tools/KataGomo-gomoku/cpp/build/katago');
const KATAGO_NET = resolve(HOME, 'projects/tools/KataGomo-gomoku-nets/b10_freestyle15x.bin.gz');
const KATAGO_CFG = resolve(LAB, 'katagomo-gtp.cfg');

export const BUDGET = {
  matchSeconds: 3,
  rapfi: { nodes: 450_000, timeMs: 60_000, threads: 1, hashMb: 32 },
  katagomo: { maxVisits: 139, maxTimeS: 60, threads: 1 },
} as const;

type Stone = { square: string; color: 'black' | 'white' };
export type LabGame = {
  index: number;
  opening: { id: string; stones: Stone[]; turn: 'black' | 'white' };
  rapfiColor: 'black' | 'white';
  winner: 'black' | 'white' | null;
  reason: string;
  moves: string[];
};

export type RapfiEval = {
  black: number;
  cp: number | null;
  mate: number | null;
  best: string | null;
  pv: string[];
};
export type KataEval = {
  black: number;
  winrate: number;
  best: string;
  pv: string[];
  visits: number;
};
export type GameEvals = {
  run: string;
  file: string;
  game: LabGame;
  budget: typeof BUDGET;
  /** One entry per position 0..moves.length; the last is the result. */
  rapfi: (RapfiEval | null)[];
  katagomo: (KataEval | null)[];
  finished: boolean;
};

const GTP_LETTERS = 'ABCDEFGHJKLMNOP';
const toGtp = (square: string): string =>
  `${GTP_LETTERS[square.charCodeAt(0) - 97]}${Number(square.slice(1))}`;
const fromGtp = (vertex: string): string => {
  const m = /^([A-HJ-P])(\d{1,2})$/i.exec(vertex.trim());
  if (!m) throw new Error(`not a GTP vertex: ${vertex}`);
  return `${String.fromCharCode(97 + GTP_LETTERS.indexOf(m[1]!.toUpperCase()))}${Number(m[2])}`;
};

/** Rapfi's eval (side to move, here signed for Black) on its own win curve. */
export const rapfiBlackScore = (cp: number | null, mate: number | null): number =>
  mate != null ? (mate > 0 ? 1 : 0) : 1 / (1 + Math.exp(-(cp ?? 0) / 200));

/** The positions of a game: the opening, then after each move. */
export function gamePositions(game: LabGame): GomokuRoomState[] {
  let state = createGomokuRoomState(`title-${game.index}`, {
    stones: game.opening.stones.map((s) => ({ square: s.square as GomokuSquare, color: s.color })),
    turn: game.opening.turn,
  });
  const out = [state];
  for (const to of game.moves) {
    state = applyGomokuRoomMove(state, { to: to as GomokuSquare });
    out.push(state);
  }
  return out;
}

/** Opening stones replayed alternately so the side to move is the opening's. */
function openingOrder(opening: LabGame['opening']): Stone[] {
  const black = opening.stones.filter((s) => s.color === 'black');
  const white = opening.stones.filter((s) => s.color === 'white');
  const lastColor = opening.turn === 'black' ? 'white' : 'black';
  const out: Stone[] = [];
  let color = (opening.stones.length % 2 === 1) === (lastColor === 'white') ? 'white' : 'black';
  while (black.length || white.length) {
    const pool = color === 'black' ? black : white;
    const other = color === 'black' ? white : black;
    out.push((pool.length ? pool : other).shift()!);
    color = color === 'black' ? 'white' : 'black';
  }
  return out;
}

/** One persistent KataGomo GTP process; each position is set up from scratch. */
class KataGtp {
  private readonly child: ChildProcessWithoutNullStreams;
  private buffer: string[] = [];
  private waiter: (() => void) | null = null;
  constructor() {
    this.child = spawn(KATAGO_BIN, ['gtp', '-model', KATAGO_NET, '-config', KATAGO_CFG]);
    this.child.stderr.resume();
    createInterface({ input: this.child.stdout }).on('line', (line) => {
      this.buffer.push(line);
      this.waiter?.();
    });
  }
  /** Sends one command and resolves with its reply (up to the blank line). */
  async send(command: string): Promise<string> {
    this.child.stdin.write(`${command}\n`);
    const lines: string[] = [];
    for (;;) {
      while (!this.buffer.length) await new Promise<void>((done) => (this.waiter = done));
      const line = this.buffer.shift()!;
      if (line === '' && lines.length) break;
      if (line !== '' || lines.length) lines.push(line);
    }
    const reply = lines.join('\n');
    if (reply.startsWith('?')) throw new Error(`KataGomo: ${command} -> ${reply}`);
    return reply;
  }
  async analyse(
    history: readonly Stone[],
    turn: 'black' | 'white',
  ): Promise<Omit<KataEval, 'black'>> {
    await this.send('clear_board');
    for (const h of history)
      await this.send(`play ${h.color === 'black' ? 'B' : 'W'} ${toGtp(h.square)}`);
    const g = turn === 'black' ? 'B' : 'W';
    const reply = await this.send(`kata-genmove_analyze ${g} avoid ${g} pass 1`);
    const info =
      /info move (\S+) visits (\d+) \S+ \S+ winrate (\S+).*? order 0 pv ((?:[A-HJ-P]\d+ ?)+)/.exec(
        reply,
      );
    if (!info) throw new Error(`KataGomo gave no analysis: ${reply.slice(0, 200)}`);
    return {
      best: fromGtp(info[1]!),
      visits: Number(info[2]),
      winrate: Number(info[3]),
      pv: info[4]!.trim().split(' ').map(fromGtp),
    };
  }
  async start(): Promise<void> {
    await this.send('boardsize 15');
    await this.send(`kata-set-param maxVisits ${BUDGET.katagomo.maxVisits}`);
    await this.send(`kata-set-param maxTime ${BUDGET.katagomo.maxTimeS}`);
  }
  close(): void {
    this.child.stdin.end('quit\n');
  }
}

async function analyseGame(run: string, file: string, outDir: string): Promise<void> {
  const game = JSON.parse(readFileSync(resolve(LAB, run, 'games', file), 'utf8')) as LabGame;
  const out = resolve(outDir, `${run}-${String(game.index).padStart(3, '0')}.json`);
  const record: GameEvals = existsSync(out)
    ? (JSON.parse(readFileSync(out, 'utf8')) as GameEvals)
    : { run, file, game, budget: BUDGET, rapfi: [], katagomo: [], finished: false };
  if (record.finished) return;
  const positions = gamePositions(game);
  const history = openingOrder(game.opening);
  const moverAt = (k: number): 'black' | 'white' => {
    const status = positions[k]!.status;
    if (status.type !== 'playing') throw new Error(`move ${k + 1} after the game ended`);
    return status.turn;
  };
  const rapfi = new RapfiSession({
    binaryPath: RAPFI_BIN,
    budget: { nodes: BUDGET.rapfi.nodes, timeMs: BUDGET.rapfi.timeMs },
    timeoutMs: BUDGET.rapfi.timeMs + 30_000,
  });
  const kata = new KataGtp();
  await Promise.all([rapfi.ready(), kata.start()]);
  try {
    for (let i = 0; i < positions.length; i += 1) {
      const state = positions[i]!;
      if (record.rapfi[i] !== undefined) continue;
      if (state.status.type !== 'playing') {
        const black = game.winner === 'black' ? 1 : game.winner === 'white' ? 0 : 0.5;
        record.rapfi[i] = { black, cp: null, mate: null, best: null, pv: [] };
        record.katagomo[i] = { black, winrate: black, best: '', pv: [], visits: 0 };
        continue;
      }
      const turn = state.status.turn;
      const stones = [
        ...history,
        ...game.moves.slice(0, i).map((square, k) => ({ square, color: moverAt(k) })),
      ];
      const [r, k] = await Promise.all([rapfi.evaluate(state), kata.analyse(stones, turn)]);
      record.rapfi[i] = {
        black: rapfiBlackScore(r.cp, r.mate),
        cp: r.cp,
        mate: r.mate,
        best: r.best,
        pv: r.pv ?? [],
      };
      record.katagomo[i] = { ...k, black: turn === 'black' ? k.winrate : 1 - k.winrate };
      writeFileSync(out, `${JSON.stringify(record)}\n`);
    }
    record.finished = record.rapfi.length === positions.length;
    writeFileSync(out, `${JSON.stringify(record)}\n`);
    console.log(
      `${new Date().toISOString()} ${run} game ${game.index}: ${positions.length} positions`,
    );
  } finally {
    kata.close();
    await rapfi.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (name: string): string | undefined => {
    const at = process.argv.indexOf(`--${name}`);
    return at >= 0 ? process.argv[at + 1] : undefined;
  };
  const run = arg('run') ?? 'run-equal-3s';
  const outDir = resolve(arg('out') ?? '.');
  const parallel = Number(arg('parallel') ?? 4);
  const wanted = new Set((arg('games') ?? '').split(',').filter(Boolean).map(Number));
  mkdirSync(outDir, { recursive: true });
  const files = readdirSync(resolve(LAB, run, 'games')).filter((f) =>
    wanted.has(Number(f.slice(0, 3))),
  );
  const queue = [...files];
  await Promise.all(
    Array.from({ length: parallel }, async () => {
      for (let file = queue.shift(); file; file = queue.shift())
        await analyseGame(run, file, outDir);
    }),
  );
}
