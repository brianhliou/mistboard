// Freestyle 15x15 adapter; live play and calibration share the same tier policy.
import {
  parseRapfiOutput,
  type RapfiCandidate,
  type RapfiChoiceOptions,
  type RapfiPosition,
  rapfiPositionState,
  selectRapfiMove,
  validateRapfiCandidateCount,
  validateRapfiChoiceOptions,
} from '@mistboard/game';

export type { RapfiCandidate, RapfiChoiceOptions, RapfiPosition };
export { parseRapfiOutput, selectRapfiMove };

function validateSeed(seed: number): void {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
    throw new Error('Invalid Rapfi seed');
}

// FNV-1a over UTF-16 code units: identical in browser and Node, with explicit
// domains and separators so game identities and plies cannot alias by joining.
function hashSeed(identity: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < identity.length; index++)
    hash = Math.imul(hash ^ identity.charCodeAt(index), 0x01000193);
  return hash >>> 0;
}

/** Persist this seed with the game; a room id works without a run seed. */
export function rapfiGameSeed(gameId: string, runSeed = 0): number {
  validateSeed(runSeed);
  if (typeof gameId !== 'string' || !gameId.length) throw new Error('Invalid Rapfi game identity');
  return hashSeed(`game:${runSeed}:${gameId}`);
}

/** Use the kernel's absolute ply (including opening stones), never call order. */
export function rapfiPlySeed(gameSeed: number, ply: number): number {
  validateSeed(gameSeed);
  if (!Number.isSafeInteger(ply) || ply < 0) throw new Error('Invalid Rapfi ply');
  return hashSeed(`ply:${gameSeed}:${ply}`);
}

export type RapfiLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export const RAPFI_LEVELS: readonly {
  readonly level: RapfiLevel;
  readonly nodes: number;
  readonly timeMs: number;
  readonly candidateCount?: number;
  readonly evalMargin?: number;
}[] = Object.freeze([
  { level: 1, nodes: 5_000, timeMs: 1_000, candidateCount: 128, evalMargin: 60_000 },
  { level: 2, nodes: 10_000, timeMs: 1_000, candidateCount: 16, evalMargin: 2_000 },
  { level: 3, nodes: 20_000, timeMs: 1_500, candidateCount: 8, evalMargin: 750 },
  { level: 4, nodes: 40_000, timeMs: 1_500, candidateCount: 4, evalMargin: 300 },
  { level: 5, nodes: 80_000, timeMs: 2_000 },
  { level: 6, nodes: 150_000, timeMs: 2_500 },
  { level: 7, nodes: 250_000, timeMs: 3_500 },
  // Include the transport/watchdog allowance inside the five-second ceiling.
  { level: 8, nodes: 400_000, timeMs: 4_750 },
]);

export interface RapfiMove {
  move: { x: number; y: number };
  /** Worker time, including lazy network initialization on the first move. */
  elapsedMs: number;
  /** Present for nonempty L1-4 requests or an explicit YXNBEST override. */
  candidates?: readonly RapfiCandidate[];
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
  tier: { nodes: number; timeMs: number; candidateCount?: number },
): { lines: string[]; timeMs: number } {
  if (
    !Number.isSafeInteger(tier.nodes) ||
    tier.nodes < 1 ||
    !Number.isSafeInteger(tier.timeMs) ||
    tier.timeMs < 1
  )
    throw new Error('Invalid Rapfi budget');
  rapfiPositionState(position);
  const count = tier.candidateCount;
  if (count !== undefined) validateRapfiCandidateCount(count);
  return {
    timeMs: tier.timeMs,
    lines: [
      'START 15',
      'INFO rule 0',
      `INFO max_node ${tier.nodes}`,
      `INFO timeout_turn ${tier.timeMs}`,
      ...(count !== undefined ? ['INFO show_detail 2'] : []),
      // BOARD's 1 means us, 2 means opponent, regardless of stone color.
      position.stones.length
        ? [
            count !== undefined ? 'YXBOARD' : 'BOARD',
            ...position.stones.map(
              (stone) => `${stone.x},${stone.y},${stone.player === position.turn ? 1 : 2}`,
            ),
            'DONE',
          ].join('\n')
        : count !== undefined
          ? `YXNBEST ${count}`
          : 'BEGIN',
      ...(count !== undefined && position.stones.length ? [`YXNBEST ${count}`] : []),
    ],
  };
}

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
    const tier = RAPFI_LEVELS.find((entry) => entry.level === level);
    if (!tier) throw new Error('Unknown Rapfi level');
    if (typeof seedOrChoice === 'number') validateSeed(seedOrChoice);
    // Rapfi short-circuits an empty board to centre without emitting PVs.
    // Explicit candidate requests retain their fail-closed parsing contract.
    const choice =
      typeof seedOrChoice !== 'number'
        ? seedOrChoice
        : tier.candidateCount !== undefined && position.stones.length > 0
          ? {
              candidateCount: tier.candidateCount,
              evalMargin: tier.evalMargin ?? 0,
              seed: seedOrChoice,
            }
          : undefined;
    const { lines, timeMs } = rapfiCommands(position, {
      ...tier,
      candidateCount: choice?.candidateCount,
    });
    // Validate options before allocating a worker, including on an empty board.
    if (choice) validateRapfiChoiceOptions(choice);
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
      if (message.elapsedMs > this.pending.timeMs + 250) {
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
