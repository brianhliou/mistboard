// Standalone freestyle 15x15 adapter: no variant registration or game kernel.
export type RapfiLevel = 1 | 2 | 3 | 4 | 5;
export const RAPFI_LEVELS: readonly {
  readonly level: RapfiLevel;
  readonly nodes: number;
  readonly timeMs: number;
}[] = Object.freeze([
  { level: 1, nodes: 100, timeMs: 1_000 },
  { level: 2, nodes: 1_000, timeMs: 1_500 },
  { level: 3, nodes: 5_000, timeMs: 2_000 },
  { level: 4, nodes: 20_000, timeMs: 3_000 },
  { level: 5, nodes: 100_000, timeMs: 5_000 },
]);

export interface RapfiPosition {
  turn: 1 | 2;
  stones: readonly { x: number; y: number; player: 1 | 2 }[];
}

export interface RapfiMove {
  move: { x: number; y: number };
  /** Worker time, including lazy network initialization on the first move. */
  elapsedMs: number;
}

/** Small transport seam so Node tests run the real browser worker in a thread. */
export interface RapfiTransport {
  listen(onMessage: (message: unknown) => void, onError: (error: Error) => void): void;
  postMessage(message: unknown): void;
  terminate(): void;
}

function browserTransport(): RapfiTransport {
  const worker = new Worker('/engine/rapfi/worker.js?v=1387d11312');
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

/** Shared with the offline ladder so calibration exercises browser commands. */
export function rapfiCommands(
  position: RapfiPosition,
  tier: { nodes: number; timeMs: number },
): { lines: string[]; timeMs: number } {
  if (
    !Number.isSafeInteger(tier.nodes) ||
    tier.nodes < 1 ||
    !Number.isSafeInteger(tier.timeMs) ||
    tier.timeMs < 1
  )
    throw new Error('Invalid Rapfi budget');
  if (position.turn !== 1 && position.turn !== 2) throw new Error('Invalid Rapfi turn');
  const occupied = new Set<string>();
  for (const stone of position.stones) {
    if (
      !Number.isInteger(stone.x) ||
      stone.x < 0 ||
      stone.x >= 15 ||
      !Number.isInteger(stone.y) ||
      stone.y < 0 ||
      stone.y >= 15 ||
      (stone.player !== 1 && stone.player !== 2)
    )
      throw new Error('Invalid Rapfi stone');
    const key = `${stone.x},${stone.y}`;
    if (occupied.has(key)) throw new Error('Duplicate Rapfi stone');
    occupied.add(key);
  }
  if (occupied.size === 225) throw new Error('Rapfi board is full');
  return {
    timeMs: tier.timeMs,
    lines: [
      'START 15',
      'INFO rule 0',
      `INFO max_node ${tier.nodes}`,
      `INFO timeout_turn ${tier.timeMs}`,
      // BOARD's 1 means us, 2 means opponent, regardless of stone color.
      position.stones.length
        ? [
            'BOARD',
            ...position.stones.map(
              (stone) => `${stone.x},${stone.y},${stone.player === position.turn ? 1 : 2}`,
            ),
            'DONE',
          ].join('\n')
        : 'BEGIN',
    ],
  };
}

type Pending = {
  position: RapfiPosition;
  lines: string[];
  timeMs: number;
  move?: { x: number; y: number };
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

  async chooseMove(position: RapfiPosition, level: RapfiLevel): Promise<RapfiMove> {
    if (this.pending) throw new Error('Rapfi is already searching');
    const tier = RAPFI_LEVELS.find((entry) => entry.level === level);
    if (!tier) throw new Error('Unknown Rapfi level');
    const { lines, timeMs } = rapfiCommands(position, tier);
    return new Promise<RapfiMove>((resolve, reject) => {
      this.pending = {
        position: { turn: position.turn, stones: position.stones.map((stone) => ({ ...stone })) },
        lines,
        timeMs,
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
      this.pending.timeMs + 250,
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
      if (message.elapsedMs > this.pending.timeMs + 250) {
        this.fail(new Error('Rapfi move timed out'));
        return;
      }
      clearTimeout(this.timer);
      this.pending = null;
      resolve({ move, elapsedMs: message.elapsedMs });
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
