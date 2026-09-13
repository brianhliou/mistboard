import { type GameSpecId, maybeGameSpecForId } from '@mistboard/game';
import {
  banqiEnabled,
  darkXiangqiEnabled,
  duckXiangqiEnabled,
  fortressXiangqiEnabled,
  jieqiEnabled,
  jungleEnabled,
  jungleFlipEnabled,
  mahjongEnabled,
  xiangqiEnabled,
} from './feature-flags.js';

// The chess stack behind this gate serves exactly this spec. parseVariantId
// (routes/lib.ts) is the source of that truth: it collapses every variant
// string to 'dark-chess', so anything the gate passes lands there.
const CHESS_STACK_SPEC_IDS = ['dark-chess'] as const satisfies readonly GameSpecId[];
type ChessStackSpecId = (typeof CHESS_STACK_SPEC_IDS)[number];
const CHESS_STACK_SPEC_ID_SET: ReadonlySet<GameSpecId> = new Set(CHESS_STACK_SPEC_IDS);

// Every spec the chess stack cannot serve. Deriving the key set from the
// GameSpecId union makes the gate fail closed at compile time: a new union
// member refuses to build until it gets an entry in GATED_GAME_SPECS below
// (or joins CHESS_STACK_SPEC_IDS).
type GatedGameSpecId = Exclude<GameSpecId, ChessStackSpecId>;

type SnakeCase<S extends string> = S extends `${infer Head}-${infer Tail}`
  ? `${Head}_${SnakeCase<Tail>}`
  : S;

// Wire error strings are the spec id in snake_case. The `_disabled` strings
// are load-bearing: variant-tenant/rooms-route.ts and the bespoke Dark (Mini)
// Xiangqi handlers match them by equality, so they must not drift.
type GateSpecEntry<Id extends GatedGameSpecId> =
  | {
      // Launch flag from ./feature-flags.js: flag off answers 404 `_disabled`;
      // flag on but the tenant registry missed answers 501 `_not_integrated`.
      enabled(): boolean;
      disabledError: `${SnakeCase<Id>}_disabled`;
      notIntegratedError: `${SnakeCase<Id>}_not_integrated`;
    }
  // No launch flag yet (the runtimeStatus 'future' specs):
  // every request answers 501 `_not_integrated`.
  | { notIntegratedError: `${SnakeCase<Id>}_not_integrated` };

// Entries ordered as in the GameSpecId union (packages/game/src/game-specs.ts).
const GATED_GAME_SPECS = {
  // Registered, not built: no tenant, no route, no client. The gate rejects
  // every request for it, which is what 'gated' means at this stage.
  mahjong: {
    enabled: mahjongEnabled,
    disabledError: 'mahjong_disabled',
    notIntegratedError: 'mahjong_not_integrated',
  },
  'dark-xiangqi': {
    enabled: darkXiangqiEnabled,
    disabledError: 'dark_xiangqi_disabled',
    notIntegratedError: 'dark_xiangqi_not_integrated',
  },
  jieqi: {
    enabled: jieqiEnabled,
    disabledError: 'jieqi_disabled',
    notIntegratedError: 'jieqi_not_integrated',
  },
  banqi: {
    enabled: banqiEnabled,
    disabledError: 'banqi_disabled',
    notIntegratedError: 'banqi_not_integrated',
  },
  jungle: {
    enabled: jungleEnabled,
    disabledError: 'jungle_disabled',
    notIntegratedError: 'jungle_not_integrated',
  },
  'jungle-flip': {
    enabled: jungleFlipEnabled,
    disabledError: 'jungle_flip_disabled',
    notIntegratedError: 'jungle_flip_not_integrated',
  },
  'fortress-xiangqi': {
    enabled: fortressXiangqiEnabled,
    disabledError: 'fortress_xiangqi_disabled',
    notIntegratedError: 'fortress_xiangqi_not_integrated',
  },
  xiangqi: {
    enabled: xiangqiEnabled,
    disabledError: 'xiangqi_disabled',
    notIntegratedError: 'xiangqi_not_integrated',
  },
  'duck-xiangqi': {
    enabled: duckXiangqiEnabled,
    disabledError: 'duck_xiangqi_disabled',
    notIntegratedError: 'duck_xiangqi_not_integrated',
  },
} satisfies { readonly [Id in GatedGameSpecId]: GateSpecEntry<Id> };

type GateEntryUnion = (typeof GATED_GAME_SPECS)[GatedGameSpecId];
type GameSpecGateError =
  | Extract<GateEntryUnion, { disabledError: string }>['disabledError']
  | GateEntryUnion['notIntegratedError']
  | 'retired_game_spec'
  | 'unknown_game_spec';

export type GameSpecGateDecision =
  | { type: 'pass' }
  | {
      type: 'reject';
      error: GameSpecGateError;
      httpStatus: 404 | 410 | 501;
      wsCloseReason: string;
    };

// A retired spec (runtimeStatus 'retired' in packages/game) is refused before
// anything else looks at it: before the chess-stack branch and before the
// flag lookup, because a flag cannot bring a retired spec back. 410 rather
// than 404: the id is known and it is gone.
//
// The deleted Draft960 spellings are refused by name: parseVariantId would
// otherwise collapse them into a Fog Chess room, and a client that asked for
// the draft must not silently get a game without one.
const DELETED_DRAFT960_SPELLINGS: ReadonlySet<string> = new Set([
  'draft960',
  'dark-draft960',
  'fog-draft960',
]);

const REJECT_RETIRED: GameSpecGateDecision = {
  type: 'reject',
  error: 'retired_game_spec',
  httpStatus: 410,
  wsCloseReason: 'game spec retired',
};

export function gateGameSpecRequest(input: {
  gameSpecId?: unknown;
  variant?: unknown;
}): GameSpecGateDecision {
  // `gameSpecId` is the canonical selector. Absent (undefined, or null from
  // URLSearchParams.get on the WS path) passes; anything else must resolve to
  // a chess-stack spec.
  if (input.gameSpecId !== undefined && input.gameSpecId !== null) {
    const spec = typeof input.gameSpecId === 'string' ? maybeGameSpecForId(input.gameSpecId) : null;
    if (!spec) {
      return {
        type: 'reject',
        error: 'unknown_game_spec',
        httpStatus: 404,
        wsCloseReason: 'unknown game spec',
      };
    }
    if (spec.runtimeStatus === 'retired') return REJECT_RETIRED;
    if (!isChessStackSpecId(spec.id)) return rejectGatedSpec(spec.id);
  }
  // The legacy `variant` field only rejects when it names a known non-chess
  // spec or a deleted Draft960 spelling. Other free strings stay with
  // parseVariantId's collapse: legacy clients send 'fog' or arbitrary values
  // and rely on landing in dark chess.
  if (typeof input.variant === 'string') {
    if (DELETED_DRAFT960_SPELLINGS.has(input.variant)) {
      return {
        type: 'reject',
        error: 'unknown_game_spec',
        httpStatus: 404,
        wsCloseReason: 'unknown game spec',
      };
    }
    const spec = maybeGameSpecForId(input.variant);
    if (spec?.runtimeStatus === 'retired') return REJECT_RETIRED;
    if (spec && !isChessStackSpecId(spec.id)) return rejectGatedSpec(spec.id);
  }
  return { type: 'pass' };
}

function isChessStackSpecId(id: GameSpecId): id is ChessStackSpecId {
  return CHESS_STACK_SPEC_ID_SET.has(id);
}

function rejectGatedSpec(id: GatedGameSpecId): GameSpecGateDecision {
  const entry = GATED_GAME_SPECS[id];
  if ('enabled' in entry && !entry.enabled()) {
    return {
      type: 'reject',
      error: entry.disabledError,
      httpStatus: 404,
      wsCloseReason: 'game spec disabled',
    };
  }
  return {
    type: 'reject',
    error: entry.notIntegratedError,
    httpStatus: 501,
    wsCloseReason: 'game spec not integrated',
  };
}
