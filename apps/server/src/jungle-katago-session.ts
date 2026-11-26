// One warm KataGo-AnimalChess GTP process, shared by every jungle game.
//
// Loading the net is most of a short move (~0.5 s on this Mac, ~1.65 s on prod),
// so a process per move ran the 1+1 seat out of its clock. This keeps one
// process loaded and hands it one search at a time: requests queue FIFO, each
// with its own deadline, the way the warm UCI session does
// (uci-engine-harness.ts UciEngineSession / UciWarmSessionCache).
//
// - A request that passes its deadline, a garbled reply or a process that dies
//   kills the process and rejects that one request; the next queued request
//   spawns a fresh process and is served by it.
// - A request that waits in the queue past the queue timeout is rejected without
//   touching the process.
// - With nothing queued for `idleMs` (10 min) the process exits, and the next
//   request (or a prewarm) starts it again. While idle it is parked with the
//   total engine-process cap, which may evict it for another engine.
// - The session carries no game state: every move request clears the board and
//   the search cache and sets the full position (jungle-katago-engine.ts builds
//   it), so nothing from another game reaches a search.
//
// Timers are unref'd; the child holds the event loop only while a request is in
// flight.

import { spawn } from 'node:child_process';
import { logger } from './obs.js';
import { parkEngineProcess, unparkEngineProcess, withEngineProcess } from './uci-engine-harness.js';

/** One GTP child as the session sees it. */
export type KatagoGtpProcess = {
  write(text: string): void;
  /** SIGKILL; idempotent. */
  kill(): void;
  /** Hold the event loop open only while a request is in flight. */
  setActive(active: boolean): void;
};

export type KatagoGtpHandlers = {
  onData(chunk: string): void;
  onExit(reason: string): void;
};

export type KatagoGtpSpawner = (handlers: KatagoGtpHandlers) => Promise<KatagoGtpProcess>;

export type KatagoSessionTimers = {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};

const realTimers: KatagoSessionTimers = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => {
    const timer = setTimeout(fn, ms);
    timer.unref();
    return timer;
  },
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

/** What a request learns when its turn comes: whether the process was already
 *  loaded, and how long it waited (queue plus any process start). */
export type KatagoRequestStart = { warm: boolean; waitedMs: number };
/** The commands to send and how long the process may take to answer them all. */
export type KatagoRequestPlan = { commands: readonly string[]; deadlineMs: number };
export type KatagoRequestResult = {
  /** One reply per command, as the engine wrote it ("= G1", "= ", "? ..."). */
  replies: string[];
  warm: boolean;
  waitedMs: number;
  /** Enqueue to last reply. */
  totalMs: number;
};

export type KatagoJungleSessionOptions = {
  spawner: KatagoGtpSpawner;
  /** Close the process after this long with nothing to do. */
  idleMs?: number;
  /** Spawn and net load, until the engine answers its first command. */
  startTimeoutMs?: number;
  /** Longest a request may wait for its turn; read per request. */
  queueTimeoutMs?: () => number;
  timers?: KatagoSessionTimers;
};

export const KATAGO_SESSION_IDLE_MS = 10 * 60_000;
export const KATAGO_SESSION_START_TIMEOUT_MS = 10_000;

type Entry = {
  readonly plan: (start: KatagoRequestStart) => KatagoRequestPlan;
  readonly enqueuedAt: number;
  queueTimer: unknown;
  resolve(result: KatagoRequestResult): void;
  reject(error: Error): void;
};

type Waiter = {
  readonly expected: number;
  readonly replies: string[];
  resolve(replies: string[]): void;
  reject(error: Error): void;
};

export type KatagoJungleSessionStats = {
  running: boolean;
  busy: boolean;
  queued: number;
  spawns: number;
  requests: number;
  kills: number;
};

export class KatagoJungleSession {
  private proc: KatagoGtpProcess | null = null;
  private buffer = '';
  private waiter: Waiter | null = null;
  private readonly queue: Entry[] = [];
  private busy = false;
  private idleTimer: unknown = null;
  private closed = false;
  private readonly timers: KatagoSessionTimers;
  private readonly idleMs: number;
  private readonly startTimeoutMs: number;
  private readonly queueTimeoutMs: () => number;
  /** Processes started, requests answered, processes killed for a failure. */
  private spawns = 0;
  private requests = 0;
  private kills = 0;

  constructor(private readonly options: KatagoJungleSessionOptions) {
    this.timers = options.timers ?? realTimers;
    this.idleMs = options.idleMs ?? KATAGO_SESSION_IDLE_MS;
    this.startTimeoutMs = options.startTimeoutMs ?? KATAGO_SESSION_START_TIMEOUT_MS;
    this.queueTimeoutMs = options.queueTimeoutMs ?? (() => 30_000);
  }

  /** True while a loaded process is up, so the next request pays no start. */
  get warm(): boolean {
    return this.proc !== null;
  }

  stats(): KatagoJungleSessionStats {
    return {
      running: this.proc !== null,
      busy: this.busy,
      queued: this.queue.length,
      spawns: this.spawns,
      requests: this.requests,
      kills: this.kills,
    };
  }

  /**
   * Queue one exchange. `plan` runs when the request reaches the process, so a
   * move can size its search to the time left after its wait.
   */
  request(plan: (start: KatagoRequestStart) => KatagoRequestPlan): Promise<KatagoRequestResult> {
    if (this.closed) return Promise.reject(new Error('KataGo jungle session closed'));
    this.cancelIdle();
    return new Promise<KatagoRequestResult>((resolve, reject) => {
      const entry: Entry = {
        plan,
        enqueuedAt: this.timers.now(),
        queueTimer: null,
        resolve,
        reject,
      };
      entry.queueTimer = this.timers.setTimeout(() => {
        const index = this.queue.indexOf(entry);
        if (index < 0) return;
        this.queue.splice(index, 1);
        logger.warn({ kind: 'katago_jungle_queue_timeout', queued: this.queue.length });
        reject(new Error('KataGo jungle queue timed out'));
      }, this.queueTimeoutMs());
      this.queue.push(entry);
      this.pump();
    });
  }

  /**
   * Start the process now if nothing is running or queued, so the first move of
   * a game does not pay the net load. Resolves once the engine answers.
   */
  prewarm(): Promise<void> {
    if (this.closed || this.proc || this.busy || this.queue.length > 0) return Promise.resolve();
    return this.request(() => ({ commands: [], deadlineMs: 0 })).then(() => undefined);
  }

  /** Kill the process and reject everything queued or in flight (shutdown, tests). */
  close(reason = 'closed'): void {
    this.closed = true;
    for (const entry of this.queue.splice(0)) {
      this.timers.clearTimeout(entry.queueTimer);
      entry.reject(new Error(`KataGo jungle session ${reason}`));
    }
    this.drop(reason);
  }

  private pump(): void {
    if (this.busy || this.closed) return;
    const entry = this.queue.shift();
    if (!entry) {
      this.scheduleIdle();
      return;
    }
    this.timers.clearTimeout(entry.queueTimer);
    this.busy = true;
    void this.run(entry).finally(() => {
      this.busy = false;
      this.pump();
    });
  }

  private async run(entry: Entry): Promise<void> {
    try {
      const warm = this.proc !== null;
      if (!warm) await this.start();
      const waitedMs = this.timers.now() - entry.enqueuedAt;
      const plan = entry.plan({ warm, waitedMs });
      const replies =
        plan.commands.length > 0 ? await this.send(plan.commands, plan.deadlineMs) : [];
      this.requests += 1;
      entry.resolve({ replies, warm, waitedMs, totalMs: this.timers.now() - entry.enqueuedAt });
    } catch (err) {
      entry.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private async start(): Promise<void> {
    this.spawns += 1;
    let proc: KatagoGtpProcess | null = null;
    const spawned = await this.options.spawner({
      onData: (chunk) => {
        if (proc && this.proc === proc) this.onData(chunk);
      },
      onExit: (reason) => {
        if (proc && this.proc === proc) this.drop(`exited (${reason})`);
      },
    });
    if (this.closed) {
      spawned.kill();
      throw new Error('KataGo jungle session closed');
    }
    proc = spawned;
    this.proc = proc;
    this.buffer = '';
    // The GTP loop answers only once the net is loaded.
    await this.send(['name'], this.startTimeoutMs);
  }

  private send(commands: readonly string[], timeoutMs: number): Promise<string[]> {
    const proc = this.proc;
    if (!proc) return Promise.reject(new Error('KataGo jungle process is not running'));
    return new Promise<string[]>((resolve, reject) => {
      const timer = this.timers.setTimeout(() => {
        this.kills += 1;
        logger.warn({
          kind: 'katago_jungle_timeout',
          timeoutMs,
          replies: this.waiter?.replies.length ?? 0,
        });
        this.drop(`timed out after ${timeoutMs} ms`);
      }, timeoutMs);
      this.waiter = {
        expected: commands.length,
        replies: [],
        resolve: (replies) => {
          this.timers.clearTimeout(timer);
          proc.setActive(false);
          resolve(replies);
        },
        reject: (error) => {
          this.timers.clearTimeout(timer);
          reject(error);
        },
      };
      unparkEngineProcess(this);
      proc.setActive(true);
      proc.write(`${commands.join('\n')}\n`);
    });
  }

  private onData(chunk: string): void {
    this.buffer += chunk.replace(/\r/g, '');
    for (;;) {
      const end = this.buffer.indexOf('\n\n');
      if (end < 0) return;
      const block = this.buffer.slice(0, end).replace(/^\n+/, '');
      this.buffer = this.buffer.slice(end + 2);
      if (block === '') continue;
      const waiter = this.waiter;
      const status = block[0];
      if (!waiter || (status !== '=' && status !== '?')) {
        this.kills += 1;
        this.drop(waiter ? `garbled reply ${JSON.stringify(block.slice(0, 40))}` : 'spoke unasked');
        return;
      }
      waiter.replies.push(block.trim());
      if (waiter.replies.length === waiter.expected) {
        this.waiter = null;
        waiter.resolve(waiter.replies);
      }
    }
  }

  /** Kill the current process (if any) and reject the exchange in flight. */
  private drop(reason: string): void {
    const proc = this.proc;
    this.proc = null;
    this.buffer = '';
    this.cancelIdle();
    unparkEngineProcess(this);
    const waiter = this.waiter;
    this.waiter = null;
    waiter?.reject(new Error(`katago-jungle ${reason}`));
    proc?.kill();
  }

  private scheduleIdle(): void {
    if (!this.proc || this.closed) return;
    this.cancelIdle();
    this.idleTimer = this.timers.setTimeout(() => {
      this.idleTimer = null;
      if (this.busy || this.queue.length > 0 || !this.proc) return;
      logger.info({ kind: 'katago_jungle_idle_close', idle_ms: this.idleMs });
      this.drop('idle');
    }, this.idleMs);
    // Idle, the process is fair game for an engine that needs its slot.
    parkEngineProcess(this, () => {
      if (!this.busy && this.queue.length === 0) this.drop('evicted for another engine');
    });
  }

  private cancelIdle(): void {
    if (this.idleTimer === null) return;
    this.timers.clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }
}

function refStream(stream: unknown, method: 'ref' | 'unref'): void {
  const fn = (stream as { [key in typeof method]?: () => void } | null | undefined)?.[method];
  if (typeof fn === 'function') fn.call(stream);
}

/**
 * A spawner for a real GTP child, counted against the total engine-process cap
 * for as long as it lives. `command` resolves at spawn time, so a missing asset
 * fails that start rather than the server's boot.
 */
export function gtpProcessSpawner(
  command: () => { bin: string; args: readonly string[]; env?: NodeJS.ProcessEnv },
): KatagoGtpSpawner {
  return (handlers) =>
    withEngineProcess((track) => {
      const { bin, args, env } = command();
      const child = spawn(bin, [...args], {
        stdio: ['pipe', 'pipe', 'ignore'],
        ...(env ? { env } : {}),
      });
      track(child);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => handlers.onData(chunk));
      child.stdin.on('error', () => {
        // The process can die before it reads stdin (a missing net); 'exit' reports it.
      });
      child.once('error', (error) => handlers.onExit(`spawn failed: ${error.message}`));
      child.once('exit', (code, signal) => handlers.onExit(`exited ${code ?? signal}`));
      const process: KatagoGtpProcess = {
        write: (text) => {
          child.stdin.write(text);
        },
        kill: () => {
          try {
            child.kill('SIGKILL');
          } catch {
            /* already gone */
          }
        },
        setActive: (active) => {
          const method = active ? 'ref' : 'unref';
          child[method]();
          refStream(child.stdin, method);
          refStream(child.stdout, method);
        },
      };
      process.setActive(false);
      return process;
    });
}
