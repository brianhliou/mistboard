import { FFQ_BANQI_SPEC_ID } from '@mistboard/game';
import { ffqBanqiEnabled } from './feature-flags.js';
import type { UserAccount } from './persistence.js';

// Reserve this namespace even before the tenant is registered. A missing
// registration must never turn an FFQ connection into a chess room.
export const FFQ_BANQI_ROOM_ID_PREFIX = 'ffq_';

// Discovery never advertises the playtest, even to admins with the flag on.
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

// Every FFQ door requires BOTH the runtime flag and an admin account, in
// local development as well as production. There is no flag-only bypass.
export function ffqBanqiAdmits(accountUser: Pick<UserAccount, 'accountRole'> | null): boolean {
  return ffqBanqiEnabled() && accountUser?.accountRole === 'admin';
}

export function isFFQBanqiRequest(input: { gameSpecId?: unknown; variant?: unknown }): boolean {
  return input.gameSpecId === FFQ_BANQI_SPEC_ID || input.variant === FFQ_BANQI_SPEC_ID;
}
