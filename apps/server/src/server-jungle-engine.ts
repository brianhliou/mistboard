/**
 * Built-in Jungle (Dou Shou Qi) PvE loop.
 *
 * Jungle is perfect-information and deterministic with a ~20 branching factor, so
 * the bot is a plain depth-limited alpha-beta search over the rules kernel — no
 * Python, no Fairy-Stockfish (FSF has no Dou Shou Qi variant). These tiers run
 * IN-PROCESS and inject moves through the same tenant append+broadcast path as a
 * human move.
 */

import {
  applyJungleMove,
  createInitialJungleState,
  getJungleLegalMoves,
  isJungleLegalMove,
  JUNGLE_DENS,
  type JUNGLE_SPEC_ID,
  type JungleColor,
  type JungleGameState,
  type JungleMove,
  type JunglePieceRole,
  type JungleSquare,
  jungleCoordOf,
  jungleRepSeedFens,
  jungleTrapOwner,
  oppositeJungleColor,
} from '@mistboard/game';
import { sendEngineAlertNotification } from './engine-alert-email.js';
import {
  buildEngineDecisionRecord,
  reportEngineFallback,
  reportEngineMoveOk,
  resolveValidatedEngineMove,
} from './engine-move-guard.js';
import { budgetForMove } from './engine-time-budget.js';
import {
  JUNGLE_RUST_ENGINE_VERSION,
  jungleEngineBinaryAvailable,
  jungleLiveEngineMove,
  jungleRustEngineEnabled,
  jungleRustTierFor,
} from './jungle-engine.js';
import {
  engineUciToJungleMove,
  jungleMoveToEngineUci,
  jungleStateToEngineFen,
} from './jungle-fen.js';
import { logger } from './obs.js';
import type { UciEval } from './uci-engine-harness.js';
import {
  buildLiveEngineDecisionPayload,
  queueEngineDecision,
} from './variant-tenant/engine-decisions.js';
import type { TenantLifecycleContext } from './variant-tenant/lifecycle.js';
import { tenantClockRemainingMs } from './variant-tenant/runtime.js';
import type { TenantRoomEvent } from './variant-tenant/tenant.js';
import type { TenantLiveRoom } from './variant-tenant/ws.js';

// Engine-move boundary (see engine-move-guard.ts) for the Rust path.
const CLOCK_SAFETY_MS = 1_000;
const MIN_MOVETIME_MS = 50;
const ENGINE_MOVE_MAX_ATTEMPTS = 2;

export const JUNGLE_ENGINE_VERSION = '0.1.0';

// Jungle ships ONE bot (2026-07-27). `misty-jungle-level-2` is it, at full strength;
// levels 1 and 3 are RETIRED — no new game may be created against them. They stay
// defined because engine ids are persisted: games played before the collapse carry a
// retired id in their seats, and replay, postgame pve-vs-pvp detection, and engine
// attribution all ask "is this seat an engine?" of those old rows. Deleting the ids
// would answer "no" and silently reclassify finished games as PvP.
//
// Hence two predicates, deliberately different:
//   isJunglePlayableEngineClientId — may a NEW room be created against this id? (one id)
//   isJungleEngineClientId         — is this seat an engine at all? (every id, ever)
// The create route takes the first; the tenant runtime takes the second. Collapsing
// them back into one is the bug this split exists to prevent.
// There is no "default" any more — with one bot, default and only are the same thing.
export const JUNGLE_PLAYABLE_ENGINE_ID = 'misty-jungle-level-2';
export const JUNGLE_RETIRED_ENGINE_IDS: readonly string[] = [
  'misty-jungle-level-1',
  'misty-jungle-level-3',
];

type JungleEngineRoom = TenantLiveRoom<
  'jungle',
  JungleColor,
  JungleMove,
  JungleGameState,
  typeof JUNGLE_SPEC_ID
>;
type JungleEngineContext = TenantLifecycleContext<
  JungleColor,
  JungleMove,
  JungleGameState,
  typeof JUNGLE_SPEC_ID,
  JungleEngineRoom
>;

export type JungleEngineTier = {
  id: string;
  name: string;
  version: string;
  depth: number;
  // Easy tiers don't always pick the best move: choose the Nth move within
  // `softPickWindow` of the best score (0/0 = always best).
  softPickRank: number;
  softPickWindow: number;
};

// Every jungle engine id that has ever been seated, playable or retired — this is the
// HISTORICAL set, not a menu (see JUNGLE_PLAYABLE_ENGINE_ID above). These depths drive
// the in-process TS search, which serves only when MISTBOARD_JUNGLE_RUST_ENGINE is off
// (dev); production runs the Rust binary's node budgets in jungle-engine.ts.
//
// The playable tier searches one ply deeper than it used to: with the ladder gone there
// is no rung above it to leave room for, and the whole point of collapsing to one bot is
// that the one bot is the strongest one. The retired tiers keep the depths they shipped
// with, so a legacy room that somehow resumes plays as it originally did.
export const JUNGLE_ENGINE_TIERS: readonly JungleEngineTier[] = [
  {
    id: 'misty-jungle-level-1',
    name: 'Misty Jungle level 1',
    version: JUNGLE_ENGINE_VERSION,
    depth: 2,
    softPickRank: 2,
    softPickWindow: 60,
  },
  {
    id: JUNGLE_PLAYABLE_ENGINE_ID,
    name: 'Misty',
    version: JUNGLE_ENGINE_VERSION,
    depth: 4,
    softPickRank: 0,
    softPickWindow: 0,
  },
  {
    id: 'misty-jungle-level-3',
    name: 'Misty Jungle level 3',
    version: JUNGLE_ENGINE_VERSION,
    depth: 4,
    softPickRank: 0,
    softPickWindow: 0,
  },
];

const ENGINE_BY_ID = new Map(JUNGLE_ENGINE_TIERS.map((tier) => [tier.id, tier]));

// Overall piece strength. The rat is boosted well above its rank-1 floor: it kills
// the elephant and swims, so it carries outsized tactical weight.
const PIECE_VALUES: Record<JunglePieceRole, number> = {
  rat: 65,
  cat: 22,
  dog: 30,
  wolf: 40,
  leopard: 50,
  tiger: 75,
  lion: 90,
  elephant: 100,
};

const WIN = 1_000_000;
// Search-node ceiling per move; alpha-beta + capture ordering stays far below this
// at the shipped depths, but it bounds any pathological branch so a turn can't hang.
const NODE_CAP = 150_000;

export function jungleEngineTierFor(engineId: string | undefined): JungleEngineTier | null {
  if (!engineId) return null;
  return ENGINE_BY_ID.get(engineId) ?? null;
}

export function jungleEngineDisplayName(engineId: string): string {
  return jungleEngineTierFor(engineId)?.name ?? engineId;
}

export function jungleEngineVersion(engineId: string | undefined): string | null {
  return isJungleEngineClientId(engineId) ? JUNGLE_ENGINE_VERSION : null;
}

// "Is this seat an engine?" — true for retired ids too, because finished games still
// carry them. Used by the tenant runtime (replay, mode detection, forfeit exemption).
export function isJungleEngineClientId(clientId: string | undefined): boolean {
  return jungleEngineTierFor(clientId) !== null;
}

// "May a NEW room be created against this id?" — the create-route allowlist. Exactly one
// id passes; a retired id is rejected as invalid_engine rather than quietly honoured.
export function isJunglePlayableEngineClientId(clientId: string | undefined): boolean {
  return clientId === JUNGLE_PLAYABLE_ENGINE_ID;
}

export function jungleEngineSeatFor(room: JungleEngineRoom): JungleColor | null {
  for (const seat of ['red', 'black'] as const) {
    if (isJungleEngineClientId(room.projection.seats[seat])) return seat;
  }
  return null;
}

export function scheduleJungleEngineMove(ctx: JungleEngineContext, room: JungleEngineRoom): void {
  if (room.engineTimer) return;
  const seat = jungleEngineSeatFor(room);
  if (seat === null || !engineToMove(room, seat)) return;
  room.engineTimer = setTimeout(() => {
    room.engineTimer = null;
    void playJungleEngineMoveIfReady(ctx, room).catch((err) => {
      logger.error(
        { kind: 'jungle_engine_move_failure', room_id: room.id, error: (err as Error).message },
        'Jungle engine move failure',
      );
    });
  }, 0);
  room.engineTimer.unref();
}

/**
 * The move provider returns the whole search summary, not just the move, so the
 * decision artifact can record what the Rust engine actually did. Tests inject a
 * stub. The in-process TS search below has no provider: it IS the search.
 */
export type JungleEngineMoveProvider = (
  engineId: string,
  fen: string,
  opts: { nodes?: number; movetimeCapMs?: number; repSeedFens?: readonly string[] },
) => Promise<UciEval>;

export async function playJungleEngineMoveIfReady(
  ctx: JungleEngineContext,
  room: JungleEngineRoom,
  moveProvider: JungleEngineMoveProvider = jungleLiveEngineMove,
): Promise<void> {
  const seat = jungleEngineSeatFor(room);
  if (seat === null || !engineToMove(room, seat)) return;
  const engineId = room.projection.seats[seat]!;
  const tier = jungleEngineTierFor(engineId);
  if (!tier) return;

  const now = ctx.now?.() ?? Date.now();
  const clock = room.projection.clock;
  const remainingMs = clock ? tenantClockRemainingMs(clock, seat, now) : null;
  const incrementMs = clock?.incrementMs ?? 0;
  if (remainingMs !== null && remainingMs <= 0) return;

  // Rust `jungle-engine` binary is the intended engine when MISTBOARD_JUNGLE_RUST_ENGINE
  // is on. If it is intended but the binary is missing — a broken deploy the boot check
  // (engine-boot-check.ts) should already have alerted on — FAIL CLOSED (alert + resign
  // the engine seat) rather than SILENTLY substituting the weaker in-process TS search.
  // The silent downgrade was a fail-open that hid a missing binary; surfacing it is the
  // point. Routed through the shared fail-closed/observability boundary.
  if (jungleRustEngineEnabled() && jungleRustTierFor(engineId)) {
    if (!jungleEngineBinaryAvailable()) {
      await failClosedJungleBinaryMissing(ctx, room, seat, engineId);
      return;
    }
    await playJungleRustEngineMove(
      ctx,
      room,
      seat,
      engineId,
      remainingMs,
      incrementMs,
      moveProvider,
    );
    return;
  }

  // Flag off → the in-process TS engine is the DELIBERATE engine for jungle PvE (a config
  // choice, not a failure fallback). This path retires once jungle is Rust-mandatory in
  // every environment (flag on + binary provisioned).
  const startedAt = Date.now();
  const chosen = chooseJungleEngineMove(room.projection.state, tier);
  if (!chosen) {
    logger.error(
      { kind: 'jungle_engine_no_legal_move', room_id: room.id, engine_id: engineId },
      'Jungle engine had no legal move',
    );
    return;
  }
  if (!engineToMove(room, seat)) return;

  const event: TenantRoomEvent<JungleColor, JungleMove, typeof JUNGLE_SPEC_ID> = {
    type: 'move-played',
    at: Date.now(),
    roomId: room.id,
    color: seat,
    move: chosen,
  };
  // Queue BEFORE the append (a winning move finishes the game and flushes the
  // queue inside that same append). This path is a synchronous in-process search
  // with NO server time budget, so `movetime_ms` is null and there is no UCI
  // `search` block — which is itself the useful signal: an artifact with a null
  // budget and no search says the TS engine moved, not the Rust binary, and that
  // distinction was previously only visible in a boot-time flag.
  queueEngineDecision(
    room,
    buildLiveEngineDecisionPayload({
      variant: 'jungle',
      roomId: room.id,
      engineId,
      engineVersion: JUNGLE_ENGINE_VERSION,
      seat,
      ply: room.projection.state.moveNumber,
      budgetMs: null,
      remainingMs,
      incrementMs,
      tier: { depth: tier.depth },
      search: null,
      thinkTimeMs: Date.now() - startedAt,
      attempts: [],
      move: jungleMoveToEngineUci(chosen),
      legalCount: getJungleLegalMoves(room.projection.state).length,
    }),
  );
  const seq = await ctx.appendEvent(room, event);
  ctx.broadcastEventAppended(room, event, seq);
}

// Fail closed when the intended Rust engine's binary is missing: alert loudly (log +
// critical email) and resign the engine seat, instead of silently substituting the TS
// search. No engine decision record here — we never got far enough to produce a move; the
// alert_kind matches the boot check so both surface under one bucket.
async function failClosedJungleBinaryMissing(
  ctx: JungleEngineContext,
  room: JungleEngineRoom,
  seat: JungleColor,
  engineId: string,
): Promise<void> {
  logger.error(
    { kind: 'jungle_engine_binary_missing', room_id: room.id, engine_id: engineId },
    'Jungle Rust engine intended but its binary is missing; failing closed and resigning the engine seat',
  );
  void sendEngineAlertNotification({
    severity: 'critical',
    alert_kind: 'engine_binary_missing',
    variant: 'jungle',
    engine_id: engineId,
    room_id: room.id,
  });
  if (!engineToMove(room, seat)) return;
  const resign: TenantRoomEvent<JungleColor, JungleMove, typeof JUNGLE_SPEC_ID> = {
    type: 'seat-resigned',
    at: Date.now(),
    roomId: room.id,
    color: seat,
  };
  const seq = await ctx.appendEvent(room, resign);
  ctx.broadcastEventAppended(room, resign, seq);
}

// Rust-engine move with the engine-move-guard contract: bounded retries, validate
// every output against the kernel, FAIL CLOSED (resign + page) on an unusable move.
// Jungle is perfect-information, so a kernel-rejected move is a bug, not fog — resign
// (mirrors server-banqi-engine.ts).
async function playJungleRustEngineMove(
  ctx: JungleEngineContext,
  room: JungleEngineRoom,
  seat: JungleColor,
  engineId: string,
  remainingMs: number | null,
  incrementMs: number,
  moveProvider: JungleEngineMoveProvider,
): Promise<void> {
  const rustTier = jungleRustTierFor(engineId);
  if (!rustTier) return;
  const state = room.projection.state;
  const fen = jungleStateToEngineFen(state);
  const repSeedFens = jungleRepSeedFensForRoom(room);
  // Clock-aware per-move budget (shared allocator). Strength = the rust tier's NODE
  // budget; this movetime is the latency ceiling + time-pressure guard. Existing
  // ceiling preserved — behavior-neutral for untimed play; adds increment awareness.
  const { computeBudgetMs: movetimeCapMs } = budgetForMove({
    remainingMs,
    incrementMs,
    ceilingMs: rustTier.movetimeCapMs,
    reserveMs: CLOCK_SAFETY_MS,
    floorMs: MIN_MOVETIME_MS,
  });

  const startedAt = Date.now();
  let lastSearch: UciEval | null = null;
  const {
    chosen: validated,
    attempts,
    aborted,
  } = await resolveValidatedEngineMove<JungleMove>({
    maxAttempts: ENGINE_MOVE_MAX_ATTEMPTS,
    requestMove: async () => {
      const search = await moveProvider(engineId, fen, {
        nodes: rustTier.nodes,
        movetimeCapMs,
        repSeedFens,
      });
      lastSearch = search;
      return search.best;
    },
    validate: (uci) => {
      const parsed = engineUciToJungleMove(uci);
      return parsed && isJungleLegalMove(state, parsed) ? parsed : null;
    },
    stillOnTurn: () => engineToMove(room, seat),
    onReject: ({ attempt, maxAttempts, uci, reason, error }) =>
      logger.warn(
        {
          kind: 'jungle_engine_move_rejected',
          room_id: room.id,
          engine_id: engineId,
          attempt,
          max_attempts: maxAttempts,
          uci,
          reject_reason: reason,
          error,
        },
        'Jungle engine output rejected by kernel; retrying',
      ),
  });
  if (aborted || !engineToMove(room, seat)) return;

  if (validated === null) {
    // FAIL CLOSED: capture a replayable record, page, and resign the engine seat.
    const record = buildEngineDecisionRecord({
      variant: 'jungle',
      roomId: room.id,
      engineId,
      engineVersion: JUNGLE_RUST_ENGINE_VERSION,
      movetimeMs: movetimeCapMs,
      tier: { nodes: rustTier.nodes, movetimeMs: rustTier.movetimeCapMs },
      ply: state.moveNumber,
      toMove: seat,
      inCheck: false,
      fen,
      history: [],
      legalUci: getJungleLegalMoves(state).map(jungleMoveToEngineUci),
      attempts,
    });
    reportEngineFallback(record, 'jungle_engine_failed_closed', 'Jungle');
    const resign: TenantRoomEvent<JungleColor, JungleMove, typeof JUNGLE_SPEC_ID> = {
      type: 'seat-resigned',
      at: Date.now(),
      roomId: room.id,
      color: seat,
    };
    const seq = await ctx.appendEvent(room, resign);
    ctx.broadcastEventAppended(room, resign, seq);
    return;
  }

  reportEngineMoveOk();
  const event: TenantRoomEvent<JungleColor, JungleMove, typeof JUNGLE_SPEC_ID> = {
    type: 'move-played',
    at: Date.now(),
    roomId: room.id,
    color: seat,
    move: validated,
  };
  // Queue BEFORE the append: if this move ends the game, the tenant event writer
  // records the game end and flushes the queue inside that same append, and a
  // decision queued afterwards would never be written.
  queueEngineDecision(
    room,
    buildLiveEngineDecisionPayload({
      variant: 'jungle',
      roomId: room.id,
      engineId,
      engineVersion: JUNGLE_RUST_ENGINE_VERSION,
      seat,
      ply: state.moveNumber,
      budgetMs: movetimeCapMs,
      remainingMs,
      incrementMs,
      tier: { nodes: rustTier.nodes, movetimeMs: rustTier.movetimeCapMs },
      search: lastSearch,
      thinkTimeMs: Date.now() - startedAt,
      attempts,
      move: jungleMoveToEngineUci(validated),
      fen,
      legalCount: getJungleLegalMoves(state).length,
    }),
  );
  const seq = await ctx.appendEvent(room, event);
  ctx.broadcastEventAppended(room, event, seq);
}

/**
 * Replay the canonical event tape and seed every position already seen twice. The live
 * projection carries counts but not a FEN representative for each digest, so replay is the
 * single source for the engine wire context and matches postgame analysis.
 */
function jungleRepSeedFensForRoom(room: JungleEngineRoom): string[] {
  let state = createInitialJungleState(room.id);
  const states: JungleGameState[] = [state];
  for (const event of room.events) {
    if (event.type !== 'move-played') continue;
    state = applyJungleMove(state, event.move);
    states.push(state);
  }
  return jungleRepSeedFens(states);
}

export function chooseJungleEngineMove(
  state: JungleGameState,
  tier: JungleEngineTier,
): JungleMove | null {
  if (state.status.type !== 'playing') return null;
  const mover = state.status.turn;
  const budget = { nodes: 0 };
  const candidates = orderedMoves(state, mover)
    .map((move) => {
      const after = applyJungleMove(state, move);
      return {
        move,
        score: -negamax(after, tier.depth - 1, -WIN, WIN, oppositeJungleColor(mover), budget, 1),
      };
    })
    .sort((a, b) => b.score - a.score || moveKey(a.move).localeCompare(moveKey(b.move)));
  if (candidates.length === 0) return null;
  if (isWinningMove(state, candidates[0]!.move, mover)) return candidates[0]!.move;
  if (tier.softPickRank <= 0) return candidates[0]!.move;
  const bestScore = candidates[0]!.score;
  const softPool = candidates.filter((entry) => entry.score >= bestScore - tier.softPickWindow);
  return softPool[Math.min(tier.softPickRank, softPool.length - 1)]?.move ?? candidates[0]!.move;
}

// Negamax with alpha-beta. Returns the value from `mover`'s perspective. `ply` is the
// distance from the root, used for win-distance scoring: a terminal win/loss found
// sooner (smaller `ply`) scores more extreme. Without it every winning line ties at
// WIN-1, so the move ordering's alphabetical tie-break could pick a slower forced win
// over an immediate den entry — the engine would "dawdle" in a won position instead of
// finishing (observed in real PvE games).
function negamax(
  state: JungleGameState,
  depth: number,
  alpha: number,
  beta: number,
  mover: JungleColor,
  budget: { nodes: number },
  ply: number,
): number {
  if (state.status.type === 'finished') {
    if (state.status.winner === mover) return WIN - ply;
    if (state.status.winner === null) return 0;
    return -(WIN - ply);
  }
  if (state.status.type !== 'playing') return 0;
  budget.nodes += 1;
  if (depth <= 0 || budget.nodes > NODE_CAP) return evaluate(state, mover);

  let best = -WIN;
  for (const move of orderedMoves(state, mover)) {
    const value = -negamax(
      applyJungleMove(state, move),
      depth - 1,
      -beta,
      -alpha,
      oppositeJungleColor(mover),
      budget,
      ply + 1,
    );
    if (value > best) best = value;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

// Static evaluation from `perspective`'s side: material + advance-toward-the-enemy-den
// + trap vulnerability. Den distance is the dominant positional driver (the win is a
// race to the opponent's den).
function evaluate(state: JungleGameState, perspective: JungleColor): number {
  const opponent = oppositeJungleColor(perspective);
  const ownDen = jungleCoordOf(JUNGLE_DENS[perspective]);
  const enemyDen = jungleCoordOf(JUNGLE_DENS[opponent]);
  let score = 0;
  for (const [sq, piece] of Object.entries(state.board)) {
    if (!piece) continue;
    const value = PIECE_VALUES[piece.role];
    const { file, rank } = jungleCoordOf(sq as JungleSquare);
    const friendly = piece.color === perspective;
    score += friendly ? value : -value;
    // Advancement: reward our pieces closing on the enemy den, penalise theirs
    // closing on ours. Adjacency to the den is nearly decisive.
    const target = friendly ? enemyDen : ownDen;
    const dist = Math.abs(file - target.file) + Math.abs(rank - target.rank);
    const advance = dist <= 1 ? 200 : (16 - dist) * 1.5;
    score += friendly ? advance : -advance;
    // A piece on the OPPONENT's trap is rank 0 (capturable by anything): risky for us,
    // good when it's their piece sitting in our trap.
    if (jungleTrapOwner(sq as JungleSquare) === (friendly ? opponent : perspective)) {
      score += friendly ? -value * 0.5 : value * 0.5;
    }
  }
  return score;
}

// Captures first (then deterministic key order) so alpha-beta prunes hard.
function orderedMoves(state: JungleGameState, mover: JungleColor): JungleMove[] {
  const moves = getJungleLegalMoves({ ...state, status: { type: 'playing', turn: mover } });
  return moves
    .map((move) => ({ move, cap: state.board[move.to] ? 1 : 0 }))
    .sort((a, b) => b.cap - a.cap || moveKey(a.move).localeCompare(moveKey(b.move)))
    .map((entry) => entry.move);
}

function isWinningMove(state: JungleGameState, move: JungleMove, mover: JungleColor): boolean {
  const after = applyJungleMove(state, move);
  return after.status.type === 'finished' && after.status.winner === mover;
}

function bothSeatsFilled(room: JungleEngineRoom): boolean {
  return Boolean(room.projection.seats.red && room.projection.seats.black);
}

function engineToMove(room: JungleEngineRoom, seat: JungleColor): boolean {
  const status = room.projection.state.status;
  return status.type === 'playing' && status.turn === seat && bothSeatsFilled(room);
}

function moveKey(move: JungleMove): string {
  return `${move.from}-${move.to}`;
}
