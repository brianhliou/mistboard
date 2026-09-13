// Shared UCI subprocess harness for the in-process PvE move providers.
//
// Every "Tier-B" engine (Fairy-Stockfish for the perfect-info xiangqi
// variants, PikaJieQi for jieqi, the MistyBanqi / MistyJungle / MistyJungleFlip
// Rust binaries) drives a UCI subprocess with the SAME process lifecycle: a small
// per-process concurrency pool, a per-request `spawn` that writes a command block
// to stdin and scans stdout for `bestmove`, a hard timeout, and a SIGKILL cleanup.
// That lifecycle used to be copy-pasted verbatim across 8 files; it now lives here
// once. Binary-path resolution, tier tables, and command assembly stay per-engine
// (each speaks a slightly different UCI dialect).
//
// This is NOT the fog engine-worker path (python-pool / internal-engine-client /
// the Obscuro container engines) — those speak the redaction-shaped HTTP protocol
// and are unaffected.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from './obs.js';

const HERE = dirname(fileURLToPath(import.meta.url));

// ── Generic UCI subprocess core (shared by every in-process spawn engine) ─────

/**
 * Read a bounded integer from an env var: the parsed value clamped to [min, max],
 * or `fallback` when the var is unset / non-numeric.
 */
export function boundedEnvInt(name: string, fallback: number, min: number, max: number): number {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

export type UciEnginePoolConfig = {
  /** Env var overriding the max concurrent subprocesses (clamped 1..8). */
  maxProcessesEnvVar: string;
  /** Env var overriding the queue-wait timeout in ms (clamped 100..30_000). */
  queueTimeoutEnvVar: string;
  /** Default max concurrent subprocesses (default 2). */
  defaultMaxProcesses?: number;
  /** Default queue-wait timeout in ms (default 5_000). */
  defaultQueueTimeoutMs?: number;
  /** Error message when a waiter times out waiting for a slot. */
  queueTimeoutMessage: string;
  /** Stable label for the per-engine breakdown in /api/server-status. Pools without
   *  a name report as 'unnamed'. */
  name?: string;
};

/** Point-in-time saturation snapshot for one pool (see #203). Cumulative counters
 *  are monotonic over the process lifetime; `active`/`queueDepth` are instantaneous. */
export type UciEnginePoolStats = {
  name: string;
  /** Subprocesses running right now. */
  active: number;
  /** Requests waiting for a slot right now. */
  queueDepth: number;
  /** Current concurrency cap (re-read from the env each acquire). */
  maxProcesses: number;
  /** Cumulative slots taken (immediate + after waiting). */
  acquired: number;
  /** Cumulative requests that had to queue (a leading saturation signal). */
  waited: number;
  /** Cumulative queue-wait timeouts (saturation that actually shed load). */
  timedOut: number;
  /** High-water mark of `queueDepth`. */
  peakQueueDepth: number;
};

type QueueEntry = {
  reject(err: Error): void;
  resolve(release: () => void): void;
  timer: ReturnType<typeof setTimeout>;
};

// Every constructed pool registers here so /api/server-status can report web-side
// engine-pool saturation — the least-instrumented signal we have, and the leading
// indicator for the non-fog engine-service split (#203, memory:
// architecture_engine_service_split). Pools are process-lifetime singletons, so
// they never unregister.
const poolRegistry = new Set<UciEnginePool>();

/** Per-pool + summed saturation stats across every in-process UCI pool. */
export function aggregateEnginePoolStats(): {
  pools: UciEnginePoolStats[];
  totals: { active: number; queueDepth: number; waited: number; timedOut: number };
} {
  const pools = [...poolRegistry]
    .map((pool) => pool.stats())
    .sort((a, b) => a.name.localeCompare(b.name));
  const totals = pools.reduce(
    (sum, p) => ({
      active: sum.active + p.active,
      queueDepth: sum.queueDepth + p.queueDepth,
      waited: sum.waited + p.waited,
      timedOut: sum.timedOut + p.timedOut,
    }),
    { active: 0, queueDepth: 0, waited: 0, timedOut: 0 },
  );
  return { pools, totals };
}

/**
 * A tiny per-process concurrency gate: at most N `spawn`ed engine subprocesses run
 * at once; the rest queue (FIFO) until a slot frees or the wait times out. Bounds
 * are re-read from the environment on every `acquire()`, matching the pre-extraction
 * behavior. The queue-wait timer is `.unref()`ed so a pending waiter never keeps the
 * process alive (repo hard rule on speculative timers).
 */
export class UciEnginePool {
  private active = 0;
  private readonly queue: QueueEntry[] = [];
  // Cumulative saturation counters (monotonic over the process lifetime).
  private acquired = 0;
  private waited = 0;
  private timedOut = 0;
  private peakQueueDepth = 0;

  constructor(private readonly config: UciEnginePoolConfig) {
    poolRegistry.add(this);
  }

  /** Take a slot, returning a release function. Call it exactly once when done. */
  acquire(): Promise<() => void> {
    if (this.active < this.maxProcesses()) {
      this.active += 1;
      this.acquired += 1;
      return Promise.resolve(this.release);
    }
    this.waited += 1;
    return new Promise<() => void>((resolveSlot, reject) => {
      const timer = setTimeout(() => {
        const idx = this.queue.findIndex((entry) => entry.reject === reject);
        if (idx >= 0) this.queue.splice(idx, 1);
        this.timedOut += 1;
        // Saturation that actually shed load (#203): every queue-wait timeout is
        // an engine request we dropped. /api/server-status only exposes the
        // counters on demand; this makes each increment an alertable log line.
        logger.warn(
          {
            kind: 'engine_pool_queue_timeout',
            pool: this.config.name ?? 'unnamed',
            active: this.active,
            queue_depth: this.queue.length,
            max_processes: this.maxProcesses(),
            timed_out_total: this.timedOut,
          },
          'Engine pool queue-wait timed out; a request was shed (pool saturated)',
        );
        reject(new Error(this.config.queueTimeoutMessage));
      }, this.queueTimeoutMs());
      timer.unref();
      this.queue.push({ reject, resolve: resolveSlot, timer });
      if (this.queue.length > this.peakQueueDepth) this.peakQueueDepth = this.queue.length;
    });
  }

  private readonly release = (): void => {
    this.active = Math.max(0, this.active - 1);
    const next = this.queue.shift();
    if (next) {
      clearTimeout(next.timer);
      this.active += 1;
      this.acquired += 1;
      next.resolve(this.release);
    }
  };

  /** Point-in-time saturation snapshot (aggregated in /api/server-status). */
  stats(): UciEnginePoolStats {
    return {
      name: this.config.name ?? 'unnamed',
      active: this.active,
      queueDepth: this.queue.length,
      maxProcesses: this.maxProcesses(),
      acquired: this.acquired,
      waited: this.waited,
      timedOut: this.timedOut,
      peakQueueDepth: this.peakQueueDepth,
    };
  }

  private maxProcesses(): number {
    return boundedEnvInt(
      this.config.maxProcessesEnvVar,
      this.config.defaultMaxProcesses ?? 2,
      1,
      8,
    );
  }

  private queueTimeoutMs(): number {
    return boundedEnvInt(
      this.config.queueTimeoutEnvVar,
      this.config.defaultQueueTimeoutMs ?? 5_000,
      100,
      30_000,
    );
  }
}

/**
 * Interpret one line of UCI engine output.
 * - `undefined` → not a `bestmove` line; keep scanning.
 * - a string → the bestmove in engine UCI.
 * - `null` → the engine reported no move (`bestmove (none)` / empty).
 */
export function parseBestmoveLine(line: string): string | null | undefined {
  if (!line.startsWith('bestmove')) return undefined;
  const move = line.split(/\s+/)[1];
  return move && move !== '(none)' ? move : null;
}

/** Parse an advertised UCI option name from `option name ... type ...`. */
export function parseUciOptionLine(line: string): string | undefined {
  const match = line.match(/^option name (.+?) type /);
  return match?.[1]?.trim() || undefined;
}

/** Return the option names configured by a UCI command block. */
export function configuredUciOptionNames(commands: readonly string[]): string[] {
  return commands.flatMap((command) => {
    const match = command.match(/^setoption name (.+?)(?: value .*)?$/);
    return match?.[1]?.trim() ? [match[1].trim()] : [];
  });
}

function validateConfiguredUciOptions(
  commands: readonly string[],
  advertisedOptions: ReadonlySet<string>,
): void {
  const unsupported = configuredUciOptionNames(commands).filter(
    (option) => !advertisedOptions.has(option),
  );
  if (unsupported.length > 0) {
    throw new Error(
      `UCI engine does not advertise configured option(s): ${unsupported.join(', ')}`,
    );
  }
}

function uciProtocolError(line: string): string | null {
  return /^(?:No such option|Unknown option|Unknown command)\b/i.test(line) ? line : null;
}

/** How much of a dead engine's stderr to keep for the failure message. */
const STDERR_TAIL_LIMIT = 2_000;

/**
 * Keep the tail of a child's stderr so a crash can name itself, and — just as
 * important — DRAIN it. `stdio: [..., 'pipe']` with no reader is a hang: once the
 * 64KB pipe buffer fills, the engine blocks on its next write and never reaches
 * `bestmove`.
 */
function captureStderrTail(child: ReturnType<typeof spawn>): () => string {
  let tail = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    tail = (tail + chunk.toString('utf8')).slice(-STDERR_TAIL_LIMIT);
  });
  return () => tail.trim();
}

/**
 * The child closed before producing a result. Every per-request runner listens for
 * this now, because without it a crashed engine is INDISTINGUISHABLE from a slow
 * one: the promise sat until the hard timeout and rejected with the timeout
 * message. Prod, 2026-09-02: six jieqi PvE games were resigned on "pikafish-jieqi
 * move timed out" at a budget the same call clears in 4.1s locally, and the logs
 * could not say whether the engine had died or was merely late.
 */
function earlyExitError(
  bin: string,
  code: number | null,
  signal: NodeJS.Signals | null,
  stderrTail: string,
): Error {
  const how = signal !== null ? `was killed by ${signal}` : `exited with code ${code}`;
  const detail = stderrTail === '' ? '' : `; stderr: ${stderrTail}`;
  return new Error(`UCI engine ${basename(bin)} ${how} before returning a result${detail}`);
}

/**
 * What the engine said before it went silent. Every runner used to discard the
 * child's output on a hard timeout and reject with the bare timeout message, so
 * an alert could not say whether the engine ever reached `readyok` (a start-up
 * stall: process spawn, hash allocation) or was deep in a search that would not
 * stop (a search overrun). Prod, 2026-09-02 and 2026-09-03: the jieqi bot
 * resigned eight games on "pikafish-jieqi move timed out" and nothing in the
 * logs could separate those two, which is the difference between fixing the
 * spawn path and fixing the search. The trace rides on the timeout error now.
 *
 * `spawn` traces cover a whole one-shot process (handshake + search); `request`
 * traces cover one `position` + `go` round-trip on a warm session, where the
 * handshake happened earlier and is reported separately.
 */
export class UciOutputTrace {
  private readonly startedAt = Date.now();
  private uciokMs: number | null = null;
  private readyokMs: number | null = null;
  private infoLines = 0;
  private lastInfo: { depth: number; timeMs: number | null } | null = null;
  private lastLine: string | null = null;

  constructor(private readonly phase: 'spawn' | 'request') {}

  note(line: string): void {
    if (line === '') return;
    this.lastLine = line;
    const elapsed = Date.now() - this.startedAt;
    if (line === 'uciok') {
      this.uciokMs ??= elapsed;
    } else if (line === 'readyok') {
      this.readyokMs ??= elapsed;
    } else if (line.startsWith('info ')) {
      this.infoLines += 1;
      const depth = line.match(/ depth (\d+)/);
      if (depth) {
        const time = line.match(/ time (\d+)/);
        this.lastInfo = { depth: Number(depth[1]), timeMs: time ? Number(time[1]) : null };
      }
    }
  }

  describe(): string {
    if (this.lastLine === null) return 'no output';
    const parts: string[] = [];
    if (this.phase === 'spawn') {
      parts.push(this.uciokMs === null ? 'no uciok' : `uciok@${this.uciokMs}ms`);
      parts.push(this.readyokMs === null ? 'no readyok' : `readyok@${this.readyokMs}ms`);
    }
    parts.push(`${this.infoLines} info line(s)`);
    if (this.lastInfo) {
      const at = this.lastInfo.timeMs === null ? '' : ` at ${this.lastInfo.timeMs}ms`;
      parts.push(`last depth ${this.lastInfo.depth}${at}`);
    }
    const tail = this.lastLine.length > 80 ? `${this.lastLine.slice(0, 77)}...` : this.lastLine;
    parts.push(`last line "${tail}"`);
    return parts.join(', ');
  }
}

function timeoutError(
  message: string,
  timeoutMs: number,
  trace: UciOutputTrace,
  extra: string,
): Error {
  const detail = extra === '' ? '' : `; ${extra}`;
  return new Error(`${message} after ${timeoutMs}ms: ${trace.describe()}${detail}`);
}

function stderrDetail(tail: string): string {
  return tail === '' ? '' : `stderr: ${tail}`;
}

export type RunUciBestmoveArgs = {
  /** Absolute path to the engine binary. */
  bin: string;
  /** UCI command block written to stdin (joined by newlines, trailing newline added). */
  commands: readonly string[];
  /** Hard timeout in ms; on expiry the child is SIGKILLed and the promise rejects. */
  timeoutMs: number;
  /** Error message used when the move times out. */
  timeoutMessage: string;
  /** Extra env vars merged over the parent env for the spawned process (e.g. a seed). */
  env?: Readonly<Record<string, string>>;
};

/**
 * Spawn a UCI engine, send `commands`, and resolve with its `bestmove` (or `null`
 * when there is no move). The child is always SIGKILLed and the timeout cleared on
 * the first of: bestmove parsed, spawn error, or timeout — so no subprocess or
 * timer leaks. One process per call (stateless, robust); callers gate concurrency
 * through a `UciEnginePool`.
 */
export function runUciBestmove(args: RunUciBestmoveArgs): Promise<string | null> {
  const { bin, commands, timeoutMs, timeoutMessage, env } = args;
  return new Promise<string | null>((resolveMove, reject) => {
    const child = spawn(bin, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      ...(env ? { env: { ...process.env, ...env } } : {}),
    });
    const trace = new UciOutputTrace('spawn');
    let buf = '';
    let settled = false;
    const advertisedOptions = new Set<string>();

    const finish = (run: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
      run();
    };

    const readStderrTail = captureStderrTail(child);
    const timer = setTimeout(
      () =>
        finish(() =>
          reject(timeoutError(timeoutMessage, timeoutMs, trace, stderrDetail(readStderrTail()))),
        ),
      timeoutMs,
    );
    child.on('error', (err) => finish(() => reject(err)));
    const consume = (): void => {
      let newline = buf.indexOf('\n');
      while (newline >= 0) {
        const line = buf.slice(0, newline).trim();
        buf = buf.slice(newline + 1);
        trace.note(line);
        const option = parseUciOptionLine(line);
        if (option) advertisedOptions.add(option);
        const protocolError = uciProtocolError(line);
        if (protocolError) {
          finish(() => reject(new Error(`UCI engine rejected command: ${protocolError}`)));
          return;
        }
        const parsed = parseBestmoveLine(line);
        if (parsed !== undefined) {
          finish(() => {
            try {
              validateConfiguredUciOptions(commands, advertisedOptions);
              resolveMove(parsed);
            } catch (err) {
              reject(err);
            }
          });
          return;
        }
        newline = buf.indexOf('\n');
      }
    };
    child.stdout.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      consume();
    });
    child.on('close', (code, signal) => {
      if (settled) return;
      // A final line missing its newline is still a result; flush it before
      // calling this a crash.
      if (buf.trim() !== '') {
        buf += '\n';
        consume();
      }
      finish(() => reject(earlyExitError(bin, code, signal, readStderrTail())));
    });

    child.stdin.write(`${commands.join('\n')}\n`);
  });
}

/**
 * Parse a UCI `info … score …` line into the fields postgame analysis needs.
 * Returns undefined for non-info or score-less lines (e.g. `info string …`). The
 * score is from the side-to-move POV, exactly as the engine reports it. `pv` is
 * the principal variation's moves (engine UCI), empty when the line carries none.
 */
export function parseInfoScore(line: string):
  | {
      depth: number;
      cp: number | null;
      mate: number | null;
      pv: string[];
      nodes: number | null;
      timeMs: number | null;
      /**
       * Set when the engine flagged the score as a fail-high/fail-low bound
       * (`score cp -34 lowerbound`). Such a line is an ABORTED iteration, not a
       * result: the score is only a bound and the pv is usually one move. The
       * last line before `bestmove` is very often one of these, because the node
       * budget expires mid-iteration. Consumers must prefer the last EXACT line.
       */
      bound: 'lower' | 'upper' | null;
    }
  | undefined {
  if (!line.startsWith('info ') || !line.includes(' score ')) return undefined;
  const tokens = line.split(/\s+/);
  let depth = 0;
  let cp: number | null = null;
  let mate: number | null = null;
  let pv: string[] = [];
  // `nodes`/`time` power the search-truncation telemetry (banqi-engine): a move that
  // reports far fewer than its node budget, or a `time` at the movetime cap, was cut short.
  let nodes: number | null = null;
  let timeMs: number | null = null;
  let bound: 'lower' | 'upper' | null = null;
  for (let i = 1; i < tokens.length; i += 1) {
    if (tokens[i] === 'depth') depth = Number(tokens[i + 1]);
    else if (tokens[i] === 'nodes') nodes = Number(tokens[i + 1]);
    else if (tokens[i] === 'time') timeMs = Number(tokens[i + 1]);
    else if (tokens[i] === 'lowerbound') bound = 'lower';
    else if (tokens[i] === 'upperbound') bound = 'upper';
    else if (tokens[i] === 'score') {
      if (tokens[i + 1] === 'cp') cp = Number(tokens[i + 2]);
      else if (tokens[i + 1] === 'mate') mate = Number(tokens[i + 2]);
    } else if (tokens[i] === 'pv') {
      pv = tokens.slice(i + 1); // the pv is the rest of the line (nodes/time precede it)
      break;
    }
  }
  return { depth, cp, mate, pv, nodes, timeMs, bound };
}

export type UciEval = {
  /** Best move in engine UCI, or null when the engine reports none. */
  best: string | null;
  /** Centipawns (side-to-move POV); null when a mate score is present. */
  cp: number | null;
  /** Signed moves-to-mate (side-to-move POV); null otherwise. */
  mate: number | null;
  /** Depth of the last scored line seen before bestmove. */
  depth: number;
  /** Principal variation of the last scored line (engine UCI); absent/empty when
   *  the engine emitted none. Feeds inline best-play lines in postgame analysis. */
  pv?: string[];
  /** Nodes searched, from the last scored info line; absent when the engine emits none.
   *  Powers search-truncation telemetry (a move well under its node budget was cut short). */
  nodes?: number;
  /** Search time (ms) from the last scored info line; absent when the engine emits none. */
  timeMs?: number;
};

/**
 * Like runUciBestmove, but also keeps the last `info … score` line so the caller
 * gets the position's evaluation (for postgame analysis), not just the move. Same
 * spawn / hard-timeout / SIGKILL-cleanup contract.
 */
export function runUciEval(args: RunUciBestmoveArgs): Promise<UciEval> {
  const { bin, commands, timeoutMs, timeoutMessage, env } = args;
  return new Promise<UciEval>((resolveEval, reject) => {
    // `env` is honoured here exactly as in runUciBestmove. It was silently
    // dropped until 2026-09-05, which mattered the moment the Flip Jungle live
    // move switched to this runner to record its search: its per-game tie-break
    // seed travels in JF_TIE_SEED, and losing it would have made the opening
    // flip identical in every game rather than merely reproducible per room.
    const child = spawn(bin, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      ...(env ? { env: { ...process.env, ...env } } : {}),
    });
    const trace = new UciOutputTrace('spawn');
    let buf = '';
    let settled = false;
    let latest: ReturnType<typeof parseInfoScore> | null = null;
    // Only used when the whole search produced nothing but bounded lines.
    let fallback: ReturnType<typeof parseInfoScore> | null = null;
    const advertisedOptions = new Set<string>();

    const finish = (run: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
      run();
    };

    const readStderrTail = captureStderrTail(child);
    const timer = setTimeout(
      () =>
        finish(() =>
          reject(timeoutError(timeoutMessage, timeoutMs, trace, stderrDetail(readStderrTail()))),
        ),
      timeoutMs,
    );
    child.on('error', (err) => finish(() => reject(err)));
    const consume = (): void => {
      let newline = buf.indexOf('\n');
      while (newline >= 0) {
        const line = buf.slice(0, newline).trim();
        buf = buf.slice(newline + 1);
        trace.note(line);
        const option = parseUciOptionLine(line);
        if (option) advertisedOptions.add(option);
        const protocolError = uciProtocolError(line);
        if (protocolError) {
          finish(() => reject(new Error(`UCI engine rejected command: ${protocolError}`)));
          return;
        }
        const score = parseInfoScore(line);
        // A bounded line is an aborted iteration; keep it only as a last resort.
        if (score) {
          if (score.bound === null) latest = score;
          else if (latest === null) fallback = score;
        }
        const move = parseBestmoveLine(line);
        if (move !== undefined) {
          finish(() => {
            try {
              validateConfiguredUciOptions(commands, advertisedOptions);
              const chosen = latest ?? fallback;
              resolveEval({
                best: move,
                cp: chosen?.cp ?? null,
                mate: chosen?.mate ?? null,
                depth: chosen?.depth ?? 0,
                pv: chosen?.pv,
                nodes: chosen?.nodes ?? undefined,
                timeMs: chosen?.timeMs ?? undefined,
              });
            } catch (err) {
              reject(err);
            }
          });
          return;
        }
        newline = buf.indexOf('\n');
      }
    };
    child.stdout.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      consume();
    });
    child.on('close', (code, signal) => {
      if (settled) return;
      // A final line missing its newline is still a result; flush it before
      // calling this a crash.
      if (buf.trim() !== '') {
        buf += '\n';
        consume();
      }
      finish(() => reject(earlyExitError(bin, code, signal, readStderrTail())));
    });

    child.stdin.write(`${commands.join('\n')}\n`);
  });
}

/**
 * Parse a UCI `info … multipv K … score … pv <move> …` line into a ranked table row.
 * Returns undefined for non-info, score-less, or pv-less lines. The score is from the
 * side-to-move POV, exactly as the engine reports it. `index` is the 1-based MultiPV rank.
 */
export function parseInfoMultiPv(line: string): UciMultiPvLine | undefined {
  if (!line.startsWith('info ') || !line.includes(' multipv ') || !line.includes(' score ')) {
    return undefined;
  }
  const tokens = line.split(/\s+/);
  let index = 0;
  let depth = 0;
  let cp: number | null = null;
  let mate: number | null = null;
  let move: string | null = null;
  let pv: string[] = [];
  let bound: 'lower' | 'upper' | null = null;
  for (let i = 1; i < tokens.length; i += 1) {
    if (tokens[i] === 'multipv') index = Number(tokens[i + 1]);
    else if (tokens[i] === 'depth') depth = Number(tokens[i + 1]);
    else if (tokens[i] === 'lowerbound') bound = 'lower';
    else if (tokens[i] === 'upperbound') bound = 'upper';
    else if (tokens[i] === 'score') {
      if (tokens[i + 1] === 'cp') cp = Number(tokens[i + 2]);
      else if (tokens[i + 1] === 'mate') mate = Number(tokens[i + 2]);
    } else if (tokens[i] === 'pv') {
      pv = tokens.slice(i + 1);
      move = pv[0] ?? null;
      break; // the pv is the rest of the line
    }
  }
  if (!index || !move) return undefined;
  return { index, depth, cp, mate, move, pv, bound };
}

export type UciMultiPvLine = {
  /** 1-based MultiPV rank (1 = engine's best). */
  index: number;
  /** Root move (first token of the pv), in engine UCI. */
  move: string;
  /** Centipawns (side-to-move POV); null when a mate score is present. */
  cp: number | null;
  /** Signed moves-to-mate (side-to-move POV); null otherwise. */
  mate: number | null;
  /** Depth this row was last reported at. */
  depth: number;
  /** Full principal variation for this rank (engine UCI), `move` first. */
  pv: string[];
  /**
   * Set when the engine flagged this row as a fail-high/fail-low bound, i.e. an
   * ABORTED iteration rather than a result — same trap as parseInfoScore's
   * `bound`. Consumers must prefer the last EXACT row for a given index.
   * NOTE: `runUciMultiPv` does NOT yet honour this and overwrites per index
   * unconditionally; `UciEngineSession.multiPvPosition` does.
   */
  bound: 'lower' | 'upper' | null;
};

/** A single search reported both ways: rank-1 scalar (same shape as UciEval) plus
 *  the ranked table. See `UciEngineSession.multiPvPosition`. */
export type UciMultiPvEval = {
  best: string | null;
  cp: number | null;
  mate: number | null;
  depth: number;
  pv?: string[];
  /** Ranked rows, index 1 first. Empty when the search reported no scored line. */
  lines: UciMultiPvLine[];
};

/**
 * Like runUciEval, but collects the full MultiPV table: the final-depth `info … multipv …`
 * rows, one per rank, sorted by rank (index 1 = best). Requires the caller to have set
 * `setoption name MultiPV value N` in `commands`. Same spawn / hard-timeout / SIGKILL-cleanup
 * contract as runUciEval. A later (deeper) row for a given index overwrites an earlier one, so
 * the returned table reflects the deepest scores the search reached before `bestmove`.
 */
export function runUciMultiPv(args: RunUciBestmoveArgs): Promise<UciMultiPvLine[]> {
  const { bin, commands, timeoutMs, timeoutMessage } = args;
  return new Promise<UciMultiPvLine[]>((resolveTable, reject) => {
    const child = spawn(bin, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    const trace = new UciOutputTrace('spawn');
    let buf = '';
    let settled = false;
    const table = new Map<number, UciMultiPvLine>();
    const advertisedOptions = new Set<string>();

    const finish = (run: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
      run();
    };

    const readStderrTail = captureStderrTail(child);
    const timer = setTimeout(
      () =>
        finish(() =>
          reject(timeoutError(timeoutMessage, timeoutMs, trace, stderrDetail(readStderrTail()))),
        ),
      timeoutMs,
    );
    child.on('error', (err) => finish(() => reject(err)));
    const consume = (): void => {
      let newline = buf.indexOf('\n');
      while (newline >= 0) {
        const line = buf.slice(0, newline).trim();
        buf = buf.slice(newline + 1);
        trace.note(line);
        const option = parseUciOptionLine(line);
        if (option) advertisedOptions.add(option);
        const protocolError = uciProtocolError(line);
        if (protocolError) {
          finish(() => reject(new Error(`UCI engine rejected command: ${protocolError}`)));
          return;
        }
        const row = parseInfoMultiPv(line);
        if (row) table.set(row.index, row);
        const move = parseBestmoveLine(line);
        if (move !== undefined) {
          finish(() => {
            try {
              validateConfiguredUciOptions(commands, advertisedOptions);
              resolveTable([...table.values()].sort((a, b) => a.index - b.index));
            } catch (err) {
              reject(err);
            }
          });
          return;
        }
        newline = buf.indexOf('\n');
      }
    };
    child.stdout.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      consume();
    });
    child.on('close', (code, signal) => {
      if (settled) return;
      // A final line missing its newline is still a result; flush it before
      // calling this a crash.
      if (buf.trim() !== '') {
        buf += '\n';
        consume();
      }
      finish(() => reject(earlyExitError(bin, code, signal, readStderrTail())));
    });

    child.stdin.write(`${commands.join('\n')}\n`);
  });
}

// ── Persistent UCI session (one process per whole-game analysis sweep) ────────

export type UciEngineSessionConfig = {
  /** Absolute path to the engine binary. */
  bin: string;
  /** Written once at spawn: `uci`, setoptions, `ucinewgame`, `isready`. The session
   *  is ready when the engine answers `readyok`. */
  initCommands: readonly string[];
  /** Timeout for the init handshake in ms (default 15_000). */
  initTimeoutMs?: number;
  /** Error-message prefix for session-level failures. */
  name?: string;
};

type SessionConsumer = {
  onLine(line: string): void;
  reject(err: Error): void;
};

/**
 * A persistent UCI engine subprocess for whole-game analysis sweeps: spawn +
 * option setup + net load happen ONCE, then each position is an incremental
 * `position …` + `go …` round-trip. The per-request spawn model (runUciEval)
 * reloads the NNUE net on every ply, a 2-5x self-inflicted slowdown on sweeps
 * (#168); this session kills that while keeping the same hard-timeout and
 * SIGKILL-cleanup discipline. Requests are serialized internally (UCI engines
 * answer one `go` at a time); callers still gate session concurrency through a
 * UciEnginePool. Always `close()` in a finally.
 */
export class UciEngineSession {
  private readonly child: ReturnType<typeof spawn>;
  private buf = '';
  private closed = false;
  private exitError: Error | null = null;
  private consumer: SessionConsumer | null = null;
  private readonly advertisedOptions = new Set<string>();
  private chain: Promise<unknown> = Promise.resolve();
  private readonly readyPromise: Promise<void>;
  private readonly spawnedAt = Date.now();
  private initDurationMs: number | null = null;

  constructor(private readonly config: UciEngineSessionConfig) {
    this.child = spawn(config.bin, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    const readStderrTail = captureStderrTail(this.child);
    this.child.on('error', (err) => this.fail(err));
    this.child.on('exit', (code, signal) => {
      if (this.closed) return;
      const how = signal !== null ? `was killed by ${signal}` : `exited with code ${code}`;
      const tail = readStderrTail();
      this.fail(new Error(`${this.label()} ${how}${tail === '' ? '' : `; stderr: ${tail}`}`));
    });
    this.child.stdout?.on('data', (chunk: Buffer) => this.onData(chunk));
    this.readyPromise = this.enqueue(() => this.init());
    // Callers await ready() (or their first eval); an unobserved duplicate
    // rejection must not crash the process.
    this.readyPromise.catch(() => {});
  }

  /** Resolves once the engine answered `readyok` and every configured option was
   *  advertised; rejects on spawn failure, protocol error, or init timeout. */
  ready(): Promise<void> {
    return this.readyPromise;
  }

  /** Spawn-to-`readyok` wall time in ms, or null until the handshake completes.
   *  This is the cost a per-move spawn paid on every ply (process start, hash
   *  allocation, net load); a warm session pays it once. */
  get initMs(): number | null {
    return this.initDurationMs;
  }

  /**
   * True once the session has terminally failed — the engine exited, or a search
   * or the init handshake timed out. `fail()` kills the process and can never be
   * undone (mid-search state is unknowable), so a caller that wants to carry on
   * must spawn a NEW session rather than retry on this one.
   *
   * Exposed so a caller can tell a dead engine from a live engine's rejection:
   * the first is worth respawning for, the second is a real error to surface.
   */
  get failed(): boolean {
    return this.exitError !== null;
  }

  /**
   * Evaluate one position: write `positionCommand` + `goCommand`, keep the last
   * `info … score` line, resolve on `bestmove`. Requests are serialized; each has
   * its own hard timeout, after which the session is failed closed (the engine's
   * state is unknown mid-search, so the whole session dies, not just the request).
   */
  evalPosition(args: {
    positionCommand: string;
    goCommand: string;
    timeoutMs: number;
    timeoutMessage: string;
  }): Promise<UciEval> {
    return this.enqueue(async () => {
      await this.readyPromise;
      return await new Promise<UciEval>((resolveEval, reject) => {
        let latest: ReturnType<typeof parseInfoScore> | null = null;
        // Only used when the whole search produced nothing but bounded lines.
        let fallback: ReturnType<typeof parseInfoScore> | null = null;
        const trace = new UciOutputTrace('request');
        const timer = setTimeout(() => {
          const init =
            this.initDurationMs === null ? 'init pending' : `init ${this.initDurationMs}ms`;
          this.fail(timeoutError(args.timeoutMessage, args.timeoutMs, trace, `session ${init}`));
        }, args.timeoutMs);
        timer.unref();
        this.consume({
          onLine: (line) => {
            trace.note(line);
            const score = parseInfoScore(line);
            // A bounded line is an aborted iteration; keep it only as a last resort.
            if (score) {
              if (score.bound === null) latest = score;
              else if (latest === null) fallback = score;
            }
            const move = parseBestmoveLine(line);
            if (move !== undefined) {
              clearTimeout(timer);
              this.consumer = null;
              const chosen = latest ?? fallback;
              resolveEval({
                best: move,
                cp: chosen?.cp ?? null,
                mate: chosen?.mate ?? null,
                depth: chosen?.depth ?? 0,
                pv: chosen?.pv,
                nodes: chosen?.nodes ?? undefined,
                timeMs: chosen?.timeMs ?? undefined,
              });
            }
          },
          reject: (err) => {
            clearTimeout(timer);
            reject(err);
          },
        });
        this.write(`${args.positionCommand}\n${args.goCommand}\n`);
      });
    });
  }

  /**
   * Like `evalPosition`, but ALSO returns the ranked MultiPV table for the same
   * search. The session must have been created with `setoption name MultiPV
   * value N` in its initCommands.
   *
   * Two traps this handles and a naive reader does not:
   *
   * 1. **Bounded rows.** Per index it keeps the last EXACT row and falls back to
   *    a bounded one only if that index never produced an exact line. A
   *    fail-high/fail-low row is an aborted iteration, not a result (see
   *    `parseInfoScore`'s `bound`).
   * 2. **The scalar result must come from rank 1.** With MultiPV > 1 the last
   *    scored `info` line is usually the rank-2 line, so reading "the last
   *    score" silently returns the second-best eval. The scalar fields here are
   *    rank 1's, never rank 2's.
   *
   * Lines with no `multipv` token at all (terminal positions, where the engine
   * reports `score mate 0` and no pv) are treated as rank 1, so a checkmate
   * still scores exactly as it does through `evalPosition`.
   */
  multiPvPosition(args: {
    positionCommand: string;
    goCommand: string;
    timeoutMs: number;
    timeoutMessage: string;
  }): Promise<UciMultiPvEval> {
    return this.enqueue(async () => {
      await this.readyPromise;
      return await new Promise<UciMultiPvEval>((resolveTable, reject) => {
        const exact = new Map<number, UciMultiPvLine>();
        const bounded = new Map<number, UciMultiPvLine>();
        const keep = (row: UciMultiPvLine): void => {
          if (row.bound === null) exact.set(row.index, row);
          else if (!exact.has(row.index)) bounded.set(row.index, row);
        };
        const trace = new UciOutputTrace('request');
        const timer = setTimeout(() => {
          const init =
            this.initDurationMs === null ? 'init pending' : `init ${this.initDurationMs}ms`;
          this.fail(timeoutError(args.timeoutMessage, args.timeoutMs, trace, `session ${init}`));
        }, args.timeoutMs);
        timer.unref();
        this.consume({
          onLine: (line) => {
            trace.note(line);
            const row = parseInfoMultiPv(line);
            if (row) keep(row);
            else if (line.startsWith('info ') && !line.includes(' multipv ')) {
              // No rank on the line: a single-line report (terminal position, or
              // an engine that only emits multipv above rank 1). Treat as rank 1.
              const score = parseInfoScore(line);
              if (score) {
                keep({
                  index: 1,
                  move: score.pv[0] ?? '',
                  cp: score.cp,
                  mate: score.mate,
                  depth: score.depth,
                  pv: score.pv,
                  bound: score.bound,
                });
              }
            }
            const move = parseBestmoveLine(line);
            if (move !== undefined) {
              clearTimeout(timer);
              this.consumer = null;
              const merged = new Map(bounded);
              for (const [index, row] of exact) merged.set(index, row);
              const lines = [...merged.values()].sort((a, b) => a.index - b.index);
              const top = merged.get(1);
              resolveTable({
                best: move,
                cp: top?.cp ?? null,
                mate: top?.mate ?? null,
                depth: top?.depth ?? 0,
                pv: top?.pv,
                lines,
              });
            }
          },
          reject: (err) => {
            clearTimeout(timer);
            reject(err);
          },
        });
        this.write(`${args.positionCommand}\n${args.goCommand}\n`);
      });
    });
  }

  /** SIGKILL the engine and reject any in-flight request. Idempotent. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    const pending = this.consumer;
    this.consumer = null;
    pending?.reject(new Error(`${this.label()} session closed`));
    try {
      this.child.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  }

  /**
   * Stop this idle session from holding the Node event loop open. A warm cache
   * parks sessions between moves; without this, a CLI that made one engine call
   * would never exit, and a test runner would hang on the parked children. The
   * cache calls `ref()` again for the duration of a request so an in-flight
   * search is never abandoned by an exiting process.
   */
  unref(): void {
    this.child.unref();
    for (const stream of [this.child.stdin, this.child.stdout, this.child.stderr]) {
      refStream(stream, 'unref');
    }
  }

  ref(): void {
    this.child.ref();
    for (const stream of [this.child.stdin, this.child.stdout, this.child.stderr]) {
      refStream(stream, 'ref');
    }
  }

  private label(): string {
    return this.config.name ?? 'uci-engine-session';
  }

  // Serialize public operations: a UCI engine answers one command block at a time.
  private enqueue<T>(op: () => Promise<T>): Promise<T> {
    const next = this.chain.then(op, op);
    this.chain = next.catch(() => {});
    return next;
  }

  private init(): Promise<void> {
    return new Promise<void>((resolveInit, reject) => {
      if (this.exitError) {
        reject(this.exitError);
        return;
      }
      const initTimeoutMs = this.config.initTimeoutMs ?? 15_000;
      const trace = new UciOutputTrace('spawn');
      const timer = setTimeout(() => {
        this.fail(timeoutError(`${this.label()} init timed out`, initTimeoutMs, trace, ''));
      }, initTimeoutMs);
      timer.unref();
      this.consume({
        onLine: (line) => {
          trace.note(line);
          if (line === 'readyok') {
            clearTimeout(timer);
            this.initDurationMs = Date.now() - this.spawnedAt;
            this.consumer = null;
            const unsupported = configuredUciOptionNames(this.config.initCommands).filter(
              (option) => !this.advertisedOptions.has(option),
            );
            if (unsupported.length > 0) {
              this.fail(
                new Error(
                  `UCI engine does not advertise configured option(s): ${unsupported.join(', ')}`,
                ),
              );
              reject(this.exitError ?? new Error('unsupported options'));
              return;
            }
            resolveInit();
          }
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      this.write(`${this.config.initCommands.join('\n')}\n`);
    });
  }

  private consume(consumer: SessionConsumer): void {
    if (this.exitError) {
      consumer.reject(this.exitError);
      return;
    }
    // A plain close() sets closed without an exitError. Requests registered
    // after it must reject NOW: the child is dead (its guarded exit handler
    // will not fire fail()), write() is a no-op, and the request timeout is
    // unref'd, so nothing else would ever settle the promise once the event
    // loop drains (CI: cancelledByParent).
    if (this.closed) {
      consumer.reject(new Error(`${this.label()} session closed`));
      return;
    }
    this.consumer = consumer;
  }

  private write(payload: string): void {
    if (this.closed) return;
    try {
      this.child.stdin?.write(payload);
    } catch (err) {
      this.fail(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private onData(chunk: Buffer): void {
    this.buf += chunk.toString('utf8');
    let newline = this.buf.indexOf('\n');
    while (newline >= 0) {
      const line = this.buf.slice(0, newline).trim();
      this.buf = this.buf.slice(newline + 1);
      const option = parseUciOptionLine(line);
      if (option) this.advertisedOptions.add(option);
      const protocolError = uciProtocolError(line);
      if (protocolError) {
        this.fail(new Error(`UCI engine rejected command: ${protocolError}`));
        return;
      }
      this.consumer?.onLine(line);
      newline = this.buf.indexOf('\n');
    }
  }

  // Terminal failure: kill the process and reject the in-flight consumer. The
  // session cannot be reused after this (mid-search state is unknowable).
  private fail(err: Error): void {
    if (this.exitError) return;
    this.exitError = err;
    const pending = this.consumer;
    this.consumer = null;
    this.closed = true;
    try {
      this.child.kill('SIGKILL');
    } catch {
      /* already gone */
    }
    pending?.reject(err);
  }
}

// A child's stdio pipes are net.Socket instances at runtime (they carry ref/unref)
// but are typed as plain streams; a pipe that is not unref'd keeps the event loop
// alive even when the ChildProcess handle itself is unref'd.
function refStream(stream: unknown, method: 'ref' | 'unref'): void {
  const fn = (stream as { [key in typeof method]?: () => void } | null | undefined)?.[method];
  if (typeof fn === 'function') fn.call(stream);
}

// ── Warm session cache (live PvE moves without a spawn per move) ─────────────

export type WarmSessionSpec = {
  /** Absolute path to the engine binary. */
  bin: string;
  /** `uci` … `isready` block written once at spawn; part of the cache key, so
   *  sessions never mix tiers (different Skill Level / Hash / net). */
  initCommands: readonly string[];
  /** Error-message prefix for session-level failures. */
  name?: string;
  initTimeoutMs?: number;
};

export type UciWarmSessionCacheStats = {
  name: string;
  idle: number;
  keys: number;
  spawned: number;
  reused: number;
  discarded: number;
};

/**
 * Keeps engine processes warm between live moves. The one-shot runners spawn a
 * fresh process per request, which was fine while startup was ~0.2 s; the FSF
 * build the xiangqi ladder moved to on 2026-09-02 takes ~4.3 s to start on prod
 * before it reads its first command (measured in the container: `printf quit |
 * binary`), and Pikafish reloads a 40 MB net per spawn (~2.8 s). Both were
 * charged to the bot's clock on every move. A parked session answers a request
 * with just `position` + `go`.
 *
 * Contract: a session is exclusive while lent out (UCI engines answer one `go`
 * at a time); callers still gate concurrency through their UciEnginePool, so
 * the number of live sessions per key never exceeds the pool's slots. A session
 * whose request failed (timeout, crash, protocol error) is DISCARDED, never
 * reused: `UciEngineSession.fail()` already killed it and its state is unknown.
 * Idle sessions are `unref()`d so they never hold the process open, and are
 * closed after `idleTtlMs` so a rung nobody plays does not keep 100 MB of hash
 * and net resident forever.
 */
export class UciWarmSessionCache {
  private readonly idle = new Map<string, Array<{ session: UciEngineSession; since: number }>>();
  private readonly sweeper: ReturnType<typeof setInterval>;
  private spawned = 0;
  private reused = 0;
  private discarded = 0;

  constructor(
    private readonly config: {
      name: string;
      /** Close a parked session this long after its last request. Default 10 min. */
      idleTtlMs?: number;
      /** Parked sessions kept per key beyond which the oldest is closed. Default 2. */
      maxIdlePerKey?: number;
    },
  ) {
    const ttl = config.idleTtlMs ?? 10 * 60_000;
    this.sweeper = setInterval(() => this.sweep(), Math.max(1_000, Math.min(60_000, ttl / 2)));
    this.sweeper.unref();
  }

  /**
   * Run `fn` with a warm session for `spec` (spawning one if none is parked),
   * then park it again, or discard it if it failed. Any rejection from `fn`
   * discards the session: a request that threw left the engine mid-search or
   * dead, and neither state is safe to hand to the next move.
   */
  async withSession<T>(spec: WarmSessionSpec, fn: (session: UciEngineSession) => Promise<T>) {
    const key = `${spec.bin}\n${spec.initCommands.join('\n')}`;
    const parked = this.idle.get(key)?.shift();
    let session: UciEngineSession;
    if (parked && !parked.session.failed) {
      session = parked.session;
      session.ref();
      this.reused += 1;
    } else {
      if (parked) this.discard(parked.session);
      session = new UciEngineSession({
        bin: spec.bin,
        initCommands: spec.initCommands,
        name: spec.name ?? this.config.name,
        ...(spec.initTimeoutMs === undefined ? {} : { initTimeoutMs: spec.initTimeoutMs }),
      });
      this.spawned += 1;
    }
    let result: T;
    try {
      result = await fn(session);
    } catch (err) {
      this.discard(session);
      throw err;
    }
    if (session.failed) {
      this.discard(session);
    } else {
      session.unref();
      const list = this.idle.get(key) ?? [];
      list.push({ session, since: Date.now() });
      this.idle.set(key, list);
      const cap = this.config.maxIdlePerKey ?? 2;
      while (list.length > cap) this.discard(list.shift()!.session);
    }
    return result;
  }

  stats(): UciWarmSessionCacheStats {
    let idle = 0;
    for (const list of this.idle.values()) idle += list.length;
    return {
      name: this.config.name,
      idle,
      keys: this.idle.size,
      spawned: this.spawned,
      reused: this.reused,
      discarded: this.discarded,
    };
  }

  /** Close every parked session (shutdown, tests). Lent-out sessions are the
   *  borrower's to finish; they are discarded on return if the cache is gone. */
  closeAll(): void {
    for (const list of this.idle.values()) for (const entry of list) this.discard(entry.session);
    this.idle.clear();
    clearInterval(this.sweeper);
  }

  private discard(session: UciEngineSession): void {
    this.discarded += 1;
    session.close();
  }

  private sweep(): void {
    const ttl = this.config.idleTtlMs ?? 10 * 60_000;
    const cutoff = Date.now() - ttl;
    for (const [key, list] of this.idle) {
      const keep = list.filter((entry) => {
        if (entry.since >= cutoff && !entry.session.failed) return true;
        this.discard(entry.session);
        return false;
      });
      if (keep.length === 0) this.idle.delete(key);
      else this.idle.set(key, keep);
    }
  }
}

// ── Fairy-Stockfish layer (the perfect-info xiangqi providers) ───────────────

// Resolve the FSF binary: explicit env override, else the known dev location, else
// the Railway/railpack + system install locations. Throws (never silently falls
// back to a first-legal move) when nothing resolves.
export function fairyStockfishPath(): string {
  const explicit = process.env.MISTBOARD_FSF_PATH;
  if (explicit) {
    const resolved = resolve(explicit);
    if (!existsSync(resolved)) {
      throw new Error(`MISTBOARD_FSF_PATH points at ${resolved} but the binary does not exist`);
    }
    return resolved;
  }
  const home = process.env.HOME;
  if (home) {
    const dev = resolve(home, 'projects', 'tools', 'fairy-stockfish', 'src', 'stockfish');
    if (existsSync(dev)) return dev;
  }
  for (const candidate of [
    resolve(process.cwd(), 'bin', 'fairy-stockfish'),
    // Railway/railpack install location — resolved regardless of cwd so the
    // engine never silently falls back to a first-legal move in prod.
    '/app/bin/fairy-stockfish',
    '/usr/local/bin/fairy-stockfish',
    '/usr/bin/fairy-stockfish',
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error('Fairy-Stockfish binary not found. Set MISTBOARD_FSF_PATH.');
}

// Custom variant .ini files live in src/; tsc does not copy them to dist/, so look
// in both the tsx-dev (src) and built (dist -> ../src) locations. Callers that use a
// built-in FSF variant (e.g. `minixiangqi`) pass no ini path at all.
export function resolveFsfVariantIniPath(filename: string): string {
  const candidates = [resolve(HERE, filename), resolve(HERE, '..', 'src', filename)];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`${filename} not found (looked in ${candidates.join(', ')})`);
}

export type FairyStockfishMoveRequest = {
  /** UCI move history from the start position (`position startpos moves ...`). */
  moves: readonly string[];
  /** UCI_Variant name (built-in like `minixiangqi`, or custom from `iniPath`). */
  variant: string;
  /** Custom variants.ini path (VariantPath); omit for built-in variants. */
  iniPath?: string;
  /** Skill Level -20..20 (clamped); omit for full strength. */
  skill?: number;
  /** Search depth cap for `go`; used with Skill Level by Lichess/PlayStrategy. */
  depth?: number;
  /** Node budget for `go`; omit to bound by movetime only. */
  nodes?: number;
  /** Movetime cap in ms for `go`; also sets the hard timeout (movetime + 4000). */
  movetimeMs: number;
  /**
   * Evaluation selection. Omitted: the engine default (classical on a build with
   * no embedded net). `{ evalFile }`: load that NNUE net and turn `Use NNUE` on
   * explicitly, so a build that happens to embed a default net cannot silently
   * substitute it. `'classical'`: turn `Use NNUE` off explicitly, for tiers whose
   * calibration was done against the hand-written eval and must not drift when
   * the binary underneath them gains a net.
   */
  eval?: { evalFile: string } | 'classical';
  /** `Threads` option; omit for the engine default (1). */
  threads?: number;
  /** `Hash` option in MB; omit for the engine default (16). */
  hashMb?: number;
  /** Binary to run; omit for the shared `fairyStockfishPath()` resolution. */
  bin?: string;
};

/**
 * Assemble the FSF UCI command block for one move request. Pure (no spawn), so the
 * option ordering / go-limit wiring is unit-testable. `skill`/`nodes` are clamped
 * exactly as the per-variant providers did before extraction.
 */
export function buildFairyStockfishCommands(req: FairyStockfishMoveRequest): string[] {
  const { init, position, go } = splitFairyStockfishCommands(req);
  return [...init, position, go];
}

/**
 * The same block split for a warm session: `init` is written once at spawn
 * (`uci` … `isready`), `position` + `go` per request. The two builders share one
 * body so the per-request path can never drift from the one-shot path.
 */
export function splitFairyStockfishCommands(req: FairyStockfishMoveRequest): {
  init: string[];
  position: string;
  go: string;
} {
  const skill = req.skill === undefined ? null : Math.max(-20, Math.min(20, Math.floor(req.skill)));
  const nodes = req.nodes === undefined ? null : Math.max(1, Math.floor(req.nodes));
  const depth = req.depth === undefined ? null : Math.max(1, Math.floor(req.depth));
  const threads = req.threads === undefined ? null : Math.max(1, Math.floor(req.threads));
  const hashMb = req.hashMb === undefined ? null : Math.max(1, Math.floor(req.hashMb));
  const position =
    req.moves.length > 0 ? `position startpos moves ${req.moves.join(' ')}` : 'position startpos';
  // `go [nodes N] movetime M` stops at whichever limit is reached first: nodes pin
  // strength CPU-independently, movetime guards wall-clock on a slow vCPU.
  const goLimits = [
    ...(nodes === null ? [] : [`nodes ${nodes}`]),
    ...(depth === null ? [] : [`depth ${depth}`]),
    `movetime ${req.movetimeMs}`,
  ].join(' ');
  // Eval options come before UCI_Variant: FSF (re)loads the net when the variant
  // is set, and a net built for another variant is refused right there, which is
  // the loud failure we want rather than a silent classical fallback.
  const evalOptions =
    req.eval === undefined
      ? []
      : req.eval === 'classical'
        ? ['setoption name Use NNUE value false']
        : [
            'setoption name Use NNUE value true',
            `setoption name EvalFile value ${req.eval.evalFile}`,
          ];
  return {
    init: [
      'uci',
      ...(threads === null ? [] : [`setoption name Threads value ${threads}`]),
      ...(hashMb === null ? [] : [`setoption name Hash value ${hashMb}`]),
      ...evalOptions,
      ...(req.iniPath ? [`setoption name VariantPath value ${req.iniPath}`] : []),
      `setoption name UCI_Variant value ${req.variant}`,
      ...(skill === null ? [] : [`setoption name Skill Level value ${skill}`]),
      'ucinewgame',
      'isready',
    ],
    position,
    go: `go ${goLimits}`,
  };
}

/**
 * Ask Fairy-Stockfish for a move. Resolves the binary, assembles the command block,
 * and runs it through the shared subprocess harness. Returns the UCI move or null
 * (no move / game over). Callers MUST pre-validate each move string in `moves` — it
 * is written to the engine's stdin.
 */
export function fairyStockfishBestmove(req: FairyStockfishMoveRequest): Promise<string | null> {
  return runUciBestmove({
    bin: req.bin ?? fairyStockfishPath(),
    commands: buildFairyStockfishCommands(req),
    timeoutMs: req.movetimeMs + 4000,
    timeoutMessage: 'fsf move timed out',
  });
}

/**
 * Like fairyStockfishBestmove, but keeps the search's last exact `info` line so the
 * caller can persist what the engine actually did (depth reached, nodes, time,
 * score) next to the move it played. Live xiangqi PvE records this per move: until
 * 2026-09-02 the bot persisted nothing, so "how deep did Level 8 really search on
 * prod" had no answer short of an offline replay.
 */
export function fairyStockfishEval(req: FairyStockfishMoveRequest): Promise<UciEval> {
  return runUciEval({
    bin: req.bin ?? fairyStockfishPath(),
    commands: buildFairyStockfishCommands(req),
    timeoutMs: req.movetimeMs + 4000,
    timeoutMessage: 'fsf move timed out',
  });
}
