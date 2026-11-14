// Fanfanqi has fixed Red/Black seats. Sound reads only the viewer's masked
// view; a growing public capture list includes cannon takes of covered tiles.
import type { BanqiColor, FFQBanqiMove, FFQBanqiPlayerView } from '@mistboard/game';
import { playSound, playTerminalPlan } from './live-sound.js';
import type { SoundKind } from './live-state.js';

type View = FFQBanqiPlayerView;
type SeatOrSpectator = BanqiColor | 'spectator' | null;

let lastView: View | null = null;
let terminalSounded = false;

export function resetFFQBanqiSoundState(): void {
  lastView = null;
  terminalSounded = false;
}

/** Own actions sound on send. A covered destination can be a cannon capture;
 *  the public move geometry and occupancy suffice, without its hidden role. */
export function soundForOwnFFQBanqiMove(view: View, move: FFQBanqiMove): SoundKind {
  if (move.from === move.to) return 'flip';
  return view.board[move.to] ? 'capture' : 'move';
}

export function maybePlayFFQBanqiSound(view: View | null, seat: SeatOrSpectator): void {
  if (!view || !seat) return;
  const prev = lastView;
  lastView = view;
  if (!prev || prev.id !== view.id) {
    // Opening a finished game does not announce an old result.
    terminalSounded = view.status.type === 'finished';
    return;
  }
  if (view.status.type === 'finished' && !terminalSounded) {
    terminalSounded = true;
    // Spectators get the shared neutral draw cue, regardless of the winner.
    const result =
      seat === 'spectator' || view.status.winner === null
        ? 'draw'
        : view.status.winner === seat
          ? 'win'
          : 'lose';
    playTerminalPlan(result, null);
    return;
  }
  if (
    terminalSounded ||
    prev.status.type !== 'playing' ||
    view.status.type !== 'playing' ||
    view.ply <= prev.ply ||
    (seat !== 'spectator' && prev.status.turn === seat)
  ) {
    return;
  }
  // Check captures first: replacing a covered victim with the cannon also
  // looks like a face-down -> face-up change at the destination.
  if (view.captured.length > prev.captured.length) {
    playSound('capture');
  } else if (
    view.board.some((entry, index) => entry && !entry.faceDown && prev.board[index]?.faceDown)
  ) {
    playSound('flip');
  } else {
    playSound('move');
  }
}
