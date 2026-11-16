import { FFQ_BANQI_SPEC_ID, gameSpecForId } from '@mistboard/game';
import { ffqBanqiEnabled } from './feature-flags.js';
import type { UserAccount } from './persistence.js';

// Reserve this namespace even before the tenant is registered. A missing
// registration must never turn an FFQ connection into a chess room.
export const FFQ_BANQI_ROOM_ID_PREFIX = 'ffq_';

// The reserved prefix also protects rows without variant metadata; the spec
// protects persisted legacy ids until every room is minted with that prefix.
export function isFFQBanqiGame(game: {
  roomId: string;
  variant?: string;
  gameSpecId?: string;
}): boolean {
  return (
    game.roomId.startsWith(FFQ_BANQI_ROOM_ID_PREFIX) ||
    game.variant === FFQ_BANQI_SPEC_ID ||
    game.gameSpecId === FFQ_BANQI_SPEC_ID
  );
}

// Play admission follows publicSurface; admins may test while it is hidden.
// The runtime flag remains a kill switch for live and casual correspondence.
export function ffqBanqiAdmits(accountUser: Pick<UserAccount, 'accountRole'> | null): boolean {
  return (
    ffqBanqiEnabled() &&
    (gameSpecForId(FFQ_BANQI_SPEC_ID).publicSurface !== 'hidden' ||
      accountUser?.accountRole === 'admin')
  );
}

// Insider reads stay flag + admin only, independently of play admission.
// Decided 2026-11-15 (#994): casual correspondence follows ffqBanqiAdmits.
export function ffqBanqiInsider(accountUser: Pick<UserAccount, 'accountRole'> | null): boolean {
  return ffqBanqiEnabled() && accountUser?.accountRole === 'admin';
}

export function isFFQBanqiRequest(input: { gameSpecId?: unknown; variant?: unknown }): boolean {
  return input.gameSpecId === FFQ_BANQI_SPEC_ID || input.variant === FFQ_BANQI_SPEC_ID;
}
