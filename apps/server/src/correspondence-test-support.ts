/**
 * Shared fixtures for the per-variant correspondence tests (unit and
 * persistent): every correspondence tenant other than dark chess, and a legal
 * move for whichever seat is to move, from the variant's own move generator.
 * The tenant contract has no generic legal-move list (only isLegalMove), so the
 * table below is the one place a test learns how each variant enumerates.
 */

import {
  getAtomicXiangqiLegalMoves,
  getBanqiLegalMoves,
  getCrazyhouseXiangqiLegalMoves,
  getDuckXiangqiLegalTurns,
  getFortressXiangqiLegalMoves,
  getJieqiLegalMoves,
  getJungleFlipLegalMoves,
  getJungleLegalMoves,
  getStandardXiangqiLegalMoves,
  getLegalMoves as getXiangqiPseudoLegalMoves,
} from '@mistboard/game';
import { atomicXiangqiTenant } from './atomic-xiangqi-tenant.js';
import { banqiTenant } from './banqi-tenant.js';
import { crazyhouseXiangqiTenant } from './crazyhouse-xiangqi-tenant.js';
import { darkXiangqiTenant } from './dark-xiangqi-tenant.js';
import { duckXiangqiTenant } from './duck-xiangqi-tenant.js';
import { fortressXiangqiTenant } from './fortress-xiangqi-tenant.js';
import { jieqiTenant } from './jieqi-tenant.js';
import { jungleFlipTenant } from './jungle-flip-tenant.js';
import { jungleTenant } from './jungle-tenant.js';
import type { TenantGameStateLike, VariantTenant } from './variant-tenant/tenant.js';
import { xiangqiTenant } from './xiangqi-tenant.js';

// Loose on purpose: the tests drive every tenant through one loop.
export type AnyTenant = VariantTenant<
  string,
  string,
  unknown,
  TenantGameStateLike<string>,
  unknown,
  string
>;

type MoveSource = (state: never) => readonly unknown[];

export const CORRESPONDENCE_TEST_TENANTS: Record<string, { tenant: AnyTenant; moves: MoveSource }> =
  {
    xiangqi: { tenant: xiangqiTenant as unknown as AnyTenant, moves: getStandardXiangqiLegalMoves },
    jieqi: { tenant: jieqiTenant as unknown as AnyTenant, moves: getJieqiLegalMoves },
    banqi: { tenant: banqiTenant as unknown as AnyTenant, moves: getBanqiLegalMoves },
    'duck-xiangqi': {
      tenant: duckXiangqiTenant as unknown as AnyTenant,
      moves: getDuckXiangqiLegalTurns,
    },
    'crazyhouse-xiangqi': {
      tenant: crazyhouseXiangqiTenant as unknown as AnyTenant,
      moves: getCrazyhouseXiangqiLegalMoves,
    },
    'fortress-xiangqi': {
      tenant: fortressXiangqiTenant as unknown as AnyTenant,
      moves: getFortressXiangqiLegalMoves,
    },
    'atomic-xiangqi': {
      tenant: atomicXiangqiTenant as unknown as AnyTenant,
      moves: getAtomicXiangqiLegalMoves,
    },
    // Fog Xiangqi plays plain xiangqi moves with no check rule (the tenant's
    // isLegalMove is the pseudo-legal one).
    'dark-xiangqi': {
      tenant: darkXiangqiTenant as unknown as AnyTenant,
      moves: getXiangqiPseudoLegalMoves,
    },
    jungle: { tenant: jungleTenant as unknown as AnyTenant, moves: getJungleLegalMoves },
    'jungle-flip': {
      tenant: jungleFlipTenant as unknown as AnyTenant,
      moves: getJungleFlipLegalMoves,
    },
  };

// Every server flag a correspondence tenant reads, on, so enabled() admits it.
export function enableCorrespondenceVariantFlags(): void {
  for (const name of [
    'MISTBOARD_CORRESPONDENCE_ENABLED',
    'MISTBOARD_XIANGQI_ENABLED',
    'MISTBOARD_JIEQI_ENABLED',
    'MISTBOARD_BANQI_ENABLED',
    'MISTBOARD_DUCK_XIANGQI_ENABLED',
    'MISTBOARD_CRAZYHOUSE_XIANGQI_ENABLED',
    'MISTBOARD_FORTRESS_XIANGQI_ENABLED',
    'MISTBOARD_ATOMIC_XIANGQI_ENABLED',
    'MISTBOARD_DARK_XIANGQI_ENABLED',
    'MISTBOARD_JUNGLE_ENABLED',
    'MISTBOARD_JUNGLE_FLIP_ENABLED',
  ]) {
    process.env[name] = 'true';
  }
}

// A legal move for the seat to move, as the ws move path would append it
// (canonicalMove when the tenant has one), checked against the tenant's own
// isLegalMove so a wrong table entry fails here rather than deep in a sweep.
export function legalMoveFor(specId: string, state: TenantGameStateLike<string>): unknown {
  const entry = CORRESPONDENCE_TEST_TENANTS[specId];
  if (!entry) throw new Error(`no correspondence test tenant for ${specId}`);
  const { tenant, moves } = entry;
  if (state.status.type !== 'playing') throw new Error(`${specId}: game is not in play`);
  const turn = (state.status as { turn: string }).turn;
  for (const candidate of moves(state as never)) {
    const move = tenant.rules.canonicalMove?.(state, candidate, turn) ?? candidate;
    if (move !== null && tenant.rules.isLegalMove(state, move)) return move;
  }
  throw new Error(`${specId}: no legal move for ${turn}`);
}
