// Whole-game freestyle analysis. One bounded Rapfi process per sweep; never
// compete for a live bot slot or launch N+1 subprocesses at once.
import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import {
  applyGomokuMove,
  createInitialGomokuState,
  type GomokuMove,
  type GomokuOpening,
  type GomokuState,
  parseRapfiOutput,
  type RapfiPoint,
  rapfiBoardLines,
} from '@mistboard/game';
import { publicRepoRoot } from './engine-paths.js';
import {
  type AnalysisProgressStore,
  type GameAnalysisCacheOps,
  liveAnalysisProgressStore,
  resolveCachedComputation,
} from './game-analysis-kernel.js';
import {
  isVacuousAnalysis,
  type SweepPlyEval,
  sweepPlyEvals,
  VacuousAnalysisError,
} from './game-analysis-sweep.js';
import * as persistence from './persistence.js';
import { UciEnginePool } from './uci-engine-harness.js';

export const GOMOKU_ANALYSIS_NODES = 100_000;
export const GOMOKU_ANALYSIS_TIME_MS = 5_000;
export const GOMOKU_ANALYSIS_HASH_BYTES = 32 * 1024 * 1024;
export const GOMOKU_ANALYSIS_ENGINE_VERSION = 1;
// Binary + freestyle network + scoring/parser version + every search dial.
// Bump the version if config, protocol, normalization or parser semantics change.
export const GOMOKU_ANALYSIS_ENGINE_ID = `rapfi-gomoku-analysis@${GOMOKU_ANALYSIS_ENGINE_VERSION}+1387d11312+net6bc0d1b0+n${GOMOKU_ANALYSIS_NODES}+t${GOMOKU_ANALYSIS_TIME_MS}+h32+threads1+pv1`;
// Existing persistence key is (room, engine, depth). The node/time budget is in
// engineId; depth is only a stable nominal dimension, never a search command.
export const GOMOKU_ANALYSIS_DEPTH = 0;

export type GomokuGameAnalysis = {
  engineId: string;
  depth: number;
  plies: SweepPlyEval[];
};
export type GomokuAnalysisCache = GameAnalysisCacheOps<SweepPlyEval[]>;
export type GomokuAnalysisOptions = {
  /** Explicit binary (or executable Docker shim), else RAPFI_BIN, then assets layout. */
  binaryPath?: string;
  /** Config and native networks live beside the asset binary by default. */
  cwd?: string;
  /** Owner watchdog, independent of the fixed engine search budget. */
  timeoutMs?: number;
  progress?: AnalysisProgressStore<SweepPlyEval>;
  /** Recorded-output process double for tests; no native binary is needed. */
  spawnProcess?: (binaryPath: string, cwd: string) => ChildProcessWithoutNullStreams;
};

const analysisPool = new UciEnginePool({
  name: 'rapfi-gomoku-analysis',
  maxProcessesEnvVar: 'RAPFI_ANALYSIS_MAX_PROCESSES',
  queueTimeoutEnvVar: 'RAPFI_ANALYSIS_QUEUE_TIMEOUT_MS',
  defaultMaxProcesses: 1,
  defaultQueueTimeoutMs: 30_000,
  queueTimeoutMessage: 'Rapfi analysis pool timed out',
});

export function rapfiAnalysisBinaryPath(): string {
  if (process.env.RAPFI_BIN) return resolve(process.env.RAPFI_BIN);
  const local = resolve(publicRepoRoot(), 'bin', 'rapfi');
  return existsSync(local) ? local : '/app/bin/rapfi';
}

type PendingReply = {
  lines: string[];
  bytes: number;
  complete(line: string): boolean;
  resolve(output: string[]): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
};

// Shared native protocol lifecycle: live PvE owns a fresh session per move,
// while postgame analysis keeps one session for its sequential sweep.
export class RapfiSession {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly reader;
  private readonly errors;
  private readonly closed: Promise<void>;
  private didClose = false;
  private closing = false;
  private failure: Error | null = null;
  private pending: PendingReply | null = null;
  private stderrBytes = 0;

  constructor(
    private readonly options: GomokuAnalysisOptions,
    trackProcess?: (child: ChildProcessWithoutNullStreams) => void,
  ) {
    const bin = resolve(options.binaryPath ?? rapfiAnalysisBinaryPath());
    this.child = (options.spawnProcess ?? ((path, cwd) => spawn(path, [], { cwd })))(
      bin,
      options.cwd ?? dirname(bin),
    );
    trackProcess?.(this.child);
    this.closed = new Promise((done) => {
      this.child.on('close', (code, signal) => {
        this.didClose = true;
        if (!this.closing) this.fail(new Error(`Rapfi exited during analysis: ${code ?? signal}`));
        done();
      });
    });
    this.child.on('error', (error) => this.fail(error));
    this.child.stdin.on('error', (error) => this.fail(error));
    this.reader = createInterface({ input: this.child.stdout });
    this.reader.on('line', (line) => this.receive(line));
    this.reader.on('error', (error) => this.fail(error));
    this.errors = createInterface({ input: this.child.stderr });
    this.errors.on('line', (line) => {
      if (/ERROR\b|failed to load|unable to open|evaluator.*disabled/i.test(line))
        this.fail(new Error('Rapfi network/config error'));
    });
    this.errors.on('error', (error) => this.fail(error));
    this.child.stderr.on('data', (chunk: Buffer) => {
      this.stderrBytes += chunk.length;
      if (this.stderrBytes > 1024 * 1024) this.fail(new Error('Rapfi stderr exceeded 1 MB'));
    });
  }

  private fail(error: Error): void {
    this.failure ??= error;
    const pending = this.pending;
    this.pending = null;
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(this.failure);
    }
    if (!this.didClose) this.child.kill('SIGKILL');
  }

  private receive(line: string): void {
    if (/^ERROR\b|failed to load|unable to open|evaluator.*disabled/i.test(line)) {
      this.fail(new Error('Rapfi network/config error'));
      return;
    }
    const pending = this.pending;
    if (!pending) return;
    pending.bytes += Buffer.byteLength(line) + 1;
    if (pending.bytes > 1024 * 1024) {
      this.fail(new Error('Rapfi position output exceeded 1 MB'));
      return;
    }
    pending.lines.push(line);
    if (pending.complete(line)) {
      clearTimeout(pending.timer);
      this.pending = null;
      pending.resolve(pending.lines);
    }
  }

  exchange(
    lines: string[],
    complete: PendingReply['complete'],
    timeoutMs = this.options.timeoutMs ?? 20_000,
  ): Promise<string[]> {
    if (this.failure) return Promise.reject(this.failure);
    if (this.pending || this.didClose)
      return Promise.reject(new Error('Rapfi session unavailable'));
    return new Promise((accept, reject) => {
      const timer = setTimeout(() => this.fail(new Error('Rapfi analysis timed out')), timeoutMs);
      this.pending = { lines: [], bytes: 0, complete, resolve: accept, reject, timer };
      try {
        this.child.stdin.write(`${lines.join('\n')}\n`);
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  async ready(): Promise<void> {
    await this.exchange(['START 15'], (line) => line.trim() === 'OK');
    this.child.stdin.write(
      [
        'INFO rule 0',
        'INFO thread_num 1',
        `INFO max_memory ${GOMOKU_ANALYSIS_HASH_BYTES}`,
        'INFO show_detail 2',
        `INFO max_node ${GOMOKU_ANALYSIS_NODES}`,
        `INFO timeout_turn ${GOMOKU_ANALYSIS_TIME_MS}`,
        '',
      ].join('\n'),
    );
  }

  async evaluate(state: GomokuState): Promise<Omit<SweepPlyEval, 'ply'>> {
    if (state.status.type !== 'playing') throw new Error('Cannot search a terminal Gomoku board');
    const turn = state.status.turn;
    const stones = rapfiBoardLines({
      turn: 1,
      stones: state.board.flatMap((color, index) =>
        color ? [{ x: index % 15, y: Math.floor(index / 15), player: color === turn ? 1 : 2 }] : [],
      ),
    });
    // YXBOARD loads WITHOUT searching. DONE commits the whole board; YXNBEST
    // emits structured PVs and a final raw x,y line. No human MESSAGE parsing.
    const output = await this.exchange(['YXBOARD', ...stones, 'DONE', 'YXNBEST 1'], (line) =>
      /^\d+,\d+$/.test(line.trim()),
    );
    const candidate = parseRapfiOutput(output).find((c) => c.pvIndex === 0);
    if (!candidate) return { cp: null, mate: null, best: null };
    if (state.board[candidate.move.y * 15 + candidate.move.x] !== null)
      throw new Error('Rapfi returned an occupied move');
    const sign = turn === 'black' ? 1 : -1;
    const forced = candidate.forcedFive;
    return {
      cp: forced ? null : sign * candidate.eval || 0,
      // Rapfi uses plies; the shared review schema uses signed FULL MOVES.
      // A zero-distance forced result uses 1 so its sign survives JSON.
      mate: forced
        ? sign * (forced.result === 'win' ? 1 : -1) * Math.max(1, Math.ceil(forced.plies / 2))
        : null,
      best: square(candidate.move),
      pv: candidate.pv.map(square),
    };
  }

  async close(): Promise<void> {
    this.closing = true;
    if (!this.didClose) {
      if (this.failure) this.child.kill('SIGKILL');
      else this.child.stdin.end('END\n');
    }
    // Keep the pool slot until close (pipes closed and process reaped), even
    // after failure. A process ignoring END gets at most one second to exit.
    const timer = setTimeout(() => {
      if (!this.didClose) this.child.kill('SIGKILL');
    }, 1_000);
    try {
      await this.closed;
    } finally {
      clearTimeout(timer);
      this.reader.close();
      this.errors.close();
    }
  }
}

function square({ x, y }: RapfiPoint): string {
  // The pinned config's X_flipY affects human labels only; raw protocol y=0
  // is our rank 1, as in the browser adapter. Never parse MESSAGE labels.
  return `${String.fromCharCode(97 + x)}${y + 1}`;
}

export async function analyzeGomokuPostgame(
  moves: readonly GomokuMove[],
  opening?: GomokuOpening,
  options: GomokuAnalysisOptions = {},
): Promise<GomokuGameAnalysis> {
  // Validate the complete log before spending a pool slot or launching Rapfi.
  let state = createInitialGomokuState(opening);
  const states = [state];
  for (const move of moves) {
    const next = applyGomokuMove(state, move);
    if (next === state) throw new Error('Illegal Gomoku analysis move');
    state = next;
    states.push(state);
  }
  const release = await analysisPool.acquire();
  let session: RapfiSession | undefined;
  try {
    session = new RapfiSession(options);
    await session.ready();
    const engine = session;
    const plies = await sweepPlyEvals(
      moves.map((move) => move.to),
      async (prefix) => {
        const position = states[prefix.length]!;
        if (position.status.type === 'finished') {
          const winner = position.status.winner;
          return {
            cp: winner === null ? 0 : winner === 'black' ? 30_000 : -30_000,
            mate: null,
            best: null,
          };
        }
        return engine.evaluate(position);
      },
      GOMOKU_ANALYSIS_DEPTH,
      options.progress,
    );
    if (isVacuousAnalysis(plies)) throw new VacuousAnalysisError('gomoku');
    return { engineId: GOMOKU_ANALYSIS_ENGINE_ID, depth: GOMOKU_ANALYSIS_DEPTH, plies };
  } finally {
    try {
      await session?.close();
    } finally {
      release();
    }
  }
}

const liveCache: GomokuAnalysisCache = {
  get: (roomId, engineId, depth) => persistence.getGameAnalysis(roomId, engineId, depth),
  save: (roomId, engineId, depth, plies) =>
    persistence.saveGameAnalysis(roomId, engineId, depth, plies),
};

export async function resolveGomokuAnalysis(
  roomId: string,
  moves: readonly GomokuMove[],
  opening?: GomokuOpening,
  cache: GomokuAnalysisCache = liveCache,
  analyze?: typeof analyzeGomokuPostgame,
  computeIfMissing = true,
): Promise<GomokuGameAnalysis | null> {
  const engineId = GOMOKU_ANALYSIS_ENGINE_ID;
  const depth = GOMOKU_ANALYSIS_DEPTH;
  const progress = analyze
    ? null
    : liveAnalysisProgressStore<SweepPlyEval>(roomId, engineId, depth);
  const plies = await resolveCachedComputation({
    roomId,
    engineId,
    depth,
    cache,
    computeIfMissing,
    compute: async () => {
      try {
        return (
          await (analyze ?? analyzeGomokuPostgame)(moves, opening, {
            progress: progress ?? undefined,
          })
        ).plies;
      } catch (error) {
        // Null checkpoints must not make every later attempt resume straight
        // into the same failed result after the binary/config is repaired.
        if (error instanceof VacuousAnalysisError) await progress?.clear();
        throw error;
      }
    },
    validate: (series) => {
      if (isVacuousAnalysis(series)) throw new VacuousAnalysisError('gomoku');
    },
    afterSave: progress ? () => progress.clear() : undefined,
  });
  return plies ? { engineId, depth, plies } : null;
}
