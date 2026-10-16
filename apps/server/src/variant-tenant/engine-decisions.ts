/**
 * Per-move engine telemetry for tenant PvE rooms: one queue, one payload shape.
 *
 * Two things live here, and they exist for different reasons.
 *
 * `queueEngineDecision` is the WRITE path. It does not write. A tenant room has
 * no `games` row until the game finishes (the tenants that omit recordGameStart
 * insert theirs at game end) and `game_debug_artifacts.game_id` is a foreign key
 * onto that row, so a write at move time fails the FK on every ply — which is
 * exactly what the first prod attempt did on 2026-09-02. So each decision is
 * parked on the room and `appendTenantEvent` flushes the queue right after
 * `recordGameEnd` succeeds (events.ts). Two consequences the callers must know:
 * queue BEFORE the append, because a mating move finishes the game and flushes
 * inside that same append; and an aborted room drops its queue, since there is
 * no game row to hang the artifacts on.
 *
 * `buildLiveEngineDecisionPayload` is the SHAPE. It wraps
 * `buildEngineDecisionRecord` — the record the fail-closed path already
 * builds — so a successful move and a failed one describe the engine the same
 * way, and adds the three things only a success has: what the server allocated,
 * what the engine actually consumed, and what got played.
 *
 * The single question this whole file exists to answer is `nodes` reached
 * against `tier_nodes` configured, and `search.time_ms` against `movetime_ms`.
 * Fog xiangqi spent ~1.8% of its allotted budget for weeks because a 64-iteration
 * cap made its deadline check unreachable, and nothing persisted could say so.
 */

import { buildEngineDecisionRecord, type EngineMoveAttempt } from '../engine-move-guard.js';
import {
  type GameDebugArtifactInput,
  LIVE_ENGINE_DECISION_ARTIFACT_TYPE,
} from '../persistence-game-lifecycle.js';
import type { UciEval } from '../uci-engine-harness.js';

/** Longest game the queue will hold; past this the OLDEST decisions are kept. */
export const MAX_QUEUED_ENGINE_DECISIONS = 400;

/** Stored pv length in the per-move artifact; enough to read the engine's plan. */
const DECISION_PV_MAX_PLIES = 8;

/**
 * The only room fields the queue touches. Structural rather than a `Pick` of
 * TenantRuntimeRoom so the dark-xiangqi room type (its own shape, not a tenant
 * runtime room) and a test's two-field stub both satisfy it.
 */
export type EngineDecisionQueueRoom = {
  id: string;
  pendingDebugArtifacts?: GameDebugArtifactInput[];
};

/**
 * Park one engine decision on the room for the tenant event writer to persist at
 * game end. See the module comment for why this cannot write at move time.
 *
 * The cap keeps the OLDEST entries: a game long enough to hit 400 engine moves
 * has already told you what its engine does per move, and the opening plies are
 * the ones an investigation replays from.
 */
export function queueEngineDecision(
  room: EngineDecisionQueueRoom,
  payload: Record<string, unknown>,
): void {
  if (!room.pendingDebugArtifacts) room.pendingDebugArtifacts = [];
  const queue = room.pendingDebugArtifacts;
  if (queue.length >= MAX_QUEUED_ENGINE_DECISIONS) return;
  queue.push({
    gameId: room.id,
    ply: typeof payload.ply === 'number' ? payload.ply : null,
    // Seat colour rides in the payload instead: the artifacts table's
    // engine_color column is chess-typed (white/black) and these tenants seat
    // red/black, so a xiangqi or banqi seat has nowhere legal to go in it.
    engineColor: null,
    artifactType: LIVE_ENGINE_DECISION_ARTIFACT_TYPE,
    payload,
  });
}

export type LiveEngineDecisionInput = {
  variant: string;
  roomId: string;
  engineId: string;
  engineVersion: string;
  /** Seat the engine played, in the variant's own colours (red/black, …). */
  seat: string;
  /** The game's ply count when the engine was asked (the move played is ply+1). */
  ply: number;
  /**
   * What the SERVER allocated for this move: the movetime handed to the engine.
   * Null for an engine the server gives no time budget at all (the in-process
   * jungle search is depth-limited, not time-limited) — null and 0 mean very
   * different things here, so an unbudgeted engine must not report zero.
   */
  budgetMs: number | null;
  remainingMs: number | null;
  incrementMs: number;
  /** The rung's configured limits, whichever of them this engine family carries. */
  tier?: { skill?: number; depth?: number; nodes?: number; movetimeMs?: number } | null;
  /** What the engine actually did; null for engines that report no search. */
  search?: UciEval | null;
  /** Wall time from the first request to the accepted result, all attempts. */
  thinkTimeMs: number;
  attempts: readonly EngineMoveAttempt[];
  /** Move played, in engine UCI; null when the engine failed closed. */
  move: string | null;
  /** Position the engine was handed, for engines fed a FEN. */
  fen?: string | null;
  /** Size of the kernel's legal set at this ply. */
  legalCount?: number;
  /** A guard or fallback replaced the engine's own move with a different one. */
  guardReplaced?: boolean;
  /** Why a guard acted (or chose not to replace the move); null when it did nothing. */
  guardReason?: string | null;
  /** The guard's own record (what it excluded, the re-search it ran). */
  guardDetail?: Record<string, unknown> | null;
};

/**
 * The `live-engine-decision` payload for one engine turn. Flat and snake_case,
 * matching the fog/chess writer's and standard xiangqi's.
 *
 * `history` and `legal_moves` are deliberately dropped from the record: the
 * fail-closed path writes them once, but a per-move artifact would write the
 * whole game into every ply's row, and both are derivable from the event log.
 * `legal_count` survives because the count is what triage actually reads.
 */
export function buildLiveEngineDecisionPayload(
  input: LiveEngineDecisionInput,
): Record<string, unknown> {
  const record = buildEngineDecisionRecord({
    variant: input.variant,
    roomId: input.roomId,
    engineId: input.engineId,
    engineVersion: input.engineVersion,
    movetimeMs: input.budgetMs ?? 0,
    ...(input.tier ? { tier: input.tier } : {}),
    ply: input.ply,
    toMove: input.seat,
    // Diagnostic-only on the success path; these loops do not all expose an
    // in-check predicate and none of them branch on it here.
    inCheck: false,
    fen: input.fen ?? null,
    history: [],
    legalUci: [],
    attempts: [...input.attempts],
  });
  const search = input.search ?? null;
  return {
    variant: record.variant,
    room_id: record.room_id,
    engine_id: record.engine_id,
    engine_version: record.engine_version,
    revision: record.revision,
    // The artifacts table's engine_color column is chess-typed, so the seat
    // travels here (and duplicates the record's `to_move`, which readers of the
    // fail-closed record already key on).
    engine_seat: input.seat,
    to_move: record.to_move,
    ply: record.ply,
    fen: record.fen,
    move: input.move,
    engine_move: search?.best ?? null,
    guard_replaced: input.guardReplaced ?? false,
    guard_reason: input.guardReason ?? null,
    guard_detail: input.guardDetail ?? null,
    failed_closed: input.move === null,
    // What the SERVER allotted this move, against what the tier is configured
    // for below and what the search actually spent further down. Those three
    // numbers disagreeing is the whole diagnostic.
    movetime_ms: input.budgetMs,
    remaining_ms: input.remainingMs,
    increment_ms: input.incrementMs,
    think_time_ms: input.thinkTimeMs,
    legal_count: input.legalCount ?? null,
    attempts: record.attempts,
    reject_reason: record.reject_reason,
    last_output: record.last_output,
    attempts_detail: record.attempts_detail,
    unreachable: record.unreachable,
    tier_skill: record.tier_skill,
    // buildEngineDecisionRecord's tier fields predate the depth-capped rungs
    // (jieqi, the FSF ladders), so depth is carried alongside them rather than
    // silently lost.
    tier_depth: input.tier?.depth ?? null,
    tier_nodes: record.tier_nodes,
    tier_movetime_ms: record.tier_movetime_ms,
    search:
      search === null
        ? null
        : {
            depth: search.depth,
            nodes: search.nodes ?? null,
            time_ms: search.timeMs ?? null,
            cp: search.cp,
            mate: search.mate,
            pv: (search.pv ?? []).slice(0, DECISION_PV_MAX_PLIES),
          },
  };
}
