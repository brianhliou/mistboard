import { applyGomokuMove, parseGomokuMove } from '@mistboard/game';
import {
  parseRapfiOutput,
  type RapfiCandidate,
  type RapfiPosition,
  rapfiCommands,
} from '../../engine/rapfi.js';
import { rapfiPositionState } from '../../engine/rapfi-candidates.js';
import type { CevalEffort, CevalHandle, CevalRequest, CevalUpdate } from './ceval-types.js';

const BUDGETS: Record<Exclude<CevalEffort, 'infinite'>, { nodes: number; timeMs: number }> = {
  quick: { nodes: 5_000, timeMs: 1_000 },
  standard: { nodes: 20_000, timeMs: 2_000 },
  deep: { nodes: 100_000, timeMs: 3_000 },
  max: { nodes: 500_000, timeMs: 5_000 },
};

/** Gomoku's engine position dialect. Placement coordinates share the kernel's
 * a1 bottom-left orientation; JSON preserves a dealt root and its turn. */
export function rapfiCevalPosition(
  req: Pick<CevalRequest, 'initialFen' | 'movesUci'>,
): RapfiPosition {
  const root: RapfiPosition = req.initialFen ? JSON.parse(req.initialFen) : { turn: 1, stones: [] };
  if (!root || !Array.isArray(root.stones) || root.stones.some((stone) => !stone))
    throw new Error('Invalid Rapfi position');
  let state = rapfiPositionState(root);
  const stones = root.stones.map((stone) => ({ ...stone }));
  let turn = root.turn;
  for (const uci of req.movesUci) {
    const move = parseGomokuMove(uci);
    if (!move) throw new Error('Invalid Gomoku placement');
    const next = applyGomokuMove(state, move);
    if (next === state) throw new Error('Illegal Gomoku placement');
    stones.push({ x: uci.charCodeAt(0) - 97, y: Number(uci.slice(1)) - 1, player: turn });
    state = next;
    turn = turn === 1 ? 2 : 1;
  }
  return { turn, stones };
}

function budget(req: CevalRequest): { nodes: number; timeMs: number } {
  if (req.maxDepth !== undefined) {
    if (!Number.isSafeInteger(req.maxDepth) || req.maxDepth < 1)
      throw new Error('Invalid Rapfi depth effort');
    return BUDGETS[
      req.maxDepth <= 14
        ? 'quick'
        : req.maxDepth <= 18
          ? 'standard'
          : req.maxDepth <= 22
            ? 'deep'
            : 'max'
    ];
  }
  // Defend against programmatic infinite requests as well as hiding the UI endpoint.
  return BUDGETS[req.effort === 'infinite' ? 'max' : (req.effort ?? 'standard')];
}

function updateFor(candidates: RapfiCandidate[]): CevalUpdate {
  const ranked = [...candidates].sort((a, b) => b.eval - a.eval || a.pvIndex - b.pvIndex);
  return {
    depth: Math.max(0, ...ranked.map((c) => c.depth)),
    seldepth: Math.max(0, ...ranked.map((c) => c.seldepth)),
    nodes: Math.max(0, ...ranked.map((c) => c.totalNodes)),
    nps:
      ranked.reduce((latest, c) => (c.totalNodes > latest.totalNodes ? c : latest), ranked[0])
        ?.speed ?? 0,
    lines: ranked.map((candidate, index) => {
      const forced = candidate.forcedFive;
      // Preserve Rapfi's winrate on the gauge's existing sigmoid(cp / 320).
      // These are display units, not chess pawns or a calibrated rating model.
      const p = Math.max(1e-6, Math.min(1 - 1e-6, candidate.winrate));
      const sign = forced?.result === 'loss' ? -1 : 1;
      return {
        multipv: index + 1,
        depth: candidate.depth,
        scoreCp: forced
          ? forced.plies === 0
            ? sign * 30000
            : null
          : Math.round(320 * Math.log(p / (1 - p))),
        mate: forced && forced.plies > 0 ? sign * Math.ceil(forced.plies / 2) : null,
        pvUci: candidate.pv.map(({ x, y }) => `${String.fromCharCode(97 + x)}${y + 1}`),
      };
    }),
  };
}

/** Rapfi sendCommand is synchronous inside its classic worker. Terminating that
 * worker is the only reliable cancellation, including during WASM initialization.
 * Each replacement owns a new generation; queued messages cannot cross positions. */
export class RapfiCeval implements CevalHandle {
  readonly variant = 'gomoku';
  private worker: Worker | null = null;
  private loading: Promise<void> | null = null;
  private cancelLoad: ((error: Error) => void) | null = null;
  private receive: ((message: { type: string; line?: string; elapsedMs?: number }) => void) | null =
    null;
  private rejectSearch: ((error: Error) => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;

  async preload(): Promise<void> {
    if (this.loading) return this.loading;
    const worker = new Worker('/engine/rapfi/worker.js?v=1387d11312');
    this.worker = worker;
    this.loading = new Promise<void>((resolve, reject) => {
      this.cancelLoad = reject;
      this.timer = setTimeout(() => this.fail(new Error('Rapfi initialization timed out')), 30_000);
      worker.onmessage = ({ data }) => {
        if (this.worker !== worker || !data || typeof data !== 'object') return;
        if (data.type === 'error') this.fail(new Error(data.error ?? 'Rapfi worker failed'));
        else if (data.type === 'ready') {
          clearTimeout(this.timer);
          this.cancelLoad = null;
          resolve();
        } else this.receive?.(data);
      };
      worker.onerror = (event) => {
        if (this.worker === worker) this.fail(new Error(event.message));
      };
      worker.postMessage({ type: 'init' });
    });
    return this.loading;
  }

  async evaluate(req: CevalRequest): Promise<CevalUpdate> {
    // Invalidate before awaiting a preload: even a stopped initialization must
    // never start a delayed search when its ready message arrives.
    if (this.receive || this.rejectSearch) this.stop();
    const generation = ++this.generation;
    const position = rapfiCevalPosition(req);
    const count = req.multiPv ?? 3;
    const plan = rapfiCommands(position, { ...budget(req), candidateCount: count });
    // Snapshot caller-owned data before the first async boundary.
    const onUpdate = req.onUpdate;
    return new Promise<CevalUpdate>((resolve, reject) => {
      // Register before preload: failures and cancellation between ready and
      // the next microtask still belong to this request.
      this.rejectSearch = reject;
      const output: string[] = [];
      let latest: CevalUpdate = updateFor([]);
      const legalCount = Math.min(count, 225 - position.stones.length);
      const validCandidates = () => {
        const seen = new Set<string>();
        return parseRapfiOutput(output)
          .filter((candidate) => {
            const key = `${candidate.move.x},${candidate.move.y}`;
            if (
              seen.has(key) ||
              position.stones.some((s) => s.x === candidate.move.x && s.y === candidate.move.y)
            )
              return false;
            seen.add(key);
            return true;
          })
          .slice(0, legalCount);
      };
      this.receive = (message) => {
        if (generation !== this.generation) return;
        if (message.type === 'line' && typeof message.line === 'string') {
          if (/^(ERROR|UNKNOWN)\b/.test(message.line)) {
            this.fail(new Error(message.line));
            return;
          }
          if (message.line.startsWith('INFO ')) output.push(message.line);
          if (message.line === 'INFO PV DONE') {
            const candidates = validCandidates();
            if (candidates.length === legalCount) {
              latest = updateFor(candidates);
              onUpdate?.(latest);
            }
          }
        } else if (message.type === 'done') {
          if (
            typeof message.elapsedMs !== 'number' ||
            !Number.isFinite(message.elapsedMs) ||
            message.elapsedMs < 0 ||
            message.elapsedMs > plan.timeMs + 250
          ) {
            this.fail(new Error('Rapfi search timed out'));
            return;
          }
          clearTimeout(this.timer);
          this.receive = null;
          this.rejectSearch = null;
          if (!latest.lines.length) latest = updateFor(validCandidates());
          if (!latest.lines.length) {
            reject(new Error('Rapfi returned no analysis'));
            return;
          }
          onUpdate?.(latest);
          resolve(latest);
        }
      };
      try {
        void this.preload()
          .then(() => {
            if (generation !== this.generation || !this.worker) return;
            this.timer = setTimeout(
              () => this.fail(new Error('Rapfi search timed out')),
              plan.timeMs + 250,
            );
            this.worker.postMessage({ type: 'commands', commands: plan.lines });
          })
          .catch((error: unknown) => {
            if (generation === this.generation)
              this.fail(error instanceof Error ? error : new Error(String(error)));
          });
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private fail(error: Error): void {
    ++this.generation;
    const reject = this.rejectSearch;
    const cancelLoad = this.cancelLoad;
    this.release();
    cancelLoad?.(error);
    reject?.(error);
  }

  private release(): void {
    clearTimeout(this.timer);
    if (this.worker) {
      this.worker.onmessage = null;
      this.worker.onerror = null;
      this.worker.terminate();
    }
    this.worker = null;
    this.loading = null;
    this.cancelLoad = null;
    this.receive = null;
    this.rejectSearch = null;
  }

  stop(): void {
    ++this.generation;
    const cancelLoad = this.cancelLoad;
    this.release();
    cancelLoad?.(new DOMException('Rapfi stopped', 'AbortError'));
  }

  dispose(): void {
    this.stop();
  }
}
