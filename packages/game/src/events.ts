import {
  clockPolicyKindFor,
  expireClock,
  freezeClock,
  nextClockForMove,
  unfreezeClock,
} from './clocks.js';
import {
  type GameSpecId,
  gameSpecForId,
  gameSpecForLegacyLiveRoom,
  maybeGameSpecForId,
} from './game-specs.js';
import type {
  AbortReason,
  ClockState,
  Color,
  GameState,
  Move,
  PieceRole,
  VariantId,
} from './types.js';
import { variantForId } from './variants.js';

export type RoomTimeControl = {
  initialMs: number;
  incrementMs: number;
  // Correspondence: per-move allowance in days. Presence selects the
  // days-per-move clock policy (see clockPolicyKindFor); initialMs mirrors the
  // allowance in ms so the clock state shape is reused verbatim on the wire.
  daysPerMove?: number;
};

export type GameEvent =
  | {
      type: 'room-created';
      at: number;
      roomId: string;
      // Legacy live rooms always set variant + offer. Variant-tenant logs are
      // spec-first: they carry gameSpecId only, and the reducer derives the
      // variant from the spec (the mirror of gameSpecIdForRoomCreatedEvent).
      // At least one of variant/gameSpecId must be present.
      variant?: VariantId;
      gameSpecId?: GameSpecId;
      timeControl?: RoomTimeControl;
      // Live-game placement region. Optional for old events; new live rooms set
      // it so future multi-region routing can remain replay-derived.
      region?: string;
      // Whether this room was created as a rated request. Persisted so hydration
      // after a restart preserves it; the actual rated outcome is still
      // account-gated at game end (see room-manager buildGameSummary).
      rated?: boolean;
      // Server-owned PvE bot attribution. The engine seat still records the
      // executable engine id; this preserves which bot profile requested it.
      pveBotId?: string;
    }
  | {
      type: 'seat-assigned';
      at: number;
      roomId: string;
      clientId: string;
      seat: Color;
    }
  | {
      type: 'seat-vacated';
      at: number;
      roomId: string;
      clientId: string;
      seat: Color;
    }
  | {
      type: 'clock-started';
      at: number;
      roomId: string;
      clock: ClockState;
    }
  | {
      type: 'move-played';
      at: number;
      roomId: string;
      color: Color;
      move: Move;
      capturedRole?: PieceRole;
      clock?: ClockState;
      thinkTimeMs?: number;
    }
  | {
      type: 'clock-expired';
      at: number;
      roomId: string;
      color: Color;
      clock: ClockState;
    }
  | {
      type: 'seat-resigned';
      at: number;
      roomId: string;
      color: Color;
      clock?: ClockState;
    }
  | {
      type: 'game-aborted';
      at: number;
      roomId: string;
      reason: AbortReason;
      clock?: ClockState;
    }
  | {
      type: 'seat-forfeited';
      at: number;
      roomId: string;
      color: Color;
      clock?: ClockState;
    }
  | {
      type: 'pause';
      at: number;
      roomId: string;
      reason: 'shutdown' | 'admin' | 'engine-error';
      clock?: ClockState;
    }
  | {
      type: 'resume';
      at: number;
      roomId: string;
      reason: 'both-present' | 'grace-elapsed' | 'admin';
      clock?: ClockState;
    };

export type GameProjection = {
  roomId: string;
  variant: VariantId;
  gameSpecId: GameSpecId;
  state: GameState;
  seats: Partial<Record<Color, string>>;
  timeControl?: RoomTimeControl;
  region?: string;
  paused: boolean;
  pausedAt: number | null;
  pauseReason: 'shutdown' | 'admin' | 'engine-error' | null;
};

export function initialGameProjection(
  roomId: string,
  variant: VariantId = 'chess',
): GameProjection {
  return {
    roomId,
    variant,
    gameSpecId: gameSpecForLegacyLiveRoom({ variant }).id,
    state: variantForId(variant).createInitialState(roomId),
    seats: {},
    paused: false,
    pausedAt: null,
    pauseReason: null,
  };
}

export function replayGameEvents(events: GameEvent[]): GameProjection {
  const firstRoomId = events[0]?.roomId ?? 'unknown-room';
  return events.reduce(
    (projection, event) => applyGameEvent(projection, event),
    initialGameProjection(firstRoomId),
  );
}

export function applyGameEvent(projection: GameProjection, event: GameEvent): GameProjection {
  if (event.roomId !== projection.roomId) return projection;

  if (event.type === 'room-created') {
    const gameSpecId = gameSpecIdForRoomCreatedEvent(event);
    // Spec-first (variant-tenant) logs omit variant; derive it from the spec's
    // chess-shell rules engine. Specs without one never replay here (the
    // xiangqi family has its own event union and reducer).
    const variant = event.variant ?? gameSpecForId(gameSpecId).legacyLiveRoom?.variant;
    if (!variant) {
      throw new Error(`room-created for ${gameSpecId} has no chess-family variant to replay`);
    }
    return {
      ...projection,
      variant,
      gameSpecId,
      timeControl: event.timeControl,
      region: event.region,
      state: variantForId(variant).createInitialState(event.roomId),
    };
  }

  if (event.type === 'seat-assigned') {
    return {
      ...projection,
      seats: {
        ...projection.seats,
        [event.seat]: event.clientId,
      },
    };
  }

  if (event.type === 'seat-vacated') {
    const beforeFirstMove =
      projection.state.moveNumber === 1 && projection.state.lastMove === undefined;
    if (!beforeFirstMove || projection.seats[event.seat] !== event.clientId) {
      return projection;
    }

    const seats = { ...projection.seats };
    delete seats[event.seat];

    return {
      ...projection,
      seats,
    };
  }

  if (event.type === 'clock-started') {
    if (projection.state.status.type !== 'playing' || projection.state.clock) return projection;
    return {
      ...projection,
      state: {
        ...projection.state,
        clock: event.clock,
      },
    };
  }

  if (event.type === 'move-played') {
    if (projection.state.status.type !== 'playing') return projection;
    if (projection.state.status.turn !== event.color) return projection;

    const prevMoveNumber = projection.state.moveNumber;
    const nextState = variantForId(projection.variant).applyMove(projection.state, event.move);
    if (nextState === projection.state) return projection;

    const nextClock = nextClockForMove(
      projection.state.clock,
      event.at,
      event.color,
      prevMoveNumber,
      nextState.status,
      clockPolicyKindFor(projection.timeControl),
    );

    return {
      ...projection,
      state: {
        ...nextState,
        clock: event.clock ?? nextClock,
      },
    };
  }

  if (event.type === 'clock-expired') {
    if (projection.state.status.type !== 'playing') return projection;
    if (projection.state.status.turn !== event.color) return projection;

    return {
      ...projection,
      state: {
        ...projection.state,
        clock: event.clock ?? expireClock(projection.state.clock, event.at, event.color),
        status: {
          type: 'finished',
          winner: event.color === 'white' ? 'black' : 'white',
          reason: 'timeout',
        },
      },
    };
  }

  if (event.type === 'seat-resigned') {
    if (projection.state.status.type !== 'playing') return projection;
    return {
      ...projection,
      state: {
        ...projection.state,
        status: {
          type: 'finished',
          winner: event.color === 'white' ? 'black' : 'white',
          reason: 'resignation',
        },
        clock: event.clock ?? freezeClock(projection.state.clock, event.at),
      },
    };
  }

  if (event.type === 'seat-forfeited') {
    // The player of `color` abandoned an in-progress game; the opponent wins.
    // Distinct from resignation only in reason ('abandonment') so PGN/analytics
    // can tell a deliberate resign from a disconnect forfeit.
    if (projection.state.status.type !== 'playing') return projection;
    return {
      ...projection,
      state: {
        ...projection.state,
        status: {
          type: 'finished',
          winner: event.color === 'white' ? 'black' : 'white',
          reason: 'abandonment',
        },
        clock: event.clock ?? freezeClock(projection.state.clock, event.at),
      },
    };
  }

  if (event.type === 'game-aborted') {
    // Abort is only valid before both players have completed their first move
    // (fewer than two plies; moveNumber increments to 2 on black's first move).
    if (projection.state.status.type !== 'playing') return projection;
    if (projection.state.moveNumber !== 1) return projection;
    return {
      ...projection,
      state: {
        ...projection.state,
        status: { type: 'aborted', reason: event.reason },
        clock: event.clock ?? freezeClock(projection.state.clock, event.at),
      },
    };
  }

  if (event.type === 'pause') {
    if (projection.state.status.type !== 'playing') return projection;
    if (projection.paused) return projection;
    return {
      ...projection,
      paused: true,
      pausedAt: event.at,
      pauseReason: event.reason,
      state: {
        ...projection.state,
        clock: event.clock ?? freezeClock(projection.state.clock, event.at),
      },
    };
  }

  if (event.type === 'resume') {
    if (!projection.paused) return projection;
    if (projection.state.status.type !== 'playing') return projection;
    const turn = projection.state.status.turn;
    // Don't arm a clock that never started ticking. Before both players have
    // completed their first move (moveNumber < 2) the clock is frozen-pregame,
    // which is indistinguishable from a pause-frozen clock; resuming must leave
    // it frozen rather than start the side-to-move's clock prematurely.
    const resumedClock =
      projection.state.moveNumber >= 2
        ? unfreezeClock(projection.state.clock, event.at, turn)
        : projection.state.clock;
    return {
      ...projection,
      paused: false,
      pausedAt: null,
      pauseReason: null,
      state: {
        ...projection.state,
        clock: event.clock ?? resumedClock,
      },
    };
  }

  return projection;
}

function gameSpecIdForRoomCreatedEvent(
  event: Extract<GameEvent, { type: 'room-created' }>,
): GameSpecId {
  const bySpecId = maybeGameSpecForId(event.gameSpecId)?.id;
  if (bySpecId) return bySpecId;
  if (!event.variant) {
    throw new Error(`room-created event has neither a known gameSpecId nor a variant`);
  }
  return gameSpecForLegacyLiveRoom({ variant: event.variant }).id;
}
