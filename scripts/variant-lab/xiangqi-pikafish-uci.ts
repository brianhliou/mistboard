// Shared Pikafish UCI layer for the standard-xiangqi puzzle pipeline (#185).
//
// The miner (xiangqi-puzzle-miner.ts) and the uniqueness audit
// (xiangqi-puzzle-uniqueness-audit.ts) must judge a solver ply IDENTICALLY, or
// the audit stops being an independent re-verification of the mined corpus and
// becomes a second, drifting definition (that drift is exactly what #185
// documents). Everything verdict-shaping that used to be copied into both
// scripts lives here, once:
//
//   - the UCI subprocess driver (same MultiPV plumbing, same timeout),
//   - `info` line parsing to raw XiangqiUciScore lines. No local mate folding:
//     normalization is xiangqiUciScoreToCp from @mistboard/game, so mate
//     scores land on one cp axis in both tools (the audit's old inline copy
//     disagreed on `mate 0`),
//   - analyzeXiangqiSolverPly, the ONE way a solver ply is judged: search the
//     standalone FEN via standardXiangqiEngineFen (history-free, the position
//     a solver actually sees) at MultiPV 2, then apply the shared
//     winning-floor gate isXiangqiSolverMoveUnique,
//   - the gate's default knobs, so the two CLIs cannot drift on defaults.
//
// The gate itself (and its scalar unit tests) stays engine-free in
// packages/game/src/puzzles-xiangqi-mining.ts; this module owns the engine
// plumbing that feeds it. Contract test: xiangqi-uniqueness-gate.test.ts
// (runs without an engine via a fake analyzeFen).
//
// Deliberately NOT imported here: apps/server engine-path resolution. The
// CLIs resolve binary + net and pass them in, so this module (and its test)
// never needs a local Pikafish install.

import { type ChildProcessByStdio, spawn } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import {
  classifyXiangqiSolverMoveUniqueness,
  standardXiangqiEngineFen,
  type XiangqiGameState,
  type XiangqiSolverUniquenessOptions,
  type XiangqiUciScore,
  type XiangqiVerifyLine,
  xiangqiUciScoreToCp,
} from '../../packages/game/src/index.ts';

// ── Shared gate defaults ─────────────────────────────────────────────────────

/** Default winning-floor gate knobs, shared by the miner's and the audit's CLI
 *  so their defaults cannot drift apart. winHi 0.80 ~ +240cp and winLo 0.60 ~
 *  +70cp on the K=400 logistic (xiangqiWinRate). */
export const XIANGQI_SOLVER_GATE_DEFAULTS: XiangqiSolverUniquenessOptions = {
  winHi: 0.8,
  winLo: 0.6,
  minGapCp: 200,
};

// ── UCI `info` line parsing ──────────────────────────────────────────────────

/** One MultiPV line of a completed search: raw UCI score (side-to-move POV,
 *  exactly one of cp/mate set) plus the full PV move-token list. */
export type XiangqiScoredLine = { rank: number; score: XiangqiUciScore; pvUci: string[] };

const MULTIPV_RE = /\bmultipv (\d+)\b/;
const SCORE_RE = /\bscore (cp|mate) (-?\d+)\b/;
const PV_RE = /\bpv (.+)$/;

/** Keep only the last `info` line per multipv rank (the deepest completed
 *  one), sorted by rank. Scores stay raw: fold mates onto the cp axis with
 *  xiangqiScoredLineToVerifyLine / xiangqiUciScoreToCp, never locally. */
export function parseXiangqiScoredLines(lines: readonly string[]): XiangqiScoredLine[] {
  const byRank = new Map<number, XiangqiScoredLine>();
  for (const line of lines) {
    if (!line.startsWith('info ')) continue;
    const score = SCORE_RE.exec(line);
    const pv = PV_RE.exec(line);
    if (!score || !pv) continue;
    const rank = Number(MULTIPV_RE.exec(line)?.[1] ?? '1');
    const kind = score[1];
    const value = Number(score[2]);
    byRank.set(rank, {
      rank,
      score: kind === 'mate' ? { cp: null, mate: value } : { cp: value, mate: null },
      pvUci: pv[1]!.trim().split(/\s+/),
    });
  }
  return [...byRank.values()].sort((a, b) => a.rank - b.rank);
}

/** Normalize a parsed line to the gate's input shape via the SHARED
 *  xiangqiUciScoreToCp (mates fold in near XIANGQI_MATE_SCORE_CP; `mate 0` =
 *  the side to move is already mated = strongly negative). Returns undefined
 *  for a missing or malformed line. */
export function xiangqiScoredLineToVerifyLine(
  line: XiangqiScoredLine | null | undefined,
): XiangqiVerifyLine | undefined {
  if (!line) return undefined;
  const cp = xiangqiUciScoreToCp(line.score);
  if (cp === null) return undefined;
  return { scoreCp: cp, mate: line.score.mate };
}

// ── Engine driver ────────────────────────────────────────────────────────────

/** Search budget: at least one of depth/nodes. A depth floor (not just a node
 *  cap) keeps best-vs-second ordering stable: too-low search mis-orders the
 *  top moves and makes the uniqueness gap lie. */
export type XiangqiSearchLimits = { depth?: number; nodes?: number };

function goCommand(limits: XiangqiSearchLimits): string {
  const parts = ['go'];
  if (limits.depth) parts.push(`depth ${limits.depth}`);
  if (limits.nodes) parts.push(`nodes ${limits.nodes}`);
  if (parts.length === 1) throw new Error('XiangqiSearchLimits needs depth and/or nodes');
  return parts.join(' ');
}

const ANALYZE_TIMEOUT_MS = 240_000;

/** Thin driver around a mainline-Pikafish subprocess. One in-flight request at
 *  a time; kill() on error paths, quit() for a clean shutdown. */
export class PikafishEngine {
  #proc: ChildProcessByStdio<Writable, Readable, null>;
  #buf = '';
  #waiter: {
    pred: (line: string) => boolean;
    resolve: (lines: string[]) => void;
    reject: (err: Error) => void;
    timer: NodeJS.Timeout;
    lines: string[];
  } | null = null;
  #multipv = 1;
  net: string;

  constructor(binary: string, net: string) {
    this.#proc = spawn(binary, [], { stdio: ['pipe', 'pipe', 'ignore'] });
    this.#proc.stdout.setEncoding('utf8');
    this.#proc.stdout.on('data', (chunk: string) => this.#onData(chunk));
    this.net = net;
  }

  #onData(chunk: string): void {
    this.#buf += chunk;
    let nl = this.#buf.indexOf('\n');
    while (nl >= 0) {
      const line = this.#buf.slice(0, nl).trim();
      this.#buf = this.#buf.slice(nl + 1);
      const w = this.#waiter;
      if (w) {
        w.lines.push(line);
        if (w.pred(line)) {
          clearTimeout(w.timer);
          this.#waiter = null;
          w.resolve(w.lines);
        }
      }
      nl = this.#buf.indexOf('\n');
    }
  }

  #request(cmds: string[], pred: (line: string) => boolean): Promise<string[]> {
    return new Promise((res, rej) => {
      const timer = setTimeout(() => {
        this.#waiter = null;
        rej(new Error(`pikafish request timed out: ${cmds[cmds.length - 1]}`));
      }, ANALYZE_TIMEOUT_MS);
      timer.unref();
      this.#waiter = { pred, resolve: res, reject: rej, timer, lines: [] };
      for (const cmd of cmds) this.#proc.stdin.write(`${cmd}\n`);
    });
  }

  async init(): Promise<void> {
    await this.#request(['uci'], (l) => l === 'uciok');
    // Mainline Pikafish requires an absolute NNUE EvalFile (same setoption the
    // server engine path sends in xiangqi-pikafish-engine.ts).
    await this.#request([`setoption name EvalFile value ${this.net}`, 'isready'], (l) =>
      l.startsWith('readyok'),
    );
  }

  async newGame(): Promise<void> {
    await this.#request(['ucinewgame', 'isready'], (l) => l.startsWith('readyok'));
  }

  #search(position: string, limits: XiangqiSearchLimits, multipv: number): Promise<string[]> {
    const cmds: string[] = [];
    if (multipv !== this.#multipv) {
      cmds.push(`setoption name MultiPV value ${multipv}`);
      this.#multipv = multipv;
    }
    cmds.push(position, goCommand(limits));
    return this.#request(cmds, (l) => l.startsWith('bestmove'));
  }

  /** Analyze a game-history position (`position startpos moves ...`). The
   *  miner's cheap scan pass walks real games this way. */
  async analyzeMoves(
    movesUci: readonly string[],
    limits: XiangqiSearchLimits,
    multipv: number,
  ): Promise<XiangqiScoredLine[]> {
    const position =
      movesUci.length > 0 ? `position startpos moves ${movesUci.join(' ')}` : 'position startpos';
    return parseXiangqiScoredLines(await this.#search(position, limits, multipv));
  }

  /** Analyze a standalone position (`position fen ...`), history-free. This is
   *  the canonical entry for judging puzzle positions: it is exactly the
   *  position a solver sees, so miner and audit verdicts cannot diverge on
   *  game-history context (#185). */
  async analyzeFen(
    fen: string,
    limits: XiangqiSearchLimits,
    multipv: number,
  ): Promise<XiangqiScoredLine[]> {
    return parseXiangqiScoredLines(await this.#search(`position fen ${fen}`, limits, multipv));
  }

  kill(): void {
    if (this.#waiter) {
      clearTimeout(this.#waiter.timer);
      this.#waiter = null;
    }
    this.#proc.kill();
  }

  quit(): void {
    if (this.#waiter) {
      clearTimeout(this.#waiter.timer);
      this.#waiter = null;
    }
    this.#proc.stdin.write('quit\n');
    this.#proc.stdin.end();
  }
}

// ── Canonical solver-ply judgment ────────────────────────────────────────────

export type XiangqiSolverPlyAnalysis = {
  /** Raw MultiPV lines (rank order); lines[0].pvUci[0] is the engine best. */
  lines: XiangqiScoredLine[];
  /** Normalized best / runner-up, solver POV (gate inputs). */
  best: XiangqiVerifyLine | undefined;
  second: XiangqiVerifyLine | undefined;
  /** The shared winning-floor gate's verdict on this ply. */
  unique: boolean;
  /** Structured reason for metrics/audit output, including deterministic near ties. */
  reason: ReturnType<typeof classifyXiangqiSolverMoveUniqueness>['reason'];
};

/** Judge one solver ply the ONE canonical way, shared by the miner's verify
 *  pass and the audit: search the standalone FEN (standardXiangqiEngineFen,
 *  history-free) at MultiPV 2 under `limits`, normalize via
 *  xiangqiUciScoreToCp, and apply isXiangqiSolverMoveUnique. Any future gate
 *  or position-loading change lands on both tools by construction. */
export async function analyzeXiangqiSolverPly(
  engine: Pick<PikafishEngine, 'analyzeFen' | 'newGame'>,
  state: XiangqiGameState,
  limits: XiangqiSearchLimits,
  gate: XiangqiSolverUniquenessOptions,
): Promise<XiangqiSolverPlyAnalysis> {
  // Every solver position must start with a fresh hash. The gated re-mine's
  // four residual near-ties came from two processes giving boundary positions
  // different hash/history context. Clearing here makes miner and later audit
  // searches independent and apples-to-apples.
  await engine.newGame();
  const lines = await engine.analyzeFen(standardXiangqiEngineFen(state), limits, 2);
  const best = xiangqiScoredLineToVerifyLine(lines[0]);
  const second = xiangqiScoredLineToVerifyLine(lines[1]);
  const verdict = classifyXiangqiSolverMoveUniqueness(best, second, gate);
  return { lines, best, second, unique: verdict.unique, reason: verdict.reason };
}
