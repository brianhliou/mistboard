// Internal replay adapter. Its output never leaves the summary computation.
import {
  applyGameEvent,
  banqiMoveToEngineUci,
  fortressXiangqiMoveToFsfUci,
  type GameEvent,
  getAtomicXiangqiLegalMoves,
  getBanqiLegalMoves,
  getFortressXiangqiLegalMoves,
  getGomokuLegalMoves,
  getJieqiLegalMoves,
  getJungleFlipLegalMoves,
  getJungleLegalMoves,
  getStandardXiangqiLegalMoves,
  getThreeKingdomsBanqiLegalMoves,
  initialGameProjection,
  jungleFlipMoveToEngineUci,
  jungleMoveToEngineUci,
  maybeGameSpecForId,
  replayGameEvents,
  variantForId,
  xiangqiMoveToFsfUci,
  xiangqiMoveToPikafishUci,
} from '@mistboard/game';
import { atomicXiangqiTenant } from './atomic-xiangqi-tenant.js';
import { banqiTenant } from './banqi-tenant.js';
import type { FairPlayMove } from './fair-play-summary.js';
import { fortressXiangqiTenant } from './fortress-xiangqi-tenant.js';
import { gomokuTenant } from './gomoku-tenant.js';
import { isInternalEngineTestLog } from './internal-engine-test.js';
import type { JieqiEvent } from './jieqi-runtime.js';
import { jieqiPublicEvents, jieqiTenant } from './jieqi-tenant.js';
import { jungleFlipTenant } from './jungle-flip-tenant.js';
import { jungleTenant } from './jungle-tenant.js';
import { threeKingdomsBanqiTenant } from './three-kingdoms-banqi-tenant.js';
import {
  applyTenantEvent,
  isTenantEventLog,
  replayTenantEvents,
} from './variant-tenant/runtime.js';
import type { TenantGameStateLike, VariantTenant } from './variant-tenant/tenant.js';
import { xiangqiTenant } from './xiangqi-tenant.js';

function tenantMoves<
  K extends string,
  C extends string,
  M,
  S extends TenantGameStateLike<C>,
  V,
  Spec extends string,
>(
  tenant: VariantTenant<K, C, M, S, V, Spec>,
  events: readonly unknown[],
  roomId: string,
  legal: (state: S) => readonly M[],
  encode: (move: M) => string,
): FairPlayMove[] | null {
  if (!isTenantEventLog(tenant, events, roomId)) return null;
  if (replayTenantEvents(tenant, events).state.status.type !== 'finished') return null;
  let projection = replayTenantEvents(tenant, events.slice(0, 1));
  const moves: FairPlayMove[] = [];
  for (const event of events.slice(1)) {
    if (event.type === 'move-played') {
      const legalMoves = legal(projection.state).map(encode);
      const uci = encode(event.move);
      if (!legalMoves.includes(uci)) return null;
      moves.push({ color: event.color, uci, legalMoves });
    }
    projection = applyTenantEvent(tenant, projection, event);
  }
  return moves;
}

function fogMoves(events: readonly unknown[], roomId: string): FairPlayMove[] | null {
  const log = events as GameEvent[];
  if (log.some((event) => event.roomId !== roomId)) return null;
  const final = replayGameEvents(log);
  if (final.gameSpecId !== 'dark-chess' || final.state.status.type !== 'finished') return null;
  let projection = initialGameProjection(roomId);
  const moves: FairPlayMove[] = [];
  const encode = (move: { from: string; to: string; promotion?: string }) =>
    `${move.from}${move.to}${move.promotion ? (move.promotion === 'knight' ? 'n' : move.promotion[0]) : ''}`;
  for (const event of log) {
    if (event.type === 'move-played') {
      const legalMoves = variantForId('dark-chess')
        .getLegalMoves(projection.state, event.color)
        .map(encode);
      const uci = encode(event.move);
      if (!legalMoves.includes(uci)) return null;
      moves.push({ color: event.color, uci, legalMoves });
    }
    projection = applyGameEvent(projection, event);
  }
  return moves;
}

/** No analysis, unfinished logs and incompatible old rules remain visible as
 * missing/unavailable games. Never substitute another variant or run an engine. */
export function fairPlayMovesFromEvents(
  variant: string,
  events: readonly unknown[],
  roomId: string,
): FairPlayMove[] | null {
  if (!maybeGameSpecForId(variant)) throw new Error(`unknown game spec: ${variant}`);
  if (!events.length || isInternalEngineTestLog(events)) return null;
  try {
    // Hidden-deal games must never create a random replacement deal on replay.
    if (
      ['jieqi', 'banqi', 'jungle-flip', 'three-kingdoms-banqi'].includes(variant) &&
      !(events[0] as { setup?: unknown }).setup
    )
      return null;
    switch (variant) {
      case 'xiangqi':
        return tenantMoves(
          xiangqiTenant,
          events,
          roomId,
          getStandardXiangqiLegalMoves,
          xiangqiMoveToPikafishUci,
        );
      case 'jieqi':
        return tenantMoves(
          jieqiTenant,
          jieqiPublicEvents(events as JieqiEvent[]),
          roomId,
          getJieqiLegalMoves,
          xiangqiMoveToPikafishUci,
        );
      case 'banqi':
        return tenantMoves(banqiTenant, events, roomId, getBanqiLegalMoves, banqiMoveToEngineUci);
      case 'jungle':
        return tenantMoves(
          jungleTenant,
          events,
          roomId,
          getJungleLegalMoves,
          jungleMoveToEngineUci,
        );
      case 'jungle-flip':
        return tenantMoves(
          jungleFlipTenant,
          events,
          roomId,
          getJungleFlipLegalMoves,
          jungleFlipMoveToEngineUci,
        );
      case 'fortress-xiangqi':
        return tenantMoves(
          fortressXiangqiTenant,
          events,
          roomId,
          getFortressXiangqiLegalMoves,
          fortressXiangqiMoveToFsfUci,
        );
      case 'atomic-xiangqi':
        return tenantMoves(
          atomicXiangqiTenant,
          events,
          roomId,
          getAtomicXiangqiLegalMoves,
          xiangqiMoveToFsfUci,
        );
      case 'three-kingdoms-banqi':
        return tenantMoves(
          threeKingdomsBanqiTenant,
          events,
          roomId,
          getThreeKingdomsBanqiLegalMoves,
          (move) => `${move.from}${move.to}`,
        );
      case 'gomoku':
        return tenantMoves(
          gomokuTenant,
          events,
          roomId,
          (state) =>
            state.status.type === 'playing'
              ? getGomokuLegalMoves({ ...state, status: state.status })
              : [],
          (move) => move.to,
        );
      case 'dark-chess':
        return fogMoves(events, roomId);
      default:
        return null; // Known specs without stored whole-game analysis.
    }
  } catch {
    // Old-rule logs are evidence gaps, never a zero-loss sample.
    return null;
  }
}
