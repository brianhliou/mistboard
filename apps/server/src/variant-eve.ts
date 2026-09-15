// Engine-vs-engine (EvE) game loop for tenant variants, driven by a per-variant
// adapter.
//
// This is the loop that rates a bot ladder: `engine:enqueue-tournament` queues
// pairings, the engine worker plays each one through `playVariantEngineGame`,
// and `engine:elo-report` / `engine:bot-rating-import` turn the results into
// the published bot ratings. It used to exist for standard xiangqi only
// (xiangqi-engine-game.ts, now a thin wrapper), which is why the fortress and
// duck ladders shipped hand-interpolated and unmeasured: nothing could play them
// against each other. A new variant becomes rateable by registering an adapter
// in variant-eve-registry.ts, and variant-eve-registry.test.ts fails the build
// for any tenant that offers an engine ladder without one.
//
// The adapter is the five things the loop cannot know about a variant: how to
// replay its events (the tenant), how to enumerate legal moves, how a move
// round-trips to the engine's UCI dialect, how to ask the engine, and the
// selection rules the LIVE path applies around the search. The last one is the
// important one: a rating is only meaningful if the rated bot is the bot a
// player is offered, so the immediate-loss guard (xiangqi, fortress) and the
// take-the-win scan (duck) run here exactly as they do in the live room.

import { replayTenantEvents } from './variant-tenant/runtime.js';
import type {
  TenantGameStateLike,
  TenantRoomEvent,
  VariantTenant,
} from './variant-tenant/tenant.js';

export type VariantEveTier = {
  id: string;
  movetimeMs: number;
};

export type VariantEveAdapter<
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  Spec extends string,
> = {
  /** `games.variant` for the EvE rows, and the first-party bot map key. */
  gameSpecId: Spec;
  /** Seat colours, first mover first. eve_games names the first-mover slot white_engine_id. */
  colors: readonly [C, C];
  // biome-ignore lint/suspicious/noExplicitAny: the loop never reads Kind or View.
  tenant: VariantTenant<any, C, M, State, any, Spec>;
  /** Resolve an engine id to its playing tier; null for engines this variant cannot play. */
  tierFor(engineId: string | undefined): VariantEveTier | null;
  /** The EvE-only uniformly-random mover, the 0-Elo anchor. Never player-facing. */
  randomEngineId?: string;
  legalMoves(state: State): readonly M[];
  moveToUci(move: M): string;
  legalMoveForUci(legalMoves: readonly M[], uci: string): M | null;
  /** Ask the engine for a move given the UCI history from the start position. */
  search(
    engineId: string,
    history: string[],
    opts: { movetimeMs: number },
  ): Promise<{ best: string | null }>;
  /**
   * Live-path selection that runs BEFORE the search and replaces it when it
   * returns a move (duck: capture the general on offer without searching).
   */
  beforeSearch?(state: State, legalMoves: readonly M[], color: C): M | null;
  /**
   * Live-path selection that runs AFTER the search on the validated move
   * (xiangqi, fortress: swap a move that hangs mate-in-one for one that does not).
   */
  guard?(state: State, chosen: M, legalMoves: readonly M[]): M;
};

// biome-ignore lint/suspicious/noExplicitAny: registry slot; call sites narrow through the adapter's own methods.
export type AnyVariantEveAdapter = VariantEveAdapter<any, any, any, any>;

export type VariantEveMoveRequest<M> = {
  engineId: string;
  history: string[];
  legalMoves: readonly M[];
  tier: VariantEveTier;
};

/** Returns the engine's move as UCI, or null when it has none. Injectable for tests. */
export type VariantEveMoveProvider<M> = (
  request: VariantEveMoveRequest<M>,
) => Promise<string | null>;

export type VariantEveGameResult<C extends string, M, Spec extends string> = {
  events: TenantRoomEvent<C, M, Spec>[];
  plyCount: number;
  result: `${C}-wins` | 'draw' | null;
  status: 'completed' | 'aborted';
  termination: string;
  totalThinkTimeMs: number;
};

export type VariantEveGameInput<C extends string, M, Spec extends string> = {
  firstEngineId: string;
  secondEngineId: string;
  maxPlies: number;
  moveProvider?: VariantEveMoveProvider<M>;
  onEvent?: (event: TenantRoomEvent<C, M, Spec>, seq: number) => Promise<void>;
  openingPolicy?: Record<string, unknown>;
  roomId: string;
  startedAt?: number;
  /** Uniform random source for the random mover; injectable for deterministic tests. */
  rng?: () => number;
};

export async function playVariantEngineGame<
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  Spec extends string,
>(
  adapter: VariantEveAdapter<C, M, State, Spec>,
  input: VariantEveGameInput<C, M, Spec>,
): Promise<VariantEveGameResult<C, M, Spec>> {
  const [first, second] = adapter.colors;
  const firstTier = requiredTier(adapter, input.firstEngineId);
  const secondTier = requiredTier(adapter, input.secondEngineId);
  const startedAt = input.startedAt ?? Date.now();
  const moveProvider = input.moveProvider ?? defaultMoveProvider(adapter);
  const rng = input.rng ?? Math.random;
  type Event = TenantRoomEvent<C, M, Spec>;
  const events: Event[] = [
    { type: 'room-created', at: startedAt, roomId: input.roomId, gameSpecId: adapter.gameSpecId },
    {
      type: 'seat-assigned',
      at: startedAt,
      roomId: input.roomId,
      clientId: input.firstEngineId,
      seat: first,
    },
    {
      type: 'seat-assigned',
      at: startedAt,
      roomId: input.roomId,
      clientId: input.secondEngineId,
      seat: second,
    },
  ];
  const history: string[] = [];
  let totalThinkTimeMs = 0;
  for (let seq = 0; seq < events.length; seq++) {
    await input.onEvent?.(events[seq]!, seq);
  }

  const replay = () => replayTenantEvents(adapter.tenant, events).state as State;
  const push = async (event: Event) => {
    events.push(event);
    await input.onEvent?.(event, events.length - 1);
  };

  // Forced random opening: a paired seed gives both colour orders of a pairing
  // the same prefix, so the engines are compared on the same positions.
  const openingPlies = randomOpeningPlies(input.openingPolicy);
  let openingSeed = seedFrom(input.openingPolicy?.seed);
  while (history.length < Math.min(openingPlies, input.maxPlies)) {
    const state = replay();
    if (state.status.type !== 'playing') break;
    const legalMoves = adapter.legalMoves(state);
    if (legalMoves.length === 0) break;
    const move = legalMoves[Number(openingSeed % BigInt(legalMoves.length))]!;
    openingSeed = nextSeed(openingSeed);
    history.push(adapter.moveToUci(move));
    await push({
      type: 'move-played',
      at: startedAt + history.length,
      roomId: input.roomId,
      color: state.status.turn,
      move,
    });
  }

  while (history.length < input.maxPlies) {
    const state = replay();
    if (state.status.type === 'finished') {
      const winner = state.status.winner;
      return {
        events,
        plyCount: history.length,
        result: winner === null ? 'draw' : `${winner}-wins`,
        status: 'completed',
        termination: state.status.reason,
        totalThinkTimeMs,
      };
    }
    if (state.status.type !== 'playing') {
      return aborted(events, history.length, 'invalid-game-state', totalThinkTimeMs);
    }

    const color = state.status.turn;
    const legalMoves = adapter.legalMoves(state);
    if (legalMoves.length === 0) {
      return aborted(events, history.length, 'no-legal-moves', totalThinkTimeMs);
    }
    const engineId = color === first ? input.firstEngineId : input.secondEngineId;
    const tier = color === first ? firstTier : secondTier;
    const isRandom = adapter.randomEngineId !== undefined && engineId === adapter.randomEngineId;

    let move: M | null = null;
    const thinkStartedAt = Date.now();
    if (isRandom) {
      // The floor is uniformly random and nothing else: no guard, no win scan.
      move = legalMoves[Math.min(legalMoves.length - 1, Math.floor(rng() * legalMoves.length))]!;
    } else {
      move = adapter.beforeSearch?.(state, legalMoves, color) ?? null;
      if (move === null) {
        const uci = await moveProvider({ engineId, history: [...history], legalMoves, tier });
        move = uci === null ? null : adapter.legalMoveForUci(legalMoves, uci);
        if (move !== null && adapter.guard) move = adapter.guard(state, move, legalMoves);
      }
    }
    totalThinkTimeMs += Math.max(0, Date.now() - thinkStartedAt);
    if (move === null) {
      return aborted(events, history.length, 'engine-failure', totalThinkTimeMs);
    }
    history.push(adapter.moveToUci(move));
    await push({
      type: 'move-played',
      at: startedAt + Math.max(1, totalThinkTimeMs),
      roomId: input.roomId,
      color,
      move,
    });
  }

  return {
    events,
    plyCount: history.length,
    result: 'draw',
    status: 'completed',
    termination: 'truncated',
    totalThinkTimeMs,
  };
}

function requiredTier<
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  Spec extends string,
>(adapter: VariantEveAdapter<C, M, State, Spec>, engineId: string): VariantEveTier {
  if (adapter.randomEngineId !== undefined && engineId === adapter.randomEngineId) {
    return { id: engineId, movetimeMs: 0 };
  }
  const tier = adapter.tierFor(engineId);
  if (!tier) throw new Error(`engine ${engineId} is not a ${adapter.gameSpecId} engine profile`);
  return tier;
}

function defaultMoveProvider<
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  Spec extends string,
>(adapter: VariantEveAdapter<C, M, State, Spec>): VariantEveMoveProvider<M> {
  return async (request) => {
    const { best } = await adapter.search(request.engineId, request.history, {
      movetimeMs: request.tier.movetimeMs,
    });
    return best;
  };
}

function aborted<C extends string, M, Spec extends string>(
  events: TenantRoomEvent<C, M, Spec>[],
  plyCount: number,
  termination: string,
  totalThinkTimeMs: number,
): VariantEveGameResult<C, M, Spec> {
  return { events, plyCount, result: null, status: 'aborted', termination, totalThinkTimeMs };
}

function randomOpeningPlies(policy: Record<string, unknown> | undefined): number {
  if (policy?.kind !== 'random_first_n_plies') return 0;
  const n = policy.n;
  return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : 0;
}

function seedFrom(value: unknown): bigint {
  if (typeof value === 'string') {
    try {
      return BigInt(value);
    } catch {
      let hash = 1469598103934665603n;
      for (const char of value) hash = (hash ^ BigInt(char.codePointAt(0)!)) * 1099511628211n;
      return hash & ((1n << 63n) - 1n);
    }
  }
  return 1n;
}

function nextSeed(seed: bigint): bigint {
  return (seed * 6364136223846793005n + 1442695040888963407n) & ((1n << 63n) - 1n);
}
