// A Fairy-Stockfish UCI session that can fail.
//
// Every wait has a deadline, an engine that dies rejects every pending wait
// with its last output, and opening the session proves the variant actually
// took. All three exist because their absence cost hours on the duck track:
// a promise nobody resolves looks like slow work, and an engine asked for a
// variant it does not have keeps playing the previous one without a word
// (an unknown UCI_Variant on stock FSF silently plays chess, perft 20).

import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { BinaryLocator, EngineIdentity, LabEngineSpec } from './types.js';

export type EngineOptions = {
  threads?: number;
  hashMb?: number;
  /** Deadline for handshakes and perft; a search gets its own budget-derived one. */
  timeoutMs?: number;
};

export class EngineError extends Error {
  constructor(
    message: string,
    readonly lastLines: readonly string[],
  ) {
    super(
      lastLines.length ? `${message}\n  last output:\n    ${lastLines.join('\n    ')}` : message,
    );
    this.name = 'EngineError';
  }
}

export function locateBinary(locator: BinaryLocator): string {
  const explicit = process.env[locator.env];
  if (explicit) {
    const path = resolve(explicit);
    if (!existsSync(path)) throw new Error(`${locator.env}=${explicit} does not exist`);
    return path;
  }
  for (const candidate of locator.fallbacks) {
    const path = candidate.startsWith('~')
      ? join(process.env.HOME ?? '', candidate.slice(1))
      : candidate;
    if (existsSync(path)) return resolve(path);
  }
  throw new Error(`${locator.label}: set ${locator.env} (tried ${locator.fallbacks.join(', ')})`);
}

export function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

type Waiter = {
  test: (line: string) => boolean;
  resolve: (line: string) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

export class LabEngine {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = '';
  private readonly waiters = new Set<Waiter>();
  private readonly recent: string[] = [];
  private readonly listeners = new Set<(line: string) => void>();
  private iniDir: string | null = null;
  private exited: string | null = null;
  readonly binaryPath: string;
  readonly timeoutMs: number;
  identity: EngineIdentity | null = null;
  /** The engine's own start FEN for the variant, when it announced one. */
  announcedStartFen: string | null = null;

  constructor(
    readonly spec: LabEngineSpec,
    readonly options: EngineOptions = {},
  ) {
    this.binaryPath = locateBinary(spec.binary);
    this.timeoutMs = options.timeoutMs ?? 60_000;
  }

  private remember(line: string): void {
    this.recent.push(line);
    if (this.recent.length > 8) this.recent.shift();
  }

  private send(command: string): void {
    if (!this.child || this.exited !== null) {
      throw new EngineError(
        `engine is not running (${this.exited ?? 'never started'}); cannot send "${command}"`,
        this.recent,
      );
    }
    this.child.stdin.write(`${command}\n`);
  }

  private wait(
    test: (line: string) => boolean,
    what: string,
    timeoutMs = this.timeoutMs,
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      if (this.exited !== null) {
        reject(new EngineError(`engine exited (${this.exited}) before ${what}`, this.recent));
        return;
      }
      const waiter: Waiter = {
        test,
        resolve: (line) => {
          clearTimeout(waiter.timer);
          this.waiters.delete(waiter);
          resolve(line);
        },
        reject: (error) => {
          clearTimeout(waiter.timer);
          this.waiters.delete(waiter);
          reject(error);
        },
        timer: setTimeout(() => {
          waiter.reject(
            new EngineError(`timed out after ${timeoutMs} ms waiting for ${what}`, this.recent),
          );
          this.kill();
        }, timeoutMs),
      };
      this.waiters.add(waiter);
    });
  }

  private onLine(line: string): void {
    this.remember(line);
    for (const listener of this.listeners) listener(line);
    for (const waiter of [...this.waiters]) if (waiter.test(line)) waiter.resolve(line);
  }

  /** Spawn, hand over the ini, prove the variant took, and record identity. */
  async open(expectedStartMoves: number): Promise<EngineIdentity> {
    const child = spawn(this.binaryPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    child.stdout.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString('utf8');
      let nl = this.buffer.indexOf('\n');
      while (nl >= 0) {
        const line = this.buffer.slice(0, nl).trim();
        this.buffer = this.buffer.slice(nl + 1);
        if (line) this.onLine(line);
        nl = this.buffer.indexOf('\n');
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString('utf8').split('\n'))
        if (line.trim()) this.remember(`stderr: ${line.trim()}`);
    });
    child.on('error', (error) => this.fail(`spawn failed: ${error.message}`));
    child.on('exit', (code, signal) => this.fail(`exit code=${code} signal=${signal}`));

    let iniSha: string | null = null;
    if (this.spec.ini !== undefined) {
      this.iniDir = mkdtempSync(join(tmpdir(), 'variant-lab-'));
      const iniPath = join(this.iniDir, `${this.spec.variant}.ini`);
      writeFileSync(iniPath, this.spec.ini);
      iniSha = createHash('sha256').update(this.spec.ini).digest('hex');
      this.send(`setoption name VariantPath value ${iniPath}`);
    }

    // `uci` after VariantPath lists custom variants in the UCI_Variant combo,
    // which is the first of two proofs that the engine knows this variant.
    let idName = '';
    let combo = '';
    const listen = (line: string) => {
      if (line.startsWith('id name ')) idName = line.slice('id name '.length);
      if (line.startsWith('option name UCI_Variant ')) combo = line;
    };
    this.listeners.add(listen);
    this.send('uci');
    await this.wait((l) => l === 'uciok', 'uciok');
    this.listeners.delete(listen);
    if (!combo.split(/\s+/).includes(this.spec.variant) || !/ var /.test(combo)) {
      throw new EngineError(
        `engine does not list variant "${this.spec.variant}"${this.spec.ini !== undefined ? ' (VariantPath was set)' : ''}`,
        this.recent,
      );
    }

    const announce = (line: string) => {
      const m = /^info string variant (\S+) .* startpos (.+)$/.exec(line);
      if (m && m[1] === this.spec.variant) this.announcedStartFen = m[2]!;
    };
    this.listeners.add(announce);
    this.send(`setoption name UCI_Variant value ${this.spec.variant}`);
    this.send(`setoption name Threads value ${this.options.threads ?? 1}`);
    this.send(`setoption name Hash value ${this.options.hashMb ?? 64}`);
    this.send('ucinewgame');
    this.send('isready');
    await this.wait((l) => l === 'readyok', 'readyok');
    this.listeners.delete(announce);

    // Second proof, the one that cannot be fooled: the move count at the
    // start position is the kernel's. An engine on the wrong variant fails
    // here rather than producing a game of a different game.
    const startNodes = await this.perft('startpos', 1);
    if (startNodes !== expectedStartMoves) {
      throw new EngineError(
        `variant "${this.spec.variant}" did not take: perft(1) at startpos is ${startNodes}, kernel says ${expectedStartMoves}`,
        this.recent,
      );
    }

    this.identity = {
      idName,
      binaryPath: this.binaryPath,
      binarySha256: sha256File(this.binaryPath),
      variant: this.spec.variant,
      iniSha256: iniSha,
    };
    return this.identity;
  }

  private fail(reason: string): void {
    if (this.exited !== null) return;
    this.exited = reason;
    for (const waiter of [...this.waiters])
      waiter.reject(new EngineError(`engine ${reason}`, this.recent));
  }

  /** `position` as the engine wants it: `startpos` or `fen <fen>`, plus moves. */
  private position(root: string, moves: readonly string[]): void {
    const where = root === 'startpos' ? 'startpos' : `fen ${root}`;
    this.send(`position ${where}${moves.length ? ` moves ${moves.join(' ')}` : ''}`);
  }

  async perft(root: string, depth: number, timeoutMs = this.timeoutMs): Promise<number> {
    this.position(root, []);
    this.send(`go perft ${depth}`);
    const line = await this.wait(
      (l) => l.startsWith('Nodes searched:'),
      `perft ${depth}`,
      timeoutMs,
    );
    return Number(line.split(':')[1]!.trim());
  }

  /** Every legal move at a position, in the engine's notation. */
  async legalMoves(root: string): Promise<string[]> {
    const moves: string[] = [];
    const listen = (line: string) => {
      const m = /^(\S+): \d+$/.exec(line);
      if (m) moves.push(m[1]!);
    };
    this.listeners.add(listen);
    try {
      await this.perft(root, 1);
    } finally {
      this.listeners.delete(listen);
    }
    return moves.sort();
  }

  /**
   * Best move under a node budget. The deadline scales with the budget, so a
   * 5M-node search on a slow box is not mistaken for a hang, and a hang is not
   * mistaken for a deep search: past the deadline the engine is killed and the
   * caller gets the last lines it printed.
   */
  async bestMove(
    root: string,
    moves: readonly string[],
    nodes: number,
    options: { fresh?: boolean } = {},
  ): Promise<{ move: string; lastInfo: string | null }> {
    let lastInfo: string | null = null;
    const listen = (line: string) => {
      if (line.startsWith('info ') && line.includes(' score ')) lastInfo = line;
    };
    this.listeners.add(listen);
    try {
      // `fresh` clears the hash table first. Two budgets sharing one process
      // otherwise share a transposition table, and the weaker side searches
      // on the stronger side's work; a ladder measured that way understates
      // the gap it exists to measure.
      if (options.fresh) {
        this.send('ucinewgame');
        this.send('isready');
        await this.wait((l) => l === 'readyok', 'readyok after ucinewgame');
      }
      this.position(root, moves);
      this.send(`go nodes ${nodes}`);
      const deadline = Math.max(this.timeoutMs, Math.ceil(nodes / 1000) * 100);
      const line = await this.wait(
        (l) => l.startsWith('bestmove'),
        `bestmove at ${nodes} nodes`,
        deadline,
      );
      return { move: line.split(/\s+/)[1] ?? '(none)', lastInfo };
    } finally {
      this.listeners.delete(listen);
    }
  }

  newGame(): void {
    this.send('ucinewgame');
  }

  kill(): void {
    if (this.child && this.exited === null) {
      try {
        this.child.stdin.write('quit\n');
      } catch {
        // already gone
      }
      this.child.kill();
    }
    if (this.iniDir) {
      rmSync(this.iniDir, { recursive: true, force: true });
      this.iniDir = null;
    }
  }

  async close(): Promise<void> {
    this.kill();
  }
}
