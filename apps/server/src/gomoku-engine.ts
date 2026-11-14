import {
  type GomokuColor,
  type GomokuMove,
  type GomokuRoomState,
  parseGomokuMove,
  parseRapfiOutput,
  RAPFI_LEVELS,
  type RapfiLevel,
  type RapfiPosition,
  rapfiGameSeed,
  rapfiLevelRequest,
  rapfiPlySeed,
  selectRapfiMove,
} from '@mistboard/game';
import { resolveValidatedEngineMove } from './engine-move-guard.js';
import { createReplyTurn, replyPace, replyPacePayload } from './engine-reply-pacing.js';
import { liveBotMoveTime } from './engine-time-budget.js';
import {
  GOMOKU_ANALYSIS_HASH_BYTES,
  type GomokuAnalysisOptions,
  RapfiSession,
} from './gomoku-analysis.js';
import { type GomokuRuntimeRoom, gomokuTenant, isGomokuEngineClientId } from './gomoku-tenant.js';
import { logger } from './obs.js';
import type { UciEval } from './uci-engine-harness.js';
import { UciEnginePool, withEngineProcess } from './uci-engine-harness.js';
import {
  buildLiveEngineDecisionPayload,
  queueEngineDecision,
} from './variant-tenant/engine-decisions.js';
import type { TenantLifecycleContext } from './variant-tenant/lifecycle.js';
import { tenantClockRemainingMs } from './variant-tenant/runtime.js';

// All live Gomoku rooms share this cap. A slot is held until the child is reaped;
// withEngineProcess also accounts for it in the server-wide physical process cap.
const livePool = new UciEnginePool({
  name: 'rapfi-gomoku-pve',
  maxProcessesEnvVar: 'RAPFI_MAX_PROCESSES',
  queueTimeoutEnvVar: 'RAPFI_QUEUE_TIMEOUT_MS',
  // Four single-threaded 32 MB searches leave room under the shared physical
  // cap. Allow several Level 8 waves, including cold startup and child reaping,
  // rather than shedding valid queued turns at the harness's 5 s default.
  defaultMaxProcesses: 4,
  defaultQueueTimeoutMs: 30_000,
  queueTimeoutMessage: 'Rapfi PvE pool timed out',
});

type MoveOptions = GomokuAnalysisOptions & {
  isCurrent?: () => boolean;
  /** Clock-aware ceiling; nodes and seeded candidate selection remain unchanged. */
  movetimeMs?: number;
  /** Offline calibration supplies its recorded game seed; rooms derive it from id. */
  gameSeed?: number;
  /** Observe the successful native search without changing its commands or choice. */
  onSearch?: (search: { move: GomokuMove; lines: string[]; elapsedMs: number }) => void;
};
export type GomokuMoveProvider = (
  state: GomokuRoomState,
  engineId: string,
  options: MoveOptions,
) => Promise<GomokuMove | null>;
type GomokuEngineRoom = GomokuRuntimeRoom & { stopping?: boolean };
export type GomokuEngineContext = TenantLifecycleContext<
  GomokuColor,
  GomokuMove,
  GomokuRoomState,
  'gomoku',
  GomokuRuntimeRoom
>;

export async function gomokuLiveEngineMove(
  state: GomokuRoomState,
  engineId: string,
  options: MoveOptions = {},
): Promise<GomokuMove | null> {
  if (!isGomokuEngineClientId(engineId)) throw new Error('Unknown Rapfi engine');
  if (state.status.type !== 'playing') return null;
  const position: RapfiPosition = {
    turn: state.status.turn === 'black' ? 1 : 2,
    stones: state.board.flatMap((color, index) =>
      color
        ? [
            {
              x: index % 15,
              y: Math.floor(index / 15),
              player: color === 'black' ? (1 as const) : (2 as const),
            },
          ]
        : [],
    ),
  };
  const request = rapfiLevelRequest(
    position,
    Number(engineId.at(-1)) as RapfiLevel,
    rapfiPlySeed(options.gameSeed ?? rapfiGameSeed(state.id), state.ply),
  );
  const searchMs = Math.min(
    request.timeMs,
    Math.max(1, Math.floor(options.movetimeMs ?? request.timeMs)),
  );
  const release = await livePool.acquire();
  try {
    return await withEngineProcess(async (track) => {
      // A queued room may have paused, ended or taken back the searched turn.
      if (options.isCurrent && !options.isCurrent()) return null;
      const started = performance.now();
      const session = new RapfiSession(options, track);
      try {
        await session.exchange(
          ['START 15'],
          (line) => line.trim() === 'OK',
          options.timeoutMs ?? 5_000,
        );
        const output = await session.exchange(
          [
            'INFO thread_num 1',
            `INFO max_memory ${GOMOKU_ANALYSIS_HASH_BYTES}`,
            ...request.lines
              .slice(1)
              .map((line) =>
                line.startsWith('INFO timeout_turn ') ? `INFO timeout_turn ${searchMs}` : line,
              ),
          ],
          (line) => /^\d+,\d+$/.test(line.trim()),
          // Each move starts a fresh process; Rapfi loads its net on the first
          // search. The engine's time budget does not cover cold startup.
          options.timeoutMs ?? searchMs + 2_000,
        );
        // Require a valid final move even when structured candidates choose it.
        const [x, y] = output.at(-1)!.trim().split(',').map(Number);
        const raw = parseGomokuMove(`${String.fromCharCode(97 + x!)}${y! + 1}`);
        if (!raw || !gomokuTenant.rules.isLegalMove(state, raw))
          throw new Error('Rapfi returned an illegal placement');
        const selected = request.choice
          ? selectRapfiMove(position, parseRapfiOutput(output), request.choice)
          : { x: x!, y: y! };
        const move = parseGomokuMove(`${String.fromCharCode(97 + selected.x)}${selected.y + 1}`);
        if (!move || !gomokuTenant.rules.isLegalMove(state, move))
          throw new Error('Rapfi returned an illegal placement');
        options.onSearch?.({
          move,
          lines: output,
          elapsedMs: Math.round(performance.now() - started),
        });
        return move;
      } finally {
        // No parked network or hash memory between turns, including failures.
        await session.close();
      }
    });
  } finally {
    release();
  }
}

const thinking = new WeakSet<GomokuRuntimeRoom>();

function engineSeat(room: GomokuRuntimeRoom): GomokuColor | null {
  for (const seat of gomokuTenant.colors)
    if (isGomokuEngineClientId(room.projection.seats[seat])) return seat;
  return null;
}

function engineToMove(room: GomokuEngineRoom, seat: GomokuColor): boolean {
  const { state, seats, clock } = room.projection;
  return (
    !room.stopping &&
    !room.projection.paused &&
    !room.rated &&
    !room.projection.rated &&
    state.status.type === 'playing' &&
    state.status.turn === seat &&
    Boolean(seats.black && seats.white) &&
    (!clock || tenantClockRemainingMs(clock, seat, Date.now()) > 0)
  );
}

export function scheduleGomokuEngineMove(
  ctx: GomokuEngineContext,
  room: GomokuRuntimeRoom,
  provider: GomokuMoveProvider = gomokuLiveEngineMove,
): void {
  const seat = engineSeat(room);
  if (room.engineTimer || thinking.has(room) || seat === null || !engineToMove(room, seat)) return;
  room.engineTimer = setTimeout(() => {
    room.engineTimer = null;
    void playGomokuEngineMoveIfReady(ctx, room, provider).catch((error: Error) => {
      logger.error(
        { kind: 'gomoku_engine_move_failure', room_id: room.id, error: error.message },
        'Gomoku engine move failure',
      );
    });
  }, 0);
  room.engineTimer.unref();
}

export async function playGomokuEngineMoveIfReady(
  ctx: GomokuEngineContext,
  room: GomokuRuntimeRoom,
  provider: GomokuMoveProvider = gomokuLiveEngineMove,
): Promise<void> {
  const seat = engineSeat(room);
  if (thinking.has(room) || seat === null || !engineToMove(room, seat)) return;
  const state = room.projection.state;
  const engineId = room.projection.seats[seat]!;
  // Reconnects append seat-assigned without changing the searched position.
  // Compare the turn/ply/board so metadata cannot repeatedly discard replies.
  const samePosition = () =>
    room.projection.state.ply === state.ply &&
    room.projection.state.board.every((color, index) => color === state.board[index]);
  const turn = createReplyTurn(
    room,
    () => engineToMove(room, seat) && room.projection.seats[seat] === engineId,
    samePosition,
  );
  const isCurrent = turn.current;
  const startedAt = Date.now();
  const clock = room.projection.clock;
  const remainingMs = clock ? tenantClockRemainingMs(clock, seat, Date.now()) : null;
  const tier = RAPFI_LEVELS[Number(engineId.at(-1)) - 1]!;
  const paceInput = {
    variant: 'gomoku',
    initialMs: clock?.initialMs,
    correspondence: room.projection.timeControl?.daysPerMove !== undefined,
    roomId: room.id,
    ply: state.ply,
    // The bot only moves while playing, where every empty point is legal.
    legalCount: state.board.filter((point) => point === null).length,
    remainingMs,
    incrementMs: clock?.incrementMs ?? 0,
    engineVsEngine: gomokuTenant.colors.every((color) =>
      isGomokuEngineClientId(room.projection.seats[color]),
    ),
  };
  const budgetInput = {
    ...paceInput,
    engineId,
    ceilingMs: tier.timeMs,
    flatReserveMs: 1_000,
    floorMs: 50,
  };
  let movetimeMs = liveBotMoveTime(budgetInput).movetimeMs;
  if (movetimeMs <= 0 || !isCurrent()) return;
  let budgetExhausted = false;
  let lastSearch: UciEval | null = null;
  thinking.add(room);
  try {
    const {
      chosen: move,
      aborted,
      attempts,
    } = await resolveValidatedEngineMove<GomokuMove>({
      maxAttempts: 2,
      requestMove: async () => {
        movetimeMs = liveBotMoveTime({
          ...budgetInput,
          waitedMs: Date.now() - startedAt,
        }).movetimeMs;
        if (movetimeMs <= 0) {
          budgetExhausted = true;
          return null;
        }
        return (
          (
            await provider(state, engineId, {
              isCurrent,
              movetimeMs,
              onSearch: ({ move, lines }) => {
                const chosen = parseRapfiOutput(lines).find(
                  (candidate) =>
                    String.fromCharCode(97 + candidate.move.x) + (candidate.move.y + 1) === move.to,
                );
                if (chosen)
                  lastSearch = {
                    best: move.to,
                    cp: chosen.forcedFive ? null : chosen.eval,
                    mate: chosen.forcedFive
                      ? (chosen.forcedFive.result === 'win' ? 1 : -1) *
                        Math.max(1, Math.ceil(chosen.forcedFive.plies / 2))
                      : null,
                    depth: chosen.depth,
                    nodes: chosen.totalNodes,
                    timeMs: chosen.timeMs,
                    pv: chosen.pv.map(
                      (point) => `${String.fromCharCode(97 + point.x)}${point.y + 1}`,
                    ),
                  };
              },
            })
          )?.to ?? null
        );
      },
      validate: (to) => {
        const candidate = parseGomokuMove(to);
        return candidate && gomokuTenant.rules.isLegalMove(state, candidate) ? candidate : null;
      },
      stillOnTurn: () => !budgetExhausted && isCurrent(),
      onReject: ({ attempt, reason, error }) =>
        logger.warn(
          { kind: 'gomoku_engine_move_rejected', room_id: room.id, attempt, reason, error },
          'Rapfi move rejected',
        ),
    });
    if (aborted) return;
    // Drain writes queued while awaiting the previous tail too. The stale-turn
    // check and enqueue below must follow every earlier pause/move/resignation.
    let writes: Promise<void>;
    do {
      writes = room.pendingWrites;
      await writes;
    } while (writes !== room.pendingWrites);
    if (!isCurrent()) return;
    // Engine forfeits use the shared engineFailureAbort summary path. Unlike
    // seat-resigned, they are excluded from results and ratings, even after the
    // pregame game-aborted window has closed. Never award an infrastructure win.
    if (!move)
      logger.warn(
        { kind: 'gomoku_engine_failed_closed', room_id: room.id },
        'Rapfi failed twice; aborting the game as an engine failure',
      );
    const thinkTimeMs = Date.now() - startedAt;
    const search = lastSearch as UciEval | null;
    const pace = replyPace({
      ...paceInput,
      cp: search?.cp ?? null,
      mate: search?.mate ?? null,
      computeMs: thinkTimeMs,
      ...(move === null ? { enabled: false } : {}),
    });
    if (!(await turn.wait(pace.waitMs))) return;
    do {
      writes = room.pendingWrites;
      await writes;
    } while (writes !== room.pendingWrites);
    if (!isCurrent()) return;
    const event = move
      ? { type: 'move-played' as const, at: Date.now(), roomId: room.id, color: seat, move }
      : { type: 'seat-forfeited' as const, at: Date.now(), roomId: room.id, color: seat };
    queueEngineDecision(room, {
      ...buildLiveEngineDecisionPayload({
        variant: 'gomoku',
        roomId: room.id,
        engineId,
        engineVersion: gomokuTenant.engine!.engineVersion!(engineId)!,
        seat,
        ply: state.ply,
        budgetMs: movetimeMs,
        remainingMs,
        incrementMs: paceInput.incrementMs,
        tier: { nodes: tier.nodes, movetimeMs: tier.timeMs },
        search: lastSearch,
        thinkTimeMs,
        attempts,
        move: move?.to ?? null,
        legalCount: paceInput.legalCount,
      }),
      ...replyPacePayload(pace),
    });
    const seq = await ctx.appendEvent(room, event);
    if (seq >= 0) ctx.broadcastEventAppended(room, event, seq);
  } finally {
    thinking.delete(room);
    // Pause/resume/undo can change the turn while a search is in flight.
    // Their scheduler saw `thinking`; arrange the current turn after cleanup.
    // Room disposal cancels the reply turn and must never restart its scheduler.
    if (!turn.cancelled()) scheduleGomokuEngineMove(ctx, room, provider);
  }
}
