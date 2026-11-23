import { AsyncLocalStorage } from 'node:async_hooks';

import type { SeatDecorations } from './seat-decorations.js';

export type AccountRoomIdentity = {
  userId: string;
  userHandle: string;
  userDisplayName: string;
} & SeatDecorations;

type AccountRoomScope = {
  first: AccountRoomIdentity;
  second: AccountRoomIdentity;
  created?: { id: string; seats: { first: string; second: string } };
};

// Like createAsLobbyMatch, this crosses the existing positional factory
// adapters without giving each variant a second, parallel live create binding.
const accountRoomScope = new AsyncLocalStorage<AccountRoomScope>();

export function accountRoomSeats(): AccountRoomScope | undefined {
  return accountRoomScope.getStore();
}

export function accountRoomCreated(id: string, first: string, second: string): void {
  const scope = accountRoomScope.getStore();
  if (scope) scope.created = { id, seats: { first, second } };
}

export async function createWithAccountSeats(
  first: AccountRoomIdentity,
  second: AccountRoomIdentity,
  create: () => Promise<{ id: string; region?: string }>,
) {
  if (first.userId === second.userId) throw new Error('distinct accounts required');
  const scope: AccountRoomScope = { first, second };
  return accountRoomScope.run(scope, async () => {
    const room = await create();
    if (!scope.created || scope.created.id !== room.id)
      throw new Error('account seats were not durably created');
    return { room, seats: scope.created.seats };
  });
}
