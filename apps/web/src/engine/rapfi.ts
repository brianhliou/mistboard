// Freestyle 15x15 adapter; live play and calibration share the same tier policy.
import {
  parseRapfiOutput,
  type RapfiCandidate,
  type RapfiChoiceOptions,
  type RapfiLevel,
  type RapfiPosition,
  rapfiLevelRequest,
  selectRapfiMove,
} from '@mistboard/game';

export { RAPFI_LEVELS, rapfiCommands, rapfiGameSeed, rapfiPlySeed } from '@mistboard/game';
export type { RapfiCandidate, RapfiChoiceOptions, RapfiLevel, RapfiPosition };
export { parseRapfiOutput, selectRapfiMove };

export interface RapfiMove {
  move: { x: number; y: number };
  /** Worker time, including lazy network initialization on the first move. */
  elapsedMs: number;
  /** Present for nonempty L1-5 requests or an explicit YXNBEST override. */
  candidates?: readonly RapfiCandidate[];
}

/** Small transport seam so Node tests run the real browser worker in a thread. */
export interface RapfiTransport {
  listen(onMessage: (message: unknown) => void, onError: (error: Error) => void): void;
  postMessage(message: unknown): void;
  terminate(): void;
}

function browserTransport(): RapfiTransport {
  const worker = new Worker('/engine/rapfi/worker.js?v=1387d11312.2');
  return {
    listen(onMessage, onError) {
      worker.onmessage = (event) => onMessage(event.data);
      worker.onerror = (event) => onError(new Error(event.message));
    },
    postMessage: (message) => worker.postMessage(message),
    terminate() {
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
    },
  };
}

/** Time past a level's search budget before a move counts as hung. Rapfi stops
 * itself at ~97% of timeout_turn, so this covers worker overhead on a slow
 * device, not extra thinking: a 250ms grace failed Level 1 on an iPhone (2026-11-05). */
export const RAPFI_MOVE_GRACE_MS = 2_000;

type Pending = {
  position: RapfiPosition;
  lines: string[];
  timeMs: number;
  move?: { x: number; y: number };
  choice?: RapfiChoiceOptions;
  output: string[];
  resolve(result: RapfiMove): void;
  reject(error: Error): void;
};

/** One outstanding request at a time. stop() releases the whole WASM heap and
 * rejects pending work; the next request starts a fresh worker. */
export class Rapfi {
  private worker: RapfiTransport | null = null;
  private ready = false;
  private pending: Pending | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly createTransport: () => RapfiTransport = browserTransport) {}

  async chooseMove(
    position: RapfiPosition,
    level: RapfiLevel,
    seedOrChoice: number | RapfiChoiceOptions = 0,
  ): Promise<RapfiMove> {
    if (this.pending) throw new Error('Rapfi is already searching');
    const { lines, timeMs, choice } = rapfiLevelRequest(position, level, seedOrChoice);
    return new Promise<RapfiMove>((resolve, reject) => {
      this.pending = {
        position: { turn: position.turn, stones: position.stones.map((stone) => ({ ...stone })) },
        lines,
        timeMs,
        choice: choice ? { ...choice } : undefined,
        output: [],
        resolve,
        reject,
      };
      try {
        if (this.worker && this.ready) {
          this.search();
        } else {
          const worker = this.createTransport();
          this.worker = worker;
          worker.listen(
            (message) => {
              if (this.worker === worker) this.receive(message);
            },
            (error) => {
              if (this.worker === worker) this.fail(error);
            },
          );
          this.timer = setTimeout(
            () => this.fail(new Error('Rapfi initialization timed out')),
            30_000,
          );
          worker.postMessage({ type: 'init' });
        }
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private search(): void {
    if (!this.pending || !this.worker) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(
      () => this.fail(new Error('Rapfi move timed out')),
      this.pending.timeMs + RAPFI_MOVE_GRACE_MS,
    );
    this.worker.postMessage({ type: 'commands', commands: this.pending.lines });
  }

  private receive(value: unknown): void {
    if (!value || typeof value !== 'object' || !('type' in value)) return;
    const message = value as { type: string; line?: string; error?: string; elapsedMs?: number };
    if (message.type === 'error') {
      this.fail(new Error(message.error ?? 'Rapfi worker failed'));
    } else if (message.type === 'ready') {
      this.ready = true;
      this.search();
    } else if (message.type === 'line' && message.line) {
      if (/^(ERROR|UNKNOWN)\b/.test(message.line)) {
        this.fail(new Error(message.line));
        return;
      }
      const match = /^(\d+),(\d+)$/.exec(message.line);
      if (match && this.pending) this.pending.move = { x: Number(match[1]), y: Number(match[2]) };
      if (this.pending?.choice && message.line.startsWith('INFO '))
        this.pending.output.push(message.line);
    } else if (message.type === 'done' && this.pending) {
      const { move, position, resolve } = this.pending;
      if (
        !move ||
        move.x >= 15 ||
        move.y >= 15 ||
        position.stones.some((stone) => stone.x === move.x && stone.y === move.y) ||
        typeof message.elapsedMs !== 'number' ||
        !Number.isFinite(message.elapsedMs) ||
        message.elapsedMs < 0
      ) {
        this.fail(new Error('Rapfi returned an invalid move'));
        return;
      }
      if (message.elapsedMs > this.pending.timeMs + RAPFI_MOVE_GRACE_MS) {
        this.fail(new Error('Rapfi move timed out'));
        return;
      }
      // The final move remains required even for YXNBEST. Its human MESSAGE
      // summaries never supply candidates; missing structured output fails closed.
      try {
        const { choice, output } = this.pending;
        const candidates = choice ? parseRapfiOutput(output) : undefined;
        const selected =
          choice && candidates ? selectRapfiMove(position, candidates, choice) : move;
        clearTimeout(this.timer);
        this.pending = null;
        resolve({
          move: selected,
          elapsedMs: message.elapsedMs,
          ...(candidates ? { candidates } : {}),
        });
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  private fail(error: Error): void {
    clearTimeout(this.timer);
    this.worker?.terminate();
    this.worker = null;
    this.ready = false;
    const pending = this.pending;
    this.pending = null;
    pending?.reject(error);
  }

  stop(): void {
    this.fail(new DOMException('Rapfi stopped', 'AbortError'));
  }
}
