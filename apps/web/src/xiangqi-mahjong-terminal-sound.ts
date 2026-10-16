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

/**
 * The sound a played move earns. A discard clicks (the viewer's own, or the
 * opponent's), a claimed set knocks, and a hand won (a win claim or a
 * self-draw) gets its own short cue so it no longer sounds like a set: a
 * light rising run for the viewer's win, a soft falling pair for the
 * opponent's (Brian, 2026-10-15). The hand that ends the match stays quiet
 * here; the match sting plays instead.
 */
export function xmjMoveSound(
  event: unknown,
  seat: unknown,
  matchOver: boolean,
): 'move' | 'captured' | 'capture' | 'level-end' | 'learn-failure' | null {
  const played = event as
    | { type?: string; color?: string; move?: { action?: string; kind?: string } }
    | undefined;
  if (played?.type !== 'move-played') return null;
  const { action, kind } = played.move ?? {};
  if (action === 'discard') return played.color === seat ? 'move' : 'captured';
  const handWon = action === 'self-draw' || (action === 'claim' && kind === 'win');
  if (handWon) {
    if (matchOver) return null;
    if (!isXmjSeat(seat)) return 'capture';
    return played.color === seat ? 'level-end' : 'learn-failure';
  }
  if (action === 'claim') return 'capture';
  return null;
}
