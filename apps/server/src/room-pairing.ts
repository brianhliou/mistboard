import { AsyncLocalStorage } from 'node:async_hooks';
import type { RoomPairing } from '@mistboard/game';

/**
 * How the room about to be made pairs its two people (#1229). Each route that
 * pairs people wraps its create in createWithPairing; both room factories (the
 * legacy chess createRoom and createTenantLiveRoom) read currentRoomPairing()
 * and stamp it on a PvP room's room-created event. Like createAsLobbyMatch and
 * createWithAccountSeats, the scope crosses every variant's positional create
 * adapter without a parallel argument through each one.
 *
 * Fail closed: a PvP room made outside any scope carries no pairing, and the web
 * reports it as `unknown`. Nothing here guesses a route.
 */
const pairingScope = new AsyncLocalStorage<RoomPairing>();

export function currentRoomPairing(): RoomPairing | undefined {
  return pairingScope.getStore();
}

export function createWithPairing<T>(pairing: RoomPairing, create: () => Promise<T>): Promise<T> {
  return pairingScope.run(pairing, create);
}
