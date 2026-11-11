/**
 * Flip Jungle (翻翻兽棋) live-room type aliases over the generic VariantTenant
 * runtime. Types only — the ws, factory, routes, and registration modules call the
 * generic tenant* helpers directly, bound to jungleFlipTenant.
 *
 * The tenant's C is the SEAT (JungleFlipSeat = 'red' | 'black', 'red' = first mover).
 * The red seat binds its ink on the opening flip and may end up owning the black ink
 * — the seat axis is distinct from the piece ink (mirrors banqi).
 */

import type {
  JUNGLE_FLIP_SPEC_ID,
  JungleFlipGameState,
  JungleFlipMove,
  JungleFlipSeat,
} from '@mistboard/game';
import type {
  TenantClientEvent,
  TenantClockState,
  TenantProjection,
  TenantRoomEvent,
  TenantRuntimeRoom,
  TenantSeat,
  TenantSnapshotClient,
} from './variant-tenant/tenant.js';

export type JungleFlipSpecId = typeof JUNGLE_FLIP_SPEC_ID;
export type JungleFlipTenantSeat = TenantSeat<JungleFlipSeat>;
export type JungleFlipCreatorPreference = JungleFlipSeat | 'random';
export type JungleFlipClockState = TenantClockState<JungleFlipSeat>;
export type JungleFlipEvent = TenantRoomEvent<JungleFlipSeat, JungleFlipMove, JungleFlipSpecId>;
export type JungleFlipClientEvent = TenantClientEvent<
  JungleFlipSeat,
  JungleFlipMove,
  JungleFlipSpecId
>;
export type JungleFlipProjection = TenantProjection<
  JungleFlipSeat,
  JungleFlipGameState,
  JungleFlipSpecId
>;
export type JungleFlipRuntimeRoom = TenantRuntimeRoom<
  'jungle-flip',
  JungleFlipSeat,
  JungleFlipMove,
  JungleFlipGameState,
  JungleFlipSpecId
>;
export type JungleFlipSnapshotClient = TenantSnapshotClient<JungleFlipSeat>;
