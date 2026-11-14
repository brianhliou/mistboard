import { FFQ_BANQI_SPEC_ID, gameSpecForId } from '@mistboard/game';
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

// The final launch changes publicSurface; until then the runtime flag still
// admits only admins. The runtime flag remains a kill switch after launch.
export function ffqBanqiAdmits(accountUser: Pick<UserAccount, 'accountRole'> | null): boolean {
  return (
    ffqBanqiEnabled() &&
    (gameSpecForId(FFQ_BANQI_SPEC_ID).publicSurface !== 'hidden' ||
      accountUser?.accountRole === 'admin')
  );
}

// Live launch never opens correspondence (#994), including existing invites.
export function ffqBanqiCorrespondenceAdmits(
  accountUser: Pick<UserAccount, 'accountRole'> | null,
): boolean {
  return ffqBanqiEnabled() && accountUser?.accountRole === 'admin';
}

export function isFFQBanqiRequest(input: { gameSpecId?: unknown; variant?: unknown }): boolean {
  return input.gameSpecId === FFQ_BANQI_SPEC_ID || input.variant === FFQ_BANQI_SPEC_ID;
}
