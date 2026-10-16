import { isXmjSeat, type XmjRoomStatus, type XmjSeat } from '@mistboard/game';

/**
 * The sting a frame earns: only on the live playing -> finished step, and only
 * for a player. A room that is already finished when it mounts (a reload, a
 * reconnect, a page opened from history) was finished before this client saw
 * it play, so it stays silent.
 */
export function xmjTerminalSound(
  previous: XmjRoomStatus['type'] | null,
  status: XmjRoomStatus | null | undefined,
  seat: XmjSeat | string | null | undefined,
): 'win' | 'lose' | 'draw' | null {
  if (previous !== 'playing' || status?.type !== 'finished' || !isXmjSeat(seat)) return null;
  if (status.winner === null) return 'draw';
  return status.winner === seat ? 'win' : 'lose';
}
